# Customer App Porting Guide

> **Last Updated:** April 5, 2026
>
> This document describes all features, data models, and API contracts from the web platform
> that the native customer app must implement to achieve feature parity.

---

## 1. Order Types

The platform supports 3 order types:

| Order Type | Value | Description |
|-----------|-------|-------------|
| Pickup | `pickup` | Customer picks up at restaurant |
| Dine-in | `dine-in` | Customer is dining in, assigned to a table |
| Delivery | `delivery` | DoorDash Drive delivers to customer address |

Delivery is only available when the restaurant has `deliverySettings.enabled === true`.

---

## 2. Delivery Feature — Full Specification

### 2.1 Feature Gating

- Delivery is available on **Chief** and **Elder** subscription tiers only.
- Check `restaurant.deliverySettings.enabled` before showing delivery option.
- If tier doesn't support delivery, the option should be hidden (not shown as disabled).

### 2.2 Checkout Flow — Delivery

When user selects "Delivery" order type:

1. **Hide** pickup time selector
2. **Show** delivery fields:
   - Delivery address input (with Google Places Autocomplete)
   - Delivery quote display area
   - Delivery instructions textarea
   - Contactless delivery checkbox (default from `deliverySettings.contactlessDefault`)
   - Driver tip selector (preset: $3, $5, $8, No Tip — default $5)
3. **Auto-fetch delivery quote** when address is selected/entered (see API below)
4. **Update order summary** to show: Subtotal + Tax + Delivery Fee + Driver Tip = Total
5. **Payment**: For delivery orders, "Pay Now" (Stripe) is strongly recommended. "Pay at Restaurant" should be hidden or labeled "Pay at Delivery" (cash on delivery).

### 2.3 Delivery Address — Google Places Autocomplete

- Uses Google Places API (`google.maps.places.Autocomplete`)
- Configuration:
  ```javascript
  {
    types: ['address'],
    componentRestrictions: { country: 'us' },
    fields: ['formatted_address', 'geometry']
  }
  ```
- On place selection: populate the address field with `place.formatted_address` and auto-trigger delivery quote fetch
- Fallback: if Google Maps API key not available, user types address manually and quote is fetched after 800ms debounce on input

### 2.4 API: Get Delivery Quote

**Endpoint:** `POST {apiBaseUrl}/getDeliveryQuote`

**Request:**
```json
{
  "restaurantId": "string",
  "locationId": "string (optional, defaults to restaurantId)",
  "dropoffAddress": "string (full address)",
  "dropoffPhone": "string (E.164 format preferred: +1XXXXXXXXXX)",
  "dropoffName": "string (customer name)",
  "orderValueCents": 1500
}
```

**Success Response:**
```json
{
  "success": true,
  "fee": 975,
  "feeFormatted": "$9.75",
  "estimatedPickupTime": "2026-04-05T18:30:00Z",
  "estimatedDropoffTime": "2026-04-05T19:00:00Z",
  "quoteId": "kc-restaurantId-1712345678"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Delivery not available to this address"
}
```

**Notes:**
- Phone numbers are auto-formatted to E.164 on the server, but sending `+1XXXXXXXXXX` is preferred
- Quote is valid for ~5 minutes
- The `quoteId` is the DoorDash `external_delivery_id` — pass it back when submitting the order

### 2.5 API: Submit Order (Delivery)

**Endpoint:** `POST {apiBaseUrl}/submitOrder`

Standard order submission with additional delivery fields:

```json
{
  "restaurantId": "string",
  "locationId": "string",
  "customerName": "string",
  "customerEmail": "string",
  "customerPhone": "string",
  "orderType": "delivery",
  "items": [...],
  "subtotal": 25.00,
  "tax": 2.13,
  "total": 39.88,
  "deliveryAddress": {
    "fullAddress": "123 Main St, San Francisco, CA 94105"
  },
  "deliveryInstructions": "Apartment 4B, leave at door",
  "contactlessDelivery": true,
  "deliveryFee": 9.75,
  "driverTip": 5.00,
  "doordashQuoteId": "kc-restaurantId-1712345678",
  "paymentMethod": "payNow",
  "paymentMethodId": "pm_xxx (from Stripe)",
  "promoCode": "SAVE10"
}
```

**Total calculation:** `total = subtotal + tax + deliveryFee + driverTip - discount`

**Success Response includes:**
```json
{
  "success": true,
  "orderId": "abc123",
  "trackingUrl": "https://track.doordash.com/..."
}
```

### 2.6 Order Confirmation — Delivery

After a delivery order is placed, show:
- Order ID
- "Your delivery is on its way!" message
- Delivery address
- Estimated delivery time (from quote)
- **"Track Delivery" button** — opens `trackingUrl` in external browser (DoorDash tracking page)
- Order summary with delivery fee and tip

