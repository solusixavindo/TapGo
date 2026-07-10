import type { Metadata } from "next";
import { LegalShell } from "../shared";

export const metadata: Metadata = {
  title: "Privacy Policy | TapGo",
  description: "Kebijakan Privasi TapGo oleh PT. TapGo Lion Indonesia."
};

export default function PrivacyPolicy() {
  return (
    <LegalShell title="Privacy Policy" updated="11 Juni 2026">
      <p>
        PT. TapGo Lion Indonesia menghormati privasi pengguna TapGo. Kebijakan ini menjelaskan data
        yang dikumpulkan, tujuan penggunaan, penyimpanan, keamanan, pihak ketiga, serta cara
        pengguna menghubungi TapGo untuk permintaan data atau penghapusan akun.
      </p>

      <h2>Data yang Dikumpulkan</h2>
      <p>
        TapGo dapat mengumpulkan nama, nomor HP, data akun, kode referral, relasi sponsor atau
        downline, status membership, data wallet aplikasi, PPOB benefit, riwayat transaksi, invoice,
        withdrawal, pesan kontak, dan permintaan dukungan.
      </p>

      <h2>Tujuan Penggunaan Data</h2>
      <p>
        Data digunakan untuk registrasi, login, keamanan akun, pengelolaan membership, referral
        reward, komisi sesuai syarat, wallet aplikasi, PPOB benefit, invoice, pembayaran,
        withdrawal, dukungan pelanggan, pencegahan penyalahgunaan, dan pencatatan operasional.
      </p>

      <h2>Penyimpanan Data</h2>
      <p>
        Data disimpan selama diperlukan untuk menjalankan layanan TapGo, memenuhi kewajiban hukum,
        menyelesaikan sengketa, menjaga keamanan, serta menyimpan catatan transaksi, wallet,
        invoice, withdrawal, dan audit operasional.
      </p>

      <h2>Keamanan Data</h2>
      <p>
        TapGo menerapkan perlindungan yang wajar, termasuk password hash, autentikasi token, kontrol
        akses berbasis role, komunikasi API yang aman, dan monitoring operasional. Tidak ada sistem
        elektronik yang bebas risiko sepenuhnya, tetapi TapGo berupaya menjaga data dari akses tidak
        sah.
      </p>

      <h2>Pihak Ketiga</h2>
      <p>
        TapGo dapat menggunakan Midtrans untuk pemrosesan pembayaran membership. TapGo juga dapat
        menggunakan layanan Google atau Firebase jika diaktifkan untuk notifikasi, diagnostik,
        crash reporting, analitik, atau layanan platform. Pihak ketiga hanya menerima data yang
        diperlukan untuk menjalankan layanan terkait.
      </p>

      <h2>Penghapusan Akun</h2>
      <p>
        Pengguna dapat meminta akses, koreksi, atau penghapusan data yang memenuhi syarat melalui
        support@tapgolion.id atau kanal resmi TapGo. TapGo dapat tetap menyimpan catatan transaksi,
        invoice, wallet, withdrawal, pajak, audit, atau hukum yang wajib dipertahankan sesuai
        ketentuan.
      </p>

      <h2>Kontak</h2>
      <p>
        PT. TapGo Lion Indonesia dapat dihubungi melalui email support@tapgolion.id, WhatsApp +62
        838-0025-5588, atau website resmi https://tapgolion.id.
      </p>
    </LegalShell>
  );
}
