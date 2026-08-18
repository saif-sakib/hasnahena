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

// selfProbe is the container HEALTHCHECK. The runtime image is distroless: no
// shell, no curl, no wget, so the only thing available to probe the server is
// the server binary itself. Costs nothing in image size — net/http is already
// linked in.
//
// It deliberately does not call cfg.Load: that exits when DATABASE_URL is
// missing, and a liveness probe reporting "unhealthy" because of unset
// configuration would be reporting on the wrong thing.
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

	// /v1/ready pings Postgres and answers 503 when it cannot reach it, which
	// is exactly the state this probe exists to catch.
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

	if config.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	// Startup only — this context is dead ten seconds after boot. Never hand it
	// to anything that must outlive startup; use runCtx (below) for that. A
	// background loop given this one runs exactly once and then returns.
	startupCtx, cancelStartup := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelStartup()

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

	// Pin every connection to UTC. The timestamp columns are `timestamp without
	// time zone`, so NOW() is stored as whatever wall clock the session's zone
	// says — on a server set to Asia/Dhaka that is six hours off the UTC values
	// Prisma writes, and pgx reads bare timestamps back as UTC either way.
	//
	// That skew is not cosmetic. IsUserTokensRevoked compares a stored NOW()
	// against a JWT's `iat`, so under a non-UTC session every token issued after
	// a password change looked older than the revocation marker and the member
	// was locked out until it expired. Neon happens to default to UTC, which is
	// the only reason production has not hit this; a VPS would not be so kind.
	poolConfig.ConnConfig.RuntimeParams["timezone"] = "UTC"

	flushSentry := observability.Init(config.Environment)
	defer flushSentry()

	dbPool, err := pgxpool.NewWithConfig(startupCtx, poolConfig)
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

	// TRUSTED_PROXIES decides which X-Forwarded-For entry is believed, and four
	// things read the answer: the rate limiter, the access log, the login
	// lockout and the audit rows (ADR-019). Both ways of getting it wrong are
	// silent, so the count this process is running with is stated at boot.
	if config.TrustedProxies == 0 && config.Environment != "development" {
		slog.Warn("TRUSTED_PROXIES is 0: every caller behind a proxy is attributed to the proxy's address, "+
			"so they share one rate-limit bucket and one lockout. Set it to the number of proxies in front "+
			"of this process (Render is 1).", "environment", config.Environment)
	} else {
		slog.Info("caller address resolution", "trustedProxies", config.TrustedProxies)
	}

	r := chi.NewRouter()

	limiterStop := make(chan struct{})
	defer close(limiterStop)
	mountMiddleware(r, middlewareConfig{
		CORSOrigins:    config.CORSOrigins,
		EnableHSTS:     config.EnableHSTS,
		TrustedProxies: config.TrustedProxies,
		RateLimit: appmw.RateLimitConfig{
			Requests:       config.RateLimitRequests,
			Window:         config.RateLimitWindow,
			TrustedProxies: config.TrustedProxies,
		},
		LimiterStop: limiterStop,
	})

	metrics.Register(dbPool)

	// Not under /v1: this is an operational surface, not part of the member
	// API, and it is versioned by the exposition format rather than by us.
	r.Handle("/metrics", metrics.Handler(config.MetricsToken))

	mountRoutes(r, routerDeps{
		auth:            authHandler,
		dashboard:       dashboardHandler,
		db:              dbPool,
		emailConfigured: emailService.IsConfigured,
	})

	// Cancelled on SIGTERM/SIGINT. Everything that should stop when the process
	// is asked to stop hangs off this.
	runCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	startCleanupLoop(runCtx, securityService, config.CleanupInterval)
	// runCtx, not startupCtx: this must keep running for the life of the
	// process, and is cancelled by the same SIGTERM that drains the server.
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

// routerDeps is everything the route table needs. It exists so mountRoutes can
// be called from a test with a real database and no Brevo, no Sentry and no
// listening socket — see cmd/server/routes_integration_test.go.
// middlewareConfig is the deployment half of the stack: who is in front of this
// process, and what a caller is allowed to do.
type middlewareConfig struct {
	CORSOrigins []string
	EnableHSTS  bool

	// TrustedProxies is how many reverse proxies sit in front. It decides which
	// X-Forwarded-For entry is believed — see middleware.ClientIP — and it is
	// the one knob an operator has to get right: set it to the number of proxies
	// in front of this process, and to 0 only when nothing is.
	TrustedProxies int

	RateLimit   appmw.RateLimitConfig
	LimiterStop <-chan struct{}
}

