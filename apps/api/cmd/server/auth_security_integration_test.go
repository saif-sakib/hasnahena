//go:build integration

// Block X — account security, over HTTP.
//
// These run through the real router, because every defect the block is about
// lives in the seam between a handler and a service: which status code an
// unauthenticated caller learns something from (WO-88), whether the token a
// member still holds keeps working after they reset the password they lost
// control of (WO-85), and which account a reset link actually resolves to
// (WO-87). None of it is visible from a repository test.
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
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"

	"hasnahena/apps/api/internal/handlers"
	"hasnahena/apps/api/internal/repositories"
	"hasnahena/apps/api/internal/services"
)

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

// securityRouter is testRouter with an email service that is *configured*.
//
// That distinction is the whole point for WO-88: with no email service every
// identifier gets the same 503, so a test for "known and unknown answer alike"
// would pass without the fix. The Brevo base URL points at a stub in-process, so
// a "sent" email leaves nothing but a counter behind.
func securityRouter(t *testing.T) (chi.Router, *int) {
	t.Helper()

	sent := 0
	brevo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		sent++
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"messageId":"stub"}`))
	}))
	t.Cleanup(brevo.Close)

	userRepo := repositories.NewUserRepository(testPool)
	securityService := services.NewSecurityService(testPool)
	emailService := services.NewEmailService(services.EmailConfig{
		BrevoAPIKey:  "stub-key",
		BrevoBaseURL: brevo.URL,
		From:         "test@hasnahena.invalid",
		AppURL:       "https://hasnahena.invalid",
	})
	authService := services.NewAuthService(userRepo, securityService, emailService, testJWTSecret, 3600)

	r := chi.NewRouter()
	mountRoutes(r, routerDeps{
		auth:            handlers.NewAuthHandler(authService, securityService),
		dashboard:       handlers.NewDashboardHandler(authService, securityService, userRepo, emailService),
		db:              testPool,
		emailConfigured: func() bool { return true },
	})
	return r, &sent
}

// call sends one request, with control over the caller's address — which is
// what the origin-keyed buckets are about.
func call(t *testing.T, r chi.Router, method, path, remoteAddr, token string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req := httptest.NewRequestWithContext(ctx, method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// seedAuthUser creates an account this file owns, with a real bcrypt hash.
//
// The phone numbers below are all 019777xxxxx, which is this file's namespace.
// Suites share one database, so a unique column that is not namespaced to its
// suite fails on whichever suite happens to run second — and passes locally,
// where you probably ran only one.
func seedAuthUser(t *testing.T, id, email, phone, password, status string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	var storedEmail any
	if email != "" {
		storedEmail = email
	}
	_, err = testPool.Exec(context.Background(), `
		INSERT INTO users (id, phone, email, "passwordHash", role, status,
		                   "accountNo", "nameEn", "fatherName", "motherName",
		                   "createdAt", "updatedAt")
		VALUES ($1, $2, $3, $4, 'MEMBER', $5::"UserStatus", $6, 'Block X', 'F', 'M', NOW(), NOW())
		ON CONFLICT (id) DO UPDATE
		SET "passwordHash" = EXCLUDED."passwordHash", status = EXCLUDED.status,
		    email = EXCLUDED.email, phone = EXCLUDED.phone, "updatedAt" = NOW()
	`, id, phone, storedEmail, string(hash), status, "ACC-BX-"+id)
	if err != nil {
		t.Fatalf("seed %s: %v", id, err)
	}
	_, err = testPool.Exec(context.Background(), `
		INSERT INTO accounts (id, "savingsBalance", "loanBalance",
		                      "createdAt", "updatedAt", "userId")
		VALUES ('acct_' || $1, 0, 0, NOW(), NOW(), $1)
		ON CONFLICT ("userId") DO NOTHING
	`, id)
	if err != nil {
		t.Fatalf("seed account for %s: %v", id, err)
	}
	// No audit rows are cleaned up: audit_logs is append-only and the trigger
	// enforces it (rule 6). Every assertion below counts a delta instead.
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM token_blacklist WHERE "userId" = $1`, id)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM accounts WHERE "userId" = $1`, id)
		_, _ = testPool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// mintTokenIssuedAt backdates `iat`.
//
// Load-bearing, not cosmetic: the revocation check truncates the marker to whole
// seconds so that first login — change the temporary password, sign in 200 ms
// later — does not produce a token born revoked. A test that mints and revokes
// inside the same second is testing that carve-out, not revocation.
func mintTokenIssuedAt(t *testing.T, userID, role string, issuedAt time.Time) string {
	t.Helper()
	b64 := func(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
	header := b64([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims, _ := json.Marshal(map[string]any{
		"sub": userID, "role": role,
		"iat": issuedAt.Unix(), "exp": issuedAt.Add(time.Hour).Unix(),
	})
	payload := b64(claims)
	mac := hmac.New(sha256.New, []byte(testJWTSecret))
	mac.Write([]byte(header + "." + payload))
	return header + "." + payload + "." + b64(mac.Sum(nil))
}

// issueResetLink puts a forgot-password token in the table directly, so a test
// can hold the plaintext the email would have carried.
func issueResetLink(t *testing.T, secret, email, phone string) {
	t.Helper()
	repo := repositories.NewUserRepository(testPool)
	if err := repo.CreateResetToken(context.Background(),
		repositories.ResetScopeForgotPassword, secret, email, phone,
		time.Now().Add(30*time.Minute)); err != nil {
		t.Fatalf("issue reset link: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(),
			`DELETE FROM password_reset_tokens WHERE scope = $1 AND (email = $2 OR phone = $3)`,
			repositories.ResetScopeForgotPassword, email, phone)
	})
}

// answer is what a caller can actually learn from one response.
//
// `meta.timestamp` is dropped: it differs between two responses a second apart
// and says nothing about anybody, and leaving it in makes an oracle test pass or
// fail on how fast the machine is.
type answer struct {
	status int
	body   string
}

func answerOf(t *testing.T, rec *httptest.ResponseRecorder) answer {
	t.Helper()
	var envelope map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		return answer{rec.Code, rec.Body.String()}
	}
	delete(envelope, "meta")
	normalised, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("re-marshal response: %v", err)
	}
	return answer{rec.Code, string(normalised)}
}

func passwordHashOf(t *testing.T, userID string) string {
	t.Helper()
	var hash string
	if err := testPool.QueryRow(context.Background(),
		`SELECT "passwordHash" FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		t.Fatalf("read password hash for %s: %v", userID, err)
	}
	return hash
}

