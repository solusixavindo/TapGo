"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMitra } from "./mitra-data";
import { MITRA_PREVIEW, TeamMember, getMemberAvatar, getTeam } from "./mitra-api";
import { PREVIEW_TEAM } from "./mitra-preview";
import { formatDate, initials, tierLabel } from "./mitra-format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Icon,
  PageHeading,
  Skeleton,
  Tone,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  useToast
} from "./mitra-ui";

function tierTone(tier: string): Tone {
  if (tier === "PLATINUM") return "gold";
  if (tier === "GOLD") return "amber";
  if (tier === "SILVER") return "blue";
  return "slate";
}

function useTeam() {
  const [team, setTeam] = useState<TeamMember[]>(MITRA_PREVIEW ? PREVIEW_TEAM : []);
  const [loading, setLoading] = useState(!MITRA_PREVIEW);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (MITRA_PREVIEW) return;
    setLoading(true);
    setError("");
    try {
      setTeam(await getTeam());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { team, loading, error, reload: load };
}

/** Foto anggota bila ada; bila tidak ada atau gagal dimuat, tampil inisial. */
function Avatar({ member, size }: { member: TeamMember; size: "sm" | "lg" }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!member.hasAvatar) return;
    let alive = true;
    void getMemberAvatar(member.userId).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [member.hasAvatar, member.userId]);

  const box = size === "lg" ? "h-16 w-16 text-lg" : "h-10 w-10 text-xs";
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={`Foto ${member.fullName}`}
        width={size === "lg" ? 64 : 40}
        height={size === "lg" ? 64 : 40}
        onError={() => setFailed(true)}
        className={`${box} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-full m-tone-gold font-black`}>
      {initials(member.fullName)}
    </span>
  );
}

function Collapse({ open, id, children }: { open: boolean; id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="m-collapse" data-open={open} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const panelId = `member-${member.userId}`;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(member.referralCode);
      toast("success", "Kode referral disalin.");
    } catch {
      toast("error", "Tidak dapat menyalin otomatis.");
    }
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-4 px-5 py-3 text-left transition hover:bg-[var(--themed-fill-1)] md:px-6"
      >
        <Avatar member={member} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold themed-text">{member.fullName}</span>
          <span className="block truncate text-xs themed-text-muted">Bergabung {formatDate(member.joinedAt)}</span>
        </span>
        <Badge tone={tierTone(member.membershipTier)}>{tierLabel(member.membershipTier)}</Badge>
        <Icon name="chevron" className="m-chevron h-4 w-4 shrink-0 themed-text-muted" />
      </button>
      <Collapse open={open} id={panelId}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pb-4 pt-1 md:px-6">
          <Avatar member={member} size="lg" />
          <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Kode referral</dt>
              <dd className="font-bold themed-text">{member.referralCode}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Tingkat</dt>
              <dd className="font-bold themed-text">Tingkat {member.level}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Bergabung</dt>
              <dd className="font-bold themed-text">{formatDate(member.joinedAt)}</dd>
            </div>
          </dl>
          <button type="button" onClick={copyCode} className={`${secondaryButtonClass} !min-h-[36px] !px-3 text-xs`}>
            <Icon name="copy" className="h-3.5 w-3.5" />
            Salin kode
          </button>
        </div>
      </Collapse>
    </li>
  );
}

function tierMix(members: TeamMember[]) {
  const counts = new Map<string, number>();
  for (const member of members) counts.set(member.membershipTier, (counts.get(member.membershipTier) ?? 0) + 1);
  return Array.from(counts.entries());
}

function LevelGroup({
  level,
  members,
  open,
  onToggle
}: {
  level: number;
  members: TeamMember[];
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `level-${level}`;
  return (
    <div className="border-b themed-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-[var(--themed-fill-1)] md:px-6"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl m-tone-gold text-sm font-black">
          {level}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black themed-text">Tingkat {level}</span>
          <span className="block text-xs themed-text-muted">
            {members.length} anggota ·{" "}
            {tierMix(members)
              .map(([tier, count]) => `${count} ${tierLabel(tier)}`)
              .join(", ")}
          </span>
        </span>
        {!open ? (
          <span className="m-avatar-stack hidden items-center sm:flex" aria-hidden="true">
            {members.slice(0, 4).map((member) => (
              <span key={member.userId} className="m-avatar-ring rounded-full">
                <Avatar member={member} size="sm" />
              </span>
            ))}
            {members.length > 4 ? (
              <span className="m-avatar-ring ml-[-10px] flex h-10 w-10 items-center justify-center rounded-full themed-fill-strong text-[11px] font-black themed-text">
                +{members.length - 4}
              </span>
            ) : null}
          </span>
        ) : null}
        <Icon name="chevron" className="m-chevron h-5 w-5 shrink-0 themed-text-muted" />
      </button>
      <Collapse open={open} id={panelId}>
        {/* Anggota baru dipasang saat tingkat dibuka, sehingga foto hanya diunduh untuk yang terlihat. */}
        {open ? (
          <ul className="border-t themed-border m-divide divide-y">
            {members.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))}
          </ul>
        ) : null}
      </Collapse>
    </div>
  );
}

