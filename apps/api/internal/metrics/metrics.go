// Package metrics exposes Prometheus instrumentation: technical metrics
// (requests, latency, pool) and business metrics (OBS-02) such as postings
// stuck unconfirmed — a member waiting on money raises no error anywhere.
package metrics

import (
	"context"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Registry is private, so a duplicate registration panics in tests.
var Registry = prometheus.NewRegistry()

var (
	httpRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "hasnahena_http_requests_total",
			Help: "HTTP requests by method, route template and status class.",
		},
		// The route PATTERN, never the raw path (IDs = cardinality and privacy).
		[]string{"method", "route", "status"},
	)

	httpDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "hasnahena_http_request_duration_seconds",
			Help: "HTTP request latency by method and route template.",
			// A posting is several Neon round trips: 50ms–2s is the interesting range.
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10},
		},
		[]string{"method", "route"},
	)

	httpInFlight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_http_requests_in_flight",
		Help: "Requests currently being served.",
	})

	// Ledger reconciliation (WO-82), set by the reconciliation loop. `check`
	// is from repositories.AllChecks.
	ledgerDriftRows = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "hasnahena_ledger_drift_rows",
			Help: "Accounts, loans or transactions whose stored value disagrees with the ledger.",
		},
		[]string{"check"},
	)
	ledgerDriftTaka = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "hasnahena_ledger_drift_taka",
			Help: "Net signed difference, in whole taka, between stored balances and what the transactions sum to.",
		},
		[]string{"check"},
	)
	// Alert when this stops moving: zero drift also looks like a job that never ran.
	ledgerLastReconciled = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_ledger_reconciled_timestamp_seconds",
		Help: "Unix time of the last reconciliation pass that completed without an error.",
	})
	ledgerReconcileFailures = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "hasnahena_ledger_reconcile_failures_total",
		Help: "Reconciliation passes that could not complete.",
	})

	// Business gauges, refreshed lazily — see businessRefresher.
	unconfirmedOver48h = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_transactions_unconfirmed_over_48h",
		Help: "Postings awaiting member confirmation for more than 48 hours.",
	})
	openDisputes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_transactions_disputed_open",
		Help: "Transactions a member has disputed and nobody has resolved.",
	})
	pendingRequests = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_transactions_pending",
		Help: "Member requests not yet processed by a worker.",
	})
	postedToday = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "hasnahena_transactions_posted_today",
			Help: "Transactions posted since midnight UTC, by type.",
		},
		[]string{"type"},
	)
	activeLoans = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_loans_active",
		Help: "Loans currently outstanding.",
	})
	businessRefreshFailures = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "hasnahena_business_metrics_refresh_failures_total",
		Help: "Failed refreshes of the business gauges. Non-zero means the gauges are stale.",
	})
	// Detects a refresher that died and froze the gauges.
	businessLastRefresh = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_business_metrics_last_refresh_timestamp_seconds",
		Help: "Unix time of the last successful business-gauge refresh.",
	})
)

var registerOnce sync.Once

// Register wires every collector into Registry. Safe to call more than once.
func Register(pool *pgxpool.Pool) {
	registerOnce.Do(func() {
		Registry.MustRegister(
			httpRequests, httpDuration, httpInFlight,
			unconfirmedOver48h, openDisputes, pendingRequests, postedToday, activeLoans,
			businessRefreshFailures, businessLastRefresh,
			ledgerDriftRows, ledgerDriftTaka, ledgerLastReconciled, ledgerReconcileFailures,
			collectors.NewGoCollector(),
			collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		)
		if pool != nil {
			Registry.MustRegister(newPoolCollector(pool))
		}
	})
}

// ObserveRequest records one finished request (from the logging middleware).
func ObserveRequest(method, route string, status int, duration time.Duration) {
	if route == "" {
		// 404s and scanners share one label.
		route = "unmatched"
	}
	httpRequests.WithLabelValues(method, route, strconv.Itoa(status)).Inc()
	httpDuration.WithLabelValues(method, route).Observe(duration.Seconds())
}

