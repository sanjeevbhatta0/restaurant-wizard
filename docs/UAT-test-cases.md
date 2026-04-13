# Koda Carte — Comprehensive UAT Test Cases

> **Purpose:** Exhaustive browser-based User Acceptance Testing for every feature and flow.
> **Status legend:** `[ ]` = Not tested, `[x]` = Passed, `[!]` = Bug found, `[-]` = N/A / Skipped
> **Environments:** DEV (restaurant-portal-6b147.web.app) | PROD (kodacarte-861d8.web.app)
> **Last updated:** 2026-04-13
> **Test run:** 2026-04-13 (DEV environment, automated via agent-browser)

---

## 1. LANDING PAGE & MARKETING SITE

### 1.1 Navigation
- [x] Logo renders and clicking it scrolls to top
- [x] Nav links scroll to correct sections: Meet, Features, Why Us, Pricing, Customers, Contact
- [x] "Login" button navigates to `/login`
- [x] "Get Started" button scrolls to pricing section
- [ ] Sticky navbar appears on scroll down
- [ ] Mobile hamburger menu opens/closes correctly
- [ ] All mobile nav links work and close the menu after click

### 1.2 Hero Section
- [x] Hero text and badge render correctly
- [x] CTA button navigates to pricing section
- [ ] Background animation/gradient renders (no visual glitches) — *needs visual check*

### 1.3 Features Section
- [x] All feature cards render with icons and descriptions
- [ ] Cards are responsive (grid → single column on mobile) — *needs mobile viewport test*

### 1.4 Why Us Section
- [x] Content renders with competitive advantages
- [ ] Responsive layout on mobile — *needs mobile viewport test*

### 1.5 Pricing Section (PricingTiers)
- [x] All 5 tier cards render (Scout, Ally, Guide, Chief, Elder)
- [x] Default billing cycle is "Annual"
- [!] Switching to "Monthly" updates prices with 20% markup — **BUG: prices identical across all billing cycles; admin multipliers may all be 1.0**
- [!] Switching to "Quarterly" updates prices with 10% markup — **same bug as above**
- [x] Scout card shows "Free" with no price
- [!] Scout "Get Started" navigates to `/signup?tier=scout` — **BUG: button click does not navigate (React Router issue from PricingTiers)**
- [ ] Ally "Get Started" navigates to `/signup?tier=ally&cycle=annual` — *not tested (same click issue expected)*
- [ ] Guide "Get Started" navigates to `/signup?tier=guide&cycle=annual`
- [ ] Chief "Get Started" navigates to `/signup?tier=chief&cycle=annual`
- [ ] Elder "Get Started" navigates to `/signup?tier=elder&cycle=annual`
- [x] "Most Popular" badge appears on recommended tier (Chief)
- [x] Feature lists match tier capabilities
- [ ] Prices update in real-time when admin publishes config changes — *not tested*
- [x] Active discount reflects correctly (e.g., 20% off Elder shows crossed-out original price)
- [x] Discount badge shows discount name and amount
- [ ] Free trial badge shows if trial enabled for a tier (e.g., "14-day free trial") — *not visible, may not be configured*
- [x] Order limit text is dynamic (reads from admin config, shows 90 not hardcoded 75)
- [x] Overage rate displays without floating-point artifacts (1.71% clean)

### 1.6 Customers Section
- [x] Testimonials render correctly (The Gurkha Kitchen, Bay Area CA, 5 stars)
- [ ] Responsive layout — *needs mobile viewport test*

### 1.7 Contact Form
- [x] Form fields: Name, Email, Restaurant Name, Message
- [x] All fields are required (Name, Email, Message required; Restaurant Name optional)
- [ ] Successful submission shows success message (not `alert()`) — *not tested to avoid sending email*
- [ ] Error on submission shows inline error (not `alert()`)
- [ ] Rate limiting: submitting multiple times within a minute shows error
- [ ] Email sent to `sanjeev@kodacarte.com` on submission

---

## 2. AUTHENTICATION

### 2.1 Restaurant Owner Login (`/login`)
- [x] Email and password fields render
- [x] Login with valid credentials → redirects to `/home`
- [x] Login with invalid credentials → shows error message (not `alert()`) — shows inline "Failed to sign in" error
- [!] "Forgot Password" link works → sends Firebase password reset email — **BUG: "Forgot Password" link is MISSING from login page**
- [x] "Sign Up" link navigates to `/signup`
- [x] Username-based login works (field accepts both username or email)
- [x] Password visibility toggle works ("Show password" button present)

### 2.2 Restaurant Owner Signup (`/signup`)
- [ ] Navigating from pricing passes tier and cycle params (e.g., `?tier=chief&cycle=annual`) — *pricing buttons don't navigate (see 1.5 bug)*
- [x] Default tier is "ally" if no param provided
- [ ] Invalid tier param defaults to "ally" — *not tested*

#### Step 1 — Account Details
- [x] All fields render: Username, Restaurant Name, Email, Phone (optional), Password, Confirm Password
- [ ] Password mismatch shows error — *not tested*
- [ ] Password < 6 chars shows error — *not tested*
- [x] Empty fields blocked by HTML5 required validation
- [x] Empty restaurant name shows error (required)
- [ ] Button text for Scout: "Create Free Account" — *not tested (pricing nav broken)*
- [ ] Button text for paid tier with trial: "Continue — Add Card for Trial"
- [x] Button text for paid tier without trial: "Continue to Payment →"
- [!] **BUG: "Continue to Payment →" button click doesn't work** — only keyboard Enter advances to Step 2

