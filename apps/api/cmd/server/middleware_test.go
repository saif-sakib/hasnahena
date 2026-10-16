package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	appmw "hasnahena/apps/api/internal/middleware"
)

// WO-60: the real middleware stack must not let a caller pick its rate-limit
// bucket via X-Forwarded-For (chi's RealIP did, at TRUSTED_PROXIES=0).

func stackedRouter(t *testing.T, trustedProxies, requests int) chi.Router {
	t.Helper()
	return stackedRouterWithIdentity(t, trustedProxies, requests, nil)
}

// stackedRouterWithIdentity mounts a token verifier (the WO-78 path).
func stackedRouterWithIdentity(
	t *testing.T,
	trustedProxies, requests int,
	verify appmw.TokenVerifier,
) chi.Router {
	t.Helper()

	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })

	r := chi.NewRouter()
	mountMiddleware(r, middlewareConfig{
		CORSOrigins: []string{"http://localhost:3000"},
		ClientIP:    appmw.ClientIPConfig{TrustedProxies: trustedProxies},
		RateLimit: appmw.RateLimitConfig{
			Requests: requests,
			Window:   time.Minute,
			ClientIP: appmw.ClientIPConfig{TrustedProxies: trustedProxies},
		},
		LimiterStop: stop,
		VerifyToken: verify,
	})
	r.Post("/v1/anything", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return r
}

func postThroughStack(r chi.Router, peer, forwardedFor string) int {
	return postThroughStackAs(r, peer, forwardedFor, "")
}

