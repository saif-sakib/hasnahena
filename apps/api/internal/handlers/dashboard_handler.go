package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	appmw "hasnahena/apps/api/internal/middleware"
	"hasnahena/apps/api/internal/repositories"
	"hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

type DashboardHandler struct {
	authService     *services.AuthService
	securityService *services.SecurityService
	emailService    *services.EmailService
	userRepo        *repositories.UserRepository

	// Closed when the process starts shutting down, so open SSE streams end at
	// once instead of eating the whole drain window. See BeginShutdown.
	shutdown     chan struct{}
	shutdownOnce sync.Once
}

type authContext struct {
	UserID string
	Role   string
}

func NewDashboardHandler(authService *services.AuthService, securityService *services.SecurityService, userRepo *repositories.UserRepository, emailService *services.EmailService) *DashboardHandler {
	return &DashboardHandler{
		authService:     authService,
		securityService: securityService,
		emailService:    emailService,
		userRepo:        userRepo,
		shutdown:        make(chan struct{}),
	}
}

// BeginShutdown ends every open SSE stream.
//
// http.Server.Shutdown waits for connections to go idle, and an SSE connection
// by design never does — without this a deploy would sit out the full drain
// timeout and then cut the streams anyway. It deliberately does not touch
// ordinary requests: those are allowed to finish, which is the whole point of
// a graceful shutdown on a service that moves money (RUN-02).
func (h *DashboardHandler) BeginShutdown() {
	h.shutdownOnce.Do(func() { close(h.shutdown) })
}

// generateFirstLoginSecret is the value behind the first-login marker.
//
// It carries no "first-login-" prefix any more: the purpose is a `scope` column
// and the secret itself is stored hashed (WO-86). Nothing ever presents this
// value — the marker's *existence* is what `mustChangePassword` reads — but it
// is generated from crypto/rand all the same, because a row keyed on something
// guessable is a row somebody can plant.
func generateFirstLoginSecret() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// tempPasswordAlphabet omits I, l, 1, O and 0 — a temporary password is read
// aloud down a phone line when email delivery fails, and those five are the
// pairs that get misheard.
const tempPasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"

func generateTempPassword() (string, error) {
	return utils.RandomString(12, tempPasswordAlphabet)
}

// generateNumericCode issues the password-change verification code. Uniform per
// digit: see utils.RandomString for why `%10` over a random byte was not
// (WO-65).
func generateNumericCode(length int) (string, error) {
	if length <= 0 {
		return "", errors.New("invalid code length")
	}
	return utils.RandomString(length, "0123456789")
}

func validateStrongPassword(newPass string) error {
	if len(newPass) < 8 {
		return errors.New("password must be at least 8 characters")
	}

	hasUpper, hasLower, hasDigit := false, false, false
	for _, c := range newPass {
		switch {
		case 'A' <= c && c <= 'Z':
			hasUpper = true
		case 'a' <= c && c <= 'z':
			hasLower = true
		case '0' <= c && c <= '9':
			hasDigit = true
		}
	}

	if !hasUpper || !hasLower || !hasDigit {
		return errors.New("password must contain uppercase, lowercase, and numbers")
	}

	return nil
}

func summarizeEmailDeliveryError(err error) string {
	if err == nil {
		return "unknown error"
	}

	msg := strings.TrimSpace(strings.ReplaceAll(err.Error(), "\n", " "))
	lower := strings.ToLower(msg)

	switch {
	case strings.Contains(lower, "status 401") || strings.Contains(lower, "status 403") || strings.Contains(lower, "invalid api key"):
		return "Brevo authentication failed (check BREVO_API_KEY)"
	case strings.Contains(lower, "status 429") || strings.Contains(lower, "quota") || strings.Contains(lower, "rate limit"):
		return "Brevo rate limit or sending quota reached"
	case strings.Contains(lower, "timeout") || strings.Contains(lower, "i/o timeout") || strings.Contains(lower, "deadline exceeded"):
		return "Brevo API request timed out"
	case strings.Contains(lower, "status 400") || strings.Contains(lower, "status 422"):
		return "Brevo rejected the email payload (check EMAIL_FROM and recipient addresses)"
	case strings.Contains(lower, "status 5"):
		return "Brevo service is temporarily unavailable"
	case strings.Contains(lower, "not configured"):
		return "Email service is not configured"
	default:
		if len(msg) > 160 {
			return msg[:160] + "..."
		}
		if msg == "" {
			return "unknown error"
		}
		return msg
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

	if r.Method == http.MethodPatch {
		var req struct {
			NotificationID string `json:"notificationId"`
			MarkAll        bool   `json:"markAll"`
		}
		if err := utils.ParseJSON(r, &req); err != nil {
			utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
			return
		}
		if req.MarkAll {
			if err := h.userRepo.MarkAllNotificationsRead(r.Context(), auth.UserID, auth.Role); err != nil {
				utils.Error(w, http.StatusInternalServerError, "NOTIFICATION_UPDATE_FAILED", "Failed to update notifications")
				return
			}
			utils.Success(w, http.StatusOK, nil)
			return
		}
		if strings.TrimSpace(req.NotificationID) == "" {
			utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "notificationId is required")
			return
		}
		if err := h.userRepo.MarkNotificationRead(r.Context(), auth.UserID, auth.Role, req.NotificationID); err != nil {
			utils.Error(w, http.StatusInternalServerError, "NOTIFICATION_UPDATE_FAILED", "Failed to update notification")
			return
		}
		utils.Success(w, http.StatusOK, nil)
		return
	}

	data, err := h.userRepo.GetNotifications(r.Context(), auth.UserID, auth.Role)
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

func (h *DashboardHandler) MemberCreateDepositRequest(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}

	var req struct {
		Amount         int64  `json:"amount"`
		BkashReference string `json:"bkashReference"`
		Notes          string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxDepositAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount exceeds maximum allowed")
		return
	}
	if strings.TrimSpace(req.BkashReference) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "bKash reference is required")
		return
	}

	requestID, err := h.userRepo.CreateMemberDepositRequest(r.Context(), auth.UserID, req.Amount, req.BkashReference, req.Notes)
	if err != nil {
		errMsg := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errMsg, "not found"):
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
		case strings.Contains(errMsg, "not active"):
			utils.Error(w, http.StatusBadRequest, "MEMBER_NOT_ACTIVE", "Member account is not active")
		case strings.Contains(errMsg, "duplicate"):
			utils.Error(w, http.StatusConflict, "DUPLICATE_REQUEST", "A similar deposit request is already pending")
		default:
			utils.Error(w, http.StatusInternalServerError, "REQUEST_CREATE_FAILED", "Failed to submit deposit request")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":   "Deposit request submitted successfully",
		"requestId": requestID,
	})
}

// A member used to file their own withdrawal notice here — POST
// /member/requests/withdrawal, which started the FR-08 clock. The route and its
// repository method are gone (ADR-030): a member asks a field worker, and staff
// pay at the desk. `loan.noticePeriodDays` is what the foundation asks for
// rather than what this code enforces, and it is published on the member's
// savings screen and in the FAQ.

