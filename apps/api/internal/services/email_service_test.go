package services

import (
	"bytes"
	"html"
	"os"
	"strings"
	"testing"
)

// WO-52 — email_service.go was 488 lines with zero tests.
//
// It renders HTML with fmt.Sprintf and hand-rolled `html.EscapeString` calls,
// and it builds two bodies — HTML and plain text — from the same inputs by
// different paths. **Only one of those paths escapes.** That asymmetry is
// correct (a text/plain body must not contain HTML entities, or a member called
// O'Rahman reads "O&#39;Rahman"), but it is exactly the kind of correct-looking
// asymmetry that silently inverts when someone refactors the two branches
// together. These tests pin both directions.
//
// No mock SMTP server, by instruction and by preference: the build* methods are
// pure, so the bodies are asserted directly and nothing reaches the network.
// The four emails carry no money — the amounts live in the notifications table,
// covered by internal/notify — so there is nothing here about taka.

func testEmailService() *EmailService {
	return NewEmailService(EmailConfig{
		BrevoAPIKey: "test-key",
		From:        "info@hasnahenafoundation.com",
		FromName:    "Hasnahena Foundation",
		AppURL:      "https://example.test",
	})
}

// Names that have to survive the round trip. The Bengali one is not decoration:
// most member names in this system are Bengali, and an escaper that mangles
// them breaks the common case rather than the edge case.
var hostileNames = []struct {
	label string
	name  string
}{
	{"script tag", `<script>alert(1)</script>`},
	{"apostrophe", `O'Rahman`},
	{"ampersand", `Karim & Sons`},
	{"double quote", `Rahim "Bhai" Uddin`},
	{"angle brackets", `<<Rahima>>`},
	{"bengali", `রহিমা খাতুন`},
	{"bengali with markup", `রহিমা<img src=x onerror=alert(1)>`},
}

// assertEscapedInHTML is the core assertion: the raw string must NOT appear in
// the HTML body, its escaped form MUST, and the raw string MUST appear in the
// text body unescaped.
func assertEscapedInHTML(t *testing.T, label, raw, textBody, htmlBody string) {
	t.Helper()

	escaped := html.EscapeString(raw)

	if escaped != raw {
		// Only meaningful when escaping actually changes the string — a Bengali
		// name has nothing to escape, and asserting its absence would be wrong.
		if strings.Contains(htmlBody, raw) {
			t.Errorf("%s: HTML body contains the raw string %q — it reached the member's inbox unescaped", label, raw)
		}
	}
	if !strings.Contains(htmlBody, escaped) {
		t.Errorf("%s: HTML body is missing the escaped form %q", label, escaped)
	}
	if !strings.Contains(textBody, raw) {
		t.Errorf("%s: text body is missing the raw string %q — the plain-text part must not be HTML-escaped", label, raw)
	}
	if escaped != raw && strings.Contains(textBody, escaped) {
		t.Errorf("%s: text body contains the HTML-escaped form %q — a member reads the entities literally", label, escaped)
	}
}

func TestMemberApprovalEmailEscapesTheName(t *testing.T) {
	s := testEmailService()
	for _, locale := range []string{"en", "bn"} {
		for _, c := range hostileNames {
			_, textBody, htmlBody, err := s.buildMemberApprovalEmail(
				"member@example.test", c.name, "Temp1234", locale)
			if err != nil {
				t.Fatalf("%s/%s: %v", locale, c.label, err)
			}
			assertEscapedInHTML(t, locale+"/"+c.label, c.name, textBody, htmlBody)
		}
	}
}

func TestMemberApprovalEmailEscapesTheTemporaryPassword(t *testing.T) {
	s := testEmailService()
	// A generated password will not contain markup, but it is interpolated by
	// the same path as the name and must not be the one that is forgotten.
	password := `p<a>ss&"word'`
	_, textBody, htmlBody, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", password, "en")
	if err != nil {
		t.Fatal(err)
	}
	assertEscapedInHTML(t, "temporary password", password, textBody, htmlBody)
}

func TestStaffWelcomeEmailEscapesEveryInterpolatedField(t *testing.T) {
	s := testEmailService()
	for _, locale := range []string{"en", "bn"} {
		name := `<b>Admin</b> & Co`
		phone := `+8801700000000<script>`
		password := `Str0ng"&<pass>`
		_, textBody, htmlBody, err := s.buildStaffWelcomeEmail(
			"staff@example.test", name, "ADMIN", phone, password, locale)
		if err != nil {
			t.Fatalf("%s: %v", locale, err)
		}
		assertEscapedInHTML(t, locale+"/name", name, textBody, htmlBody)
		assertEscapedInHTML(t, locale+"/phone", phone, textBody, htmlBody)
		assertEscapedInHTML(t, locale+"/password", password, textBody, htmlBody)
	}
}

