import { Prisma, PrismaClient } from "@prisma/client";
import { phoneLookupVariants } from "../../../core/security/phone.js";
import { bucketSelect, debitData, sameBucketsWhere } from "../../wallets/application/walletDebit.js";
import { planDebit } from "../../wallets/domain/walletBuckets.js";

/**
 * Pembalikan SATU pesanan membership yang ditandai lunas manual tanpa bukti (kasus 13 Nov 2026: Platinum Rp5.500.000
 * ditandai lunas oleh admin padahal tidak pernah dibayar).
 *
 * Yang dibalik (bila pesanan memang lunas-manual-tanpa-bukti):
 *   1. keanggotaan pembeli kembali ke tingkat sebelumnya (Basic), pesanan/invoice/pembayaran dibatalkan;
 *   2. benefit Saldo PPOB yang dikreditkan ke pembeli;
 *   3. bonus sponsor dan level HANYA untuk penerima yang dipilih (nomor HP); penerima lain dilaporkan, tidak disentuh.
 *
 * Aturan keselamatan:
 *   - SIMULASI bawaan; perubahan hanya dengan apply=true.
 *   - Menolak pesanan yang BUKAN lunas-manual-tanpa-bukti (lunas lewat penyedia, atau VIP sudah mengisi bukti).
 *   - Idempoten: pesanan yang sudah dibalik ditandai di audit dan tidak dibalik dua kali.
 *   - Saldo tidak pernah menjadi negatif: bonus yang sudah terpakai/ditarik hanya dibalik sebatas saldo yang ada, sisanya dicatat
 *     sebagai kekurangan (tidak ditagih).
 *   - Satu transaksi basis data; pembukuan berupa baris ADJUSTMENT yang dapat diaudit, bukan penghapusan.
 */

export type ReversalOptions = {
  invoiceNumber: string;
  /** Nomor HP penerima bonus yang dibalik. Kosong = tidak ada bonus yang dibalik (hanya keanggotaan dan benefit PPOB pembeli). */
  beneficiaryPhones: string[];
  apply: boolean;
};

export type ReversalCommissionRow = {
  commissionId: string;
  type: string;
  amount: string;
  beneficiaryName: string;
  beneficiaryPhone: string;
  selected: boolean;
  walletBalance: string;
  willReverse: string;
  shortfall: string;
  openWithdrawals: number;
};

