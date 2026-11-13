import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  WalletBuckets,
  assertInvariant,
  bonusCreditData,
  creditData,
  debitData,
  otherBalance,
  planDebit,
  plansFromJson,
  plansToJson,
  splitBonus,
  sumOf,
} from "../../src/modules/wallets/domain/walletBuckets.js";

const D = (value: number | string) => new Prisma.Decimal(value);
const wallet = (balance: number, cash: number, locked: number, deposit: number): WalletBuckets => ({
  balance: D(balance),
  cashBalance: D(cash),
  lockedBonusBalance: D(locked),
  depositBalance: D(deposit),
});

describe("splitBonus", () => {
  it("20% dikunci, 80% dapat ditarik", () => {
    const { cash, locked } = splitBonus(D(100000), { enabled: true, percent: 20 });
    expect(cash.toString()).toBe("80000");
    expect(locked.toString()).toBe("20000");
  });

  it("pembulatan ke bawah untuk bagian terkunci, jumlahnya tetap persis sama dengan bonus", () => {
    const { cash, locked } = splitBonus(D(12345), { enabled: true, percent: 20 });
    expect(locked.toString()).toBe("2469"); // 2469,0 -> dibulatkan ke bawah
    expect(cash.plus(locked).toString()).toBe("12345");
    const odd = splitBonus(D(7), { enabled: true, percent: 20 }); // 1,4 -> 1
    expect(odd.locked.toString()).toBe("1");
    expect(odd.cash.toString()).toBe("6");
    const tiny = splitBonus(D(4), { enabled: true, percent: 20 }); // 0,8 -> 0
    expect(tiny.locked.toString()).toBe("0");
    expect(tiny.cash.toString()).toBe("4");
  });

  it("mati, persen 0, atau jumlah tidak positif: seluruhnya dapat ditarik (perilaku lama)", () => {
    expect(splitBonus(D(50000), { enabled: false, percent: 20 }).locked.toString()).toBe("0");
    expect(splitBonus(D(50000), { enabled: true, percent: 0 }).locked.toString()).toBe("0");
    expect(splitBonus(D(0), { enabled: true, percent: 20 }).locked.toString()).toBe("0");
  });

  it("persen 100 mengunci semuanya dan persen di atas 100 dibatasi", () => {
    expect(splitBonus(D(1000), { enabled: true, percent: 100 }).cash.toString()).toBe("0");
    expect(splitBonus(D(1000), { enabled: true, percent: 250 }).locked.toString()).toBe("1000");
  });

  it("selalu menjumlah persis, untuk 5000 jumlah acak termasuk pecahan sen", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 5000; i++) {
      const amount = D((rnd() * 5_000_000).toFixed(2));
      const { cash, locked } = splitBonus(amount, { enabled: true, percent: 20 });
      expect(cash.plus(locked).equals(amount)).toBe(true);
      expect(locked.gte(0) && cash.gte(0)).toBe(true);
      expect(locked.lte(amount.times(0.2))).toBe(true);
      expect(locked.equals(locked.toDecimalPlaces(0))).toBe(true);
    }
  });
});

