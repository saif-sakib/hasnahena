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
	BrevoAPIKey         string
	BrevoAPIURL         string
	EmailFrom           string
	EmailFromName       string
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

	return Config{
		Port:                getEnv("API_PORT", getEnv("PORT", "8081")),
		DatabaseURL:         getEnv("DATABASE_URL", ""),
		JWTSecret:           jwtSecret,
		JWTExpiry:           getEnvInt64("JWT_EXPIRY_SECONDS", 86400),
		CORSOrigins:         parseCSV(getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")),
		BrevoAPIKey:         getFirstNonEmpty(getEnv("BREVO_API_KEY", ""), getEnv("SENDINBLUE_API_KEY", "")),
		BrevoAPIURL:         getFirstNonEmpty(getEnv("BREVO_API_URL", ""), getEnv("BREVO_BASE_URL", ""), "https://api.brevo.com/v3"),
		EmailFrom:           getFirstNonEmpty(getEnv("EMAIL_FROM", ""), getEnv("BREVO_SENDER_EMAIL", ""), getEnv("EMAIL_SENDER", ""), getEnv("FROM_EMAIL", ""), "info@hasnahenafoundation.com"),
		EmailFromName:       getFirstNonEmpty(getEnv("EMAIL_FROM_NAME", ""), getEnv("BREVO_SENDER_NAME", ""), "Hasnahena Foundation"),
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
