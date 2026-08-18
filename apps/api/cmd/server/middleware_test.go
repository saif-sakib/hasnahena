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

// WO-60. The rate limiter is the only thing standing between one client and as
// many money-moving requests as it cares to send. chi's RealIP overwrote
// r.RemoteAddr with the leftmost X-Forwarded-For entry — which the caller
// writes — so at the default TRUSTED_PROXIES=0 the limiter keyed on a value the
// caller chose, and varying one header per request meant a fresh bucket every
// time. The limit was never reached, so nothing looked wrong.
//
// This drives the real middleware stack, because the defect was in its
// composition rather than in any one function: `clientIP` was already correct
// and already tested. RealIP destroyed its input three middlewares earlier.

func stackedRouter(t *testing.T, trustedProxies, requests int) chi.Router {
	t.Helper()

	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })

	r := chi.NewRouter()
	mountMiddleware(r, middlewareConfig{
		CORSOrigins:    []string{"http://localhost:3000"},
		TrustedProxies: trustedProxies,
		RateLimit: appmw.RateLimitConfig{
			Requests:       requests,
			Window:         time.Minute,
			TrustedProxies: trustedProxies,
		},
		LimiterStop: stop,
	})
	r.Post("/v1/anything", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return r
}

func postThroughStack(r chi.Router, peer, forwardedFor string) int {
	req := httptest.NewRequest(http.MethodPost, "/v1/anything", nil)
	req.RemoteAddr = peer
	if forwardedFor != "" {
		req.Header.Set("X-Forwarded-For", forwardedFor)
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
	// With a proxy in front, the trusted entry is the rightmost one. Two real
	// members behind that proxy must get their own buckets, or one member
	// exhausting the quota locks out everyone — the opposite failure, and just
	// as bad.
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

// The middleware stack must not carry chi's RealIP again. It is a one-line
// import away, it looks like a sensible thing to add behind a proxy, and its
// effect — a spoofable r.RemoteAddr — is invisible until someone is abusing it.
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
