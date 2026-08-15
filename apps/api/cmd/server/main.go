package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	cfg "hasnahena/apps/api/internal/config"
	handlers "hasnahena/apps/api/internal/handlers"
	appmw "hasnahena/apps/api/internal/middleware"
	repositories "hasnahena/apps/api/internal/repositories"
	services "hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

func main() {
	config := cfg.Load()
	if config.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to parse database config: %v", err)
	}
	poolConfig.MaxConns = config.DBMaxConns
	poolConfig.MinConns = config.DBMinConns
	poolConfig.MaxConnIdleTime = config.DBMaxConnIdleTime
	poolConfig.MaxConnLifetime = config.DBMaxConnLifetime
	poolConfig.HealthCheckPeriod = config.DBHealthCheckPeriod
	// Neon pooler (pgBouncer) can raise prepared-statement conflicts; simple protocol avoids server-side prepare reuse.
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	dbPool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		log.Fatalf("failed to connect db: %v", err)
	}
	defer dbPool.Close()

	userRepo := repositories.NewUserRepository(dbPool)
	if err := userRepo.EnsureSupportSchema(context.Background()); err != nil {
		log.Fatalf("failed to ensure support schema: %v", err)
	}
	securityService := services.NewSecurityService(dbPool)
	emailService := services.NewEmailService(services.EmailConfig{
		BrevoAPIKey:  config.BrevoAPIKey,
		BrevoBaseURL: config.BrevoAPIURL,
		From:         config.EmailFrom,
		FromName:     config.EmailFromName,
		AppURL:       config.AppURL,
	})
	authService := services.NewAuthService(userRepo, securityService, emailService, config.JWTSecret, config.JWTExpiry)
	log.Printf(
		"email config: enabled=%t provider=%q api_key_set=%t from_set=%t from_name=%q app_url=%q",
		emailService.IsConfigured(),
		"brevo",
		strings.TrimSpace(config.BrevoAPIKey) != "",
		strings.TrimSpace(config.EmailFrom) != "",
		config.EmailFromName,
		config.AppURL,
	)
	if !emailService.IsConfigured() {
		log.Printf("email service disabled: set BREVO_API_KEY and EMAIL_FROM in backend environment")
	}
	authHandler := handlers.NewAuthHandler(authService, securityService)
	dashboardHandler := handlers.NewDashboardHandler(authService, securityService, userRepo, emailService)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(appmw.Logging)
	r.Use(appmw.CORS(config.CORSOrigins))

	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, http.StatusOK, map[string]interface{}{
			"status":          "ok",
			"emailConfigured": emailService.IsConfigured(),
		})
	})

	r.Route("/v1", func(v1 chi.Router) {
		v1.Route("/auth", func(auth chi.Router) {
			auth.Post("/login", authHandler.Login)
			auth.Post("/logout", authHandler.Logout)
			auth.Post("/forgot-password", authHandler.ForgotPassword)
			auth.Get("/reset-password", authHandler.ValidateResetToken)
			auth.Post("/reset-password", authHandler.ResetPassword)
		})
		v1.Route("/dashboard", func(dashboard chi.Router) {
			dashboard.Get("/user", dashboardHandler.UserInfo)

			// Member routes
			dashboard.Get("/member", dashboardHandler.MemberDashboard)
			dashboard.Get("/notifications", dashboardHandler.Notifications)
			dashboard.Patch("/notifications", dashboardHandler.Notifications)
			dashboard.Put("/password", dashboardHandler.ChangePassword)
			dashboard.Post("/password/change/request-code", dashboardHandler.RequestPasswordChangeCode)
			dashboard.Post("/password/change/verify-code", dashboardHandler.VerifyPasswordChangeCode)
			dashboard.Post("/password/change/confirm", dashboardHandler.ConfirmPasswordChangeWithCode)
			dashboard.Get("/support/config", dashboardHandler.SupportConfig)
			dashboard.Put("/support/config", dashboardHandler.SupportConfig)
			dashboard.Get("/support/threads", dashboardHandler.SupportThreads)
			dashboard.Get("/support/messages", dashboardHandler.SupportMessages)
			dashboard.Post("/support/messages", dashboardHandler.SupportSendMessage)
			dashboard.Post("/support/threads/processed", dashboardHandler.SupportMarkProcessed)
			dashboard.Get("/support/stream", dashboardHandler.SupportStream)
			dashboard.Post("/support/stream/ticket", dashboardHandler.SupportStreamTicket)
			dashboard.Get("/member/deposits", dashboardHandler.MemberDeposits)
			dashboard.Get("/member/transactions", dashboardHandler.MemberTransactions)
			dashboard.Get("/member/loans", dashboardHandler.MemberLoans)
			dashboard.Post("/member/requests/deposit", dashboardHandler.MemberCreateDepositRequest)
			dashboard.Post("/member/requests/loan-repayment", dashboardHandler.MemberCreateLoanRepaymentRequest)
			dashboard.Get("/member/profile", dashboardHandler.MemberProfile)

			// Worker routes
			dashboard.Get("/worker", dashboardHandler.WorkerDashboard)
			dashboard.Get("/worker/members", dashboardHandler.WorkerMembers)
			dashboard.Get("/worker/members/{memberId}", dashboardHandler.WorkerMemberDetail)
			dashboard.Post("/worker/members/{memberId}/deposit", dashboardHandler.WorkerAddDeposit)
			dashboard.Post("/worker/members/{memberId}/withdrawal", dashboardHandler.WorkerAddWithdrawal)
			dashboard.Post("/worker/members/{memberId}/loan", dashboardHandler.WorkerAddLoan)
			dashboard.Post("/worker/members/{memberId}/loan-payment", dashboardHandler.WorkerAddLoanPayment)
			dashboard.Get("/worker/requests", dashboardHandler.WorkerRequests)
			dashboard.Get("/worker/loans", dashboardHandler.WorkerLoans)
			dashboard.Get("/worker/transactions", dashboardHandler.WorkerTransactions)
			dashboard.Get("/worker/profile", dashboardHandler.WorkerProfile)
			dashboard.Put("/worker/profile", dashboardHandler.UpdateProfile)
			dashboard.Post("/worker/deposit", dashboardHandler.ProcessDeposit)
			dashboard.Post("/worker/withdrawal", dashboardHandler.ProcessWithdrawal)

			// Everything under /admin is gated by the middleware below, so a
			// handler added here is protected by where it is mounted rather
			// than by the author remembering a check (SEC-02). Handlers keep
			// their own requireRoles call as defence in depth.
			dashboard.Route("/admin", func(admin chi.Router) {
				admin.Group(func(adminOnly chi.Router) {
					adminOnly.Use(dashboardHandler.RequireRoles("ADMIN", "SUPER_ADMIN"))

					// Admin dashboard
					adminOnly.Get("/", dashboardHandler.AdminDashboard)
					adminOnly.Get("/members", dashboardHandler.AdminMembers)
					adminOnly.Get("/workers", dashboardHandler.AdminWorkers)
					adminOnly.Post("/workers/welcome-email", dashboardHandler.SendWorkerWelcomeEmail)
					adminOnly.Post("/members/status", dashboardHandler.UpdateMemberStatus)

					// Admin approvals
					adminOnly.Get("/approvals", dashboardHandler.AdminApprovals)
					adminOnly.Post("/approvals/registration", dashboardHandler.ApproveRegistration)
					adminOnly.Post("/approvals/registration/reject", dashboardHandler.RejectRegistration)
					adminOnly.Post("/approvals/loan", dashboardHandler.ApproveLoan)
					adminOnly.Post("/approvals/loan/reject", dashboardHandler.RejectLoan)
					adminOnly.Post("/approvals/withdrawal", dashboardHandler.ApproveWithdrawal)
					adminOnly.Post("/approvals/withdrawal/reject", dashboardHandler.RejectWithdrawal)

					// Admin deposits
					adminOnly.Get("/deposits", dashboardHandler.AdminDeposits)

					// Admin loans
					adminOnly.Get("/loans", dashboardHandler.AdminLoans)
					adminOnly.Get("/loans/detail", dashboardHandler.AdminLoanDetail)
					adminOnly.Post("/loans/default", dashboardHandler.MarkLoanDefaulted)

					// Admin reports
					adminOnly.Get("/reports/monthly", dashboardHandler.MonthlyReport)
					adminOnly.Get("/reports/yearly", dashboardHandler.YearlyReport)
					adminOnly.Get("/reports/loans", dashboardHandler.LoanPerformanceReport)

					// Admin profile
					adminOnly.Get("/profile", dashboardHandler.AdminProfile)
					adminOnly.Put("/profile", dashboardHandler.UpdateProfile)
				})

				// Donations sit under /admin for historical URL reasons but are
				// recorded by field workers too, so they get the wider gate.
				admin.Group(func(staff chi.Router) {
					staff.Use(dashboardHandler.RequireRoles("ADMIN", "SUPER_ADMIN", "WORKER"))

					staff.Get("/donations", dashboardHandler.AdminDonations)
					staff.Post("/donations", dashboardHandler.RecordDonation)
				})
			})
		})
	})

	addr := ":" + config.Port
	log.Printf("API server running on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		if errors.Is(err, syscall.EADDRINUSE) {
			log.Fatalf("port %s is already in use; set API_PORT to a free port or stop the process using it", config.Port)
		}
		log.Fatal(err)
	}
}
