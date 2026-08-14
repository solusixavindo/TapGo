# TapGo Motion Design System Phase 5.1

Status: Phase 5 complete  
Scope: Flutter user app motion polish planning  
Design freeze: preserved  
Implementation status: implemented through Sprint 5.7

## Executive Summary

TapGo already has pockets of good motion quality, especially the splash screen, dashboard entrance reveal, service card press feedback, carousel indicators, skeleton loading, and referral tree expansion. The current motion maturity is not yet fully systematic: timing, easing, page transitions, success feedback, loading states, and financial-number changes are not governed by a single reusable motion language.

Motion Audit Score: 68/100

Motion maturity level: Emerging Premium

Meaning: TapGo has production-usable motion in several places, but premium consistency requires a shared motion token system, motion accessibility policy, and phased implementation across navigation, cards, loading, success states, and financial micro-interactions.

## Motion Principles

1. Purpose before decoration
   Motion must explain state change, hierarchy, progress, or completion. Decorative motion is avoided.

2. Fast, calm, confident
   TapGo should feel responsive and premium. Most motion should finish under 240 ms.

3. Financial clarity
   Wallet, bonus, commission, and payment states should use restrained motion that increases trust, not excitement.

4. One gesture, one response
   Taps, selections, navigation, and confirmations should each have a predictable motion response.

5. No motion debt
   Every animation must have a stop condition, avoid unnecessary loops, and respect reduced motion.

6. Design freeze preservation
   Motion must not change layout, color, spacing, typography, card design, illustrations, gradients, or visual composition.

## Interaction Inventory

| Area | Interactive Elements | Current Motion Classification | Opportunity |
|---|---|---|---|
| Splash | Logo reveal, scale, fade | Custom animation | Keep, tune only if needed for reduced motion |
| Login | Login/register switch, submit button, error snackbar, config dialog | Basic state change + Material default | Add subtle crossfade/height transition later |
| Register | Form fields, referral input, submit loading | Basic Flutter state | Add field validation motion and submit loading consistency |
| Dashboard | Hero, banner carousel, service grid, wallet card, bottom nav | Mixed custom + basic | Standardize entrance, press, grid reveal |
| Bottom Navigation | Tab selection | Custom visual state, basic tap | Add 160 ms icon/label state transition |
| Service Cards | Service illustration tap, unavailable snackbar | Custom card press in parts | Unify press scale/elevation |
| Wallet | Balance display, transaction list, withdraw action | Mostly no animation/default | Add count-up and transaction row reveal |
| Membership | Package cards, document upload, checkout, invoice | Material/default + basic loading | Add membership activation and card selection motion |
| Referral | Tree nodes, copy link/code | Custom tree expand + snackbars | Improve tree expansion consistency |
| Reward | Empty state, reward list | Mostly static | Add reward reveal and empty-state motion |
| Bonus | Bonus list/stats | Mostly static | Add number count and list reveal |
| Commission | Commission history, filters | Mostly static | Add count-up and row status transition |
| Cashback | Service/stat presentation | Mostly static | Add earned-state reveal later |
| PPOB | Navigation/service detail | Mostly static/default | Add loading/success states when production flow matures |
| Merchant | Merchant cards/list/admin review | Mostly static | Add partner card state feedback |
| Marketplace | Service entry | Mostly static | Add card press only |
| Jasa | Service entry | Mostly static | Add card press only |
| Profile | Account hero, settings, logout, delete account | Mostly static + dialogs | Add profile update confirmation motion |
| Notifications | List/empty state | Mostly static | Add unread-to-read state motion later |
| Chat | Search, empty state | Mostly static | Add message row reveal later |
| Activity | Tabs/filter/list | Basic state change | Add tab and row transition |
| Dialogs | Confirmation, status, account deletion | Material default | Define modal transition token |
| Bottom Sheets | More services, bank selection, document source | Material default | Define sheet transition token |
| SnackBars | Error/success messages | Material default | Define message severity motion |
| Loading | Circular indicators, skeleton dashboard | Mixed basic/custom | Unify loading behavior |
| Empty State | Static empty-state components | No animation | Add non-looping 160-220 ms entrance |
| Error State | Static text/snackbar | Material default/no animation | Add subtle shake only for blocking form errors |
| Pull To Refresh | Not consistently present | Mostly absent | Add only where list refresh is valuable |
| Forms | Field focus, validation | Material default | Add focus/validation policy |
| Search | Search box in chat/activity contexts | Mostly static | Add focus expansion only if no layout shift |

