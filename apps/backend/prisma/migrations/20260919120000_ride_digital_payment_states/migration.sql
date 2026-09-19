-- Status pembayaran TapGoPay untuk perjalanan (tahan, lunas, kembali).
ALTER TYPE "RidePaymentState" ADD VALUE IF NOT EXISTS 'DIGITAL_HELD';
ALTER TYPE "RidePaymentState" ADD VALUE IF NOT EXISTS 'DIGITAL_PAID';
ALTER TYPE "RidePaymentState" ADD VALUE IF NOT EXISTS 'DIGITAL_REFUNDED';
