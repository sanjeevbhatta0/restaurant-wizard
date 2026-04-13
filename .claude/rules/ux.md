# UX Conventions

## No Browser Popups

**NEVER** use `window.confirm()`, `window.alert()`, or `window.prompt()`.

Always use in-app UI for user interactions:
- **Confirmations** — Modal dialogs (React Bootstrap `<Modal>`)
- **Errors** — Toast notifications or inline error messages
- **User input** — Form fields within modals or pages

## Multi-Location Guards

When `isMultiLocation && !selectedLocation`:
- Show empty state or prompt location selection
- **Never show unfiltered data** from all locations
- All data queries must be scoped to `selectedLocation`
