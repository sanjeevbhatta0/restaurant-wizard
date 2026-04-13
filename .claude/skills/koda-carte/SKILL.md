---
name: koda-carte
description: >
  Complete reference for the Koda Carte restaurant SaaS platform — architecture, all component flows
  (POS, Kitchen, Server, Payments, Menu, Orders, Website Builder, Customer Portal, Widget, Admin Portal,
  Promotions, Rewards, Reviews, Analytics, Social Media, Stripe Connect, 2FA, Staff Management),
  data model, Cloud Functions, services, contexts, multi-location, security rules, and development guidelines.
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash Edit Write Agent
---

# Koda Carte — Complete Project Reference

> **Codebase:** `restaurant-wizard` | **Brand:** Koda Carte ("Koda" = friend in Lakota)
> **Stack:** React 17 + Firebase (Firestore, Auth, Storage, Functions, Hosting) + Stripe + Gemini AI

**SKILL MAINTENANCE RULE:** When developing any new feature, fixing a bug, or noticing a gap between this skill and the actual codebase, **update this skill immediately** — add new routes, components, services, Cloud Functions, test commands, or flows. This skill must always reflect the current state of the project. Do not wait for the user to ask; do it as part of the development workflow.

---

## Environments

| | DEV | PRODUCTION |
|---|---|---|
| **App URL** | https://restaurant-portal-6b147.web.app | https://kodacarte-861d8.web.app |
| **Firebase Project** | `restaurant-portal-6b147` | `kodacarte-861d8` |
| **Firebase Account** | `sanjivbhatta100@gmail.com` | `sanjeev@kodacarte.com` |
| **Alias** | `dev` (also `default`) | `prod` |
| **Build Command** | `npm run build:only` | `npm run build:prod:only` |

**Critical:** Each Firebase project has its own Auth DB. A prod build deployed to dev hosting = auth failures.

**Environment switching:**
- Code: `src/firebase.js` reads `REACT_APP_FIREBASE_ENV`
- Build: `npm run build` = dev, `npm run build:prod` = production
- Env files: `.env` = development, `.env.production` = production
- CLI: `.firebaserc` aliases (`firebase use dev` / `firebase use prod`)
- Account: `firebase login:use <email>` before deploying

---

## Application Sections

### Section 1: Landing Page (Public)
**Route:** `/`
**Files:** `src/components/landing/LandingPage.js`, `PricingTiers.js`, `Signup.js`, `Login.js`

Sections: Hero > Who We Are > Why We Are > Our Offerings (5 pricing tiers) > Testimonials > Contact > Footer

**Pricing Tiers:**

| Tier | Price/mo | Key Features |
|------|----------|-------------|
| Scout | Free | Menu (10 items), POS, Kitchen, Server, 75 orders/mo |
| Ally | $29 | + unlimited menu, AI upload, 500 orders/mo |
| Guide | $59 | + Analytics, Website Builder, Integration, 2000 orders/mo |
| Chief | $99 | + SEO & Social, AI preview, Delivery (DoorDash), 5000 orders/mo |
| Elder | $229 | + AI Analytics, AI Content, Unlimited orders |

Billing: Monthly +20%, Quarterly +10%, Annual = base.

---

### Section 2: Core POS System (Authenticated App)

All routes under `<PrivateRoute>` + `<Layout>` sidebar.

#### Routes & Components

