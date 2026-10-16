//go:build integration

// TEST-17 (response shape) and TEST-18 (hostile input), over TEST-15's route table.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// ---------------------------------------------------------------------------
// TEST-17 — response shape
// ---------------------------------------------------------------------------

// secretKeys must never appear in a response body, at any depth.
var secretKeys = map[string]string{
	"passwordhash":    "the bcrypt hash; enough to attack offline",
	"password":        "never a response field under any circumstance",
	"currentpassword": "echoing a submitted password back is how it reaches logs",
	"newpassword":     "as above",
	"tokenhash":       "the blacklist key; disclosing it enables targeted revocation",
	"resettoken":      "a password-reset token is a live credential",
	"temppassword":    "a generated first-login password",
	"jwtsecret":       "the signing key",
	"databaseurl":     "credentials in a connection string",
}

// scanJSON walks a decoded body and reports every forbidden key it finds,
// with the path it was found at.
func scanJSON(t *testing.T, node any, path string, found *[]string) {
	t.Helper()
	switch v := node.(type) {
	case map[string]any:
		for key, child := range v {
			if reason, bad := secretKeys[strings.ToLower(key)]; bad {
				*found = append(*found, fmt.Sprintf("%s.%s (%s)", path, key, reason))
			}
			scanJSON(t, child, path+"."+key, found)
		}
	case []any:
		for i, child := range v {
			scanJSON(t, child, fmt.Sprintf("%s[%d]", path, i), found)
		}
	}
}

func TestNoResponseLeaksACredential(t *testing.T) {
	r := testRouter(t)
	// SUPER_ADMIN sees the most, so it is the token most likely to be handed a
	// field that should never have left the database.
	token := tokenFor(t, "SUPER_ADMIN")

	for _, key := range walkRoutes(t, r) {
		method, pattern, _ := strings.Cut(key, " ")
		if method != http.MethodGet {
			continue // a write's response is covered by the read that follows it
		}
		t.Run(key, func(t *testing.T) {
			rec := do(t, r, method, pattern, token)
			var body any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				return // not JSON (SSE, empty); nothing to scan
			}
			var found []string
			scanJSON(t, body, "$", &found)
			if len(found) > 0 {
				t.Fatalf("response leaks credential material: %s", strings.Join(found, "; "))
			}
		})
	}
}

