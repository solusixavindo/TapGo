"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PREVIEW_MODE,
  TOKEN_KEY,
  TOPUP_MAX_AMOUNT,
  TOPUP_MIN_AMOUNT,
  TOPUP_ORDER_KEY,
  TOPUP_QUICK_AMOUNTS,
  createTopUpOrder,
  readSession,
  writeSession
} from "../api";
import { formatRupiah, primaryButtonClass } from "../../upgrade/upgrade-shell";

export default function AmountForm() {
  const router = useRouter();
  const [selected, setSelected] = useState<number>(TOPUP_QUICK_AMOUNTS[1]!);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (PREVIEW_MODE) return;
    if (!readSession(TOKEN_KEY)) {
      router.replace("/topup");
    }
  }, [router]);

  const amount = custom.trim() ? Number(custom.replace(/[^0-9]/g, "")) : selected;
  const valid = Number.isFinite(amount) && amount >= TOPUP_MIN_AMOUNT && amount <= TOPUP_MAX_AMOUNT;

  async function onContinue() {
    if (busy || !valid) return;
    setBusy(true);
    setError("");
    try {
      if (PREVIEW_MODE) {
        router.push("/topup/bayar");
        return;
      }
      const token = readSession(TOKEN_KEY);
      const order = await createTopUpOrder(token, amount);
      writeSession(TOPUP_ORDER_KEY, order.id);
      router.push("/topup/bayar");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Jumlah belum dapat diproses.");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TOPUP_QUICK_AMOUNTS.map((value) => {
          const active = !custom.trim() && selected === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSelected(value);
                setCustom("");
              }}
              className={[
                "rounded-2xl border-2 px-4 py-4 text-center text-base font-black transition",
                active ? "border-brand-gold bg-brand-gold/10 themed-accent shadow-lg" : "themed-border themed-card-bg themed-text hover:border-white/20"
              ].join(" ")}
            >
              {formatRupiah(value)}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wider themed-text-muted">Atau masukkan jumlah lain</span>
          <input
            className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3.5 text-base text-brand-navyDeep outline-none transition placeholder:text-slate-400 focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
            type="text"
            inputMode="numeric"
            placeholder={`Minimal ${formatRupiah(TOPUP_MIN_AMOUNT)}`}
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
      </div>

      {!valid && (custom.trim() || amount) ? (
        <p className="mt-3 text-xs font-semibold text-rose-400">
          Jumlah harus antara {formatRupiah(TOPUP_MIN_AMOUNT)} dan {formatRupiah(TOPUP_MAX_AMOUNT)}.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={onContinue} disabled={busy || !valid} className={`${primaryButtonClass} mt-6`}>
        {busy ? "Menyiapkan…" : `Lanjut isi ${formatRupiah(amount || 0)}`}
      </button>
    </div>
  );
}