func (h *DashboardHandler) MemberCreateLoanRepaymentRequest(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "MEMBER")
	if !ok {
		return
	}

	var req struct {
		LoanID         string `json:"loanId"`
		Amount         int64  `json:"amount"`
		BkashReference string `json:"bkashReference"`
		Notes          string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if strings.TrimSpace(req.LoanID) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "loanId is required")
		return
	}
	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxLoanPaymentAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount exceeds maximum allowed")
		return
	}
	if strings.TrimSpace(req.BkashReference) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "bKash reference is required")
		return
	}

	requestID, err := h.userRepo.CreateMemberLoanRepaymentRequest(r.Context(), auth.UserID, req.LoanID, req.Amount, req.BkashReference, req.Notes)
	if err != nil {
		errMsg := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errMsg, "member not found"):
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
		case strings.Contains(errMsg, "loan not found"):
			utils.Error(w, http.StatusNotFound, "LOAN_NOT_FOUND", "Loan not found")
		case strings.Contains(errMsg, "not active"):
			utils.Error(w, http.StatusBadRequest, "LOAN_NOT_ACTIVE", "Loan is not active")
		case strings.Contains(errMsg, "exceeds remaining"):
			utils.Error(w, http.StatusBadRequest, "EXCEEDS_REMAINING", "Amount exceeds remaining loan balance")
		case strings.Contains(errMsg, "duplicate"):
			utils.Error(w, http.StatusConflict, "DUPLICATE_REQUEST", "A similar loan repayment request is already pending")
		default:
			utils.Error(w, http.StatusInternalServerError, "REQUEST_CREATE_FAILED", "Failed to submit loan repayment request")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":   "Loan repayment request submitted successfully",
		"requestId": requestID,
	})
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
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
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

func (h *DashboardHandler) SendWorkerWelcomeEmail(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN"); !ok {
		return
	}

	var req struct {
		Email             string `json:"email"`
		Name              string `json:"name"`
		Role              string `json:"role"`
		Phone             string `json:"phone"`
		TemporaryPassword string `json:"temporaryPassword"`
		Locale            string `json:"locale"`
	}

	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if strings.TrimSpace(req.Email) == "" || strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.TemporaryPassword) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "email, name and temporaryPassword are required")
		return
	}

	role := strings.ToUpper(strings.TrimSpace(req.Role))
	if role != "ADMIN" && role != "WORKER" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "role must be ADMIN or WORKER")
		return
	}

	// Validate the request before reporting on the mail service. The other
	// order answered 503 "Email service is not configured" to a caller who had
	// sent an empty body — true, but not the thing they needed to hear, and it
	// hid every request defect behind an environment one (TEST-18).
	if h.emailService == nil || !h.emailService.IsConfigured() {
		utils.Error(w, http.StatusServiceUnavailable, "EMAIL_NOT_CONFIGURED", "Email service is not configured. Set BREVO_API_KEY and EMAIL_FROM on backend deployment")
		return
	}

	if err := h.emailService.SendStaffWelcomeEmail(r.Context(), req.Email, req.Name, role, req.Phone, req.TemporaryPassword, req.Locale); err != nil {
		slog.Error("staff welcome email failed", "role", role, "error", err)
		utils.Error(w, http.StatusInternalServerError, "EMAIL_SEND_FAILED", summarizeEmailDeliveryError(err))
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message": "Staff welcome email sent successfully",
	})
}

// authFromRequest resolves the caller from the Authorization header, and only
// from there — an access token is never accepted in the query string, because
// query strings leak into proxy logs, CDN logs and Referer headers (SEC-05).
// EventSource cannot set headers, so the SSE stream uses a short-lived
// single-purpose ticket instead; see streamAuthFromRequest.
func (h *DashboardHandler) authFromRequest(r *http.Request) (*authContext, error) {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "" || !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return nil, errors.New("missing bearer token")
	}

	tokenString := strings.TrimSpace(authHeader[7:])
	// ValidateToken, not ParseAccessToken: this is the choke point where a
	// logged-out or password-changed token has to stop being accepted (SEC-01).
	claims, err := h.authService.ValidateToken(r.Context(), tokenString)
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
	role = strings.ToUpper(strings.TrimSpace(role))

	return h.verifyActiveRole(r.Context(), userID, role)
}

