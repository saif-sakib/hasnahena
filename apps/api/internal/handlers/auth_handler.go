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

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req models.ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Invalid request payload")
		return
	}

	req.Identifier = strings.TrimSpace(req.Identifier)
	if req.Identifier == "" {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Email or phone is required")
		return
	}

	if req.Locale == "" {
		req.Locale = "en"
	}

	err := h.authService.ForgotPassword(r.Context(), req.Identifier, req.Locale)
	if err != nil {
		errorText := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errorText, "user not found"):
			utils.Error(w, http.StatusNotFound, "AUTH_USER_NOT_FOUND", "No account found with this email or phone")
			return
		case strings.Contains(errorText, "no email"):
			utils.Error(w, http.StatusBadRequest, "AUTH_EMAIL_REQUIRED", "This account does not have an email address for password reset")
			return
		case strings.Contains(errorText, "not configured"):
			utils.Error(w, http.StatusServiceUnavailable, "EMAIL_NOT_CONFIGURED", "Email service is not configured. Set BREVO_API_KEY and EMAIL_FROM on backend deployment")
			return
		default:
			utils.Error(w, http.StatusInternalServerError, "AUTH_FORGOT_PASSWORD_FAILED", "Failed to send password reset email")
			return
		}
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"message": "Password reset link sent to your email.",
	})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req models.ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Invalid request payload")
		return
	}

	if req.Token == "" || req.Password == "" {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Token and password are required")
		return
	}

	err := h.authService.ResetPassword(r.Context(), req.Token, req.Password)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_RESET_ERROR", err.Error())
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"message": "Password reset successfully",
	})
}

func (h *AuthHandler) ValidateResetToken(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Token is required")
		return
	}

	_, err := h.authService.ValidateResetToken(r.Context(), token)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_INVALID_TOKEN", err.Error())
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"valid": true,
	})
}
