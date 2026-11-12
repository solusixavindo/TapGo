import type { Metadata } from "next";
import Link from "../hard-nav";
import RecoverForm from "./recover-form";

export const metadata: Metadata = {
  title: "Pulihkan Akun TapGo",
  description: "Pulihkan akun TapGo yang lupa password memakai kode dari Admin TapGo.",
  robots: { index: false, follow: false }
};

export default function RecoverAccountPage() {
  return (
    <main data-themed="true" className="themed-text min-h-screen px-5 py-10">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="themed-accent text-sm font-bold">
          Kembali ke Home
        </Link>

        <div className="themed-border themed-card-bg mt-6 rounded-[2rem] border p-6 md:p-10">
          <div className="flex items-center gap-3">
            <img src="/images/tapgo-mark.png" alt="TapGo Lion" className="h-11 w-11" />
            <div>
              <p className="themed-accent text-[11px] font-bold uppercase tracking-[0.22em]">Pulihkan Akun</p>
              <p className="themed-text text-sm font-bold">PT. TapGo Lion Indonesia</p>
            </div>
          </div>

          <h1 className="themed-text mt-7 text-3xl font-black leading-tight">Lupa password? Pulihkan di sini</h1>
          <p className="themed-text-muted mt-3 text-sm leading-7">
            Untuk akun yang tidak bisa dipulihkan lewat email, Admin TapGo memberikan <strong>kode 6 digit</strong> setelah memastikan
            bahwa Anda pemilik akun. Hubungi admin lewat WhatsApp{" "}
            <a href="https://wa.me/6283800255588" className="themed-accent font-bold" rel="noopener noreferrer">
              +62 838-0025-5588
            </a>{" "}
            dari nomor yang terdaftar di akun Anda, lalu masukkan kodenya di bawah ini.
          </p>

          <div className="mt-8">
            <RecoverForm />
          </div>
        </div>

        <p className="themed-text-muted mx-auto mt-6 max-w-md text-center text-xs leading-6">
          Kode hanya berlaku 30 menit dan sekali pakai. TapGo tidak pernah meminta password Anda.
        </p>
      </div>
    </main>
  );
}
