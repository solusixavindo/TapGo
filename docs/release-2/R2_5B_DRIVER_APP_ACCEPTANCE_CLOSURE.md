# R2.5B-R Driver App Browser Demo and Acceptance Closure

Tanggal: 4 Agustus 2026

Branch: `agent/tapgo-release2-driver-app-mvp-execution`

Baseline awal stage: `1e0d750e16b934f6b56ee22c361545e8fd24f20e`

## Ringkasan

Stage R2.5B-R menutup gap acceptance Driver App MVP dengan tiga lapis bukti:

1. Modularisasi batas fitur agar `main.dart` tidak lagi menjadi file campuran bootstrap, data, state, domain, dan UI.
2. Regression test untuk auth, capability, offer, active ride, single-flight, lifecycle, privacy, responsive, dark mode, dan demo-mode safety.
3. Browser demo aktual dari Flutter Web dengan `TAPGO_DRIVER_DEMO_MODE=true`, screenshot viewport nyata, dan network scan yang membuktikan tidak ada request eksternal.

Tidak ada perubahan pada backend, Prisma, customer app, production config, Maps provider, onboarding/KYC, payment, atau release artifact.

## Arsitektur Driver App

| Area | File |
|---|---|
| Bootstrap | `apps/driver_app/lib/main.dart` |
| Composition dan provider | `apps/driver_app/lib/app/composition.dart` |
| Material app dan theme | `apps/driver_app/lib/app/driver_app.dart` |
| Compile-time config | `apps/driver_app/lib/core/config/app_config.dart` |
| Domain model | `apps/driver_app/lib/features/driver/domain/driver_models.dart` |
| Repository contract | `apps/driver_app/lib/features/driver/data/driver_repository.dart` |
| API repository | `apps/driver_app/lib/features/driver/data/api_driver_repository.dart` |
| Session storage | `apps/driver_app/lib/features/driver/data/session_store.dart` |
| Controller/state | `apps/driver_app/lib/features/driver/application/driver_controller.dart` |
| Location port | `apps/driver_app/lib/features/driver/location/driver_location_port.dart` |
| Presentation | `apps/driver_app/lib/features/driver/presentation/driver_screens.dart` |
| Demo repository | `apps/driver_app/lib/demo/demo_driver_repository.dart` |

## Browser Evidence

Output:

- `docs/release-2/visual-review/r2.5-driver-app/browser/browser_00_login_360x800.png`
- `docs/release-2/visual-review/r2.5-driver-app/browser/browser_01_home_online_360x800.png`
- `docs/release-2/visual-review/r2.5-driver-app/browser/browser_02_offer_available_390x844.png`
- `docs/release-2/visual-review/r2.5-driver-app/browser/browser_03_active_trip_390x844.png`
- `docs/release-2/visual-review/r2.5-driver-app/browser/browser_04_completed_390x844.png`
- `docs/release-2/visual-review/r2.5-driver-app/browser/browser_05_capability_blocked_360x800.png`
- `docs/release-2/visual-review/r2.5-driver-app/R2_5_DRIVER_APP_CONTACT_SHEET.png`

Network proof:

- Total request: 73
- Localhost request: 73
- External request: 0
- External domains: none
- API/backend/maps/geocoding/analytics/provider request: 0

## Acceptance Traceability

