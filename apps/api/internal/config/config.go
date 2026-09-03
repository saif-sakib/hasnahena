package config

import (
	"bufio"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	JWTExpiry   int64
	CORSOrigins []string
	// SEC-09. Off by default: a browser remembers HSTS for the whole max-age, so
	// sending it from a plain-HTTP localhost API pins `localhost` to HTTPS for
	// two years across every project on that machine.
	EnableHSTS bool
	// RUN-07. Per-client throttle on mutating requests.
	RateLimitRequests int
	RateLimitWindow   time.Duration
	// How many reverse proxies sit in front of this process. Render is 1. This
	// decides which X-Forwarded-For entry is trustworthy — set it wrong and the
	// limiter keys on a value the caller controls.
	TrustedProxies int

	// TrustCloudflareClientIP prefers `CF-Connecting-IP` over counting
	// X-Forwarded-For entries. Only true when every route to this process goes
	// through the foundation's own Cloudflare zone — see middleware.ClientIP.
	TrustCloudflareClientIP bool
	BrevoAPIKey             string
	BrevoAPIURL             string
	EmailFrom               string
	EmailFromName           string
	AppURL                  string
	LogLevel                string
	// MetricsToken gates /metrics. Empty disables the endpoint entirely —
	// the exposition carries business figures, so it is not public.
	MetricsToken string
	// Environment tags Sentry events and separates local noise from production.
	Environment string
	// Connection pool sizing — and the reason the idle end of it is tuned the
	// way it is.
	//
	// **The database this runs against suspends its compute when nothing is
	// connected, and bills for the time it is awake.** So an idle pool is not
	// free: it is the whole bill. `DBMinConns` was 2 and `DBHealthCheckPeriod`
	// was one minute, which means pgxpool held two connections open for ever and
	// pinged them every sixty seconds — the compute never suspended once, on any
	// night, in any week where nobody used the platform. That is a 100% duty
	// cycle bought for nothing, and on a free tier it is the whole allowance.
	//
	// `DBMinConns: 0` lets the pool empty. `DBMaxConnIdleTime` is deliberately
	// **shorter** than the host's suspend timer (5 minutes on Neon) so the
	// connections are gone before the timer would have started, rather than
	// resetting it. The health check then has nothing to keep alive, so its
	// period is a backstop rather than a heartbeat.
	//
	// What this costs: the first query after an idle period waits for the
	// compute to resume — a few hundred milliseconds, once, and only when
	// nobody has used the platform for minutes. A field worker posting deposits
	// pays it at most once a session. Keeping the *API* warm is a separate
	// problem with a separate answer: ping `/v1/health`, which touches nothing.
	DBMaxConns          int32
	DBMinConns          int32
	DBMaxConnIdleTime   time.Duration
	DBMaxConnLifetime   time.Duration
	DBHealthCheckPeriod time.Duration

	// HTTP server bounds. Without these a single slow client can hold a
	// connection open forever (RUN-01).
	ServerReadHeaderTimeout time.Duration
	ServerReadTimeout       time.Duration
	ServerWriteTimeout      time.Duration
	ServerIdleTimeout       time.Duration

	// How long a shutdown waits for in-flight requests to finish before giving
	// up. Money-moving requests must be allowed to complete (RUN-02).
	ServerShutdownTimeout time.Duration

	// How often expired token_blacklist and rate_limits rows are swept (RUN-06).
	//
	// Daily, not hourly. Both tables are write-heavy and nothing else deletes
	// from them, so they do have to be swept — but rows that expired eleven
	// hours ago are harming nothing, and every tick is a database wake that
	// keeps a suspended compute up for its whole idle timer. Twenty-four wakes a
	// day to delete a handful of expired rate-limit buckets is the shape of
	// waste that is invisible until a bill arrives.
	CleanupInterval time.Duration

	// MetricsRefreshInterval is the **floor** between two refreshes of the
	// business gauges, not a tick. See metrics.StartBusinessRefresh: they are
	// recomputed lazily, when /metrics is actually scraped and the numbers are
	// older than this. Five aggregate queries every sixty seconds, for ever, to
	// serve sixty scrapes a month is what this replaced.
	MetricsRefreshInterval time.Duration

	// ReconcileInterval controls how often the ledger is summed and compared to
	// the stored balances (WO-82).
	//
	// **Daily since 2026-08-27, by the owner's ruling.** It was hourly, and the
	// pass is a handful of full-table aggregates — which is cheap in query terms
	// and expensive in the only term that is actually billed here, namely
	// keeping the database awake. The question it answers is "do the totals
	// still agree", drift is corrected by a human appending a posting rather
	// than by anything automatic (ADR-027), and the paper passbook is the
	// reconciling record besides. A day's latency on a check nobody acts on
	// within the hour changes nothing operationally.
	//
	// Set RECONCILE_INTERVAL to 0 to switch it off, which should only ever be a
	// temporary measure while a known drift is being corrected by hand.
	ReconcileInterval time.Duration

	// RetentionSweepInterval controls how often rejected applications past the
	// retention window have their identity data cleared (WO-93, ADR-033). Daily:
	// the window is a year, so the resolution of the sweep is irrelevant to the
	// policy and a tighter tick would only add load.
	RetentionSweepInterval time.Duration
}

