package services

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func (s *EmailService) SendMemberApprovalEmail(to string, memberName string, temporaryPassword string, locale string) error {
	if !s.IsConfigured() {
		return fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("recipient email is required")
	}

	memberName = strings.TrimSpace(memberName)
	if memberName == "" {
		memberName = "Member"
	}

	locale = strings.ToLower(strings.TrimSpace(locale))
	if locale != "bn" {
		locale = "en"
	}

	loginURL := fmt.Sprintf("%s/%s/login", s.appURL, locale)
	subject := "Your membership has been approved - Hasnahena Foundation"

	textBody := fmt.Sprintf(
		"Dear %s,\n\nYour membership application has been approved.\n\nTemporary Password: %s\nLogin URL: %s\n\nYou must change your password immediately after first login.\n\nHasnahena Foundation",
		memberName,
		temporaryPassword,
		loginURL,
	)

	htmlBody := fmt.Sprintf(
		"<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\">"+
			"<h2>Your membership has been approved</h2>"+
			"<p>Dear %s,</p>"+
			"<p>Your membership application has been approved.</p>"+
			"<p><strong>Temporary Password:</strong> %s</p>"+
			"<p><a href=\"%s\" style=\"background:#059669;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px\">Login</a></p>"+
			"<p><strong>Password change is mandatory after first login.</strong></p>"+
			"<p style=\"font-size:12px;color:#6b7280\">Do not share this password with anyone.</p>"+
			"</div>",
		memberName,
		temporaryPassword,
		loginURL,
	)

	return s.sendWithRetry(to, subject, textBody, htmlBody)
}

