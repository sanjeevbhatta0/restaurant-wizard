# CLAUDE.md — Koda Carte (Restaurant Wizard) Project Guide

> **Last Updated:** March 26, 2026

---

## 🏗️ Project Overview

**Koda Carte** (codebase: `restaurant-wizard`) is a SaaS restaurant management platform built with **React 17** and **Firebase**. It provides an all-in-one solution for restaurant owners covering POS, menu management, website building, social media, payments, and analytics.

**Brand Meaning:** "Koda" means **friend** in Lakota. The platform emphasizes community, collaboration, and modern technology.

### Production URLs

| Service | URL |
|---------|-----|
| **Live App** | https://restaurant-portal-6b147.web.app |
| **Firebase Console** | https://console.firebase.google.com/project/restaurant-portal-6b147/overview |
| **Firebase Project ID** | `restaurant-portal-6b147` |

### Admin Credentials

| Field | Value |
|-------|-------|
| **Email** | `sanjeev@admin.com` |
| **Password** | `sanjeev` |
| **UID** | `Jv3rd8hTJCRrwlG4w5OHFVGIzyK2` |
| **Admin URL (prod)** | https://restaurant-portal-6b147.web.app/admin/login |
| **Admin URL (local)** | http://localhost:3000/admin/login |

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 17, React Bootstrap, React Router v6, React Quill (WYSIWYG) |
| **Backend** | Firebase (Firestore, Auth, Storage, Functions, Hosting) |
| **Payments** | Stripe (test mode, client+server) |
| **AI** | Google Gemini API (content generation, analytics) |
| **Social** | Facebook SDK, Instagram Graph API |
| **Build Tool** | Create React App (react-scripts 5.0.1) |
| **Cloud Functions** | Node.js 20, Firebase Functions v2 |

---

## 📐 Architecture — The 4 Sections

### Section 1: Landing Page (Public Marketing Site)

The public-facing marketing website at `/` that showcases the product and pricing.

**Files:**
- `src/components/landing/LandingPage.js` — Main landing page with Hero, Who/Why We Are, Testimonials, Contact form
- `src/components/landing/LandingPage.css` — Styling (dark theme, glassmorphism)
- `src/components/landing/PricingTiers.js` — Dynamic pricing display (5 tiers), reads live config from Firestore `platformConfig`
- `src/components/Signup.js` — User registration with tier selection, Stripe payment, multi-location support
- `src/components/Login.js` — Authentication (email/password + username lookup via Cloud Function)
- `src/components/PrivacyPolicy.js` — Privacy policy page

**Sections on Landing Page:**
1. **Hero** — "Manage Your Restaurant Like a True Leader" with stats grid
2. **Who We Are** — Visionary Platform, Community First, Modern Technology
3. **Why We Are** — Data-driven decisions, all-in-one, scalability, innovation
4. **Our Offerings** — 5-tier pricing grid (Scout/Ally/Guide/Chief/Elder)
5. **Our Customers** — Testimonial from The Gurkha Kitchen (Bay Area, CA)
6. **Where We Are** — Contact form + info (support@kodacarte.com)
7. **Footer** — Links, copyright, privacy policy

**Pricing Tiers:**

| Tier | Price/mo (annual) | Key Features |
|------|-------------------|-------------|
| **Scout** 🔍 | Free | Menu (10 items), POS, Kitchen, Server, 75 orders/mo (hard cap) |
| **Ally** 🌱 | $29 | All Scout + unlimited menu items, 500 orders/mo, AI menu upload |
| **Guide** 🧭 | $59 | All Ally + Analytics, Website Builder, Website Integration, 2000 orders/mo |
| **Chief** 🦅 | $99 | All Guide + SEO & Social, AI preview, 5000 orders/mo (**Most Popular**) |
| **Elder** 👑 | $229 | Everything + AI Analytics, AI Content, Unlimited orders |

**Billing Multipliers:** Monthly +20%, Quarterly +10%, Annual = base price

---

### Section 2: Core POS System (The Product)

The authenticated restaurant management dashboard. All routes under `/home`, `/pos`, `/kitchen`, etc. are wrapped in `<PrivateRoute>` and `<Layout>`.

