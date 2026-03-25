import { verifyHs256Jwt } from './jwt';

type AuthUser = {
  id: string;
  role: string;
  email?: string;
  phone?: string;
};

export function requireAuth(req: Request): AuthUser {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth) throw new Error('Missing Authorization header');

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Invalid Authorization header');

  const token = match[1];
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Server missing JWT_SECRET');

  const claims = verifyHs256Jwt(token, secret);
  if (!claims.sub) throw new Error('Invalid token claims');

  return {
    id: claims.sub,
    role: claims.role ?? '',
    email: claims.email,
    phone: claims.phone,
  };
}