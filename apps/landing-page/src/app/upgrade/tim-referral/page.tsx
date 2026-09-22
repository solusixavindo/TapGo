import type { Metadata } from "next";
import { Suspense } from "react";
import { PREVIEW_MODE } from "../api";
import { UpgradeShell } from "../upgrade-shell";
import ReferralTeam from "./referral-team";

export const metadata: Metadata = {
  title: "Upgrade Membership — Referral",
  robots: { index: false, follow: false }
};

export default function UpgradeReferralTeamPage() {
  return (
    <UpgradeShell
      step="tim-referral"
      preview={PREVIEW_MODE}
      title="Daftar Referral"
      subtitle="Anggota yang bergabung lewat kode referral Anda, dikelompokkan per tingkat."
    >
      <Suspense fallback={<p className="text-sm font-semibold themed-text-muted">Memuat tim referral…</p>}>
        <ReferralTeam />
      </Suspense>
    </UpgradeShell>
  );
}