#### Plan Display (header)
- [x] Selected tier name and icon display correctly (Chief = 🦅)
- [x] Billing cycle badge shows (annual)
- [ ] Scout shows "FREE" badge and "No credit card required" — *not tested*
- [x] Paid tier shows price per location per month ($129/mo per location)
- [ ] Discounted price shows original crossed out + discounted price — *not tested on signup page*
- [ ] Discount badge shows (e.g., "20% off — Elder Promo")
- [ ] Trial tier shows "{N}-day free trial" with "Then $X/mo per location"
- [x] Location counter: + and - buttons present (- disabled at 1)
- [x] Location counter: minimum is 1 (- button disabled)
- [ ] Scout tier: location counter locked at 1 with "Single location only" badge
- [ ] Multi-location total formula updates correctly
- [x] "Change plan" link present ("Change plan →")

#### Step 2 — Payment (paid tiers)
- [x] Stripe card element renders (iframe present)
- [x] Total shows correct amount ("Pay $1,548.00" for annual Chief)
- [x] "← Back" button works (returns to Step 1)
- [ ] Summary shows: Restaurant name, Locations, Plan (tier + cycle), Billing type (recurring)
- [ ] Discount line appears if active discount
- [ ] Original price crossed out if discount active
- [ ] Total shows recurring billing label (/yr, /qtr, /mo)
- [ ] Trial message: "{N}-day free trial — you won't be charged today"
- [ ] Trial helper text: "Your card will be saved and charged after the trial ends"
- [ ] Non-trial helper text: "Your payment is secured with Stripe"
- [ ] "Back" button returns to Step 1
- [ ] Trial submit button: "Start {N}-Day Free Trial"
- [ ] Paid submit button: "Subscribe — $X.XX"
- [ ] Recurring billing disclosure shows under button

#### Scout Signup (free tier)
- [ ] Clicking "Create Free Account" creates account immediately (no Step 2)
- [ ] User redirected to `/home`
- [ ] Firestore restaurant doc created with `subscription.tier: 'scout'`, `status: 'active'`
- [ ] No Stripe customer or subscription created

#### Trial Signup
- [ ] Card input appears on Step 2
- [ ] SetupIntent created (card saved, not charged)
- [ ] Stripe subscription created with `trial_period_days`
- [ ] Firestore doc: `subscription.status: 'trialing'`, `trialEnd` set
- [ ] User NOT charged at signup

#### Paid Signup (no trial)
- [ ] PaymentIntent created via subscription
- [ ] Card charged immediately
- [ ] Firestore doc: `subscription.status: 'active'`, `stripeSubscriptionId` set
- [ ] `stripeCustomerId` saved in Firestore

#### Post-Signup
- [ ] Welcome email received (check inbox)
- [ ] Welcome SMS received (if phone provided and Twilio active)
- [ ] Onboarding checklist appears on first login
- [ ] Multi-location setup: location docs created for each location

### 2.3 Staff Login
- [ ] Staff can log in with staff credentials (created by restaurant owner)
- [ ] Staff sees limited dashboard based on their role/permissions
- [ ] Staff cannot access admin or account settings

### 2.4 Platform Admin Login (`/admin/login`)
- [ ] Admin login page renders
- [ ] Login with admin credentials → redirects to admin dashboard
- [ ] Invalid credentials → shows error
- [ ] Non-admin users cannot access `/admin/*` routes

---

## 3. PLATFORM ADMIN

### 3.1 Pricing Management
- [ ] All 5 tier base prices editable
- [ ] Billing multipliers editable (monthly, quarterly, annual)
- [ ] Changes reflect in "Preview" tab before publishing
- [ ] "Save Draft" saves without publishing
- [ ] "Publish" pushes changes live (verify on landing page)
- [ ] Published prices match landing page prices exactly

### 3.2 Order Limits & Overage
- [ ] Order limits editable per tier (Scout, Ally, Guide, Chief, Elder)
- [ ] Overage rate input accepts decimal values cleanly (e.g., 1.75 not 1.7500000000000002)
- [ ] Hard cap toggle for Scout tier
- [ ] Published limits reflected in pricing page feature descriptions
- [ ] Admin-configured limits override hardcoded defaults throughout platform

### 3.3 Free Trial Configuration
- [ ] Trial toggle (enable/disable) per tier
- [ ] Trial days input per tier
- [ ] Enabled trial shows on pricing page
- [ ] Enabled trial triggers trial flow in signup

### 3.4 Discounts
- [ ] Create new discount: name, type (tier/billing_cycle), target, amount, isPercentage, startDate, endDate
- [ ] Active discount reflected on pricing page
- [ ] Active discount reflected on signup page
- [ ] Active discount reflected on Account page (plan change modal)
- [ ] Expired discount not applied
- [ ] Inactive discount not applied
- [ ] Multiple discounts: only first matching applies
- [ ] Percentage discount calculates correctly
- [ ] Fixed dollar discount calculates correctly

