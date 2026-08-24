//go:build integration

// The HTTP answers a withdrawal gives.
//
// This file was written for a defect reported as "admin member withdrawal is
// not working". It was working, in the sense that it refused correctly — what
// it did not do was say so. `WorkerAddWithdrawal` classified the repository's
// errors by `strings.Contains` over the message, and the two FR-08 refusals
// matched no branch at all, so both arrived as:
//
//	500  WITHDRAWAL_FAILED  "Failed to process withdrawal"
//
// The single most common outcome of that screen was indistinguishable from the
// server having crashed. The substring matching also mis-ordered two branches it
// did match: "is guarantor for active loan" contains "active loan", and the
// active-loan case was tested first, so a guarantor was told they had a loan of
// their own.
//
// ADR-030 has since deleted the two FR-08 refusals themselves: a payout needs
// no notice and waits out no period. So the cases here changed shape — what
// used to be "the refusal must be a 409 and not a 500" is now "there must be no
// refusal at all" — but the reason the file exists did not. These assertions are
// about status codes and error codes rather than prose, because those are what
// the browser branches on, and the translation from an error to an answer is
// where the defect lived.
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

// withdrawalFixture is one member, funded, with whatever the case needs.
type withdrawalFixture struct {
	memberID string
	router   chi.Router
	token    string
}

func newWithdrawalFixture(t *testing.T, savings int64) withdrawalFixture {
	t.Helper()
	ctx := context.Background()

	const memberID = "wd-member"
	// 019111 is this file's phone namespace. The number used to be 01955500001,
	// which is what `apps/web/test/routes` seeds `nextroute-member` with — so
	// this fixture failed on users_phone_key whenever the route suite had run
	// first against the same database, and passed whenever it had not. Every
	// unique column in a shared-database suite has to be namespaced to it.
	if _, err := testPool.Exec(ctx, `
		INSERT INTO users (id, phone, email, "passwordHash", role, status,
		                   "accountNo", "nameEn", "fatherName", "motherName",
		                   "createdAt", "updatedAt")
		VALUES ($1, '01911100001', $1 || '@wd.test', 'x', 'MEMBER', 'ACTIVE',
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

// fileWithdrawalRequest inserts an outstanding PENDING withdrawal, backdated by
// monthsAgo. Under FR-08 this was the member's notice and its age decided
// whether a payout was allowed; it decides nothing now (ADR-030) and is here
// only so a case can exercise the settlement path, or show that a request filed
// today is paid today.
func fileWithdrawalRequest(t *testing.T, memberID string, amount int64, monthsAgo int) string {
	t.Helper()
	var id string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, status, "createdAt", "accountId", "userId")
		VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $2, 'request', 'PENDING',
		        NOW() - ($3 || ' months')::interval, 'acct_' || $1, $1)
		RETURNING id::text
	`, memberID, amount, monthsAgo).Scan(&id); err != nil {
		t.Fatalf("file withdrawal request: %v", err)
	}
	return id
}

// savingsOfWD reads the fixture member's balance.
func savingsOfWD(t *testing.T, memberID string) int64 {
	t.Helper()
	var balance int64
	if err := testPool.QueryRow(context.Background(),
		`SELECT "savingsBalance"::bigint FROM accounts WHERE "userId" = $1`, memberID).Scan(&balance); err != nil {
		t.Fatalf("read balance: %v", err)
	}
	return balance
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
// ADR-030 — the two refusals that used to be 500s, and are now not refusals
// ---------------------------------------------------------------------------

// Was: 409 WITHDRAWAL_NOTICE_REQUIRED. Before that: 500.
func TestWithdrawalWithNoRequestOnFileIsPaid(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "no request on file"})

	if status != http.StatusOK {
		t.Fatalf("a payout with no request behind it answered %d %s %q. "+
			"ADR-030 removed the notice requirement: staff take the request in person "+
			"and pay at the desk.", status, code, message)
	}
	if got := savingsOfWD(t, fixture.memberID); got != 15000 {
		t.Errorf("savings = %d after a 5000 payout from 20000, want 15000", got)
	}
}

// Was: 409 WITHDRAWAL_NOTICE_NOT_MATURED, carrying two dates.
func TestWithdrawalOnTheDayTheRequestIsFiledIsPaid(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)
	requestID := fileWithdrawalRequest(t, fixture.memberID, 5000, 0)

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "same day"})

	if status != http.StatusOK {
		t.Fatalf("a payout on the day the request was filed answered %d %s %q, want 200", status, code, message)
	}
	if got := savingsOfWD(t, fixture.memberID); got != 15000 {
		t.Errorf("savings = %d, want 15000", got)
	}

	// The request became the posting rather than being left behind beside it.
	var rowStatus string
	if err := testPool.QueryRow(context.Background(),
		`SELECT status::text FROM transactions WHERE id = $1`, requestID).Scan(&rowStatus); err != nil {
		t.Fatalf("read the settled request: %v", err)
	}
	if rowStatus != "CONFIRMED" {
		t.Errorf("the request is %s after being paid, want CONFIRMED — the ledger now carries it twice", rowStatus)
	}
}

// An old request still settles, which is what stops a pre-ADR-030 notice
// sitting PENDING forever after the money has been handed over.
func TestAnOldRequestIsSettledRatherThanDuplicated(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)
	fileWithdrawalRequest(t, fixture.memberID, 5000, 6)

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 5000, "notes": "settling an old request"})

	if status != http.StatusOK {
		t.Fatalf("an outstanding request was refused: %d %s %q", status, code, message)
	}
	if got := savingsOfWD(t, fixture.memberID); got != 15000 {
		t.Errorf("savings = %d after a 5000 payout from 20000, want 15000", got)
	}

	var rows int
	if err := testPool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM transactions WHERE "userId" = $1 AND type = 'WITHDRAWAL'`,
		fixture.memberID).Scan(&rows); err != nil {
		t.Fatalf("count withdrawal rows: %v", err)
	}
	if rows != 1 {
		t.Errorf("%d WITHDRAWAL rows after settling one request, want 1", rows)
	}
}

// An overdraw is still a refusal, and still not a 500. This is the case that
// proves the switch below the deleted branches still classifies rather than
// falling through — with the FR-08 arms removed, an untested `default` would
// swallow every remaining answer.
func TestAWithdrawalOverTheBalanceIsRefusedNotFailed(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)

	status, code, message := postJSON(t, fixture.router, withdrawalURL(fixture.memberID), fixture.token,
		map[string]any{"amount": 25000, "notes": "more than the balance"})

	if status == http.StatusInternalServerError {
		t.Fatalf("an overdraw produced %d %s %q — that is an answer, not a fault (rule 2b)", status, code, message)
	}
	if status != http.StatusBadRequest || code != "INSUFFICIENT_BALANCE" {
		t.Errorf("status = %d, code = %q, want 400 INSUFFICIENT_BALANCE (%q)", status, code, message)
	}
	if got := savingsOfWD(t, fixture.memberID); got != 20000 {
		t.Errorf("savings = %d after a refused payout, want 20000 unchanged", got)
	}
}

// ---------------------------------------------------------------------------
// The branch that reported the wrong reason
// ---------------------------------------------------------------------------

func TestAGuarantorIsToldTheyAreAGuarantor(t *testing.T) {
	fixture := newWithdrawalFixture(t, 20000)

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
