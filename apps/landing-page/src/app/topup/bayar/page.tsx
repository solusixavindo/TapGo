import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { TopUpShell } from "../topup-shell";
import PaymentSummary from "./payment-summary";

export const metadata: Metadata = {
  title: "Top Up TapGoPay — Transfer Bank",
  robots: { index: false, follow: false }
};

export default function TopUpPaymentPage() {
  return (
    <TopUpShell
      step="bayar"
      preview={PREVIEW_MODE}
      title="Transfer ke rekening TapGo"
      subtitle="Transfer sesuai nominal di bawah. Saldo bertambah setelah tim TapGo mengonfirmasi transfer Anda."
    >
      <PaymentSummary />
    </TopUpShell>
  );
}
