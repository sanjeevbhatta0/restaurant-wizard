# Stripe Payment Integration Setup Guide

This guide explains how to set up Stripe payments for Restaurant Wizard.

## Prerequisites

- A Stripe account (create one at [stripe.com](https://stripe.com))
- Access to your Stripe Dashboard

## Step 1: Get Your Stripe API Keys

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com)
2. Make sure you're in **Test Mode** (toggle in the top right)
3. Go to **Developers** → **API Keys**
4. You'll see two keys:
   - **Publishable key**: Starts with `pk_test_...`
   - **Secret key**: Starts with `sk_test_...`

## Step 2: Configure Frontend (React App)

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Add your Stripe publishable key:

```env
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY_HERE
```

Alternatively, update the key directly in `src/services/stripeService.js`:

```javascript
const publishableKey = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY';
```

## Step 3: Configure Backend (Firebase Functions)

### Option A: Using Environment Variables (Recommended for Production)

Set the Stripe secret key as a Firebase Functions environment variable:

```bash
# Set the Stripe secret key
firebase functions:secrets:set STRIPE_SECRET_KEY

# When prompted, enter your Stripe secret key: sk_test_YOUR_SECRET_KEY
```

### Option B: For Local Development with Emulators

Create a `.secret.local` file in the `functions/` directory:

```bash
# functions/.secret.local
STRIPE_SECRET_KEY=sk_test_YOUR_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_PUBLISHABLE_KEY
```

Or update the key directly in `functions/index.js` (NOT recommended for production):

```javascript
const stripe = require('stripe')('sk_test_YOUR_SECRET_KEY');
```

### Option C: Using Firebase Functions Config (Legacy)

```bash
firebase functions:config:set stripe.secret_key="sk_test_YOUR_SECRET_KEY"
```

Then update `functions/index.js` to use it:

```javascript
const functions = require('firebase-functions');
const stripe = require('stripe')(functions.config().stripe.secret_key);
```

## Step 4: Deploy Functions

After setting up the environment variables:

```bash
# Deploy functions
cd functions
firebase deploy --only functions
```

## Step 5: Test the Integration

### Testing Card Payments

Use Stripe's test card numbers:

| Card Number | Description |
|-------------|-------------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Card declined |
| `4000 0000 0000 9995` | Insufficient funds |

Use any future expiry date (e.g., 12/34), any 3-digit CVC, and any ZIP code.

### Testing Refunds

1. Process a card payment
2. Go to Reimbursement
3. Select the completed order
4. Process refund (will be processed through Stripe for card payments)

## Production Checklist

Before going live:

1. [ ] Switch to **Live Mode** in Stripe Dashboard
2. [ ] Get your **live API keys** (start with `pk_live_` and `sk_live_`)
3. [ ] Update environment variables with live keys
4. [ ] Deploy updated functions
5. [ ] Test with a real card (do a small purchase and refund it)

## Security Notes

- **Never** expose your secret key (`sk_...`) in frontend code
- **Never** commit API keys to version control
- Use environment variables or Firebase secrets for production
- The publishable key (`pk_...`) is safe to use in frontend code

## Stripe Dashboard Features

With this integration, you can:

- **View all payments** in the Stripe Dashboard
- **Issue refunds** directly from Stripe (or through the app)
- **See payment analytics** and reports
- **Set up webhooks** for advanced automation
- **Manage disputes** if any arise

## Troubleshooting

### "Payment not completed" Error

- Check if the card number is correct
- Ensure you're using test cards in test mode
- Verify your API keys are correct

### "Failed to create payment intent" Error

- Check if Firebase Functions are deployed
- Verify the secret key is set correctly
- Check Firebase Functions logs: `firebase functions:log`

### Refund Not Processing

- Ensure the order was paid with a card (has `stripePaymentIntentId`)
- Check if the refund amount is valid
- Verify your Stripe account has refund permissions

## API Reference

### Cloud Functions

| Function | Purpose |
|----------|---------|
| `createPaymentIntent` | Creates a Stripe PaymentIntent for card payments |
| `confirmStripePayment` | Confirms payment and updates order status |
| `processStripeRefund` | Processes refunds through Stripe |
| `getStripeConfig` | Returns Stripe publishable key (optional) |

### Frontend Service (`stripeService.js`)

| Function | Purpose |
|----------|---------|
| `getStripe()` | Initializes and returns Stripe instance |
| `createPaymentIntent()` | Calls backend to create PaymentIntent |
| `confirmPayment()` | Confirms payment after successful card charge |
| `processRefund()` | Processes refund through backend |

---

For more information, visit the [Stripe Documentation](https://stripe.com/docs).
