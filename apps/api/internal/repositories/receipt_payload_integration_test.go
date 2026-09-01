//go:build integration

// The staff ledger payload carries everything the receipt prints.
//
// `GetAllDeposits` feeds the Transactions screen on both staff dashboards, and
// that screen's Download button builds the member's receipt from the row it is
// looking at. The receipt template has always had a Name, a Mobile and a
// "Processed by" line; the payload had never had a phone column at all, and
// `processedBy` was selected and then dropped by the mapper. So every receipt
// printed from that screen carried a blank Mobile and a `-` under the name of
// the person who took the money — reported by the owner, and invisible to every
// existing test because nothing asserted on this payload's *shape*.
//
// It is asserted here rather than in the browser because the defect is a missing
// column, and a screen with a blank field renders perfectly.
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

	// Every field the receipt template has a line for. A blank one is a receipt
	// that cannot be matched to a member or to the staff member who took the
	// money — which is the whole reason a receipt is issued.
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

	// The English name, separately. The nested `name` prefers Bengali where a
	// member has one, and generated documents are English only (ADR-012) — the
	// PDF sanitiser strips every glyph the standard fonts cannot encode, so a
	// Bengali name reaches the paper as a bare `-`. The screen reads this
	// top-level field for the document and the nested one for the table.
	if value, ok := row["memberName"]; !ok || value == "" {
		t.Error("the ledger payload has no top-level English memberName — the receipt's Name line prints `-` for any member with a Bengali name")
	}
}
