import crypto from 'crypto';

export type JwtClaims = {
  sub?: string;
  role?: string;
  email?: string;
  phone?: string;
  iat?: number;
  exp?: number;
};

function base64UrlDecode(input: string): string {
  // base64url to base64
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '==='.slice((base64.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function verifyHs256Jwt(token: string, secret: string): JwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  // Validate the alg header
  const headerRaw = base64UrlDecode(encodedHeader);
  const header = JSON.parse(headerRaw);
  if (header.alg !== 'HS256') {
    throw new Error('Invalid token algorithm');
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSig = base64UrlEncode(crypto.createHmac('sha256', secret).update(signingInput).digest());
  const expectedBuf = Buffer.from(expectedSig);
  const providedBuf = Buffer.from(encodedSignature);
  // Compare lengths first: timingSafeEqual throws on a mismatch. Length is not secret.
  if (
    expectedBuf.length !== providedBuf.length
    || !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new Error('Invalid token signature');
  }

  const payloadRaw = base64UrlDecode(encodedPayload);
  const payload = JSON.parse(payloadRaw) as JwtClaims;

  if (typeof payload.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) throw new Error('Token expired');
  }

  return payload;
}