### 3.5 Feature Management
- [ ] Features assignable to tiers
- [ ] Preview features assignable (Chief tier previews)
- [ ] Changes published → feature gating enforced in restaurant dashboard

### 3.6 Metrics Dashboard
- [ ] Total restaurants count accurate
- [ ] Active subscriptions by tier accurate
- [ ] MRR calculation correct
- [ ] New signups this month accurate
- [ ] Revenue charts render

### 3.7 Users Dashboard
- [ ] List all restaurants with search/filter
- [ ] Sort by signup date, tier, status
- [ ] View restaurant details (tier, usage, locations)

---

## 4. RESTAURANT DASHBOARD — CORE NAVIGATION

### 4.1 Layout & Sidebar
- [ ] Sidebar renders with all menu items
- [ ] Active page highlighted in sidebar
- [ ] Sidebar collapses on mobile (hamburger menu)
- [ ] Feature-gated items show lock icon for locked tiers
- [ ] Clicking locked feature shows upgrade modal (not `window.confirm`)
- [ ] Upgrade modal shows correct minimum tier required
- [ ] Multi-location selector appears in header (if multi-location account)
- [ ] Selecting location filters all data to that location
- [ ] "All Locations" option shows aggregate data (where applicable)

### 4.2 Subscription Status Banners
- [ ] Active subscription: no banner
- [ ] Trial ending within 7 days: amber trial expiration banner
- [ ] Billing period ending within 5 days: amber renewal banner
- [ ] Expired subscription: red banner with "Renew" action
- [ ] Past-due subscription: warning banner
- [ ] Pending downgrade: info banner showing scheduled change

### 4.3 Onboarding Checklist
- [ ] Shows on first login after signup
- [ ] Floating panel (bottom-right)
- [ ] Can be dragged to new position
- [ ] Can be dismissed
- [ ] Progress bar updates as steps completed
- [ ] Clicking a step navigates to the relevant page
- [ ] Steps auto-complete on first feature use
- [ ] Re-accessible from Account page

---

## 5. HOME PAGE

- [ ] Greeting displays with correct time of day (morning/afternoon/evening)
- [ ] Current date shown
- [ ] Today's order count is accurate
- [ ] Today's revenue is accurate
- [ ] Pending orders count is accurate
- [ ] Recent activities feed loads (last 20)
- [ ] Activities show timestamps and action descriptions
- [ ] Activities update in real-time (place an order → activity appears)
- [ ] Multi-location: activities filtered by selected location

---

## 6. MENU MANAGEMENT

### 6.1 Categories
- [ ] Create new category (name, optional color/icon)
- [ ] Edit existing category name
- [ ] Delete category (with confirmation modal, not `window.confirm`)
- [ ] Reorder categories via drag-and-drop (if supported)
- [ ] Categories persist after page refresh

### 6.2 Menu Items
- [ ] Add new item: name, description, price
- [ ] Add item with discount (percentage)
- [ ] Add item with discount (fixed amount)
- [ ] Upload item image
- [ ] Image auto-compressed (verify file size reduced)
- [ ] Edit existing item (all fields)
- [ ] Delete item (with confirmation modal)
- [ ] Items appear in correct category
- [ ] Scout tier: warning at 10 items, blocked at limit
- [ ] Multi-location: item location assignment works
- [ ] Multi-location: item only shows at assigned locations

### 6.3 Spice Levels
- [ ] Enable spice levels for an item
- [ ] Configure spice level labels (e.g., Mild, Medium, Hot, Extra Hot)
- [ ] Spice levels appear in POS item modal
- [ ] Spice levels appear on customer website

### 6.4 AI Menu Parsing
- [ ] Upload menu image/PDF
- [ ] AI parses and suggests categories + items
- [ ] User can accept/reject/edit parsed items
- [ ] Parsed items saved to Firestore

### 6.5 Order Limit Display
- [ ] Shows order limit for current tier (from admin config)
- [ ] Text reads dynamically (not hardcoded "500 orders per month")

---

## 7. POS (POINT OF SALE)

### 7.1 Layout
- [ ] Three-panel layout renders (categories, items, order summary)
- [ ] Panels are resizable via drag handles
- [ ] Category sidebar shows all menu categories
- [ ] Clicking category filters items in center panel
- [ ] Menu items display with name, price, image

### 7.2 Service Modes
- [ ] Full Service mode: table selection required before order
- [ ] Counter Service mode: no table needed
- [ ] Food Truck mode: no table needed
- [ ] Service mode can be changed in Account settings

### 7.3 Order Creation
- [ ] Click menu item → item options modal opens
- [ ] Item options: name, description, image, notes, qty, spice level
- [ ] Add item to order → appears in right panel
- [ ] Add same item again → quantity increments
- [ ] Edit item in order (change qty, notes, spice)
- [ ] Remove item from order
- [ ] Subtotal calculates correctly
- [ ] Tax calculates correctly (at configured rate, default 8%)
- [ ] Tip options work (preset percentages + custom amount)
- [ ] Grand total = subtotal + tax + tip

### 7.4 Table Selection (Full Service)
- [ ] Table selection modal opens before payment
- [ ] Available tables shown as selectable
- [ ] Occupied tables shown as disabled/grayed
- [ ] Can select single table
- [ ] Can select multiple tables (party spanning tables)
- [ ] Selected tables highlighted
- [ ] Confirm selection proceeds to payment

