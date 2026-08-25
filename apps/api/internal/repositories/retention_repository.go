package repositories

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Data retention for applications the foundation refused — WO-93, FR-23,
// ADR-033.
//
// A rejection tombstones the applicant's email and phone so they can re-apply,
// and keeps everything else forever: the NID number, both parents' names, the
// date of birth, the two addresses and the nominee. The decision is worth
// keeping — a refusal may have to be justified, and its `audit_logs` row is
// permanent — but the identity documents are not part of that justification a
// year later.
//
// So this sweeps them, on the same ticker pattern as reconciliation.
//
// Why here and not in the Next app, which owns the *member* erasure half:
// this needs an always-on process, and — unlike member erasure — it needs no
// Cloudinary. `avatarUrl` is written in exactly one place, the signed-in
// member's own profile page, and a rejected applicant has never signed in. That
// assumption is checked rather than assumed: SweepRejectedApplications counts
// any rejected row that has one and reports it, so if a future upload path
// reaches an applicant this fails loudly instead of leaving a photograph on a
// public CDN with the row that pointed at it wiped.

// RejectedRetentionConfigKey is the admin-editable window, in days.
const RejectedRetentionConfigKey = "security.rejectedRetentionDays"

// DefaultRejectedRetentionDays is one year — long enough that a re-application
// or a dispute can still be checked against what was submitted, short enough
// that "forever" is not the answer. ADR-033.
const DefaultRejectedRetentionDays = 365

// RetentionSweepReport is what one pass did. Every field is a count rather than
// a list: this runs unattended, and a log line naming the people whose identity
// documents were just erased would put them back in a log aggregator.
type RetentionSweepReport struct {
	Scanned          int
	Cleared          int
	AddressesRemoved int
	NomineesRemoved  int
	// AvatarsFound is expected to be zero forever. See the note above.
	AvatarsFound int
	Duration     time.Duration
}

// GetRejectedRetentionDays reads the window, falling back to the default for a
// missing row, an unparseable value or a nonsensical one.
//
// It never returns an error for a bad value on purpose. A sweep that refused to
// run because somebody typed "one year" into a settings field would keep the
// data it exists to remove, silently and indefinitely; falling back to the
// documented default is the safe direction to fail in.
func (r *UserRepository) GetRejectedRetentionDays(ctx context.Context) int {
	var raw string
	err := r.db.QueryRow(ctx, `
		SELECT value FROM system_config WHERE key = $1 LIMIT 1
	`, RejectedRetentionConfigKey).Scan(&raw)
	if err != nil {
		return DefaultRejectedRetentionDays
	}
	value, convErr := strconv.Atoi(strings.TrimSpace(raw))
	if convErr != nil || value < 1 {
		return DefaultRejectedRetentionDays
	}
	return value
}

// rejectedApplicantsSQL selects the rows a sweep is allowed to touch.
//
// Three conditions, and each one is load-bearing:
//
//   - the shape is exactly what RejectRegistration leaves behind, and it takes
//     four clauses rather than two because two of the three other things that
//     produce an INACTIVE row are one clause away. A deactivated worker is
//     excluded by the role; an approved member the admin later deactivated is
//     excluded by `approvedAt IS NULL` AND by the tombstoned phone — deliberately
//     by both, because that member is somebody whose savings this foundation
//     still holds, and one clause deleted by mistake should not be enough. It is
//     the same predicate `rejectedRegistrationFilter` uses in
//     `apps/web/app/api/v1/registrations/route.ts`, which is what lets a rejected
//     applicant re-apply.
//   - the age is measured from the REJECT_REGISTRATION audit row rather than
//     from `updatedAt`, because `updatedAt` moves whenever anything writes the
//     row — including this sweep. Anchoring retention to a mutable timestamp is
//     how a retention window silently becomes "a year after we last touched it".
//   - something must still be left to clear, so a second pass over an
//     already-swept row is not an UPDATE that does nothing and an audit row that
//     says it did.
const rejectedApplicantsSQL = `
	SELECT
		u.id,
		u."accountNo",
		u."avatarUrl" IS NOT NULL
	FROM users u
	WHERE u.role = 'MEMBER'
	  AND u.status = 'INACTIVE'
	  AND u."approvedAt" IS NULL
	  AND u.phone LIKE 'rejected-%'
	  AND COALESCE((
	        SELECT MIN(a."createdAt")
	        FROM audit_logs a
	        WHERE a.action = 'REJECT_REGISTRATION'
	          AND a."entityType" = 'USER'
	          AND a."entityId" = u.id
	      ), u."updatedAt") < NOW() - make_interval(days => $1::int)
	  AND (
	        u."nidNumber" IS NOT NULL
	     OR u."dateOfBirth" IS NOT NULL
	     OR u."bloodGroup" IS NOT NULL
	     OR u.profession IS NOT NULL
	     OR u."formNumber" IS NOT NULL
	     OR u."avatarUrl" IS NOT NULL
	     OR u."nameBn" IS NOT NULL
	     OR u."fatherName" <> ''
	     OR u."motherName" <> ''
	     OR EXISTS (SELECT 1 FROM addresses ad WHERE ad."userPermanentId" = u.id OR ad."userPresentId" = u.id)
	     OR EXISTS (SELECT 1 FROM nominees n WHERE n."userId" = u.id)
	  )
	ORDER BY u.id
	LIMIT 500
`