// TestEveryResponseIsTheEnvelope: `{success, data, error, meta}` on every route.
func TestEveryResponseIsTheEnvelope(t *testing.T) {
	r := testRouter(t)
	token := tokenFor(t, "SUPER_ADMIN")

	for _, key := range walkRoutes(t, r) {
		method, pattern, _ := strings.Cut(key, " ")
		if method != http.MethodGet || strings.HasSuffix(pattern, "/support/stream") {
			continue
		}
		t.Run(key, func(t *testing.T) {
			rec := do(t, r, method, pattern, token)
			var envelope map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("body is not a JSON object: %v — %s", err, rec.Body.String())
			}
			if _, ok := envelope["success"]; !ok {
				t.Errorf("response has no `success` field: %s", rec.Body.String())
			}
			if rec.Code >= 400 {
				if _, ok := envelope["error"]; !ok {
					t.Errorf("a %d response carries no `error` object: %s", rec.Code, rec.Body.String())
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// TEST-18 — hostile input
// ---------------------------------------------------------------------------

// hostileBodies must never produce a 5xx.
var hostileBodies = []struct {
	name string
	body string
	ct   string
}{
	{"empty body", "", "application/json"},
	{"not JSON at all", "<html></html>", "application/json"},
	{"JSON null", "null", "application/json"},
	{"JSON array where an object belongs", "[1,2,3]", "application/json"},
	{"JSON string where an object belongs", `"amount"`, "application/json"},
	{"truncated JSON", `{"amount": 100`, "application/json"},
	{"trailing garbage after a valid object", `{"amount":1} DROP TABLE users`, "application/json"},
	{"duplicate keys", `{"amount": 1, "amount": 999999999}`, "application/json"},
	{"prototype pollution", `{"__proto__": {"role": "SUPER_ADMIN"}, "amount": 1}`, "application/json"},
	{"constructor pollution", `{"constructor": {"prototype": {"role": "ADMIN"}}}`, "application/json"},
	{"SQL metacharacters in every string", `{"notes":"'; DROP TABLE users; --","purpose":"' OR '1'='1","threadId":"'"}`, "application/json"},
	// Bidi overrides and combining marks, written as escapes on purpose.
	{"RTL and combining marks", "{\"notes\":\"\u202eevil\u202c\u0301\u0301\u0301\",\"nameEn\":\"عربى\"}", "application/json"},
	{"NUL byte in a string", "{\"notes\":\"a\x00b\"}", "application/json"},
	// The escaped form is *valid* JSON, so encoding/json decodes it into a Go
	// string containing U+0000 — which PostgreSQL text cannot store.
	{"escaped NUL in a string", `{"notes":"a\u0000b","donorName":"x\u0000y","threadId":"\u0000"}`, "application/json"},
	{"amount as a string", `{"amount":"100"}`, "application/json"},
	{"amount as a float", `{"amount":100.5}`, "application/json"},
	{"amount beyond int64", `{"amount":99999999999999999999999}`, "application/json"},
	{"negative amount", `{"amount":-1000}`, "application/json"},
	{"wrong content type", `{"amount":1}`, "text/plain"},
	{"no content type", `{"amount":1}`, ""},
	{"form encoding", `amount=1&notes=x`, "application/x-www-form-urlencoded"},
}

// deepJSON nests `depth` levels — the parser stack-overflow shape.
func deepJSON(depth int) string {
	return strings.Repeat(`{"a":`, depth) + `1` + strings.Repeat(`}`, depth)
}

func TestWriteRoutesSurviveHostileBodies(t *testing.T) {
	r := testRouter(t)
	// ADMIN, so the body reaches parsing rather than stopping at 401.
	token := tokenFor(t, "ADMIN")

	for _, key := range walkRoutes(t, r) {
		method, pattern, _ := strings.Cut(key, " ")
		switch method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
		default:
			continue
		}
		// Skipped: bcrypt per call makes this minutes long for no extra signal.
		if strings.Contains(pattern, "/auth/") || strings.Contains(pattern, "/password") {
			continue
		}

		for _, hb := range hostileBodies {
			t.Run(key+"/"+hb.name, func(t *testing.T) {
				rec := post(t, r, method, pattern, token, hb.body, hb.ct)
				if rec.Code >= 500 {
					t.Fatalf("hostile body produced %d — it should be refused, not crash the handler.\nbody sent: %s\nresponse: %s",
						rec.Code, hb.body, strings.TrimSpace(rec.Body.String()))
				}
			})
		}

		t.Run(key+"/deeply nested JSON", func(t *testing.T) {
			rec := post(t, r, method, pattern, token, deepJSON(20000), "application/json")
			if rec.Code >= 500 {
				t.Fatalf("20k-deep JSON produced %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
			}
		})

		t.Run(key+"/oversized body", func(t *testing.T) {
			// Comfortably past MaxRequestBodySize. The LimitReader in
			// utils.ParseJSON should make this a parse failure, not an OOM.
			huge := `{"notes":"` + strings.Repeat("A", 4<<20) + `"}`
			rec := post(t, r, method, pattern, token, huge, "application/json")
			if rec.Code >= 500 {
				t.Fatalf("4 MB body produced %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}

// TestReadRoutesSurviveHostileQueryStrings: unvalidated query parameters.
func TestReadRoutesSurviveHostileQueryStrings(t *testing.T) {
	r := testRouter(t)
	token := tokenFor(t, "ADMIN")

	hostileQueries := []string{
		"?threadId=%27%20OR%20%271%27%3D%271",
		"?threadId=" + strings.Repeat("A", 10000),
		"?month=0&year=-1",
		"?month=13&year=99999999999999999999",
		"?month=NaN&year=undefined",
		"?limit=-1&offset=-1",
		"?limit=999999999999",
		"?threadId=%00",
		"?threadId=%e2%80%ae",
		"?a=1&a=2&a=3",
	}

	for _, key := range walkRoutes(t, r) {
		method, pattern, _ := strings.Cut(key, " ")
		if method != http.MethodGet || strings.HasSuffix(pattern, "/support/stream") {
			continue
		}
		for _, q := range hostileQueries {
			t.Run(key+"/"+q, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				req := httptest.NewRequestWithContext(ctx, method, concreteURL(pattern)+q, nil)
				req.Header.Set("Authorization", "Bearer "+token)
				rec := httptest.NewRecorder()
				r.ServeHTTP(rec, req)
				if rec.Code >= 500 {
					t.Fatalf("query %s produced %d: %s", q, rec.Code, strings.TrimSpace(rec.Body.String()))
				}
			})
		}
	}
}

// post is `do` with an explicit body and content type.
func post(t *testing.T, r chi.Router, method, pattern, token, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req := httptest.NewRequestWithContext(ctx, method, concreteURL(pattern), bytes.NewReader([]byte(body)))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}
