package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"hasnahena/apps/api/internal/models"
	"hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

type AuthHandler struct {
	authService     *services.AuthService
	securityService *services.SecurityService
}

func NewAuthHandler(authService *services.AuthService, securityService *services.SecurityService) *AuthHandler {
	return &AuthHandler{
		authService:     authService,
		securityService: securityService,
	}
}

// getClientIP extracts the real client IP from request headers
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For first (for proxied requests)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	// Check X-Real-IP
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	// Fall back to RemoteAddr
	return r.RemoteAddr
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Invalid request payload")
		return
	}

	userIP := getClientIP(r)
	userAgent := r.Header.Get("User-Agent")

	result, err := h.authService.Login(r.Context(), req.Identifier, req.Password, userIP, userAgent)
	if err != nil {
		var rateLimited *services.ErrRateLimited
		if errors.As(err, &rateLimited) {
			utils.Error(w, http.StatusTooManyRequests, "AUTH_RATE_LIMITED", "Too many failed attempts. Try again in "+strconv.Itoa(rateLimited.RetryAfterSeconds)+" seconds")
			return
		}
		if errors.Is(err, services.ErrInvalidCredentials) {
			utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "Incorrect email/phone or password")
			return
		}
		if errors.Is(err, services.ErrUserInactive) {
			utils.Error(w, http.StatusForbidden, "AUTH_USER_INACTIVE", "User is not active yet")
			return
		}

		utils.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to login")
		return
	}

	utils.Success(w, http.StatusOK, result)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// Extract token from Authorization header
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		utils.Error(w, http.StatusUnauthorized, "AUTH_NO_TOKEN", "No authorization token provided")
		return
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid authorization header format")
		return
	}

	// Parse token to get user ID
	claims, err := h.authService.ParseAccessToken(token)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid token")
		return
	}

	userID, _ := claims["sub"].(string)
	if userID == "" {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid token claims")
		return
	}

	userIP := getClientIP(r)
	userAgent := r.Header.Get("User-Agent")

	// Blacklist the token
	if err := h.authService.Logout(r.Context(), token, userID, userIP, userAgent); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to logout")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Successfully logged out"})
}
