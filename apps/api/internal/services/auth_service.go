package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
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
	ErrTokenRevoked       = errors.New("token has been revoked")
)

type ErrRateLimited struct {
	RetryAfterSeconds int
}

func (e *ErrRateLimited) Error() string {
	return "too many failed attempts"
}

type AuthService struct {
	users     *repositories.UserRepository
	security  *SecurityService
	email     *EmailService
	jwtSecret []byte
	jwtExpiry int64
}

func NewAuthService(users *repositories.UserRepository, security *SecurityService, email *EmailService, jwtSecret string, jwtExpiry int64) *AuthService {
	return &AuthService{
		users:     users,
		security:  security,
		email:     email,
		jwtSecret: []byte(jwtSecret),
		jwtExpiry: jwtExpiry,
	}
}

func (s *AuthService) Login(ctx context.Context, identifier string, password string, userIP string, userAgent string) (*models.LoginData, error) {
	identifier = strings.TrimSpace(identifier)
	password = strings.TrimSpace(password)
	if identifier == "" || password == "" {
		return nil, ErrInvalidCredentials
	}
	identifierKey := strings.ToLower(identifier)

	// Check distributed rate limit
	rateResult, err := s.security.CheckRateLimit(ctx, "login", identifierKey)
	if err == nil && !rateResult.Allowed {
		return nil, &ErrRateLimited{RetryAfterSeconds: rateResult.RetryAfterSecs}
	}

	user, err := s.users.FindByIdentifier(ctx, identifier)
	if err != nil {
		rateResult, _ := s.security.RecordFailedAttempt(ctx, "login", identifierKey)
		if rateResult != nil && !rateResult.Allowed {
			return nil, &ErrRateLimited{RetryAfterSeconds: rateResult.RetryAfterSecs}
		}
		return nil, ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		rateResult, _ := s.security.RecordFailedAttempt(ctx, "login", identifierKey)
		if rateResult != nil && !rateResult.Allowed {
			return nil, &ErrRateLimited{RetryAfterSeconds: rateResult.RetryAfterSecs}
		}
		return nil, ErrInvalidCredentials
	}

	if strings.ToUpper(user.Status) != "ACTIVE" {
		return nil, ErrUserInactive
	}

	// Clear rate limit on successful login
	s.security.ClearRateLimit(ctx, "login", identifierKey)

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

	// Create audit log for successful login
	s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "LOGIN",
		EntityType: "USER",
		EntityID:   user.ID,
		UserID:     user.ID,
		UserIP:     userIP,
		UserAgent:  userAgent,
		Details:    "Successful login",
	})

	return &models.LoginData{
		AccessToken: signedToken,
		TokenType:   "Bearer",
		ExpiresIn:   s.jwtExpiry,
		User: models.User{
			ID:                 user.ID,
			Email:              user.Email,
			Phone:              user.Phone,
			Role:               user.Role,
			Status:             user.Status,
			NameEn:             user.NameEn,
			MustChangePassword: user.MustChangePassword,
		},
	}, nil
}

// Logout blacklists the current token
func (s *AuthService) Logout(ctx context.Context, token string, userID string, userIP string, userAgent string) error {
	// Parse token to get expiry
	claims, err := s.ParseAccessToken(token)
	if err != nil {
		return err
	}

	exp, ok := claims["exp"].(float64)
	if !ok {
		return ErrInvalidToken
	}
	expiresAt := time.Unix(int64(exp), 0)

	// Add token to blacklist
	if err := s.security.BlacklistToken(ctx, token, userID, "logout", expiresAt); err != nil {
		return err
	}

	// Create audit log
	s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "LOGOUT",
		EntityType: "USER",
		EntityID:   userID,
		UserID:     userID,
		UserIP:     userIP,
		UserAgent:  userAgent,
		Details:    "User logged out",
	})

	return nil
}

// InvalidateAllUserTokens revokes all tokens for a user (used on password change)
func (s *AuthService) InvalidateAllUserTokens(ctx context.Context, userID string, reason string) error {
	return s.security.BlacklistAllUserTokens(ctx, userID, reason)
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

// ValidateToken checks if token is valid AND not blacklisted
func (s *AuthService) ValidateToken(ctx context.Context, tokenString string) (jwt.MapClaims, error) {
	claims, err := s.ParseAccessToken(tokenString)
	if err != nil {
		return nil, err
	}

	// Check if token is blacklisted
	blacklisted, err := s.security.IsTokenBlacklisted(ctx, tokenString)
	if err != nil {
		return nil, err
	}
	if blacklisted {
		return nil, ErrTokenRevoked
	}

	// Check if all user tokens were revoked (e.g., password change)
	userID, _ := claims["sub"].(string)
	iat, _ := claims["iat"].(float64)
	if userID != "" && iat > 0 {
		issuedAt := time.Unix(int64(iat), 0)
		revoked, err := s.security.IsUserTokensRevoked(ctx, userID, issuedAt)
		if err == nil && revoked {
			return nil, ErrTokenRevoked
		}
	}

	return claims, nil
}

func (s *AuthService) ForgotPassword(ctx context.Context, identifier string, locale string) error {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return errors.New("identifier is required")
	}

	user, err := s.users.FindByIdentifier(ctx, identifier)
	if err != nil {
		return errors.New("user not found")
	}

	user.Email = strings.TrimSpace(user.Email)
	if user.Email == "" {
		return errors.New("no email associated with account")
	}

	if err := s.users.DeleteResetTokens(ctx, user.Email, user.Phone); err != nil {
		return err
	}

	token := make([]byte, 32)
	rand.Read(token)
	tokenHex := hex.EncodeToString(token)
	expiresAt := time.Now().Add(time.Hour)

	if err := s.users.CreateResetToken(ctx, tokenHex, user.Email, user.Phone, expiresAt); err != nil {
		return err
	}

	return s.email.SendPasswordResetEmail(user.Email, tokenHex, locale)
}

func (s *AuthService) ValidateResetToken(ctx context.Context, token string) (*repositories.PasswordResetToken, error) {
	resetToken, err := s.users.GetResetToken(ctx, token)
	if err != nil {
		return nil, errors.New("invalid or expired token")
	}

	if resetToken.UsedAt != nil || resetToken.ExpiresAt.Before(time.Now()) {
		if resetToken.ExpiresAt.Before(time.Now()) {
			_ = s.users.DeleteResetTokenByID(ctx, resetToken.ID)
		}
		return nil, errors.New("token is expired or already used")
	}

	return resetToken, nil
}

func (s *AuthService) ResetPassword(ctx context.Context, token string, newPassword string) error {
	resetToken, err := s.ValidateResetToken(ctx, token)
	if err != nil {
		return err
	}

	email := ""
	if resetToken.Email != nil {
		email = *resetToken.Email
	}
	phone := ""
	if resetToken.Phone != nil {
		phone = *resetToken.Phone
	}

	user, err := s.users.FindByIdentifier(ctx, email)
	if err != nil {
		user, err = s.users.FindByIdentifier(ctx, phone)
		if err != nil {
			return errors.New("user not found")
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	if err := s.users.UpdatePassword(ctx, email, phone, string(hash)); err != nil {
		return err
	}

	if err := s.users.MarkResetTokenUsed(ctx, resetToken.ID); err != nil {
		return err
	}

	s.security.CreateAuditLog(ctx, AuditLogEntry{
		Action:     "PASSWORD_RESET",
		EntityType: "USER",
		EntityID:   user.ID,
		UserID:     user.ID,
		Details:    "Password reset via email/phone link",
	})

	return nil
}
