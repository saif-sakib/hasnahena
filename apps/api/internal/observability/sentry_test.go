package observability

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
)

// recordingTransport keeps every event instead of sending it.
type recordingTransport struct {
	mu     sync.Mutex
	events []*sentry.Event
}

func (t *recordingTransport) Configure(sentry.ClientOptions)        {}
func (t *recordingTransport) Flush(time.Duration) bool              { return true }
func (t *recordingTransport) FlushWithContext(context.Context) bool { return true }
func (t *recordingTransport) Close()                                {}
func (t *recordingTransport) SendEvent(event *sentry.Event) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.events = append(t.events, event)
}

func (t *recordingTransport) captured() []*sentry.Event {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]*sentry.Event{}, t.events...)
}

// withSentry binds a client that records rather than sends, for the duration of
// one test. Not parallel: sentry's current hub is a process-wide global.
func withSentry(t *testing.T) (*slog.Logger, *recordingTransport) {
	t.Helper()

	transport := &recordingTransport{}
	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:        "https://public@example.invalid/1",
		Transport:  transport,
		BeforeSend: scrub,
	})
	if err != nil {
		t.Fatalf("sentry.NewClient: %v", err)
	}

	previous := sentry.CurrentHub().Client()
	sentry.CurrentHub().BindClient(client)
	t.Cleanup(func() { sentry.CurrentHub().BindClient(previous) })

	// A discarding inner handler at Debug, so the bridge sees every level.
	inner := slog.NewJSONHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(sentryHandler{inner: inner}), transport
}

// The whole point of the bridge: an error logged by a handler becomes an alert
// without that handler knowing Sentry exists. Before it, the only path to
// Sentry was a panic, and this API answers errors instead of panicking — so
// fifty slog.Error sites reported nothing for as long as the DSN had been set.
func TestErrorLogBecomesASentryEvent(t *testing.T) {
	log, transport := withSentry(t)

	log.Error("failed to post deposit", "error", errors.New("connection refused"), "userId", "ACC-KH-33001")

	events := transport.captured()
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	if len(events[0].Exception) == 0 {
		t.Fatal("want an exception, got none")
	}
	// sentry-go unwraps the chain and reports it root-cause first, so the
	// wrapper — the sentence a person wrote — is last, and that is the one the
	// issue is titled and grouped by.
	outermost := events[0].Exception[len(events[0].Exception)-1]
	if outermost.Value != "failed to post deposit: connection refused" {
		t.Errorf("exception value = %q", outermost.Value)
	}
	if events[0].Contexts["log"]["userId"] != "ACC-KH-33001" {
		t.Errorf("context lost the userId: %v", events[0].Contexts["log"])
	}
}

// "ledger drift" is the single most important line this API can log and it
// carries no error value — reporting only records with an `error` attribute
// would silently drop it.
func TestAnErrorLogWithNoErrorValueStillReports(t *testing.T) {
	log, transport := withSentry(t)

	log.Error("ledger drift", "accounts", 3)

	events := transport.captured()
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	if events[0].Message != "ledger drift" {
		t.Errorf("message = %q", events[0].Message)
	}
}

// The access log writes a 5xx line at Error level. It must not double-report:
// the handler already logged the cause, and one issue holding every 500 the API
// has ever served is worse than useless.
func TestTheSkipMarkerSuppressesTheEvent(t *testing.T) {
	log, transport := withSentry(t)

	log.Error("http_request", "status", 500, "path", "/v1/dashboard/member", SkipKey, true)

	if events := transport.captured(); len(events) != 0 {
		t.Fatalf("want 0 events, got %d", len(events))
	}
}

func TestLevelsBelowErrorDoNotReport(t *testing.T) {
	log, transport := withSentry(t)

	log.Info("api server listening", "port", 8081)
	log.Warn("rate limit hit", "ip", "203.0.113.9")
	log.Debug("pool stats", "idle", 1)

	if events := transport.captured(); len(events) != 0 {
		t.Fatalf("want 0 events, got %d", len(events))
	}
}

// A logger built with With() must not lose the attributes it was built with —
// the reconciliation job tags itself that way, and an untagged drift alert is
// one nobody can route.
func TestAttributesFixedByWithSurvive(t *testing.T) {
	log, transport := withSentry(t)

	log.With("job", "reconcile").Error("ledger drift")

	events := transport.captured()
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	if events[0].Contexts["log"]["job"] != "reconcile" {
		t.Errorf("context = %v", events[0].Contexts["log"])
	}
}

// Sentry must never be load-bearing: the line still reaches stdout whether or
// not it was reported.
func TestTheRecordStillReachesTheInnerHandler(t *testing.T) {
	seen := &countingHandler{}
	log := slog.New(sentryHandler{inner: seen})

	log.Error("failed to post deposit", "error", errors.New("boom"))
	log.Info("fine")

	if seen.count != 2 {
		t.Fatalf("inner handler saw %d records, want 2", seen.count)
	}
}

type countingHandler struct{ count int }

func (h *countingHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h *countingHandler) Handle(context.Context, slog.Record) error {
	h.count++
	return nil
}
func (h *countingHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *countingHandler) WithGroup(string) slog.Handler      { return h }