// postThroughStackAs sends the same request carrying a bearer token, or none
// when token is empty.
func postThroughStackAs(r chi.Router, peer, forwardedFor, token string) int {
	req := httptest.NewRequest(http.MethodPost, "/v1/anything", nil)
	req.RemoteAddr = peer
	if forwardedFor != "" {
		req.Header.Set("X-Forwarded-For", forwardedFor)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code
}

func TestVaryingForwardedForCannotMintAFreshQuota(t *testing.T) {
	const quota = 5
	router := stackedRouter(t, 0, quota)

	blocked := 0
	for i := 0; i < quota*3; i++ {
		// A different claimed address every time — the whole attack.
		if postThroughStack(router, "198.51.100.9:5000", fmt.Sprintf("10.0.0.%d", i)) == http.StatusTooManyRequests {
			blocked++
		}
	}

	if blocked == 0 {
		t.Fatalf("a client varying X-Forwarded-For was never throttled in %d requests: "+
			"the limiter is keying on a value the caller supplies", quota*3)
	}
	if want := quota * 3; blocked != want-quota {
		t.Errorf("blocked %d of %d, want %d — the limiter is not counting every request "+
			"against the same caller", blocked, want, want-quota)
	}
}

func TestTheThrottleAndTheAccessLogNameTheSameCaller(t *testing.T) {
	// Behind a proxy, two members get their own buckets (rightmost entry).
	router := stackedRouter(t, 1, 2)

	for i := 0; i < 3; i++ {
		if code := postThroughStack(router, "10.0.0.1:5000", "203.0.113.7"); i < 2 && code != http.StatusOK {
			t.Fatalf("request %d from the first member was %d, want 200", i, code)
		} else if i == 2 && code != http.StatusTooManyRequests {
			t.Fatalf("the first member's 3rd request was %d, want 429", code)
		}
	}

	if code := postThroughStack(router, "10.0.0.1:5000", "203.0.113.99"); code != http.StatusOK {
		t.Fatalf("a second member behind the same proxy was %d, want 200 — they are sharing a bucket", code)
	}
}

// chi's RealIP must not be mounted again.
func TestRealIPIsNotMounted(t *testing.T) {
	router := stackedRouter(t, 0, 1000)

	var seen string
	router.Post("/v1/echo", func(w http.ResponseWriter, r *http.Request) {
		seen = r.RemoteAddr
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/echo", nil)
	req.RemoteAddr = "198.51.100.9:5000"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	router.ServeHTTP(httptest.NewRecorder(), req)

	if seen != "198.51.100.9:5000" {
		t.Fatalf("r.RemoteAddr = %q — something in the stack is rewriting it from a caller-supplied header", seen)
	}
}

// ---------------------------------------------------------------------------
// WO-78 / RUN-09 — the limiter keys on the member, not on the proxy
// ---------------------------------------------------------------------------

// verifierAcceptingPrefix: "valid:<userID>" verifies; anything else does not.
func verifierAcceptingPrefix(t *testing.T) appmw.TokenVerifier {
	t.Helper()
	return func(token string) (string, bool) {
		const prefix = "valid:"
		if len(token) > len(prefix) && token[:len(prefix)] == prefix {
			return token[len(prefix):], true
		}
		return "", false
	}
}

// Members behind the Next support proxy (one Vercel address) get separate
// buckets (WO-78, ADR-021).
func TestTwoMembersBehindOneProxyGetSeparateBuckets(t *testing.T) {
	const quota = 2
	router := stackedRouterWithIdentity(t, 1, quota, verifierAcceptingPrefix(t))

	// One address for both, which is exactly the proxied situation.
	const proxied = "203.0.113.7"

	for i := 0; i < quota; i++ {
		if code := postThroughStackAs(router, "10.0.0.1:5000", proxied, "valid:member-a"); code != http.StatusOK {
			t.Fatalf("member A request %d was %d, want 200", i, code)
		}
	}
	if code := postThroughStackAs(router, "10.0.0.1:5000", proxied, "valid:member-a"); code != http.StatusTooManyRequests {
		t.Fatalf("member A past their quota was %d, want 429 — the limiter is not counting them at all", code)
	}

	// Same address, different member. Before WO-78 this was already 429,
	// because member A had spent the address's whole bucket.
	if code := postThroughStackAs(router, "10.0.0.1:5000", proxied, "valid:member-b"); code != http.StatusOK {
		t.Fatalf("member B was %d, want 200 — they are sharing member A's bucket, "+
			"which is RUN-09: one abusive member locks out the rest", code)
	}
}

// Unverified tokens must not mint fresh buckets.
func TestGarbageTokensFromOneAddressShareOneBucket(t *testing.T) {
	const quota = 5
	router := stackedRouterWithIdentity(t, 0, quota, verifierAcceptingPrefix(t))

	blocked := 0
	for i := 0; i < quota*3; i++ {
		// A different unverifiable token every time — the whole attack.
		token := fmt.Sprintf("forged-%d", i)
		if postThroughStackAs(router, "198.51.100.9:5000", "", token) == http.StatusTooManyRequests {
			blocked++
		}
	}

	if blocked != quota*3-quota {
		t.Fatalf("blocked %d of %d requests, want %d: a caller sending a fresh unverifiable "+
			"token per request is minting a fresh bucket per request",
			blocked, quota*3, quota*3-quota)
	}
}

// A member and a stranger on one address do not share a bucket.
func TestAnAuthenticatedCallerDoesNotShareTheAddressBucket(t *testing.T) {
	const quota = 2
	router := stackedRouterWithIdentity(t, 0, quota, verifierAcceptingPrefix(t))

	for i := 0; i < quota; i++ {
		if code := postThroughStackAs(router, "198.51.100.9:5000", "", ""); code != http.StatusOK {
			t.Fatalf("anonymous request %d was %d, want 200", i, code)
		}
	}
	if code := postThroughStackAs(router, "198.51.100.9:5000", "", ""); code != http.StatusTooManyRequests {
		t.Fatalf("the anonymous bucket was %d past its quota, want 429", code)
	}

	if code := postThroughStackAs(router, "198.51.100.9:5000", "", "valid:member-c"); code != http.StatusOK {
		t.Fatalf("a signed-in member from that address was %d, want 200 — anonymous "+
			"traffic is spending their quota", code)
	}
}

// With no verifier, everything is keyed on the address.
func TestWithoutAVerifierEverythingIsKeyedOnTheAddress(t *testing.T) {
	const quota = 2
	router := stackedRouterWithIdentity(t, 0, quota, nil)

	for i := 0; i < quota; i++ {
		if code := postThroughStackAs(router, "198.51.100.9:5000", "", "valid:member-a"); code != http.StatusOK {
			t.Fatalf("request %d was %d, want 200", i, code)
		}
	}
	if code := postThroughStackAs(router, "198.51.100.9:5000", "", "valid:member-b"); code != http.StatusTooManyRequests {
		t.Fatalf("a second member from the same address was %d, want 429: with no verifier "+
			"the key must still be the address", code)
	}
}
