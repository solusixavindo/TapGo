import { Prisma, PrismaClient } from "@prisma/client";
import { ppobMarginConfig, ppobMarginStatus, ppobNetMargin, PpobKind } from "../../../core/finance/ppobMargin.js";
import { POSTPAID_CATEGORIES } from "../domain/ppobProvider.js";

/** Batas baris yang dipindai; di bawah angka ini seluruh transaksi sukses dalam rentang ikut terhitung. */
const ROW_CAP = 50_000;

export type MarginStatus = "LOSS" | "BELOW_TARGET" | "OK";

export function kindOfCategory(category: Parameters<typeof POSTPAID_CATEGORIES.has>[0]): PpobKind {
  return POSTPAID_CATEGORIES.has(category) ? "POSTPAID" : "PREPAID";
}

/** Untung bersih dan statusnya terhadap target, untuk satu transaksi sukses yang modalnya tercatat. */
export function assessPpobMargin(row: { totalAmount: Prisma.Decimal | number; providerCost: Prisma.Decimal | number; category: Parameters<typeof POSTPAID_CATEGORIES.has>[0] }) {
  const kind = kindOfCategory(row.category);
  const netMargin = ppobNetMargin({ salePrice: Number(row.totalAmount), cost: Number(row.providerCost), kind });
  return { kind, netMargin, status: ppobMarginStatus(netMargin, kind) as MarginStatus };
}

/**
 * Memindai transaksi PPOB SUKSES (yang modalnya tercatat) dan menghitung berapa yang rugi bersih atau di bawah target
 * untung bersih (Rp500 prabayar, Rp1.000 pascabayar; lihat ppobMargin.ts). Perhitungan dilakukan di aplikasi karena PPN
 * dan PPh memakai pengaturan lingkungan, bukan kolom basis data.
 */
export async function scanPpobMargins(prisma: PrismaClient, where: Prisma.PpobTransactionWhereInput, options: { collectIssueIds?: boolean } = {}) {
  const rows = await prisma.ppobTransaction.findMany({
    where: { ...where, status: "SUCCESS", providerCost: { not: null } },
    select: { id: true, totalAmount: true, providerCost: true, category: true },
    orderBy: { createdAt: "desc" },
    take: ROW_CAP
  });
  let loss = 0;
  let belowTarget = 0;
  let netTotal = 0;
  const issueIds: string[] = [];
  for (const row of rows) {
    const { netMargin, status } = assessPpobMargin({ totalAmount: row.totalAmount, providerCost: row.providerCost!, category: row.category });
    netTotal += netMargin;
    if (status === "LOSS") loss += 1;
    else if (status === "BELOW_TARGET") belowTarget += 1;
    if (status !== "OK" && options.collectIssueIds) issueIds.push(row.id);
  }
  const config = ppobMarginConfig();
  return {
    costedCount: rows.length,
    loss,
    belowTarget,
    netTotal: Math.round(netTotal),
    issueIds,
    targets: { prepaid: config.targetNetPrepaid, postpaid: config.targetNetPostpaid }
  };
}
