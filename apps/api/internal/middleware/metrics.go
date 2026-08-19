package middleware

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"hasnahena/apps/api/internal/metrics"
)

// Metrics records request rate, latency and status for every request.
//
// Kept separate from Logging rather than folded into it. They look like the
// same job — both wrap the handler and both want status and duration — but
// they fail differently: a metric label is a cardinality decision that costs
// memory forever, while a log field is written once and forgotten. Keeping the
// route-pattern logic here means that decision lives in one place.
//
// Register it INSIDE Logging (so the access log still wraps everything) but
// OUTSIDE the route handlers, so a panic converted to a 500 by Recoverer is
// still counted as a 500 rather than dropped.
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

			// Read the pattern AFTER the handler: chi fills it in as it walks
			// the tree, so before ServeHTTP it is empty. The pattern is the
			// template ("/v1/dashboard/worker/members/{memberUserId}/deposit"), not
			// the resolved path — one time series per endpoint instead of one
			// per member.
			route := ""
			if rctx := chi.RouteContext(r.Context()); rctx != nil {
				route = rctx.RoutePattern()
			}

			metrics.ObserveRequest(r.Method, route, status, time.Since(start))
		}()

		next.ServeHTTP(recorder, r)
	})
}
