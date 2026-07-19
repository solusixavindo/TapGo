# Internal Testing Upload Steps - TapGo

Tanggal: 15 Juli 2026

## Do Not Commit

Do not commit or upload to Git:

- `apps/user_app/build/app/outputs/bundle/release/app-release.aab`
- `apps/user_app/android/key.properties`
- `apps/user_app/android/keystore/`
- `.env` files
- Reviewer password

## Pre-Upload Checklist

1. Confirm branch: `release/google-play-readiness`.
2. Confirm final AAB path:
   `apps/user_app/build/app/outputs/bundle/release/app-release.aab`
3. Confirm SHA-256 from `FINAL_PRE_UPLOAD_GATE.md`.
4. Confirm Play Console account is Organization if required for financial features.
5. Confirm App Content is filled:
   - Privacy Policy
   - Data Safety
   - Account deletion
   - App access
   - Financial features
   - Content rating
   - Target audience
6. Confirm reviewer access is set in Play Console App Access.

## Upload Flow

1. Open Google Play Console.
2. Select TapGo app.
3. Open `Testing` -> `Internal testing`.
4. Create a new release.
5. Upload:
   `apps/user_app/build/app/outputs/bundle/release/app-release.aab`
6. Add release notes from:
   `docs/google-play/RELEASE_NOTES_v1.0.3.md`
7. Review warnings.
8. Do not ignore financial/account/policy warnings.
9. Save and submit for Internal Testing review.

## Post-Upload

1. Record uploaded version:
   - versionName: `1.0.3`
   - versionCode: `4`
2. Next AAB after this upload must use `versionCode=5`.
3. Install as tester and run:
   - fresh install
   - login/register
   - dashboard
   - membership package
   - checkout
   - wallet
   - referral
   - account deletion screen
   - privacy policy and terms

## Rollback

If the internal testing release has a blocker:

1. Stop rollout / deactivate release in Internal Testing if available.
2. Keep current branch unchanged.
3. Patch only the blocker.
4. Increment versionCode.
5. Rebuild AAB.
6. Re-run `FINAL_PRE_UPLOAD_GATE`.