// The recipient address is interpolated into the staff email body, so a
// hostile-looking address is an injection vector in exactly the same way.
func TestStaffWelcomeEmailEscapesTheRecipientAddress(t *testing.T) {
	s := testEmailService()
	address := `"><script>alert(1)</script>@example.test`
	_, textBody, htmlBody, err := s.buildStaffWelcomeEmail(address, "Staff", "WORKER", "017", "Temp1234", "en")
	if err != nil {
		t.Fatal(err)
	}
	assertEscapedInHTML(t, "recipient address", address, textBody, htmlBody)
}

func TestPasswordChangeCodeEmailEscapesTheName(t *testing.T) {
	s := testEmailService()
	for _, locale := range []string{"en", "bn"} {
		for _, c := range hostileNames {
			_, textBody, htmlBody, err := s.buildPasswordChangeVerificationCodeEmail(
				"member@example.test", c.name, "483920", locale)
			if err != nil {
				t.Fatalf("%s/%s: %v", locale, c.label, err)
			}
			assertEscapedInHTML(t, locale+"/"+c.label, c.name, textBody, htmlBody)
		}
	}
}

// The reset URL carries a token straight from the caller into an href. An
// unescaped `"` there closes the attribute.
func TestPasswordResetEmailEscapesTheToken(t *testing.T) {
	s := testEmailService()
	token := `abc"><script>alert(1)</script>`
	_, _, htmlBody, err := s.buildPasswordResetEmail("member@example.test", token, "en")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(htmlBody, `"><script>`) {
		t.Errorf("reset token escapes its href attribute:\n%s", htmlBody)
	}
	if !strings.Contains(htmlBody, html.EscapeString(token)) {
		t.Error("reset token is missing from the HTML body in its escaped form")
	}
}

// ---------------------------------------------------------------------------
// Validation and locale
// ---------------------------------------------------------------------------

func TestBuildersRejectAnEmptyRecipient(t *testing.T) {
	s := testEmailService()
	if _, _, _, err := s.buildMemberApprovalEmail("   ", "Rahima", "Temp1234", "en"); err == nil {
		t.Error("member approval email accepted a blank recipient")
	}
	if _, _, _, err := s.buildStaffWelcomeEmail("", "Staff", "ADMIN", "017", "Temp1234", "en"); err == nil {
		t.Error("staff welcome email accepted a blank recipient")
	}
	if _, _, _, err := s.buildPasswordChangeVerificationCodeEmail("", "Rahima", "483920", "en"); err == nil {
		t.Error("password change code email accepted a blank recipient")
	}
	if _, _, _, err := s.buildPasswordResetEmail("", "token", "en"); err == nil {
		t.Error("password reset email accepted a blank recipient")
	}
}

func TestPasswordChangeCodeEmailRequiresACode(t *testing.T) {
	s := testEmailService()
	if _, _, _, err := s.buildPasswordChangeVerificationCodeEmail("member@example.test", "Rahima", "  ", "en"); err == nil {
		t.Error("an email offering a blank verification code was built without complaint")
	}
}

// An unknown locale must fall back to English rather than rendering a body with
// no greeting. `normalizeLocale` is the only thing standing between a bad
// Accept-Language and an empty email.
func TestUnknownLocaleFallsBackToEnglish(t *testing.T) {
	s := testEmailService()
	for _, locale := range []string{"", "fr", "EN-GB", "  ", "bn-BD"} {
		subject, textBody, htmlBody, err := s.buildMemberApprovalEmail(
			"member@example.test", "Rahima", "Temp1234", locale)
		if err != nil {
			t.Fatalf("locale %q: %v", locale, err)
		}
		if subject == "" || textBody == "" || htmlBody == "" {
			t.Errorf("locale %q produced an empty email", locale)
		}
		if !strings.Contains(htmlBody, "Rahima") {
			t.Errorf("locale %q dropped the member name", locale)
		}
	}
}

// Both locales must actually differ, or the Bengali branch is decorative.
func TestBengaliAndEnglishBodiesDiffer(t *testing.T) {
	s := testEmailService()
	_, enText, enHTML, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "Temp1234", "en")
	if err != nil {
		t.Fatal(err)
	}
	_, bnText, bnHTML, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "Temp1234", "bn")
	if err != nil {
		t.Fatal(err)
	}
	if enText == bnText {
		t.Error("the Bengali text body is identical to the English one")
	}
	if enHTML == bnHTML {
		t.Error("the Bengali HTML body is identical to the English one")
	}
	if !strings.Contains(bnHTML, `lang="bn"`) {
		t.Error("the Bengali HTML body is not marked lang=\"bn\" — screen readers and fonts both depend on it")
	}
}

