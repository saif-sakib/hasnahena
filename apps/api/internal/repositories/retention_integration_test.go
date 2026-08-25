//go:build integration

package repositories

import (
	"context"
	"strings"
	"testing"
)

// WO-93 / FR-23 / ADR-033 — a rejected application keeps its decision and loses
// its identity.
//
// Rejection tombstones the applicant's email and phone so they can re-apply and
// keeps everything else forever: the NID number, both parents' names, the date
// of birth, both addresses and the nominee. Nothing removed them, because
// nothing existed that could.
//
// Every fixture here is namespaced `retention-*`: this package truncates
// between tests, but the database is shared with the Next route suite and the
// cmd/server suite, and a fixture that borrows a neighbour's phone number is a
// test that passes or fails on package ordering.

const retentionNID = "1990123456789"

// seedRejectedApplicant builds the exact row RejectRegistration leaves behind —
// tombstoned contact, INACTIVE, MEMBER — with a full set of identity data and a
// REJECT_REGISTRATION audit row `daysAgo` old.
func seedRejectedApplicant(t *testing.T, id string, daysAgo int) string {
	t.Helper()
	ctx := context.Background()

	_, err := testPool.Exec(ctx, `
		INSERT INTO users (id, email, phone, "passwordHash", role, status, "accountNo",
			"nameEn", "nameBn", "fatherName", "motherName", gender, "maritalStatus",
			"childrenCount", "nidNumber", "dateOfBirth", "bloodGroup", profession,
			"formNumber", "createdAt", "updatedAt")
		VALUES ($1, 'rejected+' || $1 || '@hasnahena.local', 'rejected-' || $1, 'x',
			'MEMBER', 'INACTIVE', $2,
			'Applicant ' || $1, 'আবেদনকারী', 'Applicant Father', 'Applicant Mother',
			'MALE', 'UNMARRIED', 0, $3, '1990-01-01', 'B+', 'Farmer',
			'FORM-' || $1, NOW(), NOW())
	`, id, "ACC-KH-"+phoneSuffix(id)[:5], retentionNID)
	if err != nil {
		t.Fatalf("seed rejected applicant %s: %v", id, err)
	}

	for _, kind := range []string{"userPermanentId", "userPresentId"} {
		if _, err := testPool.Exec(ctx, `
			INSERT INTO addresses (id, "houseNo", "roadNo", village, "union", "policeStation",
				district, country, "`+kind+`")
			VALUES (gen_random_uuid()::text, '12', '4', 'Bhekutia', 'Kotwali', 'Kotwali',
				'Jessore', 'বাংলাদেশ', $1)
		`, id); err != nil {
			t.Fatalf("seed %s for %s: %v", kind, id, err)
		}
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO nominees (id, name, relationship, "nidNumber", phone, "userId")
		VALUES (gen_random_uuid()::text, 'Nominee Name', 'Brother', $2, '01700000009', $1)
	`, id, retentionNID); err != nil {
		t.Fatalf("seed nominee for %s: %v", id, err)
	}

	if _, err := testPool.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'REJECT_REGISTRATION', 'USER', $1, NULL,
			NOW() - make_interval(days => $2::int), 'incomplete documents')
	`, id, daysAgo); err != nil {
		t.Fatalf("seed rejection audit row for %s: %v", id, err)
	}

	return id
}

type identitySnapshot struct {
	nid        *string
	nameBn     *string
	dob        *string
	bloodGroup *string
	profession *string
	formNumber *string
	avatarURL  *string
	nameEn     string
	fatherName string
	motherName string
	phone      string
	status     string
	addresses  int
	nominees   int
}

func identityOf(t *testing.T, userID string) identitySnapshot {
	t.Helper()
	var s identitySnapshot
	err := testPool.QueryRow(context.Background(), `
		SELECT u."nidNumber", u."nameBn", u."dateOfBirth"::text, u."bloodGroup", u.profession,
		       u."formNumber", u."avatarUrl", u."nameEn", u."fatherName", u."motherName",
		       u.phone, u.status::text,
		       (SELECT COUNT(*) FROM addresses a WHERE a."userPermanentId" = u.id OR a."userPresentId" = u.id),
		       (SELECT COUNT(*) FROM nominees n WHERE n."userId" = u.id)
		FROM users u WHERE u.id = $1
	`, userID).Scan(&s.nid, &s.nameBn, &s.dob, &s.bloodGroup, &s.profession, &s.formNumber,
		&s.avatarURL, &s.nameEn, &s.fatherName, &s.motherName, &s.phone, &s.status,
		&s.addresses, &s.nominees)
	if err != nil {
		t.Fatalf("read identity for %s: %v", userID, err)
	}
	return s
}

