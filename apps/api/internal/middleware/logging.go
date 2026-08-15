package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// ctxKeyRequestState carries the per-request holder that lets a handler add
// facts to the access log line after the middleware has already started.
type ctxKeyRequestState struct{}

type requestState struct {
	mu     sync.Mutex
	userID string
}

func (s *requestState) setUserID(userID string) {
	s.mu.Lock()
	s.userID = userID
	s.mu.Unlock()
}

func (s *requestState) getUserID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.userID
}

// SetRequestUserID records who a request turned out to belong to, so the access
// log can carry a user ID without the middleware having to parse the token
// itself. Call it from the auth path. It is a no-op for a request that did not
// pass through Logging, which keeps it safe to call from tests.
func SetRequestUserID(ctx context.Context, userID string) {
	if state, ok := ctx.Value(ctxKeyRequestState{}).(*requestState); ok {
		state.setUserID(userID)
	}
}

// responseRecorder captures the status and byte count for the access log.
//
// Wrapping the ResponseWriter is not free: anything a handler type-asserts for
// has to survive the wrap. Flush keeps the SSE handler's http.Flusher assertion
// working, and Unwrap lets http.ResponseController reach the real writer so
// that same handler can clear its write deadline.
type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (rr *responseRecorder) WriteHeader(status int) {
	if rr.status == 0 {
		rr.status = status
	}
	rr.ResponseWriter.WriteHeader(status)
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	if rr.status == 0 {
		rr.status = http.StatusOK
	}
	n, err := rr.ResponseWriter.Write(b)
	rr.bytes += n
	return n, err
}

func (rr *responseRecorder) Flush() {
	if flusher, ok := rr.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (rr *responseRecorder) Unwrap() http.ResponseWriter {
	return rr.ResponseWriter
}

// Logging writes one structured line per request.
//
// Deliberately logs r.URL.Path and never r.URL.RawQuery: query strings carry
// thread ids and stream tickets, and an access log is the wrong place for
// either. Member email addresses never appear here or in any handler log —
// user IDs identify people in logs (RUN-05).
//
// Register this BEFORE Recoverer so that Logging is the outer wrapper. A panic
// is then converted to a 500 by Recoverer while still inside this wrapper, so
// the panic gets an access log line with the right status instead of vanishing.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		state := &requestState{}
		r = r.WithContext(context.WithValue(r.Context(), ctxKeyRequestState{}, state))
		recorder := &responseRecorder{ResponseWriter: w}

		defer func() {
			status := recorder.status
			if status == 0 {
				// Handler returned without writing anything.
				status = http.StatusOK
			}

			attrs := []any{
				"requestId", chimw.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"bytes", recorder.bytes,
				"durationMs", time.Since(start).Milliseconds(),
				"ip", r.RemoteAddr,
			}
			if userID := state.getUserID(); userID != "" {
				attrs = append(attrs, "userId", userID)
			}

			level := slog.LevelInfo
			switch {
			case status >= 500:
				level = slog.LevelError
			case status >= 400:
				level = slog.LevelWarn
			}

			slog.Log(r.Context(), level, "http_request", attrs...)
		}()

		next.ServeHTTP(recorder, r)
	})
}
