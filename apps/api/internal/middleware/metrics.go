package middleware

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"hasnahena/apps/api/internal/metrics"
)

// Metrics records request rate, latency and status. Separate from Logging
// because labels are a cardinality decision. Register INSIDE Logging, outside
// the handlers, so a recovered panic counts as a 500.
func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		metrics.IncInFlight()
		defer metrics.DecInFlight()

		recorder := &responseRecorder{ResponseWriter: w}

		defer func() {
			status := recorder.status
			if status == 0 {
				status = http.StatusOK
			}

			// Read the pattern AFTER the handler (chi fills it in); one series
			// per endpoint, not per member.
			route := ""
			if rctx := chi.RouteContext(r.Context()); rctx != nil {
				route = rctx.RoutePattern()
			}

			metrics.ObserveRequest(r.Method, route, status, time.Since(start))
		}()

		next.ServeHTTP(recorder, r)
	})
}
