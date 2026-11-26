'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, setAuthToken } from '@/lib/api';
import { useThemeMode } from '@/lib/theme';
import { showErrorAlert, showSuccessToast } from '@/lib/alerts';
import type { PublicUser } from '@/lib/types';

interface AuthScreenProps {
  initialMode?: 'login' | 'register';
  onAuthenticated?: (user: PublicUser) => void;
}

function getSafeNextPath(): string {
  if (typeof window === 'undefined') return '/';
  try {
    const nextParam = new URLSearchParams(window.location.search).get('next');
    if (nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')) {
      return nextParam;
    }
  } catch {

  }
  return '/';
}

export default function AuthScreen({
  initialMode = 'login',
  onAuthenticated,
}: AuthScreenProps) {
  const router = useRouter();
  useThemeMode();

  const mode = initialMode;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const safeNext = getSafeNextPath();
    let active = true;
    async function checkExistingSession() {
      try {
        const res = await apiFetch<{ user: PublicUser | null }>('/api/auth/me');
        if (active && res.user) {
          if (onAuthenticated) {
            onAuthenticated(res.user);
          } else {
            router.replace(safeNext);
          }
        }
      } catch {

      }
    }
    void checkExistingSession();
    return () => {
      active = false;
    };
  }, [onAuthenticated, router]);

  function navigateAuthMode(targetPath: '/login' | '/register', e: React.MouseEvent<HTMLAnchorElement>) {
    const safeNext = getSafeNextPath();
    if (safeNext !== '/') {
      e.preventDefault();
      router.replace(`${targetPath}?next=${encodeURIComponent(safeNext)}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login' ? { email, password } : { name, email, password };

      const data = await apiFetch<{ user: PublicUser; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAuthToken(data.token);
      void showSuccessToast(
        mode === 'login' ? 'Berhasil masuk' : 'Akun berhasil dibuat',
        `Selamat datang, ${data.user.name}`
      );
      if (onAuthenticated) {
        onAuthenticated(data.user);
      } else {
        router.replace(getSafeNextPath());
      }
    } catch (err) {
      await showErrorAlert(
        mode === 'login' ? 'Gagal Masuk' : 'Gagal Mendaftar',
        err instanceof Error ? err.message : 'Autentikasi gagal.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#09090B] text-zinc-950 dark:text-zinc-100 flex flex-col justify-between px-4 py-8">
      <header className="max-w-sm w-full mx-auto pt-4 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">cmnty</span>
        <span className="text-xs font-mono text-zinc-500">node · python</span>
      </header>

      <main className="max-w-sm w-full mx-auto my-auto py-12">
        <div className="mb-7">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'login' ? 'Masuk ke panel' : 'Buat akun baru'}
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {mode === 'login'
              ? 'Masuk untuk mengelola instance, konsol, dan metrik server Anda.'
              : 'Buat akun untuk mengelola deployment dan runtime server Anda.'}
          </p>
        </div>

        <div
          className="flex items-center gap-6 border-b border-zinc-200 dark:border-zinc-800 mb-6"
          role="tablist"
          aria-label="Mode autentikasi"
        >
          <Link
            href="/login"
            onClick={(e) => navigateAuthMode('/login', e)}
            role="tab"
            aria-selected={mode === 'login'}
            className={`pb-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
            }`}
          >
            Masuk
          </Link>
          <Link
            href="/register"
            onClick={(e) => navigateAuthMode('/register', e)}
            role="tab"
            aria-selected={mode === 'register'}
            className={`pb-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              mode === 'register'
                ? 'border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
            }`}
          >
            Daftar Akun
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <label
                htmlFor="auth-name"
                className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Nama Lengkap
              </label>
              <input
                id="auth-name"
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Masukkan nama lengkap"
                className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="auth-email"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@domain.com"
              className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-password"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
              className="w-full h-9 px-3 rounded-md bg-transparent border border-zinc-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-zinc-950 dark:focus:border-zinc-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 px-4 rounded-md bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 disabled:opacity-50 text-xs font-medium transition-opacity cursor-pointer"
          >
            {loading
              ? 'Memproses...'
              : mode === 'login'
              ? 'Masuk'
              : 'Buat Akun'}
          </button>
        </form>
      </main>

      <footer className="max-w-sm w-full mx-auto pb-2 text-[11px] text-zinc-500 font-mono">
        Self-hosted Server
      </footer>
    </div>
  );
}
