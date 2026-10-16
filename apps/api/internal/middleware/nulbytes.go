package middleware

import (
	"net/http"
	"strings"

	"hasnahena/apps/api/internal/utils"
)

// RejectNulBytes refuses any request whose URL carries a NUL byte, which
// Postgres text cannot store (TEST-18). Escaped NULs in bodies are refused by
// utils.ParseJSON.
func RejectNulBytes(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Raw form, so a NUL in the path is caught too.
		if strings.ContainsRune(r.URL.Path, 0) ||
			strings.Contains(strings.ToLower(r.URL.RawQuery), "%00") ||
			strings.ContainsRune(r.URL.RawQuery, 0) {
			utils.Error(w, http.StatusBadRequest, "INVALID_REQUEST",
				"Request contains a NUL byte")
			return
		}
		next.ServeHTTP(w, r)
	})
}
