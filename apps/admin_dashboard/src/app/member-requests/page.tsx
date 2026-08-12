"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DocumentSummary,
  MemberRequest,
  clearSession,
  formatMoment,
  formatRupiah,
  listDocuments,
  listMemberRequests,
  readRole,
  readToken,
  rejectDocuments,
  verifyDocuments
} from "../../lib/api";
import DocumentViewer from "./document-viewer";

/**
 * Antrean verifikasi keanggotaan.
 *
 * Yang perlu diingat saat membaca berkas ini: dokumen identitas hanya bertahan
 * 24 jam di database. Layar ini karena itu menonjolkan sisa masa simpan, dan
 * menaruh tombol cetak sebagai tindakan setara pentingnya dengan verifikasi.
 */

/** Pengajuan yang menunggu keputusan: sudah lunas tetapi belum aktif. */
function isAwaitingVerification(request: MemberRequest) {
  return request.status === "PAID" && !request.userMembership;
}

function statusLabel(request: MemberRequest) {
  if (request.status === "PAID" && request.userMembership) return "Aktif";
  if (request.status === "PAID") return "Menunggu verifikasi";
  if (request.status === "PENDING") return "Menunggu pembayaran";
  if (request.status === "CANCELLED") {
    const rejected = Boolean(request.registrationData?.documentRejection);
    return rejected ? "Ditolak, dana dikembalikan" : "Dibatalkan";
  }
  return request.status;
}

function statusTone(request: MemberRequest) {
  if (request.status === "PAID" && request.userMembership) return "bg-emerald-100 text-emerald-800";
  if (request.status === "PAID") return "bg-blue-100 text-blue-800";
  if (request.status === "CANCELLED") return "bg-rose-100 text-rose-800";
  return "bg-amber-100 text-amber-800";
}

export default function MemberRequestsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [requests, setRequests] = useState<MemberRequest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const selected = useMemo(
    () => requests.find((item) => item.id === selectedId) ?? null,
    [requests, selectedId]
  );

  const refresh = useCallback(async () => {
    try {
      const result = await listMemberRequests();
      setRequests(result.items);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Daftar belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    setRole(readRole());
    void refresh();
  }, [router, refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDocuments([]);
      return;
    }
    let alive = true;
    listDocuments(selectedId)
      .then((result) => (alive ? setDocuments(result) : undefined))
      .catch(() => (alive ? setDocuments([]) : undefined));
    return () => {
      alive = false;
    };
  }, [selectedId]);

  async function decide(action: "verify" | "reject") {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "verify") {
        await verifyDocuments(selected.id);
        setNotice("Dokumen diverifikasi. Membership sudah aktif.");
      } else {
        await rejectDocuments(selected.id, rejectReason.trim());
        setNotice("Dokumen ditolak. Pengembalian dana penuh tercatat.");
        setRejectReason("");
      }
      await refresh();
      const fresh = await listDocuments(selected.id).catch(() => []);
      setDocuments(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tindakan belum dapat diproses.");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    clearSession();
    router.replace("/");
  }

  const awaiting = requests.filter(isAwaitingVerification);
  const registration = (selected?.registrationData ?? {}) as Record<string, unknown>;

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-xl font-semibold">Verifikasi Keanggotaan</h1>
            <p className="mt-1 text-sm text-slate-500">
              {awaiting.length} pengajuan menunggu keputusan · masuk sebagai {role || "admin"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
            >
              Muat ulang
            </button>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600"
            >
              Keluar
            </button>
          </div>
        </header>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 print:hidden">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">
            {notice}
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr] print:mt-0 print:block">
          <section className="print:hidden">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Pengajuan
            </h2>
            <div className="mt-3 space-y-2">
              {loading ? <p className="text-sm text-slate-500">Memuat…</p> : null}
              {!loading && requests.length === 0 ? (
                <p className="rounded-lg bg-white px-4 py-6 text-center text-sm text-slate-500">
                  Belum ada pengajuan.
                </p>
              ) : null}
              {requests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => setSelectedId(request.id)}
                  aria-pressed={selectedId === request.id}
                  className={[
                    "block w-full rounded-xl border bg-white p-4 text-left transition",
                    selectedId === request.id
                      ? "border-brand-green ring-1 ring-brand-green"
                      : "border-slate-200 hover:border-slate-300"
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold">
                      {request.user?.fullName ?? "—"}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${statusTone(request)}`}
                    >
                      {statusLabel(request)}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    {request.invoice?.number ?? request.id}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {request.membership?.name ?? "—"} · {formatRupiah(request.totalAmount)}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section>
            {!selected ? (
              <p className="rounded-xl bg-white px-6 py-16 text-center text-sm text-slate-500 print:hidden">
                Pilih satu pengajuan untuk memeriksa dokumennya.
              </p>
            ) : (
              <article className="rounded-xl border border-slate-200 bg-white p-6 print:border-0 print:p-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {selected.user?.fullName ?? "—"}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {selected.invoice?.number ?? selected.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="rounded-lg bg-brand-ink px-4 py-2 text-sm font-semibold text-white print:hidden"
                  >
                    Cetak berkas
                  </button>
                </div>

                <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  <Row label="Paket" value={selected.membership?.name ?? "—"} />
                  <Row label="Nilai" value={formatRupiah(selected.totalAmount)} />
                  <Row label="Nomor HP" value={selected.user?.phone ?? "—"} />
                  <Row label="Kode referral" value={selected.user?.referralCode ?? "—"} />
                  <Row label="Nama sesuai KTP" value={String(registration.fullName ?? "—")} />
                  <Row label="Alamat domisili" value={String(registration.address ?? "—")} />
                  <Row label="Diajukan" value={formatMoment(selected.createdAt)} />
                  <Row label="Dibayar" value={formatMoment(selected.paidAt)} />
                  <Row label="Status" value={statusLabel(selected)} />
                </dl>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 print:gap-6">
                  {documents.length === 0 ? (
                    <p className="text-sm text-slate-500">Belum ada dokumen diunggah.</p>
                  ) : (
                    documents.map((document) => (
                      <DocumentViewer
                        key={document.type}
                        orderId={selected.id}
                        document={document}
                      />
                    ))
                  )}
                </div>

                {isAwaitingVerification(selected) ? (
                  <div className="mt-6 border-t border-slate-200 pt-5 print:hidden">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Keputusan
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Cetak berkasnya lebih dulu. Menolak dokumen membatalkan pengajuan
                      dan mencatat pengembalian dana penuh.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void decide("verify")}
                        disabled={busy}
                        className="rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? "Memproses…" : "Verifikasi dan aktifkan"}
                      </button>

                      <input
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        placeholder="Alasan penolakan"
                        maxLength={500}
                        className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-rose-400"
                      />
                      <button
                        type="button"
                        onClick={() => void decide("reject")}
                        disabled={busy}
                        className="rounded-lg border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-50"
                      >
                        Tolak dan kembalikan dana
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
    </div>
  );
}
