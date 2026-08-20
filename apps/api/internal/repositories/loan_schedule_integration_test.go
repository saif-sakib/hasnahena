//go:build integration

package repositories

import (
	"context"
	"testing"
	"time"

	"hasnahena/apps/api/internal/money"
)

// The two staff loan lists must answer the same question the same way.
//
// They are one screen now — components/dashboard/screens/loans-screen.tsx,
// re-exported by both dashboards — and the only thing that differs between an
// admin opening it and a worker opening it is which endpoint fetches the rows.
// So a disagreement between these two queries is not a discrepancy in a report;
// it is the same page showing two different numbers to two people looking at it
// together.
//
// It did. `/worker/loans` sent `installmentStartDate` as `nextDueDate`, which is
// behind every active loan by construction, so the browser's
// `nextDueDate < now` marked all four seeded loans overdue. `/admin/loans` sent
// no due date at all, so it marked none. Both now carry `isOverdue` and
// `missedInstallments` from money.MissedInstallments — the same arithmetic that
// decides whether a loan may be defaulted.
func TestBothLoanListsAgreeOnArrears(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)

	// Four months into a twelve-month schedule with nothing paid: four missed.
	behind := seedLoanBehindBy(t, borrower, guarantor, 12000, 4)
	// One month in: nothing due yet, because the first instalment falls due one
	// month *after* the schedule starts.
	current := seedLoanBehindBy(t, seedMember(t, "m3", "ACC-KH-33003", 5000), guarantor, 12000, 0)
	// A status neither list may drop. REJECTED and APPROVED were exactly the two
	// the worker's query omitted.
	rejected := seedLoanBehindBy(t, seedMember(t, "m4", "ACC-KH-33004", 5000), guarantor, 9000, 1)
	setLoanStatus(t, rejected, "REJECTED")

	adminRows, err := repo.GetAllLoans(ctx, map[string]interface{}{})
	if err != nil {
		t.Fatalf("admin loans: %v", err)
	}
	workerRows, err := repo.GetWorkerLoans(ctx, "")
	if err != nil {
		t.Fatalf("worker loans: %v", err)
	}

	admin := byLoanID(t, adminRows)
	worker := byLoanID(t, workerRows)

	// Same rows, not merely the same answers about the rows they share. The
	// worker's query used to filter `status IN (…)` and omit APPROVED and
	// REJECTED, so the one Loans component reported a different number of loans
	// depending on which dashboard opened it — and a rejected application is
	// what a member is most likely to ask a field worker about.
	for id := range admin {
		if _, ok := worker[id]; !ok {
			t.Errorf("loan %s (status %v) is in the admin list and not the worker's",
				id, admin[id]["status"])
		}
	}
	for id := range worker {
		if _, ok := admin[id]; !ok {
			t.Errorf("loan %s (status %v) is in the worker list and not the admin's",
				id, worker[id]["status"])
		}
	}

	for _, id := range []string{behind, current} {
		a, ok := admin[id]
		if !ok {
			t.Fatalf("loan %s missing from the admin list", id)
		}
		w, ok := worker[id]
		if !ok {
			t.Fatalf("loan %s missing from the worker list", id)
		}
		if a["isOverdue"] != w["isOverdue"] {
			t.Errorf("loan %s: admin isOverdue = %v, worker = %v", id, a["isOverdue"], w["isOverdue"])
		}
		if a["missedInstallments"] != w["missedInstallments"] {
			t.Errorf("loan %s: admin missed = %v, worker = %v",
				id, a["missedInstallments"], w["missedInstallments"])
		}
		if a["nextDueDate"] != w["nextDueDate"] {
			t.Errorf("loan %s: admin nextDueDate = %v, worker = %v",
				id, a["nextDueDate"], w["nextDueDate"])
		}
	}

	if got := admin[behind]["missedInstallments"]; got != 4 {
		t.Errorf("a loan four months into its schedule with nothing paid: missed = %v, want 4", got)
	}
	if got := admin[current]["missedInstallments"]; got != 0 {
		t.Errorf("a loan on the day its schedule starts: missed = %v, want 0", got)
	}
	if admin[current]["isOverdue"] != false {
		t.Error("a loan with nothing yet due is not overdue")
	}
}

// A due date must be the NEXT instalment, not the schedule's start and not its
// end. Both were shipped: the worker's list sent the start, the member's own
// loan history sent `expectedEndDate`, which told somebody on instalment 2 of
// 24 that nothing was due for two years.
func TestNextDueDateIsTheNextInstalment(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	borrower := seedMember(t, "m1", "ACC-KH-33001", 20000)
	guarantor := seedMember(t, "m2", "ACC-KH-33002", 30000)
	loanID := seedLoanBehindBy(t, borrower, guarantor, 12000, 4)

	rows, err := repo.GetAllLoans(ctx, map[string]interface{}{})
	if err != nil {
		t.Fatalf("admin loans: %v", err)
	}
	loan := byLoanID(t, rows)[loanID]

	raw, ok := loan["nextDueDate"].(string)
	if !ok {
		t.Fatal("an active loan reports no next due date")
	}
	due, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatalf("parse nextDueDate %q: %v", raw, err)
	}

	// Nothing paid, so the next instalment is the first: one month after a
	// schedule that started four months ago, i.e. three months ago.
	start := time.Now().AddDate(0, -4, 0)
	want, ok := money.NextDueDate(start, 12, 0)
	if !ok {
		t.Fatal("money.NextDueDate declined a live schedule")
	}
	if delta := due.Sub(want); delta > 24*time.Hour || delta < -24*time.Hour {
		t.Errorf("nextDueDate = %s, want about %s", due, want)
	}
	if !due.Before(time.Now()) {
		t.Error("a loan four months behind should have a due date in the past")
	}
}

func byLoanID(t *testing.T, rows []map[string]interface{}) map[string]map[string]interface{} {
	t.Helper()
	out := make(map[string]map[string]interface{}, len(rows))
	for _, row := range rows {
		id, _ := row["id"].(string)
		out[id] = row
	}
	return out
}

func setLoanStatus(t *testing.T, loanID, status string) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(),
		`UPDATE loans SET status = $2::"LoanStatus" WHERE id = $1`, loanID, status); err != nil {
		t.Fatalf("set loan status %s: %v", status, err)
	}
}
