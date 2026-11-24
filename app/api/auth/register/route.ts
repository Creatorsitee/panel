import { NextRequest, NextResponse } from 'next/server';
import { attachSessionCookie, hashPassword, signSessionToken, toPublicUser } from '@/lib/auth';
import { createUser } from '@/lib/db';
import { validateEmail } from '@/lib/security';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      password?: string;
    };

    const name = (body.name || '').trim();
    if (name.length < 2 || name.length > 60) {
      return NextResponse.json(
        { error: 'Nama lengkap harus antara 2 hingga 60 karakter.' },
        { status: 400 }
      );
    }

    const email = validateEmail(body.email || '');
    const password = body.password || '';
    if (password.length < 6 || password.length > 128) {
      return NextResponse.json(
        { error: 'Password minimal 6 karakter.' },
        { status: 400 }
      );
    }

    const passwordHash = hashPassword(password);
    const user = await createUser({ name, email, passwordHash });
    const token = signSessionToken(user);

    const res = NextResponse.json({
      user: toPublicUser(user),
      token,
    }, { status: 201 });
    attachSessionCookie(res, token, req);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mendaftarkan akun.';
    const status = message.includes('terdaftar') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
