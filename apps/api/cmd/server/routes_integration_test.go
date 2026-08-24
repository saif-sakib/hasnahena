//go:build integration

// TEST-15 — the access contract for every route the API exposes.
//
// 65 routes, previously zero tests. The table below is the specification: one
// row per route saying who may reach it. The runner then proves, for every row:
//
//	no credential           -> 401
//	a role not on the row   -> 403
//	a role on the row       -> neither 401 nor 403
//
// The table is checked against the *router*, not against itself: chi.Walk
// enumerates what is actually mounted, and a route with no row — or a row with
// no route — fails the test. That is the property that matters. A missing role
// check is a one-line diff that reads as correct, and the only reliable way to
// notice one is to make "I added a route" and "I declared who may call it" the
// same commit.
//
//	scripts/test-stack.sh up
//	eval "$(scripts/test-stack.sh env)"
//	cd apps/api && go test ./cmd/server/... -tags=integration -count=1
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hasnahena/apps/api/internal/handlers"
	"hasnahena/apps/api/internal/repositories"
	"hasnahena/apps/api/internal/services"
)

const testJWTSecret = "test-secret-at-least-thirty-two-characters"

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		os.Exit(0) // a skip, not a red build, for anyone without a database
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
	// Schema comes from `pnpm db:migrate` (scripts/test-stack.sh), not from the
	// application at boot — see WO-70.
	ensureDonationPool(ctx)

	os.Setenv("JWT_SECRET", testJWTSecret)
	code := m.Run()
	testPool.Close()
	os.Exit(code)
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

// access describes who may reach a route.
type access struct {
	// public: reachable with no credential at all.
	public bool
	// tokenOnly: needs a parseable token but no role or status check.
	tokenOnly bool
	// roles: the roles allowed. Empty (with neither flag) means any
	// authenticated, ACTIVE account regardless of role.
	roles []string
}

var (
	public    = access{public: true}
	tokenOnly = access{tokenOnly: true}
	anyRole   = access{}
	member    = access{roles: []string{"MEMBER"}}
	staff     = access{roles: []string{"WORKER", "ADMIN", "SUPER_ADMIN"}}
	adminOnly = access{roles: []string{"ADMIN", "SUPER_ADMIN"}}
)