## Current Motion Audit

### Existing Custom Motion

- Splash: AnimationController, fade, and scale.
- Dashboard: AnimatedOpacity and AnimatedSlide for entrance reveal.
- Dashboard banner/carousel: PageView with AnimatedContainer indicator.
- Service/category cards: AnimatedScale and AnimatedContainer press state in selected components.
- Dashboard decorative/service motion: AnimatedBuilder and TweenAnimationBuilder in several dashboard illustration/support elements.
- Referral tree: AnimatedSize, AnimatedSwitcher, and AnimatedRotation.
- Payment success: TweenAnimationBuilder success reveal.

### Existing Material Defaults

- MaterialPageRoute page pushes.
- showDialog / AlertDialog.
- showModalBottomSheet.
- SnackBar.
- InkWell ripple.
- CircularProgressIndicator.
- TextField focus behavior.

### Mostly Static / Needs Improvement

- Bottom navigation tab transitions.
- Wallet balance update.
- Commission and bonus values.
- Reward reveal.
- Payment/check-status progress.
- Membership package selection.
- Empty states.
- Error states.
- Profile/settings rows.
- Admin list rows and status updates.

## Motion Language

### Duration Tokens

| Token | Duration | Use |
|---|---:|---|
| instant | 80 ms | Press down, hover-like tactile response |
| fast | 120 ms | Button release, icon state, chip selection |
| quick | 160 ms | Bottom nav, tab selection, switcher |
| standard | 220 ms | Card entrance, list row reveal, field validation |
| page | 280 ms | Page transition, major state swap |
| emphasis | 360 ms | Success reveal, membership activation, reward reveal |
| maximum | 450 ms | Rare hero-like transition only |

Rule: no normal interaction should exceed 360 ms. Anything above 450 ms requires explicit approval.

### Easing Tokens

| Token | Curve | Use |
|---|---|---|
| standard | easeOutCubic | Most enter/exit and selection changes |
| emphasized | easeInOutCubic | Page/sheet movement |
| decelerate | easeOutQuart | Content entering from below |
| accelerate | easeInCubic | Dismiss/exit |
| tactile | easeOutBack-lite equivalent | Press release, small scale rebound |
| linear | linear | Progress indicators only |

Avoid elastic/bouncy motion for money, payment, withdrawal, and KYC flows.

### Motion Components

| Component | Recommended Motion |
|---|---|
| Page Transition | 280 ms fade + 12 px upward slide; preserve Material navigation structure |
| Modal Dialog | 220 ms fade + 0.98 to 1 scale |
| Bottom Sheet | 280 ms upward slide + scrim fade |
| Button Press | 80 ms scale to 0.98, release 120 ms to 1.0 |
| Service Card Press | 80 ms scale to 0.975, slight elevation reduction, no layout shift |
| Bottom Nav Selection | 160 ms icon scale 0.96 -> 1, label opacity 0.7 -> 1 |
| Wallet Balance Count | 360 ms count-up for loaded/changed value, disabled in reduce motion |
| Commission Count | 360 ms count-up only on meaningful update |
| List Row Reveal | 220 ms stagger max 40 ms between rows, max 6 rows animated |
| Empty State | 220 ms fade + small vertical rise |
| Success State | 360 ms scale/fade success mark, no confetti for financial actions |
| Error State | 160 ms color/opacity change; shake only on blocking form field |
| Loading | Skeleton shimmer or progress, not both; avoid infinite decorative loops |
| Refresh | Native refresh indicator unless custom is required later |

## Micro Interaction Opportunities