func auditCount(t *testing.T, action, entityID string) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM audit_logs WHERE action = $1 AND "entityId" = $2`, action, entityID).Scan(&n); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------
// WO-88 — forgot-password is not a membership oracle
// ---------------------------------------------------------------------------

// Red against the pre-WO-88 handler, which answered 404 AUTH_USER_NOT_FOUND for
// a non-member, 400 AUTH_EMAIL_REQUIRED for a member with no email address, and
// 200 for everyone else. Three different answers to "is this person a member?",
// on an unauthenticated endpoint, for a cooperative where membership itself is
// the sensitive fact.
func TestForgotPasswordAnswersIdenticallyWhoeverIsAskedAbout(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	seedAuthUser(t, "bx-oracle-member", "bx-oracle-member@blockx.test", "01977700001", "Correct-Horse-1", "ACTIVE")
	seedAuthUser(t, "bx-oracle-nomail", "", "01977700002", "Correct-Horse-1", "ACTIVE")
	seedAuthUser(t, "bx-oracle-susp", "bx-oracle-susp@blockx.test", "01977700003", "Correct-Horse-1", "SUSPENDED")

	cases := []struct {
		name       string
		identifier string
	}{
		{"a member with an email address", "bx-oracle-member@blockx.test"},
		{"a member with no email address", "01977700002"},
		{"a suspended member", "bx-oracle-susp@blockx.test"},
		{"somebody who has never been a member", "not-a-member@blockx.test"},
		{"a phone number nobody here has", "01955599999"},
	}

	answers := make([]answer, 0, len(cases))
	for i, tc := range cases {
		// A distinct address per case, so the origin bucket cannot start
		// answering 429 partway through and make the comparison meaningless.
		rec := call(t, r, http.MethodPost, "/v1/auth/forgot-password",
			fmt.Sprintf("198.51.100.%d:5000", i+1), "",
			map[string]string{"identifier": tc.identifier, "locale": "en"})
		answers = append(answers, answerOf(t, rec))
	}

	for i := 1; i < len(answers); i++ {
		if answers[i] != answers[0] {
			t.Errorf("%q answers %d %s; %q answers %d %s — the difference is a fact about who is a member",
				cases[i].name, answers[i].status, answers[i].body,
				cases[0].name, answers[0].status, answers[0].body)
		}
	}
	if answers[0].status != http.StatusOK {
		t.Errorf("status = %d, want 200 for every caller", answers[0].status)
	}
}

// The attempts that find nothing are the signal an enumeration is under way.
// Before this they were a 404 nobody keeps.
func TestForgotPasswordRecordsTheAttemptsThatFindNothing(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)
	const identifier = "bx-enumeration-probe@blockx.test"
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM rate_limits WHERE id LIKE '%bx-enumeration%'`)
	})
	before := auditCount(t, "PASSWORD_RESET_REQUESTED_UNKNOWN", identifier)

	call(t, r, http.MethodPost, "/v1/auth/forgot-password", "198.51.100.50:5000", "",
		map[string]string{"identifier": identifier})

	if got := auditCount(t, "PASSWORD_RESET_REQUESTED_UNKNOWN", identifier) - before; got != 1 {
		t.Errorf("audit rows for an unknown identifier = %d, want 1 — a probe that leaves no trace is a probe nobody can see", got)
	}
}

