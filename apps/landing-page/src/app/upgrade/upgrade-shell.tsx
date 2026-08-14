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
  { slug: "status", label: "Status", href: "/upgrade/status" }
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
                  ? "bg-brand-blue text-white shadow-glow"
                  : done
                    ? "bg-brand-green/12 text-brand-green"
                    : "bg-slate-100 text-slate-400"
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black",
                  active ? "bg-white/25" : done ? "bg-brand-green/20" : "bg-white"
                ].join(" ")}
              >
                {done ? <CheckIcon /> : index + 1}
              </span>
              {step.label}
            </span>
            {index < UPGRADE_STEPS.length - 1 ? (
              <span aria-hidden="true" className="hidden h-px w-5 bg-slate-200 sm:block" />
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
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-bold text-brand-blue">
          Kembali ke Home
        </Link>

        <div className="glass mt-6 rounded-[2rem] p-6 md:p-10">
          {preview ? <PreviewBadge /> : null}

          <div className="flex items-center gap-3">
            <img
              src="/images/tapgo-logo.png"
              alt="TapGo Lion"
              className="h-11 w-11 rounded-2xl object-cover shadow-sm"
            />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-green">
                Upgrade Membership
              </p>
              <p className="text-sm font-bold text-brand-navy">PT. TapGo Lion Indonesia</p>
            </div>
          </div>

          <div className="mt-7">
            <UpgradeStepper current={step} />
          </div>

          <h1 className="mt-7 text-3xl font-black leading-tight text-brand-navy md:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{subtitle}</p>

          <div className="mt-8">{children}</div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-6 text-slate-500">
          Upgrade membership diproses melalui situs ini. Aplikasi TapGo di Google
          Play hanya menampilkan status paket aktif Anda.{" "}
          <Link href="/refund-policy" className="font-bold text-brand-blue">
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
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base text-brand-ink outline-none transition placeholder:text-slate-400 focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/12";

export const primaryButtonClass =
  "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-blue px-6 text-base font-black text-white shadow-glow transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none";

export const secondaryButtonClass =
  "inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 text-base font-bold text-brand-navy transition hover:border-brand-blue hover:text-brand-blue";

export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}