// verifyActiveRole confirms the account is still ACTIVE and, when the caller
// carried a role claim, that the claim still matches the database.
func (h *DashboardHandler) verifyActiveRole(ctx context.Context, userID string, claimedRole string) (*authContext, error) {
	dbRole, dbStatus, err := h.userRepo.GetUserRoleStatus(ctx, userID)
	if err != nil {
		return nil, err
	}
	if dbStatus != "ACTIVE" {
		return nil, errors.New("user not active")
	}
	if claimedRole != "" && dbRole != claimedRole {
		return nil, errors.New("role mismatch")
	}

	// Every authenticated route funnels through here, so this is the one place
	// that has to tell the access log who the caller is (RUN-04).
	appmw.SetRequestUserID(ctx, userID)

	return &authContext{
		UserID: userID,
		Role:   dbRole,
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

// RequireRoles is the router-level form of requireRoles. Mounting a route group
// behind it means a handler is protected by where it is mounted rather than by
// the author remembering to add a check (SEC-02). Handlers keep their own
// requireRoles call as defence in depth.
func (h *DashboardHandler) RequireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := h.requireRoles(w, r, roles...); !ok {
				return
			}
			next.ServeHTTP(w, r)
		})
	}
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
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN"); !ok {
		return
	}

	var req struct {
		// The member's row id, not their account number: UpdateUserStatus
		// matches on `users.id`. It has been called `memberUserId` on the wire
		// since before the account-number rename, and stays that way — no
		// screen in this repository calls this endpoint, so a wire rename
		// would only break whatever does.
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
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}
	includeRegistration := auth.Role == "ADMIN" || auth.Role == "SUPER_ADMIN"
	data, err := h.userRepo.GetPendingApprovals(r.Context(), includeRegistration)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "APPROVALS_FETCH_FAILED", "Failed to load approvals")
		return
	}
	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) ApproveRegistration(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}
	userID := auth.UserID

	var req struct {
		UserID string `json:"userId"`
		Notes  string `json:"notes"`
		Locale string `json:"locale"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "userId is required")
		return
	}

	candidate, err := h.userRepo.GetRegistrationApprovalCandidate(r.Context(), req.UserID)
	if err != nil {
		utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
		return
	}

	tempPassword, err := generateTempPassword()
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "TEMP_PASSWORD_GENERATION_FAILED", "Failed to generate temporary password")
		return
	}

	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte(tempPassword), bcrypt.DefaultCost)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "PASSWORD_HASH_FAILED", "Failed to prepare credentials")
		return
	}

	firstLoginToken, err := generateFirstLoginSecret()
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "TOKEN_GENERATION_FAILED", "Failed to prepare first-login token")
		return
	}

	// The account number comes back from the approval rather than from
	// `candidate`, which was read before it existed: an application has no
	// account number, and admitting the member is what allocates one. Reading it
	// from the earlier snapshot would put an empty string into the approval email
	// — the one message that tells a member the number they will be asked for
	// every time they walk into the office.
	accountNo, err := h.userRepo.ApproveRegistration(r.Context(), req.UserID, userID, req.Notes, string(passwordHashBytes), firstLoginToken)
	if err != nil {
		slog.Error("approve registration failed", "userId", req.UserID, "error", err)
		utils.Error(w, http.StatusInternalServerError, "APPROVE_FAILED", "Failed to approve registration")
		return
	}

	// The applicant's own language, falling back to the admin's only for
	// applications filed before it was recorded. `req.Locale` is the *admin's*
	// dashboard locale, and using it alone meant a Bengali applicant approved by
	// an English-speaking admin received the single most important email the
	// foundation sends — the one carrying their temporary password — in a
	// language they may not read.
	emailLocale := strings.TrimSpace(candidate.PreferredLocale)
	if emailLocale == "" {
		emailLocale = req.Locale
	}

	emailDelivered := false
	deliveryError := ""
	emailAddress := strings.TrimSpace(candidate.Email)
	if h.emailService == nil || !h.emailService.IsConfigured() {
		deliveryError = "Email service is not configured"
	} else if emailAddress == "" {
		deliveryError = "Member email is not available"
	} else if err := h.emailService.SendMemberApprovalEmail(r.Context(), emailAddress, candidate.NameEn, accountNo, candidate.Phone, tempPassword, emailLocale); err != nil {
		slog.Error("member approval email failed", "userId", req.UserID, "error", err)
		deliveryError = summarizeEmailDeliveryError(err)
	} else {
		emailDelivered = true
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":        "Registration approved successfully",
		"emailDelivered": emailDelivered,
		"deliveryError":  deliveryError,
		// Both are shown once, on the approvals screen, and stored nowhere the
		// admin can go back to. Most members have no email address (ADR-036), so
		// for them this response IS the delivery: the admin reads out the number
		// and the password, and there is no second chance to see either.
		"temporaryPassword": tempPassword,
		"accountNo":         accountNo,
	})
}

func (h *DashboardHandler) RejectRegistration(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}
	userID := auth.UserID

	var req struct {
		UserID     string `json:"userId"`
		ReasonCode string `json:"reasonCode"`
		ReasonNote string `json:"reasonNote"`
		Locale     string `json:"locale"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "userId is required")
		return
	}

	// A reason is now required, and it has to be one of the codes the admin's
	// picker offers. The screen used to post `reason: ''` — hardcoded, with no
	// control to change it — so FR-05's "reject with reason" was never met: the
	// audit row's details column was the empty string and nobody, including the
	// applicant, could ever learn why.
	reasonCode := strings.ToUpper(strings.TrimSpace(req.ReasonCode))
	if !isRejectionReasonCode(reasonCode) {
		utils.Error(w, http.StatusBadRequest, "INVALID_REJECTION_REASON",
			"A rejection reason is required")
		return
	}

	reasonNote := strings.TrimSpace(req.ReasonNote)
	if len([]rune(reasonNote)) > rejectionNoteMaxLength {
		utils.Error(w, http.StatusBadRequest, "REJECTION_NOTE_TOO_LONG",
			fmt.Sprintf("The note must be %d characters or fewer", rejectionNoteMaxLength))
		return
	}
	// "Other" carries no sentence of its own, so a rejection reading only
	// "other reason" would tell the applicant nothing at all.
	if reasonCode == rejectionReasonOther && reasonNote == "" {
		utils.Error(w, http.StatusBadRequest, "REJECTION_NOTE_REQUIRED",
			"Describe the reason when choosing Other")
		return
	}

	applicant, err := h.userRepo.RejectRegistration(r.Context(), req.UserID, userID, reasonCode, reasonNote)
	if err != nil {
		// errors.Is against a sentinel, not strings.Contains over the message
		// (rule 2b). An application somebody else has already decided is an
		// answer, not a fault.
		if errors.Is(err, repositories.ErrRegistrationNotPending) {
			utils.Error(w, http.StatusConflict, "REGISTRATION_NOT_PENDING",
				"This application is no longer pending — it may already have been decided")
			return
		}
		slog.Error("reject registration failed", "userId", req.UserID, "error", err)
		utils.Error(w, http.StatusInternalServerError, "REJECT_FAILED", "Failed to reject registration")
		return
	}

	// The applicant's own language, falling back to the admin's only for
	// applications filed before it was recorded. The approval mail had the same
	// defect: a Bengali applicant approved by an admin working in English was
	// sent their temporary password in English.
	locale := strings.TrimSpace(applicant.Locale)
	if locale == "" {
		locale = req.Locale
	}

	// Delivery is reported, never fatal. The rejection is committed; an admin
	// whose email did not go out needs to know they must telephone instead.
	emailDelivered := false
	deliveryError := ""
	switch {
	case h.emailService == nil || !h.emailService.IsConfigured():
		deliveryError = "Email service is not configured"
	case strings.TrimSpace(applicant.Email) == "":
		deliveryError = "Applicant has no email address on file"
	default:
		if err := h.emailService.SendMemberRejectionEmail(
			r.Context(), applicant.Email, applicant.NameEn, reasonCode, reasonNote, locale,
		); err != nil {
			slog.Error("member rejection email failed", "userId", req.UserID, "error", err)
			deliveryError = summarizeEmailDeliveryError(err)
		} else {
			emailDelivered = true
		}
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":        "Registration rejected successfully",
		"emailDelivered": emailDelivered,
		"deliveryError":  deliveryError,
	})
}

// The rejection reason vocabulary, matching apps/web/lib/rejection-reasons.ts.
// `rejection-reasons.test.ts` reads both files and fails when they drift: a code
// the admin's picker offers that this list rejects is a 400 on a button that
// looks like it should work.
const rejectionReasonOther = "OTHER"

const rejectionNoteMaxLength = 400

var rejectionReasonCodes = map[string]bool{
	"INCOMPLETE_DOCUMENTS":  true,
	"UNCLEAR_DOCUMENTS":     true,
	"IDENTITY_MISMATCH":     true,
	"DUPLICATE_APPLICATION": true,
	"OUTSIDE_SERVICE_AREA":  true,
	"BELOW_MINIMUM_AGE":     true,
	"COULD_NOT_VERIFY":      true,
	rejectionReasonOther:    true,
}

func isRejectionReasonCode(code string) bool {
	return rejectionReasonCodes[code]
}

