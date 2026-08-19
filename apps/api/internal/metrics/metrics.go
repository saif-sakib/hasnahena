// Package metrics exposes the API's Prometheus instrumentation.
//
// Two kinds of metric live here and they answer different questions.
//
// Technical metrics — request rate, latency, status codes, pool saturation —
// answer "is the process healthy". They are cheap, recorded inline, and mostly
// tell you about a problem you could also have guessed at from the logs.
//
// Business metrics answer "is the *cooperative* healthy", and those are the
// ones worth waking up for. A transaction that has sat unconfirmed for three
// days is not an error: nothing failed, no status code was non-2xx, and no
// exception was thrown. A member is simply waiting on money and nobody knows.
// That is invisible to every technical signal here, which is precisely why
// OBS-02 exists.
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

// Registry is this service's collector registry.
//
// A private registry rather than prometheus.DefaultRegisterer: it keeps the
// exposition to metrics this code actually declares, and makes a duplicate
// registration a startup panic in tests rather than a silent global collision.
var Registry = prometheus.NewRegistry()

var (
	httpRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "hasnahena_http_requests_total",
			Help: "HTTP requests by method, route template and status class.",
		},
		// `route` is the chi route *pattern*, never the raw path. The raw path
		// contains member and loan IDs, and a label per member is both a
		// cardinality explosion and a privacy leak into a metrics endpoint.
		[]string{"method", "route", "status"},
	)

	httpDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name: "hasnahena_http_request_duration_seconds",
			Help: "HTTP request latency by method and route template.",
			// Tuned for this service: a money posting is several round trips to
			// Neon, so the interesting range is 50ms–2s, not the default's
			// sub-10ms buckets.
			Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10},
		},
		[]string{"method", "route"},
	)

	httpInFlight = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_http_requests_in_flight",
		Help: "Requests currently being served.",
	})

	// Ledger reconciliation — WO-82. Set by the reconciliation loop, not by a
	// scrape: the pass is a handful of full-table aggregates and running it on
	// every Prometheus scrape would be a self-inflicted load test.
	//
	// `check` is the invariant that disagreed — a fixed vocabulary from
	// repositories.AllChecks, so an alert can name the one that fired.
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
	// The one to alert on when it *stops* moving. A drift gauge reading zero is
	// indistinguishable from a job that has not run since the last deploy, and
	// the second is the more likely failure.
	ledgerLastReconciled = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "hasnahena_ledger_reconciled_timestamp_seconds",
		Help: "Unix time of the last reconciliation pass that completed without an error.",
	})
	ledgerReconcileFailures = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "hasnahena_ledger_reconcile_failures_total",
		Help: "Reconciliation passes that could not complete.",
	})

	// Business gauges. Refreshed on a ticker rather than computed per scrape —
	// see refreshLoop.
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
	// Without this, a refresh loop that quietly dies leaves every business gauge
	// frozen at its last good value — which looks exactly like a calm system.
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

// ObserveRequest records one finished request. Called from the logging
// middleware, which already computes all three values.
func ObserveRequest(method, route string, status int, duration time.Duration) {
	if route == "" {
		// An unmatched path — 404s, scanners, probes. Bucketing them together
		// keeps a bot sweeping for /wp-admin from minting a label per URL.
		route = "unmatched"
	}
	httpRequests.WithLabelValues(method, route, strconv.Itoa(status)).Inc()
	httpDuration.WithLabelValues(method, route).Observe(duration.Seconds())
}

// IncInFlight and DecInFlight bracket a request.
func IncInFlight() { httpInFlight.Inc() }
func DecInFlight() { httpInFlight.Dec() }

// poolCollector reports pgxpool saturation at scrape time.
//
// Implemented as a Collector rather than gauges on a ticker because
// pgxpool.Stat() is an in-memory read with no database round trip, so there is
// nothing to amortise — and a value read at scrape time cannot be stale.
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

// StartBusinessRefresh keeps the business gauges current until ctx is done.
//
// On a ticker rather than per scrape, deliberately: these are five aggregate
// queries over `transactions` and `loans`, and Prometheus scrape intervals are
// set by whoever runs the scraper. Tying database load to a stranger's config
// is how a monitoring system becomes the outage.
func StartBusinessRefresh(ctx context.Context, pool *pgxpool.Pool, interval time.Duration) {
	if pool == nil {
		return
	}
	if interval <= 0 {
		interval = time.Minute
	}

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

	go func() {
		refresh() // Populate immediately; an empty /metrics after a deploy is confusing.
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				refresh()
			}
		}
	}()
}

func readBusinessSnapshot(ctx context.Context, pool *pgxpool.Pool) (businessSnapshot, error) {
	snap := businessSnapshot{PostedToday: map[string]int64{}}

	// PROCESSED means a worker has posted it and the member has not yet
	// confirmed — the middle state of Request → Process → Confirm. Anything
	// sitting there for two days is the queue this metric exists to surface.
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

// SetLedgerDrift publishes the result of one reconciliation pass.
//
// `checks` must be every check that ran, not only the ones that found
// something. A gauge that is only ever set when it is non-zero keeps its last
// non-zero value forever, so the alert that fired on Tuesday is still firing on
// Friday after the drift was corrected — and an operator learns to ignore it.
func SetLedgerDrift(rows, taka map[string]int64, checks []string) {
	for _, check := range checks {
		ledgerDriftRows.WithLabelValues(check).Set(float64(rows[check]))
		ledgerDriftTaka.WithLabelValues(check).Set(float64(taka[check]))
	}
	ledgerLastReconciled.SetToCurrentTime()
}

// ObserveLedgerReconcileFailure records a pass that could not complete. The
// drift gauges are deliberately left untouched: a failed pass knows nothing, and
// writing zeroes would report a clean ledger it never managed to read.
func ObserveLedgerReconcileFailure() { ledgerReconcileFailures.Inc() }
