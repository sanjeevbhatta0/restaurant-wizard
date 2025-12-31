# How to Run Restaurant Wizard Locally

> Quick reference guide for running the project in development mode.

---

## 🚀 Quick Start (TL;DR)

```bash
# Terminal 1 - Start Firebase Emulators
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
firebase emulators:start

# Terminal 2 - Start React App
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
npm start
```

**Open:** http://localhost:3000

---

## 📋 Prerequisites

- **Node.js** (v18+ recommended, tested with v23)
- **Firebase CLI** - Install with: `npm install -g firebase-tools`
- **Firebase Login** - Run: `firebase login`

---

## 🛠️ Step-by-Step Setup

### Step 1: Install Dependencies

**First time only** (or after pulling new changes):

```bash
# Navigate to project root
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard

# Install main project dependencies
npm install --legacy-peer-deps

# Install functions dependencies
cd functions && npm install && cd ..
```

> **Note:** Use `--legacy-peer-deps` to avoid React version conflicts.

---

### Step 2: Start Firebase Emulators

Open a terminal and run:

```bash
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
firebase emulators:start
```

**Wait for:** "All emulators ready!"

**Emulator URLs:**
| Service | URL |
|---------|-----|
| Emulator UI | http://localhost:4000 |
| Auth | http://localhost:9099 |
| Firestore | http://localhost:8080 |
| Functions | http://localhost:5001 |
| Storage | http://localhost:9199 |

---

### Step 3: Start React Development Server

Open a **new terminal** and run:

```bash
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
npm start
```

**Wait for:** "Compiled successfully!"

**App URL:** http://localhost:3000

---

## 🔄 Alternative: Run Both Together

Use the convenience script:

```bash
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
npm run dev
```

This uses `concurrently` to run both the React app and Firebase emulators in one terminal.

---

## 🛑 Stopping the Servers

- **React Server:** Press `Ctrl + C` in the terminal running `npm start`
- **Firebase Emulators:** Press `Ctrl + C` in the terminal running `firebase emulators:start`

Or kill all processes:

```bash
pkill -f "firebase emulators"
pkill -f "react-scripts"
```

---

## ⚠️ Common Issues & Fixes

### Issue: `npm install` fails with dependency conflict

```bash
# Use legacy peer deps flag
npm install --legacy-peer-deps
```

### Issue: Firebase functions fail to load

```bash
# Reinstall functions dependencies
cd functions && npm install && cd ..
```

### Issue: `auth/network-request-failed` error

**Cause:** Firebase emulators are not running.

**Fix:** Start emulators first, then the React app.

### Issue: Port already in use

```bash
# Kill existing processes
pkill -f "firebase emulators"
pkill -f "react-scripts"

# Or find and kill specific port
lsof -i :3000  # Find process on port 3000
kill -9 <PID>  # Kill by PID
```

---

## 📁 Project URLs Summary

| What | URL | Notes |
|------|-----|-------|
| React App | http://localhost:3000 | Main development UI |
| Firebase Emulator UI | http://localhost:4000 | Manage emulator data |
| Auth Emulator | http://localhost:9099 | Authentication testing |
| Firestore Emulator | http://localhost:8080 | Database browser |

---

## 🧪 Testing a New Account

When using emulators, you can create test accounts freely:

1. Go to http://localhost:3000/signup
2. Fill in any test credentials:
   - Email: `test@example.com`
   - Password: `Test123456!`
3. Data is stored in the emulator (resets when stopped)

---

## 📦 Building for Production

```bash
# Build the React app
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting:restaurant-portal-6b147
```

---

## 📂 Current Branch

To check which branch you're on:

```bash
git branch --show-current
```

Current POS branch: `cursor/pos-interface-feature-enhancement-47eb`

---

## 🚀 Deploying to Production

### Step 1: Build the App

```bash
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard
npm run build
```

This creates an optimized production build in the `build/` folder.

### Step 2: Deploy to Firebase Hosting

```bash
firebase deploy --only hosting:restaurant-portal-6b147
```

### All-in-One Command

```bash
cd /Users/sanjeevbhatta/Documents/GitHub/restaurant-wizard && npm run build && firebase deploy --only hosting:restaurant-portal-6b147
```

### Production URL

After deployment, the app is live at:
**https://restaurant-portal-6b147.web.app**

### Verify Deployment

```bash
# Check hosting status
firebase hosting:sites:list
```

---

*Last Updated: December 30, 2025*
