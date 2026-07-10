# TapGo Lion Landing Page

Landing page resmi TapGo Lion untuk domain `https://tapgolion.id`.

## Stack

- Next.js 15 static export
- React 18
- TailwindCSS
- CSS animation ringan

## Build Local

Jalankan dari folder landing page:

```bash
cd apps/landing-page
npm install
npm run build
```

Build static menghasilkan folder:

```text
apps/landing-page/out
```

Folder `out/` adalah hasil static export yang bisa diupload ke Hostinger shared hosting.

## Preview Local

Untuk development:

```bash
npm run dev
```

Default URL dev:

```text
http://localhost:3001
```

Untuk mengecek hasil static export:

```bash
python3 -m http.server 3004 -d out
```

Lalu buka:

```text
http://localhost:3004
```

## File Siap Upload Hostinger

Setelah build dan packaging, folder siap upload berada di:

```text
apps/landing-page/dist/tapgolion-hostinger-upload
```

File ZIP siap upload berada di:

```text
apps/landing-page/dist/tapgolion-hostinger-upload.zip
```

Isi ZIP sudah disusun agar langsung diekstrak ke `public_html`.

## Deploy ke Hostinger File Manager

1. Login ke hPanel Hostinger.
2. Buka `File Manager`.
3. Masuk ke folder domain `tapgolion.id`.
4. Buka folder `public_html`.
5. Jika sebelumnya `public_html` hanya berisi folder `delete-account` atau file lama yang tidak lengkap, hapus isi `public_html` terlebih dahulu.
6. Upload file ZIP lengkap:

```text
tapgolion-hostinger-upload.zip
```

7. Extract ZIP di dalam `public_html`.
8. Pastikan `index.html` berada langsung di dalam `public_html`, bukan di `public_html/tapgolion-hostinger-upload/`.
9. Pastikan folder `_next`, `images`, `daftar`, `privacy-policy`, `terms-and-conditions`, `refund-policy`, `contact`, dan `delete-account` berada langsung di dalam `public_html`.
10. Hapus atau ganti halaman default Hostinger jika masih ada file default yang menutupi `index.html`.

## Test Setelah Upload

Cek URL berikut:

```text
https://tapgolion.id
https://tapgolion.id/daftar
https://tapgolion.id/delete-account
https://tapgolion.id/privacy-policy
https://tapgolion.id/terms-and-conditions
https://tapgolion.id/refund-policy
https://tapgolion.id/contact
https://tapgolion.id/robots.txt
https://tapgolion.id/sitemap.xml
```

## Logo

Logo resmi TapGo dari aplikasi mobile disalin ke:

```text
public/images/tapgo-logo.png
public/favicon.png
```

Logo digunakan di navbar, hero section, footer, halaman daftar, dan favicon metadata.

## Kontak Resmi

- Email: `support@tapgolion.id`
- WhatsApp: `+62 838-0025-5588`
- Link WhatsApp: `https://wa.me/6283800255588`

## Compliance Notes

Website menyatakan bahwa TapGo:

- adalah platform membership digital, layanan digital, wallet internal, program referral, dan peluang usaha berbasis teknologi
- bukan investasi
- bukan pinjaman online
- bukan penghimpunan dana masyarakat
- bukan perdagangan aset keuangan
- tidak menjanjikan keuntungan
- reward membership dan benefit mengikuti syarat dan ketentuan perusahaan

## Routes

- `/`
- `/daftar`
- `/delete-account`
- `/privacy-policy`
- `/terms-and-conditions`
- `/refund-policy`
- `/contact`
- `/robots.txt`
- `/sitemap.xml`
