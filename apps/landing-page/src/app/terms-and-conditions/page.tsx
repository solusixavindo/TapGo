import type { Metadata } from "next";
import { LegalShell } from "../shared";

export const metadata: Metadata = {
  title: "Terms & Conditions | TapGo",
  description: "Syarat dan Ketentuan penggunaan TapGo oleh PT. TapGo Lion Indonesia."
};

export default function TermsAndConditions() {
  return (
    <LegalShell title="Terms & Conditions" updated="11 Juni 2026">
      <p>
        Dengan menggunakan TapGo, pengguna menyetujui syarat dan ketentuan yang ditetapkan oleh PT.
        TapGo Lion Indonesia. Layanan TapGo mencakup membership, referral reward, PPOB benefit,
        wallet aplikasi, invoice, pembayaran, dan layanan pendukung lainnya.
      </p>

      <h2>Penggunaan Aplikasi</h2>
      <p>
        Pengguna wajib memberikan data yang benar, menjaga keamanan akun, dan menggunakan TapGo
        hanya untuk tujuan yang sah. TapGo dapat meninjau atau membatasi akun yang terindikasi
        melanggar ketentuan.
      </p>

      <h2>Membership</h2>
      <p>
        Membership TapGo dapat terdiri dari Basic, Silver, Gold, dan Platinum. Setiap paket memiliki
        biaya, benefit, PPOB benefit, dan syarat aktivasi yang berbeda. Aktivasi membership mengikuti
        status pembayaran, persetujuan, dan validasi sistem TapGo.
      </p>

      <h2>Referral, Reward, dan Komisi</h2>
      <p>
        Referral reward, reward membership, dan komisi sesuai syarat diberikan berdasarkan aturan
        TapGo, status akun, relasi referral yang valid, pembayaran yang berhasil, serta pemeriksaan
        anti-penyalahgunaan. TapGo tidak menjanjikan hasil tetap; seluruh reward bergantung pada
        kelayakan dan validasi transaksi.
      </p>

      <h2>PPOB dan Wallet</h2>
      <p>
        PPOB benefit merupakan benefit aplikasi sesuai paket dan terpisah dari cash wallet kecuali
        dinyatakan lain di aplikasi. Wallet aplikasi digunakan untuk mencatat saldo dan transaksi
        yang memenuhi syarat. Withdrawal mengikuti validasi saldo, rekening bank, keamanan, dan
        proses admin.
      </p>

      <h2>Pembayaran via Midtrans</h2>
      <p>
        Pembayaran membership dapat diproses melalui Midtrans atau penyedia pembayaran resmi lain.
        Membership, reward, dan benefit hanya diproses setelah pembayaran terkonfirmasi melalui
        backend TapGo. Pembayaran pending, gagal, expired, dibatalkan, atau tidak tervalidasi tidak
        mengaktifkan benefit.
      </p>

      <h2>Refund dan Cancel</h2>
      <p>
        Permintaan refund, pembatalan, atau reversal ditinjau berdasarkan status pembayaran, status
        membership, penggunaan benefit, risiko fraud, dan kebijakan operasional. TapGo dapat
        menahan, menolak, membatalkan, atau menyesuaikan transaksi yang melanggar ketentuan.
      </p>

      <h2>Larangan Penyalahgunaan</h2>
      <p>
        Pengguna dilarang memalsukan identitas, membuat akun manipulatif, menyalahgunakan referral,
        memanipulasi wallet, payment, reward, atau withdrawal, mengganggu sistem, atau menggunakan
        layanan untuk aktivitas ilegal.
      </p>

      <h2>Perubahan Ketentuan</h2>
      <p>
        TapGo dapat memperbarui layanan, benefit, biaya, proses operasional, atau ketentuan ini.
        Pembaruan akan disampaikan melalui aplikasi, website, atau kanal resmi jika diperlukan.
      </p>

      <h2>Kontak Resmi</h2>
      <p>
        PT. TapGo Lion Indonesia dapat dihubungi melalui support@tapgolion.id, WhatsApp +62
        838-0025-5588, atau website resmi https://tapgolion.id.
      </p>
    </LegalShell>
  );
}
