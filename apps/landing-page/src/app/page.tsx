import type { Metadata } from "next";
import ContactLeadForm from "./contact-lead-form";
import { Reveal } from "./reveal";

/**
 * Homepage TapGo Lion.
 *
 * Direkonstruksi dari konten yang SUNGGUH aktif di tapgolion.id (bukan dari
 * versi lama repo ini, yang sebelumnya memakai skema warna terang biru/hijau
 * dan pitch "platform membership" murni — tidak pernah cocok dengan identitas
 * TapGo yang sesungguhnya: navy gelap + emas, dengan logo lion-shield yang
 * sama dipakai admin_dashboard dan aplikasi mobile). Salinan kata demi kata
 * diambil langsung dari halaman live per 9 September 2026, supaya build baru
 * ini benar-benar menggantikan yang aktif tanpa kehilangan konten.
 *
 * Halaman lain (/daftar, /contact, /delete-account, legal, /upgrade, /topup)
 * TIDAK disentuh di sini — sudah dikonfirmasi cocok dengan yang live.
 */

const whatsappUrl =
  "https://wa.me/6283800255588?text=Halo%20TapGo%20Lion%2C%20saya%20ingin%20bertanya.";
const playStoreUrl = "https://play.google.com/store/apps/details?id=com.xavindo.tapgo";

const trustBadges = [
  { title: "Badan usaha resmi", desc: "Bukan perorangan — PT berbadan hukum", icon: "building" },
  { title: "Uang Anda aman", desc: "Lewat gateway berlisensi, bukan rekening pribadi", icon: "card" },
  { title: "Driver terverifikasi", desc: "Identitas diperiksa sebelum boleh menerima orderan", icon: "user" },
  { title: "Data Anda tidak menumpuk", desc: "Dokumen terenkripsi, terhapus dalam 24 jam", icon: "lock" }
];

const services = [
  {
    icon: "moto",
    title: "Ojek Online",
    headline: "Tahu persis berapa bayarnya, sebelum berangkat",
    desc: "Tarif muncul penuh sebelum Anda menekan tombol pesan, lalu dikunci. Macet di tengah jalan tidak menambah biaya, dan tidak ada tagihan yang muncul belakangan.",
    items: ["Tarif final diketahui di awal", "Identitas dan kendaraan driver terverifikasi", "Riwayat perjalanan lengkap"]
  },
  {
    icon: "driver",
    title: "Mitra Driver",
    headline: "Punya motor dan waktu luang? Itu sudah cukup",
    desc: "Tidak ada setoran harian dan tidak ada jam wajib. Anda yang menentukan kapan menyalakan aplikasi, dan setiap rupiah yang masuk tercatat per perjalanan.",
    items: ["Jam kerja fleksibel", "Status verifikasi dapat dipantau", "Rincian penghasilan per perjalanan"]
  },
  {
    icon: "receipt",
    title: "Layanan PPOB",
    headline: "Ubah ponsel Anda menjadi loket pembayaran",
    desc: "Pulsa, paket data, token listrik, dan tagihan rutin. Anggota dapat melayani tetangga dan pelanggan warung — tanpa sewa tempat, tanpa etalase, tanpa jam buka.",
    items: ["Pulsa", "Paket Data", "Token PLN", "Tagihan Rutin"]
  },
  {
    icon: "membership",
    title: "Membership",
    headline: "Mulai usaha tanpa menyiapkan stok barang",
    desc: "Setiap tingkat keanggotaan sudah membawa saldo PPOB sebagai modal awal — jadi Anda bisa langsung berjualan di hari yang sama, bukan menunggu barang datang.",
    linkLabel: "Bandingkan paket"
  }
];

const workSteps = [
  { icon: "download", short: "Unduh", title: "01 · Unduh aplikasi", desc: "Pasang TapGo gratis dari Google Play Store." },
  { icon: "user", short: "Daftar", title: "02 · Daftar akun", desc: "Gunakan nomor ponsel aktif, lalu verifikasi lewat kode SMS." },
  { icon: "role", short: "Pilih Peran", title: "03 · Pilih peran", desc: "Penumpang, mitra driver, atau agen PPOB. Satu akun bisa lebih dari satu." },
  { icon: "bolt", short: "Transaksi", title: "04 · Mulai bertransaksi", desc: "Pesan perjalanan, terima orderan, atau bayar tagihan." }
];

const packages = [
  {
    name: "SILVER",
    price: "Rp 500.000",
    highlight: "Untuk mencoba lebih dulu sebelum melangkah besar",
    items: [
      "Kaos TAPGO",
      "Saldo PPOB awal Rp 100.000",
      "BPJS Ketenagakerjaan JKK dan JKM (gratis 1 bulan pertama, bulan berikutnya dibayar sendiri)"
    ],
    cta: "Mulai dari Silver",
    slug: "silver",
    popular: false
  },
  {
    name: "GOLD",
    price: "Rp 3.000.000",
    highlight: "Modal enam kali lipat Silver — pilihan yang paling banyak diambil",
    items: ["Kaos, rompi, dan banner TAPGO", "Saldo PPOB awal Rp 600.000", "BPJS Ketenagakerjaan JKK dan JKM 1 tahun"],
    cta: "Ambil paket Gold",
    slug: "gold",
    popular: true
  },
  {
    name: "PLATINUM",
    price: "Rp 5.500.000",
    highlight: "Paket terlengkap: perlengkapan usaha, BPJS 1 tahun, dan saldo PPOB Rp 1.000.000",
    items: [
      "Kaos, rompi, dan banner TAPGO",
      "Saldo PPOB awal Rp 1.000.000",
      "BPJS Ketenagakerjaan 1 tahun (JKK, JKM, JHT)"
    ],
    cta: "Ambil paket Platinum",
    slug: "platinum",
    popular: false
  }
];

