package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestClientIPIgnoresSpoofedForwardedFor(t *testing.T) {
	// The whole limiter rests on this. X-Forwarded-For grows left to right, so
	// with one real proxy in front only the RIGHTMOST entry was added by
	// infrastructure; everything left of it is whatever the caller typed.
	//
	// If this ever regresses to reading the leftmost entry, a single client can
	// mint a fresh quota per request by varying a header and the limiter becomes
	// decorative — with no failing test and no visible symptom.
	tests := []struct {
		name           string
		xff            string
		remoteAddr     string
		trustedProxies int
		want           string
	}{
		{
			name:           "one proxy: trust the entry the proxy appended",
			xff:            "9.9.9.9, 203.0.113.7",
			remoteAddr:     "10.0.0.1:5000",
			trustedProxies: 1,
			want:           "203.0.113.7",
		},
		{
			name:           "attacker prepends many addresses, still keyed on the real one",
			xff:            "1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7",
			remoteAddr:     "10.0.0.1:5000",
			trustedProxies: 1,
			want:           "203.0.113.7",
		},
		{
			name:           "no proxy configured: header is ignored entirely",
			xff:            "9.9.9.9",
			remoteAddr:     "203.0.113.7:5000",
			trustedProxies: 0,
			want:           "203.0.113.7",
		},
		{
			name:           "more trusted proxies than entries: fall back to leftmost, never out of range",
			xff:            "203.0.113.7",
			remoteAddr:     "10.0.0.1:5000",
			trustedProxies: 3,
			want:           "203.0.113.7",
		},
		{
			name:           "two proxies",
			xff:            "9.9.9.9, 203.0.113.7, 10.0.0.9",
			remoteAddr:     "10.0.0.1:5000",
			trustedProxies: 2,
			want:           "203.0.113.7",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/v1/anything", nil)
			r.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := ClientIP(r, tc.trustedProxies); got != tc.want {
				t.Fatalf("ClientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRateLimitBlocksAfterQuotaAndRecovers(t *testing.T) {
	l := &rateLimiter{
		buckets: make(map[string]*rateLimitBucket),
		cfg:     RateLimitConfig{Requests: 3, Window: time.Minute},
	}
	now := time.Now()

	for i := 1; i <= 3; i++ {
		if ok, _ := l.allow("a", now); !ok {
			t.Fatalf("request %d should have been allowed", i)
		}
	}
	ok, retry := l.allow("a", now)
	if ok {
		t.Fatal("4th request in the window should have been blocked")
	}
	if retry <= 0 {
		t.Fatalf("blocked request must report a positive Retry-After, got %v", retry)
	}

	// A different client is unaffected — the limiter is per key, not global.
	if ok, _ := l.allow("b", now); !ok {
		t.Fatal("a second client must not inherit the first client's quota")
	}

	// The window rolls over.
	if ok, _ := l.allow("a", now.Add(time.Minute+time.Second)); !ok {
		t.Fatal("quota should reset once the window has passed")
	}
}

func TestRateLimitFailsOpenAtCapacity(t *testing.T) {
	// A limiter that starts rejecting real members when it runs out of memory has
	// amplified the attack it exists to stop.
	l := &rateLimiter{
		buckets: make(map[string]*rateLimitBucket),
		cfg:     RateLimitConfig{Requests: 1, Window: time.Minute},
	}
	now := time.Now()
	for i := 0; i < rateLimitMaxClients; i++ {
		l.buckets[string(rune(i%1000))+string(rune(i/1000))] = &rateLimitBucket{
			count: 1, windowEnd: now.Add(time.Minute), lastSeen: now,
		}
	}
	if ok, _ := l.allow("brand-new-client", now); !ok {
		t.Fatal("at capacity the limiter must fail open, not lock everyone out")
	}
}

func TestRateLimitSweepDropsIdleBuckets(t *testing.T) {
	l := &rateLimiter{
		buckets: make(map[string]*rateLimitBucket),
		cfg:     RateLimitConfig{Requests: 1, Window: time.Minute},
	}
	now := time.Now()
	l.buckets["idle"] = &rateLimitBucket{lastSeen: now.Add(-2 * rateLimitIdleTTL)}
	l.buckets["active"] = &rateLimitBucket{lastSeen: now}

	l.sweep(now)

	if _, ok := l.buckets["idle"]; ok {
		t.Error("idle bucket should have been swept — otherwise the map grows forever")
	}
	if _, ok := l.buckets["active"]; !ok {
		t.Error("active bucket must survive the sweep")
	}
}

func TestRateLimitExemptions(t *testing.T) {
	cases := []struct {
		method, path string
		wantExempt   bool
		why          string
	}{
		{http.MethodGet, "/v1/dashboard/member/transactions", true, "reads are not what RUN-07 throttles"},
		{http.MethodOptions, "/v1/anything", true, "CORS preflight must never be throttled"},
		{http.MethodPost, "/v1/health", true, "platform liveness probe"},
		{http.MethodPost, "/v1/ready", true, "load-balancer readiness probe"},
		{http.MethodPost, "/metrics", true, "scrape endpoint"},
		{http.MethodPost, "/v1/dashboard/worker/deposits", false, "money movement is exactly the target"},
		{http.MethodDelete, "/v1/dashboard/admin/workers", false, "mutating admin route"},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		if got := rateLimitExempt(r); got != c.wantExempt {
			t.Errorf("%s %s: exempt = %v, want %v (%s)", c.method, c.path, got, c.wantExempt, c.why)
		}
	}
}
