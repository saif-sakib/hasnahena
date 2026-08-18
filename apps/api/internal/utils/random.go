package utils

import (
	"crypto/rand"
	"errors"
)

// RandomString draws n characters uniformly from alphabet.
//
// Uniformly is the whole point. The obvious version — read n bytes and index
// with `alphabet[b%len(alphabet)]` — is not uniform whenever the alphabet does
// not divide 256, because the leftover byte values wrap around and land on the
// first few symbols a second time:
//
//	62-character alphabet: 256 = 4*62 + 8, so the first 8 symbols come up on
//	5 byte values each and the other 54 on 4 — 21% above uniform.
//	10 digits:             256 = 25*10 + 6, so 0-5 come up on 26 byte values
//	and 6-9 on 25.
//
// The digit case was the password-change verification code (WO-65), where a
// guesser who knows the skew searches the likelier codes first.
//
// The fix is rejection: byte values in that leftover tail are discarded rather
// than folded in, so every accepted value maps to exactly one symbol. Discards
// cost a few extra bytes — at worst 3% for the 62-character alphabet — and
// nothing else.
//
// These generators are all seeded from crypto/rand already, so this is a bias
// fix and not a predictability fix. Do not describe it as the latter.
func RandomString(n int, alphabet string) (string, error) {
	size := len(alphabet)
	if n <= 0 {
		return "", errors.New("random string length must be positive")
	}
	if size == 0 || size > 256 {
		return "", errors.New("random string alphabet must hold 1 to 256 symbols")
	}

	// The largest multiple of size that fits in a byte. Byte values at or above
	// it are the biased tail. An int, not a byte: when size is 256 this is 256,
	// which no byte reaches, so nothing is rejected and the loop still ends.
	limit := 256 - (256 % size)

	out := make([]byte, 0, n)
	// A little slack so one Read usually suffices even after some rejections.
	buf := make([]byte, n+n/4+8)
	for len(out) < n {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		for _, b := range buf {
			if int(b) >= limit {
				continue
			}
			out = append(out, alphabet[int(b)%size])
			if len(out) == n {
				break
			}
		}
	}

	return string(out), nil
}
