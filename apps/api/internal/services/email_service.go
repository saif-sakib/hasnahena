package services

import (
	"fmt"
	"net/smtp"
	"strings"
)

type EmailConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	AppURL   string
}

type EmailService struct {
	host     string
	port     int
	username string
	password string
	from     string
	appURL   string
	enabled  bool
}

func NewEmailService(cfg EmailConfig) *EmailService {
	from := strings.TrimSpace(cfg.From)
	if from == "" {
		from = strings.TrimSpace(cfg.Username)
	}

	enabled := strings.TrimSpace(cfg.Host) != "" && cfg.Port > 0 && strings.TrimSpace(cfg.Username) != "" && strings.TrimSpace(cfg.Password) != "" && from != ""

	appURL := strings.TrimSuffix(strings.TrimSpace(cfg.AppURL), "/")
	if appURL == "" {
		appURL = "https://hasnahenafoundation.com"
	}

	return &EmailService{
		host:     strings.TrimSpace(cfg.Host),
		port:     cfg.Port,
		username: strings.TrimSpace(cfg.Username),
		password: cfg.Password,
		from:     from,
		appURL:   appURL,
		enabled:  enabled,
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

	return s.send(to, subject, textBody, htmlBody)
}

func (s *EmailService) send(to string, subject string, textBody string, htmlBody string) error {
	address := fmt.Sprintf("%s:%d", s.host, s.port)
	auth := smtp.PlainAuth("", s.username, s.password, s.host)
	message := buildMultipartMessage(s.from, to, subject, textBody, htmlBody)
	return smtp.SendMail(address, auth, s.from, []string{to}, message)
}

func buildMultipartMessage(from string, to string, subject string, textBody string, htmlBody string) []byte {
	boundary := "hn-boundary-7f3d4a8e"
	headers := []string{
		fmt.Sprintf("From: Hasnahena Foundation <%s>", from),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q", boundary),
		"",
	}

	parts := []string{
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/plain; charset=UTF-8",
		"",
		textBody,
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/html; charset=UTF-8",
		"",
		htmlBody,
		fmt.Sprintf("--%s--", boundary),
		"",
	}

	return []byte(strings.Join(append(headers, parts...), "\r\n"))
}
