import { createHash } from "node:crypto";
import { env } from "../../../config/env.js";
import { logger } from "../../../core/logger/logger.js";
import {
  PpobProviderGateway,
  PpobPurchaseOutcome,
  PpobPurchaseRequest,
  PpobStatusInquiry
} from "../domain/ppobProvider.js";

/**
 * Adapter Digiflazz (Stage R2.8) — provider PPOB nyata pertama.
 *
 * Kontrak (developer.digiflazz.com/api/buyer/topup):
 * - POST {baseUrl}/transaction dengan sign = md5(username + apiKey + ref_id).
 * - ref_id = publicReference kita: permintaan ulang dengan ref_id yang sama
 *   TIDAK memotong saldo provider dua kali — inilah jangkar idempotency.
 * - Respons sinkron: status "Sukses" | "Pending" | "Gagal" dalam { data }.
 * - Cek status = topup ulang dengan payload identik (ref_id sama).
 *
 * Mode testing Digiflazz (testing=true) dipakai pada seluruh environment
 * non-production: saldo seller nyata tidak pernah tersentuh oleh UAT.
 */

const DEFAULT_BASE_URL = "https://api.digiflazz.com/v1";
const REQUEST_TIMEOUT_MS = 10000;

interface DigiflazzTransactionPayload {
  data?: {
    ref_id?: string;
    customer_no?: string;
    buyer_sku_code?: string;
    message?: string;
    status?: string;
    rc?: string;
    sn?: string | null;
    buyer_last_saldo?: number;
    price?: number;
  };
}

/** sign = md5(username + apiKey + ref_id) — persis dokumentasi Digiflazz. */
export function digiflazzSign(username: string, apiKey: string, refId: string): string {
  return createHash("md5").update(`${username}${apiKey}${refId}`).digest("hex");
}

export class DigiflazzPpobProvider implements PpobProviderGateway {
  readonly name = "digiflazz";

  constructor(
    private readonly config: {
      username: string;
      apiKey: string;
      baseUrl: string;
      testing: boolean;
    }
  ) {}

  static fromEnv(): DigiflazzPpobProvider {
    const username = env.DIGIFLAZZ_USERNAME;
    const apiKey = env.DIGIFLAZZ_API_KEY;
    if (!username || !apiKey) {
      // Fail-closed: PPOB_PROVIDER=digiflazz tanpa kredensial tidak boleh
      // boot dengan setengah konfigurasi — lempar saat resolusi provider.
      throw new Error(
        "PPOB_PROVIDER=digiflazz membutuhkan DIGIFLAZZ_USERNAME dan DIGIFLAZZ_API_KEY"
      );
    }
    return new DigiflazzPpobProvider({
      username,
      apiKey,
      baseUrl: env.DIGIFLAZZ_BASE_URL ?? DEFAULT_BASE_URL,
      // Mode testing Digiflazz aktif di luar production, apa pun konfigurasinya.
      testing: env.NODE_ENV !== "production" || env.DIGIFLAZZ_TESTING
    });
  }

  purchase(request: PpobPurchaseRequest): Promise<PpobPurchaseOutcome> {
    return this.callTransaction({
      username: this.config.username,
      buyer_sku_code: request.providerSku,
      customer_no: request.targetNumber,
      ref_id: request.publicReference,
      sign: digiflazzSign(this.config.username, this.config.apiKey, request.publicReference),
      testing: this.config.testing
    });
  }

  /**
   * Cek status = topup ulang dengan payload identik (dokumentasi Digiflazz:
   * "Respon dengan status pending dapat dicek kembali dengan melakukan topup
   * ulang dengan ref_id yang sama"). Aman: ref_id sama tidak memotong saldo
   * provider dua kali.
   */
  checkStatus(inquiry: PpobStatusInquiry): Promise<PpobPurchaseOutcome> {
    return this.callTransaction({
      username: this.config.username,
      buyer_sku_code: inquiry.providerSku,
      customer_no: inquiry.targetNumber,
      ref_id: inquiry.publicReference,
      sign: digiflazzSign(this.config.username, this.config.apiKey, inquiry.publicReference),
      testing: this.config.testing
    });
  }

  private async callTransaction(body: Record<string, unknown>): Promise<PpobPurchaseOutcome> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/transaction`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      // Timeout/jaringan putus: status provider TIDAK DIKETAHUI. Melempar
      // berarti PpobService menganggapnya kegagalan provider dan merefund —
      // aman karena ref_id mencegah pemotongan ganda saat pelanggan mengulang.
      logger.warn({ err: error, url }, "Digiflazz request failed");
      throw error;
    }

    let payload: DigiflazzTransactionPayload;
    try {
      payload = (await response.json()) as DigiflazzTransactionPayload;
    } catch {
      throw new Error(`Digiflazz returned non-JSON response (HTTP ${response.status})`);
    }

    const data = payload.data;
    if (!response.ok || !data) {
      throw new Error(
        `Digiflazz request rejected (HTTP ${response.status}): ${data?.message ?? "no payload"}`
      );
    }

    return mapDigiflazzStatus(data);
  }
}

/** Pemetaan status Digiflazz → outcome domain. Fail-closed pada nilai asing. */
export function mapDigiflazzStatus(data: {
  ref_id?: string;
  status?: string;
  rc?: string;
  message?: string;
  sn?: string | null;
}): PpobPurchaseOutcome {
  const providerReference = data.ref_id ?? "unknown";
  const status = data.status?.trim().toLowerCase();

  if (status === "sukses") {
    return {
      kind: "SUCCESS",
      providerReference,
      serialNumber: data.sn && data.sn.trim().length > 0 ? data.sn : null
    };
  }
  if (status === "pending") {
    return { kind: "PROCESSING", providerReference };
  }
  if (status === "gagal") {
    return {
      kind: "FAILED",
      providerReference: data.ref_id ?? null,
      failureCode: data.rc ? `DIGIFLAZZ_RC_${data.rc}` : "DIGIFLAZZ_FAILED",
      failureReason: data.message ?? "Transaksi gagal di provider"
    };
  }
  // Nilai status asing: jangan pernah menebak sukses. Lempar supaya dianggap
  // kegagalan sementara (refund aman oleh ref_id, atau diulang worker).
  throw new Error(`Digiflazz returned unknown status: ${data.status ?? "<empty>"}`);
}
