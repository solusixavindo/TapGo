# TapGo — Visual Evidence Standard

> **Keputusan Owner, 2026-08-01.** Berlaku permanen untuk seluruh perubahan TapGo sejak tanggal ini.
> **Laporan teks saja tidak lagi cukup untuk mendapatkan Owner Approval.**

---

## 1. Aturan dasar

**Tidak ada stage yang dapat dinyatakan APPROVED hanya dengan laporan teks.** Setiap stage wajib disertai bukti visual yang dapat dibuka dan diperiksa sendiri oleh Owner.

## 2. Artefak wajib per stage

Setiap stage membuat satu berkas:

```
docs/release-2/visual-review/STAGE_<ID>_EXECUTIVE_REVIEW.html
```

Persyaratan teknis berkas tersebut:

- **self-contained** — dapat dibuka dengan double-click, tanpa server
- **tanpa internet** — nol CDN, nol external font, nol API call, nol gambar remote
- inline CSS; inline SVG untuk diagram
- JavaScript lokal minimal diperbolehkan hanya untuk navigasi/filter/tab
- responsive untuk desktop dan mobile, tanpa horizontal overflow
- nol dependency atau package baru
- nol data sensitif, nol PII nyata, nol secret

## 3. Isi minimum setiap perubahan

Setiap perubahan yang ditampilkan wajib memuat:

| Elemen | Keterangan |
|---|---|
| **Before** | kondisi sebelum perubahan |
| **After** | kondisi sesudah perubahan |
| **Reason** | alasan perubahan |
| **Affected file** | daftar file, dari bukti Git |
| **Test evidence** | hasil test, dengan label kejujuran (§9) |
| **Status** | label dari §8 |
| **Limitation** | apa yang belum tercakup |
| **Rollback** | cara mengembalikan |
| **Runtime applicability** | apakah terlihat di runtime Android, backend saja, atau belum terlihat sama sekali |

## 4. Stage backend / security

Wajib memuat: architecture flow · authorization matrix · route/service mapping · error-code mapping · test dashboard.

## 5. Stage schema / database

Wajib memuat: ERD before/after · perubahan model, field, dan index · dampak migration · backward compatibility · rollback dan forward-fix.

## 6. Stage API

Wajib memuat: sequence diagram · endpoint inventory · contoh request/response **sintetis** · authorization · error state · perilaku idempotency.

## 7. Stage mobile / UI

Wajib memuat: **screenshot runtime Android sungguhan** · video atau screen recording untuk interaksi/motion · state loading, error, empty, dan success · bukti responsive per device · bukti accessibility.

## 8. Label kejujuran

Setiap item wajib memakai tepat satu label berikut:

| Label | Makna |
|---|---|
| `IMPLEMENTED` | kode benar-benar ada dan berjalan |
| `TESTED` | tercakup automated test |
| `DOCUMENTED` | keputusan/desain tertulis, belum berupa kode |
| `PROPOSAL ONLY` | usulan, belum disetujui untuk dibangun |
| `BLOCKED` | menunggu keputusan Owner/legal/prasyarat |
| `NOT IMPLEMENTED` | direncanakan, belum dikerjakan |
| `RUNTIME VERIFICATION REQUIRED` | perlu pembuktian di perangkat/lingkungan nyata |
| `UNTOUCHED` | sengaja tidak diubah, dibuktikan |

## 9. Label asal bukti test

| Label | Makna |
|---|---|
| `RE-VERIFIED` | test dijalankan ulang pada task tersebut |
| `REPORTED EVIDENCE — NOT RE-RUN` | angka berasal dari laporan/commit sebelumnya |

Keduanya **tidak boleh** dicampur atau disamarkan.

## 10. Larangan keras

- screenshot palsu
- mockup yang disebut sebagai runtime
- proposal yang diberi label implemented
- unit/integration test yang disebut sebagai bukti runtime Android
- test fixture yang disebut sebagai production data
- menyembunyikan validation yang gagal
- PII nyata atau secret di dalam artefak visual

## 11. Syarat approval

Stage approval memerlukan: implementation report · validation evidence · visual evidence · Owner runtime evidence bila menyangkut UI/mobile · commit hash.

## 12. Perubahan tanpa output UI

Bila perubahan tidak menghasilkan tampilan, demo wajib memakai: diagram · state transition · matrix · sequence flow · hasil test · perbandingan arsitektur before/after.

## 13. Perintah pembuka

Setiap final report wajib mencantumkan **perintah persis** yang dapat dijalankan Owner untuk membuka demo visual, misalnya:

```bash
open docs/release-2/visual-review/STAGE_5_11_TO_5_13_EXECUTIVE_REVIEW.html
```

---

## Catatan penerapan

Standar ini bersifat **prosedural**, bukan teknis: ia tidak mengubah kode, schema, maupun pipeline. Penerapannya diverifikasi saat Owner Review setiap stage.

Bila suatu stage tidak dapat memenuhi salah satu butir di atas — misalnya screenshot runtime Android belum mungkin karena aplikasi belum dibangun — hal itu **wajib dinyatakan terbuka** dengan label `RUNTIME VERIFICATION REQUIRED`, bukan dilewati diam-diam.
