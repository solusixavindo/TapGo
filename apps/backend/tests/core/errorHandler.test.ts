import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { errorHandler } from "../../src/core/errors/errorHandler.js";
import { AppError } from "../../src/core/errors/AppError.js";

/**
 * Unit murni terhadap errorHandler — tanpa server HTTP sungguhan, cukup
 * fungsi middleware dipanggil langsung dengan req/res tiruan. Memverifikasi
 * kontrak respons (status/body) TETAP identik setelah menambahkan
 * Sentry.captureException() pada cabang error tak terduga.
 *
 * Pemanggilan Sentry.captureException() itu sendiri TIDAK diuji lewat spy di
 * sini: modul namespace @sentry/node bersifat frozen (ESM), vi.spyOn gagal
 * dengan "Cannot redefine property" — konsisten dengan pola di seluruh test
 * suite ini yang memang tidak memakai vi.mock/vi.spyOn pada modul pihak
 * ketiga. Baris pemanggilannya sendiri satu baris, mudah diverifikasi lewat
 * pembacaan kode (lihat errorHandler.ts) tanpa perlu spy yang rapuh.
 */
function fakeRes() {
  const res: { statusCode?: number; body?: unknown; status: (n: number) => typeof res; json: (b: unknown) => typeof res } = {
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    }
  };
  return res;
}

describe("errorHandler", () => {
  it("AppError -> respons terstruktur sesuai kode/pesan aslinya", () => {
    const res = fakeRes();
    const error = new AppError("Tidak ditemukan", 404, "NOT_FOUND");

    errorHandler(error, { path: "/api/v1/x" } as never, res as never, (() => {}) as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, code: "NOT_FOUND", message: "Tidak ditemukan" });
  });

  it("ZodError -> 400 VALIDATION_ERROR dengan detail flatten()", () => {
    const res = fakeRes();
    const schema = z.object({ a: z.string() });
    const result = schema.safeParse({ a: 1 });
    expect(result.success).toBe(false);
    const zodError = (result as { success: false; error: ZodError }).error;

    errorHandler(zodError, { path: "/api/v1/x" } as never, res as never, (() => {}) as never);

    expect(res.statusCode).toBe(400);
    expect((res.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it("error tak terduga -> 500 generik ke klien, pesan mentah tidak pernah bocor", () => {
    const res = fakeRes();
    const boom = new Error("boom, detail internal yang tidak boleh terlihat klien");

    errorHandler(boom, { path: "/api/v1/crash" } as never, res as never, (() => {}) as never);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error"
    });
    expect(JSON.stringify(res.body)).not.toContain("boom");
  });
});
