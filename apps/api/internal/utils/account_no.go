package utils

import (
	"fmt"
	"regexp"
	"strconv"
)

const AccountNoPrefix = "ACC-KH-33"

var accountNoPattern = regexp.MustCompile(`^ACC-KH-33(\d+)$`)

func FormatAccountSequenceNumber(sequence int64) string {
	return fmt.Sprintf("%03d", sequence)
}

func FormatAccountNo(sequence int64) string {
	return AccountNoPrefix + FormatAccountSequenceNumber(sequence)
}

func ParseAccountSequence(memberID string) (int64, bool) {
	matches := accountNoPattern.FindStringSubmatch(memberID)
	if len(matches) != 2 {
		return 0, false
	}
	value, err := strconv.ParseInt(matches[1], 10, 64)
	if err != nil || value <= 0 {
		return 0, false
	}
	return value, true
}

const NextAccountNoQuery = `
        SELECT COALESCE(
                MAX(CAST(SUBSTRING("accountNo" FROM 'ACC-KH-33(\d+)$') AS INTEGER)),
                0
        ) + 1
        FROM users
        WHERE "accountNo" ~ '^ACC-KH-33[0-9]+$'
`

const AccountNoAdvisoryLockQuery = `SELECT pg_advisory_xact_lock(873921)`