// mountMiddleware is the global middleware stack, in order.
//
// Extracted from main() by WO-60 for the same reason mountRoutes was: the
// defect it fixes lives in the *order and composition* of this stack, and a
// stack built inline in main() cannot be exercised by a test. Removing chi's
// RealIP is a one-line change whose effect is only visible end to end — the
// limiter keeping its grip on a caller who varies a header.
func mountMiddleware(r chi.Router, cfg middlewareConfig) {
	r.Use(middleware.RequestID)

	// chi's middleware.RealIP is deliberately NOT mounted (WO-60). It overwrote
	// r.RemoteAddr with the leftmost X-Forwarded-For entry — a value the caller
	// supplies — so the access log recorded an address the caller chose, and at
	// the default TRUSTED_PROXIES=0 the limiter keyed on it too, handing one
	// client a fresh quota per request for the cost of varying a header.
	// Everything that needs the caller's address now goes through
	// middleware.ClientIP, which counts from the trusted end.

	// Logging sits outside Recoverer so a panic is turned into a 500 while still
	// inside the access-log wrapper, and therefore gets logged with that status.
	// It also resolves the caller's address once, for everything downstream.
	r.Use(appmw.Logging(cfg.TrustedProxies))
	r.Use(appmw.Metrics)
	r.Use(middleware.Recoverer)
	// Inside Recoverer on purpose: Recoverer stops the panic, so a reporter
	// registered outside it would never see one (RUN-08).
	r.Use(observability.Recoverer)
	r.Use(appmw.CORS(cfg.CORSOrigins, cfg.EnableHSTS))

	// RUN-07. Mounted after CORS so a throttled request still carries the
	// headers a browser needs to read the 429 — a rejection the browser reports
	// as a CORS failure tells the member nothing.
	r.Use(appmw.RateLimit(cfg.RateLimit, cfg.LimiterStop))
}

type routerDeps struct {
	auth            *handlers.AuthHandler
	dashboard       *handlers.DashboardHandler
	db              *pgxpool.Pool
	emailConfigured func() bool
}

// mountRoutes is the API's entire URL surface.
//
// It was inline in main() until 2026-08-17. Extracting it is what makes TEST-15
// possible: a table-driven test can only assert "every route refuses an
// anonymous caller" if it can enumerate the routes, and chi can only walk a
// router something else has built. Nothing about the routing changed — the
// global middleware stack stays in main(), because that is configuration rather
// than surface.
func mountRoutes(r chi.Router, d routerDeps) {
	authHandler, dashboardHandler, dbPool := d.auth, d.dashboard, d.db

	// Liveness: is the process up? Deliberately touches nothing — a restart is
	// never the right answer to a database being briefly unreachable.
	// emailConfigured stays here because the deployment.md release checklist reads it.
	r.Get("/v1/health", func(w http.ResponseWriter, r *http.Request) {
		utils.Success(w, http.StatusOK, map[string]interface{}{
			"status":          "ok",
			"emailConfigured": d.emailConfigured(),
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
		// Part of the route table rather than of main's middleware stack, so
		// that the contract tests exercise it: a NUL byte in a query parameter
		// used to reach PostgreSQL and come back as a 500 (TEST-18).
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
			dashboard.Post("/member/requests/withdrawal", dashboardHandler.MemberCreateWithdrawalNotice)
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
			// UpdateProfile edits only the caller's own row, so it asks for a
			// session and not a role — which left this PUT reachable by a
			// MEMBER while the GET beside it was staff-only. No escalation was
			// possible, but a route whose two halves disagree about who it is
			// for is a route nobody can reason about. Gated here rather than
			// inside the handler because the handler is shared with
			// /admin/profile, which the adminOnly group already narrows
			// further — mounting location is the answer (SEC-02, TEST-15).
			dashboard.With(dashboardHandler.RequireRoles("WORKER", "ADMIN", "SUPER_ADMIN")).
				Put("/worker/profile", dashboardHandler.UpdateProfile)
			// POST /worker/{deposit,withdrawal} removed 2026-08-17 (WO-41):
			// unused duplicates of the /worker/members/{memberId}/… routes
			// above, one without an audit row and one that reported success
			// without moving money.

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
		os.Exit(1)
	case <-runCtx.Done():
		slog.Info("shutdown signal received, draining in-flight requests", "timeout", shutdownTimeout.String())
	}

	// End the SSE streams first. They never go idle, so Shutdown would otherwise
	// wait out the whole timeout on connections that are safe to drop, while
	// genuinely important work — a deposit being posted — is what the drain
	// window is actually for.
	dashboardHandler.BeginShutdown()

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancelShutdown()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		// Requests still running at this point are cut. Worth an error line:
		// it means something took longer than the drain window.
		slog.Error("graceful shutdown did not finish in time", "error", err)
	} else {
		slog.Info("shutdown complete")
	}

	// dbPool.Close is deferred in main, so it runs after this — the pool
	// outlives the requests that need it.
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
