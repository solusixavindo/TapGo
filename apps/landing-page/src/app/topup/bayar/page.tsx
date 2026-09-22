import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { TopUpShell } from "../topup-shell";
import PaymentSummary from "./payment-summary";

export const metadata: Metadata = {
  title: "Top Up TapGoPay — Pembayaran",
  robots: { index: false, follow: false }
};

export default function TopUpPaymentPage() {
  return (
    <TopUpShell
      step="bayar"
      preview={PREVIEW_MODE}
      title="Periksa dan bayar"
      subtitle="Pembayaran diproses payment gateway. Saldo bertambah otomatis begitu pembayaran diterima."
    >
      <PaymentSummary />
    </TopUpShell>
  );
}
