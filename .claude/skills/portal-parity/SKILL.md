---
name: portal-parity
description: >
  Enforces portal parity between Website Builder and Widget embed mode.
  Any change to portal.js, embed-app.js, portal.css, or serveWebsite must work in both modes.
  Use this skill to verify parity after customer portal changes.
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash
paths:
  - "functions/templates/customer-portal/**"
  - "public/widget.js"
  - "public/embed.js"
---

# Portal Parity Check

The customer portal exists in **two rendering modes** that must stay in sync:

| Mode | Host | Entry Point | DOM Context |
|------|------|-------------|-------------|
| **Website Builder** | `serveWebsite` Cloud Function | Template HTML + `portal.js` | Full page: sidebar, overlay, modals |
| **Widget Embed** | `widget.js` + `embed-app.js` | iframe with `?embed=true` | Compact: no sidebar, inline content |

## Files Involved

| File | Role |
|------|------|
| `functions/templates/customer-portal/portal.js` | Shared logic (auth, orders, promos, rewards, spin wheel) |
| `functions/templates/customer-portal/portal.css` | Shared styles |
| `functions/templates/customer-portal/embed-app.js` | Widget-specific wrapper (menu, cart, checkout, tabs) |
| `public/widget.js` | Widget loader script (creates iframe) |
| `functions/index.js` (serveWebsite) | Serves both modes; injects `.cp-embed-mode` CSS for widget |

## Parity Checklist

For ANY change to portal.js, embed-app.js, or portal.css, verify ALL of these:

### 1. DOM Assumptions
- [ ] Never assume `main-content`, `account-page-container`, or other website builder DOM elements exist
- [ ] Always check `this.config.embedMode` before accessing website-builder-only DOM
- [ ] In embed mode, use `embedApp.*` methods instead of direct DOM manipulation

### 2. Navigation
- [ ] Website mode: `renderFullPageDashboard()` / `hideFullPageDashboard()`
- [ ] Embed mode: `embedApp.switchView('menu')` / `embedApp.switchView('account')`
- [ ] `hideFullPageDashboard()` already handles this — follow its pattern

### 3. Cart Operations
- [ ] Website mode: Direct cart manipulation
- [ ] Embed mode: `embedApp.addToCart()` / `embedApp.updateCartBar()`
- [ ] Don't use `window.cart` or direct DOM in embed mode

### 4. Global References
- [ ] Portal onclick handlers use `customerPortal.*`
- [ ] Works because embed-app.js sets `window.customerPortal = this.portal`
- [ ] Any new global handler must follow this pattern

### 5. CSS Overrides
- [ ] New fixed-width/fixed-position styles need `.cp-embed-mode` overrides
- [ ] Embed overrides are in `serveWebsite` function in `functions/index.js`
- [ ] Search for "Portal embed overrides" in functions/index.js

### 6. Data Loading
- [ ] Embed mode loads data in `switchView()` and `handleLogin()`/`handleSignup()`
- [ ] New data sources must be added to both loading paths
- [ ] Check `embedApp.portalDataLoaded` flag

### 7. Sign Out Button
- [ ] Website mode: sidebar has sign out
- [ ] Embed mode: `renderDashboard()` appends visible Sign Out in content area

## Widget Tab <--> Portal View Mapping

| Widget Tab | embed-app.js tab | Portal `currentView` | Renders |
|------------|-----------------|---------------------|---------|
| Menu | `menu` | N/A (shows menu) | EmbedApp menu |
| My Account | `account` | `account` | Account Overview + Sign Out |
| Orders | `orders` | `orders` | `renderAllOrders()` (active + past) |
| Promos | `promotions` | `promotions` | Promotions list |
| Rewards | `rewards` | `rewards` | Spin wheel + points + rewards |

**New portal views MUST have a corresponding widget tab.**

## Methods with Embed-Mode Branches (Reference)

These methods in portal.js already handle both modes — use as patterns:
- `renderDashboardContent()` — 'orders' shows `renderAllOrders()` instead of `renderOrderHistory()`
- `renderDashboard()` — appends Sign Out button in embed
- `hideFullPageDashboard()` — calls `embedApp.switchView('menu')`
- `reorder()` — uses `embedApp.addToCart()`
- `claimPromo()` — calls `this.showDashboard()` instead of `this.renderFullPageDashboard()`
- `handleLogin()` / `handleSignup()` — show loading, load all data, set `embedApp.portalDataLoaded`
- `handleLogout()` — clears cached data, resets `embedApp.portalDataLoaded`
- `getSpinPrizes()` — default fallback prizes

## Tests to Run After Portal Changes

```bash
# Unit + Integration + E2E
npm run test:widget

# Plus customer portal unit tests
npm run test:unit -- --testPathPattern="customerPortal|embedApp|websiteServing"
```
