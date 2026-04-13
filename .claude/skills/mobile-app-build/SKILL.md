---
name: mobile-app-build
description: >
  White-label mobile app build pipeline for Koda Carte. Covers the full flow: triggering GitHub Actions
  workflow, EAS Build credentials, App Store Connect setup, TestFlight submission. Reference for
  debugging build failures, understanding the credential chain, and known Apple API limitations.
user-invocable: false
disable-model-invocation: false
allowed-tools: Bash Read Grep Glob
---

# White-Label Mobile App Build Pipeline

## Overview

Koda Carte offers white-label iOS apps for restaurants (Elder Plan). Each restaurant gets its own
App Store listing with custom branding. The pipeline is fully automated via GitHub Actions → EAS Build → App Store Connect.

**Repositories:**
- `restaurant-wizard` — Main SaaS platform (triggers builds via Cloud Function `publishMobileApp`)
- `customer-app` — React Native / Expo app (GitHub Actions workflow runs here)

## Architecture

```
Restaurant Owner clicks "Publish App" in Koda Carte dashboard
  → Cloud Function `publishMobileApp` triggers GitHub Actions via repository_dispatch
  → GitHub Actions workflow: `.github/workflows/white-label-build.yml`
    1. Generate white-label assets (icons, splash screens) from restaurant logo
    2. Setup iOS credentials programmatically (setup-eas-credentials.ts)
    3. Inject WHITE_LABEL_* env vars into eas.json for remote EAS builder
    4. Patch GoogleService-Info.plist with white-label bundle ID
    5. EAS Build (remote Xcode compilation, ~15 min)
    6. Create/find App Store Connect app listing
    7. EAS Submit to App Store Connect / TestFlight
    8. Webhook status updates back to Koda Carte dashboard
```

## Key Files (customer-app repo)

| File | Purpose |
|------|---------|
| `.github/workflows/white-label-build.yml` | Main workflow — orchestrates everything |
| `scripts/setup-eas-credentials.ts` | Programmatic iOS credential setup (certs, profiles, bundle IDs) |
| `scripts/generate-assets.ts` | Generates app icons and splash screens from restaurant logo |
| `app.config.ts` | Dynamic Expo config — switches between base and white-label builds |
| `app.json` | Base Expo config (Koda Carte platform app) |
| `eas.json` | EAS Build and Submit profiles |

## Credential Chain (iOS)

All credentials are managed programmatically by `setup-eas-credentials.ts`:

```
Apple Developer Account (Individual, Team ID: 79CV2Q4ZSN)
  → Distribution Certificate (per-team, shared across all apps)
    → P12 uploaded to Expo (must use -legacy flag for macOS/Xcode compat)
  → Bundle ID: com.kodacarte.wl.<bundleSuffix> (per restaurant)
    → Provisioning Profile (per bundle ID, links to Distribution Certificate)
      → Uploaded to Expo as IosAppBuildCredentials
```

**Expo GraphQL Credential Entities (linked in order):**
1. `AppleDistributionCertificate` — P12 cert uploaded to Expo
2. `AppleAppIdentifier` — Bundle ID entity on Expo
3. `IosAppCredentials` — Links app identifier to Apple team
4. `AppleProvisioningProfile` — Profile uploaded to Expo
5. `IosAppBuildCredentials` — Links everything for a specific build profile

## GitHub Secrets (customer-app repo)

| Secret | Description |
|--------|-------------|
| `EXPO_TOKEN` | Expo access token for EAS CLI |
| `ASC_KEY_ID` | App Store Connect API Key ID (currently: `MVAW44W5DT`, Admin role) |
| `ASC_ISSUER_ID` | ASC API Issuer ID (`5c1a451f-3d59-44fb-b0fd-c3a166ba8aa5`) |
| `ASC_API_KEY_P8` | Base64-encoded ASC API .p8 key file |
| `APPLE_TEAM_ID` | Apple Developer Team ID (`79CV2Q4ZSN`) |

**P8 key file location (local backup):** `~/Downloads/AuthKey_MVAW44W5DT.p8`

## White-Label Bundle ID Convention

```
com.kodacarte.wl.<bundleSuffix>
```
Example: `com.kodacarte.wl.gurkhakitchenexpress`

## Triggering a Build

