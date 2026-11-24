'use client';

import React, { useState } from 'react';
import { Check, Copy, BookOpen } from 'lucide-react';

export default function VpsDeployView() {
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

  const oneLineCmd = `git clone <url-repositori-anda> nodal-panel && cd nodal-panel && sudo bash install.sh`;
  const pm2Cmd = `npm install && npm run build && pm2 start ecosystem.config.js && pm2 save`;
  const dockerCmd = `docker build -t nodal-panel . && docker run -d -p 3000:3000 -v nodal_data:/app/data --name nodal-panel nodal-panel`;

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedBlock(id);
    setTimeout(() => setCopiedBlock(null), 1800);
  }

  return (
    <div className="space-y-8 max-w-3xl pb-12">
      <div className="space-y-2 pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-zinc-500" />
          <h2 className="text-base font-bold tracking-tight">
            Panduan Deploy ke VPS (README)
          </h2>
        </div>
        <p className="text-xs text-zinc-500">
          Ikuti instruksi di bawah ini untuk mendownload, mendeploy, dan menjalankan Nodal Panel secara mandiri di VPS Ubuntu atau Debian Anda.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          1. Instalasi Otomatis (systemd &amp; Installer)
        </h3>
        <p className="text-xs text-zinc-500">
          Skrip otomatis <span className="font-mono">install.sh</span> akan mendeteksi Node.js 22+, Python 3, pip3, serta mendaftarkan systemd service di port 3000.
        </p>
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <button
              type="button"
              onClick={() => copyText('systemd', oneLineCmd)}
              className="h-7 px-2.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedBlock === 'systemd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedBlock === 'systemd' ? 'Disalin' : 'Salin'}</span>
            </button>
          </div>
          <pre className="p-4 rounded-lg bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto pt-12">
            {oneLineCmd}
          </pre>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          2. Menjalankan dengan PM2
        </h3>
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <button
              type="button"
              onClick={() => copyText('pm2', pm2Cmd)}
              className="h-7 px-2.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedBlock === 'pm2' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedBlock === 'pm2' ? 'Disalin' : 'Salin'}</span>
            </button>
          </div>
          <pre className="p-4 rounded-lg bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto pt-12">
            {pm2Cmd}
          </pre>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          3. Menjalankan dengan Docker
        </h3>
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <button
              type="button"
              onClick={() => copyText('docker', dockerCmd)}
              className="h-7 px-2.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedBlock === 'docker' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedBlock === 'docker' ? 'Disalin' : 'Salin'}</span>
            </button>
          </div>
          <pre className="p-4 rounded-lg bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto pt-12">
            {dockerCmd}
          </pre>
        </div>
      </div>
    </div>
  );
}
