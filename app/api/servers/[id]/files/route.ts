import { NextRequest, NextResponse } from 'next/server';
import {
  archiveServerEntries,
  createServerEntry,
  deleteServerEntry,
  extractZipFile,
  listServerFiles,
  moveServerEntry,
  readServerFile,
  renameServerEntry,
  writeServerFile,
} from '@/lib/files';
import { emitFilesChanged } from '@/lib/events';
import { requireServerAccess } from '@/lib/guards';

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
      action: 'write' | 'create' | 'rename' | 'extract' | 'move' | 'archive' | 'moveMany' | 'deleteMany';
      path?: string;
      paths?: string[];
      currentDir?: string;
      targetDir?: string;
      content?: string;
      encoding?: 'utf8' | 'base64';
      entryType?: 'file' | 'directory';
      newPath?: string;
    };

    if (body.action === 'write') {
      writeServerFile(
        id,
        body.path || '',
        body.content ?? '',
        body.encoding === 'base64' ? 'base64' : 'utf8'
      );
      emitFilesChanged(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'create') {
      createServerEntry(id, body.path || '', body.entryType === 'directory' ? 'directory' : 'file');
      emitFilesChanged(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'rename') {
      renameServerEntry(id, body.path || '', body.newPath || '');
      emitFilesChanged(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'extract') {
      extractZipFile(id, body.path || '');
      emitFilesChanged(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'move') {
      moveServerEntry(id, body.path || '', body.newPath || '');
      emitFilesChanged(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'archive') {
      const targetPaths = Array.isArray(body.paths)
        ? body.paths
        : body.path
        ? [body.path]
        : [];
      const archivePath = archiveServerEntries(id, targetPaths, body.currentDir || '');
      emitFilesChanged(id);
      return NextResponse.json({ ok: true, archivePath });
    }

    if (body.action === 'moveMany') {
      const targetPaths = Array.isArray(body.paths) ? body.paths : [];
      if (targetPaths.length === 0) {
        return NextResponse.json({ error: 'Tidak ada item yang dipilih.' }, { status: 400 });
      }
      const cleanDir = (body.targetDir || '').replace(/^\/+|\/+$/g, '');
      for (const itemPath of targetPaths) {
        const baseName = itemPath.split('/').pop() || itemPath;
        const destPath = cleanDir ? `${cleanDir}/${baseName}` : baseName;
        moveServerEntry(id, itemPath, destPath);
      }
      emitFilesChanged(id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'deleteMany') {
      const targetPaths = Array.isArray(body.paths) ? body.paths : [];
      if (targetPaths.length === 0) {
        return NextResponse.json({ error: 'Tidak ada item yang dipilih.' }, { status: 400 });
      }
      for (const itemPath of targetPaths) {
        deleteServerEntry(id, itemPath);
      }
      emitFilesChanged(id);
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
    emitFilesChanged(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menghapus target.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