### 7.5 Payment — Cash
- [ ] Select "Cash" payment method
- [ ] Enter amount tendered
- [ ] Change calculated and displayed
- [ ] Order marked as completed
- [ ] Receipt modal shown

### 7.6 Payment — Card (Stripe Elements)
- [ ] Card payment form renders (Stripe Elements)
- [ ] Enter valid test card (4242 4242 4242 4242)
- [ ] Payment processes successfully
- [ ] Order marked as completed
- [ ] PaymentIntent ID saved to order
- [ ] Receipt modal shown

### 7.7 Payment — Stripe Terminal (Physical Reader)
- [ ] Terminal readers listed (if configured)
- [ ] Select reader → initiate payment
- [ ] Reader shows payment amount
- [ ] Card tap/insert processes payment
- [ ] Payment confirmed → order completed
- [ ] Simulated reader: `simulateCardPresent` works in dev

### 7.8 Payment — KodaPay (Tap to Pay)
- [ ] KodaPay option available
- [ ] Initiates NFC/Tap-to-Pay flow
- [ ] Payment confirmation received
- [ ] Order completed

### 7.9 Payment — Split Payment
- [ ] Split evenly among N people
- [ ] Split by custom amounts
- [ ] Each split creates separate payment
- [ ] All splits completed → order marked done

### 7.10 Order Limits & Overage
- [ ] Scout tier: order blocked at 75 (or admin-configured limit) with error message
- [ ] Ally/Guide/Chief: order allowed beyond limit but overage tracked
- [ ] Elder: no limit enforcement
- [ ] Server-side enforcement (not just client-side)

### 7.11 Receipts
- [ ] Receipt modal shows order details, items, totals
- [ ] Print receipt option (if printer configured)
- [ ] Email receipt option
- [ ] Receipt sent to customer email/SMS

### 7.12 POS Edge Cases
- [ ] Empty order: payment button disabled
- [ ] Large order (50+ items): UI handles gracefully
- [ ] Network disconnection during payment: error shown, order not lost
- [ ] Browser refresh: confirm dialog before losing order data
- [ ] Fullscreen mode toggle
- [ ] Wake lock keeps screen on during service
- [ ] Multi-location: menu items filtered by selected location

---

## 8. KITCHEN DISPLAY

- [ ] Active orders display (new, preparing, ready)
- [ ] Order cards show: items, qty, notes, spice levels, elapsed time
- [ ] Color-coded status badges (New = blue, Preparing = yellow, Ready = green)
- [ ] Mark order "Preparing" → status updates
- [ ] Mark order "Ready" → status updates, server notified
- [ ] Real-time: new POS order appears immediately
- [ ] Browser notification on new order (if permission granted)
- [ ] Audio alert on new order
- [ ] Fullscreen mode toggle
- [ ] Wake lock keeps screen on
- [ ] Multi-location: filtered by selected location
- [ ] Orders sorted oldest-first (FIFO)
- [ ] Long order notes truncated with expand option

---

## 9. SERVER

- [ ] "Ready" orders displayed prominently
- [ ] "Served" orders shown (waiting for payment)
- [ ] "Serve" button marks order as served → table still occupied
- [ ] "Complete" button → clears table, marks order done
- [ ] Server can "claim" an order (badge shows their name)
- [ ] Claimed orders persist across page refresh (localStorage)
- [ ] Notifications when order becomes ready
- [ ] Elapsed time per table displayed (full service)
- [ ] Multi-location: filtered by selected location

---

## 10. TABLE LAYOUT

- [ ] Visual grid of restaurant tables renders
- [ ] Add new table: table number, capacity, shape
- [ ] Edit table properties
- [ ] Delete table (with confirmation modal)
- [ ] Drag-and-drop table positioning on layout
- [ ] Table status: available (green), occupied (red), reserved (yellow)
- [ ] Click occupied table → view order details
- [ ] Table status updates in real-time (when order placed/completed)
- [ ] Multi-location: tables per location
- [ ] Table layout saved and persists

---

## 11. PAYMENTS

- [ ] Payment history list renders (all completed payments)
- [ ] Filter by date range
- [ ] Filter by payment method (cash, card, terminal)
- [ ] Search by order ID or amount
- [ ] Payment details: amount, method, tip, timestamp, order ID
- [ ] Refund button on each payment
- [ ] Full refund processes correctly
- [ ] Partial refund processes correctly (enter amount)
- [ ] Refunded payments marked with refund badge
- [ ] Tax rate configuration (default 8%, editable)
- [ ] Tax rate change reflected in POS
- [ ] Payment summary/totals for selected period
- [ ] Export payments (if available)
- [ ] Multi-location: filtered by selected location

---

## 12. ORDERS

- [ ] Order history list renders (all orders, all statuses)
- [ ] Filter by status: active, completed, cancelled
- [ ] Filter by date range
- [ ] Filter by order type: dine-in, online, pickup, delivery
- [ ] Search by order ID
- [ ] Order details: items, qty, notes, total, status, timestamps
- [ ] Cancel order action (with confirmation)
- [ ] Reprint receipt for completed order
- [ ] Real-time updates when order status changes
- [ ] Multi-location: filtered by selected location
- [ ] Pagination for large order lists

