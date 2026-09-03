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

	// As early as it can be: Init needs config.Environment and nothing else, and
	// every line after this one can fail fatally. Started later — which it was —
	// a missing DATABASE_URL or an unparseable connection string ended the
	// process with a line in Render's log and no alert anywhere. What still
	// cannot report is cfg.Load itself, which exits on a missing JWT_SECRET
	// before there is an environment to tag the event with.
	defer observability.Init(config.Environment)()

	if config.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		observability.Flush()
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

	dbPool, err := pgxpool.NewWithConfig(startupCtx, poolConfig)
	if err != nil {
		slog.Error("failed to connect db", "error", err)
		observability.Flush()
		os.Exit(1)
	}
	defer dbPool.Close()

	// WO-70 removed an EnsureSupportSchema call here. It ran CREATE TABLE IF NOT
	// EXISTS at every boot for four tables schema.prisma also defines, so the
	// database had two definitions that nothing checked for agreement — and they
	// disagreed. Migrations are the only definition now; `pnpm db:migrate` runs
	// in every environment and CI fails on drift.
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

	// How a caller's address is resolved, and four things read the answer: the
	// rate limiter, the access log, the login lockout and the audit rows
	// (ADR-019). Every way of getting it wrong is silent — a wrong count yields
	// a well-formed address belonging to the wrong party — so the mode this
	// process is running in is stated at boot rather than inferred from a
	// dashboard later.
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
		// Signature and expiry only, deliberately: no revocation check, because
		// this runs on every request including the ones about to be rejected,
		// and a limiter that queries the database is an amplifier rather than a
		// defence. Handlers still call ValidateToken, which does check.
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
	startReconciliationLoop(runCtx, userRepo, config.ReconcileInterval)
	startRetentionSweepLoop(runCtx, userRepo, config.RetentionSweepInterval)
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

	// ClientIP decides which address a request is attributed to — see
	// middleware.ClientIP. It is the setting an operator has to get right, and
	// the only one whose two failure directions are both invisible.
	ClientIP appmw.ClientIPConfig

	RateLimit   appmw.RateLimitConfig
	LimiterStop <-chan struct{}

	// VerifyToken reports the subject of a signed, unexpired token. The
	// Identity middleware uses it to attribute a request to a member before the
	// rate limiter decides which bucket to count it in (WO-78).
	//
	// Nil is legal and means "attribute everything by address", which is the
	// pre-WO-78 behaviour. Tests that do not care about identity leave it unset.
	VerifyToken appmw.TokenVerifier
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
	r.Use(appmw.Logging(cfg.ClientIP))
	r.Use(appmw.Metrics)
	r.Use(middleware.Recoverer)
	// Inside Recoverer on purpose: Recoverer stops the panic, so a reporter
	// registered outside it would never see one (RUN-08).
	r.Use(observability.Recoverer)
	r.Use(appmw.CORS(cfg.CORSOrigins, cfg.EnableHSTS))

	// RUN-09. Before the limiter, and that ordering is the whole difficulty of
	// WO-78: the limiter needs to know which member a request belongs to, and a
	// token it has not verified is worth less than the address it would replace
	// — an attacker sending fresh garbage per request would mint a fresh bucket
	// per request. So the signature and expiry are checked here, once, and
	// carried in the context the way ADR-019 carries the address.
	r.Use(appmw.Identity(cfg.VerifyToken))

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
			// POST /member/requests/withdrawal removed 2026-08-24 (ADR-030). A
			// member filed their own withdrawal notice here and the notice
			// period gated the payout; both are gone. A member asks a field
			// worker, and staff pay from the screens below.
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
			// unused duplicates of the /worker/members/{memberUserId}/… routes
			// above, one without an audit row and one that reported success
			// without moving money.

			// Everything under /admin is gated by the middleware below, so a
			// handler added here is protected by where it is mounted rather
			// than by the author remembering a check (SEC-02). Handlers keep
			// their own requireRoles call as defence in depth.
			dashboard.Route("/admin", func(admin chi.Router) {
				admin.Group(func(adminOnly chi.Router) {
					adminOnly.Use(dashboardHandler.RequireRoles("ADMIN", "SUPER_ADMIN"))

					// Admin dashboard. Stays admin-only because its payload
					// carries `recentActivity` — the audit trail — which
					// product.md reserves for an admin.
					adminOnly.Get("/", dashboardHandler.AdminDashboard)
					adminOnly.Get("/workers", dashboardHandler.AdminWorkers)
					adminOnly.Post("/workers/welcome-email", dashboardHandler.SendWorkerWelcomeEmail)
					adminOnly.Post("/members/status", dashboardHandler.UpdateMemberStatus)

					// Registration and loan approval are the two decisions
					// product.md reserves for an admin ("approve/reject
					// registrations and loans"). The rest of the approvals
					// screen is *processing*, which is a worker's job, and
					// lives in the staff group below.
					adminOnly.Post("/approvals/registration", dashboardHandler.ApproveRegistration)
					adminOnly.Post("/approvals/registration/reject", dashboardHandler.RejectRegistration)
					adminOnly.Post("/approvals/loan", dashboardHandler.ApproveLoan)
					adminOnly.Post("/approvals/loan/reject", dashboardHandler.RejectLoan)

					// Admin loans
					adminOnly.Get("/loans/detail", dashboardHandler.AdminLoanDetail)
					// Marking a default starts a settlement waterfall against
					// the borrower's savings. Admin only, by product.md.
					adminOnly.Post("/loans/default", dashboardHandler.MarkLoanDefaulted)

					// Admin profile
					adminOnly.Get("/profile", dashboardHandler.AdminProfile)
					adminOnly.Put("/profile", dashboardHandler.UpdateProfile)
				})

				// These sit under /admin for historical URL reasons but are a
				// worker's daily work, so they get the wider gate.
				admin.Group(func(staff chi.Router) {
					staff.Use(dashboardHandler.RequireRoles("ADMIN", "SUPER_ADMIN", "WORKER"))

					staff.Get("/donations", dashboardHandler.AdminDonations)
					staff.Post("/donations", dashboardHandler.RecordDonation)

					// The approvals *queue* and the act of processing a pending
					// posting. Both handlers have always asked for
					// WORKER|ADMIN|SUPER_ADMIN; only the mounting disagreed, so
					// the worker approvals screen — which is the admin screen,
					// re-exported — answered 403 for every worker who opened it.
					// AdminApprovals leaves registrations out of a worker's
					// response, so widening the gate widens no data.
					staff.Get("/approvals", dashboardHandler.AdminApprovals)
					staff.Post("/approvals/withdrawal", dashboardHandler.ApproveWithdrawal)
					staff.Post("/approvals/withdrawal/reject", dashboardHandler.RejectWithdrawal)

					// Reporting is read-only aggregate over postings a worker
					// already sees one at a time.
					staff.Get("/reports/monthly", dashboardHandler.MonthlyReport)
					staff.Get("/reports/yearly", dashboardHandler.YearlyReport)
					staff.Get("/reports/loans", dashboardHandler.LoanPerformanceReport)

					// The three read-only lists the shared reports screen
					// cross-foots. Two of them hand a worker nothing new:
					// `/admin/members` is literally the same handler body as
					// `/worker/members` (GetMembersList(ctx, false)), and
					// `/worker/loans` has no worker predicate in its WHERE — it
					// already returns every loan, in a flatter shape. The third,
					// the savings ledger, is the one real widening: a field
					// worker could previously see only the postings they
					// processed. They handle that cash in person and are
					// accountable for the book, so they may read it; what stays
					// admin-only is *acting* on it.
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

// startReconciliationLoop sums the ledger and compares it to the stored
// balances, on a ticker, for the life of the process — WO-82 (OPS-07).
//
// A wrong balance looks exactly like a correct balance until somebody adds it
// up, which is why this outranks every other operational item: it is the only
// control that would have caught LEDGER-01 the night it landed rather than in
// an audit months later.
//
// It reports and never repairs. An automated correction to a ledger is a second
// defect on top of the first, and it destroys the evidence needed to understand
// the first. On drift there is an `audit_logs` row, a `slog` error, and the
// `hasnahena_ledger_drift_*` gauges the Monitor workflow can alert on. A human
// decides what to do about it.
//
// `ctx` must be runCtx, not startupCtx, for the reason wiring_test.go spells
// out: a loop handed a ten-second startup context runs once and stops, silently,
// which is indistinguishable from a ledger that never drifts.
func startReconciliationLoop(ctx context.Context, repo *repositories.UserRepository, interval time.Duration) {
	if repo == nil || interval <= 0 {
		slog.Warn("ledger reconciliation is disabled", "interval", interval)
		return
	}

	runOnce := func() {
		// Bounded independently of the tick, so a pass that is waiting on a
		// slow aggregate cannot stack up behind the next one.
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
			// Not every check has an amount — a posting attributed to the wrong
			// member names the wrong person, it does not misstate a sum.
			if repositories.CheckHasAmount(drift.Check) {
				taka[drift.Check] += drift.Delta()
			}
		}
		// Every check, not only the ones that found something — see
		// metrics.SetLedgerDrift for why a gauge left unset is worse than a
		// gauge set to zero.
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

		// Once at boot. A deploy is the most likely moment for a ledger to have
		// been changed by something other than this application.
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

// startRetentionSweepLoop clears the identity data of rejected applications
// past the retention window — WO-93, FR-23, ADR-033.
//
// A rejection keeps the decision forever and the person's NID number, both
// parents' names, date of birth and two addresses along with it. The decision is
// what the foundation may have to justify; the identity documents are not, a
// year later. Nothing removed them, because nothing existed that could.
//
// Daily, and deliberately unattended: a retention rule that needs somebody to
// remember to run it is a retention rule that is not in force. The window itself
// is `security.rejectedRetentionDays`, so shortening it is an admin decision
// rather than a deploy.
//
// `ctx` must be runCtx, for the reason wiring_test.go spells out — a loop handed
// the ten-second startup context runs once and stops, which here looks exactly
// like a system with nothing left to sweep.
func startRetentionSweepLoop(ctx context.Context, repo *repositories.UserRepository, interval time.Duration) {
	if repo == nil || interval <= 0 {
		slog.Warn("rejected-application retention sweep is disabled", "interval", interval)
		return
	}

	runOnce := func() {
		// Bounded independently of the tick. The first pass after this ships
		// has whatever backlog exists to work through, in batches.
		passCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()

		report, err := repo.SweepRejectedApplications(passCtx)
		if err != nil {
			slog.Error("rejected-application retention sweep failed", "error", err)
			return
		}
		if report.AvatarsFound > 0 {
			// The sweep clears the column; only the Next app can delete the
			// Cloudinary asset behind it. This is supposed to be impossible —
			// avatarUrl is written by a signed-in member on their own profile
			// page and a rejected applicant has never signed in — so it is an
			// error rather than a warning: the photograph is still being served
			// from a public CDN and only a person can remove it.
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

		// Once at boot, like the others: a process that restarts more often than
		// the interval would otherwise never sweep at all.
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
