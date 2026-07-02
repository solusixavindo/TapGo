# Google Play Production Preparation

## Scope

This document tracks Google Play production preparation after TapGo payment strategy was updated to DOKU primary gateway.

## Current Payment Disclosure

TapGo uses payment gateway integration for paid membership checkout.

| Gateway | App Disclosure Position |
|---|---|
| DOKU | Primary payment gateway |
| Midtrans | Secondary/fallback while review continues |
| Xendit | Not used in TapGo v1.0 |

## Store Listing Checks

| Item | Status |
|---|---|
| Privacy Policy available | Required |
| Terms & Conditions available | Required |
| Contact email active | Required |
| Website active | Required |
| No guaranteed income claims | Required |
| No investment wording | Required |
| Payment/membership description clear | Required |
| Data Safety matches permissions | Required |

## Data Safety Notes

TapGo may process:

- Account information.
- Phone number.
- Membership status.
- Referral information.
- Wallet and PPOB balances.
- Transaction history.
- Support/contact data.

Payment credentials and gateway secrets are backend-only and are not stored in the Flutter app.

## Production Submission Checklist

1. Confirm latest AAB is release signed.
2. Confirm package name remains `id.tapgolion.tapgo`.
3. Confirm versionCode is higher than the last Play upload.
4. Confirm API base URL uses `https://api.tapgolion.id`.
5. Confirm DOKU webhook UAT has passed.
6. Confirm Midtrans is described only as fallback if still under review.
7. Confirm Xendit is not referenced in app, store listing, screenshots, or payment architecture.
8. Confirm no test credentials or sensitive screenshots are included.

## Reviewer Notes Draft

TapGo is a digital membership application with wallet, PPOB benefit display, referral tracking, and membership checkout. Payment processing for membership checkout is handled through server-side payment gateway integration. TapGo v1.0 uses DOKU as the primary payment gateway, while Midtrans remains prepared as a fallback provider during review. Xendit is not used in TapGo v1.0.