---

## 13. PROMOTIONS & REWARDS

### 13.1 Promotions
- [ ] Create new promotion: name, type (percentage/fixed/BOGO), value, start date, end date
- [ ] Edit existing promotion
- [ ] Delete promotion (with confirmation modal)
- [ ] Toggle promotion active/inactive
- [ ] Active promotion applied during checkout (POS + online ordering)
- [ ] Promo code generation
- [ ] Promo code validation on customer portal

### 13.2 Loyalty/Rewards
- [ ] Loyalty program configuration: points per dollar, redemption threshold
- [ ] Customers earn points on purchases
- [ ] Points balance visible on customer portal
- [ ] Spin wheel configuration (if available)
- [ ] Rewards redeemable at checkout

---

## 14. REVIEW MANAGEMENT

- [ ] Reviews list renders
- [ ] Pending reviews shown for approval
- [ ] Approve review → published on website
- [ ] Reject review → removed
- [ ] Reply to review
- [ ] Review sources: Yelp, Google, in-app
- [ ] Star ratings display correctly
- [ ] Average rating calculation accurate
- [ ] Responsive layout on mobile (review cards stack)

---

## 15. ANALYTICS (Guide+ Tiers)

### 15.1 Classic Analytics
- [ ] Revenue chart (daily/weekly/monthly)
- [ ] Order count chart
- [ ] Popular items chart
- [ ] Peak hours chart
- [ ] Average order value
- [ ] Date range selector
- [ ] Multi-location: analytics per location

### 15.2 AI Analytics (Elder Tier)
- [ ] AI-powered insights panel renders
- [ ] Revenue trend analysis
- [ ] Customer behavior insights
- [ ] Menu optimization suggestions
- [ ] Predictive analytics
- [ ] Feature locked for non-Elder tiers (shows upgrade prompt)

---

## 16. SEO & SOCIAL (Chief+ Tiers)

### 16.1 Business Listings
- [ ] Google Business profile connection
- [ ] Yelp profile connection
- [ ] Business info sync (name, address, hours, photos)
- [ ] Feature locked for non-Chief tiers

### 16.2 Social Media
- [ ] Facebook connection/posting
- [ ] Instagram connection/posting
- [ ] Twitter/X connection/posting
- [ ] Create new post: text, image, select platforms
- [ ] Schedule post for future date
- [ ] Post history with status (published, failed, scheduled)
- [ ] Disconnect social account
- [ ] Feature locked for non-Chief tiers

---

## 17. WEBSITE BUILDER (Guide+ Tiers)

### 17.1 Website Setup
- [ ] Template selection: Modern Bistro, Italian Trattoria, Fresh Cafe, Warm Spice
- [ ] Preview each template before selecting
- [ ] Website configuration: restaurant name, tagline, about, logo, hero image
- [ ] Color theme customization
- [ ] Menu sections configuration
- [ ] Business hours configuration
- [ ] Contact information
- [ ] Social media links
- [ ] SEO meta tags (title, description)

### 17.2 Website Preview
- [ ] Preview button opens restaurant website in new tab
- [ ] Preview uses authenticated preview mode (not public)
- [ ] Preview shows current draft changes (not just published)
- [ ] Preview URL format: `serveWebsite?restaurant={slug}&preview={restaurantId}`

### 17.3 Website Publishing
- [ ] Publish button makes website live
- [ ] Published website accessible at public URL
- [ ] Published website shows correct template
- [ ] Published website shows menu items with prices
- [ ] Published website shows promotions
- [ ] Published website has online ordering enabled (if configured)

### 17.4 Custom Domain
- [ ] Custom domain input field
- [ ] Domain verification instructions shown
- [ ] Custom domain serves restaurant website after DNS setup

### 17.5 Feature Gating
- [ ] Guide/Chief/Elder: full access
- [ ] Scout/Ally: feature locked with upgrade prompt

---

## 18. WEBSITE INTEGRATION (Guide+ Tiers)

- [ ] Widget embed code generation
- [ ] Copy embed code button
- [ ] Widget preview renders
- [ ] Embed code works on external site (paste into test HTML page)
- [ ] Widget shows menu, allows ordering
- [ ] Widget respects restaurant theme/branding

---

## 19. CUSTOMER-FACING WEBSITE

### 19.1 Menu Display
- [ ] Categories render as navigation tabs
- [ ] Items display with name, description, price, image
- [ ] Discounted items show original and sale price
- [ ] Spice levels shown on applicable items
- [ ] Items filterable by category
- [ ] Responsive layout (desktop, tablet, mobile)

### 19.2 Online Ordering
- [ ] "Add to Cart" button on each item
- [ ] Item modal: qty, special notes, spice level
- [ ] Cart icon shows item count
- [ ] Cart panel: items, qty adjusters, subtotal
- [ ] Remove item from cart
- [ ] Checkout flow: customer name, phone, email
- [ ] Phone verification via OTP (if enabled, currently bypassed)
- [ ] Payment options: prepaid (Stripe) or pay-at-store
- [ ] Stripe payment form renders and processes
- [ ] Order confirmation page
- [ ] Order confirmation email/SMS sent
- [ ] Order appears in restaurant POS/Kitchen

