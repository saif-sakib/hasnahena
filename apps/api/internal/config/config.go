package config

import (
	"bufio"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	JWTExpiry           int64
	CORSOrigins         []string
	EmailHost           string
	EmailPort           int
	EmailUser           string
	EmailPass           string
	EmailFrom           string
	AppURL              string
	DBMaxConns          int32
	DBMinConns          int32
	DBMaxConnIdleTime   time.Duration
	DBMaxConnLifetime   time.Duration
	DBHealthCheckPeriod time.Duration
}

func Load() Config {
	// Load environment from .env files
	loadEnvironment()

	// Validate JWT_SECRET - critical security requirement
	jwtSecret := getEnv("JWT_SECRET", "")
	if jwtSecret == "" || jwtSecret == "change-this-in-production" {
		log.Fatal("SECURITY ERROR: JWT_SECRET environment variable must be set to a secure value (minimum 32 characters)")
	}
	if len(jwtSecret) < 32 {
		log.Fatal("SECURITY ERROR: JWT_SECRET must be at least 32 characters long for adequate security")
	}

	emailHost, emailPort, emailUser, emailPass := resolveSMTPConfig()

	return Config{
		Port:                getEnv("API_PORT", getEnv("PORT", "8081")),
		DatabaseURL:         getEnv("DATABASE_URL", ""),
		JWTSecret:           jwtSecret,
		JWTExpiry:           getEnvInt64("JWT_EXPIRY_SECONDS", 86400),
		CORSOrigins:         parseCSV(getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")),
		EmailHost:           emailHost,
		EmailPort:           emailPort,
		EmailUser:           emailUser,
		EmailPass:           emailPass,
		EmailFrom:           getFirstNonEmpty(getEnv("EMAIL_FROM", ""), getEnv("EMAIL_SENDER", ""), getEnv("SMTP_FROM", ""), getEnv("MAIL_FROM", ""), getEnv("FROM_EMAIL", "")),
		AppURL:              resolvePublicAppURL(),
		DBMaxConns:          int32(getEnvInt("DB_MAX_CONNS", 25)),
		DBMinConns:          int32(getEnvInt("DB_MIN_CONNS", 2)),
		DBMaxConnIdleTime:   getEnvDuration("DB_MAX_CONN_IDLE_TIME", 5*time.Minute),
		DBMaxConnLifetime:   getEnvDuration("DB_MAX_CONN_LIFETIME", 30*time.Minute),
		DBHealthCheckPeriod: getEnvDuration("DB_HEALTH_CHECK_PERIOD", 1*time.Minute),
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
			loadEnvFile(p)
		}
	}
}

func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

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
		os.Setenv(key, val)
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

func getFirstValidInt(fallback int, values ...string) int {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		parsed, err := strconv.Atoi(trimmed)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func resolveSMTPConfig() (host string, port int, user string, pass string) {
	parsedHost, parsedPort, parsedUser, parsedPass := parseSMTPURL(
		getFirstNonEmpty(getEnv("SMTP_URL", ""), getEnv("EMAIL_URL", ""), getEnv("MAIL_URL", "")),
	)

	parsedPortCandidate := ""
	if parsedPort > 0 {
		parsedPortCandidate = strconv.Itoa(parsedPort)
	}

	host = getFirstNonEmpty(
		getEnv("EMAIL_HOST", ""),
		getEnv("EMAIL_SERVER", ""),
		getEnv("SMTP_HOST", ""),
		getEnv("SMTP_SERVER", ""),
		getEnv("MAIL_HOST", ""),
		parsedHost,
	)

	port = getFirstValidInt(
		587,
		getEnv("EMAIL_PORT", ""),
		getEnv("SMTP_PORT", ""),
		getEnv("MAIL_PORT", ""),
		parsedPortCandidate,
	)

	user = getFirstNonEmpty(
		getEnv("EMAIL_USER", ""),
		getEnv("EMAIL_USERNAME", ""),
		getEnv("SMTP_USER", ""),
		getEnv("SMTP_USERNAME", ""),
		getEnv("MAIL_USER", ""),
		getEnv("MAIL_USERNAME", ""),
		parsedUser,
	)

	pass = getFirstNonEmpty(
		getEnv("EMAIL_PASS", ""),
		getEnv("EMAIL_PASSWORD", ""),
		getEnv("SMTP_PASS", ""),
		getEnv("SMTP_PASSWORD", ""),
		getEnv("MAIL_PASS", ""),
		getEnv("MAIL_PASSWORD", ""),
		parsedPass,
	)

	return host, port, user, pass
}

func parseSMTPURL(raw string) (host string, port int, user string, pass string) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", 0, "", ""
	}

	lower := strings.ToLower(trimmed)
	if !strings.HasPrefix(lower, "smtp://") && !strings.HasPrefix(lower, "smtps://") {
		trimmed = "smtp://" + trimmed
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Hostname() == "" {
		return "", 0, "", ""
	}

	host = parsed.Hostname()
	if strings.EqualFold(parsed.Scheme, "smtps") {
		port = 465
	} else {
		port = 587
	}

	if parsed.Port() != "" {
		if p, err := strconv.Atoi(parsed.Port()); err == nil && p > 0 {
			port = p
		}
	}

	if parsed.User != nil {
		user = strings.TrimSpace(parsed.User.Username())
		if parsedPassword, ok := parsed.User.Password(); ok {
			pass = parsedPassword
		}
	}

	return host, port, user, pass
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
