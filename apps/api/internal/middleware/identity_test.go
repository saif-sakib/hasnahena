package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// WO-78: only a verified token attributes a request to a member.
func TestIdentityOnlyAttributesVerifiedTokens(t *testing.T) {
	verify := func(token string) (string, bool) {
		if token == "good" {
			return "member-1", true
		}
		return "", false
	}

	tests := []struct {
		name       string
		authHeader string
		want       string
	}{
		{name: "no header at all", authHeader: "", want: ""},
		{name: "a verified token", authHeader: "Bearer good", want: "member-1"},
		{
			// RFC 7235 makes the scheme case-insensitive, and a client that
			// sends "bearer" is not an attacker — it is a client.
			name:       "lowercase scheme",
			authHeader: "bearer good",
			want:       "member-1",
		},
		{name: "surrounding whitespace", authHeader: "Bearer   good  ", want: "member-1"},
		{
			// A forged token must leave the request anonymous.
			name:       "a token that does not verify",
			authHeader: "Bearer forged",
			want:       "",
		},
		{name: "the wrong scheme", authHeader: "Basic good", want: ""},
		{name: "the scheme with no token", authHeader: "Bearer", want: ""},
		{name: "a bare token with no scheme", authHeader: "good", want: ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var seen string
			handler := Identity(verify)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				seen = RequestUserID(r)
			}))

			req := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			handler.ServeHTTP(httptest.NewRecorder(), req)

			if seen != tc.want {
				t.Fatalf("RequestUserID = %q, want %q", seen, tc.want)
			}
		})
	}
}

// An empty subject is ignored, or every such caller would share one bucket.
func TestIdentityIgnoresAnEmptySubject(t *testing.T) {
	verify := func(string) (string, bool) { return "", true }

	var seen string
	handler := Identity(verify)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = RequestUserID(r)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
	req.Header.Set("Authorization", "Bearer whatever")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if seen != "" {
		t.Fatalf("RequestUserID = %q, want empty", seen)
	}
}

// Without the middleware, RequestUserID is "" rather than a panic.
func TestRequestUserIDIsEmptyWithoutTheMiddleware(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
	req.Header.Set("Authorization", "Bearer good")

	if got := RequestUserID(req); got != "" {
		t.Fatalf("RequestUserID = %q, want empty: the value must come from the "+
			"middleware, never from the header directly", got)
	}
}

// Identity with no verifier is the pre-WO-78 stack, and it must pass requests
// through untouched rather than panicking.
func TestIdentityWithoutAVerifierIsANoOp(t *testing.T) {
	called := false
	handler := Identity(nil)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		if got := RequestUserID(r); got != "" {
			t.Fatalf("RequestUserID = %q, want empty", got)
		}
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/anything", nil)
	req.Header.Set("Authorization", "Bearer good")
	handler.ServeHTTP(httptest.NewRecorder(), req)

	if !called {
		t.Fatal("the next handler was not reached")
	}
}