**Layout & Navigation:**
- `src/components/Layout.js` — Sidebar layout with collapsible nav, location selector, tier-based feature gating (locked features show 🔒)
- `src/components/Layout.css` — Sidebar styling

**Core Components:**

| Route | Component | Description |
|-------|-----------|-------------|
| `/home` | `Home.js` | Dashboard with greeting, today's stats (orders, revenue, pending), quick actions, recent activity feed |
| `/analytics` | `Dashboard.js` (53KB) | Full analytics dashboard with charts and metrics |
| `/menu-management` | `MenuManagement.js` (38KB) | CRUD for menu categories and items with images, prices, discounts (% or $) |
| `/menu-management/category/:id` | `CategoryItems.js` | Items within a specific category |
| `/pos` | `POS.js` (17KB) | **Tablet-friendly** 3-panel POS: Categories → Items → Current Order. Supports wake lock, fullscreen mode, table assignment |
| `/kitchen` | `Kitchen.js` (19KB) | Kitchen display system — real-time order queue with status workflow |
| `/server` | `Server.js` (29KB) | Server view — table management and order tracking for front-of-house staff |
| `/table-layout` | `TableLayout.js` (21KB) | Visual table layout designer with drag-and-drop |
| `/payments` | `Payments.js` (93KB) | Payment processing — Stripe card payments, cash, split bills, refunds, reimbursements |
| `/orders` | `Orders.js` (29KB) | Order management — view/filter orders, status workflow (new → preparing → ready → completed) |
| `/promotions` | `PromotionsRewards.js` (26KB) | Promotions and rewards management |
| `/account` | `Account.js` (76KB) | Account settings — profile, restaurant info, subscription management, security, multi-location config |

**Order Status Workflow:**
```
new → sent_to_kitchen → preparing → ready → completed
                                           → reimbursed (via refund)
```

**Contexts (React Context API):**
- `AuthContext.js` — Firebase Auth state (currentUser, loading)
- `MenuContext.js` — Shared menu data with caching (localStorage, 5-min expiry), location filtering, real-time Firestore listeners
- `LocationContext.js` — Multi-location support (selectedLocation, isMultiLocation, locations list)
- `SubscriptionContext.js` — Tier-based feature gating, pricing config, order limits, menu limits
- `AdminContext.js` — Admin auth check, draft/publish config management

**Services:**
- `stripeService.js` — Stripe integration (loadStripe, createPaymentIntent, confirmPayment, processRefund, tier payment)
- `activityService.js` — Activity logging (order events, menu changes)
- `orderUsageService.js` — Order count tracking per billing cycle for tier limits
- `notificationService.js` — Browser notifications for kitchen/server
- `wakeLockService.js` — Screen Wake Lock API for POS tablets
- `websiteService.js` — Website settings CRUD
- `facebookService.js` — Facebook SDK integration
- `socialMediaService.js` — Social media connections management
- `adminConfigService.js` — Platform config read/write, admin check, publish/draft lifecycle
- `aiContentService.js` — Gemini AI content generation
- `analyticsAIService.js` — AI-powered analytics insights
- `platformAnalyticsService.js` — Platform-wide analytics tracking (page views, signups)
- `menuParserService.js` — AI menu parsing from images

**Custom Hooks:**
- `useFullscreen.js` — Fullscreen API wrapper for POS mode

---

### Section 3: Website Builder & Customer Engagement

Allows restaurant owners to build and publish a customer-facing website with online ordering.

**Admin-Side Components:**
- `src/components/WebsiteBuilder.js` (29KB) — Visual website customizer: theme (3 templates), colors, hero image, about content, business hours, social links, contact info. Publishes to Firestore `restaurants/{uid}/website/settings`
- `src/components/WebsiteIntegration.js` (35KB) — Embed code generator for external websites, menu widget script
- `src/components/SeoSocialPosts.js` (59KB) — Social media posting to Facebook Pages and Instagram Business. AI content generation (Elder tier)
- `src/components/AIAnalytics.js` (33KB) — AI-powered analytics dashboard (Elder tier)

**Server-Side Website Rendering (Cloud Functions):**
- `functions/index.js` → `serveWebsite` — Dynamically serves restaurant websites based on slug/subdomain
- `functions/index.js` → `getMenu` — Public API to fetch menu data for customer-facing sites
- `functions/index.js` → `submitOrder` — Public API to accept online orders from customer websites

