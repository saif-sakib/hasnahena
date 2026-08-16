package middleware

import "net/http"

// CORS also sets the standing security headers, since both belong to every
// response and neither needs any request state.
//
// enableHSTS comes from the ENABLE_HSTS env var and is off by default on
// purpose. Strict-Transport-Security is remembered by the browser for its whole
// max-age, so sending it from a plain-HTTP localhost API pins `localhost` to
// HTTPS for two years — in every project that developer works on, not just this
// one, and with no obvious way to undo it. It must be on in production, where
// Render terminates TLS, and off everywhere else.
func CORS(allowedOrigins []string, enableHSTS bool) func(http.Handler) http.Handler {
	originAllowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		originAllowed[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := originAllowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Max-Age", "86400")
			}

			// Security Headers
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-XSS-Protection", "1; mode=block")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			// SEC-09. Next already sends this for the web app; without it here the
			// API was the one origin a downgrade attack still had to work with.
			//
			// `preload` is deliberate but has a condition attached: submitting the
			// domain to the browser preload list is close to irreversible, so it
			// is only honest to send it once api.hasnahenafoundation.com is
			// permanently HTTPS. It is, behind Render.
			if enableHSTS {
				w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
