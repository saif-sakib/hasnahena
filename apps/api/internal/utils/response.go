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

// ParseJSON decodes exactly one JSON value, bounded by MaxRequestBodySize, and
// refuses an escaped U+0000 (Postgres text cannot store it; TEST-18).
// Unmarshal, not Decode, so trailing garbage is rejected.
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

// containsEscapedNul finds a \u0000 escape, honouring escaped backslashes.
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
