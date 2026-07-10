const registerUrl = "/daftar";
const whatsappUrl =
  "https://wa.me/6283800255588?text=Halo%20TapGo%20Lion%2C%20saya%20ingin%20mendapatkan%20informasi%20mengenai%20membership%20TapGo.";

const companyAddress = [
  "PT. TapGo Lion Indonesia",
  "Jalan Kp. Pasir Gendok No. 11",
  "Desa Bojongleles",
  "Kecamatan Rangkasbitung",
  "Kabupaten Lebak",
  "Banten",
  "Indonesia"
];

const features = [
  { title: "Membership Digital", icon: "card" },
  { title: "Komunitas Aktif", icon: "community" },
  { title: "Wallet Digital", icon: "wallet" },
  { title: "Layanan PPOB", icon: "receipt" },
  { title: "Sistem Referral Modern", icon: "network" },
  { title: "Dashboard Bisnis", icon: "dashboard" },
  { title: "Monitoring Transaksi", icon: "monitor" },
  { title: "Dukungan Teknologi", icon: "support" }
];

const advantages = [
  {
    title: "Platform Digital Modern",
    desc: "Pengalaman membership dirancang mobile-first, cepat, dan mudah digunakan oleh anggota di seluruh Indonesia."
  },
  {
    title: "Membership Mudah Digunakan",
    desc: "Proses keanggotaan dibuat ringkas dengan informasi paket, manfaat, dan aktivasi yang jelas."
  },
  {
    title: "Dashboard Transparan",
    desc: "Anggota dapat memantau informasi akun, transaksi, aktivitas membership, dan perkembangan komunitas secara rapi."
  },
  {
    title: "Wallet Terintegrasi",
    desc: "Wallet digital internal membantu pencatatan saldo, benefit, dan aktivitas ekosistem TapGo secara terstruktur."
  },
  {
    title: "Komunitas Berkembang",
    desc: "TapGo mendukung kolaborasi anggota, edukasi bisnis, dan peluang usaha berbasis teknologi."
  },
  {
    title: "Dukungan Teknologi Berkelanjutan",
    desc: "Sistem terus dikembangkan untuk mendukung keamanan, performa, dan kebutuhan operasional digital."
  }
];

const joinSteps = [
  "Pilih Paket Membership",
  "Lengkapi Pendaftaran",
  "Aktivasi Keanggotaan",
  "Nikmati Berbagai Manfaat Membership"
];

const packages = [
  {
    name: "Basic",
    slug: "basic",
    price: "Gratis",
    highlight: "Untuk memulai",
    accent: "from-brand-cyan to-brand-green",
    items: ["Bonus saldo Rp5.000", "Sponsor bonus Rp2.000", "Berlaku untuk 1.000 member pertama"]
  },
  {
    name: "Silver",
    slug: "silver",
    price: "Rp500.000",
    highlight: "Membership usaha",
    accent: "from-slate-500 to-brand-cyan",
    items: ["Saldo PPOB Rp100.000", "BPJS Ketenagakerjaan", "Hak Usaha"]
  },
  {
    name: "Gold",
    slug: "gold",
    price: "Rp3.000.000",
    highlight: "Benefit lebih luas",
    accent: "from-amber-400 to-brand-green",
    items: ["Saldo PPOB Rp600.000", "BPJS Ketenagakerjaan", "Hak Usaha"]
  },
  {
    name: "Platinum",
    slug: "platinum",
    price: "Rp5.500.000",
    highlight: "Akses prioritas",
    accent: "from-brand-blue to-brand-green",
    items: ["Saldo PPOB Rp1.000.000", "BPJS Ketenagakerjaan", "Hak Usaha Prioritas"]
  }
];