func retentionAuditRows(t *testing.T, userID string) []string {
	t.Helper()
	rows, err := testPool.Query(context.Background(), `
		SELECT COALESCE(details, '') FROM audit_logs
		WHERE action = 'RETENTION_SWEEP' AND "entityId" = $1
		ORDER BY "createdAt"
	`, userID)
	if err != nil {
		t.Fatalf("read retention audit rows: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var details string
		if err := rows.Scan(&details); err != nil {
			t.Fatalf("scan retention audit row: %v", err)
		}
		out = append(out, details)
	}
	return out
}

func TestARejectedApplicationLosesItsIdentityAfterTheWindow(t *testing.T) {
	repo := newTestRepo(t)
	id := seedRejectedApplicant(t, "retention-old", 400)

	report, err := repo.SweepRejectedApplications(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if report.Cleared != 1 {
		t.Fatalf("cleared %d applications, want 1", report.Cleared)
	}
	if report.AddressesRemoved != 2 || report.NomineesRemoved != 1 {
		t.Errorf("removed %d addresses and %d nominees, want 2 and 1",
			report.AddressesRemoved, report.NomineesRemoved)
	}

	after := identityOf(t, id)
	for name, value := range map[string]*string{
		"nidNumber":   after.nid,
		"nameBn":      after.nameBn,
		"dateOfBirth": after.dob,
		"bloodGroup":  after.bloodGroup,
		"profession":  after.profession,
		"formNumber":  after.formNumber,
	} {
		if value != nil {
			t.Errorf("%s survived the sweep as %q — this is the data the retention window exists to remove", name, *value)
		}
	}
	if after.fatherName != "" || after.motherName != "" {
		t.Errorf("parents' names survived the sweep: %q / %q", after.fatherName, after.motherName)
	}
	if after.addresses != 0 || after.nominees != 0 {
		t.Errorf("%d addresses and %d nominees survived the sweep", after.addresses, after.nominees)
	}

	// What must NOT change: the decision is kept. The name is what the rejection
	// was about, the tombstoned phone is what lets the applicant re-apply, and
	// the status is the decision itself.
	if !strings.HasPrefix(after.phone, "rejected-") {
		t.Errorf("phone is %q — the tombstone is what lets a rejected applicant re-apply", after.phone)
	}
	if after.status != "INACTIVE" || after.nameEn == "" {
		t.Errorf("the decision itself was altered: status %q, nameEn %q", after.status, after.nameEn)
	}
}

func TestARecentRejectionKeepsItsIdentity(t *testing.T) {
	repo := newTestRepo(t)
	id := seedRejectedApplicant(t, "retention-recent", 10)

	report, err := repo.SweepRejectedApplications(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if report.Cleared != 0 {
		t.Fatalf("cleared %d applications, want 0 — a rejection ten days old is inside the window", report.Cleared)
	}
	if identityOf(t, id).nid == nil {
		t.Error("a ten-day-old rejection was stripped; the window is a year (ADR-033)")
	}
}

func TestTheSweepLeavesEveryAccountThatIsNotARejectedApplication(t *testing.T) {
	repo := newTestRepo(t)

	// An ACTIVE member, backdated, with the same identity data.
	member := seedMember(t, "retention-member", "ACC-KH-40001", 5000)
	if _, err := testPool.Exec(context.Background(), `
		UPDATE users SET "nidNumber" = $2, "updatedAt" = NOW() - make_interval(days => 900) WHERE id = $1
	`, member, retentionNID); err != nil {
		t.Fatalf("backdate member: %v", err)
	}

	// A worker an admin deactivated years ago. Same role-free INACTIVE shape as
	// a rejection; the tombstoned phone is the only thing telling them apart,
	// and a sweep that got this wrong would erase a staff record.
	worker := seedStaff(t, "retention-worker", "WORKER")
	if _, err := testPool.Exec(context.Background(), `
		UPDATE users SET status = 'INACTIVE', "nidNumber" = $2,
		    "updatedAt" = NOW() - make_interval(days => 900) WHERE id = $1
	`, worker, retentionNID); err != nil {
		t.Fatalf("deactivate worker: %v", err)
	}

	// And the one that is a single clause away from a rejected application: a
	// member who WAS approved and was later deactivated. Same role, same status,
	// and this foundation is still holding their savings. `approvedAt` and the
	// contact tombstone are what separate them.
	suspended := seedMember(t, "retention-suspended", "ACC-KH-40002", 12000)
	if _, err := testPool.Exec(context.Background(), `
		UPDATE users SET status = 'INACTIVE', "nidNumber" = $2, "approvedAt" = NOW() - make_interval(days => 900),
		    "updatedAt" = NOW() - make_interval(days => 900) WHERE id = $1
	`, suspended, retentionNID); err != nil {
		t.Fatalf("suspend member: %v", err)
	}

	report, err := repo.SweepRejectedApplications(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if report.Cleared != 0 {
		t.Fatalf("cleared %d rows, want 0", report.Cleared)
	}
	for _, id := range []string{member, worker, suspended} {
		if identityOf(t, id).nid == nil {
			t.Errorf("%s was stripped by the rejected-application sweep", id)
		}
	}
}

func TestTheRetentionAuditRowNamesNothingItErased(t *testing.T) {
	repo := newTestRepo(t)
	id := seedRejectedApplicant(t, "retention-audit", 400)
	before := identityOf(t, id)

	if _, err := repo.SweepRejectedApplications(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	rows := retentionAuditRows(t, id)
	if len(rows) != 1 {
		t.Fatalf("wrote %d audit rows, want exactly 1", len(rows))
	}
	details := rows[0]

	// audit_logs is append-only (DATA-08), so anything named here outlives the
	// erasure. An audit row carrying the NID number would be erasure that
	// preserves what it erased (ADR-033).
	for name, value := range map[string]string{
		"the NID number":    retentionNID,
		"the name":          before.nameEn,
		"the father's name": before.fatherName,
		"the mother's name": before.motherName,
		"the village":       "Bhekutia",
		"the Bengali name":  "আবেদনকারী",
	} {
		if value != "" && strings.Contains(details, value) {
			t.Errorf("the retention audit row names %s (%q): %q", name, value, details)
		}
	}
	if !strings.Contains(details, "ACC-KH-") {
		t.Errorf("the retention audit row names neither the account number nor anything else "+
			"an operator can act on: %q", details)
	}
}

func TestTheRetentionWindowIsConfigurable(t *testing.T) {
	repo := newTestRepo(t)
	seedRejectedApplicant(t, "retention-configured", 5)

	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO system_config (id, key, value, "updatedAt")
		VALUES ('cfg_retention_test', $1, '2', NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
	`, RejectedRetentionConfigKey); err != nil {
		t.Fatalf("set retention config: %v", err)
	}

	if got := repo.GetRejectedRetentionDays(context.Background()); got != 2 {
		t.Fatalf("GetRejectedRetentionDays = %d, want 2", got)
	}
	report, err := repo.SweepRejectedApplications(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if report.Cleared != 1 {
		t.Fatalf("cleared %d, want 1 — a five-day-old rejection is past a two-day window", report.Cleared)
	}
}

func TestABadRetentionValueFallsBackToTheDefaultRatherThanStopping(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	for _, bad := range []string{"one year", "", "0", "-30"} {
		if _, err := testPool.Exec(ctx, `
			INSERT INTO system_config (id, key, value, "updatedAt")
			VALUES ('cfg_retention_test', $1, $2, NOW())
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
		`, RejectedRetentionConfigKey, bad); err != nil {
			t.Fatalf("set retention config to %q: %v", bad, err)
		}
		// Refusing to run would keep the data this exists to remove, silently
		// and indefinitely. The safe direction to fail in is the documented
		// default, not zero and not "never".
		if got := repo.GetRejectedRetentionDays(ctx); got != DefaultRejectedRetentionDays {
			t.Errorf("value %q gave a window of %d days, want the %d-day default",
				bad, got, DefaultRejectedRetentionDays)
		}
	}
}

func TestSweepingTwiceWritesOneAuditRow(t *testing.T) {
	repo := newTestRepo(t)
	id := seedRejectedApplicant(t, "retention-twice", 400)

	for pass := 1; pass <= 2; pass++ {
		if _, err := repo.SweepRejectedApplications(context.Background()); err != nil {
			t.Fatalf("sweep pass %d: %v", pass, err)
		}
	}

	// A sweep that re-swept an already-clean row would write an audit row a day
	// saying it erased something that was already gone, for the life of the
	// deployment — which is how an append-only table becomes unreadable.
	if rows := retentionAuditRows(t, id); len(rows) != 1 {
		t.Fatalf("two passes wrote %d audit rows, want 1", len(rows))
	}
}
