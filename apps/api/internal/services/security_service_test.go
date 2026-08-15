package services

import (
	"testing"
	"time"
)

// The first-login flow changes the temporary password (which revokes every
// token for that user) and then signs in again a few hundred milliseconds
// later. The new token must survive, or the member logs in to a dashboard that
// 401s on every call.
func TestTokenIssuedBeforeRevocation(t *testing.T) {
	// A fixed instant with a sub-second component, which is what NOW() gives.
	revokedAt := time.Date(2026, 8, 15, 12, 0, 5, 400_000_000, time.UTC)

	// JWT iat is always truncated to a whole second.
	iat := func(sec int) time.Time {
		return time.Date(2026, 8, 15, 12, 0, sec, 0, time.UTC)
	}

	tests := []struct {
		name        string
		issuedAt    time.Time
		wantRevoked bool
	}{
		{"token from an earlier second is revoked", iat(4), true},
		{"token from well before is revoked", iat(0), true},
		{"token re-issued in the same second survives", iat(5), false},
		{"token from a later second survives", iat(6), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tokenIssuedBeforeRevocation(tc.issuedAt, revokedAt)
			if got != tc.wantRevoked {
				t.Errorf("tokenIssuedBeforeRevocation(%v, %v) = %v, want %v",
					tc.issuedAt.Format(time.RFC3339Nano), revokedAt.Format(time.RFC3339Nano), got, tc.wantRevoked)
			}
		})
	}
}

// A marker written exactly on a second boundary must still revoke everything
// issued before it.
func TestTokenIssuedBeforeRevocationOnExactSecond(t *testing.T) {
	revokedAt := time.Date(2026, 8, 15, 12, 0, 5, 0, time.UTC)

	if !tokenIssuedBeforeRevocation(time.Date(2026, 8, 15, 12, 0, 4, 0, time.UTC), revokedAt) {
		t.Error("token from the previous second should be revoked")
	}
	if tokenIssuedBeforeRevocation(time.Date(2026, 8, 15, 12, 0, 5, 0, time.UTC), revokedAt) {
		t.Error("token issued at the marker second should survive")
	}
}
