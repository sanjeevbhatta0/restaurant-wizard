# Testing Requirements

## All New Development Must Include Tests

Every new feature, bug fix, or enhancement must have corresponding tests:
- **Unit tests** — Logic, calculations, state management
- **Integration tests** — Component interactions, mocked Firestore
- **E2E tests** — Full flow with Firebase emulators

A feature is not complete until its tests pass.

## Build Gate

`npm run build` runs all tests first. Build fails if any test fails.
Use `npm run build:only` or `npm run build:prod:only` to skip tests during rapid iteration.

## Test Commands

```bash
npm run test:ci          # Full CI with coverage (use before deploy)
npm run test:pos         # POS flow
npm run test:widget      # Widget/website
npm run test:e2e         # E2E (requires emulators)
```

Use `/test-runner` skill for smart test selection based on changed files.

## E2E Tests Require Emulators

```bash
# Terminal 1
firebase emulators:start

# Terminal 2
FIRESTORE_EMULATOR_HOST=localhost:8080 npm run test:e2e
```

Without emulators, E2E tests auto-skip to mock fallback tests.