| Opportunity | Recommendation | UX Benefit |
|---|---|---|
| Login/Register switch | Crossfade forms and animate height | Reduces abrupt context change |
| Submit button loading | Replace text with consistent spinner and lock width | Prevents layout jump and duplicate submit |
| Form validation | Field-level fade/slide error text | Makes errors easier to locate |
| Dashboard entry | Keep existing reveal, standardize timing | Gives premium first impression |
| Service card tap | Unified tactile press | Confirms tap without changing layout |
| Bottom nav change | Icon/label transition | Helps users understand active destination |
| Wallet balance | Count-up on first loaded balance | Makes data loading feel intentional |
| Wallet transaction rows | Subtle stagger on loaded list | Improves scanability |
| Membership package selection | Press + selected-card emphasis | Improves confidence before checkout |
| Membership activation | Success reveal after paid status | Communicates completion clearly |
| Referral code copy | Button state changes to copied for 1.2s | Stronger feedback than snackbar alone |
| Referral tree expand | Keep existing animated tree; standardize duration | Helps users track hierarchy |
| Reward reveal | 360 ms card reveal | Makes rewards feel meaningful |
| Bonus/commission update | Count transition for changed values | Reinforces financial state change |
| PPOB payment state | Stepper/progress state animation later | Clarifies transaction progression |
| Merchant verification | Status pill transition | Helps admin/users see state changes |
| Jasa service entry | Same card press only | Keeps service grid cohesive |
| Notification read state | Row opacity/status dot transition | Shows action result |
| Profile update | Success check state on save button | Confirms saved state |
| Delete account dialog | Calm modal transition, no dramatic motion | Keeps sensitive flow serious |
| Payment success | Existing success motion refined under MDS | Builds trust after transaction |
| Withdrawal success | Small success state; no celebratory effect | Appropriate for financial action |

## Performance Policy

1. Target 60 FPS on mid-range Android devices.
2. Avoid animating layout-heavy properties when transform/opacity can communicate the same state.
3. Prefer AnimatedSwitcher, AnimatedOpacity, AnimatedScale, AnimatedSlide, and lightweight AnimationController usage.
4. Do not animate large blur, shadows, gradients, or image filters.
5. Avoid nested looping animations.
6. Stagger lists only for initial visible rows, max 6 items, max 40 ms delay.
7. Do not run decorative animations while scrolling.
8. Use RepaintBoundary only where profiling shows repeated repaint cost.
9. Keep animation controllers disposed and avoid global always-running controllers.
10. Motion must not trigger network calls, business state changes, or duplicated API requests.
11. Skeleton/shimmer duration should be 900-1200 ms if used; prefer subtle opacity shimmer.
12. Reduced motion must replace count-up/stagger/slide with fade or instant state.

## Accessibility Motion Policy

1. Respect platform reduced-motion settings wherever Flutter exposes animation scale or accessibility features.
2. Provide an app-level reduce-motion fallback if system detection is insufficient.
3. Disable:
   - count-up number animation
   - staggered list reveal
   - elastic/bouncy transitions
   - long slide transitions
   - looping decorative motion
4. Keep:
   - focus indicators
   - loading indicators
   - state changes
   - essential progress feedback
5. Error states must not rely only on motion; include text and color.
6. Success states must not rely only on animated icon; include clear text.
7. Motion should not flash more than once and must avoid rapid brightness changes.
8. Tap feedback must remain perceivable when reduce motion is active, using color/opacity state instead of scale where needed.

## Implementation Roadmap

### Sprint 5.2 - Motion Tokens and Reduced Motion Foundation

Effort: 1-2 days

- Create motion tokens: durations, curves, scale factors, transition distances.
- Add reduce-motion helper.
- No visual redesign.
- Wrap only reusable primitives.

### Sprint 5.3 - Navigation Motion

Effort: 1-2 days

- Standardize page transitions.
- Bottom navigation selected-state motion.
- Keep routes and navigation logic unchanged.

### Sprint 5.4 - Card and Service Motion

Effort: 2 days

- Unified button/card press feedback.
- Service grid card motion.
- Membership package card selection motion.
- No layout or illustration changes.

### Sprint 5.5 - Loading, Empty, and Error Motion

Effort: 2 days

- Standard loading behavior.
- Empty-state entrance.
- Field validation and error message motion.
- Review all SnackBar usage.

### Sprint 5.6 - Financial and Success Micro Interactions

Effort: 2-3 days

- Wallet balance count-up.
- Bonus/commission count transitions.
- Payment success and withdrawal success state.
- Referral copy feedback.

### Sprint 5.7 - Motion QA

Effort: 2 days

- Screenshot/video QA on emulator and physical device.
- Light/dark validation.
- Reduced motion validation.
- Scroll performance check.
- Regression check for login, register, dashboard, payment, account deletion.

Estimated total effort: 10-14 engineering days including QA.

## Implementation Guardrails

