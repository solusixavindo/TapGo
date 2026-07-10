import type { Metadata } from "next";
import { Suspense } from "react";
import RegisterForm from "./register-form";

export const metadata: Metadata = {
  title: "Daftar Membership TapGo Lion",
  description: "Daftar membership TapGo Lion dan pilih paket keanggotaan Basic, Silver, Gold, atau Platinum."
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-mist" />}>
      <RegisterForm />
    </Suspense>
  );
}
