import { PrismaClient, UserRole } from "@prisma/client";

/**
 * Pengawasan aksi admin untuk pemilik (Super Admin VIP): ringkasan per admin dan peringatan pola yang patut ditinjau.
 *
 * Sumbernya hanya tabel audit_logs, tanpa pencatatan baru. Peringatan adalah PETUNJUK untuk ditinjau manusia, bukan
 * tuduhan: tiap peringatan menyebut siapa, berapa kali, dan kapan, sehingga dapat dicocokkan dengan log lengkapnya.
 */

/** Aksi yang menggerakkan atau menyetujui uang; jumlahnya dijumlahkan dari metadata (amount/totalPaid). */
export const MONEY_ACTIONS = new Set([
  "WITHDRAWAL_APPROVED",
  "WITHDRAWAL_PAID",
  "MANUAL_TOPUP_CONFIRMED",
  "REWARD_APPROVED",
  "REWARD_PAID",
  "DRIVER_INCENTIVE_CLAIM_APPROVED",
  "DRIVER_INCENTIVE_CLAIM_REVERSED",
  "PROFIT_SHARING_PERIOD_DISTRIBUTED",
  "MEMBERSHIP_PAYMENT_CONFIRMED",
  "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED"
]);

/** Ambang peringatan. Sengaja konstanta di kode (bukan pengaturan) agar tidak bisa dilonggarkan lewat konsol. */
export const OVERSIGHT_THRESHOLDS = {
  /** Penarikan disetujui oleh satu admin dalam satu jam. */
  withdrawalApprovalsPerHour: 10,
  /** Top up manual dikonfirmasi oleh satu admin dalam satu jam. */
  manualTopUpsPerHour: 5,
  /** Login admin gagal pada satu akun admin dalam satu jam. */
  failedAdminLoginsPerHour: 5,
  /** Total rupiah uang yang diproses satu admin dalam jendela pengamatan. */
  moneyPerWindow: 20_000_000
} as const;

const HOUR_MS = 3_600_000;
const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN", "SUPER_ADMIN_VIP"];

export type OversightRow = {
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: UserRole | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
};

export type OversightAlert = {
  key: string;
  severity: "warning" | "info";
  message: string;
  actorId: string | null;
  actorName: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
};

export type OversightAdmin = {
  actorId: string;
  name: string;
  role: UserRole;
  total: number;
  moneyTotal: number;
  byAction: Record<string, number>;
};

export type OversightReport = {
  windowHours: number;
  generatedAt: string;
  admins: OversightAdmin[];
  alerts: OversightAlert[];
};

