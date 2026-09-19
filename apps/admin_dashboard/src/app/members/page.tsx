"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MemberListItem, formatMoment, formatRupiah, listMembers, readRole, readToken } from "../../lib/api";
import ConsoleHeader from "../console-header";

const TIERS = ["", "BASIC", "SILVER", "GOLD", "PLATINUM"] as const;
const TIER_LABEL: Record<string, string> = {
  "": "Semua paket",
  BASIC: "Basic",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum"
};

/**
 * Direktori seluruh member (bukan antrean persetujuan — lihat Persetujuan
 * Member untuk itu). Mengekspos endpoint GET /admin/members yang sebelumnya
 * sudah ada di backend tapi belum punya tampilan.
 */
export default function MembersPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [items, setItems] = useState<MemberListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState("");
  // Filter dari kartu Beranda (?aktif=7, ?daftar=1|7), hari kalender WIB.
  const [scope, setScope] = useState<{ activeDays?: number; registeredDays?: number }>({});

  const refresh = useCallback(async (
    nextPage: number,
    nextSearch: string,
    nextTier: string,
    nextScope: { activeDays?: number; registeredDays?: number } = {}
  ) => {
    setLoading(true);
    try {
      const result = await listMembers({
        page: nextPage,
        search: nextSearch || undefined,
        tier: nextTier || undefined,
        ...nextScope
      });
      setItems(result.items);
      setTotal(result.total);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Daftar member belum dapat dimuat.");
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
    const params = new URLSearchParams(window.location.search);
    const aktif = Number(params.get("aktif"));
    const daftar = Number(params.get("daftar"));
    const initial = {
      ...(Number.isInteger(aktif) && aktif > 0 ? { activeDays: aktif } : {}),
      ...(Number.isInteger(daftar) && daftar > 0 ? { registeredDays: daftar } : {})
    };
    setScope(initial);
    void refresh(1, "", "", initial);
  }, [router, refresh]);

  function clearScope() {
    setScope({});
    setPage(1);
    window.history.replaceState(null, "", window.location.pathname);
    void refresh(1, search, tier, {});
  }

  const scopeLabel = scope.activeDays
    ? `Login dalam ${scope.activeDays} hari terakhir`
    : scope.registeredDays === 1
      ? "Mendaftar hari ini"
      : scope.registeredDays
        ? `Mendaftar dalam ${scope.registeredDays} hari terakhir`
        : "";

  function onSearchSubmit() {
    setPage(1);
    void refresh(1, search, tier, scope);
  }

  function onTierChange(next: string) {
    setTier(next);
    setPage(1);
    void refresh(1, search, next, scope);
  }

  function goToPage(next: number) {
    setPage(next);
    void refresh(next, search, tier, scope);
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Direktori Member"
          subtitle={`${total} member terdaftar`}
          role={role}
        />

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {scopeLabel ? (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span className="rounded-full bg-brand-navy px-3 py-1 text-xs font-bold text-white">{scopeLabel}</span>
            <button type="button" onClick={clearScope} className="text-xs font-semibold text-slate-500 underline underline-offset-4">
              Tampilkan semua member
            </button>
          </p>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => (event.key === "Enter" ? onSearchSubmit() : undefined)}
            placeholder="Cari nama, nomor HP, atau kode referral"
            className="min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
          />
          <select
            value={tier}
            onChange={(event) => onTierChange(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          >
            {TIERS.map((option) => (
              <option key={option} value={option}>
                {TIER_LABEL[option]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onSearchSubmit}
            className="rounded-lg bg-brand-ink px-4 py-2.5 text-sm font-semibold text-white"
          >
            Cari
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Tidak ada member yang cocok.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((member) => {
              const expanded = expandedId === member.id;
              return (
                <div key={member.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? "" : member.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold">{member.fullName}</p>
                      <p className="text-xs text-slate-500">
                        {member.phone} · {member.referralCode} · bergabung {formatMoment(member.joinedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                        {member.membership?.name ?? "Basic"}
                      </span>
                      <span className="text-xs text-slate-400">{expanded ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 md:grid-cols-4">
                      <Detail label="Saldo wallet" value={formatRupiah(member.walletBalance)} />
                      <Detail label="Saldo PPOB" value={formatRupiah(member.ppobBalance)} />
                      <Detail label="Total komisi diterima" value={formatRupiah(member.commissionTotal)} />
                      <Detail label="Referral langsung / total referral" value={`${member.directSponsorCount} / ${member.totalDownline}`} />
                      <Detail label="Email" value={member.email ?? "—"} />
                      <Detail
                        label="Pemberi referral"
                        value={member.sponsor ? `${member.sponsor.fullName} (${member.sponsor.referralCode})` : "—"}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            >
              Sebelumnya
            </button>
            <span className="text-sm text-slate-500">
              Halaman {page} dari {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-700">{value}</p>
    </div>
  );
}