// IncInFlight and DecInFlight bracket a request.
func IncInFlight() { httpInFlight.Inc() }
func DecInFlight() { httpInFlight.Dec() }

// poolCollector reports pgxpool saturation at scrape time (in-memory read).
type poolCollector struct {
	pool *pgxpool.Pool

	total       *prometheus.Desc
	acquired    *prometheus.Desc
	idle        *prometheus.Desc
	max         *prometheus.Desc
	waitCount   *prometheus.Desc
	waitSeconds *prometheus.Desc
}

func newPoolCollector(pool *pgxpool.Pool) *poolCollector {
	return &poolCollector{
		pool:        pool,
		total:       prometheus.NewDesc("hasnahena_db_pool_connections_total", "Connections currently open.", nil, nil),
		acquired:    prometheus.NewDesc("hasnahena_db_pool_connections_acquired", "Connections currently checked out.", nil, nil),
		idle:        prometheus.NewDesc("hasnahena_db_pool_connections_idle", "Connections open and idle.", nil, nil),
		max:         prometheus.NewDesc("hasnahena_db_pool_connections_max", "Configured pool ceiling.", nil, nil),
		waitCount:   prometheus.NewDesc("hasnahena_db_pool_acquire_waits_total", "Acquires that had to wait for a free connection.", nil, nil),
		waitSeconds: prometheus.NewDesc("hasnahena_db_pool_acquire_wait_seconds_total", "Cumulative time spent waiting to acquire.", nil, nil),
	}
}

func (c *poolCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.total
	ch <- c.acquired
	ch <- c.idle
	ch <- c.max
	ch <- c.waitCount
	ch <- c.waitSeconds
}

func (c *poolCollector) Collect(ch chan<- prometheus.Metric) {
	s := c.pool.Stat()
	ch <- prometheus.MustNewConstMetric(c.total, prometheus.GaugeValue, float64(s.TotalConns()))
	ch <- prometheus.MustNewConstMetric(c.acquired, prometheus.GaugeValue, float64(s.AcquiredConns()))
	ch <- prometheus.MustNewConstMetric(c.idle, prometheus.GaugeValue, float64(s.IdleConns()))
	ch <- prometheus.MustNewConstMetric(c.max, prometheus.GaugeValue, float64(s.MaxConns()))
	ch <- prometheus.MustNewConstMetric(c.waitCount, prometheus.CounterValue, float64(s.EmptyAcquireCount()))
	ch <- prometheus.MustNewConstMetric(c.waitSeconds, prometheus.CounterValue, s.AcquireDuration().Seconds())
}

// businessSnapshot is one read of the numbers that describe the cooperative.
type businessSnapshot struct {
	UnconfirmedOver48h int64
	OpenDisputes       int64
	Pending            int64
	ActiveLoans        int64
	PostedToday        map[string]int64
}

// businessRefresher recomputes the business gauges lazily on scrape, at most
// once per minGap (a floor). A ticker would keep a scale-to-zero database
// awake for a twice-daily scrape. Also refreshed once at startup.
type businessRefresher struct {
	pool   *pgxpool.Pool
	minGap time.Duration

	mu   sync.Mutex
	last time.Time
}

var business struct {
	mu sync.Mutex
	r  *businessRefresher
}

// RefreshBusinessIfStale is called by the /metrics handler before writing.
func RefreshBusinessIfStale(ctx context.Context) {
	business.mu.Lock()
	r := business.r
	business.mu.Unlock()
	if r == nil {
		return
	}

	r.mu.Lock()
	if !r.last.IsZero() && time.Since(r.last) < r.minGap {
		r.mu.Unlock()
		return
	}
	// Stamped before querying so two concurrent scrapes don't both refresh.
	r.last = time.Now()
	r.mu.Unlock()

	r.refresh(ctx)
}