export type ReversalReport = {
  applied: boolean;
  alreadyReversed: boolean;
  order: { id: string; status: string; totalAmount: string; packageName: string; buyerName: string; buyerPhone: string };
  confirmedBy: string | null;
  membership: { currentTier: string; restoreTo: string };
  ppob: { amount: string; willReverse: string };
  commissions: ReversalCommissionRow[];
};

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function reverseUnverifiedOrder(prisma: PrismaClient, options: ReversalOptions): Promise<ReversalReport> {
  const selectedPhones = new Set(options.beneficiaryPhones.flatMap((p) => phoneLookupVariants(p)));

  return prisma.$transaction(
    async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { number: options.invoiceNumber } });
      if (!invoice) throw new Error(`Invoice ${options.invoiceNumber} tidak ditemukan.`);
      const order = await tx.membershipOrder.findUnique({
        where: { id: invoice.orderId },
        include: { user: true, membership: true, payments: { orderBy: { createdAt: "desc" } } }
      });
      if (!order) throw new Error("Pesanan tidak ditemukan.");

      const payment = order.payments[0];
      const reference = payment?.providerReference ?? "";
      const meta = payment?.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata) ? (payment.metadata as Record<string, unknown>) : {};
      const alreadyReversed = (await tx.auditLog.count({ where: { action: "UNVERIFIED_ORDER_REVERSED", entityId: order.id } })) > 0;
      if (!alreadyReversed) {
        if (!reference.startsWith("ADMIN-")) {
          throw new Error("Pesanan ini TIDAK ditandai lunas manual oleh admin (pembayaran lewat penyedia atau jalur lain). Tidak dibalik.");
        }
        if (typeof meta.manualEvidence === "string" && meta.manualEvidence.length > 0) {
          throw new Error("Pesanan ini dikonfirmasi manual DENGAN bukti dari VIP. Tidak dibalik oleh skrip ini.");
        }
      }
      const confirmer = reference.startsWith("ADMIN-")
        ? await tx.user.findUnique({ where: { id: reference.slice("ADMIN-".length) }, select: { fullName: true } })
        : null;

      // Keanggotaan sebelumnya (yang kadaluarsa karena pesanan ini) atau Basic.
      const granted = await tx.userMembership.findUnique({ where: { orderId: order.id } });
      const expiredByThis = (
        await tx.userMembership.findMany({ where: { userId: order.userId, status: "EXPIRED" }, include: { membership: true }, orderBy: { activeAt: "desc" } })
      ).find((m) => (m.metadata as { upgradedToOrderId?: string } | null)?.upgradedToOrderId === order.id);
      const basic = await tx.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
      const restore = expiredByThis?.membership ?? basic;

      // Benefit PPOB pembeli
      const ppobCredit = await tx.walletTransaction.findFirst({ where: { type: "PPOB_BENEFIT", referenceType: "MEMBERSHIP_ORDER", referenceId: order.id } });
      const buyerWallet = await tx.wallet.findUnique({ where: { userId: order.userId } });
      const ppobAmount = ppobCredit?.amount ?? D(0);
      const ppobReverse = buyerWallet ? Prisma.Decimal.min(ppobAmount, buyerWallet.ppobBalance) : D(0);

      // Bonus sponsor dan level
      const commissions = await tx.commission.findMany({
        where: { triggerType: "MEMBERSHIP_ORDER", triggerId: order.id },
        include: { beneficiary: { select: { fullName: true, phone: true } } },
        orderBy: { createdAt: "asc" }
      });
      const rows: ReversalCommissionRow[] = [];
      const plans: Array<{ commissionId: string; amount: Prisma.Decimal; reverse: Prisma.Decimal; walletId: string }> = [];
      // Satu penerima bisa mendapat dua bonus dari satu pesanan (sponsor dan level): saldo yang tersisa dihitung berurutan,
      // supaya jumlah yang dibalik tidak pernah melebihi saldo.
      const remaining = new Map<string, Prisma.Decimal>();
      for (const c of commissions) {
        const wallet = await tx.wallet.findUnique({ where: { userId: c.beneficiaryId }, select: { ...bucketSelect, userId: true } });
        const selected = selectedPhones.has(c.beneficiary.phone);
        const reversible = c.status === "POSTED" && selected && !!wallet;
        const left = wallet ? (remaining.get(wallet.id) ?? wallet.balance) : D(0);
        const reverse = reversible && wallet ? Prisma.Decimal.min(c.amount, left) : D(0);
        if (reversible && wallet) remaining.set(wallet.id, left.minus(reverse));
        const openWithdrawals = await tx.withdrawal.count({ where: { userId: c.beneficiaryId, status: { in: ["PENDING", "APPROVED"] } } });
        rows.push({
          commissionId: c.id,
          type: c.type,
          amount: c.amount.toFixed(0),
          beneficiaryName: c.beneficiary.fullName,
          beneficiaryPhone: c.beneficiary.phone,
          selected,
          walletBalance: wallet ? left.plus(reversible ? reverse : D(0)).toFixed(0) : "0",
          willReverse: reverse.toFixed(0),
          shortfall: reversible ? c.amount.minus(reverse).toFixed(0) : "0",
          openWithdrawals
        });
        if (reversible && wallet) plans.push({ commissionId: c.id, amount: c.amount, reverse, walletId: wallet.id });
      }

      const report: ReversalReport = {
        applied: false,
        alreadyReversed,
        order: {
          id: order.id,
          status: order.status,
          totalAmount: order.totalAmount.toFixed(0),
          packageName: order.membership.name,
          buyerName: order.user.fullName,
          buyerPhone: order.user.phone
        },
        confirmedBy: confirmer?.fullName ?? null,
        membership: { currentTier: order.membership.tier, restoreTo: restore.tier },
        ppob: { amount: ppobAmount.toFixed(0), willReverse: ppobReverse.toFixed(0) },
        commissions: rows
      };
      if (alreadyReversed || !options.apply) return report;

      // ---- Terapkan ----
      if (granted) {
        await tx.userMembership.update({
          where: { id: granted.id },
          data: { status: "CANCELLED", expiresAt: new Date(), metadata: { ...((granted.metadata as object | null) ?? {}), reversedAsUnverified: true } }
        });
      }
      const newerActive = await tx.userMembership.count({ where: { userId: order.userId, status: "ACTIVE", orderId: { not: order.id } } });
      if (expiredByThis && newerActive === 0) {
        await tx.userMembership.update({ where: { id: expiredByThis.id }, data: { status: "ACTIVE", expiresAt: null } });
      }
      if (order.user.membershipId === order.membershipId) {
        await tx.user.update({ where: { id: order.userId }, data: { membershipId: restore.id } });
      }
      await tx.membershipOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
      if (payment) {
        await tx.membershipPayment.update({ where: { id: payment.id }, data: { status: "CANCELLED", metadata: { ...meta, reversedUnverified: true } } });
      }

      if (buyerWallet && ppobReverse.gt(0)) {
        const cleared = await tx.wallet.updateMany({ where: { id: buyerWallet.id, ppobBalance: buyerWallet.ppobBalance }, data: { ppobBalance: { decrement: ppobReverse } } });
        if (cleared.count !== 1) throw new Error("Saldo PPOB pembeli berubah saat diproses. Ulangi.");
        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            type: "ADJUSTMENT",
            amount: ppobReverse.neg(),
            referenceType: "UNVERIFIED_ORDER_REVERSAL",
            referenceId: `${order.id}:ppob`,
            metadata: { kind: "PPOB_BENEFIT_REVERSED", orderId: order.id }
          }
        });
      }

      for (const plan of plans) {
        if (plan.reverse.gt(0)) {
          const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: plan.walletId }, select: bucketSelect });
          const actual = Prisma.Decimal.min(plan.reverse, wallet.balance); // pembaruan terbaru: tidak pernah lebih dari saldo
          const debit = planDebit(wallet, actual, "CASH_FIRST");
          const moved = await tx.wallet.updateMany({ where: sameBucketsWhere(wallet), data: debitData(debit) });
          if (moved.count !== 1) throw new Error("Saldo penerima bonus berubah saat diproses. Ulangi.");
          plan.reverse = actual;
          await tx.walletTransaction.create({
            data: {
              walletId: plan.walletId,
              type: "ADJUSTMENT",
              amount: actual.neg(),
              referenceType: "UNVERIFIED_ORDER_REVERSAL",
              referenceId: plan.commissionId,
              metadata: { kind: "COMMISSION_REVERSED", orderId: order.id, shortfall: plan.amount.minus(actual).toString() }
            }
          });
        }
        await tx.commission.update({ where: { id: plan.commissionId }, data: { status: "REVERSED" } });
      }

      await tx.auditLog.create({
        data: {
          actorId: null,
          action: "UNVERIFIED_ORDER_REVERSED",
          entityType: "MEMBERSHIP_ORDER",
          entityId: order.id,
          metadata: {
            invoice: options.invoiceNumber,
            restoredTier: restore.tier,
            ppobReversed: ppobReverse.toString(),
            commissionsReversed: plans.map((p) => ({ id: p.commissionId, reversed: p.reverse.toString(), shortfall: p.amount.minus(p.reverse).toString() }))
          }
        }
      });
      return { ...report, applied: true };
    },
    { timeout: 30_000 }
  );
}
