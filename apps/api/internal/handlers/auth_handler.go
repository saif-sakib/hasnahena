package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	appmw "hasnahena/apps/api/internal/middleware"
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

// getClientIP is the address a login attempt is attributed to.
//
// It used to read the LEFTMOST X-Forwarded-For entry — the end the caller
// writes — and this value keys the login lockout. Varying one header therefore
// gave an attacker a fresh allowance of failed attempts per request, which is
// the lockout not existing. It now goes through the same resolver as the access
// log and the rate limiter (WO-60).
func getClientIP(r *http.Request) string {
	return appmw.RequestClientIP(r)
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
	appmw.SetRequestUserID(r.Context(), userID)
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

// forgotPasswordReply is the ONLY thing a caller learns from this endpoint, and
// it is the same for a member, a suspended member, a member with no email
// address, and a phone number that has never been near this foundation.
//
// The three answers it replaces were a membership oracle: 404 meant "not a
// member", 400 AUTH_EMAIL_REQUIRED meant "a member, and here is a fact about
// their record", 200 meant "a member" (WO-88). Nothing below may branch on what
// the lookup found — see AuthService.ForgotPassword, which returns nil for
// every one of those cases and logs what actually happened.
const forgotPasswordReply = "If an account exists for that email or phone, a password reset link has been sent."

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

	// The two refusals that survive are both true of every caller alike: the
	// throttle counts what *this* caller has asked for, and an unconfigured
	// email service is decided before any lookup happens.
	err := h.authService.ForgotPassword(r.Context(), req.Identifier, req.Locale, getClientIP(r))
	var rateLimited *services.ErrRateLimited
	switch {
	case err == nil:
	case errors.As(err, &rateLimited):
		utils.Error(w, http.StatusTooManyRequests, "AUTH_RATE_LIMITED",
			"Too many password reset requests. Try again in "+strconv.Itoa(rateLimited.RetryAfterSeconds)+" seconds")
		return
	case errors.Is(err, services.ErrEmailNotConfigured):
		utils.Error(w, http.StatusServiceUnavailable, "EMAIL_NOT_CONFIGURED", "Email service is not configured. Set BREVO_API_KEY and EMAIL_FROM on backend deployment")
		return
	default:
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Email or phone is required")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"message": forgotPasswordReply,
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

	// An invalid link is the caller's problem and says so; anything else is
	// ours, and answering it with err.Error() used to put internal detail on a
	// public endpoint.
	if err := h.authService.ResetPassword(r.Context(), req.Token, req.Password); err != nil {
		if errors.Is(err, services.ErrInvalidResetToken) {
			utils.Error(w, http.StatusBadRequest, "AUTH_INVALID_TOKEN", "This reset link is invalid or has expired")
			return
		}
		slog.Error("password reset failed", "error", err)
		utils.Error(w, http.StatusInternalServerError, "AUTH_RESET_ERROR", "Failed to reset password")
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

	if _, err := h.authService.ValidateResetToken(r.Context(), token); err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_INVALID_TOKEN", "This reset link is invalid or has expired")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"valid": true,
	})
}
