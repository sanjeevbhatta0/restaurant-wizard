# Koda Carte — Production Readiness Checklist

> Track all items that must be completed before going fully live.
> Last updated: 2026-04-13

---

## Domain & Hosting

- [x] Domain `kodacarte.com` registered on GoDaddy
- [x] Firebase Hosting connected to production project (`kodacarte-861d8`)
- [x] DNS fully propagated and ACME SSL verified for `kodacarte.com`
- [x] `www.kodacarte.com` redirect to `kodacarte.com`
- [x] Custom domain self-service for restaurant websites (Website Builder UI + Cloud Functions)
- [x] Firebase Hosting rewrites fixed for v2 Cloud Functions (`run` instead of `function`)
- [x] Customer-facing restaurant website serving via custom domain (verified with `nepalibhasa.com`)

## Authentication & Security

- [x] Admin portal login working (production)
- [x] Restaurant admin signup/login working (production)
- [x] Firestore security rules hardened — tenant isolation, admin-only writes, field validation, deny-all fallback (2026-04-11)
- [x] Storage security rules hardened — SVG removed, split write/delete, social-posts read restricted (2026-04-11)
- [x] Rate limiting on public Cloud Functions — `lookupStaffEmail`, `submitReview`, `sendVerificationCode`, `submitContactForm` (2026-04-11)
- [x] XSS prevention — query params sanitized, `EMBED_CONFIG` uses `JSON.stringify()`, `templateId` whitelisted (2026-04-11)
- [x] Server-side price verification on `createTierPayment` — amount computed from `platformConfig`, not client (2026-04-11)
- [x] Server-side tax rate on `submitOrder` — read from Firestore, not client `orderData.taxRate` (2026-04-11)
- [x] Auth required on `createTerminalConnectionToken` / `createTerminalLocation` — removed `request.data.uid` fallback (2026-04-11)
- [x] `uploadTemplate` restricted to platform admins only — prevents supply-chain XSS (2026-04-11)
- [x] Cryptographic randomness for OTP, 2FA backup codes, promo codes — `Math.random()` → `crypto.randomInt()` (2026-04-11)
- [x] Error message leaks fixed — `getMenu`, `submitOrder`, `createStaffAccount` use `safeError()` (2026-04-11)
- [x] Hardcoded Firebase API key fallback removed from `functions/index.js` (2026-04-11)
- [x] Preview mode secured — requires restaurant ID token instead of `?preview=true` (2026-04-11)
- [x] `.env` / `.env.production` added to `.gitignore` (2026-04-11)
- [ ] Switch Stripe from test keys to live keys in production (currently live keys set via secrets)
- [ ] Verify Stripe live mode works end-to-end (signup payment, POS payment, refund)
- [ ] Move Firebase API keys to environment-only in frontend (not in `src/firebase.js` source code)
- [ ] Enable Firebase App Check for production
- [ ] Sanitize `aboutContent` HTML with server-side sanitizer (currently raw HTML from restaurant owner)
- [ ] Sign Google OAuth `state` parameter with HMAC (currently base64-only, Twitter flow already uses signed state)

## Email & Notifications

- [x] Resend API key configured (both dev + prod)
- [x] Twilio credentials configured (both dev + prod)
- [x] Welcome email sent on restaurant signup (Firestore trigger)
- [x] Welcome SMS sent on restaurant signup (if phone provided)
- [ ] Verify `kodacarte.com` domain in Resend dashboard (to send from `support@kodacarte.com`)
- [ ] Update email sender from `onboarding@resend.dev` to `support@kodacarte.com` after domain verification
- [x] Customer phone verification via OTP (Twilio SMS) — **BYPASSED**: `skipPhoneVerification` flag active while Twilio toll-free pending
- [x] Order receipt email/SMS to customers (auto on completion)
- [ ] Password reset email customization
- [ ] Upgrade Twilio from trial to paid account (trial has sending restrictions)
- [ ] Purchase a Twilio phone number (current number may be personal — need dedicated Twilio number)
- [ ] Complete Twilio toll-free number verification (currently pending — SMS sending blocked)
- [ ] Remove `skipPhoneVerification` bypass once Twilio toll-free is verified (currently defaults to `true` in `serveWebsite` templateData; set `skipPhoneVerification: false` in restaurant website settings in Firestore to re-enable OTP)

## Payments

