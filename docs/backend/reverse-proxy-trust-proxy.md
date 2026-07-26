# Reverse Proxy & Express `trust proxy` (P1-3)

Dokumen ini menjelaskan topologi produksi yang **diharapkan** dan konfigurasi
`trust proxy` pada backend. Dokumen ini tidak mengubah VPS/Nginx — hanya acuan.

## Topologi

```
Client ──HTTPS──▶ Nginx (satu reverse proxy) ──HTTP──▶ Node/Express (127.0.0.1:4000)
```

Backend berada di belakang **tepat satu** reverse proxy Nginx. Karena itu,
`app.set("trust proxy", 1)` ([src/app.ts](../../apps/backend/src/app.ts)) —
Express hanya mempercayai **satu hop** paling kanan pada `X-Forwarded-For`.

- `req.ip` = IP klien asli yang ditetapkan Nginx (hop terkanan).
- `X-Forwarded-For` yang dipalsukan klien (prefix di kiri) **diabaikan**,
  sehingga rate limiting berbasis IP tidak dapat di-bypass dengan spoofing.

> Jangan memakai `trust proxy = true` (mempercayai seluruh rantai) tanpa alasan:
> hal itu membuat klien dapat memalsukan IP melalui `X-Forwarded-For`.

## Konfigurasi Nginx yang diharapkan (acuan)

Header berikut harus diset oleh Nginx dan **tidak** boleh diteruskan mentah dari
klien:

```nginx
server {
    listen 443 ssl;
    server_name api.tapgolion.id;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        # Nginx menimpa X-Forwarded-For dengan IP koneksi nyata di hop terkanan.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Host $host;

        # WebSocket (Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Konsekuensi bila hop berubah

Jika di kemudian hari ada **lebih dari satu** proxy tepercaya (mis. Cloudflare di
depan Nginx), naikkan nilainya menjadi jumlah hop tepercaya yang sebenarnya
(`app.set("trust proxy", 2)`), bukan `true`. Nilai harus mencerminkan jumlah
proxy yang benar-benar Anda kendalikan.

## Verifikasi

Test `tests/security/trustProxy.test.ts`:
- `createApp()` menetapkan `trust proxy = 1`.
- Direct request → `req.ip` = IP socket.
- XFF dari proxy tepercaya → `req.ip` = IP klien.
- XFF yang dipalsukan klien → diabaikan (memakai hop terkanan).
