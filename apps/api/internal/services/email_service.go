package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	brevoDefaultBaseURL = "https://api.brevo.com/v3"
	brevoHTTPTimeout    = 12 * time.Second
	brevoRetryAttempts  = 3
	brevoRetryBackoff   = 1500 * time.Millisecond
)

type EmailConfig struct {
	BrevoAPIKey  string
	BrevoBaseURL string
	From         string
	FromName     string
	AppURL       string
}

type EmailService struct {
	apiKey    string
	baseURL   string
	fromEmail string
	fromName  string
	appURL    string
	enabled   bool
	client    *http.Client
}

type brevoSendEmailRequest struct {
	Sender      brevoParticipant   `json:"sender"`
	To          []brevoParticipant `json:"to"`
	Subject     string             `json:"subject"`
	HTMLContent string             `json:"htmlContent,omitempty"`
	TextContent string             `json:"textContent,omitempty"`
}

type brevoParticipant struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type brevoErrorResponse struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

func NewEmailService(cfg EmailConfig) *EmailService {
	apiKey := strings.TrimSpace(cfg.BrevoAPIKey)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BrevoBaseURL), "/")
	if baseURL == "" {
		baseURL = brevoDefaultBaseURL
	}

	fromEmail := strings.TrimSpace(cfg.From)
	if fromEmail == "" {
		fromEmail = "info@hasnahenafoundation.com"
	}

	fromName := strings.TrimSpace(cfg.FromName)
	if fromName == "" {
		fromName = "Hasnahena Foundation"
	}

	enabled := apiKey != "" && fromEmail != ""

	appURL := strings.TrimSuffix(strings.TrimSpace(cfg.AppURL), "/")
	if appURL == "" {
		appURL = "https://www.hasnahenafoundation.com"
	}

	return &EmailService{
		apiKey:    apiKey,
		baseURL:   baseURL,
		fromEmail: fromEmail,
		fromName:  fromName,
		appURL:    appURL,
		enabled:   enabled,
		client: &http.Client{
			Timeout: brevoHTTPTimeout,
		},
	}
}

func (s *EmailService) IsConfigured() bool {
	return s != nil && s.enabled
}

func normalizeLocale(locale string) string {
	normalized := strings.ToLower(strings.TrimSpace(locale))
	if normalized == "bn" {
		return "bn"
	}
	return "en"
}

func (s *EmailService) renderOfficialEmailHTML(locale, preheader, heading, bodyHTML string) string {
	headerTag := "Accounts and Security Notification"
	footerPrimary := "Hasnahena Foundation Member Support"
	safetyLine := "For account safety, never share your password or verification code with anyone."
	if locale == "bn" {
		headerTag = "অ্যাকাউন্ট ও নিরাপত্তা নোটিশ"
		footerPrimary = "Hasnahena Foundation সদস্য সহায়তা টিম"
		safetyLine = "অ্যাকাউন্টের নিরাপত্তার জন্য আপনার পাসওয়ার্ড বা যাচাইকরণ কোড কাউকে শেয়ার করবেন না।"
	}

	return fmt.Sprintf(`
<!doctype html>
<html lang="%s">
	<body style="margin:0;padding:0;background:#f3f7f6;font-family:Arial,sans-serif;color:#0f172a;">
		<span style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;visibility:hidden;">%s</span>
		<table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
			<tr>
				<td align="center">
					<table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:14px;border:1px solid #dbe7e5;overflow:hidden;">
						<tr>
							<td style="padding:22px 24px;background:#0f766e;color:#ffffff;">
								<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">%s</div>
								<div style="margin-top:6px;font-size:24px;font-weight:700;line-height:1.2;">Hasnahena Foundation</div>
							</td>
						</tr>
						<tr>
							<td style="padding:28px 24px 12px 24px;">
								<h2 style="margin:0 0 14px 0;font-size:22px;line-height:1.3;color:#0f172a;">%s</h2>
								%s
							</td>
						</tr>
						<tr>
							<td style="padding:18px 24px 24px 24px;">
								<div style="font-size:12px;line-height:1.7;color:#475569;border-top:1px solid #e2ecea;padding-top:14px;">
									<div>%s</div>
									<div style="margin-top:4px;">%s</div>
									<div style="margin-top:4px;">Website: <a href="%s" style="color:#0f766e;text-decoration:none;">%s</a></div>
								</div>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
`, locale, html.EscapeString(preheader), html.EscapeString(headerTag), html.EscapeString(heading), bodyHTML, html.EscapeString(footerPrimary), html.EscapeString(safetyLine), html.EscapeString(s.appURL), html.EscapeString(s.appURL))
}

