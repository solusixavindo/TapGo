# Daftar regresi user_app / backend

Aturan Owner (2026-09-25): setiap kenaikan versi wajib **tidak mengulang kesalahan versi sebelumnya**.
Setiap laporan Owner dari uji HP dicatat di sini dengan penyebab dan ujinya. Uji-uji ini berjalan
di `flutter test` / `vitest` dan di `scripts/release-gate-user-app.sh`; paket APK/AAB tidak
diserahkan bila salah satunya gagal. **Laporan baru wajib menambah baris di sini beserta ujinya.**

| Versi lapor | Gejala | Akar masalah | Uji penjaga |
|---|---|---|---|
| 2.0.4+31 | "Terjadi gangguan tampilan" saat ganti tema gelap ke terang | Grid layanan Beranda menghitung lebar sel negatif (`(lebar − 36) / 4`) saat sesaat mendapat lebar ~0, membangun `SizedBox` berlebar negatif (`dashboard_screen.dart`) | `test/theme_switch_test.dart` (lebar 0/12/30/36 dan 5 skenario ganti tema) |
| 2.0.4+31 | Tombol cari hanya membuka Kartu Anggota | Fitur cari tidak punya isi selain satu pintasan | `test/ui_polish_release2_test.dart` (tidak ada kolom/ikon cari) |
| 2.0.4+31 | Ikon Ubah Password tidak senada | Tidak ada ilustrasi 3D untuk label itu, jatuh ke ikon Material datar | `test/ui_polish_release2_test.dart` (peta aset `Ubah Password`) |
| 2.0.4+31 | Latar terang terlalu putih | `#F4F8FB` nyaris sama dengan kartu putih | `test/ui_polish_release2_test.dart` (luminans latar dan kontras teks sekunder) |
| 2.0.4+31 | Kartu Aktivitas terlalu besar dan putih di tema gelap | Tiga baris teks, warna `Colors.white` dan teks hardcode | `test/ui_polish_release2_test.dart` (tinggi < 80, warna = surface tema) |
| 2.0.3+30 | Aktivitas: galat tak tertangani saat tarik-segarkan gagal | `refresh` tanpa `catchError` | `test/activity_feed_test.dart` |
| 2.0.2+29 | Pesan jaringan PPOB berubah menjadi generik | Kode `NETWORK_ERROR` tidak diteruskan | `test/ppob_api_contract_test.dart` |
| 2.0.x | Diminta login padahal tidak logout | Refresh token berlomba | `test/upgrade_from_28_test.dart`, `token_refresh_coordinator` |
| 2.0.5+32 | Build lama tetap diterima server | Build sebelum 2.0.5 mengirim header distribusi | `legacyMobileClientGate.integration.test.ts` (batas build minimum) |
| 2.0.5+32 | Akun admin/super admin dapat masuk APK | Hanya `/admin/*` yang dijaga | `adminMobileBlock.integration.test.ts` |
| 2.0.5+32 | Pesan chat dari driver tidak muncul sampai layar dibuka ulang | Layar hanya mengandalkan Socket.IO, yang nonaktif di produksi (`REALTIME_ENABLED=false`); tanpa polling | `test/chat_inbox_test.dart` (polling memasukkan pesan baru tanpa duplikasi) |
| 2.0.5+32 | Pesan yang dikirim lewat REST tidak tampil di layar pengirim | `post()` sudah membuka pembungkus `data`, kode mencari `result['data']` | `test/chat_inbox_test.dart` (balasan cepat tampil sekali) |
| 2.0.5+32 | Pesan chat baru tidak memicu notifikasi | Push hanya untuk status perjalanan | `chatConversationsPush.integration.test.ts` (dua arah, tanpa isi pesan, dibatasi 20 detik) |
| backend | Penghapusan Founder dikhawatirkan memengaruhi mesin bisnis | Hanya gerbang bonus Founder yang dihapus (tanpa grant selalu `true`) | `businessEngineGolden.integration.test.ts` (seluruh komisi, bonus level, dompet, mutasi identik byte-demi-byte dengan kode sebelumnya) |
| backend | Uji recovery/admin gagal setelah pemuat push diimpor statis | `env` ter-parse saat impor modul | seluruh suite backend (pemuat push kini malas) |

## Prosedur sebelum menyerahkan paket

1. `scripts/release-gate-user-app.sh` harus **GERBANG LOLOS**.
2. Untuk perubahan tampilan: periksa terang **dan** gelap, dan ganti tema bolak-balik, di emulator/HP.
3. Untuk perubahan backend: suite penuh `vitest` terhadap database uji.
4. Tambahkan baris baru di tabel di atas untuk setiap temuan baru.