// clearRejectedIdentitySQL empties every identity column the applicant filled
// in. `fatherName` and `motherName` are NOT NULL, so they are emptied rather
// than nulled; `nameEn` is left alone because it is what the rejection decision
// is *about*, and the audit row that justifies the refusal would name nobody
// without it.
const clearRejectedIdentitySQL = `
	UPDATE users
	SET "nidNumber"   = NULL,
	    "avatarUrl"   = NULL,
	    "dateOfBirth" = NULL,
	    "bloodGroup"  = NULL,
	    profession    = NULL,
	    "formNumber"  = NULL,
	    "nameBn"      = NULL,
	    "fatherName"  = '',
	    "motherName"  = '',
	    "updatedAt"   = NOW()
	WHERE id = $1
`

// SweepRejectedApplications clears the identity data of every rejected
// application past the retention window, one transaction per applicant.
//
// Per applicant rather than one big transaction: a sweep that fails halfway
// through should leave the ones it finished finished, and the alternative holds
// a write lock on hundreds of user rows while it works. The 500-row limit is the
// same reasoning — the first pass after this ships has a backlog to clear, and
// it should clear it over several ticks rather than in one long transaction.
func (r *UserRepository) SweepRejectedApplications(ctx context.Context) (RetentionSweepReport, error) {
	started := time.Now()
	report := RetentionSweepReport{}

	days := r.GetRejectedRetentionDays(ctx)

	type candidate struct {
		id        string
		accountNo *string
		hasAvatar bool
	}

	rows, err := r.db.Query(ctx, rejectedApplicantsSQL, days)
	if err != nil {
		return report, fmt.Errorf("select rejected applications: %w", err)
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.accountNo, &c.hasAvatar); err != nil {
			rows.Close()
			return report, fmt.Errorf("scan rejected application: %w", err)
		}
		candidates = append(candidates, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return report, fmt.Errorf("read rejected applications: %w", err)
	}
	report.Scanned = len(candidates)

	for _, c := range candidates {
		if c.hasAvatar {
			report.AvatarsFound++
		}
		addresses, nominees, err := r.clearRejectedApplicant(ctx, c.id, c.accountNo, days)
		if err != nil {
			return report, err
		}
		report.Cleared++
		report.AddressesRemoved += addresses
		report.NomineesRemoved += nominees
	}

	report.Duration = time.Since(started)
	return report, nil
}

func (r *UserRepository) clearRejectedApplicant(
	ctx context.Context,
	userID string,
	accountNo *string,
	days int,
) (addresses int, nominees int, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)

	addressResult, err := tx.Exec(ctx,
		`DELETE FROM addresses WHERE "userPermanentId" = $1 OR "userPresentId" = $1`, userID)
	if err != nil {
		return 0, 0, fmt.Errorf("delete addresses: %w", err)
	}
	nomineeResult, err := tx.Exec(ctx, `DELETE FROM nominees WHERE "userId" = $1`, userID)
	if err != nil {
		return 0, 0, fmt.Errorf("delete nominee: %w", err)
	}
	if _, err := tx.Exec(ctx, clearRejectedIdentitySQL, userID); err != nil {
		return 0, 0, fmt.Errorf("clear identity: %w", err)
	}

	// The account number, not the name, the NID or the address. `audit_logs` is
	// append-only, so anything named here outlives the erasure — an audit row
	// that recorded what it erased would be erasure that preserves what it
	// erased (ADR-033). A rejected applicant may have no account number at all,
	// in which case the row names the internal id and nothing about the person.
	identifier := userID
	if accountNo != nil && *accountNo != "" {
		identifier = *accountNo
	}
	details := fmt.Sprintf(
		"Retention sweep cleared the identity data of rejected application %s after %d days",
		identifier, days,
	)
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (id, action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES (gen_random_uuid()::text, 'RETENTION_SWEEP', 'USER', $1, NULL, NOW(), $2)
	`, userID, details); err != nil {
		return 0, 0, fmt.Errorf("write audit row: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return int(addressResult.RowsAffected()), int(nomineeResult.RowsAffected()), nil
}
