package services

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"hasnahena/apps/api/internal/models"
	"hasnahena/apps/api/internal/repositories"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserInactive       = errors.New("user not active")
	ErrInvalidToken       = errors.New("invalid token")
)

const (
	maxLoginFailures   = 5
	loginLockoutPeriod = 30 * time.Second
)

type ErrRateLimited struct {
	RetryAfterSeconds int
}

func (e *ErrRateLimited) Error() string {
	return "too many failed attempts"
}

type loginAttempt struct {
	FailedCount int
	LockedUntil time.Time
}

type AuthService struct {
	users     *repositories.UserRepository
	jwtSecret []byte
	jwtExpiry int64
	mu        sync.Mutex
	attempts  map[string]*loginAttempt
}

func NewAuthService(users *repositories.UserRepository, jwtSecret string, jwtExpiry int64) *AuthService {
	return &AuthService{
		users:     users,
		jwtSecret: []byte(jwtSecret),
		jwtExpiry: jwtExpiry,
		attempts:  make(map[string]*loginAttempt),
	}
}

func (s *AuthService) Login(ctx context.Context, identifier string, password string) (*models.LoginData, error) {
	identifier = strings.TrimSpace(identifier)
	password = strings.TrimSpace(password)
	if identifier == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	identifierKey := strings.ToLower(identifier)

	if retryAfter := s.checkLockout(identifierKey); retryAfter > 0 {
		return nil, &ErrRateLimited{RetryAfterSeconds: retryAfter}
	}

	user, err := s.users.FindByIdentifier(ctx, identifier)
	if err != nil {
		if retryAfter := s.recordFailedAttempt(identifierKey); retryAfter > 0 {
			return nil, &ErrRateLimited{RetryAfterSeconds: retryAfter}
		}
		return nil, ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		if retryAfter := s.recordFailedAttempt(identifierKey); retryAfter > 0 {
			return nil, &ErrRateLimited{RetryAfterSeconds: retryAfter}
		}
		return nil, ErrInvalidCredentials
	}

	if strings.ToUpper(user.Status) != "ACTIVE" {
		return nil, ErrUserInactive
	}
	s.clearFailedAttempts(identifierKey)

	now := time.Now().Unix()
	exp := now + s.jwtExpiry
	claims := jwt.MapClaims{
		"sub":   user.ID,
		"role":  user.Role,
		"email": user.Email,
		"phone": user.Phone,
		"iat":   now,
		"exp":   exp,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signedToken, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return nil, err
	}

	return &models.LoginData{
		AccessToken: signedToken,
		TokenType:   "Bearer",
		ExpiresIn:   s.jwtExpiry,
		User: models.User{
			ID:     user.ID,
			Email:  user.Email,
			Phone:  user.Phone,
			Role:   user.Role,
			Status: user.Status,
			NameEn: user.NameEn,
		},
	}, nil
}

func (s *AuthService) checkLockout(identifier string) int {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.attempts[identifier]
	if !ok {
		return 0
	}
	if entry.LockedUntil.After(now) {
		return int(entry.LockedUntil.Sub(now).Seconds()) + 1
	}
	if !entry.LockedUntil.IsZero() && entry.LockedUntil.Before(now) {
		delete(s.attempts, identifier)
	}
	return 0
}

func (s *AuthService) recordFailedAttempt(identifier string) int {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()

	entry, ok := s.attempts[identifier]
	if !ok {
		entry = &loginAttempt{}
		s.attempts[identifier] = entry
	}
	entry.FailedCount++
	if entry.FailedCount >= maxLoginFailures {
		entry.LockedUntil = now.Add(loginLockoutPeriod)
		return int(loginLockoutPeriod.Seconds())
	}
	return 0
}

func (s *AuthService) clearFailedAttempts(identifier string) {
	s.mu.Lock()
	delete(s.attempts, identifier)
	s.mu.Unlock()
}

func (s *AuthService) ParseAccessToken(tokenString string) (jwt.MapClaims, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, ErrInvalidToken
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return s.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	return claims, nil
}
