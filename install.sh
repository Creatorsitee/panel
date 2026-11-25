#!/usr/bin/env bash
set -euo pipefail

# cmnty — Automated Server Installer (Ubuntu / Debian)
# Usage: git clone <your-repo-url> cmnty && cd cmnty && sudo bash install.sh

if [ "$(id -u)" -ne 0 ]; then
  echo "Harap jalankan skrip ini sebagai root atau gunakan sudo: sudo bash install.sh"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PORT="${PORT:-3000}"
SERVICE_NAME="cmnty-panel"

echo "==> [1/6] Memperbarui paket sistem & memasang dependensi dasar (git, curl, python3, pip3)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg python3 python3-pip python3-venv build-essential

echo "==> [2/6] Memeriksa runtime Node.js..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  echo "Memasang Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "Node.js: $(node -v)"
echo "Python : $(python3 --version)"
echo "Git    : $(git --version)"

echo "==> [3/6] Membuat konfigurasi .env produksi jika belum ada..."
cd "$APP_DIR"
if [ ! -f ".env" ]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat > .env <<EOF
NODE_ENV=production
PORT=${APP_PORT}
PANEL_SESSION_SECRET=${SESSION_SECRET}
EOF
  chmod 600 .env
fi

echo "==> [4/6] Memasang dependensi npm dan membangun aplikasi..."
TOTAL_MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 2048)"
TOTAL_SWAP_MB="$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "$TOTAL_MEM_MB" -lt 2048 ] && [ "$TOTAL_SWAP_MB" -lt 512 ] && [ ! -f "/swapfile" ]; then
  echo "RAM terdeteksi ${TOTAL_MEM_MB} MB, menyiapkan swap 1 GB sementara/permanen agar build lancar..."
  (fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none) && \
    chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && \
    (grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab) || \
    rm -f /swapfile || true
fi

rm -rf .next
npm install --include=dev --include=optional --no-audit --no-fund
NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}" npm run build

mkdir -p "${APP_DIR}/data/servers"

echo "==> [5/6] Menyiapkan layanan systemd (${SERVICE_NAME})..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=cmnty - Node.js & Python Self-Hosted Server Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(command -v npm) run start -- -p ${APP_PORT} -H 0.0.0.0
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "==> [6/6] Selesai!"
PUBLIC_IP="$(hostname -I | awk '{print $1}')"
echo "---------------------------------------------------------"
echo "cmnty aktif di      : http://${PUBLIC_IP}:${APP_PORT}"
echo "Status layanan      : systemctl status ${SERVICE_NAME}"
echo "Log real-time       : journalctl -u ${SERVICE_NAME} -f"
echo "---------------------------------------------------------"