- [x] Stripe test integration working (POS, signup, refunds)
- [x] Stripe live keys set via Firebase Secrets
- [x] Stripe Terminal Cloud Functions deployed (connection token, locations, readers, payment intents)
- [x] Signup pricing reads from admin config (platformConfig/current) instead of hardcoded values (2026-04-11)
- [x] Free trial support in signup flow — admin-configurable per tier, sets status='trialing' with trialEnd (2026-04-11)
- [x] Subscription expiration enforcement — checks currentPeriodEnd + 3-day grace, trial expiry (2026-04-11)
- [x] Expiration/trial banners in Layout — warns users when trial or billing period ending soon (2026-04-11)
- [x] Plan upgrade creates Stripe PaymentIntent with prorated charge (2026-04-11)
- [x] Plan downgrade scheduled for end of billing period (pendingDowngrade field) (2026-04-11)
- [x] createPlanUpgradePayment Cloud Function added for upgrade payments (2026-04-11)
- [x] Stripe Subscriptions for recurring billing — `createStripeSubscription`, `activateTrialSubscription`, `updateSubscriptionPlan` Cloud Functions (2026-04-13)
- [x] Stripe webhook handler (`stripeWebhook`) for subscription lifecycle — invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted (2026-04-13)
- [x] Free trial collects card via SetupIntent (no charge until trial ends) (2026-04-13)
- [x] Discounts applied consistently on Pricing page, Signup page, Account page, and server-side (Stripe Coupons) (2026-04-13)
- [x] Plan upgrade uses Stripe subscription update with `proration_behavior: 'always_invoice'` (2026-04-13)
- [x] Plan downgrade scheduled at period end, applied by webhook on renewal (2026-04-13)
- [x] Stripe Products/Prices created dynamically and cached in `platformConfig/stripeProducts` and `platformConfig/stripePrices` (2026-04-13)
- [x] 49 subscription billing tests — discounts, proration, trial, webhook, multi-location, pricing consistency (2026-04-13)
- [ ] **Set `STRIPE_WEBHOOK_SECRET`** in both dev and prod — `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project <project>`
- [ ] **Configure Stripe webhook endpoint** in Stripe Dashboard → URL: `https://<functions-url>/stripeWebhook`, events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] **Deploy new subscription Cloud Functions** to dev and prod — `createStripeSubscription`, `activateTrialSubscription`, `updateSubscriptionPlan`, `stripeWebhook`
- [ ] Test live Stripe end-to-end: subscription signup, trial signup, upgrade, downgrade, renewal, failed payment
- [ ] Validate Stripe Terminal integration with physical reader hardware
- [ ] Test Stripe Terminal payment flow: register reader, create payment intent, process card-present payment
- [ ] Stripe Connect: validate connected account onboarding and payouts for multi-restaurant

## Delivery (DoorDash Drive)

- [x] DoorDash Drive sandbox integration complete (5 Cloud Functions + webhook)
- [x] Delivery quote, acceptance, tracking, and cancellation flows working
- [x] DoorDash webhook processing with status updates
- [x] Quote expiry fix: accept-before-create, auto re-quote with 20% fee threshold
- [x] Frontend quote expiration timer (4.5 min) with refresh UI
- [x] DoorDash secrets configured in both dev and prod (sandbox keys)
- [ ] Switch DoorDash from sandbox to production credentials
- [ ] Register production webhook URL with DoorDash Developer Portal
- [ ] Test live delivery end-to-end with real DoorDash driver

## Customer Portal & Ordering

- [x] Website builder with 4 templates (modern-bistro, italian-trattoria, fresh-cafe, warm-spice)
- [x] Widget embed mode working
- [x] Online ordering via portal (prepaid + pay-at-store)
- [x] Order receipt email/SMS on completion (Firestore trigger)
- [x] Promotions & rewards (loyalty points, spin wheel)
- [x] Portal parity maintained between Website Builder and Widget embed modes
- [ ] Customer promotional SMS opt-in / opt-out
- [x] Test ordering flow on all 4 templates (modern-bistro, italian-trattoria, fresh-cafe, warm-spice)
- [x] Test widget ordering on external site

## Features & Quality