// routeContract is keyed "METHOD /path" exactly as chi.Walk reports it.
var routeContract = map[string]access{
	// Operational. No credential: a load balancer has none to offer.
	"GET /v1/health": public,
	"GET /v1/ready":  public,

	// Authentication. Public by necessity — these are how a caller gets a
	// credential in the first place.
	"POST /v1/auth/login":           public,
	"POST /v1/auth/forgot-password": public,
	"GET /v1/auth/reset-password":   public,
	"POST /v1/auth/reset-password":  public,
	// Logout takes a token but deliberately does not check role or status: a
	// suspended member must still be able to end their session.
	"POST /v1/auth/logout": tokenOnly,

	// Anything a signed-in person does regardless of what they are.
	"GET /v1/dashboard/user":                          anyRole,
	"GET /v1/dashboard/notifications":                 anyRole,
	"PATCH /v1/dashboard/notifications":               anyRole,
	"PUT /v1/dashboard/password":                      anyRole,
	"POST /v1/dashboard/password/change/request-code": anyRole,
	"POST /v1/dashboard/password/change/verify-code":  anyRole,
	"POST /v1/dashboard/password/change/confirm":      anyRole,
	"GET /v1/dashboard/support/config":                anyRole,
	"GET /v1/dashboard/support/threads":               anyRole,
	"GET /v1/dashboard/support/messages":              anyRole,
	"POST /v1/dashboard/support/messages":             anyRole,
	// Anyone may open a thread; only staff may close one. The check is inside
	// MarkSupportThreadProcessed rather than at the route, which is why this
	// row is easy to get wrong and worth pinning.
	"POST /v1/dashboard/support/threads/processed": staff,
	"GET /v1/dashboard/support/stream":             anyRole,
	"POST /v1/dashboard/support/stream/ticket":     anyRole,
	// Same path as the GET above, but writing the retention policy is an
	// admin act. The split lives inside the handler, which is exactly why it
	// is worth a row of its own.
	"PUT /v1/dashboard/support/config": adminOnly,

	// A member's own money. Staff read member data through the worker and
	// admin routes instead, so these are MEMBER and nothing else.
	"GET /v1/dashboard/member":                          member,
	"GET /v1/dashboard/member/deposits":                 member,
	"GET /v1/dashboard/member/transactions":             member,
	"GET /v1/dashboard/member/loans":                    member,
	"GET /v1/dashboard/member/profile":                  member,
	"POST /v1/dashboard/member/requests/deposit":        member,
	"POST /v1/dashboard/member/requests/loan-repayment": member,
	// POST /member/requests/withdrawal is deliberately absent (ADR-030). It was
	// the member's own withdrawal notice, and both it and the notice period it
	// started are gone: a member asks a field worker, and staff pay from
	// /worker/members/{memberUserId}/withdrawal below.

	// Field-worker surface. Admins are included: an admin covering a round
	// needs the same screens.
	"GET /v1/dashboard/worker":                                    staff,
	"GET /v1/dashboard/worker/members":                            staff,
	"GET /v1/dashboard/worker/members/{memberUserId}":             staff,
	"POST /v1/dashboard/worker/members/{memberUserId}/deposit":    staff,
	"POST /v1/dashboard/worker/members/{memberUserId}/withdrawal": staff,
	"POST /v1/dashboard/worker/members/{memberUserId}/loan":       staff,
	// Adding principal to a loan that is already running. Staff, not admin
	// only: it is a disbursement at the desk, the same act as `/loan`, and the
	// ceiling it is measured against is enforced in the repository rather than
	// by who is allowed to ask.
	"POST /v1/dashboard/worker/members/{memberUserId}/loan-topup":   staff,
	"POST /v1/dashboard/worker/members/{memberUserId}/loan-payment": staff,
	"GET /v1/dashboard/worker/requests":                             staff,
	"GET /v1/dashboard/worker/loans":                                staff,
	"GET /v1/dashboard/worker/transactions":                         staff,
	"GET /v1/dashboard/worker/profile":                              staff,
	// UpdateProfile only ever edits the caller's own row, so it asks for a
	// session rather than a role — which left this PUT open to a MEMBER while
	// the GET beside it was staff-only. Not an escalation, but a route whose
	// two halves disagree about who it is for. Gated at the router since
	// 2026-08-17 so the answer is visible in the route table (SEC-02).
	"PUT /v1/dashboard/worker/profile": staff,

	// Administration.
	// The dashboard payload carries `recentActivity`, which is the audit
	// trail — admin-only by product.md even though the counters beside it are
	// not sensitive.
	"GET /v1/dashboard/admin/":                               adminOnly,
	"GET /v1/dashboard/admin/workers":                        adminOnly,
	"POST /v1/dashboard/admin/workers/welcome-email":         adminOnly,
	"POST /v1/dashboard/admin/members/status":                adminOnly,
	"POST /v1/dashboard/admin/approvals/registration":        adminOnly,
	"POST /v1/dashboard/admin/approvals/registration/reject": adminOnly,
	"POST /v1/dashboard/admin/approvals/loan":                adminOnly,
	"POST /v1/dashboard/admin/approvals/loan/reject":         adminOnly,
	"GET /v1/dashboard/admin/loans/detail":                   adminOnly,
	"POST /v1/dashboard/admin/loans/default":                 adminOnly,
	"GET /v1/dashboard/admin/profile":                        adminOnly,
	// Same handler as the worker PUT above, but mounted inside the adminOnly
	// group, so the middleware narrows it regardless of what the handler asks
	// for. Mounting location wins — that is the point of SEC-02.
	"PUT /v1/dashboard/admin/profile": adminOnly,

	// Donations live under /admin for historical URL reasons but are recorded
	// by field workers too.
	"GET /v1/dashboard/admin/donations":  staff,
	"POST /v1/dashboard/admin/donations": staff,

	// The approvals queue, and processing a pending posting. Approving a
	// *registration* or a *loan* is an admin decision and stays above; moving
	// money a member has already asked for is the worker's job (FR-07, FR-08),
	// and these three handlers have asked for WORKER since they were written.
	// Only the mounting said otherwise, which 403'd the worker approvals
	// screen — the same component the admin opens.
	"GET /v1/dashboard/admin/approvals":                    staff,
	"POST /v1/dashboard/admin/approvals/withdrawal":        staff,
	"POST /v1/dashboard/admin/approvals/withdrawal/reject": staff,

	// Read-only aggregates over postings a worker already sees one at a time.
	"GET /v1/dashboard/admin/reports/monthly": staff,
	"GET /v1/dashboard/admin/reports/yearly":  staff,
	"GET /v1/dashboard/admin/reports/loans":   staff,

	// The three read-only lists the shared reports screen cross-foots.
	// `/admin/members` is the same handler body as `/worker/members`, and
	// `/worker/loans` already returns every loan, so those two hand a worker
	// nothing they could not already fetch. The savings ledger is the real
	// widening — read only; every write to it is gated elsewhere.
	"GET /v1/dashboard/admin/members":  staff,
	"GET /v1/dashboard/admin/loans":    staff,
	"GET /v1/dashboard/admin/deposits": staff,
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// testRouter builds the real route table over the test database.
func testRouter(t *testing.T) chi.Router {
	t.Helper()
	userRepo := repositories.NewUserRepository(testPool)
	securityService := services.NewSecurityService(testPool)
	authService := services.NewAuthService(userRepo, securityService, nil, testJWTSecret, 3600)

	r := chi.NewRouter()
	mountRoutes(r, routerDeps{
		auth:            handlers.NewAuthHandler(authService, securityService),
		dashboard:       handlers.NewDashboardHandler(authService, securityService, userRepo, nil),
		db:              testPool,
		emailConfigured: func() bool { return false },
	})
	return r
}

// walkRoutes lists every mounted route as "METHOD /pattern".
func walkRoutes(t *testing.T, r chi.Router) []string {
	t.Helper()
	var out []string
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		out = append(out, method+" "+route)
		return nil
	})
	if err != nil {
		t.Fatalf("walk router: %v", err)
	}
	return out
}

