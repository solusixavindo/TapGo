import { beforeEach, describe, expect, it } from "vitest";
import {
  buildAdminRequestRecord,
  describeAdminRequest,
  normalizeAdminPath,
  resetAdminRequestDebounce,
  sanitizeBody
} from "../../src/core/http/adminActivity.js";

const ID = "11111111-2222-4333-8444-555555555555";
const req = (method: string, url: string, body?: unknown, query: Record<string, unknown> = {}) =>
  ({ method, originalUrl: url, body, query, headers: { "user-agent": "Mozilla/5.0 Test" } }) as never;

beforeEach(() => resetAdminRequestDebounce());

describe("normalizeAdminPath dan describeAdminRequest", () => {
  it("mengubah id menjadi :id dan memetakan ke kalimat operator", () => {
    const { path, template } = normalizeAdminPath(`/api/v1/admin/withdrawals/${ID}/approve?x=1`);
    expect(path).toBe(`/withdrawals/${ID}/approve`);
    expect(template).toBe("/withdrawals/:id/approve");
    expect(describeAdminRequest("POST", template)).toBe("Menyetujui penarikan dana");
    expect(describeAdminRequest("POST", "/manual-topups/:id/confirm")).toBe("Mengonfirmasi top up manual");
    expect(describeAdminRequest("PATCH", "/rides/drivers/:id/status")).toBe("Mengubah status driver");
  });

  it("rute yang belum terdaftar tampil apa adanya (tidak disembunyikan)", () => {
    expect(describeAdminRequest("POST", "/rute-baru/:id/aksi")).toBe("POST /rute-baru/:id/aksi");
  });
});

describe("sanitizeBody", () => {
  it("menyamarkan rahasia, memotong teks panjang, dan menolak bentuk yang bukan isian", () => {
    const out = sanitizeBody({ reason: "x".repeat(500), password: "rahasia", currentPassword: "abc", token: "t", amount: 5000, note: null, nested: { a: 1 } })!;
    expect(out.password).toBe("***");
    expect(out.currentPassword).toBe("***");
    expect(out.token).toBe("***");
    expect(String(out.reason).length).toBeLessThanOrEqual(301);
    expect(out.amount).toBe(5000);
    expect(out.nested).toBe('{"a":1}');
    expect(sanitizeBody(Buffer.from("raw"))).toBeUndefined();
    expect(sanitizeBody([1, 2])).toBeUndefined();
    expect(sanitizeBody({})).toBeUndefined();
  });
});

describe("buildAdminRequestRecord", () => {
  it("POST dicatat lengkap: kalimat, status, hasil, isian yang disamarkan, perangkat", () => {
    const rec = buildAdminRequestRecord(req("POST", `/api/v1/admin/withdrawals/${ID}/reject`, { reason: "rekening salah", password: "x" }), 200, 12.4, "actor-1")!;
    expect(rec.action).toBe("ADMIN_REQUEST");
    expect(rec.entityId).toBe("POST /withdrawals/:id/reject");
    expect(rec.metadata).toMatchObject({ label: "Menolak penarikan dana", method: "POST", statusCode: 200, ok: true, readOnly: false, durationMs: 12, userAgent: "Mozilla/5.0 Test" });
    expect(rec.metadata.body).toEqual({ reason: "rekening salah", password: "***" });
  });

  it("penolakan (403) dicatat dengan ok=false", () => {
    const rec = buildAdminRequestRecord(req("POST", `/api/v1/admin/withdrawals/${ID}/paid`), 403, 3, "a")!;
    expect(rec.metadata).toMatchObject({ statusCode: 403, ok: false });
  });

  it("GET penyegaran otomatis dan pembacaan log sendiri tidak dicatat; GET lain dicatat sekali per 30 detik", () => {
    for (const url of ["/api/v1/admin/dashboard/summary", "/api/v1/admin/dashboard/oversight", "/api/v1/admin/audit-logs?page=1", "/api/v1/admin/reports/financial-summary"]) {
      expect(buildAdminRequestRecord(req("GET", url), 200, 1, "a")).toBeNull();
    }
    const t = Date.now();
    const first = buildAdminRequestRecord(req("GET", `/api/v1/admin/members/${ID}`), 200, 1, "a", t)!;
    expect(first.metadata).toMatchObject({ label: "Melihat detail member", readOnly: true });
    expect(first.metadata.body).toBeUndefined();
    expect(buildAdminRequestRecord(req("GET", `/api/v1/admin/members/${ID}`), 200, 1, "a", t + 5_000)).toBeNull();
    expect(buildAdminRequestRecord(req("GET", `/api/v1/admin/members/${ID}`), 200, 1, "b", t + 5_000)).not.toBeNull();
    expect(buildAdminRequestRecord(req("GET", `/api/v1/admin/members/${ID}`), 200, 1, "a", t + 31_000)).not.toBeNull();
  });

  it("OPTIONS/HEAD tidak dicatat; query rahasia disamarkan", () => {
    expect(buildAdminRequestRecord(req("OPTIONS", "/api/v1/admin/members"), 204, 1, "a")).toBeNull();
    const rec = buildAdminRequestRecord(req("GET", "/api/v1/admin/members?search=budi&token=zzz", undefined, { search: "budi", token: "zzz" }), 200, 1, "a")!;
    expect(rec.metadata.query).toEqual({ search: "budi", token: "***" });
  });
});
