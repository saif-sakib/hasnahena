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
	"hasnahena/apps/api/internal/metrics"
	appmw "hasnahena/apps/api/internal/middleware"
	"hasnahena/apps/api/internal/observability"
	repositories "hasnahena/apps/api/internal/repositories"
	services "hasnahena/apps/api/internal/services"
	"hasnahena/apps/api/internal/utils"
)

// logLevel exists before config.Load so its own failures are structured.
var logLevel = new(slog.LevelVar)

func setupLogging() {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	// Also routes the std log package (and dependencies) through JSON.
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

// selfProbe is the container HEALTHCHECK (the distroless image has no curl).
// It skips cfg.Load so missing config is not reported as "unhealthy".
func selfProbe() int {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = os.Getenv("PORT")
	}
	if port == "" {
		port = "8081"
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/v1/ready")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func main() {
	// Must run before anything else: cfg.Load exits on missing variables.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(selfProbe())
	}

	setupLogging()

	config := cfg.Load()
	applyLogLevel(config.LogLevel)

	// As early as possible so later fatal startup errors reach Sentry.
	defer observability.Init(config.Environment)()

	if config.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		observability.Flush()
		os.Exit(1)
	}

	// Startup only — dead after 10s. Long-lived loops must use runCtx.
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelStartup()

	poolConfig, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		slog.Error("failed to parse database config", "error", err)
		observability.Flush()
		os.Exit(1)
	}
	poolConfig.MaxConns = config.DBMaxConns
	poolConfig.MinConns = config.DBMinConns
	poolConfig.MaxConnIdleTime = config.DBMaxConnIdleTime
	poolConfig.MaxConnLifetime = config.DBMaxConnLifetime
	poolConfig.HealthCheckPeriod = config.DBHealthCheckPeriod
	// Neon pooler (pgBouncer) can raise prepared-statement conflicts; simple protocol avoids server-side prepare reuse.
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	// Pin sessions to UTC: columns are `timestamp without time zone`, and a
	// non-UTC NOW() breaks the revocation-marker vs JWT `iat` comparison.
	poolConfig.ConnConfig.RuntimeParams["timezone"] = "UTC"

	dbPool, err := pgxpool.NewWithConfig(startupCtx, poolConfig)
	if err != nil {
		slog.Error("failed to connect db", "error", err)
		observability.Flush()
		os.Exit(1)
	}
	defer dbPool.Close()

	userRepo := repositories.NewUserRepository(dbPool)
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

	// Caller address for limiter, access log, lockout and audit (ADR-019).
	clientIPConfig := appmw.ClientIPConfig{
		TrustedProxies:  config.TrustedProxies,
		TrustCloudflare: config.TrustCloudflareClientIP,
	}
	switch {
	case clientIPConfig.TrustCloudflare:
		slog.Info("caller address resolution: CF-Connecting-IP, falling back to the proxy count",
			"trustedProxies", config.TrustedProxies)
	case config.TrustedProxies == 0 && config.Environment != "development":
		slog.Warn("TRUSTED_PROXIES is 0: every caller behind a proxy is attributed to the proxy's address, "+
			"so they share one rate-limit bucket and one lockout. Set it to the number of proxies in front "+
			"of this process, or set TRUST_CLOUDFLARE_CLIENT_IP=true if every route to it passes through "+
			"your own Cloudflare zone.", "environment", config.Environment)
	default:
		slog.Info("caller address resolution: X-Forwarded-For by count",
			"trustedProxies", config.TrustedProxies)
	}

	r := chi.NewRouter()

	limiterStop := make(chan struct{})
	defer close(limiterStop)
	mountMiddleware(r, middlewareConfig{
		CORSOrigins: config.CORSOrigins,
		EnableHSTS:  config.EnableHSTS,
		ClientIP:    clientIPConfig,
		RateLimit: appmw.RateLimitConfig{
			Requests: config.RateLimitRequests,
			Window:   config.RateLimitWindow,
			ClientIP: clientIPConfig,
		},
		LimiterStop: limiterStop,
		// Signature and expiry only — no DB revocation check on every request.
		// Handlers still call ValidateToken.
		VerifyToken: func(token string) (string, bool) {
			claims, err := authService.ParseAccessToken(token)
			if err != nil {
				return "", false
			}
			sub, _ := claims["sub"].(string)
			return sub, sub != ""
		},
	})

	metrics.Register(dbPool)

	r.Handle("/metrics", metrics.Handler(config.MetricsToken))

	mountRoutes(r, routerDeps{
		auth:            authHandler,
		dashboard:       dashboardHandler,
		db:              dbPool,
		emailConfigured: emailService.IsConfigured,
	})

	runCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	startCleanupLoop(runCtx, securityService, config.CleanupInterval)
	startReconciliationLoop(runCtx, userRepo, config.ReconcileInterval)
	startRetentionSweepLoop(runCtx, userRepo, config.RetentionSweepInterval)
	metrics.StartBusinessRefresh(runCtx, dbPool, config.MetricsRefreshInterval)

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

	waitForShutdown(runCtx, srv, dashboardHandler, serverFailed, config.ServerShutdownTimeout)
}

