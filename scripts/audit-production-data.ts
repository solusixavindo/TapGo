import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env.production") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env") });
dotenv.config();

const prisma = new PrismaClient();
const outputPath = path.resolve(process.cwd(), "PRODUCTION_DATA_AUDIT_REPORT.md");

const knownUatPhones = new Set(["080000000001", "080000000002", "080000000003"]);
const dummyMarkers = [
  "uat",
  "test",
  "tester",
  "demo",
  "dummy",
  "sample",
  "kiki",
  "dadan",
  "caca",
  "joni",
  "fatmala",
  "gemb",
  "marica"
];

function maskPhone(phone: string | null | undefined) {
  if (!phone) return "-";
  if (phone.length <= 6) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function maskEmail(email: string | null | undefined) {
  if (!email) return "-";
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function money(value: unknown) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function count(value: unknown) {
  return Number(value ?? 0).toLocaleString("id-ID");
}

function hasDummyMarker(...values: Array<string | null | undefined>) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  return dummyMarkers.some((marker) => text.includes(marker));
}

function reportTable(headers: string[], rows: string[][]) {
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.length
    ? rows.map((row) => `| ${row.join(" | ")} |`).join("\n")
    : `| ${headers.map(() => "-").join(" | ")} |`;
  return [header, divider, body].join("\n");
}

async function safe<T>(label: string, query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await query();
  } catch (error) {
    console.warn(`[WARN] ${label} failed:`, error instanceof Error ? error.message : error);
    return fallback;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Point it to production only for read-only audit.");
  }

  const [
    usersTotal,
    usersByRole,
    usersByStatus,
    memberships,
    walletsTotal,
    walletSums,
    walletTransactionByType,
    ordersByStatus,
    invoicesByStatus,
    paymentsByStatus,
    referralsTotal,
    referralLevelsTotal,
    commissionsByTypeStatus,
    rewardByStatus,
    withdrawalsByStatus,
    profitPeriodsByStatus,
    profitDistributionsByStatus,
    contactByStatus,
    deletionByStatus,
    auditLogsTotal,
    candidates,
    pendingOldOrders,
    pendingOldInvoices
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.membership.findMany({
      orderBy: { price: "asc" },
      select: {
        tier: true,
        name: true,
        price: true,
        ppobBalance: true,
        bpjsBenefit: true,
        merchandise: true,
        isActive: true
      }
    }),
    prisma.wallet.count(),
    prisma.wallet.aggregate({
      _sum: { balance: true, cashBalance: true, ppobBalance: true }
    }),
    prisma.walletTransaction.groupBy({
      by: ["type"],
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { type: "asc" }
    }),
    prisma.membershipOrder.groupBy({ by: ["status"], _count: { _all: true }, _sum: { totalAmount: true } }),
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.membershipPayment.groupBy({ by: ["status", "provider", "method"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.referral.count(),
    prisma.referralLevel.count(),
    prisma.commission.groupBy({ by: ["type", "status"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.rewardTransaction.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.withdrawal.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true, finalAmount: true } }),
    prisma.profitSharingPeriod.groupBy({ by: ["status"], _count: { _all: true }, _sum: { netProfitAmount: true, totalPoolAmount: true } }),
    prisma.profitSharingDistribution.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.contactMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.accountDeletionRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.auditLog.count(),
    prisma.user.findMany({
      where: {
        OR: [
          { phone: { in: [...knownUatPhones] } },
          { fullName: { contains: "uat", mode: "insensitive" } },
          { fullName: { contains: "test", mode: "insensitive" } },
          { fullName: { contains: "demo", mode: "insensitive" } },
          { email: { contains: "test", mode: "insensitive" } },
          { email: { contains: "demo", mode: "insensitive" } },
          { referralCode: { contains: "UAT", mode: "insensitive" } },
          { referralCode: { contains: "TEST", mode: "insensitive" } }
        ]
      },
      take: 200,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        referralCode: true,
        createdAt: true
      }
    }),
    prisma.membershipOrder.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) }
      },
      take: 50,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        user: { select: { fullName: true, phone: true } },
        membership: { select: { tier: true } }
      }
    }),
    prisma.invoice.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) }
      },
      take: 50,
      orderBy: { createdAt: "asc" },
      select: {
        number: true,
        status: true,
        amount: true,
        createdAt: true,
        user: { select: { fullName: true, phone: true } }
      }
    })
  ]);

  const migrations = await safe(
    "migration count",
    () => prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 20
    `,
    []
  );

  const manualCandidates = candidates.map((user) => {
    const reasons = [];
    if (knownUatPhones.has(user.phone)) reasons.push("known UAT credential");
    if (hasDummyMarker(user.fullName, user.email, user.referralCode)) reasons.push("dummy/test marker");
    return {
      ...user,
      reasons: reasons.length ? reasons.join(", ") : "manual review"
    };
  });

  const generatedAt = new Date().toISOString();
  const dbHost = process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@").replace(/\?.*$/, "");

  const md = `# Production Data Audit Report

Generated at: ${generatedAt}

Database URL checked: \`${dbHost}\`

Mode: READ ONLY. Script ini hanya menjalankan query \`findMany\`, \`count\`, \`aggregate\`, \`groupBy\`, dan baca tabel migration. Tidak ada \`create\`, \`update\`, \`delete\`, \`upsert\`, \`truncate\`, atau raw write.

## Executive Summary

- Total users: ${count(usersTotal)}
- Total wallets: ${count(walletsTotal)}
- Wallet cash liability: ${money(walletSums._sum.cashBalance)}
- Wallet PPOB liability: ${money(walletSums._sum.ppobBalance)}
- Backward-compatible wallet balance: ${money(walletSums._sum.balance)}
- Referrals: ${count(referralsTotal)}
- Referral level links: ${count(referralLevelsTotal)}
- Audit logs: ${count(auditLogsTotal)}
- Candidate UAT/dummy/test users found: ${count(manualCandidates.length)}

## Users by Role

${reportTable(["Role", "Count"], usersByRole.map((item) => [item.role, count(item._count._all)]))}

## Users by Status

${reportTable(["Status", "Count"], usersByStatus.map((item) => [item.status, count(item._count._all)]))}

## Membership Packages

${reportTable(
  ["Tier", "Name", "Price", "PPOB Benefit", "BPJS", "Merchandise", "Active"],
  memberships.map((item) => [
    item.tier,
    item.name,
    money(item.price),
    money(item.ppobBalance),
    item.bpjsBenefit ?? "-",
    JSON.stringify(item.merchandise ?? []),
    String(item.isActive)
  ])
)}

## Wallet Transaction Ledger

${reportTable(
  ["Type", "Count", "Total Amount"],
  walletTransactionByType.map((item) => [item.type, count(item._count._all), money(item._sum.amount)])
)}

## Membership Orders

${reportTable(
  ["Status", "Count", "Total Amount"],
  ordersByStatus.map((item) => [item.status, count(item._count._all), money(item._sum.totalAmount)])
)}

## Invoices

${reportTable(
  ["Status", "Count", "Total Amount"],
  invoicesByStatus.map((item) => [item.status, count(item._count._all), money(item._sum.amount)])
)}

## Membership Payments

${reportTable(
  ["Status", "Provider", "Method", "Count", "Total Amount"],
  paymentsByStatus.map((item) => [
    item.status,
    item.provider ?? "-",
    item.method,
    count(item._count._all),
    money(item._sum.amount)
  ])
)}

## Commissions

${reportTable(
  ["Type", "Status", "Count", "Total Amount"],
  commissionsByTypeStatus.map((item) => [item.type, item.status, count(item._count._all), money(item._sum.amount)])
)}

## Rewards

${reportTable(
  ["Status", "Count", "Total Amount"],
  rewardByStatus.map((item) => [item.status, count(item._count._all), money(item._sum.amount)])
)}

## Withdrawals

${reportTable(
  ["Status", "Count", "Requested Amount", "Final Amount"],
  withdrawalsByStatus.map((item) => [
    item.status,
    count(item._count._all),
    money(item._sum.amount),
    money(item._sum.finalAmount)
  ])
)}

## Profit Sharing

### Periods

${reportTable(
  ["Status", "Count", "Net Profit", "Pool"],
  profitPeriodsByStatus.map((item) => [
    item.status,
    count(item._count._all),
    money(item._sum.netProfitAmount),
    money(item._sum.totalPoolAmount)
  ])
)}

### Distributions

${reportTable(
  ["Status", "Count", "Total Amount"],
  profitDistributionsByStatus.map((item) => [item.status, count(item._count._all), money(item._sum.amount)])
)}

## Support and Compliance Data

${reportTable(["Area", "Status", "Count"], [
  ...contactByStatus.map((item) => ["Contact Messages", item.status, count(item._count._all)]),
  ...deletionByStatus.map((item) => ["Delete Account Requests", item.status, count(item._count._all)])
])}

## Prisma Migrations Latest 20

${reportTable(
  ["Migration", "Finished At"],
  migrations.map((item) => [item.migration_name, item.finished_at?.toISOString() ?? "-"])
)}

## Candidate UAT / Dummy / Tester Users

${reportTable(
  ["User ID", "Name", "Phone", "Email", "Role", "Status", "Referral Code", "Reason"],
  manualCandidates.map((user) => [
    user.id,
    user.fullName,
    maskPhone(user.phone),
    maskEmail(user.email),
    user.role,
    user.status,
    user.referralCode,
    user.reasons
  ])
)}

## Old Pending Membership Orders (> 7 Days)

${reportTable(
  ["Order ID", "User", "Phone", "Tier", "Status", "Amount", "Created At"],
  pendingOldOrders.map((order) => [
    order.id,
    order.user.fullName,
    maskPhone(order.user.phone),
    order.membership.tier,
    order.status,
    money(order.totalAmount),
    order.createdAt.toISOString()
  ])
)}

## Old Pending Invoices (> 7 Days)

${reportTable(
  ["Invoice", "User", "Phone", "Status", "Amount", "Created At"],
  pendingOldInvoices.map((invoice) => [
    invoice.number,
    invoice.user.fullName,
    maskPhone(invoice.user.phone),
    invoice.status,
    money(invoice.amount),
    invoice.createdAt.toISOString()
  ])
)}

## Classification

### KEEP

- Admin dan Super Admin production yang aktif dan masih dipakai operasional.
- Membership package Basic/Silver/Gold/Platinum.
- Data transaksi paid/posted/approved yang berhubungan dengan wallet, commission, reward, withdrawal, profit sharing, dan invoice.
- Audit log dan legal request.

### UAT / DUMMY / TESTER CANDIDATE

- Akun dengan nomor UAT resmi: \`080000000001\`, \`080000000002\`, \`080000000003\`.
- Akun yang mengandung marker nama/email/referral seperti UAT, test, demo, dummy, sample.
- Order/invoice pending lama yang berasal dari akun kandidat.

### REVIEW MANUAL

- Semua user real yang tidak mengandung marker UAT/dummy/test.
- Semua transaksi uang yang sudah paid/posted/approved.
- Reward/profit sharing yang sudah masuk siklus approval.

## Recommended Next Step

1. Review kandidat di tabel di atas.
2. Backup database production sebelum cleanup.
3. Jalankan \`npm --workspace apps/backend run cleanup:prelaunch -- --dry-run\`.
4. Jika sudah disetujui manual, jalankan cleanup dengan allowlist eksplisit. Jangan cleanup otomatis berdasarkan pattern saja.
`;

  await fs.writeFile(outputPath, md);
  console.log(`Production data audit report written to ${outputPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
