import type { Metadata } from "next";
import { PREVIEW_MODE } from "./api";
import LoginForm from "./login-form";
import { UpgradeShell } from "./upgrade-shell";

export const metadata: Metadata = {
  title: "Upgrade Membership — Masuk",
  description:
    "Masuk dengan nomor HP dan password akun TapGo Anda untuk mengurus upgrade membership.",
  robots: { index: false, follow: false }
};

export default function UpgradeLoginPage() {
  return (
    <UpgradeShell
      step="masuk"
      preview={PREVIEW_MODE}
      title="Masuk untuk mengurus membership"
      subtitle="Gunakan nomor HP dan password yang sama dengan aplikasi TapGo. Tidak perlu membuat akun baru."
    >
      <LoginForm />
    </UpgradeShell>
  );
}