const articles = [
  {
    id: "pengenalan",
    tag: "Pengenalan",
    readTime: "6 menit baca",
    title: "Apa itu TapGo Lion dan bagaimana ekosistemnya bekerja",
    summary: "Mengapa empat layanan disatukan dalam satu aplikasi, dan apa untungnya bagi Anda.",
    body: [
      "TapGo Lion Indonesia dibangun dari satu pengamatan sederhana: kebanyakan orang di kota kecil dan menengah memakai aplikasi yang berbeda untuk hal-hal yang sebenarnya saling berkaitan. Satu aplikasi untuk memesan ojek, satu lagi untuk membeli pulsa, satu lagi untuk mengurus penghasilan sampingan. Masing-masing meminta pendaftaran ulang, verifikasi ulang, dan saldo yang terpisah.",
      "TapGo menyatukan empat hal itu — perjalanan, kemitraan driver, pembayaran harian, dan keanggotaan — di atas satu akun.",
      { heading: "Empat bagian yang saling menyambung" },
      "Ojek online adalah pintu masuk yang paling sering dipakai. Anda memasukkan titik jemput dan tujuan, tarif muncul lebih dulu, lalu Anda memutuskan. Tidak ada perhitungan ulang di akhir perjalanan.",
      "Kemitraan driver adalah sisi sebaliknya. Orang yang punya kendaraan dan waktu luang dapat mendaftar, melewati verifikasi, dan mulai menerima orderan dari penumpang di aplikasi yang sama.",
      "Layanan PPOB menangani kebutuhan yang berulang tiap bulan: pulsa, paket data, token listrik, dan tagihan rutin. Anggota bahkan dapat melayani orang lain sebagai agen.",
      "Membership mengikat ketiganya. Anggota memperoleh saldo PPOB awal, kartu anggota digital, dan akses sebagai agen.",
      { heading: "Mengapa disatukan?" },
      "Karena uangnya berputar di tempat yang sama. Penghasilan seorang mitra driver dapat langsung dipakai membeli token listrik. Saldo PPOB seorang anggota dapat dipakai melayani tetangga. Tidak perlu memindahkan dana antaraplikasi, dan tidak perlu mendaftar dua kali.",
      { heading: "Siapa yang berdiri di belakangnya" },
      "Layanan ini dijalankan PT. TapGo Lion Indonesia, badan usaha berbadan hukum di Indonesia. Aplikasinya dapat diunduh gratis di Google Play Store, dan pembayaran diproses melalui payment gateway berlisensi — bukan transfer ke rekening pribadi."
    ]
  },
  {
    id: "penumpang",
    tag: "Panduan Penumpang",
    readTime: "5 menit baca",
    title: "Cara memesan ojek online di aplikasi TapGo, langkah demi langkah",
    summary: "Dari membuka aplikasi sampai perjalanan selesai, termasuk cara membaca tarif.",
    body: [
      "Memesan perjalanan di TapGo dirancang selesai dalam waktu kurang dari satu menit. Berikut urutannya.",
      { heading: "Langkah pemesanan" },
      {
        list: [
          "Buka aplikasi dan pastikan lokasi aktif. Titik jemput terisi otomatis dari lokasi Anda, dan tetap dapat digeser bila kurang tepat.",
          "Masukkan tujuan. Ketik nama tempat atau alamat. Semakin lengkap alamatnya, semakin akurat perkiraan tarifnya.",
          "Periksa tarif yang muncul. Angka yang ditampilkan adalah tarif final. Bila Anda setuju, lanjutkan.",
          "Tekan pesan dan tunggu driver. Aplikasi mencarikan driver terdekat yang sedang tersedia.",
          "Cocokkan identitas sebelum naik. Nama, foto, dan nomor kendaraan ditampilkan di aplikasi. Pastikan cocok dengan yang datang."
        ]
      },
      { heading: "Membaca tarif dengan benar" },
      "Tarif dihitung dari jarak tempuh dan dikunci sebelum perjalanan dimulai. Karena itu, kemacetan di tengah jalan tidak menambah biaya Anda.",
      { heading: "Bila terjadi kendala" },
      "Setiap perjalanan tersimpan di menu riwayat, lengkap dengan waktu, rute, dan nominalnya. Bila ada yang perlu ditanyakan, sebutkan nomor perjalanan tersebut saat menghubungi kami — penanganannya akan jauh lebih cepat.",
      { heading: "Tips singkat" },
      {
        list: [
          "Tunggu di titik yang mudah dijangkau kendaraan, bukan di dalam gang sempit.",
          "Simpan alamat rumah dan kantor agar tidak perlu mengetik ulang.",
          "Pastikan baterai ponsel cukup agar driver tetap dapat menghubungi Anda."
        ]
      }
    ]
  },
  {
    id: "mitra",
    tag: "Panduan Mitra",
    readTime: "7 menit baca",
    title: "Menjadi mitra driver TapGo: syarat, berkas, dan proses verifikasi",
    summary: "Apa yang perlu disiapkan sebelum mendaftar, dan apa yang terjadi setelahnya.",
    body: [
      "Menjadi mitra driver berarti Anda menentukan sendiri kapan bekerja. Namun karena Anda akan membawa orang lain, prosesnya memang menuntut pemeriksaan.",
      { heading: "Yang perlu disiapkan" },
      {
        list: [
          "KTP yang masih berlaku dan terbaca jelas.",
          "SIM sesuai jenis kendaraan yang akan dipakai.",
          "STNK kendaraan yang masih berlaku.",
          "Nomor ponsel aktif yang dapat menerima SMS.",
          "Rekening bank atas nama Anda sendiri untuk penerimaan penghasilan."
        ]
      },
      { heading: "Alur pendaftaran" },
      {
        list: [
          "Daftar di aplikasi TapGo Driver. Isi data diri sesuai KTP — bukan nama panggilan.",
          "Lengkapi data kendaraan. Jenis, merek, dan nomor polisi harus sama persis dengan STNK.",
          "Kirim berkas. Foto di tempat terang, seluruh bagian dokumen masuk dalam bingkai, tidak buram, dan tidak tertutup jari.",
          "Tunggu verifikasi. Tim kami memeriksa kecocokan data. Statusnya dapat dipantau langsung di aplikasi.",
          "Mulai menerima orderan. Begitu disetujui, akun Anda aktif."
        ]
      },
      { heading: "Penyebab pendaftaran tertunda" },
      "Yang paling sering: foto dokumen buram, nama di KTP berbeda dengan nama di STNK tanpa keterangan, masa berlaku dokumen sudah lewat, atau nomor polisi salah ketik. Semuanya dapat dihindari dengan memeriksa ulang sebelum mengirim.",
      { heading: "Setelah aktif" },
      "Penghasilan tercatat per perjalanan dan dapat ditinjau kapan saja. Karena kewenangan driver diperiksa ulang pada setiap operasi, perubahan status akun berlaku seketika — ini menjaga keamanan penumpang sekaligus mitra."
    ]
  },
  {
    id: "ppob",
    tag: "Panduan PPOB",
    readTime: "5 menit baca",
    title: "Transaksi PPOB: pulsa, token listrik, dan tagihan bulanan",
    summary: "Cara bertransaksi dengan aman, dan cara melayani orang lain sebagai agen.",
    body: [
      "PPOB adalah singkatan dari Payment Point Online Bank — istilah untuk layanan pembayaran tagihan dan pembelian produk digital lewat satu titik. Di TapGo, layanan ini tersedia bagi semua pengguna, dan anggota dapat memakainya untuk melayani orang lain.",
      { heading: "Alur transaksi" },
      {
        list: [
          "Pilih jenis layanan. Pulsa, paket data, token listrik, atau tagihan.",
          "Masukkan nomor tujuan. Nomor ponsel untuk pulsa, atau nomor meter untuk token listrik.",
          "Periksa nama pelanggan yang muncul. Untuk token listrik dan tagihan, sistem menampilkan nama pemilik. Cocokkan sebelum melanjutkan — ini pemeriksaan terpenting.",
          "Konfirmasi dan bayar. Nominal beserta biaya layanan ditampilkan sebelum Anda menyetujui.",
          "Simpan bukti transaksi. Setiap transaksi menghasilkan bukti yang tersimpan di riwayat."
        ]
      },
      { heading: "Menjadi agen PPOB" },
      "Anggota memperoleh saldo PPOB awal sesuai tingkat keanggotaannya. Saldo ini dapat dipakai melayani transaksi orang lain — tetangga, pelanggan warung, atau rekan kerja. Setiap penjualan tercatat, sehingga Anda dapat menghitung sendiri perputarannya.",
      { heading: "Hal yang perlu diperhatikan" },
      {
        list: [
          "Selalu cocokkan nama pelanggan sebelum menekan bayar. Token yang salah kirim sulit ditarik kembali.",
          "Token listrik yang berhasil akan menampilkan nomor token. Catat atau kirim segera kepada pelanggan.",
          "Bila transaksi terlihat menggantung, periksa riwayat lebih dulu sebelum mengulang — untuk menghindari pembayaran ganda."
        ]
      }
    ]
  },
  {
    id: "membership",
    tag: "Membership",
    readTime: "6 menit baca",
    title: "Memahami membership TapGo dan cara melakukan upgrade",
    summary: "Perbedaan Silver, Gold, dan Platinum, serta lima langkah proses upgrade.",
    body: [
      "Membership TapGo bukan sekadar lencana. Yang membedakan tiap tingkatan adalah saldo PPOB awal yang Anda terima dan tingkat dukungan yang menyertainya.",
      { heading: "Perbandingan singkat" },
      {
        list: [
          "Silver — Rp 500.000. Kaos TAPGO, saldo PPOB awal Rp 100.000, dan BPJS Ketenagakerjaan JKK dan JKM untuk 1 bulan pertama (bulan berikutnya dibayar sendiri).",
          "Gold — Rp 3.000.000. Kaos, rompi, dan banner TAPGO, saldo PPOB awal Rp 600.000, dan BPJS Ketenagakerjaan JKK dan JKM 1 tahun.",
          "Platinum — Rp 5.500.000. Kaos, rompi, dan banner TAPGO, saldo PPOB awal Rp 1.000.000, dan BPJS Ketenagakerjaan 1 tahun (JKK, JKM, JHT)."
        ]
      },
      { heading: "Lima langkah upgrade" },
      {
        list: [
          "Masuk di situs ini. Gunakan nomor ponsel dan password yang sama dengan aplikasi. Tidak perlu membuat akun baru.",
          "Pilih paket. Paket hanya dapat dinaikkan, tidak dapat diturunkan.",
          "Lengkapi data dan dokumen. Nama sesuai KTP, alamat domisili, foto KTP, dan swafoto memegang KTP.",
          "Selesaikan pembayaran. Diproses melalui payment gateway berlisensi.",
          "Tunggu verifikasi. Manfaat aktif setelah dokumen diperiksa tim kami."
        ]
      },
      { heading: "Mengapa upgrade dilakukan di situs, bukan di aplikasi?" },
      "Aplikasi TapGo di Google Play hanya menampilkan status paket aktif Anda. Pembelian dilakukan melalui situs ini agar sesuai dengan ketentuan distribusi aplikasi.",
      { heading: "Bila dokumen tidak lolos verifikasi" },
      "Pembayaran dikembalikan penuh. Status pengembalian dana dapat Anda pantau di halaman status pengajuan."
    ]
  },
  {
    id: "keamanan",
    tag: "Keamanan",
    readTime: "5 menit baca",
    title: "Bagaimana data dan dokumen identitas Anda dilindungi",
    summary: "Apa yang kami simpan, berapa lama, dan siapa saja yang dapat melihatnya.",
    body: [
      "Untuk memverifikasi keanggotaan, kami perlu melihat dokumen identitas Anda. Karena itu data paling sensitif yang Anda serahkan, berikut penjelasan apa adanya mengenai perlakuannya.",
      { heading: "Disimpan terenkripsi, bukan apa adanya" },
      "Foto KTP dan swafoto tidak pernah tersimpan dalam bentuk gambar biasa. Isinya dienkripsi, dan kuncinya disimpan terpisah dari database. Artinya, salinan database saja tidak cukup untuk membuka dokumen Anda.",
      { heading: "Dihapus otomatis dalam 24 jam" },
      "Dokumen hanya diperlukan selama proses pemeriksaan. Paling lama 24 jam setelah diunggah, isinya dihapus dari sistem. Yang tersisa hanya catatan bahwa dokumen pernah ada dan sudah diperiksa — bukan dokumennya.",
      { heading: "Setiap akses tercatat" },
      "Ketika petugas membuka dokumen Anda, sistem mencatat siapa yang membuka, dokumen milik siapa, dan kapan. Catatan ini tidak dapat dihapus lewat jalur biasa.",
      { heading: "Pembayaran tidak lewat rekening pribadi" },
      "Seluruh pembayaran diproses melalui payment gateway berlisensi. Kami tidak pernah meminta transfer ke rekening pribadi siapa pun. Bila ada yang mengaku dari TapGo dan meminta hal tersebut, itu penipuan — mohon laporkan kepada kami.",
      { heading: "Hak Anda" },
      "Anda dapat meminta penghapusan akun melalui halaman hapus akun. Rincian selengkapnya ada pada Kebijakan Privasi."
    ]
  }
];

