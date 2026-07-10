import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env.production") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env") });
dotenv.config();

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const dryRun = !execute || args.has("--dry-run");
const outputPath = path.resolve(process.cwd(), "PRE_LAUNCH_DATA_CLEANUP_PLAN.md");

const knownUatPhones = ["080000000001", "080000000002", "080000000003"];
const confirmedOldTestNames = ["Dedi Ganteng", "Yeyen Bohay"];

function maskPhone(phone: string | null | undefined) {
  if (!phone) return "-";
  if (phone.length <= 6) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function reportTable(headers: string[], rows: string[][]) {
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.length
    ? rows.map((row) => `| ${row.join(" | ")} |`).join("\n")
    : `| ${headers.map(() => "-").join(" | ")} |`;
  return [header, divider, body].join("\n");
}

function parseAllowlist() {
  return (process.env.TAPGO_CLEANUP_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { phone: { in: knownUatPhones } },
        { fullName: { contains: "uat", mode: "insensitive" } },
        { fullName: { contains: "test", mode: "insensitive" } },
        { fullName: { contains: "demo", mode: "insensitive" } },
        ...confirmedOldTestNames.map((name) => ({
          fullName: { equals: name, mode: "insensitive" as const }
        })),
        { referralCode: { contains: "UAT", mode: "insensitive" } },
        { referralCode: { contains: "TEST", mode: "insensitive" } }
      ]
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fullName: true,
      phone: true,
      role: true,
      status: true,
      referralCode: true,
      createdAt: true,
      wallet: { select: { balance: true, cashBalance: true, ppobBalance: true } },
      _count: {
        select: {
          membershipOrders: true,
          invoices: true,
          commissions: true,
          rewardTransactions: true,
          withdrawals: true,
          sessions: true,
          sponsoredReferrals: true,
          referralAncestors: true,
          referralDescendants: true
        }
      }
    }
  });

  const allowlist = parseAllowlist();
  const generatedAt = new Date().toISOString();
  const plan = `# Pre-Launch Data Cleanup Plan

Generated at: ${generatedAt}

Default mode: DRY RUN.

This script is intentionally fail-safe:

- It never deletes by pattern alone.
- Execute mode requires \`TAPGO_CLEANUP_CONFIRM=YES\`.
- Execute mode also requires \`TAPGO_CLEANUP_USER_IDS\` allowlist.
- Admin/Super Admin users are never deleted by this script.
- Paid/posted/approved financial records are never deleted by this script.
- Allowlisted test users with only pending order/payment data can be marked \`DELETED\` after pending records are cancelled.

## Confirmed Old Test Users

Owner confirmed these old APK / old phone test accounts:

${reportTable(
  ["Name", "Classification", "Known pending order"],
  [
    ["Dedi Ganteng", "CONFIRMED OLD TEST USER", "Silver Rp500.000"],
    ["Yeyen Bohay", "CONFIRMED OLD TEST USER", "Gold Rp3.000.000"]
  ]
)}

## Candidate Users

${reportTable(
  [
    "User ID",
    "Name",
    "Phone",
    "Role",
    "Status",
    "Referral",
    "Wallet balance",
    "Cash",
    "PPOB",
    "Cleanup Action",
    "Linked Records"
  ],
  candidates.map((user) => [
    user.id,
    user.fullName,
    maskPhone(user.phone),
    user.role,
    user.status,
    user.referralCode,
    String(user.wallet?.balance ?? "0"),
    String(user.wallet?.cashBalance ?? "0"),
    String(user.wallet?.ppobBalance ?? "0"),
    confirmedOldTestNames.some((name) => name.toLowerCase() === user.fullName.toLowerCase())
      ? "cancel pending order/invoice/payment, revoke session, mark DELETED if no final financial records"
      : "manual review / allowlist required",
    JSON.stringify(user._count)
  ])
)}

## Safe Cleanup Policy

### KEEP

- \`SUPER_ADMIN\` and \`ADMIN\` accounts.
- Users with paid/posted/approved financial history.
- Users with wallet cash/PPOB balances unless manually reconciled.
- Audit logs, invoices, payments, commissions, reward records, and profit sharing records.

### Candidate Actions

1. Revoke sessions for approved test user IDs.
2. Cancel old pending membership orders/invoices for approved test user IDs.
3. Cancel old pending membership payments for approved test user IDs.
4. Mark approved test users as \`DELETED\` only if there is no paid/posted/approved financial history.

### Not Automated

- Physical delete for users with financial ledgers.
- Delete of paid/posted/approved records.
- Reversal of paid financial data.
- Cleanup of production admin accounts.

## Commands

Dry run:

\`\`\`bash
npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
\`\`\`

Execute with explicit allowlist:

\`\`\`bash
TAPGO_CLEANUP_CONFIRM=YES TAPGO_CLEANUP_USER_IDS="user-id-1,user-id-2" npm --workspace apps/backend run cleanup:prelaunch -- --execute
\`\`\`

## Current Run

- Mode: ${dryRun ? "DRY RUN" : "EXECUTE"}
- Candidate count: ${candidates.length}
- Allowlisted user IDs: ${allowlist.length ? allowlist.join(", ") : "-"}
`;

  await fs.writeFile(outputPath, plan);

  if (dryRun) {
    console.log(`Dry-run cleanup plan written to ${outputPath}`);
    return;
  }

  if (process.env.TAPGO_CLEANUP_CONFIRM !== "YES") {
    throw new Error("Execute mode requires TAPGO_CLEANUP_CONFIRM=YES.");
  }

  if (allowlist.length === 0) {
    throw new Error("Execute mode requires TAPGO_CLEANUP_USER_IDS allowlist.");
  }

  const users = await prisma.user.findMany({
    where: { id: { in: allowlist } },
    include: {
      wallet: true,
      commissions: true,
      rewardTransactions: true,
      withdrawals: true,
      invoices: true,
      membershipPayments: true,
      membershipOrders: true
    }
  });

  const unsafeUsers = users.filter((user) => {
    const hasFinalFinancialRecords =
      user.role !== "USER" ||
      user.commissions.some((commission) => commission.status === "POSTED") ||
      user.rewardTransactions.some((reward) => ["APPROVED", "PAID"].includes(reward.status)) ||
      user.withdrawals.some((withdrawal) => ["APPROVED", "PAID"].includes(withdrawal.status)) ||
      user.invoices.some((invoice) => ["AUTHORIZED", "PAID", "REFUNDED"].includes(invoice.status)) ||
      user.membershipPayments.some((payment) => ["AUTHORIZED", "PAID", "REFUNDED"].includes(payment.status)) ||
      user.membershipOrders.some((order) => order.status === "PAID");
    return Boolean(hasFinalFinancialRecords);
  });

  if (unsafeUsers.length > 0) {
    throw new Error(
      `Cleanup aborted. Unsafe user IDs need manual review: ${unsafeUsers.map((user) => user.id).join(", ")}`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { userId: { in: allowlist }, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    await tx.invoice.updateMany({
      where: { userId: { in: allowlist }, status: "PENDING" },
      data: { status: "CANCELLED" }
    });

    await tx.membershipOrder.updateMany({
      where: { userId: { in: allowlist }, status: "PENDING" },
      data: { status: "CANCELLED" }
    });

    await tx.membershipPayment.updateMany({
      where: { userId: { in: allowlist }, status: "PENDING" },
      data: { status: "CANCELLED" }
    });

    await tx.user.updateMany({
      where: { id: { in: allowlist }, role: "USER" },
      data: { status: "DELETED" }
    });
  });

  console.log(`Cleanup execute completed for ${allowlist.length} allowlisted user(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