### 2.7 Active Order Tracking — Delivery Status

Delivery orders have a `doordash.deliveryStatus` field that updates in real-time via webhooks:

| Status | Display Text | Icon |
|--------|-------------|------|
| `quoted` | Quote Received | truck |
| `awaiting_driver` | Finding Driver | search |
| `driver_assigned` | Driver Assigned | person-check |
| `driver_enroute_pickup` | Driver Heading to Restaurant | arrow-right |
| `driver_at_pickup` | Driver at Restaurant | geo-alt |
| `picked_up` | Order Picked Up | bag-check |
| `driver_enroute_dropoff` | Driver On The Way | truck |
| `driver_at_dropoff` | Driver Arriving | geo-alt-fill |
| `delivered` | Delivered | check-circle |
| `cancelled` | Delivery Cancelled | x-circle |

**Progress stepper:** Show a visual stepper:
```
Placed -> Preparing -> Driver Assigned -> Picked Up -> On The Way -> Delivered
```

**Driver info** (available after `driver_assigned`):
- `doordash.dasherName` — Driver name
- `doordash.dasherPhone` — Driver phone (for calling)
- `doordash.dasherVehicle` — `{ make, model }` (e.g., "Toyota Camry")
- `doordash.dasherLocation` — `{ lat, lng }` (for map display)
- `doordash.trackingUrl` — DoorDash tracking page URL

**Order status mapping:**
- `order.status = 'out_for_delivery'` when `doordash.deliveryStatus = 'picked_up'`
- `order.status = 'completed'` when `doordash.deliveryStatus = 'delivered'`
- `order.status = 'delivery_failed'` when `doordash.deliveryStatus = 'cancelled'`

### 2.8 Delivery Fee Display

- `deliveryFee` on the order is in **dollars** (e.g., `9.75`)
- `doordash.fee` is in **cents** (e.g., `975`) — this is the raw DoorDash value
- Display the dollar value to customers

---

## 3. Order Data Model (Firestore)

### 3.1 Base Order Fields

Path: `restaurants/{restaurantId}/orders/{orderId}`

```javascript
{
  // Identity
  orderId: "auto-generated",
  restaurantId: "string",
  locationId: "string (optional, for multi-location)",

  // Customer
  customerName: "string",
  customerEmail: "string",
  customerPhone: "string",
  customerId: "string (Firebase Auth UID, if logged in)",

  // Order details
  orderType: "pickup" | "dine-in" | "delivery",
  items: [
    {
      id: "string",
      name: "string",
      price: 12.99,
      quantity: 2,
      discount: { type: "percentage" | "fixed", value: 10 },
      specialInstructions: "no onions",
      categoryName: "Appetizers"
    }
  ],
  specialInstructions: "string (order-level notes)",

  // Pricing
  subtotal: 25.98,
  discountedSubtotal: 23.38,
  tax: 1.99,
  total: 25.37,
  deliveryFee: 9.75,          // only for delivery orders
  driverTip: 5.00,            // only for delivery orders

  // Status
  status: "new" | "sent_to_kitchen" | "preparing" | "ready" |
          "out_for_delivery" | "completed" | "delivery_failed" | "reimbursed",
  createdAt: Timestamp,
  readyAt: Timestamp,
  servedAt: Timestamp,
  completedAt: Timestamp,

  // Source
  source: "website" | "widget" | "pos",
  paymentMethod: "payNow" | "payLater" | "cash" | "card",
  paymentMethodId: "pm_xxx (Stripe)",
  stripePaymentIntentId: "pi_xxx",
  paymentStatus: "pending" | "paid" | "refunded",

  // Promotions
  promoCode: "SAVE10",
  promoDiscount: { type: "percentage", value: 10, title: "10% Off" },

  // Table (dine-in only)
  tableNumber: "5",
  tableLabel: "Table 5",

  // Pickup
  pickupTime: "6:30 PM",

  // Delivery (only when orderType === 'delivery')
  deliveryAddress: {
    fullAddress: "123 Main St, San Francisco, CA 94105"
  },
  deliveryInstructions: "Apartment 4B, leave at door",
  contactlessDelivery: true,
  doordash: {
    externalDeliveryId: "kc-{restaurantId}-{timestamp}",
    deliveryStatus: "driver_assigned",
    trackingUrl: "https://track.doordash.com/...",
    fee: 975,                      // cents
    tip: 500,                      // cents
    dasherName: "John D.",
    dasherPhone: "+15551234567",
    dasherVehicle: { make: "Toyota", model: "Camry" },
    dasherLocation: { lat: 37.77, lng: -122.41 },
    estimatedPickupTime: Timestamp,
    estimatedDropoffTime: Timestamp,
    actualPickupTime: Timestamp,
    actualDeliveryTime: Timestamp,
    supportReference: "DD-12345678",
    proofOfDeliveryUrl: "https://...",
    cancelReason: null
  }
}
```