- [x] Onboarding guide for new restaurant admins
- [x] Admin Users dashboard with real data
- [x] Admin Metrics dashboard with real data (removed mock data)
- [x] Multi-location support (menu, orders, analytics, table layout, website per location)
- [x] AI analytics and content generation (Gemini API)
- [x] Review management (Yelp, Google Business)
- [x] Fix ~20 ESLint warnings (unused variables, missing deps)
- [x] Upgrade React 17 → React 18 (using `createRoot` API)
- [x] Upgrade Firebase CLI to v15.13.0
- [x] Upgrade Node.js in functions from 20 to 22
- [x] Instagram posting implementation
- [x] Twitter/X posting implementation
- [x] Contact form email notification to `sanjeev@kodacarte.com`

## Printer Integration (Receipts)

- [x] Research receipt printer SDKs (Star Micronics, Epson ePOS, ESC/POS protocol)
- [x] Add printer connection settings to Account page (USB, Bluetooth, Network options)
- [x] Build receipt print template (match email receipt design)
- [x] Auto-print receipt on order completion (configurable per restaurant)
- [x] Kitchen ticket printing from Kitchen display
- [ ] Test with physical receipt printer hardware

## Legal & Compliance

- [x] Privacy Policy page complete and accurate
- [x] Terms of Service page
- [x] Cookie consent banner
- [x] GDPR/CCPA data handling disclosure
- [ ] Stripe PCI compliance documentation

## Analytics & Monitoring

- [x] Platform analytics tracking (page views, signups, orders)
- [x] Set up error monitoring (Sentry)
- [x] Set up uptime monitoring for production URL
- [x] Google Analytics / Search Console for `kodacarte.com`
- [x] Firebase Performance Monitoring enabled

## Testing

- [x] 1695 tests passing across 53 test suites (updated 2026-04-11)
- [x] E2E tests with Firebase emulators (POS, widget, website, delivery)
- [x] Delivery quote expiry tests (unit + integration)
- [x] Full manual test of all flows on production
- [x] Load testing for concurrent orders
- [x] Mobile responsiveness testing across devices
- [x] Cross-browser testing (Chrome, Safari, Firefox, Edge)

## Launch Prep

- [x] Landing page redesigned (features showcase, why us section)
- [x] Real customer testimonials
- [x] Marketing website copy final review
- [x] SEO meta tags on all public pages
- [x] Social media accounts created and linked
- [ ] Support email inbox monitored (`support@kodacarte.com`)
- [x] Backup and disaster recovery plan for Firestore data

---

## Fix & Test Log

### 2026-04-11 — Stripe Payment Architecture Fixes

**Issues Identified:**
1. Signup pricing was hardcoded in `stripeService.js` — admin config changes had no effect on signup
2. Free trial config existed in admin but was never used during signup
3. Subscription expiration (currentPeriodEnd) was saved but never enforced
4. Plan upgrades/downgrades bypassed payment — just wrote to Firestore
5. No user-facing warnings for expiring subscriptions or trials

**Fixes Applied:**
| # | Fix | Files Changed |
|---|-----|---------------|
| 1 | `calculateTierPrice` now accepts optional `adminConfig` param; Signup fetches live config from `platformConfig/current` | `stripeService.js`, `Signup.js` |
| 2 | Added `handleTrialSignup()` — when admin enables free trial for a tier, signup skips payment and sets `status: 'trialing'` with `trialEnd` | `Signup.js` |
| 3 | `isSubscriptionActive()` now checks `currentPeriodEnd` (3-day grace) and `trialEnd`; added `isSubscriptionExpired()` and `getDaysRemaining()` | `SubscriptionContext.js` |
| 4 | Upgrades create a prorated Stripe PaymentIntent via new `createPlanUpgradePayment` Cloud Function; downgrades save `pendingDowngrade` to take effect at period end | `Account.js`, `functions/index.js` |
| 5 | Layout shows red banner when expired, amber banner when trial/billing period ending within 7/5 days | `Layout.js` |

**Firebase initialization fix (from earlier session):**
- Reordered `src/firebase.js`: emulator connections now happen BEFORE `enableMultiTabIndexedDbPersistence` (was causing "Firestore has already been started" crash)

**Test Results (2026-04-11):**
- `npm run test:ci`: **53 suites passed, 1695 tests passed, 156 skipped (E2E)** — PASS
- `stripeService.test.js`: 14/14 passed — backward-compatible `calculateTierPrice` with optional adminConfig
- `pos.logic.test.js`: 52/52 passed
- `serviceMode.test.js`: 52/52 passed