| Route | Component | Size | Purpose |
|-------|-----------|------|---------|
| `/home` | Home.js | | Dashboard: greeting, today's stats, quick actions, activity feed |
| `/analytics` | Dashboard.js | 53KB | Charts, metrics, revenue trends |
| `/menu-management` | MenuManagement.js | 38KB | CRUD categories/items, images, discounts, AI menu upload |
| `/menu-management/category/:id` | CategoryItems.js | | Items within category |
| `/pos` | POS.js | 17KB | 3-panel tablet POS: Categories > Items > Order. Wake lock, fullscreen |
| `/kitchen` | Kitchen.js | 19KB | Real-time order queue, status workflow |
| `/server` | Server.js | 29KB | Table management, order tracking, front-of-house |
| `/table-layout` | TableLayout.js | 21KB | Drag-and-drop table designer |
| `/payments` | Payments.js | 93KB | Stripe card, cash, split bills, refunds, Stripe Connect |
| `/orders` | Orders.js | 29KB | Paginated order list (10-50/page), filtering, sorting |
| `/promotions` | PromotionsRewards.js | 26KB | Promotions & rewards management |
| `/seo-social` | SeoSocialPosts.js | 59KB | Social posting (Facebook, Instagram, Twitter), AI content |
| `/website-builder` | WebsiteBuilder.js | 29KB | Visual theme/color/content customizer, 4 templates |
| `/website-integration` | WebsiteIntegration.js | 35KB | Embed code generator, menu widget |
| `/reviews` | ReviewManagement.js | | Customer review management |
| `/mobile-app` | MobileApp.js | | Mobile app publishing wizard — Elder Plan only |
| `/account` | Account.js | 76KB | Profile, subscription, security, 2FA, multi-location, Stripe Connect |

#### Order Status Workflow
```
Pickup/Dine-in:
new --> sent_to_kitchen --> preparing --> ready --> completed
                                                --> reimbursed (via refund)
Delivery (DoorDash Drive):
new --> sent_to_kitchen --> preparing --> ready --> out_for_delivery --> completed
                                                --> delivery_failed
```

**Delivery Sub-Statuses** (in `order.doordash.deliveryStatus`):
```
quoted --> awaiting_driver --> driver_assigned --> driver_enroute_pickup -->
driver_at_pickup --> picked_up --> driver_enroute_dropoff --> driver_at_dropoff --> delivered
```

#### POS Flow (Critical Path)
1. POS creates order with items, table, order type --> status `sent_to_kitchen`
2. Kitchen sees order in real-time queue --> marks `preparing`
3. Kitchen marks `ready` (sets `readyAt` timestamp)
4. Server sees ready orders --> marks `served` (sets `servedAt`)
5. Payment processes (card/cash) --> status `completed`
6. Completed orders disappear from Kitchen/Server/Payment active views

#### Payment Types
- **Card (Stripe):** createPaymentIntent --> confirmStripePayment
- **Cash:** Direct status update to completed
- **Split bill:** Multiple payment methods on one order
- **Refund:** processStripeRefund (full or partial)
- **Stripe Terminal:** Physical card reader (Bluetooth/Internet/Simulated)
- **KodaPay:** Mobile Tap to Pay

#### Payment Timing (Pre-Pay vs Post-Pay)
Counter Service and Food Truck modes support configurable payment timing:
- **Pre-Pay** (default): Customer pays at time of order. Order includes `paidAtPOS: true` + `paymentDetails`.
- **Post-Pay**: Customer pays after food is ready. Payment collected via Payments page at `ready` status.

**Config:** `paymentTiming` field in `restaurants/{uid}` (`'pre_pay'` | `'post_pay'`). Default: `'pre_pay'`.
**UI:** Account.js > Service Mode section shows payment timing cards when counter/food_truck is selected.
**Logic:** `isPayFirst()` in SubscriptionContext checks both `serviceMode` and `paymentTiming`.

#### Receipt (Post-Payment)
After successful payment, **ReceiptModal** shows itemized receipt with restaurant info, order details, payment method.
**Delivery:** Email, SMS, or Print (thermal 80mm).
**Files:** `src/components/ReceiptModal.js`, `src/components/ReceiptModal.css`
**Tests:** `npm run test:receipt`

---

### Section 3: Website Builder & Customer Portal

#### Admin Side
- **WebsiteBuilder.js** — Theme selection (4 templates), colors, hero, about, hours, social, contact
- **WebsiteIntegration.js** — Embed codes, widget script generator
- **SeoSocialPosts.js** — Post to Facebook Pages, Instagram Business, Twitter/X. AI content gen (Elder)
- **AIAnalytics.js** — AI analytics dashboard (Elder tier)

#### Website Templates (functions/templates/)

