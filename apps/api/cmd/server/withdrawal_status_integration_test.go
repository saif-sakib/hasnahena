//go:build integration

// The HTTP answers a withdrawal gives — reported as "admin member withdrawal is
// not working".
//
// It was working, in the sense that it refused correctly. What it did not do was
// say so. `WorkerAddWithdrawal` classified the repository's errors by
// `strings.Contains` over the message, and the two FR-08 refusals matched no
// branch at all, so both arrived as:
//
//	500  WITHDRAWAL_FAILED  "Failed to process withdrawal"
//
// The single most common outcome of that screen — the member has not given
// notice, or the notice is not due yet — was indistinguishable from the server
// having crashed. The same hole was in `ApproveWithdrawal`, which is the *other*
// admin screen a withdrawal passes through, so both said the same nothing.
//
// The substring matching also mis-ordered two branches it did match:
// "is guarantor for active loan" contains "active loan", and the active-loan
// case was tested first, so a guarantor was told they had a loan of their own.
//
// These assertions are about status codes and error codes rather than prose,
// because those are what the browser branches on. The repository behaviour
// underneath is already proved in
// internal/repositories/policy_enforcement_integration_test.go — what was never
// tested is the translation from an error to an answer, which is where the
// defect lived.
//
// Every identifier is namespaced `wd*`: the Go suites truncate between tests and
// a fixture that collides with another file's passes or fails on package order.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// withdrawalFixture is one member, funded, with whatever notice the case needs.
type withdrawalFixture struct {
	memberID string
	router   chi.Router
	token    string
}

func newWithdrawalFixture(t *testing.T, savings int64) withdrawalFixture {
	t.Helper()
	ctx := context.Background()

	const memberID = "wd-member"
	if _, err := testPool.Exec(ctx, `
		INSERT INTO users (id, phone, email, "passwordHash", role, status,
		                   "accountNo", "nameEn", "fatherName", "motherName",
		                   "createdAt", "updatedAt")
		VALUES ($1, '01955500001', $1 || '@wd.test', 'x', 'MEMBER', 'ACTIVE',
		        'WD-MEMBER-1', 'Withdrawal Fixture', 'F', 'M', NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', "updatedAt" = NOW()
	`, memberID); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO accounts (id, "savingsBalance", "loanBalance",
		                      "isLoanEligible", "maxLoanAmount", "createdAt", "updatedAt", "userId")
		VALUES ('acct_' || $1, $2, 0, true, 0, NOW(), NOW(), $1)
		ON CONFLICT (id) DO UPDATE SET "savingsBalance" = EXCLUDED."savingsBalance", "loanBalance" = 0
	`, memberID, savings); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	// Left over from an earlier case in this file, if any.
	if _, err := testPool.Exec(ctx,
		`DELETE FROM transactions WHERE "userId" = $1`, memberID); err != nil {
		t.Fatalf("clear transactions: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`DELETE FROM loans WHERE "borrowerId" = $1 OR "guarantorId" = $1`, memberID); err != nil {
		t.Fatalf("clear loans: %v", err)
	}

	return withdrawalFixture{
		memberID: memberID,
		router:   testRouter(t),
		token:    tokenFor(t, "ADMIN"),
	}
}

// giveNotice files a withdrawal notice backdated by monthsAgo, which is how a
// test reaches a matured notice without waiting three months.
func giveNotice(t *testing.T, memberID string, amount int64, monthsAgo int) string {
	t.Helper()
	var id string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, status, "createdAt", "accountId", "userId")
		VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $2, 'notice', 'PENDING',
		        NOW() - ($3 || ' months')::interval, 'acct_' || $1, $1)
		RETURNING id::text
	`, memberID, amount, monthsAgo).Scan(&id); err != nil {
		t.Fatalf("give notice: %v", err)
	}
	return id
}

