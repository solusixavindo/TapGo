import type { Metadata } from "next";
import DeleteAccountForm from "./delete-account-form";

export const metadata: Metadata = {
  title: "Hapus Akun TapGo Lion",
  description: "Ajukan permintaan penghapusan akun TapGo Lion melalui halaman resmi PT. TapGo Lion Indonesia."
};

const erasableData = [
  "Nama",
  "Nomor HP",
  "Email jika ada",
  "Alamat",
  "Data profil",
  "Data referral yang tidak wajib disimpan",
  "Data wallet non-transaksi jika memungkinkan"
];

const retainedData = [
  "Invoice",
  "Transaksi pembayaran",
  "Riwayat withdrawal",
  "Data yang diwajibkan oleh hukum, perpajakan, keamanan, audit, atau penyelesaian administrasi"
];

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-brand-green" viewBox="0 0 20 20" fill="none">
      <path d="M4 10.5 8.2 14 16 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function DeleteAccountPage() {
  return (
    <main data-themed="true" className="themed-text min-h-screen px-5 py-8">
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <a href="/" className="themed-text flex items-center gap-3 font-bold" aria-label="TapGo Lion Indonesia">
          <img src="/images/tapgo-mark.png" alt="TapGo Lion" className="h-10 w-10 object-contain" />
          <span>TapGo Lion</span>
        </a>
        <a href="/" className="themed-border themed-fill themed-text rounded-full border px-5 py-2.5 text-sm font-bold shadow-sm transition hover:-translate-y-0.5 hover:border-brand-gold/40 hover:text-[var(--themed-accent-gold)]">
          Beranda
        </a>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-8 py-12 lg:grid-cols-[0.92fr_1.08fr] lg:py-16">
        <div>
          <div className="themed-glass rounded-[2rem] p-7 md:p-10">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Delete Account</p>
            <h1 className="themed-text mt-4 text-4xl font-black tracking-tight md:text-6xl">
              Permintaan Hapus Akun TapGo
            </h1>
            <p className="themed-text-secondary mt-5 text-lg leading-8">
              Pengguna TapGo dapat mengajukan permintaan penghapusan akun dan data pribadi melalui halaman ini.
            </p>
          </div>

          <div className="mt-5 grid gap-5">
            <article className="rounded-[1.6rem] themed-border themed-card-bg border p-6">
              <h2 className="themed-text text-2xl font-black">Tentang penghapusan akun</h2>
              <p className="themed-text-secondary mt-4 leading-7">
                Pengguna dapat meminta penghapusan atau penonaktifan akun TapGo. Proses dilakukan dengan verifikasi untuk menjaga keamanan data, riwayat transaksi, dan kewajiban administrasi.
              </p>
            </article>

            <article className="rounded-[1.6rem] themed-border themed-card-bg border p-6">
              <h2 className="themed-text text-2xl font-black">Estimasi proses</h2>
              <p className="themed-text-secondary mt-4 leading-7">
                Permintaan akan diproses dalam waktu maksimal 7-14 hari kerja setelah data berhasil diverifikasi.
              </p>
            </article>
          </div>
        </div>

        <DeleteAccountForm />
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 pb-16 lg:grid-cols-2">
        <article className="rounded-[1.6rem] themed-border themed-card-bg border p-6">
          <h2 className="themed-text text-2xl font-black">Data yang dapat dihapus</h2>
          <ul className="themed-text-secondary mt-5 space-y-3">
            {erasableData.map((item) => (
              <li key={item} className="flex gap-3"><CheckIcon />{item}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-[1.6rem] themed-border themed-card-bg border p-6">
          <h2 className="themed-text text-2xl font-black">Data yang mungkin tetap disimpan</h2>
          <ul className="themed-text-secondary mt-5 space-y-3">
            {retainedData.map((item) => (
              <li key={item} className="flex gap-3"><CheckIcon />{item}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-[1.6rem] themed-border themed-card-bg border p-6 lg:col-span-2">
          <h2 className="themed-text text-2xl font-black">Kontak resmi</h2>
          <div className="themed-text-secondary mt-5 grid gap-3 leading-7 sm:grid-cols-2">
            <p><strong>Perusahaan:</strong> PT. TapGo Lion Indonesia</p>
            <p><strong>Email:</strong> <a className="themed-accent font-bold" href="mailto:support@tapgolion.id">support@tapgolion.id</a></p>
            <p><strong>WhatsApp:</strong> +62 838-0025-5588</p>
            <p><strong>Website:</strong> https://tapgolion.id</p>
          </div>
        </article>
      </section>
    </main>
  );
}
