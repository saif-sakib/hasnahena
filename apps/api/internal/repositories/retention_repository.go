package repositories

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Retention for refused applications (WO-93, FR-23, ADR-033): clears identity
// data past the window; the decision itself is kept. Runs in Go because it
// needs no Cloudinary — a rejected applicant never signed in, so has no avatar;
// SweepRejectedApplications reports any that do.

// RejectedRetentionConfigKey is the admin-editable window, in days.
const RejectedRetentionConfigKey = "security.rejectedRetentionDays"

// DefaultRejectedRetentionDays is one year (ADR-033).
const DefaultRejectedRetentionDays = 365

// RetentionSweepReport holds counts only — never names in a log.
type RetentionSweepReport struct {
	Scanned          int
	Cleared          int
	AddressesRemoved int
	NomineesRemoved  int
	// AvatarsFound is expected to be zero forever. See the note above.
	AvatarsFound int
	Duration     time.Duration
}

// GetRejectedRetentionDays falls back to the default on a missing or bad
// value, never erroring: a sweep that refuses to run keeps the data.
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

// rejectedApplicantsSQL selects rows a sweep may touch:
//   - exactly RejectedApplicationSQL (shared with the indexes, registration and
//     login), so a deactivated member with savings is never matched;
//   - aged from the REJECT_REGISTRATION audit row, not the mutable updatedAt;
//   - something still left to clear, so a re-pass is a no-op.
//
// rejectedApplicationPrefixed derives the `u.`-aliased form rather than
// restating it (rejected-application.test.ts).
var rejectedApplicationPrefixed = strings.NewReplacer(
	"role =", "u.role =",
	"status =", "u.status =",
	`"approvedAt"`, `u."approvedAt"`,
	`"passwordHash"`, `u."passwordHash"`,
).Replace(RejectedApplicationSQL)

var rejectedApplicantsSQL = `
	SELECT
		u.id,
		-- Application number first: rejected applicants have no account number (ADR-039).
		COALESCE(NULLIF(u."formNumber", ''), NULLIF(u."accountNo", '')),
		u."avatarUrl" IS NOT NULL
	FROM users u
	WHERE (` + rejectedApplicationPrefixed + `)
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
	     OR u."rejectionReasonNote" IS NOT NULL
	     OR u.email IS NOT NULL
	     OR u.phone NOT LIKE 'expired-%'
	     OR EXISTS (SELECT 1 FROM addresses ad WHERE ad."userId" = u.id)
	     OR EXISTS (SELECT 1 FROM nominees n WHERE n."userId" = u.id)
	  )
	ORDER BY u.id
	LIMIT 500
`

// clearRejectedIdentitySQL empties identity columns. fatherName/motherName are
// NOT NULL so emptied; nameEn is kept (the decision is about them). Email and
// phone are cleared on this schedule, not at rejection.
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
	    -- The admin's free-text note is identity data; the code and date are kept.
	    "rejectionReasonNote" = NULL,
	    -- Contact details go here, not at rejection. phone is NOT NULL, so it
	    -- gets a unique tombstone. (No backticks: this is a Go raw string.)
	    email         = NULL,
	    phone         = 'expired-' || id,
	    "updatedAt"   = NOW()
	WHERE id = $1
`

// SweepRejectedApplications clears expired rejected applications, one
// transaction per applicant, 500 per pass.
func (r *UserRepository) SweepRejectedApplications(ctx context.Context) (RetentionSweepReport, error) {
	started := time.Now()
	report := RetentionSweepReport{}

	days := r.GetRejectedRetentionDays(ctx)

	type candidate struct {
		id string
		// The application number, or an account number on older rows; maybe neither.
		reference *string
		hasAvatar bool
	}

	rows, err := r.db.Query(ctx, rejectedApplicantsSQL, days)
	if err != nil {
		return report, fmt.Errorf("select rejected applications: %w", err)
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.reference, &c.hasAvatar); err != nil {
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
		addresses, nominees, err := r.clearRejectedApplicant(ctx, c.id, c.reference, days)
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
	reference *string,
	days int,
) (addresses int, nominees int, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)

	addressResult, err := tx.Exec(ctx,
		`DELETE FROM addresses WHERE "userId" = $1`, userID)
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

	// Name only the application reference — audit_logs outlives the erasure (ADR-033).
	identifier := userID
	if reference != nil && *reference != "" {
		identifier = *reference
	}
	details := fmt.Sprintf(
		"Retention sweep cleared the identity data of rejected application %s after %d days",
		identifier, days,
	)
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (action, "entityType", "entityId", "performedBy", "createdAt", details)
		VALUES ('RETENTION_SWEEP', 'USER', $1, NULL, NOW(), $2)
	`, userID, details); err != nil {
		return 0, 0, fmt.Errorf("write audit row: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return int(addressResult.RowsAffected()), int(nomineeResult.RowsAffected()), nil
}