func (s *EmailService) renderOfficialEmailText(locale, heading, body string) string {
	footer := "Hasnahena Foundation Member Support\nWebsite: " + s.appURL + "\nFor account safety, never share your password or verification code with anyone."
	if locale == "bn" {
		footer = "Hasnahena Foundation সদস্য সহায়তা টিম\nওয়েবসাইট: " + s.appURL + "\nঅ্যাকাউন্টের নিরাপত্তার জন্য আপনার পাসওয়ার্ড বা যাচাইকরণ কোড কাউকে শেয়ার করবেন না।"
	}

	return strings.TrimSpace(heading) + "\n\n" + strings.TrimSpace(body) + "\n\n" + footer
}

func (s *EmailService) buildMemberApprovalEmail(to string, memberName string, temporaryPassword string, locale string) (subject, textBody, htmlBody string, err error) {
	if !s.IsConfigured() {
		return "", "", "", fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return "", "", "", fmt.Errorf("recipient email is required")
	}

	memberName = strings.TrimSpace(memberName)
	if memberName == "" {
		memberName = "Member"
	}

	locale = normalizeLocale(locale)

	loginURL := fmt.Sprintf("%s/%s/login", s.appURL, locale)

	escapedMemberName := html.EscapeString(memberName)
	escapedPassword := html.EscapeString(temporaryPassword)
	escapedLoginURL := html.EscapeString(loginURL)

	if locale == "bn" {
		subject = "সদস্যপদ অনুমোদন নিশ্চিতকরণ | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "সদস্যপদ অনুমোদিত হয়েছে", fmt.Sprintf("প্রিয় %s,\n\nআপনার সদস্যপদ আবেদন অনুমোদিত হয়েছে।\n\nঅস্থায়ী পাসওয়ার্ড: %s\nলগইন লিংক: %s\n\nপ্রথম লগইনের পর অবশ্যই পাসওয়ার্ড পরিবর্তন করবেন।", memberName, temporaryPassword, loginURL))
		htmlBody = s.renderOfficialEmailHTML(locale, "সদস্যপদ অনুমোদন", "সদস্যপদ অনুমোদিত হয়েছে", fmt.Sprintf(
			"<p style=\"margin:0 0 12px 0;\">প্রিয় %s,</p>"+
				"<p style=\"margin:0 0 14px 0;\">আপনার সদস্যপদ আবেদন অনুমোদিত হয়েছে। নিচের তথ্য ব্যবহার করে লগইন করুন।</p>"+
				"<p style=\"margin:0 0 6px 0;\"><strong>অস্থায়ী পাসওয়ার্ড:</strong> %s</p>"+
				"<p style=\"margin:0 0 18px 0;\"><strong>মেয়াদ:</strong> প্রথম লগইন পর্যন্ত</p>"+
				"<p style=\"margin:0 0 18px 0;\"><a href=\"%s\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;\">লগইন করুন</a></p>"+
				"<p style=\"margin:0;color:#334155;\"><strong>গুরুত্বপূর্ণ:</strong> প্রথম লগইনের পর সাথে সাথে পাসওয়ার্ড পরিবর্তন করুন।</p>",
			escapedMemberName,
			escapedPassword,
			escapedLoginURL,
		))
	} else {
		subject = "Membership Approval Confirmation | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "Membership Approved", fmt.Sprintf("Dear %s,\n\nYour membership application has been approved.\n\nTemporary password: %s\nLogin URL: %s\n\nPlease change this password immediately after your first login.", memberName, temporaryPassword, loginURL))
		htmlBody = s.renderOfficialEmailHTML(locale, "Membership approved", "Your Membership Has Been Approved", fmt.Sprintf(
			"<p style=\"margin:0 0 12px 0;\">Dear %s,</p>"+
				"<p style=\"margin:0 0 14px 0;\">Your membership application has been approved. Use the temporary password below to access your account.</p>"+
				"<p style=\"margin:0 0 6px 0;\"><strong>Temporary password:</strong> %s</p>"+
				"<p style=\"margin:0 0 18px 0;\"><strong>Validity:</strong> until first login</p>"+
				"<p style=\"margin:0 0 18px 0;\"><a href=\"%s\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;\">Log in to your account</a></p>"+
				"<p style=\"margin:0;color:#334155;\"><strong>Important:</strong> change this password immediately after first login.</p>",
			escapedMemberName,
			escapedPassword,
			escapedLoginURL,
		))
	}

	return subject, textBody, htmlBody, nil
}

