import { env } from "../../../config/env.js";
import { prisma } from "../../../config/prisma.js";
import { FcmClient, parseServiceAccount } from "../infrastructure/FcmClient.js";
import { PushService } from "./PushService.js";

let instance: PushService | undefined;

/** Instans tunggal. Tanpa kunci service account, layanan mati (tidak mengirim). */
export function getPushService(): PushService {
  if (instance) return instance;
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const projectId = env.FIREBASE_PROJECT_ID ?? (account as { project_id?: string } | null)?.project_id;
  const sender = account && projectId ? new FcmClient(projectId, account) : null;
  instance = new PushService(
    {
      listTokens: (userId) =>
        prisma.pushToken.findMany({ where: { userId }, select: { id: true, token: true } }),
      deleteTokens: async (ids) => {
        await prisma.pushToken.deleteMany({ where: { id: { in: ids } } });
      }
    },
    sender
  );
  return instance;
}