**Deployed to DEV (2026-04-11):**
- Hosting: `npm run build:only` → `firebase deploy --only hosting` — SUCCESS
- Function: `firebase deploy --only functions:createPlanUpgradePayment` — SUCCESS
- Live at: https://restaurant-portal-6b147.web.app

### 2026-04-11 — Comprehensive Production Readiness Audit

**Tier-Based Feature Gating (Browser Tested):**
| Tier | Locked Features | Unlocked Features | Result |
|------|----------------|-------------------|--------|
| Scout | Analytics, SEO & Social, Website Integration, Website Builder, Mobile App | Home, Menu, POS, Kitchen, Server, Table Layout, Payments, Orders, Promotions, Reviews, Account | PASS |
| Ally | Analytics, SEO & Social, Website Integration, Website Builder, Mobile App | Home, Menu, POS, Kitchen, Server, Table Layout, Payments, Orders, Promotions, Reviews, Account | PASS |
| Guide | SEO & Social, Mobile App | Above + Analytics, Website Integration, Website Builder | PASS |
| Chief | Mobile App | Above + SEO & Social | PASS |
| Elder | (none) | All features unlocked | PASS |

**Bugs Found & Fixed:**
| # | Bug | Severity | File(s) | Fix |
|---|-----|----------|---------|-----|
| 1 | `window.confirm()` in Layout.js locked feature click | Medium | `Layout.js` | Replaced with React Bootstrap Modal |
| 2 | Default tax rate 8.5% in Payments.js (POS uses 8%) | High | `Payments.js` | Changed default to 8% |
| 3 | Default tax rate 8.5% in embed-app.js (4 occurrences) | High | `embed-app.js` | Changed all 4 to 8% |
| 4 | Default tax rate 8.5% in functions/index.js template rendering (3 occurrences) | High | `functions/index.js` | Changed all 3 to 8% |
| 5 | `window.confirm()` in MenuManagement.js (2 instances) | Medium | `MenuManagement.js` | Replaced with ConfirmModal |
| 6 | `window.confirm()` in CategoryItems.js | Medium | `CategoryItems.js` | Replaced with ConfirmModal |
| 7 | `window.confirm()` in PromotionsRewards.js | Medium | `PromotionsRewards.js` | Replaced with ConfirmModal |
| 8 | `window.confirm()` in Account.js (3 instances) | Medium | `Account.js` | Replaced with ConfirmModal |
| 9 | `window.confirm()` in TableLayout.js | Medium | `TableLayout.js` | Replaced with ConfirmModal |
| 10 | ReviewManagement.css has no mobile breakpoints | Low | `ReviewManagement.css` | Added `@media (max-width: 576px)` responsive rules |
| 11 | `alert()` in Kitchen.js (2 instances) — error status + order completion | Medium | `Kitchen.js` | Replaced with `setError()` (component already has Alert rendering) |
| 12 | `alert()` in POS.js — KodaPay cancellation | Medium | `POS.js` | Replaced with `setError()` (component already has Alert rendering) |
| 13 | `alert()` in LandingPage.js — contact form failure | Medium | `LandingPage.js` | Added `contactError` state + inline error banner |
| 14 | `resetPaymentForm()` in Payments.js resets tax to 8.5% | High | `Payments.js` | Changed to 8% (was inconsistent with default) |
| 15 | Menu item edit/delete buttons invisible on touch devices | Medium | `MenuManagement.css` | Added `@media (hover: none)` to show action buttons on touch |

**New Component Created:**
- `src/components/ConfirmModal.js` — Reusable confirmation dialog replacing all `window.confirm()` usage

**Cross-Module Consistency Checks:**
| Check | Result |
|-------|--------|
| Default tax rate consistent (8%) across POS, Payments, Account, embed-app, functions/index.js | PASS (after fixes) |
| Multi-location guards (`isMultiLocation && !selectedLocation`) present in all data-fetching components | PASS |
| No `dangerouslySetInnerHTML` in any component | PASS |
| No `window.confirm/alert/prompt` remaining | PASS (after fixes) |
| No hardcoded Stripe keys in source | PASS |
| No swallowed errors (empty `.catch()`) | PASS |
| Subscription expiration enforced with grace period | PASS |
| Trial expiration enforced | PASS |
| Environment-aware config (dev vs prod) | PASS |
| All subscription tiers properly defined in TIER_FEATURES | PASS |
| AI Analytics gated to Elder tier only | PASS |
| Mobile App gated to Elder tier only | PASS |