// SendMemberApprovalEmail renders the message and hands it to the transport. The
// rendering is buildMemberApprovalEmail, which is pure and therefore testable — see
// email_service_test.go (WO-52). Nothing here reaches the network.
func (s *EmailService) SendMemberApprovalEmail(to string, memberName string, temporaryPassword string, locale string) error {
	subject, textBody, htmlBody, err := s.buildMemberApprovalEmail(to, memberName, temporaryPassword, locale)
	if err != nil {
		return err
	}
	return s.sendWithRetry(strings.TrimSpace(to), subject, textBody, htmlBody)
}

func (s *EmailService) buildStaffWelcomeEmail(to string, staffName string, role string, phone string, temporaryPassword string, locale string) (subject, textBody, htmlBody string, err error) {
	if !s.IsConfigured() {
		return "", "", "", fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return "", "", "", fmt.Errorf("recipient email is required")
	}

	staffName = strings.TrimSpace(staffName)
	if staffName == "" {
		staffName = "Staff"
	}

	role = strings.ToUpper(strings.TrimSpace(role))
	if role != "ADMIN" {
		role = "WORKER"
	}

	locale = normalizeLocale(locale)

	loginURL := fmt.Sprintf("%s/%s/login", s.appURL, locale)
	escapedStaffName := html.EscapeString(staffName)
	escapedEmail := html.EscapeString(to)
	escapedPhone := html.EscapeString(strings.TrimSpace(phone))
	escapedTempPassword := html.EscapeString(temporaryPassword)
	escapedLoginURL := html.EscapeString(loginURL)

	if locale == "bn" {
		roleLabel := "কর্মী"
		if role == "ADMIN" {
			roleLabel = "অ্যাডমিন"
		}
		subject = "স্টাফ অ্যাকাউন্ট সক্রিয়করণ | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "স্টাফ অ্যাকাউন্ট তৈরি হয়েছে", fmt.Sprintf("প্রিয় %s,\n\nআপনাকে %s হিসেবে যুক্ত করা হয়েছে।\n\nইমেইল: %s\nফোন: %s\nঅস্থায়ী পাসওয়ার্ড: %s\nলগইন: %s\n\nপ্রথম লগইনের পর অবশ্যই পাসওয়ার্ড পরিবর্তন করবেন।", staffName, roleLabel, to, strings.TrimSpace(phone), temporaryPassword, loginURL))
		htmlBody = s.renderOfficialEmailHTML(locale, "নতুন স্টাফ অ্যাকাউন্ট", "আপনার স্টাফ অ্যাকাউন্ট সক্রিয় হয়েছে", fmt.Sprintf(
			"<p style=\"margin:0 0 12px 0;\">প্রিয় %s,</p>"+
				"<p style=\"margin:0 0 14px 0;\">আপনাকে <strong>%s</strong> হিসেবে যুক্ত করা হয়েছে।</p>"+
				"<p style=\"margin:0 0 6px 0;\"><strong>ইমেইল:</strong> %s</p>"+
				"<p style=\"margin:0 0 6px 0;\"><strong>ফোন:</strong> %s</p>"+
				"<p style=\"margin:0 0 14px 0;\"><strong>অস্থায়ী পাসওয়ার্ড:</strong> %s</p>"+
				"<p style=\"margin:0 0 18px 0;\"><a href=\"%s\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;\">ড্যাশবোর্ডে লগইন করুন</a></p>"+
				"<p style=\"margin:0;color:#334155;\"><strong>গুরুত্বপূর্ণ:</strong> প্রথম লগইনের পর নতুন পাসওয়ার্ড সেট করুন।</p>",
			escapedStaffName,
			html.EscapeString(roleLabel),
			escapedEmail,
			escapedPhone,
			escapedTempPassword,
			escapedLoginURL,
		))
	} else {
		roleLabel := "Worker"
		if role == "ADMIN" {
			roleLabel = "Admin"
		}
		subject = "Staff Account Activation | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "Your Staff Account Is Ready", fmt.Sprintf("Dear %s,\n\nYou have been added as %s.\n\nEmail: %s\nPhone: %s\nTemporary password: %s\nLogin URL: %s\n\nPlease change your password immediately after first login.", staffName, roleLabel, to, strings.TrimSpace(phone), temporaryPassword, loginURL))
		htmlBody = s.renderOfficialEmailHTML(locale, "New staff account", "Your Staff Account Has Been Activated", fmt.Sprintf(
			"<p style=\"margin:0 0 12px 0;\">Dear %s,</p>"+
				"<p style=\"margin:0 0 14px 0;\">You have been added as <strong>%s</strong>.</p>"+
				"<p style=\"margin:0 0 6px 0;\"><strong>Email:</strong> %s</p>"+
				"<p style=\"margin:0 0 6px 0;\"><strong>Phone:</strong> %s</p>"+
				"<p style=\"margin:0 0 14px 0;\"><strong>Temporary password:</strong> %s</p>"+
				"<p style=\"margin:0 0 18px 0;\"><a href=\"%s\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;\">Log in to dashboard</a></p>"+
				"<p style=\"margin:0;color:#334155;\"><strong>Important:</strong> update your password immediately after first login.</p>",
			escapedStaffName,
			html.EscapeString(roleLabel),
			escapedEmail,
			escapedPhone,
			escapedTempPassword,
			escapedLoginURL,
		))
	}

	return subject, textBody, htmlBody, nil
}

