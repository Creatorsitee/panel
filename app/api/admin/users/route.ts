import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, toPublicUser } from '@/lib/auth';
import { createUserByAdmin, listAllServers, listAllUsers } from '@/lib/db';
import { requireAdmin } from '@/lib/guards';
import { validateEmail } from '@/lib/security';
import type { AdminUserSummary, UserRole } from '@/lib/types';

export async function GET(req: NextRequest) {
  const adminCheck = requireAdmin(req);
  if (adminCheck.error) return adminCheck.error;

  const users = listAllUsers();
  const servers = listAllServers();

  const serverCountMap = new Map<string, number>();
  for (const srv of servers) {
    serverCountMap.set(srv.ownerId, (serverCountMap.get(srv.ownerId) || 0) + 1);
  }

  const summaries: AdminUserSummary[] = users.map((u) => ({
    ...toPublicUser(u),
    serverCount: serverCountMap.get(u.id) || 0,
  }));

  return NextResponse.json({ users: summaries });
}

export async function POST(req: NextRequest) {
  const adminCheck = requireAdmin(req);
  if (adminCheck.error) return adminCheck.error;

  try {
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      password?: string;
      role?: UserRole;
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

    const role: UserRole = body.role === 'admin' ? 'admin' : 'user';
    const passwordHash = hashPassword(password);
    const created = await createUserByAdmin({ name, email, passwordHash, role });

    return NextResponse.json(
      { user: { ...toPublicUser(created), serverCount: 0 } satisfies AdminUserSummary },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal membuat user.';
    const status = message.includes('terdaftar') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
