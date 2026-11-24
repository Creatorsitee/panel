import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie, signSessionToken, toPublicUser, verifyPassword } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db';
import { validateEmail } from '@/lib/security';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      email?: string;
      password?: string;
    };

    const email = validateEmail(body.email || '');
    const password = body.password || '';
    if (!password) {
      return NextResponse.json({ error: 'Password wajib diisi.' }, { status: 400 });
    }

    const user = getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: 'Email atau password salah.' },
        { status: 401 }
      );
    }

    const token = signSessionToken(user);
    const res = NextResponse.json({
      user: toPublicUser(user),
      token,
    });
    attachSessionCookie(res, token, req);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal masuk ke akun.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
