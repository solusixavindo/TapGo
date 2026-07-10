import { Router } from "express";

const company = "PT. TapGo Lion Indonesia";
const email = "support@tapgolion.id";
const whatsapp = "+62 838-0025-5588";
const address = "Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles, Kecamatan Rangkasbitung, Kabupaten Lebak, Banten, Indonesia";

export const legalRouter = Router();

legalRouter.get(["/privacy-policy", "/privacy"], (_req, res) => {
  res.type("html").send(page("Privacy Policy", `
    <p>${company} mengumpulkan dan memproses data pengguna untuk menjalankan layanan TapGo Membership, Referral, Wallet, PPOB, dan Withdrawal.</p>
    <h2>Data yang dikumpulkan</h2>
    <ul>
      <li>Nama, nomor HP, email jika tersedia, dan alamat.</li>
      <li>Nomor KTP, foto KTP, dan foto diri jika digunakan untuk verifikasi.</li>
      <li>Data rekening bank untuk withdrawal.</li>
      <li>Data referral, sponsor, downline, membership, invoice, pembayaran, wallet, komisi, reward, dan withdrawal.</li>
      <li>Pesan customer support dan permintaan penghapusan akun.</li>
    </ul>
    <h2>Tujuan penggunaan data</h2>
    <p>Data digunakan untuk registrasi member, verifikasi akun, pengelolaan membership, referral dan komisi, invoice dan transaksi, withdrawal, layanan pelanggan, audit, keamanan, dan kepatuhan hukum.</p>
    <h2>Penyimpanan dan keamanan</h2>
    <p>TapGo menerapkan autentikasi, pembatasan akses berbasis role, pencatatan transaksi, dan pengamanan database. Data transaksi penting dapat disimpan untuk audit, kepatuhan, dan penyelesaian kewajiban.</p>
    <h2>Hak penghapusan akun</h2>
    <p>Pengguna dapat mengajukan penghapusan atau penonaktifan akun melalui aplikasi TapGo atau halaman <a href="/legal/delete-account">Delete Account</a>. Permintaan ditinjau agar data transaksi penting tetap dikelola sesuai kewajiban hukum.</p>
    <h2>Kontak</h2>
    <p>Email: <a href="mailto:${email}">${email}</a><br>WhatsApp: ${whatsapp}<br>Alamat: ${address}</p>
  `));
});

legalRouter.get(["/terms-and-conditions", "/terms"], (_req, res) => {
  res.type("html").send(page("Terms & Conditions", `
    <p>Dengan menggunakan TapGo, pengguna menyetujui syarat layanan ${company}.</p>
    <h2>Paket Membership</h2>
    <ul>
      <li>Basic: gratis, registration bonus Rp5.000, sponsor bonus Rp2.000 sesuai ketentuan 1.000 user pertama.</li>
      <li>Silver: Rp500.000, PPOB Rp100.000, BPJS TK JKK/JKM, Hak Usaha.</li>
      <li>Gold: Rp3.000.000, PPOB Rp600.000, BPJS TK JKK/JKM, Hak Usaha.</li>
      <li>Platinum: Rp5.500.000, PPOB Rp1.000.000, BPJS TK JKK/JKM/JHT, Hak Usaha Mitra.</li>
    </ul>
    <h2>Bonus dan Referral</h2>
    <p>Bonus registration, sponsor, level, reward, dan profit sharing hanya diberikan jika syarat marketing plan terpenuhi dan transaksi tercatat sah di sistem TapGo.</p>
    <h2>Wallet, PPOB, dan Withdrawal</h2>
    <p>Saldo TapGoPay, PPOB, dan withdrawal mengikuti saldo ledger, minimum withdrawal, verifikasi rekening, serta approval admin. TapGo berhak menolak transaksi yang melanggar atau tidak valid.</p>
    <h2>Penyalahgunaan</h2>
    <p>Pengguna dilarang membuat akun palsu, memanipulasi referral, melakukan klaim ganda, atau menyalahgunakan sistem. Pelanggaran dapat menyebabkan pembatasan akun dan pembatalan bonus.</p>
    <h2>Perubahan layanan</h2>
    <p>${company} dapat memperbarui syarat layanan, benefit, dan kebijakan dengan pemberitahuan yang wajar.</p>
  `));
});

legalRouter.get("/delete-account", (_req, res) => {
  res.type("html").send(page("Delete Account", `
    <p>Pengguna TapGo dapat mengajukan penghapusan atau penonaktifan akun melalui menu Akun &gt; Hapus Akun di aplikasi TapGo.</p>
    <h2>Proses</h2>
    <ol>
      <li>Buka aplikasi TapGo dan login.</li>
      <li>Buka menu Akun &gt; Hapus Akun.</li>
      <li>Isi alasan opsional dan kirim pengajuan.</li>
      <li>Tim TapGo meninjau permintaan dengan status Pending, Approved, Rejected, atau Completed.</li>
    </ol>
    <p>Data transaksi penting seperti invoice, wallet ledger, komisi, dan withdrawal tidak langsung dihapus karena dapat diperlukan untuk audit, kepatuhan, dan penyelesaian kewajiban.</p>
    <p>Bantuan: <a href="mailto:${email}">${email}</a> atau WhatsApp ${whatsapp}.</p>
  `));
});

legalRouter.get(["/contact-us", "/contact"], (_req, res) => {
  res.type("html").send(page("Contact Us", `
    <p><strong>${company}</strong></p>
    <p>Email: <a href="mailto:${email}">${email}</a><br>WhatsApp: ${whatsapp}<br>Alamat: ${address}</p>
    <p>Untuk bantuan akun, membership, referral, wallet, invoice, withdrawal, atau penghapusan akun, hubungi support resmi TapGo melalui kontak di atas.</p>
  `));
});

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - TapGo</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f8fb; color: #172033; line-height: 1.6; }
    main { max-width: 860px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #eaf0f6; border-radius: 18px; padding: 24px; }
    h1 { color: #06284a; margin-top: 0; }
    h2 { color: #0a2a43; margin-top: 28px; }
    a { color: #0569e8; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${title}</h1>
      ${body}
    </article>
  </main>
</body>
</html>`;
}