func (s *EmailService) SendStaffWelcomeEmail(to string, staffName string, role string, phone string, temporaryPassword string, locale string) error {
	if !s.IsConfigured() {
		return fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("recipient email is required")
	}

	staffName = strings.TrimSpace(staffName)
	if staffName == "" {
		staffName = "Staff"
	}

	role = strings.ToUpper(strings.TrimSpace(role))
	if role != "ADMIN" {
		role = "WORKER"
	}

	locale = strings.ToLower(strings.TrimSpace(locale))
	if locale != "bn" {
		locale = "en"
	}

	loginURL := fmt.Sprintf("%s/%s/login", s.appURL, locale)

	var subject, textBody, htmlBody string
	if locale == "bn" {
		roleLabel := "কর্মী"
		if role == "ADMIN" {
			roleLabel = "অ্যাডমিন"
		}
		subject = "নতুন স্টাফ অ্যাকাউন্ট - Hasnahena Foundation"
		textBody = fmt.Sprintf(
			"প্রিয় %s,\n\nআপনাকে %s হিসেবে যুক্ত করা হয়েছে।\n\nইমেইল: %s\nফোন: %s\nঅস্থায়ী পাসওয়ার্ড: %s\nলগইন: %s\n\nপ্রথম লগইনের পরে অবশ্যই পাসওয়ার্ড পরিবর্তন করুন।\n\nHasnahena Foundation",
			staffName,
			roleLabel,
			to,
			strings.TrimSpace(phone),
			temporaryPassword,
			loginURL,
		)
		htmlBody = fmt.Sprintf(
			"<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\">"+
				"<h2>আপনার অ্যাকাউন্ট তৈরি হয়েছে</h2>"+
				"<p>প্রিয় %s,</p>"+
				"<p>আপনাকে %s হিসেবে যুক্ত করা হয়েছে।</p>"+
				"<p><strong>ইমেইল:</strong> %s</p>"+
				"<p><strong>ফোন:</strong> %s</p>"+
				"<p><strong>অস্থায়ী পাসওয়ার্ড:</strong> %s</p>"+
				"<p><a href=\"%s\" style=\"background:#059669;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px\">লগইন করুন</a></p>"+
				"<p><strong>প্রথম লগইনের পরে অবশ্যই পাসওয়ার্ড পরিবর্তন করুন।</strong></p>"+
				"</div>",
			staffName,
			roleLabel,
			to,
			strings.TrimSpace(phone),
			temporaryPassword,
			loginURL,
		)
	} else {
		roleLabel := "Worker"
		if role == "ADMIN" {
			roleLabel = "Admin"
		}
		subject = "New Staff Account - Hasnahena Foundation"
		textBody = fmt.Sprintf(
			"Dear %s,\n\nYou were added as %s.\n\nEmail: %s\nPhone: %s\nTemporary Password: %s\nLogin URL: %s\n\nYou must change your password immediately after first login.\n\nHasnahena Foundation",
			staffName,
			roleLabel,
			to,
			strings.TrimSpace(phone),
			temporaryPassword,
			loginURL,
		)
		htmlBody = fmt.Sprintf(
			"<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\">"+
				"<h2>Your account has been created</h2>"+
				"<p>Dear %s,</p>"+
				"<p>You were added as %s.</p>"+
				"<p><strong>Email:</strong> %s</p>"+
				"<p><strong>Phone:</strong> %s</p>"+
				"<p><strong>Temporary Password:</strong> %s</p>"+
				"<p><a href=\"%s\" style=\"background:#059669;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px\">Login</a></p>"+
				"<p><strong>Password change is mandatory after first login.</strong></p>"+
				"</div>",
			staffName,
			roleLabel,
			to,
			strings.TrimSpace(phone),
			temporaryPassword,
			loginURL,
		)
	}

	return s.sendWithRetry(to, subject, textBody, htmlBody)
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

func (s *EmailService) SendPasswordResetEmail(to string, token string, locale string) error {
	if !s.IsConfigured() {
		return fmt.Errorf("email service not configured")
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return fmt.Errorf("recipient email is required")
	}

	locale = strings.ToLower(strings.TrimSpace(locale))
	if locale != "bn" {
		locale = "en"
	}

	resetURL := fmt.Sprintf("%s/%s/reset-password?token=%s", s.appURL, locale, token)

	var subject, textBody, htmlBody string
	if locale == "bn" {
		subject = "পাসওয়ার্ড রিসেট করুন - Hasnahena Foundation"
		textBody = fmt.Sprintf("আপনার পাসওয়ার্ড রিসেট করতে নিচের লিঙ্কে ক্লিক করুন:\n\n%s\n\nএই লিঙ্কটি পরবর্তী ১ ঘণ্টার জন্য কার্যকর থাকবে।", resetURL)
		htmlBody = fmt.Sprintf(`
			<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
				<h2>পাসওয়ার্ড রিসেট</h2>
				<p>আপনার পাসওয়ার্ড রিসেট করতে নিচের বাটনে ক্লিক করুন:</p>
				<p><a href="%s" style="background:#059669;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">পাসওয়ার্ড রিসেট করুন</a></p>
				<p>এই লিঙ্কটি পরবর্তী <strong>১ ঘণ্টার</strong> জন্য কার্যকর থাকবে।</p>
				<p style="font-size:12px;color:#6b7280">আপনি যদি এই অনুরোধ না করে থাকেন, তবে এই ইমেইলটি এড়িয়ে যান।</p>
			</div>
		`, resetURL)
	} else {
		subject = "Reset Your Password - Hasnahena Foundation"
		textBody = fmt.Sprintf("Click the link below to reset your password:\n\n%s\n\nThis link will expire in 1 hour.", resetURL)
		htmlBody = fmt.Sprintf(`
			<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
				<h2>Password Reset</h2>
				<p>Click the button below to reset your password:</p>
				<p><a href="%s" style="background:#059669;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px">Reset Password</a></p>
				<p>This link will expire in <strong>1 hour</strong>.</p>
				<p style="font-size:12px;color:#6b7280">If you didn't request this, you can safely ignore this email.</p>
</div>
`, resetURL)
	}

	return s.sendWithRetry(to, subject, textBody, htmlBody)
}
