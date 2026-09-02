// Package observability wires error reporting.
//
// The whole package is a no-op when SENTRY_DSN is unset, which is the normal
// state locally and in CI. Nothing here should ever be load-bearing: if error
// reporting is down, the API keeps serving.
package observability

import (
	"context"
	"errors"
	"fmt"
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

	// Route every slog record at Error level to Sentry. Without this the only
	// thing that can reach Sentry from this API is a panic — and this API does
	// not panic, because every failure is an error value returned up to a
	// handler that answers 4xx or 5xx (rule 2b). That is exactly the state it
	// was in from the day the DSN was first set: correctly configured, and
	// silent, because nothing ever called the reporter.
	slog.SetDefault(slog.New(sentryHandler{inner: slog.Default().Handler()}))

	slog.Info("error tracking enabled", "environment", environment)
	return Flush
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

// Flush drains buffered events, and must be called before any os.Exit.
//
// Sentry's transport is asynchronous and os.Exit skips deferred functions, so
// without this the fatal errors — the database being unreachable, the port
// being taken, the ones you would most want to see — are precisely the ones
// that never arrive. A no-op when no client is configured.
func Flush() { sentry.Flush(3 * time.Second) }

// SkipKey marks a log record that must not become a Sentry event.
//
// One record needs it: the access log's 5xx line. That line is telemetry, not a
// fault — the handler which produced the 500 has already logged the cause with
// the error attached — so without this every server error would arrive twice,
// once usefully and once inside a single enormous "http_request" issue.
const SkipKey = "sentrySkip"

// sentryHandler forwards Error-level slog records to Sentry and then passes
// them to the real handler unchanged.
//
// A bridge rather than a call at each site, because there are fifty of those
// and the fifty-first would be written by someone who did not know this file
// exists. It also means the reporting rule is stated once: **if it was worth
// logging at Error, it is worth an alert.**
type sentryHandler struct {
	inner slog.Handler
	// Attributes fixed by With() before the record was made. Collected so a
	// logger built with slog.Default().With("job", "reconcile") still tags its
	// events with the job.
	attrs []slog.Attr
}

func (h sentryHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h sentryHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return sentryHandler{
		inner: h.inner.WithAttrs(attrs),
		attrs: append(append([]slog.Attr{}, h.attrs...), attrs...),
	}
}

func (h sentryHandler) WithGroup(name string) slog.Handler {
	return sentryHandler{inner: h.inner.WithGroup(name), attrs: h.attrs}
}

func (h sentryHandler) Handle(ctx context.Context, record slog.Record) error {
	if record.Level >= slog.LevelError {
		capture(record, h.attrs)
	}
	// Reported or not, the line still goes to stdout. Sentry being down, over
	// quota, or misconfigured must never cost us the log.
	return h.inner.Handle(ctx, record)
}

// capture turns one log record into one Sentry event.
func capture(record slog.Record, preset []slog.Attr) {
	var cause error
	extra := make(map[string]any)
	skip := false

	collect := func(attr slog.Attr) {
		value := attr.Value.Resolve()
		switch attr.Key {
		case SkipKey:
			skip = true
		case "error":
			// slog stores an error as its string once it has been through a
			// JSON handler, so accept either shape.
			if err, ok := value.Any().(error); ok {
				cause = err
			} else if text := value.String(); text != "" {
				cause = errors.New(text)
			}
		default:
			extra[attr.Key] = value.Any()
		}
	}

	for _, attr := range preset {
		collect(attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		collect(attr)
		return true
	})

	if skip {
		return
	}

	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		// One context block rather than a tag each: tags are indexed and
		// low-cardinality by design, and these carry request ids and amounts.
		if len(extra) > 0 {
			scope.SetContext("log", sentry.Context(extra))
		}
		if cause == nil {
			// "ledger drift" and the boot-time configuration failures carry no
			// error value, and they are among the most important events here.
			sentry.CaptureMessage(record.Message)
			return
		}
		// Wrapped so the issue title is the sentence a human wrote rather than
		// whatever pgx called the connection failure — grouping follows the
		// title, and "failed to post deposit" is the useful grouping.
		sentry.CaptureException(fmt.Errorf("%s: %w", record.Message, cause))
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