// One address cycling through numbers is stopped. The number is the one
// apps/web/app/api/v1/registrations/route.ts already settled on for the same
// question.
func TestForgotPasswordThrottlesOneAddressCyclingThroughIdentifiers(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)
	const addr = "198.51.100.77:5000"
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM rate_limits WHERE id LIKE 'forgot-password%'`)
	})

	limited := 0
	for i := 0; i < 25; i++ {
		rec := call(t, r, http.MethodPost, "/v1/auth/forgot-password", addr, "",
			map[string]string{"identifier": fmt.Sprintf("bx-sweep-%02d@blockx.test", i)})
		if rec.Code == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Error("25 probes from one address, none refused — unthrottled, this is a bulk membership-disclosure oracle")
	}
}

// ---------------------------------------------------------------------------
// WO-85 — a reset must end the sessions the member has lost control of
// ---------------------------------------------------------------------------

// Red against the pre-WO-85 code. ResetPassword ran UpdatePassword →
// MarkResetTokenUsed → audit → return nil and never touched revocation, so the
// attacker's token went on working against both backends for up to 24 hours —
// on the one path a locked-out member can actually reach.
func TestAPasswordResetEndsEverySessionTheAccountHasOpen(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	user := seedAuthUser(t, "bx-reset-revoke", "bx-reset-revoke@blockx.test", "01977700010", "Correct-Horse-1", "ACTIVE")
	stolen := mintTokenIssuedAt(t, user, "MEMBER", time.Now().Add(-5*time.Minute))

	if rec := call(t, r, http.MethodGet, "/v1/dashboard/user", "", stolen, nil); rec.Code != http.StatusOK {
		t.Fatalf("the token does not work before the reset: %d %s", rec.Code, rec.Body.String())
	}

	issueResetLink(t, "bx-reset-revoke-secret", "bx-reset-revoke@blockx.test", "01977700010")
	rec := call(t, r, http.MethodPost, "/v1/auth/reset-password", "", "",
		map[string]string{"token": "bx-reset-revoke-secret", "password": "Brand-New-Pass-9"})
	if rec.Code != http.StatusOK {
		t.Fatalf("reset failed: %d %s", rec.Code, rec.Body.String())
	}

	if rec := call(t, r, http.MethodGet, "/v1/dashboard/user", "", stolen, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("the token issued before the reset still works: %d — the member did everything right "+
			"and the attacker is still signed in", rec.Code)
	}
}

// The control. GREEN before WO-85 as well as after: the logged-in password
// change has always revoked other sessions, and this test exists so that fixing
// the reset path cannot quietly break the path that already worked.
func TestALoggedInPasswordChangeEndsEverySession(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	user := seedAuthUser(t, "bx-change-revoke", "bx-change-revoke@blockx.test", "01977700011", "Correct-Horse-1", "ACTIVE")
	other := mintTokenIssuedAt(t, user, "MEMBER", time.Now().Add(-5*time.Minute))

	rec := call(t, r, http.MethodPut, "/v1/dashboard/password", "", other,
		map[string]string{"currentPassword": "Correct-Horse-1", "newPassword": "Brand-New-Pass-9"})
	if rec.Code != http.StatusOK {
		t.Fatalf("password change failed: %d %s", rec.Code, rec.Body.String())
	}

	if rec := call(t, r, http.MethodGet, "/v1/dashboard/user", "", other, nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("a session from before the password change still works: %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// WO-87 — one reset, one account
// ---------------------------------------------------------------------------

// Red against `UPDATE users SET "passwordHash" = $1 WHERE email = $2 OR phone =
// $3`. A reset token carries the email *and* the phone recorded when it was
// issued; when those have come to belong to two different rows — through a
// rejection tombstone, an admin phone edit, or any contact change — that
// statement set BOTH accounts to the requester's new password. The caller asked
// to reset one account and silently reset a stranger's.
func TestAPasswordResetTouchesOnlyTheTokensOwner(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	owner := seedAuthUser(t, "bx-split-owner", "bx-split-owner@blockx.test", "01977700020", "Correct-Horse-1", "ACTIVE")
	stranger := seedAuthUser(t, "bx-split-stranger", "bx-split-stranger@blockx.test", "01977700021", "Correct-Horse-2", "ACTIVE")
	before := passwordHashOf(t, stranger)

	// The token's email belongs to one row and its phone to another.
	issueResetLink(t, "bx-split-secret", "bx-split-owner@blockx.test", "01977700021")

	rec := call(t, r, http.MethodPost, "/v1/auth/reset-password", "", "",
		map[string]string{"token": "bx-split-secret", "password": "Brand-New-Pass-9"})
	if rec.Code != http.StatusOK {
		t.Fatalf("reset failed: %d %s", rec.Code, rec.Body.String())
	}

	if got := passwordHashOf(t, stranger); got != before {
		t.Error("resetting one account changed a second account's password — the caller now knows a stranger's credentials")
	}
	if passwordHashOf(t, owner) == "" {
		t.Fatal("owner row vanished")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHashOf(t, owner)), []byte("Brand-New-Pass-9")); err != nil {
		t.Errorf("the account the link belonged to was not reset: %v", err)
	}
}

