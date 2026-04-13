---
name: deploy
description: >
  Deploy Koda Carte to Firebase. Validates environment (dev vs prod), ensures correct build config,
  checks Firebase login, and prevents cross-environment deployment mistakes.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash Read Grep
argument-hint: [dev|prod|both|functions]
---

# Deploy Koda Carte

**Target:** $ARGUMENTS

## Pre-flight Checks

**Current Firebase state:**
```!
echo "=== Firebase Alias ===" && cat .firebaserc | grep -A5 '"projects"' 2>/dev/null
echo "=== Current Login ===" && firebase login:list 2>/dev/null | head -3
echo "=== Active Project ===" && firebase use 2>/dev/null | head -1
```

**Current build environment:**
```!
echo "=== .env REACT_APP vars ===" && grep REACT_APP .env 2>/dev/null | head -3
echo "=== .env.production REACT_APP vars ===" && grep REACT_APP .env.production 2>/dev/null | head -3
```

---

## Deployment Commands

### Deploy to DEV
```bash
firebase login:use sanjivbhatta100@gmail.com
firebase use dev
npm run build:only              # DEV config
firebase deploy --only hosting
```

### Deploy to PRODUCTION
```bash
firebase login:use sanjeev@kodacarte.com
firebase use prod
npm run build:prod:only         # PROD config
firebase deploy --only hosting --project kodacarte-861d8
```

### Deploy to BOTH
```bash
# Step 1: Dev
firebase login:use sanjivbhatta100@gmail.com
firebase use dev
npm run build:only
firebase deploy --only hosting

# Step 2: Prod (must rebuild!)
firebase login:use sanjeev@kodacarte.com
firebase use prod
npm run build:prod:only
firebase deploy --only hosting --project kodacarte-861d8

# Step 3: Switch back to dev
firebase login:use sanjivbhatta100@gmail.com
firebase use dev
```

### Deploy Functions to PRODUCTION
```bash
firebase login:use sanjeev@kodacarte.com
firebase deploy --only functions --project kodacarte-861d8
```

### Deploy Everything to PRODUCTION
```bash
firebase login:use sanjeev@kodacarte.com
firebase use prod
npm run build:prod:only
firebase deploy --project kodacarte-861d8
```

---

## Critical Rules

1. **DEFAULT IS DEV.** If the user says "deploy" without specifying, deploy to DEV only. **NEVER deploy to production unless explicitly asked** ("deploy to prod", "deploy to production").

2. **Never mix credentials.** Before deploying:
   - DEV: must be `sanjivbhatta100@gmail.com` with `firebase use dev`
   - PROD: must be `sanjeev@kodacarte.com` with `firebase use prod`

3. **Build config MUST match target:**
   - Dev hosting = `build:only` (REACT_APP_FIREBASE_ENV=development)
   - Prod hosting = `build:prod:only` (REACT_APP_FIREBASE_ENV=production)

4. **Each Firebase project has separate Auth DB.** Users in dev do not exist in prod. Wrong build = auth failures.

5. **Always switch back to dev** after deploying to prod (so local dev stays on dev project).

6. **Test before deploying to prod:** Run `npm run test:ci` before any production deploy.

7. **Functions deploy** can show quota errors but still succeed. Run deploy again — if it says "No changes detected / Skipped", the first deploy worked.

## Post-Deploy Verification

After deploying, verify:
- [ ] App loads without errors
- [ ] Login works with correct credentials
- [ ] POS loads menu items correctly
- [ ] Orders can be placed and appear in Kitchen