func (h *DashboardHandler) ApproveLoan(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	var req struct {
		LoanID string `json:"loanId"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	if strings.TrimSpace(req.LoanID) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "loanId is required")
		return
	}

	if err := h.userRepo.ApproveLoan(r.Context(), req.LoanID, auth.UserID); err != nil {
		errMsg := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errMsg, "only pending"):
			utils.Error(w, http.StatusBadRequest, "LOAN_NOT_PENDING", "Only pending loans can be approved")
		case strings.Contains(errMsg, "not found"):
			utils.Error(w, http.StatusNotFound, "LOAN_NOT_FOUND", "Loan request not found")
		default:
			utils.Error(w, http.StatusInternalServerError, "APPROVE_FAILED", "Failed to approve loan")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Loan approved successfully"})
}

func (h *DashboardHandler) RejectLoan(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
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
	if strings.TrimSpace(req.LoanID) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "loanId is required")
		return
	}

	if err := h.userRepo.RejectLoan(r.Context(), req.LoanID, auth.UserID, req.Reason); err != nil {
		errMsg := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errMsg, "only pending"):
			utils.Error(w, http.StatusBadRequest, "LOAN_NOT_PENDING", "Only pending loans can be rejected")
		case strings.Contains(errMsg, "not found"):
			utils.Error(w, http.StatusNotFound, "LOAN_NOT_FOUND", "Loan request not found")
		default:
			utils.Error(w, http.StatusInternalServerError, "REJECT_FAILED", "Failed to reject loan")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Loan rejected successfully"})
}

func (h *DashboardHandler) ApproveWithdrawal(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}
	userID := auth.UserID

	var req struct {
		RequestID     string `json:"requestId"`
		TransactionID string `json:"transactionId"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		requestID = strings.TrimSpace(req.TransactionID)
	}
	if requestID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "requestId is required")
		return
	}

	if err := h.userRepo.ApproveWithdrawal(r.Context(), requestID, userID); err != nil {
		errMsg := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errMsg, "not found"):
			utils.Error(w, http.StatusNotFound, "TRANSACTION_NOT_FOUND", "Transaction request not found")
		case strings.Contains(errMsg, "only pending"),
			strings.Contains(errMsg, "loan is not active"),
			strings.Contains(errMsg, "exceeds remaining"),
			strings.Contains(errMsg, "missing loan reference"),
			strings.Contains(errMsg, "unsupported transaction type"):
			utils.Error(w, http.StatusBadRequest, "INVALID_TRANSACTION_STATE", err.Error())
		default:
			slog.Error("approve withdrawal failed", "requestId", requestID, "error", err)
			utils.Error(w, http.StatusInternalServerError, "APPROVE_WITHDRAWAL_FAILED", "Failed to approve withdrawal")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Withdrawal approved successfully"})
}

func (h *DashboardHandler) RejectWithdrawal(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}
	userID := auth.UserID

	var req struct {
		RequestID     string `json:"requestId"`
		TransactionID string `json:"transactionId"`
		Reason        string `json:"reason"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		requestID = strings.TrimSpace(req.TransactionID)
	}
	if requestID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "requestId is required")
		return
	}

	if err := h.userRepo.RejectWithdrawal(r.Context(), requestID, userID, req.Reason); err != nil {
		errMsg := strings.ToLower(strings.TrimSpace(err.Error()))
		switch {
		case strings.Contains(errMsg, "not found"):
			utils.Error(w, http.StatusNotFound, "TRANSACTION_NOT_FOUND", "Transaction request not found")
		case strings.Contains(errMsg, "only pending"):
			utils.Error(w, http.StatusBadRequest, "INVALID_TRANSACTION_STATE", err.Error())
		case strings.Contains(errMsg, "unsupported transaction type"):
			utils.Error(w, http.StatusBadRequest, "INVALID_TRANSACTION_STATE", err.Error())
		default:
			utils.Error(w, http.StatusInternalServerError, "REJECT_WITHDRAWAL_FAILED", "Failed to reject withdrawal")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Withdrawal rejected successfully"})
}

// ==================== ADMIN DEPOSITS HANDLERS ====================

func (h *DashboardHandler) AdminDeposits(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
		return
	}

	filters := map[string]interface{}{
		"type": r.URL.Query().Get("type"),
		// "all" widens the answer from savings movements to every posting type,
		// which is what the transactions screen shows. Anything else keeps the
		// DEPOSIT/WITHDRAWAL default.
		"types":  r.URL.Query().Get("types"),
		"search": r.URL.Query().Get("search"),
		"page":   r.URL.Query().Get("page"),
		"limit":  r.URL.Query().Get("limit"),
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
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
		return
	}

	filters := map[string]interface{}{
		"status": r.URL.Query().Get("status"),
		"search": r.URL.Query().Get("search"),
		"page":   r.URL.Query().Get("page"),
		"limit":  r.URL.Query().Get("limit"),
	}

	data, err := h.userRepo.GetAllLoans(r.Context(), filters)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "LOANS_FETCH_FAILED", "Failed to load loans")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) AdminLoanDetail(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN"); !ok {
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
	auth, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}
	userID := auth.UserID

	var req struct {
		LoanID string `json:"loanId"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.MarkLoanDefaulted(r.Context(), req.LoanID, userID, req.Notes); err != nil {
		switch {
		case errors.Is(err, repositories.ErrLoanIDRequired):
			utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "loanId is required")
		case errors.Is(err, repositories.ErrLoanNotFound):
			utils.Error(w, http.StatusNotFound, "LOAN_NOT_FOUND", "No loan with that id")
		case errors.Is(err, repositories.ErrLoanNotDefaultable):
			// 409, not 400: the request was well-formed, the loan is simply not
			// in a state where defaulting it means anything. Most often this is
			// a second click on a loan already defaulted — which used to re-run
			// the recovery waterfall and take the money twice.
			utils.Error(w, http.StatusConflict, "LOAN_NOT_DEFAULTABLE", err.Error())
		default:
			slog.Error("mark loan defaulted failed", "loanId", req.LoanID, "error", err)
			utils.Error(w, http.StatusInternalServerError, "MARK_DEFAULT_FAILED", "Failed to mark loan as defaulted")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Loan marked as defaulted and recovery processed"})
}

// ==================== ADMIN DONATIONS HANDLERS ====================

func (h *DashboardHandler) AdminDonations(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN", "WORKER"); !ok {
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
	auth, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN", "WORKER")
	if !ok {
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
	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxDonationAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Donation amount exceeds maximum allowed")
		return
	}

	receiptNumber, err := h.userRepo.RecordDonation(r.Context(), auth.UserID, req.Amount, strings.TrimSpace(req.DonorName), strings.TrimSpace(req.Notes))
	if err != nil {
		if errors.Is(err, repositories.ErrDonationPoolMissing) {
			// A deployment fault, not the caller's. 503 and the actual cause,
			// because "Failed to record donation" gave whoever was standing at
			// the counter nothing to do next.
			utils.Error(w, http.StatusServiceUnavailable, "DONATION_POOL_MISSING", err.Error())
			return
		}
		slog.Error("record donation failed", "error", err)
		utils.Error(w, http.StatusInternalServerError, "RECORD_DONATION_FAILED", "Failed to record donation")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Donation recorded successfully", "receiptNumber": receiptNumber})
}

// ==================== ADMIN REPORTS HANDLERS ====================

func (h *DashboardHandler) MonthlyReport(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
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
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
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
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
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
	auth, ok := h.requireRoles(w, r, "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	data, err := h.userRepo.GetAdminProfile(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "PROFILE_FETCH_FAILED", "Failed to load admin profile")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	var req map[string]interface{}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if err := h.userRepo.UpdateProfile(r.Context(), auth.UserID, req); err != nil {
		// A phone or email already on another account is the caller's mistake
		// and is fixable by them; answering 500 told them the server was
		// broken and gave them nothing to correct (TEST-15).
		if errors.Is(err, repositories.ErrDuplicateContact) {
			utils.Error(w, http.StatusConflict, "CONTACT_ALREADY_IN_USE",
				"That phone number or email address is already registered to another account")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "UPDATE_PROFILE_FAILED", "Failed to update profile")
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Profile updated successfully"})
}

func (h *DashboardHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	if strings.TrimSpace(req.CurrentPassword) == "" || strings.TrimSpace(req.NewPassword) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "currentPassword and newPassword are required")
		return
	}
	if err := validateStrongPassword(req.NewPassword); err != nil {
		utils.Error(w, http.StatusBadRequest, "WEAK_PASSWORD", err.Error())
		return
	}

	if err := h.userRepo.ChangePassword(r.Context(), auth.UserID, req.CurrentPassword, req.NewPassword); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "incorrect") {
			utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "Current password is incorrect")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "PASSWORD_CHANGE_FAILED", "Failed to change password")
		return
	}

	// Invalidate all user tokens (force re-login on all devices).
	//
	// Checked, but not fatal: the password has already changed by this point, so
	// answering an error would tell the member their change failed when it did
	// not. What a silent failure *does* mean is that a session on another device
	// — including one an attacker holds, which is the usual reason to change a
	// password — stays valid. That has to be visible in the logs.
	if err := h.authService.InvalidateAllUserTokens(r.Context(), auth.UserID, "password_change"); err != nil {
		slog.Error("password changed but existing sessions were not revoked", "userId", auth.UserID, "error", err)
	}

	// Create audit log
	// The address the whole process agrees on, not the leftmost header entry —
	// which the caller writes, and which is stored here as evidence (WO-60).
	userIP := appmw.RequestClientIP(r)
	// Checked: an audit row that silently fails to write is a rule-6 problem —
	// the log is the only record that this account's password was changed, and
	// by whom. The write cannot be undone here (the password has changed), so it
	// is logged loudly rather than returned.
	if err := h.securityService.CreateAuditLog(r.Context(), services.AuditLogEntry{
		Action:     "PASSWORD_CHANGE",
		EntityType: "USER",
		EntityID:   auth.UserID,
		UserID:     auth.UserID,
		UserIP:     userIP,
		UserAgent:  r.Header.Get("User-Agent"),
		Details:    "Password changed successfully",
	}); err != nil {
		slog.Error("failed to write PASSWORD_CHANGE audit log", "userId", auth.UserID, "error", err)
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Password changed successfully"})
}

