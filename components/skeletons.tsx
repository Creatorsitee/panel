'use client';

import React from 'react';

export function ShimmerBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton-shimmer rounded ${className}`} />;
}

export function HostStatsSkeleton() {
  return (
    <div
      className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 space-y-4"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
        <ShimmerBlock className="h-3.5 w-44" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-zinc-950/70 border border-zinc-200/80 dark:border-zinc-800/80 rounded-md p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ShimmerBlock className="w-3.5 h-3.5 rounded-sm shrink-0" />
                <ShimmerBlock className="h-3 w-24" />
              </div>
              <ShimmerBlock className="h-3 w-9" />
            </div>
            <ShimmerBlock className="h-1.5 w-full rounded-full" />
            <div className="flex items-center justify-between gap-2">
              <ShimmerBlock className="h-3 w-20" />
              <ShimmerBlock className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
        {[3, 4, 3].map((rowCount, idx) => (
          <div
            key={idx}
            className="bg-white/70 dark:bg-zinc-950/40 border border-zinc-200/70 dark:border-zinc-800/70 rounded-md p-3 space-y-1.5"
          >
            <div className="flex items-center gap-1.5">
              <ShimmerBlock className="w-3.5 h-3.5 rounded-sm shrink-0" />
              <ShimmerBlock className="h-3 w-28" />
            </div>
            {Array.from({ length: rowCount }).map((_, row) => (
              <div key={row} className="flex items-center justify-between gap-2">
                <ShimmerBlock className="h-2.5 w-20" />
                <ShimmerBlock className="h-2.5 w-28" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServerCardsSkeleton({ count = 3 }: { count?: number }) {
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
              <ShimmerBlock className="h-3.5 w-44 max-w-full" />
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <ShimmerBlock className="h-3 w-32" />
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

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" aria-hidden="true">
        <ShimmerBlock className="h-9 w-full sm:max-w-sm rounded" />
        <ShimmerBlock className="h-9 w-full sm:w-64 rounded" />
      </div>

      <ServerCardsSkeleton count={3} />
    </div>
  );
}

export function HostRouteSkeleton() {
  return (
    <div className="space-y-6 pb-12" role="status" aria-label="Memuat resource host">
      <span className="sr-only">Memuat resource host...</span>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800" aria-hidden="true">
        <ShimmerBlock className="h-6 w-44" />
        <ShimmerBlock className="h-3.5 w-52" />
      </div>
      <HostStatsSkeleton />
    </div>
  );
}

export function ConsoleLinesSkeleton() {
  const widths = ['w-64', 'w-80', 'w-56', 'w-72', 'w-48', 'w-60'];
  return (
    <div className="space-y-1.5 py-0.5" role="status" aria-label="Menghubungkan stream console">
      <span className="sr-only">Menghubungkan stream console...</span>
      {widths.map((w, idx) => (
        <div key={idx} className="flex items-center gap-2 h-5" aria-hidden="true">
          <ShimmerBlock className="h-3 w-28 shrink-0" />
          <ShimmerBlock className={`h-3 ${w} max-w-full`} />
        </div>
      ))}
    </div>
  );
}

export function FileManagerSkeleton() {
  const nameWidths = ['w-32', 'w-44', 'w-28', 'w-40', 'w-36', 'w-48', 'w-24', 'w-36'];
  return (
    <div role="status" aria-label="Memuat daftar file">
      <span className="sr-only">Memuat daftar file...</span>
      <div
        className="px-3 sm:px-4 py-2 bg-zinc-50/80 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
        aria-hidden="true"
      >
        <div className="flex items-center gap-2.5">
          <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
          <ShimmerBlock className="h-3 w-16" />
        </div>
        <ShimmerBlock className="h-3 w-24" />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60" aria-hidden="true">
        {nameWidths.map((w, idx) => (
          <div
            key={idx}
            className="px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-3"
          >
            <div className="flex items-center gap-2.5 flex-1 min-w-0 py-0.5">
              <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
              <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
              <ShimmerBlock className={`h-3.5 ${w} max-w-full`} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ShimmerBlock className="hidden sm:block h-3 w-12" />
              <ShimmerBlock className="w-8 h-8 rounded" />
            </div>
          </div>
        ))}
      </div>
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
      className="p-3 sm:p-4 space-y-3 min-h-[420px] bg-[#09090B]"
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

export function ServerWorkspaceSkeleton({
  tab = 'console',
}: {
  tab?: 'console' | 'files' | 'settings';
}) {
  return (
    <div className="space-y-5 sm:space-y-6" role="status" aria-label="Memuat workspace server">
      <span className="sr-only">Memuat workspace server...</span>

      <div
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800"
        aria-hidden="true"
      >
        <div className="space-y-1.5">
          <ShimmerBlock className="h-3 w-32" />
          <ShimmerBlock className="h-6 w-48" />
        </div>
        <div className="flex lg:hidden items-center gap-1.5">
          <ShimmerBlock className="h-7 w-16 rounded" />
          <ShimmerBlock className="h-7 w-24 rounded" />
          <ShimmerBlock className="h-7 w-20 rounded" />
        </div>
      </div>

      {tab === 'console' && (
        <div className="space-y-4 max-w-5xl mx-auto pb-10" aria-hidden="true">
          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 sm:p-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            {[0, 1, 2, 3].map((i) => (
              <ShimmerBlock key={i} className="h-8 w-full rounded" />
            ))}
          </div>

          <div className="bg-[#09090B] border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-3 sm:px-4 py-2 bg-[#111114] border-b border-zinc-800 flex items-center justify-between">
              <ShimmerBlock className="h-5 w-16 rounded" />
              <ShimmerBlock className="h-4 w-12 rounded" />
            </div>
            <div className="h-[340px] sm:h-[420px] p-3 sm:p-4 bg-[#09090B]">
              <ConsoleLinesSkeleton />
            </div>
            <div className="border-t border-zinc-800/90 bg-[#0C0C0E] px-3 sm:px-3.5 h-10 flex items-center gap-2">
              <ShimmerBlock className="h-3.5 w-3.5 rounded-sm shrink-0" />
              <ShimmerBlock className="h-3.5 w-44" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3.5 py-2.5 space-y-1.5"
                >
                  <ShimmerBlock className="h-3 w-16" />
                  <ShimmerBlock className="h-5 w-24" />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 sm:p-4 space-y-3 ${
                    i === 2 ? 'md:col-span-2 lg:col-span-1' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <ShimmerBlock className="h-3.5 w-20" />
                    {i === 2 && (
                      <div className="flex items-center gap-2.5">
                        <ShimmerBlock className="h-3 w-14" />
                        <ShimmerBlock className="h-3 w-14" />
                      </div>
                    )}
                  </div>
                  <ShimmerBlock className="h-[176px] w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'files' && (
        <div className="space-y-4 max-w-5xl mx-auto pb-10" aria-hidden="true">
          <div className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 sm:px-3.5 sm:py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShimmerBlock className="h-7 w-7 rounded shrink-0" />
              <ShimmerBlock className="h-3.5 w-24" />
            </div>
            <div className="grid grid-cols-3 sm:flex sm:items-center gap-1.5 sm:gap-2 shrink-0">
              <ShimmerBlock className="h-8 w-full sm:w-20 rounded" />
              <ShimmerBlock className="h-8 w-full sm:w-24 rounded" />
              <ShimmerBlock className="h-8 w-full sm:w-20 rounded" />
            </div>
          </div>
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0c0c0e]">
            <FileManagerSkeleton />
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-6 max-w-3xl pb-12" aria-hidden="true">
          <div className="flex items-center justify-between gap-3">
            <ShimmerBlock className="h-4 w-36" />
            <ShimmerBlock className="h-3 w-24" />
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
              <ShimmerBlock className="h-3.5 w-48" />
            </div>
            <div className="space-y-1.5">
              <ShimmerBlock className="h-3 w-28" />
              <ShimmerBlock className="h-9 w-full rounded" />
            </div>
            <div className="flex items-center gap-2.5 pt-1">
              <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
              <ShimmerBlock className="h-3.5 w-56" />
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 sm:p-5 space-y-4">
            <div className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <ShimmerBlock className="h-3.5 w-28" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="space-y-1.5">
                <ShimmerBlock className="h-3 w-24" />
                <ShimmerBlock className="h-9 w-full rounded" />
              </div>
              <div className="space-y-1.5">
                <ShimmerBlock className="h-3 w-20" />
                <ShimmerBlock className="h-9 w-full rounded" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <ShimmerBlock className="h-3 w-24" />
                <ShimmerBlock className="h-9 w-full rounded" />
              </div>
            </div>
          </div>

          <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-red-500/20">
              <ShimmerBlock className="w-4 h-4 rounded-sm shrink-0" />
              <ShimmerBlock className="h-3.5 w-28" />
            </div>
            <ShimmerBlock className="h-3 w-3/4" />
            <ShimmerBlock className="h-8 w-36 rounded" />
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminTableSkeleton({ section = 'users' }: { section?: 'users' | 'servers' }) {
  return (
    <div aria-hidden="true">
      <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800/70">
        {[0, 1, 2].map((i) => (
          <div key={i} className="p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5 flex-1">
                <ShimmerBlock className="h-3.5 w-32" />
                <ShimmerBlock className="h-3 w-44" />
              </div>
              <ShimmerBlock className="h-5 w-14 rounded" />
            </div>

            {section === 'servers' ? (
              <>
                <div className="grid grid-cols-2 gap-2 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/80 dark:border-zinc-800/80 rounded p-2">
                  <div className="space-y-1.5">
                    <ShimmerBlock className="h-2.5 w-12" />
                    <ShimmerBlock className="h-3 w-24" />
                    <ShimmerBlock className="h-2.5 w-32" />
                  </div>
                  <div className="space-y-1.5">
                    <ShimmerBlock className="h-2.5 w-14" />
                    <ShimmerBlock className="h-3 w-24" />
                    <ShimmerBlock className="h-2.5 w-28" />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <ShimmerBlock className="h-7 w-14 rounded" />
                  <ShimmerBlock className="w-7 h-7 rounded" />
                  <ShimmerBlock className="h-7 w-14 rounded" />
                  <ShimmerBlock className="w-7 h-7 rounded" />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/70">
                <ShimmerBlock className="h-3 w-28" />
                <div className="flex items-center gap-1.5">
                  <ShimmerBlock className="h-7 w-14 rounded" />
                  <ShimmerBlock className="h-7 w-14 rounded" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hidden md:block">
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-4 py-2.5 grid grid-cols-5 gap-4">
          <ShimmerBlock className="h-3 w-16" />
          <ShimmerBlock className="h-3 w-14" />
          <ShimmerBlock className="h-3 w-16" />
          <ShimmerBlock className="h-3 w-20" />
          <ShimmerBlock className="h-3 w-12 ml-auto" />
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {[0, 1, 2, 3].map((i) =>
            section === 'servers' ? (
              <div key={i} className="px-4 py-3.5 grid grid-cols-5 items-center gap-4">
                <div className="space-y-1.5">
                  <ShimmerBlock className="h-3.5 w-28" />
                  <ShimmerBlock className="h-3 w-40" />
                </div>
                <div className="space-y-1.5">
                  <ShimmerBlock className="h-3.5 w-24" />
                  <ShimmerBlock className="h-3 w-32" />
                </div>
                <div className="space-y-1.5">
                  <ShimmerBlock className="h-3 w-24" />
                  <ShimmerBlock className="h-3 w-28" />
                </div>
                <ShimmerBlock className="h-5 w-16 rounded" />
                <div className="flex items-center justify-end gap-1">
                  <ShimmerBlock className="w-7 h-7 rounded" />
                  <ShimmerBlock className="w-7 h-7 rounded" />
                  <ShimmerBlock className="h-7 w-14 rounded" />
                  <ShimmerBlock className="w-7 h-7 rounded" />
                </div>
              </div>
            ) : (
              <div key={i} className="px-4 py-3.5 grid grid-cols-5 items-center gap-4">
                <div className="space-y-1.5">
                  <ShimmerBlock className="h-3.5 w-28" />
                  <ShimmerBlock className="h-3 w-36" />
                </div>
                <ShimmerBlock className="h-5 w-14 rounded" />
                <ShimmerBlock className="h-3.5 w-8" />
                <ShimmerBlock className="h-3.5 w-20" />
                <div className="flex items-center justify-end gap-1">
                  <ShimmerBlock className="h-7 w-14 rounded" />
                  <ShimmerBlock className="h-7 w-14 rounded" />
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminRouteSkeleton({ section = 'users' }: { section?: 'users' | 'servers' }) {
  return (
    <div className="space-y-6 pb-12" role="status" aria-label="Memuat panel admin">
      <span className="sr-only">Memuat panel admin...</span>

      <div
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800"
        aria-hidden="true"
      >
        <ShimmerBlock className="h-6 w-36" />
        <ShimmerBlock className="h-10 w-full sm:w-52 rounded" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-zinc-50 dark:bg-zinc-900/55 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 sm:p-3.5 space-y-2"
          >
            <ShimmerBlock className="h-3 w-24" />
            <ShimmerBlock className="h-6 w-16" />
            <ShimmerBlock className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div
        className={`flex flex-col ${section === 'servers' ? 'lg:flex-row lg:items-center' : 'sm:flex-row sm:items-center'} justify-between gap-3`}
        aria-hidden="true"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1">
          <ShimmerBlock className="h-9 w-full sm:max-w-sm rounded" />
          <ShimmerBlock className={`h-9 w-full ${section === 'servers' ? 'sm:w-80' : 'sm:w-44'} rounded`} />
        </div>
        <ShimmerBlock className={`h-9 w-full ${section === 'servers' ? 'lg:w-32' : 'sm:w-32'} rounded`} />
      </div>

      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#0C0C0E]">
        <AdminTableSkeleton section={section} />
      </div>
    </div>
  );
}

export function WorkspaceBootSkeleton({
  routeKind = 'dashboard',
  serverTab = 'console',
  adminSection = 'users',
}: {
  routeKind?: 'dashboard' | 'server' | 'admin' | 'host';
  serverTab?: 'console' | 'files' | 'settings';
  adminSection?: 'users' | 'servers';
}) {
  return (
    <div
      className="min-h-screen bg-white dark:bg-[#09090B] text-zinc-900 dark:text-zinc-100 flex overflow-x-clip"
      role="status"
      aria-label="Memuat panel cmnty"
    >
      <span className="sr-only">Memuat panel cmnty...</span>

      <aside
        className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen w-60 bg-zinc-50 dark:bg-[#0C0C0E] border-r border-zinc-200 dark:border-zinc-800 flex-col shrink-0"
        aria-hidden="true"
      >
        <div className="h-14 px-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
          <ShimmerBlock className="h-4 w-16" />
        </div>

        <div className="flex-1 p-3 space-y-6">
          <div className="space-y-1.5">
            <ShimmerBlock className="h-3 w-24 mx-3 mb-2" />
            <ShimmerBlock className="h-9 w-full rounded" />
            <ShimmerBlock className="h-9 w-full rounded" />
            {routeKind === 'admin' && (
              <>
                <ShimmerBlock className="h-9 w-full rounded" />
                <ShimmerBlock className="h-9 w-full rounded" />
              </>
            )}
          </div>

          {routeKind === 'server' && (
            <div className="space-y-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <ShimmerBlock className="h-3 w-28 mx-3 mb-2" />
              <ShimmerBlock className="h-9 w-full rounded" />
              <ShimmerBlock className="h-9 w-full rounded" />
              <ShimmerBlock className="h-9 w-full rounded" />
            </div>
          )}
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

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="h-14 border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-4"
          aria-hidden="true"
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <ShimmerBlock className="lg:hidden w-8 h-8 rounded shrink-0" />
            <ShimmerBlock className="h-4 w-36 sm:w-48" />
          </div>
          <ShimmerBlock className={`h-8 rounded ${routeKind === 'server' ? 'w-28' : 'w-24 sm:w-28'}`} />
        </header>

        <main className="flex-1 min-w-0 p-4 sm:p-6 max-w-6xl w-full mx-auto">
          {routeKind === 'server' ? (
            <ServerWorkspaceSkeleton tab={serverTab} />
          ) : routeKind === 'admin' ? (
            <AdminRouteSkeleton section={adminSection} />
          ) : routeKind === 'host' ? (
            <HostRouteSkeleton />
          ) : (
            <DashboardContentSkeleton />
          )}
        </main>
      </div>
    </div>
  );
}
