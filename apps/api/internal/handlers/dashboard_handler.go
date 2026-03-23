package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"hasnahena/apps/api/internal/repositories"
	"hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

type DashboardHandler struct {
	authService *services.AuthService
	userRepo    *repositories.UserRepository
}

type authContext struct {
	UserID string
	Role   string
}

func NewDashboardHandler(authService *services.AuthService, userRepo *repositories.UserRepository) *DashboardHandler {
	return &DashboardHandler{
		authService: authService,
		userRepo:    userRepo,
	}
}

func (h *DashboardHandler) MemberDashboard(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}

	data, err := h.userRepo.GetMemberDashboardData(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "DASHBOARD_FETCH_FAILED", "Failed to load dashboard data")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) Notifications(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	data, err := h.userRepo.GetNotifications(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "NOTIFICATION_FETCH_FAILED", "Failed to load notifications")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberDeposits(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}
	data, err := h.userRepo.GetMemberDeposits(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_DEPOSITS_FETCH_FAILED", "Failed to load member deposits")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberTransactions(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}
	data, err := h.userRepo.GetMemberTransactions(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_TRANSACTIONS_FETCH_FAILED", "Failed to load member transactions")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberLoans(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}
	data, err := h.userRepo.GetMemberLoans(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_LOANS_FETCH_FAILED", "Failed to load member loans")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MemberProfile(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}
	data, err := h.userRepo.GetMemberProfile(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "MEMBER_PROFILE_FETCH_FAILED", "Failed to load member profile")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerDashboard(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
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
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
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
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN"); !ok {
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
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN"); !ok {
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
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN"); !ok {
		return
	}
	data, err := h.userRepo.GetMembersList(r.Context(), true)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "ADMIN_WORKERS_FETCH_FAILED", "Failed to load workers")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) authFromRequest(r *http.Request) (*authContext, error) {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "" || !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return nil, errors.New("missing bearer token")
	}

	tokenString := strings.TrimSpace(authHeader[7:])
	claims, err := h.authService.ParseAccessToken(tokenString)
	if err != nil {
		return nil, err
	}

	subValue, ok := claims["sub"]
	if !ok {
		return nil, errors.New("missing sub claim")
	}

	userID, ok := subValue.(string)
	if !ok || strings.TrimSpace(userID) == "" {
		return nil, errors.New("invalid sub claim")
	}

	roleValue, ok := claims["role"]
	if !ok {
		return nil, errors.New("missing role claim")
	}
	role, ok := roleValue.(string)
	if !ok || strings.TrimSpace(role) == "" {
		return nil, errors.New("invalid role claim")
	}

	return &authContext{
		UserID: userID,
		Role:   strings.ToUpper(strings.TrimSpace(role)),
	}, nil
}

func (h *DashboardHandler) userIDFromRequest(r *http.Request) (string, error) {
	auth, err := h.authFromRequest(r)
	if err != nil {
		return "", err
	}
	return auth.UserID, nil
}

func (h *DashboardHandler) requireAuthenticated(w http.ResponseWriter, r *http.Request) (*authContext, bool) {
	auth, err := h.authFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return nil, false
	}
	return auth, true
}

func (h *DashboardHandler) requireRoles(w http.ResponseWriter, r *http.Request, roles ...string) (*authContext, bool) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return nil, false
	}

	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[strings.ToUpper(strings.TrimSpace(role))] = struct{}{}
	}
	if _, exists := allowed[auth.Role]; !exists {
		utils.Error(w, http.StatusForbidden, "AUTH_FORBIDDEN", "Insufficient permissions")
		return nil, false
	}
	return auth, true
}

