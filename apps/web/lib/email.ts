import nodemailer from 'nodemailer';

// Email configuration using environment variables
const EMAIL_FROM = process.env.EMAIL_FROM || 'info@hasnahenafoundation.com';
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

// Get the app URL - prioritize production URLs
function getProductionUrl(): string {
  // Vercel production URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // Custom domain
  if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('localhost')) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  // App URL
  if (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) {
    return process.env.APP_URL;
  }
  // Fallback for production
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://hasnahenafoundation.com';
}

// Create transporter with connection pooling for better performance
let transporter: nodemailer.Transporter | null = null;

const createTransporter = () => {
  if (transporter) return transporter;

  if (!EMAIL_USER || !EMAIL_PASS) {
    console.error('[Email] Missing EMAIL_USER or EMAIL_PASS environment variables');
    console.error('[Email] EMAIL_USER:', EMAIL_USER ? 'SET' : 'NOT SET');
    console.error('[Email] EMAIL_PASS:', EMAIL_PASS ? 'SET' : 'NOT SET');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
    pool: true, // Use connection pooling
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
};

interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
  const transporter = createTransporter();

  if (!transporter) {
    console.error('[Email] Transporter not configured');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    await transporter.sendMail({
      from: `"Hasnahena Foundation" <${EMAIL_FROM}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    console.log(`[Email] Sent to ${options.to}: ${options.subject}`);
    return { success: true };
  } catch (error) {
    console.error('[Email] Failed to send:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}

export function generatePasswordResetEmail(resetUrl: string, locale: string = 'en') {
  const isbn = locale === 'bn';

  const subject = isbn
    ? 'পাসওয়ার্ড রিসেট - হাসনাহেনা ফাউন্ডেশন'
    : 'Password Reset - Hasnahena Foundation';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .logo { text-align: center; margin-bottom: 30px; }
    .logo h1 { color: #059669; margin: 0; font-size: 24px; }
    h2 { color: #333; margin-top: 0; }
    .button { display: inline-block; background: #059669; color: white !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
    .button:hover { background: #047857; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 20px 0; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <h1>🌿 ${isbn ? 'হাসনাহেনা ফাউন্ডেশন' : 'Hasnahena Foundation'}</h1>
      </div>

      <h2>${isbn ? 'পাসওয়ার্ড রিসেট অনুরোধ' : 'Password Reset Request'}</h2>

      <p>${isbn
        ? 'আপনি আপনার অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ করেছেন। নিচের বাটনে ক্লিক করে নতুন পাসওয়ার্ড সেট করুন:'
        : 'You requested to reset your account password. Click the button below to set a new password:'}</p>

      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">${isbn ? 'পাসওয়ার্ড রিসেট করুন' : 'Reset Password'}</a>
      </div>

      <div class="warning">
        ⚠️ ${isbn
          ? 'এই লিঙ্কটি ১ ঘন্টার মধ্যে মেয়াদ উত্তীর্ণ হবে। যদি আপনি এই অনুরোধ না করে থাকেন, অনুগ্রহ করে এই ইমেইলটি উপেক্ষা করুন।'
          : 'This link will expire in 1 hour. If you did not request this, please ignore this email.'}
      </div>

      <p style="font-size: 13px; color: #666;">
        ${isbn ? 'লিঙ্ক কাজ না করলে এই URL কপি করে ব্রাউজারে পেস্ট করুন:' : 'If the button doesn\'t work, copy and paste this URL into your browser:'}
        <br>
        <a href="${resetUrl}" style="color: #059669; word-break: break-all;">${resetUrl}</a>
      </p>

      <div class="footer">
        <p>${isbn ? 'ধন্যবাদ,' : 'Thank you,'}<br><strong>${isbn ? 'হাসনাহেনা ফাউন্ডেশন টিম' : 'Hasnahena Foundation Team'}</strong></p>
        <p>© ${new Date().getFullYear()} Hasnahena Foundation. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const text = isbn
    ? `পাসওয়ার্ড রিসেট অনুরোধ\n\nআপনি আপনার অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ করেছেন।\n\nনিচের লিঙ্কে ক্লিক করুন:\n${resetUrl}\n\nএই লিঙ্কটি ১ ঘন্টার মধ্যে মেয়াদ উত্তীর্ণ হবে।\n\nহাসনাহেনা ফাউন্ডেশন`
    : `Password Reset Request\n\nYou requested to reset your account password.\n\nClick this link to reset: ${resetUrl}\n\nThis link expires in 1 hour.\n\nHasnahena Foundation`;

  return { subject, html, text };
}

export function getAppUrl(): string {
  return getProductionUrl();
}
