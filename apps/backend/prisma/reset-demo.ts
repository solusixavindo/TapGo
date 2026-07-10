import { PrismaClient } from "@prisma/client";
import { cleanupDemoData, seedDemoData } from "./demo-seed-utils.js";

const prisma = new PrismaClient();

async function main() {
  await cleanupDemoData(prisma);
  const result = await seedDemoData(prisma);
  console.table([
    { label: "Reset status", value: "Demo data cleaned and re-seeded" },
    { label: "Total demo users", value: result.totalUsers },
    { label: "Network members", value: result.totalNetworkMembers },
    { label: "Presentation date", value: "Senin, 8 Juni 2026" },
  ]);
  console.log("Final UAT demo reset completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
