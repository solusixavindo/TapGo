"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PREVIEW_MODE,
  PREVIEW_REFERRAL_SUMMARY,
  PREVIEW_REFERRAL_TEAM,
  ReferralSummary,
  ReferralTeamMember,
  TOKEN_KEY,
  getReferralSummary,
  getReferralTeam,
  readSession
} from "../api";
import { formatRupiah, secondaryButtonClass } from "../upgrade-shell";

function formatMoment(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(parsed);
}

function groupByLevel(members: ReferralTeamMember[]) {
  const byLevel = new Map<number, ReferralTeamMember[]>();
  for (const member of members) {
    const bucket = byLevel.get(member.level) ?? [];
    bucket.push(member);
    byLevel.set(member.level, bucket);
  }
  return Array.from(byLevel.entries()).sort(([left], [right]) => left - right);
}

export default function ReferralTeam() {
  const router = useRouter();
  const [summary, setSummary] = useState<ReferralSummary | null>(
    PREVIEW_MODE ? PREVIEW_REFERRAL_SUMMARY : null
  );
  const [team, setTeam] = useState<ReferralTeamMember[]>(
    PREVIEW_MODE ? PREVIEW_REFERRAL_TEAM : []
  );
  const [loading, setLoading] = useState(!PREVIEW_MODE);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (PREVIEW_MODE) return;
    const token = readSession(TOKEN_KEY);
    if (!token) {
      router.replace("/upgrade");
      return;
    }
    let alive = true;
    Promise.all([getReferralSummary(token), getReferralTeam(token)])
      .then(([summaryResult, teamResult]) => {
        if (!alive) return;
        setSummary(summaryResult);
        setTeam(teamResult);
        setError("");
      })
      .catch((caught: unknown) =>
        alive
          ? setError(
              caught instanceof Error ? caught.message : "Daftar referral belum dapat dimuat."
            )
          : undefined
      )
      .finally(() => (alive ? setLoading(false) : undefined));
    return () => {
      alive = false;
    };
  }, [router]);

  async function copyLink() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.referralLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API dapat ditolak browser (mis. tanpa izin/permission
      // policy) — kegagalan diam-diam di sini tidak berbahaya, pengguna masih
      // bisa menyalin manual dari teks yang tertampil.
    }
  }

  if (loading) {
    return <p className="text-sm font-semibold themed-text-muted">Memuat tim referral…</p>;
  }

  if (error && !summary) {
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

  if (!summary) {
    return null;
  }

  const groups = groupByLevel(team);

  return (
    <div>
      <div className="overflow-hidden rounded-[1.5rem] border themed-border themed-card-bg p-5">
        <p className="text-xs font-bold uppercase tracking-wider themed-text-muted">
          Kode referral Anda
        </p>
        <p className="mt-1 text-2xl font-black themed-text">{summary.referralCode}</p>

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border themed-border themed-card-bg px-4 py-3">
          <p className="flex-1 truncate text-sm themed-text-muted">{summary.referralLink}</p>
          <button
            type="button"
            onClick={copyLink}
            className="shrink-0 rounded-xl bg-brand-gold px-3 py-2 text-xs font-black text-brand-navyDeep transition hover:-translate-y-0.5"
          >
            {copied ? "Tersalin" : "Salin"}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-dashed themed-border pt-5">
          <div>
            <p className="text-xs themed-text-muted">Referral Langsung</p>
            <p className="mt-1 text-lg font-black themed-text">{summary.directDownlines}</p>
          </div>
          <div>
            <p className="text-xs themed-text-muted">Total Referral</p>
            <p className="mt-1 text-lg font-black themed-text">{summary.totalDownlines}</p>
          </div>
          <div>
            <p className="text-xs themed-text-muted">Total Komisi</p>
            <p className="mt-1 text-lg font-black themed-text">
              {formatRupiah(summary.totalCommission)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        {groups.length === 0 ? (
          <div className="rounded-2xl border themed-border themed-card-bg px-5 py-6 text-center">
            <p className="text-sm font-bold themed-text">Belum ada mitra</p>
            <p className="mt-2 text-sm leading-7 themed-text-muted">
              Daftar referral Anda akan muncul di sini setelah ada member baru yang
              memakai kode referral Anda.
            </p>
          </div>
        ) : (
          groups.map(([level, members]) => (
            <div key={level}>
              <p className="mb-3 text-xs font-black uppercase tracking-wider themed-text-muted">
                Tingkat {level} · {members.length} anggota
              </p>
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-4 rounded-2xl border themed-border themed-card-bg px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold themed-text">
                        {member.fullName}
                      </p>
                      <p className="text-xs themed-text-muted">
                        {member.referralCode} · Bergabung {formatMoment(member.joinedAt)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-green/15 px-2.5 py-1 text-[11px] font-black text-brand-green">
                      {member.membershipTier}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {error ? (
        <p className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-300">
          Data terakhir yang berhasil dimuat ditampilkan di atas. {error}
        </p>
      ) : null}

      <Link href="/" className={`${secondaryButtonClass} mt-6`}>
        Selesai
      </Link>
    </div>
  );
}
