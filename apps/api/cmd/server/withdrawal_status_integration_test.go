//go:build integration

// The HTTP answers a withdrawal gives — status and error codes, which the
// browser branches on (rule 2b, ADR-030). Identifiers are namespaced `wd*`.
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
	// 019111 is this file's phone namespace.
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
		INSERT INTO accounts ("savingsBalance", "loanBalance",
		                      "createdAt", "updatedAt", "userId")
		VALUES ($2, 0, NOW(), NOW(), $1)
		ON CONFLICT ("userId") DO UPDATE SET "savingsBalance" = EXCLUDED."savingsBalance", "loanBalance" = 0
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

// fileWithdrawalRequest inserts an outstanding PENDING withdrawal, backdated.
// It gates nothing (ADR-030); it exercises the settlement path.
func fileWithdrawalRequest(t *testing.T, memberID string, amount int64, monthsAgo int) string {
	t.Helper()
	var id string
	if err := testPool.QueryRow(context.Background(), `
		INSERT INTO transactions (id, type, amount, description, status, "createdAt", "userId")
		VALUES (gen_random_uuid()::text, 'WITHDRAWAL', $2, 'request', 'PENDING',
		        NOW() - ($3 || ' months')::interval, $1)
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

// No request on file: paid (ADR-030).
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

// An overdraw is refused with a 4xx, not a 500.
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
		INSERT INTO loans (id, "borrowerId", "guarantorId",
			"principalAmount", "remainingAmount", "totalInstallments", "paidInstallments",
			"installmentAmount", purpose, status, "disbursementDate", "createdAt", "updatedAt")
		VALUES ('LOAN-WD-1', $1, $2,
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
	// A guarantor must not be told they have a loan of their own.
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
