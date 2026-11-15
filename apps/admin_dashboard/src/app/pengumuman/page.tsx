"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  AnnouncementItem,
  AnnouncementStatus,
  archiveAnnouncement,
  formatMoment,
  listAnnouncements,
  publishAnnouncement,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Pengumuman pemilik untuk ikon bel di aplikasi user.
 *
 * Hanya Super Admin VIP. Teks polos tanpa tautan (penjagaan sebenarnya ada di server; pemeriksaan di sini hanya agar
 * penulis tahu lebih awal). Tidak dapat diubah setelah terbit: salah ketik = arsipkan lalu terbitkan ulang, supaya
 * jejak audit tidak dapat ditulis ulang.
 */

const STATUS_LABEL: Record<AnnouncementStatus, string> = { ACTIVE: "Tampil", EXPIRED: "Kedaluwarsa", ARCHIVED: "Diarsipkan" };
const STATUS_TONE: Record<AnnouncementStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  EXPIRED: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-slate-200 text-slate-700"
};
const FILTERS: Array<{ value: "ACTIVE" | "ARCHIVED" | "ALL"; label: string }> = [
  { value: "ACTIVE", label: "Tampil" },
  { value: "ARCHIVED", label: "Diarsipkan" },
  { value: "ALL", label: "Semua" }
];

/** Cermin ringan aturan server (announcementContent.ts) hanya untuk peringatan dini; server tetap penentu. */
function looksLikeLink(text: string) {
  const t = text.normalize("NFKC");
  return (
    /\b(?:https?|ftp)\s*:/i.test(t) ||
    /\bwww\s*\./i.test(t) ||
    /[a-z0-9-]+\.(?:com|id|net|org|co|io|me|ly|xyz|link|app|top|info|biz|site|online|shop|click|cc|tk|ru|cn|vip|club|live|store|page|dev|ai|gl|to)\b/i.test(t) ||
    /@[a-z0-9_.-]{3,}/i.test(t)
  );
}

/** Tanggal "YYYY-MM-DD" (hari kalender WIB) menjadi akhir hari itu dalam ISO. */
function endOfDayIso(day: string) {
  return new Date(`${day}T23:59:59+07:00`).toISOString();
}

