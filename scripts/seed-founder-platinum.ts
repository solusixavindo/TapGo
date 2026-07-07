import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { AdminConsoleService } from "../apps/backend/src/modules/admin-console/application/AdminConsoleService.js";
import { normalizePhoneNumber } from "../apps/backend/src/core/security/phone.js";

dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env.production") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/backend/.env") });
dotenv.config();

const founderAccounts = [
  { founderId: "FND-001", fullName: "Evi Saepudin", phone: "082258492759", email: "episaepudin011979@gmail.com" },
  { founderId: "FND-002", fullName: "Atang Supriatna", phone: "085213572418", email: "atangsupri17@gmail.com" },
  { founderId: "FND-003", fullName: "M. Dedi Muftiadi", phone: "082113243121", email: "dmuftiadi@gmail.com" },
  { founderId: "FND-004", fullName: "Dede Sapta Jadi", phone: "089531562223", email: "dedesaptahadi050@gmail.com" },
  { founderId: "FND-005", fullName: "Ivan Alfiana", phone: "087885752765", email: "ivanalviana47@gmail.com" },
  { founderId: "FND-006", fullName: "Lupi Saptiyawan", phone: "083874092118", email: "lupisaptiyawan@gmail.com" },
  { founderId: "FND-007", fullName: "Dede Wahid Nurohim", phone: "083137024060", email: "dedewahid713@gmail.com" },
  { founderId: "FND-008", fullName: "Sumardi", phone: "08985978319", email: "infoumumbanten@gmail.com" },
  { founderId: "FND-009", fullName: "Saepudin", phone: "081327403320", email: "barkumdin33@gmail.com" },
  { founderId: "FND-010", fullName: "Saprudin", phone: "083875532786", email: "khsaprudin253@gmail.com" }
] as const;

const prisma = new PrismaClient();
const service = new AdminConsoleService(prisma);
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");

function maskPhone(phone: string) {
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const existingFounderCount = await prisma.founderProgramGrant.count({
    where: { founderRole: "FOUNDER_PLATINUM", revokedAt: null }
  });

  console.log(`Founder Platinum seed mode: ${execute ? "EXECUTE" : "DRY_RUN"}`);
  console.log(`Active Founder Platinum count: ${existingFounderCount}`);
  console.table(founderAccounts.map((account) => ({
    founderId: account.founderId,
    name: account.fullName,
    phone: maskPhone(account.phone),
    email: account.email
  })));

  if (!execute) {
    console.log("Dry run only. Add --execute with TAPGO_FOUNDER_PLATINUM_CONFIRM=YES to create accounts.");
    return;
  }

  if (process.env.TAPGO_FOUNDER_PLATINUM_CONFIRM !== "YES") {
    throw new Error("Execute mode requires TAPGO_FOUNDER_PLATINUM_CONFIRM=YES.");
  }

  const initialPassword = process.env.FOUNDER_PLATINUM_INITIAL_PASSWORD;
  if (!initialPassword || initialPassword.length < 8) {
    throw new Error("Execute mode requires FOUNDER_PLATINUM_INITIAL_PASSWORD with at least 8 characters.");
  }

  const actorId = process.env.FOUNDER_PLATINUM_ACTOR_ID
    ?? (await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    }))?.id;

  if (!actorId) {
    throw new Error("No active SUPER_ADMIN found. Set FOUNDER_PLATINUM_ACTOR_ID explicitly.");
  }

  for (const account of founderAccounts) {
    const normalizedPhone = normalizePhoneNumber(account.phone);
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          { email: account.email },
          { referralCode: account.founderId }
        ]
      },
      select: { id: true, fullName: true, phone: true, referralCode: true }
    });

    if (existingUser) {
      console.log(`SKIP ${account.founderId}: existing user ${existingUser.id} (${existingUser.referralCode})`);
      continue;
    }

    const result = await service.grantFounderPlatinum({
      actorId,
      founderId: account.founderId,
      fullName: account.fullName,
      phone: account.phone,
      email: account.email,
      password: initialPassword,
      reason: "Founder Platinum official 10 appreciation accounts"
    });

    console.log(`CREATED ${account.founderId}: ${result.user.id}`);
  }

  const finalFounderCount = await prisma.founderProgramGrant.count({
    where: { founderRole: "FOUNDER_PLATINUM", revokedAt: null }
  });
  console.log(`Final active Founder Platinum count: ${finalFounderCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