export default function NetworkView() {
  const { core } = useMitra();
  const toast = useToast();
  const { team, loading, error, reload } = useTeam();
  const [query, setQuery] = useState("");
  const [openLevels, setOpenLevels] = useState<ReadonlySet<number>>(new Set([1]));

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byLevel = new Map<number, TeamMember[]>();
    for (const member of team) {
      if (
        needle &&
        !member.fullName.toLowerCase().includes(needle) &&
        !member.referralCode.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const bucket = byLevel.get(member.level) ?? [];
      bucket.push(member);
      byLevel.set(member.level, bucket);
    }
    byLevel.forEach((bucket) => {
      bucket.sort((a, b) => Date.parse(b.joinedAt) - Date.parse(a.joinedAt));
    });
    return Array.from(byLevel.entries()).sort(([a], [b]) => a - b);
  }, [team, query]);

  const searching = query.trim().length > 0;
  const allOpen = groups.length > 0 && groups.every(([level]) => searching || openLevels.has(level));

  if (!core) return null;
  const { summary } = core;

  function toggle(level: number) {
    setOpenLevels((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleAll() {
    setOpenLevels(allOpen ? new Set() : new Set(groups.map(([level]) => level)));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary.referralLink);
      toast("success", "Tautan referral disalin.");
    } catch {
      toast("error", "Tidak dapat menyalin otomatis. Salin tautan secara manual.");
    }
  }

  const shareText = encodeURIComponent(
    `Bergabung bersama TapGo Lion lewat tautan saya: ${summary.referralLink} (kode referral ${summary.referralCode})`
  );

  return (
    <div className="space-y-6">
      <PageHeading title="Referral" description="Bagikan tautan referral Anda dan pantau anggota yang bergabung." />

      <Card className="p-5 md:p-6">
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Tautan referral Anda</p>
            <div className="mt-2 flex items-center gap-2 rounded-xl themed-fill px-3.5 py-3">
              <Icon name="share" className="h-4 w-4 shrink-0 themed-text-muted" />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold themed-text">{summary.referralLink}</p>
            </div>
            <p className="mt-2 text-xs themed-text-muted">
              Kode referral: <span className="font-bold themed-text">{summary.referralCode}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={primaryButtonClass}>
              <Icon name="copy" className="h-4 w-4" />
              Salin tautan
            </button>
            <a
              href={`https://wa.me/?text=${shareText}`}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryButtonClass}
            >
              Bagikan WhatsApp
              <Icon name="external" className="h-4 w-4" />
            </a>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card as="div" className="p-4 md:p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Referral langsung</p>
          <p className="m-num mt-2 text-2xl font-black themed-text">{summary.directDownlines}</p>
        </Card>
        <Card as="div" className="p-4 md:p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Total referral</p>
          <p className="m-num mt-2 text-2xl font-black themed-text">{summary.totalDownlines}</p>
        </Card>
        <Card as="div" className="col-span-2 p-4 md:p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Sebaran per tingkat</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {groups.length === 0 ? (
              <span className="text-sm themed-text-muted">Belum ada anggota</span>
            ) : (
              team.length > 0 &&
              Array.from(new Set(team.map((member) => member.level)))
                .sort((a, b) => a - b)
                .map((level) => (
                  <span key={level} className="rounded-lg themed-fill px-2.5 py-1 text-xs font-bold themed-text-secondary">
                    T{level} · <span className="m-num">{team.filter((member) => member.level === level).length}</span>
                  </span>
                ))
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Daftar referral"
          subtitle={`${team.length} anggota`}
          action={
            groups.length > 0 && !searching ? (
              <button
                type="button"
                onClick={toggleAll}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--themed-accent-gold)] hover:underline"
              >
                <Icon name="chevron" className={`h-4 w-4 transition-transform ${allOpen ? "rotate-180" : ""}`} />
                {allOpen ? "Tutup semua" : "Buka semua"}
              </button>
            ) : undefined
          }
        />
        <div className="border-b themed-border px-5 py-3 md:px-6">
          <input
            className={`${inputClass} !mt-0 w-full !py-2 text-sm sm:max-w-xs`}
            type="search"
            placeholder="Cari nama atau kode…"
            aria-label="Cari anggota"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : groups.length === 0 ? (
          <EmptyState icon="users" title={team.length === 0 ? "Belum ada anggota" : "Tidak ada hasil"}>
            {team.length === 0
              ? "Bagikan tautan referral Anda. Anggota baru akan muncul di sini."
              : "Coba ubah kata kunci pencarian."}
          </EmptyState>
        ) : (
          <div>
            {groups.map(([level, members]) => (
              <LevelGroup
                key={level}
                level={level}
                members={members}
                open={searching || openLevels.has(level)}
                onToggle={() => toggle(level)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
