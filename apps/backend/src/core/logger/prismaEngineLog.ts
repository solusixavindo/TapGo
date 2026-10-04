const PREFIX = "Prisma engine error: ";
const MAX_MESSAGE_LENGTH = 300;

/**
 * Teks log untuk event `error` mesin Prisma (`prisma.$on("error")`).
 *
 * Hook Sentry di logger.ts hanya membaca field `err`/`error`; field `event`
 * dibuang, jadi pesan seperti "Error in PostgreSQL connection" tidak pernah
 * sampai ke Sentry dan semua galat mesin Prisma menumpuk di satu issue
 * "Prisma error" tanpa isi (TAPGO-BACKEND-2). Pesannya dimasukkan ke teks log
 * supaya tiap jenis galat menjadi issue sendiri yang bisa didiagnosis.
 * Dirapikan dan dipotong agar satu baris dan terbatas panjangnya.
 */
export function prismaEngineErrorMessage(event: unknown): string {
  const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  const message =
    typeof record.message === "string"
      ? record.message.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH)
      : "";
  if (!message) return `${PREFIX}(tanpa pesan)`;
  const target = typeof record.target === "string" ? record.target.trim().slice(0, 80) : "";
  return target ? `${PREFIX}${message} [${target}]` : `${PREFIX}${message}`;
}
