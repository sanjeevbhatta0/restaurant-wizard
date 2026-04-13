---
name: test-runner
description: >
  Run the appropriate test suite for Koda Carte based on what changed.
  Supports targeted test runs (POS, widget, admin, reviews, etc.) and full CI mode.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash Read Grep Glob
argument-hint: "[all|unit|integration|e2e|pos|widget|admin|reviews|2fa|social|listings|stripe|access]"
---

# Test Runner for Koda Carte

**Request:** $ARGUMENTS

## Available Test Commands

| Command | Scope | Tests |
|---------|-------|-------|
| `npm run test:unit` | Unit tests only | ~743 tests |
| `npm run test:integration` | Integration tests only | ~523 tests |
| `npm run test:e2e` | E2E (needs emulators) | ~181 tests |
| `npm run test:pos` | POS flow (unit+int+e2e) | pos.logic + posOrderFlow + posFullFlow |
| `npm run test:widget` | Widget/website (unit+int+e2e) | embedApp + widgetOrder + websiteOrder + widgetE2E + websiteOrderE2E |
| `npm run test:admin` | Admin portal (unit+int+e2e) | platformAdmin + platformAdminFlow + platformAdminE2E |
| `npm run test:reviews` | Reviews (unit+int+e2e) | reviews + reviewsFlow + reviewsE2E |
| `npm run test:2fa` | Two-factor auth | twoFactorAuth + twoFactorAuthFlow |
| `npm run test:social` | Social media | socialMedia + socialMediaFlow |
| `npm run test:listings` | Business listings | businessListings + businessListingsFlow |
| `npm run test:stripe-connect` | Stripe Connect | stripeConnect + stripeConnectFlow + stripeConnectE2E |
| `npm run test:access-control` | Access control | accessControl + accessControlFlow + accessControlE2E |
| `npm run test:service-mode` | Counter/service modes | serviceMode + counterServiceFlow |
| `npm run test:receipt` | Receipt feature | receipt + receiptFlow |
| `npm run test:ci` | Full CI with coverage | All tests, no watch mode |

## Smart Test Selection

Based on which files were changed, run the most targeted tests:

| Files Changed | Run |
|--------------|-----|
| `POS.js`, `Kitchen.js`, `Server.js`, `Payments.js` | `npm run test:pos` AND `npm run test:receipt` |
| `ReceiptModal.js` | `npm run test:receipt` |
| `portal.js`, `embed-app.js`, `widget.js`, `WebsiteIntegration.js` | `npm run test:widget` |
| `MenuManagement.js`, `CategoryItems.js`, `MenuContext.js` | `npm run test:unit -- --testPathPattern="pos.logic\|embedApp\|websiteServing"` |
| `Orders.js`, `orderUsageService.js` | `npm run test:unit -- --testPathPattern="orderUsage\|pos.logic"` |
| `PromotionsRewards.js` | `npm run test:unit -- --testPathPattern="promotions"` |
| Admin components (`admin/*`) | `npm run test:admin` |
| `Account.js`, `stripeService.js`, Stripe Connect | `npm run test:stripe-connect` |
| `SeoSocialPosts.js`, social services | `npm run test:social` |
| `functions/index.js` | `npm run test:e2e` (needs emulators) |
| `firestore.rules` | `npm run test:e2e -- --testPathPattern="accessControl"` |
| Any customer portal change | `npm run test:widget` AND `npm run test:unit -- --testPathPattern="customerPortal"` |

## E2E Test Prerequisites

E2E tests require Firebase emulators:
```bash
# Terminal 1: Start emulators
firebase emulators:start

# Terminal 2: Run E2E tests
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run test:e2e
```

Emulator ports: Auth=9099, Firestore=8080, Functions=5001, Hosting=5002, Storage=9199, UI=4000

Without emulators, E2E tests auto-skip to mock fallback tests.

## Before Deploying

Always run full CI suite:
```bash
npm run test:ci
```

Build gate: `npm run build` runs all tests first. Build fails if any test fails.
Use `npm run build:only` to skip tests during rapid iteration.
