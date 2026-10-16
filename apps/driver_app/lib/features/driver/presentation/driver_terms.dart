part of '../../../main.dart';

/// Versi naskah pernyataan. Naikkan SETIAP kali isi di bawah berubah: versi ini dikirim ke server saat pengajuan
/// dan dicatat di audit sebagai bukti naskah mana yang disetujui driver.
const String kDriverTermsVersion = '2026-10-16.2';

/// Satu kelompok butir; [label] opsional untuk bagian yang butirnya perlu dikelompokkan.
class DriverTermsGroup {
  const DriverTermsGroup({this.label, required this.items});
  final String? label;
  final List<String> items;
}

class DriverTermsSection {
  const DriverTermsSection({
    required this.title,
    this.intro,
    required this.groups,
    this.outro,
  });
  final String title;
  final String? intro;
  final List<DriverTermsGroup> groups;
  final String? outro;
}

/// Isi pernyataan kemitraan. Angka dan perilaku yang disebut di sini harus sama dengan sistem:
/// komisi 8% (tunai: ditahan dari Saldo TapGo; digital: dipotong dari tarif), SOS, pengingat kelelahan,
/// jejak lokasi perjalanan ~14 hari (RIDE_LOCATION_RETENTION_DAYS). Ubah isi => naikkan [kDriverTermsVersion].
const List<DriverTermsSection> kDriverTermsSections = [
  DriverTermsSection(
    title: '1. Status kemitraan',
    groups: [
      DriverTermsGroup(items: [
        'Anda adalah mitra independen TapGo, bukan karyawan, pekerja, atau agen TapGo. TapGo menyediakan aplikasi yang mempertemukan Anda dengan penumpang; TapGo sendiri tidak mengangkut penumpang.',
        'Anda bebas menentukan kapan online atau offline, dan boleh menolak tawaran pesanan.',
        'Kendaraan, bahan bakar, perawatan, kuota internet, SIM, STNK, pajak kendaraan, dan pajak penghasilan Anda adalah tanggung jawab Anda sendiri.',
        'Pernyataan ini berlaku bersama Kebijakan Privasi TapGo dan peraturan perundang-undangan Indonesia.',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '2. Hak Anda sebagai driver',
    groups: [
      DriverTermsGroup(items: [
        'Melihat rincian sebelum menerima: tarif, komisi TapGo, dan pendapatan bersih Anda ditampilkan pada setiap tawaran.',
        'Menerima tarif perjalanan sesuai aplikasi: pesanan tunai dibayar penumpang langsung kepada Anda; pesanan digital (TapGoPay) masuk ke saldo Anda setelah dipotong komisi.',
        'Menolak tawaran tanpa harus menjelaskan alasan, dan membatalkan pesanan yang sudah diterima bila ada alasan yang sah, misalnya penumpang tidak ada di titik jemput, penumpang meminta hal yang melanggar hukum, atau kondisi tidak aman.',
        'Komisi yang ditahan untuk pesanan tunai dikembalikan utuh bila pesanan dibatalkan.',
        'Mendapat bantuan: tombol SOS di aplikasi dan layanan bantuan TapGo lewat WhatsApp pada menu Akun > Bantuan.',
        'Mengetahui alasan bila pengajuan Anda ditolak atau akun Anda dibatasi, dan mengajukan keberatan disertai bukti (lihat bagian 6).',
        'Perlindungan data pribadi: mengakses, memperbaiki, dan meminta penghapusan data Anda sesuai peraturan perlindungan data pribadi (lihat bagian 8).',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '3. Kewajiban Anda sebagai driver',
    groups: [
      DriverTermsGroup(label: 'Identitas dan akun', items: [
        'Seluruh data dan dokumen (KTP, SIM, STNK, foto diri, SKCK) benar, asli, milik Anda sendiri, dan masih berlaku.',
        'Satu akun hanya untuk satu orang. Dilarang meminjamkan, menyewakan, menjual, atau membagikan akun, kata sandi, atau kode verifikasi, dan dilarang membiarkan orang lain mengemudi memakai akun Anda.',
        'Mengemudikan kendaraan yang sama dengan yang didaftarkan, dalam kondisi laik jalan, dengan surat-surat dan pajak yang berlaku.',
      ]),
      DriverTermsGroup(label: 'Keselamatan', items: [
        'Memiliki SIM yang sesuai jenis kendaraan, mematuhi rambu dan batas kecepatan.',
        'Motor: memakai helm berstandar dan menyediakan helm untuk penumpang. Mobil: sabuk pengaman terpasang untuk semua penumpang.',
        'Dilarang mengemudi di bawah pengaruh alkohol, narkotika, atau obat yang mengganggu kesadaran, dan dilarang mengemudi saat sangat lelah. Berhentilah beristirahat ketika aplikasi mengingatkan Anda setelah online terus-menerus dalam waktu lama.',
        'Dilarang mengoperasikan ponsel dengan tangan saat kendaraan melaju, dan dilarang membawa penumpang melebihi kapasitas kendaraan atau di luar penumpang pesanan.',
      ]),
      DriverTermsGroup(label: 'Perilaku terhadap penumpang', items: [
        'Bersikap sopan. Dilarang melakukan kekerasan, pelecehan (fisik, verbal, atau digital), ancaman, atau diskriminasi berdasarkan suku, agama, ras, golongan, jenis kelamin, usia, atau disabilitas.',
        'Dilarang merokok di kendaraan selama perjalanan dan dilarang mengangkut barang terlarang atau berbahaya. Tolak permintaan yang melanggar hukum.',
        'Mengikuti rute yang wajar menuju tujuan. Dilarang memperpanjang rute atau waktu perjalanan dengan sengaja.',
        'Dilarang meminta bayaran di luar tarif di aplikasi, kecuali biaya tol atau parkir yang sah dan disepakati, dan dilarang memaksa tip.',
      ]),
      DriverTermsGroup(label: 'Aplikasi dan data penumpang', items: [
        'Mengaktifkan izin lokasi selama online. Dilarang memalsukan lokasi, memakai emulator, atau memodifikasi aplikasi atau perangkat untuk mengakali sistem.',
        'Merahasiakan data penumpang (nama, nomor, lokasi, isi percakapan). Data itu hanya untuk menyelesaikan pesanan; dilarang menyimpan, menyebarkan, atau menghubungi penumpang di luar kebutuhan pesanan, dan dilarang memotret atau merekam penumpang untuk disebarkan.',
      ]),
      DriverTermsGroup(label: 'Keuangan', items: [
        'Pesanan tunai: pastikan Saldo TapGo cukup untuk komisi. Komisi tidak boleh dihindari dengan memindahkan pesanan ke luar aplikasi.',
        'Dilarang membuat pesanan fiktif atau transaksi tidak wajar, dan dilarang memakai isi saldo atau penarikan untuk pencucian uang.',
        'Melaporkan segera bila ada kesalahan saldo atau pembayaran yang menguntungkan Anda.',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '4. Hak dan kewajiban TapGo',
    groups: [
      DriverTermsGroup(label: 'TapGo berkewajiban', items: [
        'Menyediakan aplikasi dan pencocokan pesanan.',
        'Menghitung tarif dan komisi secara transparan, serta menampilkannya pada setiap tawaran.',
        'Memproses pembayaran digital dan mengembalikannya kepada penumpang bila pesanan dibatalkan.',
        'Menyediakan tombol SOS dan layanan bantuan.',
        'Menjaga keamanan data Anda sesuai hukum.',
        'Memberi tahu perubahan tarif, komisi, atau kebijakan lewat aplikasi sebelum berlaku, dan menanggapi keberatan Anda.',
      ]),
      DriverTermsGroup(label: 'TapGo berhak', items: [
        'Memotong komisi, saat ini 8% dari tarif perjalanan (dibulatkan ke atas). Angka yang berlaku selalu tampil pada tawaran.',
        'Meminta verifikasi identitas tambahan dan menetapkan standar kualitas layanan.',
        'Menolak pengajuan, membatasi, menangguhkan, atau menonaktifkan akun sesuai bagian 6.',
        'Mengoreksi saldo bila terjadi kesalahan sistem atau transaksi tidak sah, disertai pemberitahuan kepada Anda.',
        'Mengubah fitur layanan, dan menyerahkan data kepada pihak berwenang sesuai hukum.',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '5. Kebijakan risiko perjalanan',
    groups: [
      DriverTermsGroup(label: 'Keadaan darurat dan kecelakaan', items: [
        'Utamakan keselamatan jiwa. Hubungi 112 untuk keadaan darurat. Tombol SOS di aplikasi mencatat lokasi dan perjalanan Anda lalu meneruskannya ke tim TapGo; SOS bukan pengganti 112.',
        'Bila terjadi kecelakaan: berhenti di tempat aman, tolong korban, hubungi 112, jangan meninggalkan lokasi, dan laporkan kepada TapGo secepatnya lewat SOS atau WhatsApp. TapGo membantu menyediakan data perjalanan (waktu, jejak lokasi, percakapan) bagi pihak berwenang dan perusahaan asuransi.',
      ]),
      DriverTermsGroup(label: 'Tanggung jawab atas kerugian', items: [
        'Kerugian pada kendaraan, barang, atau cedera Anda tidak otomatis ditanggung TapGo. Kecuali TapGo mengumumkan program perlindungan atau asuransi secara tertulis, Anda bertanggung jawab atas kendaraan dan jaminan kesehatan Anda sendiri. Kami menyarankan Anda memiliki BPJS Kesehatan dan asuransi kendaraan.',
        'Kerugian penumpang atau pihak ketiga yang timbul dari kelalaian atau pelanggaran Anda menjadi tanggung jawab Anda.',
      ]),
      DriverTermsGroup(label: 'Penumpang bermasalah', items: [
        'Bila penumpang mabuk, agresif, mengancam, melecehkan, atau meminta hal yang melanggar hukum, Anda berhak tidak melanjutkan perjalanan. Hentikan kendaraan di tempat aman dan ramai, minta penumpang turun dengan sopan, batalkan pesanan dengan alasan yang sesuai, lalu laporkan kepada TapGo. Jangan menurunkan penumpang di tempat berbahaya, misalnya jalan tol atau jalan sepi di malam hari, kecuali Anda sendiri terancam.',
        'Penumpang tidak muncul: hubungi lewat chat di aplikasi, tunggu secara wajar, lalu batalkan dengan alasan yang benar. Alasan pembatalan yang tidak benar dapat dianggap penyelewengan.',
        'Pesanan tunai: penyerahan uang tunai terjadi antara Anda dan penumpang; TapGo tidak menanggung uang tunai yang hilang. Bila penumpang menolak membayar, laporkan lewat TapGo dengan bukti perjalanan. Jangan menahan penumpang atau barangnya secara paksa.',
        'Barang tertinggal wajib dikembalikan lewat TapGo. Menyimpan atau memakai barang penumpang adalah penyelewengan.',
      ]),
      DriverTermsGroup(label: 'Kondisi tidak aman', items: [
        'Cuaca ekstrem, banjir, kerusuhan, atau jalan yang tidak aman: Anda boleh membatalkan pesanan dengan alasan keselamatan.',
        'Kelelahan: aplikasi mengingatkan Anda setelah online terus-menerus dalam waktu lama. Keselamatan Anda dan penumpang adalah tanggung jawab Anda; berhentilah dan beristirahat saat lelah.',
      ]),
      DriverTermsGroup(label: 'Laporan terhadap Anda dan bukti perjalanan', items: [
        'Bila penumpang atau pihak lain melaporkan Anda (misalnya pelecehan, kekerasan, pencurian, atau mengemudi berbahaya), TapGo memeriksa laporan itu. Akun dapat dibatasi atau ditangguhkan selama pemeriksaan, dan Anda wajib bekerja sama serta memberi keterangan. Kasus yang mengandung unsur pidana dapat diserahkan kepada aparat penegak hukum.',
        'Demi keselamatan dan penyelesaian sengketa, TapGo menyimpan data pesanan, percakapan di aplikasi, laporan SOS, dan jejak lokasi selama perjalanan (jejak lokasi sekitar 14 hari, data lain selama diperlukan untuk kewajiban hukum dan pembukuan). Dengan menyetujui, Anda mengizinkan penggunaan data itu untuk keperluan tersebut.',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '6. Penyelewengan, sanksi, dan keberatan',
    intro: 'Hal berikut dianggap penyelewengan:',
    groups: [
      DriverTermsGroup(items: [
        'Memberikan data atau dokumen palsu, memakai identitas orang lain, atau meminjamkan, menyewakan, atau menjual akun.',
        'Memalsukan lokasi, memakai emulator, atau memodifikasi aplikasi atau perangkat untuk mengakali sistem, tarif, atau insentif.',
        'Membuat pesanan fiktif, bersekongkol dengan penumpang, atau membatalkan dengan sengaja dan dengan alasan palsu.',
        'Meminta bayaran di luar tarif aplikasi, menaikkan tarif secara sepihak, atau mengubah tujuan atau rute demi tarif lebih tinggi.',
        'Mengalihkan pesanan ke luar aplikasi untuk menghindari komisi, atau memanipulasi saldo dan pembayaran.',
        'Kekerasan, pelecehan, ancaman, diskriminasi, pencurian, penipuan, atau membawa barang terlarang.',
        'Menyalahgunakan data penumpang atau data TapGo, atau mengganggu, meretas, atau merekayasa balik sistem TapGo.',
        'Mengancam atau mengintimidasi penumpang, driver lain, atau staf TapGo.',
      ]),
    ],
    outro:
        'Sanksi diberikan bertahap sesuai berat pelanggaran: (1) peringatan; (2) pembatasan sementara atau penangguhan akun, termasuk selama pemeriksaan; (3) pembatalan insentif serta koreksi atau pembalikan transaksi yang diperoleh secara tidak sah, termasuk menahan saldo yang terkait pesanan bermasalah selama pemeriksaan (saldo dilepas bila tidak terbukti ada pelanggaran); (4) penonaktifan permanen dan penolakan pendaftaran ulang; (5) penagihan ganti rugi dan/atau pelaporan kepada pihak berwajib. '
        'Pelanggaran berat, seperti kekerasan, pelecehan seksual, penipuan, pencurian, identitas palsu, jual-beli akun, atau narkotika, dapat langsung dikenai penonaktifan permanen tanpa peringatan awal.\n\n'
        'Keberatan: Anda dapat mengajukan keberatan atas keputusan TapGo lewat layanan bantuan (Akun > Bantuan) disertai bukti. TapGo meninjau ulang dan menyampaikan hasilnya kepada Anda.',
  ),
  DriverTermsSection(
    title: '7. Komisi, saldo, dan pembayaran',
    groups: [
      DriverTermsGroup(items: [
        'Pesanan tunai: komisi (saat ini 8% dari tarif, dibulatkan ke atas) ditahan dari Saldo TapGo saat Anda menerima pesanan. Untuk menerima pesanan tunai, Saldo TapGo Anda harus minimal Rp50.000 saat pesanan diterima (dihitung sebelum komisi ditahan; angka yang berlaku tampil di aplikasi). Saldo di bawah batas itu, atau yang kurang untuk komisinya, membuat pesanan tunai tidak dapat diterima. Pesanan dibatalkan: komisi dikembalikan. Pesanan selesai: komisi menjadi biaya final. Saat saldo hampir habis (Rp10.000 atau kurang), aplikasi memperingatkan Anda untuk mengisi saldo.',
        'Pesanan digital (TapGoPay): penumpang membayar lebih dulu. Saat pesanan selesai, tarif dikurangi komisi masuk ke saldo Anda dan dapat ditarik lewat tapgolion.id sesuai ketentuan penarikan. Pesanan dibatalkan: dana dikembalikan kepada penumpang.',
        'Saldo TapGo diisi lewat tapgolion.id. Biaya layanan pembayaran ditampilkan lebih dulu sebelum Anda membayar.',
        'Perubahan tarif atau komisi diumumkan lewat aplikasi sebelum berlaku.',
        'Pajak atas penghasilan Anda menjadi tanggung jawab Anda. Rekap penghasilan tersedia di aplikasi.',
        'Kesalahan hitung atau sistem dapat dikoreksi oleh TapGo disertai pemberitahuan kepada Anda.',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '8. Data pribadi dan privasi',
    groups: [
      DriverTermsGroup(items: [
        'Data yang dikumpulkan: identitas dan dokumen (KTP, SIM, STNK, foto diri, SKCK), kontak darurat, data kendaraan, lokasi (termasuk saat aplikasi berjalan di latar belakang selama Anda online atau punya pesanan, ditandai notifikasi tetap), data pesanan, percakapan di aplikasi, dan data perangkat.',
        'Tujuan penggunaan: verifikasi identitas, pencocokan pesanan, keselamatan, pembayaran, pencegahan penipuan, kepatuhan hukum, dan peningkatan layanan.',
        'Dibagikan seperlunya: kepada penumpang pada pesanan Anda (nama, kendaraan dan plat, serta posisi Anda selama perjalanan), kepada penyedia pembayaran dan layanan teknis, dan kepada pihak berwenang bila diwajibkan hukum. Data Anda tidak dijual.',
        'Dokumen unggahan dipakai untuk verifikasi, disimpan seperlunya, dan dihapus sesuai kebijakan retensi TapGo.',
        'Hak Anda: mengakses, memperbaiki, meminta penghapusan data, dan menarik persetujuan sesuai peraturan perlindungan data pribadi, lewat layanan bantuan. Menarik persetujuan atas data yang diperlukan untuk layanan (misalnya lokasi) berarti Anda tidak dapat bertugas sebagai driver. Rincian ada di Kebijakan Privasi (Akun > Bantuan).',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '9. Berhenti dan pengakhiran',
    groups: [
      DriverTermsGroup(items: [
        'Anda dapat berhenti kapan saja: offline, menarik pengajuan, atau meminta penutupan akun lewat layanan bantuan, setelah menyelesaikan perjalanan yang sedang berjalan dan kewajiban saldo.',
        'TapGo dapat menolak pengajuan, menangguhkan, atau menonaktifkan akun bila syarat tidak lagi terpenuhi (misalnya dokumen kedaluwarsa atau data tidak sesuai) atau terjadi pelanggaran.',
        'Kewajiban keuangan yang belum selesai, tanggung jawab atas pelanggaran sebelum pengakhiran, dan ketentuan tentang data tetap berlaku setelah kemitraan berakhir.',
      ]),
    ],
  ),
  DriverTermsSection(
    title: '10. Perubahan dan penyelesaian sengketa',
    groups: [
      DriverTermsGroup(items: [
        'TapGo dapat memperbarui pernyataan ini. Perubahan penting diberitahukan lewat aplikasi dan, bila perlu, Anda diminta menyetujui ulang. Versi yang Anda setujui dicatat.',
        'Perbedaan pendapat diselesaikan lebih dulu secara musyawarah lewat layanan bantuan. Pernyataan ini tunduk pada hukum Indonesia; sengketa yang tidak selesai diajukan ke pengadilan yang berwenang di Indonesia.',
      ]),
    ],
  ),
];

/// Kalimat persetujuan di bawah naskah, ditampilkan di samping kotak centang.
const String kDriverTermsAcceptance =
    'Saya telah membaca dan memahami seluruh pernyataan ini. Data yang saya berikan benar. Saya bersedia mematuhi hak dan '
    'kewajiban driver, kebijakan risiko perjalanan, dan sanksi bila terjadi penyelewengan, serta menyetujui penggunaan data '
    'saya sebagaimana dijelaskan.';

/// Naskah pernyataan sebagai kolom bagian-bagian. Dipakai di langkah terakhir pendaftaran dan di halaman baca-saja
/// pada tab Akun. Tidak punya scroll sendiri: pemanggil yang menyediakan.
class DriverTermsView extends StatelessWidget {
  const DriverTermsView({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      key: const ValueKey('driver-terms'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Pernyataan Kemitraan Driver TapGo',
          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          'Versi $kDriverTermsVersion',
          key: const ValueKey('driver-terms-version'),
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 16),
        for (var i = 0; i < kDriverTermsSections.length; i++) ...[
          _TermsSectionView(
            key: ValueKey('driver-terms-section-${i + 1}'),
            section: kDriverTermsSections[i],
          ),
          const SizedBox(height: 20),
        ],
      ],
    );
  }
}

class _TermsSectionView extends StatelessWidget {
  const _TermsSectionView({super.key, required this.section});
  final DriverTermsSection section;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          section.title,
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        if (section.intro != null) ...[
          Text(section.intro!),
          const SizedBox(height: 8),
        ],
        for (final group in section.groups) ...[
          if (group.label != null) ...[
            Text(
              group.label!,
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
          ],
          for (final item in group.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 1, right: 8, left: 2),
                    child: Text('•'),
                  ),
                  Expanded(child: Text(item, style: const TextStyle(height: 1.35))),
                ],
              ),
            ),
          const SizedBox(height: 4),
        ],
        if (section.outro != null) ...[
          const SizedBox(height: 4),
          Text(section.outro!, style: const TextStyle(height: 1.35)),
        ],
      ],
    );
  }
}

/// Halaman baca-saja pernyataan (tab Akun > Bantuan), agar driver aktif dapat membaca ulang kapan saja.
class DriverTermsScreen extends StatelessWidget {
  const DriverTermsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pernyataan Kemitraan')),
      body: const SafeArea(
        child: SingleChildScrollView(
          key: ValueKey('driver-terms-scroll'),
          padding: EdgeInsets.fromLTRB(20, 16, 20, 32),
          child: DriverTermsView(),
        ),
      ),
    );
  }
}
