import type { Metadata } from "next";
import { PREVIEW_MODE } from "./api";
import { TopUpShell } from "./topup-shell";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Top Up TapGoPay — Masuk",
  robots: { index: false, follow: false }
};

export default function TopUpLoginPage() {
  return (
    <TopUpShell
      step="masuk"
      preview={PREVIEW_MODE}
      title="Masuk ke akun TapGo"
      subtitle="Gunakan nomor HP dan password akun TapGo Anda untuk mengisi saldo TapGoPay."
    >
      <LoginForm />
    </TopUpShell>
  );
}