// Every email must name the login or reset destination, and it must be the
// configured app URL rather than a hardcoded host.
func TestBodiesUseTheConfiguredAppURL(t *testing.T) {
	s := NewEmailService(EmailConfig{
		BrevoAPIKey: "test-key",
		From:        "info@example.test",
		AppURL:      "https://staging.example.test/",
	})
	_, textBody, htmlBody, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "Temp1234", "en")
	if err != nil {
		t.Fatal(err)
	}
	// `/login`, not `/en/login`: English has no prefix since WO-95, and an email
	// is the last place a link that 301s belongs — these outlive the deploy that
	// wrote them and some clients resolve redirects before a person ever clicks.
	const want = "https://staging.example.test/login"
	if !strings.Contains(textBody, want) {
		t.Errorf("text body does not link to %s", want)
	}
	if !strings.Contains(htmlBody, want) {
		t.Errorf("HTML body does not link to %s", want)
	}
	// The trailing slash on AppURL must not survive into a doubled one. This
	// matters more than it did: `localeURL` concatenates rather than formatting
	// with a separator, so a constructor that stopped trimming would produce
	// `https://…//login` with nothing else complaining.
	if strings.Contains(htmlBody, "example.test//") {
		t.Error("a trailing slash on APP_URL produced a doubled slash in the link")
	}

	// And the Bengali half of the same email, which does still carry a prefix.
	_, bnText, bnHTML, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "Temp1234", "bn")
	if err != nil {
		t.Fatal(err)
	}
	const wantBn = "https://staging.example.test/bn/login"
	if !strings.Contains(bnText, wantBn) || !strings.Contains(bnHTML, wantBn) {
		t.Errorf("the Bengali bodies do not link to %s", wantBn)
	}
}

// ---------------------------------------------------------------------------
// WO-95 — the links in an email are the canonical URLs, not redirects
// ---------------------------------------------------------------------------

// English lost its URL prefix (ADR-034), so `https://…/en/login` is a URL the
// web app answers with a 301. It still works; it is still the wrong thing to
// put in an email.
//
// These links outlive the deploy that wrote them. A member is emailed a
// password-reset link and may open it an hour later or forward it; approval
// emails sit in an inbox for years. Some clients and corporate link scanners
// resolve a redirect before a person ever clicks, and a chain is one more thing
// that can break between here and the login form.
//
// The rule is implemented twice — here and in `apps/web/lib/locale-path.ts` —
// because the two runtimes cannot share a module. This is the half that keeps
// the Go side honest; `apps/web/test/unit/locale-routing.test.ts` is the other.
func TestEmailLinksUseTheCanonicalLocalePath(t *testing.T) {
	const appURL = "https://example.test"

	cases := []struct {
		locale string
		path   string
		want   string
	}{
		{"en", "/login", "https://example.test/login"},
		{"EN", "/login", "https://example.test/login"},
		{"", "/login", "https://example.test/login"},
		{"fr", "/login", "https://example.test/login"},
		{"bn", "/login", "https://example.test/bn/login"},
		{" bn ", "/login", "https://example.test/bn/login"},
		{"en", "/reset-password?token=abc", "https://example.test/reset-password?token=abc"},
		{"bn", "/reset-password?token=abc", "https://example.test/bn/reset-password?token=abc"},
	}
	for _, tc := range cases {
		if got := localeURL(appURL, tc.locale, tc.path); got != tc.want {
			t.Errorf("localeURL(%q, %q, %q) = %q, want %q", appURL, tc.locale, tc.path, got, tc.want)
		}
	}
}

// The census. Building one of these by hand is how the `/en/` prefix survives a
// refactor, and the emails are the one surface where nobody notices for months.
func TestNoEmailBuildsALocaleURLByHand(t *testing.T) {
	source, err := os.ReadFile("email_service.go")
	if err != nil {
		t.Fatalf("read email_service.go: %v", err)
	}
	// Comments stripped first. The doc comment on localeURL quotes the very
	// expression this forbids, and a detector that fires on its own rule being
	// written down teaches people to delete the explanation — the same lesson
	// requirements.test.ts records about searching for the word "markup".
	// The banned shape is the *format string*, not the argument list —
	// `localeURL(s.appURL, locale, "/login")` legitimately passes both, so a
	// check on `s.appURL, locale` would fail on the fix itself.
	if bytes.Contains(withoutComments(source), []byte(`"%s/%s/`)) {
		// Worded without a verb of its own: `go vet` reads a literal containing
		// one as a format string this call forgot to pass arguments for, and it
		// constant-folds a concatenation, so hiding it that way does not work.
		t.Error("email_service.go builds a URL by interpolating the locale into a Sprintf " +
			"path. English has no prefix (ADR-034), so that produces a link the web app " +
			"answers with a 301. Use localeURL(s.appURL, locale, path).")
	}
}

// withoutComments removes `//` line comments so a census reads code, not prose.
func withoutComments(source []byte) []byte {
	var out bytes.Buffer
	for _, line := range bytes.Split(source, []byte("\n")) {
		if i := bytes.Index(line, []byte("//")); i >= 0 {
			line = line[:i]
		}
		out.Write(line)
		out.WriteByte('\n')
	}
	return out.Bytes()
}
