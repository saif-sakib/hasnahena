// Package observability wires error reporting.
//
// The whole package is a no-op when SENTRY_DSN is unset, which is the normal
// state locally and in CI. Nothing here should ever be load-bearing: if error
// reporting is down, the API keeps serving.
package observability

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
)

// Init starts Sentry if a DSN is configured. The returned function flushes
// buffered events and must be deferred from main — Sentry's transport is
// asynchronous, so without it a panic that kills the process is never reported.
func Init(environment string) func() {
	dsn := strings.TrimSpace(os.Getenv("SENTRY_DSN"))
	if dsn == "" {
		slog.Info("error tracking disabled: set SENTRY_DSN to enable Sentry")
		return func() {}
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:         dsn,
		Environment: environment,
		// Tags every event with the deployed commit, so a spike in the
		// dashboard points at a specific deploy instead of a day. Render sets
		// RENDER_GIT_COMMIT itself; nothing to configure.
		Release: firstNonEmpty(os.Getenv("SENTRY_RELEASE"), os.Getenv("RENDER_GIT_COMMIT"), "dev"),
		// Errors only. Performance tracing on a free plan burns the quota that
		// should be holding actual exceptions.
		EnableTracing: false,
		// This is a financial system: an event body can otherwise carry request
		// data, and request data here means member names, phone numbers and
		// amounts. Off by default, and BeforeSend scrubs what is left.
		SendDefaultPII: false,
		BeforeSend:     scrub,
	})
	if err != nil {
		// A bad DSN must not stop the API booting. Members losing access to
		// their savings because error reporting was misconfigured would be a
		// worse outcome than having no error reporting.
		slog.Error("sentry init failed; continuing without error tracking", "error", err)
		return func() {}
	}

	slog.Info("error tracking enabled", "environment", environment)
	return func() { sentry.Flush(3 * time.Second) }
}

// scrub removes anything member-identifying before an event leaves the process.
func scrub(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	event.User = sentry.User{ID: event.User.ID} // keep the id, drop email/ip/name

	if event.Request != nil {
		// Query strings carry SSE tickets and reset tokens; cookies carry
		// sessions; headers carry the bearer token.
		event.Request.QueryString = ""
		event.Request.Cookies = ""
		event.Request.Data = ""
		event.Request.Headers = nil
	}
	return event
}

// Recoverer reports a panic to Sentry and re-panics so chi's own Recoverer
// still turns it into a 500.
//
// Register it INSIDE chi's Recoverer. The ordering matters and is easy to get
// backwards: chi's Recoverer stops the panic, so anything outside it never sees
// one. This must be the inner wrapper to observe the panic at all (RUN-08).
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				hub := sentry.CurrentHub().Clone()
				hub.Scope().SetRequest(r)
				hub.Recover(rec)
				hub.Flush(2 * time.Second)
				panic(rec)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// CaptureError reports a handled error — one that did not panic but that
// someone should look at, such as a money posting that failed to commit.
func CaptureError(err error, tags map[string]string) {
	if err == nil {
		return
	}
	sentry.WithScope(func(scope *sentry.Scope) {
		for k, v := range tags {
			scope.SetTag(k, v)
		}
		sentry.CaptureException(err)
	})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
