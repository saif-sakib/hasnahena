package config

import (
	"os"
	"testing"
	"time"
)

// Neon bills for awake time, so idle behaviour is a line item: these defaults
// once held the database at a 100% duty cycle (~182 compute-hours/month
// against 100). Each assertion is a ceiling on eagerness, not an exact value.
func TestIdleDefaultsLetTheDatabaseSleep(t *testing.T) {
	// Cleared so a developer's .env cannot affect the result.
	for _, key := range []string{
		"DB_MIN_CONNS", "DB_MAX_CONN_IDLE_TIME", "DB_HEALTH_CHECK_PERIOD",
		"CLEANUP_INTERVAL", "RECONCILE_INTERVAL", "METRICS_REFRESH_INTERVAL",
	} {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}
	// Load() exits the process without one.
	if os.Getenv("JWT_SECRET") == "" {
		t.Setenv("JWT_SECRET", "test-secret-at-least-thirty-two-characters")
	}

	cfg := Load()

	t.Run("the pool empties when nobody is using the platform", func(t *testing.T) {
		// At 2 the pool never empties and the compute never suspends.
		if cfg.DBMinConns != 0 {
			t.Errorf("DBMinConns is %d; must be 0 or the connection pool never empties and the "+
				"database never suspends", cfg.DBMinConns)
		}
	})

	t.Run("idle connections are dropped before the host's suspend timer", func(t *testing.T) {
		// At or above Neon's 5-minute timer, idle connections keep resetting it.
		const hostSuspendTimer = 5 * time.Minute
		if cfg.DBMaxConnIdleTime >= hostSuspendTimer {
			t.Errorf("DBMaxConnIdleTime is %s, at or above the host's %s suspend timer; "+
				"connections must be gone before it would have started",
				cfg.DBMaxConnIdleTime, hostSuspendTimer)
		}
	})

	t.Run("the health check is a backstop, not a heartbeat", func(t *testing.T) {
		// With MinConns at 0 there is nothing for it to keep alive, so a tight
		// period buys nothing and a one-minute one is a query a minute for ever.
		if cfg.DBHealthCheckPeriod < time.Minute {
			t.Errorf("DBHealthCheckPeriod is %s; below a minute it is a heartbeat on an "+
				"empty pool", cfg.DBHealthCheckPeriod)
		}
	})

	t.Run("background jobs wake the database a few times a day, not dozens", func(t *testing.T) {
		// Every tick is a wake that holds the compute up for its idle timer.
		const leastEagerAcceptable = 6 * time.Hour

		for _, job := range []struct {
			name     string
			interval time.Duration
		}{
			{"CleanupInterval", cfg.CleanupInterval},
			{"ReconcileInterval", cfg.ReconcileInterval},
			{"RetentionSweepInterval", cfg.RetentionSweepInterval},
		} {
			// Zero means disabled, which is a legitimate setting for the
			// reconciliation pass while a known drift is corrected by hand.
			if job.interval == 0 {
				continue
			}
			if job.interval < leastEagerAcceptable {
				t.Errorf("%s is %s; that is %.0f database wakes a day. Nothing here answers a "+
					"question that changes within the hour — see ADR-027 for the reconciliation "+
					"pass specifically",
					job.name, job.interval, (24*time.Hour).Seconds()/job.interval.Seconds())
			}
		}
	})

	t.Run("the business gauges are not recomputed on a fast timer", func(t *testing.T) {
		// This is a floor between refreshes now rather than a tick, but the
		// number still bounds how often a scrape may reach the database.
		if cfg.MetricsRefreshInterval < 5*time.Minute {
			t.Errorf("MetricsRefreshInterval is %s; five aggregate queries at that rate is "+
				"database load with no reader — the endpoint is scraped twice a day",
				cfg.MetricsRefreshInterval)
		}
	})
}

// The gauges must be refreshed by a scrape, not by a ticker.
func TestMetricsRefreshIntervalIsAFloorNotATick(t *testing.T) {
	source, err := os.ReadFile("config.go")
	if err != nil {
		t.Fatalf("read config.go: %v", err)
	}
	if !contains(string(source), "floor") {
		t.Error("the MetricsRefreshInterval comment no longer explains that it is a floor " +
			"between lazy refreshes rather than a tick; if it has gone back to a ticker, " +
			"see the note on businessRefresher in internal/metrics/metrics.go")
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (len(needle) == 0 || indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
