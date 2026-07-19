# TapGo Phase 6.1 UX Audit & Information Architecture

Status: Sprint 6.1 audit and low-risk usability polish  
Date: 20 Juli 2026  
Scope: Flutter user app source review  
Design freeze: active

## 1. Executive Summary

Current UX maturity: Production Candidate

UX score: 82/100

TapGo sudah memiliki struktur aplikasi yang cukup matang untuk release candidate: flow utama login, dashboard, membership, checkout, payment, wallet, referral, profile, support, dan admin tersedia dalam satu aplikasi dengan pola visual yang konsisten. Phase 5 juga sudah membuat interaction motion lebih rapi dan state feedback lebih mudah dipahami.

Key strengths:

- Dashboard memberi akses cepat ke layanan utama seperti Wallet, Membership, Referral, PPOB, Merchant, Jasa, dan Marketplace.
- Flow membership sampai checkout dan payment sudah linear: pilih paket, isi form, checkout, bayar, sukses.
- Profile/Akun sudah menjadi pusat pengelolaan membership, referral, komisi, rekening bank, legal, support, dan pengaturan.
- State feedback seperti loading, retry, empty, snackbar, dan dialog sudah lebih konsisten setelah Phase 5.
- Admin screens sudah memiliki grouping operasional yang jelas untuk payment, withdrawal, founder, laporan, dan member.

Key weaknesses:

- Beberapa label masih campur Indonesia/Inggris, misalnya `Referral Tree`, `Copy referral link`, `Download Invoice`, `Privacy Policy`, dan `Terms & Conditions`.
- Beberapa icon-only actions membutuhkan label aksesibilitas yang lebih jelas untuk screen reader.
- Profile/Akun memiliki banyak item, sehingga ada potensi information overload walaupun belum boleh direstrukturisasi pada Sprint 6.1.
- Beberapa admin item masih memakai istilah teknis internal seperti `Commission Settings` dan `Membership Package Settings`.
- Runtime behavior seperti large-text wrapping, real keyboard flow, dan focus traversal masih perlu diverifikasi di perangkat.

Highest-risk usability issues:

- Medium: istilah campur Indonesia/Inggris dapat menurunkan kejelasan untuk pengguna awam.
- Medium: icon-only actions kurang ramah screen reader jika tidak memiliki semantic label.
- Low: banyak entry point menuju membership/referral/wallet dapat terasa repetitif, tetapi masih berguna untuk discoverability.

Overall recommendation:

Sprint 6.1 layak melanjutkan low-risk polish berupa standardisasi label, helper text, tooltip/semantic label, dan keyboard/action clarity. Redesign menu, reordering navigasi, atau penyederhanaan flow sebaiknya ditunda ke sprint UX berikutnya setelah Product Owner melakukan runtime verification.

## 2. Audit Method

Screens and code reviewed:

- `SplashGate` and `SplashScreen`
- `AuthScreen`
- `TapGoDashboard`
- Bottom navigation tabs
- Account/Profile section
- `MembershipScreen`
- `MembershipRegistrationScreen`
- `CheckoutScreen`
- `PaymentMethodScreen`
- `PaymentSuccessScreen`
- `ReferralTreeScreen`
- Wallet and withdrawal screens
- Bank account, account deletion, contact/support, help, settings
- Admin dashboard, payment, wallet, withdrawal, broadcast, founder, and report screens

Audit boundaries:

- Source review only. No emulator, screenshot, or video runtime verification was performed.
- No visual redesign, layout hierarchy change, navigation architecture change, color change, icon replacement, or business logic change is allowed.
- Recommendations are limited to wording, semantics, accessible labels, helper text, and tiny UX safeguards.

Confirmed findings are based on code-level evidence in `apps/user_app/lib`. Runtime items requiring Product Owner verification are listed separately and should be checked with `flutter run`.

## 3. User Journey Review