describe("planDebit", () => {
  // balance 1000 = cash 300 + locked 200 + deposit 250 + lain-lain 250
  const w = wallet(1000, 300, 200, 250);

  it("lain-lain dulu, lalu terkunci, lalu deposit, lalu dapat ditarik", () => {
    expect(otherBalance(w).toString()).toBe("250");
    const a = planDebit(w, D(100));
    expect([a.other, a.locked, a.deposit, a.cash].map(String)).toEqual(["100", "0", "0", "0"]);
    const b = planDebit(w, D(400));
    expect([b.other, b.locked, b.deposit, b.cash].map(String)).toEqual(["250", "150", "0", "0"]);
    const c = planDebit(w, D(800));
    expect([c.other, c.locked, c.deposit, c.cash].map(String)).toEqual(["250", "200", "250", "100"]);
    const all = planDebit(w, D(1000));
    expect([all.other, all.locked, all.deposit, all.cash].map(String)).toEqual(["250", "200", "250", "300"]);
  });

  it("CASH_FIRST (komisi tunai): dapat ditarik dulu, lalu lain-lain, terkunci, deposit", () => {
    const a = planDebit(w, D(100), "CASH_FIRST");
    expect([a.other, a.locked, a.deposit, a.cash].map(String)).toEqual(["0", "0", "0", "100"]);
    const b = planDebit(w, D(700), "CASH_FIRST");
    expect([b.other, b.locked, b.deposit, b.cash].map(String)).toEqual(["250", "150", "0", "300"]);
  });

  it("tanpa kantong baru (bendera mati) sama persis dengan aturan lama: non-tarik dulu, tarik terakhir", () => {
    const old = wallet(1000, 600, 0, 0); // non-tarik 400
    const p = planDebit(old, D(500));
    expect(p.other.toString()).toBe("400");
    expect(p.cash.toString()).toBe("100");
    expect(p.locked.toString()).toBe("0");
    expect(p.deposit.toString()).toBe("0");
    const c = planDebit(old, D(50), "CASH_FIRST");
    expect(c.cash.toString()).toBe("50"); // komisi lama: fromCash = min(fee, cashBalance)
    expect(c.other.toString()).toBe("0");
  });

  it("menolak jumlah melebihi saldo atau negatif; nol menghasilkan rencana kosong", () => {
    expect(() => planDebit(w, D(1000.01))).toThrow();
    expect(() => planDebit(w, D(-1))).toThrow();
    expect(sumOf(planDebit(w, D(0))).toString()).toBe("0");
  });

  it("menolak dompet yang melanggar invarian", () => {
    expect(() => assertInvariant(wallet(100, 80, 30, 0))).toThrow(); // 110 > 100
    expect(() => assertInvariant(wallet(100, -1, 0, 0))).toThrow();
    expect(() => assertInvariant(wallet(100, 40, 30, 30))).not.toThrow(); // tepat 100
  });

  it("5000 dompet dan pengurangan acak: jumlah persis, tidak ada kantong negatif, invarian terjaga", () => {
    let seed = 987654321;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 5000; i++) {
      const cash = Math.floor(rnd() * 500000);
      const locked = Math.floor(rnd() * 200000);
      const deposit = Math.floor(rnd() * 300000);
      const other = Math.floor(rnd() * 100000);
      const state = wallet(cash + locked + deposit + other, cash, locked, deposit);
      const amount = D(Math.floor(rnd() * Number(state.balance) + 1) % (Number(state.balance) + 1));
      for (const order of ["NON_CASH_FIRST", "CASH_FIRST"] as const) {
        const plan = planDebit(state, amount, order);
        expect(sumOf(plan).equals(amount)).toBe(true);
        expect(plan.other.lte(otherBalance(state))).toBe(true);
        expect(plan.locked.lte(state.lockedBonusBalance)).toBe(true);
        expect(plan.deposit.lte(state.depositBalance)).toBe(true);
        expect(plan.cash.lte(state.cashBalance)).toBe(true);
        const after: WalletBuckets = {
          balance: state.balance.minus(amount),
          cashBalance: state.cashBalance.minus(plan.cash),
          lockedBonusBalance: state.lockedBonusBalance.minus(plan.locked),
          depositBalance: state.depositBalance.minus(plan.deposit),
        };
        assertInvariant(after);
        // Pembalikan dengan rencana yang sama memulihkan dompet persis.
        const restored = {
          balance: after.balance.plus(sumOf(plan)),
          cashBalance: after.cashBalance.plus(plan.cash),
          lockedBonusBalance: after.lockedBonusBalance.plus(plan.locked),
          depositBalance: after.depositBalance.plus(plan.deposit),
        };
        expect(restored.balance.equals(state.balance)).toBe(true);
        expect(restored.cashBalance.equals(state.cashBalance)).toBe(true);
        expect(restored.lockedBonusBalance.equals(state.lockedBonusBalance)).toBe(true);
        expect(restored.depositBalance.equals(state.depositBalance)).toBe(true);
      }
    }
  });
});

describe("kolom Prisma dan penyimpanan rencana", () => {
  it("debitData dan creditData mencerminkan rencana", () => {
    const plan = planDebit(wallet(1000, 300, 200, 250), D(400));
    expect(debitData(plan)).toEqual({
      balance: { decrement: D(400) },
      cashBalance: { decrement: D(0) },
      lockedBonusBalance: { decrement: D(150) },
      depositBalance: { decrement: D(0) },
    });
    expect(creditData(plan).lockedBonusBalance.increment.toString()).toBe("150");
  });

  it("bonusCreditData: balance bertambah penuh, terpecah ke cash dan locked", () => {
    const data = bonusCreditData(splitBonus(D(100000), { enabled: true, percent: 20 }));
    expect(data.balance.increment.toString()).toBe("100000");
    expect(data.cashBalance.increment.toString()).toBe("80000");
    expect(data.lockedBonusBalance?.increment.toString()).toBe("20000");
    // Tanpa bagian terkunci, kolom itu tidak disentuh sama sekali (pembaruan identik dengan perilaku lama).
    expect(bonusCreditData(splitBonus(D(100000), { enabled: false, percent: 20 }))).toEqual({
      balance: { increment: D(100000) },
      cashBalance: { increment: D(100000) },
    });
  });

  it("rencana dapat disimpan dan dibaca kembali; data rusak atau lama menghasilkan null", () => {
    const plan = planDebit(wallet(1000, 300, 200, 250), D(800));
    const back = plansFromJson(plansToJson(plan));
    expect(back).not.toBeNull();
    expect(sumOf(back!).equals(D(800))).toBe(true);
    expect(plansFromJson(null)).toBeNull();
    expect(plansFromJson("x")).toBeNull();
    expect(plansFromJson({ other: "abc" })).toBeNull();
    expect(plansFromJson({ other: "-5" })).toBeNull();
  });
});