const stats = [
  { value: "4", label: "Layanan terintegrasi", hint: "Ojek, Driver, PPOB, Membership" },
  { value: "3", label: "Tingkat keanggotaan", hint: "Silver, Gold, Platinum" },
  { value: "24 jam", label: "Masa simpan dokumen", hint: "Terenkripsi, lalu dihapus" },
  { value: "100%", label: "Pengembalian dana", hint: "Bila dokumen tidak terverifikasi" }
];

const faqs = [
  {
    q: "Apa saja layanan yang tersedia di TapGo?",
    a: "Empat layanan: ojek online untuk perjalanan harian, kemitraan driver bagi yang ingin berpenghasilan, layanan PPOB untuk pulsa dan tagihan, serta program membership dengan tiga tingkatan."
  },
  {
    q: "Di mana aplikasi TapGo dapat diunduh?",
    a: 'Aplikasi TapGo tersedia gratis di Google Play Store. Cari "TapGo" atau buka langsung tautan unduh di halaman ini.'
  },
  {
    q: "Bagaimana cara menjadi mitra driver TapGo?",
    a: "Daftar melalui aplikasi TapGo Driver, lengkapi data diri dan berkas kendaraan, lalu tunggu verifikasi tim kami. Setelah disetujui, akun Anda langsung dapat menerima orderan."
  },
  {
    q: "Apakah tarif diketahui sebelum memesan?",
    a: "Ya. Tarif ditampilkan penuh sebelum Anda menekan tombol pesan, sehingga tidak ada biaya tersembunyi di akhir perjalanan."
  },
  {
    q: "Bagaimana cara upgrade membership?",
    a: "Melalui situs ini. Masuk dengan akun yang sama dengan aplikasi, pilih paket, lengkapi data dan dokumen identitas, lalu selesaikan pembayaran."
  },
  {
    q: "Berapa lama dokumen identitas saya disimpan?",
    a: "Disimpan terenkripsi dan otomatis dihapus paling lama 24 jam setelah diunggah. Setiap akses petugas terhadap dokumen tercatat."
  }
];

