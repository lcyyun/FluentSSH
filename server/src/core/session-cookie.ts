import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'fluentssh_sid';
const tokens = new Set<string>();
const MAX_TOKENS = 200;

export function issueToken(): string {
  const token = randomBytes(32).toString('base64url');
  tokens.add(token);
  if (tokens.size > MAX_TOKENS) {
    const oldest = tokens.values().next().value;
    if (oldest) tokens.delete(oldest);
  }
  return token;
}

export function isValidToken(token: string | undefined | null): boolean {
  return Boolean(token && tokens.has(token));
}

export function parseCookie(header: string | undefined, name = COOKIE_NAME): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function getRequestToken(req: Request): string | null {
  const attributed = (req as Request & { fluentsshToken?: string }).fluentsshToken;
  return parseCookie(req.headers.cookie) ?? (typeof req.query.token === 'string' ? req.query.token : null) ?? attributed ?? null;
}

/** Issue a local session cookie on first visit and validate it afterwards. */
export function sessionCookieMiddleware(req: Request, res: Response, next: NextFunction) {
  const existing = parseCookie(req.headers.cookie);
  if (existing && isValidToken(existing)) return next();
  const token = issueToken();
  const isHttps = req.protocol === 'https';
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${60 * 60 * 24 * 365}`
  ];
  if (isHttps) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
  // Make the token visible to this request so APIs on the very first call succeed.
  (req as Request & { fluentsshToken?: string }).fluentsshToken = token;
  next();
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const token = getRequestToken(req);
  if (!isValidToken(token)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid local session.' } });
    return;
  }
  next();
}

export { COOKIE_NAME };
