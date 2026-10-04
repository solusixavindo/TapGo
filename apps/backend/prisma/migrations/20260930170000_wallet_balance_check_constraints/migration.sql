-- Audit keamanan 30 September 2026 (L1): kode aplikasi sudah menjaga
-- balance/cash_balance/ppob_balance tidak pernah negatif lewat
-- updateMany bersyarat (WHERE ... >= nominal) di dalam transaksi
-- Serializable — lihat WalletService/PpobService. CHECK constraint ini
-- adalah lapis pertahanan TERAKHIR di database: bila suatu saat ada bug
-- atau query manual yang lolos dari lapis aplikasi, database sendiri yang
-- menolak baris negatif, bukan cuma berharap kode aplikasi selalu benar.
--
-- DO block di bawah SENGAJA memeriksa dulu sebelum menambah constraint:
-- ALTER TABLE ... ADD CONSTRAINT pada Postgres otomatis memvalidasi semua
-- baris yang sudah ada dan akan gagal dengan sendirinya bila ada
-- pelanggaran — tapi pesan errornya generik ("baris melanggar check
-- constraint") tanpa menyebut berapa banyak atau di mana. Blok ini
-- memberi hitungan eksplisit lebih dulu supaya migrasi yang gagal
-- memberi info yang bisa langsung ditindaklanjuti, bukan cuma nama
-- constraint.
--
-- Bila migrasi ini gagal di produksi karena ada baris negatif: JANGAN
-- paksa lewati (mis. dengan NOT VALID lalu tidak pernah divalidasi) —
-- telusuri dulu baris yang dilaporkan lewat query di bawah, perbaiki
-- datanya (atau catat sebagai penyesuaian manual yang sah dengan jejak
-- audit), baru jalankan migrasi ini lagi.
DO $$
DECLARE
  violating_count integer;
BEGIN
  SELECT COUNT(*) INTO violating_count
  FROM "wallets"
  WHERE "balance" < 0 OR "cash_balance" < 0 OR "ppob_balance" < 0;

  IF violating_count > 0 THEN
    RAISE EXCEPTION 'Migrasi wallet_balance_check_constraints dibatalkan: % baris di wallets punya balance/cash_balance/ppob_balance negatif. Jalankan `SELECT id, user_id, balance, cash_balance, ppob_balance FROM wallets WHERE balance < 0 OR cash_balance < 0 OR ppob_balance < 0;` untuk menemukannya, perbaiki datanya, baru jalankan migrasi ini lagi.', violating_count;
  END IF;
END $$;

-- CATATAN: "wallets_balance_non_negative" SENGAJA tidak ditambahkan di sini —
-- sudah dibuat oleh migrasi 0003_referral_wallet_hardening. Menambahkannya
-- lagi gagal dengan SQLSTATE 42710 (constraint sudah ada) di setiap database
-- yang sudah menjalankan 0003, termasuk produksi. Hanya dua kolom yang belum
-- punya penjaga yang ditambahkan.
ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_cash_balance_non_negative" CHECK ("cash_balance" >= 0),
  ADD CONSTRAINT "wallets_ppob_balance_non_negative" CHECK ("ppob_balance" >= 0);
