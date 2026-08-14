import type { Metadata } from "next";
import { PREVIEW_MODE } from "../api";
import { UpgradeShell } from "../upgrade-shell";
import PackagePicker from "./package-picker";

export const metadata: Metadata = {
  title: "Upgrade Membership — Pilih Paket",
  robots: { index: false, follow: false }
};

export default function UpgradePackagePage() {
  return (
    <UpgradeShell
      step="paket"
      preview={PREVIEW_MODE}
      title="Pilih paket membership"
      subtitle="Paket hanya dapat dinaikkan. Manfaat berlaku setelah dokumen Anda diverifikasi tim TapGo."
    >
      <PackagePicker />
    </UpgradeShell>
  );
}
