package main

import (
	"context"
	"errors"
	"log"
	"net/http"
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
	authService := services.NewAuthService(userRepo, config.JWTSecret, config.JWTExpiry)
	authHandler := handlers.NewAuthHandler(authService)
	dashboardHandler := handlers.NewDashboardHandler(authService, userRepo)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(appmw.Logging)
	r.Use(appmw.CORS(config.CORSOrigins))

	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(v1 chi.Router) {
		v1.Route("/auth", func(auth chi.Router) {
			auth.Post("/login", authHandler.Login)
		})
		v1.Route("/dashboard", func(dashboard chi.Router) {
			dashboard.Get("/user", dashboardHandler.UserInfo)

			// Member routes
			dashboard.Get("/member", dashboardHandler.MemberDashboard)
			dashboard.Get("/notifications", dashboardHandler.Notifications)
			dashboard.Patch("/notifications", dashboardHandler.Notifications)
			dashboard.Put("/password", dashboardHandler.ChangePassword)
			dashboard.Get("/support/config", dashboardHandler.SupportConfig)
			dashboard.Put("/support/config", dashboardHandler.SupportConfig)
			dashboard.Get("/support/threads", dashboardHandler.SupportThreads)
			dashboard.Get("/support/messages", dashboardHandler.SupportMessages)
			dashboard.Post("/support/messages", dashboardHandler.SupportSendMessage)
			dashboard.Post("/support/threads/processed", dashboardHandler.SupportMarkProcessed)
			dashboard.Get("/support/stream", dashboardHandler.SupportStream)
			dashboard.Get("/member/deposits", dashboardHandler.MemberDeposits)
			dashboard.Get("/member/transactions", dashboardHandler.MemberTransactions)
			dashboard.Get("/member/loans", dashboardHandler.MemberLoans)
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

			// Admin dashboard
			dashboard.Get("/admin", dashboardHandler.AdminDashboard)
			dashboard.Get("/admin/members", dashboardHandler.AdminMembers)
			dashboard.Get("/admin/workers", dashboardHandler.AdminWorkers)
			dashboard.Post("/admin/members/status", dashboardHandler.UpdateMemberStatus)

			// Admin approvals
			dashboard.Get("/admin/approvals", dashboardHandler.AdminApprovals)
			dashboard.Post("/admin/approvals/registration", dashboardHandler.ApproveRegistration)
			dashboard.Post("/admin/approvals/registration/reject", dashboardHandler.RejectRegistration)
			dashboard.Post("/admin/approvals/withdrawal", dashboardHandler.ApproveWithdrawal)
			dashboard.Post("/admin/approvals/withdrawal/reject", dashboardHandler.RejectWithdrawal)

			// Admin deposits
			dashboard.Get("/admin/deposits", dashboardHandler.AdminDeposits)

			// Admin loans
			dashboard.Get("/admin/loans", dashboardHandler.AdminLoans)
			dashboard.Get("/admin/loans/detail", dashboardHandler.AdminLoanDetail)
			dashboard.Post("/admin/loans/default", dashboardHandler.MarkLoanDefaulted)

			// Admin donations
			dashboard.Get("/admin/donations", dashboardHandler.AdminDonations)
			dashboard.Post("/admin/donations", dashboardHandler.RecordDonation)

			// Admin reports
			dashboard.Get("/admin/reports/monthly", dashboardHandler.MonthlyReport)
			dashboard.Get("/admin/reports/yearly", dashboardHandler.YearlyReport)
			dashboard.Get("/admin/reports/loans", dashboardHandler.LoanPerformanceReport)

			// Admin profile
			dashboard.Get("/admin/profile", dashboardHandler.AdminProfile)
			dashboard.Put("/admin/profile", dashboardHandler.UpdateProfile)
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
