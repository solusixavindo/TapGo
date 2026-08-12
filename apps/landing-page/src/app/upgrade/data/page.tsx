import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { UpgradeShell } from "../upgrade-shell";
import RegistrationForm from "./registration-form";

export const metadata: Metadata = {
  title: "Upgrade Membership — Data & Dokumen",
  robots: { index: false, follow: false }
};

export default function UpgradeDataPage() {
  return (
    <UpgradeShell
      step="data"
      preview={PREVIEW_MODE}
      title="Lengkapi data dan dokumen"
      subtitle="Dokumen identitas dipakai untuk verifikasi keanggotaan. Tim TapGo memeriksanya setelah pembayaran diterima."
    >
      <RegistrationForm />
    </UpgradeShell>
  );
}
