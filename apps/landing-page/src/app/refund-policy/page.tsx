import type { Metadata } from "next";
import { LegalShell } from "../shared";

export const metadata: Metadata = {
  title: "Refund/Cancellation Policy",
  description: "Kebijakan refund dan pembatalan membership TapGo Lion."
};

export default function RefundPolicy() {
  return (
    <LegalShell title="Refund/Cancellation Policy" updated="4 Juni 2026">
      <p>Kebijakan ini menjelaskan kondisi refund atau pembatalan pembayaran membership TapGo.</p>
      <h2>Pembayaran Membership</h2>
      <p>Pembayaran membership diproses melalui kanal resmi perusahaan atau payment gateway. Pengguna wajib memastikan paket dan data akun sudah benar sebelum melakukan pembayaran.</p>
      <h2>Kondisi Refund Jika Berlaku</h2>
      <p>Refund dapat dipertimbangkan jika terjadi pembayaran ganda, kesalahan nominal yang terverifikasi, atau transaksi gagal yang dananya tetap terdebit.</p>
      <h2>Pembayaran yang Sudah Diproses</h2>
      <p>Pembayaran yang sudah berhasil diproses, manfaat membership telah aktif, saldo telah digunakan, atau paket sudah dinikmati dapat tidak memenuhi syarat refund.</p>
      <h2>Pengecualian Refund</h2>
      <p>Refund tidak berlaku untuk penyalahgunaan akun, data palsu, pelanggaran ketentuan, perubahan keputusan pribadi setelah manfaat aktif, atau transaksi di luar kanal resmi.</p>
      <h2>Cara Menghubungi Support</h2>
      <p>Kirim permintaan ke support@tapgolion.id atau WhatsApp +62 838-0025-5588 dengan nama, nomor telepon, bukti pembayaran, tanggal transaksi, nominal, dan alasan permintaan. Tim support akan melakukan verifikasi sesuai prosedur perusahaan.</p>
    </LegalShell>
  );
}
