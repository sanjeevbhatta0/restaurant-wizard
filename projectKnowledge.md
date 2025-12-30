# Restaurant Wizard - Project Knowledge Base

> Last Updated: December 30, 2025

---

## 📋 Project Overview

**Restaurant Wizard** is a SaaS platform for restaurant owners that provides an all-in-one solution to manage their online presence. It's built with React and Firebase.

### Core Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Menu Management** | Create categories and menu items with images, prices, discounts (fixed $ or %) | ✅ Implemented |
| **Order Management** | View/track customer orders with status workflow (new → preparing → ready → completed) | ✅ Implemented |
| **Website Builder** | Visual builder for creating a restaurant website with customizable theme, contact info, business hours, and social links | ✅ Implemented |
| **Website Integration** | Embeddable script to add the menu to any external website | ✅ Implemented |
| **Social Media Posting** | Post directly to Facebook Pages and Instagram Business accounts | ✅ Implemented (Twitter coming soon) |
| **Authentication** | User signup/login with Firebase Auth | ✅ Implemented |

### Tech Stack

- **Frontend:** React 17, React Bootstrap, React Router v6, React Quill (WYSIWYG editor)
- **Backend:** Firebase (Firestore, Storage, Auth, Functions, Hosting)
- **Social Integration:** Facebook SDK, Instagram Graph API
- **Build Tool:** Create React App

---

## 🗂️ Project Structure

```
restaurant-wizard/
├── build/                    # Production build output
├── functions/                # Firebase Cloud Functions
│   ├── index.js              # Main functions file (getMenu, submitOrder, serveWebsite)
│   └── package.json
├── public/                   # Static assets
│   ├── embed.js              # Embeddable menu widget script
│   ├── index.html            # Main HTML with Facebook SDK
│   └── manifest.json         # PWA manifest
├── src/
│   ├── components/           # React components
│   │   ├── Home.js           # Dashboard home
│   │   ├── Login.js          # Login page
│   │   ├── Signup.js         # Signup page
│   │   ├── MenuManagement.js # Menu CRUD operations
│   │   ├── Orders.js         # Order management
│   │   ├── WebsiteBuilder.js # Website customization
│   │   ├── WebsiteIntegration.js # Embed code generator
│   │   ├── SeoSocialPosts.js # Social media posting
│   │   └── Layout.js         # App layout with sidebar
│   ├── contexts/
│   │   └── AuthContext.js    # Firebase Auth context
│   ├── services/
│   │   ├── facebookService.js
│   │   ├── socialMediaService.js
│   │   └── websiteService.js
│   ├── firebase.js           # Firebase configuration
│   └── App.js                # Main app with routing
├── .env                      # Facebook App ID
├── .env.development          # Emulator configuration
├── firebase.json             # Firebase configuration
└── package.json
```

---

## 🚀 How to Run the Project

### Prerequisites

- Node.js (tested with v23, project specifies v18 for functions)
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project configured

### Step 1: Install Dependencies

```bash
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard

# Install with legacy peer deps due to React 17 vs testing library conflict
npm install --legacy-peer-deps

# Install functions dependencies
cd functions && npm install && cd ..
```

### Step 2: Start Firebase Emulators

The project is configured to use Firebase Emulators in development mode.

```bash
firebase emulators:start
```

This starts:
- **Auth Emulator:** http://localhost:9099
- **Firestore Emulator:** http://localhost:8080
- **Functions Emulator:** http://localhost:5001
- **Storage Emulator:** http://localhost:9199
- **Hosting Emulator:** http://localhost:5002
- **Emulator UI:** http://localhost:4000

### Step 3: Start React Development Server

In a separate terminal:

```bash
npm start
```

This starts the React app at **http://localhost:3000**

### Alternative: Run Both Together

```bash
npm run dev
```

This uses `concurrently` to run both the React app and Firebase emulators.

---

## 🔧 Environment Configuration

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

### Firebase Project

- **Project ID:** `restaurant-portal-6b147`
- **Hosting URL:** `https://restaurant-portal-6b147.web.app`

---

## 🐛 Known Issues & Solutions

### Issue 1: `npm install` Fails with Dependency Conflict

**Error:**
```
npm error ERESOLVE could not resolve
npm error peer react@"^18.0.0 || ^19.0.0" from @testing-library/react@16.2.0
```

**Cause:** The project uses React 17, but `@testing-library/react@16.2.0` requires React 18+.

**Solution:**
```bash
npm install --legacy-peer-deps
```

---

### Issue 2: `auth/network-request-failed` on Signup/Login

**Error:**
```
FirebaseError: Firebase: Error (auth/network-request-failed)
```

**Cause:** The app is configured to use Firebase Emulators (via `.env.development`), but the emulators are not running.

**Solution:**
Start the Firebase emulators before using the app:
```bash
firebase emulators:start
```

**How to Verify Emulators Are Running:**
```bash
lsof -i :9099  # Should show node process listening
```

---

### Issue 3: ESLint Warnings on Compile