| No | Acceptance item | Evidence | Status |
|---:|---|---|---|
| 1 | Driver app has isolated Flutter package identity | `apps/driver_app/android/app/build.gradle.kts` | PASS |
| 2 | Android package is `com.xavindo.tapgo.driver` | APK badging/source inspection | PASS |
| 3 | App label is TapGo Driver | Android manifest/source inspection | PASS |
| 4 | Release build does not fallback to debug signing | `build.gradle.kts` release block has no debug signing config | PASS |
| 5 | `main.dart` is bootstrap-only | `apps/driver_app/lib/main.dart` | PASS |
| 6 | Feature boundaries are separated | `app/`, `core/`, `demo/`, `features/driver/` | PASS |
| 7 | Backend source is untouched | zero diff against `apps/backend/` | PASS |
| 8 | Prisma source is untouched | zero diff against `apps/backend/prisma/` | PASS |
| 9 | Customer app source is untouched | zero diff against `apps/user_app/` | PASS |
| 10 | No Maps/provider integration | `NoDriverLocationPort` fail-closed | PASS |
| 11 | No onboarding/KYC implementation | route inventory and source diff | PASS |
| 12 | Login screen renders safely | `browser_00_login_360x800.png` | PASS |
| 13 | Session restore opens workspace | `widget_test.dart` session valid test | PASS |
| 14 | Logout clears local session | `widget_test.dart` logout test | PASS |
| 15 | Invalid session fail-closed | `widget_test.dart` invalid/stale token tests | PASS |
| 16 | Profile required blocked state | `widget_test.dart`, visual evidence | PASS |
| 17 | Pending driver blocked state | `widget_test.dart` capability matrix | PASS |
| 18 | Suspended driver blocked state | `browser_05_capability_blocked_360x800.png` | PASS |
| 19 | Rejected driver blocked state | `widget_test.dart` capability matrix | PASS |
| 20 | Account inactive blocked state | `widget_test.dart` capability matrix | PASS |
| 21 | Online availability action is single-flight | `widget_test.dart` availability test | PASS |
| 22 | Offline to online mapping uses explicit enum | `DriverAvailability.online` test | PASS |
| 23 | Offer empty state is safe | `visual_evidence_test.dart` | PASS |
| 24 | Offer available renders in realistic viewport | `browser_02_offer_available_390x844.png` | PASS |
| 25 | Offer detail can be opened | `widget_test.dart` offer tile interaction | PASS |
| 26 | Accept offer is single-flight | `widget_test.dart` accept test | PASS |
| 27 | Reject offer removes local offer | `widget_test.dart` reject test | PASS |
| 28 | Taken/expired offer fails closed | `widget_test.dart` `RIDE_ALREADY_TAKEN` test | PASS |
| 29 | Current ride restores for driver | `widget_test.dart` active ride restore test | PASS |
| 30 | Active trip screen renders | `browser_03_active_trip_390x844.png` | PASS |
| 31 | Completed trip screen renders | `browser_04_completed_390x844.png` | PASS |
| 32 | Unknown status disables primary action | `widget_test.dart` unknown status test | PASS |
| 33 | Terminal status disables primary action | `widget_test.dart` completed status test | PASS |
| 34 | Pickup action calls correct repository method | `widget_test.dart` lifecycle action test | PASS |
| 35 | Arrived action calls correct repository method | `widget_test.dart` lifecycle action test | PASS |
| 36 | Start trip action calls correct repository method | `widget_test.dart` lifecycle action test | PASS |
| 37 | Complete trip action calls correct repository method | `widget_test.dart` lifecycle action test | PASS |
| 38 | Cancel trip action calls correct repository method | `widget_test.dart` cancel action test | PASS |
| 39 | Lifecycle resume refreshes exactly once | `widget_test.dart` app lifecycle test | PASS |
| 40 | Passenger PII is not rendered | `widget_test.dart` privacy test | PASS |
| 41 | Tokens/passwords are not rendered | `widget_test.dart` privacy test | PASS |
| 42 | Demo selector/banner are excluded in normal build | `widget_test.dart` normal build test | PASS |
| 43 | Demo mode performs no network calls | browser network scan and demo repository test | PASS |
| 44 | Responsive 320/360/390/412 viewport has no overflow | `widget_test.dart`, `visual_evidence_test.dart` | PASS |
| 45 | Dark theme and minimum touch target remain usable | `widget_test.dart` dark theme test | PASS |

## Responsive Matrix

| Viewport | Evidence |
|---|---|
| 320x640 | `15_width_320x640.png` |
| 360x800 | `browser_00_login_360x800.png`, `browser_01_home_online_360x800.png`, `browser_05_capability_blocked_360x800.png` |
| 390x844 | `browser_02_offer_available_390x844.png`, `browser_03_active_trip_390x844.png`, `browser_04_completed_390x844.png` |
| 412x915 | `widget_test.dart` responsive test |

## Normal Build Exclusion

Normal driver builds do not show:

- demo scenario selector;
- `DEMO DATA` banner;
- demo query behavior;
- backend/provider mock controls.

The demo query parameter is guarded by `kDriverDemoMode` and resolves to login in normal builds.

## Known Deferred Scope

The following remain intentionally deferred from R2.5B-R:

- real driver onboarding/KYC;
- Maps/geocoding/provider integration;
- production location streaming;
- release signing setup;
- Play/App Store distribution artifacts;
- push notification/provider events;
- R2.6 work.

## Final Gate

R2.5B-R is ready for owner review when:

- all automated validation passes;
- browser screenshots are committed;
- network scan remains external `0`;
- no production source outside `apps/driver_app/` and `docs/release-2/visual-review/r2.5-driver-app/` is changed.