export const metadata: Metadata = {
  title: "TapGo Lion Indonesia | Ojek Online, Mitra Driver, PPOB & Membership",
  description:
    "TapGo menyatukan ojek online, kemitraan driver, dan layanan pembayaran PPOB dalam satu akun. Tarif pasti sejak awal, atau jadikan aplikasi ini sumber penghasilan."
};

function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M4 10h11M11 5l5 5-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} viewBox="0 0 20 20" fill="none">
      <path d="M4 10.5 8.2 14 16 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <img src="/images/tapgo-mark.png" alt="TapGo Lion" className={className} loading="eager" />
  );
}

function GooglePlayButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={playStoreUrl}
      className={`inline-flex items-center gap-3 rounded-2xl bg-black px-5 py-3 text-white shadow-lg transition hover:-translate-y-0.5 ${className}`}
    >
      <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none">
        <path d="M3.6 2.6 14 12 3.6 21.4c-.4-.2-.6-.6-.6-1.1V3.7c0-.5.2-.9.6-1.1Z" fill="#00D4FF" />
        <path d="M14 12 17.5 8.7 6.2 2.3c-.4-.2-.9-.2-1.3 0L14 12Z" fill="#12B981" />
        <path d="M14 12 17.5 15.3 6.2 21.7c-.4.2-.9.2-1.3 0L14 12Z" fill="#FFC857" />
        <path d="M17.5 8.7 21 10.7c.7.4.7 1.4 0 1.8l-3.5 2-3.5-3.3 3.5-2.5Z" fill="#0B66E4" />
      </svg>
      <span className="text-left">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Dapatkan di</span>
        <span className="block text-base font-bold leading-tight">Google Play</span>
      </span>
    </a>
  );
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path d="M12 3.8a8.2 8.2 0 0 0-7 12.5l-1 3.7 3.8-1a8.2 8.2 0 1 0 4.2-15.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.9 8.5c.2-.5.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.4.5c.6 1 1.4 1.8 2.5 2.4l.5-.5c.2-.2.4-.2.7-.1l1.6.7c.3.1.4.3.4.6v.4c0 .4-.2.7-.5.8-.5.3-1.3.4-2.4 0-2.8-.9-4.9-3.1-5.8-5.8-.3-.8-.2-1.5.1-2.2Z" fill="currentColor" />
    </svg>
  );
}

