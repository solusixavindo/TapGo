/**
 * Port menuju biller/provider PPOB nyata (Stage R2.8).
 *
 * Boundary ini sengaja dibuat sekarang agar Stage R2.8 hanya menukar
 * implementasi infrastructure tanpa menyentuh application/presentation.
 * Implementasi R2.7 (NoPpobProviderGateway) fail-closed: getAvailability()
 * false, sehingga order tidak pernah dibuat dan saldo tidak pernah didebit.
 */
export type PpobProviderOutcome = "SUCCESS" | "PENDING" | "FAILED";

export interface PpobProviderAvailability {
  available: boolean;
  reason?: string;
}

export interface PpobProviderPurchaseRequest {
  orderId: string;
  sku: string;
  targetNumber: string;
  /** Total yang sudah didebit dari wallet (price + adminFee). */
  amount: string;
}

export interface PpobProviderPurchaseResult {
  outcome: PpobProviderOutcome;
  providerRef?: string;
  failureReason?: string;
}

export interface PpobProviderGateway {
  /** Dicek SEBELUM debit; tidak tersedia => order gagal tanpa menyentuh saldo. */
  getAvailability(): PpobProviderAvailability;
  purchase(request: PpobProviderPurchaseRequest): Promise<PpobProviderPurchaseResult>;
}