| Journey | Strengths | Pain Points | Severity | Recommendation | Sprint 6.1 Allowed |
|---|---|---|---|---|---|
| Splash -> Login | Splash is direct and avoids debug banner. Startup fail-open work already reduces hang risk. | Runtime startup still depends on device and API availability. | Low | Verify on Android device; no code change in 6.1. | No |
| Login -> Dashboard | Clear login/register switch and backend auth path. Submit guard exists. | Keyboard action flow can be improved further on secondary forms later. | Low | Keep current auth focus flow; test in runtime. | Already improved in Phase 5.6 |
| Registration -> Dashboard | Form validation prevents empty data. Referral field is optional. | Some hints are minimal and may need clearer examples. | Low | Defer broader form microcopy to Sprint 6.2. | No |
| Dashboard -> Feature discovery | Service grid and bottom nav make key features discoverable. | Many service entries are visible; some unavailable services may require clearer expectation. | Medium | Do not restructure; audit labels and unavailable-state wording later. | Partial |
| Membership -> Registration | Linear flow and clear package cards. | Button label `Daftar` is generic but understandable. | Low | Defer package CTA copy test to 6.2. | No |
| Registration -> Checkout | Upload and checkout path is understandable. | WhatsApp preview and download invoice wording should be localized consistently. | Low | Rename user-facing English labels to Indonesian. | Yes |
| Checkout -> Payment | Primary action `Bayar Sekarang` is clear. | Secondary action `Download Invoice` is English. | Low | Rename to `Unduh Invoice`. | Yes |
| Payment -> Success or Failure | Payment screen has status dialog, DOKU fallback text, and success screen. | Failure text uses `gagal/expired`, mixing slash and English. | Low | Rename to `gagal atau kedaluwarsa`. | Yes |
| Referral flow | Referral summary, copy link, and tree view are available. | Screen title `Referral Tree` and button `Copy referral link` are mixed language. | Medium | Rename to `Jaringan Referral` and `Salin link referral`. | Yes |
| Wallet and withdrawal | Wallet balance, transaction history, bank account, and withdrawal request exist. | Withdrawal flow needs runtime verification for keyboard, validation, and confirmation clarity. | Medium | Defer detailed form pass to 6.2. | No |
| Profile and settings | Account section exposes membership, referral, wallet, KYC, legal, support, help, settings. | Many menu items create high cognitive load. | Medium | Do not reorder in 6.1; document for future IA sprint. | No |
| Support/contact | Contact form and help center are accessible from account menu. | Support copy is long in one status surface. | Low | Defer text hierarchy review due design freeze. | No |
| Admin flow | Admin dashboard groups key operations and uses loading/error states. | Some labels remain English/internal. | Medium | Localize low-risk action labels where safe. | Yes |

## 4. Information Architecture Review

Menu grouping:

- Dashboard prioritizes daily actions and feature discovery.
- Account/Profile collects personal, financial, referral, legal, support, and settings actions.
- Admin dashboard groups operational tools by business area.

Screen hierarchy:

- Primary user flow is linear enough: Login/Register -> Dashboard -> Membership -> Registration -> Checkout -> Payment -> Success.
- Account/Profile acts as a secondary hub for management tasks.
- Admin screens are separated by role and not visible to normal users.

Primary versus secondary actions:

- Primary actions such as `Bayar Sekarang`, `Ajukan Withdraw`, `Kirim Pengajuan`, and `Login` are clear.
- Secondary actions like invoice download and WhatsApp notification should be localized.

Naming consistency:

- Confirmed inconsistencies: `Referral Tree`, `Copy referral link`, `Download Invoice`, `Privacy Policy`, `Terms & Conditions`, `Payment Management`, `Wallet Management`, and `Withdrawal Management`.
- Some English product/business terms may remain acceptable if Product Owner wants them as business labels, but consumer-facing Account and Checkout labels should be Indonesian-first.

Feature discoverability:

- Good discoverability through both service grid and Account menu.
- Duplicate entry points are acceptable for now because they help new users find key flows.

Navigation loops and dead ends:

- Most internal screens use `_DemoScaffold` with back handling.
- Success screen returns to dashboard via `popUntil(route.isFirst)`.
- Runtime back-stack verification remains required.

Information overload:

- Account/Profile has many actions in one list. This should be reviewed in a later IA sprint, but not changed in 6.1 because menu reordering is out of scope.

## 5. Accessibility Review

Confirmed code-level findings:

- Several icon-only actions already have `Tooltip`, but some upload/date/source actions can benefit from explicit semantic labels.
- Text fields generally have labels and validation messages.
- Phase 5 reduced-motion helpers are inherited by major motion components.
- Button disabled/loading states are visually clear but should be checked with screen reader semantics in runtime.

Items requiring real-device verification:

- Large font scaling on dashboard service grid, checkout buttons, account list, and admin table-like cards.
- Screen reader announcement order on Account menu, bottom sheets, dialogs, and payment status.
- Touch target comfort for small icon buttons in header/search/date picker entry.
- Keyboard focus behavior for registration, bank account, support, and account deletion forms.