// ---------------------------------------------------------------------------
// WO-89 — the lockout escalates, and says so
// ---------------------------------------------------------------------------

// serveLockout is "time passed". The lockout is real, so a test that waited for
// it would spend 30 seconds to reach the second step and 12 minutes to reach the
// fourth; expiring the row's lockedUntil is the same state without the wait.
func serveLockout(t *testing.T, bucketID string) {
	t.Helper()
	_, err := testPool.Exec(context.Background(),
		`UPDATE rate_limits SET "lockedUntil" = NOW() - INTERVAL '1 second' WHERE id = $1`, bucketID)
	if err != nil {
		t.Fatalf("serve lockout for %s: %v", bucketID, err)
	}
}

func lockoutRemaining(t *testing.T, bucketID string) time.Duration {
	t.Helper()
	var seconds *float64
	err := testPool.QueryRow(context.Background(),
		`SELECT EXTRACT(EPOCH FROM ("lockedUntil" - NOW())) FROM rate_limits WHERE id = $1`, bucketID).Scan(&seconds)
	if err != nil {
		t.Fatalf("read lockout for %s: %v", bucketID, err)
	}
	if seconds == nil {
		return 0
	}
	return time.Duration(*seconds * float64(time.Second))
}

// Red against the flat `RateLimitMaxAttempts = 5 / RateLimitLockout = 30s`: five
// guesses, wait, five more, for ever, with no escalation, no alert and no audit
// row. Against a temporary password that was never changed, or a member who
// chose their phone number, that is enough.
func TestTheLoginLockoutEscalatesAndLeavesAnAuditRow(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	user := seedAuthUser(t, "bx-lockout", "bx-lockout@blockx.test", "01977700030", "Correct-Horse-1", "ACTIVE")
	const identifier = "bx-lockout@blockx.test"
	const attacker = "203.0.113.9:6000"
	originBucket := "login-origin:" + identifier + "|203.0.113.9"
	identifierBucket := "login:" + identifier
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM rate_limits WHERE id LIKE '%bx-lockout%'`)
	})
	auditBefore := auditCount(t, "LOGIN_LOCKOUT_ESCALATED", user)

	guess := func() int {
		rec := call(t, r, http.MethodPost, "/v1/auth/login", attacker, "",
			map[string]string{"identifier": identifier, "password": "not-the-password"})
		return rec.Code
	}

	var steps []time.Duration
	for round := 0; round < 3; round++ {
		for i := 0; i < 5; i++ {
			guess()
		}
		steps = append(steps, lockoutRemaining(t, originBucket))
		if code := guess(); code != http.StatusTooManyRequests {
			t.Fatalf("round %d: a sixth guess answered %d, want 429", round+1, code)
		}
		serveLockout(t, originBucket)
		serveLockout(t, identifierBucket)
	}

	for i := 1; i < len(steps); i++ {
		if steps[i] <= steps[i-1] {
			t.Errorf("lockout %d = %v is not longer than lockout %d = %v — a sustained attack "+
				"never costs the attacker more than the first one did", i+1, steps[i], i, steps[i-1])
		}
	}

	if got := auditCount(t, "LOGIN_LOCKOUT_ESCALATED", user) - auditBefore; got == 0 {
		t.Error("no audit row after the lockout escalated — a sustained attack on one member is invisible to everyone")
	}
}

// The tension named in WO-89, pinned in both directions. Escalation must key on
// the identifier *and* the address, or an attacker who knows a member's phone
// number can hold them out of their own savings for an hour at a time.
func TestAnAttackFromElsewhereCannotLockAMemberOutForAnHour(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	seedAuthUser(t, "bx-dos", "bx-dos@blockx.test", "01977700031", "Correct-Horse-1", "ACTIVE")
	const identifier = "bx-dos@blockx.test"
	identifierBucket := "login:" + identifier
	originBucket := "login-origin:" + identifier + "|203.0.113.44"
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM rate_limits WHERE id LIKE '%bx-dos%'`)
	})

	for round := 0; round < 4; round++ {
		for i := 0; i < 5; i++ {
			call(t, r, http.MethodPost, "/v1/auth/login", "203.0.113.44:6000", "",
				map[string]string{"identifier": identifier, "password": "not-the-password"})
		}
		serveLockout(t, originBucket)
		serveLockout(t, identifierBucket)
	}

	// The attacker's own bucket has escalated well past the first step.
	for i := 0; i < 5; i++ {
		call(t, r, http.MethodPost, "/v1/auth/login", "203.0.113.44:6000", "",
			map[string]string{"identifier": identifier, "password": "not-the-password"})
	}
	if attackerLock := lockoutRemaining(t, originBucket); attackerLock <= time.Minute {
		t.Errorf("the attacker's lockout is %v — a sustained attack has to price itself out", attackerLock)
	}

	// The member's side of it: the identifier-alone bucket never escalates, so
	// the worst an attack from elsewhere can do to them is the flat step.
	if memberLock := lockoutRemaining(t, identifierBucket); memberLock > 90*time.Second {
		t.Errorf("the identifier-alone lockout reached %v — at that length it is a weapon against the member, "+
			"not a defence of their account", memberLock)
	}
}

