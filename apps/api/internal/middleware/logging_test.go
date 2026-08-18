package middleware

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Verifies the things the SSE handler depends on surviving the Logging wrap.
func TestLoggingWrapperKeepsSSEContract(t *testing.T) {
	var (
		sawFlusher  bool
		deadlineErr error
		gotStatus   int
	)

	h := Logging(0)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sawFlusher = w.(http.Flusher)
		deadlineErr = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		SetRequestUserID(r.Context(), "user-123")
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("hi"))
	}))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r)
	}))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	gotStatus = resp.StatusCode

	if !sawFlusher {
		t.Error("handler lost http.Flusher through the Logging wrapper — SSE would break")
	}
	if deadlineErr != nil {
		t.Errorf("SetWriteDeadline through Unwrap failed: %v — SSE would be cut at WriteTimeout", deadlineErr)
	}
	if gotStatus != http.StatusTeapot {
		t.Errorf("status = %d, want %d", gotStatus, http.StatusTeapot)
	}
}

func TestRecorderCapturesImplicitOK(t *testing.T) {
	rec := &responseRecorder{ResponseWriter: httptest.NewRecorder()}
	if _, err := rec.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if rec.status != http.StatusOK {
		t.Errorf("implicit status = %d, want 200", rec.status)
	}
	if rec.bytes != 1 {
		t.Errorf("bytes = %d, want 1", rec.bytes)
	}
}

func TestSetRequestUserIDIsNoopWithoutMiddleware(t *testing.T) {
	// Must not panic for a request that never passed through Logging.
	SetRequestUserID(httptest.NewRequest("GET", "/", nil).Context(), "nobody")
}

// WO-60. Every `http_request` line carries an "ip", and until this change that
// was r.RemoteAddr *after* chi's RealIP had overwritten it with the leftmost
// X-Forwarded-For entry — a value the caller supplies. An access log that
// cannot be trusted to say where a request came from is not evidence, and in a
// financial system answering "who did this" is the log's whole purpose.
func TestAccessLogRecordsTheAddressTheCallerCannotChoose(t *testing.T) {
	const (
		spoofed = "1.2.3.4"
		proxy   = "203.0.113.7"
		peer    = "198.51.100.9"
	)

	tests := []struct {
		name           string
		trustedProxies int
		xff            string
		wantIP         string
		wantPeer       string
	}{
		{
			name:           "nothing in front: the header is ignored entirely",
			trustedProxies: 0,
			xff:            spoofed,
			wantIP:         peer,
			// ip and peer agree, so the line carries no separate peer field.
			wantPeer: "",
		},
		{
			name:           "one proxy: the entry the proxy appended, and the peer alongside",
			trustedProxies: 1,
			xff:            spoofed + ", " + proxy,
			wantIP:         proxy,
			wantPeer:       peer,
		},
		{
			name:           "no header at all",
			trustedProxies: 1,
			xff:            "",
			wantIP:         peer,
			wantPeer:       "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			restore := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
			defer slog.SetDefault(restore)

			var seenByHandler string
			h := Logging(tc.trustedProxies)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seenByHandler = RequestClientIP(r)
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodPost, "/v1/anything", nil)
			req.RemoteAddr = peer + ":54321"
			if tc.xff != "" {
				req.Header.Set("X-Forwarded-For", tc.xff)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)

			var line map[string]any
			if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line); err != nil {
				t.Fatalf("access log is not JSON: %v (%q)", err, buf.String())
			}

			if got := line["ip"]; got != tc.wantIP {
				t.Errorf("logged ip = %v, want %v", got, tc.wantIP)
			}
			if tc.wantPeer == "" {
				if _, ok := line["peer"]; ok {
					t.Errorf("peer logged when it equals ip: %v", line["peer"])
				}
			} else if got := line["peer"]; got != tc.wantPeer {
				t.Errorf("logged peer = %v, want %v", got, tc.wantPeer)
			}

			// A handler writing an audit row must name the same caller the log
			// does. Two answers to "who did this" is worse than one.
			if seenByHandler != tc.wantIP {
				t.Errorf("RequestClientIP = %q, want %q — the handler and the log disagree", seenByHandler, tc.wantIP)
			}

			if tc.trustedProxies == 0 && strings.Contains(buf.String(), spoofed) {
				t.Errorf("the caller-supplied address reached the access log: %s", buf.String())
			}
		})
	}
}

// A request that never passed through Logging still has to answer, and has to
// answer with the peer rather than with a header.
func TestRequestClientIPFallsBackToThePeer(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/anything", nil)
	req.RemoteAddr = "198.51.100.9:1234"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")

	if got := RequestClientIP(req); got != "198.51.100.9" {
		t.Fatalf("RequestClientIP = %q, want the peer", got)
	}
}
