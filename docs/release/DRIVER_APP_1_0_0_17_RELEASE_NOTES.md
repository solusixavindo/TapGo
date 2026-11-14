# TapGo Driver 1.0.0+17 — tombol Terima jujur dan rincian saldo

Tanggal: 2026-11-14. Menggantikan 1.0.0+16 (isi +16 tetap berlaku). `versionCode` 17. Pin tetap trust-anchor.
APK uji untuk Owner (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir C).

## Yang berubah
1. **Tombol Terima**: bila server menolak (pesanan sudah diambil driver lain, saldo di bawah minimal, akun belum aktif, dll.),
   alasannya kini tampil DI DALAM lembar tawaran di atas tombol, bukan di layar belakang yang tertutup. Sebelumnya terasa
   "tidak merespons" sehingga driver menekan berulang. Kegagalan tak terduga juga menampilkan pesan umum.
2. **Rincian saldo** di kartu saldo tab Pendapatan (hanya tampilan): pendapatan dapat ditarik, bonus terkunci, deposit, lain-lain.
   Muncul hanya bila server mengirim persen kunci > 0; server lama atau bendera mati: tampilan sama persis seperti +16.
   Tanpa tombol dan tanpa kata penarikan (aturan Google Play).

## Belum terbukti
Perilaku di HP belum diuji Owner. Rincian saldo baru tampil setelah backend dengan bendera `BONUS_LOCK_ENABLED=true` aktif.