### 19.3 Customer Account
- [ ] Customer registration
- [ ] Customer login
- [ ] Order history view
- [ ] Loyalty points balance
- [ ] Reward redemption

### 19.4 Promotions & Rewards on Website
- [ ] Active promotions displayed
- [ ] Promo code input at checkout
- [ ] Promo code applied to total
- [ ] Spin wheel (if configured)
- [ ] Loyalty points shown (if logged in)

### 19.5 Reviews on Website
- [ ] Approved reviews displayed
- [ ] Average rating shown
- [ ] Submit new review (with star rating)
- [ ] Review requires name and rating

### 19.6 Contact & Info
- [ ] Restaurant address, phone, hours displayed
- [ ] Google Maps embed (if API key configured)
- [ ] About section with restaurant description
- [ ] Social media links

### 19.7 Multi-Location
- [ ] Location selector appears (if multi-location restaurant)
- [ ] Selecting location filters menu and info
- [ ] Each location can have different menu items

---

## 20. WIDGET EMBED MODE

- [ ] Widget renders inside iframe on external site
- [ ] Menu tab: items display correctly
- [ ] Cart functionality works within widget
- [ ] Checkout flow completes within widget
- [ ] No sidebar, modals, or full-page elements breaking embed
- [ ] `embedMode` flag respected throughout
- [ ] `switchView()` navigation works
- [ ] `addToCart()` from embed works
- [ ] Styles don't leak outside widget (`.cp-embed-mode` overrides)
- [ ] Widget responsive at various container sizes

---

## 21. DELIVERY (DoorDash Drive — Chief+ Tiers)

- [ ] Delivery toggle in restaurant settings
- [ ] Delivery option appears on customer website checkout
- [ ] Delivery address input with validation
- [ ] Delivery quote fetched from DoorDash (`getDeliveryQuote`)
- [ ] Quote displays: fee, estimated delivery time
- [ ] Quote expiration timer (4.5 min) with refresh option
- [ ] Accept delivery → creates DoorDash delivery
- [ ] Track delivery status: created → picked_up → delivered
- [ ] Delivery status updates in restaurant dashboard
- [ ] Cancel delivery option (before pickup)
- [ ] Webhook status updates from DoorDash processed correctly
- [ ] Feature locked for non-Chief tiers

---

## 22. MOBILE APP (Elder Tier)

- [ ] Mobile app configuration page renders
- [ ] App name input
- [ ] App icon upload
- [ ] Splash screen configuration
- [ ] Color theme matches restaurant branding
- [ ] "Build App" button triggers GitHub Actions workflow
- [ ] Build status updates in real-time (queued → building → submitted → live)
- [ ] Build failure shows error details
- [ ] Download/install instructions shown on success
- [ ] Feature locked for non-Elder tiers

---

## 23. ACCOUNT SETTINGS

### 23.1 Profile
- [ ] Edit restaurant name
- [ ] Edit username
- [ ] Edit email (Firebase Auth update)
- [ ] Edit phone number
- [ ] Edit address
- [ ] Save changes persists to Firestore
- [ ] Change password
- [ ] Profile photo/logo upload

### 23.2 Configuration
- [ ] Service mode selector: Full Service, Counter Service, Food Truck
- [ ] Payment timing: Pre-pay vs Post-pay
- [ ] Tax rate input (%, default 8%)
- [ ] Customer display toggle
- [ ] Customer display configuration
- [ ] Tip presets configuration (default: 15%, 18%, 20%, 25%)
- [ ] Reimbursement PIN setup

### 23.3 Two-Factor Authentication
- [ ] Enable 2FA → shows QR code
- [ ] Scan QR with authenticator app
- [ ] Enter code to verify setup
- [ ] Backup codes generated and displayed
- [ ] Disable 2FA (requires code)
- [ ] Regenerate backup codes (requires code)
- [ ] Login with 2FA enabled requires code

### 23.4 Subscription Management
- [ ] Current plan displayed (tier, billing cycle, status)
- [ ] Renewal date shown
- [ ] Order usage stats (current/limit)
- [ ] All 5 tier cards with current pricing (discount-aware)
- [ ] Discount badge on discounted tiers
- [ ] Original price crossed out if discount active

### 23.5 Plan Upgrade
- [ ] Click higher tier → upgrade confirmation modal
- [ ] Modal shows: current plan → new plan, billing cycle, price per location
- [ ] Discount info shown in modal if active
- [ ] Prorated billing note shown for subscription upgrades
- [ ] Confirm upgrade → Stripe subscription updated with proration
- [ ] New tier features immediately available
- [ ] Success message shown

### 23.6 Plan Downgrade
- [ ] Click lower tier → downgrade confirmation modal
- [ ] Modal shows downgrade scheduled at period end
- [ ] "You'll keep your current features until then" message
- [ ] Confirm downgrade → `pendingDowngrade` saved
- [ ] Pending downgrade applied at next renewal (webhook)

### 23.7 Billing Cycle Change
- [ ] Click different billing cycle (Monthly/Quarterly/Annual)
- [ ] Confirmation modal shows new pricing
- [ ] Discount applied if active for new cycle
- [ ] Change processed