## 6. Prioritized Findings

| Priority | Finding | Affected Screen | User Impact | Evidence | Recommended Action | Target Sprint |
|---|---|---|---|---|---|---|
| Critical | No confirmed critical UX blocker in source audit. | N/A | N/A | Source review | Continue runtime verification. | 6.1 |
| High | Account/Profile menu has many items and may overload first-time users. | Profile/Akun | Users may miss important actions. | Account menu contains membership, referral, wallet, KYC, legal, support, help, settings, logout. | Do not reorder now; plan IA grouping review. | 6.3+ |
| Medium | Mixed English/Indonesian labels. | Referral, Checkout, Profile, Admin | Reduces clarity for Indonesian users. | `Referral Tree`, `Copy referral link`, `Download Invoice`, legal labels. | Localize low-risk labels. | 6.1 |
| Medium | Icon-only actions need stronger accessible labels. | Dashboard/header, registration upload/date actions | Screen reader users may receive unclear action names. | Icon buttons and source list actions. | Add tooltip/semantic label where safe. | 6.1/6.3 |
| Medium | Payment failure copy uses mixed shorthand. | Payment | Error clarity could be better. | `Pembayaran gagal/expired`. | Use plain Indonesian wording. | 6.1 |
| Low | Admin labels use English/internal terms. | Admin Dashboard | Admin clarity impact only. | `Payment Management`, `Withdrawal Management`, `Commission Settings`. | Localize only obvious labels; defer structural admin IA. | 6.2+ |
| Low | Runtime large-text behavior unknown. | All screens | Possible overflow at accessibility text sizes. | Source review only. | Device verification checklist. | 6.3 |

## 7. Low-Risk Fixes Approved for Sprint 6.1

Implemented changes must stay within these safe items:

- Rename `Copy referral link` to `Salin link referral`.
- Rename `Referral Tree` screen title to `Jaringan Referral`.
- Rename `Download Invoice` to `Unduh Invoice`.
- Improve payment pending/failure copy from `gagal/expired` to `gagal atau kedaluwarsa`.
- Add semantic labels/tooltips to low-risk icon-only controls where safe.
- Update tests for changed user-facing labels.

## 8. Deferred Improvements

- Account/Profile IA regrouping.
- Admin terminology review for all English labels.
- Full form helper text review for registration, bank account, support, withdrawal, and account deletion.
- Large text and screen reader audit on device.
- Onboarding/help copy for unavailable services.
- Runtime navigation/back-stack QA.

## 9. Phase 6 Roadmap

### Sprint 6.2 - Form & Input Experience

- Review all forms for field order, helper text, keyboard action, validation clarity, and duplicate submit prevention.
- Focus screens: registration, bank account, withdrawal, support/contact, account deletion.

### Sprint 6.3 - Accessibility

- Add semantic labels and tooltips systematically.
- Verify large font, touch targets, screen reader order, dialogs, bottom sheets, and focus traversal.

### Sprint 6.4 - Empty, Error & Help Experience

- Refine empty, error, offline, retry, and help states without changing layout.
- Improve service unavailable explanations.

### Sprint 6.5 - Copywriting & Microcopy

- Standardize Indonesian terminology across user and admin-facing screens.
- Define TapGo glossary for Membership, Wallet, PPOB, Referral, Bonus, Commission, Reward, and Withdrawal.

### Sprint 6.6 - Final UX QA

- Runtime walkthrough with Product Owner.
- Back-stack, accessibility, large text, slow network, and error-state verification.

## 10. Runtime Verification Checklist

Product Owner should run:

```bash
cd apps/user_app
flutter run
```

Verify changed Sprint 6.1 surfaces:

- Account/Profile shows `Salin link referral`.
- Referral screen title shows `Jaringan Referral`.
- Checkout secondary invoice action shows `Unduh Invoice`.
- Payment status copy uses `gagal atau kedaluwarsa` when applicable.
- Date picker button and upload source actions remain easy to understand.
- Account/Profile still opens Membership, Referral, Wallet, KYC, Rekening Bank, Legal, Hapus Akun, Hubungi Kami, Bantuan, Pengaturan, and Logout.
- No layout, color, icon, illustration, or navigation structure changed.

## 11. Sprint 6.1 Completion Gate

Go for low-risk implementation only.

No UX blocker was found that requires redesign or business-flow changes in Sprint 6.1.
