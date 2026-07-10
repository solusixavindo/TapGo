# TapGo UAT Tunnel Guide

Panduan ini dipakai agar HP Android fisik bisa mengakses backend TapGo yang masih berjalan di MacBook lokal, tanpa VPS. Gunakan untuk UAT/staging, bukan production deployment.

## 1. Jalankan Backend Lokal

Dari root project:

```bash
cd /Users/macbook/Documents/FriTekno/Projects/Tapgo
npm install
docker compose -f infra/docker-compose.yml up -d
npm --workspace apps/backend run db:generate
npm --workspace apps/backend run db:migrate
npm --workspace apps/backend run seed:demo
npm --workspace apps/backend run dev
```

Default backend port:

```text
4000
```

Health check:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{
  "success": true,
  "service": "tapgo-backend",
  "status": "ok"
}
```

Jika port `4000` sudah dipakai, hentikan proses lama atau jalankan backend dengan `PORT` berbeda dan sesuaikan command tunnel.

## 2. Cloudflare Tunnel

Install `cloudflared` di MacBook:

```bash
brew install cloudflared
```

Jalankan tunnel ke backend lokal:

```bash
cloudflared tunnel --url http://localhost:4000
```

Cloudflare akan menampilkan URL HTTPS publik, contoh:

```text
https://nama-random.trycloudflare.com
```

Test health dari URL tunnel:

```bash
curl https://nama-random.trycloudflare.com/health
```

Jika response `status: ok`, backend sudah bisa diakses dari HP Android.

## 3. Alternatif Ngrok

Install ngrok:

```bash
brew install ngrok/ngrok/ngrok
```

Login/authtoken ngrok jika belum:

```bash
ngrok config add-authtoken <NGROK_AUTHTOKEN>
```

Jalankan tunnel:

```bash
ngrok http 4000
```

Ambil URL HTTPS dari output ngrok, contoh:

```text
https://abc123.ngrok-free.app
```

Test:

```bash
curl https://abc123.ngrok-free.app/health
```

## 4. Build APK UAT

APK UAT terbaru sudah mendukung penggantian URL server dari aplikasi. Artinya URL Cloudflare/ngrok boleh berubah tanpa rebuild APK.

Build default staging:

```bash
cd /Users/macbook/Documents/FriTekno/Projects/Tapgo/apps/user_app
flutter pub get
flutter build apk --debug --dart-define=TAPGO_APP_MODE=staging
```

Salin APK ke folder dist:

```bash
cd /Users/macbook/Documents/FriTekno/Projects/Tapgo
cp apps/user_app/build/app/outputs/flutter-apk/app-debug.apk dist/TapGo-UAT-08062026-final-register-login-fix.apk
```

Opsional: APK juga masih bisa dibuild dengan URL awal:


```bash
cd /Users/macbook/Documents/FriTekno/Projects/Tapgo/apps/user_app
flutter build apk --debug \
  --dart-define=TAPGO_APP_MODE=staging \
  --dart-define=TAPGO_API_BASE_URL=https://URL-TUNNEL
```

Catatan:

- `TAPGO_API_BASE_URL` hanya menjadi default awal.
- Setelah APK terpasang, URL bisa diganti dari aplikasi tanpa rebuild.
- Aplikasi otomatis menyimpan root URL dan menambahkan `/api/v1` untuk request API.

## 5. Ganti URL Server Dari Aplikasi

Gunakan saat URL Cloudflare/ngrok berubah.

1. Buka aplikasi TapGo.
2. Di halaman Login, ketuk logo TapGo 5 kali.
3. Dialog `Server Configuration` akan muncul.
4. Isi root URL tunnel baru, contoh:

```text
https://nama-random.trycloudflare.com
```

5. Tekan `Test Connection`.
6. Pastikan status OK dan URL yang dites adalah:

```text
https://nama-random.trycloudflare.com/health
```

7. Tekan `Save`.
8. Register/Login akan memakai:

```text
https://nama-random.trycloudflare.com/api/v1/auth/register
https://nama-random.trycloudflare.com/api/v1/auth/login
```

Jika user memasukkan URL dengan `/api/v1`, aplikasi otomatis menyimpannya sebagai root URL.

## 6. Install APK ke HP Android

Jika HP terhubung USB dan `adb` aktif:

```bash
adb install -r dist/TapGo-UAT-08062026-final-register-login-fix.apk
```

Atau kirim APK ke HP melalui AirDrop/WhatsApp/Drive, lalu install manual.

## 7. UAT Checklist HP Fisik

1. Jalankan Docker/Postgres/Redis lokal.
2. Jalankan backend TapGo di MacBook.
3. Buka `http://localhost:4000/health`.
4. Jalankan Cloudflare Tunnel atau ngrok.
5. Copy URL HTTPS tunnel.
6. Test `https://URL-TUNNEL/health` dari browser HP.
7. Install APK UAT ke HP.
8. Buka Login, tap logo TapGo 5 kali.
9. Isi root URL tunnel.
10. Tekan `Test Connection`.
11. Tekan `Save`.
12. Register member baru.
13. Login member.
14. Beli paket membership.
15. Cek dashboard, wallet, referral, dan admin console.

## 8. Jika Tunnel Mati

Jika backend/tunnel tidak aktif:

- Register tidak boleh masuk dashboard.
- Login tidak boleh masuk dashboard.
- Aplikasi menampilkan:

```text
Server TapGo belum dapat dihubungi. Pastikan server UAT aktif.
```

Nyalakan ulang backend dan tunnel, lalu buka ulang aplikasi atau tekan ulang Login/Register.

## 9. Risiko Tersisa

- URL gratis Cloudflare/ngrok bisa berubah setiap tunnel direstart.
- Jika URL berubah, tidak perlu rebuild APK. Ganti dari `Server Configuration`.
- Laptop harus tetap menyala dan tidak sleep selama UAT.
- Jangan gunakan tunnel gratis ini untuk production.
- Midtrans callback dari sandbox harus diarahkan ke URL tunnel yang sedang aktif jika ingin test callback nyata.
