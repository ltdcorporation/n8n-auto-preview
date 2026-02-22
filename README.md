# n8n-auto-preview

Workflow otomatis n8n untuk:
- jalan tiap jam (`0 * * * *`)
- ambil 4 media random dari stok lokal
- prioritas campuran gambar + video (kalau keduanya tersedia)
- fallback tetap jalan kalau salah satu tipe habis
- generate `caption.txt` (caption + hashtag)
- output ke subfolder job dengan timestamp WIB humanize
- lock anti tabrakan: kalau run sebelumnya masih jalan, run baru di-skip

## Struktur Folder

```text
/home/ubuntu/n8n-auto-preview
├── data
│   ├── captions.json
│   └── hashtags.json
├── output_jobs
├── scripts
│   ├── bootstrap.sh
│   ├── install_n8n.sh
│   └── run_job.mjs
├── source_media
│   ├── images
│   └── videos
├── systemd
│   └── n8n.service
└── workflows
    └── n8n-auto-preview.json
```

## Rule Workflow

- Ekstensi gambar valid: `jpg`, `jpeg`, `png`, `webp`
- Ekstensi video valid: `mp4`, `mov`
- Kalau total media valid `< 4`: job stop (skip)
- Kalau dua tipe ada: usahakan campur minimal 1 gambar + 1 video
- Kalau salah satu tipe habis: tetap jalan pakai tipe yang masih tersedia
- Media terpilih dipindah dari `source_media/*` ke `output_jobs/job_*`
- Caption diambil random non-repeat dari `captions.json`
- Kalau semua caption sudah `used=true`, auto reset ke `false`
- Hashtag diambil random `3-5` dari `hashtags.json` (boleh repeat)

## Format Output

Contoh folder job:

```text
output_jobs/job_2026-02-22_21-00_WIB/
├── media_1.ext
├── media_2.ext
├── media_3.ext
├── media_4.ext
└── caption.txt
```

Isi `caption.txt`:

```text
<caption line>
#tag1 #tag2 #tag3 ...
```

## Setup di Ubuntu Headless

1. Clone repo ke path final:

```bash
git clone git@github.com:ltdcorporation/n8n-auto-preview.git /home/ubuntu/n8n-auto-preview
cd /home/ubuntu/n8n-auto-preview
```

2. Bootstrap folder + data default:

```bash
bash scripts/bootstrap.sh
```

3. Install n8n (butuh `sudo`):

```bash
sudo bash scripts/install_n8n.sh
```

4. Pasang service systemd:

```bash
sudo cp systemd/n8n.service /etc/systemd/system/n8n.service
sudo systemctl daemon-reload
sudo systemctl enable --now n8n
sudo systemctl status n8n
```

5. Buka n8n (`http://<IP_RDP>:5678`), lalu import workflow:
- file: `workflows/n8n-auto-preview.json`
- activate workflow setelah dicek path command node

## Operasi Harian

- taruh stok gambar di `source_media/images`
- taruh stok video di `source_media/videos`
- edit caption bank di `data/captions.json`
- edit hashtag bank di `data/hashtags.json`

## Manual Test (tanpa n8n)

Jalankan langsung engine:

```bash
node scripts/run_job.mjs
```

## Troubleshoot Cepat

- Cek log service:

```bash
journalctl -u n8n -f
```

- Kalau node `Execute Command` gagal, cek path ini valid:
- `/home/ubuntu/n8n-auto-preview/scripts/run_job.mjs`

- Kalau sering skip karena stok kurang:
- tambahin media sampai total valid >= 4
