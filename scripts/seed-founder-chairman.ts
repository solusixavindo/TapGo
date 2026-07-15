import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { AdminConsoleService } from "../apps/backend/src/modules/admin-console/application/AdminConsoleService.js";
import { normalizePhoneNumber } from "../apps/backend/src/core/security/phone.js";

dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env.production") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env") });
dotenv.config();

const founderChairman = {
  founderId: "FCH-001",
  fullName: "Ahmad Zulhi",
  phone: "083890782273",
  email: "ahmadzulhi87@gmail.com"
} as const;

const prisma = new PrismaClient();
const service = new AdminConsoleService(prisma);
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");

function maskPhone(phone: string) {
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

function maskAccount(accountNumber?: string) {
  if (!accountNumber) {
    return null;
  }
  return `${"*".repeat(Math.max(6, accountNumber.length - 4))}${accountNumber.slice(-4)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const existingChairmanCount = await prisma.founderProgramGrant.count({
    where: { founderRole: "FOUNDER_CHAIRMAN" }
  });

  console.log(`Founder Chairman seed mode: ${execute ? "EXECUTE" : "DRY_RUN"}`);
  console.table([{
    founderId: founderChairman.founderId,
    name: founderChairman.fullName,
    phone: maskPhone(founderChairman.phone),
    email: founderChairman.email,
    bankAccount: maskAccount(process.env.FOUNDER_CHAIRMAN_BANK_ACCOUNT_NUMBER) ?? "not provided"
  }]);
  console.log(`Existing Founder Chairman count: ${existingChairmanCount}`);

  if (!execute) {
    console.log("Dry run only. Add --execute with TAPGO_FOUNDER_CHAIRMAN_CONFIRM=YES to create the account.");
    return;
  }

  if (process.env.TAPGO_FOUNDER_CHAIRMAN_CONFIRM !== "YES") {
    throw new Error("Execute mode requires TAPGO_FOUNDER_CHAIRMAN_CONFIRM=YES.");
  }

  const initialPassword = process.env.FOUNDER_CHAIRMAN_INITIAL_PASSWORD;
  if (!initialPassword || initialPassword.length < 8) {
    throw new Error("Execute mode requires FOUNDER_CHAIRMAN_INITIAL_PASSWORD with at least 8 characters.");
  }

  const bankName = process.env.FOUNDER_CHAIRMAN_BANK_NAME;
  const accountHolderName = process.env.FOUNDER_CHAIRMAN_BANK_ACCOUNT_NAME;
  const accountNumber = process.env.FOUNDER_CHAIRMAN_BANK_ACCOUNT_NUMBER;
  const bankAccount = bankName && accountHolderName && accountNumber
    ? { bankName, accountHolderName, accountNumber }
    : undefined;

  const actorId = process.env.FOUNDER_CHAIRMAN_ACTOR_ID
    ?? (await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    }))?.id;

  if (!actorId) {
    throw new Error("No active SUPER_ADMIN found. Set FOUNDER_CHAIRMAN_ACTOR_ID explicitly.");
  }

  const normalizedPhone = normalizePhoneNumber(founderChairman.phone);
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: normalizedPhone },
        { email: founderChairman.email },
        { referralCode: founderChairman.founderId }
      ]
    },
    select: { id: true, fullName: true, phone: true, referralCode: true }
  });

  if (existingUser) {
    console.log(`SKIP ${founderChairman.founderId}: existing user ${existingUser.id} (${existingUser.referralCode})`);
    return;
  }

  const result = await service.grantFounderChairman({
    actorId,
    fullName: founderChairman.fullName,
    phone: founderChairman.phone,
    email: founderChairman.email,
    password: initialPassword,
    reason: "Founder Chairman official single founder account",
    ...(bankAccount ? { bankAccount } : {})
  });

  console.log(`CREATED ${founderChairman.founderId}: ${result.userId}`);
  console.log(`Bank account stored as masked reference: ${result.bankAccountMasked ?? "not provided"}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
