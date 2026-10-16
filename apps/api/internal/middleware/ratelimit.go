package middleware

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"hasnahena/apps/api/internal/utils"
)

// RUN-07. In-memory, unlike the login lockout table: it counts every request,
// and a table would add a write to the money routes' hot path. With N
// instances the effective limit is N× (Render runs one).
const (
	// Idle buckets are dropped after this.
	rateLimitIdleTTL = 10 * time.Minute

	// Ceiling on tracked clients; on overflow the limiter fails OPEN.
	rateLimitMaxClients = 50_000
)

// RateLimitConfig is built from env vars in main.go.
type RateLimitConfig struct {
	// Requests permitted per window, per client, for mutating methods.
	Requests int
	Window   time.Duration

	ClientIP ClientIPConfig
}

// ClientIPConfig is how this deployment resolves a caller's address — set once
// at boot, never inferred per request (ADR-019).
type ClientIPConfig struct {
	// TrustedProxies is how many reverse proxies sit in front of this process.
	TrustedProxies int

	// TrustCloudflare believes CF-Connecting-IP. ONLY when every route to this
	// process passes through the foundation's Cloudflare zone.
	TrustCloudflare bool
}

type rateLimitBucket struct {
	count     int
	windowEnd time.Time
	lastSeen  time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*rateLimitBucket
	cfg     RateLimitConfig
}

// allow reports whether the client may proceed, and how long to wait if not.
func (l *rateLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		// Fail open rather than lock out members under load.
		if len(l.buckets) >= rateLimitMaxClients {
			return true, 0
		}
		l.buckets[key] = &rateLimitBucket{count: 1, windowEnd: now.Add(l.cfg.Window), lastSeen: now}
		return true, 0
	}

	b.lastSeen = now
	if now.After(b.windowEnd) {
		b.count = 1
		b.windowEnd = now.Add(l.cfg.Window)
		return true, 0
	}

	b.count++
	if b.count > l.cfg.Requests {
		return false, time.Until(b.windowEnd)
	}
	return true, 0
}

func (l *rateLimiter) sweep(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		if now.Sub(b.lastSeen) > rateLimitIdleTTL {
			delete(l.buckets, k)
		}
	}
}

// ClientIP is the address a request is attributed to — by the limiter, the
// access log and audit rows alike. X-Forwarded-For is counted from the RIGHT
// (TRUSTED_PROXIES); the leftmost entry is caller-controlled. With
// TRUST_CLOUDFLARE_CLIENT_IP, CF-Connecting-IP is preferred: hop counting was
// silently wrong twice when DNS moved to Cloudflare.
func ClientIP(r *http.Request, cfg ClientIPConfig) string {
	if cfg.TrustCloudflare {
		if candidate := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); candidate != "" {
			// Must parse: it becomes a rate-limit key and an audit value.
			if net.ParseIP(candidate) != nil {
				return candidate
			}
		}
	}

	if cfg.TrustedProxies > 0 {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			idx := len(parts) - cfg.TrustedProxies
			if idx < 0 {
				idx = 0
			}
			if ip := strings.TrimSpace(parts[idx]); ip != "" {
				return ip
			}
		}
	}

	// Direct connection: the TCP peer, which no header can change.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimitExempt reports paths that must never be throttled.
func rateLimitExempt(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		// Reads are not throttled; SEC-08 is limited in its Next handler.
		return true
	}

	// Health probes: a 429 reads as "down" and can trigger restarts.
	switch r.URL.Path {
	case "/v1/health", "/v1/ready", "/metrics":
		return true
	}
	return false
}

// limiterKey: the member when the Identity middleware verified their token,
// else the address. Through the Next proxy every request carries Vercel's
// address (ADR-021). Prefixes keep ids and addresses in separate buckets.
func limiterKey(r *http.Request, cfg ClientIPConfig) string {
	if userID := RequestUserID(r); userID != "" {
		return "user:" + userID
	}
	return "ip:" + ClientIP(r, cfg)
}

// RateLimit throttles mutating requests per caller.
func RateLimit(cfg RateLimitConfig, stop <-chan struct{}) func(http.Handler) http.Handler {
	l := &rateLimiter{buckets: make(map[string]*rateLimitBucket), cfg: cfg}

	// Swept on a ticker so a burst does not also pay for cleanup.
	go func() {
		t := time.NewTicker(rateLimitIdleTTL / 2)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case now := <-t.C:
				l.sweep(now)
			}
		}
	}()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rateLimitExempt(r) {
				next.ServeHTTP(w, r)
				return
			}

			ok, retryAfter := l.allow(limiterKey(r, cfg.ClientIP), time.Now())
			if !ok {
				secs := int(retryAfter.Seconds()) + 1
				w.Header().Set("Retry-After", strconv.Itoa(secs))
				utils.Error(w, http.StatusTooManyRequests, "RATE_LIMITED",
					"Too many requests. Try again in "+strconv.Itoa(secs)+" seconds")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
