import { createHash } from "node:crypto";
import { env } from "../../../config/env.js";
import { logger } from "../../../core/logger/logger.js";
import {
  POSTPAID_CATEGORIES,
  PpobBillInquiryError,
  PpobBillInquiryRequest,
  PpobBillInquiryResult,
  PpobBillPayRequest,
  PpobPostpaidCatalogEntry,
  PpobPriceListEntry,
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
/// Lama hasil daftar harga dipakai ulang (batas pengecekan Digiflazz, rc=83).
const PRICELIST_CACHE_MS = 2 * 60 * 1000;

interface DigiflazzPriceListRow {
  buyer_sku_code?: string;
  price?: number;
  buyer_product_status?: boolean;
  /// Baris pascabayar: tanpa `price`, memakai admin dan commission.
  product_name?: string;
  brand?: string;
  admin?: number;
  commission?: number;
  seller_product_status?: boolean;
  desc?: string;
}

interface DigiflazzPriceListPayload {
  data?: DigiflazzPriceListRow[] | { rc?: string; message?: string } | null;
}

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
    selling_price?: number;
    /// Pascabayar (inq-pasca / pay-pasca).
    customer_name?: string;
    admin?: number;
    period?: string;
    desc?: unknown;
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
    if (POSTPAID_CATEGORIES.has(inquiry.category)) {
      return this.callTransaction(
        this.postpaidBody("status-pasca", inquiry.publicReference, inquiry.providerSku, inquiry.targetNumber)
      );
    }
    return this.callTransaction({
      username: this.config.username,
      buyer_sku_code: inquiry.providerSku,
      customer_no: inquiry.targetNumber,
      ref_id: inquiry.publicReference,
      sign: digiflazzSign(this.config.username, this.config.apiKey, inquiry.publicReference),
      testing: this.config.testing
    });
  }

  /** Badan permintaan pascabayar; sign = md5(username + apiKey + ref_id), sama dengan prabayar. */
  private postpaidBody(
    commands: "inq-pasca" | "pay-pasca" | "status-pasca",
    refId: string,
    sku: string,
    customerNo: string
  ): Record<string, unknown> {
    return {
      commands,
      username: this.config.username,
      buyer_sku_code: sku,
      customer_no: customerNo,
      ref_id: refId,
      sign: digiflazzSign(this.config.username, this.config.apiKey, refId),
      // Dokumentasi Digiflazz hanya menyertakan flag testing pada inquiry;
      // pembayaran dan cek status mengikuti ref_id inquiry-nya.
      ...(commands === "inq-pasca" && this.config.testing ? { testing: true } : {})
    };
  }

  /** Cek tagihan (inq-pasca). Tidak memotong saldo siapa pun. */
  async inquireBill(request: PpobBillInquiryRequest): Promise<PpobBillInquiryResult> {
    const body = this.postpaidBody(
      "inq-pasca",
      request.publicReference,
      request.providerSku,
      request.targetNumber
    );
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/transaction`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      logger.warn({ err: error }, "Digiflazz inq-pasca request failed");
      throw new PpobBillInquiryError("PROVIDER_UNREACHABLE", BILL_RETRY_MESSAGE);
    }
    let payload: DigiflazzTransactionPayload;
    try {
      payload = (await response.json()) as DigiflazzTransactionPayload;
    } catch {
      throw new PpobBillInquiryError("PROVIDER_INVALID_RESPONSE", BILL_RETRY_MESSAGE);
    }
    return parseBillInquiry(payload.data, response.ok);
  }

  /** Bayar tagihan (pay-pasca) dengan ref_id inquiry. Hasil dipetakan seperti prabayar. */
  payBill(request: PpobBillPayRequest): Promise<PpobPurchaseOutcome> {
    return this.callTransaction(
      this.postpaidBody("pay-pasca", request.publicReference, request.providerSku, request.targetNumber)
    );
  }

  /** Katalog pascabayar dari daftar harga `pasca` (admin dan commission, tanpa price). */
  async fetchPostpaidCatalog(): Promise<PpobPostpaidCatalogEntry[]> {
    const rows = await this.fetchPriceListRows("pasca");
    const entries: PpobPostpaidCatalogEntry[] = [];
    for (const row of rows) {
      if (typeof row.buyer_sku_code !== "string" || row.buyer_sku_code.length === 0) continue;
      if (typeof row.product_name !== "string" || row.product_name.trim().length === 0) continue;
      entries.push({
        providerSku: row.buyer_sku_code,
        name: row.product_name.trim(),
        brand: typeof row.brand === "string" ? row.brand.trim() : "",
        adminFee: typeof row.admin === "number" && row.admin >= 0 ? row.admin : 0,
        commission: typeof row.commission === "number" && row.commission >= 0 ? row.commission : 0,
        active: row.buyer_product_status !== false && row.seller_product_status !== false,
        description: typeof row.desc === "string" && row.desc.trim().length > 0 ? row.desc.trim() : null
      });
    }
    return entries;
  }

  /**
   * Daftar harga modal PRABAYAR Digiflazz terkini (Stage R2.12 — sinkronisasi harga
   * PPOB). Pascabayar sengaja TIDAK ikut: barisnya tak punya `price` (admin dan
   * commission) sehingga selalu terbuang di sini, sedangkan Digiflazz membatasi
   * pengecekan daftar harga (rc=83). Katalog pascabayar punya jalur sendiri
   * (fetchPostpaidCatalog) dengan satu permintaan per siklus.
   */
  async fetchPriceList(): Promise<PpobPriceListEntry[]> {
    return this.fetchPriceListFor("prepaid");
  }

  private async fetchPriceListFor(cmd: "prepaid" | "pasca"): Promise<PpobPriceListEntry[]> {
    const rows = await this.fetchPriceListRows(cmd);
    return rows
      .filter(
        (row): row is DigiflazzPriceListRow & { buyer_sku_code: string; price: number } =>
          typeof row.buyer_sku_code === "string" && typeof row.price === "number" && row.price > 0
      )
      .map((row) => ({
        providerSku: row.buyer_sku_code,
        cost: row.price,
        buyerProductStatus: row.buyer_product_status !== false
      }));
  }

  /**
   * Hasil daftar harga disimpan sebentar: Digiflazz membatasi pengecekan daftar harga
   * (rc=83 "limitasi pengecekan pricelist"), jadi pemanggil berturut-turut pada
   * instance yang sama tidak boleh mengulang permintaan yang sama.
   */
  private pricelistCache = new Map<string, { at: number; rows: DigiflazzPriceListRow[] }>();

  private async fetchPriceListRows(cmd: "prepaid" | "pasca"): Promise<DigiflazzPriceListRow[]> {
    const cached = this.pricelistCache.get(cmd);
    if (cached && Date.now() - cached.at < PRICELIST_CACHE_MS) {
      return cached.rows;
    }
    const rows = await this.requestPriceListRows(cmd);
    this.pricelistCache.set(cmd, { at: Date.now(), rows });
    return rows;
  }

  private async requestPriceListRows(cmd: "prepaid" | "pasca"): Promise<DigiflazzPriceListRow[]> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/price-list`;
    // sign untuk price-list BUKAN md5(username+apiKey+ref_id) seperti transaksi —
    // dokumentasi Digiflazz memakai kata kunci tetap "pricelist" di posisi ref_id.
    const sign = createHash("md5")
      .update(`${this.config.username}${this.config.apiKey}pricelist`)
      .digest("hex");

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cmd, username: this.config.username, sign }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      logger.warn({ err: error, url, cmd }, "Digiflazz price-list request failed");
      throw error;
    }

    let payload: DigiflazzPriceListPayload;
    try {
      payload = (await response.json()) as DigiflazzPriceListPayload;
    } catch {
      throw new Error(`Digiflazz price-list returned non-JSON response (HTTP ${response.status})`);
    }

    const rows = extractPriceListRows(payload);
    if (!response.ok || rows === null) {
      const data = payload.data;
      const detail = data && !Array.isArray(data) ? data : undefined;
      throw new Error(
        `Digiflazz price-list rejected (HTTP ${response.status}, cmd=${cmd}): ${detail?.message ?? "no payload"}${detail?.rc ? ` (rc=${detail.rc})` : ""} [bentuk: ${describePayloadShape(payload)}]`
      );
    }
    return rows;
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
  price?: number;
  selling_price?: number;
}): PpobPurchaseOutcome {
  const providerReference = data.ref_id ?? "unknown";
  const status = data.status?.trim().toLowerCase();

  if (status === "sukses") {
    return {
      kind: "SUCCESS",
      providerReference,
      serialNumber: data.sn && data.sn.trim().length > 0 ? data.sn : null,
      // Pascabayar: yang ditagihkan ke kita adalah selling_price (harga setelah
      // komisi); prabayar tidak punya field itu dan tetap memakai price.
      providerCost:
        typeof data.selling_price === "number" && data.selling_price > 0
          ? data.selling_price
          : typeof data.price === "number" && data.price > 0
            ? data.price
            : null
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

const BILL_RETRY_MESSAGE = "Penyedia tagihan sedang tidak merespons. Coba lagi sebentar lagi.";
/// Batas wajar satu tagihan; angka di atas ini diperlakukan sebagai respons rusak.
const MAX_BILL_COST = 50_000_000;

/** Pesan aman per kode respons Digiflazz; pesan mentah penyedia tidak ditampilkan. */
function billInquiryMessageFor(rc: string | undefined): string {
  switch (rc) {
    case "60":
      return "Tagihan belum tersedia atau sudah dibayar untuk periode ini.";
    case "14":
      return "Nomor pelanggan tidak ditemukan. Periksa kembali nomornya.";
    case "01":
    case "03":
    case "70":
      return BILL_RETRY_MESSAGE;
    default:
      return "Tagihan tidak dapat diperiksa. Periksa nomor pelanggan lalu coba lagi.";
  }
}

function scalarDetail(desc: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!desc || typeof desc !== "object" || Array.isArray(desc)) return out;
  for (const [key, value] of Object.entries(desc as Record<string, unknown>)) {
    if (Object.keys(out).length >= 10) break;
    if (typeof value === "number" && Number.isFinite(value)) out[key.slice(0, 40)] = value;
    else if (typeof value === "string" && value.trim().length > 0) out[key.slice(0, 40)] = value.trim().slice(0, 80);
  }
  return out;
}

function periodOf(data: NonNullable<DigiflazzTransactionPayload["data"]>): string | null {
  if (typeof data.period === "string" && data.period.trim()) return data.period.trim().slice(0, 40);
  const desc = data.desc as Record<string, unknown> | undefined;
  for (const holder of [desc?.tagihan, desc?.bill]) {
    const first = (holder as { detail?: Array<Record<string, unknown>> } | undefined)?.detail?.[0];
    const value = first?.periode ?? first?.period;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 40);
  }
  return null;
}

/**
 * Respons inq-pasca -> hasil domain. Fail-closed: status selain "Sukses",
 * jumlah tak masuk akal, atau tanpa angka biaya ditolak sebagai inquiry gagal
 * (tidak ada uang yang bergerak pada inquiry, jadi gagal itu aman).
 */
export function parseBillInquiry(
  data: DigiflazzTransactionPayload["data"],
  httpOk: boolean
): PpobBillInquiryResult {
  if (!httpOk || !data) {
    throw new PpobBillInquiryError("PROVIDER_REJECTED", BILL_RETRY_MESSAGE);
  }
  if (data.status?.trim().toLowerCase() !== "sukses") {
    throw new PpobBillInquiryError(
      data.rc ? `DIGIFLAZZ_RC_${data.rc}` : "DIGIFLAZZ_FAILED",
      billInquiryMessageFor(data.rc)
    );
  }
  const sellingPrice = typeof data.selling_price === "number" ? data.selling_price : 0;
  const price = typeof data.price === "number" ? data.price : 0;
  // selling_price (setelah komisi) adalah biaya kita; bila tak ada, price (lebih
  // tinggi atau sama) dipakai supaya margin tidak pernah tergerus.
  const cost = sellingPrice > 0 ? sellingPrice : price;
  const admin = typeof data.admin === "number" && data.admin >= 0 ? data.admin : 0;
  if (!(cost > 0) || cost > MAX_BILL_COST) {
    throw new PpobBillInquiryError("PROVIDER_INVALID_AMOUNT", BILL_RETRY_MESSAGE);
  }
  const gross = price > 0 ? price : cost;
  return {
    customerName: (data.customer_name ?? "").trim().slice(0, 120) || "Pelanggan",
    period: periodOf(data),
    billAmount: Math.max(gross - admin, 0),
    adminFee: admin,
    cost,
    detail: scalarDetail(data.desc)
  };
}

/**
 * Baris daftar harga dari berbagai bentuk jawaban Digiflazz: `{data: [...]}`
 * (prabayar), larik di tingkat atas, atau objek berisi baris-baris (kunci apa pun).
 * Objek berisi `rc` adalah galat (mis. rc=83), bukan daftar. null = bukan daftar.
 */
export function extractPriceListRows(payload: unknown): DigiflazzPriceListRow[] | null {
  const candidate =
    payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload
      ? (payload as { data?: unknown }).data
      : payload;
  if (Array.isArray(candidate)) return candidate as DigiflazzPriceListRow[];
  if (candidate && typeof candidate === "object" && !("rc" in candidate)) {
    const values = Object.values(candidate as Record<string, unknown>).filter(
      (value): value is DigiflazzPriceListRow =>
        !!value && typeof value === "object" && !Array.isArray(value) && "buyer_sku_code" in value
    );
    return values.length > 0 ? values : null;
  }
  return null;
}

/** Ringkasan bentuk jawaban (nama kunci dan tipe, tanpa nilai) untuk pesan galat/log. */
export function describePayloadShape(payload: unknown): string {
  const type = (value: unknown): string =>
    Array.isArray(value) ? `array(${value.length})` : value === null ? "null" : typeof value;
  if (!payload || typeof payload !== "object") return type(payload);
  const keys = (obj: object) =>
    Object.entries(obj as Record<string, unknown>)
      .slice(0, 8)
      .map(([key, value]) => `${key.slice(0, 24)}:${type(value)}`)
      .join(",");
  const data = Array.isArray(payload) ? payload : (payload as { data?: unknown }).data;
  const inner =
    data && typeof data === "object" && !Array.isArray(data) ? ` data{${keys(data as object)}}` : "";
  return `${type(payload)}{${Array.isArray(payload) ? "" : keys(payload)}}${inner}`;
}