### Via Cloud Function (production flow)
Restaurant owner clicks "Publish App" in the MobileApp component → calls `publishMobileApp` Cloud Function
→ triggers GitHub Actions workflow dispatch.

### Via GitHub CLI (manual/debug)
```bash
cd /path/to/customer-app
gh workflow run "White Label Build & Publish" \
  -f restaurantId=<FIRESTORE_UID> \
  -f bundleSuffix=<lowercase_no_spaces> \
  -f appName="<Display Name>" \
  -f platforms=ios \
  -f logoUrl="<logo_url>" \
  -f primaryColor="#2c3e50" \
  -f webhookUrl="<webhook_url>" \
  -f webhookToken="<token>"
```

## Known Limitations & Manual Steps

### App Store Connect App Creation (MANUAL — Apple limitation)
**Individual Apple Developer accounts cannot create App Store Connect app listings via API.**
This applies to ALL API key roles (Admin, App Manager, Developer). The ASC REST API returns:
```
"The resource 'apps' does not allow 'CREATE'"
```

**Workaround:** For each NEW restaurant app, manually create the app in ASC:
1. Go to https://appstoreconnect.apple.com/apps
2. Click "+" → "New App"
3. Select iOS, enter app name, select bundle ID (`com.kodacarte.wl.<suffix>`), enter SKU
4. Note the `ascAppId` from the URL (e.g., `6762054759`)

The workflow's "Ensure App Store Connect app exists" step checks if the app already exists.
If it does, it auto-populates the `ascAppId`. Subsequent builds for the same restaurant
are fully automated.

**To eliminate this step:** Upgrade to Apple Developer Organization account ($99/year + D-U-N-S number).
Organization accounts CAN create apps via API.

### Apple Pay Not Available for White-Label Apps
The Stripe `merchantIdentifier` is removed from white-label builds to avoid requiring
per-app Apple Pay merchant ID registration. Card payments via Stripe still work.
Apple Pay can be added later by registering merchant IDs programmatically.

### GoogleService-Info.plist
The workflow patches the `BUNDLE_ID` in `GoogleService-Info.plist` to match the white-label
bundle ID before building. The Firebase project (`restaurant-portal-6b147`) is shared across
all white-label apps — they connect to the same Firebase backend.

## Debugging Build Failures

### Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Could not find target 'X' in project.pbxproj` | WHITE_LABEL_* env vars not reaching EAS builder | Ensure env vars are in eas.json `build.white-label-production.env` |
| `Provisioning profile doesn't include Apple Pay` | Stripe plugin adds Apple Pay entitlement | Remove `merchantIdentifier` from white-label Stripe plugin config |
| `Credentials are not set up. Run in interactive mode` | Missing provisioning profile on Expo | Run `setup-eas-credentials.ts` (workflow does this automatically) |
| `App Store Connect API Keys cannot be set up in --non-interactive` | Missing `ascApiKeyId`/`ascApiKeyIssuerId` in eas.json | Workflow injects these before submit step |
| `PKCS12 import failure` | OpenSSL 3.x creates incompatible P12 | Use `-legacy` flag in `openssl pkcs12 -export` |
| `The resource 'apps' does not allow 'CREATE'` | Individual account limitation | Create app manually in ASC web UI |

### Fetching EAS Build Logs
```bash
# Get build details and log URLs
npx eas-cli build:view <BUILD_ID> --json

# Log URLs expire after 15 minutes — fetch immediately after build failure
curl -s "<log_url>" | tail -200
```

### Checking TestFlight Status
```bash
# Via ASC API (requires PyJWT + cryptography)
python3 -c "
import jwt, time, json, urllib.request
# ... (see workflow for full example)
" 
```

## Existing White-Label Apps

| Restaurant | Bundle Suffix | Bundle ID | ASC App ID | Status |
|-----------|---------------|-----------|------------|--------|
| Gurkha Kitchen Express | gurkhakitchenexpress | com.kodacarte.wl.gurkhakitchenexpress | 6762054759 | Submitted to TestFlight |

## EAS Project

- **Project ID:** `ae5ea3e5-e899-4423-a7d2-06ee39d6756f`
- **Slug:** `koda-carte-customer`
- **Expo Account:** `012sanjivt`
- **EAS Dashboard:** https://expo.dev/accounts/012sanjivt/projects/koda-carte-customer