// routerDeps is everything the route table needs, so tests can mount it
// without Brevo, Sentry or a socket. middlewareConfig is the deployment half.
type middlewareConfig struct {
	CORSOrigins []string
	EnableHSTS  bool

	// ClientIP decides which address a request is attributed to.
	ClientIP appmw.ClientIPConfig

	RateLimit   appmw.RateLimitConfig
	LimiterStop <-chan struct{}

	// VerifyToken attributes a request to a member before rate limiting (WO-78).
	// Nil means "attribute by address".
	VerifyToken appmw.TokenVerifier
}

// mountMiddleware is the global middleware stack, in order.
func mountMiddleware(r chi.Router, cfg middlewareConfig) {
	r.Use(middleware.RequestID)

	// chi's RealIP is deliberately NOT mounted: it trusts a caller-supplied
	// X-Forwarded-For. Use middleware.ClientIP (ADR-019).
	// Logging sits outside Recoverer so panics are logged as 500s.
	r.Use(appmw.Logging(cfg.ClientIP))
	r.Use(appmw.Metrics)
	r.Use(middleware.Recoverer)
	// Inside Recoverer, or the reporter never sees a panic.
	r.Use(observability.Recoverer)
	r.Use(appmw.CORS(cfg.CORSOrigins, cfg.EnableHSTS))

	// Before the limiter, which keys on the verified member (WO-78).
	r.Use(appmw.Identity(cfg.VerifyToken))

	// After CORS so a 429 still carries the headers a browser needs.
	r.Use(appmw.RateLimit(cfg.RateLimit, cfg.LimiterStop))
}

type routerDeps struct {
	auth            *handlers.AuthHandler
	dashboard       *handlers.DashboardHandler
	db              *pgxpool.Pool
	emailConfigured func() bool
}

