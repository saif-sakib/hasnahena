package middleware

import (
	"net/http"
	"strings"

	"hasnahena/apps/api/internal/utils"
)

// RejectNulBytes refuses any request whose URL carries a NUL byte.
//
// PostgreSQL text columns cannot store U+0000 at all — the driver reports
// `invalid byte sequence for encoding "UTF8": 0x00` — so a NUL that reaches a
// query parameter becomes a database error, and every handler turns a database
// error into a 500. `GET /v1/dashboard/support/messages?threadId=%00` was
// answering "Failed to load support messages" for exactly this reason
// (TEST-18).
//
// Fixing it per-handler would mean remembering it at each of the places a query
// value reaches SQL, which is the kind of thing that is right on the day it is
// written and wrong six months later. It belongs here instead: one check, on
// every route, for a byte that no legitimate caller ever sends.
//
// Request *bodies* are a separate case: a raw NUL inside a JSON string is
// invalid JSON, which encoding/json already rejects, but the escaped form
// (backslash-u-0000) is valid JSON and decodes to a real NUL. TEST-18 sends
// both at every write route; if a handler ever starts storing one, that test
// fails and the fix belongs at the handler, where the field is known.
func RejectNulBytes(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// RawQuery, not the parsed values: parsing decodes %00 into a real NUL,
		// and checking the raw form also catches a NUL smuggled into the path.
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
