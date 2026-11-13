-- Kunci 20% bonus membership dan penarikan deposit (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4).
-- Hanya menambah kolom berbawaan 0 dan batasan pemeriksa; TIDAK mengubah saldo apa pun. Perilaku baru dikendalikan
-- bendera BONUS_LOCK_ENABLED (bawaan mati), jadi aman dipasang lebih dulu.

ALTER TABLE "wallets"
  ADD COLUMN "locked_bonus_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deposit_balance"      DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Invarian pembukuan ditegakkan database: tidak ada kantong negatif, dan jumlah kantong yang tercatat tidak pernah
-- melebihi saldo total (selisihnya = "lain-lain": transfer masuk, pengembalian dana, penyesuaian).
ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_locked_bonus_nonneg" CHECK ("locked_bonus_balance" >= 0),
  ADD CONSTRAINT "wallets_deposit_nonneg"      CHECK ("deposit_balance" >= 0),
  ADD CONSTRAINT "wallets_buckets_within_balance"
    CHECK ("cash_balance" + "locked_bonus_balance" + "deposit_balance" <= "balance");

CREATE TYPE "WithdrawalSource" AS ENUM ('CASH', 'DEPOSIT');
ALTER TABLE "withdrawals" ADD COLUMN "source" "WithdrawalSource" NOT NULL DEFAULT 'CASH';