// ensureDonationPool recreates the donation pool account, which `pnpm db:seed`
// creates in a real environment.
//
// This package cannot assume the seed survived: the repositories suite
// truncates every table between tests, and `go test ./...` runs both against
// the same database. Depending on a fixture another package happens to leave
// behind is how a suite passes locally and fails in CI depending on the order
// the packages ran in.
func ensureDonationPool(ctx context.Context) {
	// repositories.DonationFundUserID — the pool is found by its owner now that
	// there is no account number (ADR-023).
	const owner = "system_donation_fund"
	if _, err := testPool.Exec(ctx, `
		INSERT INTO users (id, email, phone, "passwordHash", role, status,
			"nameEn", "fatherName", "motherName", "createdAt", "updatedAt")
		VALUES ($1, 'donation-fund@system.invalid', '00000000000', 'x', 'ADMIN', 'INACTIVE',
			'Donation Fund', '-', '-', NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`, owner); err != nil {
		panic("seed donation fund user: " + err.Error())
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO accounts (id, "savingsBalance", "loanBalance",
			"isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
		VALUES ('acct_' || $1, 0, 0, false, 0, NOW(), NOW(), $1)
		ON CONFLICT ("userId") DO NOTHING
	`, owner); err != nil {
		panic("seed donation account: " + err.Error())
	}
}

var seededOnce = map[string]string{}

// seedRoleUser returns an ACTIVE user of the given role, created once per run.
func seedRoleUser(t *testing.T, role string) string {
	t.Helper()
	if id, ok := seededOnce[role]; ok {
		return id
	}
	id := fmt.Sprintf("goroute-%s", strings.ToLower(role))
	// Every unique column is namespaced to this suite. The Next contract suite
	// seeds its own role users in the same database and both originally used
	// `RT-<role>` as the account number, so whichever ran second failed on
	// users_accountNo_key — a collision that only appears when the suites run in
	// the same session, which is exactly when CI runs them.
	//
	// DO UPDATE, not DO NOTHING: the repositories suite truncates `users`
	// between its tests, so a row seeded earlier in the run may be gone, and a
	// row that survived may have been left INACTIVE.
	_, err := testPool.Exec(context.Background(), `
		INSERT INTO users (id, phone, email, "passwordHash", role, status,
		                   "accountNo", "nameEn", "fatherName", "motherName",
		                   "createdAt", "updatedAt")
		VALUES ($1, $2, $3, 'x', $4::"UserRole", 'ACTIVE',
		        $5, 'Route Test', 'F', 'M', NOW(), NOW())
		ON CONFLICT (id) DO UPDATE
		SET status = 'ACTIVE', role = EXCLUDED.role, "updatedAt" = NOW()
	`, id, phoneFor(role), id+"@goroutes.test", role, "GORT-"+role)
	if err != nil {
		t.Fatalf("seed %s: %v", role, err)
	}
	// Every member needs an account or the member routes 500 for reasons that
	// have nothing to do with authorization.
	if role == "MEMBER" {
		_, err = testPool.Exec(context.Background(), `
			INSERT INTO accounts (id, "savingsBalance", "loanBalance",
			                      "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
			VALUES ('acct_' || $1, 0, 0, true, 0, NOW(), NOW(), $1)
			ON CONFLICT (id) DO NOTHING
		`, id)
		if err != nil {
			t.Fatalf("seed account: %v", err)
		}
	}
	seededOnce[role] = id
	return id
}

func phoneFor(role string) string {
	switch role {
	case "MEMBER":
		return "01922200001"
	case "WORKER":
		return "01922200002"
	case "ADMIN":
		return "01922200003"
	default:
		return "01922200004"
	}
}

func mintToken(t *testing.T, userID, role string, exp time.Time) string {
	t.Helper()
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"sub": userID, "role": role,
		"iat": time.Now().Unix(), "exp": exp.Unix(),
	})
	payload := b64(claims)
	mac := hmac.New(sha256.New, []byte(testJWTSecret))
	mac.Write([]byte(header + "." + payload))
	return header + "." + payload + "." + b64(mac.Sum(nil))
}

func tokenFor(t *testing.T, role string) string {
	t.Helper()
	return mintToken(t, seedRoleUser(t, role), role, time.Now().Add(time.Hour))
}

// concreteURL fills in path parameters. Which value hardly matters for an
// authorization test — what matters is that the router matches the route.
func concreteURL(pattern string) string {
	url := strings.ReplaceAll(pattern, "{memberUserId}", "GORT-MEMBER")
	// The SSE stream blocks until the client disconnects. Omitting threadId
	// makes it answer 400 immediately, which is still "not 401 and not 403" —
	// the only thing this test asks of it.
	return url
}

// do sends one request through the real router.
func do(t *testing.T, r chi.Router, method, pattern, token string) *httptest.ResponseRecorder {
	t.Helper()
	var body *bytes.Reader
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		body = bytes.NewReader([]byte(`{}`))
	default:
		body = bytes.NewReader(nil)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req := httptest.NewRequestWithContext(ctx, method, concreteURL(pattern), body)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// ---------------------------------------------------------------------------
// TEST-15
// ---------------------------------------------------------------------------

// TestEveryRouteHasADeclaredContract is the guard that keeps the rest honest.
// Without it, a route added tomorrow is simply not covered by anything below,
// and the suite goes on reporting green.
func TestEveryRouteHasADeclaredContract(t *testing.T) {
	r := testRouter(t)
	mounted := walkRoutes(t, r)

	seen := map[string]bool{}
	for _, key := range mounted {
		seen[key] = true
		if _, ok := routeContract[key]; !ok {
			t.Errorf("route %q is mounted but has no entry in routeContract — "+
				"add one saying who may call it", key)
		}
	}
	for key := range routeContract {
		if !seen[key] {
			t.Errorf("routeContract has an entry for %q, which is not mounted — "+
				"the route was renamed or removed", key)
		}
	}
	t.Logf("%d routes under contract", len(mounted))
}

func TestEveryRouteRefusesAnAnonymousCaller(t *testing.T) {
	r := testRouter(t)

	for _, key := range walkRoutes(t, r) {
		contract, ok := routeContract[key]
		if !ok || contract.public {
			continue
		}
		method, pattern, _ := strings.Cut(key, " ")
		t.Run(key, func(t *testing.T) {
			rec := do(t, r, method, pattern, "")
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("want 401 with no credential, got %d: %s",
					rec.Code, strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}

func TestEveryRouteRefusesAForgedToken(t *testing.T) {
	r := testRouter(t)
	// A token that is well-formed and unexpired but signed with another key.
	// This is the failure mode where a route reads claims without verifying.
	forged := func() string {
		b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
		header := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
		claims, _ := json.Marshal(map[string]any{
			"sub": "goroute-admin", "role": "SUPER_ADMIN",
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		})
		payload := b64(claims)
		mac := hmac.New(sha256.New, []byte("not-the-real-signing-key-at-all-x"))
		mac.Write([]byte(header + "." + payload))
		return header + "." + payload + "." + b64(mac.Sum(nil))
	}()

	for _, key := range walkRoutes(t, r) {
		contract, ok := routeContract[key]
		if !ok || contract.public {
			continue
		}
		method, pattern, _ := strings.Cut(key, " ")
		t.Run(key, func(t *testing.T) {
			rec := do(t, r, method, pattern, forged)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("a token signed with the wrong key reached the handler: got %d", rec.Code)
			}
		})
	}
}

func TestRoleSeparationAcrossEveryRoute(t *testing.T) {
	r := testRouter(t)
	roles := []string{"MEMBER", "WORKER", "ADMIN"}

	for _, key := range walkRoutes(t, r) {
		contract, ok := routeContract[key]
		if !ok || contract.public || contract.tokenOnly {
			continue
		}
		method, pattern, _ := strings.Cut(key, " ")

		for _, role := range roles {
			allowed := len(contract.roles) == 0 // anyRole
			for _, r2 := range contract.roles {
				if r2 == role {
					allowed = true
				}
			}

			t.Run(key+"/"+role, func(t *testing.T) {
				rec := do(t, r, method, pattern, tokenFor(t, role))
				switch {
				case allowed && (rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden):
					t.Fatalf("%s must be allowed here but got %d: %s",
						role, rec.Code, strings.TrimSpace(rec.Body.String()))
				case !allowed && rec.Code != http.StatusForbidden:
					t.Fatalf("%s must be refused with 403, got %d: %s",
						role, rec.Code, strings.TrimSpace(rec.Body.String()))
				}
			})
		}
	}
}

// TestRoutesRefuseAnExpiredToken covers the window a stolen token is useful in.
func TestRoutesRefuseAnExpiredToken(t *testing.T) {
	r := testRouter(t)
	expired := mintToken(t, seedRoleUser(t, "ADMIN"), "ADMIN", time.Now().Add(-time.Minute))

	for _, key := range walkRoutes(t, r) {
		contract, ok := routeContract[key]
		if !ok || contract.public {
			continue
		}
		method, pattern, _ := strings.Cut(key, " ")
		t.Run(key, func(t *testing.T) {
			if rec := do(t, r, method, pattern, expired); rec.Code != http.StatusUnauthorized {
				t.Fatalf("want 401 for an expired token, got %d", rec.Code)
			}
		})
	}
}