// SendStaffWelcomeEmail renders the message and hands it to the transport. The
// rendering is buildStaffWelcomeEmail, which is pure and therefore testable — see
// email_service_test.go (WO-52). Nothing here reaches the network.
func (s *EmailService) SendStaffWelcomeEmail(to string, staffName string, role string, phone string, temporaryPassword string, locale string) error {
	subject, textBody, htmlBody, err := s.buildStaffWelcomeEmail(to, staffName, role, phone, temporaryPassword, locale)
	if err != nil {
		return err
	}
	return s.sendWithRetry(strings.TrimSpace(to), subject, textBody, htmlBody)
}

func (s *EmailService) sendWithRetry(to string, subject string, textBody string, htmlBody string) error {
	var lastErr error
	for attempt := 1; attempt <= brevoRetryAttempts; attempt++ {
		err := s.sendViaBrevo(to, subject, textBody, htmlBody)
		if err == nil {
			return nil
		}
		lastErr = fmt.Errorf("attempt %d: %w", attempt, err)

		if attempt < brevoRetryAttempts {
			time.Sleep(brevoRetryBackoff)
		}
	}

	return fmt.Errorf("failed to send email after %d attempt(s): %w", brevoRetryAttempts, lastErr)
}

func (s *EmailService) sendViaBrevo(to string, subject string, textBody string, htmlBody string) error {
	if !s.IsConfigured() {
		return fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("recipient email is required")
	}
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return fmt.Errorf("email subject is required")
	}
	if strings.TrimSpace(textBody) == "" && strings.TrimSpace(htmlBody) == "" {
		return fmt.Errorf("email body is required")
	}

	payload := brevoSendEmailRequest{
		Sender: brevoParticipant{
			Name:  s.fromName,
			Email: s.fromEmail,
		},
		To:          []brevoParticipant{{Email: to}},
		Subject:     subject,
		HTMLContent: htmlBody,
		TextContent: textBody,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal brevo payload: %w", err)
	}

	requestURL := s.baseURL + "/smtp/email"
	req, err := http.NewRequest(http.MethodPost, requestURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to build brevo request: %w", err)
	}

	req.Header.Set("accept", "application/json")
	req.Header.Set("content-type", "application/json")
	req.Header.Set("api-key", s.apiKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("brevo request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return buildBrevoAPIError(resp.StatusCode, responseBody)
	}

	return nil
}