function TrustIcon({ type }: { type: string }) {
  const common = "h-5 w-5";
  if (type === "building") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M5 21V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V21M14 10h3.5A1.5 1.5 0 0 1 19 11.5V21M8 8h1M8 12h1M8 16h1M17 14h1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "card") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M5 20c1-3.3 3.5-5 7-5s6 1.7 7 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
      <rect x="5" y="10.5" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ServiceIcon({ type }: { type: string }) {
  const common = "h-6 w-6";
  if (type === "moto") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <circle cx="5.5" cy="17.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="18.5" cy="17.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M5.5 17.5 9 10h4l2.5 3.5H19l-2 4M9 10 7.5 7h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "driver") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M5.5 20c1-3.7 3.5-5.5 6.5-5.5s5.5 1.8 6.5 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M17.5 8.5 19.5 10.5 22 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "receipt") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M7 4h10v16l-2-1.2-2 1.2-2-1.2-2 1.2V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M9 9h6M9 13h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
      <path d="M12 3 20 7v6c0 4.2-3.2 7.4-8 8.5C7.2 20.4 4 17.2 4 13V7l8-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepIcon({ type }: { type: string }) {
  const common = "h-5 w-5";
  if (type === "download") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 20c1-3.3 3.5-5 7-5s6 1.7 7 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "role") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
      <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-bold uppercase tracking-[0.22em] themed-accent">{children}</p>;
}

