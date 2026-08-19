package utils

import "testing"

func TestFormatMemberID(t *testing.T) {
	tests := []struct {
		sequence int64
		want     string
	}{
		{1, "ACC-KH-33001"},
		{9, "ACC-KH-33009"},
		{10, "ACC-KH-33010"},
		{999, "ACC-KH-33999"},
		// Past three digits the number simply grows; it is never truncated,
		// because a member ID that collides is worse than one that is long.
		{1000, "ACC-KH-331000"},
		{12345, "ACC-KH-3312345"},
	}

	for _, tc := range tests {
		if got := FormatMemberID(tc.sequence); got != tc.want {
			t.Errorf("FormatMemberID(%d) = %q, want %q", tc.sequence, got, tc.want)
		}
	}
}

// A member ID has to survive the round trip, or a printed card cannot be looked
// up again.
func TestMemberIDRoundTrip(t *testing.T) {
	for _, sequence := range []int64{1, 2, 9, 10, 99, 100, 101, 999, 1000, 33001, 999999} {
		memberID := FormatMemberID(sequence)
		got, ok := ParseMemberSequence(memberID)
		if !ok {
			t.Errorf("ParseMemberSequence(%q) failed for sequence %d", memberID, sequence)
			continue
		}
		if got != sequence {
			t.Errorf("round trip of %d gave %q which parsed back as %d", sequence, memberID, got)
		}
	}
}

func TestParseMemberSequenceRejectsMalformed(t *testing.T) {
	bad := []string{
		"",
		"ACC-KH-33",           // prefix with no sequence
		"ACC-KH-33000",        // sequence zero is not a member
		"ACC-KH-34001",        // wrong branch digits
		"acc-kh-33001",        // lower case
		"ACC-KH-33001 ",       // trailing space
		" ACC-KH-33001",       // leading space
		"ACC-KH-33001X",       // trailing junk
		"ACC-KH-33abc",        // non-numeric sequence
		"XACC-KH-33001",       // leading junk
		"MEMBER-ACC-KH-33001", // embedded, not anchored
	}

	for _, id := range bad {
		if _, ok := ParseMemberSequence(id); ok {
			t.Errorf("ParseMemberSequence(%q) accepted a malformed member ID", id)
		}
	}
}

func TestFormatMemberSequenceNumberPads(t *testing.T) {
	if got := FormatMemberSequenceNumber(7); got != "007" {
		t.Errorf("FormatMemberSequenceNumber(7) = %q, want %q", got, "007")
	}
	if got := FormatMemberSequenceNumber(1234); got != "1234" {
		t.Errorf("FormatMemberSequenceNumber(1234) = %q, want %q", got, "1234")
	}
}