func buildBrevoAPIError(statusCode int, responseBody []byte) error {
	message := strings.TrimSpace(string(responseBody))
	if len(responseBody) > 0 {
		var parsed brevoErrorResponse
		if err := json.Unmarshal(responseBody, &parsed); err == nil {
			if parsedMsg := strings.TrimSpace(parsed.Message); parsedMsg != "" {
				message = parsedMsg
			}
			if parsedCode := strings.TrimSpace(parsed.Code); parsedCode != "" {
				if message == "" {
					message = parsedCode
				} else if !strings.Contains(strings.ToLower(message), strings.ToLower(parsedCode)) {
					message = parsedCode + ": " + message
				}
			}
		}
	}

	if message == "" {
		message = http.StatusText(statusCode)
	}

	return fmt.Errorf("brevo api status %d: %s", statusCode, message)
}

func (s *EmailService) buildPasswordChangeVerificationCodeEmail(to string, recipientName string, code string, locale string) (subject, textBody, htmlBody string, err error) {
	if !s.IsConfigured() {
		return "", "", "", fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return "", "", "", fmt.Errorf("recipient email is required")
	}

	recipientName = strings.TrimSpace(recipientName)
	if recipientName == "" {
		recipientName = "Member"
	}

	code = strings.TrimSpace(code)
	if code == "" {
		return "", "", "", fmt.Errorf("verification code is required")
	}

	locale = normalizeLocale(locale)
	escapedName := html.EscapeString(recipientName)
	escapedCode := html.EscapeString(code)

	if locale == "bn" {
		subject = "পাসওয়ার্ড পরিবর্তন যাচাইকরণ কোড | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "পাসওয়ার্ড পরিবর্তন যাচাইকরণ", fmt.Sprintf("প্রিয় %s,\n\nআপনার পাসওয়ার্ড পরিবর্তন অনুরোধের জন্য যাচাইকরণ কোড নিচে দেওয়া হলো:\n\nকোড: %s\n\nএই কোড ১০ মিনিটের জন্য কার্যকর।", recipientName, code))
		htmlBody = s.renderOfficialEmailHTML(locale, "পাসওয়ার্ড যাচাইকরণ কোড", "পাসওয়ার্ড পরিবর্তনের আগে এই কোডটি যাচাই করুন", fmt.Sprintf(
			"<p style=\"margin:0 0 12px 0;\">প্রিয় %s,</p>"+
				"<p style=\"margin:0 0 14px 0;\">আপনার পাসওয়ার্ড পরিবর্তন অনুরোধ নিশ্চিত করতে নিচের কোডটি দিন:</p>"+
				"<div style=\"margin:0 0 16px 0;padding:14px 16px;background:#e7f5f3;border:1px solid #bae4dd;border-radius:10px;font-size:30px;letter-spacing:6px;font-weight:700;text-align:center;color:#115e59;\">%s</div>"+
				"<p style=\"margin:0;color:#334155;\">এই কোড <strong>১০ মিনিট</strong> পরে মেয়াদোত্তীর্ণ হবে। আপনি অনুরোধ না করে থাকলে অ্যাকাউন্ট নিরাপদ আছে।</p>",
			escapedName,
			escapedCode,
		))
	} else {
		subject = "Password Change Verification Code | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "Password Change Verification", fmt.Sprintf("Dear %s,\n\nUse the verification code below to confirm your password change request:\n\nCode: %s\n\nThis code expires in 10 minutes.", recipientName, code))
		htmlBody = s.renderOfficialEmailHTML(locale, "Password verification code", "Verify Your Password Change Request", fmt.Sprintf(
			"<p style=\"margin:0 0 12px 0;\">Dear %s,</p>"+
				"<p style=\"margin:0 0 14px 0;\">Enter the verification code below to confirm your password change:</p>"+
				"<div style=\"margin:0 0 16px 0;padding:14px 16px;background:#e7f5f3;border:1px solid #bae4dd;border-radius:10px;font-size:30px;letter-spacing:6px;font-weight:700;text-align:center;color:#115e59;\">%s</div>"+
				"<p style=\"margin:0;color:#334155;\">This code will expire in <strong>10 minutes</strong>. If you did not request this, your account is still secure.</p>",
			escapedName,
			escapedCode,
		))
	}

	return subject, textBody, htmlBody, nil
}