### 23.8 Stripe Connect
- [ ] "Connect Stripe Account" button
- [ ] Redirects to Stripe Connect onboarding
- [ ] Return from Stripe → account connected
- [ ] Connected status shown with account details
- [ ] Disconnect option
- [ ] Customer payments routed to connected account (not platform)
- [ ] Overage charges routed to platform account (not connected)

### 23.9 Stripe Terminal Setup
- [ ] Create terminal location
- [ ] Register reader (registration code or simulated)
- [ ] List connected readers
- [ ] Delete reader
- [ ] Terminal configuration display

### 23.10 Staff Management
- [ ] Create staff account (username, password, role)
- [ ] Edit staff permissions
- [ ] Delete staff account
- [ ] Staff login works with created credentials

### 23.11 Multi-Location Management
- [ ] Add new location (name, address)
- [ ] Edit location details
- [ ] Set default location
- [ ] Delete location (with confirmation)
- [ ] Location-specific settings (tax rate, hours)

### 23.12 Printer Configuration
- [ ] Printer type selection (USB, Bluetooth, Network)
- [ ] Printer connection settings
- [ ] Test print button
- [ ] Auto-print on order completion toggle

---

## 24. STRIPE CONNECT (Payment Routing)

- [ ] New restaurant without Stripe Connect: payments go to platform
- [ ] Restaurant with Stripe Connect: customer payments go to connected account
- [ ] Overage charges always go to platform account (no `transfer_data`)
- [ ] Subscription charges always go to platform account
- [ ] Stripe Connect onboarding flow completes successfully
- [ ] Connected account status correctly reflected in dashboard
- [ ] Disconnect → reverts to platform-only payments

---

## 25. SUBSCRIPTION LIFECYCLE (Stripe Webhooks)

### 25.1 Successful Renewal
- [ ] `invoice.paid` event → subscription status = "active"
- [ ] Order usage counters reset to 0
- [ ] Billing period dates updated
- [ ] Last payment amount recorded

### 25.2 Failed Payment
- [ ] `invoice.payment_failed` → subscription status = "past_due"
- [ ] Warning banner shown in dashboard
- [ ] Restaurant can still operate (grace period)

### 25.3 Subscription Cancellation
- [ ] `customer.subscription.deleted` → status = "canceled"
- [ ] Cancellation date recorded
- [ ] Features restricted after cancellation

### 25.4 Trial Expiry
- [ ] Trial ends → Stripe charges saved card
- [ ] If payment succeeds → status transitions to "active"
- [ ] If payment fails → status = "past_due"

### 25.5 Pending Downgrade on Renewal
- [ ] Downgrade scheduled → `pendingDowngrade` in Firestore
- [ ] On renewal → webhook applies downgrade (new tier, new price)
- [ ] `pendingDowngrade` cleared after application

---

## 26. ORDER USAGE & OVERAGE

- [ ] Order count increments on each POS order
- [ ] Order count increments on each online order
- [ ] Usage stats visible in Account page
- [ ] Scout: hard cap enforced (order blocked at limit)
- [ ] Scout: blocked order shows user-friendly error (not crash)
- [ ] Ally: overage tracked at 2% per order beyond 500
- [ ] Guide: overage tracked at 1% per order beyond 2000
- [ ] Chief: overage tracked at 0.5% per order beyond 5000
- [ ] Elder: no limit, no overage
- [ ] Overage billing function charges accumulated overage
- [ ] Overage charged to platform Stripe (not connected account)
- [ ] Usage counters reset on subscription renewal

---

## 27. CUSTOMER DISPLAY

- [ ] Customer display page renders (`/customer-display`)
- [ ] Enable/disable customer display in Account settings
- [ ] Display shows current order items and running total
- [ ] Display updates in real-time as items added in POS
- [ ] Tip options shown (if configured)
- [ ] Display clears after order completed
- [ ] Configuration: logo, colors, tip presets

---

## 28. NOTIFICATIONS (Email & SMS)

- [ ] Welcome email on restaurant signup
- [ ] Welcome SMS on restaurant signup (if phone provided)
- [ ] Order receipt email to customer
- [ ] Order receipt SMS to customer
- [ ] Password reset email
- [ ] Contact form email to platform
- [ ] Order confirmation to restaurant (new online order)
- [ ] Email sender shows correct address (not `onboarding@resend.dev`)
- [ ] SMS from correct Twilio number

---

## 29. CROSS-BROWSER & RESPONSIVE

### 29.1 Desktop Browsers
- [ ] Chrome (latest): full test pass
- [ ] Safari (latest): full test pass
- [ ] Firefox (latest): full test pass
- [ ] Edge (latest): full test pass

### 29.2 Mobile Browsers
- [ ] iOS Safari: landing page, signup, customer website
- [ ] Android Chrome: landing page, signup, customer website
- [ ] POS on tablet: layout works, touch targets adequate

### 29.3 Responsive Breakpoints
- [ ] Landing page responsive (desktop → mobile)
- [ ] Dashboard sidebar collapses on < 768px
- [ ] POS resizable panels work on tablet
- [ ] Menu management responsive
- [ ] Review cards stack on mobile
- [ ] Payment forms usable on mobile

---

## 30. SECURITY & EDGE CASES