**Page HTTP Status (All Routes):**
All 18 routes return HTTP 200: landing, login, signup, home, menu-management, pos, kitchen, server, table-layout, payments, orders, promotions, reviews, seo-social, website-integration, website-builder, account, analytics

**Test Results (post-fix, final):**
- `npm run test:ci`: **53 suites passed, 1695 tests passed, 156 skipped (E2E)** — PASS
- Test mocks updated: `kitchenServerPayment.test.js`, `templateRendering.test.js`, `embedApp.test.js`, `websiteServing.test.js` — default tax rate assertions changed 8.5 → 8

**Deployed to DEV (2026-04-11, final):**
- Hosting: `npm run build:only` → `firebase deploy --only hosting` — SUCCESS
- Function: `firebase deploy --only functions:serveWebsite` (tax rate fix) — SUCCESS
- Live at: https://restaurant-portal-6b147.web.app
- All 15 bugs found and fixed, zero `alert()`/`window.confirm()`/`window.prompt()` in production code

### 2026-04-11 — Security Hardening Audit

**Scope:** Full security audit of Firestore rules, Storage rules, Cloud Functions (`functions/index.js`), and frontend source code.

**Critical Vulnerabilities Fixed (3):**
| # | Vulnerability | Severity | Fix |
|---|--------------|----------|-----|
| 1 | `createTerminalConnectionToken` / `createTerminalLocation` — no auth, accepted `request.data.uid` | Critical | Require `request.auth`, removed `data.uid` fallback |
| 2 | `createTierPayment` — client-controlled payment amount | Critical | Server-side price calc from `platformConfig/current`, client amount verified ±$1 |
| 3 | `uploadTemplate` — any authenticated user could overwrite global HTML templates | Critical | Added `verifyAdminCaller()` + `templateId` whitelist |

**High Vulnerabilities Fixed (8):**
| # | Vulnerability | Severity | Fix |
|---|--------------|----------|-----|
| 4 | Firestore: any authenticated user could read any restaurant's root doc | High | Restricted to `isOwnerOrStaff()` or `isPlatformAdmin()` |
| 5 | Firestore: `platformAnalytics` writable by any authenticated user | High | Restricted to `isPlatformAdmin()` only |
| 6 | XSS: `promoId`, `initialTab`, `locationId` query params injected raw into JS string literals | High | `promoId` sanitized `[a-zA-Z0-9_-]`, `initialTab` whitelisted, `EMBED_CONFIG` uses `JSON.stringify()` |
| 7 | Hardcoded Firebase API key fallback `AIzaSyACOWtwR1Q...` in 2 locations | High | Removed fallback, key from `process.env` only |
| 8 | `submitOrder` tax rate client-controlled (`orderData.taxRate`) | High | Server reads tax rate from restaurant/location Firestore config |
| 9 | No rate limiting on `lookupStaffEmail`, `submitReview`, `sendVerificationCode`, `submitContactForm` | High | Added: 10/min, 5/hr, 3/hr/phone, 3/hr/email |
| 10 | Raw `error.message` leaked to clients in `getMenu`, `submitOrder`, `createStaffAccount` | High | Replaced with `safeError()` |
| 11 | SVG upload allowed in Storage rules — stored XSS vector | High | Removed `svg+xml` from `isValidImage()` |

**Medium Vulnerabilities Fixed (7):**
| # | Vulnerability | Severity | Fix |
|---|--------------|----------|-----|
| 12 | `Math.random()` for OTP codes, 2FA backup codes, promo codes | Medium | Replaced with `crypto.randomInt()` |
| 13 | `PROJECT_ID` self-referential `const` declaration bug | Medium | Fixed operator precedence |
| 14 | Unauthenticated preview mode bypass (`?preview=true`) | Medium | Now requires restaurant ID as token |
| 15 | Wildcard CORS `*` on `mobileAppBuildWebhook` | Medium | Changed to `null` |
| 16 | Storage `write` rule covers `delete` — `isValidImage()` throws on null `request.resource` | Medium | Split into explicit `create/update` + `delete` rules |
| 17 | Firestore: reviews `create` with no field validation, self-approval possible | Medium | Added `status == 'pending'` and `rating 1-5` validation |
| 18 | `.env` / `.env.production` tracked by git (Stripe publishable key exposed) | Medium | Added to `.gitignore` |

