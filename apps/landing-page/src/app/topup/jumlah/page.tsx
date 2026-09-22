import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { TopUpShell } from "../topup-shell";
import AmountForm from "./amount-form";

export const metadata: Metadata = {
  title: "Top Up TapGoPay — Jumlah",
  robots: { index: false, follow: false }
};

export default function TopUpAmountPage() {
  return (
    <TopUpShell
      step="jumlah"
      preview={PREVIEW_MODE}
      title="Berapa yang mau diisi?"
      subtitle="Pilih nominal cepat atau masukkan jumlah sendiri."
    >
      <AmountForm />
    </TopUpShell>
  );
}
