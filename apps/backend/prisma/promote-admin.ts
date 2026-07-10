import { PrismaClient } from "@prisma/client";
import { normalizePhone, parseRole } from "./admin-utils.js";

const prisma = new PrismaClient();

function getArg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const rawPhone = getArg("phone");
  const rawRole = getArg("role") ?? "ADMIN";

  if (!rawPhone) {
    throw new Error("Missing --phone. Example: npm --workspace apps/backend run promote:admin -- --phone=081234567890 --role=SUPER_ADMIN");
  }

  const phone = normalizePhone(rawPhone);
  const role = parseRole(rawRole);

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    throw new Error(`User with phone ${phone} was not found.`);
  }

  const updated = await prisma.user.update({
    where: { phone },
    data: {
      role,
      status: "ACTIVE"
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      role: true
    }
  });

  console.table([updated]);
  console.log(`User ${updated.phone} promoted to ${updated.role}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
