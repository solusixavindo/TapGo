import { env } from "../../../config/env.js";

/**
 * Kanal pembelian membership.
 *
 * Stage R2.6 jalur A: pembelian terjadi di web, sementara aplikasi mobile hanya
 * menampilkan status paket aktif. Pemisahan kanal dibuat eksplisit di sini agar
 * satu keputusan kebijakan tidak tersebar sebagai pemeriksaan env di banyak
 * controller — yang justru menjadi sebab pencairan saldo dulu ikut terbuka
 * bersama pembelian membership.
 */
export type MembershipPurchaseChannel = "WEB" | "APP" | "ADMIN";

/**
 * Master switch. Bila false, seluruh kanal pembelian mati apa pun nilai flag
 * kanalnya. Mempertahankan perilaku deployment yang sudah ada.
 */
export function membershipPurchaseMasterEnabled(): boolean {
  return env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
}

/** Apakah kanal tertentu boleh melakukan pembelian membership. */
export function membershipPurchaseEnabled(
  channel: MembershipPurchaseChannel,
): boolean {
  if (!membershipPurchaseMasterEnabled()) {
    return false;
  }
  switch (channel) {
    case "WEB":
      return env.MEMBERSHIP_PURCHASE_WEB_ENABLED;
    case "APP":
      return env.MEMBERSHIP_PURCHASE_APP_ENABLED;
    case "ADMIN":
      // Konfirmasi pembayaran manual oleh admin mengikuti master switch saja;
      // ia bukan kanal yang dipakai pengguna akhir.
      return true;
  }
}

/**
 * Apakah paket berbayar boleh ditampilkan pada kanal tertentu.
 *
 * Menampilkan daftar harga di aplikasi mobile tanpa jalan membeli justru
 * mengundang pertanyaan anti-steering, jadi visibilitas mengikuti kanal yang
 * sama dengan pembeliannya.
 */
export function paidMembershipVisible(
  channel: MembershipPurchaseChannel,
): boolean {
  return membershipPurchaseEnabled(channel);
}

/** Pencairan saldo wallet. Sengaja TIDAK terkait pembelian membership. */
export function walletCashOutEnabled(): boolean {
  return env.WALLET_CASH_OUT_ENABLED;
}
