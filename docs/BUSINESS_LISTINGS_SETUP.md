# Business Listings API Setup Guide

> **Purpose:** Step-by-step instructions for setting up Yelp, Google Business, and Apple Business Connect integrations for Koda Carte. Follow this guide when setting up a new environment (development, staging, production) or when rotating API credentials.

---

## Table of Contents

1. [Yelp Fusion API](#1-yelp-fusion-api)
2. [Google Business Profile API](#2-google-business-profile-api)
3. [Apple Business Connect](#3-apple-business-connect)
4. [Storing Secrets in Firebase](#4-storing-secrets-in-firebase)
5. [Deploying Functions](#5-deploying-functions)
6. [Verifying the Setup](#6-verifying-the-setup)
7. [API Limits & Pricing](#7-api-limits--pricing)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Yelp Fusion API

### What It Enables
- Search for restaurants on Yelp by name + location
- Fetch business details (rating, review count, address, hours, photos)
- Fetch up to 3 most recent reviews per business
- Use review data as AI context for social post generation

### What It Does NOT Enable
- Replying to reviews (must be done on Yelp directly)
- Editing business listings
- Accessing more than 3 reviews
- Yelp business owner analytics

### Setup Steps

1. **Create a Yelp Account** (if you don't have one)
   - Go to https://www.yelp.com/signup
   - Sign up with email and verify

2. **Go to Yelp Developers Portal**
   - Navigate to https://www.yelp.com/developers/v3/manage_app

3. **Create a New App**
   - Fill in the form:

   | Field | Value |
   |-------|-------|
   | App Name | Koda Carte |
   | Industry | Restaurant / Food & Dining |
   | Contact Email | support@kodacarte.com (or your business email) |
   | Description | Restaurant management platform that helps owners monitor their Yelp presence, track ratings, and generate AI-powered review responses |

   - Agree to Yelp's API Terms of Use
   - Click **Create New App**

4. **Copy Your Credentials**
   - You will see:
     - **Client ID** — note this but we don't use it directly
     - **API Key** — this is what we need (long string starting with letters/numbers)
   - Copy the **API Key**

5. **Store in Firebase** (see [Section 4](#4-storing-secrets-in-firebase))
   ```bash
   echo "YOUR_YELP_API_KEY" | firebase functions:secrets:set YELP_API_KEY
   ```

### Yelp API Key Format
- Long alphanumeric string with underscores
- Example format: `bVvb3dXPVK_PjMU9uadq...` (128+ characters)
- No spaces, no special characters beyond underscores

---

## 2. Google Business Profile API

### What It Enables
- OAuth-based connection where business owners authorize our platform
- Fetch all reviews (paginated, no limit)
- Reply to reviews directly from our portal
- Fetch business information (name, address, hours, etc.)

### What It Does NOT Enable
- Managing Google Ads
- Editing Google Maps listing details (separate API)
- Accessing Google Analytics

### Prerequisites
- A Google Cloud Project (can use the existing Firebase project: `restaurant-portal-6b147`)
- Billing enabled on the Google Cloud project
- Business Profile API access approved by Google

### Setup Steps

1. **Go to Google Cloud Console**
   - Navigate to https://console.cloud.google.com
   - Select project `restaurant-portal-6b147` (or your project)

2. **Enable the Business Profile API**
   - Go to: APIs & Services > Library
   - Search for "My Business" or "Business Profile"
   - Click **Google My Business API** (also called Business Profile API)
   - Click **Enable**

3. **Apply for API Access** (required)
   - Go to https://developers.google.com/my-business/content/prereqs
   - Fill out the API access request form
   - Google reviews the application (can take days to weeks)
   - You'll receive an email when approved
   - **Note:** Reviews/reply features won't work until approval is granted

4. **Configure OAuth Consent Screen**
   - Go to: APIs & Services > OAuth consent screen
   - Select **External** user type
   - Fill in:

   | Field | Value |
   |-------|-------|
   | App name | Koda Carte |
   | User support email | support@kodacarte.com |
   | App logo | Upload Koda Carte logo |
   | Developer contact email | support@kodacarte.com |

   - Add scopes:
     - `https://www.googleapis.com/auth/business.manage`
   - Save

5. **Create OAuth 2.0 Credentials**
   - Go to: APIs & Services > Credentials
   - Click **Create Credentials** > **OAuth client ID**
   - Application type: **Web application**
   - Name: `Koda Carte Business Listings`
   - Authorized redirect URIs — add:
     ```
     https://us-central1-restaurant-portal-6b147.cloudfunctions.net/handleGoogleAuthCallback
     ```
     For local development also add:
     ```
     http://localhost:5001/restaurant-portal-6b147/us-central1/handleGoogleAuthCallback
     ```
   - Click **Create**

6. **Copy Your Credentials**
   - **Client ID** — looks like: `123456789-abcdef.apps.googleusercontent.com`
   - **Client Secret** — looks like: `GOCSPX-...`

7. **Store in Firebase** (see [Section 4](#4-storing-secrets-in-firebase))
   ```bash
   echo "YOUR_CLIENT_ID" | firebase functions:secrets:set GOOGLE_BUSINESS_CLIENT_ID
   echo "YOUR_CLIENT_SECRET" | firebase functions:secrets:set GOOGLE_BUSINESS_CLIENT_SECRET
   ```

### Google OAuth Flow (How It Works at Runtime)
1. Restaurant owner clicks "Connect Google Business" in our portal
2. Our `initiateGoogleAuth` Cloud Function generates an OAuth URL
3. Owner is redirected to Google's consent screen
4. Owner authorizes Koda Carte to access their Business Profile
5. Google redirects to our `handleGoogleAuthCallback` Cloud Function
6. We exchange the authorization code for access + refresh tokens
7. Refresh token is stored in Firestore (per user)
8. Future API calls use the refresh token to get fresh access tokens

---

## 3. Apple Business Connect

### What It Enables
- Manual entry of Apple Business Connect information
- Direct link to Apple Business Connect dashboard
- Track that the business has claimed their Apple listing

### Why No API
- Apple Business Connect does not offer a public API for third-party integrations
- All management must be done through Apple's portal directly
- We provide a "command center" with deep links

### Setup Steps

No API setup required. Apple Business Connect works as manual entry in our portal:

1. Restaurant owner goes to https://businessconnect.apple.com
2. Signs in with their Apple ID
3. Claims/verifies their business listing
4. In our portal, they enter:
   - Business name on Apple
   - Apple Business Connect URL (for quick access)
   - Notes (e.g., "Verified on March 2026")

### For the Restaurant Owner
Share these instructions with restaurant owners who want to set up Apple Business Connect:

1. Go to https://businessconnect.apple.com
2. Sign in with your Apple ID (create one if needed)
3. Search for your business
4. Claim your listing and verify ownership
5. Once verified, come back to Koda Carte > SEO & Social > Business Connections
6. Click "Connect" under Apple and enter your business details

---

## 4. Storing Secrets in Firebase

All API keys and credentials are stored as Firebase Secrets (backed by Google Cloud Secret Manager).

### Setting Secrets

```bash
# Yelp
echo "YOUR_YELP_API_KEY" | firebase functions:secrets:set YELP_API_KEY

# Google Business (set placeholders if not ready yet)
echo "YOUR_CLIENT_ID" | firebase functions:secrets:set GOOGLE_BUSINESS_CLIENT_ID
echo "YOUR_CLIENT_SECRET" | firebase functions:secrets:set GOOGLE_BUSINESS_CLIENT_SECRET
```

### Viewing Current Secrets

```bash
# List all secrets
firebase functions:secrets:get YELP_API_KEY
firebase functions:secrets:get GOOGLE_BUSINESS_CLIENT_ID
firebase functions:secrets:get GOOGLE_BUSINESS_CLIENT_SECRET
```

### Updating Secrets

Run the same `secrets:set` command — it creates a new version automatically:
```bash
echo "NEW_API_KEY" | firebase functions:secrets:set YELP_API_KEY
```

### Deleting Secrets

```bash
firebase functions:secrets:destroy YELP_API_KEY
```

### Secret Names Reference

| Secret Name | Service | Purpose |
|-------------|---------|---------|
| `YELP_API_KEY` | Yelp Fusion v3 | API key for business search and reviews |
| `GOOGLE_BUSINESS_CLIENT_ID` | Google Business Profile | OAuth client ID |
| `GOOGLE_BUSINESS_CLIENT_SECRET` | Google Business Profile | OAuth client secret |
| `GEMINI_API_KEY` | Google Gemini AI | AI content generation (already configured) |

---

## 5. Deploying Functions

After setting secrets, deploy the Cloud Functions:

```bash
# Deploy all functions
firebase deploy --only functions

# Or deploy only business listing functions
firebase deploy --only functions:searchYelpBusiness,functions:connectYelpBusiness,functions:fetchYelpReviews,functions:initiateGoogleAuth,functions:handleGoogleAuthCallback,functions:fetchGoogleReviews,functions:replyToGoogleReview,functions:generateReviewResponse,functions:generateVisibilityTasks,functions:getBusinessListingsOverview
```

### If You Hit CPU Quota Errors

The free tier has limited CPU for Cloud Run. If you see "Quota exceeded for total allowable CPU per project per region":

1. **Wait 10-15 minutes** for failed revisions to wind down
2. **Deploy in small batches** (2-3 functions at a time):
   ```bash
   firebase deploy --only functions:searchYelpBusiness,functions:connectYelpBusiness
   # wait a minute
   firebase deploy --only functions:fetchYelpReviews,functions:generateReviewResponse
   ```
3. **Upgrade to Blaze plan** (pay-as-you-go) for higher quotas
4. **Clean up old revisions** via Google Cloud Console:
   - Go to https://console.cloud.google.com/run
   - Select each service > Revisions > Delete old failed revisions

---

## 6. Verifying the Setup

### Test Yelp Integration

1. Log in to the app with an **Elder tier** account
2. Go to **SEO & Social** tab
3. In the sidebar, find the **Business Connections** card
4. Click **Find My Business** under Yelp
5. Search for a known restaurant (e.g., "The Gurkha Kitchen" in "San Francisco")
6. Expected: Search results appear with name, rating, address
7. Select a result — it should show as "Connected" with rating and review count
8. Go to the **Reviews** tab — you should see up to 3 Yelp reviews

### Test Google Integration

1. Click **Connect** under Google Business
2. Expected: OAuth consent screen opens in new window
3. Sign in with the Google account that manages the business
4. Authorize access
5. Redirected back — Google should show as "Connected"
6. Reviews tab should show Google reviews

### Test Apple Integration

1. Click **Connect** under Apple Business
2. Fill in business name and Apple Business Connect URL
3. Click Save
4. Expected: Apple shows as "Connected" with the info you entered

### Test AI Features

1. On the Reviews tab, click **AI Response** on any review
2. Expected: AI generates a contextual reply
3. On the Visibility tab, click **Generate Tasks**
4. Expected: AI generates prioritized improvement tasks
5. On the Create Post tab, generate AI content
6. Expected: Content should reference review insights (if connected)

---

## 7. API Limits & Pricing

| Service | Free Tier | Paid Tier | Cost |
|---------|-----------|-----------|------|
| **Yelp Fusion API** | 5,000 calls/day | N/A (only free tier) | Free |
| **Google Business Profile API** | No daily limit (standard quota) | N/A | Free (but requires Blaze plan for Cloud Functions) |
| **Apple Business Connect** | N/A (no API) | N/A | Free |
| **Firebase Cloud Functions** | 125K invocations/month, 40K GB-seconds | Pay-as-you-go | ~$0.40/million invocations |
| **Google Cloud Secret Manager** | 6 active secret versions free | $0.06/10K access ops | Essentially free at our scale |

### Yelp-Specific Limits
- **3 reviews maximum** per business via API (hard limit, cannot be increased)
- **5,000 API calls/day** (resets at midnight UTC)
- **No rate limit** officially documented, but avoid burst requests
- **Display requirements:** Must show Yelp branding/attribution when displaying data

### Google-Specific Limits
- **Per-user OAuth tokens** — each restaurant owner authorizes separately
- **Refresh tokens** don't expire unless revoked by the user
- **Access tokens** expire after 1 hour (auto-refreshed by our code)

---

## 8. Troubleshooting

### "API key not configured" message in the app
- The secret hasn't been set or the function hasn't been redeployed
- Run `firebase functions:secrets:get YELP_API_KEY` to verify
- Redeploy: `firebase deploy --only functions`

### Yelp search returns no results
- Check the API key is correct (no extra spaces)
- Check Yelp's API status: https://www.yelp.com/developers
- Search query must match a real business on Yelp
- Try broader search terms (city name instead of street address)

### Google OAuth fails
- Verify redirect URI in Google Cloud Console matches exactly
- Check that Business Profile API is enabled
- Check that API access has been approved by Google
- Verify client ID and secret are correct

### "Quota exceeded" during deployment
- Wait 10-15 minutes for failed Cloud Run revisions to cool down
- Deploy fewer functions at a time
- Check Cloud Run quotas: https://console.cloud.google.com/iam-admin/quotas

### Reviews not appearing
- Yelp: Only 3 most recent reviews are available via API
- Google: Check that OAuth token is still valid (owner may have revoked access)
- Try "Sync Reviews" button to force a refresh

---

## Production Checklist

When moving from test accounts to production:

- [ ] Create new Yelp app with production business email
- [ ] Set new `YELP_API_KEY` in Firebase secrets
- [ ] Create new Google OAuth credentials with production redirect URIs
- [ ] Set new `GOOGLE_BUSINESS_CLIENT_ID` and `GOOGLE_BUSINESS_CLIENT_SECRET`
- [ ] Update OAuth consent screen with production app info and logo
- [ ] Submit Google OAuth app for verification (required for public use)
- [ ] Apply for Google Business Profile API access with production project
- [ ] Verify Yelp API Terms of Use compliance (attribution, display requirements)
- [ ] Test all flows end-to-end with a real restaurant listing
- [ ] Monitor API usage in Yelp Developer dashboard and Google Cloud Console
