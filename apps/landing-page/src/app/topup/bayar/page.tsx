import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { TopUpShell } from "../topup-shell";
import PaymentSummary from "./payment-summary";

export const metadata: Metadata = {
  title: "Top Up TapGoPay — Transfer atau QRIS",
  robots: { index: false, follow: false }
};

export default function TopUpPaymentPage() {
  return (
    <TopUpShell
      step="bayar"
      preview={PREVIEW_MODE}
      title="Transfer atau QRIS ke TapGo"
      subtitle="Bayar sesuai nominal di bawah lewat transfer bank atau QRIS. Saldo bertambah setelah tim TapGo mengonfirmasi pembayaran Anda."
    >
      <PaymentSummary />
    </TopUpShell>
  );
}
