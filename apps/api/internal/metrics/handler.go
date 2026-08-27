package metrics

import (
	"crypto/subtle"
	"log/slog"
	"net/http"
	"strings"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Handler serves the Prometheus exposition, behind a bearer token.
//
// /metrics is not public here, and that is a deliberate departure from the
// usual advice. The exposition carries how many members are waiting on money,
// how many disputes are open and how many loans are outstanding. For a village
// cooperative that is commercially and personally sensitive — it is a rough
// read on the organisation's health and on individual members' circumstances,
// available to anyone who guesses a URL.
//
// With no token configured the endpoint returns 404 rather than 401: an
// unconfigured deployment should be indistinguishable from one that never had
// the endpoint, so a scanner learns nothing from probing it.
func Handler(token string) http.Handler {
	exposition := promhttp.HandlerFor(Registry, promhttp.HandlerOpts{
		// A broken collector should not take the scrape down with it; report
		// what can be reported and record the failure.
		ErrorHandling: promhttp.ContinueOnError,
		Registry:      Registry,
	})

	if token == "" {
		slog.Warn("metrics endpoint disabled: set METRICS_TOKEN to enable /metrics")
		return http.NotFoundHandler()
	}

	expected := []byte(token)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presented := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))

		// Constant-time compare: a scraper's token is a long-lived credential,
		// and a timing oracle on it is worth avoiding for the cost of one call.
		if subtle.ConstantTimeCompare([]byte(presented), expected) != 1 {
			slog.Warn("metrics scrape rejected", "remote", r.Header.Get("X-Forwarded-For"))
			w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// The business gauges are recomputed here rather than on a ticker, so
		// the database is queried when somebody actually asks and not otherwise
		// — see the note on businessRefresher. Bounded by its own floor, so a
		// scraper set to five seconds still touches the database at most once
		// per METRICS_REFRESH_INTERVAL.
		RefreshBusinessIfStale(r.Context())

		exposition.ServeHTTP(w, r)
	})
}
