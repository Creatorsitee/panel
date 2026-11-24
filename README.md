# Nodal Panel

Panel manajemen server Node.js dan Python real-time bergaya Pterodactyl yang berjalan langsung di VPS Anda.

## Deploy Otomatis ke VPS (Ubuntu / Debian)

Cukup `git clone` repositori ini ke VPS Anda dan jalankan installer otomatis:

```bash
git clone <url-repositori-anda> nodal-panel
cd nodal-panel
sudo bash install.sh
```

Installer akan otomatis:
1. Memastikan Node.js 22+, Python 3, `pip3`, dan `git` terpasang.
2. Membuat `PANEL_SESSION_SECRET` acak di `.env`.
3. Membangun aplikasi produksi (`npm run build`).
4. Mendaftarkan dan menjalankan service `systemd` (`nodal-panel.service`) di port `3000`.

## Menjalankan dengan PM2

```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 save
```

## Menjalankan dengan Docker

```bash
docker build -t nodal-panel .
docker run -d -p 3000:3000 -v nodal_data:/app/data --name nodal-panel nodal-panel
```
