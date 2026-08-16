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

// RUN-07. Login was the only throttled route; every other mutating endpoint —
// including the ones that move money — accepted requests as fast as they arrived.
//
// Why this is in memory and not in the `rate_limits` table
// -------------------------------------------------------
// That table is the right home for *login lockout*: it counts failures, it must
// survive a restart (a restart is not a reason to forget an attacker), and it
// writes once per failed attempt, which is rare.
//
// A general limiter is the opposite on every axis. It has to count *every*
// request, so a table would mean an UPDATE on the hot path of the same
// transactions the money routes are already contending on. Surviving a restart
// buys nothing here: an attacker does not stop because the process did, and the
// window is seconds. So this keeps counters in memory, costs no I/O, and adds no
// contention.
//
// The tradeoff, stated plainly: with N API instances the effective limit is N
// times the configured one, because each holds its own counters. Render runs one
// instance today. If that changes and the limit matters exactly, this is the
// thing to move — to the database or to a shared store — and the note in
// docs/production-readiness.md under RUN-07 says so.

const (
	// Buckets are dropped once idle for this long, so the map tracks active
	// clients rather than every address ever seen.
	rateLimitIdleTTL = 10 * time.Minute

	// A hard ceiling on tracked clients. Without it, traffic from many source
	// addresses turns a rate limiter into a memory exhaustion bug — the limiter
	// becomes the outage it exists to prevent. On overflow the limiter fails
	// OPEN (see allow) rather than locking out real members.
	rateLimitMaxClients = 50_000
)

// RateLimitConfig is built from env vars in main.go so the numbers are operable
// without a deploy.
type RateLimitConfig struct {
	// Requests permitted per window, per client, for mutating methods.
	Requests int
	Window   time.Duration

	// TrustedProxies is how many reverse proxies sit in front of this process.
	// See clientIP — this is the difference between a limiter that works and one
	// an attacker steps around by setting a header.
	TrustedProxies int
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
		// Fail open rather than lock out legitimate members. A limiter that
		// starts rejecting everyone under load has amplified the problem.
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

// clientIP returns the address to key the limiter on.
//
// This is the part that decides whether the limiter is real. chi's RealIP
// middleware — mounted in main.go, and deprecated upstream for exactly this
// reason — overwrites r.RemoteAddr with the LEFTMOST X-Forwarded-For entry,
// which is supplied by the caller and therefore attacker-controlled. Keying on
// it would let one client mint a fresh quota per request by varying a header.
//
// X-Forwarded-For grows left to right, each proxy appending the address it
// received the connection from. So the trustworthy entry is counted from the
// RIGHT: with one proxy in front (Render), the last entry is the address Render
// saw, and everything to its left is whatever the client chose to claim.
func clientIP(r *http.Request, trustedProxies int) string {
	if trustedProxies > 0 {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			idx := len(parts) - trustedProxies
			if idx < 0 {
				idx = 0
			}
			if ip := strings.TrimSpace(parts[idx]); ip != "" {
				return ip
			}
		}
	}

	// Direct connection, or no proxy configured. RemoteAddr may have been
	// rewritten by chi's RealIP; with TrustedProxies=0 that is the operator
	// saying nothing is in front, so there is nothing better to use.
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
		// Reads are not what RUN-07 is about, and throttling GETs would catch
		// the dashboard's own polling. SEC-08's read oracle is rate-limited at
		// its own handler in the Next app, where the identifier is meaningful.
		return true
	}

	// Liveness and readiness are polled by the platform and by UptimeRobot. A
	// 429 here reads as "the service is down" and can trigger a restart loop.
	switch r.URL.Path {
	case "/v1/health", "/v1/ready", "/metrics":
		return true
	}
	return false
}

// RateLimit throttles mutating requests per client address.
func RateLimit(cfg RateLimitConfig, stop <-chan struct{}) func(http.Handler) http.Handler {
	l := &rateLimiter{buckets: make(map[string]*rateLimitBucket), cfg: cfg}

	// Idle buckets are swept on a ticker rather than on each request, so a burst
	// does not also pay for cleanup.
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

			ok, retryAfter := l.allow(clientIP(r, cfg.TrustedProxies), time.Now())
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