| Template | Style | Font |
|----------|-------|------|
| modern-bistro | Dark navy (#2c3e50) | Poppins |
| italian-trattoria | Black/Gold (#c9a962) | Playfair Display |
| fresh-cafe | Green (#2d6a4f) | Nunito |
| warm-spice | Warm tones | Custom |

#### Customer Portal (functions/templates/customer-portal/)
- `portal.js` — Customer-facing: auth (phone verification), orders, promotions, rewards, spin wheel
- `portal.css` — Portal styling
- `embed-app.js` — Widget wrapper: menu, cart, checkout, tab switching
- `data/mock-data.js` — Development mock data

#### Website Serving Flow
1. Customer visits URL (subdomain or `?restaurant=slug`)
2. `serveWebsite` Cloud Function resolves restaurant
3. Loads settings + template from Firestore
4. Renders HTML with `{{placeholder}}` replacement
5. Injects Customer Portal JS/CSS

#### Customer Features
- **Phone verification:** OTP via Twilio SMS
- **Order placement:** Pickup/delivery, pay-now (Stripe) or pay-at-store
- **Order tracking:** Active orders with real-time status
- **Promotions:** View & claim active promotions, promo codes
- **Rewards:** Loyalty points, tier system, daily spin wheel
- **Receipts:** Email (Resend) and/or SMS (Twilio) on order completion
- **Account:** View profile, order history, reorder

---

### Section 4: Admin Portal

**Route:** `/admin/*` (wrapped in `<AdminProvider>`)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/admin/login` | AdminLogin.js | Admin auth (checks `admins` collection) |
| `/admin/pricing` | PricingManagement.js | Edit tier prices, billing, limits, trials |
| `/admin/features` | FeatureManagement.js | Toggle features per tier |
| `/admin/preview` | PricingPreview.js | Live preview of pricing page |
| `/admin/metrics` | MetricsDashboard.js | Platform analytics |
| `/admin/settings` | AdminSettings.js | Admin account, 2FA |

**Workflow:** Edit --> Save as Draft (`platformConfigDraft`) --> Preview --> Publish to `platformConfig` (or Schedule)

---

## Context Providers

| Context | File | Provides |
|---------|------|----------|
| **AuthContext** | AuthContext.js | `currentUser`, `restaurantUid`, `loading`, `isStaff`, `staffRole`, `staffPermissions` |
| **LocationContext** | LocationContext.js | `selectedLocation`, `isMultiLocation`, `locations`, `restaurantData` |
| **SubscriptionContext** | SubscriptionContext.js | `getCurrentTier()`, `canAccessFeature()`, `orderLimit`, `menuLimit`, `isTrialActive` |
| **AdminContext** | AdminContext.js | `isAdmin`, `publishedConfig`, `draftConfig`, `publishConfig()`, `saveDraft()` |
| **MenuContext** | MenuContext.js | `categories`, `allCategories`, `loading`, `refreshMenu()`, `clearCache()` + image preloading |
| **OnboardingContext** | OnboardingContext.js | `onboardingStep`, `isOnboarding`, `completeStep()` |

---

## Frontend Services

| Service | Purpose |
|---------|---------|
| `stripeService.js` | Stripe SDK init, platform + connected account instances |
| `terminalService.js` | Stripe Terminal SDK, reader connection (Bluetooth/Internet/Simulated) |
| `activityService.js` | Activity logging to Firestore |
| `orderUsageService.js` | Order count tracking per billing cycle, tier limits |
| `notificationService.js` | Browser notifications, audio alerts, vibration |
| `wakeLockService.js` | Screen Wake Lock API for POS tablets |
| `lanSyncService.js` | WebSocket LAN relay for offline sync |
| `offlineService.js` | Network monitoring, Firestore + LAN coordination |
| `websiteService.js` | Website config CRUD |
| `facebookService.js` | Facebook SDK login init |
| `twitterService.js` | Twitter/X OAuth 2.0 flow |
| `socialMediaService.js` | Social connections storage |
| `businessListingsService.js` | Yelp/Google Business integration |
| `aiContentService.js` | AI content generation via Cloud Functions |
| `analyticsAIService.js` | AI analytics insights |
| `menuParserService.js` | AI menu image parsing |
| `adminConfigService.js` | Admin config draft/publish/schedule |
| `platformAnalyticsService.js` | Platform metrics tracking |
| `imageService.js` | Image preloading, compression, resizing |
| `deliveryService.js` | DoorDash Drive delivery integration |

---

## Cloud Functions (~80 total)

### Core Business
| Function | Type | Purpose |
|----------|------|---------|
| `lookupEmailByUsername` | HTTP | Username-to-email lookup for login |
| `createPaymentIntent` | Callable | Stripe PaymentIntent for card payments |
| `confirmStripePayment` | Callable | Confirm payment, update order |
| `processStripeRefund` | Callable | Full/partial Stripe refunds |
| `getStripeConfig` | Callable | Return publishable key |
| `createTierPayment` | Callable | Signup tier payment |
| `serveWebsite` | HTTP | Dynamic restaurant website serving |
| `getMenu` | HTTP | Public menu API |
| `submitOrder` | HTTP | Public order submission |
| `getPromotions` | HTTP | Public promotions API |
| `submitContactForm` | Callable | Landing page contact form |

### AI & Content
| Function | Type | Purpose |
|----------|------|---------|
| `generateAIContent` | Callable | Social media content via Gemini |
| `improveAIContent` | Callable | Improve existing content |
| `generateHashtags` | Callable | AI hashtag suggestions |
| `getSeoRecommendations` | Callable | SEO recommendations |
| `getContentIdeas` | Callable | Content ideas generation |
| `parseMenuImage` | Callable | AI menu parsing from images |
| `getAIAnalytics` | Callable | AI analytics insights |
| `generateReviewResponse` | Callable | AI review reply generation |
| `generateVisibilityTasks` | Callable | AI visibility improvement tasks |

### Customer & Rewards
| Function | Type | Purpose |
|----------|------|---------|
| `claimPromotion` | Callable | Claim a promotion |
| `validatePromoCode` | Callable | Validate promo codes |
| `saveDailySpinResult` | Callable | Save spin wheel result |
| `getCustomerRewards` | Callable | Fetch customer rewards/points |
| `sendVerificationCode` | Callable | Send phone OTP (Twilio) |
| `verifyPhoneCode` | Callable | Verify phone OTP |

### Delivery (DoorDash Drive)
| Function | Type | Purpose |
|----------|------|---------|
| `getDeliveryQuote` | HTTP | Delivery fee + ETA for checkout |
| `doordashWebhook` | HTTP (public) | DoorDash status webhooks |
| `cancelDeliveryOrder` | Callable | Cancel delivery before pickup |
| `getDeliveryStatus` | Callable | On-demand status refresh |
| `configureDelivery` | Callable | Enable delivery, register DoorDash Business/Store |

### Business Listings & Reviews
| Function | Type | Purpose |
|----------|------|---------|
| `searchYelpBusiness` | Callable | Search Yelp for business |
| `connectYelpBusiness` | Callable | Connect Yelp listing |
| `fetchYelpReviews` | Callable | Fetch Yelp reviews |
| `initiateGoogleAuth` | Callable | Google Business OAuth start |
| `handleGoogleAuthCallback` | HTTP | Google OAuth callback |
| `fetchGoogleReviews` | Callable | Fetch Google reviews |
| `replyToGoogleReview` | Callable | Reply to Google review |
| `getBusinessListingsOverview` | Callable | Business listings dashboard |
| `submitReview` | HTTP | Customer review submission |
| `getApprovedReviews` | HTTP | Fetch approved reviews |

### Stripe Terminal (13 functions)
`createTerminalConnectionToken`, `createTerminalLocation`, `getTerminalLocation`,
`registerTerminalReader`, `listTerminalReaders`, `deleteTerminalReader`,
`getTerminalConfig`, `createTerminalPaymentIntent`, `processTerminalPayment`,
`cancelTerminalAction`, `getTerminalReaderStatus`, `createSimulatedReader`,
`simulateTerminalCardPresent`

### Stripe Connect (5 functions)
`initiateStripeConnect`, `refreshStripeConnectLink`, `checkStripeConnectStatus`,
`getStripeConnectStatus`, `disconnectStripeConnect`

### 2FA — Admin (5 functions)
`setupAdmin2FA`, `verifyAndEnable2FA`, `verifyAdmin2FACode`, `disableAdmin2FA`, `regenerateBackupCodes`

### 2FA — Restaurant (5 functions)
`setupRestaurant2FA`, `verifyAndEnableRestaurant2FA`, `verifyRestaurant2FACode`,
`disableRestaurant2FA`, `regenerateRestaurantBackupCodes`

### Twitter/X (5 functions)
`initiateTwitterAuth`, `handleTwitterCallback`, `postTweet`, `disconnectTwitter`, `getTwitterStatus`

### Staff Management (4 functions)
`createStaffAccount`, `updateStaffAccount`, `deleteStaffAccount`, `lookupStaffEmail`

### Mobile App (2 functions)
`publishMobileApp` (Callable), `mobileAppBuildWebhook` (HTTP)

### Receipts & Notifications (1 function + triggers)
`sendReceiptOnDemand` (Callable)

### Firestore Triggers
| Function | Trigger | Purpose |
|----------|---------|---------|
| `processSocialMediaPost` | onDocumentCreated | Auto-post to social media |
| `onRestaurantCreated` | onDocumentCreated | Welcome email on signup |
| `onOrderCompleted` | onDocumentUpdated | Send receipt on order completion |

### Backend Services (functions/services/)
- `emailService.js` — Resend API for transactional email
- `smsService.js` — Twilio API for SMS
- `notificationService.js` — Orchestrates email + SMS delivery

### Email Templates (functions/templates/emails/)
- `orderReceipt.js` — Order receipt email template
- `welcomeRestaurant.js` — Welcome email on signup

---

## Firestore Data Model

```
restaurants/{userId}
  |- (profile: name, email, slug, subscription, tier, locations, deliverySettings, etc.)
  |- menuCategories/{categoryId}
  |    |- items/{itemId}
  |- orders/{orderId}
  |- activities/{activityId}
  |- reimbursements/{reimbursementId}
  |- website/{websiteId}         -- Website builder settings
  |- layout/{layoutId}           -- Table layout data
  |- locations/{locationId}      -- Multi-location support
  |    |- menuCategories/...
  |    |- orders/...
  |    |- layout/...
  |    |- website/...
  |- customers/{customerId}      -- Customer portal users
  |- staff/{staffId}             -- Staff accounts & roles
  |- reviews/{reviewId}          -- Customer reviews
  |- rewardsConfig/{configId}    -- Rewards configuration

socialMediaPosts/{postId}
socialConnections/{userId}
websiteSettings/{userId}
admins/{adminId}
platformConfig/{docId}           -- Published pricing/features (PUBLIC read)
platformConfigDraft/{docId}      -- Draft pricing/features (admin only)
scheduledChanges/{docId}
analyticsEvents/{eventId}
platformAnalytics/{docId}
```

---

## Security Rules

| Collection | Read | Write |
|-----------|------|-------|
| `restaurants/{uid}/**` | Owner only (uid == auth.uid) | Owner only |
| `restaurants/{uid}/orders` | Owner only | Owner + public create |
| `platformConfig` | **Public** (pricing display) | Admins only |
| `platformConfigDraft` | Admins only | Admins only |
| `admins` | Own doc only | None (manual) |
| `analyticsEvents` | Admins only | Public create |

**Note:** `doordashWebhook` is a public HTTP endpoint but validates an Authorization header token stored as `DOORDASH_WEBHOOK_TOKEN` Firebase secret.

---

## Stripe Integration

- **Mode:** Test mode (pk_test_... / sk_test_...) — switch to live before launch
- **Publishable Key:** In `src/services/stripeService.js` and `functions/index.js`
- **Secret Key:** In `functions/index.js` (hardcoded test key)
- **Use Cases:**
  1. **POS payments** — Card swipe/tap (createPaymentIntent --> confirmStripePayment)
  2. **Signup payments** — One-time tier payment (createTierPayment)
  3. **Refunds** — Full/partial (processStripeRefund)
  4. **Website/Widget online payments** — Customer "Pay Now" (stripe.createPaymentMethod)
  5. **Stripe Connect** — Connected accounts for restaurant payouts
  6. **Stripe Terminal** — Physical card readers
- **TODO:** Replace one-time payments with Stripe Subscriptions for recurring billing

---

## Multi-Location Architecture

**Overview:** Restaurants can optionally operate multiple locations. `LocationContext` provides `selectedLocation`, `isMultiLocation`, and `locations`. When multi-location, all data queries MUST be scoped to selected location.

### Data Patterns

| Pattern | Used By | How It Works |
|---------|---------|-------------|
| **`locationId` field** | Orders, Reimbursements, Activities | `where('locationId', '==', selectedLocation)` |
| **`locations` array** | Menu items | `locations: ['loc-a', 'loc-b']`; empty = all. Client-side filter in MenuContext |
| **`locationIds` array** | Promotions | `locationIds: ['loc-a']`; empty = all. Client-side filter |
| **Per-location subcollections** | Table layout, Website settings | `locations/{locationId}/layout/`, `locations/{locationId}/website/` |

### Query Rules (MUST follow)

1. **Server-side filtering preferred**: Use `where('locationId', '==', selectedLocation)` in Firestore queries
2. **Guard for no location**: When `isMultiLocation && !selectedLocation`, show empty state — never unfiltered data
3. **Single-location compat**: When `isMultiLocation` is false, do NOT include `locationId` filter
4. **Cache key isolation**: MenuContext keys include location: `restaurant_menu_cache_{uid}_{locationId}`

### Components with Location Filtering

| Component | Filter Type | Notes |
|-----------|------------|-------|
| Orders.js | Server-side `where()` | locationId in query |
| Home.js | Server-side (orders), client-side (activities) | Activities: backward compat |
| Payments.js | Server-side `where()` | All 4 order queries have location filters |
| Kitchen.js | Server-side `where()` | Scoped to location |
| Server.js | Server-side `where()` | Scoped to location |
| POS.js | Writes `locationId` | Orders created with `locationId: selectedLocation` |
| AIAnalytics.js | Server-side `where()` | Filtered by location |
| useAnalyticsData.js | Server-side `where()` | Orders + reimbursements |
| PromotionsRewards.js | Client-side | Admin targets promos to locations via `locationIds` |
| MenuContext.js | Client-side | Items filtered by `locations` array |
| TableLayout.js | Per-location subcollection | `locations/{id}/layout/` |
| WebsiteBuilder.js | Per-location subcollection | `locations/{id}/website/` |

---

## Feature Gating by Tier

| Feature | Scout | Ally | Guide | Chief | Elder |
|---------|-------|------|-------|-------|-------|
| Menu Management | 10 items | Unlimited | Unlimited | Unlimited | Unlimited |
| POS, Kitchen, Server, Orders, Payments | Yes | Yes | Yes | Yes | Yes |
| AI Menu Upload | No | Yes | Yes | Yes | Yes |
| Analytics | No | No | Yes | Yes | Yes |
| Website Builder & Integration | No | No | Yes | Yes | Yes |
| SEO & Social | No | No | No | Yes | Yes |
| Delivery (DoorDash) | No | No | No | Yes | Yes |
| AI Analytics & Content | No | No | No | No | Yes |
| Mobile App | No | No | No | No | Yes |
| Promotions | Yes | Yes | Yes | Yes | Yes |

---

## Environment Variables

### `.env`
```
REACT_APP_FACEBOOK_APP_ID=1187049703423497
```

### `.env.development`
```
REACT_APP_USE_EMULATOR=true
REACT_APP_EMULATOR_HOST=localhost
REACT_APP_FIRESTORE_EMULATOR_PORT=8080
REACT_APP_FUNCTIONS_EMULATOR_PORT=5001
REACT_APP_STORAGE_EMULATOR_PORT=9199
REACT_APP_AUTH_EMULATOR_PORT=9099
```

### Firebase Secrets (`firebase functions:secrets:set`)

| Secret | Purpose |
|--------|---------|
| `GEMINI_API_KEY` | Gemini AI content/analytics |
| `DOORDASH_DEVELOPER_ID` | DoorDash Drive developer ID |
| `DOORDASH_KEY_ID` | DoorDash Drive key ID |
| `DOORDASH_SIGNING_SECRET` | DoorDash JWT signing secret |
| `DOORDASH_WEBHOOK_TOKEN` | DoorDash webhook auth token |
| `RESEND_API_KEY` | Resend email service |
| `TWILIO_ACCOUNT_SID` | Twilio SMS account |
| `TWILIO_AUTH_TOKEN` | Twilio SMS auth |
| `GITHUB_PAT` | GitHub Actions trigger (mobile app builds) |
| `GITHUB_REPO` | GitHub repo for customer-app |
| `MOBILE_APP_WEBHOOK_TOKEN` | Mobile app build webhook auth |

---

## Image Optimization

Menu item images use a 3-layer pipeline:
1. **Preloading (MenuContext):** `preloadImages()` fires when menu data loads
2. **Progressive rendering (MenuItemImage):** Shimmer skeleton + fade-in transition
3. **Compression on upload:** Client-side resize (800x800 max) + JPEG 0.8 quality

Files: `src/services/imageService.js`, `src/components/MenuItemImage.js`

---

## Key Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm start` | Dev server | http://localhost:3000 |
| `npm run dev` | Dev + emulators | Concurrent startup |
| `npm run emulate` | Emulators only | Firebase emulators:start |
| `npm run relay` | LAN relay | WebSocket server for offline POS |
| `node scripts/setup-admin.js` | Admin setup | Creates admin in emulator |
| `node scripts/setup-prod.js` | Prod setup | Initializes prod Firestore config |

---

## Testing

**~1,447 tests across 40 files** (16 unit, 15 integration, 9 E2E)

```bash
npm test                 # Watch mode
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:e2e         # E2E (requires emulators)
npm run test:ci          # CI mode with coverage
npm run test:pos         # POS tests
npm run test:widget      # Widget/website tests
npm run test:admin       # Admin tests
npm run test:reviews     # Review tests
npm run test:2fa         # 2FA tests
npm run test:social      # Social media tests
npm run test:listings    # Business listings tests
npm run test:stripe-connect  # Stripe Connect tests
npm run test:access-control  # Access control tests
npm run test:receipt         # Receipt tests
npm run test:service-mode    # Counter/service mode tests
```

**Build gate:** `npm run build` runs all tests first. Build fails if any test fails.
**E2E tests** require Firebase emulators running on standard ports.

---

## Companion Apps (Koda Carte Ecosystem)

All three apps share the **same Firebase backend** (Firestore, Auth, Cloud Functions). Changes to Cloud Functions, Firestore data model, or shared business logic in the main app **must be ported** to the companion apps.

### Ecosystem Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    FIREBASE BACKEND                       │
│  Firestore  ·  Auth  ·  Cloud Functions  ·  Storage       │
└──────┬─────────────────┬─────────────────┬───────────────┘
       │                 │                 │
┌──────┴──────┐  ┌───────┴───────┐  ┌──────┴──────┐
│  Web App    │  │ Customer App  │  │  POS Payment │
│ (this repo) │  │ (mobile)      │  │  App (mobile)│
│             │  │               │  │              │
│ React 17    │  │ React Native  │  │ React Native │
│ + Firebase  │  │ + Expo + EAS  │  │ 0.84 (bare)  │
│             │  │               │  │              │
│ Restaurant  │  │ Customer      │  │ Staff        │
│ admin       │  │ ordering,     │  │ payment      │
│ dashboard   │  │ rewards,      │  │ collection   │
│             │  │ menu browsing │  │ (Tap to Pay) │
└─────────────┘  └───────────────┘  └──────────────┘
```

### Customer App (`customer-app`)

**Path:** `/Users/sanjeevbhatta/Documents/GitHub/customer-app`
**Stack:** React Native 0.76+ / Expo prebuild / TypeScript / Zustand / Stripe React Native
**Purpose:** White-label customer app — ordering, rewards, promotions, menu, order tracking

| Feature | Shared Cloud Functions Used |
|---------|---------------------------|
| Menu browsing | `getMenu` (HTTP) |
| Order placement | `submitOrder` (HTTP) |
| Payments | `createPaymentIntent`, `confirmStripePayment` (Callable) |
| Phone auth | `sendVerificationCode`, `verifyPhoneCode` (Callable) |
| Promotions | `getPromotions` (HTTP), `claimPromotion`, `validatePromoCode` (Callable) |
| Rewards | `getCustomerRewards`, `saveDailySpinResult` (Callable) |
| Reviews | `submitReview`, `getApprovedReviews` (HTTP) |
| Delivery | `getDeliveryQuote` (HTTP) |

**Firestore paths read/written:** `restaurants/{id}/customers/{userId}`, `restaurants/{id}/orders/{orderId}`, menu categories/items (read-only)

### POS Payment App (`restaurant-pos-payment-app`)

**Path:** `/Users/sanjeevbhatta/Documents/GitHub/restaurant-pos-payment-app`
**Stack:** React Native 0.84 (bare) / TypeScript / Stripe Terminal React Native
**Purpose:** Staff payment companion — Tap to Pay (Apple/Google), Stripe M2 Bluetooth reader, refunds

| Feature | Shared Cloud Functions Used |
|---------|---------------------------|
| Payment collection | `createPaymentIntent`, `confirmStripePayment` (Callable) |
| Refunds | `processStripeRefund` (HTTP POST) |
| Terminal setup | `createTerminalConnectionToken`, `createTerminalLocation` (Callable) |
| Order sync | Real-time Firestore `onSnapshot` on `restaurants/{id}/orders` |

**Firestore paths read/written:** `restaurants/{id}/orders/{orderId}` (read orders, write payment status), `restaurants/{id}/activities/{id}` (write payment activity)

### Cross-App Sync Rules (MUST follow)

**When you change any of these in the main app, the change MUST be ported to the companion apps:**

| What Changed | Port To | How |
|-------------|---------|-----|
| Cloud Function **signature** (params, response shape) | Both apps | Update service calls that invoke the function |
| Cloud Function **new feature** (e.g., new field in order response) | Relevant app | Add UI/logic to consume the new field |
| Firestore **document schema** (new/renamed/removed fields) | Both apps | Update TypeScript types + any code reading/writing those fields |
| **Order status workflow** (new statuses, changed transitions) | Both apps | Update status display, filtering, and transitions |
| **Promotions/Rewards logic** (new promo types, reward rules) | Customer app | Update promo claiming, reward display, spin wheel |
| **Payment flow** (new payment methods, refund changes) | POS Payment app | Update payment collection and refund screens |
| **Menu data model** (new item fields, category changes) | Customer app | Update menu display, cart item construction |
| **Customer auth** (new auth methods, profile fields) | Customer app | Update auth flow and account screen |
| **Stripe Terminal** functions (new reader types, config changes) | POS Payment app | Update terminal service and reader management |
| **Delivery** (new delivery fields, status changes) | Customer app | Update order tracking and checkout flow |

---

## Known Issues & TODOs

### Critical for Production Launch
1. **Stripe test keys hardcoded** — Switch to production keys + environment secrets
2. **Stripe Subscriptions** — Currently one-time PaymentIntents, need recurring
3. **Firebase API keys in code** — Should use environment variables
4. **DoorDash sandbox mode** — Switch to production credentials when ready

### Code Quality
5. **~20 ESLint warnings** — Unused variables, missing useEffect dependencies
6. **React 17** — Should upgrade to React 18

### Feature Gaps
7. **No terms of service page** — Footer links to `#terms`
8. **No Google Places autocomplete** — Delivery address is free text
9. **No delivery analytics drilldown** — Aggregate only, no per-restaurant breakdown
