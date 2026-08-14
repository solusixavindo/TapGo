"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ASSIGNABLE_ROLES,
  AdminAccount,
  ROLE_REASON_CODES,
  RoleCandidate,
  assignAdminRole,
  formatMoment,
  listAdminAccounts,
  readRole,
  readToken,
  searchRoleCandidates
} from "../../lib/api";

/**
 * Pengelolaan role, khusus pemilik sistem.
 *
 * Halaman ini menyembunyikan dirinya untuk role selain puncak, tetapi itu hanya
 * kesopanan tampilan — penjaga sesungguhnya ada di server, yang menolak
 * SUPER_ADMIN sekalipun.
 *
 * Role puncak sengaja TIDAK ada di daftar pilihan. Memberikannya hanya bisa
 * lewat CLI di server, supaya otoritas tertinggi tidak pernah lahir dari satu
 * klik di peramban.
 */

const ROLE_LABEL: Record<string, string> = {
  USER: "Pengguna biasa",
  ADMIN: "Admin",
  SUPER_ADMIN: "Super Admin",
  SUPER_ADMIN_VIP: "Super Admin VIP"
};

const REASON_LABEL: Record<string, string> = {
  NEW_ADMIN_ASSIGNMENT: "Pengangkatan admin baru",
  PROMOTION: "Kenaikan kewenangan",
  DEMOTION: "Penurunan kewenangan",
  RESPONSIBILITY_CHANGE: "Perubahan tanggung jawab",
  ACCESS_REMOVAL: "Pencabutan akses",
  OFFBOARDING: "Berhenti bekerja",
  SECURITY_INCIDENT: "Insiden keamanan"
};

function roleTone(role: string) {
  if (role === "SUPER_ADMIN_VIP") return "bg-amber-100 text-amber-900";
  if (role === "SUPER_ADMIN") return "bg-indigo-100 text-indigo-800";
  if (role === "ADMIN") return "bg-slate-200 text-slate-700";
  return "bg-slate-100 text-slate-500";
}

export default function RolesPage() {
  const router = useRouter();
  const [myRole, setMyRole] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RoleCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await listAdminAccounts());
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
    setMyRole(readRole());
    void refresh();
  }, [router, refresh]);

  async function change(target: AdminAccount | RoleCandidate, role: string, reasonCode: string) {
    if (busyId) return;
    setBusyId(target.id);
    setError("");
    setNotice("");
    try {
      await assignAdminRole(target.id, role, reasonCode);
      setNotice(
        `${target.fullName} kini ${ROLE_LABEL[role] ?? role}. Sesi lamanya dicabut, jadi ia perlu masuk ulang.`
      );
      setCandidates([]);
      setQuery("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Perubahan belum dapat diproses.");
    } finally {
      setBusyId("");
    }
  }

  async function search() {
    if (query.trim().length < 3) {
      setError("Ketik minimal 3 karakter untuk mencari.");
      return;
    }
    setSearching(true);
    setError("");
    try {
      setCandidates(await searchRoleCandidates(query.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pencarian gagal.");
    } finally {
      setSearching(false);
    }
  }

  if (myRole && myRole !== "SUPER_ADMIN_VIP") {
    return (
      <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
        <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold">Halaman ini khusus pemilik sistem</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Hanya Super Admin VIP yang dapat mengubah role. Anda masuk sebagai{" "}
            {ROLE_LABEL[myRole] ?? myRole}.
          </p>
          <Link
            href="/member-requests"
            className="mt-5 inline-block rounded-lg bg-brand-ink px-4 py-2.5 text-sm font-semibold text-white"
          >
            Kembali ke verifikasi
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Pengelolaan Role</h1>
            <p className="mt-1 text-sm text-slate-500">
              Hanya Super Admin VIP yang dapat mengubah role admin dan super admin.
            </p>
          </div>
          <Link
            href="/member-requests"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
          >
            Verifikasi keanggotaan
          </Link>
        </header>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Angkat admin baru</h2>
          <p className="mt-1 text-sm text-slate-500">
            Cari akun yang sudah terdaftar dengan nama, nomor HP, atau kode referral.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => (event.key === "Enter" ? void search() : undefined)}
              placeholder="Nama, nomor HP, atau kode referral"
              className="min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
            />
            <button
              type="button"
              onClick={() => void search()}
              disabled={searching}
              className="rounded-lg bg-brand-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {searching ? "Mencari…" : "Cari"}
            </button>
          </div>

          {candidates.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold">{candidate.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {candidate.phone} · {candidate.referralCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === candidate.id}
                    onClick={() => void change(candidate, "ADMIN", "NEW_ADMIN_ASSIGNMENT")}
                    className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Jadikan Admin
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Pemegang role saat ini
          </h2>
          {loading ? <p className="mt-3 text-sm text-slate-500">Memuat…</p> : null}

          <div className="mt-3 space-y-2">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={busyId === account.id}
                onChange={change}
              />
            ))}
          </div>
        </section>

        <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
          Role Super Admin VIP tidak dapat diberikan dari halaman ini. Pemberiannya hanya lewat
          perintah di server, supaya otoritas tertinggi tidak pernah lahir dari satu klik.
          Setiap perubahan role mencabut sesi orang yang bersangkutan seketika.
        </p>
      </div>
    </main>
  );
}

function AccountRow({
  account,
  busy,
  onChange
}: {
  account: AdminAccount;
  busy: boolean;
  onChange: (target: AdminAccount, role: string, reasonCode: string) => void;
}) {
  const [role, setRole] = useState(account.role);
  const [reason, setReason] = useState<string>("RESPONSIBILITY_CHANGE");
  const locked = account.role === "SUPER_ADMIN_VIP";

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{account.fullName}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${roleTone(account.role)}`}>
            {ROLE_LABEL[account.role] ?? account.role}
          </span>
          {account.holdsScopeManage ? (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
              Pengelola scope
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {account.phone} · terakhir masuk {formatMoment(account.lastLoginAt)}
        </p>
      </div>

      {locked ? (
        <p className="text-xs text-slate-400">
          Akun pemilik. Hanya dapat diubah lewat perintah di server.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABEL[option]}
              </option>
            ))}
          </select>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ROLE_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {REASON_LABEL[code]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || role === account.role}
            onClick={() => onChange(account, role, reason)}
            className="rounded-lg bg-brand-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Memproses…" : "Terapkan"}
          </button>
        </div>
      )}
    </div>
  );
}
