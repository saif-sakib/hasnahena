package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"hasnahena/apps/api/internal/models"
	"hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

type AuthHandler struct {
	authService *services.AuthService
}

func NewAuthHandler(authService *services.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, http.StatusBadRequest, "AUTH_VALIDATION_ERROR", "Invalid request payload")
		return
	}

	result, err := h.authService.Login(r.Context(), req.Identifier, req.Password)
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