const faqs = [
  {
    q: "Apa itu TapGo?",
    a: "TapGo adalah platform membership digital yang menghadirkan manfaat keanggotaan, layanan digital, peluang usaha, dan komunitas berbasis teknologi."
  },
  {
    q: "Bagaimana cara mendaftar?",
    a: "Calon member dapat membuka halaman daftar, memilih paket membership, mengisi data yang diperlukan, lalu mengikuti instruksi aktivasi."
  },
  {
    q: "Bagaimana cara aktivasi membership?",
    a: "Aktivasi dilakukan setelah data pendaftaran dan pembayaran paket, jika ada, berhasil diverifikasi melalui sistem atau tim TapGo."
  },
  {
    q: "Apa manfaat membership?",
    a: "Manfaat dapat berupa akses layanan digital, wallet internal, layanan PPOB, komunitas, dashboard, benefit paket, dan peluang usaha sesuai ketentuan."
  },
  {
    q: "Bagaimana cara menggunakan aplikasi?",
    a: "Setelah membership aktif, member dapat login ke aplikasi TapGo untuk memantau akun, transaksi, wallet, layanan digital, dan informasi membership."
  },
  {
    q: "Bagaimana menghubungi support?",
    a: "Support dapat dihubungi melalui WhatsApp +62 838-0025-5588 atau email support@tapgolion.id."
  },
  {
    q: "Apakah data saya aman?",
    a: "TapGo menerapkan pengelolaan data yang wajar untuk kebutuhan verifikasi, transaksi, keamanan akun, dan dukungan layanan sesuai Kebijakan Privasi."
  },
  {
    q: "Bagaimana kebijakan refund?",
    a: "Refund mengikuti ketentuan perusahaan, status aktivasi membership, bukti transaksi, dan hasil verifikasi support."
  }
];

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none">
      <path d="M4 10.5 8.2 14 16 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M4 10h11M11 5l5 5-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <img
      src="/images/tapgo-logo.png"
      alt="TapGo Lion"
      className={`${className} rounded-2xl object-cover shadow-sm`}
      loading="eager"
    />
  );
}