// mountRoutes is the API's entire URL surface; extracted so tests can walk it.
func mountRoutes(r chi.Router, d routerDeps) {
	authHandler, dashboardHandler, dbPool := d.auth, d.dashboard, d.db

	// Liveness: touches nothing. emailConfigured is read by the release checklist.
	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, http.StatusOK, map[string]interface{}{
			"status":          "ok",
			"emailConfigured": d.emailConfigured(),
		})
	})

	// Readiness: pings the pool.
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
		// In the route table so contract tests cover it (TEST-18).
		v1.Use(appmw.RejectNulBytes)

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
			dashboard.Get("/worker/members/{memberUserId}", dashboardHandler.WorkerMemberDetail)
			dashboard.Post("/worker/members/{memberUserId}/deposit", dashboardHandler.WorkerAddDeposit)
			dashboard.Post("/worker/members/{memberUserId}/withdrawal", dashboardHandler.WorkerAddWithdrawal)
			dashboard.Post("/worker/members/{memberUserId}/loan", dashboardHandler.WorkerAddLoan)
			dashboard.Post("/worker/members/{memberUserId}/loan-topup", dashboardHandler.WorkerAddLoanTopUp)
			dashboard.Post("/worker/members/{memberUserId}/loan-payment", dashboardHandler.WorkerAddLoanPayment)
			dashboard.Get("/worker/requests", dashboardHandler.WorkerRequests)
			dashboard.Get("/worker/loans", dashboardHandler.WorkerLoans)
			dashboard.Get("/worker/transactions", dashboardHandler.WorkerTransactions)
			dashboard.Get("/worker/profile", dashboardHandler.WorkerProfile)
			// Staff-only; the handler is shared with /admin/profile (SEC-02).
			dashboard.With(dashboardHandler.RequireRoles("WORKER", "ADMIN", "SUPER_ADMIN")).
				Put("/worker/profile", dashboardHandler.UpdateProfile)
			// Everything under /admin is gated by where it is mounted (SEC-02);
			// handlers keep their own requireRoles as defence in depth.
			dashboard.Route("/admin", func(admin chi.Router) {
				admin.Group(func(adminOnly chi.Router) {
					adminOnly.Use(dashboardHandler.RequireRoles("ADMIN", "SUPER_ADMIN"))

					// Admin-only: carries recentActivity (the audit trail).
					adminOnly.Get("/", dashboardHandler.AdminDashboard)
					adminOnly.Get("/workers", dashboardHandler.AdminWorkers)
					adminOnly.Post("/workers/welcome-email", dashboardHandler.SendWorkerWelcomeEmail)
					adminOnly.Post("/members/status", dashboardHandler.UpdateMemberStatus)

					// Registration and loan approval are admin decisions;
					// processing postings is a worker's job (staff group below).
					adminOnly.Post("/approvals/registration", dashboardHandler.ApproveRegistration)
					adminOnly.Post("/approvals/registration/reject", dashboardHandler.RejectRegistration)
					adminOnly.Post("/approvals/loan", dashboardHandler.ApproveLoan)
					adminOnly.Post("/approvals/loan/reject", dashboardHandler.RejectLoan)

					// Admin loans
					adminOnly.Get("/loans/detail", dashboardHandler.AdminLoanDetail)
					adminOnly.Post("/loans/default", dashboardHandler.MarkLoanDefaulted)

					// Admin profile
					adminOnly.Get("/profile", dashboardHandler.AdminProfile)
					adminOnly.Put("/profile", dashboardHandler.UpdateProfile)
				})

				// Under /admin for historical URL reasons; a worker's daily work.
				admin.Group(func(staff chi.Router) {
					staff.Use(dashboardHandler.RequireRoles("ADMIN", "SUPER_ADMIN", "WORKER"))

					staff.Get("/donations", dashboardHandler.AdminDonations)
					staff.Post("/donations", dashboardHandler.RecordDonation)

					// AdminApprovals omits registrations for a worker.
					staff.Get("/approvals", dashboardHandler.AdminApprovals)
					staff.Post("/approvals/withdrawal", dashboardHandler.ApproveWithdrawal)
					staff.Post("/approvals/withdrawal/reject", dashboardHandler.RejectWithdrawal)

					staff.Get("/reports/monthly", dashboardHandler.MonthlyReport)
					staff.Get("/reports/yearly", dashboardHandler.YearlyReport)
					staff.Get("/reports/loans", dashboardHandler.LoanPerformanceReport)

					// Read-only lists for the shared reports screen.
					staff.Get("/members", dashboardHandler.AdminMembers)
					staff.Get("/loans", dashboardHandler.AdminLoans)
					staff.Get("/deposits", dashboardHandler.AdminDeposits)
				})
			})
		})
	})
}

