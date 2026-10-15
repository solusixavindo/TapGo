"use client";

import { useHardRouter as useRouter } from "../../hard-nav";
import { useEffect, useState } from "react";
import {
  PREVIEW_MODE,
  TOKEN_KEY,
  TOPUP_MAX_AMOUNT,
  TOPUP_ORDER_KEY,
  TOPUP_TARGETS,
  TOPUP_TARGET_KEY,
  TopUpMethodId,
  TopUpOptions,
  TopUpQuote,
  TopUpTarget,
  createManualTopUp,
  createOnlineTopUp,
  getTopUpOptions,
  isSafePaymentUrl,
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
  // undefined = belum dimuat; null = server lama tanpa endpoint opsi (kembali ke transfer manual seperti semula).
  const [options, setOptions] = useState<TopUpOptions | null | undefined>(PREVIEW_MODE ? null : undefined);
  // Opsi gagal dimuat karena jaringan/server (bukan server lama): jangan diam-diam beralih ke transfer manual.
  const [optionsError, setOptionsError] = useState("");
  const [optionsAttempt, setOptionsAttempt] = useState(0);

  // Penawaran harga per metode (dari server), disimpan bersama kunci nominal+tujuan yang diminta supaya biaya
  // dari nominal sebelumnya tidak pernah tampil untuk nominal yang baru diketik.
  const [quoteSet, setQuoteSet] = useState<{ key: string; list: TopUpQuote[] } | null>(null);
  const [quoteError, setQuoteError] = useState(false);
  const [method, setMethod] = useState<TopUpMethodId | null>(null);

  const config = TOPUP_TARGETS[target];
  const online = options?.online === true;
  const minimum = options?.minimum?.[target] ?? config.min;
  const maximum = options?.maximum ?? TOPUP_MAX_AMOUNT;
  const unavailable = options != null && !options.online && !options.manualTransfer;

  useEffect(() => {
    if (PREVIEW_MODE) return;
    if (!readSession(TOKEN_KEY)) {
      router.replace("/topup");
      return;
    }
    // Tujuan dari tautan yang dipilih saat masuk (?tujuan=ppob).
    const initial = parseTopUpTarget(readSession(TOPUP_TARGET_KEY));
    if (initial !== "WALLET") chooseTarget(initial);
    let alive = true;
    setOptionsError("");
    getTopUpOptions(readSession(TOKEN_KEY))
      .then((result) => (alive ? setOptions(result) : undefined))
      .catch((caught: unknown) => {
        if (!alive) return;
        // 404 = server lama tanpa endpoint opsi: pakai alur lama. Selain itu (jaringan, 429, 5xx) tampilkan galat
        // dengan tombol coba lagi; beralih ke transfer manual di sini akan menyesatkan driver yang manualnya dimatikan.
        if ((caught as { status?: number } | null)?.status === 404) {
          setOptions(null);
        } else {
          setOptionsError(caught instanceof Error ? caught.message : "Opsi top up belum dapat dimuat.");
        }
      });
    return () => {
      alive = false;
    };
  }, [router, optionsAttempt]);

  /** Ganti tujuan: nominal cepat dan batas minimal ikut berganti. */
  function chooseTarget(next: TopUpTarget) {
    setTarget(next);
    setSelected(TOPUP_TARGETS[next].quick[next === "PPOB" ? 0 : 1]!);
    setCustom("");
    setError("");
    writeSession(TOPUP_TARGET_KEY, next);
  }

  const amount = custom.trim() ? Number(custom.replace(/[^0-9]/g, "")) : selected;
  const amountOk = Number.isFinite(amount) && amount >= minimum && amount <= maximum;

  // Muat penawaran harga tiap metode setiap kali nominal atau tujuan berubah (jeda singkat saat mengetik).
  const quoteKey = `${target}:${amount}`;
  useEffect(() => {
    setQuoteError(false);
    if (PREVIEW_MODE || !online || !amountOk || !options?.methods?.length) {
      setQuoteSet(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      getTopUpOptions(readSession(TOKEN_KEY), { amount, target })
        .then((result) => {
          if (!alive) return;
          setQuoteSet({ key: `${target}:${amount}`, list: result.quotes ?? [] });
          // Pertahankan metode pilihan bila masih tersedia; selain itu pakai yang pertama.
          setMethod((current) => (result.quotes?.some((q) => q.method === current) ? current : (result.quotes?.[0]?.method ?? null)));
        })
        .catch(() => {
          if (!alive) return;
          setQuoteSet(null);
          setQuoteError(true);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [online, amountOk, amount, target, options]);

  // Hanya penawaran untuk nominal+tujuan yang sedang tampil yang dipakai.
  const quotes = quoteSet?.key === quoteKey ? quoteSet.list : null;
  const quote = quotes?.find((item) => item.method === method) ?? null;
  // Server lama (tanpa metode): satu biaya tunggal. Server baru: biaya metode terpilih.
  const hasMethods = (options?.methods?.length ?? 0) > 0;
  const fee = !online ? 0 : hasMethods ? (quote?.fee ?? 0) : (options?.onlineFee ?? 0);
  const quoteReady = !hasMethods || quote !== null;
  const valid = amountOk && !unavailable && options !== undefined && !optionsError && (!online || quoteReady);
  const total = (amount || 0) + fee;

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
      if (online) {
        const order = await createOnlineTopUp(token, amount, target, hasMethods && method ? method : undefined);
        if (!isSafePaymentUrl(order.redirectUrl)) {
          throw new Error("Halaman pembayaran belum dapat dibuka. Coba lagi beberapa saat lagi.");
        }
        writeSession(TOPUP_ORDER_KEY, order.id);
        // Halaman pembayaran penyedia; setelah selesai pelanggan kembali ke halaman status.
        window.location.assign(order.redirectUrl);
        return;
      }
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
              <span className="mt-1.5 block text-xs themed-text-muted">Minimal {formatRupiah(options?.minimum?.[key] ?? item.min)}</span>
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
            placeholder={`Minimal ${formatRupiah(minimum)}`}
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ""))}
          />
        </label>
      </div>

      {!amountOk && (custom.trim() || amount) ? (
        <p className="mt-3 text-xs font-semibold text-rose-400">
          Jumlah {config.label} harus antara {formatRupiah(minimum)} dan {formatRupiah(maximum)}.
        </p>
      ) : null}

      {/* Satu metode saja (bawaan: transfer bank) tidak perlu pilihan; biayanya sudah tampil di rincian di bawah. */}
      {online && (options?.methods?.length ?? 0) > 1 && amountOk ? (
        <div className="mt-6" data-testid="method-picker">
          <p className="text-xs font-bold uppercase tracking-wider themed-text-muted">Bayar dengan</p>
          <div role="radiogroup" aria-label="Metode pembayaran" className="mt-3 space-y-2.5">
            {options!.methods!.map((item) => {
              const itemQuote = quotes?.find((q) => q.method === item.id);
              const active = method === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`method-${item.id}`}
                  onClick={() => setMethod(item.id)}
                  className={[
                    "flex w-full items-center justify-between gap-4 rounded-2xl border-2 px-4 py-3.5 text-left transition",
                    active ? "border-brand-gold bg-brand-gold/10 shadow-lg" : "themed-border themed-card-bg hover:border-white/20"
                  ].join(" ")}
                >
                  <span>
                    <span className={`block text-sm font-black ${active ? "themed-accent" : "themed-text"}`}>{item.label}</span>
                    <span className="mt-0.5 block text-xs themed-text-muted">{item.description}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs font-bold themed-text">
                    {itemQuote ? `Biaya ${formatRupiah(itemQuote.fee)}` : quoteError ? "—" : "…"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {online && amountOk ? (
        <dl
          className="mt-6 space-y-2.5 rounded-2xl border themed-border themed-card-bg px-4 py-4 text-sm"
          data-testid="fee-summary"
        >
          <div className="flex items-start justify-between gap-6">
            <dt className="themed-text-muted">Top up {config.label}</dt>
            <dd className="font-bold themed-text">{formatRupiah(amount)}</dd>
          </div>
          <div className="flex items-start justify-between gap-6">
            <dt className="themed-text-muted">Biaya layanan pembayaran</dt>
            <dd className="font-bold themed-text" data-testid="fee-amount">{quoteReady ? formatRupiah(fee) : "…"}</dd>
          </div>
          <div className="flex items-start justify-between gap-6 border-t border-dashed themed-border pt-2.5">
            <dt className="font-bold themed-text">Total yang dibayar</dt>
            <dd className="font-black themed-accent" data-testid="fee-total">{quoteReady ? formatRupiah(total) : "…"}</dd>
          </div>
          <p className="pt-1 text-xs leading-6 themed-text-muted">
            Saldo bertambah sebesar {formatRupiah(amount)}. Biaya layanan dipungut penyedia pembayaran dan tidak masuk ke saldo.
          </p>
          {target === "WALLET" && options?.commissionPercent && options.commissionPercent > 0 ? (
            <p className="rounded-xl bg-brand-gold/10 px-3 py-2 text-xs font-semibold leading-6 themed-text" data-testid="commission-capacity">
              Saldo {formatRupiah(amount)} cukup untuk menerima pesanan tunai.
            </p>
          ) : null}
        </dl>
      ) : null}

      {optionsError ? (
        <div role="alert" className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          <p>{optionsError}</p>
          <button
            type="button"
            data-testid="retry-options"
            onClick={() => setOptionsAttempt((count) => count + 1)}
            className="mt-2 underline underline-offset-2"
          >
            Coba lagi
          </button>
        </div>
      ) : null}

      {quoteError ? (
        <p role="alert" data-testid="quote-error" className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-300">
          Biaya layanan belum dapat dimuat. Periksa koneksi, lalu ubah nominal sedikit atau muat ulang halaman ini.
        </p>
      ) : null}

      {unavailable ? (
        <p role="alert" className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-300">
          Top up sedang tidak tersedia. Silakan coba lagi nanti.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={onContinue} disabled={busy || !valid} className={`${primaryButtonClass} mt-6`}>
        {busy
          ? "Menyiapkan…"
          : optionsError || options === undefined
            ? "Memuat opsi pembayaran…"
            : online
            ? !amountOk
              ? "Masukkan jumlah yang valid"
              : quoteReady
                ? `Bayar ${formatRupiah(total)}`
                : "Menghitung biaya…"
            : `Lanjut isi ${config.label} ${formatRupiah(amount || 0)}`}
      </button>
    </div>
  );
}
