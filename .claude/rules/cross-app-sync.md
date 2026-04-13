# Cross-App Sync Rule

Koda Carte is a **3-app ecosystem** sharing the same Firebase backend:

| App | Repo | Path | Role |
|-----|------|------|------|
| **Web App** (this repo) | `restaurant-wizard` | This project | Restaurant admin dashboard |
| **Customer App** | `customer-app` | `~/Documents/GitHub/customer-app` | Customer mobile app (ordering, rewards, menu) |
| **POS Payment App** | `restaurant-pos-payment-app` | `~/Documents/GitHub/restaurant-pos-payment-app` | Staff payment collection (Tap to Pay, Bluetooth reader) |

## When to Port Changes

After modifying any of these in the main app, **flag or port the change** to the companion apps:

- **Cloud Function signatures** (params or response shape changed) --> Both apps
- **Firestore document schemas** (fields added/renamed/removed) --> Both apps
- **Order status workflow** (new statuses or transitions) --> Both apps
- **Promotions/Rewards logic** --> Customer app
- **Payment flow or Stripe changes** --> POS Payment app
- **Menu data model** --> Customer app
- **Stripe Terminal functions** --> POS Payment app

## How to Port

1. After making the change in this repo, note which Cloud Functions or Firestore schemas were affected
2. Open the companion app repo and update the corresponding service file
3. If TypeScript types changed, update the `types/` directory in the companion app
4. Run the companion app's tests to verify

See `/koda-carte` skill for the full cross-app sync table with specific function mappings.
