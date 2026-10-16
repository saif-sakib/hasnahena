package metrics

import (
	"crypto/subtle"
	"log/slog"
	"net/http"
	"strings"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Handler serves /metrics behind a bearer token — the figures are sensitive.
// With no token it answers 404, as if the endpoint did not exist.
func Handler(token string) http.Handler {
	exposition := promhttp.HandlerFor(Registry, promhttp.HandlerOpts{
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

		if subtle.ConstantTimeCompare([]byte(presented), expected) != 1 {
			slog.Warn("metrics scrape rejected", "remote", r.Header.Get("X-Forwarded-For"))
			w.Header().Set("WWW-Authenticate", `Bearer realm="metrics"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// Lazy business refresh, bounded by METRICS_REFRESH_INTERVAL.
		RefreshBusinessIfStale(r.Context())

		exposition.ServeHTTP(w, r)
	})
}
