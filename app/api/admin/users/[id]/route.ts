import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, toPublicUser } from '@/lib/auth';
import {
  deleteServerRecord,
  deleteUserRecord,
  getUserById,
  listAllServers,
  updateUserRecord,
} from '@/lib/db';
import { stopServerProcess } from '@/lib/processes';
import { requireAdmin } from '@/lib/guards';
import { validateEmail } from '@/lib/security';
import type { AdminUserSummary, UserRole } from '@/lib/types';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const adminCheck = requireAdmin(req);
  if (adminCheck.error) return adminCheck.error;

  const { id } = await context.params;
  const target = getUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 });
  }

  try {
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      role?: UserRole;
      password?: string;
    };

    const patch: Parameters<typeof updateUserRecord>[1] = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length < 2 || name.length > 60) {
        return NextResponse.json(
          { error: 'Nama lengkap harus antara 2 hingga 60 karakter.' },
          { status: 400 }
        );
      }
      patch.name = name;
    }

    if (body.email !== undefined) {
      patch.email = validateEmail(body.email);
    }

    if (body.role !== undefined) {
      const nextRole: UserRole = body.role === 'admin' ? 'admin' : 'user';
      if (id === adminCheck.user.id && nextRole !== 'admin') {
        return NextResponse.json(
          { error: 'Anda tidak dapat menurunkan role akun Anda sendiri.' },
          { status: 400 }
        );
      }
      patch.role = nextRole;
    }

    if (body.password !== undefined && body.password !== '') {
      if (!body.password.trim() || body.password.length < 6 || body.password.length > 128) {
        return NextResponse.json(
          { error: 'Password baru minimal 6 karakter dan tidak boleh hanya spasi.' },
          { status: 400 }
        );
      }
      patch.passwordHash = hashPassword(body.password);
    }

    const updated = await updateUserRecord(id, patch);
    const serverCount = listAllServers().filter((s) => s.ownerId === id).length;

    return NextResponse.json({
      user: { ...toPublicUser(updated), serverCount } satisfies AdminUserSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memperbarui user.';
    const status = message.includes('digunakan') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const adminCheck = requireAdmin(req);
  if (adminCheck.error) return adminCheck.error;

  const { id } = await context.params;
  if (id === adminCheck.user.id) {
    return NextResponse.json(
      { error: 'Anda tidak dapat menghapus akun yang sedang digunakan.' },
      { status: 400 }
    );
  }

  const target = getUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'User tidak ditemukan.' }, { status: 404 });
  }

  try {
    const ownedServers = listAllServers().filter((s) => s.ownerId === id);
    for (const srv of ownedServers) {
      await stopServerProcess(srv.id, true);
      await deleteServerRecord(srv.id);
    }

    await deleteUserRecord(id);
    return NextResponse.json({ ok: true, deletedServers: ownedServers.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menghapus user.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
