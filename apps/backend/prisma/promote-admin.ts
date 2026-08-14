import { PrismaClient } from "@prisma/client";
import { phoneLookupVariants } from "../src/core/security/phone.js";
import { parseRole } from "./admin-utils.js";

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

  const role = parseRole(rawRole);

  /*
   * Pencarian memakai phoneLookupVariants, sama seperti jalur login.
   *
   * Sebelumnya skrip ini menormalkan ke "+62…" lewat admin-utils, sedangkan
   * aplikasi menyimpan nomor sebagai "08…" (lihat normalizePhoneNumber di
   * src/core/security/phone.ts). Keduanya menormalkan ke arah BERLAWANAN,
   * sehingga skrip ini tidak pernah dapat menemukan satu pun pengguna yang
   * mendaftar lewat API — promosi admin selalu gagal dengan "was not found".
   */
  const variants = phoneLookupVariants(rawPhone);
  const user = await prisma.user.findFirst({ where: { phone: { in: variants } } });
  if (!user) {
    throw new Error(
      `User with phone ${rawPhone} was not found (dicari sebagai: ${variants.join(", ")}).`
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
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
