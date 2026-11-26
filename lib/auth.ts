import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest, NextResponse } from 'next/server';
import type { PublicUser, UserRecord, UserRole } from './types';

export const SESSION_COOKIE_NAME = 'nodal_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const globalForAuth = globalThis as unknown as {
  __nodalSessionSecret?: string;
};

function getSessionSecret(): string {
  if (!globalForAuth.__nodalSessionSecret) {
    const dataRoot = process.env.PANEL_DATA_DIR?.trim()
      ? path.resolve(process.env.PANEL_DATA_DIR.trim())
      : path.join(process.cwd(), 'data');
    const secretFile = path.join(dataRoot, '.session-secret');
    try {
      if (fs.existsSync(secretFile)) {
        const persisted = fs.readFileSync(secretFile, 'utf8').trim();
        if (persisted.length >= 32) {
          globalForAuth.__nodalSessionSecret = persisted;
          return persisted;
        }
      }
      const generated = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(path.dirname(secretFile), { recursive: true });
      fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
      globalForAuth.__nodalSessionSecret = generated;
    } catch {
      globalForAuth.__nodalSessionSecret = crypto.randomBytes(32).toString('hex');
    }
  }
  return globalForAuth.__nodalSessionSecret;
}

export function hashPassword(password: string): string {
  if (!password || password.length < 6) {
    throw new Error('Password minimal 6 karakter.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function signSessionToken(user: Pick<UserRecord, 'id' | 'email' | 'name' | 'role'>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${encodedPayload}`;
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getSessionSecret()).update(data).digest()
  );
  return `${data}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, encodedPayload, sig] = parts;
  const data = `${header}.${encodedPayload}`;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getSessionSecret()).update(data).digest()
  );

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    if (!parsed.userId || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export function extractSessionFromRequest(req: NextRequest): SessionPayload | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    const verified = verifySessionToken(bearer);
    if (verified) return verified;
  }

  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) {

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      const origin = req.headers.get('origin');
      const rawHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
      const host = rawHost?.split(',')[0]?.trim();
      const customHeader = req.headers.get('x-requested-with');
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host && customHeader !== 'XMLHttpRequest') {
            return null;
          }
        } catch {
          return null;
        }
      } else if (!customHeader) {
        return null;
      }
    }
    return verifySessionToken(cookieToken);
  }

  return null;
}

function isSecureRequest(req?: NextRequest): boolean {
  if (!req) return false;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'https') return true;
  if (forwardedProto === 'http') return false;
  return req.nextUrl.protocol === 'https:';
}

export function attachSessionCookie(res: NextResponse, token: string, req?: NextRequest): void {
  const secure = isSecureRequest(req);
  const cookieAttrs = secure
    ? 'HttpOnly; Secure; SameSite=None; Partitioned'
    : 'HttpOnly; SameSite=Lax';
  res.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; ${cookieAttrs}`
  );
}

export function clearSessionCookie(res: NextResponse, req?: NextRequest): void {
  const secure = isSecureRequest(req);
  const cookieAttrs = secure
    ? 'HttpOnly; Secure; SameSite=None; Partitioned'
    : 'HttpOnly; SameSite=Lax';
  res.headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; ${cookieAttrs}`
  );
}
