import { describe, expect, it, vi } from "vitest";
import { SmtpOtpProvider } from "../../src/modules/auth/infrastructure/SmtpOtpProvider.js";

/**
 * Test unit SmtpOtpProvider (keputusan Owner G3).
 *
 * Transporter SMTP disuntik sebagai stub — tidak ada jaringan, dan perilaku
 * yang diuji adalah kontrak provider: kanal yang didukung, isi email, dan
 * kebocoran informasi yang dilarang.
 */
function makeTransporter() {
  const sendMail = vi.fn(async (_mail: unknown) => ({ messageId: "<msg-1@tapgo.test>" }));
  return { sendMail };
}

function lastMail(sendMail: ReturnType<typeof makeTransporter>["sendMail"]) {
  return sendMail.mock.calls[0]?.[0] as {
    from: string;
    to: string;
    subject: string;
    text: string;
  };
}

function makeRequest(overrides: Partial<Parameters<SmtpOtpProvider["send"]>[0]> = {}) {
  return {
    channel: "EMAIL" as const,
    destination: "member@example.com",
    code: "482913",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    purpose: "PASSWORD_RECOVERY" as const,
    ...overrides
  };
}

describe("SmtpOtpProvider (unit)", () => {
  it("hanya mendukung kanal EMAIL, bukan PHONE", () => {
    const provider = new SmtpOtpProvider(makeTransporter() as never, "TapGo <no-reply@tapgolion.id>");
    expect(provider.supports("EMAIL")).toBe(true);
    expect(provider.supports("PHONE")).toBe(false);
  });

  it("mengirim email berisi kode ke tujuan dan mengembalikan referensi provider", async () => {
    const transporter = makeTransporter();
    const provider = new SmtpOtpProvider(transporter as never, "TapGo <no-reply@tapgolion.id>");

    const result = await provider.send(makeRequest());

    expect(result.providerReference).toBe("<msg-1@tapgo.test>");
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const mail = lastMail(transporter.sendMail);
    expect(mail.from).toBe("TapGo <no-reply@tapgolion.id>");
    expect(mail.to).toBe("member@example.com");
    expect(mail.subject).toContain("Pemulihan");
    expect(mail.text).toContain("482913");
    expect(mail.text).toContain("10 menit");
  });

  it("memakai subjek verifikasi untuk purpose selain recovery", async () => {
    const transporter = makeTransporter();
    const provider = new SmtpOtpProvider(transporter as never, "TapGo <no-reply@tapgolion.id>");

    await provider.send(makeRequest({ purpose: "EMAIL_VERIFICATION" }));

    expect(lastMail(transporter.sendMail).subject).toContain("Verifikasi");
  });

  it("kegagalan SMTP dilempar apa adanya tanpa mencatat kode/tujuan", async () => {
    const transporter = {
      sendMail: vi.fn(async () => {
        throw new Error("connection refused");
      })
    };
    const provider = new SmtpOtpProvider(transporter as never, "TapGo <no-reply@tapgolion.id>");

    await expect(provider.send(makeRequest())).rejects.toThrow("connection refused");
  });
});
