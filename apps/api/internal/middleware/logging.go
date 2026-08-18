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

// ctxKeyClientIP carries the address this request is attributed to, resolved
// once by Logging so that the access log, the rate limiter and any audit row a
// handler writes all name the same caller.
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

// RequestClientIP returns the address this request is attributed to.
//
// Set by Logging from ClientIP, so a handler recording who did something gets
// the same answer the limiter and the access log got. Falls back to the TCP
// peer for a request that did not pass through Logging, which keeps handler
// tests working — and is the safe direction to fail, because the peer is the
// one value no caller can choose.
//
// Never read X-Forwarded-For directly in a handler. Three did, taking the
// LEFTMOST entry, which is the attacker-supplied end: two recorded it as the
// address a password change came from, and the login lockout counted failed
// attempts against it — so varying one header stepped around the lockout
// entirely (WO-60).
func RequestClientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(ctxKeyClientIP{}).(string); ok && ip != "" {
		return ip
	}
	return ClientIP(r, 0)
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
//
// Takes the trusted-proxy count because the address a request came from is a
// deployment fact, not a request one — see ClientIP. Before WO-60 this logged
// r.RemoteAddr after chi's RealIP had overwritten it with a caller-supplied
// header, so the field naming where a request came from was chosen by whoever
// sent it. An access log that cannot be trusted on that point is not evidence,
// and in a financial system the log exists to answer "who did this".
func Logging(trustedProxies int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return loggingHandler(next, trustedProxies)
	}
}

func loggingHandler(next http.Handler, trustedProxies int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		clientIP := ClientIP(r, trustedProxies)
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
			// The TCP peer, when it is not the address being attributed. With a
			// proxy in front they differ on every request and the pair is the
			// full picture; with no proxy configured they differ only when
			// someone sent a header claiming otherwise, which is a signal.
			if peer := ClientIP(r, 0); peer != clientIP {
				attrs = append(attrs, "peer", peer)
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
