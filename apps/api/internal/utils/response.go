package utils

import (
	"encoding/json"
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

// ParseJSON decodes a JSON request body, bounded by MaxRequestBodySize so a
// large or endless body cannot exhaust memory. A body over the limit fails as a
// decode error, which every call site already surfaces as 400 INVALID_REQUEST.
func ParseJSON(r *http.Request, v interface{}) error {
	return json.NewDecoder(io.LimitReader(r.Body, MaxRequestBodySize)).Decode(v)
}
