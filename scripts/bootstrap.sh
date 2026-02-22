#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

mkdir -p \
  "${ROOT_DIR}/source_media/images" \
  "${ROOT_DIR}/source_media/videos" \
  "${ROOT_DIR}/output_jobs" \
  "${ROOT_DIR}/data" \
  "${ROOT_DIR}/workflows" \
  "${ROOT_DIR}/systemd"

if [[ ! -f "${ROOT_DIR}/data/captions.json" ]]; then
  cat > "${ROOT_DIR}/data/captions.json" <<'JSON'
[
  {
    "id": 1,
    "text": "Pilih vibe favorit lo hari ini, stok ready dan tinggal gas.",
    "used": false,
    "used_at": null
  },
  {
    "id": 2,
    "text": "Konten fresh udah siap, tinggal pilih yang paling nyantol buat audience lo.",
    "used": false,
    "used_at": null
  },
  {
    "id": 3,
    "text": "Biar feed lo tetap hidup, ini materi promo yang bisa langsung lo pakai.",
    "used": false,
    "used_at": null
  },
  {
    "id": 4,
    "text": "Udah siap publish? Ambil paket preview ini dan lanjut eksekusi sekarang.",
    "used": false,
    "used_at": null
  }
]
JSON
fi

if [[ ! -f "${ROOT_DIR}/data/hashtags.json" ]]; then
  cat > "${ROOT_DIR}/data/hashtags.json" <<'JSON'
[
  "#promosi",
  "#kontencreator",
  "#digitalmarketing",
  "#jualanonline",
  "#socialmedia",
  "#branding",
  "#marketingstrategy",
  "#contentplan",
  "#idekonten",
  "#bisnisonline"
]
JSON
fi

echo "Bootstrap selesai."
echo "Root: ${ROOT_DIR}"
echo "Isi media ke: ${ROOT_DIR}/source_media/images dan ${ROOT_DIR}/source_media/videos"
echo "Edit caption di: ${ROOT_DIR}/data/captions.json"
echo "Edit hashtag di: ${ROOT_DIR}/data/hashtags.json"
