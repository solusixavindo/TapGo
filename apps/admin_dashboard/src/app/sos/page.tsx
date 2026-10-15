"use client";

import { useCallback, useEffect, useState } from "react";
import { SosAlert, formatMoment, listSosAlerts, readRole, readToken, resolveSosAlert, roleAtLeast } from "../../lib/api";
import ConsoleHeader from "../console-header";
import { useHardRouter as useRouter } from "../hard-nav";

/**
 * Sinyal SOS dari tombol darurat driver_app. Yang aktif ditampilkan paling atas dan dimuat ulang otomatis tiap 30 detik
 * selagi halaman terbuka. Sinyal HANYA ditutup oleh orang yang menanganinya, dengan catatan: tidak ada penutupan otomatis.
 *
 * Nomor HP driver disamarkan untuk peran ADMIN oleh server (aturan konsol); Super Admin melihat nomor lengkap.
 * Lokasi dibuka di Google Maps (titik GPS terakhir driver saat menekan tombol, dengan akurasinya).
 */

const REFRESH_MS = 30_000;

const STATUS_STYLE: Record<SosAlert["status"], { label: string; className: string }> = {
  OPEN: { label: "Baru", className: "bg-rose-100 text-rose-800" },
  ACKNOWLEDGED: { label: "Ditangani", className: "bg-amber-100 text-amber-900" },
  RESOLVED: { label: "Selesai", className: "bg-emerald-100 text-emerald-800" }
};

function mapsUrl(alert: SosAlert) {
  return `https://www.google.com/maps?q=${alert.lat},${alert.lng}`;
}

export default function SosPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [alerts, setAlerts] = useState<SosAlert[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await listSosAlerts(showResolved ? "RESOLVED" : undefined));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    const current = readRole();
    if (!roleAtLeast(current, "ADMIN")) {
      router.replace("/beranda");
      return;
    }
    setRole(current);
    void load();
  }, [router, load]);

  // Muat ulang berkala hanya pada tab "Aktif" dan hanya saat halaman terlihat.
  useEffect(() => {
    if (showResolved) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, showResolved]);

  async function submitResolve(id: string) {
    if (busy) return;
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setError("Tulis catatan penanganan (minimal 3 huruf) sebelum menutup sinyal.");
      return;
    }
    setBusy(true);
    try {
      await resolveSosAlert(id, trimmed);
      setResolving(null);
      setNote("");
      setError("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sinyal belum dapat ditutup.");
    } finally {
      setBusy(false);
    }
  }

  const activeCount = !showResolved ? alerts?.length ?? 0 : 0;

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <ConsoleHeader
          title="SOS Darurat"
          subtitle="Sinyal darurat dari driver. Hubungi driver segera, lalu tutup sinyal dengan catatan penanganan."
          role={role}
          actions={
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Memuat…" : "Muat ulang"}
            </button>
          }
        />

        <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Status sinyal">
          {[
            { id: false, label: "Aktif" },
            { id: true, label: "Selesai" }
          ].map((tab) => (
            <button
              key={String(tab.id)}
              type="button"
              role="tab"
              aria-selected={showResolved === tab.id}
              onClick={() => setShowResolved(tab.id)}
              className={[
                "rounded-lg px-3.5 py-1.5 text-sm font-bold transition",
                showResolved === tab.id ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-200"
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!showResolved && activeCount > 0 ? (
          <p role="alert" className="mb-4 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white" data-testid="sos-active-banner">
            {activeCount} sinyal SOS aktif. Hubungi driver sekarang.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {alerts && alerts.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
            <p className="font-bold">{showResolved ? "Belum ada sinyal yang selesai" : "Tidak ada sinyal SOS aktif"}</p>
            <p className="mt-1 text-sm text-slate-500">Sinyal dari tombol SOS driver akan muncul di sini.</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {(alerts ?? []).map((alert) => {
            const style = STATUS_STYLE[alert.status];
            const open = resolving === alert.id;
            return (
              <section key={alert.id} data-testid="sos-row" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${style.className}`}>{style.label}</span>
                    <h2 className="mt-1.5 text-lg font-black">{alert.driver.fullName}</h2>
                    <p className="text-sm text-slate-600">
                      {alert.driver.phone ? (
                        <a className="font-semibold text-brand-navy underline" href={`tel:${alert.driver.phone}`}>
                          {alert.driver.phone}
                        </a>
                      ) : (
                        "Nomor tidak tersedia"
                      )}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>Dikirim: {formatMoment(alert.createdAt)}</p>
                    {alert.resolvedAt ? <p>Selesai: {formatMoment(alert.resolvedAt)}</p> : null}
                  </div>
                </div>
                <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Lokasi</dt>
                    <dd className="mt-0.5 font-semibold">
                      <a className="text-brand-navy underline" href={mapsUrl(alert)} target="_blank" rel="noopener noreferrer">
                        Buka di Google Maps
                      </a>
                      {alert.accuracyMeters !== null ? <span className="text-slate-500"> · akurasi ±{Math.round(alert.accuracyMeters)} m</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Perjalanan</dt>
                    <dd className="mt-0.5 font-semibold">{alert.rideOrderId ? "Sedang dalam perjalanan" : "Tidak sedang dalam perjalanan"}</dd>
                  </div>
                  {alert.resolutionNote ? (
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Catatan penanganan</dt>
                      <dd className="mt-0.5 font-semibold">{alert.resolutionNote}</dd>
                    </div>
                  ) : null}
                </dl>

                {alert.status !== "RESOLVED" ? (
                  open ? (
                    <div className="mt-4 rounded-xl bg-slate-50 p-4">
                      <label className="text-sm font-bold" htmlFor={`sos-note-${alert.id}`}>
                        Catatan penanganan
                      </label>
                      <textarea
                        id={`sos-note-${alert.id}`}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Mis. sudah dihubungi, driver aman; atau ditindaklanjuti ke pihak berwenang."
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitResolve(alert.id)}
                          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {busy ? "Menyimpan…" : "Tutup sinyal"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setResolving(null);
                            setNote("");
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setResolving(alert.id);
                        setNote("");
                        setError("");
                      }}
                      className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800"
                    >
                      Tandai selesai ditangani
                    </button>
                  )
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