func setNoticePeriod(t *testing.T, months string) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO system_config (id, key, value, "updatedAt")
		VALUES ('cfg_notice', 'loan.noticePeriodMonths', $1, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
	`, months); err != nil {
		t.Fatalf("set notice period: %v", err)
	}
}

// postJSON sends a real request through the real router and returns the
// response with the envelope already decoded.
func postJSON(t *testing.T, r chi.Router, url, token string, body map[string]any) (int, string, string) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req := httptest.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var envelope struct {
		Success bool `json:"success"`
		Error   struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &envelope)
	return rec.Code, envelope.Error.Code, envelope.Error.Message
}

func withdrawalURL(memberID string) string {
	return fmt.Sprintf("/v1/dashboard/worker/members/%s/withdrawal", memberID)
}

// ---------------------------------------------------------------------------
// FR-08 — the two refusals that used to be 500s
// ---------------------------------------------------------------------------

func TestWithdrawalWithNoNoticeIsRefusedNotFailed(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)
	setNoticePeriod(t, "3")

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "no notice on file"})

	if status == http.StatusInternalServerError {
		t.Fatalf("a member with no withdrawal notice produced %d %s %q. "+
			"That is the ordinary answer under FR-08, not a server fault, and reporting it as one "+
			"is what made this screen look broken.", status, code, message)
	}
	if status != http.StatusConflict {
		t.Errorf("status = %d, want 409", status)
	}
	if code != "WITHDRAWAL_NOTICE_REQUIRED" {
		t.Errorf("error code = %q, want WITHDRAWAL_NOTICE_REQUIRED", code)
	}
	if message == "" || message == "Failed to process withdrawal" {
		t.Errorf("message = %q; it has to say what is missing and who supplies it", message)
	}
}

func TestWithdrawalBeforeTheNoticeMaturesReportsTheDate(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)
	setNoticePeriod(t, "3")
	giveNotice(t, fixture.memberID, 5000, 1) // one month into a three-month notice

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "too early"})

	if status != http.StatusConflict {
		t.Fatalf("status = %d (%s: %q), want 409", status, code, message)
	}
	if code != "WITHDRAWAL_NOTICE_NOT_MATURED" {
		t.Errorf("error code = %q, want WITHDRAWAL_NOTICE_NOT_MATURED", code)
	}
	// The repository builds this message with both dates. The handler used to
	// discard it, which is the difference between an answer and a shrug.
	if !containsAll(message, "notice given", "payable from") {
		t.Errorf("message = %q; it must carry the date the notice was given and the date it is payable", message)
	}
}

func TestAMaturedNoticeIsPaid(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)
	setNoticePeriod(t, "3")
	giveNotice(t, fixture.memberID, 5000, 6)

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "matured"})

	if status != http.StatusOK {
		t.Fatalf("a matured notice was refused: %d %s %q", status, code, message)
	}

	var balance int64
	if err := testPool.QueryRow(context.Background(),
		`SELECT "savingsBalance"::bigint FROM accounts WHERE "userId" = $1`, fixture.memberID).Scan(&balance); err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if balance != 15000 {
		t.Errorf("savings = %d after a 5000 payout from 20000, want 15000", balance)
	}
}

// ---------------------------------------------------------------------------
// The branch that reported the wrong reason
// ---------------------------------------------------------------------------

func TestAGuarantorIsToldTheyAreAGuarantor(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)
	setNoticePeriod(t, "0")
	giveNotice(t, fixture.memberID, 5000, 0)

	// Somebody else's active loan, guaranteed by our member. Our member has no
	// loan of their own.
	borrower := seedRoleUser(t, "MEMBER")
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO loans (id, "loanNumber", "accountId", "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "disbursementDate", "createdAt", "updatedAt")
		VALUES ('wd-loan', 'LOAN-WD-1', 'acct_' || $1, $1, $2,
			12000, 12000, 12, 0, 1000, 'guarantee fixture', 'ACTIVE', NOW(), NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', "guarantorId" = EXCLUDED."guarantorId"
	`, borrower, fixture.memberID); err != nil {
		t.Fatalf("seed guaranteed loan: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM loans WHERE id = 'wd-loan'`)
	})

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "guarantor"})

	if status != http.StatusBadRequest || code != "WITHDRAWAL_BLOCKED" {
		t.Fatalf("status = %d, code = %q, want 400 WITHDRAWAL_BLOCKED (%q)", status, code, message)
	}
	// The substring version answered "Cannot withdraw while having an active
	// loan" here, because "is guarantor for active loan" contains "active loan".
	// This member has no loan of their own; being told they do sends them to
	// look for one.
	if !containsAll(message, "guarantee") {
		t.Errorf("message = %q; a guarantor must be told they are a guarantor, not that they have a loan", message)
	}
}

func containsAll(haystack string, needles ...string) bool {
	for _, needle := range needles {
		if !contains(haystack, needle) {
			return false
		}
	}
	return true
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
