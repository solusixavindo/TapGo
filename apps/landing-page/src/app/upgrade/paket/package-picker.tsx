"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MembershipPackage,
  PACKAGE_HINT_KEY,
  PACKAGE_KEY,
  PREVIEW_MODE,
  PREVIEW_PACKAGES,
  TOKEN_KEY,
  getCurrentMembershipTier,
  listPackages,
  matchPackageByTier,
  readSession,
  writeSession
} from "../api";
import { formatRupiah, primaryButtonClass } from "../upgrade-shell";

const TIER_LABEL: Record<string, string> = {
  BASIC: "Basic",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum"
};

export default function PackagePicker() {
  const router = useRouter();
  const [packages, setPackages] = useState<MembershipPackage[]>(
    PREVIEW_MODE ? PREVIEW_PACKAGES : []
  );
  const [selected, setSelected] = useState<string>(
    PREVIEW_MODE ? PREVIEW_PACKAGES[1]!.id : ""
  );
  const [loading, setLoading] = useState(!PREVIEW_MODE);
  const [error, setError] = useState("");
  // Sebelumnya label ini di-hardcode "Basic" untuk semua orang, sehingga
  // pengguna yang upgrade dari Silver->Gold tetap melihat "Basic" di sini.
  const [currentTier, setCurrentTier] = useState<string>(
    PREVIEW_MODE ? "BASIC" : ""
  );

  useEffect(() => {
    if (PREVIEW_MODE) return;
    // Tanpa sesi, langkah ini tidak ada artinya: order tidak dapat dibuat.
    const token = readSession(TOKEN_KEY);
    if (!token) {
      router.replace("/upgrade");
      return;
    }
    let alive = true;
    listPackages()
      .then((result) => {
        if (!alive) return;
        setPackages(result);
        setError("");
        // Paket yang ditunjuk pengunjung dari halaman depan dipakai sebagai
        // pilihan awal. Hanya berlaku bila belum ada yang dipilih, supaya
        // kembali ke langkah ini tidak menimpa pilihan yang sudah diubah.
        setSelected((current) =>
          current
            ? current
            : matchPackageByTier(result, readSession(PACKAGE_HINT_KEY))
        );
      })
      .catch((caught: unknown) =>
        alive
          ? setError(
              caught instanceof Error ? caught.message : "Paket belum dapat dimuat."
            )
          : undefined
      )
      .finally(() => (alive ? setLoading(false) : undefined));
    // Kegagalan mengambil tier aktif tidak boleh menghalangi alur upgrade —
    // cukup sembunyikan label bila belum diketahui.
    getCurrentMembershipTier(token)
      .then((tier) => (alive ? setCurrentTier(tier) : undefined))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [router]);

  function onContinue() {
    if (!selected) return;
    writeSession(PACKAGE_KEY, selected);
    router.push("/upgrade/data");
  }

  if (loading) {
    return <p className="text-sm font-semibold themed-text-muted">Memuat paket…</p>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4">
        <p className="text-sm font-bold text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 text-sm font-bold themed-accent"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div>
      {currentTier ? (
        <p className="mb-5 inline-flex rounded-full themed-fill px-3 py-1.5 text-xs font-bold themed-text-muted">
          Paket aktif Anda saat ini: {TIER_LABEL[currentTier] ?? currentTier}
        </p>
      ) : null}

      <div className="space-y-4">
        {packages.map((item) => {
          const active = selected === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              aria-pressed={active}
              className={[
                "block w-full rounded-[1.5rem] border-2 p-5 text-left transition",
                active
                  ? "border-brand-gold bg-brand-gold/10 shadow-lg"
                  : "themed-border themed-card-bg hover:border-white/20"
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xl font-black themed-text">{item.name}</p>
                  <p className="mt-1 text-2xl font-black themed-accent">
                    {formatRupiah(item.price)}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className={[
                    "mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                    active ? "border-brand-gold bg-brand-gold" : "border-white/20"
                  ].join(" ")}
                >
                  {active ? <span className="h-2 w-2 rounded-full bg-brand-navyDeep" /> : null}
                </span>
              </div>

              <ul className="mt-4 space-y-2">
                {item.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2 text-sm themed-text-muted">
                    <span className="mt-0.5 text-brand-green" aria-hidden="true">
                      ✓
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <p className="mt-6 rounded-2xl border themed-border themed-card-bg px-4 py-3 text-xs leading-6 themed-text-muted">
        Harga sudah termasuk seluruh biaya. Pembayaran diproses payment gateway
        berlisensi. Manfaat aktif setelah dokumen identitas diverifikasi.
      </p>

      <button
        type="button"
        onClick={onContinue}
        disabled={!selected}
        className={`${primaryButtonClass} mt-6`}
      >
        Lanjut Isi Data
      </button>
    </div>
  );
}
