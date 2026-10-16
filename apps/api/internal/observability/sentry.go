// Package observability wires error reporting. A no-op without SENTRY_DSN, and
// never load-bearing.
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

// Init starts Sentry if configured. Defer the returned flush from main.
func Init(environment string) func() {
	dsn := strings.TrimSpace(os.Getenv("SENTRY_DSN"))
	if dsn == "" {
		slog.Info("error tracking disabled: set SENTRY_DSN to enable Sentry")
		return func() {}
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:         dsn,
		Environment: environment,
		// Render sets RENDER_GIT_COMMIT itself.
		Release: firstNonEmpty(os.Getenv("SENTRY_RELEASE"), os.Getenv("RENDER_GIT_COMMIT"), "dev"),
		// Errors only; tracing burns the free quota.
		EnableTracing: false,
		// Member data must not leak; BeforeSend scrubs the rest.
		SendDefaultPII: false,
		BeforeSend:     scrub,
	})
	if err != nil {
		// A bad DSN must not stop the API booting.
		slog.Error("sentry init failed; continuing without error tracking", "error", err)
		return func() {}
	}

	// Route every Error-level slog record to Sentry — this API returns errors
	// rather than panicking, so otherwise nothing would ever be reported.
	slog.SetDefault(slog.New(sentryHandler{inner: slog.Default().Handler()}))

	slog.Info("error tracking enabled", "environment", environment)
	return Flush
}

// scrub removes anything member-identifying before an event leaves the process.
func scrub(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	event.User = sentry.User{ID: event.User.ID} // keep the id, drop email/ip/name

	if event.Request != nil {
		// Query strings carry SSE tickets and reset tokens; headers carry tokens.
		event.Request.QueryString = ""
		event.Request.Cookies = ""
		event.Request.Data = ""
		event.Request.Headers = nil
	}
	return event
}

// Recoverer reports a panic and re-panics. Register it INSIDE chi's Recoverer,
// or it never sees one (RUN-08).
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

// Flush drains buffered events; call before any os.Exit.
func Flush() { sentry.Flush(3 * time.Second) }

// SkipKey marks a log record that must not become a Sentry event (the access
// log's 5xx line — the handler already reported the cause).
const SkipKey = "sentrySkip"

// sentryHandler forwards Error-level slog records to Sentry, then to the real
// handler: if it was worth logging at Error, it is worth an alert.
type sentryHandler struct {
	inner slog.Handler
	// Attributes fixed by With(), so job tags reach the event.
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
	// Always still logged, whatever Sentry does.
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
			// After a JSON handler an error is stored as its string.
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
		// One context block: tags are indexed and must be low-cardinality.
		if len(extra) > 0 {
			scope.SetContext("log", sentry.Context(extra))
		}
		if cause == nil {
			// e.g. ledger drift carries no error value.
			sentry.CaptureMessage(record.Message)
			return
		}
		// The human message is the issue title, so grouping is meaningful.
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
