# cmnty — Self-Hosted VPS Panel

Panel manajemen server Node.js dan Python mandiri real-time bergaya Pterodactyl yang dirancang untuk VPS standar maupun VPS dengan NAT Gateway.

## Fitur Utama
- **Manajemen Proses Multi-Runtime**: Dukungan penuh untuk aplikasi dan bot Node.js (`node`, `npm`, `npx`, `tsx`) serta Python (`python3`, `uvicorn`, `gunicorn`, `flask`, `fastapi`, `pytest`).
- **Pilihan Resource Adil (Fair-Share)**: Alokasi memori minimal 512 MB hingga 4 GB dan batas CPU proporsional agar pembuatan server tidak langsung menghabiskan resource VPS.
- **Dukungan NAT VPS & Port Internal**: Memungkinkan pengaturan Port Internal khusus agar terhubung mulus dengan port forwarding NAT Gateway (mis. Public `38.49.215.170:port` -> Internal VPS).
- **Terminal Real-Time & Pterodactyl-Style Charts**: Live stream log daemon/stdout/stderr, area chart CPU Load & Memory interaktif, serta input perintah stdin.
- **File Manager Terintegrasi**: Editor file, upload ZIP otomatis, buat/hapus/rename direktori, dan sinkronisasi `.env`.
- **Notifikasi SweetAlert2 & Shimmer Skeleton**: Pengalaman pengguna modern, clean, dan responsif.

## Deploy Otomatis ke VPS (Ubuntu / Debian)

Cukup `git clone` repositori ini ke VPS Anda dan jalankan skrip installer otomatis:

```bash
git clone <url-repositori-anda> cmnty
cd cmnty
sudo bash install.sh
```

Installer akan otomatis:
1. Memastikan Node.js 22 LTS, Python 3, `pip3`, dan `git` terpasang.
2. Membuat kunci sesi rahasia (`PANEL_SESSION_SECRET`) di `.env`.
3. Membangun aplikasi produksi (`npm run build`).
4. Mendaftarkan dan menjalankan service systemd (`cmnty-panel.service`) pada port internal `3000`.

## Menjalankan di Lingkungan NAT VPS
1. Jalankan panel `cmnty` di dalam VPS pada port internal **`3000`**.
2. Akses panel dari internet menggunakan IP Publik dan Port Publik yang telah diforward (misal `http://38.49.215.170:6705`).
3. Saat membuat server aplikasi atau bot di dalam panel, tentukan **Port Internal** sesuai port yang telah di-approve pada NAT Gateway VPS Anda.

## Menjalankan dengan PM2

```bash
npm ci --omit=dev=false
npm run build
pm2 start ecosystem.config.js
pm2 save
```