func (h *DashboardHandler) RequestPasswordChangeCode(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	if h.emailService == nil || !h.emailService.IsConfigured() {
		utils.Error(w, http.StatusServiceUnavailable, "EMAIL_NOT_CONFIGURED", "Email service is not configured. Set BREVO_API_KEY and EMAIL_FROM on backend deployment")
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword"`
		Locale          string `json:"locale"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	currentPassword := strings.TrimSpace(req.CurrentPassword)
	if currentPassword == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "currentPassword is required")
		return
	}

	if err := h.userRepo.VerifyCurrentPassword(r.Context(), auth.UserID, currentPassword); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "incorrect") {
			utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "Current password is incorrect")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "PASSWORD_CHANGE_FAILED", "Failed to verify current password")
		return
	}

	userInfo, err := h.userRepo.GetUserInfo(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "USER_FETCH_FAILED", "Failed to load user profile")
		return
	}

	email, _ := userInfo["email"].(string)
	phone, _ := userInfo["phone"].(string)
	nameEn, _ := userInfo["nameEn"].(string)
	email = strings.TrimSpace(email)
	phone = strings.TrimSpace(phone)
	nameEn = strings.TrimSpace(nameEn)
	if email == "" {
		utils.Error(w, http.StatusBadRequest, "EMAIL_REQUIRED", "No email is set on your account. Please contact admin support.")
		return
	}

	code, err := generateNumericCode(6)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to generate verification code")
		return
	}

	// The user id is the scope, not part of the secret. Six digits hashed on
	// their own would collide across members under the (scope, tokenHash)
	// unique index the moment two of them were sent the same code.
	scope := repositories.PasswordChangeScope(auth.UserID)
	if err := h.userRepo.DeleteResetTokensByScope(r.Context(), scope); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to prepare verification code")
		return
	}

	expiresAt := time.Now().Add(10 * time.Minute)
	if err := h.userRepo.CreateResetToken(r.Context(), scope, code, email, phone, expiresAt); err != nil {
		utils.Error(w, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "Failed to store verification code")
		return
	}

	locale := strings.ToLower(strings.TrimSpace(req.Locale))
	if locale == "" {
		locale = "en"
	}

	if err := h.emailService.SendPasswordChangeVerificationCodeEmail(r.Context(), email, nameEn, code, locale); err != nil {
		_ = h.userRepo.DeleteResetTokensByScope(r.Context(), scope)
		summary := summarizeEmailDeliveryError(err)
		slog.Error("password change code email failed", "userId", auth.UserID, "reason", summary, "error", err)
		utils.Error(w, http.StatusServiceUnavailable, "EMAIL_DELIVERY_FAILED", "Failed to send verification code: "+summary)
		return
	}

	// The address the whole process agrees on, not the leftmost header entry —
	// which the caller writes, and which is stored here as evidence (WO-60).
	userIP := appmw.RequestClientIP(r)
	// Checked: an audit row that silently fails to write is a rule-6 problem —
	// the log is the only record that this account's password was changed, and
	// by whom. The write cannot be undone here (the password has changed), so it
	// is logged loudly rather than returned.
	if err := h.securityService.CreateAuditLog(r.Context(), services.AuditLogEntry{
		Action:     "PASSWORD_CHANGE_CODE_SENT",
		EntityType: "USER",
		EntityID:   auth.UserID,
		UserID:     auth.UserID,
		UserIP:     userIP,
		UserAgent:  r.Header.Get("User-Agent"),
		Details:    "Password change verification code sent by email",
	}); err != nil {
		slog.Error("failed to write PASSWORD_CHANGE_CODE_SENT audit log", "userId", auth.UserID, "error", err)
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":          "Verification code sent to your email",
		"expiresInSeconds": 600,
	})
}

func (h *DashboardHandler) VerifyPasswordChangeCode(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	var req struct {
		VerificationCode string `json:"verificationCode"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	verificationCode := strings.TrimSpace(req.VerificationCode)
	if len(verificationCode) != 6 {
		utils.Error(w, http.StatusBadRequest, "INVALID_VERIFICATION_CODE", "Verification code must be 6 digits")
		return
	}
	for _, c := range verificationCode {
		if c < '0' || c > '9' {
			utils.Error(w, http.StatusBadRequest, "INVALID_VERIFICATION_CODE", "Verification code must contain only digits")
			return
		}
	}

	if _, err := h.userRepo.GetResetToken(r.Context(), repositories.PasswordChangeScope(auth.UserID), verificationCode); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_VERIFICATION_CODE", "Invalid or expired verification code")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message": "Verification code verified",
	})
}

