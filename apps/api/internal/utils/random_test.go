package utils

import (
	"crypto/rand"
	"strings"
	"testing"
)

const (
	passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"
	digitAlphabet    = "0123456789"
)

// biasedString is the implementation WO-65 replaced, kept verbatim so the tests
// below can show that the statistic separates it from the fixed one.
//
// Without it these would be uniformity tests that pass and prove nothing: a
// chi-square that never sees a skewed sample is not evidence that it would
// notice one. This is the "seen to fail against the pre-fix code" rule from
// traps.md, wired into the suite instead of performed once by hand.
func biasedString(n int, alphabet string) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	out := make([]byte, n)
	for i := range out {
		out[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	return string(out)
}

// chiSquare measures how far an observed distribution sits from uniform.
//
// Preferred to a per-symbol tolerance because the two biases here are wildly
// different sizes — 21% for the 62-character alphabet, 1.6% for the digits —
// and a tolerance loose enough not to flake on sampling noise would sail past
// the digit case. Chi-square pools every symbol's deviation into one number
// whose distribution under uniformity is known, so one threshold covers both.
func chiSquare(counts map[rune]int, total int, symbols int) float64 {
	expected := float64(total) / float64(symbols)
	sum := 0.0
	for _, observed := range counts {
		diff := float64(observed) - expected
		sum += diff * diff / expected
	}
	return sum
}

func tally(s string) map[rune]int {
	counts := make(map[rune]int)
	for _, r := range s {
		counts[r]++
	}
	return counts
}

// Under uniformity chi-square has mean = degrees of freedom and standard
// deviation = sqrt(2*df), so these thresholds sit roughly 12 standard
// deviations above the expected value: a false failure is not a realistic
// event. The biased implementation lands far beyond them — see the assertions.
const (
	passwordSamples   = 200_000 // chars; biased ≈ 1318, uniform ≈ 61 ± 11
	passwordThreshold = 200.0
	digitSamples      = 600_000 // digits; biased ≈ 220, uniform ≈ 9 ± 4.2
	digitThreshold    = 60.0
)

func TestGeneratedPasswordsAreUniformOverTheirAlphabet(t *testing.T) {
	var b strings.Builder
	for b.Len() < passwordSamples {
		// Twelve at a time, the length the handler actually asks for, so the
		// test exercises the refill path rather than one enormous read.
		s, err := RandomString(12, passwordAlphabet)
		if err != nil {
			t.Fatalf("RandomString: %v", err)
		}
		b.WriteString(s)
	}
	sample := b.String()

	got := chiSquare(tally(sample), len(sample), len(passwordAlphabet))
	if got > passwordThreshold {
		t.Errorf("generated passwords are not uniform: chi-square %.1f exceeds %.1f", got, passwordThreshold)
	}

	// The same measurement on the old implementation, so a future edit that
	// quietly reintroduces `% len(alphabet)` cannot leave this file passing.
	biased := chiSquare(tally(biasedString(len(sample), passwordAlphabet)), len(sample), len(passwordAlphabet))
	if biased <= passwordThreshold {
		t.Errorf("the test cannot detect the defect it exists for: biased chi-square %.1f is within %.1f", biased, passwordThreshold)
	}
}

func TestVerificationCodeDigitsAreUniform(t *testing.T) {
	var b strings.Builder
	for b.Len() < digitSamples {
		s, err := RandomString(6, digitAlphabet)
		if err != nil {
			t.Fatalf("RandomString: %v", err)
		}
		b.WriteString(s)
	}
	sample := b.String()

	got := chiSquare(tally(sample), len(sample), len(digitAlphabet))
	if got > digitThreshold {
		t.Errorf("verification code digits are not uniform: chi-square %.1f exceeds %.1f", got, digitThreshold)
	}

	biased := chiSquare(tally(biasedString(len(sample), digitAlphabet)), len(sample), len(digitAlphabet))
	if biased <= digitThreshold {
		t.Errorf("the test cannot detect the defect it exists for: biased chi-square %.1f is within %.1f", biased, digitThreshold)
	}
}

func TestRandomStringReturnsTheRequestedShape(t *testing.T) {
	for _, length := range []int{1, 6, 12, 64} {
		s, err := RandomString(length, passwordAlphabet)
		if err != nil {
			t.Fatalf("RandomString(%d): %v", length, err)
		}
		if len([]rune(s)) != length {
			t.Errorf("RandomString(%d) returned %d characters", length, len([]rune(s)))
		}
		for _, r := range s {
			if !strings.ContainsRune(passwordAlphabet, r) {
				t.Errorf("RandomString produced %q, which is not in the alphabet", r)
			}
		}
	}
}

func TestRandomStringRejectsImpossibleRequests(t *testing.T) {
	cases := []struct {
		name     string
		length   int
		alphabet string
	}{
		{"zero length", 0, passwordAlphabet},
		{"negative length", -1, passwordAlphabet},
		{"empty alphabet", 8, ""},
		{"alphabet larger than a byte", 8, strings.Repeat("a", 257)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := RandomString(tc.length, tc.alphabet); err == nil {
				t.Error("expected an error, got none")
			}
		})
	}
}

// The rejection bound is 256 - (256 % size). Held in a byte it would wrap to 0
// for a 256-symbol alphabet, rejecting every value and looping forever. This is
// the test that would hang rather than fail, which is why the bound is an int.
func TestRandomStringTerminatesWhenTheAlphabetFillsTheByteRange(t *testing.T) {
	full := make([]byte, 256)
	for i := range full {
		full[i] = byte(i)
	}

	s, err := RandomString(32, string(full[:128])) // 128 divides 256 exactly
	if err != nil {
		t.Fatalf("128-symbol alphabet: %v", err)
	}
	if len(s) == 0 {
		t.Error("128-symbol alphabet produced nothing")
	}

	single, err := RandomString(4, "x")
	if err != nil {
		t.Fatalf("single-symbol alphabet: %v", err)
	}
	if single != "xxxx" {
		t.Errorf("single-symbol alphabet produced %q, want \"xxxx\"", single)
	}
}
