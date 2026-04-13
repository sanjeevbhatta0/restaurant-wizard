# Portal Parity Rule

The customer-facing portal exists in **two rendering modes** that must stay in sync:
- **Website Builder mode** — full-page dashboard with sidebar, overlay, modals
- **Widget embed mode** — compact inline content, no sidebar

Any change to `portal.js`, `embed-app.js`, or `portal.css` **MUST work in both modes**.

## Key Rules

1. **Check `this.config.embedMode`** before accessing website-builder-only DOM elements
2. **Never assume** `main-content`, `account-page-container`, or other website builder DOM exists
3. **In embed mode**, use `embedApp.switchView()` for navigation, `embedApp.addToCart()` for cart
4. **New CSS** with fixed-width/fixed-position needs `.cp-embed-mode` overrides in `functions/index.js`
5. **New portal views** must have a corresponding widget tab in `embed-app.js`
6. **After changes**, run `npm run test:widget` to verify both modes

See `/portal-parity` skill for full checklist and method reference.