func (h *DashboardHandler) ConfirmPasswordChangeWithCode(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	var req struct {
		CurrentPassword  string `json:"currentPassword"`
		NewPassword      string `json:"newPassword"`
		VerificationCode string `json:"verificationCode"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	currentPassword := strings.TrimSpace(req.CurrentPassword)
	newPassword := strings.TrimSpace(req.NewPassword)
	verificationCode := strings.TrimSpace(req.VerificationCode)
	if currentPassword == "" || newPassword == "" || verificationCode == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "currentPassword, newPassword, and verificationCode are required")
		return
	}
	if len(verificationCode) != 6 {
		utils.Error(w, http.StatusBadRequest, "INVALID_VERIFICATION_CODE", "Verification code must be 6 digits")
		return
	}
	for _, c := range verificationCode {
		if c < '0' || c > '9' {
			utils.Error(w, http.StatusBadRequest, "INVALID_VERIFICATION_CODE", "Verification code must contain only digits")
			return
		}
	}
	if currentPassword == newPassword {
		utils.Error(w, http.StatusBadRequest, "WEAK_PASSWORD", "New password must be different from current password")
		return
	}
	if err := validateStrongPassword(newPassword); err != nil {
		utils.Error(w, http.StatusBadRequest, "WEAK_PASSWORD", err.Error())
		return
	}

	scope := repositories.PasswordChangeScope(auth.UserID)
	resetToken, err := h.userRepo.GetResetToken(r.Context(), scope, verificationCode)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_VERIFICATION_CODE", "Invalid or expired verification code")
		return
	}

	if err := h.userRepo.ChangePassword(r.Context(), auth.UserID, currentPassword, newPassword); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "incorrect") {
			utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "Current password is incorrect")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "PASSWORD_CHANGE_FAILED", "Failed to change password")
		return
	}

	if err := h.userRepo.MarkResetTokenUsed(r.Context(), resetToken.ID); err != nil {
		slog.Error("failed to mark password change verification code used", "userId", auth.UserID, "tokenId", resetToken.ID, "error", err)
	}
	_ = h.userRepo.DeleteResetTokensByScope(r.Context(), scope)

	// Invalidate all user tokens (force re-login on all devices).
	//
	// Checked, but not fatal: the password has already changed by this point, so
	// answering an error would tell the member their change failed when it did
	// not. What a silent failure *does* mean is that a session on another device
	// — including one an attacker holds, which is the usual reason to change a
	// password — stays valid. That has to be visible in the logs.
	if err := h.authService.InvalidateAllUserTokens(r.Context(), auth.UserID, "password_change"); err != nil {
		slog.Error("password changed but existing sessions were not revoked", "userId", auth.UserID, "error", err)
	}

	// Create audit log
	// The address the whole process agrees on, not the leftmost header entry —
	// which the caller writes, and which is stored here as evidence (WO-60).
	userIP := appmw.RequestClientIP(r)
	// Checked: an audit row that silently fails to write is a rule-6 problem —
	// the log is the only record that this account's password was changed, and
	// by whom. The write cannot be undone here (the password has changed), so it
	// is logged loudly rather than returned.
	if err := h.securityService.CreateAuditLog(r.Context(), services.AuditLogEntry{
		Action:     "PASSWORD_CHANGE",
		EntityType: "USER",
		EntityID:   auth.UserID,
		UserID:     auth.UserID,
		UserIP:     userIP,
		UserAgent:  r.Header.Get("User-Agent"),
		Details:    "Password changed successfully with email verification code",
	}); err != nil {
		slog.Error("failed to write PASSWORD_CHANGE audit log", "userId", auth.UserID, "error", err)
	}

	utils.Success(w, http.StatusOK, map[string]string{"message": "Password changed successfully"})
}

func (h *DashboardHandler) SupportConfig(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		retentionDays, _ := h.userRepo.GetSupportRetentionDays(r.Context())
		utils.Success(w, http.StatusOK, map[string]interface{}{
			"retentionDays": retentionDays,
		})
		return
	case http.MethodPut:
		if auth.Role != "ADMIN" && auth.Role != "SUPER_ADMIN" {
			utils.Error(w, http.StatusForbidden, "AUTH_FORBIDDEN", "Insufficient permissions")
			return
		}
		var req struct {
			RetentionDays int `json:"retentionDays"`
		}
		if err := utils.ParseJSON(r, &req); err != nil {
			utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
			return
		}
		if req.RetentionDays < 1 {
			utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "retentionDays must be at least 1")
			return
		}
		if err := h.userRepo.SetSupportRetentionDays(r.Context(), req.RetentionDays); err != nil {
			utils.Error(w, http.StatusInternalServerError, "SUPPORT_CONFIG_UPDATE_FAILED", "Failed to update support config")
			return
		}
		utils.Success(w, http.StatusOK, map[string]interface{}{"retentionDays": req.RetentionDays})
		return
	default:
		utils.Error(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "Method not allowed")
		return
	}
}

func (h *DashboardHandler) SupportThreads(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}
	_ = h.userRepo.PurgeExpiredSupportData(r.Context())

	threads, err := h.userRepo.GetSupportThreads(r.Context(), auth.UserID, auth.Role)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "SUPPORT_THREADS_FETCH_FAILED", "Failed to load support threads")
		return
	}
	utils.Success(w, http.StatusOK, threads)
}

func (h *DashboardHandler) SupportMessages(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}
	_ = h.userRepo.PurgeExpiredSupportData(r.Context())
	threadID := strings.TrimSpace(r.URL.Query().Get("threadId"))
	if threadID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "threadId is required")
		return
	}
	messages, err := h.userRepo.GetSupportMessages(r.Context(), auth.UserID, auth.Role, threadID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "SUPPORT_MESSAGES_FETCH_FAILED", "Failed to load support messages")
		return
	}
	utils.Success(w, http.StatusOK, messages)
}

func (h *DashboardHandler) SupportSendMessage(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}
	var req struct {
		ThreadID string `json:"threadId"`
		Message  string `json:"message"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	threadID, err := h.userRepo.AddSupportMessage(
		r.Context(),
		auth.UserID,
		auth.Role,
		strings.TrimSpace(req.ThreadID),
		strings.TrimSpace(req.Message),
	)
	if err != nil {
		utils.Error(w, http.StatusBadRequest, "SUPPORT_SEND_FAILED", err.Error())
		return
	}

	utils.Success(w, http.StatusOK, map[string]string{
		"threadId": threadID,
		"message":  "Support message sent",
	})
}

func (h *DashboardHandler) SupportMarkProcessed(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}
	var req struct {
		ThreadID string `json:"threadId"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	if err := h.userRepo.MarkSupportThreadProcessed(r.Context(), auth.UserID, auth.Role, strings.TrimSpace(req.ThreadID)); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "forbidden") {
			utils.Error(w, http.StatusForbidden, "AUTH_FORBIDDEN", "Insufficient permissions")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "SUPPORT_PROCESS_FAILED", "Failed to mark thread processed")
		return
	}
	utils.Success(w, http.StatusOK, map[string]string{"message": "Support thread marked processed"})
}

// sseTicketTTL is how long an issued stream ticket stays usable. Short enough
// that a ticket captured from a log or Referer header is already dead, long
// enough for the browser to open the EventSource it was issued for.
const sseTicketTTL = 60 * time.Second

// SupportStreamTicket issues a single-purpose credential for the SSE stream.
//
// EventSource cannot send an Authorization header, so the stream needs a
// credential that survives being in the URL. This is that credential: it is
// good for one purpose, for sseTicketTTL, and it is not an access token — a
// leaked ticket cannot be replayed against any other endpoint (SEC-05).
// Clients fetch a fresh ticket immediately before each connect, including
// reconnects.
func (h *DashboardHandler) SupportStreamTicket(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireAuthenticated(w, r)
	if !ok {
		return
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		utils.Error(w, http.StatusInternalServerError, "TICKET_ISSUE_FAILED", "Failed to issue stream ticket")
		return
	}
	ticket := hex.EncodeToString(raw)
	expiresAt := time.Now().UTC().Add(sseTicketTTL)

	if err := h.userRepo.CreateSSETicket(r.Context(), hashSSETicket(ticket), auth.UserID, sseTicketPurposeSupport, expiresAt); err != nil {
		utils.Error(w, http.StatusInternalServerError, "TICKET_ISSUE_FAILED", "Failed to issue stream ticket")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"ticket":           ticket,
		"expiresInSeconds": int(sseTicketTTL / time.Second),
	})
}

const sseTicketPurposeSupport = "support_stream"

func hashSSETicket(ticket string) string {
	sum := sha256.Sum256([]byte(ticket))
	return hex.EncodeToString(sum[:])
}

// streamAuthFromRequest authenticates an SSE connection: an Authorization
// header when the caller can set one (the Next proxy can), otherwise a stream
// ticket from the query string. A full access token in the query string is
// never accepted.
func (h *DashboardHandler) streamAuthFromRequest(w http.ResponseWriter, r *http.Request) (*authContext, bool) {
	if strings.TrimSpace(r.Header.Get("Authorization")) != "" {
		return h.requireAuthenticated(w, r)
	}

	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	if ticket == "" {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing stream ticket")
		return nil, false
	}

	userID, err := h.userRepo.ConsumeSSETicket(r.Context(), hashSSETicket(ticket), sseTicketPurposeSupport)
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing stream ticket")
		return nil, false
	}

	auth, err := h.verifyActiveRole(r.Context(), userID, "")
	if err != nil {
		utils.Error(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or missing stream ticket")
		return nil, false
	}
	return auth, true
}

func (h *DashboardHandler) SupportStream(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.streamAuthFromRequest(w, r)
	if !ok {
		return
	}

	threadID := strings.TrimSpace(r.URL.Query().Get("threadId"))
	if threadID == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "threadId is required")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		utils.Error(w, http.StatusInternalServerError, "STREAM_NOT_SUPPORTED", "Streaming not supported")
		return
	}

	// The server sets a WriteTimeout for every other route; this one has to opt
	// out of it or the stream would be cut mid-conversation. An error here just
	// means the deadline stays, which degrades to a periodically dropped stream
	// rather than a broken one, so it is not worth failing the request over.
	if err := http.NewResponseController(w).SetWriteDeadline(time.Time{}); err != nil {
		slog.Warn("support stream could not clear its write deadline", "error", err)
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	lastCount := -1
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	send := func() bool {
		messages, err := h.userRepo.GetSupportMessages(r.Context(), auth.UserID, auth.Role, threadID)
		if err != nil {
			return false
		}
		if len(messages) != lastCount {
			lastCount = len(messages)
			_, _ = w.Write([]byte("event: update\n"))
			_, _ = w.Write([]byte("data: messages\n\n"))
			flusher.Flush()
		}
		return true
	}

	if !send() {
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case <-h.shutdown:
			return
		case <-ticker.C:
			if !send() {
				return
			}
		}
	}
}

// ==================== WORKER HANDLERS ====================

func (h *DashboardHandler) WorkerRequests(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	data, err := h.userRepo.GetWorkerRequests(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "REQUESTS_FETCH_FAILED", "Failed to load worker requests")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerLoans(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	data, err := h.userRepo.GetWorkerLoans(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "LOANS_FETCH_FAILED", "Failed to load worker loans")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerTransactions(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	data, err := h.userRepo.GetWorkerTransactions(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "TRANSACTIONS_FETCH_FAILED", "Failed to load worker transactions")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

func (h *DashboardHandler) WorkerProfile(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	data, err := h.userRepo.GetWorkerProfile(r.Context(), auth.UserID)
	if err != nil {
		utils.Error(w, http.StatusInternalServerError, "PROFILE_FETCH_FAILED", "Failed to load worker profile")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

// ProcessDeposit and ProcessWithdrawal were removed 2026-08-17 (WO-41), along
// with POST /v1/dashboard/worker/{deposit,withdrawal}.
//
// ProcessDeposit duplicated WorkerAddDeposit without the audit row or the
// sequential receipt number. ProcessWithdrawal was worse: it parsed the request
// and then answered `{"message":"Withdrawal processed successfully"}` having
// moved nothing and recorded nothing — a handler that reports success for work
// it never did is the failure mode a reconciliation job exists to catch.
//
// Neither had a client. The worker UI posts to
// /v1/dashboard/worker/members/{memberUserId}/{deposit,withdrawal}, which is
// WorkerAddDeposit / WorkerAddWithdrawal below.

// WorkerMemberDetail returns detailed information about a specific member
func (h *DashboardHandler) WorkerMemberDetail(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN"); !ok {
		return
	}

	memberUserId := r.PathValue("memberUserId")
	if memberUserId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Member ID is required")
		return
	}

	data, err := h.userRepo.GetMemberDetailForWorker(r.Context(), memberUserId)
	if err != nil {
		slog.Error("member detail lookup failed", "memberUserId", memberUserId, "error", err)
		if strings.Contains(err.Error(), "not found") {
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "MEMBER_DETAIL_FETCH_FAILED", "Failed to load member details")
		return
	}

	utils.Success(w, http.StatusOK, data)
}

// WorkerAddDeposit adds a deposit for a member
func (h *DashboardHandler) WorkerAddDeposit(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	memberUserId := r.PathValue("memberUserId")
	if memberUserId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Member ID is required")
		return
	}

	var req struct {
		Amount int64  `json:"amount"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxDepositAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount exceeds maximum allowed")
		return
	}

	receipt, err := h.userRepo.AddMemberDeposit(r.Context(), memberUserId, auth.UserID, req.Amount, req.Notes)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
			return
		}
		if strings.Contains(err.Error(), "not active") {
			utils.Error(w, http.StatusBadRequest, "MEMBER_NOT_ACTIVE", "Member account is not active")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "DEPOSIT_FAILED", "Failed to process deposit")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":       "Deposit added successfully",
		"receiptNumber": receipt,
	})
}