**Website Templates (functions/templates/):**

| Template | Style | Font |
|----------|-------|------|
| `modern-bistro/` | Dark navy (#2c3e50) | Poppins |
| `italian-trattoria/` | Black/Gold (#c9a962) | Playfair Display |
| `fresh-cafe/` | Green (#2d6a4f) | Nunito |

**Customer Portal (functions/templates/customer-portal/):**
- `portal.js` — Customer-facing menu display, cart, online ordering UI
- `portal.css` — Customer portal styling
- `data/mock-data.js` — Mock data for development/testing

**Website Serving Flow:**
1. Customer visits restaurant URL (subdomain or `?restaurant=slug`)
2. `serveWebsite` Cloud Function resolves restaurant by slug/ID
3. Loads website settings + template from Firestore
4. Renders HTML template with Handlebars-style `{{placeholder}}` replacement
5. Injects Customer Portal JS/CSS for menu display and online ordering

---

### Section 4: Admin Portal (Platform Management)

Internal admin dashboard for managing platform pricing, features, and analytics.

**Route:** `/admin/*` (wrapped in `<AdminProvider>`)

**Admin Components:**

| Route | Component | Description |
|-------|-----------|-------------|
| `/admin/login` | `AdminLogin.js` | Admin authentication (checks `admins` Firestore collection) |
| `/admin/pricing` | `PricingManagement.js` (28KB) | Edit tier prices, billing multipliers, order limits, free trials, discounts |
| `/admin/features` | `FeatureManagement.js` (9KB) | Toggle features per tier |
| `/admin/preview` | `PricingPreview.js` (16KB) | Live preview of pricing page as customers see it |
| `/admin/metrics` | `MetricsDashboard.js` (18KB) | Platform analytics — signups, page views, active users |
| `/admin/settings` | `AdminSettings.js` (11KB) | Admin password change, account settings |

**Admin Workflow:**
1. Edit pricing/features/discounts in admin dashboard
2. Changes are saved as **drafts** (`platformConfigDraft` collection)
3. **Preview** changes before publishing
4. **Publish** to make live (`platformConfig` collection) — pricing page reads from here
5. **Schedule** future publishes via `PublishScheduler.js`

**Admin Dashboard Layout:**
- Sidebar: Configuration (Pricing, Features, Preview) | Analytics (Metrics) | Account (Settings)
- Header: Page title, status badge (Draft/Published), Save Draft / Schedule / Publish Now buttons
- Toast notifications for save/publish feedback

---

## 📁 Project Structure

```
restaurant-wizard/
├── build/                          # Production build output
├── functions/                      # Firebase Cloud Functions
│   ├── index.js                    # All cloud functions (2798 lines)
│   ├── .env                        # Gemini API key
│   ├── package.json                # Node 20, firebase-functions v6
│   └── templates/                  # Website templates
│       ├── modern-bistro/          # Template: Modern Bistro
│       ├── italian-trattoria/      # Template: Italian Trattoria
│       ├── fresh-cafe/             # Template: Fresh Café
│       ├── customer-portal/        # Shared customer portal (JS/CSS/mock data)
│       └── templates.json          # Template metadata
├── public/                         # Static assets
│   ├── index.html                  # HTML shell (Facebook SDK)
│   ├── embed.js                    # Embeddable menu widget
│   ├── koda-carte-logo.png         # App logo
│   └── manifest.json               # PWA manifest
├── scripts/                        # Utility scripts
│   ├── setup-admin.js              # Create admin in emulator
│   ├── add-admin-prod.js           # Add admin to production Firestore
│   ├── admin-data.json             # Admin seed data
│   └── upload-templates.js         # Upload templates to hosting
├── src/
│   ├── App.js                      # Main app with all routes
│   ├── firebase.js                 # Firebase config + emulator connection
│   ├── components/
│   │   ├── landing/                # Section 1: Landing page
│   │   │   ├── LandingPage.js
│   │   │   ├── LandingPage.css
│   │   │   └── PricingTiers.js
│   │   ├── admin/                  # Section 4: Admin portal
│   │   │   ├── AdminDashboard.js
│   │   │   ├── AdminDashboard.css
│   │   │   ├── AdminLogin.js
│   │   │   ├── AdminSettings.js
│   │   │   ├── FeatureManagement.js
│   │   │   ├── MetricsDashboard.js
│   │   │   ├── PricingManagement.js
│   │   │   ├── PricingPreview.js
│   │   │   └── PublishScheduler.js
│   │   ├── Layout.js               # Sidebar layout (Section 2)
│   │   ├── Home.js                 # Dashboard home
│   │   ├── POS.js                  # Point of Sale
│   │   ├── Kitchen.js              # Kitchen display
│   │   ├── Server.js               # Server/waiter view
│   │   ├── TableLayout.js          # Table layout designer
│   │   ├── MenuManagement.js       # Menu CRUD
│   │   ├── Orders.js               # Order management
│   │   ├── Payments.js             # Payment processing
│   │   ├── Dashboard.js            # Analytics dashboard
│   │   ├── PromotionsRewards.js    # Promotions
│   │   ├── WebsiteBuilder.js       # Website builder (Section 3)
│   │   ├── WebsiteIntegration.js   # Embed codes
│   │   ├── SeoSocialPosts.js       # Social media
│   │   ├── AIAnalytics.js          # AI analytics
│   │   ├── Account.js              # Account settings
│   │   ├── Signup.js               # Registration
│   │   ├── Login.js                # Authentication
│   │   └── ...                     # CSS files and supporting components
│   ├── contexts/                   # React Context providers
│   │   ├── AuthContext.js
│   │   ├── MenuContext.js
│   │   ├── LocationContext.js
│   │   ├── SubscriptionContext.js
│   │   └── AdminContext.js
│   ├── services/                   # Business logic services
│   │   ├── stripeService.js
│   │   ├── activityService.js
│   │   ├── orderUsageService.js
│   │   ├── notificationService.js
│   │   ├── wakeLockService.js
│   │   ├── adminConfigService.js
│   │   ├── aiContentService.js
│   │   ├── analyticsAIService.js
│   │   ├── platformAnalyticsService.js
│   │   ├── facebookService.js
│   │   ├── socialMediaService.js
│   │   ├── websiteService.js
│   │   └── menuParserService.js
│   └── hooks/
│       └── useFullscreen.js
├── firebase.json                   # Firebase hosting + functions config
├── firestore.rules                 # Firestore security rules
├── firestore.indexes.json          # Firestore composite indexes
├── storage.rules                   # Storage security rules
├── .env                            # Facebook App ID
├── .env.development                # Emulator config
├── package.json                    # React app dependencies
└── CLAUDE.md                       # This file
```

---

## ☁️ Cloud Functions (functions/index.js)

| Function | Type | Description |
|----------|------|-------------|
| `lookupEmailByUsername` | HTTP | Find email by username for login |
| `createPaymentIntent` | Callable | Create Stripe PaymentIntent for card payments |
| `confirmStripePayment` | Callable | Confirm payment and update order status |
| `processStripeRefund` | Callable | Process refund through Stripe |
| `getStripeConfig` | Callable | Return Stripe publishable key |
| `createTierPayment` | Callable | Create payment for tier subscription during signup |
| `processSocialMediaPost` | Firestore Trigger | Auto-post to Facebook/Instagram when doc created |
| `serveWebsite` | HTTP | Dynamically serve restaurant customer websites |
| `getMenu` | HTTP | Public API — fetch menu for customer-facing sites |
| `submitOrder` | HTTP | Public API — accept online orders from customer websites |
| `generateAIContent` | Callable | Generate social media content via Gemini AI |
| `getAIAnalytics` | Callable | AI-powered analytics insights via Gemini AI |

---

## 🗄️ Firestore Data Model

```
├── restaurants/{userId}
│   ├── (restaurant profile: name, email, slug, subscription, etc.)
│   ├── menuCategories/{categoryId}
│   │   └── items/{itemId}
│   ├── orders/{orderId}
│   ├── activities/{activityId}
│   ├── reimbursements/{reimbursementId}
│   ├── website/{websiteId}        # Website builder settings
│   ├── layout/{layoutId}          # Table layout data
│   ├── locations/{locationId}     # Multi-location data
│   │   ├── menuCategories/...
│   │   ├── orders/...
│   │   ├── layout/...
│   │   └── website/...
│   └── customers/{customerId}     # Customer portal users
├── socialMediaPosts/{postId}
├── socialConnections/{userId}
├── websiteSettings/{userId}
├── admins/{adminId}               # Admin users
├── platformConfig/{docId}         # Published pricing/features
├── platformConfigDraft/{docId}    # Draft pricing/features
├── scheduledChanges/{docId}       # Scheduled config publishes
├── analyticsEvents/{eventId}      # Platform analytics events
└── platformAnalytics/{docId}      # Aggregate analytics data
```

---

## 🔐 Security Rules Summary

| Collection | Read | Write |
|-----------|------|-------|
| `restaurants/{uid}/**` | Owner only (uid == auth.uid) | Owner only |
| `restaurants/{uid}/orders` | Owner only | Owner + public create |
| `platformConfig` | **Public** (pricing display) | Admins only |
| `platformConfigDraft` | Admins only | Admins only |
| `admins` | Own doc only | None (manual) |
| `analyticsEvents` | Admins only | Public create |

---

## 💳 Stripe Integration

- **Mode:** Test mode (pk_test_... / sk_test_...)
- **Publishable Key:** In `src/services/stripeService.js` and `functions/index.js`
- **Secret Key:** In `functions/index.js` (hardcoded test key)
- **Use Cases:**
  1. **POS payments** — Card swipe/tap at restaurant (createPaymentIntent → confirmStripePayment)
  2. **Signup payments** — One-time tier payment during registration (createTierPayment)
  3. **Refunds** — Full/partial refunds (processStripeRefund)
  4. **Website/Widget online payments** — Customer "Pay Now" at checkout (stripe.createPaymentMethod → paymentMethodId stored on order)
- **TODO:** Replace one-time payments with Stripe Subscriptions for recurring billing

---

## 🚀 How to Run Locally

### Prerequisites
- Node.js v18+ (tested with v23)
- Firebase CLI: `npm install -g firebase-tools`
- Firebase login: `firebase login`

### Quick Start
```bash
# Terminal 1 — Firebase Emulators
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
firebase emulators:start

# Terminal 2 — React Dev Server
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
npm start
# Or on a custom port:
PORT=3005 npm start
```

### Install Dependencies (first time)
```bash
npm install --legacy-peer-deps
cd functions && npm install && cd ..
```

### Set Up Admin in Emulator
```bash
node scripts/setup-admin.js
```

### Emulator URLs
| Service | URL |
|---------|-----|
| React App | http://localhost:3000 |
| Emulator UI | http://localhost:4000 |
| Auth | http://localhost:9099 |
| Firestore | http://localhost:8080 |
| Functions | http://localhost:5001 |
| Hosting | http://localhost:5002 |
| Storage | http://localhost:9199 |

---

## 🚢 Deploy to Production

```bash
# Build
npm run build

# Deploy hosting only
firebase deploy --only hosting:restaurant-portal-6b147

# Deploy functions only
firebase deploy --only functions

# Deploy everything
firebase deploy

# Deploy Firestore rules
firebase deploy --only firestore:rules
```

---

## 🔄 Portal Parity — Website Builder ↔ Widget Embed

**CRITICAL DEVELOPMENT RULE:** The customer-facing portal exists in **two rendering modes** — the Website Builder customer portal and the Widget embed portal. **Any change to one MUST be applied to the other.** These share the same `portal.js` but have different host environments.

### Architecture

| File | Role |
|------|------|
| `functions/templates/customer-portal/portal.js` | Shared customer portal logic (auth, orders, promotions, rewards, spin wheel) |
| `functions/templates/customer-portal/portal.css` | Shared portal styles |
| `functions/templates/customer-portal/embed-app.js` | Widget-specific wrapper (menu, cart, checkout, tab switching) |
| `functions/index.js` (serveWebsite) | Serves both modes; injects `.cp-embed-mode` CSS overrides for widget |

### How Embed Mode Works

- `serveWebsite` detects `?embed=true` query param → serves `embed-app.js` + `portal.js`
- Embed mode sets `.cp-embed-mode` class on portal root → CSS overrides flatten modals, hide sidebar/overlay
- `embed-app.js` exposes `window.customerPortal = this.portal` so portal.js onclick handlers work
- Portal methods that assume website builder DOM (e.g., `renderFullPageDashboard()`, `hideFullPageDashboard()`) must check `this.config.embedMode` and use embed-compatible alternatives

### Development Checklist (MUST follow for any portal change)

1. **portal.js changes**: If adding/modifying any method, verify it works in both modes:
   - Website Builder mode: full-page dashboard with sidebar, overlay, modal positioning
   - Widget embed mode: inline content, no sidebar/overlay, `embedApp.*` for cart/navigation
2. **DOM assumptions**: Never assume `main-content`, `account-page-container`, or other website builder DOM elements exist. Always check `this.config.embedMode` first.
3. **Global references**: Portal onclick handlers use `customerPortal.*` — this works because embed-app.js sets `window.customerPortal = this.portal`. Any new global handler must follow this pattern.
4. **CSS overrides**: If adding new fixed-width/fixed-position styles to portal.css, add corresponding `.cp-embed-mode` overrides in the `serveWebsite` function's embed CSS block (`functions/index.js`, search for "Portal embed overrides").
5. **Data loading**: Embed mode loads data (orders, promotions, customerData) in `switchView()` and `handleLogin()`/`handleSignup()`. New data sources must be added to these loading paths.
6. **Navigation**: Use `embedApp.switchView('menu')` in embed mode instead of manipulating DOM directly. The `hideFullPageDashboard()` method already handles this.
7. **Cart operations**: In embed mode, use `embedApp.addToCart()` / `embedApp.updateCartBar()` instead of `window.cart` or direct DOM manipulation.
8. **Tests**: Run `npm run test:widget` to verify widget/website tests pass after any portal change. Both unit tests (`embedApp.test.js`, `websiteServing.test.js`) and integration tests (`widgetOrderFlow.test.js`, `websiteOrderFlow.test.js`) must pass.

### Known Embed Mode Adaptations (Reference)

These methods in `portal.js` have embed-mode branches — use them as a pattern for future changes:
- `renderDashboardContent()` — 'orders' view shows `renderAllOrders()` (combined active+past) instead of `renderOrderHistory()` (past only)
- `renderDashboard()` — appends a visible Sign Out button in the content area (since sidebar is hidden)
- `hideFullPageDashboard()` — calls `embedApp.switchView('menu')` in embed mode
- `reorder()` — uses `embedApp.addToCart()` in embed mode
- `claimPromo()` — calls `this.showDashboard()` instead of `this.renderFullPageDashboard()` in embed mode
- `handleLogin()` / `handleSignup()` — show `showLoadingState()` spinner, load all data, and set `embedApp.portalDataLoaded = true`
- `handleLogout()` — clears cached data arrays and resets `embedApp.portalDataLoaded`
- `getSpinPrizes()` — has default fallback prizes for when no rewardsConfig loaded

### Widget Tab ↔ Portal View Mapping

The `widget.js` header tabs map to portal views via `embed-app.js switchView()`. **Any new portal view MUST have a corresponding widget tab.**

| Widget Tab (`widget.js`) | embed-app.js tab | Portal `currentView` | Renders |
|--------------------------|-----------------|---------------------|---------|
| Menu | `menu` | N/A (shows menu) | EmbedApp menu |
| My Account | `account` | `account` | Account Overview + Sign Out |
| Orders | `orders` | `orders` | `renderAllOrders()` (active + past combined) |
| Promos | `promotions` | `promotions` | Promotions list |
| Rewards | `rewards` | `rewards` | Spin wheel + points + rewards |

---

## ⚠️ Known Issues & TODOs

### Critical for Production Launch
1. **Stripe test keys hardcoded** — Need to switch to production Stripe keys and use environment secrets
2. **Stripe Subscriptions not implemented** — Currently using one-time PaymentIntents instead of recurring subscriptions
3. **Firebase API keys exposed in code** — Should use environment variables
4. **Contact form not connected** — Just logs to console, no backend/email
5. **Instagram/Twitter posting not implemented** — Functions are stubs (TODO)
6. **Firebase CLI outdated** — v13.34.0, latest is v15.11.0

### Code Quality
7. **~20 ESLint warnings** — Unused variables, missing useEffect dependencies
8. **React 17** — Should upgrade to React 18
9. **Node 20 for functions** — System runs v23, functions specify v18 (should be 20+)

### Feature Gaps
10. **No email notifications** — Order status changes don't send emails/SMS
11. **No real customer testimonials** — Only one hardcoded testimonial
12. **No terms of service page** — Footer links to `#terms`
13. **AI features depend on Gemini API key** — Key is in `functions/.env`

---

## 🔑 Environment Variables

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

### `functions/.env`
```
# Gemini API Key is stored securely via Firebase Secrets
# To update: firebase functions:secrets:set GEMINI_API_KEY
```

---

## 🧪 Testing

**REQUIREMENT: All new development MUST include unit, integration, and E2E tests.** Any new feature, bug fix, or enhancement must have corresponding tests before it is considered complete. Tests protect critical customer-facing flows from regression.

**Test Framework:** Jest + React Testing Library (via Create React App)
**Total Tests:** ~342 passing across 17 test suites (includes ~18 E2E tests with emulator)
**Build Gate:** `npm run build` runs all tests first — build fails if any test fails.

### Test Scripts

```bash
npm test                    # Interactive watch mode (development)
npm run test:unit           # Run unit tests only
npm run test:integration    # Run integration tests only
npm run test:e2e            # Run E2E tests (requires emulators running)
npm run test:pos            # Run all POS tests (unit + integration + e2e)
npm run test:widget         # Run widget/website tests (unit + integration + e2e)
npm run test:ci             # CI mode: all tests with coverage, no watch
npm run build               # Tests MUST pass before build proceeds
npm run build:only          # Skip tests, build only
```

### Test Structure

```
src/__tests__/
├── unit/
│   ├── pos.logic.test.js       # 52 tests — Price calc, discounts, item mgmt, totals, status workflow
│   ├── orderUsage.test.js      # 17 tests — Tier limits, overage calc, hard caps, billing periods
│   ├── stripeService.test.js   # 14 tests — Tier pricing, billing multipliers, multi-location
│   ├── embedApp.test.js        # ~53 tests — Widget cart, pricing, tax, order construction, Stripe payment, menu caching, data staleness
│   └── websiteServing.test.js  # 30 tests — Slug resolution, template data, menu filtering, order validation
├── integration/
│   ├── posOrderFlow.test.js    # 14 tests — Full order lifecycle with mocked Firestore
│   ├── kitchenServerPayment.test.js # 27 tests — Kitchen, Server, Payment component logic
│   ├── onlineOrderFlow.test.js # 8 tests — Website orders, prepaid vs pay-at-store
│   ├── widgetOrderFlow.test.js # ~30 tests — Widget config, menu→cart→checkout, postMessage, Stripe payment
│   └── websiteOrderFlow.test.js # 21 tests — Template rendering, customer orders, multi-location, POS integration
├── e2e/
│   ├── posFullFlow.test.js     # 14 tests — Real Firestore emulator E2E (12 emulator + 2 mock)
│   ├── widgetE2E.test.js       # 10 tests — Widget menu/order/lifecycle via emulator (8 emulator + 2 mock)
│   └── websiteOrderE2E.test.js # 8 tests — Website order lifecycle via emulator (6 emulator + 2 mock)
└── helpers/                    # Not a test suite
```

### Key Test: Full Order Lifecycle E2E

The `posFullFlow.test.js` tests the **exact flow** the user requested:
1. **POS** creates order → status = `sent_to_kitchen`
2. **Kitchen** queries and sees the order → marks as `preparing`
3. **Kitchen** marks as `ready` (with `readyAt` timestamp)
4. **Server** queries and sees the order → marks as `served` (with `servedAt` timestamp)
5. **Payment** queries served orders → processes cash payment → status = `completed`
6. **Verification** — order no longer appears in Kitchen, Server, or Payment active views

### Running E2E Tests with Emulators

```bash
# Terminal 1: Start emulators
firebase emulators:start

# Terminal 2: Run E2E tests
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run test:e2e
```

Without emulators, E2E tests auto-skip and the mock fallback tests run instead.

### Manual Test Checklist
1. Signup → select tier → payment → redirect to dashboard
2. Login (email or username)
3. Menu Management → add category → add items with images
4. POS → select items → assign table → send to kitchen
5. Kitchen → view orders → update status
6. Server → manage tables → track orders
7. Payments → process card/cash payment → refund
8. Website Builder → customize → preview → publish
9. Admin → edit pricing → preview → publish