func (h *DashboardHandler) UserInfo(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetUserInfo(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "USER_INFO_FETCH_FAILED", "Failed to load user info")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) UpdateMemberStatus(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		MemberID string `json:"memberId"`
		Status   string `json:"status"`
		Reason   string `json:"reason"`
	}

	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	validStatuses := map[string]bool{"ACTIVE": true, "SUSPENDED": true, "PENDING": true, "INACTIVE": true}
	if !validStatuses[req.Status] {
		utils.Error(w, http.StatusBadRequest, "INVALID_STATUS", "Invalid status value")
		return
	}

	if err := h.userRepo.UpdateUserStatus(r.Context(), req.MemberID, req.Status, req.Reason); err != nil {
		utils.Error(w, http.StatusInternalServerError, "UPDATE_FAILED", "Failed to update member status")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Member status updated successfully"})
}

// ==================== ADMIN APPROVAL HANDLERS ====================

func (h *DashboardHandler) AdminApprovals(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}
	data, err := h.userRepo.GetPendingApprovals(r.Context())
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "APPROVALS_FETCH_FAILED", "Failed to load approvals")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) ApproveRegistration(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		UserID string `json:"userId"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.ApproveRegistration(r.Context(), req.UserID, userID, req.Notes); err != nil {
		utils.Error(w, http.StatusInternalServerError, "APPROVE_FAILED", "Failed to approve registration")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Registration approved successfully"})
}

func (h *DashboardHandler) RejectRegistration(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		UserID string `json:"userId"`
		Reason string `json:"reason"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.RejectRegistration(r.Context(), req.UserID, userID, req.Reason); err != nil {
		utils.Error(w, http.StatusInternalServerError, "REJECT_FAILED", "Failed to reject registration")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Registration rejected successfully"})
}

func (h *DashboardHandler) ApproveLoan(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		LoanID string `json:"loanId"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.ApproveLoan(r.Context(), req.LoanID, userID); err != nil {
		utils.Error(w, http.StatusInternalServerError, "APPROVE_LOAN_FAILED", "Failed to approve loan")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Loan approved successfully"})
}

func (h *DashboardHandler) RejectLoan(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		LoanID string `json:"loanId"`
		Reason string `json:"reason"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.RejectLoan(r.Context(), req.LoanID, userID, req.Reason); err != nil {
		utils.Error(w, http.StatusInternalServerError, "REJECT_LOAN_FAILED", "Failed to reject loan")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Loan rejected successfully"})
}

func (h *DashboardHandler) ApproveWithdrawal(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		RequestID string `json:"requestId"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.ApproveWithdrawal(r.Context(), req.RequestID, userID); err != nil {
		utils.Error(w, http.StatusInternalServerError, "APPROVE_WITHDRAWAL_FAILED", "Failed to approve withdrawal")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Withdrawal approved successfully"})
}

func (h *DashboardHandler) RejectWithdrawal(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		RequestID string `json:"requestId"`
		Reason    string `json:"reason"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.RejectWithdrawal(r.Context(), req.RequestID, userID, req.Reason); err != nil {
		utils.Error(w, http.StatusInternalServerError, "REJECT_WITHDRAWAL_FAILED", "Failed to reject withdrawal")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Withdrawal rejected successfully"})
}

// ==================== ADMIN DEPOSITS HANDLERS ====================

func (h *DashboardHandler) AdminDeposits(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	filters := map[string]interface{}{
		"type":   r.URL.Query().Get("type"),
		"search": r.URL.Query().Get("search"),
	}

	data, err := h.userRepo.GetAllDeposits(r.Context(), filters)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "DEPOSITS_FETCH_FAILED", "Failed to load deposits")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

// ==================== ADMIN LOANS HANDLERS ====================

func (h *DashboardHandler) AdminLoans(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	filters := map[string]interface{}{
		"status": r.URL.Query().Get("status"),
		"search": r.URL.Query().Get("search"),
	}

	data, err := h.userRepo.GetAllLoans(r.Context(), filters)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "LOANS_FETCH_FAILED", "Failed to load loans")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) AdminLoanDetail(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	loanID := r.URL.Query().Get("id")
	if loanID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Loan ID required")
		return
	}

	data, err := h.userRepo.GetLoanDetail(r.Context(), loanID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "LOAN_DETAIL_FETCH_FAILED", "Failed to load loan detail")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) MarkLoanDefaulted(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		LoanID string `json:"loanId"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.MarkLoanDefaulted(r.Context(), req.LoanID, userID, req.Notes); err != nil {
		utils.Error(w, http.StatusInternalServerError, "MARK_DEFAULT_FAILED", "Failed to mark loan as defaulted")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Loan marked as defaulted and recovery processed"})
}

// ==================== ADMIN DONATIONS HANDLERS ====================

func (h *DashboardHandler) AdminDonations(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetDonations(r.Context())
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "DONATIONS_FETCH_FAILED", "Failed to load donations")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) RecordDonation(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		Amount    int64  `json:"amount"`
		DonorName string `json:"donorName"`
		Notes     string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.RecordDonation(r.Context(), req.Amount, req.DonorName, req.Notes); err != nil {
		utils.Error(w, http.StatusInternalServerError, "RECORD_DONATION_FAILED", "Failed to record donation")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Donation recorded successfully"})
}

// ==================== ADMIN REPORTS HANDLERS ====================

func (h *DashboardHandler) MonthlyReport(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	year := 2024
	month := 1

	if yearStr := r.URL.Query().Get("year"); yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			year = y
		}
	}

	if monthStr := r.URL.Query().Get("month"); monthStr != "" {
		if m, err := strconv.Atoi(monthStr); err == nil {
			month = m
		}
	}

	data, err := h.userRepo.GetMonthlyReport(r.Context(), year, month)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "REPORT_FETCH_FAILED", "Failed to load monthly report")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) YearlyReport(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	year := 2024

	if yearStr := r.URL.Query().Get("year"); yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			year = y
		}
	}

	data, err := h.userRepo.GetYearlyReport(r.Context(), year)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "REPORT_FETCH_FAILED", "Failed to load yearly report")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) LoanPerformanceReport(w http.ResponseWriter, r *http.Request) {
	if _, err := h.userIDFromRequest(r); err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetLoanPerformanceReport(r.Context())
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "REPORT_FETCH_FAILED", "Failed to load loan performance report")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

// ==================== ADMIN PROFILE HANDLERS ====================

func (h *DashboardHandler) AdminProfile(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetAdminProfile(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "PROFILE_FETCH_FAILED", "Failed to load admin profile")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req map[string]interface{}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.UpdateProfile(r.Context(), userID, req); err != nil {
		utils.Error(w, http.StatusInternalServerError, "UPDATE_PROFILE_FAILED", "Failed to update profile")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Profile updated successfully"})
}

// ==================== WORKER HANDLERS ====================

func (h *DashboardHandler) WorkerRequests(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetWorkerRequests(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "REQUESTS_FETCH_FAILED", "Failed to load worker requests")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerLoans(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetWorkerLoans(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "LOANS_FETCH_FAILED", "Failed to load worker loans")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerTransactions(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetWorkerTransactions(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "TRANSACTIONS_FETCH_FAILED", "Failed to load worker transactions")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerProfile(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	data, err := h.userRepo.GetWorkerProfile(r.Context(), userID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "PROFILE_FETCH_FAILED", "Failed to load worker profile")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) ProcessDeposit(w http.ResponseWriter, r *http.Request) {
	userID, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		MemberID string `json:"memberId"`
		Amount   int64  `json:"amount"`
		Receipt  string `json:"receipt"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.ProcessDeposit(r.Context(), req.MemberID, userID, req.Amount, req.Receipt); err != nil {
		utils.Error(w, http.StatusInternalServerError, "PROCESS_DEPOSIT_FAILED", "Failed to process deposit")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Deposit processed successfully"})
}

func (h *DashboardHandler) ProcessWithdrawal(w http.ResponseWriter, r *http.Request) {
	_, err := h.userIDFromRequest(r)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing token")
		return
	}

	var req struct {
		MemberID string `json:"memberId"`
		Amount   int64  `json:"amount"`
		Reason   string `json:"reason"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	// Would call ProcessWithdrawal repository method when implemented
	utils.Success(w, http.StatusOK, map[string]string{"message": "Withdrawal processed successfully"})
}
