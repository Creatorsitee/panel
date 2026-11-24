import { NextRequest, NextResponse } from 'next/server';
import {
  createServerEntry,
  deleteServerEntry,
  extractZipFile,
  listServerFiles,
  moveServerEntry,
  readServerFile,
  renameServerEntry,
  writeServerFile,
} from '@/lib/file-manager';
import { requireServerAccess } from '@/lib/route-guard';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'list';
    const targetPath = searchParams.get('path') || '';

    if (mode === 'read') {
      const file = readServerFile(id, targetPath);
      return NextResponse.json({ path: targetPath, ...file });
    }

    const entries = listServerFiles(id, targetPath);
    return NextResponse.json({ path: targetPath, entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal membaca file.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const body = (await req.json()) as {
      action: 'write' | 'create' | 'rename' | 'extract' | 'move';
      path: string;
      content?: string;
      encoding?: 'utf8' | 'base64';
      entryType?: 'file' | 'directory';
      newPath?: string;
    };

    if (body.action === 'write') {
      writeServerFile(
        id,
        body.path,
        body.content ?? '',
        body.encoding === 'base64' ? 'base64' : 'utf8'
      );
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'create') {
      createServerEntry(id, body.path, body.entryType === 'directory' ? 'directory' : 'file');
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'rename') {
      renameServerEntry(id, body.path, body.newPath || '');
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'extract') {
      extractZipFile(id, body.path);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'move') {
      moveServerEntry(id, body.path, body.newPath || '');
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Aksi file tidak valid.' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memproses file.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const access = requireServerAccess(req, id);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(req.url);
    const targetPath = searchParams.get('path') || '';
    deleteServerEntry(id, targetPath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menghapus target.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
