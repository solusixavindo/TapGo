import { PrismaClient } from "@prisma/client";
import { logger } from "../core/logger/logger.js";
import { prismaEngineErrorMessage } from "../core/logger/prismaEngineLog.js";

export const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" }
  ]
});

prisma.$on("error", (event) => logger.error({ event }, prismaEngineErrorMessage(event)));
prisma.$on("warn", (event) => logger.warn({ event }, "Prisma warning"));

export async function disconnectPrisma() {
  await prisma.$disconnect();
}
