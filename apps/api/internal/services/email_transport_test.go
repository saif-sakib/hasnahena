package services

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// WO-62 — the transport, as opposed to the rendering that WO-52 covered.
//
// The defect was arithmetic, not logic: three attempts against a 12-second
// client with a 1.5-second sleep between them is a 39-second synchronous call
// inside an HTTP handler, and SERVER_SHUTDOWN_TIMEOUT is 30. A deploy landing
// during a slow Brevo call was a SIGKILL mid-request.
//
// None of these tests waits out a real timeout. The service's timings are
// fields so a test can run the same code paths in milliseconds; the one test
// that uses the real constants only does arithmetic on them.

// newTestEmailService points the service at a stub and shrinks its clocks.
func newTestEmailService(t *testing.T, handler http.HandlerFunc) (*EmailService, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	svc := NewEmailService(EmailConfig{
		BrevoAPIKey:  "test-key",
		BrevoBaseURL: server.URL,
		From:         "info@hasnahenafoundation.test",
		FromName:     "Hasnahena",
		AppURL:       "https://hasnahena.test",
	})
	svc.sendBudget = 400 * time.Millisecond
	svc.attemptTimeout = 100 * time.Millisecond
	svc.retryBackoff = 10 * time.Millisecond
	svc.client.Timeout = svc.sendBudget
	return svc, server
}

// hangUntilTheClientGivesUp is a Brevo that accepts the connection and then says
// nothing — the failure shape WO-62 is about, since a hang is what spends a
// timeout budget where an error would not.
//
// It drains the request body first, deliberately. net/http learns that the peer
// has gone from a read on the connection, and an unread request body is what
// that read returns instead; leave it unread and the handler sits well past the
// client's cancellation, which makes httptest.Server.Close block with it. The
// second arm is a backstop so a mistake here fails a test rather than hanging
// the suite.
func hangUntilTheClientGivesUp(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	select {
	case <-r.Context().Done():
	case <-time.After(3 * time.Second):
	}
}

func send(svc *EmailService) error {
	return svc.sendWithRetry(context.Background(), "member@example.test", "Subject", "text body", "<p>html body</p>")
}

// The invariant the order was written about. Real constants, no network: if
// someone raises the budget past the drain, or shortens the drain, this is what
// says so — rather than a member's approval being SIGKILLed mid-flight on the
// next deploy.
func TestTheWorstCaseFitsInsideTheShutdownDrain(t *testing.T) {
	// config.go: getEnvDuration("SERVER_SHUTDOWN_TIMEOUT", 30*time.Second).
	const shutdownDefault = 30 * time.Second

	if brevoSendBudget >= shutdownDefault {
		t.Fatalf("email budget %s does not fit inside the %s shutdown drain", brevoSendBudget, shutdownDefault)
	}
	// Leave the drain most of its time: the email is not the only thing that has
	// to finish, and a request that only just fits is not a margin.
	if brevoSendBudget > shutdownDefault/2 {
		t.Errorf("email budget %s takes more than half the %s drain", brevoSendBudget, shutdownDefault)
	}
	if brevoAttemptTimeout > brevoSendBudget {
		t.Errorf("one attempt (%s) may outlast the whole budget (%s)", brevoAttemptTimeout, brevoSendBudget)
	}
}

func TestASuccessfulSendMakesOneRequest(t *testing.T) {
	var calls int32
	var gotKey string
	var gotBody string

	svc, _ := newTestEmailService(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		gotKey = r.Header.Get("api-key")
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.WriteHeader(http.StatusCreated)
	})

	if err := send(svc); err != nil {
		t.Fatalf("send: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("made %d requests, want 1", got)
	}
	if gotKey != "test-key" {
		t.Errorf("api-key header was %q", gotKey)
	}
	if !strings.Contains(gotBody, "member@example.test") {
		t.Errorf("payload did not carry the recipient: %s", gotBody)
	}
}

// A Brevo that accepts the connection and then says nothing. This is the shape
// of the failure that mattered: not an error, a hang.
func TestASlowBrevoIsAbandonedWhenTheBudgetRunsOut(t *testing.T) {
	svc, _ := newTestEmailService(t, hangUntilTheClientGivesUp)

	start := time.Now()
	err := send(svc)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("a hung Brevo produced no error")
	}
	// The budget plus slack for scheduling; the point is that it is bounded at
	// all, and bounded by the budget rather than by attempts × client timeout.
	if elapsed > svc.sendBudget+2*time.Second {
		t.Errorf("took %s, which is past the %s budget", elapsed, svc.sendBudget)
	}
}

// The reason attempts are bounded separately from the sequence. With only an
// outer budget, the first hung connection eats all of it and the retries that
// exist for exactly this case never run.
func TestAHungAttemptDoesNotConsumeEveryRetry(t *testing.T) {
	var calls int32
	svc, _ := newTestEmailService(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		hangUntilTheClientGivesUp(w, r)
	})

	if err := send(svc); err == nil {
		t.Fatal("expected an error")
	}
	if got := atomic.LoadInt32(&calls); got < 2 {
		t.Errorf("only %d attempt(s) reached the server; the per-attempt timeout is not bounding anything", got)
	}
}

func TestRetriesStopAtTheAttemptLimit(t *testing.T) {
	var calls int32
	svc, _ := newTestEmailService(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":"unauthorized","message":"key rejected"}`))
	})

	err := send(svc)
	if err == nil {
		t.Fatal("expected an error")
	}
	if got := atomic.LoadInt32(&calls); got != brevoRetryAttempts {
		t.Errorf("made %d attempts, want %d", got, brevoRetryAttempts)
	}
	// Brevo's own words survive to the caller: the handler puts this in front of
	// an admin, and "failed to send" alone has never told anyone what to fix.
	if !strings.Contains(err.Error(), "key rejected") {
		t.Errorf("error lost the upstream message: %v", err)
	}
}

// Pins the deliberate context.WithoutCancel in sendWithRetry.
//
// Both cancellations a request context carries would do harm. The approval has
// already committed by the time this runs, and the HTTP response is what
// carries the temporary password — so if the admin's browser has gone, this
// email is the only way the member will ever receive it. A test, because
// "ctx is not used for cancellation" reads like an oversight and would be
// tidied up by the next person through.
func TestTheCallersCancellationDoesNotCancelTheSend(t *testing.T) {
	var calls int32
	svc, _ := newTestEmailService(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusCreated)
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := svc.sendWithRetry(ctx, "member@example.test", "Subject", "text", "<p>html</p>"); err != nil {
		t.Fatalf("an already-cancelled caller stopped the send: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("made %d requests, want 1", got)
	}
}

func TestAnUnconfiguredServiceDoesNotReachTheNetwork(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
	}))
	t.Cleanup(server.Close)

	svc := NewEmailService(EmailConfig{BrevoBaseURL: server.URL})
	if err := send(svc); err == nil {
		t.Fatal("an unconfigured service reported success")
	}
	if got := atomic.LoadInt32(&calls); got != 0 {
		t.Errorf("made %d requests with no API key", got)
	}
}
