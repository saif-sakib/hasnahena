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
// thing to move — to the database or to a shared store. Deliberate at one
// instance: a shared store would be a second dependency on the hot path of
// every request, to fix a limit nothing is currently straining.

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

	// ClientIP describes how a caller's address is resolved. See ClientIP —
	// this is the difference between a limiter that works and one an attacker
	// steps around by setting a header.
	ClientIP ClientIPConfig
}

// ClientIPConfig is how *this deployment* resolves a caller's address. A
// deployment fact, not a request one (ADR-019), which is why it is configured
// once at boot and never inferred per request.
type ClientIPConfig struct {
	// TrustedProxies is how many reverse proxies sit in front of this process.
	TrustedProxies int

	// TrustCloudflare believes `CF-Connecting-IP`.
	//
	// Set it ONLY when every route to this process passes through the
	// foundation's own Cloudflare zone. Cloudflare sets that header to the
	// address it accepted the connection from and strips any copy the caller
	// supplied, so within that path it is exact — but nothing about the header
	// itself proves the request came through Cloudflare, and a process reachable
	// another way would be believing a value anyone can type.
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

// ClientIP returns the address this request should be attributed to: the one
// the limiter keys on, the one the access log records, and the one an audit row
// stores as evidence. One function, so those three cannot disagree.
//
// This is the part that decides whether the limiter is real. chi's RealIP
// middleware — deprecated upstream for exactly this reason, and removed from
// this process by WO-60 — overwrote r.RemoteAddr with the LEFTMOST
// X-Forwarded-For entry, which is supplied by the caller and therefore
// attacker-controlled. Keying on it let one client mint a fresh quota per
// request by varying a header.
//
// X-Forwarded-For grows left to right, each proxy appending the address it
// received the connection from. So the trustworthy entry is counted from the
// RIGHT: with one proxy in front (Render), the last entry is the address Render
// saw, and everything to its left is whatever the client chose to claim.
//
// TRUSTED_PROXIES is the knob for that count: set it to the number of proxies in
// front of this process, and to 0 only when nothing is. Too low and real members
// share one bucket; too high and the header is believed.
//
// It is a *deployment fact*, and it changed twice in one week when the DNS moved
// to Cloudflare — 1, then 2, then 3 — each time silently, because a wrong count
// yields a perfectly well-formed address belonging to the wrong party. So when
// TRUST_CLOUDFLARE_CLIENT_IP is set, `CF-Connecting-IP` is preferred and the
// arithmetic becomes the fallback: one value, no index, unmoved by adding a hop.
func ClientIP(r *http.Request, cfg ClientIPConfig) string {
	// Preferred, because it is not arithmetic. Counting hops was wrong twice in
	// one week — once at 1 after DNS moved to Cloudflare, once at 2 — and both
	// times silently, because the wrong answer is a well-formed address that
	// simply belongs to the wrong party. `CF-Connecting-IP` carries one value
	// and does not move when a proxy is added in front.
	if cfg.TrustCloudflare {
		if candidate := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); candidate != "" {
			// Parsed, not merely non-empty: this value becomes a rate-limit key
			// and an audit row, and neither should be able to hold arbitrary
			// text. Anything unparseable falls through to the count below
			// rather than being trusted for being present.
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

	// Direct connection, or no proxy configured: the TCP peer, which no header
	// can change. This is what chi's RealIP used to destroy before the limiter
	// ever ran.
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

// limiterKey is who this request is counted against.
//
// RUN-09 / WO-78. The member when their token verifies, the address otherwise.
// Everything arriving through the Next support proxy carries Vercel's address —
// all of it, from every member, into one bucket — and ADR-021 explains why
// forwarding a header cannot fix that. Keying on the member does.
//
// The prefixes are not decoration: without them a member whose id happened to
// look like an address would share a bucket with that address. They also make
// the key readable in a debugger, which matters for the only thing that ever
// goes wrong here.
//
// The identity is verified — signature and expiry — by the Identity middleware
// before this runs. Keying on an *unverified* token would let one client mint a
// fresh bucket per request by sending garbage, which is the WO-60 defect
// wearing a different header, so the fallback to the address for a caller whose
// token does not check out is the load-bearing half of this function.
func limiterKey(r *http.Request, cfg ClientIPConfig) string {
	if userID := RequestUserID(r); userID != "" {
		return "user:" + userID
	}
	return "ip:" + ClientIP(r, cfg)
}

// RateLimit throttles mutating requests per caller — the member when their
// token verifies, otherwise the address.
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
