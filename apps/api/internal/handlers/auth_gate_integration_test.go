//go:build integration

// TEST-02 / TEST-08 — the HTTP authorization boundary: a route group behind
// RequireRoles is protected by where it is mounted (SEC-02).

package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hasnahena/apps/api/internal/repositories"
	"hasnahena/apps/api/internal/services"
)

const testJWTSecret = "test-secret-at-least-thirty-two-characters"

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		// A skip, not a red build, for anyone without a database.
		os.Exit(0)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		panic("bad TEST_DATABASE_URL: " + err.Error())
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"

	testPool, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		panic("cannot connect to TEST_DATABASE_URL: " + err.Error())
	}
	if err := testPool.Ping(ctx); err != nil {
		panic("cannot ping TEST_DATABASE_URL: " + err.Error())
	}

	os.Setenv("JWT_SECRET", testJWTSecret)
	code := m.Run()
	testPool.Close()
	os.Exit(code)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// newGate builds the same middleware main.go mounts, over a real database.
func newGate(t *testing.T) *DashboardHandler {
	t.Helper()
	userRepo := repositories.NewUserRepository(testPool)
	securityService := services.NewSecurityService(testPool)
	authService := services.NewAuthService(userRepo, securityService, nil, testJWTSecret, 3600)
	return NewDashboardHandler(authService, securityService, userRepo, nil)
}

// seedUser creates a user with a known role and status and removes it afterwards.
func seedUser(t *testing.T, role, status string) string {
	t.Helper()
	ctx := context.Background()
	id := fmt.Sprintf("gate-%s-%d", role, time.Now().UnixNano())
	phone := fmt.Sprintf("019%08d", time.Now().UnixNano()%100000000)

	_, err := testPool.Exec(ctx, `
		INSERT INTO users (id, phone, email, "passwordHash", role, status,
		                   "nameEn", "fatherName", "motherName", "createdAt", "updatedAt")
		VALUES ($1, $2, $3, 'x', $4::"UserRole", $5::"UserStatus", 'Gate Test', 'F', 'M', NOW(), NOW())
	`, id, phone, id+"@test.local", role, status)
	if err != nil {
		t.Fatalf("seed %s/%s: %v", role, status, err)
	}
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// mintToken signs a token the same shape the login endpoint issues.
func mintToken(t *testing.T, userID, role string, exp time.Time) string {
	t.Helper()
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"sub":  userID,
		"role": role,
		"iat":  time.Now().Unix(),
		"exp":  exp.Unix(),
	})
	payload := b64(claims)
	mac := hmac.New(sha256.New, []byte(testJWTSecret))
	mac.Write([]byte(header + "." + payload))
	return header + "." + payload + "." + b64(mac.Sum(nil))
}

