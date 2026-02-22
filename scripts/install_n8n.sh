#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Jalankan pakai sudo: sudo bash scripts/install_n8n.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y curl ca-certificates gnupg ffmpeg

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v20\.|^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install -g --unsafe-perm n8n

echo "Install selesai."
node -v
npm -v
n8n --version
