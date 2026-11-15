import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Pengumuman pemilik di ikon bel aplikasi user (keputusan Owner 15 Nov 2026):
 * hanya VIP yang menulis, teks polos tanpa tautan, tidak dapat diubah setelah terbit, tercatat di audit,
 * dan pengguna melihat hanya yang aktif dengan penanda belum dibaca.
 */
let server: Server | undefined;
let baseUrl = "";
let sign: (payload: { sub: string; role: UserRole; sessionId: string; channel?: "WEB" | "APP" | "ADMIN" }) => string;
let seq = 0;

async function user(role: UserRole): Promise<User> {
  seq += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: { fullName: `Pengumuman ${role} ${seq}`, phone: `+62897${String(4000000 + seq)}`, referralCode: `ANN${String(seq).padStart(6, "0")}`, role, membershipId: basic.id }
  });
}
const adminCall = (actor: User, method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}/api/v1/admin${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${sign({ sub: actor.id, role: actor.role, sessionId: `s-${actor.id}`, channel: "ADMIN" })}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
const appCall = (actor: User | null, method: string, path: string) =>
  fetch(`${baseUrl}/api/v1/announcements${path}`, {
    method,
    headers: actor ? { authorization: `Bearer ${sign({ sub: actor.id, role: actor.role, sessionId: `s-${actor.id}`, channel: "APP" })}` } : {}
  });
const publish = (actor: User, body: Record<string, unknown>) => adminCall(actor, "POST", "/announcements", body);
const valid = { title: "Jadwal perawatan", body: "Layanan top up berhenti sebentar malam ini pukul 23.00 WIB." };
const json = async (res: Response) => (await res.json()) as { success: boolean; data?: any; code?: string; message?: string };

describe.skipIf(!runIntegration)("Pengumuman pemilik", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("Need dedicated test DB");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "announcement-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "announcement-refresh-secret-00000000";
    const [{ createApp }, tokenService] = await Promise.all([import("../../src/app.js"), import("../../src/core/security/tokenService.js")]);
    sign = tokenService.signAccessToken as typeof sign;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });
  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  describe("penulisan (konsol admin)", () => {
    it("hanya Super Admin VIP: Admin dan Super Admin ditolak, termasuk untuk melihat daftar dan mengarsipkan", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const created = await json(await publish(vip, valid));
      for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
        const actor = await user(role);
        expect((await publish(actor, valid)).status).toBe(403);
        expect((await adminCall(actor, "GET", "/announcements")).status).toBe(403);
        expect((await adminCall(actor, "POST", `/announcements/${created.data.id}/archive`)).status).toBe(403);
      }
      expect(await prisma.announcement.count()).toBe(1);
    });

    it("pengguna biasa tidak dapat memakai rute admin sama sekali", async () => {
      const member = await user("USER");
      const res = await adminCall(member, "POST", "/announcements", valid);
      expect([401, 403]).toContain(res.status);
      expect(await prisma.announcement.count()).toBe(0);
    });

    it("menerbitkan: tersimpan, isi dinormalkan, tercatat di audit dengan pelaku", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const res = await publish(vip, { title: "  Jadwal \n perawatan ", body: "Isi\r\n\r\n\r\n\r\nakhir" });
      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.data).toMatchObject({ title: "Jadwal perawatan", body: "Isi\n\nakhir", audience: "USERS", status: "ACTIVE", expiresAt: null });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ANNOUNCEMENT_PUBLISHED", entityId: body.data.id } });
      expect(audit.actorId).toBe(vip.id);
      expect(audit.metadata).toMatchObject({ title: "Jadwal perawatan", audience: "USERS" });
    });

    it("menolak tautan (422), isi kosong, dan batas panjang; tidak ada yang tersimpan", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const link = await publish(vip, { title: "Promo", body: "Buka https://contoh.test sekarang" });
      expect(link.status).toBe(422);
      expect((await json(link)).code ?? "").toContain("ANNOUNCEMENT_LINK_NOT_ALLOWED");
      expect((await publish(vip, { title: "Promo", body: "Kunjungi tapgolion.id" })).status).toBe(422);
      expect((await publish(vip, { title: "Promo di toko.com", body: "Diskon" })).status).toBe(422);
      expect((await publish(vip, { title: "   ", body: "Isi" })).status).toBe(422);
      expect((await publish(vip, { title: "Judul", body: "a".repeat(1001) })).status).toBe(422);
      expect((await publish(vip, { title: "a".repeat(81), body: "Isi" })).status).toBe(422);
      expect((await publish(vip, { title: "Judul" })).status).toBe(400);
      expect(await prisma.announcement.count()).toBe(0);
    });

    it("audience tahap 1 hanya USERS; nilai lain ditolak", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      expect((await publish(vip, { ...valid, audience: "DRIVERS" })).status).toBe(400);
      expect((await publish(vip, { ...valid, audience: "ALL" })).status).toBe(400);
      expect(await prisma.announcement.count()).toBe(0);
    });

    it("tanggal berakhir harus di masa depan", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const past = await publish(vip, { ...valid, expiresAt: new Date(Date.now() - 60_000).toISOString() });
      expect(past.status).toBe(422);
      expect((await json(past)).code ?? "").toContain("ANNOUNCEMENT_EXPIRY_IN_PAST");
      const future = await publish(vip, { ...valid, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      expect(future.status).toBe(201);
    });

    it("tidak dapat diubah setelah terbit: tidak ada rute ubah/hapus", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const id = (await json(await publish(vip, valid))).data.id as string;
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const res = await adminCall(vip, method, `/announcements/${id}`, { title: "Diubah", body: "Diubah" });
        expect(res.status).toBe(404);
      }
      const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
      expect(row.title).toBe(valid.title);
      expect(row.body).toBe(valid.body);
    });

    it("mengarsipkan: tercatat, yang kedua kali ditolak 409, id tidak dikenal 404", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const id = (await json(await publish(vip, valid))).data.id as string;
      const archived = await adminCall(vip, "POST", `/announcements/${id}/archive`);
      expect(archived.status).toBe(200);
      expect((await json(archived)).data.status).toBe("ARCHIVED");
      const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
      expect(row.archivedBy).toBe(vip.id);
      expect(await prisma.auditLog.count({ where: { action: "ANNOUNCEMENT_ARCHIVED", entityId: id, actorId: vip.id } })).toBe(1);
      expect((await adminCall(vip, "POST", `/announcements/${id}/archive`)).status).toBe(409);
      expect((await adminCall(vip, "POST", "/announcements/2f1c9d0e-6b7a-4c1d-9e0f-3a4b5c6d7e8f/archive")).status).toBe(404);
      expect((await adminCall(vip, "POST", "/announcements/bukan-uuid/archive")).status).toBe(400);
    });

    it("batas 10 terbitan per jam per akun; akun VIP lain tidak terpengaruh", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const other = await user("SUPER_ADMIN_VIP");
      for (let i = 0; i < 10; i += 1) expect((await publish(vip, { title: `Info ${i}`, body: "Isi pengumuman biasa." })).status).toBe(201);
      const eleventh = await publish(vip, valid);
      expect(eleventh.status).toBe(429);
      expect((await json(eleventh)).code ?? "").toContain("ANNOUNCEMENT_RATE_LIMIT");
      expect(await prisma.announcement.count()).toBe(10);
      expect((await publish(other, valid)).status).toBe(201);
    });

    it("daftar admin memuat semua status dengan nama pelaku, dan dapat disaring", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const a = (await json(await publish(vip, { title: "Aktif", body: "Isi aktif." }))).data.id as string;
      const b = (await json(await publish(vip, { title: "Diarsipkan", body: "Isi arsip." }))).data.id as string;
      await adminCall(vip, "POST", `/announcements/${b}/archive`);
      await prisma.announcement.create({
        data: { title: "Lewat", body: "Sudah lewat.", createdBy: vip.id, publishedAt: new Date(Date.now() - 7200_000), expiresAt: new Date(Date.now() - 3600_000) }
      });
      const all = (await json(await adminCall(vip, "GET", "/announcements"))).data;
      expect(all.items.map((item: any) => item.status).sort()).toEqual(["ACTIVE", "ARCHIVED", "EXPIRED"]);
      expect(all.items.find((item: any) => item.id === a).createdByName).toBe(vip.fullName);
      expect(all.items.find((item: any) => item.id === b).archivedByName).toBe(vip.fullName);
      const active = (await json(await adminCall(vip, "GET", "/announcements?status=ACTIVE"))).data;
      expect(active.items.map((item: any) => item.title)).toEqual(["Aktif"]);
      const archived = (await json(await adminCall(vip, "GET", "/announcements?status=ARCHIVED"))).data;
      expect(archived.items.map((item: any) => item.title)).toEqual(["Diarsipkan"]);
    });
  });

  describe("pembacaan (aplikasi user)", () => {
    it("wajib login", async () => {
      expect((await appCall(null, "GET", "")).status).toBe(401);
      expect((await appCall(null, "GET", "/unread-count")).status).toBe(401);
      expect((await appCall(null, "POST", "/seen")).status).toBe(401);
    });

    it("hanya yang aktif untuk USERS/ALL; terbaru di atas; arsip, kedaluwarsa, dan DRIVERS tidak tampil", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const member = await user("USER");
      const base = { createdBy: vip.id };
      const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
      await prisma.announcement.createMany({
        data: [
          { ...base, title: "Lama", body: "Isi", publishedAt: hoursAgo(5) },
          { ...base, title: "Baru", body: "Isi", publishedAt: hoursAgo(1) },
          { ...base, title: "Untuk semua", body: "Isi", audience: "ALL", publishedAt: hoursAgo(3) },
          { ...base, title: "Arsip", body: "Isi", publishedAt: hoursAgo(2), archivedAt: new Date(), archivedBy: vip.id },
          { ...base, title: "Kedaluwarsa", body: "Isi", publishedAt: hoursAgo(4), expiresAt: hoursAgo(1) },
          { ...base, title: "Khusus driver", body: "Isi", audience: "DRIVERS", publishedAt: hoursAgo(2) },
          { ...base, title: "Terjadwal nanti", body: "Isi", publishedAt: new Date(Date.now() + 3600_000) }
        ]
      });
      const res = await json(await appCall(member, "GET", ""));
      expect(res.data.items.map((item: any) => item.title)).toEqual(["Baru", "Untuk semua", "Lama"]);
      expect(res.data.unreadCount).toBe(3);
      expect(Object.keys(res.data.items[0]).sort()).toEqual(["body", "id", "publishedAt", "title", "unread"]);
    });

    it("penanda belum dibaca: bertambah saat terbit baru, nol setelah dibuka, per pengguna", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const alice = await user("USER");
      const bob = await user("USER");
      await publish(vip, { title: "Satu", body: "Isi satu." });
      await publish(vip, { title: "Dua", body: "Isi dua." });
      expect((await json(await appCall(alice, "GET", "/unread-count"))).data.unreadCount).toBe(2);

      expect((await appCall(alice, "POST", "/seen")).status).toBe(204);
      expect((await json(await appCall(alice, "GET", "/unread-count"))).data.unreadCount).toBe(0);
      const afterSeen = (await json(await appCall(alice, "GET", ""))).data;
      expect(afterSeen.unreadCount).toBe(0);
      expect(afterSeen.items.every((item: any) => item.unread === false)).toBe(true);
      // Bob belum membuka: tidak terpengaruh.
      expect((await json(await appCall(bob, "GET", "/unread-count"))).data.unreadCount).toBe(2);

      await new Promise((resolve) => setTimeout(resolve, 15));
      await publish(vip, { title: "Tiga", body: "Isi tiga." });
      const next = (await json(await appCall(alice, "GET", ""))).data;
      expect(next.unreadCount).toBe(1);
      expect(next.items.find((item: any) => item.title === "Tiga").unread).toBe(true);
      expect(next.items.find((item: any) => item.title === "Satu").unread).toBe(false);
      expect((await json(await appCall(alice, "GET", "/unread-count"))).data.unreadCount).toBe(1);
    });

    it("pengumuman yang diarsipkan langsung hilang dari daftar dan hitungan pengguna", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const member = await user("USER");
      const id = (await json(await publish(vip, valid))).data.id as string;
      expect((await json(await appCall(member, "GET", "/unread-count"))).data.unreadCount).toBe(1);
      await adminCall(vip, "POST", `/announcements/${id}/archive`);
      expect((await json(await appCall(member, "GET", ""))).data.items).toEqual([]);
      expect((await json(await appCall(member, "GET", "/unread-count"))).data.unreadCount).toBe(0);
    });

    it("tidak boleh di-cache dan tidak membocorkan data pembuat", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const member = await user("USER");
      await publish(vip, valid);
      const res = await appCall(member, "GET", "");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(vip.id);
      expect(text).not.toContain(vip.fullName);
      expect(text).not.toContain(vip.phone);
    });

    it("menghapus akun ikut menghapus penanda dibaca (tanpa sisa data)", async () => {
      const vip = await user("SUPER_ADMIN_VIP");
      const member = await user("USER");
      await publish(vip, valid);
      await appCall(member, "POST", "/seen");
      expect(await prisma.announcementSeen.count({ where: { userId: member.id } })).toBe(1);
      await prisma.user.delete({ where: { id: member.id } });
      expect(await prisma.announcementSeen.count({ where: { userId: member.id } })).toBe(0);
    });
  });
});
