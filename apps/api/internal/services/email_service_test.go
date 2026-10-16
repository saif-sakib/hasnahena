package services

import (
	"bytes"
	"html"
	"os"
	"strings"
	"testing"
)

// WO-52 — the email bodies. HTML is escaped and plain text is NOT (or a member
// called O'Rahman reads "O&#39;Rahman"); both directions are pinned. build* are
// pure, so nothing reaches the network.

func testEmailService() *EmailService {
	return NewEmailService(EmailConfig{
		BrevoAPIKey: "test-key",
		From:        "info@hasnahenafoundation.com",
		FromName:    "Hasnahena Foundation",
		AppURL:      "https://example.test",
	})
}

// Names that must survive the round trip, including Bengali.
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

// assertEscapedInHTML: raw absent and escaped present in HTML; raw in text.
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
				"member@example.test", c.name, "ACC-KH-33001", "01700000000", "Temp1234", locale)
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
	_, textBody, htmlBody, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "ACC-KH-33001", "01700000000", password, "en")
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
	if _, _, _, err := s.buildMemberApprovalEmail("   ", "Rahima", "ACC-KH-33001", "01700000000", "Temp1234", "en"); err == nil {
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

// An unknown locale falls back to English.
func TestUnknownLocaleFallsBackToEnglish(t *testing.T) {
	s := testEmailService()
	for _, locale := range []string{"", "fr", "EN-GB", "  ", "bn-BD"} {
		subject, textBody, htmlBody, err := s.buildMemberApprovalEmail(
			"member@example.test", "Rahima", "ACC-KH-33001", "01700000000", "Temp1234", locale)
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
	_, enText, enHTML, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "ACC-KH-33001", "01700000000", "Temp1234", "en")
	if err != nil {
		t.Fatal(err)
	}
	_, bnText, bnHTML, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "ACC-KH-33001", "01700000000", "Temp1234", "bn")
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
	_, textBody, htmlBody, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "ACC-KH-33001", "01700000000", "Temp1234", "en")
	if err != nil {
		t.Fatal(err)
	}
	// `/login`, not `/en/login` (ADR-034).
	const want = "https://staging.example.test/login"
	if !strings.Contains(textBody, want) {
		t.Errorf("text body does not link to %s", want)
	}
	if !strings.Contains(htmlBody, want) {
		t.Errorf("HTML body does not link to %s", want)
	}
	// AppURL's trailing slash must not double up.
	if strings.Contains(htmlBody, "example.test//") {
		t.Error("a trailing slash on APP_URL produced a doubled slash in the link")
	}

	// And the Bengali half of the same email, which does still carry a prefix.
	_, bnText, bnHTML, err := s.buildMemberApprovalEmail("member@example.test", "Rahima", "ACC-KH-33001", "01700000000", "Temp1234", "bn")
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

// Email links are canonical (no 301). The Go half of the rule in
// apps/web/lib/locale-path.ts; locale-routing.test.ts is the other.
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
	// Comments stripped first (localeURL's doc quotes the banned shape). The
	// banned shape is the format string.
	if bytes.Contains(withoutComments(source), []byte(`"%s/%s/`)) {
		// No verb in the literal, or go vet reads it as a format string.
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

// The rejection email (T-07): says why, in the applicant's language, escaped.

func TestRejectionEmailStatesTheReasonInBothLanguages(t *testing.T) {
	s := testEmailService()

	for _, code := range []string{
		"INCOMPLETE_DOCUMENTS",
		"UNCLEAR_DOCUMENTS",
		"IDENTITY_MISMATCH",
		"DUPLICATE_APPLICATION",
		"OUTSIDE_SERVICE_AREA",
		"BELOW_MINIMUM_AGE",
		"COULD_NOT_VERIFY",
	} {
		for _, locale := range []string{"en", "bn"} {
			sentence := rejectionReasonSentence(code, locale)
			if sentence == "" {
				t.Errorf("%s/%s: no sentence — the applicant would be told they were "+
					"rejected and nothing else", code, locale)
				continue
			}
			_, textBody, htmlBody, err := s.buildMemberRejectionEmail(
				"applicant@example.test", "Rahima", code, "", locale)
			if err != nil {
				t.Fatalf("%s/%s: %v", code, locale, err)
			}
			if !strings.Contains(textBody, sentence) || !strings.Contains(htmlBody, sentence) {
				t.Errorf("%s/%s: the reason is not in the email body", code, locale)
			}
		}
	}
}

// OTHER has no sentence; the admin's note is the reason.
func TestRejectionEmailCarriesTheAdminsNote(t *testing.T) {
	s := testEmailService()
	const note = "Please resubmit with the back of the NID."

	_, textBody, htmlBody, err := s.buildMemberRejectionEmail(
		"applicant@example.test", "Rahima", "OTHER", note, "en")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(textBody, note) || !strings.Contains(htmlBody, note) {
		t.Error("the admin's note is missing from the email — with OTHER it is the only reason there is")
	}

	// Preset reason and note are joined.
	_, bothText, _, err := s.buildMemberRejectionEmail(
		"applicant@example.test", "Rahima", "UNCLEAR_DOCUMENTS", note, "en")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bothText, rejectionReasonSentence("UNCLEAR_DOCUMENTS", "en")) {
		t.Error("the preset reason was dropped when a note was supplied")
	}
	if !strings.Contains(bothText, note) {
		t.Error("the note was dropped when a preset reason was supplied")
	}
}

func TestRejectionEmailEscapesEverythingInterpolated(t *testing.T) {
	s := testEmailService()
	for _, locale := range []string{"en", "bn"} {
		for _, c := range hostileNames {
			_, textBody, htmlBody, err := s.buildMemberRejectionEmail(
				"applicant@example.test", c.name, "OTHER", c.name, locale)
			if err != nil {
				t.Fatalf("%s/%s: %v", locale, c.label, err)
			}
			// Name and note are both attacker-influenced.
			assertEscapedInHTML(t, locale+"/"+c.label, c.name, textBody, htmlBody)
		}
	}
}

func TestRejectionEmailTellsThemTheyMayApplyAgain(t *testing.T) {
	// The whole point of scoping uniqueness to live rows is that a rejected
	// applicant can apply again. If the email does not say so, they will not.
	s := testEmailService()
	for _, locale := range []string{"en", "bn"} {
		_, textBody, htmlBody, err := s.buildMemberRejectionEmail(
			"applicant@example.test", "Rahima", "INCOMPLETE_DOCUMENTS", "", locale)
		if err != nil {
			t.Fatalf("locale %q: %v", locale, err)
		}
		if !strings.Contains(textBody, "/register") || !strings.Contains(htmlBody, "/register") {
			t.Errorf("locale %q: no link back to the registration form", locale)
		}
	}
}

func TestRejectionEmailBodiesDifferByLocale(t *testing.T) {
	s := testEmailService()
	_, enText, _, err := s.buildMemberRejectionEmail("a@example.test", "Rahima", "IDENTITY_MISMATCH", "", "en")
	if err != nil {
		t.Fatal(err)
	}
	_, bnText, _, err := s.buildMemberRejectionEmail("a@example.test", "Rahima", "IDENTITY_MISMATCH", "", "bn")
	if err != nil {
		t.Fatal(err)
	}
	if enText == bnText {
		t.Error("the Bengali rejection email is identical to the English one")
	}
}

func TestRejectionEmailRefusesAnEmptyRecipient(t *testing.T) {
	s := testEmailService()
	if _, _, _, err := s.buildMemberRejectionEmail("   ", "Rahima", "OTHER", "note", "en"); err == nil {
		t.Error("an empty recipient was accepted")
	}
}
