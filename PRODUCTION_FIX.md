# Production Order Flow Fix

## Issue
Orders sent from POS to Kitchen were not appearing in production, even though they worked in local development.

## Root Causes Identified

1. **Inconsistent locationId filtering**: 
   - POS was setting `locationId` to `selectedLocation || currentUser.uid`
   - Kitchen was NOT filtering by `locationId` for single-location restaurants
   - This mismatch caused orders to not appear in Kitchen queries

2. **Missing Firestore Index**:
   - Queries using `where('status', 'in', [...])` with `orderBy('createdAt')` require composite indexes
   - Missing indexes cause queries to fail silently or return no results

3. **Poor error handling**:
   - Index errors weren't being caught or reported clearly
   - Made debugging production issues difficult

## Fixes Applied

### 1. Kitchen Component (`src/components/Kitchen.js`)
- ✅ Now consistently filters by `locationId` for BOTH single and multi-location restaurants
- ✅ Single-location: filters by `currentUser.uid` (matches what POS sets)
- ✅ Multi-location: filters by `selectedLocation`
- ✅ Added fallback query without `orderBy` if index is missing
- ✅ Added manual sorting when `orderBy` isn't available
- ✅ Improved error handling with detailed logging for index errors

### 2. POS Component (`src/components/POS.js`)
- ✅ Ensures `locationId` is set consistently:
  - Multi-location: uses `selectedLocation`
  - Single-location: uses `currentUser.uid`
- ✅ Always sets `locationId` field (no more conditional logic)

### 3. Server Component (`src/components/Server.js`)
- ✅ Applied same fixes as Kitchen for consistency
- ✅ Now filters by `locationId` for single-location restaurants
- ✅ Added fallback query and error handling

### 4. Firestore Indexes (`firestore.indexes.json`)
- ✅ Created index definition file for required composite index
- ✅ Updated `firebase.json` to reference the indexes file

## Deployment Steps

### Step 1: Deploy Firestore Indexes
```bash
firebase deploy --only firestore:indexes
```

This will create the required composite index for the orders query. The index may take a few minutes to build.

### Step 2: Deploy Code Changes
```bash
npm run build
firebase deploy --only hosting
```

### Step 3: Verify Index Creation
1. Go to Firebase Console → Firestore → Indexes
2. Verify that the composite index for `orders` collection exists with fields:
   - `locationId` (Ascending)
   - `status` (Ascending)
   - `createdAt` (Ascending)

### Step 4: Test the Flow
1. Open POS in production
2. Create an order and send it to kitchen
3. Open Kitchen view - order should appear immediately
4. Check browser console for any errors

## Testing Checklist

- [ ] POS: Create order with single location → Verify `locationId` is set to `currentUser.uid`
- [ ] POS: Create order with multi-location → Verify `locationId` is set to `selectedLocation`
- [ ] Kitchen: View orders for single location → Orders appear correctly
- [ ] Kitchen: View orders for multi-location → Only orders for selected location appear
- [ ] Server: View orders → Orders appear correctly
- [ ] Kitchen: Change order status from "sent_to_kitchen" to "preparing" → Status updates
- [ ] Kitchen: Change order status from "preparing" to "ready" → Status updates
- [ ] Server: View ready orders → Ready orders appear

## Troubleshooting

### If orders still don't appear:

1. **Check browser console** for error messages
2. **Check Firebase Console → Firestore → Indexes** - ensure index is built (status: "Enabled")
3. **Check order documents** in Firestore:
   - Verify `locationId` field exists and matches expected value
   - Verify `status` field is set to `sent_to_kitchen` or `preparing`
   - Verify `createdAt` field exists
4. **Check Firestore Rules** - ensure user has read access to orders collection

### Common Issues:

- **Index not built yet**: Wait a few minutes after deploying indexes
- **locationId mismatch**: Check that POS and Kitchen are using the same locationId value
- **Permissions**: Verify Firestore rules allow reading orders

## Notes

- The fallback query (without `orderBy`) will work even if the index isn't built yet, but results won't be sorted
- Manual sorting is applied client-side as a fallback
- All queries now consistently filter by `locationId` to ensure data isolation between locations
