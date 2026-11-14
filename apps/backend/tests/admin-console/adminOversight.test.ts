import { describe, expect, it } from "vitest";
import { OVERSIGHT_THRESHOLDS, OversightRow, analyzeActivity } from "../../src/modules/admin-console/application/AdminOversightService.js";

const now = new Date("2026-11-14T10:00:00Z");
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
const row = (over: Partial<OversightRow> & { action: string }): OversightRow => ({
  actorId: "sa-1",
  actorName: "Bendahara",
  actorRole: "SUPER_ADMIN",
  entityId: "e",
  metadata: null,
  createdAt: at(5),
  ...over
});

describe("analyzeActivity", () => {
  it("meringkas per admin: jumlah aksi, per jenis, dan total uang dari metadata", () => {
    const rep = analyzeActivity(
      [
        row({ action: "WITHDRAWAL_APPROVED", metadata: { amount: "150000.00" } }),
        row({ action: "WITHDRAWAL_PAID", metadata: { amount: "150000.00" } }),
        row({ action: "PROFIT_SHARING_PERIOD_DISTRIBUTED", metadata: { totalPaid: "1000000.00" } }),
        row({ action: "SUPPORT_TICKET_UPDATED" })
      ],
      24,
      now
    );
    expect(rep.admins).toHaveLength(1);
    expect(rep.admins[0]).toMatchObject({ name: "Bendahara", total: 4, moneyTotal: 1_300_000 });
    expect(rep.admins[0]!.byAction).toEqual({ WITHDRAWAL_APPROVED: 1, WITHDRAWAL_PAID: 1, PROFIT_SHARING_PERIOD_DISTRIBUTED: 1, SUPPORT_TICKET_UPDATED: 1 });
    expect(rep.alerts).toEqual([]);
  });

  it("peringatan lonjakan: persis di ambang menyala, satu di bawahnya tidak", () => {
    const n = OVERSIGHT_THRESHOLDS.withdrawalApprovalsPerHour;
    const burst = Array.from({ length: n }, (_, i) => row({ action: "WITHDRAWAL_APPROVED", createdAt: at(i * 5) }));
    expect(analyzeActivity(burst, 24, now).alerts.map((a) => a.key)).toEqual(["withdrawal-burst"]);
    expect(analyzeActivity(burst.slice(1), 24, now).alerts).toEqual([]);
  });

  it("aksi yang tersebar lebih dari satu jam tidak dihitung sebagai lonjakan", () => {
    const n = OVERSIGHT_THRESHOLDS.manualTopUpsPerHour;
    const spread = Array.from({ length: n }, (_, i) => row({ action: "MANUAL_TOPUP_CONFIRMED", createdAt: at(i * 90) }));
    expect(analyzeActivity(spread, 24, now).alerts).toEqual([]);
    const tight = Array.from({ length: n }, (_, i) => row({ action: "MANUAL_TOPUP_CONFIRMED", createdAt: at(i * 10) }));
    const alerts = analyzeActivity(tight, 24, now).alerts;
    expect(alerts.map((a) => a.key)).toEqual(["topup-burst"]);
    expect(alerts[0]!.message).toContain("Bendahara");
    expect(alerts[0]!.count).toBe(n);
  });

  it("volume uang besar oleh satu admin menjadi catatan info; admin lain tidak ikut", () => {
    const rep = analyzeActivity(
      [
        row({ action: "WITHDRAWAL_PAID", metadata: { amount: "15000000" } }),
        row({ action: "WITHDRAWAL_PAID", metadata: { amount: "6000000" } }),
        row({ action: "WITHDRAWAL_PAID", actorId: "sa-2", actorName: "Lain", metadata: { amount: "1000000" } })
      ],
      24,
      now
    );
    expect(rep.alerts).toHaveLength(1);
    expect(rep.alerts[0]).toMatchObject({ key: "money-volume", severity: "info", actorName: "Bendahara" });
    expect(rep.admins[0]!.name).toBe("Bendahara"); // diurutkan menurut uang
  });

  it("login admin gagal berulang pada satu akun diperingatkan; baris non-admin dan tanpa pelaku diabaikan", () => {
    const n = OVERSIGHT_THRESHOLDS.failedAdminLoginsPerHour;
    const failed = Array.from({ length: n }, (_, i) => ({ userId: "u1", name: "Operator", at: at(i * 3) }));
    const rep = analyzeActivity(
      [row({ action: "WITHDRAWAL_APPROVED", actorId: "member", actorRole: "USER" }), row({ action: "X", actorId: null, actorRole: null })],
      24,
      now,
      failed
    );
    expect(rep.admins).toEqual([]);
    expect(rep.alerts.map((a) => a.key)).toEqual(["admin-login-failures"]);
    expect(analyzeActivity([], 24, now, failed.slice(1)).alerts).toEqual([]);
  });
});
