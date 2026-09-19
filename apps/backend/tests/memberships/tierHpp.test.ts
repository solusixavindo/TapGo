import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * HPP (harga pokok) per paket adalah dasar laporan laba rugi, dan angkanya
 * berasal dari keputusan klien. Berkas ini mengunci migrasi data agar rincian
 * komponen selalu berjumlah sama dengan total, dan total sama dengan keputusan.
 */

const SQL = readFileSync(
  new URL("../../prisma/migrations/20260919130000_platinum_benefits_and_hpp/migration.sql", import.meta.url),
  "utf8"
);

const EXPECTED_TOTAL: Record<string, number> = {
  SILVER: 190_000,
  GOLD: 1_230_000,
  PLATINUM: 1_870_000
};

function tierBlock(tier: string) {
  const start = SQL.indexOf(`WHERE "tier" = '${tier}'`);
  expect(start, tier).toBeGreaterThan(-1);
  const from = SQL.lastIndexOf("UPDATE", start);
  return SQL.slice(from, start);
}

describe("HPP paket membership", () => {
  for (const [tier, total] of Object.entries(EXPECTED_TOTAL)) {
    it(`${tier}: rincian komponen berjumlah Rp${total.toLocaleString("id-ID")}`, () => {
      const block = tierBlock(tier);
      const declared = Number(/"hpp_total" = (\d+)/.exec(block)?.[1]);
      const raw = /"hpp_breakdown" = '(\[[\s\S]*?\])'::jsonb/.exec(block)?.[1];
      expect(raw).toBeTruthy();
      const items = JSON.parse(raw!) as Array<{ cost: number }>;
      const sum = items.reduce((acc, item) => acc + item.cost, 0);

      expect(declared).toBe(total);
      expect(sum).toBe(total);
    });
  }

  it("Silver hanya kaos dan Gold/Platinum kaos, rompi, banner (tanpa jaket, topi, brosur, stiker)", () => {
    const merch = (tier: string) =>
      JSON.parse(/"merchandise" = '(\[[\s\S]*?\])'::jsonb/.exec(tierBlock(tier))![1]!) as string[];
    expect(merch("SILVER")).toEqual(["Kaos TAPGO"]);
    expect(merch("GOLD")).toEqual(["Kaos TAPGO", "Rompi TAPGO", "Banner TAPGO"]);
    expect(merch("PLATINUM")).toEqual(["Kaos TAPGO", "Rompi TAPGO", "Banner TAPGO"]);
  });

  it("saldo PPOB tiap paket sama dengan komponen PPOB pada HPP", () => {
    const expected: Record<string, number> = { SILVER: 100_000, GOLD: 600_000, PLATINUM: 1_000_000 };
    for (const [tier, ppob] of Object.entries(expected)) {
      const block = tierBlock(tier);
      expect(Number(/"ppob_balance" = (\d+)/.exec(block)![1])).toBe(ppob);
      const items = JSON.parse(/"hpp_breakdown" = '(\[[\s\S]*?\])'::jsonb/.exec(block)![1]!) as Array<{ name: string; cost: number }>;
      expect(items.find((item) => item.name === "Saldo PPOB")?.cost).toBe(ppob);
    }
  });
});