// SendPasswordChangeVerificationCodeEmail renders the message and hands it to the transport. The
// rendering is buildPasswordChangeVerificationCodeEmail, which is pure and therefore testable — see
// email_service_test.go (WO-52). Nothing here reaches the network.
func (s *EmailService) SendPasswordChangeVerificationCodeEmail(to string, recipientName string, code string, locale string) error {
	subject, textBody, htmlBody, err := s.buildPasswordChangeVerificationCodeEmail(to, recipientName, code, locale)
	if err != nil {
		return err
	}
	return s.sendWithRetry(strings.TrimSpace(to), subject, textBody, htmlBody)
}

func (s *EmailService) buildPasswordResetEmail(to string, token string, locale string) (subject, textBody, htmlBody string, err error) {
	if !s.IsConfigured() {
		return "", "", "", fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return "", "", "", fmt.Errorf("recipient email is required")
	}

	locale = normalizeLocale(locale)

	resetURL := fmt.Sprintf("%s/%s/reset-password?token=%s", s.appURL, locale, token)
	escapedResetURL := html.EscapeString(resetURL)

	if locale == "bn" {
		subject = "পাসওয়ার্ড রিসেট অনুরোধ | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "পাসওয়ার্ড রিসেট করুন", fmt.Sprintf("আপনার অ্যাকাউন্টের জন্য পাসওয়ার্ড রিসেট অনুরোধ পাওয়া গেছে। নিচের লিংক ব্যবহার করে নতুন পাসওয়ার্ড সেট করুন:\n\n%s\n\nএই লিংক ৩০ মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে।", resetURL))
		htmlBody = s.renderOfficialEmailHTML(locale, "পাসওয়ার্ড রিসেট অনুরোধ", "আপনার পাসওয়ার্ড রিসেট করুন", fmt.Sprintf(
			"<p style=\"margin:0 0 14px 0;\">আপনার অ্যাকাউন্টের জন্য পাসওয়ার্ড রিসেট অনুরোধ পাওয়া গেছে।</p>"+
				"<p style=\"margin:0 0 18px 0;\"><a href=\"%s\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;\">পাসওয়ার্ড রিসেট করুন</a></p>"+
				"<p style=\"margin:0;color:#334155;\">এই লিংক <strong>৩০ মিনিট</strong> পর্যন্ত কার্যকর থাকবে। আপনি অনুরোধ না করলে এই ইমেইল উপেক্ষা করুন।</p>",
			escapedResetURL,
		))
	} else {
		subject = "Password Reset Request | Hasnahena Foundation"
		textBody = s.renderOfficialEmailText(locale, "Reset Your Password", fmt.Sprintf("We received a password reset request for your account. Use the link below to set a new password:\n\n%s\n\nThis link expires in 30 minutes.", resetURL))
		htmlBody = s.renderOfficialEmailHTML(locale, "Password reset request", "Reset Your Password", fmt.Sprintf(
			"<p style=\"margin:0 0 14px 0;\">We received a password reset request for your account.</p>"+
				"<p style=\"margin:0 0 18px 0;\"><a href=\"%s\" style=\"display:inline-block;background:#0f766e;color:#ffffff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:600;\">Reset password</a></p>"+
				"<p style=\"margin:0;color:#334155;\">This link expires in <strong>30 minutes</strong>. If you did not request this, you can safely ignore this email.</p>",
			escapedResetURL,
		))
	}

	return subject, textBody, htmlBody, nil
}

// SendPasswordResetEmail renders the message and hands it to the transport. The
// rendering is buildPasswordResetEmail, which is pure and therefore testable — see
// email_service_test.go (WO-52). Nothing here reaches the network.
func (s *EmailService) SendPasswordResetEmail(to string, token string, locale string) error {
	subject, textBody, htmlBody, err := s.buildPasswordResetEmail(to, token, locale)
	if err != nil {
		return err
	}
	return s.sendWithRetry(strings.TrimSpace(to), subject, textBody, htmlBody)
}
