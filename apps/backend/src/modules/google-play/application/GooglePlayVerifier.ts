import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

export type GooglePlayVerifiedPurchaseState =
  | "PENDING"
  | "PURCHASED"
  | "CANCELLED"
  | "UNKNOWN";

export type GooglePlayVerifiedAcknowledgementState =
  | "PENDING"
  | "ACKNOWLEDGED"
  | "NOT_REQUIRED";

export type GooglePlayVerifyProductPurchaseInput = {
  packageName: string;
  productId: string;
  purchaseToken: string;
};

export type GooglePlayVerifiedProductPurchase = {
  packageName: string;
  productId: string;
  purchaseState: GooglePlayVerifiedPurchaseState;
  acknowledgementState: GooglePlayVerifiedAcknowledgementState;
  googleOrderId?: string;
  purchaseTime?: Date;
  testPurchase?: boolean;
  obfuscatedAccountId?: string;
  raw?: Record<string, unknown>;
};

export interface GooglePlayVerifier {
  verifyProductPurchase(
    input: GooglePlayVerifyProductPurchaseInput,
  ): Promise<GooglePlayVerifiedProductPurchase>;

  acknowledgeProductPurchase(
    input: GooglePlayVerifyProductPurchaseInput,
  ): Promise<{ acknowledgedAt: Date }>;
}

export class NotConfiguredGooglePlayVerifier implements GooglePlayVerifier {
  async verifyProductPurchase(): Promise<GooglePlayVerifiedProductPurchase> {
    throw new AppError(
      "Google Play verification is not configured.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "GOOGLE_PLAY_VERIFIER_NOT_CONFIGURED",
    );
  }

  async acknowledgeProductPurchase(): Promise<{ acknowledgedAt: Date }> {
    throw new AppError(
      "Google Play verification is not configured.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "GOOGLE_PLAY_VERIFIER_NOT_CONFIGURED",
    );
  }
}