// waitForShutdown blocks until the server dies or the process is asked to stop,
// then drains.
func waitForShutdown(
	runCtx context.Context,
	srv *http.Server,
	dashboardHandler *handlers.DashboardHandler,
	serverFailed <-chan error,
	shutdownTimeout time.Duration,
) {
	select {
	case err := <-serverFailed:
		if errors.Is(err, syscall.EADDRINUSE) {
			slog.Error("port is already in use; set API_PORT to a free port or stop the process using it", "addr", srv.Addr)
		} else {
			slog.Error("api server failed", "error", err)
		}
		observability.Flush()
		os.Exit(1)
	case <-runCtx.Done():
		slog.Info("shutdown signal received, draining in-flight requests", "timeout", shutdownTimeout.String())
	}

	// End SSE streams first; they never go idle and would eat the drain window.
	dashboardHandler.BeginShutdown()

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancelShutdown()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown did not finish in time", "error", err)
	} else {
		slog.Info("shutdown complete")
	}

}

// startCleanupLoop sweeps expired token_blacklist and rate_limits rows (RUN-06).
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

		// Once at boot, in case restarts outpace the interval.
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

// startReconciliationLoop sums the ledger against stored balances (WO-82).
// Reports, never repairs (ADR-027). ctx must be runCtx — see wiring_test.go.
func startReconciliationLoop(ctx context.Context, repo *repositories.UserRepository, interval time.Duration) {
	if repo == nil || interval <= 0 {
		slog.Warn("ledger reconciliation is disabled", "interval", interval)
		return
	}

	runOnce := func() {
		passCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()

		report, err := repo.Reconcile(passCtx)
		if err != nil {
			metrics.ObserveLedgerReconcileFailure()
			slog.Error("ledger reconciliation failed", "error", err)
			return
		}

		rows := make(map[string]int64, len(repositories.AllChecks))
		taka := make(map[string]int64, len(repositories.AllChecks))
		for _, drift := range report.Drifts {
			rows[drift.Check]++
			if repositories.CheckHasAmount(drift.Check) {
				taka[drift.Check] += drift.Delta()
			}
		}
		// Every check, so an unset gauge never reads as "no drift".
		metrics.SetLedgerDrift(rows, taka, repositories.AllChecks)

		if report.Balanced() {
			slog.Info("ledger reconciled", "duration", report.Duration, "scanned", report.Scanned)
			return
		}

		if err := repo.RecordDrift(passCtx, report); err != nil {
			slog.Error("could not record ledger drift in the audit log", "error", err)
		}
		for _, drift := range report.Drifts {
			slog.Error("ledger drift",
				"check", drift.Check,
				"entity", drift.Entity,
				"id", drift.EntityID,
				"stored", drift.Actual,
				"ledger", drift.Expected,
				"delta", drift.Delta(),
			)
		}
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Once at boot.
		runOnce()

		for {
			select {
			case <-ctx.Done():
				slog.Info("reconciliation loop stopped")
				return
			case <-ticker.C:
				runOnce()
			}
		}
	}()
}

// startRetentionSweepLoop clears rejected applicants' identity data past
// security.rejectedRetentionDays (FR-23, ADR-033). ctx must be runCtx.
func startRetentionSweepLoop(ctx context.Context, repo *repositories.UserRepository, interval time.Duration) {
	if repo == nil || interval <= 0 {
		slog.Warn("rejected-application retention sweep is disabled", "interval", interval)
		return
	}

	runOnce := func() {
		passCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()

		report, err := repo.SweepRejectedApplications(passCtx)
		if err != nil {
			slog.Error("rejected-application retention sweep failed", "error", err)
			return
		}
		if report.AvatarsFound > 0 {
			// Only the Next app can delete the Cloudinary asset; this should
			// be impossible (a rejected applicant never signed in).
			slog.Error("retention sweep cleared an avatarUrl it cannot delete from Cloudinary",
				"count", report.AvatarsFound,
				"action", "delete these assets by hand; see docs/runbook.md")
		}
		if report.Cleared == 0 {
			return
		}
		slog.Info("retention sweep cleared rejected applications",
			"cleared", report.Cleared,
			"addresses", report.AddressesRemoved,
			"nominees", report.NomineesRemoved,
			"duration", report.Duration,
		)
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Once at boot.
		runOnce()

		for {
			select {
			case <-ctx.Done():
				slog.Info("retention sweep loop stopped")
				return
			case <-ticker.C:
				runOnce()
			}
		}
	}()
}
