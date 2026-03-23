package handlers

import (
	"errors"
	"net/http"
	"strings"

	"hasnahena/apps/api/internal/repositories"
	"hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

type DashboardHandler struct {
	authService *services.AuthService
	userRepo    *repositories.UserRepository
}

func NewDashboardHandler(authService *services.AuthService, userRepo *repositories.UserRepository) *DashboardHandler {
	return &DashboardHandler{
		authService: authService,
		userRepo:    userRepo,
	}
}

func (h *DashboardHandler) MemberDashboard(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetMemberDashboardData(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "DASHBOARD_FETCH_FAILED", "Failed to load dashboard data")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) Notifications(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetNotifications(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "NOTIFICATION_FETCH_FAILED", "Failed to load notifications")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberDeposits(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMemberDeposits(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_DEPOSITS_FETCH_FAILED", "Failed to load member deposits")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberTransactions(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMemberTransactions(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_TRANSACTIONS_FETCH_FAILED", "Failed to load member transactions")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberLoans(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMemberLoans(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_LOANS_FETCH_FAILED", "Failed to load member loans")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberProfile(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMemberProfile(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_PROFILE_FETCH_FAILED", "Failed to load member profile")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerDashboard(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetWorkerDashboard(r.Context())
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "WORKER_DASHBOARD_FETCH_FAILED", "Failed to load worker dashboard")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerMembers(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMembersList(r.Context(), false)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "WORKER_MEMBERS_FETCH_FAILED", "Failed to load worker members")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) AdminDashboard(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetAdminDashboard(r.Context())
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "ADMIN_DASHBOARD_FETCH_FAILED", "Failed to load admin dashboard")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) AdminMembers(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMembersList(r.Context(), false)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "ADMIN_MEMBERS_FETCH_FAILED", "Failed to load members")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) AdminWorkers(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetMembersList(r.Context(), true)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "ADMIN_WORKERS_FETCH_FAILED", "Failed to load workers")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) userIDFromRequest(r *http.Request) (string, error) {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "" || !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return "", errors.New("missing bearer token")
	}

	tokenString := strings.TrimSpace(authHeader[7:])
	claims, err := h.authService.ParseAccessToken(tokenString)
	if err != nil {
		return "", err
	}

	subValue, ok := claims["sub"]
	if !ok {
		return "", errors.New("missing sub claim")
	}

	userID, ok := subValue.(string)
	if !ok || strings.TrimSpace(userID) == "" {
		return "", errors.New("invalid sub claim")
	}

	return userID, nil
}
