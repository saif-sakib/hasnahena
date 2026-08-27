package config

import (
	"os"
	"testing"
	"time"
)

// The database this platform runs on suspends its compute when nothing is
// connected, and bills for the time it is awake. That makes **the idle
// behaviour of this process a line item**, not a performance detail, and it is
// the kind of thing that is invisible in review: every value guarded here is
// individually defensible and together they held a scale-to-zero database at a
// 100% duty cycle for every hour of every night.
//
// What that cost, measured 2026-08-27: roughly 182 compute-hours a month
// against an allowance of 100, on a platform nobody was using for most of them.
//
// Each assertion below is a *ceiling on eagerness*, never an exact value — an
// operator lowering an interval further, or an environment variable overriding
// one for a good reason, is fine. What must not happen again is a default that
// keeps the database awake around the clock.
func TestIdleDefaultsLetTheDatabaseSleep(t *testing.T) {
	// Load() reads the environment and the .env files. A developer's own file
	// must not be able to make this pass or fail, so the variables under test
	// are cleared for the duration.
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
		// This single number was the whole bill. At 2, pgxpool holds two
		// connections open for the life of the process and the health check
		// keeps them alive — so the compute has no idle moment to suspend in,
		// on any night, in any week where nobody logs in.
		if cfg.DBMinConns != 0 {
			t.Errorf("DBMinConns is %d; must be 0 or the connection pool never empties and the "+
				"database never suspends", cfg.DBMinConns)
		}
	})

	t.Run("idle connections are dropped before the host's suspend timer", func(t *testing.T) {
		// Neon suspends after five minutes of inactivity. An idle timeout at or
		// above that keeps resetting the timer instead of letting it expire,
		// which is the same failure as MinConns with a slower fuse.
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
		// Every tick is a wake, and a wake holds the compute up for at least the
		// host's whole idle timer whatever the query cost. Twenty-four wakes a
		// day to delete expired rate-limit buckets is two hours of billed
		// compute for work that could have waited.
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
//
// Stated as a test because the ticker is the obvious shape and the reasoning
// against it is not: a ticker ties database load to nothing at all, so it runs
// at full rate whether anybody is watching or not. `/metrics` here is read
// twice a day by one GitHub Actions workflow.
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
