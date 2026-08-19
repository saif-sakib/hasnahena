package utils

import (
	"fmt"
	"regexp"
	"strconv"
)

const MemberIDPrefix = "ACC-KH-33"

var memberIDPattern = regexp.MustCompile(`^ACC-KH-33(\d+)$`)

func FormatMemberSequenceNumber(sequence int64) string {
	return fmt.Sprintf("%03d", sequence)
}

func FormatMemberID(sequence int64) string {
	return MemberIDPrefix + FormatMemberSequenceNumber(sequence)
}

func ParseMemberSequence(memberID string) (int64, bool) {
	matches := memberIDPattern.FindStringSubmatch(memberID)
	if len(matches) != 2 {
		return 0, false
	}
	value, err := strconv.ParseInt(matches[1], 10, 64)
	if err != nil || value <= 0 {
		return 0, false
	}
	return value, true
}

const NextMemberIDQuery = `
        SELECT COALESCE(
                MAX(CAST(SUBSTRING("memberId" FROM 'ACC-KH-33(\d+)$') AS INTEGER)),
                0
        ) + 1
        FROM users
        WHERE "memberId" ~ '^ACC-KH-33[0-9]+$'
`

const MemberIDAdvisoryLockQuery = `SELECT pg_advisory_xact_lock(873921)`