// call runs a request through a route mounted behind RequireRoles and reports
// the status. The handler answers 200, so any other status came from the gate.
func call(t *testing.T, h *DashboardHandler, authHeader string, roles ...string) int {
	t.Helper()
	r := chi.NewRouter()
	r.Group(func(protected chi.Router) {
		protected.Use(h.RequireRoles(roles...))
		protected.Get("/protected", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code
}

func bearer(token string) string { return "Bearer " + token }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestGateRejectsMissingAndMalformedCredentials(t *testing.T) {
	h := newGate(t)
	admin := seedUser(t, "ADMIN", "ACTIVE")

	// A valid token without the "Bearer " scheme must fail (minted, not pasted,
	// so no JWT literal trips gitleaks).
	valid := mintToken(t, admin, "ADMIN", time.Now().Add(time.Hour))

	cases := []struct {
		name   string
		header string
	}{
		{"no header at all", ""},
		{"empty bearer", "Bearer "},
		{"wrong scheme", "Basic dXNlcjpwYXNz"},
		{"valid token but no scheme", valid},
		{"not a JWT", "Bearer nonsense"},
		{"two dots, junk payload", "Bearer a.b.c"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := call(t, h, tc.header, "ADMIN"); got != http.StatusUnauthorized {
				t.Fatalf("want 401, got %d", got)
			}
		})
	}
}

func TestGateRejectsForgedAndExpiredTokens(t *testing.T) {
	h := newGate(t)
	admin := seedUser(t, "ADMIN", "ACTIVE")

	t.Run("signed with the wrong secret", func(t *testing.T) {
		// Mint with a different secret by temporarily swapping it out.
		original := os.Getenv("JWT_SECRET")
		os.Setenv("JWT_SECRET", "a-completely-different-secret-value")
		forged := mintTokenWith(t, "a-completely-different-secret-value", admin, "ADMIN", time.Now().Add(time.Hour))
		os.Setenv("JWT_SECRET", original)

		if got := call(t, h, bearer(forged), "ADMIN"); got != http.StatusUnauthorized {
			t.Fatalf("a token signed with the wrong secret must not authenticate; got %d", got)
		}
	})

	t.Run("expired", func(t *testing.T) {
		expired := mintToken(t, admin, "ADMIN", time.Now().Add(-time.Hour))
		if got := call(t, h, bearer(expired), "ADMIN"); got != http.StatusUnauthorized {
			t.Fatalf("want 401 for an expired token, got %d", got)
		}
	})
}

func TestGateEnforcesRoleSeparation(t *testing.T) {
	h := newGate(t)

	member := seedUser(t, "MEMBER", "ACTIVE")
	worker := seedUser(t, "WORKER", "ACTIVE")
	admin := seedUser(t, "ADMIN", "ACTIVE")

	// The matrix that matters: every role against every gate. A missing row
	// here is how a privilege boundary goes unnoticed.
	users := map[string]string{"MEMBER": member, "WORKER": worker, "ADMIN": admin}
	gates := map[string][]string{
		"member-only": {"MEMBER"},
		"worker-only": {"WORKER"},
		"admin-only":  {"ADMIN", "SUPER_ADMIN"},
		"staff":       {"WORKER", "ADMIN", "SUPER_ADMIN"},
	}
	allowed := map[string]map[string]bool{
		"member-only": {"MEMBER": true, "WORKER": false, "ADMIN": false},
		"worker-only": {"MEMBER": false, "WORKER": true, "ADMIN": false},
		"admin-only":  {"MEMBER": false, "WORKER": false, "ADMIN": true},
		"staff":       {"MEMBER": false, "WORKER": true, "ADMIN": true},
	}

	for gateName, roles := range gates {
		for role, id := range users {
			t.Run(gateName+"/"+role, func(t *testing.T) {
				token := mintToken(t, id, role, time.Now().Add(time.Hour))
				got := call(t, h, bearer(token), roles...)

				want := http.StatusForbidden
				if allowed[gateName][role] {
					want = http.StatusOK
				}
				if got != want {
					t.Fatalf("%s calling %s: want %d, got %d", role, gateName, want, got)
				}
			})
		}
	}
}

func TestGateRejectsAnEscalatedRoleClaim(t *testing.T) {
	// The gate re-reads the role from the database; keep it that way.
	h := newGate(t)
	member := seedUser(t, "MEMBER", "ACTIVE")

	escalated := mintToken(t, member, "SUPER_ADMIN", time.Now().Add(time.Hour))
	if got := call(t, h, bearer(escalated), "ADMIN", "SUPER_ADMIN"); got != http.StatusUnauthorized {
		t.Fatalf("a MEMBER presenting a SUPER_ADMIN claim must be refused; got %d", got)
	}
}

func TestGateRejectsInactiveAccounts(t *testing.T) {
	// Suspending an account has to take effect against a token that is still
	// within its lifetime, or suspension means nothing until the token expires.
	h := newGate(t)

	for _, status := range []string{"INACTIVE", "PENDING", "SUSPENDED"} {
		t.Run(status, func(t *testing.T) {
			id := seedUser(t, "ADMIN", status)
			token := mintToken(t, id, "ADMIN", time.Now().Add(time.Hour))
			if got := call(t, h, bearer(token), "ADMIN"); got != http.StatusUnauthorized {
				t.Fatalf("a %s account must not pass the gate; got %d", status, got)
			}
		})
	}
}

func TestGateRejectsATokenForADeletedUser(t *testing.T) {
	h := newGate(t)
	id := seedUser(t, "ADMIN", "ACTIVE")
	token := mintToken(t, id, "ADMIN", time.Now().Add(time.Hour))

	// Valid before deletion.
	if got := call(t, h, bearer(token), "ADMIN"); got != http.StatusOK {
		t.Fatalf("precondition failed: want 200, got %d", got)
	}

	if _, err := testPool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := call(t, h, bearer(token), "ADMIN"); got != http.StatusUnauthorized {
		t.Fatalf("a token for a deleted user must be refused; got %d", got)
	}
}

// mintTokenWith is mintToken with an explicit secret, for forgery tests.
func mintTokenWith(t *testing.T, secret, userID, role string, exp time.Time) string {
	t.Helper()
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"sub": userID, "role": role, "iat": time.Now().Unix(), "exp": exp.Unix(),
	})
	payload := b64(claims)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(header + "." + payload))
	return header + "." + payload + "." + b64(mac.Sum(nil))
}
