import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { UpgradeShell } from "../upgrade-shell";
import PaymentSummary from "./payment-summary";

export const metadata: Metadata = {
  title: "Upgrade Membership — Pembayaran",
  robots: { index: false, follow: false }
};

export default function UpgradePaymentPage() {
  return (
    <UpgradeShell
      step="bayar"
      preview={PREVIEW_MODE}
      title="Periksa dan bayar"
      subtitle="Pembayaran diproses payment gateway. Manfaat membership aktif setelah dokumen Anda diverifikasi."
    >
      <PaymentSummary />
    </UpgradeShell>
  );
}
