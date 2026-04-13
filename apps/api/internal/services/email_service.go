package services

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

const (
	smtpConnectTimeout  = 8 * time.Second
	smtpCommandTimeout  = 35 * time.Second
	smtpRetryAttempts   = 3
	smtpRetryBackoff    = 1500 * time.Millisecond
	smtpImplicitTLSPort = 465
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
	host := strings.TrimSpace(cfg.Host)
	password := normalizeSMTPPassword(host, cfg.Password)
	from := strings.TrimSpace(cfg.From)
	if from == "" {
		from = strings.TrimSpace(cfg.Username)
	}

	enabled := host != "" && cfg.Port > 0 && strings.TrimSpace(cfg.Username) != "" && strings.TrimSpace(password) != "" && from != ""

	appURL := strings.TrimSuffix(strings.TrimSpace(cfg.AppURL), "/")
	if appURL == "" {
		appURL = "https://www.hasnahenafoundation.com"
	}

	return &EmailService{
		host:     host,
		port:     cfg.Port,
		username: strings.TrimSpace(cfg.Username),
		password: password,
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

	return s.sendWithRetry(to, subject, textBody, htmlBody)
}

func (s *EmailService) sendWithRetry(to string, subject string, textBody string, htmlBody string) error {
	portsToTry := []int{s.port}
	if shouldTryImplicitTLSFallback(s.host, s.port) {
		portsToTry = append(portsToTry, smtpImplicitTLSPort)
	}

	var lastErr error
	for attempt := 1; attempt <= smtpRetryAttempts; attempt++ {
		for _, port := range portsToTry {
			err := s.sendOnPort(to, subject, textBody, htmlBody, port)
			if err == nil {
				return nil
			}
			lastErr = fmt.Errorf("smtp port %d attempt %d: %w", port, attempt, err)
		}

		if attempt < smtpRetryAttempts {
			time.Sleep(smtpRetryBackoff)
		}
	}

	return fmt.Errorf("failed to send email after %d attempt(s): %w", smtpRetryAttempts, lastErr)
}

func (s *EmailService) sendOnPort(to string, subject string, textBody string, htmlBody string, port int) error {
	address := fmt.Sprintf("%s:%d", s.host, port)
	auth := smtp.PlainAuth("", s.username, s.password, s.host)
	envelopeFrom := s.username
	if strings.TrimSpace(envelopeFrom) == "" {
		envelopeFrom = s.from
	}

	headerFrom := s.from
	replyTo := ""
	if isGmailHost(s.host) {
		if strings.TrimSpace(s.username) != "" {
			headerFrom = s.username
		}
		if !strings.EqualFold(strings.TrimSpace(s.from), strings.TrimSpace(headerFrom)) {
			replyTo = s.from
		}
	}

	message := buildMultipartMessage(headerFrom, to, subject, textBody, htmlBody, replyTo)

	conn, err := s.openConnection(address, port)
	if err != nil {
		return err
	}
	if err := conn.SetDeadline(time.Now().Add(smtpCommandTimeout)); err != nil {
		_ = conn.Close()
		return err
	}

	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return err
	}
	defer client.Close()
	if err := client.Hello("localhost"); err != nil {
		return err
	}

	if port != smtpImplicitTLSPort {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}); err != nil {
				return err
			}
		} else if port == 587 {
			return fmt.Errorf("smtp server does not support STARTTLS on port 587")
		}
	}

	if strings.TrimSpace(s.username) != "" {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(auth); err != nil {
				return fmt.Errorf("smtp authentication failed: %w", err)
			}
		} else {
			return fmt.Errorf("smtp authentication extension not available")
		}
	}

	if err := client.Mail(envelopeFrom); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}

	writer, err := client.Data()
	if err != nil {
		return err
	}

	if _, err := writer.Write(message); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}

	return client.Quit()
}

func (s *EmailService) openConnection(address string, port int) (net.Conn, error) {
	dialer := &net.Dialer{
		Timeout:   smtpConnectTimeout,
		KeepAlive: 30 * time.Second,
	}

	if port == smtpImplicitTLSPort {
		return tls.DialWithDialer(dialer, "tcp", address, &tls.Config{
			ServerName: s.host,
			MinVersion: tls.VersionTLS12,
		})
	}

	return dialer.Dial("tcp", address)
}

func shouldTryImplicitTLSFallback(host string, port int) bool {
	if port != 587 {
		return false
	}
	return isGmailHost(host)
}

func isGmailHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	return strings.Contains(h, "gmail.com") || strings.Contains(h, "googlemail.com")
}

func normalizeSMTPPassword(host string, password string) string {
	trimmed := strings.TrimSpace(password)
	h := strings.ToLower(strings.TrimSpace(host))
	if trimmed == "" {
		return trimmed
	}

	if strings.Contains(h, "gmail.com") || strings.Contains(h, "googlemail.com") {
		compact := strings.ReplaceAll(trimmed, " ", "")
		if len(compact) == 16 {
			return compact
		}
	}

	return trimmed
}

func buildMultipartMessage(from string, to string, subject string, textBody string, htmlBody string, replyTo string) []byte {
	boundary := "hn-boundary-7f3d4a8e"
	headers := []string{fmt.Sprintf("From: Hasnahena Foundation <%s>", from)}
	if strings.TrimSpace(replyTo) != "" {
		headers = append(headers, fmt.Sprintf("Reply-To: %s", strings.TrimSpace(replyTo)))
	}
	headers = append(headers,
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q", boundary),
		"",
	)

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
