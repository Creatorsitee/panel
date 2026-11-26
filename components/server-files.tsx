'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  FileArchive,
  FileCode2,
  FilePlus2,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Move,
  Pencil,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { usePanel } from './panel-shell';
import { FileEditorSkeleton, FileManagerSkeleton } from './skeletons';
import { isEditableTextFile } from '@/lib/file-types';
import { resolveCodeLanguage } from '@/lib/code-language';
import CodeEditor from './code-editor';
import {
  showConfirmDialog,
  showErrorAlert,
  showSuccessToast,
  showWarningAlert,
} from '@/lib/alerts';
import type { FileEntry } from '@/lib/types';

interface ServerFilesTabProps {
  serverId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isSystemIgnoredDir(entry: FileEntry): boolean {
  return (
    entry.type === 'directory' &&
    (entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '__pycache__' ||
      entry.name === '.venv' ||
      entry.name === '.py_packages')
  );
}

export default function ServerFilesTab({ serverId }: ServerFilesTabProps) {
  const { filesVersionByServer } = usePanel();
  const filesVersion = filesVersionByServer[serverId] || 0;

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

  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  } | null>(null);

  const [moveModalPaths, setMoveModalPaths] = useState<string[] | null>(null);
  const [newDestPath, setNewDestPath] = useState('');

