import { z } from "zod";

/**
 * Notifikasi Midtrans.
 *
 * `signature_key`, `status_code`, dan `gross_amount` WAJIB, dan itu bukan sekadar
 * kerapian schema. Ketiganya adalah bahan pembentuk signature
 * (sha512(order_id + status_code + gross_amount + server_key)), sehingga tanpa
 * salah satu pun signature tidak dapat dihitung — dan endpoint ini TIDAK
 * memerlukan autentikasi.
 *
 * Sebelumnya ketiganya opsional. Akibatnya siapa pun dapat mengirim notifikasi
 * TANPA `signature_key` dan lolos verifikasi selama NODE_ENV bukan "production"
 * (termasuk "staging" dan "development"), lalu melunasi invoice orang lain
 * beserta seluruh rangkaian bonusnya. Wajib di sini membuat permintaan semacam
 * itu berhenti dengan 400 sebelum menyentuh service; penjaga keduanya ada pada
 * verifySignature yang kini fail-closed tanpa memandang NODE_ENV.
 */
export const midtransNotificationSchema = z.object({
  body: z.object({
    order_id: z.string().min(3).max(80),
    transaction_status: z.string().min(3).max(40),
    transaction_id: z.string().min(3).max(120).optional(),
    fraud_status: z.string().min(2).max(40).optional(),
    status_code: z.string().min(2).max(8),
    gross_amount: z.string().min(1).max(32),
    signature_key: z.string().min(20).max(256),
    payment_type: z.string().min(2).max(60).optional(),
    transaction_time: z.string().min(6).max(60).optional()
  }).passthrough()
});
