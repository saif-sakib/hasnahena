package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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

// logLevel is set from LOG_LEVEL once config is loaded. It has to exist before
// then so that config.Load's own failures are already structured.
var logLevel = new(slog.LevelVar)

func setupLogging() {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	// SetDefault also routes the standard log package through this handler, so
	// a stray log.Printf anywhere in a dependency still comes out as JSON.
	slog.SetDefault(slog.New(handler))
}

func applyLogLevel(name string) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "debug":
		logLevel.Set(slog.LevelDebug)
	case "warn", "warning":
		logLevel.Set(slog.LevelWarn)
	case "error":
		logLevel.Set(slog.LevelError)
	default:
		logLevel.Set(slog.LevelInfo)
	}
}

func main() {
	setupLogging()

	config := cfg.Load()
	applyLogLevel(config.LogLevel)

	if config.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		slog.Error("failed to parse database config", "error", err)
		os.Exit(1)
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
		slog.Error("failed to connect db", "error", err)
		os.Exit(1)
	}
	defer dbPool.Close()

	userRepo := repositories.NewUserRepository(dbPool)
	if err := userRepo.EnsureSupportSchema(context.Background()); err != nil {
		slog.Error("failed to ensure support schema", "error", err)
		os.Exit(1)
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
	slog.Info("email config",
		"enabled", emailService.IsConfigured(),
		"provider", "brevo",
		"apiKeySet", strings.TrimSpace(config.BrevoAPIKey) != "",
		"fromSet", strings.TrimSpace(config.EmailFrom) != "",
		"fromName", config.EmailFromName,
		"appUrl", config.AppURL,
	)
	if !emailService.IsConfigured() {
		slog.Warn("email service disabled: set BREVO_API_KEY and EMAIL_FROM in backend environment")
	}
	authHandler := handlers.NewAuthHandler(authService, securityService)
	dashboardHandler := handlers.NewDashboardHandler(authService, securityService, userRepo, emailService)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	// Logging sits outside Recoverer so a panic is turned into a 500 while still
	// inside the access-log wrapper, and therefore gets logged with that status.
	r.Use(appmw.Logging)
	r.Use(middleware.Recoverer)
	r.Use(appmw.CORS(config.CORSOrigins))

	// Liveness: is the process up? Deliberately touches nothing — a restart is
	// never the right answer to a database being briefly unreachable.
	// emailConfigured stays here because the deployment.md release checklist reads it.
	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, http.StatusOK, map[string]interface{}{
			"status":          "ok",
			"emailConfigured": emailService.IsConfigured(),
		})
	})

	// Readiness: can this instance actually serve? Pings the pool, so a load
	// balancer can pull an instance that has lost its database without the
	// orchestrator killing it.
	r.Get("/v1/ready", func(w http.ResponseWriter, r *http.Request) {
		pingCtx, cancelPing := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancelPing()

		if err := dbPool.Ping(pingCtx); err != nil {
			slog.Error("readiness check failed", "error", err)
			utils.Error(w, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "Database is not reachable")
			return
		}

		utils.Success(w, http.StatusOK, map[string]interface{}{"status": "ready"})
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

	// Cancelled on SIGTERM/SIGINT. Everything that should stop when the process
	// is asked to stop hangs off this.
	runCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	startCleanupLoop(runCtx, securityService, config.CleanupInterval)

	srv := &http.Server{
		Addr:    ":" + config.Port,
		Handler: r,
		// Without these one slow client can hold a connection open forever (RUN-01).
		ReadHeaderTimeout: config.ServerReadHeaderTimeout,
		ReadTimeout:       config.ServerReadTimeout,
		WriteTimeout:      config.ServerWriteTimeout,
		IdleTimeout:       config.ServerIdleTimeout,
	}

	serverFailed := make(chan error, 1)
	go func() {
		slog.Info("api server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverFailed <- err
		}
	}()

	select {
	case err := <-serverFailed:
		if errors.Is(err, syscall.EADDRINUSE) {
			slog.Error("port is already in use; set API_PORT to a free port or stop the process using it", "port", config.Port)
		} else {
			slog.Error("api server failed", "error", err)
		}
		os.Exit(1)
	case <-runCtx.Done():
		slog.Info("shutdown signal received, draining in-flight requests", "timeout", config.ServerShutdownTimeout.String())
	}

	// End the SSE streams first. They never go idle, so Shutdown would otherwise
	// wait out the whole timeout on connections that are safe to drop, while
	// genuinely important work — a deposit being posted — is what the drain
	// window is actually for.
	dashboardHandler.BeginShutdown()

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), config.ServerShutdownTimeout)
	defer cancelShutdown()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		// Requests still running at this point are cut. Worth an error line:
		// it means something took longer than the drain window.
		slog.Error("graceful shutdown did not finish in time", "error", err)
	} else {
		slog.Info("shutdown complete")
	}

	// dbPool.Close is deferred above, so it runs after this — the pool outlives
	// the requests that need it.
}

// startCleanupLoop sweeps expired token_blacklist and rate_limits rows on a
// ticker (RUN-06). Both tables are write-heavy and nothing else ever deletes
// from them, so without this they grow for the life of the deployment.
func startCleanupLoop(ctx context.Context, security *services.SecurityService, interval time.Duration) {
	if interval <= 0 {
		slog.Warn("cleanup loop disabled", "interval", interval.String())
		return
	}

	runOnce := func() {
		// Bounded independently of the tick so a stuck delete cannot stack up.
		sweepCtx, cancel := context.WithTimeout(ctx, 1*time.Minute)
		defer cancel()

		tokens, err := security.CleanupExpiredTokens(sweepCtx)
		if err != nil {
			slog.Error("token blacklist cleanup failed", "error", err)
		}

		rateLimits, err := security.CleanupExpiredRateLimits(sweepCtx)
		if err != nil {
			slog.Error("rate limit cleanup failed", "error", err)
		}

		if tokens > 0 || rateLimits > 0 {
			slog.Info("cleanup swept expired rows", "tokenBlacklist", tokens, "rateLimits", rateLimits)
		}
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Once at boot: a process that restarts more often than the interval
		// would otherwise never sweep at all.
		runOnce()

		for {
			select {
			case <-ctx.Done():
				slog.Info("cleanup loop stopped")
				return
			case <-ticker.C:
				runOnce()
			}
		}
	}()
}