function amountOf(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const m = metadata as Record<string, unknown>;
  for (const key of ["amount", "totalPaid"]) {
    const n = Number(m[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Jendela geser 1 jam: ada berapa kejadian paling banyak dalam satu jam, beserta waktu pertama dan terakhirnya. */
function densestHour(times: Date[]): { count: number; first: Date; last: Date } | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  let best = { count: 0, first: sorted[0]!, last: sorted[0]! };
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end]!.getTime() - sorted[start]!.getTime() > HOUR_MS) start += 1;
    const count = end - start + 1;
    if (count > best.count) best = { count, first: sorted[start]!, last: sorted[end]! };
  }
  return best;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Murni dan dapat diuji: dari baris audit menjadi laporan pengawasan. */
export function analyzeActivity(
  rows: OversightRow[],
  windowHours: number,
  now: Date,
  failedAdminLogins: Array<{ userId: string; name: string; at: Date }> = []
): OversightReport {
  const admins = new Map<string, OversightAdmin>();
  const byActorAction = new Map<string, Date[]>();
  for (const row of rows) {
    if (!row.actorId || !row.actorRole || !ADMIN_ROLES.includes(row.actorRole)) continue;
    const entry =
      admins.get(row.actorId) ??
      ({ actorId: row.actorId, name: row.actorName ?? "Tanpa nama", role: row.actorRole, total: 0, moneyTotal: 0, byAction: {} } as OversightAdmin);
    entry.total += 1;
    entry.byAction[row.action] = (entry.byAction[row.action] ?? 0) + 1;
    if (MONEY_ACTIONS.has(row.action)) entry.moneyTotal += amountOf(row.metadata);
    admins.set(row.actorId, entry);
    const key = `${row.actorId}|${row.action}`;
    byActorAction.set(key, [...(byActorAction.get(key) ?? []), row.createdAt]);
  }

  const alerts: OversightAlert[] = [];
  const addDense = (action: string, threshold: number, key: string, label: string) => {
    for (const admin of admins.values()) {
      const dense = densestHour(byActorAction.get(`${admin.actorId}|${action}`) ?? []);
      if (dense && dense.count >= threshold) {
        alerts.push({
          key,
          severity: "warning",
          message: `${admin.name} ${label} ${dense.count} kali dalam satu jam`,
          actorId: admin.actorId,
          actorName: admin.name,
          count: dense.count,
          firstAt: dense.first.toISOString(),
          lastAt: dense.last.toISOString()
        });
      }
    }
  };
  addDense("WITHDRAWAL_APPROVED", OVERSIGHT_THRESHOLDS.withdrawalApprovalsPerHour, "withdrawal-burst", "menyetujui penarikan");
  addDense("MANUAL_TOPUP_CONFIRMED", OVERSIGHT_THRESHOLDS.manualTopUpsPerHour, "topup-burst", "mengonfirmasi top up manual");

  for (const admin of admins.values()) {
    if (admin.moneyTotal >= OVERSIGHT_THRESHOLDS.moneyPerWindow) {
      alerts.push({
        key: "money-volume",
        severity: "info",
        message: `${admin.name} memproses uang ${rupiah(admin.moneyTotal)} dalam ${windowHours} jam terakhir`,
        actorId: admin.actorId,
        actorName: admin.name,
        count: admin.total,
        firstAt: now.toISOString(),
        lastAt: now.toISOString()
      });
    }
  }

  const failedByUser = new Map<string, { name: string; times: Date[] }>();
  for (const f of failedAdminLogins) {
    const cur = failedByUser.get(f.userId) ?? { name: f.name, times: [] };
    cur.times.push(f.at);
    failedByUser.set(f.userId, cur);
  }
  for (const [userId, info] of failedByUser) {
    const dense = densestHour(info.times);
    if (dense && dense.count >= OVERSIGHT_THRESHOLDS.failedAdminLoginsPerHour) {
      alerts.push({
        key: "admin-login-failures",
        severity: "warning",
        message: `Akun admin ${info.name} gagal masuk ${dense.count} kali dalam satu jam`,
        actorId: userId,
        actorName: info.name,
        count: dense.count,
        firstAt: dense.first.toISOString(),
        lastAt: dense.last.toISOString()
      });
    }
  }

  return {
    windowHours,
    generatedAt: now.toISOString(),
    admins: [...admins.values()].sort((a, b) => b.moneyTotal - a.moneyTotal || b.total - a.total),
    alerts: alerts.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "warning" ? -1 : 1))
  };
}

export class AdminOversightService {
  constructor(private readonly prisma: PrismaClient) {}

  async report(windowHours = 24, now = new Date()): Promise<OversightReport> {
    const since = new Date(now.getTime() - windowHours * HOUR_MS);
    const [rows, failed] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { createdAt: { gte: since }, actor: { role: { in: ADMIN_ROLES } } },
        orderBy: { createdAt: "desc" },
        take: 20_000,
        select: {
          action: true,
          actorId: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          actor: { select: { fullName: true, role: true } }
        }
      }),
      // Login gagal dicatat tanpa pelaku (actorId kosong) dengan entityId = akun yang dituju.
      this.prisma.auditLog.findMany({
        where: { action: "AUTH_LOGIN_FAILED", createdAt: { gte: since }, entityType: "USER", entityId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 20_000,
        select: { entityId: true, createdAt: true }
      })
    ]);
    const targetIds = [...new Set(failed.map((f) => f.entityId!))];
    const adminTargets = targetIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: targetIds }, role: { in: ADMIN_ROLES } },
          select: { id: true, fullName: true }
        })
      : [];
    const names = new Map(adminTargets.map((u) => [u.id, u.fullName]));
    return analyzeActivity(
      rows.map((r) => ({
        action: r.action,
        actorId: r.actorId,
        actorName: r.actor?.fullName ?? null,
        actorRole: r.actor?.role ?? null,
        entityId: r.entityId,
        metadata: r.metadata,
        createdAt: r.createdAt
      })),
      windowHours,
      now,
      failed.filter((f) => names.has(f.entityId!)).map((f) => ({ userId: f.entityId!, name: names.get(f.entityId!)!, at: f.createdAt }))
    );
  }
}