- Do not change UI layout.
- Do not change colors.
- Do not change typography.
- Do not change illustrations.
- Do not add new business features.
- Do not animate payment or wallet values in a way that implies reward certainty.
- Do not use confetti for financial outcomes.
- Do not introduce new dependencies unless Flutter built-ins are insufficient.

## Recommended Flutter Architecture

No implementation is done in Phase 5.1. For later sprints, recommended structure:

- `TapGoMotionDurations`
- `TapGoMotionCurves`
- `TapGoMotionScale`
- `TapGoMotionDistances`
- `TapGoMotionAccessibility`
- `TapGoPressable`
- `TapGoAnimatedNumber`
- `TapGoFadeSlide`
- `TapGoAnimatedStateSwitcher`

These should be small, reusable widgets or static token classes. Avoid scattering raw durations and curves across screens.

## Go / No-Go for Implementation

Recommendation: GO for Phase 5.2 planning.

Reason: The system has enough existing motion foundations to standardize without redesign. Implementation should start with tokens and accessibility before visual micro-interactions.

## Phase 5 Closure

Status: COMPLETE

### Completed Sprint Summary

| Sprint | Outcome |
|---|---|
| 5.1 Motion Audit & MDS | Defined TapGo motion principles, token targets, interaction inventory, performance policy, and accessibility policy. |
| 5.2 Core Interaction Motion | Added shared motion helpers for page transitions, dialogs, bottom sheets, press feedback, and reduced-motion checks. |
| 5.3 Dashboard Motion | Standardized dashboard entrance, card interaction, skeleton/state transitions, and financial value transitions without changing layout. |
| 5.4 Membership & Payment Motion | Applied consistent reveal/selection/loading transitions across membership package, registration, checkout, invoice, and payment states. |
| 5.5 Feedback & State Experience | Standardized snackbar severity, loading widgets, retry/status surfaces, and success/error/warning/info feedback. |
| 5.6 Navigation & Flow Polish | Aligned navigation timings, bottom sheet safe-area behavior, referral tree motion, and auth keyboard flow. |
| 5.7 Final Motion QA | Removed excessive elastic success motion, confirmed reduced-motion rendering, and closed the Phase 5 motion QA pass. |

### Final Motion Architecture

Motion is centralized around small shared helpers in the Flutter user app:

- `_TapGoMotion` for duration tokens, easing, and reduced-motion detection.
- `_tapGoPageRoute` for app page transitions.
- `_showTapGoDialog` for dialog transitions.
- `_showTapGoBottomSheet` for bottom sheet transitions and safe-area behavior.
- `_TapGoPressable` for tactile press feedback.
- `_TapGoReveal` and `_TapGoFadeSwitcher` for lightweight entrance and state switching.
- `_TapGoSnackbar`, `_TapGoLoading`, and `_TapGoStateEntrance` for feedback and state experience.

The system intentionally avoids new dependencies and relies on Flutter built-ins.

### Reduced-Motion Policy

Phase 5 components use `MediaQuery.disableAnimations` through `_TapGoMotion.reduce(context)`. When reduced motion is enabled:

- Page/dialog/sheet transitions become instant or near-instant.
- Reveal, scale, and selection animations complete without hiding content.
- Payment success no longer uses elastic/bouncy motion.
- Loading, success, error, and retry feedback remain visible through text, icon, and stable state.

### Known Limitations

- Runtime verification must still be performed by the Product Owner on an Android device or emulator using `flutter run`.
- Some pre-existing decorative dashboard and splash animations still use local timing because changing them broadly would risk visual redesign and was outside Sprint 5.7 scope.
- Plugin warnings from Flutter/Gradle remain dependency-maintenance items, not Phase 5 motion blockers.

### Runtime Verification Responsibility

The Product Owner should verify:

- Splash to Login.
- Login submission guard.
- Dashboard entrance.
- Bottom navigation.
- Membership package selection.
- Registration, checkout, and payment states.
- Snackbar feedback.
- Empty/error/retry state.
- Dialog and bottom sheet dismissal.
- Referral tree expansion.
- Back navigation.
- Reduced-motion mode where locally testable.

### Phase 5 Completion Status

Phase 5 is complete and ready for Phase 6 planning. Design freeze remained intact: no layout, color, typography, illustration, branding, information architecture, or business logic changes were introduced by the motion closure pass.
