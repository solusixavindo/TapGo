import type { Metadata } from "next";
import { Reveal } from "../reveal";

export const metadata: Metadata = {
  title: "Contact",
  description: "Kontak resmi PT. TapGo Lion Indonesia."
};

export default function Contact() {
  return (
    <main data-themed="true" className="min-h-screen px-5 py-10 themed-text">
      <div className="mx-auto max-w-4xl">
        <Reveal className="themed-glass mt-2 rounded-[2rem] p-8 md:p-12">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Contact</p>
          <h1 className="mt-3 text-4xl font-black themed-text md:text-6xl">PT. TapGo Lion Indonesia</h1>
          <div className="mt-8 grid gap-3 text-lg font-semibold themed-text-secondary">
            <p>Website: https://tapgolion.id</p>
            <p>Email: <a className="text-brand-gold" href="mailto:support@tapgolion.id">support@tapgolion.id</a></p>
            <p>WhatsApp: +62 838-0025-5588</p>
            <p>Area layanan: Indonesia</p>
          </div>
          <div className="mt-8 leading-7 themed-text-muted">
            <p>PT. TapGo Lion Indonesia</p>
            <p>Jalan Kp. Pasir Gendok No. 11</p>
            <p>Desa Bojongleles</p>
            <p>Kecamatan Rangkasbitung</p>
            <p>Kabupaten Lebak</p>
            <p>Banten</p>
            <p>Indonesia</p>
          </div>
          <a
            href="https://wa.me/6283800255588?text=Halo%20TapGo%20Lion%2C%20saya%20ingin%20mendapatkan%20informasi%20mengenai%20membership%20TapGo."
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-brand-green px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-1"
          >
            Chat WhatsApp
          </a>
          <div className="themed-surface mt-10 rounded-3xl p-6 text-sm leading-7 themed-text-secondary">
            TapGo adalah platform membership digital dan peluang usaha berbasis teknologi. TapGo bukan investasi, bukan pinjaman online, bukan penghimpunan dana masyarakat, dan tidak menjanjikan keuntungan.
          </div>
        </Reveal>
      </div>
    </main>
  );
}
