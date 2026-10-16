package middleware

import (
	"context"
	"net/http"
	"strings"
)

// RUN-09 / WO-78: who a request belongs to, decided once, before the rate
// limiter. Support traffic arrives via Vercel's address, so it is keyed on the
// member instead (ADR-021 — forwarding X-Forwarded-For cannot fix it; do not
// retry). Signature and expiry are verified here; revocation is NOT (that
// would put DB queries before the limiter) — handlers still check it. Read the
// result with RequestUserID; nothing else parses Authorization for this.
type ctxKeyUserID struct{}

// TokenVerifier reports the subject of a signed, unexpired token. A function so
// this package does not depend on services.
type TokenVerifier func(token string) (userID string, ok bool)

// Identity stores the verified caller in the context. Mount after Logging and
// BEFORE RateLimit.
func Identity(verify TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if verify != nil {
				if token := bearerToken(r); token != "" {
					if userID, ok := verify(token); ok && userID != "" {
						r = r.WithContext(context.WithValue(r.Context(), ctxKeyUserID{}, userID))
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestUserID is the verified token's subject, or "". For attributing a
// request (throttling, logging), never for authorising one.
func RequestUserID(r *http.Request) string {
	if id, ok := r.Context().Value(ctxKeyUserID{}).(string); ok {
		return id
	}
	return ""
}

// bearerToken extracts a bearer token (scheme case-insensitive).
func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}