export default function Home() {
  return (
    <main data-themed="true" className="themed-text overflow-hidden">
      {/* HERO */}
      <section className="relative px-5 pb-16 pt-14 md:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-black leading-tight tracking-tight md:text-6xl">
            Aplikasi yang mengantar Anda hari ini, dan{" "}
            <span className="themed-accent">menghidupi Anda besok</span>
          </h1>
          <p className="themed-text-muted mx-auto mt-6 max-w-2xl text-lg leading-8">
            TapGo menyatukan ojek online, kemitraan driver, dan layanan pembayaran PPOB dalam satu akun. Pesan
            perjalanan dengan tarif yang sudah pasti sejak awal — atau ubah aplikasi yang sama menjadi sumber
            penghasilan, dengan modal awal dan pendampingan yang jelas sejak hari pertama.
          </p>
          <ul className="themed-text-secondary mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold">
            {["Gratis diunduh", "Tanpa biaya tersembunyi", "Daftar dalam hitungan menit"].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckIcon className="h-4 w-4 themed-accent" /> {item}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <GooglePlayButton />
            <a href={whatsappUrl} className="inline-flex items-center gap-2 rounded-full bg-brand-green px-6 py-3.5 font-bold text-white shadow-lg transition hover:-translate-y-0.5">
              <WhatsAppIcon /> Konsultasi WhatsApp
            </a>
          </div>
        </div>

        <div className="themed-border themed-card-bg mx-auto mt-14 max-w-md rounded-[2rem] border p-10 text-center">
          <LogoMark className="mx-auto h-16 w-16" />
          <p className="mt-5 text-xl font-black">Ekosistem TapGo</p>
          <p className="themed-text-muted mt-2 text-sm">Ojek Online · Mitra Driver · PPOB · Membership</p>
        </div>
      </section>

      {/* TRUST BADGES */}
      <Reveal>
      <section className="themed-border border-y px-5 py-14">
        <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {trustBadges.map((badge) => (
            <div key={badge.title} className="flex items-start gap-3">
              <div className="themed-fill grid h-10 w-10 shrink-0 place-items-center rounded-xl themed-accent">
                <TrustIcon type={badge.icon} />
              </div>
              <div>
                <p className="themed-text font-bold">{badge.title}</p>
                <p className="themed-text-muted mt-1 text-sm">{badge.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      </Reveal>

      {/* LAYANAN */}
      <Reveal>
      <section id="layanan" className="px-5 py-20">
        <div className="mx-auto max-w-3xl">
          <SectionEyebrow>Layanan</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
            Empat layanan, satu akun, satu perputaran uang
          </h2>
          <p className="themed-text-muted mt-5 text-lg leading-8">
            Penghasilan Anda sebagai driver bisa langsung dipakai menjual token listrik. Saldo PPOB Anda bisa
            melayani tetangga. Tidak ada dana yang perlu dipindah antaraplikasi, dan tidak ada pendaftaran yang
            perlu diulang.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-2">
          {services.map((service) => (
            <article key={service.title} className="themed-border themed-card-bg rounded-[1.75rem] border p-7">
              <div className="themed-fill grid h-12 w-12 place-items-center rounded-2xl themed-accent">
                <ServiceIcon type={service.icon} />
              </div>
              <p className="themed-fill themed-text-secondary mt-5 inline-flex rounded-full px-3 py-1 text-xs font-bold">
                {service.title}
              </p>
              <h3 className="themed-text mt-3 text-xl font-black">{service.headline}</h3>
              <p className="themed-text-muted mt-3 leading-7">{service.desc}</p>
              {service.items ? (
                <ul className="mt-5 space-y-2">
                  {service.items.map((item) => (
                    <li key={item} className="themed-text-secondary flex items-center gap-2 text-sm">
                      <CheckIcon className="h-4 w-4 themed-accent" /> {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <a href="#membership" className="mt-5 inline-flex items-center gap-2 font-bold themed-accent">
                  {service.linkLabel} <ArrowIcon />
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
      </Reveal>

      {/* CARA KERJA */}
      <Reveal>
      <section id="cara-kerja" className="themed-border border-t px-5 py-20">
        <div className="mx-auto max-w-3xl">
          <SectionEyebrow>Cara Kerja</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
            Empat titik yang berputar di satu poros
          </h2>
          <p className="themed-text-muted mt-5 text-lg leading-8">
            Dari mengunduh sampai menerima uang pertama, seluruhnya berjalan di satu akun. Anda tidak perlu memilih
            peran sekarang — satu akun bisa menjadi penumpang, driver, dan agen sekaligus.
          </p>
        </div>
        {/* Diagram orbit — dekoratif, hanya layar lebar. Disembunyikan dari
            pembaca layar karena grid kartu di bawahnya menyampaikan isi yang
            sama secara berurut dan lebih mudah diakses. */}
        <div className="orbit-wrap-pad hidden min-[900px]:block">
          <div className="orbit" aria-hidden="true">
            <div className="orbit-ring" />
            <div className="orbit-ring orbit-ring-2" />
            <div className="orbit-ring orbit-ring-3" />
            <div className="orbit-ripple" />
            <div className="orbit-ripple" />
            <div className="orbit-ripple" />
            <div className="orbit-core">
              <LogoMark className="h-9 w-9" />
              <b className="text-[13px] font-black text-white">Satu Akun</b>
            </div>
            {workSteps.map((step, index) => (
              <div
                key={`spoke-${step.title}`}
                className="orbit-spoke"
                style={{ ["--a" as string]: `${index * 90}deg` } as React.CSSProperties}
              />
            ))}
            {workSteps.map((step, index) => (
              <div
                key={step.title}
                className="orbit-node"
                style={{ ["--a" as string]: `${index * 90}deg` } as React.CSSProperties}
              >
                <div className="orbit-node-in">
                  <div className="orbit-node-icon mx-auto grid h-8 w-8 place-items-center bg-white/5 text-brand-gold">
                    <StepIcon type={step.icon} />
                  </div>
                  <em className="mt-1.5 block text-[10px] font-bold not-italic uppercase tracking-wider text-brand-gold/80">
                    Langkah {index + 1}
                  </em>
                  <b className="block text-[13px] font-black leading-tight text-white">{step.short}</b>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Daftar untuk layar sempit: diagram orbit tidak terbaca di ponsel. */}
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 min-[900px]:hidden md:grid-cols-2">
          {workSteps.map((step) => (
            <div key={step.title} className="themed-border themed-card-bg rounded-[1.75rem] border p-6">
              <div className="themed-fill grid h-12 w-12 place-items-center rounded-2xl themed-accent">
                <StepIcon type={step.icon} />
              </div>
              <h3 className="themed-text mt-6 text-lg font-black">{step.title}</h3>
              <p className="themed-text-muted mt-2 text-sm leading-6">{step.desc}</p>
            </div>
          ))}
        </div>

        {/* Aksen navy gelap tetap (bukan ikut tema) — lihat catatan di
            globals.css. Teks di dalamnya memakai warna eksplisit supaya
            tetap kontras terlepas dari tema halaman. */}
        <div className="mx-auto mt-10 max-w-6xl rounded-[2rem] border border-white/10 bg-gradient-to-br from-brand-navySoft to-brand-navyDeep p-8 text-center md:p-12">
          <SectionEyebrow>Gratis di Google Play</SectionEyebrow>
          <h3 className="mx-auto mt-3 max-w-2xl text-2xl font-black text-white md:text-4xl">Pasang dulu, putuskan nanti</h3>
          <p className="mx-auto mt-4 max-w-2xl leading-7 text-slate-400">
            Mengunduh dan mendaftar sepenuhnya gratis, dan Anda tidak terikat apa pun. Lihat sendiri tarifnya, lihat
            sendiri layanannya — baru tentukan apakah Anda ingin menjadi penumpang, mitra driver, atau agen.
            Tersedia untuk Android.
          </p>
          <div className="mt-7 flex justify-center">
            <GooglePlayButton />
          </div>
          <p className="mt-4 text-xs text-slate-500">Paket aplikasi: com.xavindo.tapgo</p>
        </div>
      </section>
      </Reveal>

      {/* MEMBERSHIP */}
      <Reveal>
      <section id="membership" className="themed-border border-t px-5 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <SectionEyebrow>Membership</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Modal usaha yang langsung bisa diputar</h2>
          <p className="themed-text-muted mt-5 text-lg leading-8">
            Biaya keanggotaan tidak hilang begitu saja — sebagian besar kembali kepada Anda sebagai saldo PPOB yang
            siap dijual. Upgrade diproses di situs ini; aplikasi di Google Play hanya menampilkan status paket aktif
            Anda.
          </p>
          <p className="themed-text-muted mt-4 text-sm font-semibold">
            Sudah punya akun TapGo?{" "}
            <a href="/upgrade" className="themed-accent underline underline-offset-4 hover:opacity-80">
              Upgrade paket membership Anda di sini
            </a>
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
          {packages.map((pkg) => (
            <article
              key={pkg.name}
              // Kartu "Paling dipilih" SENGAJA tetap aksen navy gelap tetap
              // (bukan ikut tema) supaya tetap menonjol di kedua tema — lihat
              // catatan di globals.css. Kartu lain ikut tema halaman.
              className={`relative rounded-[1.75rem] border p-7 ${
                pkg.popular ? "border-brand-gold bg-brand-navySoft" : "themed-border themed-card-bg"
              }`}
            >
              {pkg.popular ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-gold px-3 py-1 text-[11px] font-black uppercase tracking-wide text-brand-navyDeep">
                  Paling dipilih
                </span>
              ) : null}
              <p className="text-xs font-black uppercase tracking-[0.2em] themed-accent">{pkg.name}</p>
              <p className={`mt-3 text-3xl font-black ${pkg.popular ? "text-white" : "themed-text"}`}>{pkg.price}</p>
              <p className={`mt-3 text-sm leading-6 ${pkg.popular ? "text-slate-400" : "themed-text-muted"}`}>
                {pkg.highlight}
              </p>
              <ul className="mt-6 space-y-3">
                {pkg.items.map((item) => (
                  <li
                    key={item}
                    className={`flex items-start gap-2 text-sm ${pkg.popular ? "text-slate-300" : "themed-text-secondary"}`}
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 themed-accent" /> {item}
                  </li>
                ))}
              </ul>
              {/* Tombol paket di homepage produksi mengarah ke /upgrade (alur
                  pembelian sungguhan untuk pengguna yang sudah punya akun),
                  BUKAN ke /daftar (form minat WhatsApp untuk yang belum
                  punya akun) — dikonfirmasi lewat tapgolion.id langsung. */}
              <a
                href="/upgrade"
                className={`mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition hover:-translate-y-0.5 ${
                  pkg.popular ? "bg-brand-gold text-brand-navyDeep" : "themed-fill-strong themed-text"
                }`}
              >
                {pkg.cta} <ArrowIcon />
              </a>
            </article>
          ))}
        </div>
        <p className="themed-text-muted mx-auto mt-8 max-w-3xl text-center text-sm leading-7">
          Harga sudah termasuk seluruh biaya — tidak ada iuran bulanan dan tidak ada potongan tersembunyi.
          Pembayaran diproses payment gateway berlisensi. Bila dokumen identitas tidak dapat diverifikasi,
          pembayaran dikembalikan penuh sesuai kebijakan pengembalian dana.
        </p>
      </section>
      </Reveal>

      {/* PUSAT EDUKASI */}
      <Reveal>
      <section id="edukasi" className="themed-border border-t px-5 py-20">
        <div className="mx-auto max-w-3xl">
          <SectionEyebrow>Pusat Edukasi</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Panduan lengkap memakai TapGo</h2>
          <p className="themed-text-muted mt-5 text-lg leading-8">
            Enam panduan yang menjawab pertanyaan sebenarnya: berapa biayanya, apa syaratnya, dan apa yang terjadi
            kalau ada masalah. Klik judul untuk membaca isi lengkapnya.
          </p>
        </div>
        <div className="mx-auto mt-10 max-w-4xl space-y-4">
          {articles.map((article) => (
            <details key={article.id} id={article.id} className="group themed-border themed-card-bg rounded-[1.5rem] border p-6">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] themed-accent">
                      {article.tag} · {article.readTime}
                    </p>
                    <h3 className="themed-text mt-2 text-lg font-black md:text-xl">{article.title}</h3>
                    <p className="themed-text-muted mt-2 text-sm leading-6">{article.summary}</p>
                  </div>
                  <span aria-hidden="true" className="mt-1 shrink-0 themed-accent transition group-open:rotate-45">
                    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                </div>
              </summary>
              <div className="themed-border themed-text-secondary mt-6 space-y-4 border-t pt-6 text-sm leading-7">
                {article.body.map((block, index) => {
                  if (typeof block === "string") {
                    return <p key={index}>{block}</p>;
                  }
                  if ("heading" in block) {
                    return (
                      <h4 key={index} className="themed-text text-base font-black">
                        {block.heading}
                      </h4>
                    );
                  }
                  return (
                    <ol key={index} className="list-decimal space-y-2 pl-5">
                      {block.list.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>
      </Reveal>

      {/* STATS */}
      <Reveal>
      <section className="themed-border border-t px-5 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="themed-border themed-card-bg rounded-[1.5rem] border p-6 text-center">
              <p className="text-3xl font-black themed-accent">{stat.value}</p>
              <p className="themed-text mt-2 font-bold">{stat.label}</p>
              <p className="themed-text-muted mt-1 text-xs">{stat.hint}</p>
            </div>
          ))}
        </div>
      </section>
      </Reveal>

      {/* FAQ */}
      <Reveal>
      <section id="faq" className="themed-border border-t px-5 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <SectionEyebrow>Pertanyaan Umum</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Yang paling sering ditanyakan</h2>
          <p className="themed-text-muted mt-5 text-lg leading-8">
            Tidak menemukan jawabannya? Tim kami membalas pesan WhatsApp setiap hari.
          </p>
          <a href={whatsappUrl} className="mt-5 inline-flex items-center gap-2 font-bold themed-accent">
            Tanya via WhatsApp <ArrowIcon />
          </a>
        </div>
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {faqs.map((faq) => (
            <details key={faq.q} className="group themed-border themed-card-bg rounded-[1.5rem] border p-6">
              <summary className="themed-text cursor-pointer list-none font-bold">{faq.q}</summary>
              <p className="themed-text-muted mt-4 leading-7">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>
      </Reveal>

      {/* KONTAK */}
      <Reveal>
      <section id="kontak" className="themed-border border-t px-5 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <SectionEyebrow>Hubungi Kami</SectionEyebrow>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Siap bergabung dengan TapGo Lion?</h2>
          <p className="themed-text-muted mt-5 text-lg leading-8">
            Masih ragu paket mana yang cocok, atau ingin memastikan syarat menjadi mitra driver? Kirim pesan
            WhatsApp dan tim kami menjawab langsung — tanpa biaya, tanpa kewajiban mendaftar.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={whatsappUrl} className="inline-flex items-center gap-2 rounded-full bg-brand-green px-6 py-3.5 font-bold text-white shadow-lg transition hover:-translate-y-0.5">
              <WhatsAppIcon /> Chat WhatsApp
            </a>
            <GooglePlayButton />
          </div>
        </div>

        <div className="themed-border themed-card-bg mx-auto mt-14 grid max-w-5xl gap-8 rounded-[2rem] border p-8 md:grid-cols-2 md:p-12">
          <div>
            <p className="themed-text-secondary text-lg font-semibold">WhatsApp</p>
            <p className="themed-text text-xl font-black">+62 838-0025-5588</p>
            <p className="themed-text-secondary mt-5 text-lg font-semibold">Situs resmi</p>
            <p className="themed-text text-xl font-black">tapgolion.id</p>
            <p className="themed-text-secondary mt-5 text-lg font-semibold">Badan usaha</p>
            <p className="themed-text text-xl font-black">PT. TapGo Lion Indonesia</p>
          </div>
          <ContactLeadForm />
        </div>
      </section>
      </Reveal>

    </main>
  );
}
