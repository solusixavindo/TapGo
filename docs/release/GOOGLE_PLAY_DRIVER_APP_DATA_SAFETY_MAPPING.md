# Data Safety mapping — TapGo Driver (untuk diisi Owner di Play Console)

Dokumen ini memetakan jawaban form "Data safety" Play Console ke perilaku aplikasi driver_app yang
SUNGGUH ada di kode saat ini (30 September 2026). Owner tinggal menyalin jawaban di bawah ke form
Play Console — jangan menjawab dari ingatan/asumsi, karena ketidakcocokan antara form dan perilaku
aplikasi sungguhan adalah pelanggaran kebijakan Play yang bisa membuat aplikasi ditangguhkan.

Bila ada perubahan fitur di masa depan (mis. E2: pencocokan wajah dipindah ke server), dokumen ini
WAJIB diperbarui dan form Play Console WAJIB disesuaikan ulang sebelum rilis versi itu.

## Pertanyaan pembuka

- **Does your app collect or share any of the required user data types?** Ya.
- **Is all of the user data collected by your app encrypted in transit?** Ya (HTTPS/TLS ke seluruh
  endpoint backend TapGo).
- **Does your app provide a way for users to request that their data is deleted?** Ya — menu Hapus
  Akun di aplikasi, atau https://tapgolion.id/hapus-akun, atau email support@tapgolion.id.

## Location

| Jenis | Dikumpulkan | Dibagikan | Tujuan | Opsional/Wajib | Catatan |
|---|---|---|---|---|---|
| Approximate location | Ya | Tidak | App functionality (pencocokan pesanan) | Wajib untuk fitur Online | Berasal dari GPS yang sama dengan precise location |
| Precise location | Ya | Tidak | App functionality (pencocokan pesanan, rute, posisi live) | Wajib untuk fitur Online | Dikirim berkala HANYA selama status ONLINE atau ada perjalanan aktif; via layanan latar depan (foreground service) dengan notifikasi tetap. TIDAK memakai izin background location. Berhenti seketika saat driver OFFLINE |

Jawab "No" untuk pertanyaan izin lokasi latar belakang / background location — aplikasi ini
eksplisit tidak memintanya (lihat `AndroidManifest.xml`, hanya `ACCESS_FINE_LOCATION` /
`ACCESS_COARSE_LOCATION` + `FOREGROUND_SERVICE_LOCATION`).

## Personal info

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| Name | Ya | Tidak | Account management, App functionality |
| Phone number | Ya | Tidak | Account management, App functionality (identitas login) |
| Email address | Ya (opsional) | Tidak | Account management |
| User IDs | Ya | Tidak | Account management, Analytics/keamanan (ID perangkat untuk deteksi anomali) |
| Address | Tidak dari aplikasi (alamat pengajuan mitra dikumpulkan lewat proses verifikasi, bukan field aplikasi berkelanjutan) | — | — |

## Financial info

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| Purchase history | Ya (riwayat top up saldo driver) | Tidak | App functionality |
| Other financial info | Ya (saldo dompet, komisi, riwayat pencairan/withdrawal) | Tidak | App functionality |

TapGo Driver TIDAK memproses pembayaran kartu/rekening langsung di dalam aplikasi (top up manual
lewat transfer + konfirmasi admin) — tidak ada integrasi payment gateway di sisi driver_app saat ini.

## Photos and videos

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| Photos | Ya | Tidak | App functionality (verifikasi wajah harian — diproses ON-DEVICE, tidak diunggah; dokumen KTP/SIM/STNK — diunggah terenkripsi untuk verifikasi mitra) |

Catatan penting untuk form: foto verifikasi wajah **tidak meninggalkan perangkat** (pemrosesan
liveness + embedding sepenuhnya on-device). Foto dokumen identitas (KTP/SIM/STNK) **diunggah ke
server** dan dienkripsi, dilihat tim verifikasi TapGo, dihapus otomatis maksimal 72 jam.

## Messages

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| In-app messages | Ya | Tidak | App functionality (chat dengan penumpang selama perjalanan aktif) |

## App activity

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| App interactions | Ya | Tidak | Analytics, App functionality |

## App info and performance

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| Crash logs | Ya (Sentry, bila SENTRY_DSN diisi di server produksi) | Ya, ke Sentry (pihak ketiga, hanya untuk crash reporting) | Analytics |
| Diagnostics | Ya | Tidak | Analytics |

## Device or other IDs

| Jenis | Dikumpulkan | Dibagikan | Tujuan |
|---|---|---|---|
| Device or other IDs | Ya | Tidak | App functionality, keamanan (deteksi sesi ganda/anomali) |

## Data yang TIDAK dikumpulkan aplikasi ini

Jawab "No collection" untuk kategori berikut kecuali ditemukan bukti baru di kode:

- Health and fitness
- Web browsing history
- Search history
- Contacts (aplikasi TIDAK membaca daftar kontak perangkat — tombol WhatsApp CS membuka aplikasi
  WhatsApp driver lewat deep link, bukan lewat akses kontak)
- Calendar

## Pihak ketiga yang menerima data

- **Firebase Cloud Messaging (Google)** — token push perangkat, untuk notifikasi order/chat/SOS.
- **Sentry** — crash log, HANYA bila `SENTRY_DSN` diisi di lingkungan produksi backend.
- Tidak ada payment gateway pihak ketiga di sisi driver_app (top up manual, lihat di atas).

## Sebelum submit ke Play Console

1. Login ke Play Console, buka App content > Data safety.
2. Isi setiap kategori persis seperti tabel di atas.
3. Screenshot hasil isian, simpan sebagai bukti di folder ini untuk audit rilis berikutnya.
4. Jangan submit sebelum baris "Foreground service (location)" declaration (form terpisah, lihat
   `DRIVER_APP_READINESS_PLAN.md` E5.5) juga terisi.
