package utils

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Meta struct {
	Timestamp string `json:"timestamp"`
}

type Envelope struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data"`
	Error   *APIError   `json:"error"`
	Meta    Meta        `json:"meta"`
}

func WriteJSON(w http.ResponseWriter, status int, payload Envelope) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func Success(w http.ResponseWriter, status int, data interface{}) {
	WriteJSON(w, status, Envelope{
		Success: true,
		Data:    data,
		Error:   nil,
		Meta: Meta{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func Error(w http.ResponseWriter, status int, code string, message string) {
	WriteJSON(w, status, Envelope{
		Success: false,
		Data:    nil,
		Error: &APIError{
			Code:    code,
			Message: message,
		},
		Meta: Meta{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// ErrNulInJSON is returned when a request body contains an escaped NUL.
var ErrNulInJSON = errors.New("request body contains a NUL character")

// ParseJSON decodes a JSON request body, bounded by MaxRequestBodySize so a
// large or endless body cannot exhaust memory. A body over the limit fails as a
// decode error, which every call site already surfaces as 400 INVALID_REQUEST.
//
// It also refuses a body carrying U+0000 in any string. PostgreSQL text columns
// cannot hold that byte — the driver reports `invalid byte sequence for
// encoding "UTF8": 0x00` — so a NUL that survives decoding becomes a database
// error at whatever depth it is eventually written, and every handler renders a
// database error as a 500. A threadId of backslash-u-0000 was doing exactly
// that to POST /v1/dashboard/support/threads/processed (TEST-18).
//
// A *raw* NUL inside a JSON string is already invalid JSON and encoding/json
// rejects it; only the escaped form gets this far, which is why the check is
// here and not in the middleware that guards the URL (RejectNulBytes).
//
// json.Unmarshal rather than Decoder.Decode, deliberately: Decode reads the
// first JSON value and ignores whatever follows it, so `{"amount":1} anything`
// used to parse cleanly. Unmarshal requires the body to be one complete value
// and nothing else.
func ParseJSON(r *http.Request, v interface{}) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxRequestBodySize))
	if err != nil {
		return err
	}
	if containsEscapedNul(body) {
		return ErrNulInJSON
	}
	return json.Unmarshal(body, v)
}

// containsEscapedNul reports whether raw JSON contains a backslash-u-0000
// escape that would decode to U+0000.
//
// It walks the bytes rather than decoding twice, and it honours escaping, so an
// escaped backslash followed by the plain text u0000 — which decodes to a
// harmless string — is not mistaken for one. That distinction is the whole
// reason this is a scanner and not strings.Contains.
func containsEscapedNul(body []byte) bool {
	inString := false
	for i := 0; i < len(body); i++ {
		c := body[i]
		if !inString {
			if c == '"' {
				inString = true
			}
			continue
		}
		switch c {
		case '"':
			inString = false
		case '\\':
			// Consume the escape so that `\\` cannot be read as the start of
			// another one, and `\uXXXX` is inspected as a unit.
			if i+1 >= len(body) {
				return false
			}
			if body[i+1] == 'u' && i+5 < len(body) &&
				body[i+2] == '0' && body[i+3] == '0' && body[i+4] == '0' && body[i+5] == '0' {
				return true
			}
			i++
		}
	}
	return false
}
