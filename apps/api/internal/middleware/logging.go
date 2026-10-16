package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"

	"hasnahena/apps/api/internal/observability"
)

// ctxKeyRequestState lets a handler add facts to the access log line.
type ctxKeyRequestState struct{}

// ctxKeyClientIP carries the attributed address, resolved once by Logging.
type ctxKeyClientIP struct{}

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

// RequestClientIP returns the attributed address (falls back to the TCP peer).
// Never read X-Forwarded-For directly in a handler (WO-60, ADR-019).
func RequestClientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(ctxKeyClientIP{}).(string); ok && ip != "" {
		return ip
	}
	return ClientIP(r, ClientIPConfig{})
}

// SetRequestUserID records who a request belongs to, for the access log.
func SetRequestUserID(ctx context.Context, userID string) {
	if state, ok := ctx.Value(ctxKeyRequestState{}).(*requestState); ok {
		state.setUserID(userID)
	}
}

// responseRecorder captures status and bytes. Flush and Unwrap keep the SSE
// handler's Flusher and ResponseController working through the wrap.
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

// Logging writes one structured line per request: path only, never the query
// (tickets, thread ids), and user IDs rather than emails (RUN-05). Register it
// BEFORE Recoverer so panics are logged with their 500.
func Logging(cfg ClientIPConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return loggingHandler(next, cfg)
	}
}

func loggingHandler(next http.Handler, cfg ClientIPConfig) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		clientIP := ClientIP(r, cfg)
		state := &requestState{}
		ctx := context.WithValue(r.Context(), ctxKeyRequestState{}, state)
		ctx = context.WithValue(ctx, ctxKeyClientIP{}, clientIP)
		r = r.WithContext(ctx)
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
				"ip", clientIP,
			}
			// The TCP peer when it differs from the attributed address.
			if peer := ClientIP(r, ClientIPConfig{}); peer != clientIP {
				attrs = append(attrs, "peer", peer)
			}
			if userID := state.getUserID(); userID != "" {
				attrs = append(attrs, "userId", userID)
			}

			level := slog.LevelInfo
			switch {
			case status >= 500:
				level = slog.LevelError
				// Error level, but not a Sentry alert (observability.SkipKey).
				attrs = append(attrs, observability.SkipKey, true)
			case status >= 400:
				level = slog.LevelWarn
			}

			slog.Log(r.Context(), level, "http_request", attrs...)
		}()

		next.ServeHTTP(recorder, r)
	})
}
