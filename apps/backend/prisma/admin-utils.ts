import { Prisma, PrismaClient, UserRole } from "@prisma/client";

export function normalizePhone(phone: string) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");

  if (digits.startsWith("0")) {
    return `+62${digits.slice(1)}`;
  }

  if (digits.startsWith("62")) {
    return `+${digits}`;
  }

  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  return `+62${digits}`;
}

export function parseRole(role: string): Extract<UserRole, "ADMIN" | "SUPER_ADMIN"> {
  const normalized = role.trim().toUpperCase();
  if (normalized === "ADMIN" || normalized === "SUPER_ADMIN") {
    return normalized;
  }

  throw new Error("Role must be ADMIN or SUPER_ADMIN.");
}

export async function ensureBasicMembership(prisma: PrismaClient) {
  return prisma.membership.upsert({
    where: { tier: "BASIC" },
    update: {
      name: "Basic",
      price: new Prisma.Decimal(0),
      directBonus: new Prisma.Decimal(2000),
      activeLevels: 0,
      ppobBalance: new Prisma.Decimal(0),
      bpjsBenefit: "Tidak termasuk",
      merchandise: [],
      businessRight: "Akses pengguna"
    },
    create: {
      tier: "BASIC",
      name: "Basic",
      price: new Prisma.Decimal(0),
      directBonus: new Prisma.Decimal(2000),
      activeLevels: 0,
      ppobBalance: new Prisma.Decimal(0),
      bpjsBenefit: "Tidak termasuk",
      merchandise: [],
      businessRight: "Akses pengguna"
    }
  });
}
