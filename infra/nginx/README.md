# Setup Nginx + SSL untuk TapGo backend

Langkah ini dijalankan LANGSUNG di VPS (Nginx berjalan di host, bukan di
dalam container — lihat catatan di `infra/docker-compose.prod.yml`).
Diasumsikan Ubuntu/Debian; sesuaikan perintah paket bila distro lain.

## 1. Prasyarat

- Domain `api.tapgolion.id` (atau domain Anda) sudah menunjuk (A/AAAA record)
  ke IP VPS ini.
- Backend sudah jalan lewat `docker compose -f infra/docker-compose.prod.yml
  up -d` dan bisa diakses dari VPS itu sendiri: `curl 127.0.0.1:4000/health`
  harus mengembalikan `{"success":true,...}`.

## 2. Install Nginx + Certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

## 3. Pasang konfigurasi HTTP awal

```bash
sudo cp infra/nginx/tapgo-backend.conf /etc/nginx/sites-available/tapgo-backend.conf
sudo ln -s /etc/nginx/sites-available/tapgo-backend.conf /etc/nginx/sites-enabled/
sudo nginx -t   # HARUS lolos sebelum lanjut
sudo systemctl reload nginx
```

Pada titik ini, `http://api.tapgolion.id/health` (lewat Nginx, port 80)
sudah harus bisa diakses dari luar VPS.

## 4. Aktifkan HTTPS lewat Certbot

```bash
sudo certbot --nginx -d api.tapgolion.id
```

Certbot akan **otomatis menyisipkan** blok `server { listen 443 ssl; ... }`
plus redirect HTTP->HTTPS ke `/etc/nginx/sites-available/tapgo-backend.conf`
— jangan menulis blok HTTPS itu sendiri secara manual sebelum langkah ini,
path sertifikat belum ada dan `nginx -t` akan gagal.

Ikuti prompt Certbot (email untuk notifikasi kedaluwarsa, setuju ToS).
Pilih opsi "redirect" bila ditanya supaya semua trafik HTTP dialihkan ke
HTTPS.

## 5. Verifikasi perpanjangan otomatis

Certbot memasang systemd timer/cron sendiri saat instalasi. Cek jadwalnya:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run   # simulasi perpanjangan, tidak mengubah sertifikat asli
```

## 6. Setelah ini aktif

- `https://api.tapgolion.id/health` harus mengembalikan 200 dengan sertifikat
  valid (cek lewat browser atau `curl -v`).
- Update `apps/backend/.env` di VPS: `APP_URL`/`API_BASE_URL`/`CORS_ORIGINS`
  harus memakai `https://api.tapgolion.id`, bukan lagi akses langsung ke
  `127.0.0.1:4000` dari luar (yang sekarang memang tidak bisa diakses dari
  luar VPS sama sekali — lihat `infra/docker-compose.prod.yml`, port backend
  hanya bind ke `127.0.0.1`).
