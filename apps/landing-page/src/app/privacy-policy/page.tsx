import type { Metadata } from "next";
import { LegalShell } from "../shared";

export const metadata: Metadata = {
  title: "Privacy Policy | TapGo",
  description: "Kebijakan Privasi TapGo oleh PT. TapGo Lion Indonesia.",
  alternates: { canonical: "/privacy-policy/" }
};

export default function PrivacyPolicy() {
  return (
    <LegalShell title="Privacy Policy" updated="13 Oktober 2026">
      <p>
        PT. TapGo Lion Indonesia menghormati privasi pengguna TapGo. Kebijakan ini menjelaskan data
        yang dikumpulkan oleh aplikasi TapGo Penumpang untuk Android, aplikasi TapGo Driver untuk
        Android, dan oleh situs https://tapgolion.id, tujuan penggunaan, penyimpanan, keamanan,
        pihak ketiga, serta cara pengguna menghubungi TapGo untuk permintaan data atau penghapusan
        akun. TapGo tidak menjual data pribadi pengguna.
      </p>

      <h2>Data yang Dikumpulkan oleh Aplikasi TapGo Penumpang (Android)</h2>
      <p>
        Aplikasi mengumpulkan nama, nomor HP, email (bila ditambahkan pengguna), dan password yang
        disimpan dalam bentuk hash. Aplikasi mengumpulkan lokasi perangkat (presisi atau perkiraan)
        hanya saat pengguna memakai layanan Ojek Online (TapGo Ride/TapGo Car), untuk mencocokkan
        perjalanan dan menampilkan titik jemput, tujuan, serta posisi driver; aplikasi tidak
        melacak lokasi saat layanan itu tidak dipakai. Aplikasi juga menyimpan riwayat saldo
        TapGoPay, transfer, dan pembelian PPOB, pesan chat dengan driver selama perjalanan aktif
        (dapat dibaca hingga 7 hari setelah perjalanan selesai dan dibalas hingga 2 jam setelahnya),
        tiket bantuan, serta foto profil yang diunggah pengguna secara sukarela melalui kamera atau
        galeri. Untuk keamanan akun, aplikasi mengirim ID dan sidik perangkat serta versi aplikasi.
      </p>
      <p>
        Aplikasi TapGo Penumpang <strong>tidak</strong> mengumpulkan KTP maupun swafoto verifikasi
        wajah — persyaratan itu hanya berlaku untuk mitra driver, lihat bagian TapGo Driver di
        bawah.
      </p>

      <h2>Data yang Dikumpulkan oleh Aplikasi TapGo Driver (Android)</h2>
      <p>
        Aplikasi mitra driver mengumpulkan nama, nomor HP, email (bila ditambahkan), dan password
        dalam bentuk hash, sama seperti aplikasi penumpang. Karena sifat pekerjaannya, aplikasi ini
        mengumpulkan data tambahan yang <strong>tidak</strong> diminta dari penumpang:
      </p>
      <p>
        <strong>Lokasi latar depan selama online.</strong> Selama driver berstatus ONLINE atau
        sedang menjalankan perjalanan, aplikasi mengirim lokasi perangkat secara berkala ke server
        — termasuk saat layar terkunci, lewat layanan latar depan Android dengan notifikasi tetap
        yang selalu terlihat ("Anda online"). Lokasi berhenti dikirim segera setelah driver
        berstatus OFFLINE. Aplikasi ini <strong>tidak</strong> meminta maupun memakai izin lokasi
        latar belakang (background location) — pengiriman lokasi hanya berjalan selama layanan
        latar depan tersebut aktif.
      </p>
      <p>
        <strong>Verifikasi wajah harian.</strong> Sebelum mengaktifkan status online, aplikasi dapat
        meminta driver mengambil swafoto lewat kamera depan untuk pemeriksaan liveness (mata
        terbuka, satu wajah, framing wajar) dan pencocokan kemiripan terhadap foto referensi KYC.
        Seluruh pemrosesan berjalan di perangkat (on-device) memakai model pengenalan wajah lokal —
        gambar wajah tidak dikirim ke server pihak ketiga mana pun untuk keperluan ini.
      </p>
      <p>
        <strong>Dokumen identitas dan kendaraan.</strong> Untuk pengajuan dan verifikasi menjadi
        mitra, aplikasi meminta foto KTP, SIM, STNK, dan swafoto memegang KTP. Dokumen ini disimpan
        terenkripsi, hanya dilihat tim verifikasi TapGo yang berwenang, dan dihapus otomatis dalam
        waktu terbatas setelah diunggah (paling lama 72 jam; umumnya 24 jam) — kebijakan yang sama
        seperti dokumen KTP membership di situs web, lihat bagian "Perlakuan Dokumen Identitas" di
        bawah.
      </p>
      <p>
        <strong>Data penghasilan dan saldo.</strong> Aplikasi menyimpan riwayat perjalanan, komisi,
        saldo dompet driver, riwayat top up, dan pencairan (withdrawal), termasuk rekening bank tujuan
        pencairan (nama bank, nomor rekening, dan nama pemilik rekening) yang Anda simpan sendiri.
      </p>
      <p>
        <strong>Kontak dukungan.</strong> Tombol Bantuan di aplikasi membuka WhatsApp resmi TapGo
        (+62 838-0025-5588) lewat aplikasi WhatsApp driver sendiri — TapGo tidak membaca daftar
        kontak perangkat untuk fitur ini.
      </p>
      <p>
        <strong>Jejak lokasi perjalanan.</strong> Titik lokasi yang terkait dengan sebuah perjalanan
        disimpan selama 14 hari untuk keselamatan, penyelesaian sengketa, dan verifikasi insentif;
        titik lokasi yang tidak terkait perjalanan (driver hanya online) dihapus setelah 1 hari.
      </p>
      <p>
        <strong>Penilaian dan ulasan.</strong> Aplikasi menampilkan kepada driver penilaian bintang
        dan ulasan singkat yang diberikan penumpang, tanpa identitas penumpang. Setelah perjalanan
        selesai, driver juga dapat menilai penumpang (bintang dan catatan singkat); penilaian ini
        hanya dilihat tim TapGo untuk keselamatan dan tidak ditampilkan kepada penumpang maupun
        driver lain.
      </p>
      <p>
        <strong>Insentif harian.</strong> Untuk membayar bonus insentif, TapGo memverifikasi
        perjalanan yang dihitung (waktu mulai dan selesai, jejak lokasi, penumpang, dan ID
        perangkat) guna mencegah pesanan rekayasa. Bonus yang tidak lolos verifikasi dapat ditolak
        atau ditarik kembali.
      </p>
      <p>
        <strong>Pusat Bantuan.</strong> Pertanyaan yang Anda kirim lewat Pusat Bantuan di aplikasi
        disimpan sebagai tiket bantuan beserta balasan tim TapGo, dan hanya dilihat tim dukungan
        yang berwenang.
      </p>
      <p>
        <strong>Hapus akun.</strong> Driver dapat mengajukan penghapusan akun langsung di aplikasi
        (Akun &gt; Bantuan &gt; Hapus Akun) atau lewat https://tapgolion.id/hapus-akun. Pengajuan
        ditinjau tim TapGo; data transaksi yang wajib disimpan untuk audit dan kepatuhan hukum
        tetap disimpan.
      </p>
      <p>
        Seperti aplikasi penumpang, aplikasi driver juga menyimpan pesan chat dengan penumpang
        selama perjalanan aktif, serta mengirim ID dan sidik perangkat serta versi aplikasi untuk
        keamanan akun.
      </p>

      <h2>Data yang Dikumpulkan oleh Situs Web</h2>
      <p>
        Situs mengumpulkan data akun, kode referral, relasi sponsor atau mitra, status membership,
        data wallet, PPOB benefit, riwayat transaksi, invoice, withdrawal, pesan kontak, dan
        permintaan dukungan. Untuk pencairan saldo, situs menyimpan rekening bank tujuan (nama bank,
        nomor rekening, dan nama pemilik rekening) yang pengguna isi sendiri. Saat pengguna membeli membership di https://tapgolion.id/upgrade,
        situs juga meminta nama lengkap, alamat, foto KTP, dan swafoto dengan KTP untuk verifikasi
        identitas, serta foto profil secara opsional.
      </p>

      <h2>Perlakuan Dokumen Identitas (KTP, SIM, STNK, dan Swafoto)</h2>
      <p>
        Dokumen identitas digunakan untuk memverifikasi pembelian membership (situs web) atau
        pengajuan menjadi mitra driver (aplikasi TapGo Driver), dan hanya dilihat oleh tim verifikasi
        TapGo yang berwenang. Berkas disimpan dalam bentuk terenkripsi, tidak pernah tersimpan
        sebagai gambar mentah, dan dihapus otomatis dalam waktu terbatas setelah diunggah (paling
        lama 72 jam; umumnya 24 jam). Bila dokumen ditolak, pembayaran pengguna dikembalikan sesuai
        kebijakan pengembalian dana (membership), atau pengajuan mitra diberi tahu alasan penolakan
        (driver).
      </p>

      <h2>Notifikasi dan Token Perangkat</h2>
      <p>
        Aplikasi meminta izin notifikasi. Bila pengguna mengizinkan, token perangkat yang dibuat
        oleh Firebase Cloud Messaging (Google) disimpan pada akun untuk mengirim notifikasi
        perjalanan, saldo, dan pembayaran. Isi notifikasi tidak memuat nominal, nama, atau alamat.
        Token dihapus dari akun saat pengguna keluar. Pengguna dapat menolak atau mematikan
        notifikasi kapan saja melalui pengaturan perangkat tanpa mengurangi fungsi lain aplikasi.
      </p>

      <h2>Tujuan Penggunaan Data</h2>
      <p>
        Data digunakan untuk registrasi, login, keamanan akun, layanan Ojek, pengelolaan
        membership, referral reward, komisi sesuai syarat, wallet, PPOB, invoice, pembayaran,
        withdrawal, pengiriman notifikasi, dukungan pelanggan, pencegahan penyalahgunaan, dan
        pencatatan operasional.
      </p>

      <h2>Penyimpanan Data</h2>
      <p>
        Data disimpan selama diperlukan untuk menjalankan layanan TapGo, memenuhi kewajiban hukum,
        menyelesaikan sengketa, menjaga keamanan, serta menyimpan catatan transaksi, wallet,
        invoice, withdrawal, dan audit operasional. Dokumen identitas mengikuti masa simpan
        terbatas yang dijelaskan di atas.
      </p>

      <h2>Keamanan Data</h2>
      <p>
        TapGo menerapkan perlindungan yang wajar, termasuk password hash, autentikasi token, kontrol
        akses berbasis role, enkripsi dokumen identitas, komunikasi API yang aman, dan monitoring
        operasional. Tidak ada sistem elektronik yang bebas risiko sepenuhnya, tetapi TapGo
        berupaya menjaga data dari akses tidak sah.
      </p>

      <h2>Pihak Ketiga</h2>
      <p>
        TapGo menggunakan Midtrans untuk pemrosesan pembayaran membership dan top up saldo, Google Firebase untuk
        pengiriman notifikasi, dan penyedia layanan PPOB untuk memproses pembelian pulsa dan
        tagihan. Pihak ketiga hanya menerima data yang diperlukan untuk menjalankan layanan
        terkait.
      </p>
      <p>
        <strong>Pembayaran.</strong> Pembayaran membership dan top up saldo dilakukan di halaman
        pembayaran Midtrans melalui transfer bank virtual account. TapGo meneruskan nama, alamat
        email, nomor HP, dan nominal tagihan ke Midtrans agar pembayaran dapat dibuat. TapGo hanya
        menyimpan status pembayaran dan jenis pembayaran; TapGo tidak menyimpan nomor kartu maupun
        rekening bank pembayar.
      </p>
      <p>
        <strong>Laporan kerusakan dan diagnostik.</strong> Aplikasi TapGo Penumpang dan TapGo Driver
        dapat mengirim laporan galat dan performa ke layanan Sentry untuk memperbaiki kerusakan.
        Laporan berisi jenis galat, jejak kode, versi aplikasi, serta model dan versi Android
        perangkat; aplikasi diatur agar tidak mengirim nama, nomor HP, atau data akun ke Sentry.
        Data ini tidak dipakai untuk iklan.
      </p>
      <p>
        <strong>Peta dan pencarian lokasi.</strong> Aplikasi TapGo menampilkan peta dengan gambar
        peta dari OpenStreetMap (tile.openstreetmap.org); wilayah peta yang ditampilkan diminta dari
        server tersebut. Saat pengguna mencari tempat di aplikasi TapGo Penumpang, teks pencarian
        dikirim ke layanan pencarian lokasi OpenStreetMap Nominatim (nominatim.openstreetmap.org)
        dan Photon oleh Komoot (photon.komoot.io), bersama posisi perangkat saat ini bila izin lokasi
        diberikan agar hasil terdekat tampil lebih dulu. Untuk mengubah titik di peta menjadi
        alamat, koordinat titik itu dikirim ke Nominatim. Penyedia layanan tersebut menerima data
        yang dikirim beserta alamat IP perangkat; TapGo tidak mengirim nama, nomor HP, atau data
        akun ke layanan tersebut. Pada aplikasi TapGo Driver, tombol navigasi membuka aplikasi
        Google Maps di luar TapGo dengan koordinat tujuan; setelah itu berlaku kebijakan privasi
        Google.
      </p>

      <h2>Penghapusan Akun</h2>
      <p>
        Pengguna dapat meminta penghapusan atau penonaktifan akun melalui menu Hapus Akun di
        aplikasi, halaman https://tapgolion.id/hapus-akun, atau support@tapgolion.id. Pengguna
        juga dapat meminta akses atau koreksi data. TapGo dapat tetap menyimpan catatan transaksi,
        invoice, wallet, withdrawal, pajak, audit, atau hukum yang wajib dipertahankan sesuai
        ketentuan.
      </p>

      <h2>Perubahan Kebijakan</h2>
      <p>
        Kebijakan ini dapat diperbarui. Tanggal pembaruan terakhir tercantum di bagian atas halaman
        ini, dan perubahan penting akan diinformasikan melalui aplikasi atau situs.
      </p>

      <h2>Kontak</h2>
      <p>
        PT. TapGo Lion Indonesia dapat dihubungi melalui email support@tapgolion.id, WhatsApp +62
        838-0025-5588, atau website resmi https://tapgolion.id.
      </p>
    </LegalShell>
  );
}