  const [renameModalPath, setRenameModalPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const currentDirRef = useRef(currentDir);

  useEffect(() => {
    currentDirRef.current = currentDir;
  }, [currentDir]);

  const loadDirectory = useCallback(
    async (dirPath: string, options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoadingList(true);
      }
      try {
        const res = await apiFetch<{ path: string; entries: FileEntry[] }>(
          `/api/servers/${serverId}/files?mode=list&path=${encodeURIComponent(dirPath)}`
        );
        setEntries(res.entries);
        setCurrentDir(dirPath);
        const existingSet = new Set(res.entries.map((item) => item.path));
        setSelectedPaths((prev) => prev.filter((p) => existingSet.has(p)));
      } catch (err) {
        if (!options.silent) {
          await showErrorAlert(
            'Gagal Memuat Direktori',
            err instanceof Error ? err.message : 'Gagal memuat daftar file.'
          );
        }
      } finally {
        if (!options.silent) {
          setLoadingList(false);
        }
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
          setSelectedPaths([]);
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
    if (filesVersion === 0) return;
    void loadDirectory(currentDirRef.current, { silent: true });
  }, [filesVersion, loadDirectory]);

  useEffect(() => {
    if (!activeMenuPath && !newEntryType && !moveModalPaths && !renameModalPath) return;
    const closeMenu = () => {
      setActiveMenuPath(null);
      setMenuPosition(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
        setNewEntryType(null);
        setMoveModalPaths(null);
        setRenameModalPath(null);
      }
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, { passive: true });
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu);
      window.removeEventListener('keydown', handleKey);
    };
  }, [activeMenuPath, newEntryType, moveModalPaths, renameModalPath]);

  const selectableEntries = useMemo(
    () => entries.filter((entry) => !isSystemIgnoredDir(entry)),
    [entries]
  );

  const allSelectableChecked =
    selectableEntries.length > 0 &&
    selectableEntries.every((entry) => selectedPaths.includes(entry.path));

  function toggleSelectPath(entryPath: string) {
    setSelectedPaths((prev) =>
      prev.includes(entryPath) ? prev.filter((p) => p !== entryPath) : [...prev, entryPath]
    );
  }

  function toggleSelectAll() {
    if (allSelectableChecked) {
      setSelectedPaths([]);
    } else {
      setSelectedPaths(selectableEntries.map((entry) => entry.path));
    }
  }

  async function openFile(filePath: string) {
    if (!isEditableTextFile(filePath)) {
      await showWarningAlert(
        'Format Tidak Didukung',
        `File "${filePath}" adalah format arsip, paket, foto, atau biner dan tidak dapat diedit sebagai teks.`
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
      void loadDirectory(currentDir, { silent: true });
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
      if (createdType === 'file' && isEditableTextFile(fullPath)) {
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
      setSelectedPaths((prev) => prev.filter((p) => p !== entryPath));
      void showSuccessToast('Berhasil dihapus', entryPath);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus',
        err instanceof Error ? err.message : 'Gagal menghapus item.'
      );
    }
  }

  async function handleRenameEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!renameModalPath || !renameValue.trim()) return;
    const trimmed = renameValue.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed || trimmed.includes('/')) {
      await showErrorAlert('Nama Tidak Valid', 'Masukkan nama file/folder baru tanpa garis miring (/).');
      return;
    }

    const parentParts = renameModalPath.split('/');
    parentParts.pop();
    const newPath = parentParts.length > 0 ? `${parentParts.join('/')}/${trimmed}` : trimmed;

    try {
      await apiFetch(`/api/servers/${serverId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'rename',
          path: renameModalPath,
          newPath,
        }),
      });
      if (selectedFile === renameModalPath) {
        setSelectedFile(newPath);
      }
      setSelectedPaths((prev) =>
        prev.map((p) => (p === renameModalPath ? newPath : p))
      );
      setRenameModalPath(null);
      setRenameValue('');
      void showSuccessToast('Berhasil diganti nama', newPath);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Mengganti Nama',
        err instanceof Error ? err.message : 'Gagal mengganti nama item.'
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

  async function handleArchivePaths(targetPaths: string[]) {
    setActiveMenuPath(null);
    if (targetPaths.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; archivePath: string }>(
        `/api/servers/${serverId}/files`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'archive',
            paths: targetPaths,
            currentDir,
          }),
        }
      );
      setSelectedPaths([]);
      void showSuccessToast('Arsip ZIP dibuat', res.archivePath);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Mengarsipkan',
        err instanceof Error ? err.message : 'Gagal membuat arsip ZIP.'
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedPaths.length === 0) return;
    const confirmed = await showConfirmDialog({
      title: `Hapus ${selectedPaths.length} item terpilih?`,
      text: 'Seluruh file dan folder yang dipilih akan dihapus permanen.',
      confirmText: 'Ya, Hapus Semua',
      cancelText: 'Batal',
      destructive: true,
    });
    if (!confirmed) return;

    setBulkBusy(true);
    try {
      await apiFetch(`/api/servers/${serverId}/files`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'deleteMany',
          paths: selectedPaths,
        }),
      });
      if (selectedFile && selectedPaths.includes(selectedFile)) {
        setSelectedFile(null);
        setFileContent('');
        setSavedContent('');
      }
      const deletedCount = selectedPaths.length;
      setSelectedPaths([]);
      void showSuccessToast('Berhasil dihapus', `${deletedCount} item dihapus.`);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Menghapus Item',
        err instanceof Error ? err.message : 'Gagal menghapus item terpilih.'
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleMoveEntries(e: React.FormEvent) {
    e.preventDefault();
    if (!moveModalPaths || moveModalPaths.length === 0) return;
    const destination = newDestPath.trim();

    setBulkBusy(true);
    try {
      if (moveModalPaths.length === 1) {
        if (!destination) {
          throw new Error('Path tujuan wajib diisi.');
        }
        await apiFetch(`/api/servers/${serverId}/files`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'move',
            path: moveModalPaths[0],
            newPath: destination,
          }),
        });
        void showSuccessToast('Berhasil dipindahkan', destination);
      } else {
        await apiFetch(`/api/servers/${serverId}/files`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'moveMany',
            paths: moveModalPaths,
            targetDir: destination,
          }),
        });
        void showSuccessToast(
          'Berhasil dipindahkan',
          `${moveModalPaths.length} item dipindahkan`
        );
      }
      setMoveModalPaths(null);
      setNewDestPath('');
      setSelectedPaths([]);
      await loadDirectory(currentDir);
    } catch (err) {
      await showErrorAlert(
        'Gagal Memindahkan Item',
        err instanceof Error ? err.message : 'Gagal memindahkan file/folder.'
      );
    } finally {
      setBulkBusy(false);
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

  const pathSegments = useMemo(
    () => currentDir.split('/').filter(Boolean),
    [currentDir]
  );

  const hasUnsavedChanges = selectedFile !== null && fileContent !== savedContent;

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-20 relative">
      {!selectedFile && (
        <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <nav
            aria-label="Breadcrumb direktori"
            className="flex items-center flex-wrap gap-1 text-xs font-mono min-w-0 flex-1"
          >
            <button
              type="button"
              disabled={!currentDir}
              onClick={() => {
                setSelectedPaths([]);
                void loadDirectory('');
              }}
              className={`h-7 px-2 rounded inline-flex items-center font-semibold transition-colors shrink-0 ${
                currentDir
                  ? 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 cursor-pointer'
                  : 'text-zinc-900 dark:text-zinc-100 cursor-default'
              }`}
              title="Direktori root"
            >
              /
            </button>
            {pathSegments.map((segment, idx) => {
              const targetPath = pathSegments.slice(0, idx + 1).join('/');
              const isLast = idx === pathSegments.length - 1;
              return (
                <React.Fragment key={targetPath}>
                  {idx > 0 && <span className="text-zinc-400 select-none">/</span>}
                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => {
                      setSelectedPaths([]);
                      void loadDirectory(targetPath);
                    }}
                    className={`h-7 px-1.5 rounded inline-flex items-center truncate max-w-[160px] sm:max-w-[220px] transition-colors ${
                      isLast
                        ? 'text-zinc-900 dark:text-zinc-100 font-semibold cursor-default'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 cursor-pointer'
                    }`}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          <input
            ref={uploadInputRef}
            type="file"
            multiple
            onChange={handleUploadFiles}
            className="hidden"
            aria-label="Upload file"
          />

          <div className="grid grid-cols-3 sm:flex sm:items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setNewEntryType('file');
                setNewEntryName('');
              }}
              className="h-8 px-2 sm:px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap min-w-0 transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">File Baru</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setNewEntryType('directory');
                setNewEntryName('');
              }}
              className="h-8 px-2 sm:px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap min-w-0 transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Folder Baru</span>
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
              className="h-8 px-2 sm:px-3 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 text-[11px] sm:text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap min-w-0 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{uploading ? 'Upload...' : 'Upload'}</span>
            </button>
          </div>
        </div>
      )}

      {newEntryType && (
        <form
          onSubmit={handleCreateEntry}
          className="p-3 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="new-entry-name-input"
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              {newEntryType === 'file' ? 'Nama file:' : 'Nama folder:'}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="new-entry-name-input"
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
            </div>
          </div>
        </form>
      )}

      {renameModalPath && (
        <form
          onSubmit={handleRenameEntry}
          onClick={(e) => e.stopPropagation()}
          className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 space-y-3"
        >
          <div className="text-xs font-semibold">
            Ganti Nama &quot;{renameModalPath}&quot;
          </div>
          <input
            type="text"
            required
            autoFocus
            aria-label="Nama baru"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="nama-baru.ext"
            className="w-full h-8 px-2.5 rounded bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-xs font-mono focus:outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="h-8 px-3 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer"
            >
              Simpan Nama
            </button>
            <button
              type="button"
              onClick={() => setRenameModalPath(null)}
              className="h-8 px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-xs cursor-pointer"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      {moveModalPaths && moveModalPaths.length > 0 && (
        <form
          onSubmit={handleMoveEntries}
          onClick={(e) => e.stopPropagation()}
          className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 space-y-3"
        >
          <div className="text-xs font-semibold">
            {moveModalPaths.length === 1
              ? `Pindahkan "${moveModalPaths[0]}"`
              : `Pindahkan ${moveModalPaths.length} item ke direktori tujuan`}
          </div>
          <input
            type="text"
            required={moveModalPaths.length === 1}
            autoFocus
            aria-label="Path tujuan"
            value={newDestPath}
            onChange={(e) => setNewDestPath(e.target.value)}
            placeholder={
              moveModalPaths.length === 1
                ? 'path/baru/nama-file-atau-folder'
                : 'folder-tujuan (kosongkan untuk root /)'
            }
            className="w-full h-8 px-2.5 rounded bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 text-xs font-mono focus:outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={bulkBusy}
              className="h-8 px-3 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium cursor-pointer disabled:opacity-50"
            >
              Pindahkan
            </button>
            <button
              type="button"
              onClick={() => setMoveModalPaths(null)}
              className="h-8 px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-xs cursor-pointer"
            >
              Batal
            </button>
          </div>
        </form>
      )}

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

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/70 text-[10px] font-mono text-zinc-400">
                {resolveCodeLanguage(selectedFile).name}
              </span>
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
          </div>

          {loadingFile ? (
            <FileEditorSkeleton />
          ) : (
            <CodeEditor
              filename={selectedFile}
              value={fileContent}
              onChange={setFileContent}
              onSave={() => {
                if (hasUnsavedChanges && !saving) {
                  void saveCurrentFile();
                }
              }}
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
            <>
              {selectableEntries.length > 0 && (
                <div className="px-3 sm:px-4 py-2 bg-zinc-50/80 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500">
                  <label className="inline-flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allSelectableChecked}
                      onChange={toggleSelectAll}
                      aria-label="Pilih semua item"
                      className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100 cursor-pointer"
                    />
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">
                      {selectedPaths.length > 0
                        ? `${selectedPaths.length} dipilih`
                        : `${entries.length} item`}
                    </span>
                  </label>
                </div>
              )}

              <div
                onScroll={() => {
                  if (activeMenuPath) {
                    setActiveMenuPath(null);
                    setMenuPosition(null);
                  }
                }}
                className="divide-y divide-zinc-100 dark:divide-zinc-800/70 overflow-y-auto max-h-[560px]"
              >
                {entries.map((entry) => {
                  const isZip = entry.name.toLowerCase().endsWith('.zip');
                  const isDir = entry.type === 'directory';
                  const isIgnored = isSystemIgnoredDir(entry);
                  const canEdit = !isDir && isEditableTextFile(entry.name);
                  const isChecked = selectedPaths.includes(entry.path);

                  return (
                    <div
                      key={entry.path}
                      className={`px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-3 text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60 relative ${
                        isChecked ? 'bg-zinc-100/70 dark:bg-zinc-900/80' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          disabled={isIgnored}
                          checked={isChecked}
                          onChange={() => toggleSelectPath(entry.path)}
                          aria-label={`Pilih ${entry.name}`}
                          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                        />

                        <button
                          type="button"
                          disabled={isIgnored}
                          onClick={() => {
                            if (isDir) {
                              setSelectedPaths([]);
                              void loadDirectory(entry.path);
                            } else {
                              void openFile(entry.path);
                            }
                          }}
                          className="flex-1 flex items-center gap-2.5 text-left min-w-0 py-0.5 cursor-pointer disabled:opacity-50"
                        >
                          {isDir ? (
                            <Folder className="w-4 h-4 text-zinc-500 dark:text-zinc-400 shrink-0" />
                          ) : isZip ? (
                            <FileArchive className="w-4 h-4 text-zinc-600 dark:text-zinc-300 shrink-0" />
                          ) : (
                            <FileCode2 className="w-4 h-4 text-zinc-400 shrink-0" />
                          )}
                          <span
                            className={`font-mono truncate ${
                              isDir || canEdit
                                ? 'font-medium text-zinc-900 dark:text-zinc-100'
                                : 'text-zinc-500 dark:text-zinc-400'
                            }`}
                          >
                            {entry.name}
                          </span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        {entry.type === 'file' && (
                          <span className="text-[11px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500 hidden sm:inline">
                            {formatBytes(entry.size)}
                          </span>
                        )}

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
                                window.innerHeight - rect.bottom < 210 && rect.top > 210;
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
                            aria-label={`Menu aksi ${entry.name}`}
                            aria-haspopup="menu"
                            aria-expanded={activeMenuPath === entry.path}
                            className="w-8 h-8 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <MoreHorizontal className="w-4 h-4" />
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
                              className="w-44 rounded-md shadow-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 py-1 z-50 text-xs"
                            >
                              {!isIgnored && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setActiveMenuPath(null);
                                    setRenameModalPath(entry.path);
                                    setRenameValue(entry.name);
                                  }}
                                  className="w-full px-3 py-2 text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                                  <span>Ganti Nama</span>
                                </button>
                              )}

                              {!isIgnored && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setActiveMenuPath(null);
                                    setMoveModalPaths([entry.path]);
                                    setNewDestPath(entry.path);
                                  }}
                                  className="w-full px-3 py-2 text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                                >
                                  <Move className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                                  <span>Pindahkan</span>
                                </button>
                              )}

                              {isZip && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleExtractZip(entry.path)}
                                  className="w-full px-3 py-2 text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                                >
                                  <FileArchive className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                                  <span>Ekstrak ZIP</span>
                                </button>
                              )}

                              {!isIgnored && !isZip && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleArchivePaths([entry.path])}
                                  className="w-full px-3 py-2 text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 cursor-pointer"
                                >
                                  <FileArchive className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                                  <span>Arsipkan (.zip)</span>
                                </button>
                              )}

                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleDeleteEntry(entry.path)}
                                className="w-full px-3 py-2 text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Hapus</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {!selectedFile && selectedPaths.length > 0 && (
        <div className="sticky bottom-4 z-30 flex justify-center pointer-events-none">
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-white/95 dark:bg-zinc-900/95 backdrop-blur border border-zinc-200 dark:border-zinc-700 shadow-2xl">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                setMoveModalPaths(selectedPaths);
                setNewDestPath(currentDir);
              }}
              className="h-8 px-3 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-opacity"
            >
              <Move className="w-3.5 h-3.5 shrink-0" />
              <span>Move</span>
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => handleArchivePaths(selectedPaths)}
              className="h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <FileArchive className="w-3.5 h-3.5 shrink-0" />
              <span>Archive</span>
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={handleBulkDelete}
              className="h-8 px-3 rounded-md border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-50 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
