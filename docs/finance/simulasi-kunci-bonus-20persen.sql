-- SIMULASI (HANYA MEMBACA): kunci 20% bonus membership ke Saldo TapGo, berlaku surut untuk seluruh bonus yang sudah masuk.
-- Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4; jawaban Owner 12 Nov 2026.
--
-- Aman dijalankan di produksi: satu-satunya yang dibuat adalah dua TABEL SEMENTARA yang hanya hidup selama sesi psql
-- ini (hilang otomatis, tidak menyentuh tabel asli); semua pembacaan sesudahnya berjalan dalam mode hanya-baca
-- (INSERT/UPDATE/DELETE akan ditolak database). Keluaran hanya agregat serta daftar dengan nomor HP/nama disamarkan.
-- Tidak mencetak rekening, kata sandi, atau token.
--
-- Cara pakai:  psql "<koneksi>" -f simulasi-kunci-bonus-20persen.sql
--
-- Aturan yang disimulasikan (usulan; belum berlaku di sistem):
--   bonus membership = SPONSOR_BONUS, BASIC_SPONSOR_BONUS, LEVEL_BONUS, REWARD_BONUS, PROFIT_SHARING,
--                      PROFIT_SHARING_BONUS, INCENTIVE_BONUS  (dikurangi pembalikan insentif driver)
--   dikunci   = 20% x total bonus yang pernah masuk
--   dipindah  = MIN(dikunci, saldo yang dapat ditarik saat ini)   -- tidak pernah membuat saldo negatif
--   kekurangan = dikunci - dipindah                                -- sudah terlanjur ditarik/dipakai; TIDAK ditagih
-- Saldo Registrasi/PPOB tidak ikut (bukan saldo yang dapat ditarik).

CREATE TEMP TABLE sim_bonus AS
SELECT
  w.user_id,
  w.id AS wallet_id,
  w.balance,
  w.cash_balance,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type IN (
    'SPONSOR_BONUS','BASIC_SPONSOR_BONUS','LEVEL_BONUS','REWARD_BONUS',
    'PROFIT_SHARING','PROFIT_SHARING_BONUS','INCENTIVE_BONUS')), 0)
  - COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.type = 'ADJUSTMENT'
    AND t.reference_type = 'DRIVER_INCENTIVE_REVERSAL'), 0) AS total_bonus
FROM wallets w
LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
GROUP BY w.user_id, w.id, w.balance, w.cash_balance;

CREATE TEMP TABLE sim_result AS
SELECT
  b.*,
  GREATEST(b.total_bonus, 0) * 0.20                                         AS dikunci,
  LEAST(GREATEST(b.total_bonus, 0) * 0.20, GREATEST(b.cash_balance, 0))      AS dipindah,
  GREATEST(b.total_bonus, 0) * 0.20
    - LEAST(GREATEST(b.total_bonus, 0) * 0.20, GREATEST(b.cash_balance, 0))  AS kekurangan
FROM sim_bonus b
WHERE b.total_bonus > 0;

-- Mulai di sini database menolak setiap penulisan.
SET default_transaction_read_only = on;

\echo
\echo '=== 1. RINGKASAN ==='
SELECT
  (SELECT COUNT(*) FROM wallets)                                              AS dompet_total,
  COUNT(*)                                                                    AS pengguna_pernah_dapat_bonus,
  COUNT(*) FILTER (WHERE dipindah > 0)                                        AS pengguna_terdampak,
  ROUND(SUM(total_bonus), 0)                                                  AS total_bonus_pernah_masuk,
  ROUND(SUM(dikunci), 0)                                                      AS total_seharusnya_dikunci,
  ROUND(SUM(dipindah), 0)                                                     AS total_benar_benar_dipindah,
  ROUND(SUM(kekurangan), 0)                                                   AS total_kekurangan_tidak_ditagih,
  ROUND((SELECT COALESCE(SUM(cash_balance), 0) FROM wallets), 0)              AS saldo_dapat_ditarik_sekarang,
  ROUND((SELECT COALESCE(SUM(cash_balance), 0) FROM wallets) - COALESCE(SUM(dipindah), 0), 0)
                                                                              AS saldo_dapat_ditarik_sesudah
FROM sim_result;

\echo
\echo '=== 2. SEBARAN PENGGUNA ==='
SELECT
  CASE
    WHEN kekurangan = 0 THEN 'A. penuh (saldo cukup untuk seluruh 20%)'
    WHEN dipindah  > 0 THEN 'B. sebagian (saldo kurang dari 20%)'
    ELSE                    'C. tidak bisa (saldo dapat ditarik = 0)'
  END                         AS kelompok,
  COUNT(*)                    AS pengguna,
  ROUND(SUM(dikunci), 0)      AS seharusnya_dikunci,
  ROUND(SUM(dipindah), 0)     AS dipindah,
  ROUND(SUM(kekurangan), 0)   AS kekurangan
FROM sim_result
GROUP BY 1
ORDER BY 1;

\echo
\echo '=== 3. DAMPAK TERBESAR (nomor HP dan nama disamarkan) ==='
SELECT
  LEFT(u.phone, 4) || '****' || RIGHT(u.phone, 3)         AS nomor,
  LEFT(u."fullName", 1) || REPEAT('*', GREATEST(LENGTH(u."fullName") - 1, 0)) AS nama,
  u.role,
  ROUND(r.total_bonus, 0)    AS total_bonus,
  ROUND(r.cash_balance, 0)   AS dapat_ditarik_sekarang,
  ROUND(r.dipindah, 0)       AS dipindah,
  ROUND(r.kekurangan, 0)     AS kekurangan
FROM sim_result r
JOIN users u ON u.id = r.user_id
ORDER BY r.dipindah DESC, r.kekurangan DESC
LIMIT 15;

\echo
\echo '=== 5. PERKIRAAN DEPOSIT PRIBADI YANG SUDAH ADA (untuk fitur tarik deposit) ==='
-- Saldo non-tarik sekarang = balance - cash_balance; terdiri dari top up, transfer masuk, pengembalian dana, dsb.
-- Perkiraan konservatif deposit = MIN(saldo non-tarik, total top up yang pernah masuk). Bukan angka pembukuan pasti;
-- ia hanya menunjukkan besarnya kewajiban jika seluruh deposit lama dibuka untuk ditarik.
WITH noncash AS (
  SELECT w.id, GREATEST(w.balance - w.cash_balance, 0) AS non_cash,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'TOPUP'), 0) AS total_topup
  FROM wallets w LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
  GROUP BY w.id, w.balance, w.cash_balance
)
SELECT
  COUNT(*) FILTER (WHERE non_cash > 0)                                   AS dompet_punya_saldo_non_tarik,
  ROUND(SUM(non_cash), 0)                                                AS total_saldo_non_tarik,
  COUNT(*) FILTER (WHERE LEAST(non_cash, total_topup) > 0)               AS dompet_punya_perkiraan_deposit,
  ROUND(SUM(LEAST(non_cash, total_topup)), 0)                            AS total_perkiraan_deposit
FROM noncash;

\echo
\echo '=== 4. PENGECEKAN KEWARASAN DATA (harus 0 baris bermasalah) ==='
SELECT
  COUNT(*) FILTER (WHERE cash_balance > balance)   AS dompet_cash_melebihi_balance,
  COUNT(*) FILTER (WHERE cash_balance < 0)          AS dompet_cash_negatif,
  COUNT(*) FILTER (WHERE balance < 0)               AS dompet_balance_negatif
FROM wallets;