// WorkerAddWithdrawal processes a withdrawal for a member
func (h *DashboardHandler) WorkerAddWithdrawal(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	memberUserId := r.PathValue("memberUserId")
	if memberUserId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Member ID is required")
		return
	}

	var req struct {
		Amount int64  `json:"amount"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxWithdrawalAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount exceeds maximum allowed")
		return
	}

	receipt, err := h.userRepo.AddMemberWithdrawal(r.Context(), memberUserId, auth.UserID, req.Amount, req.Notes)
	if err != nil {
		// Matched on sentinels, in a switch, so the order cannot silently
		// decide the answer. The substring version that used to be here tested
		// "active loan" before "guarantor", and "is guarantor for active loan"
		// contains "active loan" — so a guarantor was told they had a loan of
		// their own.
		switch {
		case errors.Is(err, repositories.ErrMemberNotFound):
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
		case errors.Is(err, repositories.ErrMemberNotActive):
			utils.Error(w, http.StatusBadRequest, "MEMBER_NOT_ACTIVE", "Member account is not active")
		case errors.Is(err, repositories.ErrInsufficientBalance):
			utils.Error(w, http.StatusBadRequest, "INSUFFICIENT_BALANCE", err.Error())
		case errors.Is(err, repositories.ErrGuarantorBlocksWithdrawal):
			utils.Error(w, http.StatusBadRequest, "WITHDRAWAL_BLOCKED",
				"This member guarantees another member's active loan, so their savings are locked")
		case errors.Is(err, repositories.ErrActiveLoanBlocksWithdrawal):
			utils.Error(w, http.StatusBadRequest, "WITHDRAWAL_BLOCKED",
				"This member has an active loan. Enable loan.allowActiveLoanWithdrawal in settings to permit it")
		// The two FR-08 refusals that used to live here — no notice on file, and
		// a notice not yet matured — are gone with the gate itself (ADR-030).
		// The refusals that remain are all about the member's own position:
		// suspended, overdrawn, or holding savings locked by a guarantee.
		default:
			slog.Error("add member withdrawal failed", "memberUserId", memberUserId, "error", err)
			utils.Error(w, http.StatusInternalServerError, "WITHDRAWAL_FAILED", "Failed to process withdrawal")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":       "Withdrawal processed successfully",
		"receiptNumber": receipt,
	})
}

// WorkerAddLoan creates a loan application for a member
func (h *DashboardHandler) WorkerAddLoan(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	memberUserId := r.PathValue("memberUserId")
	if memberUserId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Member ID is required")
		return
	}

	var req struct {
		Amount       int64  `json:"amount"`
		Purpose      string `json:"purpose"`
		Installments int    `json:"installments"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxLoanAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Loan amount exceeds maximum allowed")
		return
	}

	if strings.TrimSpace(req.Purpose) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_PURPOSE", "Purpose is required")
		return
	}
	if len(req.Purpose) > utils.MaxPurposeLength {
		utils.Error(w, http.StatusBadRequest, "INVALID_PURPOSE", "Purpose is too long")
		return
	}

	if req.Installments < 1 {
		utils.Error(w, http.StatusBadRequest, "INVALID_INSTALLMENTS", "Installments must be at least 1")
		return
	}

	loanNumber, err := h.userRepo.CreateMemberLoan(r.Context(), memberUserId, auth.UserID, req.Amount, req.Purpose, req.Installments)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
			return
		}
		if strings.Contains(err.Error(), "not active") {
			utils.Error(w, http.StatusBadRequest, "MEMBER_NOT_ACTIVE", "Member account is not active")
			return
		}
		if strings.Contains(err.Error(), "not eligible") {
			utils.Error(w, http.StatusBadRequest, "NOT_ELIGIBLE", "Member is not eligible for a loan")
			return
		}
		if strings.Contains(err.Error(), "exceeds limit") {
			utils.Error(w, http.StatusBadRequest, "EXCEEDS_LIMIT", "Loan amount exceeds maximum limit")
			return
		}
		if strings.Contains(err.Error(), "active loan") {
			utils.Error(w, http.StatusBadRequest, "ACTIVE_LOAN_EXISTS", "Member already has an active loan")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "LOAN_CREATION_FAILED", "Failed to create loan")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":    "Loan created and disbursed successfully",
		"loanNumber": loanNumber,
	})
}

