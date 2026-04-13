# Build & Deploy Safety Rules

## Two Environments — Never Mix

| | DEV | PRODUCTION |
|---|---|---|
| **Firebase Project** | `restaurant-portal-6b147` | `kodacarte-861d8` |
| **Firebase Account** | `sanjivbhatta100@gmail.com` | `sanjeev@kodacarte.com` |
| **CLI Alias** | `dev` (default) | `prod` |
| **Build Command** | `npm run build:only` | `npm run build:prod:only` |
| **App URL** | https://restaurant-portal-6b147.web.app | https://kodacarte-861d8.web.app |

Each Firebase project has its **own Auth database**. Users in dev do not exist in prod. Deploying the wrong build = auth failures for all users.

## Default to DEV — Never Deploy to Production Unless Explicitly Asked

- **All development, testing, and iteration happens on DEV.** This is the default.
- **NEVER deploy to production** unless the user explicitly says "deploy to production" or "deploy to prod."
- If the user says "deploy" without specifying, **always deploy to DEV only.**
- **NEVER switch Firebase credentials** to `sanjeev@kodacarte.com` or run `firebase use prod` unless production deployment is explicitly requested.

## Never Mix Credentials

- Before any deploy, verify the active Firebase account matches the target:
  - DEV deploy = must be logged in as `sanjivbhatta100@gmail.com`
  - PROD deploy = must be logged in as `sanjeev@kodacarte.com`
- **NEVER** run a build command that doesn't match the deploy target:
  - Dev hosting = `npm run build:only` only
  - Prod hosting = `npm run build:prod:only` only
- **NEVER** deploy a dev build to prod or a prod build to dev.

## Never Run react-scripts Directly

**NEVER** run `npx react-scripts build` or `react-scripts build` directly.
Always use npm scripts. Running react-scripts directly skips `REACT_APP_FIREBASE_ENV`,
causing the app to use the wrong Firebase project.

## Deploy Functions in Batches

**NEVER** deploy all functions at once (`firebase deploy --only functions`).
The Cloud Run CPU quota will be exceeded, causing most function updates to fail.
Deploy specific functions or batches of ~10-15 at a time:

```bash
firebase deploy --only functions:functionName1,functions:functionName2 --project kodacarte-861d8
```

## Always Switch Back to Dev After Prod Deploy

After deploying to production, **always** switch back to dev so local development stays on the dev project:

```bash
firebase login:use sanjivbhatta100@gmail.com
firebase use dev
```
