import Link from "next/link";

/**
 * Kerangka alur upgrade membership (Stage R2.6 jalur A).
 *
 * Pembelian membership terjadi di web, bukan di dalam aplikasi. Aplikasi yang
 * diunggah ke Google Play hanya menampilkan paket aktif — tanpa tombol beli dan
 * tanpa tautan ke halaman ini.
 */
export const UPGRADE_STEPS = [
  { slug: "masuk", label: "Masuk", href: "/upgrade" },
  { slug: "paket", label: "Pilih Paket", href: "/upgrade/paket" },
  { slug: "data", label: "Data & Dokumen", href: "/upgrade/data" },
  { slug: "bayar", label: "Pembayaran", href: "/upgrade/bayar" },
  { slug: "status", label: "Status", href: "/upgrade/status" },
  { slug: "tim-referral", label: "Referral", href: "/upgrade/tim-referral" }
] as const;

export type UpgradeStepSlug = (typeof UPGRADE_STEPS)[number]["slug"];

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <path
        d="m5 13 4 4 10-10"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UpgradeStepper({ current }: { current: UpgradeStepSlug }) {
  const currentIndex = UPGRADE_STEPS.findIndex((s) => s.slug === current);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3" aria-label="Langkah upgrade">
      {UPGRADE_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.slug} className="flex items-center gap-2">
            <span
              aria-current={active ? "step" : undefined}
              className={[
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition",
                active
                  ? "bg-brand-gold text-brand-navyDeep shadow-lg"
                  : done
                    ? "bg-brand-green/15 text-brand-green"
                    : "themed-fill themed-text-muted"
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black",
                  active ? "bg-white/30" : done ? "bg-brand-green/25" : "themed-fill-strong themed-text"
                ].join(" ")}
              >
                {done ? <CheckIcon /> : index + 1}
              </span>
              {step.label}
            </span>
            {index < UPGRADE_STEPS.length - 1 ? (
              <span aria-hidden="true" className="themed-border hidden h-px w-5 border-t sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Penanda kejujuran saat halaman dirender dengan data contoh. */
export function PreviewBadge() {
  return (
    <p className="mb-5 flex items-start gap-2 rounded-2xl bg-amber-100/80 px-4 py-3 text-xs font-bold text-amber-800">
      <span aria-hidden="true">⚑</span>
      <span>
        DATA CONTOH — halaman ini sedang ditinjau tampilannya dan tidak terhubung
        ke server. Tidak ada transaksi nyata yang terjadi.
      </span>
    </p>
  );
}

export function UpgradeShell({
  step,
  title,
  subtitle,
  preview = false,
  children
}: {
  step: UpgradeStepSlug;
  title: string;
  subtitle: string;
  preview?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main data-themed="true" className="themed-text min-h-screen px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="themed-accent text-sm font-bold">
          Kembali ke Home
        </Link>

        <div className="themed-border themed-card-bg mt-6 rounded-[2rem] border p-6 md:p-10">
          {preview ? <PreviewBadge /> : null}

          <div className="flex items-center gap-3">
            <img src="/images/tapgo-mark.png" alt="TapGo Lion" className="h-11 w-11" />
            <div>
              <p className="themed-accent text-[11px] font-bold uppercase tracking-[0.22em]">
                Upgrade Membership
              </p>
              <p className="themed-text text-sm font-bold">PT. TapGo Lion Indonesia</p>
            </div>
          </div>

          <div className="mt-7">
            <UpgradeStepper current={step} />
          </div>

          <h1 className="themed-text mt-7 text-3xl font-black leading-tight md:text-4xl">
            {title}
          </h1>
          <p className="themed-text-muted mt-3 text-sm leading-7">{subtitle}</p>

          <div className="mt-8">{children}</div>
        </div>

        <p className="themed-text-muted mx-auto mt-6 max-w-2xl text-center text-xs leading-6">
          Upgrade membership diproses melalui situs ini. Aplikasi TapGo di Google
          Play hanya menampilkan status paket aktif Anda.{" "}
          <Link href="/refund-policy" className="themed-accent font-bold">
            Kebijakan pengembalian dana
          </Link>
        </p>
      </div>
    </main>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="themed-text-muted text-xs font-bold uppercase tracking-wider">{label}</span>
      {children}
      {hint ? <span className="themed-text-muted mt-1.5 block text-xs">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3.5 text-base text-brand-navyDeep outline-none transition placeholder:text-slate-400 focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20";

// Variant Tailwind (hover:/disabled:) tidak mengenali kelas custom kita
// (themed-*) sebagai utility, jadi tidak menghasilkan CSS apa pun bila
// ditulis sebagai mis. "hover:themed-accent" — sengaja memakai notasi
// arbitrary-value yang merujuk variabel CSS yang sama secara langsung.
export const primaryButtonClass =
  "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-gold px-6 text-base font-black text-brand-navyDeep shadow-lg transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:shadow-none disabled:bg-[var(--themed-fill-2)] disabled:text-[var(--themed-text-muted)]";

export const secondaryButtonClass =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border themed-border themed-fill px-6 text-base font-bold themed-text transition hover:border-brand-gold hover:text-[var(--themed-accent-gold)]";

export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}
