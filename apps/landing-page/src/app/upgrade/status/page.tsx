import type { Metadata } from "next";
import { Suspense } from "react";
import { PREVIEW_MODE } from "../api";
import { UpgradeShell } from "../upgrade-shell";
import OrderStatus from "./order-status";

export const metadata: Metadata = {
  title: "Upgrade Membership — Status",
  robots: { index: false, follow: false }
};

export default function UpgradeStatusPage() {
  return (
    <UpgradeShell
      step="status"
      preview={PREVIEW_MODE}
      title="Status pengajuan"
      subtitle="Halaman ini menampilkan status terkini dari server. Menutup halaman tidak membatalkan pengajuan Anda."
    >
      <Suspense fallback={<p className="text-sm font-semibold text-slate-500">Memuat status…</p>}>
        <OrderStatus />
      </Suspense>
    </UpgradeShell>
  );
}
