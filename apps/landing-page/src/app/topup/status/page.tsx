import type { Metadata } from "next";
import { Suspense } from "react";
import { PREVIEW_MODE } from "../api";
import { TopUpShell } from "../topup-shell";
import OrderStatus from "./order-status";

export const metadata: Metadata = {
  title: "Top Up TapGoPay — Status",
  robots: { index: false, follow: false }
};

export default function TopUpStatusPage() {
  return (
    <TopUpShell
      step="status"
      preview={PREVIEW_MODE}
      title="Status top up"
      subtitle="Halaman ini menampilkan status terkini dari server. Menutup halaman tidak membatalkan pembayaran Anda."
    >
      <Suspense fallback={<p className="text-sm font-semibold themed-text-muted">Memuat status…</p>}>
        <OrderStatus />
      </Suspense>
    </TopUpShell>
  );
}