func (r *businessRefresher) refresh(ctx context.Context) {
	refreshBusinessSnapshot(ctx, r.pool)
}

// StartBusinessRefresh registers the pool and populates the gauges once.
// interval is the floor between refreshes, not a tick.
func StartBusinessRefresh(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	if pool == nil {
		return
	}
	if interval <= 0 {
		interval = 10 * time.Minute
	}

	business.mu.Lock()
	business.r = &businessRefresher{pool: pool, minGap: interval}
	business.mu.Unlock()

	// Populate immediately; an empty /metrics after a deploy is confusing.
	go func() {
		refreshBusinessSnapshot(ctx, pool)
		business.mu.Lock()
		if business.r != nil {
			business.r.mu.Lock()
			business.r.last = time.Now()
			business.r.mu.Unlock()
		}
		business.mu.Unlock()
	}()
}

func refreshBusinessSnapshot(ctx context.Context, pool *pgxpool.Pool) {
	refresh := func() {
		queryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()

		snap, err := readBusinessSnapshot(queryCtx, pool)
		if err != nil {
			businessRefreshFailures.Inc()
			slog.Warn("business metrics refresh failed", "error", err)
			return
		}

		unconfirmedOver48h.Set(float64(snap.UnconfirmedOver48h))
		openDisputes.Set(float64(snap.OpenDisputes))
		pendingRequests.Set(float64(snap.Pending))
		activeLoans.Set(float64(snap.ActiveLoans))
		for _, t := range []string{"DEPOSIT", "WITHDRAWAL", "LOAN_DISBURSEMENT", "LOAN_REPAYMENT"} {
			postedToday.WithLabelValues(t).Set(float64(snap.PostedToday[t]))
		}
		businessLastRefresh.Set(float64(time.Now().Unix()))
	}

	refresh()
}

func readBusinessSnapshot(ctx context.Context, pool *pgxpool.Pool) (businessSnapshot, error) {
	snap := businessSnapshot{PostedToday: map[string]int64{}}

	// PROCESSED = posted by a worker, awaiting member confirmation.
	err := pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (
				WHERE status = 'PROCESSED'
				  AND COALESCE("processedAt", "createdAt") < NOW() - INTERVAL '48 hours'
			),
			COUNT(*) FILTER (WHERE status = 'DISPUTED'),
			COUNT(*) FILTER (WHERE status = 'PENDING')
		FROM transactions
	`).Scan(&snap.UnconfirmedOver48h, &snap.OpenDisputes, &snap.Pending)
	if err != nil {
		return snap, err
	}

	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM loans WHERE status = 'ACTIVE'
	`).Scan(&snap.ActiveLoans); err != nil {
		return snap, err
	}

	rows, err := pool.Query(ctx, `
		SELECT type::text, COUNT(*)
		FROM transactions
		WHERE "createdAt" >= date_trunc('day', NOW())
		GROUP BY type
	`)
	if err != nil {
		return snap, err
	}
	defer rows.Close()

	for rows.Next() {
		var t string
		var n int64
		if err := rows.Scan(&t, &n); err != nil {
			return snap, err
		}
		snap.PostedToday[t] = n
	}
	return snap, rows.Err()
}

// SetLedgerDrift publishes one pass. `checks` must be every check that ran,
// or a corrected drift keeps alerting.
func SetLedgerDrift(rows, taka map[string]int64, checks []string) {
	for _, check := range checks {
		ledgerDriftRows.WithLabelValues(check).Set(float64(rows[check]))
		ledgerDriftTaka.WithLabelValues(check).Set(float64(taka[check]))
	}
	ledgerLastReconciled.SetToCurrentTime()
}

// ObserveLedgerReconcileFailure: drift gauges are left alone — a failed pass knows nothing.
func ObserveLedgerReconcileFailure() { ledgerReconcileFailures.Inc() }
