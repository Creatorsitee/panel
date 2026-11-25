'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  FileCode2,
  FilePlus2,
  Folder,
  FolderPlus,
  MoreVertical,
  Move,
  Save,
  Trash2,
  Upload,
  FileArchive,
  ArrowLeft,
} from 'lucide-react';
import { apiFetch } from './api-client';
import { FileEditorSkeleton, FileManagerSkeleton } from './Skeletons';
import {
  showConfirmDialog,
  showErrorAlert,
  showSuccessToast,
  showWarningAlert,
} from '@/lib/swal';
import type { FileEntry } from '@/lib/types';

interface ServerFilesTabProps {
  serverId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const TEXT_FILE_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.mjs',
  '.cjs',
  '.py',
  '.json',
  '.env',
  '.txt',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.sh',
  '.ini',
  '.cfg',
]);

function isEditableFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower === '.env' || lower === 'dockerfile' || lower === 'requirements.txt') return true;
  const idx = lower.lastIndexOf('.');
  if (idx === -1) return false;
  const ext = lower.slice(idx);
  return TEXT_FILE_EXTENSIONS.has(ext);
}

export default function ServerFilesTab({ serverId }: ServerFilesTabProps) {
  const [currentDir, setCurrentDir] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [newEntryName, setNewEntryName] = useState('');
  const [newEntryType, setNewEntryType] = useState<'file' | 'directory' | null>(null);
  const [uploading, setUploading] = useState(false);

  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  } | null>(null);
  const [moveModalPath, setMoveModalPath] = useState<string | null>(null);
  const [newDestPath, setNewDestPath] = useState('');

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(
    async (dirPath: string) => {
      setLoadingList(true);
      try {
        const res = await apiFetch<{ path: string; entries: FileEntry[] }>(
          `/api/servers/${serverId}/files?mode=list&path=${encodeURIComponent(dirPath)}`
        );
        setEntries(res.entries);
        setCurrentDir(dirPath);
      } catch (err) {
        await showErrorAlert(
          'Gagal Memuat Direktori',
          err instanceof Error ? err.message : 'Gagal memuat daftar file.'
        );
      } finally {
        setLoadingList(false);
      }
    },
    [serverId]
  );

  useEffect(() => {
    let active = true;
    async function init() {
      setLoadingList(true);
      try {
        const res = await apiFetch<{ path: string; entries: FileEntry[] }>(
          `/api/servers/${serverId}/files?mode=list&path=`
        );
        if (active) {
          setEntries(res.entries);
          setCurrentDir('');
        }
      } catch (err) {
        if (active) {
          await showErrorAlert(
            'Gagal Memuat File',
            err instanceof Error ? err.message : 'Gagal memuat daftar file.'
          );
        }
      } finally {
        if (active) setLoadingList(false);
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [serverId]);

  useEffect(() => {
    if (!activeMenuPath && !newEntryType && !moveModalPath) return;
    const closeMenu = () => {
      setActiveMenuPath(null);
      setMenuPosition(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
        setNewEntryType(null);
        setMoveModalPath(null);
      }
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('keydown', handleKey);
    };
  }, [activeMenuPath, newEntryType, moveModalPath]);

  async function openFile(filePath: string) {
    if (!isEditableFile(filePath)) {
      await showWarningAlert(
        'Format Tidak Didukung',
        `File "${filePath}" adalah format biner/arsip dan tidak dapat diedit sebagai teks.`
      );
      return;
    }
    setSelectedFile(filePath);
    setLoadingFile(true);
    try {
      const res = await apiFetch<{ content: string }>(
        `/api/servers/${serverId}/files?mode=read&path=${encodeURIComponent(filePath)}`
      );
      setFileContent(res.content);
      setSavedContent(res.content);
    } catch (err) {
      setSelectedFile(null);
      await showErrorAlert(
        'Gagal Membuka File',
        err instanceof Error ? err.message : 'Gagal membuka file.'
      );
    } finally {
      setLoadingFile(false);
    }
  }

  async function saveCurrentFile() {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await apiFetch(`/api/servers/${serverId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'write',
          path: selectedFile,
          content: fileContent,
        }),
      });
      setSavedContent(fileContent);
      void showSuccessToast('File disimpan', selectedFile);
      setSelectedFile(null);
      setFileContent('');
      setSavedContent('');
      void loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menyimpan File',
        err instanceof Error ? err.message : 'Gagal menyimpan file.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!newEntryName.trim() || !newEntryType) return;
    const fullPath = currentDir
      ? `${currentDir}/${newEntryName.trim()}`
      : newEntryName.trim();

    try {
      await apiFetch(`/api/servers/${serverId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          path: fullPath,
          entryType: newEntryType,
        }),
      });
      setNewEntryName('');
      const createdType = newEntryType;
      setNewEntryType(null);
      void showSuccessToast(
        createdType === 'file' ? 'File dibuat' : 'Folder dibuat',
        fullPath
      );
      await loadDirectory(currentDir);
      if (createdType === 'file') {
        void openFile(fullPath);
      }
    } catch (err) {
      await showErrorAlert(
        'Gagal Membuat Item',
        err instanceof Error ? err.message : 'Gagal membuat item.'
      );
    }
  }

  async function handleDeleteEntry(entryPath: string) {
    setActiveMenuPath(null);
    const confirmed = await showConfirmDialog({
      title: `Hapus "${entryPath}"?`,
      text: 'Item yang dihapus tidak dapat dikembalikan.',
      confirmText: 'Ya, Hapus',
      cancelText: 'Batal',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await apiFetch(
        `/api/servers/${serverId}/files?path=${encodeURIComponent(entryPath)}`,
        { method: 'DELETE' }
      );
      if (selectedFile === entryPath) {
        setSelectedFile(null);
        setFileContent('');
        setSavedContent('');
      }
      void showSuccessToast('Berhasil dihapus', entryPath);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus',
        err instanceof Error ? err.message : 'Gagal menghapus item.'
      );
    }
  }

  async function handleExtractZip(entryPath: string) {
    setActiveMenuPath(null);
    try {
      await apiFetch(`/api/servers/${serverId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'extract',
          path: entryPath,
        }),
      });
      void showSuccessToast('Arsip ZIP diekstrak', entryPath);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Mengekstrak ZIP',
        err instanceof Error ? err.message : 'Gagal mengekstrak ZIP.'
      );
    }
  }

  async function handleMoveEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!moveModalPath || !newDestPath.trim()) return;
    const destination = newDestPath.trim();
    try {
      await apiFetch(`/api/servers/${serverId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'move',
          path: moveModalPath,
          newPath: destination,
        }),
      });
      void showSuccessToast('Berhasil dipindahkan', destination);
      setMoveModalPath(null);
      setNewDestPath('');
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Memindahkan Item',
        err instanceof Error ? err.message : 'Gagal memindahkan file/folder.'
      );
    }
  }

  async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function handleUploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let uploadedCount = 0;

    try {
      for (const file of Array.from(fileList)) {
        if (file.size > 2 * 1024 * 1024) {
          throw new Error(`File "${file.name}" melebihi batas 2 MB.`);
        }
        const content = await fileToBase64(file);
        const targetPath = currentDir ? `${currentDir}/${file.name}` : file.name;
        await apiFetch(`/api/servers/${serverId}/files`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'write',
            path: targetPath,
            content,
            encoding: 'base64',
          }),
        });
        uploadedCount += 1;
      }
      void showSuccessToast('Upload selesai', `${uploadedCount} file berhasil diunggah.`);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Mengunggah File',
        err instanceof Error ? err.message : 'Gagal mengunggah file.'
      );
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function navigateUp() {
    if (!currentDir) return;
    const parts = currentDir.split('/');
    parts.pop();
    void loadDirectory(parts.join('/'));
  }

  const hasUnsavedChanges = selectedFile !== null && fileContent !== savedContent;

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      {/* File Manager Toolbar */}
      {!selectedFile && (
        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 text-xs font-mono min-w-0 flex-1">
            <button
              type="button"
              disabled={!currentDir}
              onClick={navigateUp}
              className="h-8 px-2.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Naik</span>
            </button>
            <span className="text-zinc-500 dark:text-zinc-400 font-semibold truncate">
              /{currentDir}
            </span>
          </div>

          <input
            ref={uploadInputRef}
            type="file"
            multiple
            onChange={handleUploadFiles}
            className="hidden"
            aria-label="Upload file"
          />

          <div className="grid grid-cols-3 sm:flex sm:items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setNewEntryType('file');
                setNewEntryName('');
              }}
              className="h-8 px-2.5 sm:px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
              <span>File Baru</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewEntryType('directory');
                setNewEntryName('');
              }}
              className="h-8 px-2.5 sm:px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 shrink-0" />
              <span>Folder Baru</span>
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
              className="h-8 px-2.5 sm:px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span>{uploading ? 'Upload...' : 'Upload'}</span>
            </button>
          </div>
        </div>
      )}

      {newEntryType && (
        <form
          onSubmit={handleCreateEntry}
          className="p-3 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-medium">
            {newEntryType === 'file' ? 'Nama file:' : 'Nama folder:'}
          </span>
          <input
            type="text"
            required
            autoFocus
            value={newEntryName}
            onChange={(e) => setNewEntryName(e.target.value)}
            placeholder={newEntryType === 'file' ? 'app.js' : 'src'}
            className="flex-1 min-w-[180px] h-8 px-2.5 rounded bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-xs font-mono focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            className="h-8 px-3 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
          >
            Buat
          </button>
          <button
            type="button"
            onClick={() => setNewEntryType(null)}
            className="h-8 px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-xs cursor-pointer"
          >
            Batal
          </button>
        </form>
      )}

      {/* Move Modal */}
      {moveModalPath && (
        <form
          onSubmit={handleMoveEntry}
          className="p-4 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 space-y-3"
        >
          <div className="text-xs font-semibold">Pindahkan atau Ganti Path &quot;{moveModalPath}&quot;</div>
          <input
            type="text"
            required
            autoFocus
            value={newDestPath}
            onChange={(e) => setNewDestPath(e.target.value)}
            placeholder="path/baru/nama-folder"
            className="w-full h-8 px-2.5 rounded bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-xs font-mono focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="h-8 px-3 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
            >
              Pindahkan
            </button>
            <button
              type="button"
              onClick={() => setMoveModalPath(null)}
              className="h-8 px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-xs cursor-pointer"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      {/* Full Card View when File is Selected vs File List */}
      {selectedFile ? (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-[#09090B] flex flex-col shadow-xl">
          <div className="px-3 sm:px-4 py-2.5 bg-[#141820] border-b border-zinc-800 flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono text-zinc-300 min-w-0 flex-1">
              <button
                type="button"
                onClick={async () => {
                  if (hasUnsavedChanges) {
                    const discard = await showConfirmDialog({
                      title: 'Perubahan belum disimpan',
                      text: `Tutup "${selectedFile}" tanpa menyimpan perubahan?`,
                      confirmText: 'Ya, Tutup',
                      cancelText: 'Batal',
                      destructive: true,
                    });
                    if (!discard) return;
                  }
                  setSelectedFile(null);
                }}
                className="text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1 cursor-pointer shrink-0"
                title="Kembali ke Daftar File"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali</span>
              </button>
              <span className="text-zinc-600 shrink-0">/</span>
              <span className="font-semibold text-zinc-200 truncate">
                {selectedFile}
                {hasUnsavedChanges ? ' *' : ''}
              </span>
            </div>

            <button
              type="button"
              disabled={saving || loadingFile || !hasUnsavedChanges}
              onClick={saveCurrentFile}
              className="h-7 px-3 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0"
            >
              <Save className="w-3 h-3" />
              <span>{saving ? 'Menyimpan...' : 'Simpan'}</span>
            </button>
          </div>

          {loadingFile ? (
            <FileEditorSkeleton />
          ) : (
            <textarea
              aria-label={`Editor kode untuk ${selectedFile}`}
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                  e.preventDefault();
                  if (hasUnsavedChanges) saveCurrentFile();
                }
              }}
              spellCheck={false}
              className="w-full flex-1 min-h-[380px] sm:min-h-[520px] p-3 sm:p-4 bg-[#09090B] text-zinc-100 font-mono text-xs leading-relaxed focus:outline-none resize-none"
            />
          )}
        </div>
      ) : (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0c0c0e] flex flex-col shadow-sm">
          {loadingList ? (
            <FileManagerSkeleton />
          ) : entries.length === 0 ? (
            <div className="p-8 text-xs text-zinc-500 text-center">Direktori ini masih kosong.</div>
          ) : (
            <div
              onScroll={() => {
                if (activeMenuPath) {
                  setActiveMenuPath(null);
                  setMenuPosition(null);
                }
              }}
              className="divide-y divide-zinc-100 dark:divide-zinc-800/60 overflow-y-auto max-h-[520px]"
            >
              {entries.map((entry) => {
                const isZip = entry.name.toLowerCase().endsWith('.zip');
                const isDir = entry.type === 'directory';
                const isIgnored =
                  entry.name === 'node_modules' ||
                  entry.name === '.git' ||
                  entry.name === '__pycache__' ||
                  entry.name === '.venv' ||
                  entry.name === '.py_packages';

                const canEdit = isEditableFile(entry.name);

                return (
                  <div
                    key={entry.path}
                    className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-3 text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60 relative border-l-2 border-l-transparent hover:border-l-zinc-500"
                  >
                    <button
                      type="button"
                      disabled={isIgnored && isDir}
                      onClick={() => {
                        if (isDir) {
                          loadDirectory(entry.path);
                        } else {
                          openFile(entry.path);
                        }
                      }}
                      className="flex-1 flex items-center gap-2.5 text-left min-w-0 py-0.5 cursor-pointer disabled:opacity-50"
                    >
                      {isDir ? (
                        <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                      ) : isZip ? (
                        <FileArchive className="w-4 h-4 text-zinc-700 dark:text-zinc-100 shrink-0" />
                      ) : (
                        <FileCode2 className="w-4 h-4 text-zinc-400 shrink-0" />
                      )}
                      <span className={`font-mono truncate ${canEdit ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'}`}>
                        {entry.name}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      {entry.type === 'file' && !isZip && (
                        <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                          {formatBytes(entry.size)}
                        </span>
                      )}

                      {/* Folder Move Button */}
                      {isDir && !isIgnored && (
                        <button
                          type="button"
                          onClick={() => {
                            setMoveModalPath(entry.path);
                            setNewDestPath(entry.path);
                          }}
                          aria-label={`Pindahkan ${entry.name}`}
                          title="Pindahkan Folder"
                          className="w-7 h-7 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          <Move className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* ZIP 3-Dot Menu */}
                      {isZip ? (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              if (activeMenuPath === entry.path) {
                                setActiveMenuPath(null);
                                setMenuPosition(null);
                                return;
                              }
                              const rect = ev.currentTarget.getBoundingClientRect();
                              const openUpward =
                                window.innerHeight - rect.bottom < 96 && rect.top > 96;
                              setMenuPosition(
                                openUpward
                                  ? {
                                      bottom: window.innerHeight - rect.top + 4,
                                      right: Math.max(8, window.innerWidth - rect.right),
                                    }
                                  : {
                                      top: rect.bottom + 4,
                                      right: Math.max(8, window.innerWidth - rect.right),
                                    }
                              );
                              setActiveMenuPath(entry.path);
                            }}
                            aria-label={`Opsi ZIP ${entry.name}`}
                            aria-haspopup="menu"
                            aria-expanded={activeMenuPath === entry.path}
                            className="w-7 h-7 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeMenuPath === entry.path && menuPosition && (
                            <div
                              role="menu"
                              onClick={(ev) => ev.stopPropagation()}
                              style={{
                                position: 'fixed',
                                top: menuPosition.top,
                                bottom: menuPosition.bottom,
                                right: menuPosition.right,
                              }}
                              className="w-36 rounded shadow-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 py-1 z-50 text-xs"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleExtractZip(entry.path)}
                                className="w-full px-3 py-2 text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                              >
                                <FileArchive className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-100 shrink-0" />
                                <span>Ekstrak ZIP</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleDeleteEntry(entry.path)}
                                className="w-full px-3 py-2 text-left text-red-600 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Hapus</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(entry.path)}
                          aria-label={`Hapus ${entry.name}`}
                          className="w-7 h-7 rounded flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