func Load() Config {
	// Load environment from .env files
	loadEnvironment()

	// Validate JWT_SECRET - critical security requirement
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" || jwtSecret == "change-this-in-production" {
		slog.Error("JWT_SECRET must be set to a secure value of at least 32 characters")
		os.Exit(1)
	}
	if len(jwtSecret) < 32 {
		slog.Error("JWT_SECRET must be at least 32 characters long for adequate security", "length", len(jwtSecret))
		os.Exit(1)
	}

	return Config{
		Port:                    getEnv("API_PORT", getEnv("PORT", "8081")),
		DatabaseURL:             getEnv("DATABASE_URL", ""),
		JWTSecret:               jwtSecret,
		JWTExpiry:               getEnvInt64("JWT_EXPIRY_SECONDS", 86400),
		CORSOrigins:             parseCSV(getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")),
		EnableHSTS:              getEnvBool("ENABLE_HSTS", false),
		RateLimitRequests:       getEnvInt("RATE_LIMIT_REQUESTS", 60),
		RateLimitWindow:         getEnvDuration("RATE_LIMIT_WINDOW", 1*time.Minute),
		TrustedProxies:          getEnvInt("TRUSTED_PROXIES", 0),
		TrustCloudflareClientIP: getEnvBool("TRUST_CLOUDFLARE_CLIENT_IP", false),
		BrevoAPIKey:             getFirstNonEmpty(getEnv("BREVO_API_KEY", ""), getEnv("SENDINBLUE_API_KEY", "")),
		BrevoAPIURL:             getFirstNonEmpty(getEnv("BREVO_API_URL", ""), getEnv("BREVO_BASE_URL", ""), "https://api.brevo.com/v3"),
		EmailFrom:               getFirstNonEmpty(getEnv("EMAIL_FROM", ""), getEnv("BREVO_SENDER_EMAIL", ""), getEnv("EMAIL_SENDER", ""), getEnv("FROM_EMAIL", ""), "info@hasnahenafoundation.com"),
		EmailFromName:           getFirstNonEmpty(getEnv("EMAIL_FROM_NAME", ""), getEnv("BREVO_SENDER_NAME", ""), "Hasnahena Foundation"),
		AppURL:                  resolvePublicAppURL(),
		LogLevel:                getEnv("LOG_LEVEL", "info"),
		MetricsToken:            getEnv("METRICS_TOKEN", ""),
		Environment:             getFirstNonEmpty(getEnv("ENVIRONMENT", ""), getEnv("RENDER_SERVICE_NAME", ""), "development"),
		// WO-75. 25 against Neon, and the question that order asked was whether
		// those two numbers are compatible. They are, and the reason is stronger
		// than the arithmetic:
		//
		// The API connects through Neon's *pooled* endpoint — the `-pooler`
		// host, which .env.render.example requires — so what 25 is measured
		// against is PgBouncer's client limit, which is in the thousands, not
		// the compute's own `max_connections`. One Render instance holds at most
		// 25 of them.
		//
		// More usefully: pool size here is a throughput setting, not a
		// correctness one, and that was verified rather than assumed. The whole
		// integration suite — including TestConcurrentDepositsAllLand, which
		// drives 20 simultaneous deposits at one member — passes with
		// `pool_max_conns=2`. It can only do that because no repository call
		// ever holds two connections at once, which is exactly the property
		// ADR-017 exists to preserve: read config inside the transaction with
		// the `…Tx` reader, never from the pool. A call that took a second
		// connection would deadlock at 2 and pass at 25, so that run is the
		// cheapest available check on ADR-017 still holding.
		//
		// Lowering this is therefore safe and only costs latency under load.
		// Raising it past what Neon's plan allows is the failure worth
		// avoiding, and it is a deploy-time decision, not a code one.
		DBMaxConns: int32(getEnvInt("DB_MAX_CONNS", 25)),
		// Zero, so the pool can empty and the database can suspend. See the
		// note on the struct field — this one number was the whole bill.
		DBMinConns: int32(getEnvInt("DB_MIN_CONNS", 0)),
		// Shorter than the host's suspend timer, so connections are gone before
		// it would have started rather than continually resetting it.
		DBMaxConnIdleTime:   getEnvDuration("DB_MAX_CONN_IDLE_TIME", 60*time.Second),
		DBMaxConnLifetime:   getEnvDuration("DB_MAX_CONN_LIFETIME", 30*time.Minute),
		DBHealthCheckPeriod: getEnvDuration("DB_HEALTH_CHECK_PERIOD", 5*time.Minute),

		ServerReadHeaderTimeout: getEnvDuration("SERVER_READ_HEADER_TIMEOUT", 10*time.Second),
		ServerReadTimeout:       getEnvDuration("SERVER_READ_TIMEOUT", 30*time.Second),
		// Generous because report and document endpoints do real work. The SSE
		// stream clears this deadline for itself; see DashboardHandler.SupportStream.
		ServerWriteTimeout:     getEnvDuration("SERVER_WRITE_TIMEOUT", 60*time.Second),
		ServerIdleTimeout:      getEnvDuration("SERVER_IDLE_TIMEOUT", 120*time.Second),
		ServerShutdownTimeout:  getEnvDuration("SERVER_SHUTDOWN_TIMEOUT", 30*time.Second),
		CleanupInterval:        getEnvDuration("CLEANUP_INTERVAL", 24*time.Hour),
		MetricsRefreshInterval: getEnvDuration("METRICS_REFRESH_INTERVAL", 10*time.Minute),
		ReconcileInterval:      getEnvDuration("RECONCILE_INTERVAL", 24*time.Hour),
		RetentionSweepInterval: getEnvDuration("RETENTION_SWEEP_INTERVAL", 24*time.Hour),
	}
}

