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
//     `RejectedApplicationSQL` — the same predicate the partial unique indexes
//     carry and the same one the Next registration route and the Go login lookup
//     use, so "who may re-apply", "who owns an email" and "whose data expires"
//     cannot answer differently.
//
//     **This clause used to be `u.phone LIKE 'rejected-%'`**, matching the
//     tombstone that rejection wrote over the applicant's phone number. When
//     that scramble was removed on 2026-08-26 — it was what made telling the
//     applicant impossible — this predicate would have matched nothing ever
//     again, and the sweep would have gone on reporting success while retaining
//     every rejected applicant's NID for ever. Nothing about it would have
//     looked wrong: the job runs, the query is valid, the count is zero.
//
//   - the age is measured from the REJECT_REGISTRATION audit row rather than
//     from `updatedAt`, because `updatedAt` moves whenever anything writes the
//     row — including this sweep. Anchoring retention to a mutable timestamp is
//     how a retention window silently becomes "a year after we last touched it".
//
//   - something must still be left to clear, so a second pass over an
//     already-swept row is not an UPDATE that does nothing and an audit row that
//     says it did.
//
// rejectedApplicationPrefixed is RejectedApplicationSQL with the `u.` alias the
// query below joins under. Derived rather than written out a second time: two
// spellings of one predicate is the drift `rejected-application.test.ts` exists
// to refuse.
var rejectedApplicationPrefixed = strings.NewReplacer(
	"role =", "u.role =",
	"status =", "u.status =",
	`"approvedAt"`, `u."approvedAt"`,
	`"passwordHash"`, `u."passwordHash"`,
).Replace(RejectedApplicationSQL)

var rejectedApplicantsSQL = `
	SELECT
		u.id,
		-- The application's number first. A rejected applicant has **no account
		-- number** — that is issued on admission and nowhere else (ADR-039) — so
		-- COALESCE-ing the other way round would name every swept row after a
		-- column that is always NULL, and the audit trail would record each
		-- erasure against an internal cuid.
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

// clearRejectedIdentitySQL empties every identity column the applicant filled
// in. `fatherName` and `motherName` are NOT NULL, so they are emptied rather
// than nulled; `nameEn` is left alone because it is what the rejection decision
// is *about*, and the audit row that justifies the refusal would name nobody
// without it.
//
// The applicant's **email and phone are also left**, and that is new as of
// 2026-08-26. They used to be destroyed at the moment of rejection, to free the
// unique constraint for a re-application — which is why nothing could tell the
// applicant they had been rejected. Uniqueness is scoped to live rows now, so
// the details survive long enough for the rejection email to be sent, and are
// erased on this schedule with everything else rather than on the spot.
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
	    -- The admin's free-text rejection note, which may name the applicant or
	    -- describe their documents. The *code* and the date are the decision
	    -- itself and are kept for ever (ADR-033); the prose an admin typed
	    -- around it is identity data like the rest of this list.
	    "rejectionReasonNote" = NULL,
	    -- The contact details, erased **here** rather than at the moment of
	    -- rejection. They used to be overwritten on the spot, which is what left
	    -- the foundation unable to tell the applicant anything; they now live
	    -- exactly as long as the rest of the identity data and go with it.
	    --
	    -- The phone column is NOT NULL, so it is tombstoned rather than nulled,
	    -- and the tombstone stays unique because a later application by somebody
	    -- else could otherwise collide with it. The email column can simply go.
	    -- (No backticks in this comment: it lives inside a Go raw string.)
	    email         = NULL,
	    phone         = 'expired-' || id,
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
		id string
		// The application number, falling back to an account number for the rows
		// written before the two were separated. Never both, and often neither.
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

	// The application's reference — not the name, the NID or the address.
	// `audit_logs` is append-only, so anything named here outlives the erasure,
	// and a row that recorded what it erased would be erasure that preserves what
	// it erased (ADR-033). A row with neither reference names the internal id and
	// nothing about the person.
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