// WO-89(b). ErrUserInactive tells an unauthenticated caller "this identifier is
// a real account, currently suspended" — the WO-88 oracle on a different
// endpoint. The check already sits after bcrypt.CompareHashAndPassword; this
// pins the ordering, which is a one-line move away from being wrong.
func TestASuspendedAccountIsIndistinguishableFromAWrongPassword(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	r, _ := securityRouter(t)

	seedAuthUser(t, "bx-suspended", "bx-suspended@blockx.test", "01977700040", "Correct-Horse-1", "SUSPENDED")
	seedAuthUser(t, "bx-active", "bx-active@blockx.test", "01977700041", "Correct-Horse-1", "ACTIVE")
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM rate_limits WHERE id LIKE '%bx-suspended%' OR id LIKE '%bx-active%' OR id LIKE '%bx-ghost%'`)
	})

	wrongPassword := func(identifier, addr string) answer {
		return answerOf(t, call(t, r, http.MethodPost, "/v1/auth/login", addr, "",
			map[string]string{"identifier": identifier, "password": "definitely-wrong"}))
	}

	suspended := wrongPassword("bx-suspended@blockx.test", "203.0.113.60:7000")
	active := wrongPassword("bx-active@blockx.test", "203.0.113.61:7000")
	ghost := wrongPassword("bx-ghost@blockx.test", "203.0.113.62:7000")

	if suspended != active {
		t.Errorf("a wrong password for a suspended account answers %d %s and for an active one %d %s",
			suspended.status, suspended.body, active.status, active.body)
	}
	if ghost != active {
		t.Errorf("a wrong password for a non-member answers %d %s and for a member %d %s",
			ghost.status, ghost.body, active.status, active.body)
	}

	// And the suspended member is still told why, once they have proved the
	// password — they need to know, and they have earned the answer.
	rec := call(t, r, http.MethodPost, "/v1/auth/login", "203.0.113.63:7000", "",
		map[string]string{"identifier": "bx-suspended@blockx.test", "password": "Correct-Horse-1"})
	if rec.Code != http.StatusForbidden {
		t.Errorf("a suspended member with the right password gets %d, want 403 telling them the account is not active", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AUTH_USER_INACTIVE") {
		t.Errorf("body = %s, want AUTH_USER_INACTIVE", rec.Body.String())
	}
}