### 30.1 Authentication
- [ ] Unauthenticated user cannot access `/home` or any protected route
- [ ] Staff user cannot access Account/Admin pages
- [ ] Admin user cannot access restaurant dashboard (separate auth)
- [ ] Session timeout: user re-prompted to login
- [ ] Multiple tabs: auth state synced

### 30.2 Data Isolation
- [ ] Restaurant A cannot see Restaurant B's data
- [ ] Restaurant A cannot modify Restaurant B's data
- [ ] Staff can only access their restaurant's data

### 30.3 Input Validation
- [ ] Menu item price: negative values rejected
- [ ] Tax rate: bounded (0-100%)
- [ ] Location count: bounded (1-100)
- [ ] Phone number: validated format
- [ ] Email: validated format
- [ ] XSS attempt in text fields: sanitized

### 30.4 Payment Security
- [ ] Server-side price verification on all payments
- [ ] Client cannot manipulate payment amounts
- [ ] Stripe Elements properly sandboxed (PCI compliance)
- [ ] No Stripe secret keys in frontend code

### 30.5 Rate Limiting
- [ ] Contact form: max 3/hr per email
- [ ] Staff email lookup: max 10/min
- [ ] Review submission: max 5/hr
- [ ] Phone verification: max 3/hr per phone

---

## 31. PERFORMANCE

- [ ] Landing page loads in < 3 seconds
- [ ] Dashboard loads in < 3 seconds
- [ ] POS menu items load in < 2 seconds
- [ ] Customer website loads in < 3 seconds
- [ ] Image uploads complete in < 5 seconds
- [ ] No memory leaks on long POS sessions (8+ hours)
- [ ] No visible jank during real-time updates

---

## 32. ERROR HANDLING

- [ ] No `window.alert()` or `window.confirm()` anywhere in the app
- [ ] All errors shown via in-app toasts or inline messages
- [ ] Stripe payment errors show user-friendly messages
- [ ] Network errors handled gracefully (retry option shown)
- [ ] 404 page for unknown routes
- [ ] Firebase permission denied: shows "access denied" not raw error

---

## Test Execution Tracker

| Section | Total Cases | Passed | Failed | Bugs Filed |
|---------|------------|--------|--------|------------|
| 1. Landing Page | 28 | | | |
| 2. Authentication | 30 | | | |
| 3. Platform Admin | 25 | | | |
| 4. Dashboard Navigation | 12 | | | |
| 5. Home Page | 9 | | | |
| 6. Menu Management | 18 | | | |
| 7. POS | 37 | | | |
| 8. Kitchen Display | 13 | | | |
| 9. Server | 9 | | | |
| 10. Table Layout | 10 | | | |
| 11. Payments | 15 | | | |
| 12. Orders | 11 | | | |
| 13. Promotions & Rewards | 12 | | | |
| 14. Review Management | 9 | | | |
| 15. Analytics | 10 | | | |
| 16. SEO & Social | 9 | | | |
| 17. Website Builder | 16 | | | |
| 18. Website Integration | 6 | | | |
| 19. Customer Website | 26 | | | |
| 20. Widget Embed | 11 | | | |
| 21. Delivery | 13 | | | |
| 22. Mobile App | 9 | | | |
| 23. Account Settings | 42 | | | |
| 24. Stripe Connect | 7 | | | |
| 25. Subscription Lifecycle | 10 | | | |
| 26. Order Usage & Overage | 12 | | | |
| 27. Customer Display | 7 | | | |
| 28. Notifications | 9 | | | |
| 29. Cross-Browser | 11 | | | |
| 30. Security | 15 | | | |
| 31. Performance | 7 | | | |
| 32. Error Handling | 6 | | | |
| **TOTAL** | **~464** | | | |

---

## Bug Log

| # | Section | Test Case | Severity | Description | Status |
|---|---------|-----------|----------|-------------|--------|
| 1 | 1.5 Pricing | Billing cycle toggle | Medium | Prices don't change when switching between Monthly/Quarterly/Annual — admin billing multipliers may all be set to 1.0. The +20%/+10% badges were misleading. **Fix:** badges now only show when multiplier > 1.0, computed dynamically from admin config. | Fixed |
| 2 | 1.5 Pricing | Tier "Get Started" buttons | High | Clicking "Start Free" or "Get Started" on pricing tier cards does not navigate to `/signup`. **Fix:** replaced `<button onClick={navigate}>` with `<Link to={url}>` for reliable React Router navigation. | Fixed |
| 3 | 2.1 Login | Forgot Password | High | "Forgot Password" link is completely missing from the login page. **Fix:** added "Forgot Password?" link, reset email form, and success confirmation using Firebase `sendPasswordResetEmail`. No `alert()` used. | Fixed |
| 4 | 2.2 Signup | "Continue to Payment" button | Medium | The "Continue to Payment →" button click handler doesn't advance to Step 2. Only keyboard Enter works. **Fix:** added explicit `onClick` handler as fallback that validates form and calls `handleAccountSubmit`. | Fixed |
| 5 | 2.1 Login | Error message formatting | Low | Invalid login error shows raw Firebase error: "Failed to sign in: Firebase: Error (auth/invalid-login-credentials)." **Fix:** added error code map for 8 Firebase error codes, unknown errors show "Unable to sign in. Please try again." | Fixed |
