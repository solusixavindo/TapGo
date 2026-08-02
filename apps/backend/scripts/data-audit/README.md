# Tooling Audit Data — read-only

Alat untuk mengklasifikasikan akun/transaksi UAT terhadap data produksi
nyata, tanpa pernah menyentuh production.

## Aturan keras

1. **Audit bersifat read-only.** `audit.ts` hanya menjalankan `SELECT`/`count`.
2. **Output hanya agregat dan identifier tersamarkan.** Tidak ada nomor
   telepon, email, nama, atau alamat lengkap yang dicetak.
3. **Purge selalu dry-run secara default.** Eksekusi nyata memerlukan tiga
   konfirmasi eksplisit sekaligus.
4. **Purge hanya menerima daftar ID eksplisit.** Tidak ada wildcard, tidak ada
   `--all`, tidak ada filter yang memilih baris secara implisit.
5. **Menolak berjalan pada production.** Nama database wajib memuat salah satu
   dari `test`, `uat`, `staging`, `clone`, atau `disposable`.

## Alur yang disetujui Owner

Audit sebenarnya menunggu backup/clone production ke database non-production
yang bersifat disposable. Sampai itu tersedia, alat ini hanya boleh dijalankan
terhadap database uji.

```bash
# 1. Audit read-only — aman, tidak mengubah apa pun
DATABASE_URL=postgresql://.../tapgo_clone_uat npx tsx scripts/data-audit/audit.ts

# 2. Menghasilkan kandidat purge — tetap read-only, hanya menulis berkas JSON
DATABASE_URL=postgresql://.../tapgo_clone_uat npx tsx scripts/data-audit/purge-candidates.ts \
  --out /tmp/kandidat.json

# 3. Dry-run purge — default, tidak menghapus apa pun
DATABASE_URL=postgresql://.../tapgo_clone_uat npx tsx scripts/data-audit/purge.ts \
  --ids /tmp/kandidat.json

# 4. Eksekusi nyata — HANYA setelah backup terverifikasi dan Owner menyetujui
#    daftar ID persisnya. Ketiga flag di bawah wajib ada bersamaan.
DATABASE_URL=postgresql://.../tapgo_clone_uat npx tsx scripts/data-audit/purge.ts \
  --ids /tmp/kandidat.json \
  --execute \
  --i-have-a-verified-backup \
  --confirm-environment=tapgo_clone_uat
```

## Klasifikasi

| Kelas | Arti |
|---|---|
| `SYSTEM_MASTER` | Membership, benefit, konfigurasi. Tidak pernah menjadi kandidat purge. |
| `CONFIRMED_TEST` | Cocok dengan pola tester yang diketahui **dan** tidak punya jejak finansial. |
| `POSSIBLE_TEST` | Cocok pola tester **tetapi** punya jejak finansial. Wajib keputusan Owner. |
| `REAL_PRODUCTION` | Tidak cocok pola tester mana pun. |
| `MUST_PRESERVE` | Punya invoice, pembayaran, komisi, penarikan, atau profit sharing. |
| `REQUIRES_OWNER_DECISION` | Segala yang ambigu. Default untuk kasus yang tidak jelas. |

Setiap akun yang punya jejak finansial **selalu** berakhir di `MUST_PRESERVE`
atau `REQUIRES_OWNER_DECISION`, tidak pernah di `CONFIRMED_TEST` — bahkan bila
polanya sangat mirip akun uji.