function FeatureIcon({ type }: { type: string }) {
  const common = "h-6 w-6";

  if (type === "community") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.9" />
        <path d="M3.5 19c.8-3.2 2.6-4.8 5.2-4.8 1.4 0 2.5.4 3.3 1.2.8-.8 1.9-1.2 3.3-1.2 2.6 0 4.4 1.6 5.2 4.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "wallet") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M4 7.5h14.5A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-12A3.5 3.5 0 0 1 3 16V8.5A3.5 3.5 0 0 1 6.5 5H17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M17 13.5h.1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "receipt") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M7 4h10v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2V4Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M9 9h6M9 13h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "network") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M12 6v5M8 16l4-5 4 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM18 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="1.9" />
      </svg>
    );
  }

  if (type === "dashboard") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" stroke="currentColor" strokeWidth="1.9" />
        <path d="M8 16V11M12 16V8M16 16v-3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "monitor") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M4 6h16v10H4V6Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M9 20h6M12 16v4M7.5 12l2.2-2.2 2 2 3.8-3.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (type === "support") {
    return (
      <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
        <path d="M5 12a7 7 0 0 1 14 0v3a3 3 0 0 1-3 3h-2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M5 12h3v5H6.5A1.5 1.5 0 0 1 5 15.5V12ZM19 12h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5V12ZM11 18h3" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={common} viewBox="0 0 24 24" fill="none">
      <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto h-[500px] w-full max-w-[440px] [perspective:1200px]">
      <div className="mesh-grid absolute inset-0 rounded-[2rem]" />
      <div className="float-slow absolute left-4 top-10 rounded-3xl border border-white/70 bg-white/75 px-4 py-3 text-sm font-bold text-brand-navy shadow-glass backdrop-blur">
        Membership aktif
      </div>
      <div className="float-delay absolute right-2 top-28 rounded-3xl border border-white/70 bg-white/75 px-4 py-3 text-sm font-bold text-brand-navy shadow-glass backdrop-blur">
        Wallet digital
      </div>
      <div className="float-delay absolute bottom-28 left-0 rounded-3xl border border-white/70 bg-white/75 px-4 py-3 text-sm font-bold text-brand-navy shadow-glass backdrop-blur">
        Layanan PPOB
      </div>
      <div className="absolute left-1/2 top-12 h-[410px] w-[235px] -translate-x-1/2 rotate-[-5deg] rounded-[2rem] border-[10px] border-brand-navy bg-brand-navy shadow-glow [transform-style:preserve-3d]">
        <div className="h-full overflow-hidden rounded-[1.35rem] bg-gradient-to-b from-white to-brand-mist p-4">
          <div className="mx-auto mb-5 h-1.5 w-16 rounded-full bg-slate-300" />
          <div className="rounded-2xl bg-gradient-to-br from-brand-blue via-brand-cyan to-brand-green p-4 text-white shadow-glow">
            <div className="flex items-center gap-2">
              <LogoMark className="h-8 w-8 rounded-xl" />
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/85">TapGo</p>
            </div>
            <p className="mt-8 text-2xl font-black">Digital Member</p>
            <p className="mt-1 text-sm text-white/80">Peluang usaha teknologi</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {["PPOB", "Wallet", "Usaha", "Support"].map((item) => (
              <div key={item} className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="mb-3 h-8 w-8 rounded-xl bg-brand-cyan/15" />
                <p className="text-xs font-bold text-brand-navy">{item}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl bg-brand-navy p-4 text-white">
            <p className="text-xs text-white/70">Status</p>
            <p className="mt-1 text-lg font-black">Siap berkembang</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EcosystemVisual() {
  const items = ["Member", "PPOB", "Wallet", "Dashboard", "Support"];

  return (
    <div className="relative min-h-[340px] overflow-hidden rounded-[2rem] border border-white/70 bg-white/60 p-6 shadow-glass backdrop-blur">
      <div className="spin-slow absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-brand-cyan/30" />
      <div className="absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[1.6rem] bg-gradient-to-br from-brand-blue to-brand-green text-center text-sm font-black text-white shadow-glow">
        TapGo
      </div>
      {items.map((item, index) => {
        const positions = [
          "left-[8%] top-[15%]",
          "right-[8%] top-[18%]",
          "left-[12%] bottom-[18%]",
          "right-[10%] bottom-[16%]",
          "left-1/2 top-[6%] -translate-x-1/2"
        ];

        return (
          <div
            key={item}
            className={`float-slow absolute rounded-3xl border border-white/80 bg-white/80 px-5 py-4 text-sm font-black text-brand-navy shadow-glass backdrop-blur ${positions[index]}`}
            style={{ animationDelay: `${index * -0.55}s` }}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-brand-navy md:text-5xl">{title}</h2>
      {children ? <p className="mt-5 text-base leading-8 text-slate-600 md:text-lg">{children}</p> : null}
    </div>
  );
}

export default function Home() {
  return (
    <main className="overflow-hidden">
      <nav className="sticky top-0 z-50 border-b border-white/70 bg-white/[0.78] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <a href="/" className="flex items-center gap-3 font-bold text-brand-navy" aria-label="TapGo Lion Indonesia">
            <LogoMark />
            <span>TapGo Lion</span>
          </a>
          <div className="hidden items-center gap-7 text-sm font-semibold text-slate-600 lg:flex">
            <a href="#tentang">Tentang</a>
            <a href="#keunggulan">Keunggulan</a>
            <a href="#membership">Membership</a>
            <a href="#faq">FAQ</a>
            <a href="/contact">Contact</a>
          </div>
          <a href={registerUrl} className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-5 py-2.5 text-sm font-bold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-brand-blue">
            Daftar <ArrowIcon />
          </a>
        </div>
      </nav>

      <section className="relative px-5 pb-20 pt-16 md:pt-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex rounded-full border border-brand-cyan/30 bg-white/70 px-4 py-2 text-sm font-bold text-brand-blue shadow-sm backdrop-blur">
              <LogoMark className="mr-2 h-6 w-6 rounded-lg" />
              PT. TapGo Lion Indonesia
            </div>
            <h1 className="mt-7 max-w-4xl text-4xl font-black tracking-tight text-brand-navy md:text-6xl">
              Bangun Ekosistem Membership Digital Bersama TapGo
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 md:text-xl">
              Platform membership digital yang menghadirkan berbagai manfaat, peluang usaha, layanan digital, dan ekosistem komunitas yang dirancang untuk berkembang bersama.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={registerUrl} className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-blue to-brand-green px-7 py-4 text-center font-bold text-white shadow-glow transition hover:-translate-y-1">
                Daftar Sekarang <ArrowIcon />
              </a>
              <a href="#membership" className="rounded-full border border-brand-blue/20 bg-white/80 px-7 py-4 text-center font-bold text-brand-navy shadow-sm transition hover:-translate-y-1 hover:border-brand-green/40">
                Pelajari Membership
              </a>
            </div>
            <div className="mt-10 grid gap-3 text-sm font-semibold text-slate-600 sm:grid-cols-3">
              {["Perusahaan Indonesia", "Ekosistem teknologi", "Siap verifikasi digital"].map((badge) => (
                <div key={badge} className="glass rounded-2xl px-4 py-3">{badge}</div>
              ))}
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section className="px-5 py-12">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-4">
          {["Bukan investasi", "Bukan pinjaman online", "Bukan penghimpunan dana", "Platform membership digital"].map((item) => (
            <div key={item} className="glass rounded-3xl p-6 text-center font-bold text-brand-navy">{item}</div>
          ))}
        </div>
      </section>

      <section id="tentang" className="px-5 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Apa Itu TapGo?</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-brand-navy md:text-5xl">Platform membership digital untuk ekonomi berbasis teknologi.</h2>
          </div>
          <div className="glass rounded-[2rem] p-8 text-lg leading-9 text-slate-700">
            TapGo adalah platform membership digital yang menghubungkan anggota dengan berbagai manfaat, layanan digital, peluang usaha, dan komunitas yang saling mendukung dalam pengembangan ekonomi berbasis teknologi.
          </div>
        </div>
        <div className="mx-auto mt-10 grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-3xl border border-brand-blue/10 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-glass">
              <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-blue/12 to-brand-green/18 text-brand-blue">
                <FeatureIcon type={feature.icon} />
              </div>
              <p className="font-black text-brand-navy">{feature.title}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="keunggulan" className="bg-gradient-to-b from-white to-brand-mist px-5 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Keunggulan</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-brand-navy md:text-5xl">Mengapa Memilih TapGo?</h2>
            <p className="mt-5 text-base leading-8 text-slate-700 md:text-lg">
              TapGo dibangun untuk calon member umum, komunitas, dan pelaku usaha yang membutuhkan sistem digital yang modern, jelas, dan mudah diakses.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {advantages.map((item) => (
              <article key={item.title} className="rounded-[1.6rem] border border-brand-blue/10 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-glass">
                <h3 className="text-xl font-black text-brand-navy">{item.title}</h3>
                <p className="mt-4 leading-7 text-slate-700">{item.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20">
        <SectionTitle eyebrow="Cara Bergabung" title="Mulai membership dalam empat langkah." />
        <div className="mx-auto mt-12 grid max-w-7xl gap-5 md:grid-cols-4">
          {joinSteps.map((step, index) => (
            <div key={step} className="tilt-card glass rounded-[2rem] p-6">
              <div className="mb-8 grid h-12 w-12 place-items-center rounded-2xl bg-brand-navy text-lg font-black text-white">{index + 1}</div>
              <h3 className="text-xl font-black text-brand-navy">{step}</h3>
            </div>
          ))}
        </div>
      </section>

      <section id="membership" className="px-5 py-20">
        <SectionTitle eyebrow="Membership" title="Paket membership TapGo.">
          Pilih paket sesuai kebutuhan. Manfaat membership mengikuti ketentuan perusahaan dan status aktivasi akun.
        </SectionTitle>
        <div className="mx-auto mt-12 grid max-w-7xl gap-5 md:grid-cols-2 xl:grid-cols-4">
          {packages.map((pkg) => (
            <article key={pkg.name} className="tilt-card glass rounded-[2rem] p-6">
              <div className={`mb-6 h-2 rounded-full bg-gradient-to-r ${pkg.accent}`} />
              <p className="text-sm font-bold text-brand-green">{pkg.highlight}</p>
              <h3 className="mt-2 text-2xl font-black text-brand-navy">{pkg.name}</h3>
              <p className="mt-3 text-3xl font-black text-brand-blue">{pkg.price}</p>
              <ul className="mt-7 space-y-4 text-sm font-medium text-slate-600">
                {pkg.items.map((item) => (
                  <li key={item} className="flex gap-3"><span className="mt-0.5 text-brand-green"><CheckIcon /></span>{item}</li>
                ))}
              </ul>
              <a href={`/daftar?package=${pkg.slug}`} className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-navy px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-brand-blue">
                Daftar Sekarang <ArrowIcon />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Ekosistem Digital</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-brand-navy md:text-5xl">Membership, layanan, dan komunitas dalam satu alur digital.</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              TapGo menggabungkan layanan PPOB, wallet internal, dashboard bisnis, monitoring transaksi, dan dukungan komunitas untuk membantu anggota menjalankan peluang usaha secara lebih terstruktur.
            </p>
          </div>
          <EcosystemVisual />
        </div>
      </section>

      <section className="px-5 py-20">
        <div className="mx-auto max-w-7xl rounded-[2rem] bg-gradient-to-br from-brand-navy via-[#0C3559] to-brand-blue p-8 text-white shadow-glow md:p-12">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="md:col-span-2">
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Compliance</p>
              <h2 className="mt-3 text-3xl font-black md:text-5xl">Bahasa bisnis yang jelas dan bertanggung jawab.</h2>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-white/75">
                TapGo adalah platform membership digital dan peluang usaha berbasis teknologi. TapGo bukan produk investasi, bukan pinjaman online, bukan penghimpunan dana masyarakat, dan tidak menjanjikan keuntungan.
              </p>
            </div>
            <div className="glass rounded-[2rem] p-6 text-brand-navy">
              <p className="text-sm font-bold text-slate-500">Catatan manfaat</p>
              <p className="mt-3 text-2xl font-black">Sesuai ketentuan</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">Benefit, reward membership, dan program referral mengikuti syarat, verifikasi, dan kebijakan PT. TapGo Lion Indonesia.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="px-5 py-20">
        <SectionTitle eyebrow="FAQ" title="Pertanyaan umum." />
        <div className="mx-auto mt-10 grid max-w-4xl gap-4">
          {faqs.map((faq) => (
            <details key={faq.q} className="group rounded-3xl border border-brand-blue/10 bg-white p-6 shadow-sm">
              <summary className="cursor-pointer list-none font-bold text-brand-navy">{faq.q}</summary>
              <p className="mt-4 leading-7 text-slate-600">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contact" className="px-5 py-20">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-[2rem] border border-brand-cyan/15 bg-white p-8 shadow-glass md:grid-cols-2 md:p-12">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">Contact</p>
            <h2 className="mt-3 text-3xl font-black text-brand-navy md:text-5xl">PT. TapGo Lion Indonesia</h2>
            <div className="mt-6 space-y-1 leading-7 text-slate-600">
              {companyAddress.map((line) => <p key={line}>{line}</p>)}
            </div>
          </div>
          <div className="space-y-4 text-lg font-semibold text-slate-700">
            <p>Website: https://tapgolion.id</p>
            <p>Email: <a className="text-brand-blue" href="mailto:support@tapgolion.id">support@tapgolion.id</a></p>
            <p>WhatsApp: +62 838-0025-5588</p>
            <a href={whatsappUrl} className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-blue to-brand-green px-6 py-3 text-sm font-bold text-white shadow-glow transition hover:-translate-y-1">
              Chat WhatsApp <ArrowIcon />
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-brand-blue/10 px-5 py-10">
        <div className="mx-auto grid max-w-7xl gap-8 text-sm text-slate-600 md:grid-cols-[1.2fr_0.9fr_0.7fr]">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark className="h-9 w-9" />
              <p className="font-bold text-brand-navy">PT. TapGo Lion Indonesia</p>
            </div>
            <p className="mt-4">© 2026 PT. TapGo Lion Indonesia. All rights reserved.</p>
          </div>
          <address className="not-italic leading-7 text-slate-700">
            {companyAddress.map((line) => <p key={line}>{line}</p>)}
          </address>
          <div className="flex flex-wrap content-start gap-5 font-semibold">
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms-and-conditions">Terms & Conditions</a>
            <a href="/refund-policy">Refund Policy</a>
            <a href="/contact">Contact</a>
            <a href="/delete-account">Hapus Akun</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
