import type { PushService } from "./PushService.js";
import type { PushNotifier } from "./rideNotifications.js";

/**
 * Pengirim push untuk layanan bisnis (perjalanan, wallet, membership).
 *
 * SENGAJA tidak mengimpor config/env atau config/prisma secara statis.
 * Layanan bisnis diimpor oleh modul rute dan oleh uji SEBELUM konfigurasi
 * siap; impor statis env.ts memaksa parse saat itu juga dan mematahkan
 * urutan penyetelan env (kunci OTP, identifier, dst). Semuanya dimuat
 * malas, tepat saat notifikasi pertama benar-benar dikirim.
 */
let instance: Promise<PushService> | undefined;

async function build(): Promise<PushService> {
  const [{ env }, { prisma }, { FcmClient, parseServiceAccount }, { PushService: Service }] = await Promise.all([
    import("../../../config/env.js"),
    import("../../../config/prisma.js"),
    import("../infrastructure/FcmClient.js"),
    import("./PushService.js")
  ]);
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const projectId = env.FIREBASE_PROJECT_ID ?? account?.project_id;
  const sender = account && projectId ? new FcmClient(projectId, account) : null;
  return new Service(
    {
      listTokens: (userId) =>
        prisma.pushToken.findMany({ where: { userId }, select: { id: true, token: true } }),
      deleteTokens: async (ids) => {
        await prisma.pushToken.deleteMany({ where: { id: { in: ids } } });
      }
    },
    sender
  );
}

export function loadPushService(): Promise<PushService> {
  instance ??= build();
  return instance;
}

/**
 * Nilai bawaan aman untuk semua layanan. `enabled` hanya membaca process.env
 * (murah dan sinkron): tanpa kunci service account, tidak ada yang dimuat dan
 * tidak ada yang dikirim.
 */
export const lazyPushNotifier: PushNotifier = {
  get enabled() {
    return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim());
  },
  notifyUser: async (userId, message) => {
    await (await loadPushService()).notifyUser(userId, message);
  }
};
