//go:build integration

// The staff ledger payload carries every field the receipt prints (phone,
// processedBy) — a blank field renders perfectly, so assert the shape.
package repositories

import (
	"context"
	"testing"
)

func TestTheLedgerPayloadCarriesWhatTheReceiptPrints(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	member := seedMember(t, "rcpt-m", "ACC-KH-77001", 0)
	worker := seedStaff(t, "rcpt-w", "WORKER")

	receipt, err := repo.AddMemberDeposit(ctx, member, worker, 5000, "counter deposit")
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}

	data, err := repo.GetAllDeposits(ctx, map[string]interface{}{})
	if err != nil {
		t.Fatalf("GetAllDeposits: %v", err)
	}
	rows, _ := data["deposits"].([]map[string]interface{})
	var row map[string]interface{}
	for _, r := range rows {
		if r["id"] == receipt {
			row = r
			break
		}
	}
	if row == nil {
		t.Fatalf("the deposit just posted (%s) is not in the ledger payload", receipt)
	}

	// Every field the receipt template has a line for.
	for _, field := range []string{"id", "amount", "status", "processedBy", "memberPhone"} {
		if value, ok := row[field]; !ok || value == nil || value == "" {
			t.Errorf("the ledger payload has no %q — the receipt prints a blank line for it", field)
		}
	}

	member2, _ := row["member"].(map[string]interface{})
	if member2 == nil {
		t.Fatal("the ledger payload has no nested member")
	}
	for _, field := range []string{"accountNo", "name", "phone"} {
		if value, ok := member2[field]; !ok || value == nil || value == "" {
			t.Errorf("the nested member has no %q", field)
		}
	}

	// English name separately: documents are English-only (ADR-012).
	if value, ok := row["memberName"]; !ok || value == "" {
		t.Error("the ledger payload has no top-level English memberName — the receipt's Name line prints `-` for any member with a Bengali name")
	}
}
