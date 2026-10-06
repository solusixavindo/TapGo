"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PREVIEW_MODE,
  TOKEN_KEY,
  TOPUP_MAX_AMOUNT,
  TOPUP_ORDER_KEY,
  TOPUP_TARGETS,
  TOPUP_TARGET_KEY,
  TopUpTarget,
  createManualTopUp,
  parseTopUpTarget,
  readSession,
  writeSession
} from "../api";
import { formatRupiah, primaryButtonClass } from "../../upgrade/upgrade-shell";

const TARGET_ORDER: TopUpTarget[] = ["WALLET", "PPOB"];

export default function AmountForm() {
  const router = useRouter();
  const [target, setTarget] = useState<TopUpTarget>("WALLET");
  const [selected, setSelected] = useState<number>(TOPUP_TARGETS.WALLET.quick[1]!);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const config = TOPUP_TARGETS[target];

  useEffect(() => {
    if (PREVIEW_MODE) return;
    if (!readSession(TOKEN_KEY)) {
      router.replace("/topup");
      return;
    }
    // Tujuan dari tautan yang dipilih saat masuk (?tujuan=ppob).
    const initial = parseTopUpTarget(readSession(TOPUP_TARGET_KEY));
    if (initial !== "WALLET") chooseTarget(initial);
  }, [router]);

  /** Ganti tujuan: nominal cepat dan batas minimal ikut berganti. */
  function chooseTarget(next: TopUpTarget) {
    setTarget(next);
    setSelected(TOPUP_TARGETS[next].quick[next === "PPOB" ? 0 : 1]!);
    setCustom("");
    setError("");
    writeSession(TOPUP_TARGET_KEY, next);
  }

  const amount = custom.trim() ? Number(custom.replace(/[^0-9]/g, "")) : selected;
  const valid = Number.isFinite(amount) && amount >= config.min && amount <= TOPUP_MAX_AMOUNT;

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
      const order = await createManualTopUp(token, amount, target);
      writeSession(TOPUP_ORDER_KEY, order.id);
      router.push("/topup/bayar");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Jumlah belum dapat diproses.");
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider themed-text-muted">Isi saldo untuk</p>
      <div role="radiogroup" aria-label="Tujuan top up" className="mt-3 grid gap-3 sm:grid-cols-2">
        {TARGET_ORDER.map((key) => {
          const item = TOPUP_TARGETS[key];
          const active = target === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`target-${key.toLowerCase()}`}
              onClick={() => chooseTarget(key)}
              className={[
                "rounded-2xl border-2 px-4 py-4 text-left transition",
                active ? "border-brand-gold bg-brand-gold/10 shadow-lg" : "themed-border themed-card-bg hover:border-white/20"
              ].join(" ")}
            >
              <span className={`block text-base font-black ${active ? "themed-accent" : "themed-text"}`}>{item.label}</span>
              <span className="mt-0.5 block text-xs font-semibold themed-text-muted">{item.short}</span>
              <span className="mt-1.5 block text-xs themed-text-muted">Minimal {formatRupiah(item.min)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-6 themed-text-muted" data-testid="target-description">
        {config.description}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {config.quick.map((value) => {
          const active = !custom.trim() && selected === value;
          return (
            <button
              key={value}
              type="button"
              data-testid="quick-amount"
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
            placeholder={`Minimal ${formatRupiah(config.min)}`}
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
      </div>

      {!valid && (custom.trim() || amount) ? (
        <p className="mt-3 text-xs font-semibold text-rose-400">
          Jumlah {config.label} harus antara {formatRupiah(config.min)} dan {formatRupiah(TOPUP_MAX_AMOUNT)}.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={onContinue} disabled={busy || !valid} className={`${primaryButtonClass} mt-6`}>
        {busy ? "Menyiapkan…" : `Lanjut isi ${config.label} ${formatRupiah(amount || 0)}`}
      </button>
    </div>
  );
}
