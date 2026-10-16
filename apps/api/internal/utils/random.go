package utils

import (
	"crypto/rand"
	"errors"
)

// RandomString draws n characters uniformly from alphabet, using rejection
// sampling: `b % len` over-weights the first symbols whenever the alphabet
// does not divide 256 (WO-65). A bias fix — crypto/rand was already used.
func RandomString(n int, alphabet string) (string, error) {
	size := len(alphabet)
	if n <= 0 {
		return "", errors.New("random string length must be positive")
	}
	if size == 0 || size > 256 {
		return "", errors.New("random string alphabet must hold 1 to 256 symbols")
	}

	// Largest multiple of size that fits in a byte; an int so size 256 works.
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
