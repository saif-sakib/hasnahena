package middleware

import (
	"context"
	"net/http"
	"strings"
)

// RUN-09 / WO-78. Who a request belongs to, decided once, before anything that
// needs to know.
//
// The problem this exists for
// ---------------------------
// The rate limiter keys on the caller's address. Everything the browser sends
// to `/v1/dashboard/support/*` goes through a Next proxy on Vercel first, so it
// arrives from Vercel's address — all of it, from every member, into one
// bucket. [ADR-021] records at length why forwarding an `X-Forwarded-For` entry
// cannot fix that: `TRUSTED_PROXIES` is one global number and there is no value
// correct for both the proxied and the direct path. Do not retry it.
//
// The fix is to stop keying support traffic on an address at all and key it on
// the member. That needs a verified identity *before* the limiter runs, and the
// order matters more than it looks:
//
//   - Keying on an **unverified** token is worse than keying on the address. An
//     attacker sending a fresh garbage token per request would mint a fresh
//     bucket per request, which is the WO-60 defect with a different header.
//   - So the token is verified here — signature and expiry, the two things a
//     forger cannot fake — before the limiter sees it.
//
// What is deliberately NOT checked here
// -------------------------------------
// Revocation. `authService.ValidateToken` also asks the database whether the
// token is blacklisted and whether the member's tokens were revoked wholesale
// by a password change, and every handler still does that. Repeating it here
// would put two queries on the hot path of every request including the ones the
// limiter is about to reject — a rate limiter that queries the database is a
// denial-of-service amplifier.
//
// It is also not needed for this purpose. A revoked token is still *evidence of
// which member holds it*: it was signed for that subject, and no one else can
// produce one. Attributing their traffic to them is exactly right, and the
// handler refuses the request a moment later on its own.
//
// The shape is [ADR-019]'s, on purpose: one place decides, everything else
// reads it back with RequestUserID. Nothing else may parse an Authorization
// header to answer "who is this" for a cross-cutting concern.
type ctxKeyUserID struct{}

// TokenVerifier reports the subject of a signed, unexpired token.
//
// A function rather than the AuthService itself, so this package keeps its one
// import of net/http and does not depend on services — which depends on the
// repositories, which depend on pgx. main.go supplies the real one.
type TokenVerifier func(token string) (userID string, ok bool)

// Identity resolves the caller from their bearer token and stores the result in
// the request context.
//
// Mount it after Logging (which resolves the address) and BEFORE RateLimit,
// which is the whole point. A request with no token, a malformed one, or one
// whose signature or expiry does not check out simply carries no user id, and
// everything downstream falls back to the address.
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

// RequestUserID returns the id of the member this request was proven to belong
// to, or "" for an anonymous or unverifiable caller.
//
// "Proven" means the token's signature and expiry checked out — not that the
// request is authorised. Use it to *attribute* a request (throttling, logging),
// never to authorise one: it does not know about revocation, roles, or whether
// the account is still ACTIVE. Authorisation stays where it is, in the
// handlers, behind ValidateToken.
func RequestUserID(r *http.Request) string {
	if id, ok := r.Context().Value(ctxKeyUserID{}).(string); ok {
		return id
	}
	return ""
}

// bearerToken extracts the token from an Authorization header, or "" if there
// is not one. Case-insensitive on the scheme, as RFC 7235 requires.
func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}
