"use client";

import ProfileAvatar from "./profile-avatar";
import { FormEvent, useCallback, useEffect, useState } from "react";
import "./mitra.css";
import { MITRA_PREVIEW, login, logout, readSession } from "./mitra-api";
import { MitraDataProvider, useMitra } from "./mitra-data";
import { NAV_ITEMS, ViewId, isViewId } from "./mitra-nav";
import { formatRupiah } from "./mitra-format";
import {
  Badge,
  ErrorState,
  Icon,
  Notice,
  Skeleton,
  Spinner,
  ToastProvider,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass
} from "./mitra-ui";
import OverviewView from "./view-overview";
import WalletView from "./view-wallet";
import WithdrawView from "./view-withdraw";
import NetworkView from "./view-network";
import CommissionView from "./view-commission";
import AccountView from "./view-account";

function LoginPanel({ onLoggedIn, expired }: { onLoggedIn: () => void; expired: boolean }) {
  const [phone, setPhone] = useState(MITRA_PREVIEW ? "081234567890" : "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await login(phone.trim(), password);
      onLoggedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nomor HP atau password belum sesuai.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <div className="themed-glass w-full rounded-3xl p-7 md:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-green">TapGo Lion</p>
        <h1 className="mt-3 text-3xl font-black themed-text">Dashboard Mitra</h1>
        <p className="mt-3 text-sm leading-6 themed-text-secondary">
          Masuk dengan akun TapGo Anda untuk mengelola saldo, penarikan dana, komisi, dan referral.
        </p>
        {expired ? (
          <div className="mt-5">
            <Notice tone="amber">Sesi Anda berakhir. Silakan masuk kembali.</Notice>
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Nomor HP</span>
            <input
              className={inputClass}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="08xxxxxxxxxx"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Password</span>
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              placeholder="Password akun TapGo"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm font-semibold m-text-red">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
            {busy ? <Spinner /> : null}
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
        </form>
        <p className="mt-5 flex items-center gap-2 text-xs themed-text-muted">
          <Icon name="lock" className="h-3.5 w-3.5" />
          Sambungan terenkripsi. TapGo tidak pernah meminta password lewat chat.
        </p>
      </div>
    </div>
  );
}

function readHash(): ViewId {
  if (typeof window === "undefined") return "overview";
  const value = window.location.hash.replace(/^#/, "");
  return isViewId(value) ? value : "overview";
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { core, loading, error, reload } = useMitra();
  const [view, setView] = useState<ViewId>("overview");

  useEffect(() => {
    setView(readHash());
    const onHash = () => setView(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: ViewId) => {
    window.location.hash = next;
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  if (!core) {
    if (loading) {
      return (
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-52 w-full" />
          <div className="grid gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-lg themed-glass rounded-2xl">
        <ErrorState message={error || "Data belum dapat dimuat."} onRetry={reload} />
        <div className="border-t themed-border p-4 text-center">
          <button type="button" onClick={onLogout} className="text-sm font-bold text-[var(--themed-accent-gold)]">
            Keluar
          </button>
        </div>
      </div>
    );
  }

  const { profile, summary, wallet } = core;

  return (
    <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[248px_1fr]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 space-y-4">
          <div className="themed-glass rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <ProfileAvatar name={profile.fullName} sizeClass="h-11 w-11 text-sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black themed-text">{profile.fullName}</p>
                <p className="truncate text-xs themed-text-muted">{profile.phone}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl themed-fill px-3 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Saldo</span>
              <span className="m-num text-sm font-black themed-text">{formatRupiah(wallet.cashBalance)}</span>
            </div>
          </div>
          <nav aria-label="Menu dashboard mitra" className="themed-glass rounded-2xl p-2">
            <ul className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="m-nav-item flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold themed-text-secondary transition hover:bg-[var(--themed-fill-2)]"
                    aria-current={view === item.id ? "page" : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px]" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <button type="button" onClick={onLogout} className={`${secondaryButtonClass} w-full`}>
            <Icon name="logout" className="h-4 w-4" />
            Keluar
          </button>
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-0">
        {MITRA_PREVIEW ? (
          <div className="mb-5">
            <Notice tone="amber" title="DATA CONTOH">
              Mode tinjauan tampilan. Angka dan nama pada halaman ini bukan data nyata.
            </Notice>
          </div>
        ) : null}
        <div className="mb-5 flex items-center justify-between lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <ProfileAvatar name={profile.fullName} sizeClass="h-10 w-10 text-xs" />
            <div className="min-w-0">
              <p className="truncate text-sm font-black themed-text">{profile.fullName}</p>
              <Badge tone="gold">{summary.membershipTier}</Badge>
            </div>
          </div>
        </div>
        {view === "overview" ? <OverviewView onNavigate={navigate} /> : null}
        {view === "wallet" ? <WalletView onNavigate={navigate} /> : null}
        {view === "withdraw" ? <WithdrawView /> : null}
        {view === "network" ? <NetworkView /> : null}
        {view === "commission" ? <CommissionView /> : null}
        {view === "account" ? <AccountView onLogout={onLogout} /> : null}
      </div>

      <nav
        aria-label="Menu dashboard mitra"
        className="fixed inset-x-0 bottom-0 z-40 border-t themed-nav backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-6 px-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="m-nav-item flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-bold themed-text-muted transition"
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} className="h-5 w-5" />
                {item.short}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export default function MitraDashboard() {
  const [signedIn, setSignedIn] = useState(MITRA_PREVIEW);
  const [checked, setChecked] = useState(MITRA_PREVIEW);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (MITRA_PREVIEW) return;
    setSignedIn(readSession() !== null);
    setChecked(true);
  }, []);

  const handleLogout = useCallback(() => {
    void logout().finally(() => {
      setExpired(false);
      setSignedIn(false);
    });
  }, []);

  const handleExpired = useCallback(() => {
    setExpired(true);
    setSignedIn(false);
  }, []);

  return (
    <div className="m-scope">
      <ToastProvider>
        {!checked ? null : signedIn ? (
          <MitraDataProvider onSessionExpired={handleExpired}>
            <Shell onLogout={handleLogout} />
          </MitraDataProvider>
        ) : (
          <LoginPanel
            expired={expired}
            onLoggedIn={() => {
              setExpired(false);
              setSignedIn(true);
            }}
          />
        )}
      </ToastProvider>
    </div>
  );
}