**Warnings:**
```
src/components/Layout.js - 'currentUser' is assigned a value but never used
src/components/MenuManagement.js - 'navigate' is assigned a value but never used
src/components/Orders.js - React Hook useEffect has a missing dependency
src/components/SeoSocialPosts.js - React Hook useEffect has a missing dependency
```

**Impact:** Non-blocking, app still runs.

**Solution:** Can be fixed later by removing unused variables and adding missing dependencies to useEffect hooks.

---

### Issue 4: Node Version Mismatch for Functions

**Warning:**
```
Your requested "node" version "18" doesn't match your global version "23"
```

**Cause:** `functions/package.json` specifies Node 18, but the system has Node 23.

**Impact:** Functions run with Node 23, may cause compatibility issues in production.

**Solution:** Either update `functions/package.json` to Node 20/22, or use nvm to switch to Node 18 when working with functions.

---

### Issue 5: Outdated firebase-functions Package

**Warning:**
```
package.json indicates an outdated version of firebase-functions
```

**Solution:**
```bash
cd functions
npm install --save firebase-functions@latest
```

---

## 📱 Converting to iPadOS App

The project can be converted to an iPadOS app using **Capacitor**:

1. **Install Capacitor:**
   ```bash
   npm install @capacitor/core @capacitor/cli
   npx cap init "Restaurant Wizard" "com.restaurantwizard.app"
   ```

2. **Add iOS Platform:**
   ```bash
   npm install @capacitor/ios
   npx cap add ios
   ```

3. **Build and Sync:**
   ```bash
   npm run build
   npx cap sync ios
   npx cap open ios
   ```

**Note:** Facebook SDK integration may need adjustment for native app.

---

## 🔜 Suggested Next Steps

### High Priority
1. Fix ESLint warnings in components
2. Update Node version in functions to 20
3. Upgrade firebase-functions package
4. Add proper error handling in Signup (show error messages to user)

### Features to Add
1. Payment integration (Stripe/Square)
2. Email/SMS notifications for order status
3. Analytics dashboard
4. QR code menu generation
5. Complete Twitter/X integration

### Technical Improvements
1. Upgrade React 17 → React 18
2. Add comprehensive testing
3. Implement form validation
4. Add error boundaries

---

## 📞 Firebase Emulator Ports Quick Reference

| Service | Port | URL |
|---------|------|-----|
| Auth | 9099 | http://localhost:9099 |
| Firestore | 8080 | http://localhost:8080 |
| Functions | 5001 | http://localhost:5001 |
| Storage | 9199 | http://localhost:9199 |
| Hosting | 5002 | http://localhost:5002 |
| Emulator UI | 4000 | http://localhost:4000 |
| React App | 3000 | http://localhost:3000 |

---

## 🔑 Test Credentials (Emulator Only)

When using the emulator, you can create any test account. Example:
- **Email:** test@example.com
- **Password:** Test123456!

Note: Emulator data is reset when emulators are stopped unless you export/import data.

---

---

## 🚀 Deploying to Production

### Build the App

```bash
npm run build
```

### Deploy to Firebase Hosting

```bash
# Deploy only hosting (recommended)
firebase deploy --only hosting:restaurant-portal-6b147

# Or deploy everything (hosting + functions)
firebase deploy
```

**Note:** Use the specific site target (`hosting:restaurant-portal-6b147`) to avoid errors with the wildcard site configuration.

### Production URLs

| Service | URL |
|---------|-----|
| **Main App** | https://restaurant-portal-6b147.web.app |
| **Firebase Console** | https://console.firebase.google.com/project/restaurant-portal-6b147/overview |

### Production vs Local

| Aspect | Local (Emulator) | Production |
|--------|------------------|------------|
| Firebase Auth | Uses emulator (port 9099) | Uses real Firebase Auth |
| Firestore | Uses emulator (port 8080) | Uses real Firestore |
| Data Persistence | Data resets on restart | Data persists permanently |
| Signup/Login | Any test credentials | Real accounts required |

---

## 🧪 Testing Notes

### Automated Testing Limitation

Browser automation tools (like Cursor's browser, Playwright, Puppeteer) may have difficulty with React controlled inputs. The DOM is updated but React's internal state doesn't update, causing form submissions to send empty values.

**Symptoms:**
- Form appears filled when viewed
- Submission fails with validation errors
- Console shows `auth/invalid-email` even with valid-looking emails

**Workaround:** Test React forms manually in a real browser.

### Manual Testing Checklist

1. **Signup Flow:**
   - Go to https://restaurant-portal-6b147.web.app/signup
   - Fill all fields manually
   - Verify redirect to dashboard on success

2. **Login Flow:**
   - Go to https://restaurant-portal-6b147.web.app/login
   - Enter credentials created during signup
   - Verify access to dashboard

3. **Menu Management:**
   - Add a category
   - Add an item with image
   - Edit and delete items

4. **Orders:**
   - View orders page
   - Test status change dropdown

---

*Document created: December 30, 2025*