### 3.2 Restaurant Settings (Delivery)

Path: `restaurants/{restaurantId}`

```javascript
{
  deliverySettings: {
    enabled: false,
    doordashBusinessId: null,
    doordashStoreId: null,
    pickupInstructions: "Ask for online orders at the counter",
    defaultPrepTime: 20,             // minutes
    contactlessDefault: true,
    tipSuggestions: [15, 20, 25]     // percentage (not currently used in checkout, preset $ amounts used instead)
  }
}
```

---

## 4. Customer Authentication (Portal)

### 4.1 Auth Flow

The customer portal uses **Firebase Auth** (email/password) scoped per restaurant.

- Customer data stored at: `restaurants/{restaurantId}/customers/{customerId}`
- `customerId` = Firebase Auth UID
- Customers are per-restaurant (a customer at Restaurant A is different from Restaurant B)

### 4.2 Customer Document

Path: `restaurants/{restaurantId}/customers/{customerId}`

```javascript
{
  email: "customer@example.com",
  name: "John Doe",
  phone: "+15551234567",
  address: "123 Main St, SF, CA 94105",
  createdAt: Timestamp,
  lastLogin: Timestamp,
  totalOrders: 5,
  totalSpent: 125.50,
  loyaltyPoints: 250,
  rewardHistory: [
    { reward: "Free appetizer", redeemedAt: Timestamp, pointsUsed: 100 }
  ]
}
```

### 4.3 Auth Endpoints

- **Signup**: Firebase Auth `createUserWithEmailAndPassword()`, then create customer doc
- **Login**: Firebase Auth `signInWithEmailAndPassword()`
- **Logout**: Firebase Auth `signOut()`
- **Phone verification**: Optional, via Twilio SMS (can be skipped with `skipPhoneVerification` config flag)

---

## 5. Promotions & Rewards

### 5.1 Promotions

Path: `restaurants/{restaurantId}/promotions/{promoId}` (but loaded via order/website config)

Promo types:
- **Percentage discount**: `{ type: 'percentage', value: 10 }` = 10% off
- **Fixed amount discount**: `{ type: 'fixed', value: 5 }` = $5 off
- **Free item**: `{ type: 'freeItem', itemId: 'xxx' }`

Promo code applied at checkout: validates via client-side check against loaded promotions.

### 5.2 Rewards / Loyalty

- Points earned per order (configurable per restaurant)
- Spin wheel for rewards (gamification)
- Reward tiers with point thresholds
- Redeem points for rewards (discounts, free items)

### 5.3 Rewards Config

Path: `restaurants/{restaurantId}/rewardsConfig`

```javascript
{
  enabled: true,
  pointsPerDollar: 10,
  spinEnabled: true,
  spinFrequency: "once_per_day",
  prizes: [
    { name: "10% Off", type: "percentage", value: 10, weight: 30 },
    { name: "Free Dessert", type: "freeItem", itemId: "xxx", weight: 10 },
    { name: "50 Points", type: "points", value: 50, weight: 40 },
    { name: "Try Again", type: "none", value: 0, weight: 20 }
  ]
}
```

---

## 6. Menu Data

### 6.1 Categories

Path: `restaurants/{restaurantId}/menuCategories/{categoryId}`

```javascript
{
  name: "Appetizers",
  displayOrder: 1,
  locations: ["loc-a", "loc-b"],  // empty = all locations
  createdAt: Timestamp
}
```

### 6.2 Items

Path: `restaurants/{restaurantId}/menuCategories/{categoryId}/items/{itemId}`

```javascript
{
  name: "Spring Rolls",
  description: "Crispy vegetable spring rolls with sweet chili sauce",
  price: 8.99,
  imageUrl: "https://firebasestorage.googleapis.com/...",
  discount: { type: "percentage", value: 10 },  // optional
  available: true,
  locations: ["loc-a"],  // empty = all locations
  displayOrder: 1,
  createdAt: Timestamp
}
```

### 6.3 Menu API

**Endpoint:** `GET {apiBaseUrl}/getMenu?restaurantId={id}&locationId={id}`

Returns all categories with their items, filtered by location if specified.

---

## 7. Multi-Location Support

- Restaurant may have multiple locations
- `locationId` field scopes orders and menus
- Menu items have a `locations` array — empty means available at all locations
- When ordering, pass `locationId` in the order submission
- Location data: `restaurants/{restaurantId}/locations/{locationId}`