// WorkerAddLoanTopUp adds principal to a loan that is already running.
//
// Staff-initiated, like a disbursement and unlike a repayment request: the
// money is handed over at the desk, so there is nothing for the member to
// confirm afterwards. The refusals are all sentinels — a finished loan and a
// member at their borrowing ceiling are answers, not faults (rule 2b), and the
// ceiling message carries the two figures the member will ask about.
func (h *DashboardHandler) WorkerAddLoanTopUp(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	memberUserId := r.PathValue("memberUserId")
	if memberUserId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Member ID is required")
		return
	}

	var req struct {
		LoanId string `json:"loanId"`
		Amount int64  `json:"amount"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}
	if strings.TrimSpace(req.LoanId) == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Loan ID is required")
		return
	}
	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxLoanAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount exceeds maximum allowed")
		return
	}

	receiptNumber, err := h.userRepo.AddLoanTopUp(
		r.Context(), memberUserId, auth.UserID, strings.TrimSpace(req.LoanId), req.Amount, req.Notes)
	if err != nil {
		switch {
		case errors.Is(err, repositories.ErrMemberNotFound):
			utils.Error(w, http.StatusNotFound, "MEMBER_NOT_FOUND", "Member not found")
		case errors.Is(err, repositories.ErrMemberNotActive):
			utils.Error(w, http.StatusBadRequest, "MEMBER_NOT_ACTIVE", "Member account is not active")
		case errors.Is(err, repositories.ErrLoanNotFound):
			utils.Error(w, http.StatusNotFound, "LOAN_NOT_FOUND", "Loan not found for this member")
		case errors.Is(err, repositories.ErrLoanNotActive):
			utils.Error(w, http.StatusConflict, "LOAN_NOT_ACTIVE",
				"Only an active loan can be increased. A completed or defaulted loan needs a new application")
		case errors.Is(err, repositories.ErrTopUpExceedsLimit):
			// err.Error() carries the ceiling, the savings it is derived from
			// and what the member would owe. Discarding it would leave staff
			// with "not allowed" and no number to act on.
			utils.Error(w, http.StatusConflict, "TOPUP_EXCEEDS_LIMIT", err.Error())
		default:
			slog.Error("loan top-up failed", "memberUserId", memberUserId, "loanId", req.LoanId, "error", err)
			utils.Error(w, http.StatusInternalServerError, "TOPUP_FAILED", "Failed to increase the loan")
		}
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":       "Loan increased successfully",
		"receiptNumber": receiptNumber,
	})
}

// WorkerAddLoanPayment records a loan payment for a member
func (h *DashboardHandler) WorkerAddLoanPayment(w http.ResponseWriter, r *http.Request) {
	auth, ok := h.requireRoles(w, r, "WORKER", "ADMIN", "SUPER_ADMIN")
	if !ok {
		return
	}

	memberUserId := r.PathValue("memberUserId")
	if memberUserId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Member ID is required")
		return
	}

	var req struct {
		LoanId string `json:"loanId"`
		Amount int64  `json:"amount"`
		Notes  string `json:"notes"`
	}
	if err := utils.ParseJSON(r, &req); err != nil {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	if req.LoanId == "" {
		utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "Loan ID is required")
		return
	}

	if req.Amount <= 0 {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Amount must be greater than 0")
		return
	}
	if req.Amount > utils.MaxLoanPaymentAmount {
		utils.Error(w, http.StatusBadRequest, "INVALID_AMOUNT", "Payment amount exceeds maximum allowed")
		return
	}

	receiptNumber, err := h.userRepo.AddMemberLoanPayment(r.Context(), memberUserId, auth.UserID, req.LoanId, req.Amount, req.Notes)
	if err != nil {
		slog.Error("add member loan payment failed", "memberUserId", memberUserId, "error", err)
		if strings.Contains(err.Error(), "not found") {
			utils.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
			return
		}
		if strings.Contains(err.Error(), "not active") {
			utils.Error(w, http.StatusBadRequest, "LOAN_NOT_ACTIVE", "This loan is not active")
			return
		}
		// errors.Is, not a substring: this now also arrives when two payments
		// race and the second loses, where the message is the same but the
		// cause is a concurrent posting rather than a mistyped amount.
		if errors.Is(err, repositories.ErrRepaymentExceedsBalance) || strings.Contains(err.Error(), "exceeds remaining") {
			utils.Error(w, http.StatusConflict, "EXCEEDS_REMAINING", "Payment amount exceeds the remaining loan balance")
			return
		}
		utils.Error(w, http.StatusInternalServerError, "PAYMENT_FAILED", "Failed to process loan payment")
		return
	}

	utils.Success(w, http.StatusOK, map[string]interface{}{
		"message":       "Loan payment processed successfully",
		"receiptNumber": receiptNumber,
	})
}
