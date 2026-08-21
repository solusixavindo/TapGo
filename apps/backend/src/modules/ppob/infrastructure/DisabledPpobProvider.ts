import { PpobProviderGateway, PpobPurchaseOutcome, PpobPurchaseRequest, PpobProviderDisabledError } from "../domain/ppobProvider.js";

/**
 * Provider fail-closed saat PPOB_PROVIDER=disabled (default).
 *
 * Bukan adapter "kosong": keberadaannya memastikan setiap pembelian yang lolos
 * sampai ke provider selalu berakhir dengan kompensasi refund yang teruji,
 * bukan transaksi menggantung.
 */
export class DisabledPpobProvider implements PpobProviderGateway {
  readonly name = "disabled";

  purchase(_request: PpobPurchaseRequest): Promise<PpobPurchaseOutcome> {
    return Promise.reject(new PpobProviderDisabledError());
  }
}
