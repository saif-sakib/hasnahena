package middleware

import (
	"net/http"
	"net/http/httptest"
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

	h := Logging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