// loadEnvironment loads .env files from the project root
func loadEnvironment() {
	wd, err := os.Getwd()
	if err != nil {
		return
	}

	// Look for .env files in various locations
	paths := []string{
		filepath.Join(wd, ".env"),
		filepath.Join(wd, ".env.local"),
		filepath.Join(wd, "..", ".env"),
		filepath.Join(wd, "..", ".env.local"),
		filepath.Join(wd, "..", "..", ".env"),
		filepath.Join(wd, "..", "..", ".env.local"),
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			// Best-effort by design — a missing or malformed .env is normal in
			// production, where the values come from Render and Vercel instead.
			// It is reported rather than discarded, because a *present* file
			// that fails to parse silently starts the server on defaults, and
			// "why is it using the wrong database" is an expensive question.
			if err := loadEnvFile(p); err != nil {
				slog.Warn("config: ignoring env file", "path", p, "error", err)
			}
		}
	}
}

func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }() // read-only; nothing to report and nowhere to report it

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		// Do not overwrite values that were already set
		if os.Getenv(key) != "" {
			continue
		}

		raw := strings.TrimSpace(parts[1])
		val := normalizeEnvValue(raw)
		// Checked: a failed Setenv leaves the process running on a default while
		// the file on disk says otherwise — the same silent-misconfiguration
		// shape as the parse failure above.
		if err := os.Setenv(key, val); err != nil {
			return fmt.Errorf("set %s: %w", key, err)
		}
	}

	return scanner.Err()
}

func normalizeEnvValue(raw string) string {
	if raw == "" {
		return raw
	}

	// Handle quoted values
	if (strings.HasPrefix(raw, `"`) && strings.HasSuffix(raw, `"`)) ||
		(strings.HasPrefix(raw, `'`) && strings.HasSuffix(raw, `'`)) {
		return raw[1 : len(raw)-1]
	}

	// Support unquoted values with trailing inline comments
	if idx := strings.Index(raw, " #"); idx >= 0 {
		return strings.TrimSpace(raw[:idx])
	}

	return raw
}

func getEnv(key string, fallback string) string {
	value := normalizeEnvValue(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value
}

// getEnvBool accepts the spellings an operator actually types in a dashboard.
// Anything unrecognised falls back rather than guessing — for ENABLE_HSTS a
// wrong guess is a two-year commitment in every visitor's browser.
func getEnvBool(key string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func getEnvInt64(key string, fallback int64) int64 {
	value := normalizeEnvValue(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvInt(key string, fallback int) int {
	value := normalizeEnvValue(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	value := normalizeEnvValue(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseCSV(value string) []string {
	parts := strings.Split(value, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

func getFirstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func resolvePublicAppURL() string {
	candidates := []string{
		getEnv("EMAIL_APP_URL", ""),
		getEnv("PRODUCTION_APP_URL", ""),
		getEnv("FRONTEND_URL", ""),
		getEnv("WEB_URL", ""),
		getEnv("SITE_URL", ""),
		getEnv("NEXT_PUBLIC_SITE_URL", ""),
		getEnv("PUBLIC_URL", ""),
		getEnv("NEXT_PUBLIC_APP_URL", ""),
		getEnv("APP_URL", ""),
		getEnv("WEBSITE_URL", ""),
		getEnv("PUBLIC_WEB_URL", ""),
		getEnv("VERCEL_PROJECT_PRODUCTION_URL", ""),
		getEnv("VERCEL_URL", ""),
		getEnv("RENDER_EXTERNAL_URL", ""),
	}

	for _, candidate := range candidates {
		if normalized := normalizePublicURL(candidate); normalized != "" {
			return normalized
		}
	}

	return "https://www.hasnahenafoundation.com"
}

func normalizePublicURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	withScheme := trimmed
	if !strings.HasPrefix(strings.ToLower(withScheme), "http://") && !strings.HasPrefix(strings.ToLower(withScheme), "https://") {
		withScheme = "https://" + withScheme
	}

	parsed, err := url.Parse(withScheme)
	if err != nil || parsed.Host == "" {
		return ""
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "" || host == "localhost" || host == "127.0.0.1" || strings.HasSuffix(host, ".local") {
		return ""
	}

	return "https://" + parsed.Host
}
