"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MembershipPackage,
  PREVIEW_MODE,
  PREVIEW_PACKAGES,
  listPackages
} from "../api";
import { formatRupiah, primaryButtonClass } from "../upgrade-shell";

const CURRENT_TIER_LABEL = "Basic";

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

  useEffect(() => {
    if (PREVIEW_MODE) return;
    let alive = true;
    listPackages()
      .then((result) => {
        if (!alive) return;
        setPackages(result);
        setError("");
      })
      .catch((caught: unknown) =>
        alive
          ? setError(
              caught instanceof Error ? caught.message : "Paket belum dapat dimuat."
            )
          : undefined
      )
      .finally(() => (alive ? setLoading(false) : undefined));
    return () => {
      alive = false;
    };
  }, []);

  function onContinue() {
    if (!selected) return;
    sessionStorage.setItem("tapgo.upgrade.packageId", selected);
    router.push("/upgrade/data");
  }

  if (loading) {
    return <p className="text-sm font-semibold text-slate-500">Memuat paket…</p>;
  }

  if (error) {
    return (
      <div className="rounded-2xl bg-rose-50 px-5 py-4">
        <p className="text-sm font-bold text-rose-700">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 text-sm font-bold text-brand-blue"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-5 inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
        Paket aktif Anda saat ini: {CURRENT_TIER_LABEL}
      </p>

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
                  ? "border-brand-blue bg-brand-blue/5 shadow-glow"
                  : "border-slate-200 bg-white hover:border-slate-300"
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xl font-black text-brand-navy">{item.name}</p>
                  <p className="mt-1 text-2xl font-black text-brand-blue">
                    {formatRupiah(item.price)}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className={[
                    "mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                    active ? "border-brand-blue bg-brand-blue" : "border-slate-300"
                  ].join(" ")}
                >
                  {active ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                </span>
              </div>

              <ul className="mt-4 space-y-2">
                {item.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2 text-sm text-slate-600">
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

      <p className="mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
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