**Additional Firestore Hardening:**
- Added `isPlatformAdmin()` helper function for admin role checks
- Added deny-all fallback rule `match /{document=**} { allow read, write: if false; }`
- `analyticsEvents` create now validates `type`, `timestamp` fields and `userId == request.auth.uid`
- `customers` update now blocks self-modification of `loyaltyPoints`, `tier`, `totalSpent`
- `website` subcollection read restricted to `isOwnerOrStaff()` (was `allow read: if true`)
- `locations` subcollection read restricted to authenticated users (was `allow read: if true`)
- `social-posts` Storage read restricted to owner only (was world-readable)

**Remaining (requires manual/external action):**
- [ ] `aboutContent` raw HTML injection — needs `sanitize-html` npm package on server
- [ ] Google OAuth `state` HMAC signing — medium risk, requires refactor
- [ ] Firebase API keys in `src/firebase.js` — client-side keys, low risk but move to env vars for hygiene
- [ ] Distributed rate limiting (Upstash Redis or Firebase App Check) — current in-memory rate limiter is per-instance

**Files Changed:**
`firestore.rules`, `storage.rules`, `functions/index.js` (12 functions), `.gitignore`

**Test Results (post-security):**
- `npm run test:ci`: **53 suites passed, 1695 tests passed, 156 skipped (E2E)** — PASS

**Deployed to DEV (2026-04-11):**
- Hosting + Firestore rules + Storage rules: `firebase deploy --only hosting,firestore:rules,storage` — SUCCESS
- Cloud Functions (3 batches, 12 functions): all deployed — SUCCESS
- Live at: https://restaurant-portal-6b147.web.app

### 2026-04-13 — Stripe Subscriptions & Recurring Billing

**Problem:** Platform had no recurring billing — signup created a one-time PaymentIntent, no automatic renewal. Free trials skipped payment entirely (no card collected). Discounts set in admin panel were not reflected on signup page. Plan upgrades used separate one-time PaymentIntents instead of modifying the subscription. Overage charges and order limits needed enforcement.

**What was built:**

| Component | Change |
|-----------|--------|
| `createStripeSubscription` (Cloud Function) | Creates Stripe Customer, Product, Price (cached), and Subscription. Trials use SetupIntent. Discounts applied as Stripe Coupons. |
| `activateTrialSubscription` (Cloud Function) | After card setup, creates Subscription with `trial_period_days`. Stripe auto-charges when trial ends. |
| `updateSubscriptionPlan` (Cloud Function) | Upgrades: prorated via `proration_behavior: 'always_invoice'`. Downgrades: scheduled at period end. Scout = cancellation. |
| `stripeWebhook` (Cloud Function) | Handles `invoice.paid` (activate + reset usage + apply pending downgrade), `invoice.payment_failed` (past_due), `customer.subscription.updated`, `customer.subscription.deleted` |
| `calculateServerPrice` (helper) | Server-side pricing with discount logic matching PricingTiers.js |
| `getOrCreateStripeProduct/Price` (helpers) | Dynamic Stripe Product/Price creation with Firestore caching |
| `Signup.js` | Trial collects card via SetupIntent. Shows discounted prices (original crossed out, discount badge). Recurring billing info displayed. |
| `Account.js` | Plan changes use `updateSubscriptionPlan` (Stripe subscription API). Tier cards and billing options show discounts. Modal shows discount info + proration note. |
| `stripeService.js` | Added `createStripeSubscription`, `activateTrialSubscription`, `updateSubscriptionPlan` client functions. `calculateTierPrice` includes discount logic. |

**New secret required:** `STRIPE_WEBHOOK_SECRET` — must be set before deploying webhook function.

**Tests:** 49 new tests in `subscriptionBilling.test.js` — all pass. 200 total billing-related tests pass.

**Files changed:** `functions/index.js`, `src/components/Signup.js`, `src/components/Account.js`, `src/services/stripeService.js`, `src/__tests__/unit/subscriptionBilling.test.js`

**Not yet deployed** — requires `STRIPE_WEBHOOK_SECRET` and webhook endpoint configuration first.
