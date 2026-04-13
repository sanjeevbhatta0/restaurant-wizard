# CLAUDE.md — Koda Carte

> **Codebase:** `restaurant-wizard` | **Brand:** Koda Carte ("Koda" = friend in Lakota)
> **Stack:** React 17 + Firebase (Firestore, Auth, Storage, Functions, Hosting) + Stripe + Gemini AI + DoorDash Drive

SaaS restaurant management platform — POS, menu management, website builder, payments, analytics, delivery, social media, and more.

---

## Koda Carte Ecosystem (3 Apps, 1 Backend)

All three apps share the **same Firebase backend**. Changes to Cloud Functions, Firestore schemas, or order workflows in this repo must be ported to the companion apps.

| App | Repo | Path | Role |
|-----|------|------|------|
| **Web App** (this repo) | `restaurant-wizard` | This project | Restaurant admin dashboard (POS, Kitchen, Server, Payments, Menu, Website Builder) |
| **Customer App** | `customer-app` | `~/Documents/GitHub/customer-app` | Customer mobile app — ordering, rewards, promotions, menu, reviews |
| **POS Payment App** | `restaurant-pos-payment-app` | `~/Documents/GitHub/restaurant-pos-payment-app` | Staff payment collection — Apple Tap to Pay, Stripe M2 Bluetooth reader, refunds |

See `.claude/rules/cross-app-sync.md` for what to port and when. See `/koda-carte` skill for detailed function mappings.

---

## AI Agent Structure (4-Layer Architecture)

```
restaurant-wizard/
├── CLAUDE.md                        # L1: Always loaded. Project overview + critical rules
├── .claude/
│   ├── settings.json                # Permissions, tool access, hooks config
│   ├── settings.local.json          # Local overrides (not committed)
│   ├── rules/                       # L1: Modular rules, auto-loaded by topic
│   │   ├── build-deploy.md          #   Build/deploy safety rules
│   │   ├── cross-app-sync.md        #   Cross-app porting requirements (3-app ecosystem)
│   │   ├── portal-parity.md         #   Website Builder <-> Widget embed parity
│   │   ├── testing.md               #   Testing requirements
│   │   └── ux.md                    #   UX conventions
│   ├── skills/                      # L2: On-demand knowledge packs
│   │   ├── koda-carte/SKILL.md      #   Complete project reference (architecture, data model, all flows)
│   │   ├── deploy/SKILL.md          #   Firebase deployment commands + validation
│   │   ├── test-runner/SKILL.md     #   Smart test selection + execution
│   │   └── portal-parity/SKILL.md   #   Portal parity verification checklist
│   └── hooks/                       # L3: Safety gates + automation
│       ├── portal-parity-check.sh   #   Auto-checks portal file edits
│       └── deploy-env-check.sh      #   Validates env before deploy commands
```

**How to use:** CLAUDE.md + rules/ are always in context. Skills load on demand via `/skill-name` or auto-trigger. Hooks run automatically on tool events.

---

## Environments

| | DEV | PRODUCTION |
|---|---|---|
| **App URL** | https://restaurant-portal-6b147.web.app | https://kodacarte-861d8.web.app |
| **Firebase Project** | `restaurant-portal-6b147` | `kodacarte-861d8` |
| **Firebase Account** | `sanjivbhatta100@gmail.com` | `sanjeev@kodacarte.com` |
| **Alias** | `dev` (default) | `prod` |
| **Build** | `npm run build:only` | `npm run build:prod:only` |

**Admin (DEV):** `sanjeev@admin.com` / `sanjeev` at `/admin/login`
**Admin (PROD):** Sign up first, then add UID to `admins` collection in prod Firestore

---

## Quick Start

```bash
# Install (first time)
npm install --legacy-peer-deps && cd functions && npm install && cd ..

# Terminal 1 — Emulators
firebase emulators:start

# Terminal 2 — Dev server
npm start

# Admin setup in emulator
node scripts/setup-admin.js
```

Emulators: UI=4000, Auth=9099, Firestore=8080, Functions=5001, Hosting=5002, Storage=9199

---

## Skills Directory

| Skill | Invoke | What it provides |
|-------|--------|------------------|
| **koda-carte** | `/koda-carte` | Complete project reference — all components, Cloud Functions, data model, services, contexts, multi-location, security rules, env vars, known issues |
| **deploy** | `/deploy [dev\|prod\|both\|functions]` | Firebase deployment with environment validation |
| **test-runner** | `/test-runner [target]` | Smart test execution based on changed files |
| **portal-parity** | `/portal-parity` | Website Builder / Widget embed parity verification |
| **mobile-app-build** | (auto) | White-label iOS build pipeline — GitHub Actions, EAS Build, credential chain, ASC limitations, debugging |
