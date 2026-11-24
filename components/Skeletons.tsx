'use client';

import React from 'react';

export function ShimmerBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton-shimmer rounded ${className}`} />;
}

export function HostStatsSkeleton() {
  return (
    <div
      className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <ShimmerBlock className="w-4 h-4 rounded-sm" />
          <ShimmerBlock className="h-3.5 w-36" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="space-y-2 min-w-0">
            <ShimmerBlock className="h-3 w-20 max-w-full" />
            <ShimmerBlock className="h-4 w-32 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServerCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="bg-zinc-50/80 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col justify-between"
        >
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5 flex-1">
                <ShimmerBlock className="h-3 w-24" />
                <ShimmerBlock className="h-4 w-36" />
              </div>
              <ShimmerBlock className="h-5 w-16 rounded" />
            </div>
            <div className="p-2 rounded bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80">
              <ShimmerBlock className="h-3.5 w-44" />
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <ShimmerBlock className="h-3 w-28" />
            <ShimmerBlock className="h-3.5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardContentSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Memuat dashboard server">
      <span className="sr-only">Memuat dashboard server...</span>
      <HostStatsSkeleton />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" aria-hidden="true">
        <ShimmerBlock className="h-9 w-full max-w-sm rounded" />
        <ShimmerBlock className="h-9 w-full sm:w-64 rounded" />
      </div>

      <ServerCardsSkeleton count={6} />
    </div>
  );
}

export function WorkspaceBootSkeleton() {
  return (
    <div
      className="min-h-screen bg-white dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100 flex"
      role="status"
      aria-label="Memuat panel cmnty"
    >
      <span className="sr-only">Memuat panel cmnty...</span>

      {/* Sidebar Skeleton */}
      <aside
        className="hidden lg:flex w-60 bg-zinc-50 dark:bg-[#0C0C0E] border-r border-zinc-200 dark:border-zinc-800 flex-col shrink-0"
        aria-hidden="true"
      >
        <div className="h-14 px-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
          <ShimmerBlock className="h-4 w-16" />
        </div>

        <div className="flex-1 p-3 space-y-6">
          <div className="space-y-2">
            <ShimmerBlock className="h-3 w-24 mx-3" />
            <ShimmerBlock className="h-9 w-full rounded" />
            <ShimmerBlock className="h-9 w-full rounded" />
          </div>
        </div>

        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <ShimmerBlock className="h-9 w-full rounded" />
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="space-y-1.5 flex-1">
              <ShimmerBlock className="h-3.5 w-24" />
              <ShimmerBlock className="h-3 w-32" />
            </div>
            <ShimmerBlock className="w-8 h-8 rounded" />
          </div>
        </div>
      </aside>

      {/* Main Content Skeleton */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="h-14 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-5 flex items-center justify-between gap-3 sm:gap-4"
          aria-hidden="true"
        >
          <ShimmerBlock className="h-4 w-32 sm:w-40" />
          <ShimmerBlock className="h-8 w-24 sm:w-28 rounded" />
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto">
          <DashboardContentSkeleton />
        </main>
      </div>
    </div>
  );
}

export function ConsoleLinesSkeleton() {
  const widths = ['w-72', 'w-96', 'w-64', 'w-80', 'w-56', 'w-88'];
  return (
    <div className="space-y-2.5 py-1" role="status" aria-label="Menghubungkan stream console">
      <span className="sr-only">Menghubungkan stream console...</span>
      {widths.map((w, idx) => (
        <div key={idx} className="flex items-center gap-2" aria-hidden="true">
          <ShimmerBlock className="h-3 w-24 shrink-0" />
          <ShimmerBlock className={`h-3 ${w} max-w-full`} />
        </div>
      ))}
    </div>
  );
}

export function FileManagerSkeleton() {
  const nameWidths = ['w-32', 'w-44', 'w-28', 'w-40', 'w-36', 'w-48', 'w-24', 'w-36'];
  return (
    <div
      className="divide-y divide-zinc-100 dark:divide-zinc-800/60"
      role="status"
      aria-label="Memuat daftar file"
    >
      <span className="sr-only">Memuat daftar file...</span>
      {nameWidths.map((w, idx) => (
        <div
          key={idx}
          className="px-3 sm:px-4 py-3 flex items-center justify-between gap-3"
          aria-hidden="true"
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
            <ShimmerBlock className={`h-3.5 ${w} max-w-full`} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShimmerBlock className="h-3 w-12" />
            <ShimmerBlock className="w-7 h-7 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FileEditorSkeleton() {
  const lineWidths = [
    'w-48',
    'w-72',
    'w-64',
    'w-32',
    'w-80',
    'w-96',
    'w-56',
    'w-72',
    'w-40',
    'w-64',
    'w-84',
    'w-52',
  ];
  return (
    <div
      className="p-3 sm:p-4 space-y-3 min-h-[380px] sm:min-h-[520px] bg-[#09090B]"
      role="status"
      aria-label="Membuka isi file"
    >
      <span className="sr-only">Membuka isi file...</span>
      {lineWidths.map((w, idx) => (
        <ShimmerBlock key={idx} className={`h-3.5 ${w} max-w-full`} />
      ))}
    </div>
  );
}