---

## 8. Payment Integration

### 8.1 Stripe

- Card payments via Stripe
- `stripePublishableKey` provided in restaurant config
- `stripeConnectedAccountId` for Stripe Connect (restaurant's own Stripe account)
- Flow: Create PaymentMethod client-side -> pass `paymentMethodId` to `submitOrder`

### 8.2 Payment Options

| Method | Value | Description |
|--------|-------|-------------|
| Pay at Restaurant | `payLater` | Cash or card at pickup |
| Pay Now | `payNow` | Stripe card payment at checkout |

For **delivery orders**: Pay Now is strongly recommended (delivery requires prepayment for DoorDash).

---

## 9. Real-time Updates

- Use Firestore `onSnapshot` listeners on the customer's orders to get real-time status updates
- Query: `restaurants/{restaurantId}/orders` where `customerId == currentUser.uid` and `status in ['new', 'sent_to_kitchen', 'preparing', 'ready', 'out_for_delivery']`
- For delivery orders, listen for changes to `doordash.deliveryStatus` and `doordash.dasherLocation`

---

## 10. API Base URLs

| Environment | API Base URL |
|-------------|-------------|
| **Dev** | `https://us-central1-restaurant-portal-6b147.cloudfunctions.net` |
| **Production** | `https://us-central1-kodacarte-861d8.cloudfunctions.net` |

---

## 11. Configuration Object

The web platform passes a configuration object to the customer-facing code. The native app should load equivalent data:

```javascript
{
  restaurantId: "string",
  locationId: "string",
  restaurantName: "string",
  apiBaseUrl: "string",
  stripePublishableKey: "string",
  stripeConnectedAccountId: "string",
  taxRate: 0.085,                    // decimal (8.5%)
  deliveryEnabled: true,
  deliveryTipSuggestions: [15, 20, 25],
  deliveryContactlessDefault: true,
  googleMapsApiKey: "string"
}
```

Source this from:
- `restaurants/{restaurantId}` document (for delivery settings, name, etc.)
- `restaurants/{restaurantId}/website/settings` or equivalent config doc
- App-level config for API URLs and API keys

---

## 12. Order Status Display

### For Customers

| Status | Display | Can Cancel? |
|--------|---------|------------|
| `new` | Order Placed | Yes |
| `sent_to_kitchen` | Sent to Kitchen | No |
| `preparing` | Being Prepared | No |
| `ready` | Ready for Pickup | No |
| `out_for_delivery` | Out for Delivery | No |
| `completed` | Completed | No |
| `delivery_failed` | Delivery Failed | No |

### Active vs Past Orders

- **Active**: status in `['new', 'sent_to_kitchen', 'preparing', 'ready', 'out_for_delivery']`
- **Past**: status in `['completed', 'delivery_failed', 'reimbursed']`

---

## 13. Reorder Flow

When customer taps "Reorder" on a past order:
1. For each item in the order, add to cart with same quantity
2. Navigate to menu/cart view
3. Customer can modify before placing

---

## 14. Reviews

Path: `restaurants/{restaurantId}/reviews/{reviewId}`

```javascript
{
  customerId: "string",
  customerName: "string",
  orderId: "string",
  rating: 4,           // 1-5 stars
  comment: "Great food!",
  createdAt: Timestamp
}
```

Customers can leave a review after order is completed.

---

## 15. Push Notifications (App-Specific)

The web platform uses browser notifications. The native app should implement push notifications for:

- Order status changes (preparing, ready, out_for_delivery, delivered)
- Driver assigned (with driver name)
- Delivery ETA updates
- Promotional notifications (new promos available)
- Reward earned notifications

---

## 16. Recent Changes Log

### April 2026 — Delivery Integration
- Added DoorDash Drive delivery support (Chief/Elder tiers)
- Added Google Places Autocomplete for delivery address
- Phone numbers formatted to E.164 (`+1XXXXXXXXXX`)
- Delivery quote fetched before order submission
- Real-time delivery tracking via DoorDash webhooks
- Driver info displayed (name, phone, vehicle, location)
- Tracking URL opens DoorDash tracking page
- Tip selector: $3, $5 (default), $8, No Tip

### Key Implementation Notes
- DoorDash external delivery ID format: `kc-{restaurantId}-{timestamp}`
- Webhook URL: `{apiBaseUrl}/doordashWebhook`
- All delivery status updates come via server-side webhooks, not client polling
- The `doordash.trackingUrl` is the primary tracking mechanism (opens DoorDash's tracking page)
- `doordash.dasherLocation` updates as driver moves (if the app wants to show a map)
