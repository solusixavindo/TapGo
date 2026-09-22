import type { Metadata } from "next";
import MitraDashboard from "./mitra-dashboard";

export const metadata: Metadata = {
  title: "Dashboard Mitra",
  description:
    "Kelola saldo, tarik dana, pantau komisi, dan pantau referral Anda sebagai mitra TapGo Lion.",
  robots: { index: false, follow: false }
};

export default function MitraPage() {
  return (
    <main data-themed="true" className="min-h-screen px-4 py-8 themed-text sm:px-6 md:py-10">
      <MitraDashboard />
    </main>
  );
}