export default function AnnouncementsPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [expiry, setExpiry] = useState("");
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<"ACTIVE" | "ARCHIVED" | "ALL">("ACTIVE");
  const [items, setItems] = useState<AnnouncementItem[] | null>(null);
  const [listError, setListError] = useState("");
  const [confirmId, setConfirmId] = useState("");

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    if (!roleAtLeast(readRole(), "SUPER_ADMIN_VIP")) router.replace("/beranda");
  }, [router]);

  const load = useCallback(async () => {
    try {
      const result = await listAnnouncements(filter);
      setItems(result.items);
      setListError("");
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "Daftar pengumuman belum dapat dimuat.");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasLink = looksLikeLink(title) || looksLikeLink(body);
  const today = new Date().toISOString().slice(0, 10);
  const formReady = title.trim().length > 0 && body.trim().length > 0 && !hasLink;

  function goPreview(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setNotice("");
    if (!formReady) return;
    setStep("preview");
  }

  async function publish() {
    setBusy(true);
    setFormError("");
    try {
      await publishAnnouncement({ title, body, expiresAt: expiry ? endOfDayIso(expiry) : null });
      setTitle("");
      setBody("");
      setExpiry("");
      setStep("edit");
      setNotice("Pengumuman terbit. Pengguna melihatnya di ikon bel saat membuka aplikasi.");
      setFilter("ACTIVE");
      await load();
    } catch (caught) {
      setStep("edit");
      setFormError(caught instanceof Error ? caught.message : "Pengumuman belum dapat diterbitkan.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    setBusy(true);
    try {
      await archiveAnnouncement(id);
      setConfirmId("");
      setNotice("Pengumuman diarsipkan dan tidak lagi tampil di aplikasi.");
      await load();
    } catch (caught) {
      setListError(caught instanceof Error ? caught.message : "Pengumuman belum dapat diarsipkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-950 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <ConsoleHeader
          title="Pengumuman"
          subtitle="Tulis pesan untuk semua pengguna aplikasi. Muncul di ikon bel."
        />

        {notice ? (
          <p role="status" className="mb-4 rounded-lg bg-emerald-100 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </p>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="tulis-judul">
          <h2 id="tulis-judul" className="text-sm font-bold uppercase tracking-wider text-slate-500">
            {step === "edit" ? "Tulis pengumuman" : "Pratinjau sebelum terbit"}
          </h2>

          {step === "edit" ? (
            <form onSubmit={goPreview} className="mt-4 space-y-4" noValidate>
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Teks polos, <strong>tanpa tautan atau alamat situs</strong>. Setelah terbit pengumuman tidak dapat diubah; kalau ada
                yang salah, arsipkan lalu terbitkan yang baru.
              </p>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Judul</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={ANNOUNCEMENT_TITLE_MAX}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
                  placeholder="Contoh: Jadwal perawatan layanan"
                  data-testid="announcement-title"
                />
                <span className="mt-1 block text-right text-xs text-slate-500">
                  {title.length}/{ANNOUNCEMENT_TITLE_MAX}
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Isi pengumuman</span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={ANNOUNCEMENT_BODY_MAX}
                  rows={7}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
                  placeholder="Tulis pesan yang singkat dan jelas."
                  data-testid="announcement-body"
                />
                <span className="mt-1 block text-right text-xs text-slate-500">
                  {body.length}/{ANNOUNCEMENT_BODY_MAX}
                </span>
              </label>

              <label className="block max-w-xs">
                <span className="text-sm font-semibold text-slate-700">Tampil sampai (opsional)</span>
                <input
                  type="date"
                  value={expiry}
                  min={today}
                  onChange={(event) => setExpiry(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
                  data-testid="announcement-expiry"
                />
                <span className="mt-1 block text-xs text-slate-500">Kosong = tampil sampai Anda mengarsipkannya.</span>
              </label>

              {hasLink ? (
                <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="announcement-link-warning">
                  Teks memuat tautan, alamat situs, atau alamat surel. Hapus dulu; pengumuman semacam itu ditolak.
                </p>
              ) : null}
              {formError ? (
                <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!formReady}
                className="rounded-lg bg-brand-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                data-testid="announcement-preview"
              >
                Pratinjau
              </button>
            </form>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="max-w-md rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="announcement-preview-card">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tampilan di ikon bel</p>
                <p className="mt-2 text-base font-bold text-slate-900">{title.trim()}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{body.trim()}</p>
              </div>
              <dl className="space-y-1 text-sm text-slate-700">
                <div className="flex gap-2">
                  <dt className="font-semibold">Penerima:</dt>
                  <dd>semua pengguna aplikasi TapGo</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold">Tampil sampai:</dt>
                  <dd>{expiry ? formatMoment(endOfDayIso(expiry)) : "sampai diarsipkan"}</dd>
                </div>
              </dl>
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Setelah diterbitkan, isi tidak dapat diubah. Tindakan ini tercatat di Log Aktivitas atas nama Anda.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={publish}
                  disabled={busy}
                  className="rounded-lg bg-brand-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  data-testid="announcement-publish"
                >
                  {busy ? "Menerbitkan…" : "Terbitkan ke semua pengguna"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("edit")}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Kembali mengedit
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8" aria-labelledby="riwayat-judul">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="riwayat-judul" className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Riwayat pengumuman
            </h2>
            <div className="flex gap-1" role="group" aria-label="Saring status">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={filter === option.value}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    filter === option.value ? "bg-brand-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {listError ? (
            <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {listError}
            </p>
          ) : null}

          {items === null && !listError ? (
            <p className="mt-3 rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">Memuat…</p>
          ) : null}
          {items && items.length === 0 ? (
            <p className="mt-3 rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">Belum ada pengumuman di daftar ini.</p>
          ) : null}

          <ul className="mt-3 space-y-3" data-testid="announcement-list">
            {items?.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Terbit {formatMoment(item.publishedAt)}
                      {item.createdByName ? ` oleh ${item.createdByName}` : ""}
                      {item.expiresAt ? ` · tampil sampai ${formatMoment(item.expiresAt)}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{item.body}</p>
                {item.status === "ARCHIVED" ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Diarsipkan {formatMoment(item.archivedAt)}
                    {item.archivedByName ? ` oleh ${item.archivedByName}` : ""}
                  </p>
                ) : confirmId === item.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">Arsipkan pengumuman ini?</span>
                    <button
                      type="button"
                      onClick={() => archive(item.id)}
                      disabled={busy}
                      className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Ya, arsipkan
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId("")}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(item.id)}
                    className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Arsipkan
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
