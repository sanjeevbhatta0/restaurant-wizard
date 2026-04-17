const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');
const cors = require('cors')({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    // Allow all HTTPS origins (restaurant custom domains can be anything)
    if (origin.startsWith('https://')) return callback(null, true);
    // Allow localhost for development
    if (origin.startsWith('http://localhost')) return callback(null, true);
    // Block plain HTTP from non-localhost origins
    callback(new Error('CORS: HTTPS required'));
  }
});
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');

admin.initializeApp();

// ============================================
// IN-MEMORY CACHE (survives across warm Cloud Function invocations)
// ============================================
const _cache = {};
function cacheGet(key, maxAgeMs) {
  const entry = _cache[key];
  if (entry && Date.now() - entry.ts < maxAgeMs) return entry.data;
  return null;
}
function cacheSet(key, data) {
  _cache[key] = { data, ts: Date.now() };
  // Evict old entries if cache grows too large (>200 keys)
  const keys = Object.keys(_cache);
  if (keys.length > 200) {
    const oldest = keys.sort((a, b) => _cache[a].ts - _cache[b].ts).slice(0, 50);
    oldest.forEach(k => delete _cache[k]);
  }
}

// ============================================
// INPUT SANITIZATION HELPERS
// ============================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function sanitizeColor(color) {
  if (!color) return '';
  // Allow hex (#fff, #ffffff), rgb(), rgba(), hsl(), hsla(), and named CSS colors
  const cleaned = String(color).trim();
  if (/^#([0-9a-fA-F]{3,8})$/.test(cleaned)) return cleaned;
  if (/^(rgb|rgba|hsl|hsla)\([0-9,.\s%]+\)$/.test(cleaned)) return cleaned;
  if (/^[a-zA-Z]{3,20}$/.test(cleaned)) return cleaned; // named colors
  return ''; // reject anything else
}
function sanitizeFontFamily(font) {
  if (!font) return '';
  // Only allow alphanumeric, spaces, and hyphens (valid Google Font names)
  const cleaned = String(font).trim();
  if (/^[a-zA-Z0-9\s\-]+$/.test(cleaned)) return cleaned;
  return 'Poppins'; // safe fallback
}
function sanitizeUrl(url) {
  if (!url) return '';
  const cleaned = String(url).trim();
  // Only allow https:// URLs (or data: for inline images)
  if (cleaned.startsWith('https://') || cleaned.startsWith('data:image/')) return cleaned;
  return ''; // reject javascript:, http://, etc.
}

// ============================================
// SAFE ERROR HELPER — prevents leaking internals to clients
// ============================================
function safeError(error, fallbackMsg = 'An unexpected error occurred') {
  console.error('Function error:', error);
  // In production, don't leak raw error messages (may contain paths, SQL, internal state)
  const isProd = (process.env.GCLOUD_PROJECT || '').includes('kodacarte');
  if (isProd) {
    // Only expose known-safe error types
    if (error.code && ['not-found', 'permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'already-exists'].includes(error.code)) {
      return error.message;
    }
    return fallbackMsg;
  }
  return error.message || fallbackMsg;
}

// ============================================
// RATE LIMITER (in-memory, per Cloud Function instance)
// ============================================
const _rateLimits = {};
function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  if (!_rateLimits[key] || now - _rateLimits[key].windowStart > windowMs) {
    _rateLimits[key] = { count: 1, windowStart: now };
    return true;
  }
  _rateLimits[key].count++;
  if (_rateLimits[key].count > maxRequests) return false;
  return true;
}
function getClientIp(req) {
  return req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}
// Periodic cleanup of stale rate limit entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(_rateLimits)) {
    if (now - _rateLimits[key].windowStart > 300000) delete _rateLimits[key];
  }
}, 300000);

// ============================================
// ENVIRONMENT-AWARE CONFIGURATION
// ============================================
const PROJECT_ID = process.env.GCLOUD_PROJECT
  || (process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG).projectId : null)
  || 'restaurant-portal-6b147';

const getApiBaseUrl = () => `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
const getAppBaseUrl = () => `https://${PROJECT_ID}.web.app`;

// Client-side Firebase API keys (public by design — embedded in every page served to browsers).
// Derived from PROJECT_ID so the correct key is used in dev vs production.
const FIREBASE_CLIENT_API_KEYS = {
  'restaurant-portal-6b147': 'AIzaSyACOWtwR1QMedvnzMxzlh4JZU2buNl-vO0',
  'kodacarte-861d8': 'AIzaSyCl8JplSR6gFxOYz57skUrWUgNVN-gt3X8'
};
const getClientApiKey = () => FIREBASE_CLIENT_API_KEYS[PROJECT_ID] || '';

// ============================================
// PROMOTIONS HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique per-customer promo code (e.g., KC-A3X9B2)
 */
function generateUniquePromoCode() {
  const crypto = require('crypto');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'KC-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

/**
 * Parse a promotion's discount string + type into numeric values
 * @param {Object} promo - promotion with .discount (string) and .type fields
 * @returns {{ discountValue: number, discountUnit: 'percentage'|'amount' }}
 */
function parsePromoDiscount(promo) {
  if (!promo || !promo.discount) return { discountValue: 0, discountUnit: 'percentage' };

  const discountStr = String(promo.discount);

  if (promo.type === 'percentage' || promo.type === 'flashSale' || promo.type === 'storeLaunch') {
    if (discountStr.includes('%')) {
      return { discountValue: parseFloat(discountStr.replace('%', '')) || 0, discountUnit: 'percentage' };
    }
    if (discountStr.startsWith('$')) {
      return { discountValue: parseFloat(discountStr.replace('$', '')) || 0, discountUnit: 'amount' };
    }
    // Try parsing as number (assume percentage for these types)
    const val = parseFloat(discountStr);
    if (!isNaN(val)) return { discountValue: val, discountUnit: 'percentage' };
  }

  if (promo.type === 'bogo') {
    return { discountValue: 0, discountUnit: 'percentage' }; // BOGO handled specially
  }

  if (promo.type === 'freeItem') {
    return { discountValue: 0, discountUnit: 'amount' }; // Free item handled specially
  }

  // Fallback: try to detect from string
  if (discountStr.includes('%')) {
    return { discountValue: parseFloat(discountStr.replace('%', '')) || 0, discountUnit: 'percentage' };
  }
  if (discountStr.startsWith('$')) {
    return { discountValue: parseFloat(discountStr.replace('$', '')) || 0, discountUnit: 'amount' };
  }

  return { discountValue: 0, discountUnit: 'percentage' };
}

/**
 * Validate a promo code against promotionClaims and promotions collections.
 * Shared logic used by both validatePromoCode and submitOrder.
 * @returns {{ valid: boolean, reason?: string, ...promoDetails }}
 */
async function validatePromoInternal(db, restaurantId, promoCode, subtotal) {
  if (!promoCode || !restaurantId) {
    return { valid: false, reason: 'Missing promo code or restaurant ID' };
  }

  // 1. Search promotionClaims by uniqueCode first
  let claimSnapshot = await db
    .collection(`restaurants/${restaurantId}/promotionClaims`)
    .where('uniqueCode', '==', promoCode)
    .where('used', '==', false)
    .limit(1)
    .get();

  // 2. If not found, search by shared promoCode
  if (claimSnapshot.empty) {
    claimSnapshot = await db
      .collection(`restaurants/${restaurantId}/promotionClaims`)
      .where('promoCode', '==', promoCode)
      .where('used', '==', false)
      .limit(1)
      .get();
  }

  if (claimSnapshot.empty) {
    return { valid: false, reason: 'Invalid or already used promo code' };
  }

  const claimDoc = claimSnapshot.docs[0];
  const claim = claimDoc.data();

  // Check expiry
  const now = new Date();
  const validUntil = claim.validUntil?.toDate ? claim.validUntil.toDate() : new Date(claim.validUntil);
  if (validUntil < now) {
    return { valid: false, reason: 'This promotion has expired' };
  }

  // Check min order amount
  if (claim.minOrderAmount && subtotal < claim.minOrderAmount) {
    return { valid: false, reason: `Minimum order of $${claim.minOrderAmount} required` };
  }

  return {
    valid: true,
    claimId: claimDoc.id,
    promotionId: claim.promotionId,
    promoCode: claim.promoCode,
    uniqueCode: claim.uniqueCode,
    discountValue: claim.discountValue || 0,
    discountUnit: claim.discountUnit || 'percentage',
    type: claim.type,
    title: claim.promotionTitle,
    minOrderAmount: claim.minOrderAmount || 0
  };
}

// Initialize Stripe - uses Firebase Secrets in production, falls back to test key for dev
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripePublishableKey = defineSecret('STRIPE_PUBLISHABLE_KEY');

// DoorDash Drive secrets
const doordashDeveloperId = defineSecret('DOORDASH_DEVELOPER_ID');
const doordashKeyId = defineSecret('DOORDASH_KEY_ID');
const doordashSigningSecret = defineSecret('DOORDASH_SIGNING_SECRET');
const doordashWebhookToken = defineSecret('DOORDASH_WEBHOOK_TOKEN');

// Notification secrets (Resend email + Plivo SMS)
const resendApiKey = defineSecret('RESEND_API_KEY');
const plivoAuthId = defineSecret('PLIVO_AUTH_ID');
const plivoAuthToken = defineSecret('PLIVO_AUTH_TOKEN');
const plivoFromNumber = defineSecret('PLIVO_FROM_NUMBER');
const googleMapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');

// Mobile App build pipeline secrets
const githubPat = defineSecret('GITHUB_PAT');
const mobileAppWebhookToken = defineSecret('MOBILE_APP_WEBHOOK_TOKEN');
const githubRepo = defineSecret('GITHUB_REPO'); // e.g. "sanjeevbhatta0/customer-app"

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = stripeSecretKey.value() || process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured. Set it via: firebase functions:secrets:set STRIPE_SECRET_KEY');
    // Pin API version so behavior is independent of the account's default.
    // New Stripe accounts default to newer versions where
    // `latest_invoice.payment_intent` on default_incomplete subscriptions is
    // no longer auto-populated (replaced by `confirmation_secret`).
    _stripe = require('stripe')(key, { apiVersion: '2024-12-18.acacia' });
  }
  return _stripe;
}
// Keep backward compat — `stripe` now calls through getter
const stripe = new Proxy({}, {
  get: (_, prop) => {
    const s = getStripe();
    const val = s[prop];
    return typeof val === 'function' ? val.bind(s) : val;
  }
});

// Initialize DoorDash Drive service (fresh each call — secrets resolve at runtime)
const { createDoordashService } = require('./services/doordashService');
function getDoordash() {
  return createDoordashService({
    developerId: (doordashDeveloperId.value() || process.env.DOORDASH_DEVELOPER_ID || '').trim(),
    keyId: (doordashKeyId.value() || process.env.DOORDASH_KEY_ID || '').trim(),
    signingSecret: (doordashSigningSecret.value() || process.env.DOORDASH_SIGNING_SECRET || '').trim(),
  });
}

// ============================================
// AUTHENTICATION HELPER FUNCTIONS
// ============================================

/**
 * Look up email by username for login
 * This allows unauthenticated users to find their email by username
 */
exports.lookupEmailByUsername = onRequest(async (req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      // Rate limit: 10 lookups per IP per minute
      const ip = getClientIp(req);
      if (!checkRateLimit(`lookup_${ip}`, 10, 60000)) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      const { username } = req.body;

      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
      }

      const db = admin.firestore();
      const restaurantsRef = db.collection('restaurants');

      // Rate limit: max 10 lookups per IP per minute
      // NOTE: For production, implement proper rate limiting via Firebase App Check
      // or a rate-limiting middleware. This is a basic in-memory limiter.

      // Try exact match first
      let snapshot = await restaurantsRef.where('username', '==', username).limit(1).get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return res.json({ email: doc.data().email });
      }

      // Try case-insensitive match using usernameLower field
      snapshot = await restaurantsRef.where('usernameLower', '==', username.toLowerCase()).limit(1).get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return res.json({ email: doc.data().email });
      }

      // Try lowercase match on original username field (fallback for older accounts)
      snapshot = await restaurantsRef.where('username', '==', username.toLowerCase()).limit(1).get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        return res.json({ email: doc.data().email });
      }

      // Return generic error (don't reveal whether username exists)
      return res.status(404).json({ error: 'Invalid username or password' });
    } catch (error) {
      console.error('Error looking up username:', error);
      return res.status(500).json({ error: 'Failed to lookup username' });
    }
  });
});

// ============================================
// STRIPE PAYMENT FUNCTIONS
// ============================================

/**
 * Create a Stripe PaymentIntent for card payments
 * Called from the frontend when processing a card payment
 */
exports.createPaymentIntent = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { amount, currency = 'usd', orderIds, tableNumbers, restaurantId, metadata = {}, source } = request.data;

    // Validate amount
    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid payment amount');
    }

    // Validate restaurant ownership (support staff users)
    const resolvedRestaurantId = resolveRestaurantId(request);
    if (restaurantId !== resolvedRestaurantId) {
      throw new HttpsError('permission-denied', 'Not authorized for this restaurant');
    }

    // Check for connected Stripe account (terminal uses platform SDK directly)
    const connectedAccountId = source === 'terminal' ? null : await getStripeConnectAccountId(restaurantId);

    // amount comes in cents from the mobile app (source=terminal) or dollars from web
    const amountInCents = source === 'terminal' ? Math.round(amount) : Math.round(amount * 100);

    // Build metadata — ensure all values are strings (Stripe requirement)
    const safeMetadata = {};
    if (metadata && typeof metadata === 'object') {
      for (const [k, v] of Object.entries(metadata)) {
        safeMetadata[k] = String(v);
      }
    }

    // Build intent params
    let intentParams = {
      amount: amountInCents,
      currency: currency,
      metadata: {
        restaurantId: restaurantId,
        orderIds: JSON.stringify(orderIds),
        tableNumbers: JSON.stringify(tableNumbers),
        source: source || 'web',
        ...safeMetadata
      }
    };

    if (source === 'terminal') {
      // Terminal payments: use card_present payment method for Tap to Pay
      intentParams.payment_method_types = ['card_present'];
      intentParams.capture_method = 'automatic';
    } else {
      // Web payments: keep current behavior
      intentParams.automatic_payment_methods = { enabled: true };
    }

    logger.info('Creating PaymentIntent:', { source, amountInCents, connectedAccountId, restaurantId });

    // Create PaymentIntent — on connected account for web, platform for terminal
    const paymentIntent = connectedAccountId
      ? await stripe.paymentIntents.create(intentParams, { stripeAccount: connectedAccountId })
      : await stripe.paymentIntents.create(intentParams);

    logger.info('PaymentIntent created:', { id: paymentIntent.id, status: paymentIntent.status });

    // Return the client secret for the frontend
    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      connectedAccountId: connectedAccountId || null
    };
  } catch (error) {
    console.error('Error creating payment intent:', error);
    if (error.code) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Confirm payment and update order status
 * Called after successful Stripe payment
 */
exports.confirmStripePayment = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { paymentIntentId, orderIds, paymentDetails, restaurantId, source } = request.data;

    logger.info('confirmStripePayment called:', { paymentIntentId, orderIds, restaurantId, source });

    // Verify restaurant ownership (support staff users)
    const resolvedRestaurantId = resolveRestaurantId(request);
    if (restaurantId !== resolvedRestaurantId) {
      logger.warn('Permission denied:', { restaurantId, resolvedRestaurantId, uid: request.auth?.uid });
      throw new HttpsError('permission-denied', 'Not authorized for this restaurant');
    }

    // Terminal payments are on the platform account; all others may be on connected account
    const connectedAccountId = source === 'terminal' ? null : await getStripeConnectAccountId(restaurantId);

    logger.info('Retrieving PaymentIntent:', { paymentIntentId, connectedAccountId, source });

    // Retrieve the payment intent to verify it's actually paid
    const paymentIntent = connectedAccountId
      ? await stripe.paymentIntents.retrieve(paymentIntentId, { stripeAccount: connectedAccountId })
      : await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      throw new HttpsError('failed-precondition', `Payment not completed. Status: ${paymentIntent.status}`);
    }

    // Update orders in Firestore with payment details
    const db = admin.firestore();
    const batch = db.batch();

    for (const orderId of orderIds) {
      const orderRef = db.doc(`restaurants/${restaurantId}/orders/${orderId}`);
      const orderSnap = await orderRef.get();
      const orderData = orderSnap.exists ? orderSnap.data() : {};

      // If this was a pending KodaPay order, mark as paid and send to kitchen
      // Otherwise, mark as completed (normal dine-in payment flow)
      const isPendingMobilePayment = orderData.pendingMobilePayment === true;

      const updateData = {
        paymentDate: FieldValue.serverTimestamp(),
        paidAtPOS: true,
        paymentDetails: {
          ...paymentDetails,
          stripePaymentIntentId: paymentIntentId,
          paymentMethod: 'card',
          paidAt: new Date().toISOString()
        },
        updatedAt: FieldValue.serverTimestamp()
      };

      if (isPendingMobilePayment) {
        updateData.status = 'sent_to_kitchen';
        updateData.pendingMobilePayment = false;
      } else {
        updateData.status = 'completed';
      }

      batch.update(orderRef, updateData);
    }

    await batch.commit();

    return {
      success: true,
      message: 'Payment confirmed and orders updated'
    };
  } catch (error) {
    console.error('Error confirming payment:', error);
    if (error.code) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Process a Stripe refund for a completed order
 */
exports.processStripeRefund = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const {
      orderId,
      restaurantId,
      refundAmount,
      refundType,
      reason = 'requested_by_customer'
    } = request.data;

    // Verify restaurant ownership (support staff users)
    const resolvedRestaurantId = resolveRestaurantId(request);
    if (restaurantId !== resolvedRestaurantId) {
      throw new HttpsError('permission-denied', 'Not authorized for this restaurant');
    }

    // Get the order to find the payment intent ID
    const db = admin.firestore();
    const orderRef = db.doc(`restaurants/${restaurantId}/orders/${orderId}`);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }

    const orderData = orderSnap.data();
    const paymentIntentId = orderData.paymentDetails?.stripePaymentIntentId;

    if (!paymentIntentId) {
      // Order was paid with cash, just update status without Stripe refund
      await orderRef.update({
        status: 'reimbursed',
        reimbursement: {
          amount: refundAmount,
          type: refundType,
          processedAt: FieldValue.serverTimestamp(),
          processedBy: request.auth.uid,
          paymentMethod: orderData.paymentDetails?.paymentMethod || 'cash'
        },
        updatedAt: FieldValue.serverTimestamp()
      });

      return {
        success: true,
        message: 'Refund recorded (cash payment)',
        refundId: null
      };
    }

    // Convert refund amount to cents
    const refundAmountCents = Math.round(refundAmount * 100);

    // Check for connected Stripe account
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    // Create Stripe refund (on connected account if applicable)
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundAmountCents,
      reason: reason,
      metadata: {
        orderId: orderId,
        restaurantId: restaurantId,
        refundType: refundType
      }
    }, stripeOptions);

    // Update order with refund details
    await orderRef.update({
      status: 'reimbursed',
      reimbursement: {
        amount: refundAmount,
        type: refundType,
        stripeRefundId: refund.id,
        processedAt: FieldValue.serverTimestamp(),
        processedBy: request.auth.uid,
        paymentMethod: 'card'
      },
      updatedAt: FieldValue.serverTimestamp()
    });

    // Create reimbursement record for analytics
    const reimbursementRecord = {
      orderId: orderId,
      orderNumber: orderData.orderNumber || orderId,
      amount: refundAmount,
      type: refundType,
      originalOrderTotal: orderData.total || 0,
      stripeRefundId: refund.id,
      stripePaymentIntentId: paymentIntentId,
      processedAt: FieldValue.serverTimestamp(),
      processedBy: request.auth.uid,
      locationId: orderData.locationId || restaurantId,
      orderType: orderData.orderType || 'dine_in',
      isOnlineOrder: orderData.source === 'website'
    };

    // Only add tableNumber if it exists (not for online orders)
    if (orderData.tableNumber) {
      reimbursementRecord.tableNumber = orderData.tableNumber;
    }

    await db.collection(`restaurants/${restaurantId}/reimbursements`).add(reimbursementRecord);

    return {
      success: true,
      message: 'Refund processed successfully',
      refundId: refund.id
    };
  } catch (error) {
    console.error('Error processing refund:', error);
    if (error.code) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Get Stripe publishable key for frontend
 */
exports.getStripeConfig = onCall({ secrets: [stripeSecretKey, stripePublishableKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Resolve restaurant ID (supports staff users)
    const restaurantId = resolveRestaurantId(request);
    const connectedAccountId = restaurantId ? await getStripeConnectAccountId(restaurantId) : null;

    return {
      publishableKey: stripePublishableKey.value() || process.env.STRIPE_PUBLISHABLE_KEY || '',
      connectedAccountId: connectedAccountId || null
    };
  } catch (error) {
    console.error('Error getting Stripe config:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Create a PaymentIntent for one-time tier payment during signup
 * TODO: Replace with Stripe Subscriptions for recurring billing
 * 
 * This function creates a PaymentIntent for the tier subscription payment.
 * The amount is calculated as: tierPrice * locationCount * billingPeriodMonths
 * 
 * Required data:
 * - amount: Total amount in dollars
 * - tier: Selected tier (ally, guide, chief, elder)
 * - billingCycle: Billing cycle (monthly, quarterly, annual)
 * - locationCount: Number of restaurant locations
 * - restaurantName: Restaurant name for metadata
 * - email: Customer email
 */
exports.createTierPayment = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    // Note: Allow unauthenticated calls since this is called during signup before user is created
    const { amount, currency = 'usd', tier, billingCycle, locationCount, restaurantName, email } = request.data;

    if (!tier || !['ally', 'guide', 'chief', 'elder'].includes(tier)) {
      throw new HttpsError('invalid-argument', 'Invalid tier selection');
    }

    if (!billingCycle || !['monthly', 'quarterly', 'annual'].includes(billingCycle)) {
      throw new HttpsError('invalid-argument', 'Invalid billing cycle');
    }

    if (!locationCount || locationCount < 1 || locationCount > 100) {
      throw new HttpsError('invalid-argument', 'Invalid location count');
    }

    // Server-side price calculation — never trust client-supplied amount
    const db = admin.firestore();
    const configDoc = await db.doc('platformConfig/current').get();
    const adminConfig = configDoc.exists ? configDoc.data() : null;

    // Base prices per tier (fallback if admin config not set)
    const DEFAULT_PRICES = {
      ally: { monthly: 29, quarterly: 79, annual: 290 },
      guide: { monthly: 59, quarterly: 159, annual: 590 },
      chief: { monthly: 99, quarterly: 269, annual: 990 },
      elder: { monthly: 229, quarterly: 619, annual: 2290 }
    };

    let basePrice;
    if (adminConfig && adminConfig.tiers && adminConfig.tiers[tier]) {
      const tierConfig = adminConfig.tiers[tier];
      basePrice = tierConfig.pricing?.[billingCycle] ?? DEFAULT_PRICES[tier][billingCycle];
    } else {
      basePrice = DEFAULT_PRICES[tier][billingCycle];
    }

    // Additional location pricing
    const additionalLocations = Math.max(0, locationCount - 1);
    const locationSurcharge = adminConfig?.additionalLocationPrice ?? 20;
    const multiplier = billingCycle === 'quarterly' ? 3 : billingCycle === 'annual' ? 12 : 1;
    const serverAmount = basePrice + (additionalLocations * locationSurcharge * multiplier);

    // Verify client amount matches server calculation (tolerance of $1 for rounding)
    if (amount && Math.abs(amount - serverAmount) > 1) {
      console.warn(`Price mismatch: client=${amount}, server=${serverAmount}, tier=${tier}, cycle=${billingCycle}`);
      throw new HttpsError('invalid-argument', 'Payment amount does not match expected price');
    }

    // Convert server-computed amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(serverAmount * 100);

    // Create a PaymentIntent with tier metadata
    // TODO: When implementing subscriptions, replace this with stripe.checkout.sessions.create()
    // with a subscription mode and priceId
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency,
      automatic_payment_methods: {
        enabled: true,
      },
      receipt_email: email,
      metadata: {
        type: 'tier_subscription',
        tier: tier,
        billingCycle: billingCycle,
        locationCount: locationCount.toString(),
        restaurantName: restaurantName,
        // TODO: Add these when implementing Stripe subscriptions:
        // priceId: STRIPE_PRICE_IDS[tier][billingCycle],
        // customerId: stripeCustomerId
      },
      description: `Koda Carte ${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan - ${billingCycle} billing (${locationCount} location${locationCount > 1 ? 's' : ''})`
    });

    // Return the client secret for the frontend
    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    };
  } catch (error) {
    console.error('Error creating tier payment:', error);
    if (error.code) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

// ======================================
// Stripe Subscription Billing
// ======================================
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

/**
 * Helper: get or create a Stripe Product for a tier.
 * Products are cached in platformConfig/stripeProducts.
 */
async function getOrCreateStripeProduct(stripe, db, tier) {
  const productsDoc = await db.doc('platformConfig/stripeProducts').get();
  const products = productsDoc.exists ? productsDoc.data() : {};

  if (products[tier]) {
    // Verify product still exists in Stripe
    try {
      await stripe.products.retrieve(products[tier]);
      return products[tier];
    } catch {
      // Product was deleted, create a new one
    }
  }

  const tierNames = { ally: 'Ally', guide: 'Guide', chief: 'Chief', elder: 'Elder' };
  const product = await stripe.products.create({
    name: `Koda Carte ${tierNames[tier] || tier} Plan`,
    metadata: { tier, platform: 'kodacarte' },
  });

  await db.doc('platformConfig/stripeProducts').set(
    { [tier]: product.id },
    { merge: true }
  );

  return product.id;
}

/**
 * Helper: get or create a Stripe Price for a tier + billing cycle + amount.
 * Prices are immutable in Stripe, so a new one is created if the amount changes.
 */
async function getOrCreateStripePrice(stripe, db, productId, tier, billingCycle, amountInCents) {
  const intervalMap = { monthly: 'month', quarterly: 'month', annual: 'year' };
  const intervalCountMap = { monthly: 1, quarterly: 3, annual: 1 };
  const interval = intervalMap[billingCycle];
  const intervalCount = intervalCountMap[billingCycle];

  // Cache key: tier_cycle_amount
  const cacheKey = `${tier}_${billingCycle}_${amountInCents}`;
  const pricesDoc = await db.doc('platformConfig/stripePrices').get();
  const prices = pricesDoc.exists ? pricesDoc.data() : {};

  if (prices[cacheKey]) {
    try {
      const existing = await stripe.prices.retrieve(prices[cacheKey]);
      if (existing.active && existing.unit_amount === amountInCents) {
        return prices[cacheKey];
      }
    } catch {
      // Price deleted or invalid, create new
    }
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: amountInCents,
    currency: 'usd',
    recurring: { interval, interval_count: intervalCount },
    metadata: { tier, billingCycle, platform: 'kodacarte' },
  });

  await db.doc('platformConfig/stripePrices').set(
    { [cacheKey]: price.id },
    { merge: true }
  );

  return price.id;
}

/**
 * Helper: calculate server-side price per location per billing period.
 * Matches the client-side calculateTierPrice logic.
 */
function calculateServerPrice(adminConfig, tier, billingCycle) {
  const DEFAULT_BASE_PRICES = { ally: 29, guide: 59, chief: 99, elder: 229 };
  const DEFAULT_BILLING_MULTIPLIERS = { monthly: 1.20, quarterly: 1.10, annual: 1.00 };

  const basePrices = adminConfig?.pricing || DEFAULT_BASE_PRICES;
  const billingMultipliers = adminConfig?.billingMultipliers || DEFAULT_BILLING_MULTIPLIERS;
  const BILLING_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

  const basePrice = basePrices[tier] ?? DEFAULT_BASE_PRICES[tier] ?? 29;
  const multiplier = billingMultipliers[billingCycle] ?? DEFAULT_BILLING_MULTIPLIERS[billingCycle] ?? 1;
  const billingMonths = BILLING_MONTHS[billingCycle] || 1;

  // Check for active discounts
  let discountAmount = 0;
  let activeDiscount = null;
  if (adminConfig?.discounts) {
    const now = new Date();
    activeDiscount = adminConfig.discounts.find(d => {
      if (!d.active) return false;
      const start = new Date(d.startDate);
      const end = new Date(d.endDate);
      return now >= start && now <= end &&
        ((d.type === 'tier' && d.target === tier) ||
         (d.type === 'billing_cycle' && d.target === billingCycle));
    });

    if (activeDiscount) {
      if (activeDiscount.isPercentage) {
        discountAmount = basePrice * (activeDiscount.amount / 100);
      } else {
        discountAmount = activeDiscount.amount;
      }
    }
  }

  const discountedBasePrice = Math.max(0, basePrice - discountAmount);
  const monthlyPerLocation = discountedBasePrice * multiplier;
  const totalPerLocationCharge = monthlyPerLocation * billingMonths;

  return {
    monthlyPerLocation: Math.round(monthlyPerLocation * 100) / 100,
    totalPerLocationCharge: Math.round(totalPerLocationCharge * 100) / 100,
    billingMonths,
    activeDiscount,
    discountAmount: Math.round(discountAmount * 100) / 100,
    basePrice,
    multiplier,
  };
}

/**
 * Create a Stripe Subscription for a new restaurant signup.
 * Handles:
 * - Recurring billing (monthly, quarterly, annual)
 * - Free trials (collect card via SetupIntent, charge after trial)
 * - Discounts (applied as Stripe Coupons)
 * - Multi-location pricing
 *
 * Flow:
 * - Non-trial: Creates subscription with payment_behavior='default_incomplete',
 *   returns clientSecret from the latest invoice's PaymentIntent
 * - Trial: Creates SetupIntent to collect card, then creates subscription with trial
 *   Returns setupIntentClientSecret
 */
exports.createStripeSubscription = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    const { tier, billingCycle, locationCount, restaurantName, email } = request.data;

    if (!tier || !['ally', 'guide', 'chief', 'elder'].includes(tier)) {
      throw new HttpsError('invalid-argument', 'Invalid tier selection');
    }
    if (!billingCycle || !['monthly', 'quarterly', 'annual'].includes(billingCycle)) {
      throw new HttpsError('invalid-argument', 'Invalid billing cycle');
    }
    if (!locationCount || locationCount < 1 || locationCount > 100) {
      throw new HttpsError('invalid-argument', 'Invalid location count');
    }
    if (!email) {
      throw new HttpsError('invalid-argument', 'Email is required');
    }

    const db = admin.firestore();
    const configDoc = await db.doc('platformConfig/current').get();
    const adminConfig = configDoc.exists ? configDoc.data() : null;

    // Calculate server-side price (with discounts)
    const pricing = calculateServerPrice(adminConfig, tier, billingCycle);
    const amountPerLocationCents = Math.round(pricing.totalPerLocationCharge * 100);

    // Check for free trial
    const trialConfig = adminConfig?.freeTrials?.[tier];
    const hasFreeTrial = trialConfig?.enabled && trialConfig?.days > 0;
    const trialDays = hasFreeTrial ? trialConfig.days : 0;

    // Get or create Stripe Product and Price
    const productId = await getOrCreateStripeProduct(stripe, db, tier);
    const priceId = await getOrCreateStripePrice(
      stripe, db, productId, tier, billingCycle, amountPerLocationCents
    );

    // Create Stripe Customer
    const customer = await stripe.customers.create({
      email,
      name: restaurantName,
      metadata: {
        tier,
        billingCycle,
        locationCount: locationCount.toString(),
        platform: 'kodacarte',
      },
    });

    // Create Stripe Coupon if there's an active discount
    let couponId = null;
    if (pricing.activeDiscount) {
      const d = pricing.activeDiscount;
      const couponParams = {
        metadata: { discountName: d.name, platform: 'kodacarte' },
        max_redemptions: 1,
      };
      if (d.isPercentage) {
        couponParams.percent_off = d.amount;
      } else {
        couponParams.amount_off = Math.round(d.amount * 100); // cents
        couponParams.currency = 'usd';
      }
      // Set duration based on discount end date
      const end = new Date(d.endDate);
      const now = new Date();
      const monthsLeft = Math.max(1, Math.ceil((end - now) / (30 * 24 * 60 * 60 * 1000)));
      couponParams.duration = 'repeating';
      couponParams.duration_in_months = monthsLeft;

      const coupon = await stripe.coupons.create(couponParams);
      couponId = coupon.id;
    }

    if (hasFreeTrial) {
      // TRIAL FLOW: Collect card via SetupIntent, create subscription with trial
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        metadata: {
          tier,
          billingCycle,
          locationCount: locationCount.toString(),
          restaurantName,
          type: 'trial_signup',
          priceId,
          trialDays: trialDays.toString(),
          ...(couponId ? { couponId } : {}),
        },
      });

      return {
        type: 'trial',
        setupIntentClientSecret: setupIntent.client_secret,
        customerId: customer.id,
        priceId,
        trialDays,
        couponId,
        pricing: {
          monthlyPerLocation: pricing.monthlyPerLocation,
          totalPerLocationCharge: pricing.totalPerLocationCharge,
          billingMonths: pricing.billingMonths,
          discountAmount: pricing.discountAmount,
        },
      };
    } else {
      // PAID FLOW: Create subscription, charge immediately
      const subscriptionParams = {
        customer: customer.id,
        items: [{ price: priceId, quantity: locationCount }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          tier,
          billingCycle,
          locationCount: locationCount.toString(),
          restaurantName,
          platform: 'kodacarte',
        },
      };

      if (couponId) {
        subscriptionParams.coupon = couponId;
      }

      const subscription = await stripe.subscriptions.create(subscriptionParams);

      return {
        type: 'subscription',
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        customerId: customer.id,
        pricing: {
          monthlyPerLocation: pricing.monthlyPerLocation,
          totalPerLocationCharge: pricing.totalPerLocationCharge,
          billingMonths: pricing.billingMonths,
          discountAmount: pricing.discountAmount,
        },
      };
    }
  } catch (error) {
    console.error('Error creating subscription:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Activate a trial subscription after the SetupIntent is confirmed.
 * Called from the client after card details are collected during trial signup.
 * Creates the Stripe Subscription with trial_period_days.
 */
exports.activateTrialSubscription = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    const { customerId, priceId, locationCount, trialDays, couponId, tier, billingCycle, restaurantName } = request.data;

    if (!customerId || !priceId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // Get customer's default payment method from the confirmed SetupIntent
    const customer = await stripe.customers.retrieve(customerId);
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    if (!paymentMethods.data.length) {
      throw new HttpsError('failed-precondition', 'No payment method found. Please add a card.');
    }

    const defaultPaymentMethod = paymentMethods.data[0].id;

    // Set default payment method on customer
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: defaultPaymentMethod },
    });

    // Create subscription with trial
    const subscriptionParams = {
      customer: customerId,
      items: [{ price: priceId, quantity: locationCount || 1 }],
      trial_period_days: trialDays || 14,
      default_payment_method: defaultPaymentMethod,
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      metadata: {
        tier: tier || '',
        billingCycle: billingCycle || '',
        locationCount: (locationCount || 1).toString(),
        restaurantName: restaurantName || '',
        platform: 'kodacarte',
      },
    };

    if (couponId) {
      subscriptionParams.coupon = couponId;
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    return {
      subscriptionId: subscription.id,
      trialEnd: new Date(subscription.trial_end * 1000).toISOString(),
      status: subscription.status,
    };
  } catch (error) {
    console.error('Error activating trial subscription:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Bill overage charges to the platform Stripe account.
 * Called when a restaurant's billing period ends and they have accumulated overage.
 * Overage goes to the PLATFORM account (not the restaurant's connected account),
 * because it's a platform usage fee, not a customer payment.
 *
 * Can be triggered manually by admin or by a scheduled function.
 */
exports.billOverageCharges = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    await verifyAdminCaller(request.auth);

    const { restaurantId } = request.data;
    if (!restaurantId) {
      throw new HttpsError('invalid-argument', 'restaurantId is required');
    }

    const db = admin.firestore();
    const restaurantRef = db.doc(`restaurants/${restaurantId}`);
    const restaurantSnap = await restaurantRef.get();

    if (!restaurantSnap.exists) {
      throw new HttpsError('not-found', 'Restaurant not found');
    }

    const data = restaurantSnap.data();
    const usage = data.orderUsage || {};
    const overageCharges = usage.overageCharges || 0;
    const overageOrders = usage.overageOrders || 0;

    if (overageCharges <= 0) {
      return { success: true, message: 'No overage charges to bill', amount: 0 };
    }

    // Minimum charge of $0.50 (Stripe minimum)
    const chargeAmount = Math.max(50, Math.round(overageCharges * 100)); // cents

    const stripe = require('stripe')(stripeSecretKey.value());
    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeAmount,
      currency: 'usd',
      metadata: {
        type: 'overage_charge',
        restaurantId,
        tier: data.subscription?.tier || 'unknown',
        overageOrders: overageOrders.toString(),
        periodStart: usage.currentPeriodStart || '',
        periodEnd: usage.currentPeriodEnd || '',
      },
      description: `Koda Carte overage charge: ${overageOrders} orders over limit ($${overageCharges.toFixed(2)})`,
      // Use the restaurant owner's saved payment method if available
      ...(data.subscription?.stripeCustomerId ? {
        customer: data.subscription.stripeCustomerId,
        off_session: true,
        confirm: true,
      } : {}),
    });

    // Record the billing in Firestore
    await restaurantRef.update({
      'orderUsage.lastOverageBilled': admin.firestore.FieldValue.serverTimestamp(),
      'orderUsage.lastOverageAmount': overageCharges,
      'orderUsage.lastOveragePaymentIntent': paymentIntent.id,
      // Reset overage counters after billing
      'orderUsage.overageCharges': 0,
      'orderUsage.overageOrders': 0,
    });

    return {
      success: true,
      paymentIntentId: paymentIntent.id,
      amount: overageCharges,
      overageOrders,
    };
  } catch (error) {
    console.error('Error billing overage:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Create a PaymentIntent for a plan upgrade (prorated charge).
 * Called from Account.js when a user upgrades to a higher tier.
 */
exports.createPlanUpgradePayment = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in to upgrade plan');
    }

    const { amount, newTier, newBillingCycle, currentTier, locationCount, email } = request.data;

    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid upgrade amount');
    }

    if (!newTier || !['ally', 'guide', 'chief', 'elder'].includes(newTier)) {
      throw new HttpsError('invalid-argument', 'Invalid tier selection');
    }

    const amountInCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      receipt_email: email,
      metadata: {
        type: 'plan_upgrade',
        previousTier: currentTier,
        newTier: newTier,
        billingCycle: newBillingCycle,
        locationCount: (locationCount || 1).toString(),
        userId: request.auth.uid
      },
      description: `Koda Carte plan upgrade: ${currentTier} → ${newTier} (${newBillingCycle}, ${locationCount} location${locationCount > 1 ? 's' : ''})`
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    };
  } catch (error) {
    console.error('Error creating plan upgrade payment:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Update a Stripe Subscription plan (upgrade or downgrade).
 * - Upgrades: Prorated immediately (Stripe charges the difference)
 * - Downgrades: Scheduled at end of current billing period
 * - Billing cycle changes: Update the subscription's Price
 *
 * Uses Stripe's built-in proration for accurate billing.
 */
exports.updateSubscriptionPlan = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { newTier, newBillingCycle, locationCount } = request.data;
    const uid = request.auth.uid;

    if (!newTier || !['scout', 'ally', 'guide', 'chief', 'elder'].includes(newTier)) {
      throw new HttpsError('invalid-argument', 'Invalid tier');
    }
    if (!newBillingCycle || !['monthly', 'quarterly', 'annual'].includes(newBillingCycle)) {
      throw new HttpsError('invalid-argument', 'Invalid billing cycle');
    }

    const db = admin.firestore();
    const restaurantDoc = await db.doc(`restaurants/${uid}`).get();
    if (!restaurantDoc.exists) {
      throw new HttpsError('not-found', 'Restaurant not found');
    }

    const data = restaurantDoc.data();
    const subscription = data.subscription;

    if (!subscription?.stripeSubscriptionId || !subscription?.stripeCustomerId) {
      throw new HttpsError('failed-precondition', 'No active subscription found. Please contact support.');
    }

    // Downgrade to scout (free) = cancel subscription
    if (newTier === 'scout') {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
        metadata: { pendingDowngrade: 'scout' },
      });

      await db.doc(`restaurants/${uid}`).update({
        'subscription.pendingDowngrade': {
          newTier: 'scout',
          newBillingCycle: 'monthly',
          scheduledAt: new Date().toISOString(),
          effectiveAt: subscription.currentPeriodEnd,
        },
        'subscription.updatedAt': new Date().toISOString(),
      });

      return {
        type: 'downgrade_scheduled',
        effectiveAt: subscription.currentPeriodEnd,
        message: 'Downgrade to Scout scheduled at end of billing period',
      };
    }

    // Get admin config for pricing
    const configDoc = await db.doc('platformConfig/current').get();
    const adminConfig = configDoc.exists ? configDoc.data() : null;

    // Calculate new price
    const pricing = calculateServerPrice(adminConfig, newTier, newBillingCycle);
    const newAmountCents = Math.round(pricing.totalPerLocationCharge * 100);
    const effectiveLocationCount = locationCount || subscription.locationCount || 1;

    // Get or create the new Price in Stripe
    const productId = await getOrCreateStripeProduct(stripe, db, newTier);
    const newPriceId = await getOrCreateStripePrice(
      stripe, db, productId, newTier, newBillingCycle, newAmountCents
    );

    // Retrieve current subscription to get the item ID
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentItem = stripeSubscription.items.data[0];

    if (!currentItem) {
      throw new HttpsError('internal', 'Subscription has no items');
    }

    // Determine tier order for upgrade vs downgrade
    const TIER_ORDER = { scout: 0, ally: 1, guide: 2, chief: 3, elder: 4 };
    const currentTierRank = TIER_ORDER[subscription.tier] ?? 0;
    const newTierRank = TIER_ORDER[newTier] ?? 0;
    const isUpgrade = newTierRank > currentTierRank ||
      (newTierRank === currentTierRank && newAmountCents * effectiveLocationCount > currentItem.price.unit_amount * currentItem.quantity);

    if (isUpgrade) {
      // UPGRADE: Apply immediately with proration
      const updatedSubscription = await stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        {
          items: [{
            id: currentItem.id,
            price: newPriceId,
            quantity: effectiveLocationCount,
          }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'pending_if_incomplete',
          metadata: {
            tier: newTier,
            billingCycle: newBillingCycle,
            locationCount: effectiveLocationCount.toString(),
          },
        }
      );

      // Update Firestore
      await db.doc(`restaurants/${uid}`).update({
        'subscription.tier': newTier,
        'subscription.billingCycle': newBillingCycle,
        'subscription.locationCount': effectiveLocationCount,
        'subscription.status': updatedSubscription.status,
        'subscription.updatedAt': new Date().toISOString(),
        // Clear any pending downgrade
        'subscription.pendingDowngrade': admin.firestore.FieldValue.delete(),
      });

      return {
        type: 'upgrade_applied',
        newTier,
        newBillingCycle,
        status: updatedSubscription.status,
        message: `Upgraded to ${newTier} plan with prorated billing`,
      };
    } else {
      // DOWNGRADE: Schedule for end of current period
      // Use Stripe's subscription schedule or update at period end
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        metadata: {
          pendingDowngradeTier: newTier,
          pendingDowngradeCycle: newBillingCycle,
          pendingDowngradeLocations: effectiveLocationCount.toString(),
          pendingDowngradePriceId: newPriceId,
        },
      });

      // Store pending downgrade in Firestore (will be applied by webhook on renewal)
      await db.doc(`restaurants/${uid}`).update({
        'subscription.pendingDowngrade': {
          newTier,
          newBillingCycle,
          newPriceId,
          locationCount: effectiveLocationCount,
          scheduledAt: new Date().toISOString(),
          effectiveAt: subscription.currentPeriodEnd,
        },
        'subscription.updatedAt': new Date().toISOString(),
      });

      return {
        type: 'downgrade_scheduled',
        newTier,
        newBillingCycle,
        effectiveAt: subscription.currentPeriodEnd,
        message: `Downgrade scheduled for ${subscription.currentPeriodEnd}`,
      };
    }
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

exports.processSocialMediaPost = onDocumentCreated('socialMediaPosts/{postId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const postData = snap.data();
  const postId = event.params.postId;
  const db = admin.firestore();

  try {
    // Get user's social media tokens from restaurants/{uid}/settings/socialMedia
    const userConnections = await db
      .doc(`restaurants/${postData.userId}/settings/socialMedia`)
      .get();

    if (!userConnections.exists) {
      throw new Error('User social media connections not found');
    }

    const connections = userConnections.data();
    const updates = [];

    // Post to each selected platform
    if (postData.platforms.facebook && connections.facebook?.connected) {
      updates.push(postToFacebook(postData, connections.facebook.token));
    }

    if (postData.platforms.instagram && connections.instagram?.connected) {
      updates.push(postToInstagram(postData, connections.instagram.token));
    }

    if (postData.platforms.twitter && connections.twitter?.connected) {
      updates.push(postToTwitter(postData, connections.twitter.accessToken));
    }

    // Wait for all posts to complete
    const results = await Promise.allSettled(updates);

    // Update post status
    const status = results.every(r => r.status === 'fulfilled') ? 'completed' : 'partial';
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason.message);

    await snap.ref.update({
      status,
      errors: errors.length > 0 ? errors : [],
      updatedAt: FieldValue.serverTimestamp()
    });

  } catch (error) {
    console.error('Error processing social media post:', error);
    await snap.ref.update({
      status: 'failed',
      error: error.message,
      updatedAt: FieldValue.serverTimestamp()
    });
  }
});

// Platform-specific posting functions
async function postToFacebook(postData, token) {
  try {
    // First, get the user's Facebook pages
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${token}`
    );

    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      throw new Error('No Facebook pages found for this account');
    }

    // Use the first page (you might want to let users select which page to post to)
    const pageId = pagesResponse.data.data[0].id;
    const pageAccessToken = pagesResponse.data.data[0].access_token;

    // Prepare the post data
    const postContent = {
      message: postData.content,
      access_token: pageAccessToken
    };

    // If there's an image, upload it first
    if (postData.imageUrl) {
      const imageResponse = await axios.get(postData.imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);

      // Upload image to Facebook
      const uploadResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/photos`,
        imageBuffer,
        {
          params: {
            access_token: pageAccessToken,
            caption: postData.content,
            published: true
          },
          headers: {
            'Content-Type': 'image/jpeg'
          }
        }
      );

      return uploadResponse.data;
    } else {
      // Post text-only content
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/feed`,
        postContent
      );

      return response.data;
    }
  } catch (error) {
    console.error('Error posting to Facebook:', error.response?.data || error.message);
    throw new Error(`Facebook posting failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

async function postToInstagram(postData, token) {
  try {
    // Instagram requires an image — skip if no image provided
    if (!postData.imageUrl) {
      throw new Error('Instagram requires an image to post');
    }

    // Get the user's Facebook pages to find linked Instagram business account
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${token}`
    );

    if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
      throw new Error('No Facebook pages found — Instagram Business accounts are linked through Facebook pages');
    }

    // Find the first page with a linked Instagram business account
    let instagramAccountId = null;
    let pageAccessToken = null;

    for (const page of pagesResponse.data.data) {
      const igResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
      );
      if (igResponse.data.instagram_business_account) {
        instagramAccountId = igResponse.data.instagram_business_account.id;
        pageAccessToken = page.access_token;
        break;
      }
    }

    if (!instagramAccountId) {
      throw new Error('No Instagram Business account found linked to your Facebook pages');
    }

    // Step 1: Create a media container
    const createMediaResponse = await axios.post(
      `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
      null,
      {
        params: {
          image_url: postData.imageUrl,
          caption: postData.content,
          access_token: pageAccessToken
        }
      }
    );

    if (!createMediaResponse.data.id) {
      throw new Error('Failed to create Instagram media container');
    }

    // Step 2: Publish the media container
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: createMediaResponse.data.id,
          access_token: pageAccessToken
        }
      }
    );

    return publishResponse.data;
  } catch (error) {
    console.error('Error posting to Instagram:', error.response?.data || error.message);
    throw new Error(`Instagram posting failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

async function postToTwitter(postData, token) {
  try {
    let mediaId = null;

    // If there's an image, upload it first via Twitter media upload API (v1.1)
    if (postData.imageUrl) {
      try {
        // Download the image
        const imageResponse = await axios.get(postData.imageUrl, { responseType: 'arraybuffer' });
        const imageBase64 = Buffer.from(imageResponse.data).toString('base64');

        // Upload to Twitter media endpoint
        const mediaUploadResponse = await axios.post(
          'https://upload.twitter.com/1.1/media/upload.json',
          `media_data=${encodeURIComponent(imageBase64)}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        mediaId = mediaUploadResponse.data.media_id_string;
      } catch (mediaError) {
        console.warn('Twitter media upload failed, posting text only:', mediaError.message);
      }
    }

    // Truncate content to 280 characters for Twitter
    let tweetText = postData.content;
    if (tweetText.length > 280) {
      tweetText = tweetText.substring(0, 277) + '...';
    }

    // Post tweet via Twitter API v2
    const tweetPayload = { text: tweetText };
    if (mediaId) {
      tweetPayload.media = { media_ids: [mediaId] };
    }

    const tweetResponse = await axios.post(
      'https://api.twitter.com/2/tweets',
      tweetPayload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return tweetResponse.data;
  } catch (error) {
    console.error('Error posting to Twitter:', error.response?.data || error.message);
    throw new Error(`Twitter posting failed: ${error.response?.data?.detail || error.response?.data?.title || error.message}`);
  }
}

// Helper function to get restaurant by slug (with in-memory cache)
async function getRestaurantBySlug(slug) {
  const cached = cacheGet(`slug_${slug}`, 10 * 60 * 1000); // 10-min TTL
  if (cached) return cached;

  const snapshot = await admin.firestore()
    .collection('restaurants')
    .where('slug', '==', slug)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const result = { id: doc.id, ...doc.data() };
  cacheSet(`slug_${slug}`, result);
  return result;
}

// Template definitions (embedded for Cloud Functions)
const TEMPLATES = {
  'modern-bistro': {
    primaryColor: '#2c3e50',
    secondaryColor: '#3498db',
    accentColor: '#e74c3c',
    fontFamily: 'Poppins'
  },
  'italian-trattoria': {
    primaryColor: '#1a1a1a',
    secondaryColor: '#2d2d2d',
    accentColor: '#c9a962',
    fontFamily: 'Playfair Display'
  },
  'fresh-cafe': {
    primaryColor: '#2d6a4f',
    secondaryColor: '#40916c',
    accentColor: '#ff6b6b',
    fontFamily: 'Nunito'
  },
  'warm-spice': {
    primaryColor: '#3d2b1f',
    secondaryColor: '#5c4033',
    accentColor: '#ce830c',
    fontFamily: 'Poppins'
  }
};

// Helper function to render template with data
function renderTemplate(template, data) {
  const fs = require('fs');
  const path = require('path');

  let html = template;

  // Load Customer Portal assets for injection
  let customerPortalStyles = '';
  let customerPortalScript = '';
  let customerPortalMockData = '';

  try {
    const portalCssPath = path.join(__dirname, 'templates', 'customer-portal', 'portal.css');
    const portalJsPath = path.join(__dirname, 'templates', 'customer-portal', 'portal.js');
    const portalMockDataPath = path.join(__dirname, 'templates', 'customer-portal', 'data', 'mock-data.js');

    if (fs.existsSync(portalCssPath)) {
      customerPortalStyles = fs.readFileSync(portalCssPath, 'utf-8');
    }
    if (fs.existsSync(portalJsPath)) {
      customerPortalScript = fs.readFileSync(portalJsPath, 'utf-8');
    }
    if (fs.existsSync(portalMockDataPath)) {
      customerPortalMockData = fs.readFileSync(portalMockDataPath, 'utf-8');
    }
  } catch (err) {
    console.error('Error loading Customer Portal assets:', err);
  }

  // Replace simple placeholders
  const replacements = {
    '{{restaurantId}}': data.restaurantId || '',
    '{{locationId}}': data.locationId || data.restaurantId || '', // For multi-location support
    '{{restaurantName}}': data.restaurantName || 'Restaurant',
    '{{tagline}}': data.tagline || 'Welcome to our restaurant',
    '{{description}}': data.description || 'Delicious food, great atmosphere',
    '{{heroImage}}': data.heroImage || '',
    '{{aboutImage}}': data.aboutImage || '',
    '{{aboutContent}}': data.aboutContent || '<p>Welcome to our restaurant! We are passionate about serving delicious food made with the freshest ingredients.</p>',
    '{{address}}': data.address || '123 Main Street, City, State 12345',
    '{{addressEncoded}}': encodeURIComponent(data.address || '123 Main Street, City, State 12345'),
    '{{phone}}': data.phone || '(555) 123-4567',
    '{{email}}': data.email || 'hello@restaurant.com',
    '{{primaryColor}}': data.primaryColor || '#2c3e50',
    '{{secondaryColor}}': data.secondaryColor || '#3498db',
    '{{accentColor}}': data.accentColor || '#e74c3c',
    '{{fontFamily}}': data.fontFamily || 'Poppins',
    '{{logo}}': data.logo || '',
    '{{facebook}}': data.facebook || '',
    '{{instagram}}': data.instagram || '',
    '{{twitter}}': data.twitter || '',
    '{{taxRate}}': data.taxRate !== undefined ? data.taxRate : 8,
    '{{promoId}}': data.promoId || '',
    '{{year}}': new Date().getFullYear().toString(),
    '{{apiBaseUrl}}': data.apiBaseUrl || getAppBaseUrl(),
    '{{stripePublishableKey}}': data.stripePublishableKey || '',
    '{{stripeConnectedAccountId}}': data.stripeConnectedAccountId || '',
    '{{skipPhoneVerification}}': data.skipPhoneVerification ? 'true' : 'false',
    '{{deliveryEnabled}}': data.deliveryEnabled ? 'true' : 'false',
    '{{hoursJson}}': JSON.stringify(data.hours || {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '12:00', close: '23:00' },
      sunday: { open: '12:00', close: '21:00' }
    }),
    // Customer Portal content injection
    '{{customerPortalStyles}}': customerPortalStyles,
    '{{customerPortalScript}}': customerPortalScript,
    '{{customerPortalMockData}}': customerPortalMockData,
    // JSON-encoded CONFIG for safe injection into <script> (handles special chars in names/values)
    '{{configJson}}': JSON.stringify({
      restaurantId: data.restaurantId || '',
      locationId: data.locationId || data.restaurantId || '',
      restaurantName: data.restaurantName || 'Restaurant',
      apiBaseUrl: data.apiBaseUrl || getAppBaseUrl(),
      stripePublishableKey: (data.stripePublishableKey || '').trim(),
      stripeConnectedAccountId: (data.stripeConnectedAccountId || '').trim(),
      taxRate: (data.taxRate !== undefined ? data.taxRate : 8) / 100,
      promoId: data.promoId || '',
      deliveryEnabled: !!data.deliveryEnabled,
      deliveryTipSuggestions: data.deliveryTipSuggestions || [15, 20, 25],
      deliveryContactlessDefault: !!data.deliveryContactlessDefault,
      googleMapsApiKey: data.googleMapsApiKey || ''
    }).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c'), // Escape for safe embedding in JS single-quoted string
    // Firebase config for customer-facing auth
    '{{firebaseConfigJson}}': JSON.stringify({
      apiKey: getClientApiKey(),
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      storageBucket: `${PROJECT_ID}.appspot.com`
    })
  };

  // Replace all placeholders
  for (const [placeholder, value] of Object.entries(replacements)) {
    html = html.split(placeholder).join(value);
  }

  // Handle conditional blocks {{#if variable}}...{{/if}}
  html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, variable, content) => {
    return data[variable] ? content : '';
  });

  return html;
}


// Serve restaurant websites dynamically
exports.serveWebsite = onRequest({ secrets: [stripeSecretKey, stripePublishableKey, googleMapsApiKey] }, async (req, res) => {
  return cors(req, res, async () => {
    try {
      const host = req.hostname;
      console.log('Incoming request hostname:', host);

      let restaurantId;
      let restaurant;
      let derivedLocationId = null;

      // Helper function to find restaurant by slug or ID, handling multi-location combined slugs
      async function findRestaurantBySlugOrId(slug) {
        const db = admin.firestore();

        // First try exact slug match
        let rest = await getRestaurantBySlug(slug);
        if (rest) {
          return { restaurantId: rest.id, restaurant: rest, locationSlug: null };
        }

        // Try as direct restaurant ID (for cases where slug isn't set)
        const directDoc = await db.doc(`restaurants/${slug}`).get();
        if (directDoc.exists) {
          return { restaurantId: slug, restaurant: { id: slug, ...directDoc.data() }, locationSlug: null };
        }

        // For multi-location: slug might be "restaurant-id-or-slug-location-slug"
        // Try progressively shorter prefixes
        const parts = slug.split('-');
        for (let i = parts.length - 1; i >= 1; i--) {
          const potentialRestaurantPart = parts.slice(0, i).join('-');
          const potentialLocationSlug = parts.slice(i).join('-');

          // Try as slug first
          rest = await getRestaurantBySlug(potentialRestaurantPart);
          if (rest) {
            return { restaurantId: rest.id, restaurant: rest, locationSlug: potentialLocationSlug };
          }

          // Try as direct restaurant ID
          const idDoc = await db.doc(`restaurants/${potentialRestaurantPart}`).get();
          if (idDoc.exists) {
            return { restaurantId: potentialRestaurantPart, restaurant: { id: potentialRestaurantPart, ...idDoc.data() }, locationSlug: potentialLocationSlug };
          }
        }

        return { restaurantId: null, restaurant: null, locationSlug: null };
      }

      // Check if this is a custom domain (not our own hosting domain)
      if (!host.includes('web.app') && !host.includes('firebaseapp.com') && !host.includes('cloudfunctions.net') && !host.includes('localhost') && !host.includes('run.app')) {
        console.log('Custom domain detected:', host);

        // Try matching both the exact host and the bare/www variant
        const hostVariants = [host];
        if (host.startsWith('www.')) {
          hostVariants.push(host.slice(4)); // bare domain
        } else {
          hostVariants.push(`www.${host}`); // www version
        }

        let customDomainSnap = null;
        for (const variant of hostVariants) {
          // Check against customDomain field (bare domain)
          let snap = await admin.firestore()
            .collection('restaurants')
            .where('customDomain', '==', variant)
            .limit(1)
            .get();
          if (!snap.empty) {
            customDomainSnap = snap;
            break;
          }
          // Also check customDomainWww field
          snap = await admin.firestore()
            .collection('restaurants')
            .where('customDomainWww', '==', variant)
            .limit(1)
            .get();
          if (!snap.empty) {
            customDomainSnap = snap;
            break;
          }
        }

        if (customDomainSnap && !customDomainSnap.empty) {
          const doc = customDomainSnap.docs[0];
          restaurantId = doc.id;
          restaurant = { id: doc.id, ...doc.data() };
          console.log('Resolved custom domain', host, 'to restaurant:', restaurantId);

          // For multi-location custom domains, check if path has a location slug
          // e.g., www.joesburgers.com/downtown
          const pathParts = req.path.split('/').filter(Boolean);
          if (pathParts.length > 0 && restaurant.isMultiLocation) {
            const locSlug = pathParts[0];
            const locSnap = await admin.firestore()
              .collection(`restaurants/${restaurantId}/locations`)
              .where('slug', '==', locSlug)
              .limit(1)
              .get();
            if (!locSnap.empty) {
              derivedLocationId = locSnap.docs[0].id;
              console.log('Custom domain location:', locSlug, '->', derivedLocationId);
            }
          }
        } else {
          console.log('No restaurant found for custom domain:', host);
        }
      }

      // Handle subdomain or query param
      if (!restaurantId && (host.includes(`${PROJECT_ID}.web.app`) || host.includes('cloudfunctions.net'))) {
        const subdomain = host.split('.')[0];
        if (subdomain !== PROJECT_ID && subdomain !== `us-central1-${PROJECT_ID}`) {
          const result = await findRestaurantBySlugOrId(subdomain);
          if (result.restaurantId) {
            restaurant = result.restaurant;
            restaurantId = result.restaurantId;
            if (result.locationSlug) {
              // Find the locationId from the location slug
              const locationsSnap = await admin.firestore()
                .collection(`restaurants/${restaurantId}/locations`)
                .where('slug', '==', result.locationSlug)
                .limit(1)
                .get();
              if (!locationsSnap.empty) {
                derivedLocationId = locationsSnap.docs[0].id;
              }
            }
          }
        }
      }

      // Fallback to query param for testing
      if (!restaurantId && req.query.restaurant) {
        console.log('Looking up restaurant by query param:', req.query.restaurant);
        const result = await findRestaurantBySlugOrId(req.query.restaurant);
        console.log('Lookup result:', JSON.stringify({ restaurantId: result.restaurantId, hasRestaurant: !!result.restaurant, locationSlug: result.locationSlug }));
        if (result.restaurantId) {
          restaurant = result.restaurant;
          restaurantId = result.restaurantId;
          if (result.locationSlug) {
            // Find the locationId from the location slug
            const locationsSnap = await admin.firestore()
              .collection(`restaurants/${restaurantId}/locations`)
              .where('slug', '==', result.locationSlug)
              .limit(1)
              .get();
            if (!locationsSnap.empty) {
              derivedLocationId = locationsSnap.docs[0].id;
              console.log('Found location by slug:', result.locationSlug, '-> id:', derivedLocationId);
            } else {
              console.log('No location found with slug:', result.locationSlug);
              // Try to find location by name match (fallback)
              const allLocationsSnap = await admin.firestore()
                .collection(`restaurants/${restaurantId}/locations`)
                .get();
              console.log('Available locations:', allLocationsSnap.docs.map(d => ({ id: d.id, slug: d.data().slug, name: d.data().name })));
            }
          }
        }
      }

      // Also check if locationId is directly in query params (takes priority)
      if (req.query.locationId) {
        derivedLocationId = req.query.locationId;
        console.log('Using locationId from query param:', derivedLocationId);
      }

      if (!restaurantId) {
        return res.status(404).send(`
                    <!DOCTYPE html>
                    <html><head><title>Restaurant Not Found</title>
                    <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
                    .container{text-align:center;padding:2rem;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
                    h1{color:#e74c3c;margin-bottom:1rem;}</style></head>
                    <body><div class="container"><h1>🍽️ Restaurant Not Found</h1><p>The restaurant you're looking for doesn't exist.</p></div></body></html>
                `);
      }

      // Fetch restaurant data from Firestore
      const db = admin.firestore();
      const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();

      if (!restaurantDoc.exists) {
        return res.status(404).send(`
                    <!DOCTYPE html>
                    <html><head><title>Restaurant Not Found</title>
                    <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
                    .container{text-align:center;padding:2rem;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
                    h1{color:#e74c3c;margin-bottom:1rem;}</style></head>
                    <body><div class="container"><h1>🍽️ Restaurant Not Found</h1><p>This restaurant doesn't exist in our system.</p></div></body></html>
                `);
      }

      const restaurantData = restaurantDoc.data();

      // Check if multi-location and get locationId from query, derived from slug, or config
      const isMultiLocation = restaurantData.isMultiLocation === true;
      const locationId = req.query.locationId || derivedLocationId || null;

      console.log('Multi-location:', isMultiLocation, '| LocationId:', locationId, '| Derived:', derivedLocationId);

      // Fetch website configuration (location-specific for multi-location)
      let websiteDoc;
      let websiteData = {};
      let effectiveLocationId;

      if (isMultiLocation && locationId) {
        // Multi-location: load location-specific config
        websiteDoc = await db.doc(`restaurants/${restaurantId}/locations/${locationId}/website/config`).get();
        websiteData = websiteDoc.exists ? websiteDoc.data() : {};
        effectiveLocationId = locationId; // Use the known locationId
        console.log('Loaded location-specific config for locationId:', locationId);
      } else if (isMultiLocation && !locationId) {
        // Multi-location but no locationId - this is a problem!
        // Try to find a location by searching through all locations for a matching slug
        console.log('Multi-location restaurant but no locationId. Searching locations...');
        const locationsSnap = await db.collection(`restaurants/${restaurantId}/locations`).get();

        for (const locDoc of locationsSnap.docs) {
          const locData = locDoc.data();
          const locConfigDoc = await db.doc(`restaurants/${restaurantId}/locations/${locDoc.id}/website/config`).get();
          if (locConfigDoc.exists) {
            // Check if this location's website config is published or matches our needs
            const locConfig = locConfigDoc.data();
            // Use the first location that has a website config
            // This is a fallback - ideally we'd have the locationId from the URL
            websiteDoc = locConfigDoc;
            websiteData = locConfig;
            effectiveLocationId = locDoc.id;
            console.log('Using fallback location:', locDoc.id, locData.name);
            break;
          }
        }

        // If still no config found, fall back to restaurant-level (legacy single-location)
        if (!websiteDoc?.exists) {
          websiteDoc = await db.doc(`restaurants/${restaurantId}/website/config`).get();
          websiteData = websiteDoc.exists ? websiteDoc.data() : {};
          effectiveLocationId = websiteData.locationId || restaurantId;
          console.log('Using restaurant-level fallback config');
        }
      } else {
        // Single-location: load restaurant-level config
        websiteDoc = await db.doc(`restaurants/${restaurantId}/website/config`).get();
        websiteData = websiteDoc.exists ? websiteDoc.data() : {};
        effectiveLocationId = restaurantId;
        console.log('Single-location: using restaurant-level config');
      }

      console.log('Effective locationId for orders:', effectiveLocationId);

      // Check for promo query parameter (for store launch QR codes)
      // Sanitize to alphanumeric + dash/underscore only to prevent XSS in JS string injection
      const rawPromoId = req.query.promo || '';
      const promoId = rawPromoId.replace(/[^a-zA-Z0-9_-]/g, '');

      // Check if this is an authenticated preview request (owner only)
      // Preview requires a signed token to prevent public access to unpublished sites
      const previewToken = req.query.preview || '';
      const isPreview = previewToken === restaurantId; // Simple owner-knows-ID check

      // Check if website is published (unless it's an owner preview request)
      if (!websiteData.isPublished && !isPreview) {
        return res.status(404).send(`
                    <!DOCTYPE html>
                    <html><head><title>Website Not Published</title>
                    <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
                    .container{text-align:center;padding:2rem;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
                    h1{color:#f39c12;margin-bottom:1rem;}</style></head>
                    <body><div class="container"><h1>🚧 Coming Soon</h1><p>This restaurant's website is under construction.</p></div></body></html>
                `);
      }

      // Whitelist template ID to prevent path traversal
      const rawTemplateId = websiteData.template || 'modern-bistro';
      const templateId = TEMPLATES[rawTemplateId] ? rawTemplateId : 'modern-bistro';
      const templateDefaults = TEMPLATES[templateId];

      // For multi-location, try to get location-specific settings
      let locationTaxRate = null;
      if (isMultiLocation && effectiveLocationId && effectiveLocationId !== restaurantId) {
        const locationDoc = await db.doc(`restaurants/${restaurantId}/locations/${effectiveLocationId}`).get();
        if (locationDoc.exists) {
          const locationData = locationDoc.data();
          // Use location taxRate if set, otherwise fall back to restaurant-level
          if (locationData.taxRate !== undefined) {
            locationTaxRate = locationData.taxRate;
          }
        }
      }

      // Determine final taxRate: location > restaurant > default
      const finalTaxRate = locationTaxRate !== null ? locationTaxRate :
        (restaurantData.taxRate !== undefined ? restaurantData.taxRate : 8);

      console.log('Tax rate sources - Location:', locationTaxRate, 'Restaurant:', restaurantData.taxRate, 'Final:', finalTaxRate);

      // Build template data
      const templateData = {
        restaurantId: restaurantId,
        locationId: effectiveLocationId,
        restaurantName: escapeHtml(websiteData.restaurantName || restaurantData.name || 'Restaurant'),
        tagline: escapeHtml(websiteData.tagline || 'Welcome to our restaurant'),
        description: escapeHtml(websiteData.description || 'Delicious food made with love'),
        heroImage: sanitizeUrl(websiteData.heroImage || ''),
        aboutImage: sanitizeUrl(websiteData.aboutImage || ''),
        aboutContent: websiteData.aboutContent || '<p>Welcome to our restaurant! We are passionate about serving delicious food.</p>',
        address: escapeHtml(websiteData.address || restaurantData.address || ''),
        phone: escapeHtml(websiteData.phone || restaurantData.phone || ''),
        email: escapeHtml(websiteData.email || restaurantData.email || ''),
        logo: sanitizeUrl(websiteData.logo || restaurantData.logo || ''),
        primaryColor: sanitizeColor(websiteData.primaryColor) || templateDefaults.primaryColor,
        secondaryColor: sanitizeColor(websiteData.secondaryColor) || templateDefaults.secondaryColor,
        accentColor: sanitizeColor(websiteData.accentColor) || templateDefaults.accentColor,
        fontFamily: sanitizeFontFamily(websiteData.fontFamily) || templateDefaults.fontFamily,
        facebook: escapeHtml(websiteData.facebook || ''),
        instagram: escapeHtml(websiteData.instagram || ''),
        twitter: escapeHtml(websiteData.twitter || ''),
        hours: websiteData.hours || {
          monday: { open: '11:00', close: '22:00' },
          tuesday: { open: '11:00', close: '22:00' },
          wednesday: { open: '11:00', close: '22:00' },
          thursday: { open: '11:00', close: '22:00' },
          friday: { open: '11:00', close: '23:00' },
          saturday: { open: '12:00', close: '23:00' },
          sunday: { open: '12:00', close: '21:00' }
        },
        // Use emulator URL if running in emulator, otherwise production Cloud Functions URL
        apiBaseUrl: process.env.FUNCTIONS_EMULATOR === 'true'
          ? `http://localhost:5001/${PROJECT_ID}/us-central1`
          : getApiBaseUrl(),
        stripePublishableKey: stripePublishableKey.value() || process.env.STRIPE_PUBLISHABLE_KEY || '',
        stripeConnectedAccountId: await getStripeConnectAccountId(restaurantId) || '',
        taxRate: finalTaxRate,
        promoId: promoId,
        skipPhoneVerification: websiteData.skipPhoneVerification !== false, // Default true until SMS is enabled (10DLC approval)
        // Delivery settings
        deliveryEnabled: !!(restaurantData.deliverySettings && restaurantData.deliverySettings.enabled),
        deliveryTipSuggestions: (restaurantData.deliverySettings && restaurantData.deliverySettings.tipSuggestions) || [15, 20, 25],
        deliveryContactlessDefault: !!(restaurantData.deliverySettings && restaurantData.deliverySettings.contactlessDefault),
        googleMapsApiKey: googleMapsApiKey.value() || process.env.GOOGLE_MAPS_API_KEY || ''
      };

      // === EMBED MODE ===
      // Serves a complete standalone app (menu + cart + checkout + portal) for the widget iframe
      const isEmbed = req.query.embed === 'true';
      if (isEmbed) {
        const fs = require('fs');
        const path = require('path');

        // Load all assets
        let portalCss = '', portalJs = '', embedAppJs = '';
        try {
          const base = path.join(__dirname, 'templates', 'customer-portal');
          if (fs.existsSync(path.join(base, 'portal.css'))) portalCss = fs.readFileSync(path.join(base, 'portal.css'), 'utf-8');
          if (fs.existsSync(path.join(base, 'portal.js'))) portalJs = fs.readFileSync(path.join(base, 'portal.js'), 'utf-8');
          if (fs.existsSync(path.join(base, 'embed-app.js'))) embedAppJs = fs.readFileSync(path.join(base, 'embed-app.js'), 'utf-8');
        } catch (err) {
          console.error('Error loading embed assets:', err);
        }

        // Pre-fetch menu data server-side to eliminate client-side API call
        let preloadedMenu = [];
        try {
          const isMultiLoc = restaurantData.isMultiLocation === true;
          const catSnap = await db.collection(`restaurants/${restaurantId}/menuCategories`).orderBy('name').get();
          for (const catDoc of catSnap.docs) {
            const cat = { id: catDoc.id, ...catDoc.data(), items: [] };
            const itemSnap = await db.collection(`restaurants/${restaurantId}/menuCategories/${catDoc.id}/items`).orderBy('name').get();
            itemSnap.forEach(itemDoc => {
              const d = itemDoc.data();
              if (isMultiLoc && effectiveLocationId && d.locations && d.locations.length > 0 && !d.locations.includes(effectiveLocationId)) return;
              cat.items.push({ id: itemDoc.id, ...d, price: typeof d.price === 'number' ? d.price : parseFloat(d.price) || 0, discount: typeof d.discount === 'number' ? d.discount : parseFloat(d.discount) || 0, discountType: d.discountType || 'amount' });
            });
            if (cat.items.length > 0) preloadedMenu.push(cat);
          }
        } catch (menuErr) {
          console.error('Error pre-loading menu:', menuErr);
        }

        // Whitelist valid tab names to prevent XSS in JS string injection
        const validTabs = ['menu', 'order', 'cart', 'account', 'rewards', 'reviews'];
        const rawTab = req.query.tab || 'menu';
        const initialTab = validTabs.includes(rawTab) ? rawTab : 'menu';
        const firebaseConfig = JSON.stringify({
          apiKey: getClientApiKey(),
          authDomain: `${PROJECT_ID}.firebaseapp.com`,
          projectId: PROJECT_ID,
          storageBucket: `${PROJECT_ID}.appspot.com`
        });

        const embedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${templateData.restaurantName}</title>
  ${templateData.logo ? `<link rel="icon" href="${templateData.logo}" type="image/png">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${templateData.fontFamily}:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
  <style>${portalCss}</style>
  <style>
    :root {
      --ea-primary: ${templateData.primaryColor};
      --ea-secondary: ${templateData.secondaryColor};
      --ea-accent: ${templateData.accentColor};
      --ea-font: '${templateData.fontFamily}', system-ui, sans-serif;
      --ea-radius: 10px;
      --ea-shadow: 0 2px 12px rgba(0,0,0,0.08);
      /* portal overrides */
      --primary-color: ${templateData.primaryColor};
      --secondary-color: ${templateData.secondaryColor};
      --accent-color: ${templateData.accentColor};
      --font-family: '${templateData.fontFamily}', sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--ea-font); background: #f8f9fa; color: #333; overflow-x: hidden; }

    /* ---- App Shell ---- */
    .ea-app { min-height: 100vh; display: flex; flex-direction: column; }
    .ea-view { display: none; flex: 1; }
    .ea-view.ea-active { display: block; }
    .ea-hidden { display: none !important; }

    /* ---- Loading ---- */
    .ea-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; }
    .ea-spinner { width: 36px; height: 36px; border: 3px solid #e0e0e0; border-top-color: var(--ea-primary); border-radius: 50%; animation: ea-spin 0.8s linear infinite; margin-bottom: 12px; }
    @keyframes ea-spin { to { transform: rotate(360deg); } }
    .ea-error { color: #dc3545; padding: 20px; text-align: center; }
    .ea-empty { color: #999; text-align: center; padding: 40px 20px; }

    /* ---- Categories ---- */
    .ea-categories { display: flex; gap: 8px; padding: 16px 16px 12px; overflow-x: auto; -webkit-overflow-scrolling: touch; background: #fff; border-bottom: 1px solid #eee; position: sticky; top: 0; z-index: 10; }
    .ea-categories::-webkit-scrollbar { display: none; }
    .ea-cat-btn { flex-shrink: 0; padding: 8px 18px; border: 2px solid var(--ea-primary); background: transparent; color: var(--ea-primary); border-radius: 25px; cursor: pointer; font-weight: 600; font-size: 0.88rem; transition: all 0.2s; font-family: var(--ea-font); white-space: nowrap; }
    .ea-cat-btn:hover, .ea-cat-btn.active { background: var(--ea-primary); color: #fff; }
    .ea-cat-count { font-size: 0.72rem; opacity: 0.7; margin-left: 4px; }

    /* ---- Items Grid ---- */
    .ea-items-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 16px; }
    .ea-item-card { background: #fff; border-radius: var(--ea-radius); overflow: hidden; box-shadow: var(--ea-shadow); transition: transform 0.2s, box-shadow 0.2s; }
    .ea-item-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,0,0,0.12); }
    .ea-item-img { width: 100%; height: 170px; object-fit: cover; display: block; }
    .ea-item-img-placeholder { width: 100%; height: 120px; background: linear-gradient(135deg, #f0f0f0, #e8e8e8); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: #ccc; }
    .ea-item-body { padding: 14px; }
    .ea-item-name { font-weight: 600; font-size: 1rem; margin-bottom: 4px; color: #222; }
    .ea-item-desc { color: #777; font-size: 0.82rem; margin-bottom: 10px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ea-item-footer { display: flex; justify-content: space-between; align-items: center; }
    .ea-item-price { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .ea-price-original { text-decoration: line-through; color: #aaa; font-size: 0.85rem; }
    .ea-price-final { font-weight: 700; color: var(--ea-primary); font-size: 1.1rem; }
    .ea-price-badge { background: #e74c3c; color: #fff; font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    .ea-add-btn { padding: 8px 16px; background: var(--ea-primary); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.85rem; font-family: var(--ea-font); transition: opacity 0.2s; display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .ea-add-btn:hover { opacity: 0.85; }
    .ea-add-btn:active { transform: scale(0.96); }

    /* ---- Cart Bar ---- */
    .ea-cart-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--ea-primary); color: #fff; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: 600; z-index: 100; box-shadow: 0 -2px 16px rgba(0,0,0,0.2); }
    .ea-cart-bar-left { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; }
    .ea-cart-count { background: #fff; color: var(--ea-primary); width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; }
    .ea-cart-bar-right { display: flex; align-items: center; gap: 12px; }
    .ea-cart-bar-btn { background: rgba(255,255,255,0.2); padding: 6px 16px; border-radius: 20px; font-size: 0.88rem; }

    /* ---- Cart Overlay + Panel ---- */
    .ea-cart-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); z-index: 200; }
    .ea-cart-panel { position: fixed; bottom: 0; left: 0; right: 0; max-height: 70vh; background: #fff; border-radius: 16px 16px 0 0; box-shadow: 0 -4px 30px rgba(0,0,0,0.2); z-index: 201; display: flex; flex-direction: column; overflow: hidden; animation: ea-slide-up 0.3s ease; }
    @keyframes ea-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
    .ea-cart-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #eee; }
    .ea-cart-header h3 { font-size: 1.1rem; }
    .ea-cart-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #666; padding: 0 4px; }
    .ea-cart-items { flex: 1; overflow-y: auto; padding: 12px 20px; }
    .ea-cart-empty { text-align: center; color: #999; padding: 30px; }
    .ea-cart-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
    .ea-cart-item-info { flex: 1; }
    .ea-cart-item-name { font-weight: 600; font-size: 0.92rem; }
    .ea-cart-item-price { color: #666; font-size: 0.85rem; margin-top: 2px; }
    .ea-cart-item-controls { display: flex; align-items: center; gap: 8px; }
    .ea-qty-btn { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #ddd; background: #f8f8f8; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
    .ea-qty-btn:hover { background: var(--ea-primary); color: #fff; border-color: var(--ea-primary); }
    .ea-qty { font-weight: 600; min-width: 20px; text-align: center; }
    .ea-remove-btn { background: none; border: none; color: #dc3545; cursor: pointer; padding: 4px; font-size: 0.9rem; }
    .ea-cart-summary { padding: 16px 20px; border-top: 1px solid #eee; background: #fafafa; }
    .ea-summary-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.9rem; color: #555; }
    .ea-summary-total { font-weight: 700; font-size: 1.05rem; color: #222; padding-top: 8px; border-top: 1px solid #ddd; margin-top: 4px; }
    .ea-checkout-btn { width: 100%; padding: 14px; background: var(--ea-primary); color: #fff; border: none; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 12px; font-family: var(--ea-font); transition: opacity 0.2s; }
    .ea-checkout-btn:hover { opacity: 0.9; }
    .ea-clear-btn { width: 100%; padding: 10px; background: transparent; color: #999; border: 1px solid #ddd; border-radius: 10px; font-size: 0.85rem; cursor: pointer; margin-top: 8px; font-family: var(--ea-font); }

    /* ---- Cart item notes & spice ---- */
    .ea-cart-item-spice { font-size: 0.75rem; color: #e74c3c; font-weight: 600; }
    .ea-cart-item-notes { font-size: 0.72rem; color: #e67e22; font-style: italic; }
    .ea-item-spice-hint { font-size: 0.72rem; color: #e74c3c; margin-bottom: 4px; }
    .ea-cart-note-btn { cursor: pointer; margin-left: 6px; font-size: 0.7rem; color: #aaa; }
    .ea-cart-note-btn:hover { color: #e67e22; }
    .ea-cart-item-name .bi-pencil-fill { color: #e67e22; }

    /* ---- Item Options Overlay ---- */
    .ea-item-options-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; }
    .ea-item-options-panel { background: #fff; border-radius: 12px; padding: 20px; max-width: 340px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
    .ea-item-options-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .ea-item-options-close { background: none; border: none; font-size: 1.4rem; cursor: pointer; color: #999; }
    .ea-item-options-section { margin-bottom: 14px; }
    .ea-item-options-section label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; }
    .ea-spice-options { display: flex; flex-wrap: wrap; gap: 6px; }
    .ea-spice-btn { padding: 6px 14px; border: 1px solid #e74c3c; border-radius: 20px; background: #fff; color: #e74c3c; cursor: pointer; font-size: 0.85rem; transition: all 0.15s; }
    .ea-spice-btn:hover, .ea-spice-btn.active { background: #e74c3c; color: #fff; }
    .ea-item-notes-input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 0.85rem; resize: none; height: 60px; font-family: var(--ea-font); }
    .ea-item-options-add { width: 100%; padding: 12px; background: var(--ea-primary); color: #fff; border: none; border-radius: 10px; font-size: 0.95rem; font-weight: 600; cursor: pointer; margin-top: 8px; font-family: var(--ea-font); }
    .ea-item-options-add:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ---- Checkout ---- */
    .ea-checkout { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: #fff; z-index: 300; overflow-y: auto; }
    .ea-checkout-inner { max-width: 800px; margin: 0 auto; padding: 20px; }
    .ea-checkout-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
    .ea-back-btn { background: none; border: 1px solid #ddd; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 0.88rem; color: #555; font-family: var(--ea-font); display: flex; align-items: center; gap: 6px; }
    .ea-back-btn:hover { background: #f0f0f0; }
    .ea-checkout-grid { display: grid; grid-template-columns: 1fr 320px; gap: 24px; }
    .ea-checkout-form-section h3, .ea-checkout-summary-section h3 { font-size: 1.1rem; margin-bottom: 16px; color: #222; }
    .ea-field { margin-bottom: 14px; }
    .ea-field label { display: block; font-size: 0.85rem; font-weight: 600; color: #555; margin-bottom: 4px; }
    .ea-field input, .ea-field select, .ea-field textarea { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 0.95rem; font-family: var(--ea-font); transition: border-color 0.2s; }
    .ea-field input:focus, .ea-field select:focus, .ea-field textarea:focus { outline: none; border-color: var(--ea-primary); box-shadow: 0 0 0 3px rgba(0,0,0,0.05); }
    .ea-place-order-btn { width: 100%; padding: 14px; background: var(--ea-primary); color: #fff; border: none; border-radius: 10px; font-size: 1.05rem; font-weight: 700; cursor: pointer; font-family: var(--ea-font); margin-top: 8px; transition: opacity 0.2s; }
    .ea-place-order-btn:hover { opacity: 0.9; }
    .ea-place-order-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .ea-order-items { border: 1px solid #eee; border-radius: 10px; overflow: hidden; background: #fafafa; }
    .ea-order-item { display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #eee; font-size: 0.88rem; }
    .ea-order-item:last-child { border-bottom: none; }
    .ea-order-totals { margin-top: 12px; }

    /* ---- Payment Options ---- */
    .ea-payment-options { display: flex; flex-direction: column; gap: 8px; }
    .ea-payment-option { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 2px solid #e0e0e0; border-radius: 10px; cursor: pointer; transition: all 0.2s; background: #fff; }
    .ea-payment-option:hover { border-color: var(--ea-primary); }
    .ea-payment-option.active { border-color: var(--ea-primary); background: rgba(0,0,0,0.02); }
    .ea-payment-option input[type="radio"] { display: none; }
    .ea-payment-option i { font-size: 1.4rem; color: var(--ea-primary); flex-shrink: 0; }
    .ea-payment-option div { flex: 1; }
    .ea-payment-option strong { display: block; font-size: 0.92rem; color: #222; }
    .ea-payment-option span { font-size: 0.8rem; color: #888; }
    #ea-card-element { padding: 12px; border: 2px solid #e0e0e0; border-radius: 10px; background: #fff; min-height: 44px; transition: border-color 0.2s; }
    #ea-card-element:focus-within { border-color: var(--ea-primary); }
    #ea-card-element iframe { height: 100% !important; }
    .ea-card-errors { color: #dc3545; font-size: 0.82rem; margin-top: 4px; min-height: 18px; }
    #ea-card-container { margin-top: 4px; }

    /* ---- Confirmation ---- */
    .ea-confirmation { text-align: center; padding: 60px 20px; max-width: 500px; margin: 0 auto; }
    .ea-conf-icon { font-size: 4rem; color: #28a745; margin-bottom: 16px; }
    .ea-confirmation h2 { font-size: 1.8rem; margin-bottom: 8px; }
    .ea-conf-id { font-size: 1.1rem; color: var(--ea-primary); font-weight: 600; margin-bottom: 16px; }
    .ea-conf-time { font-size: 1rem; color: #555; margin: 8px 0; }
    .ea-conf-detail { font-size: 0.9rem; color: #777; margin-bottom: 24px; }

    /* ---- Toast ---- */
    .ea-toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #28a745; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 0.88rem; font-weight: 500; z-index: 999; box-shadow: 0 4px 16px rgba(0,0,0,0.2); animation: ea-toast-in 0.3s ease; display: flex; align-items: center; gap: 8px; }
    .ea-toast-error { background: #dc3545; }
    @keyframes ea-toast-in { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

    /* ---- Portal embed overrides ---- */
    .cp-embed-mode .cp-overlay { display: none !important; }
    .cp-embed-mode .cp-modal { position: relative !important; top: 0 !important; left: 0 !important; transform: none !important; width: 100% !important; max-width: 100% !important; height: auto !important; max-height: none !important; border-radius: 0 !important; box-shadow: none !important; animation: none !important; opacity: 1 !important; visibility: visible !important; }
    .cp-embed-mode .cp-modal-close { display: none !important; }
    .cp-embed-mode .cp-sidebar { display: none !important; }
    .cp-embed-mode .cp-dashboard { display: block !important; width: 100% !important; height: auto !important; max-height: none !important; }
    .cp-embed-mode .cp-content { width: 100% !important; max-width: 100% !important; padding: 16px !important; border-radius: 0 !important; }
    .cp-embed-mode .cp-auth-container { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    .cp-embed-mode .cp-wheel-wrapper { width: 100% !important; max-width: 280px !important; margin: 0 auto !important; }
    .pac-container { z-index: 100000 !important; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---- Responsive ---- */
    @media (max-width: 640px) {
      .ea-items-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; padding: 10px; }
      .ea-item-img { height: 120px; }
      .ea-item-img-placeholder { height: 80px; font-size: 1.5rem; }
      .ea-item-body { padding: 10px; }
      .ea-item-name { font-size: 0.9rem; }
      .ea-item-desc { font-size: 0.75rem; -webkit-line-clamp: 1; }
      .ea-item-footer { flex-direction: column; align-items: flex-start; gap: 8px; }
      .ea-add-btn { width: 100%; justify-content: center; padding: 8px 12px; }
      .ea-cat-btn { padding: 6px 14px; font-size: 0.82rem; }
      .ea-categories { padding: 12px 10px 10px; gap: 6px; }
      .ea-checkout-grid { grid-template-columns: 1fr; }
      .ea-checkout-summary-section { order: -1; }
      .ea-cart-panel { max-height: 85vh; }
      .ea-checkout-inner { padding: 14px; }
    }
    @media (max-width: 380px) {
      .ea-items-grid { grid-template-columns: 1fr; }
    }
  </style>
  <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"><\/script>
  <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js"><\/script>
  <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js"><\/script>
  <script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-functions-compat.js"><\/script>
  <script src="https://js.stripe.com/v3/"><\/script>
  <script>firebase.initializeApp(${firebaseConfig});<\/script>
</head>
<body>
  <div id="embed-root"></div>
  <script>
    var EMBED_CONFIG = ${JSON.stringify({
      restaurantId: restaurantId,
      locationId: effectiveLocationId,
      restaurantName: templateData.restaurantName,
      apiBaseUrl: templateData.apiBaseUrl,
      taxRate: templateData.taxRate,
      promoId: promoId,
      initialTab: initialTab,
      primaryColor: templateData.primaryColor,
      secondaryColor: templateData.secondaryColor,
      accentColor: templateData.accentColor,
      fontFamily: templateData.fontFamily,
      stripeKey: templateData.stripePublishableKey,
      stripeConnectedAccountId: templateData.stripeConnectedAccountId || '',
      skipPhoneVerification: templateData.skipPhoneVerification,
      hours: templateData.hours,
      deliveryEnabled: templateData.deliveryEnabled,
      deliveryTipSuggestions: templateData.deliveryTipSuggestions,
      deliveryContactlessDefault: templateData.deliveryContactlessDefault,
      googleMapsApiKey: templateData.googleMapsApiKey || ''
    }).replace(/</g, '\\u003c')};
    var PRELOADED_MENU = ${JSON.stringify(preloadedMenu).replace(/</g, '\\u003c')};
  <\/script>
  ${templateData.googleMapsApiKey ? '<script src="https://maps.googleapis.com/maps/api/js?key=' + templateData.googleMapsApiKey + '&libraries=places"><\\/script>' : ''}
  <script>${portalJs}<\/script>
  <script>${embedAppJs}<\/script>
  <script>
    var embedApp = new EmbedApp(EMBED_CONFIG);
  <\/script>
</body>
</html>`;

        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'ALLOWALL',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com https://www.gstatic.com https://*.firebaseio.com https://*.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' https: data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app wss://*.firebaseio.com https://api.stripe.com; frame-src https://js.stripe.com;",
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        });

        return res.send(embedHtml);
      }

      // ALWAYS load from local files first (they're included in the functions package and always up-to-date)
      // Only fall back to Storage if local files don't exist
      const fs = require('fs');
      const path = require('path');
      const localTemplatePath = path.join(__dirname, 'templates', templateId, 'template.html');

      let templateHtml;

      if (fs.existsSync(localTemplatePath)) {
        templateHtml = fs.readFileSync(localTemplatePath, 'utf-8');
        console.log(`Loaded template from local file: ${localTemplatePath}`);
      } else {
        // Fallback: Try to load from Firebase Storage
        console.log(`Local template not found, trying Storage: ${localTemplatePath}`);
        const bucket = admin.storage().bucket();
        const templateFile = bucket.file(`templates/${templateId}/template.html`);
        const [templateExists] = await templateFile.exists();

        if (templateExists) {
          const [content] = await templateFile.download();
          templateHtml = content.toString('utf-8');
          console.log(`Loaded template from Storage: templates/${templateId}/template.html`);
        } else {
          return res.status(500).send(`
                        <!DOCTYPE html>
                        <html><head><title>Template Not Found</title>
                        <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
                        .container{text-align:center;padding:2rem;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
                        h1{color:#e74c3c;margin-bottom:1rem;}</style></head>
                        <body><div class="container"><h1>⚠️ Template Not Found</h1><p>Template "${escapeHtml(templateId)}" needs to be uploaded to storage or added to local templates.</p></div></body></html>
                    `);
        }
      }

      // Render template with data
      const renderedHtml = renderTemplate(templateHtml, templateData);

      // Set headers — CDN edge caches for 10 min, browser for 5 min
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': isPreview ? 'no-cache' : 'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': isPreview ? 'ALLOWALL' : 'SAMEORIGIN',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com https://www.gstatic.com https://*.firebaseio.com https://*.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' https: data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app wss://*.firebaseio.com https://api.stripe.com; frame-src https://js.stripe.com;",
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });

      return res.send(renderedHtml);

    } catch (error) {
      console.error('Error serving website:', error);
      return res.status(500).send(`
                <!DOCTYPE html>
                <html><head><title>Error</title>
                <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}
                .container{text-align:center;padding:2rem;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);}
                h1{color:#e74c3c;margin-bottom:1rem;}</style></head>
                <body><div class="container"><h1>😕 Oops!</h1><p>Something went wrong. Please try again later.</p></div></body></html>
            `);
    }
  });
});

// Upload templates to storage (admin-only function)
exports.uploadTemplate = onCall(async (request) => {
  try {
    // Only platform admins can upload templates — prevents supply-chain XSS
    await verifyAdminCaller(request.auth);

    const { templateId, templateHtml } = request.data;

    if (!templateId || !templateHtml) {
      throw new HttpsError('invalid-argument', 'Template ID and HTML are required');
    }

    // Validate templateId against whitelist to prevent path traversal
    const validTemplateIds = Object.keys(TEMPLATES);
    if (!validTemplateIds.includes(templateId)) {
      throw new HttpsError('invalid-argument', `Invalid template ID. Must be one of: ${validTemplateIds.join(', ')}`);
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(`templates/${templateId}/template.html`);

    await file.save(templateHtml, {
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=3600'
      }
    });

    return { success: true, message: `Template ${templateId} uploaded successfully` };
  } catch (error) {
    console.error('Error uploading template:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

// Save website configuration
exports.saveWebsiteConfig = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { config, locationId } = request.data;
    const restaurantId = request.auth.uid;

    if (!config) {
      throw new HttpsError('invalid-argument', 'Config is required');
    }

    const db = admin.firestore();

    // Check if multi-location restaurant
    const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();
    const restaurantData = restaurantDoc.data() || {};
    const isMultiLocation = restaurantData.isMultiLocation === true;

    // Determine config path based on whether this is a location-specific website
    let configPath;
    let effectiveLocationId;

    if (isMultiLocation && locationId) {
      // Multi-location: save config under the location
      configPath = `restaurants/${restaurantId}/locations/${locationId}/website/config`;
      effectiveLocationId = locationId;
    } else {
      // Single-location: save config under restaurant
      configPath = `restaurants/${restaurantId}/website/config`;
      effectiveLocationId = restaurantId;
    }

    // Save website config with locationId
    await db.doc(configPath).set({
      ...config,
      locationId: effectiveLocationId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Generate slug
    let slug;
    if (isMultiLocation && locationId) {
      // For multi-location, use combined slug: restaurant-location
      const locationDoc = await db.doc(`restaurants/${restaurantId}/locations/${locationId}`).get();
      const locationData = locationDoc.data() || {};
      const baseSlug = restaurantData.slug || restaurantId;
      const locationSlug = locationData.slug || locationData.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || locationId;
      slug = `${baseSlug}-${locationSlug}`;

      // Save slug to location
      if (!locationData.slug) {
        await db.doc(`restaurants/${restaurantId}/locations/${locationId}`).update({
          slug: locationSlug
        });
      }
    } else {
      // Single-location slug
      if (!restaurantData.slug && config.restaurantName) {
        slug = config.restaurantName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');

        await db.doc(`restaurants/${restaurantId}`).update({ slug });
      } else {
        slug = restaurantData.slug || config.restaurantName?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || restaurantId;
      }
    }

    const locationParam = isMultiLocation && locationId ? `&locationId=${locationId}` : '';

    return {
      success: true,
      slug: slug,
      locationId: effectiveLocationId,
      websiteUrl: `${getApiBaseUrl()}/serveWebsite?restaurant=${slug}`,
      previewUrl: `${getApiBaseUrl()}/serveWebsite?restaurant=${slug}&preview=true${locationParam}`
    };
  } catch (error) {
    console.error('Error saving website config:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

// Publish website
exports.publishWebsite = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const { locationId } = request.data || {};
    const db = admin.firestore();

    // Check if multi-location restaurant
    const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();
    const restaurantData = restaurantDoc.data() || {};
    const isMultiLocation = restaurantData.isMultiLocation === true;

    // Determine config path
    let configPath;
    let slug;

    if (isMultiLocation && locationId) {
      // Multi-location: use location-specific config
      configPath = `restaurants/${restaurantId}/locations/${locationId}/website/config`;

      // Get location slug for URL
      const locationDoc = await db.doc(`restaurants/${restaurantId}/locations/${locationId}`).get();
      const locationData = locationDoc.data() || {};
      const locationSlug = locationData.slug || locationId;
      const baseSlug = restaurantData.slug || restaurantId;
      slug = `${baseSlug}-${locationSlug}`;
    } else {
      // Single-location: use restaurant-level config
      configPath = `restaurants/${restaurantId}/website/config`;
      slug = restaurantData.slug || restaurantId;
    }

    // Check if config exists, if not create it
    const configDoc = await db.doc(configPath).get();
    if (!configDoc.exists) {
      // Create the config document first
      await db.doc(configPath).set({
        isPublished: true,
        publishedAt: FieldValue.serverTimestamp(),
        template: 'modern-bistro'
      });
    } else {
      // Update existing config
      await db.doc(configPath).update({
        isPublished: true,
        publishedAt: FieldValue.serverTimestamp()
      });
    }

    return {
      success: true,
      websiteUrl: `${getApiBaseUrl()}/serveWebsite?restaurant=${slug}`,
      message: 'Website published successfully!'
    };
  } catch (error) {
    console.error('Error publishing website:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

// Serve menu data
exports.getMenu = onRequest(async (req, res) => {
  return cors(req, res, async () => {
    try {
      // Get restaurant ID and optional locationId from query parameters
      const restaurantId = req.query.restaurantId;
      const locationId = req.query.locationId;
      console.log('Getting menu for restaurant:', restaurantId, '| location:', locationId);

      if (!restaurantId) {
        console.error('No restaurant ID provided');
        return res.status(400).json({ error: 'Restaurant ID is required' });
      }

      // Check in-memory cache first (5-minute TTL)
      const cacheKey = `menu_${restaurantId}_${locationId || 'all'}`;
      const cached = cacheGet(cacheKey, 5 * 60 * 1000);
      if (cached) {
        res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
        return res.json(cached);
      }

      // Check if this is a multi-location restaurant
      const restaurantDoc = await admin.firestore().doc(`restaurants/${restaurantId}`).get();
      const isMultiLocation = restaurantDoc.exists && restaurantDoc.data()?.isMultiLocation === true;

      // Get menu categories from Firestore
      const categoriesSnapshot = await admin.firestore()
        .collection(`restaurants/${restaurantId}/menuCategories`)
        .orderBy('name')
        .get();

      const categories = [];

      // For each category, get its items
      for (const categoryDoc of categoriesSnapshot.docs) {
        const categoryData = {
          id: categoryDoc.id,
          ...categoryDoc.data(),
          items: []
        };

        // Get items for this category
        const itemsSnapshot = await admin.firestore()
          .collection(`restaurants/${restaurantId}/menuCategories/${categoryDoc.id}/items`)
          .orderBy('name')
          .get();

        itemsSnapshot.forEach(itemDoc => {
          const itemData = itemDoc.data();

          // Filter by location for multi-location restaurants
          if (isMultiLocation && locationId) {
            // If item has locations array with entries, check if current location is included
            if (itemData.locations && itemData.locations.length > 0) {
              if (!itemData.locations.includes(locationId)) {
                // Skip this item - not available at this location
                return;
              }
            }
            // If no locations array or empty, item is available at all locations
          }

          // Ensure price and discount are numbers
          categoryData.items.push({
            id: itemDoc.id,
            ...itemData,
            price: typeof itemData.price === 'number' ? itemData.price : parseFloat(itemData.price) || 0,
            discount: typeof itemData.discount === 'number' ? itemData.discount : parseFloat(itemData.discount) || 0,
            discountType: itemData.discountType || 'amount'
          });
        });

        // Only include categories that have items (after location filtering)
        if (categoryData.items.length > 0) {
          categories.push(categoryData);
        }
      }

      const result = { categories };
      cacheSet(cacheKey, result);

      // CDN edge cache: 5 min public, 5 min stale-while-revalidate
      res.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=300');
      console.log('Menu data loaded successfully:', categories.length, 'categories for location:', locationId || 'all');
      res.json(result);
    } catch (error) {
      console.error('Error serving menu:', error);
      res.status(500).json({ error: safeError(error, 'Error loading menu') });
    }
  });
});

// Handle order submissions
exports.submitOrder = onRequest({
  secrets: [doordashDeveloperId, doordashKeyId, doordashSigningSecret]
}, (request, response) => {
  cors(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
      }

      // Rate limit: 30 orders per IP per minute
      const ip = getClientIp(request);
      if (!checkRateLimit(`order_${ip}`, 30, 60000)) {
        return response.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      // Reject oversized payloads (100KB max)
      const bodySize = JSON.stringify(request.body || '').length;
      if (bodySize > 102400) {
        return response.status(413).json({ error: 'Request payload too large' });
      }

      const orderData = request.body;
      console.log('Received order data:', {
        restaurantId: orderData.restaurantId,
        itemCount: orderData.items?.length,
        serviceType: orderData.serviceType,
        paymentMethod: orderData.paymentMethod,
        hasCustomer: !!orderData.customer,
      });

      // Validate required fields
      if (!orderData.restaurantId || !orderData.customer || !orderData.items || orderData.items.length === 0) {
        console.error('Missing required fields:', {
          hasRestaurantId: !!orderData.restaurantId,
          hasCustomer: !!orderData.customer,
          hasItems: !!orderData.items,
          itemsLength: orderData.items?.length
        });
        return response.status(400).json({ error: 'Missing required order data' });
      }

      // Generate order number (cryptographically random)
      const crypto = require('crypto');
      const orderNumber = `${Date.now()}-${crypto.randomInt(100000, 999999)}`;

      const db = admin.firestore();

      // Server-side price verification: use cached menu data (same cache as getMenu)
      // to verify prices without N×M Firestore reads per order.
      // Cache TTL is 5 minutes — same window customers see, so prices always match.
      let verifiedSubtotal = 0;
      const menuCacheKey = `menu_${orderData.restaurantId}_${orderData.locationId || 'all'}`;
      let menuData = cacheGet(menuCacheKey, 5 * 60 * 1000);
      if (!menuData) {
        // Cache miss — load full menu once (same as getMenu)
        const menuBasePath = `restaurants/${orderData.restaurantId}/menuCategories`;
        const catSnap = await db.collection(menuBasePath).orderBy('name').get();
        const categories = [];
        for (const catDoc of catSnap.docs) {
          const catData = { id: catDoc.id, ...catDoc.data(), items: [] };
          const itemSnap = await db.collection(`${menuBasePath}/${catDoc.id}/items`).orderBy('name').get();
          itemSnap.forEach(itemDoc => {
            const itemData = itemDoc.data();
            catData.items.push({
              id: itemDoc.id,
              ...itemData,
              price: typeof itemData.price === 'number' ? itemData.price : parseFloat(itemData.price) || 0,
              discount: typeof itemData.discount === 'number' ? itemData.discount : parseFloat(itemData.discount) || 0,
              discountType: itemData.discountType || 'amount'
            });
          });
          if (catData.items.length > 0) categories.push(catData);
        }
        menuData = { categories };
        cacheSet(menuCacheKey, menuData);
      }

      // Build item lookup map from cached menu
      const itemMap = {};
      for (const cat of menuData.categories) {
        for (const item of cat.items) {
          itemMap[item.id] = item;
        }
      }

      for (const item of orderData.items) {
        if (!item.id || !item.quantity || item.quantity < 1) continue;
        const foundItem = itemMap[item.id];
        if (foundItem) {
          let price = foundItem.price || 0;
          // Apply discount from menu item if present
          if (foundItem.discount && foundItem.discount > 0) {
            price = foundItem.discountType === 'percentage'
              ? price * (1 - foundItem.discount / 100)
              : price - foundItem.discount;
          }
          price = Math.max(0, price);
          verifiedSubtotal += price * item.quantity;
        } else {
          // Item not found — use client price but flag it
          verifiedSubtotal += (item.finalPrice || item.price || 0) * (item.quantity || 1);
        }
      }
      verifiedSubtotal = Math.round(verifiedSubtotal * 100) / 100;

      // Use server-verified subtotal (ignore client-sent subtotal)
      const subtotal = verifiedSubtotal;

      // Server-side tax rate: read from restaurant/location config, never trust client
      const restaurantDoc = await db.doc(`restaurants/${orderData.restaurantId}`).get();
      const restaurantConfig = restaurantDoc.exists ? restaurantDoc.data() : {};
      let taxRate = restaurantConfig.taxRate !== undefined ? restaurantConfig.taxRate : 8;
      // If multi-location, check location-specific tax rate
      if (orderData.locationId && orderData.locationId !== orderData.restaurantId) {
        const locationDoc = await db.doc(`restaurants/${orderData.restaurantId}/locations/${orderData.locationId}`).get();
        if (locationDoc.exists && locationDoc.data().taxRate !== undefined) {
          taxRate = locationDoc.data().taxRate;
        }
      }

      // Validate and apply promo code if provided
      // Uses a Firestore transaction to atomically check + claim the promo,
      // preventing double-redemption from concurrent requests.
      let promoDiscount = 0;
      let promoValidation = null;
      if (orderData.promoCode) {
        promoValidation = await validatePromoInternal(db, orderData.restaurantId, orderData.promoCode, subtotal);
        if (promoValidation.valid && promoValidation.claimId) {
          // Atomically claim the promo to prevent race conditions
          const claimRef = db.doc(`restaurants/${orderData.restaurantId}/promotionClaims/${promoValidation.claimId}`);
          try {
            await db.runTransaction(async (txn) => {
              const claimSnap = await txn.get(claimRef);
              if (!claimSnap.exists || claimSnap.data().used === true) {
                throw new Error('Promo already used');
              }
              txn.update(claimRef, {
                used: true,
                usedAt: FieldValue.serverTimestamp(),
                usedInOrder: 'pending' // will be updated after order creation
              });
            });
            // Promo atomically claimed — calculate discount
            if (promoValidation.discountUnit === 'percentage') {
              promoDiscount = subtotal * (promoValidation.discountValue / 100);
            } else {
              promoDiscount = promoValidation.discountValue;
            }
            promoDiscount = Math.min(promoDiscount, subtotal);
            promoDiscount = Math.round(promoDiscount * 100) / 100;
          } catch (txnErr) {
            console.warn('Promo claim transaction failed (likely concurrent use):', txnErr.message);
            promoValidation = { valid: false, reason: 'Promo code was just used by another order' };
          }
        }
      }

      // Handle loyalty points redemption
      let pointsDiscount = 0;
      let pointsRedeemed = 0;
      if (orderData.pointsToRedeem && orderData.customerId) {
        try {
          // Load rewards config for redemption rate
          const configDoc = await db.doc(`restaurants/${orderData.restaurantId}/rewardsConfig/settings`).get();
          const rc = configDoc.exists ? configDoc.data() : { loyalty: { redemptionRate: 100, minRedeemPoints: 100 } };
          const redemptionRate = rc.loyalty?.redemptionRate || 100;
          const minRedeem = rc.loyalty?.minRedeemPoints || 100;

          // Verify customer has enough points
          const customerRef = db.doc(`restaurants/${orderData.restaurantId}/customers/${orderData.customerId}`);
          const customerSnap = await customerRef.get();
          const availablePoints = customerSnap.exists ? (customerSnap.data().rewardPoints || 0) : 0;

          const requestedPoints = Math.min(parseInt(orderData.pointsToRedeem) || 0, availablePoints);
          if (requestedPoints >= minRedeem) {
            pointsRedeemed = requestedPoints;
            pointsDiscount = Math.round((pointsRedeemed / redemptionRate) * 100) / 100;
            pointsDiscount = Math.min(pointsDiscount, subtotal - promoDiscount); // Don't exceed remaining
          }
        } catch (ptsErr) {
          console.error('Error processing points redemption:', ptsErr);
        }
      }

      // Handle spin reward redemption
      let rewardDiscount = 0;
      let redeemedRewardId = null;
      if (orderData.rewardId && orderData.customerId) {
        try {
          const rewardDoc = await db.doc(`restaurants/${orderData.restaurantId}/customerRewards/${orderData.rewardId}`).get();
          if (rewardDoc.exists) {
            const reward = rewardDoc.data();
            if (reward.userId === orderData.customerId && !reward.used) {
              const expiresAt = reward.expiresAt?.toDate ? reward.expiresAt.toDate() : new Date(reward.expiresAt);
              if (expiresAt > new Date()) {
                redeemedRewardId = orderData.rewardId;
                if (reward.prizeType === 'discount') {
                  rewardDiscount = subtotal * (reward.prizeValue / 100);
                } else if (reward.prizeType === 'flatDiscount') {
                  rewardDiscount = reward.prizeValue;
                }
                rewardDiscount = Math.min(rewardDiscount, subtotal - promoDiscount - pointsDiscount);
                rewardDiscount = Math.round(rewardDiscount * 100) / 100;
              }
            }
          }
        } catch (rwErr) {
          console.error('Error processing reward redemption:', rwErr);
        }
      }

      // Server-side total calculation (prevents client tampering)
      const totalDiscount = promoDiscount + pointsDiscount + rewardDiscount;
      const discountedSubtotal = subtotal - totalDiscount;
      const serverTax = Math.round(discountedSubtotal * (taxRate / 100) * 100) / 100;
      // For delivery orders, add delivery fee + driver tip to total
      const deliveryFee = orderData.orderType === 'delivery' ? (parseFloat(orderData.deliveryFee) || 0) : 0;
      const driverTip = orderData.orderType === 'delivery' ? (parseFloat(orderData.driverTip) || 0) : 0;
      const serverTotal = Math.round((discountedSubtotal + serverTax + deliveryFee + driverTip) * 100) / 100;

      // Load rewards config for points calculation
      let pointsPerDollar = 1;
      try {
        const configDoc = await db.doc(`restaurants/${orderData.restaurantId}/rewardsConfig/settings`).get();
        if (configDoc.exists && configDoc.data().loyalty?.pointsPerDollar) {
          pointsPerDollar = configDoc.data().loyalty.pointsPerDollar;
        }
      } catch (e) { /* use default */ }

      // Calculate loyalty points earned
      const loyaltyPointsEarned = Math.floor(serverTotal * pointsPerDollar);

      // For delivery orders, accept the DoorDash quote BEFORE creating the order.
      // This prevents orphaned orders when quotes have expired.
      let doordashData = null;
      let trackingUrl = null;
      if (orderData.orderType === 'delivery' && orderData.doordashQuoteId) {
        const doordash = getDoordash();
        // Format phone to E.164 for DoorDash
        let dropoffPhone = (orderData.customer.phone || '').trim();
        if (dropoffPhone) {
          const digits = dropoffPhone.replace(/\D/g, '');
          if (digits.length === 10) dropoffPhone = '+1' + digits;
          else if (digits.length === 11 && digits.startsWith('1')) dropoffPhone = '+' + digits;
          else if (!dropoffPhone.startsWith('+')) dropoffPhone = '+1' + digits;
        }

        const acceptOptions = {
          tip: Math.round(driverTip * 100),
          dropoffPhone,
          contactlessDropoff: orderData.contactlessDelivery || false,
          dropoffInstructions: orderData.deliveryInstructions || '',
        };

        try {
          const acceptResult = await doordash.acceptQuote(orderData.doordashQuoteId, acceptOptions);
          doordashData = doordash.buildOrderDoordashData(acceptResult, {
            externalDeliveryId: orderData.doordashQuoteId,
            fee: Math.round(deliveryFee * 100),
            tip: Math.round(driverTip * 100),
          });
          trackingUrl = doordashData.trackingUrl;
          console.log(`DoorDash quote accepted: ${orderData.doordashQuoteId}, tracking: ${trackingUrl}`);
        } catch (ddErr) {
          const isQuoteExpired = ddErr.status === 400 &&
            (ddErr.doordashError?.field_errors?.some(e => e.field === 'external_delivery_id') ||
             ddErr.message?.toLowerCase().includes('expired') ||
             ddErr.message?.toLowerCase().includes('quote'));

          if (isQuoteExpired) {
            // Auto re-quote: fetch a fresh quote and accept it
            console.log(`Quote expired (${orderData.doordashQuoteId}), attempting auto re-quote...`);
            try {
              const restaurantDoc = await db.doc(`restaurants/${orderData.restaurantId}`).get();
              const restData = restaurantDoc.data();
              let pickupAddress = restData.address || '';
              let pickupPhone = restData.phone || '';
              let pickupName = restData.name || 'Restaurant';
              let pickupInstructions = restData.deliverySettings?.pickupInstructions || '';

              if (orderData.locationId && orderData.locationId !== orderData.restaurantId) {
                const locDoc = await db.doc(`restaurants/${orderData.restaurantId}/locations/${orderData.locationId}`).get();
                if (locDoc.exists) {
                  const locData = locDoc.data();
                  pickupAddress = locData.address || pickupAddress;
                  pickupPhone = locData.phone || pickupPhone;
                  pickupName = locData.name || pickupName;
                }
              }

              // Format pickup phone
              const pDigits = pickupPhone.replace(/\D/g, '');
              const fmtPickupPhone = pDigits.length === 10 ? `+1${pDigits}` : pDigits.length === 11 && pDigits.startsWith('1') ? `+${pDigits}` : pickupPhone;

              const newQuoteId = doordash.generateExternalDeliveryId(orderData.restaurantId);
              const nameParts = (orderData.customer.name || '').split(' ');

              const newQuote = await doordash.getQuote({
                externalDeliveryId: newQuoteId,
                pickupAddress,
                pickupPhone: fmtPickupPhone || dropoffPhone,
                pickupBusinessName: pickupName,
                pickupInstructions,
                dropoffAddress: orderData.deliveryAddress?.fullAddress || '',
                dropoffPhone,
                dropoffContactGivenName: nameParts[0] || '',
                dropoffContactFamilyName: nameParts.slice(1).join(' ') || '',
                orderValue: Math.round(serverTotal * 100),
              });

              // Check fee threshold: accept if new fee is within 20% of original
              const originalFeeCents = Math.round(deliveryFee * 100);
              const newFeeCents = newQuote.fee || 0;
              const feeThreshold = originalFeeCents * 1.2;

              if (newFeeCents > feeThreshold && originalFeeCents > 0) {
                console.log(`Re-quote fee too high: ${newFeeCents} vs original ${originalFeeCents} (threshold: ${feeThreshold})`);
                return response.status(400).json({
                  error: 'quote_expired',
                  message: 'Delivery quote expired and the new delivery fee is higher. Please refresh your quote.',
                  newFee: newFeeCents,
                  newFeeFormatted: `$${(newFeeCents / 100).toFixed(2)}`,
                });
              }

              const acceptResult = await doordash.acceptQuote(newQuoteId, acceptOptions);
              doordashData = doordash.buildOrderDoordashData(acceptResult, {
                externalDeliveryId: newQuoteId,
                fee: newFeeCents,
                tip: Math.round(driverTip * 100),
              });
              trackingUrl = doordashData.trackingUrl;
              // Update delivery fee if it changed
              if (newFeeCents !== originalFeeCents) {
                deliveryFee = newFeeCents / 100;
              }
              console.log(`Auto re-quote succeeded: ${newQuoteId}, fee: ${newFeeCents}, tracking: ${trackingUrl}`);
            } catch (reQuoteErr) {
              console.error('Auto re-quote failed:', reQuoteErr.message);
              return response.status(400).json({
                error: 'quote_expired',
                message: 'Delivery quote expired. Please go back and refresh your delivery quote.',
              });
            }
          } else {
            // Non-quote-expiry DoorDash error — fail without creating order
            console.error('DoorDash acceptance failed:', ddErr.message, JSON.stringify(ddErr.doordashError, null, 2));
            return response.status(500).json({
              error: 'delivery_failed',
              message: 'Failed to arrange delivery. Please try again.',
            });
          }
        }
      }

      // Recalculate total if delivery fee changed during re-quote
      const finalTotal = orderData.orderType === 'delivery'
        ? Math.round((discountedSubtotal + serverTax + deliveryFee + driverTip) * 100) / 100
        : serverTotal;

      // ── Server-side order limit enforcement ──
      // Read limits from platformConfig (admin-configured) and the restaurant's current usage.
      const restaurantRef = db.doc(`restaurants/${orderData.restaurantId}`);
      const restaurantSnap = await restaurantRef.get();
      const restaurantData = restaurantSnap.exists ? restaurantSnap.data() : {};
      const tier = restaurantData.subscription?.tier || 'ally';

      // Read admin-configured limits
      const platformConfigSnap = await db.doc('platformConfig/current').get();
      const platformLimits = platformConfigSnap.exists && platformConfigSnap.data().orderLimits
        ? platformConfigSnap.data().orderLimits
        : { scout: { limit: 75, hardCap: true }, ally: { limit: 500 }, guide: { limit: 2000 }, chief: { limit: 5000 }, elder: { limit: Infinity } };
      const tierLimits = platformLimits[tier] || platformLimits.ally;

      if (tierLimits.limit !== Infinity) {
        const usage = restaurantData.orderUsage || {};
        const currentCount = usage.currentPeriodCount || 0;

        // Check if billing period has elapsed
        const periodEnd = usage.currentPeriodEnd ? new Date(usage.currentPeriodEnd) : new Date(0);
        const now = new Date();
        const isCurrentPeriod = now <= periodEnd;

        const effectiveCount = isCurrentPeriod ? currentCount : 0;

        if (tierLimits.hardCap && effectiveCount >= tierLimits.limit) {
          return response.status(403).json({
            error: 'order_limit_reached',
            message: `This restaurant has reached its ${tierLimits.limit} order limit for this billing period.`,
          });
        }

        // Track overage for non-hard-capped tiers
        const newCount = effectiveCount + 1;
        const isOverage = newCount > tierLimits.limit;
        const overageRate = tierLimits.overageRate || 0;
        const overageCharge = isOverage ? finalTotal * overageRate : 0;

        // Update usage atomically
        const usageUpdate = {
          'orderUsage.currentPeriodCount': isCurrentPeriod ? admin.firestore.FieldValue.increment(1) : 1,
          'orderUsage.lastUpdated': now.toISOString(),
        };
        if (!isCurrentPeriod) {
          // Reset period
          const billingCycle = restaurantData.subscription?.billingCycle || 'monthly';
          const newEnd = new Date(now);
          if (billingCycle === 'annual') newEnd.setFullYear(newEnd.getFullYear() + 1);
          else if (billingCycle === 'quarterly') newEnd.setMonth(newEnd.getMonth() + 3);
          else newEnd.setMonth(newEnd.getMonth() + 1);

          usageUpdate['orderUsage.currentPeriodStart'] = now.toISOString();
          usageUpdate['orderUsage.currentPeriodEnd'] = newEnd.toISOString();
          usageUpdate['orderUsage.overageOrders'] = 0;
          usageUpdate['orderUsage.overageCharges'] = 0;
        }
        if (isOverage && overageCharge > 0) {
          usageUpdate['orderUsage.overageOrders'] = admin.firestore.FieldValue.increment(1);
          usageUpdate['orderUsage.overageCharges'] = admin.firestore.FieldValue.increment(overageCharge);
        }
        await restaurantRef.update(usageUpdate);
      }

      // Create the order document
      // For website orders, locationId defaults to restaurantId (single location setup)
      // orderType: 'pickup' or 'delivery' from website, 'dine_in' from POS
      const orderDoc = {
        orderNumber,
        restaurantId: orderData.restaurantId,
        locationId: orderData.locationId || orderData.restaurantId,
        customerId: orderData.customerId || null,
        customer: orderData.customer,
        items: orderData.items,
        subtotal: subtotal,
        tax: serverTax,
        taxRate: taxRate,
        total: finalTotal,
        promoCode: promoValidation?.valid ? orderData.promoCode : null,
        promotionId: promoValidation?.valid ? promoValidation.promotionId : null,
        promoDiscount: promoDiscount,
        promoType: promoValidation?.valid ? promoValidation.type : null,
        pointsRedeemed: pointsRedeemed || 0,
        pointsDiscount: pointsDiscount || 0,
        rewardId: redeemedRewardId || null,
        rewardDiscount: rewardDiscount || 0,
        loyaltyPointsEarned,
        pickupTime: orderData.pickupTime,
        orderType: orderData.orderType || 'pickup',
        paymentMethod: orderData.paymentMethod,
        paymentDetails: orderData.paymentDetails || null,
        source: orderData.source || 'website',
        status: 'new',
        createdAt: FieldValue.serverTimestamp(),
        ...(orderData.orderType === 'delivery' ? {
          deliveryAddress: orderData.deliveryAddress || null,
          deliveryInstructions: orderData.deliveryInstructions || '',
          contactlessDelivery: orderData.contactlessDelivery || false,
          deliveryFee: deliveryFee,
          driverTip: driverTip,
          ...(doordashData ? { doordash: doordashData } : {}),
        } : {})
      };

      // Save order to Firestore
      await db.collection('orders').doc(orderNumber).set(orderDoc);
      await db.collection(`restaurants/${orderData.restaurantId}/orders`).doc(orderNumber).set(orderDoc);

      // Update promo claim with final order number (claim already atomically reserved above)
      if (promoValidation?.valid && promoValidation.claimId) {
        try {
          await db.doc(`restaurants/${orderData.restaurantId}/promotionClaims/${promoValidation.claimId}`).update({
            usedInOrder: orderNumber
          });
          console.log(`Linked promo claim ${promoValidation.claimId} to order ${orderNumber}`);
        } catch (promoErr) {
          console.error('Error linking promo claim to order:', promoErr);
        }
      }

      // Deduct redeemed points from customer
      if (pointsRedeemed > 0 && orderData.customerId) {
        try {
          await db.doc(`restaurants/${orderData.restaurantId}/customers/${orderData.customerId}`).update({
            rewardPoints: FieldValue.increment(-pointsRedeemed)
          });
          console.log(`Deducted ${pointsRedeemed} points from customer ${orderData.customerId}`);
        } catch (ptsErr) {
          console.error('Error deducting points:', ptsErr);
        }
      }

      // Mark spin reward as used
      if (redeemedRewardId) {
        try {
          await db.doc(`restaurants/${orderData.restaurantId}/customerRewards/${redeemedRewardId}`).update({
            used: true,
            usedAt: FieldValue.serverTimestamp(),
            usedInOrder: orderNumber
          });
          console.log(`Marked reward ${redeemedRewardId} as used in order ${orderNumber}`);
        } catch (rwErr) {
          console.error('Error marking reward as used:', rwErr);
        }
      }

      // Update customer loyalty points if authenticated
      if (orderData.customerId) {
        try {
          const customerRef = admin.firestore()
            .doc(`restaurants/${orderData.restaurantId}/customers/${orderData.customerId}`);

          const customerDoc = await customerRef.get();

          if (customerDoc.exists) {
            // Update existing customer
            await customerRef.update({
              rewardPoints: FieldValue.increment(loyaltyPointsEarned),
              totalOrders: FieldValue.increment(1),
              lastOrderAt: FieldValue.serverTimestamp()
            });
            console.log(`Updated customer ${orderData.customerId} with ${loyaltyPointsEarned} points`);
          } else {
            // Create customer document if it doesn't exist
            await customerRef.set({
              email: orderData.customer.email,
              fullName: orderData.customer.name,
              phone: orderData.customer.phone || '',
              rewardPoints: loyaltyPointsEarned + 100, // Welcome bonus + order points
              totalOrders: 1,
              tier: 'Bronze',
              memberSince: new Date().toISOString().split('T')[0],
              lastOrderAt: FieldValue.serverTimestamp(),
              createdAt: FieldValue.serverTimestamp()
            });
            console.log(`Created new customer ${orderData.customerId} with ${loyaltyPointsEarned + 100} points (including welcome bonus)`);
          }
        } catch (customerError) {
          // Log but don't fail the order if customer update fails
          console.error('Error updating customer loyalty:', customerError);
        }
      }

      // Return success with order ID and points earned
      const successResponse = {
        success: true,
        orderId: orderNumber,
        loyaltyPointsEarned,
        message: 'Order submitted successfully'
      };
      if (trackingUrl) {
        successResponse.trackingUrl = trackingUrl;
      }
      response.json(successResponse);
    } catch (error) {
      console.error('Error submitting order:', error);
      response.status(500).json({ error: safeError(error, 'Failed to submit order') });
    }
  });
});


exports.updateWebsite = onCall(async (request) => {
  try {
    // Check if user is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const { html, restaurantId, slug } = request.data;

    // Verify request data
    if (!html || !restaurantId || uid !== restaurantId) {
      throw new HttpsError('invalid-argument', 'Invalid request data');
    }

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(`websites/${restaurantId}/index.html`);

    await file.save(html, {
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=300',
        customMetadata: {
          restaurantId: restaurantId,
          slug: slug || restaurantId
        }
      }
    });

    // Make the file publicly readable
    await file.makePublic();

    const websiteUrl = slug
      ? `${getApiBaseUrl()}/serveWebsite?restaurant=${slug}`
      : `${getApiBaseUrl()}/serveWebsite?restaurant=${restaurantId}`;

    return {
      success: true,
      websiteUrl: websiteUrl,
      message: 'Website updated successfully'
    };
  } catch (error) {
    console.error('Error in updateWebsite:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

// ============================================
// AI CONTENT GENERATION FUNCTIONS
// ============================================

// Gemini API key - set via Firebase Secrets or .env file
const geminiApiKeySecret = defineSecret('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Business Listings API keys
const yelpApiKeySecret = defineSecret('YELP_API_KEY');
const googleBusinessClientId = defineSecret('GOOGLE_BUSINESS_CLIENT_ID');
const googleBusinessClientSecret = defineSecret('GOOGLE_BUSINESS_CLIENT_SECRET');

// Twitter/X API keys (OAuth 2.0 with PKCE)
const twitterClientId = defineSecret('TWITTER_CLIENT_ID');
const twitterClientSecret = defineSecret('TWITTER_CLIENT_SECRET');

// Helper to get Gemini API key (from secret or env)
function getGeminiApiKey() {
  return geminiApiKeySecret.value() || process.env.GEMINI_API_KEY || '';
}

/**
 * Helper function to call Gemini API
 */
async function callGeminiAPI(prompt) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY environment variable.');
  }

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return response.data.candidates[0].content.parts[0].text;
    }
    throw new Error('Invalid response from Gemini API');
  } catch (error) {
    console.error('Gemini API error:', error.response?.data || error.message);
    throw new Error('Failed to generate content: ' + (error.response?.data?.error?.message || error.message));
  }
}

/**
 * Generate default steps for common SEO actions when AI doesn't provide them
 */
function generateDefaultSteps(actionText) {
  const actionLower = actionText.toLowerCase();

  if (actionLower.includes('google business') || actionLower.includes('google my business') || actionLower.includes('gbp')) {
    return [
      'Go to google.com/business and sign in with your Gmail account',
      'Search for your restaurant name to check if a listing already exists',
      'If found, click "Claim this business" and follow the verification steps',
      'If not found, click "Add your business to Google"',
      'Enter your business name and complete address',
      'Add your phone number and website URL',
      'Select "Restaurant" as your primary category',
      'Add your business hours and upload photos'
    ];
  }

  if (actionLower.includes('photo') || actionLower.includes('image')) {
    return [
      'Take photos during good natural lighting (near windows or outdoors)',
      'Use your smartphone camera in landscape/horizontal mode',
      'Photograph your top 5 most popular dishes from a 45-degree angle',
      'Take a clear photo of your restaurant exterior showing the signage',
      'Capture your dining area when it is clean and well-lit',
      'Upload photos to Google Business, Facebook, Instagram, and your website'
    ];
  }

  if (actionLower.includes('review') || actionLower.includes('respond')) {
    return [
      'Log into your Google Business Profile at business.google.com',
      'Click on "Reviews" in the left menu',
      'Read each review carefully before responding',
      'For positive reviews: Thank the customer and mention something specific they said',
      'For negative reviews: Apologize sincerely, offer to make it right, and provide your contact',
      'Respond within 24-48 hours for best results',
      'Always stay professional - never argue or get defensive'
    ];
  }

  if (actionLower.includes('social media') || actionLower.includes('facebook') || actionLower.includes('instagram')) {
    return [
      'Choose 2-3 social platforms to focus on (Facebook and Instagram recommended)',
      'Create a business account if you do not have one already',
      'Add your restaurant name, address, phone, and website to your bio',
      'Upload your logo as profile picture and a food photo as cover',
      'Post at least 3 times per week - food photos, specials, behind-the-scenes',
      'Respond to comments and messages within a few hours',
      'Use relevant hashtags like #restaurantname #cityname #foodie'
    ];
  }

  if (actionLower.includes('website') || actionLower.includes('menu online')) {
    return [
      'Make sure your menu is available on your website (not just a PDF)',
      'Add your address and phone number on every page',
      'Include a "Contact" or "Location" page with Google Maps embed',
      'Add high-quality photos of your food and restaurant',
      'Make sure your website works well on mobile phones',
      'Add online ordering if available'
    ];
  }

  // Default generic steps
  return [
    'Research what this task involves and why it is important',
    'Set aside 30 minutes to complete this task',
    'Gather any information or photos you might need',
    'Follow any official guides or tutorials available online',
    'Test your changes to make sure everything looks correct',
    'Make a note to review and update periodically'
  ];
}

/**
 * Generate AI-powered social media content
 */
exports.generateAIContent = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { type, platform, tone, context, businessContext } = request.data;

    // Build the prompt based on content type
    let prompt = `You are a social media expert for restaurants. Generate a ${platform} post for a restaurant.

Restaurant Name: ${context.restaurantName || 'Our Restaurant'}
Cuisine Type: ${context.cuisineType || 'Restaurant'}
`;

    // Enrich prompt with business listings data when available
    if (businessContext) {
      prompt += `\nBusiness Insights (use these to create more impactful content):`;
      if (businessContext.avgRating) prompt += `\n- Average Rating: ${businessContext.avgRating}/5 across review platforms`;
      if (businessContext.totalReviews) prompt += `\n- Total Reviews: ${businessContext.totalReviews}`;
      if (businessContext.topPraises) prompt += `\n- What customers love: ${businessContext.topPraises}`;
      if (businessContext.commonComplaints) prompt += `\n- Areas to address: ${businessContext.commonComplaints}`;
      if (businessContext.recentKeywords) prompt += `\n- Trending keywords from reviews: ${businessContext.recentKeywords}`;
      prompt += `\nLeverage these insights to create content that highlights strengths and addresses customer sentiment.\n`;
    }

    switch (type) {
      case 'menu_feature':
        prompt += `
Create a post featuring this menu item:
- Item Name: ${context.menuItem?.name || 'Today\'s Special'}
- Description: ${context.menuItem?.description || 'A delicious dish'}
- Price: ${context.menuItem?.price ? '$' + context.menuItem.price : ''}

Make it appetizing and enticing. Include a call to action to visit or order.`;
        break;

      case 'promotion':
        prompt += `
Create a promotional post for:
- Promotion: ${context.promotionDetails || 'Special offer'}
- Discount/Offer: ${context.discount || 'Limited time offer'}
- Valid Until: ${context.validUntil || 'While supplies last'}

Make it urgent and compelling with a clear call to action.`;
        break;

      case 'event':
        prompt += `
Create a post announcing:
- Event: ${context.eventName || 'Special Event'}
- Date: ${context.eventDate || 'Coming Soon'}
- Details: ${context.eventDetails || 'Join us for a special experience'}

Make it exciting and encourage RSVPs or reservations.`;
        break;

      case 'engagement':
        prompt += `
Create an engaging post that encourages interaction.
Theme: ${context.theme || 'general'}
Goal: Get customers to comment, like, or share.

Ideas: Ask a question, run a poll, share a fun fact about the restaurant/food, or create a conversation starter.`;
        break;

      case 'behind_scenes':
        prompt += `
Create a behind-the-scenes post showing the human side of the restaurant.
Focus on: ${context.focus || 'kitchen, team, preparation'}

Make it personal and authentic.`;
        break;

      default:
        prompt += `
Create a general promotional post that:
- Highlights the restaurant's unique value
- Encourages visits or online orders
- Creates a sense of community`;
    }

    prompt += `

Tone: ${tone || 'friendly and professional'}
Platform: ${platform}
${platform === 'twitter' ? 'Keep it under 280 characters.' : ''}
${platform === 'instagram' ? 'Make it visually descriptive and include line breaks for readability.' : ''}

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "caption": "The main post text here",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"],
  "callToAction": "A clear call to action",
  "bestPostTime": "Suggested best time to post (e.g., '6:00 PM - Dinner rush')",
  "alternativeVersions": ["A shorter version", "A more casual version"]
}`;

    const result = await callGeminiAPI(prompt);

    // Try to parse as JSON, with fallback
    try {
      // Extract JSON from the response (it might be wrapped in markdown code blocks)
      let jsonStr = result;
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      const parsed = JSON.parse(jsonStr.trim());
      return { success: true, content: parsed };
    } catch (parseError) {
      // If parsing fails, return the raw text as caption
      return {
        success: true,
        content: {
          caption: result,
          hashtags: [],
          callToAction: '',
          bestPostTime: '',
          alternativeVersions: []
        }
      };
    }
  } catch (error) {
    console.error('Error generating AI content:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Improve existing content
 */
exports.improveAIContent = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { content, instruction } = request.data;

    const instructionPrompts = {
      'make_shorter': 'Make this social media post shorter and more concise while keeping the main message:',
      'make_longer': 'Expand this social media post with more details and engaging content:',
      'more_engaging': 'Rewrite this post to be more engaging and attention-grabbing:',
      'add_emojis': 'Add appropriate emojis to make this post more visually appealing:',
      'more_professional': 'Rewrite this post in a more professional and polished tone:',
      'more_casual': 'Rewrite this post in a casual, friendly, conversational tone:',
      'add_urgency': 'Rewrite this post to create a sense of urgency and FOMO:',
      'add_humor': 'Add some light humor or wit to this post while keeping it professional:'
    };

    const prompt = `${instructionPrompts[instruction] || 'Improve this social media post:'}

Original post:
"${content}"

Return ONLY the improved post text, nothing else.`;

    const result = await callGeminiAPI(prompt);

    return { success: true, improvedContent: result.trim().replace(/^["']|["']$/g, '') };
  } catch (error) {
    console.error('Error improving content:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Generate hashtag suggestions
 */
exports.generateHashtags = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { content, platform, count = 10 } = request.data;

    const prompt = `Generate ${count} highly relevant hashtags for this ${platform} post about a restaurant:

"${content}"

Requirements:
- Mix of popular and niche hashtags
- Include location-based hashtags if mentioned
- Include food/cuisine specific hashtags
- Include trending restaurant hashtags
- For Instagram: include some hashtags with high engagement
- For Twitter: keep hashtags shorter

Return ONLY a JSON array of hashtags (without the # symbol), like this:
["foodie", "restaurant", "delicious"]`;

    const result = await callGeminiAPI(prompt);

    // Parse the result
    try {
      let jsonStr = result;
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      // Also try to find just the array
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }
      const hashtags = JSON.parse(jsonStr.trim());
      return { success: true, hashtags };
    } catch (parseError) {
      // Fallback: extract words that look like hashtags
      const words = result.match(/\b\w+\b/g) || [];
      return { success: true, hashtags: words.slice(0, count) };
    }
  } catch (error) {
    console.error('Error generating hashtags:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Get SEO recommendations for the restaurant
 */
exports.getSeoRecommendations = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { restaurantData } = request.data;

    const prompt = `As an SEO expert for local restaurants, analyze this restaurant's online presence and provide actionable recommendations.

IMPORTANT: Your audience is restaurant owners who are NOT tech-savvy. For each action, provide DETAILED step-by-step instructions that anyone can follow.

Restaurant Information:
- Name: ${restaurantData.name || 'Not provided'}
- Location: ${restaurantData.address || 'Not provided'}
- Cuisine Type: ${restaurantData.cuisineType || 'Not provided'}
- Website: ${restaurantData.websiteUrl ? 'Yes' : 'No'}
- Online Ordering: ${restaurantData.hasOnlineOrdering ? 'Yes' : 'No'}
- Social Media Connected: ${restaurantData.socialMedia || 'Not specified'}

Provide a comprehensive SEO analysis with:
1. Local SEO score (0-100)
2. Top 5 immediate actions to improve visibility - INCLUDE DETAILED STEP-BY-STEP INSTRUCTIONS
3. Keyword recommendations for their cuisine/location
4. Google Business Profile optimization tips
5. Content ideas for better search rankings
6. Common mistakes to avoid

Return as JSON:
{
  "seoScore": 75,
  "grade": "B",
  "immediateActions": [
    {
      "priority": "high",
      "action": "Complete your Google Business Profile",
      "impact": "Can increase visibility by 50%",
      "steps": [
        "Step 1: Go to google.com/business and sign in with your Gmail account",
        "Step 2: Search for your restaurant name - if it exists, claim it; if not, click 'Add your business'",
        "Step 3: Enter your restaurant's full address exactly as it appears on your storefront",
        "Step 4: Add your phone number and website URL",
        "Step 5: Select your primary category as 'Restaurant' and add secondary categories like your cuisine type",
        "Step 6: Add your business hours including special holiday hours",
        "Step 7: Upload at least 10 high-quality photos of your food, interior, and exterior"
      ]
    }
  ],
  "keywords": ["keyword1", "keyword2"],
  "googleBusinessTips": ["tip1", "tip2"],
  "contentIdeas": ["idea1", "idea2"],
  "mistakesToAvoid": ["mistake1", "mistake2"],
  "monthlyChecklist": ["task1", "task2"]
}`;

    const result = await callGeminiAPI(prompt);

    try {
      let jsonStr = result;
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      const parsed = JSON.parse(jsonStr.trim());

      // Ensure each action has steps - add default steps if missing
      if (parsed.immediateActions) {
        parsed.immediateActions = parsed.immediateActions.map(action => {
          if (!action.steps || action.steps.length === 0) {
            // Generate default helpful steps based on the action
            action.steps = generateDefaultSteps(action.action);
          }
          return action;
        });
      }

      return { success: true, recommendations: parsed };
    } catch (parseError) {
      console.error('Parse error, using fallback:', parseError);
      // Return a default structure if parsing fails
      return {
        success: true,
        recommendations: {
          seoScore: 50,
          grade: 'C',
          immediateActions: [
            {
              priority: 'high',
              action: 'Complete your Google Business Profile',
              impact: 'Can increase visibility by 50%',
              steps: [
                'Go to google.com/business and sign in with your Gmail account',
                'Search for your restaurant name to see if it already exists',
                'If found, click "Claim this business" and verify ownership',
                'If not found, click "Add your business to Google"',
                'Enter your complete address exactly as it appears on your storefront',
                'Add your phone number that customers can call',
                'Choose "Restaurant" as your primary business category',
                'Set your business hours including any special holiday hours',
                'Upload at least 5 photos of your food, interior, and storefront'
              ]
            },
            {
              priority: 'high',
              action: 'Add high-quality photos to your online profiles',
              impact: 'Businesses with photos get 42% more direction requests',
              steps: [
                'Take photos during good lighting (natural daylight works best)',
                'Photograph your 5 most popular dishes from above at a 45-degree angle',
                'Take a photo of your restaurant exterior showing the sign clearly',
                'Capture your dining area when it looks clean and inviting',
                'Upload these photos to Google Business Profile, Facebook, and Instagram',
                'Add descriptive captions mentioning the dish name and key ingredients'
              ]
            },
            {
              priority: 'medium',
              action: 'Respond to all customer reviews',
              impact: 'Improves customer trust and search rankings',
              steps: [
                'Log into your Google Business Profile dashboard',
                'Click on "Reviews" in the left sidebar',
                'Read each review carefully before responding',
                'For positive reviews: Thank them specifically for what they mentioned',
                'For negative reviews: Apologize, offer to make it right, provide contact info',
                'Aim to respond within 24-48 hours of receiving a review',
                'Keep responses professional and avoid getting defensive'
              ]
            }
          ],
          keywords: [],
          googleBusinessTips: ['Add photos weekly', 'Respond to all reviews'],
          contentIdeas: ['Share daily specials', 'Behind-the-scenes content'],
          mistakesToAvoid: ['Inconsistent NAP (Name, Address, Phone)', 'Ignoring reviews'],
          monthlyChecklist: ['Update hours if changed', 'Post new photos'],
          rawAnalysis: result
        }
      };
    }
  } catch (error) {
    console.error('Error getting SEO recommendations:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Get content ideas based on trending topics and restaurant data
 */
exports.getContentIdeas = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { restaurantName, cuisineType, location, currentMonth } = request.data;

    const month = currentMonth || new Date().toLocaleString('default', { month: 'long' });

    const prompt = `Generate 10 creative social media content ideas for a ${cuisineType || 'restaurant'} called "${restaurantName || 'the restaurant'}" located in ${location || 'the local area'}.

Consider:
- Current month: ${month} (include seasonal/holiday relevant ideas)
- Food trends and popular content formats
- Mix of promotional and engaging content
- Ideas that work across Instagram, Facebook, and Twitter

Return as JSON array:
[
  {
    "title": "Idea title",
    "description": "Brief description of the content",
    "type": "promotion|engagement|educational|behind_scenes|user_generated|seasonal",
    "platforms": ["instagram", "facebook"],
    "difficulty": "easy|medium|hard",
    "estimatedEngagement": "high|medium|low",
    "bestDayToPost": "Monday|Tuesday|etc",
    "exampleCaption": "A sample caption for this idea"
  }
]`;

    const result = await callGeminiAPI(prompt);

    try {
      let jsonStr = result;
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }
      const ideas = JSON.parse(jsonStr.trim());
      return { success: true, ideas };
    } catch (parseError) {
      return {
        success: true,
        ideas: [
          {
            title: 'Feature Your Signature Dish',
            description: 'Showcase your most popular menu item with mouth-watering photos',
            type: 'promotion',
            platforms: ['instagram', 'facebook'],
            difficulty: 'easy',
            estimatedEngagement: 'high',
            bestDayToPost: 'Friday',
            exampleCaption: 'Our famous [dish] - the one everyone talks about! 🍽️'
          }
        ],
        rawResponse: result
      };
    }
  } catch (error) {
    console.error('Error getting content ideas:', error);
    throw new HttpsError('internal', safeError(error));
  }
});

// ============================================
// MENU PARSING WITH VISION API
// ============================================

/**
 * Parse a menu image/PDF using Gemini Vision API
 * Extracts categories and items with prices
 */
exports.parseMenuImage = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { imageData, mimeType } = request.data;

    if (!imageData) {
      throw new HttpsError('invalid-argument', 'Image data is required');
    }

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'Gemini API key not configured');
    }

    console.log('Parsing menu image, mimeType:', mimeType);

    // Use Gemini Vision API to parse the menu
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            {
              text: `You are a menu parsing expert. Analyze this restaurant menu image and extract ALL menu items you can find.

For each item, extract:
- The category/section it belongs to (e.g., "Appetizers", "Main Course", "Beverages", "Desserts", etc.)
- The item name
- The description (if available, otherwise leave empty)
- The price (as a number, without currency symbols)
- Any discount information (if mentioned)

IMPORTANT: 
- Be thorough and extract EVERY item you can see
- If you can't read the price clearly, estimate based on typical restaurant prices
- Group items into logical categories based on how they appear in the menu
- If a section header is visible, use that as the category name

Return your response as valid JSON in this EXACT format:
{
  "categories": [
    {
      "name": "Category Name",
      "items": [
        {
          "name": "Item Name",
          "description": "Item description or empty string",
          "price": 12.99,
          "discount": 0
        }
      ]
    }
  ],
  "totalItemsFound": 10,
  "parsingConfidence": "high"
}

Return ONLY the JSON, no other text.`
            },
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: imageData
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 32,
          topP: 0.95,
          maxOutputTokens: 8192
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid response from Gemini Vision API');
    }

    const resultText = response.data.candidates[0].content.parts[0].text;
    console.log('Gemini response received, parsing JSON...');

    // Parse the JSON response
    try {
      let jsonStr = resultText;
      // Remove markdown code blocks if present
      const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate and clean the data
      if (parsed.categories && Array.isArray(parsed.categories)) {
        parsed.categories = parsed.categories.map(category => ({
          name: category.name || 'Uncategorized',
          items: (category.items || []).map(item => ({
            name: item.name || 'Unknown Item',
            description: item.description || '',
            price: typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0,
            discount: typeof item.discount === 'number' ? item.discount : parseFloat(item.discount) || 0
          }))
        })).filter(cat => cat.items.length > 0);
      }

      const totalItems = parsed.categories?.reduce((sum, cat) => sum + cat.items.length, 0) || 0;

      return {
        success: true,
        data: parsed,
        totalItems,
        message: `Successfully extracted ${totalItems} items from the menu`
      };
    } catch (parseError) {
      console.error('JSON parsing error:', parseError, 'Raw response:', resultText);
      throw new HttpsError('internal', 'Failed to parse menu data. Please try with a clearer image.');
    }
  } catch (error) {
    console.error('Error parsing menu image:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error, 'Failed to parse menu image'));
  }
});

// ============================================
// AI ANALYTICS
// ============================================

const SYSTEM_CONTEXT = `You are an expert restaurant business analyst. Analyze the provided data and give actionable insights. Be specific with numbers and percentages. Use a friendly, professional tone suitable for restaurant owners.`;

function buildOrderSummary(orderData) {
  if (!orderData) return 'No order data available.';
  let summary = `
Restaurant Order Data Summary:
- Data Period: ${orderData.dateRange?.label || 'All Time'} (${orderData.dateRange?.start || 'N/A'} to ${orderData.dateRange?.end || 'N/A'})
- Total Orders: ${orderData.totalOrders || 0}
- Total Revenue: $${(orderData.totalRevenue || 0).toFixed(2)}
- Average Order Value: $${(orderData.avgOrderValue || 0).toFixed(2)}
- Top Selling Items by Revenue: ${(orderData.topItems || []).slice(0, 10).map(i => `${i.name} ($${(i.revenue||0).toFixed(2)}, qty: ${i.quantity||0})`).join(', ')}`;

  if (orderData.bottomItems) {
    summary += `\n- Bottom Performers: ${orderData.bottomItems.slice(0, 5).map(i => `${i.name} (qty: ${i.quantity||0})`).join(', ')}`;
  }
  if (orderData.paymentMethods) {
    const pm = orderData.paymentMethods;
    summary += `\n- Revenue by Payment: Cash $${(pm.cash||0).toFixed(2)}, Card $${(pm.card||0).toFixed(2)}, Online $${(pm.online||0).toFixed(2)}`;
  }
  if (orderData.sourceBreakdown) {
    const sb = orderData.sourceBreakdown;
    summary += `\n- Orders by Source: POS ${sb.pos||0}, Website ${sb.website||0}`;
  }
  if (orderData.orderTypes) {
    const ot = orderData.orderTypes;
    summary += `\n- Order Types: Dine-in ${ot.dine_in||0}, Counter ${ot.counter||0}, Pickup ${ot.pickup||0}, Delivery ${ot.delivery||0}`;
  }
  if (orderData.totalTips != null) {
    summary += `\n- Total Tips: $${(orderData.totalTips||0).toFixed(2)}, Avg Tip per Order: $${(orderData.avgTip||0).toFixed(2)}`;
  }
  if (orderData.avgOrderTime) {
    summary += `\n- Avg Order Completion Time: ${(orderData.avgOrderTime||0).toFixed(1)} minutes`;
  }
  if (orderData.kitchenTime) {
    summary += `\n- Avg Kitchen Time: ${(orderData.kitchenTime||0).toFixed(1)} minutes`;
  }
  if (orderData.customerInsights) {
    const ci = orderData.customerInsights;
    summary += `\n- Unique Customers: ${ci.uniqueCustomers||0}, Returning: ${ci.returning||0}, New: ${ci.newCustomers||0}`;
    summary += `\n- Avg Orders/Customer: ${(ci.avgOrdersPerCustomer||0).toFixed(1)}, Avg Lifetime Value: $${(ci.avgLifetimeValue||0).toFixed(2)}`;
  }
  if (orderData.categoryPerformance) {
    summary += `\n- Category Performance: ${orderData.categoryPerformance.slice(0, 8).map(c => `${c.name} ($${(c.revenue||0).toFixed(2)})`).join(', ')}`;
  }
  if (orderData.itemCombos) {
    summary += `\n- Popular Combos: ${orderData.itemCombos.slice(0, 5).map(c => `${c.combo} (${c.count}x)`).join(', ')}`;
  }
  if (orderData.revenueBreakdown) {
    const rb = orderData.revenueBreakdown;
    summary += `\n- Revenue Breakdown: Subtotal $${(rb.subtotal||0).toFixed(2)}, Tax $${(rb.tax||0).toFixed(2)}, Tips $${(rb.tips||0).toFixed(2)}, Discounts $${(rb.discounts||0).toFixed(2)}`;
  }
  if (orderData.ordersByDay) {
    summary += `\n- Orders by Day: ${JSON.stringify(orderData.ordersByDay)}`;
  }
  if (orderData.ordersByHour) {
    const hours = orderData.ordersByHour;
    if (Array.isArray(hours)) {
      const top3 = [...hours].sort((a,b) => b.count - a.count).slice(0, 3);
      summary += `\n- Busiest Hours: ${top3.map(h => `${h.label} (${h.count} orders)`).join(', ')}`;
    } else {
      summary += `\n- Orders by Hour: ${JSON.stringify(hours)}`;
    }
  }
  return summary;
}

function buildMenuSummary(menuData) {
  if (!menuData) return 'No menu data available.';
  return `
Menu Data:
- Total Categories: ${menuData.categoryCount || 0}
- Total Items: ${menuData.itemCount || 0}
- Price Range: $${menuData.minPrice || 0} - $${menuData.maxPrice || 0}
- Average Item Price: $${(menuData.avgPrice || 0).toFixed(2)}
- Items with Discounts: ${menuData.discountedItems || 0}`;
}

function buildPromptForType(analysisType, orderSummary, menuSummary, question) {
  switch (analysisType) {
    // Tier 1: Essential
    case 'businessSummary':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n${menuSummary}\n\nProvide a brief business performance summary in this JSON format:\n{"headline":"One impactful headline (max 10 words)","summary":"2-3 sentence executive summary","keyMetrics":[{"label":"metric name","value":"value with unit","trend":"up/down/stable","insight":"brief context"}],"topInsight":"The single most important insight the owner should know"}\n\nReturn ONLY valid JSON.`;

    case 'salesPrediction':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n\nBased on the historical order patterns, predict sales for the next 7 days.\nReturn in JSON: {"prediction":{"nextWeekRevenue":1500.00,"dailyBreakdown":[{"day":"Monday","predicted":200,"confidence":"high/medium/low"}],"peakDay":"Saturday","slowestDay":"Tuesday"},"methodology":"Brief explanation","recommendations":["tip1","tip2"]}\n\nReturn ONLY valid JSON.`;

    case 'anomalyAlerts':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n${menuSummary}\n\nAnalyze for unusual patterns, anomalies, or concerning trends.\nReturn in JSON: {"alerts":[{"severity":"high/medium/low","title":"Brief title","description":"What you noticed","recommendation":"What to do"}],"healthScore":85,"healthDescription":"Overall assessment"}\n\nReturn ONLY valid JSON.`;

    // Tier 2: Differentiation
    case 'menuOptimization':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n${menuSummary}\n\nAnalyze menu performance and suggest optimizations.\nReturn in JSON: {"recommendations":[{"type":"remove/promote/reprice/bundle","item":"name","reason":"why","expectedImpact":"improvement","priority":"high/medium/low"}],"menuHealthScore":75,"quickWins":["easy change"],"underperformers":["item"],"stars":["best items"]}\n\nReturn ONLY valid JSON.`;

    case 'staffInsights':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n\nAnalyze order timing patterns for staff scheduling insights.\nReturn in JSON: {"peakHours":[{"hour":"6 PM - 7 PM","orderVolume":"high","recommendation":"full staff"}],"slowPeriods":[{"hour":"2 PM - 4 PM","recommendation":"reduced staff"}],"optimalSchedule":{"weekday":"Brief weekday rec","weekend":"Brief weekend rec"},"efficiencyTips":["tip"],"averageOrderTime":"estimated minutes"}\n\nReturn ONLY valid JSON.`;

    case 'orderCombos':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n\nAnalyze order patterns to find popular item combinations.\nReturn in JSON: {"popularCombos":[{"items":["item1","item2"],"frequency":"how often","suggestion":"combo deal idea"}],"bundleOpportunities":[{"name":"bundle name","items":["item1","item2"],"suggestedPrice":19.99,"expectedUplift":"percentage"}],"crossSellOpportunities":["suggestion"]}\n\nReturn ONLY valid JSON.`;

    // Tier 3: Premium
    case 'marketPosition':
      return `${SYSTEM_CONTEXT}\n${menuSummary}\n\nProvide competitive positioning insights.\nReturn in JSON: {"pricePosition":"budget/mid-range/premium","insights":[{"category":"name","assessment":"how pricing compares","recommendation":"suggestion"}],"opportunities":["opportunity"],"competitiveAdvantages":["advantage"],"pricingStrategy":"overall recommendation"}\n\nReturn ONLY valid JSON.`;

    case 'aiChat':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n${menuSummary}\n\nThe restaurant owner asks: "${question || 'How is my business doing?'}"\n\nProvide a helpful, conversational response. Be specific with data. Keep under 200 words.\nReturn in JSON: {"response":"Your answer","followUpQuestions":["related question"]}\n\nReturn ONLY valid JSON.`;

    case 'weeklyReport':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n${menuSummary}\n\nGenerate a comprehensive weekly business report.\nReturn in JSON: {"reportTitle":"Weekly Performance Report","period":"report period","executiveSummary":"3-4 sentence summary","sections":[{"title":"Revenue Performance","content":"analysis","highlight":"key number"}],"actionItems":[{"priority":"high/medium/low","task":"action","expectedImpact":"why"}],"nextWeekFocus":"one priority"}\n\nReturn ONLY valid JSON.`;

    // NEW: Revenue Intelligence (combined prediction + pricing + growth)
    case 'revenueIntelligence':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n${menuSummary}\n\nProvide comprehensive revenue intelligence combining sales prediction, pricing strategy, and revenue growth opportunities.\nReturn in JSON: {"prediction":{"nextWeekRevenue":1500.00,"dailyBreakdown":[{"day":"Monday","predicted":200,"confidence":"high/medium/low"}],"peakDay":"Saturday","slowestDay":"Tuesday"},"pricingRecommendations":[{"item":"item name","currentApproach":"current strategy","suggestion":"what to change","estimatedImpact":"expected $ or % change"}],"revenueGrowthIdeas":[{"idea":"specific actionable idea","effort":"low/medium/high","potentialImpact":"estimated $ or % increase","timeframe":"when to expect results"}],"summaryInsight":"One key takeaway for revenue growth"}\n\nReturn ONLY valid JSON.`;

    // NEW: Customer Intelligence
    case 'customerIntelligence':
      return `${SYSTEM_CONTEXT}\n${orderSummary}\n\nAnalyze customer behavior, segmentation, and retention opportunities.\nReturn in JSON: {"segments":[{"name":"High-Value Regulars/Occasional Visitors/New Customers/At-Risk","count":"estimated count or %","avgSpend":"average spend","behavior":"description","strategy":"how to engage"}],"retentionInsights":{"returningRate":"percentage","avgVisitFrequency":"description","churnRisk":"assessment"},"behaviorPatterns":[{"pattern":"what you noticed","implication":"what it means","action":"what to do"}],"personalizationIdeas":["specific personalization suggestion"],"summaryInsight":"One key takeaway about customers"}\n\nReturn ONLY valid JSON.`;

    default:
      return null;
  }
}

async function callGeminiAPI(apiKey, prompt, maxTokens = 2048) {
  const response = await axios.post(
    `${GEMINI_API_URL}?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: maxTokens }
    },
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Invalid response from Gemini API');
  }
  const resultText = response.data.candidates[0].content.parts[0].text;
  let jsonStr = resultText;
  const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];
  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    return { rawResponse: resultText };
  }
}

/**
 * Get AI-powered analytics insights
 * Supports 3 tiers + batch mode for the premium AI dashboard
 */
exports.getAIAnalytics = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { tier, analysisType, orderData, menuData, question, batchTypes } = request.data;

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'Gemini API key not configured');
    }

    const orderSummary = buildOrderSummary(orderData);
    const menuSummary = buildMenuSummary(menuData);

    // ---- BATCH MODE: fire multiple analyses in parallel ----
    if (batchTypes && Array.isArray(batchTypes) && batchTypes.length > 0) {
      const promises = batchTypes.map(type => {
        const prompt = buildPromptForType(type, orderSummary, menuSummary, question);
        if (!prompt) return Promise.resolve({ type, data: null, error: 'Unknown analysis type' });
        return callGeminiAPI(apiKey, prompt, 3072)
          .then(data => ({ type, data }))
          .catch(err => ({ type, data: null, error: err.message }));
      });

      const results = await Promise.allSettled(promises);
      const batchResult = {};
      results.forEach((r) => {
        const val = r.status === 'fulfilled' ? r.value : { type: 'unknown', data: null, error: r.reason?.message };
        if (val.error) {
          batchResult[val.type] = { success: false, error: val.error };
        } else {
          batchResult[val.type] = { success: true, data: val.data };
        }
      });

      return { success: true, batch: true, data: batchResult };
    }

    // ---- SINGLE MODE: backward-compatible ----
    let prompt = '';
    let systemContext = SYSTEM_CONTEXT;

    // Tier 1: Essential Insights
    if (tier === 1) {
      switch (analysisType) {
        case 'businessSummary':
          prompt = `${systemContext}

${orderSummary}
${menuSummary}

Provide a brief business performance summary in this JSON format:
{
  "headline": "One impactful headline (max 10 words)",
  "summary": "2-3 sentence executive summary of overall performance",
  "keyMetrics": [
    {"label": "metric name", "value": "value with unit", "trend": "up/down/stable", "insight": "brief context"}
  ],
  "topInsight": "The single most important insight the owner should know"
}

Return ONLY valid JSON.`;
          break;

        case 'salesPrediction':
          prompt = `${systemContext}

${orderSummary}

Based on the historical order patterns, predict sales for the next 7 days.

Return your prediction in this JSON format:
{
  "prediction": {
    "nextWeekRevenue": 1500.00,
    "dailyBreakdown": [
      {"day": "Monday", "predicted": 200, "confidence": "high/medium/low"}
    ],
    "peakDay": "Saturday",
    "slowestDay": "Tuesday"
  },
  "methodology": "Brief explanation of how you made this prediction",
  "recommendations": ["actionable tip 1", "actionable tip 2"]
}

Return ONLY valid JSON.`;
          break;

        case 'anomalyAlerts':
          prompt = `${systemContext}

${orderSummary}
${menuSummary}

Analyze the data for any unusual patterns, anomalies, or concerning trends.

Return your findings in this JSON format:
{
  "alerts": [
    {
      "severity": "high/medium/low",
      "title": "Brief alert title",
      "description": "What you noticed and why it matters",
      "recommendation": "What to do about it"
    }
  ],
  "healthScore": 85,
  "healthDescription": "Overall assessment of business health"
}

If no anomalies found, return an empty alerts array with a positive health assessment.
Return ONLY valid JSON.`;
          break;

        default:
          throw new HttpsError('invalid-argument', 'Invalid analysis type for Tier 1');
      }
    }

    // Tier 2: Differentiation
    else if (tier === 2) {
      switch (analysisType) {
        case 'menuOptimization':
          prompt = `${systemContext}

${orderSummary}
${menuSummary}

Analyze the menu performance and suggest optimizations.

Return your recommendations in this JSON format:
{
  "recommendations": [
    {
      "type": "remove/promote/reprice/bundle",
      "item": "item name",
      "reason": "why this change",
      "expectedImpact": "what improvement to expect",
      "priority": "high/medium/low"
    }
  ],
  "menuHealthScore": 75,
  "quickWins": ["easy change 1", "easy change 2"],
  "underperformers": ["item that needs attention"],
  "stars": ["your best performing items"]
}

Return ONLY valid JSON.`;
          break;

        case 'staffInsights':
          prompt = `${systemContext}

${orderSummary}

Analyze order timing patterns to provide staff scheduling insights.

Return your analysis in this JSON format:
{
  "peakHours": [
    {"hour": "6 PM - 7 PM", "orderVolume": "high", "recommendation": "full staff"}
  ],
  "slowPeriods": [
    {"hour": "2 PM - 4 PM", "recommendation": "reduced staff"}
  ],
  "optimalSchedule": {
    "weekday": "Brief scheduling recommendation for weekdays",
    "weekend": "Brief scheduling recommendation for weekends"
  },
  "efficiencyTips": ["tip 1", "tip 2"],
  "averageOrderTime": "estimated minutes per order"
}

Return ONLY valid JSON.`;
          break;

        case 'orderCombos':
          prompt = `${systemContext}

${orderSummary}

Analyze order patterns to find popular item combinations.

Return your findings in this JSON format:
{
  "popularCombos": [
    {
      "items": ["item 1", "item 2"],
      "frequency": "how often ordered together",
      "suggestion": "combo deal idea"
    }
  ],
  "bundleOpportunities": [
    {
      "name": "suggested bundle name",
      "items": ["item 1", "item 2", "item 3"],
      "suggestedPrice": 19.99,
      "expectedUplift": "percentage increase in orders"
    }
  ],
  "crossSellOpportunities": ["when someone orders X, suggest Y"]
}

Return ONLY valid JSON.`;
          break;

        default:
          throw new HttpsError('invalid-argument', 'Invalid analysis type for Tier 2');
      }
    }

    // Tier 3: Premium
    else if (tier === 3) {
      switch (analysisType) {
        case 'marketPosition':
          prompt = `${systemContext}

${menuSummary}

Based on the menu pricing, provide competitive positioning insights.

Return your analysis in this JSON format:
{
  "pricePosition": "budget/mid-range/premium",
  "insights": [
    {
      "category": "category name",
      "assessment": "how pricing compares to typical restaurants",
      "recommendation": "pricing suggestion"
    }
  ],
  "opportunities": ["market opportunity 1", "market opportunity 2"],
  "competitiveAdvantages": ["what makes this menu stand out"],
  "pricingStrategy": "overall recommendation for pricing approach"
}

Return ONLY valid JSON.`;
          break;

        case 'aiChat':
          prompt = `${systemContext}

${orderSummary}
${menuSummary}

The restaurant owner asks: "${question || 'How is my business doing?'}"

Provide a helpful, conversational response. Be specific with data when available. Keep response under 200 words.

Return in this JSON format:
{
  "response": "Your conversational answer here",
  "followUpQuestions": ["related question they might ask next"]
}

Return ONLY valid JSON.`;
          break;

        case 'weeklyReport':
          prompt = `${systemContext}

${orderSummary}
${menuSummary}

Generate a comprehensive weekly business report.

Return in this JSON format:
{
  "reportTitle": "Weekly Performance Report",
  "period": "report period description",
  "executiveSummary": "3-4 sentence summary for busy owners",
  "sections": [
    {
      "title": "Revenue Performance",
      "content": "detailed analysis",
      "highlight": "key number or achievement"
    },
    {
      "title": "Top Performers",
      "content": "what's working well",
      "highlight": "standout item or trend"
    },
    {
      "title": "Areas for Improvement",
      "content": "growth opportunities",
      "highlight": "priority action item"
    }
  ],
  "actionItems": [
    {"priority": "high/medium/low", "task": "specific action to take", "expectedImpact": "why it matters"}
  ],
  "nextWeekFocus": "one thing to prioritize next week"
}

Return ONLY valid JSON.`;
          break;

        default:
          throw new HttpsError('invalid-argument', 'Invalid analysis type for Tier 3');
      }
    } else {
      throw new HttpsError('invalid-argument', 'Invalid tier. Must be 1, 2, or 3');
    }

    // Call Gemini API
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid response from Gemini API');
    }

    const resultText = response.data.candidates[0].content.parts[0].text;

    // Parse and return the response
    try {
      let jsonStr = resultText;
      const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());
      return { success: true, data: parsed, tier, analysisType };
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      // Return raw text if JSON parsing fails
      return { success: true, data: { rawResponse: resultText }, tier, analysisType };
    }

  } catch (error) {
    console.error('Error in AI Analytics:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error, 'Failed to generate AI analytics'));
  }
});

// ============================================
// PROMOTIONS & REWARDS FUNCTIONS
// ============================================

/**
 * Get active promotions for a restaurant (public endpoint for website)
 */
exports.getPromotions = onRequest(async (req, res) => {
  return cors(req, res, async () => {
    try {
      const restaurantId = req.query.restaurantId;

      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant ID is required' });
      }

      const db = admin.firestore();
      const now = new Date();

      // Get all published promotions that haven't expired
      const promotionsSnapshot = await db
        .collection(`restaurants/${restaurantId}/promotions`)
        .where('isPublished', '==', true)
        .get();

      const promotions = [];

      promotionsSnapshot.forEach(doc => {
        const promo = { id: doc.id, ...doc.data() };

        // Check if promotion is still valid
        const validUntil = promo.validUntil?.toDate ? promo.validUntil.toDate() : new Date(promo.validUntil);
        const validFrom = promo.validFrom?.toDate ? promo.validFrom.toDate() : new Date(promo.validFrom || 0);

        if (validUntil >= now && validFrom <= now) {
          // Check if there are claims remaining
          const remainingClaims = (promo.maxClaims || 0) - (promo.claimCount || 0);
          if (promo.maxClaims === 0 || promo.maxClaims === null || remainingClaims > 0) {
            const { discountValue, discountUnit } = parsePromoDiscount(promo);
            promotions.push({
              ...promo,
              discountValue,
              discountUnit,
              autoClaimOnSignup: promo.autoClaimOnSignup || false,
              remainingClaims: promo.maxClaims ? remainingClaims : null,
              validUntil: validUntil.toISOString(),
              validFrom: validFrom.toISOString()
            });
          }
        }
      });

      // Sort by creation date (newest first)
      promotions.sort((a, b) => {
        const dateA = a.createdAt?.toMillis?.() || 0;
        const dateB = b.createdAt?.toMillis?.() || 0;
        return dateB - dateA;
      });

      res.json({ success: true, promotions });
    } catch (error) {
      console.error('Error getting promotions:', error);
      res.status(500).json({ error: 'Failed to load promotions' });
    }
  });
});

/**
 * Claim a promotion (authenticated users only)
 */
exports.claimPromotion = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated to claim promotions');
    }

    const { restaurantId, promotionId } = request.data;
    const userId = request.auth.uid;

    if (!restaurantId || !promotionId) {
      throw new HttpsError('invalid-argument', 'Restaurant ID and Promotion ID are required');
    }

    const db = admin.firestore();
    const promoRef = db.doc(`restaurants/${restaurantId}/promotions/${promotionId}`);
    const claimRef = db.doc(`restaurants/${restaurantId}/promotionClaims/${promotionId}_${userId}`);

    // Use transaction to ensure atomic update
    const result = await db.runTransaction(async (transaction) => {
      const promoDoc = await transaction.get(promoRef);
      const claimDoc = await transaction.get(claimRef);

      if (!promoDoc.exists) {
        throw new HttpsError('not-found', 'Promotion not found');
      }

      const promo = promoDoc.data();

      // Check if already claimed by this user
      if (claimDoc.exists) {
        throw new HttpsError('already-exists', 'You have already claimed this promotion');
      }

      // Check if promotion is still valid
      const now = new Date();
      const validUntil = promo.validUntil?.toDate ? promo.validUntil.toDate() : new Date(promo.validUntil);
      if (validUntil < now) {
        throw new HttpsError('failed-precondition', 'This promotion has expired');
      }

      // Check if claims are available
      if (promo.maxClaims && (promo.claimCount || 0) >= promo.maxClaims) {
        throw new HttpsError('resource-exhausted', 'This promotion has reached its claim limit');
      }

      // Parse discount values for the claim record
      const { discountValue, discountUnit } = parsePromoDiscount(promo);
      const uniqueCode = generateUniquePromoCode();

      // Record the claim
      transaction.set(claimRef, {
        userId,
        promotionId,
        promotionTitle: promo.title,
        promoCode: promo.code,
        uniqueCode,
        discount: promo.discount,
        discountValue,
        discountUnit,
        type: promo.type,
        validUntil: promo.validUntil,
        minOrderAmount: promo.minOrderAmount || 0,
        claimedAt: FieldValue.serverTimestamp(),
        used: false
      });

      // Increment claim count
      transaction.update(promoRef, {
        claimCount: FieldValue.increment(1)
      });

      return {
        promoCode: promo.code,
        uniqueCode,
        discount: promo.discount,
        discountValue,
        discountUnit,
        type: promo.type,
        title: promo.title
      };
    });

    return {
      success: true,
      message: 'Promotion claimed successfully!',
      ...result
    };
  } catch (error) {
    console.error('Error claiming promotion:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Validate a promo code for use at checkout or POS
 */
exports.validatePromoCode = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { restaurantId, promoCode, subtotal } = request.data;

    if (!restaurantId || !promoCode) {
      throw new HttpsError('invalid-argument', 'Restaurant ID and promo code are required');
    }

    const db = admin.firestore();
    const result = await validatePromoInternal(db, restaurantId, promoCode, subtotal || 0);
    return result;
  } catch (error) {
    console.error('Error validating promo code:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Save daily spin result (authenticated users only)
 */
exports.saveDailySpinResult = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { restaurantId, prizeId, prizeName, prizeType, prizeValue } = request.data;
    const userId = request.auth.uid;

    if (!restaurantId || !prizeId) {
      throw new HttpsError('invalid-argument', 'Restaurant ID and prize details are required');
    }

    const db = admin.firestore();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const spinRef = db.doc(`restaurants/${restaurantId}/customerSpins/${userId}`);

    // Check if already spun today
    const spinDoc = await spinRef.get();
    if (spinDoc.exists) {
      const lastSpinDate = spinDoc.data().lastSpinDate;
      if (lastSpinDate === today) {
        throw new HttpsError('resource-exhausted', 'You have already spun today. Come back tomorrow!');
      }
    }

    // Calculate streak
    let streak = 1;
    if (spinDoc.exists) {
      const lastSpinDate = spinDoc.data().lastSpinDate;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (lastSpinDate === yesterdayStr) {
        streak = (spinDoc.data().streak || 0) + 1;
      }
    }

    // Generate reward code if won something
    let rewardCode = null;
    if (prizeType !== 'none') {
      rewardCode = `SPIN-${prizeId.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    }

    // Save spin result
    await spinRef.set({
      lastSpinDate: today,
      streak,
      lastPrize: {
        prizeId,
        prizeName,
        prizeType,
        prizeValue,
        rewardCode,
        wonAt: FieldValue.serverTimestamp()
      }
    }, { merge: true });

    // If won points, add to customer's reward points
    if (prizeType === 'points' && prizeValue) {
      const customerRef = db.doc(`restaurants/${restaurantId}/customers/${userId}`);
      await customerRef.update({
        rewardPoints: FieldValue.increment(prizeValue)
      }).catch(() => {
        // Customer doc might not exist yet
      });
    }

    // Save to rewards history
    if (prizeType !== 'none') {
      await db.collection(`restaurants/${restaurantId}/customerRewards`).add({
        userId,
        prizeId,
        prizeName,
        prizeType,
        prizeValue,
        rewardCode,
        source: 'daily_spin',
        used: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        wonAt: FieldValue.serverTimestamp()
      });
    }

    return {
      success: true,
      streak,
      rewardCode,
      message: prizeType !== 'none' ? 'Congratulations! Your reward has been saved.' : 'Better luck next time!'
    };
  } catch (error) {
    console.error('Error saving spin result:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Get customer's earned rewards
 */
exports.getCustomerRewards = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { restaurantId } = request.data;
    const userId = request.auth.uid;

    if (!restaurantId) {
      throw new HttpsError('invalid-argument', 'Restaurant ID is required');
    }

    const db = admin.firestore();
    const now = new Date();

    // Get unused rewards that haven't expired
    const rewardsSnapshot = await db
      .collection(`restaurants/${restaurantId}/customerRewards`)
      .where('userId', '==', userId)
      .where('used', '==', false)
      .get();

    const rewards = [];
    rewardsSnapshot.forEach(doc => {
      const reward = { id: doc.id, ...doc.data() };
      const expiresAt = reward.expiresAt?.toDate ? reward.expiresAt.toDate() : new Date(reward.expiresAt);
      if (expiresAt > now) {
        rewards.push({
          ...reward,
          expiresAt: expiresAt.toISOString()
        });
      }
    });

    // Get ALL claimed promotions (both used and unused)
    // Used promos must still appear so the portal can show "Used" badge
    // and prevent re-claiming
    const claimsSnapshot = await db
      .collection(`restaurants/${restaurantId}/promotionClaims`)
      .where('userId', '==', userId)
      .get();

    const claimedPromotions = [];
    claimsSnapshot.forEach(doc => {
      claimedPromotions.push({ id: doc.id, ...doc.data() });
    });

    // Get spin info
    const spinDoc = await db.doc(`restaurants/${restaurantId}/customerSpins/${userId}`).get();
    const spinInfo = spinDoc.exists ? spinDoc.data() : { streak: 0, lastSpinDate: null };

    // Get rewards config (loyalty settings, spin prizes)
    let rewardsConfig = null;
    try {
      const configDoc = await db.doc(`restaurants/${restaurantId}/rewardsConfig/settings`).get();
      if (configDoc.exists) {
        rewardsConfig = configDoc.data();
        // Remove server-only fields
        delete rewardsConfig.updatedAt;
      }
    } catch (configErr) {
      console.log('Could not load rewards config:', configErr.message);
    }

    // Get customer doc for points balance
    let customerPoints = 0;
    try {
      const customerDoc = await db.doc(`restaurants/${restaurantId}/customers/${userId}`).get();
      if (customerDoc.exists) {
        customerPoints = customerDoc.data().rewardPoints || 0;
      }
    } catch (cpErr) {
      console.log('Could not load customer points:', cpErr.message);
    }

    return {
      success: true,
      rewards,
      claimedPromotions,
      spinInfo,
      rewardsConfig,
      customerPoints
    };
  } catch (error) {
    console.error('Error getting customer rewards:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', safeError(error));
  }
});

// ============================================
// BUSINESS LISTINGS — Yelp, Google Business, Apple
// ============================================

const YELP_API_BASE = 'https://api.yelp.com/v3';

/**
 * Helper: Get Google OAuth access token from a per-user refresh token
 */
async function getGoogleAccessToken(refreshToken) {
  const clientId = googleBusinessClientId.value() || process.env.GOOGLE_BUSINESS_CLIENT_ID || '';
  const clientSecret = googleBusinessClientSecret.value() || process.env.GOOGLE_BUSINESS_CLIENT_SECRET || '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Business credentials not configured');
  }

  const response = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  return response.data.access_token;
}

/**
 * Helper: Get Yelp API key
 */
function getYelpApiKey() {
  return (yelpApiKeySecret.value() || process.env.YELP_API_KEY || '').trim();
}

// ---- YELP FUNCTIONS ----

/**
 * Search Yelp for a business by name and location
 */
exports.searchYelpBusiness = onCall({ secrets: [yelpApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const apiKey = getYelpApiKey();
    if (!apiKey) {
      return { success: false, error: 'not_configured', message: 'Yelp API key is not configured. Set YELP_API_KEY in Firebase Secrets.' };
    }

    const { name, location } = request.data;
    if (!name || !location) {
      throw new HttpsError('invalid-argument', 'Business name and location are required');
    }

    const response = await axios.get(`${YELP_API_BASE}/businesses/search`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { term: name, location: location, categories: 'restaurants,food', limit: 5 }
    });

    const businesses = (response.data.businesses || []).map(biz => ({
      id: biz.id,
      name: biz.name,
      rating: biz.rating,
      reviewCount: biz.review_count,
      url: biz.url,
      imageUrl: biz.image_url,
      address: biz.location?.display_address?.join(', ') || '',
      phone: biz.display_phone || '',
      categories: (biz.categories || []).map(c => c.title),
      isClosed: biz.is_closed
    }));

    return { success: true, businesses };
  } catch (error) {
    console.error('Error searching Yelp:', error.response?.data || error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to search Yelp: ' + (error.response?.data?.error?.description || error.message));
  }
});

/**
 * Connect a Yelp business — fetch details + reviews, cache in Firestore
 */
exports.connectYelpBusiness = onCall({ secrets: [yelpApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const apiKey = getYelpApiKey();
    if (!apiKey) {
      return { success: false, error: 'not_configured', message: 'Yelp API key is not configured.' };
    }

    const { businessId } = request.data;
    if (!businessId) {
      throw new HttpsError('invalid-argument', 'Business ID is required');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    // Fetch business details
    const bizResponse = await axios.get(`${YELP_API_BASE}/businesses/${businessId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const biz = bizResponse.data;

    // Fetch reviews (max 3 from Yelp API) — may fail if endpoint is unavailable
    let yelpReviews = [];
    try {
      const reviewsResponse = await axios.get(`${YELP_API_BASE}/businesses/${businessId}/reviews`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        params: { limit: 3, sort_by: 'newest' }
      });
      yelpReviews = reviewsResponse.data.reviews || [];
    } catch (reviewErr) {
      console.warn('Yelp reviews fetch failed (endpoint may be deprecated):', reviewErr.response?.status, reviewErr.response?.data?.error?.code);
      // Continue without reviews — connection still succeeds
    }

    // Save connection state
    const connectionData = {
      connected: true,
      businessId: biz.id,
      businessName: biz.name,
      businessUrl: biz.url,
      rating: biz.rating,
      reviewCount: biz.review_count,
      imageUrl: biz.image_url || '',
      address: biz.location?.display_address?.join(', ') || '',
      phone: biz.display_phone || '',
      categories: (biz.categories || []).map(c => c.title),
      connectedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    };

    await db.doc(`restaurants/${uid}/settings/businessListings`).set(
      { yelp: connectionData },
      { merge: true }
    );

    // Cache reviews
    const batch = db.batch();
    for (const review of yelpReviews) {
      const reviewRef = db.collection(`restaurants/${uid}/businessReviews`).doc(`yelp_${review.id}`);
      batch.set(reviewRef, {
        platform: 'yelp',
        externalId: review.id,
        authorName: review.user?.name || 'Anonymous',
        authorImageUrl: review.user?.image_url || '',
        rating: review.rating,
        text: review.text,
        createdAt: admin.firestore.Timestamp.fromDate(new Date(review.time_created)),
        fetchedAt: admin.firestore.Timestamp.now(),
        platformUrl: review.url || biz.url
      });
    }
    await batch.commit();

    return { success: true, connection: connectionData, reviewCount: yelpReviews.length };
  } catch (error) {
    console.error('Error connecting Yelp business:', error.response?.data || error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to connect Yelp business: ' + (error.response?.data?.error?.description || error.message));
  }
});

/**
 * Refresh cached Yelp reviews
 */
exports.fetchYelpReviews = onCall({ secrets: [yelpApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const apiKey = getYelpApiKey();
    if (!apiKey) {
      return { success: false, error: 'not_configured', message: 'Yelp API key is not configured.' };
    }

    const { businessId } = request.data;
    if (!businessId) {
      throw new HttpsError('invalid-argument', 'Business ID is required');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    let yelpReviews = [];
    try {
      const reviewsResponse = await axios.get(`${YELP_API_BASE}/businesses/${businessId}/reviews`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        params: { limit: 3, sort_by: 'newest' }
      });
      yelpReviews = reviewsResponse.data.reviews || [];
    } catch (reviewErr) {
      console.warn('Yelp reviews fetch failed (endpoint may be deprecated):', reviewErr.response?.status);
    }

    // Update cached reviews
    if (yelpReviews.length > 0) {
      const batch = db.batch();
      for (const review of yelpReviews) {
        const reviewRef = db.collection(`restaurants/${uid}/businessReviews`).doc(`yelp_${review.id}`);
        batch.set(reviewRef, {
          platform: 'yelp',
          externalId: review.id,
          authorName: review.user?.name || 'Anonymous',
          authorImageUrl: review.user?.image_url || '',
          rating: review.rating,
          text: review.text,
          createdAt: admin.firestore.Timestamp.fromDate(new Date(review.time_created)),
          fetchedAt: admin.firestore.Timestamp.now(),
          platformUrl: review.url || ''
        });
      }
      await batch.commit();
    }

    // Update lastSyncedAt
    await db.doc(`restaurants/${uid}/settings/businessListings`).set(
      { yelp: { lastSyncedAt: new Date().toISOString() } },
      { merge: true }
    );

    return { success: true, reviews: yelpReviews.length };
  } catch (error) {
    console.error('Error fetching Yelp reviews:', error.response?.data || error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to fetch Yelp reviews');
  }
});

// ---- GOOGLE BUSINESS FUNCTIONS ----

/**
 * Initiate Google Business OAuth — returns the authorization URL
 */
exports.initiateGoogleAuth = onCall({ secrets: [googleBusinessClientId, googleBusinessClientSecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const clientId = googleBusinessClientId.value() || process.env.GOOGLE_BUSINESS_CLIENT_ID || '';
    if (!clientId) {
      return { success: false, error: 'not_configured', message: 'Google Business credentials are not configured.' };
    }

    const uid = request.auth.uid;
    const { redirectUri } = request.data;

    // Build the OAuth URL
    const scopes = [
      'https://www.googleapis.com/auth/business.manage'
    ].join(' ');

    const state = Buffer.from(JSON.stringify({ uid })).toString('base64');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri || `${getAppBaseUrl()}/auth/google-business/callback`)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    return { success: true, authUrl };
  } catch (error) {
    console.error('Error initiating Google auth:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Handle Google Business OAuth callback — exchange code for tokens
 */
exports.handleGoogleAuthCallback = onRequest({ secrets: [googleBusinessClientId, googleBusinessClientSecret] }, async (req, res) => {
  return cors(req, res, async () => {
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state parameter' });
      }

      const clientId = googleBusinessClientId.value() || process.env.GOOGLE_BUSINESS_CLIENT_ID || '';
      const clientSecret = googleBusinessClientSecret.value() || process.env.GOOGLE_BUSINESS_CLIENT_SECRET || '';

      // Decode state to get uid
      let uid;
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        uid = stateData.uid;
      } catch {
        return res.status(400).json({ error: 'Invalid state parameter' });
      }

      // Exchange code for tokens
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: req.query.redirect_uri || `${getAppBaseUrl()}/auth/google-business/callback`,
        grant_type: 'authorization_code'
      });

      const { access_token, refresh_token } = tokenResponse.data;

      // Fetch account info using the access token
      let accountName = 'Google Business Profile';
      let locationId = '';
      try {
        const accountsResponse = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
          headers: { Authorization: `Bearer ${access_token}` }
        });
        const accounts = accountsResponse.data.accounts || [];
        if (accounts.length > 0) {
          accountName = accounts[0].accountName || accounts[0].name;

          // Try to get locations
          const locationsResponse = await axios.get(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${accounts[0].name}/locations`,
            { headers: { Authorization: `Bearer ${access_token}` } }
          );
          const locations = locationsResponse.data.locations || [];
          if (locations.length > 0) {
            locationId = locations[0].name;
            accountName = locations[0].title || accountName;
          }
        }
      } catch (err) {
        console.error('Error fetching Google Business info:', err.response?.data || err.message);
      }

      // Save connection to Firestore
      const db = admin.firestore();
      await db.doc(`restaurants/${uid}/settings/businessListings`).set({
        google: {
          connected: true,
          accountName,
          locationId,
          refreshToken: refresh_token,
          connectedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString()
        }
      }, { merge: true });

      // Redirect back to the app
      res.redirect(`${getAppBaseUrl()}/seo-social?google_connected=true`);
    } catch (error) {
      console.error('Error in Google auth callback:', error.response?.data || error.message);
      res.redirect(`${getAppBaseUrl()}/seo-social?google_error=true`);
    }
  });
});

/**
 * Fetch Google Business reviews
 */
exports.fetchGoogleReviews = onCall({ secrets: [googleBusinessClientId, googleBusinessClientSecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    // Get stored connection with refresh token
    const settingsDoc = await db.doc(`restaurants/${uid}/settings/businessListings`).get();
    if (!settingsDoc.exists || !settingsDoc.data()?.google?.connected) {
      throw new HttpsError('failed-precondition', 'Google Business is not connected');
    }

    const googleData = settingsDoc.data().google;
    if (!googleData.refreshToken) {
      throw new HttpsError('failed-precondition', 'Google Business refresh token missing. Please reconnect.');
    }

    const accessToken = await getGoogleAccessToken(googleData.refreshToken);
    const locationId = googleData.locationId;

    if (!locationId) {
      return { success: true, reviews: [], message: 'No location found. Please reconnect Google Business.' };
    }

    // Fetch reviews
    const reviewsResponse = await axios.get(
      `https://mybusiness.googleapis.com/v4/${locationId}/reviews`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const googleReviews = reviewsResponse.data.reviews || [];

    // Cache reviews in Firestore
    const batch = db.batch();
    for (const review of googleReviews) {
      const reviewRef = db.collection(`restaurants/${uid}/businessReviews`).doc(`google_${review.reviewId}`);
      batch.set(reviewRef, {
        platform: 'google',
        externalId: review.reviewId,
        authorName: review.reviewer?.displayName || 'Google User',
        authorImageUrl: review.reviewer?.profilePhotoUrl || '',
        rating: review.starRating === 'FIVE' ? 5 : review.starRating === 'FOUR' ? 4 : review.starRating === 'THREE' ? 3 : review.starRating === 'TWO' ? 2 : 1,
        text: review.comment || '',
        createdAt: admin.firestore.Timestamp.fromDate(new Date(review.createTime)),
        fetchedAt: admin.firestore.Timestamp.now(),
        ownerResponse: review.reviewReply?.comment || null,
        ownerRespondedAt: review.reviewReply?.updateTime || null,
        platformUrl: review.name || ''
      });
    }
    await batch.commit();

    // Update lastSyncedAt
    await db.doc(`restaurants/${uid}/settings/businessListings`).set(
      { google: { lastSyncedAt: new Date().toISOString() } },
      { merge: true }
    );

    return { success: true, reviews: googleReviews.length };
  } catch (error) {
    console.error('Error fetching Google reviews:', error.response?.data || error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to fetch Google reviews');
  }
});

/**
 * Reply to a Google Business review
 */
exports.replyToGoogleReview = onCall({ secrets: [googleBusinessClientId, googleBusinessClientSecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { reviewName, replyText } = request.data;
    if (!reviewName || !replyText) {
      throw new HttpsError('invalid-argument', 'Review name and reply text are required');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    const settingsDoc = await db.doc(`restaurants/${uid}/settings/businessListings`).get();
    if (!settingsDoc.exists || !settingsDoc.data()?.google?.refreshToken) {
      throw new HttpsError('failed-precondition', 'Google Business is not connected');
    }

    const accessToken = await getGoogleAccessToken(settingsDoc.data().google.refreshToken);

    // Post the reply
    await axios.put(
      `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
      { comment: replyText },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    // Update cached review in Firestore
    const reviewId = reviewName.split('/').pop();
    const reviewRef = db.collection(`restaurants/${uid}/businessReviews`).doc(`google_${reviewId}`);
    const reviewDoc = await reviewRef.get();
    if (reviewDoc.exists) {
      await reviewRef.update({
        ownerResponse: replyText,
        ownerRespondedAt: new Date().toISOString()
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error replying to Google review:', error.response?.data || error.message);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to reply to review');
  }
});

// ---- AI-POWERED BUSINESS FUNCTIONS ----

/**
 * Generate an AI-powered review response using Gemini
 */
exports.generateReviewResponse = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { reviewText, rating, authorName, restaurantName, cuisineType, tone } = request.data;
    if (!reviewText) {
      throw new HttpsError('invalid-argument', 'Review text is required');
    }

    const prompt = `You are a restaurant owner responding to a customer review. Generate a thoughtful, professional response.

Restaurant: ${restaurantName || 'Our Restaurant'}
Cuisine: ${cuisineType || 'Restaurant'}
Reviewer: ${authorName || 'Customer'}
Rating: ${rating || 'N/A'} out of 5 stars
Review: "${reviewText}"

Tone: ${tone || 'warm and professional'}

Guidelines:
- If positive (4-5 stars): Thank them genuinely, reference specific things they mentioned, invite them back
- If neutral (3 stars): Thank them, acknowledge both positives and concerns, explain how you're improving
- If negative (1-2 stars): Apologize sincerely, take responsibility, offer to make it right, provide contact info
- Keep it concise (2-4 sentences)
- Be authentic and personal, not corporate
- Never be defensive or argumentative

Return as JSON:
{
  "response": "The primary response text",
  "alternativeResponses": ["A shorter version", "A more formal version"],
  "sentiment": "positive|neutral|negative",
  "keyThemes": ["food quality", "service", "atmosphere"]
}`;

    const result = await callGeminiAPI(prompt);

    try {
      let jsonStr = result;
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      const parsed = JSON.parse(jsonStr.trim());
      return { success: true, ...parsed };
    } catch {
      return { success: true, response: result, alternativeResponses: [], sentiment: 'neutral', keyThemes: [] };
    }
  } catch (error) {
    console.error('Error generating review response:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Generate AI-powered visibility improvement tasks
 */
exports.generateVisibilityTasks = onCall({ secrets: [geminiApiKeySecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { restaurantData, connectedPlatforms, reviewSummary } = request.data;

    const prompt = `You are a digital marketing expert for restaurants. Generate a prioritized list of actionable tasks to improve this restaurant's online visibility across Yelp, Google Business Profile, and Apple Business Connect.

Restaurant: ${restaurantData?.name || 'Restaurant'}
Cuisine: ${restaurantData?.cuisineType || 'Not specified'}
Location: ${restaurantData?.address || 'Not specified'}
Connected Platforms: ${JSON.stringify(connectedPlatforms || {})}
Review Summary: ${reviewSummary || 'No review data available'}

Generate 8-12 specific, actionable tasks. For each task provide DETAILED step-by-step instructions that a non-technical restaurant owner can follow.

Return as JSON array:
[
  {
    "platform": "yelp|google|apple|general",
    "title": "Task title",
    "description": "Why this matters",
    "priority": "high|medium|low",
    "category": "profile|reviews|photos|content",
    "impactScore": 15,
    "steps": [
      "Step 1: Go to...",
      "Step 2: Click on...",
      "Step 3: Fill in..."
    ]
  }
]`;

    const result = await callGeminiAPI(prompt);

    try {
      let jsonStr = result;
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (arrayMatch) jsonStr = arrayMatch[0];
      const tasks = JSON.parse(jsonStr.trim());

      // Store tasks in Firestore
      const uid = request.auth.uid;
      const db = admin.firestore();
      const batch = db.batch();

      for (const task of tasks) {
        const taskRef = db.collection(`restaurants/${uid}/visibilityTasks`).doc();
        batch.set(taskRef, {
          ...task,
          status: 'pending',
          createdAt: admin.firestore.Timestamp.now(),
          completedAt: null,
          generatedByAI: true
        });
      }
      await batch.commit();

      return { success: true, tasks };
    } catch (parseErr) {
      console.warn('Failed to parse Gemini visibility tasks, using defaults:', parseErr.message);
      const fallbackTasks = [
        { platform: 'google', title: 'Complete your Google Business Profile', description: 'A complete profile gets 7x more clicks', priority: 'high', category: 'profile', impactScore: 20, steps: ['Go to google.com/business', 'Sign in and claim your business', 'Complete all sections'] },
        { platform: 'yelp', title: 'Add photos to your Yelp page', description: 'Businesses with photos get 42% more direction requests', priority: 'high', category: 'photos', impactScore: 15, steps: ['Log into biz.yelp.com', 'Go to Photos section', 'Upload 10+ high-quality food photos'] },
        { platform: 'apple', title: 'Claim your Apple Business Connect listing', description: 'Reach customers on Apple Maps, Siri, and Wallet', priority: 'medium', category: 'profile', impactScore: 10, steps: ['Go to businessconnect.apple.com', 'Sign in with your Apple ID', 'Search for and claim your business'] }
      ];

      // Save fallback tasks to Firestore
      const uid = request.auth.uid;
      const db = admin.firestore();
      const fallbackBatch = db.batch();
      for (const task of fallbackTasks) {
        const taskRef = db.collection(`restaurants/${uid}/visibilityTasks`).doc();
        fallbackBatch.set(taskRef, {
          ...task,
          status: 'pending',
          createdAt: admin.firestore.Timestamp.now(),
          completedAt: null,
          generatedByAI: true
        });
      }
      await fallbackBatch.commit();

      return { success: true, tasks: fallbackTasks };
    }
  } catch (error) {
    console.error('Error generating visibility tasks:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Get aggregated overview of all connected business listings
 */
exports.getBusinessListingsOverview = onCall({ secrets: [yelpApiKeySecret, googleBusinessClientId, googleBusinessClientSecret] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    const db = admin.firestore();

    // Get connection states
    const settingsDoc = await db.doc(`restaurants/${uid}/settings/businessListings`).get();
    const connections = settingsDoc.exists ? settingsDoc.data() : {};

    // Get cached reviews
    const reviewsSnapshot = await db.collection(`restaurants/${uid}/businessReviews`)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const reviews = reviewsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate aggregate stats
    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0
      ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews
      : 0;

    const platformStats = {};
    for (const review of reviews) {
      const p = review.platform || 'unknown';
      if (!platformStats[p]) platformStats[p] = { count: 0, totalRating: 0, responded: 0 };
      platformStats[p].count++;
      platformStats[p].totalRating += review.rating || 0;
      if (review.ownerResponse) platformStats[p].responded++;
    }

    // Sentiment breakdown
    let positive = 0, neutral = 0, negative = 0;
    for (const r of reviews) {
      if (r.rating >= 4) positive++;
      else if (r.rating === 3) neutral++;
      else negative++;
    }

    // Get visibility tasks
    const tasksSnapshot = await db.collection(`restaurants/${uid}/visibilityTasks`)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const tasks = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const completedTasks = tasks.filter(t => t.status === 'completed').length;

    return {
      success: true,
      connections,
      overview: {
        totalReviews,
        avgRating: Math.round(avgRating * 10) / 10,
        platformStats,
        sentiment: { positive, neutral, negative },
        responseRate: totalReviews > 0 ? Math.round((reviews.filter(r => r.ownerResponse).length / totalReviews) * 100) : 0
      },
      reviews,
      tasks,
      taskProgress: { total: tasks.length, completed: completedTasks }
    };
  } catch (error) {
    console.error('Error getting business listings overview:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

// ============================================
// STRIPE TERMINAL FUNCTIONS (Mobile POS App)
// ============================================

/**
 * Create a connection token for the Stripe Terminal SDK.
 * Called on app launch and whenever the SDK needs to reconnect.
 */
exports.createTerminalConnectionToken = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }
    const restaurantId = request.auth.uid;

    const params = {};
    if (request.data && request.data.locationId) {
      params.location = request.data.locationId;
    }

    const connectionToken = await stripe.terminal.connectionTokens.create(params);

    return { secret: connectionToken.secret };
  } catch (error) {
    console.error('Error creating terminal connection token:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Create a Stripe Terminal Location for the restaurant.
 * A location is required to connect a Tap to Pay reader.
 */
exports.createTerminalLocation = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }
    const restaurantId = request.auth.uid;

    const data = request.data || {};
    const displayName = data.displayName;
    const address = data.address || {
      line1: data.addressLine1,
      city: data.city,
      state: data.state,
      postal_code: data.postalCode,
      country: data.country,
    };

    if (!displayName || !address.line1 || !address.city || !address.state || !address.postal_code) {
      throw new HttpsError('invalid-argument', 'Display name and full address are required');
    }

    const location = await stripe.terminal.locations.create({
      display_name: displayName,
      address: {
        line1: address.line1,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        country: address.country || 'US',
      },
      metadata: {
        restaurantId: restaurantId,
      },
    });

    const db = admin.firestore();
    const settingsRef = db.doc(`restaurants/${restaurantId}/settings/stripeTerminal`);
    await settingsRef.set(
      { stripeLocationId: location.id, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return {
      locationId: location.id,
      displayName: location.display_name,
    };
  } catch (error) {
    console.error('Error creating terminal location:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Retrieve the restaurant's Terminal Location from Stripe.
 */
exports.getTerminalLocation = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const db = admin.firestore();
    const settingsDoc = await db.doc(
      `restaurants/${request.auth.uid}/settings/stripeTerminal`
    ).get();

    const locationId = settingsDoc.data()?.stripeLocationId;
    if (!locationId) {
      return { exists: false };
    }

    const location = await stripe.terminal.locations.retrieve(locationId);
    return {
      exists: true,
      locationId: location.id,
      displayName: location.display_name,
      address: location.address,
    };
  } catch (error) {
    console.error('Error getting terminal location:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

// ============================================
// ADMIN TWO-FACTOR AUTHENTICATION (TOTP)
// ============================================

/**
 * Helper: Verify the caller is an admin.
 * Returns the admin doc data or throws HttpsError.
 */
async function verifyAdminCaller(authContext) {
  if (!authContext) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  const db = admin.firestore();
  const adminDoc = await db.doc(`admins/${authContext.uid}`).get();
  if (!adminDoc.exists) {
    throw new HttpsError('permission-denied', 'Not an admin.');
  }
  return adminDoc.data();
}

/**
 * Helper: Generate 8 backup codes (format: XXXX-XXXX).
 */
function generateBackupCodes() {
  const crypto = require('crypto');
  const codes = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  for (let i = 0; i < 8; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      if (j === 4) code += '-';
      code += chars.charAt(crypto.randomInt(chars.length));
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Step 1 of 2FA Setup: Generate a TOTP secret and QR code.
 * Returns the QR code data URL and manual-entry key for the admin to
 * add to their authenticator app.
 *
 * The secret is stored as a pending (unverified) secret in admin2FA/{uid}.
 * It only becomes active after verifyAndEnable2FA confirms the first code.
 */
exports.setupAdmin2FA = onCall(async (request) => {
  try {
    const adminData = await verifyAdminCaller(request.auth);
    const uid = request.auth.uid;
    const db = admin.firestore();

    // Generate TOTP secret
    const secret = generateSecret();
    const accountName = adminData.email || request.auth.token.email || 'Admin';
    const otpauthUrl = generateURI({ issuer: 'Koda Carte Admin', label: accountName, secret, type: 'totp' });

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    // Store pending secret (not yet activated)
    await db.doc(`admin2FA/${uid}`).set({
      pendingSecret: secret,
      pendingCreatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Format the secret into groups of 4 for easier manual entry
    const formattedKey = secret.match(/.{1,4}/g).join(' ');

    return {
      success: true,
      qrCodeDataUrl,
      manualEntryKey: formattedKey,
    };
  } catch (error) {
    console.error('Error setting up 2FA:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to set up two-factor authentication.');
  }
});

/**
 * Step 2 of 2FA Setup: Verify the first code and activate 2FA.
 * The admin enters a code from their authenticator app to prove they set it up correctly.
 * On success, 2FA is enabled and 8 backup codes are generated.
 */
exports.verifyAndEnable2FA = onCall(async (request) => {
  try {
    await verifyAdminCaller(request.auth);
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code || code.length !== 6) {
      throw new HttpsError('invalid-argument', 'Please enter a valid 6-digit code.');
    }

    // Get the pending secret
    const tfaDoc = await db.doc(`admin2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.pendingSecret) {
      throw new HttpsError('failed-precondition', 'No pending 2FA setup found. Please start the setup again.');
    }

    // Check if pending secret is expired (10 minutes)
    if (tfaData.pendingCreatedAt) {
      const createdAt = tfaData.pendingCreatedAt.toDate ? tfaData.pendingCreatedAt.toDate() : new Date(tfaData.pendingCreatedAt);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (createdAt < tenMinutesAgo) {
        throw new HttpsError('failed-precondition', 'Setup has expired. Please start again.');
      }
    }

    // Verify the code against the pending secret
    const isValid = verifySync({ secret: tfaData.pendingSecret, token: code }).valid;

    if (!isValid) {
      throw new HttpsError('invalid-argument', 'Incorrect code. Make sure the code from your authenticator app matches and try again.');
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes();

    // Activate 2FA: move secret to permanent, store backup codes, clear pending
    await db.doc(`admin2FA/${uid}`).set({
      secret: tfaData.pendingSecret,
      enabled: true,
      enabledAt: FieldValue.serverTimestamp(),
      backupCodes: backupCodes.map(c => ({ code: c, used: false })),
      pendingSecret: null,
      pendingCreatedAt: null,
    });

    // Update the admin document so the client knows 2FA is enabled
    await db.doc(`admins/${uid}`).update({
      twoFactorEnabled: true,
    });

    return {
      success: true,
      backupCodes,
    };
  } catch (error) {
    console.error('Error enabling 2FA:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to enable two-factor authentication.');
  }
});

/**
 * Verify a TOTP code during admin login.
 * Accepts either a 6-digit authenticator code or a backup code (XXXX-XXXX format).
 */
exports.verifyAdmin2FACode = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }

    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code) {
      throw new HttpsError('invalid-argument', 'Please enter a code.');
    }

    const tfaDoc = await db.doc(`admin2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.enabled || !tfaData?.secret) {
      throw new HttpsError('failed-precondition', 'Two-factor authentication is not enabled.');
    }

    const trimmedCode = code.trim();

    // Check if it's a backup code (format: XXXX-XXXX)
    if (trimmedCode.includes('-') && trimmedCode.length === 9) {
      const upperCode = trimmedCode.toUpperCase();
      const backupIndex = tfaData.backupCodes.findIndex(
        bc => bc.code === upperCode && !bc.used
      );

      if (backupIndex === -1) {
        throw new HttpsError('invalid-argument', 'Invalid or already used backup code.');
      }

      // Mark backup code as used
      const updatedCodes = [...tfaData.backupCodes];
      updatedCodes[backupIndex] = { ...updatedCodes[backupIndex], used: true, usedAt: new Date().toISOString() };

      await db.doc(`admin2FA/${uid}`).update({
        backupCodes: updatedCodes,
      });

      // Count remaining backup codes
      const remaining = updatedCodes.filter(bc => !bc.used).length;

      return { success: true, method: 'backup', remainingBackupCodes: remaining };
    }

    // Standard 6-digit TOTP code
    if (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      throw new HttpsError('invalid-argument', 'Please enter a valid 6-digit code from your authenticator app.');
    }

    const isValid = verifySync({ secret: tfaData.secret, token: trimmedCode }).valid;

    if (!isValid) {
      throw new HttpsError('invalid-argument', 'Incorrect code. Please check your authenticator app and try again.');
    }

    return { success: true, method: 'totp' };
  } catch (error) {
    console.error('Error verifying 2FA code:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to verify code.');
  }
});

/**
 * Disable 2FA for an admin. Requires a valid TOTP or backup code to confirm.
 */
exports.disableAdmin2FA = onCall(async (request) => {
  try {
    await verifyAdminCaller(request.auth);
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code) {
      throw new HttpsError('invalid-argument', 'Please enter your authenticator code to disable 2FA.');
    }

    const tfaDoc = await db.doc(`admin2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.enabled || !tfaData?.secret) {
      throw new HttpsError('failed-precondition', 'Two-factor authentication is not currently enabled.');
    }

    const trimmedCode = code.trim();

    // Verify with TOTP code
    let verified = false;
    if (trimmedCode.length === 6 && /^\d{6}$/.test(trimmedCode)) {
      verified = verifySync({ secret: tfaData.secret, token: trimmedCode }).valid;
    }

    // Or verify with backup code
    if (!verified && trimmedCode.includes('-') && trimmedCode.length === 9) {
      const upperCode = trimmedCode.toUpperCase();
      verified = tfaData.backupCodes.some(bc => bc.code === upperCode && !bc.used);
    }

    if (!verified) {
      throw new HttpsError('invalid-argument', 'Incorrect code. Cannot disable 2FA without a valid code.');
    }

    // Disable 2FA
    await db.doc(`admin2FA/${uid}`).delete();

    // Update admin document
    await db.doc(`admins/${uid}`).update({
      twoFactorEnabled: false,
    });

    return { success: true };
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to disable two-factor authentication.');
  }
});

/**
 * Regenerate backup codes for an admin with 2FA enabled.
 * Old backup codes are replaced. Requires a valid TOTP code to confirm.
 */
exports.regenerateBackupCodes = onCall(async (request) => {
  try {
    await verifyAdminCaller(request.auth);
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'Please enter a valid 6-digit code from your authenticator app.');
    }

    const tfaDoc = await db.doc(`admin2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.enabled || !tfaData?.secret) {
      throw new HttpsError('failed-precondition', 'Two-factor authentication is not enabled.');
    }

    const isValid = verifySync({ secret: tfaData.secret, token: code }).valid;
    if (!isValid) {
      throw new HttpsError('invalid-argument', 'Incorrect code.');
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes();

    await db.doc(`admin2FA/${uid}`).update({
      backupCodes: backupCodes.map(c => ({ code: c, used: false })),
    });

    return { success: true, backupCodes };
  } catch (error) {
    console.error('Error regenerating backup codes:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to regenerate backup codes.');
  }
});

// ============================================
// RESTAURANT USER TWO-FACTOR AUTHENTICATION
// ============================================
// Mirrors admin 2FA but uses restaurant2FA/{uid} collection
// and restaurants/{uid}.twoFactorEnabled flag.

/**
 * Step 1 of restaurant 2FA setup: Generate TOTP secret and QR code.
 */
exports.setupRestaurant2FA = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const db = admin.firestore();

    // Get restaurant name for the authenticator label
    const restaurantDoc = await db.doc(`restaurants/${uid}`).get();
    const accountName = restaurantDoc.data()?.email || request.auth.token.email || 'Restaurant';

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: 'Koda Carte', label: accountName, secret, type: 'totp' });

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    await db.doc(`restaurant2FA/${uid}`).set({
      pendingSecret: secret,
      pendingCreatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const formattedKey = secret.match(/.{1,4}/g).join(' ');

    return { success: true, qrCodeDataUrl, manualEntryKey: formattedKey };
  } catch (error) {
    console.error('Error setting up restaurant 2FA:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to set up two-factor authentication.');
  }
});

/**
 * Step 2: Verify the first code and activate restaurant 2FA.
 */
exports.verifyAndEnableRestaurant2FA = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code || code.length !== 6) {
      throw new HttpsError('invalid-argument', 'Please enter a valid 6-digit code.');
    }

    const tfaDoc = await db.doc(`restaurant2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.pendingSecret) {
      throw new HttpsError('failed-precondition', 'No pending 2FA setup found. Please start the setup again.');
    }

    if (tfaData.pendingCreatedAt) {
      const createdAt = tfaData.pendingCreatedAt.toDate ? tfaData.pendingCreatedAt.toDate() : new Date(tfaData.pendingCreatedAt);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (createdAt < tenMinutesAgo) {
        throw new HttpsError('failed-precondition', 'Setup has expired. Please start again.');
      }
    }

    const isValid = verifySync({ secret: tfaData.pendingSecret, token: code }).valid;

    if (!isValid) {
      throw new HttpsError('invalid-argument', 'Incorrect code. Make sure the code from your authenticator app matches and try again.');
    }

    const backupCodes = generateBackupCodes();

    await db.doc(`restaurant2FA/${uid}`).set({
      secret: tfaData.pendingSecret,
      enabled: true,
      enabledAt: FieldValue.serverTimestamp(),
      backupCodes: backupCodes.map(c => ({ code: c, used: false })),
      pendingSecret: null,
      pendingCreatedAt: null,
    });

    await db.doc(`restaurants/${uid}`).update({
      twoFactorEnabled: true,
    });

    return { success: true, backupCodes };
  } catch (error) {
    console.error('Error enabling restaurant 2FA:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to enable two-factor authentication.');
  }
});

/**
 * Verify a restaurant user's TOTP or backup code during login.
 */
exports.verifyRestaurant2FACode = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code) {
      throw new HttpsError('invalid-argument', 'Please enter a code.');
    }

    const tfaDoc = await db.doc(`restaurant2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.enabled || !tfaData?.secret) {
      throw new HttpsError('failed-precondition', 'Two-factor authentication is not enabled.');
    }

    const trimmedCode = code.trim();

    // Check backup code (XXXX-XXXX format)
    if (trimmedCode.includes('-') && trimmedCode.length === 9) {
      const upperCode = trimmedCode.toUpperCase();
      const backupIndex = tfaData.backupCodes.findIndex(
        bc => bc.code === upperCode && !bc.used
      );

      if (backupIndex === -1) {
        throw new HttpsError('invalid-argument', 'Invalid or already used backup code.');
      }

      const updatedCodes = [...tfaData.backupCodes];
      updatedCodes[backupIndex] = { ...updatedCodes[backupIndex], used: true, usedAt: new Date().toISOString() };

      await db.doc(`restaurant2FA/${uid}`).update({ backupCodes: updatedCodes });

      const remaining = updatedCodes.filter(bc => !bc.used).length;
      return { success: true, method: 'backup', remainingBackupCodes: remaining };
    }

    // Standard 6-digit TOTP code
    if (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      throw new HttpsError('invalid-argument', 'Please enter a valid 6-digit code from your authenticator app.');
    }

    const isValid = verifySync({ secret: tfaData.secret, token: trimmedCode }).valid;

    if (!isValid) {
      throw new HttpsError('invalid-argument', 'Incorrect code. Please check your authenticator app and try again.');
    }

    return { success: true, method: 'totp' };
  } catch (error) {
    console.error('Error verifying restaurant 2FA code:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to verify code.');
  }
});

/**
 * Disable restaurant 2FA. Requires a valid TOTP or backup code.
 */
exports.disableRestaurant2FA = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code) {
      throw new HttpsError('invalid-argument', 'Please enter your authenticator code to disable 2FA.');
    }

    const tfaDoc = await db.doc(`restaurant2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.enabled || !tfaData?.secret) {
      throw new HttpsError('failed-precondition', 'Two-factor authentication is not currently enabled.');
    }

    const trimmedCode = code.trim();
    let verified = false;

    if (trimmedCode.length === 6 && /^\d{6}$/.test(trimmedCode)) {
      verified = verifySync({ secret: tfaData.secret, token: trimmedCode }).valid;
    }

    if (!verified && trimmedCode.includes('-') && trimmedCode.length === 9) {
      const upperCode = trimmedCode.toUpperCase();
      verified = tfaData.backupCodes.some(bc => bc.code === upperCode && !bc.used);
    }

    if (!verified) {
      throw new HttpsError('invalid-argument', 'Incorrect code. Cannot disable 2FA without a valid code.');
    }

    await db.doc(`restaurant2FA/${uid}`).delete();
    await db.doc(`restaurants/${uid}`).update({ twoFactorEnabled: false });

    return { success: true };
  } catch (error) {
    console.error('Error disabling restaurant 2FA:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to disable two-factor authentication.');
  }
});

/**
 * Regenerate backup codes for a restaurant user with 2FA enabled.
 */
exports.regenerateRestaurantBackupCodes = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }
    const uid = request.auth.uid;
    const { code } = request.data;
    const db = admin.firestore();

    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      throw new HttpsError('invalid-argument', 'Please enter a valid 6-digit code from your authenticator app.');
    }

    const tfaDoc = await db.doc(`restaurant2FA/${uid}`).get();
    const tfaData = tfaDoc.data();

    if (!tfaData?.enabled || !tfaData?.secret) {
      throw new HttpsError('failed-precondition', 'Two-factor authentication is not enabled.');
    }

    const isValid = verifySync({ secret: tfaData.secret, token: code }).valid;
    if (!isValid) {
      throw new HttpsError('invalid-argument', 'Incorrect code.');
    }

    const backupCodes = generateBackupCodes();

    await db.doc(`restaurant2FA/${uid}`).update({
      backupCodes: backupCodes.map(c => ({ code: c, used: false })),
    });

    return { success: true, backupCodes };
  } catch (error) {
    console.error('Error regenerating restaurant backup codes:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Failed to regenerate backup codes.');
  }
});

// ============================================
// TWITTER/X INTEGRATION (OAuth 2.0 with PKCE)
// ============================================

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';

/**
 * Initiate Twitter/X OAuth 2.0 PKCE flow
 * Returns the authorization URL for the user to visit
 */
exports.initiateTwitterAuth = onCall({ secrets: [twitterClientId, twitterClientSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const clientId = twitterClientId.value();
  if (!clientId) {
    return { success: false, error: 'not_configured', message: 'Twitter API credentials not configured. Please contact support.' };
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  // Generate PKCE code verifier and challenge
  const crypto = require('crypto');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  // Store the code verifier and state for later verification
  await db.doc(`twitterAuth/${uid}`).set({
    codeVerifier,
    state,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minute expiry
  });

  // Determine callback URL based on environment
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const callbackUrl = isEmulator
    ? `http://localhost:5001/${PROJECT_ID}/us-central1/handleTwitterCallback`
    : `${getApiBaseUrl()}/handleTwitterCallback`;

  const authUrl = `${TWITTER_AUTH_URL}?` + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'tweet.read tweet.write users.read offline.access',
    state: `${uid}:${state}`,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  return { success: true, authUrl };
});

/**
 * Handle Twitter/X OAuth callback
 * Exchanges authorization code for access/refresh tokens
 */
exports.handleTwitterCallback = onRequest({ secrets: [twitterClientId, twitterClientSecret], cors: true }, async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${getAppUrl()}?twitter_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !state) {
    return res.redirect(`${getAppUrl()}?twitter_error=missing_params`);
  }

  // Parse state to get uid
  const [uid, stateToken] = state.split(':');
  if (!uid || !stateToken) {
    return res.redirect(`${getAppUrl()}?twitter_error=invalid_state`);
  }

  const db = admin.firestore();

  try {
    // Retrieve and validate the stored auth data
    const authDoc = await db.doc(`twitterAuth/${uid}`).get();
    if (!authDoc.exists) {
      return res.redirect(`${getAppUrl()}?twitter_error=session_expired`);
    }

    const authData = authDoc.data();
    if (authData.state !== stateToken) {
      return res.redirect(`${getAppUrl()}?twitter_error=state_mismatch`);
    }

    if (authData.expiresAt.toDate() < new Date()) {
      await db.doc(`twitterAuth/${uid}`).delete();
      return res.redirect(`${getAppUrl()}?twitter_error=session_expired`);
    }

    // Determine callback URL (must match what was used in authorize)
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    const callbackUrl = isEmulator
      ? `http://localhost:5001/${PROJECT_ID}/us-central1/handleTwitterCallback`
      : `${getApiBaseUrl()}/handleTwitterCallback`;

    const clientId = twitterClientId.value();
    const clientSecret = twitterClientSecret.value();

    // Exchange code for tokens
    const tokenResponse = await axios.post(
      TWITTER_TOKEN_URL,
      new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        code_verifier: authData.codeVerifier
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user profile info from Twitter
    const profileResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    const twitterUser = profileResponse.data.data;

    // Store connection data in Firestore
    await db.doc(`restaurants/${uid}/settings/socialMedia`).set({
      twitter: {
        connected: true,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
        twitterUserId: twitterUser.id,
        twitterUsername: twitterUser.username,
        twitterName: twitterUser.name,
        connectedAt: new Date().toISOString()
      }
    }, { merge: true });

    // Clean up auth session
    await db.doc(`twitterAuth/${uid}`).delete();

    // Redirect back to the app with success
    const appUrl = isEmulator ? 'http://localhost:3000' : getAppBaseUrl();
    return res.redirect(`${appUrl}/seo-social?twitter_connected=true`);
  } catch (error) {
    console.error('Twitter OAuth callback error:', error.response?.data || error.message);
    const appUrl = process.env.FUNCTIONS_EMULATOR === 'true'
      ? 'http://localhost:3000'
      : getAppBaseUrl();
    return res.redirect(`${appUrl}/seo-social?twitter_error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * Helper to get app URL
 */
function getAppUrl() {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  return isEmulator ? 'http://localhost:3000' : getAppBaseUrl();
}

/**
 * Refresh Twitter/X access token using refresh token
 */
async function refreshTwitterToken(uid, refreshToken) {
  const clientId = twitterClientId.value();
  const clientSecret = twitterClientSecret.value();

  const tokenResponse = await axios.post(
    TWITTER_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      }
    }
  );

  const { access_token, refresh_token: newRefreshToken, expires_in } = tokenResponse.data;

  // Update stored tokens
  const db = admin.firestore();
  await db.doc(`restaurants/${uid}/settings/socialMedia`).set({
    twitter: {
      accessToken: access_token,
      refreshToken: newRefreshToken || refreshToken,
      expiresAt: new Date(Date.now() + expires_in * 1000).toISOString()
    }
  }, { merge: true });

  return access_token;
}

/**
 * Post a tweet on behalf of the user
 */
exports.postTweet = onCall({ secrets: [twitterClientId, twitterClientSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { content, imageUrl } = request.data;

  if (!content || !content.trim()) {
    throw new HttpsError('invalid-argument', 'Tweet content is required');
  }

  const db = admin.firestore();

  try {
    // Get user's Twitter connection
    const socialDoc = await db.doc(`restaurants/${uid}/settings/socialMedia`).get();
    if (!socialDoc.exists || !socialDoc.data().twitter?.connected) {
      throw new HttpsError('failed-precondition', 'Twitter/X is not connected. Please connect your account first.');
    }

    const twitter = socialDoc.data().twitter;
    let accessToken = twitter.accessToken;

    // Check if token is expired and refresh if needed
    if (twitter.expiresAt && new Date(twitter.expiresAt) < new Date()) {
      if (!twitter.refreshToken) {
        throw new HttpsError('failed-precondition', 'Twitter session expired. Please reconnect your account.');
      }
      accessToken = await refreshTwitterToken(uid, twitter.refreshToken);
    }

    // Post the tweet
    const result = await postToTwitter({ content, imageUrl }, accessToken);
    return { success: true, tweetId: result.data?.id };
  } catch (error) {
    console.error('Error posting tweet:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', `Failed to post tweet: ${error.message}`);
  }
});

/**
 * Disconnect Twitter/X account
 */
exports.disconnectTwitter = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  try {
    await db.doc(`restaurants/${uid}/settings/socialMedia`).set({
      twitter: {
        connected: false,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        twitterUserId: null,
        twitterUsername: null,
        twitterName: null,
        disconnectedAt: new Date().toISOString()
      }
    }, { merge: true });

    return { success: true };
  } catch (error) {
    console.error('Error disconnecting Twitter:', error);
    throw new HttpsError('internal', 'Failed to disconnect Twitter/X');
  }
});

/**
 * Get Twitter/X connection status
 */
exports.getTwitterStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  try {
    const socialDoc = await db.doc(`restaurants/${uid}/settings/socialMedia`).get();
    if (!socialDoc.exists || !socialDoc.data().twitter) {
      return { connected: false };
    }

    const twitter = socialDoc.data().twitter;
    return {
      connected: twitter.connected || false,
      username: twitter.twitterUsername || null,
      name: twitter.twitterName || null,
      connectedAt: twitter.connectedAt || null
    };
  } catch (error) {
    console.error('Error getting Twitter status:', error);
    throw new HttpsError('internal', 'Failed to get Twitter status');
  }
});

// ============================================
// STAFF ACCESS CONTROL
// ============================================

const crypto = require('crypto');

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Create a staff account for a restaurant
 * Creates a Firebase Auth user + Firestore record with permissions
 */
exports.createStaffAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const ownerUid = request.auth.uid;
  const { username, password, displayName, permissions } = request.data;

  if (!username || !password || !displayName || !permissions) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }
  if (username.length < 3) {
    throw new HttpsError('invalid-argument', 'Username must be at least 3 characters');
  }
  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters');
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new HttpsError('invalid-argument', 'Must select at least one permission');
  }

  const db = admin.firestore();

  // Check for duplicate username within this restaurant
  const existing = await db.collection(`restaurants/${ownerUid}/staffAccounts`)
    .where('usernameLower', '==', username.toLowerCase())
    .limit(1).get();
  if (!existing.empty) {
    throw new HttpsError('already-exists', 'A staff account with this username already exists');
  }

  // Create Firebase Auth user with synthetic email
  const syntheticEmail = `${username.toLowerCase()}.staff.${ownerUid}@kodacarte.local`;
  let staffUser;
  try {
    staffUser = await admin.auth().createUser({
      email: syntheticEmail,
      password: password,
      displayName: displayName
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'This staff username is already taken');
    }
    throw new HttpsError('internal', safeError(err, 'Failed to create staff auth account'));
  }

  // Set custom claims
  await admin.auth().setCustomUserClaims(staffUser.uid, {
    isStaff: true,
    restaurantId: ownerUid,
    permissions: permissions
  });

  // Hash password for Firestore record (backup verification)
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  // Store staff record
  await db.doc(`restaurants/${ownerUid}/staffAccounts/${staffUser.uid}`).set({
    username: username,
    usernameLower: username.toLowerCase(),
    displayName: displayName,
    email: syntheticEmail,
    permissions: permissions,
    active: true,
    authUid: staffUser.uid,
    passwordHash: passwordHash,
    passwordSalt: salt,
    createdAt: FieldValue.serverTimestamp(),
    lastLogin: null
  });

  return {
    success: true,
    staffId: staffUser.uid,
    message: `Staff account "${username}" created successfully`
  };
});

/**
 * Update a staff account's permissions, name, or password
 */
exports.updateStaffAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const ownerUid = request.auth.uid;
  const { staffId, displayName, permissions, newPassword, active } = request.data;

  if (!staffId) {
    throw new HttpsError('invalid-argument', 'Staff ID is required');
  }

  const db = admin.firestore();
  const staffRef = db.doc(`restaurants/${ownerUid}/staffAccounts/${staffId}`);
  const staffDoc = await staffRef.get();

  if (!staffDoc.exists) {
    throw new HttpsError('not-found', 'Staff account not found');
  }

  const updates = { updatedAt: FieldValue.serverTimestamp() };

  if (displayName !== undefined) {
    updates.displayName = displayName;
    await admin.auth().updateUser(staffId, { displayName });
  }

  if (permissions !== undefined && Array.isArray(permissions)) {
    updates.permissions = permissions;
    // Update custom claims
    const currentClaims = (await admin.auth().getUser(staffId)).customClaims || {};
    await admin.auth().setCustomUserClaims(staffId, {
      ...currentClaims,
      permissions: permissions
    });
  }

  if (newPassword) {
    if (newPassword.length < 6) {
      throw new HttpsError('invalid-argument', 'Password must be at least 6 characters');
    }
    await admin.auth().updateUser(staffId, { password: newPassword });
    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    updates.passwordHash = passwordHash;
    updates.passwordSalt = salt;
  }

  if (active !== undefined) {
    updates.active = active;
    await admin.auth().updateUser(staffId, { disabled: !active });
  }

  await staffRef.update(updates);

  return { success: true, message: 'Staff account updated' };
});

/**
 * Delete a staff account
 */
exports.deleteStaffAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const ownerUid = request.auth.uid;
  const { staffId } = request.data;

  if (!staffId) {
    throw new HttpsError('invalid-argument', 'Staff ID is required');
  }

  const db = admin.firestore();
  const staffRef = db.doc(`restaurants/${ownerUid}/staffAccounts/${staffId}`);
  const staffDoc = await staffRef.get();

  if (!staffDoc.exists) {
    throw new HttpsError('not-found', 'Staff account not found');
  }

  // Delete Firebase Auth user
  try {
    await admin.auth().deleteUser(staffId);
  } catch (err) {
    console.error('Error deleting staff auth user:', err);
  }

  // Delete Firestore record
  await staffRef.delete();

  return { success: true, message: 'Staff account deleted' };
});

/**
 * Look up staff email by username (for login)
 */
exports.lookupStaffEmail = onRequest(async (req, res) => {
  return cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      // Rate limit: 10 lookups per IP per minute
      const ip = getClientIp(req);
      if (!checkRateLimit(`staff_lookup_${ip}`, 10, 60000)) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      const { username } = req.body;
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
      }

      const db = admin.firestore();

      // Search all restaurants for a staff account with this username
      const restaurantsSnapshot = await db.collectionGroup('staffAccounts')
        .where('usernameLower', '==', username.toLowerCase())
        .where('active', '==', true)
        .limit(1).get();

      if (!restaurantsSnapshot.empty) {
        const staffDoc = restaurantsSnapshot.docs[0];
        const data = staffDoc.data();
        return res.json({
          email: data.email,
          isStaff: true,
          displayName: data.displayName
        });
      }

      return res.status(404).json({ error: 'Staff account not found' });
    } catch (error) {
      console.error('Error looking up staff email:', error);
      return res.status(500).json({ error: 'Failed to lookup staff account' });
    }
  });
});

// ============================================
// STRIPE CONNECT HELPER
// ============================================

/**
 * Look up a restaurant's connected Stripe account ID.
 * Validates the account is actually accessible via Stripe API.
 * Returns null if not connected or account is invalid (auto-heals stale data).
 */
const _connectCache = {};
async function getStripeConnectAccountId(restaurantId) {
  if (!restaurantId) return null;
  try {
    // Check validation cache (5-minute TTL)
    const cached = _connectCache[restaurantId];
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      return cached.accountId;
    }

    const db = admin.firestore();
    const connectDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).get();
    if (!connectDoc.exists) {
      _connectCache[restaurantId] = { accountId: null, ts: Date.now() };
      return null;
    }
    const data = connectDoc.data();
    if (data.status !== 'active' || !data.stripeAccountId) {
      _connectCache[restaurantId] = { accountId: null, ts: Date.now() };
      return null;
    }

    // Validate the connected account is actually accessible
    try {
      const account = await stripe.accounts.retrieve(data.stripeAccountId);
      if (account.charges_enabled) {
        _connectCache[restaurantId] = { accountId: data.stripeAccountId, ts: Date.now() };
        return data.stripeAccountId;
      }
      // Account exists but charges not enabled
      console.warn(`Connected account ${data.stripeAccountId} has charges disabled, falling back to platform`);
      _connectCache[restaurantId] = { accountId: null, ts: Date.now() };
      return null;
    } catch (stripeErr) {
      // Account is invalid, revoked, or inaccessible — auto-heal
      console.error(`Connected account ${data.stripeAccountId} is invalid: ${stripeErr.message}. Marking as revoked.`);
      await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).update({
        status: 'revoked',
        revokedAt: FieldValue.serverTimestamp(),
        revokedReason: stripeErr.message
      });
      _connectCache[restaurantId] = { accountId: null, ts: Date.now() };
      return null;
    }
  } catch (err) {
    console.error('Error fetching Stripe Connect account:', err);
    return null;
  }
}

/**
 * Resolve the correct restaurantId from auth context.
 * Staff users carry restaurantId in custom claims; owners use their own UID.
 */
function resolveRestaurantId(request) {
  if (request.auth?.token?.isStaff && request.auth?.token?.restaurantId) {
    return request.auth.token.restaurantId;
  }
  return request.auth?.uid || null;
}

// ============================================
// STRIPE CONNECT FUNCTIONS
// ============================================

/**
 * Initiate Stripe Connect onboarding for a restaurant owner.
 * Creates a Standard connected account and returns an Account Link URL.
 */
exports.initiateStripeConnect = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const db = admin.firestore();

    // Check if already connected
    const connectDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).get();
    if (connectDoc.exists && connectDoc.data().status === 'active') {
      throw new HttpsError('already-exists', 'Stripe account is already connected');
    }

    // Get restaurant info for pre-filling
    const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();
    const restaurantData = restaurantDoc.exists ? restaurantDoc.data() : {};

    let stripeAccountId;

    // Reuse existing account if onboarding was started but not completed
    if (connectDoc.exists && connectDoc.data().stripeAccountId) {
      stripeAccountId = connectDoc.data().stripeAccountId;
    } else {
      // Create a new Standard connected account
      const account = await stripe.accounts.create({
        type: 'standard',
        email: restaurantData.email || request.auth.token.email,
        business_profile: {
          name: restaurantData.restaurantName || undefined,
        },
        metadata: {
          restaurantId: restaurantId,
          platform: 'kodacarte'
        }
      });
      stripeAccountId = account.id;
    }

    // Determine return/refresh URLs
    const baseUrl = request.data?.returnUrl || getAppBaseUrl();
    const returnUrl = `${baseUrl}/account?stripe_connect=success&account_id=${stripeAccountId}`;
    const refreshUrl = `${baseUrl}/account?stripe_connect=refresh`;

    // Create an Account Link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    // Save pending state to Firestore
    await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).set({
      stripeAccountId: stripeAccountId,
      status: 'pending',
      initiatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      success: true,
      url: accountLink.url,
      stripeAccountId: stripeAccountId
    };
  } catch (error) {
    console.error('Error initiating Stripe Connect:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Refresh a Stripe Connect onboarding link (if the previous one expired).
 */
exports.refreshStripeConnectLink = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const db = admin.firestore();

    const connectDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).get();
    if (!connectDoc.exists || !connectDoc.data().stripeAccountId) {
      throw new HttpsError('not-found', 'No pending Stripe Connect found. Please start over.');
    }

    const stripeAccountId = connectDoc.data().stripeAccountId;
    const baseUrl = request.data?.returnUrl || getAppBaseUrl();
    const returnUrl = `${baseUrl}/account?stripe_connect=success&account_id=${stripeAccountId}`;
    const refreshUrl = `${baseUrl}/account?stripe_connect=refresh`;

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return {
      success: true,
      url: accountLink.url
    };
  } catch (error) {
    console.error('Error refreshing Stripe Connect link:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Check if a Stripe Connect account has completed onboarding.
 * Called after the user returns from Stripe onboarding.
 */
exports.checkStripeConnectStatus = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const stripeAccountId = request.data?.stripeAccountId;

    if (!stripeAccountId) {
      throw new HttpsError('invalid-argument', 'stripeAccountId is required');
    }

    // Retrieve account from Stripe to check status
    const account = await stripe.accounts.retrieve(stripeAccountId);

    // For Standard accounts, details_submitted is the key indicator.
    // charges_enabled may take a moment to activate after onboarding.
    const isComplete = account.details_submitted;
    const db = admin.firestore();

    if (isComplete) {
      // Mark as active — charges_enabled will be true shortly after details_submitted
      await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).set({
        stripeAccountId: stripeAccountId,
        status: 'active',
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: true,
        businessName: account.business_profile?.name || null,
        connectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      // Still pending — user hasn't finished the Stripe onboarding form
      await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).set({
        stripeAccountId: stripeAccountId,
        status: 'pending',
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: false,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return {
      success: true,
      status: isComplete ? 'active' : 'pending',
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    };
  } catch (error) {
    console.error('Error checking Stripe Connect status:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Get current Stripe Connect status for the restaurant.
 */
exports.getStripeConnectStatus = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const db = admin.firestore();

    const connectDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).get();
    if (!connectDoc.exists) {
      return { connected: false, status: 'not_connected' };
    }

    const data = connectDoc.data();

    // Validate the connected account is actually accessible via Stripe API
    // This catches stale/revoked accounts before the client tries to use them
    if (data.status === 'active' && data.stripeAccountId) {
      const validatedId = await getStripeConnectAccountId(restaurantId);
      if (!validatedId) {
        // Account was invalid — getStripeConnectAccountId already marked it as revoked
        return { connected: false, status: 'revoked', stripeAccountId: null };
      }
    }

    return {
      connected: data.status === 'active',
      status: data.status,
      stripeAccountId: data.stripeAccountId || null,
      chargesEnabled: data.chargesEnabled || false,
      payoutsEnabled: data.payoutsEnabled || false,
      businessName: data.businessName || null,
      connectedAt: data.connectedAt || null
    };
  } catch (error) {
    console.error('Error getting Stripe Connect status:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

/**
 * Disconnect a restaurant's Stripe Connect account.
 */
exports.disconnectStripeConnect = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const db = admin.firestore();

    const connectDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).get();
    if (!connectDoc.exists || !connectDoc.data().stripeAccountId) {
      throw new HttpsError('not-found', 'No Stripe Connect account found');
    }

    const stripeAccountId = connectDoc.data().stripeAccountId;

    // Remove the connection — doesn't delete the Stripe account itself
    await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).set({
      stripeAccountId: null,
      status: 'disconnected',
      disconnectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      previousAccountId: stripeAccountId
    });

    return {
      success: true,
      message: 'Stripe account disconnected. Payments will now go through the platform account.'
    };
  } catch (error) {
    console.error('Error disconnecting Stripe Connect:', error);
    if (error.code) throw error;
    throw new HttpsError('internal', safeError(error));
  }
});

// ============================================
// CUSTOMER REVIEWS
// ============================================

/**
 * Submit a customer review (public HTTP endpoint).
 * Reviews are created with status 'pending' and must be approved by the restaurant admin.
 */
exports.submitReview = onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      // Rate limit: 5 reviews per IP per hour
      const ip = getClientIp(req);
      if (!checkRateLimit(`review_${ip}`, 5, 3600000)) {
        return res.status(429).json({ error: 'Too many review submissions. Please try again later.' });
      }

      const { restaurantId, customerName, customerEmail, rating, reviewText, customerId } = req.body;

      if (!restaurantId || !customerName || !rating || !reviewText) {
        return res.status(400).json({ error: 'Missing required fields: restaurantId, customerName, rating, reviewText' });
      }

      const numRating = parseInt(rating);
      if (isNaN(numRating) || numRating < 1 || numRating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      if (reviewText.length > 1000) {
        return res.status(400).json({ error: 'Review text must be 1000 characters or less' });
      }

      const db = admin.firestore();

      // Verify restaurant exists
      const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();
      if (!restaurantDoc.exists) {
        return res.status(404).json({ error: 'Restaurant not found' });
      }

      const reviewDoc = {
        customerName: customerName.trim(),
        customerEmail: customerEmail ? customerEmail.trim() : null,
        customerId: customerId || null,
        rating: numRating,
        reviewText: reviewText.trim(),
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };

      const docRef = await db.collection(`restaurants/${restaurantId}/reviews`).add(reviewDoc);

      return res.status(201).json({
        success: true,
        message: 'Review submitted! It will be visible after approval.',
        reviewId: docRef.id
      });
    } catch (error) {
      console.error('Error submitting review:', error);
      return res.status(500).json({ error: 'Failed to submit review' });
    }
  });
});

/**
 * Get approved reviews for a restaurant (public HTTP endpoint).
 */
exports.getApprovedReviews = onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const restaurantId = req.query.restaurantId;
      if (!restaurantId) {
        return res.status(400).json({ error: 'restaurantId query parameter is required' });
      }

      const db = admin.firestore();
      const snapshot = await db.collection(`restaurants/${restaurantId}/reviews`)
        .where('status', '==', 'approved')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const reviews = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        reviews.push({
          id: doc.id,
          customerName: data.customerName,
          rating: data.rating,
          reviewText: data.reviewText,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
        });
      });

      return res.json({ success: true, reviews });
    } catch (error) {
      console.error('Error fetching reviews:', error);
      return res.status(500).json({ error: 'Failed to fetch reviews' });
    }
  });
});

// ============================================
// STRIPE TERMINAL FUNCTIONS
// ============================================

// Duplicate createTerminalConnectionToken removed — the version at line ~4507 is the canonical one.

// Duplicate createTerminalLocation removed — the version at line ~4532 is the canonical one.

/**
 * Register a Stripe Terminal reader using a registration code.
 * The registration code is displayed on the reader screen during setup.
 */
exports.registerTerminalReader = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const { registrationCode, label } = request.data;

    if (!registrationCode) {
      throw new HttpsError('invalid-argument', 'Registration code is required');
    }

    const db = admin.firestore();
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    // Get the terminal location
    const terminalDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeTerminal`).get();
    if (!terminalDoc.exists || !terminalDoc.data().stripeLocationId) {
      throw new HttpsError('failed-precondition', 'Terminal location must be set up first');
    }

    const locationId = terminalDoc.data().stripeLocationId;

    const reader = await stripe.terminal.readers.create({
      registration_code: registrationCode,
      label: label || 'POS Reader',
      location: locationId,
      metadata: {
        restaurantId: restaurantId,
        platform: 'kodacarte'
      }
    }, stripeOptions);

    return {
      success: true,
      readerId: reader.id,
      label: reader.label,
      deviceType: reader.device_type,
      status: reader.status
    };
  } catch (error) {
    console.error('Error registering terminal reader:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to register reader'));
  }
});

/**
 * List all Stripe Terminal readers for a restaurant's location.
 */
exports.listTerminalReaders = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = resolveRestaurantId(request);
    const db = admin.firestore();
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    const terminalDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeTerminal`).get();
    if (!terminalDoc.exists || !terminalDoc.data().stripeLocationId) {
      return { readers: [] };
    }

    const locationId = terminalDoc.data().stripeLocationId;

    const readers = await stripe.terminal.readers.list({
      location: locationId,
      limit: 100
    }, stripeOptions);

    const BLUETOOTH_TYPES = new Set(['bbpos_chipper2x', 'stripe_m2', 'bbpos_wisepad3']);

    return {
      readers: readers.data.map(r => ({
        id: r.id,
        label: r.label,
        deviceType: r.device_type,
        connectionType: BLUETOOTH_TYPES.has(r.device_type) ? 'bluetooth'
                      : r.device_type?.startsWith('simulated_') ? 'simulated'
                      : 'internet',
        status: r.status,
        ipAddress: r.ip_address,
        serialNumber: r.serial_number
      }))
    };
  } catch (error) {
    console.error('Error listing terminal readers:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to list readers'));
  }
});

/**
 * Delete a Stripe Terminal reader.
 */
exports.deleteTerminalReader = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { readerId } = request.data;
    if (!readerId) {
      throw new HttpsError('invalid-argument', 'Reader ID is required');
    }

    const restaurantId = request.auth.uid;
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    await stripe.terminal.readers.del(readerId, stripeOptions);
    return { success: true };
  } catch (error) {
    console.error('Error deleting terminal reader:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to delete reader'));
  }
});

/**
 * Get the Stripe Terminal configuration for a restaurant.
 */
exports.getTerminalConfig = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = resolveRestaurantId(request);
    const db = admin.firestore();

    const terminalDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeTerminal`).get();
    if (!terminalDoc.exists) {
      return { configured: false };
    }

    const data = terminalDoc.data();
    return {
      configured: !!data.stripeLocationId,
      stripeLocationId: data.stripeLocationId || null,
      locationDisplayName: data.locationDisplayName || null,
      address: data.address || null
    };
  } catch (error) {
    console.error('Error getting terminal config:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to get terminal config'));
  }
});

/**
 * Create a PaymentIntent for Stripe Terminal (server-driven).
 * Terminal payments use `payment_method_types: ['card_present']`.
 */
exports.createTerminalPaymentIntent = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { amount, orderIds, tableNumbers, restaurantId: reqRestaurantId } = request.data;
    const restaurantId = resolveRestaurantId(request) || reqRestaurantId;

    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Amount must be greater than 0');
    }

    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const amountInCents = Math.round(amount * 100);

    const intentParams = {
      amount: amountInCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        restaurantId: restaurantId,
        orderIds: (orderIds || []).join(','),
        tableNumbers: (tableNumbers || []).join(','),
        source: 'terminal',
        platform: 'kodacarte'
      }
    };

    if (connectedAccountId) {
      intentParams.application_fee_amount = Math.round(amountInCents * 0.029);
    }

    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    const paymentIntent = await stripe.paymentIntents.create(intentParams, stripeOptions);

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    };
  } catch (error) {
    console.error('Error creating terminal payment intent:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to create terminal payment intent'));
  }
});

/**
 * Server-driven: hand a PaymentIntent to a reader for collection.
 * Used for smart readers (WisePOS E, S700) and screenless readers
 * when operating in server-driven mode.
 * The reader will prompt the customer to present their card.
 */
exports.processTerminalPayment = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { readerId, amount, orderIds, tableNumbers, restaurantId: reqRestaurantId } = request.data;
    const restaurantId = resolveRestaurantId(request) || reqRestaurantId;

    if (!readerId) {
      throw new HttpsError('invalid-argument', 'Reader ID is required');
    }
    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Amount must be greater than 0');
    }

    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    const amountInCents = Math.round(amount * 100);

    // 1. Create the PaymentIntent
    const intentParams = {
      amount: amountInCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        restaurantId,
        orderIds: (orderIds || []).join(','),
        tableNumbers: (tableNumbers || []).join(','),
        source: 'terminal_server_driven',
        platform: 'kodacarte'
      }
    };

    if (connectedAccountId) {
      intentParams.application_fee_amount = Math.round(amountInCents * 0.029);
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams, stripeOptions);

    // 2. Hand the PaymentIntent to the reader
    const readerAction = await stripe.terminal.readers.processPaymentIntent(
      readerId,
      { payment_intent: paymentIntent.id },
      stripeOptions
    );

    return {
      paymentIntentId: paymentIntent.id,
      readerId: readerAction.id,
      readerAction: readerAction.action?.type || 'process_payment_intent',
      status: readerAction.action?.status || 'in_progress'
    };
  } catch (error) {
    console.error('Error processing terminal payment:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to process terminal payment'));
  }
});

/**
 * Server-driven: cancel the current reader action.
 */
exports.cancelTerminalAction = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { readerId } = request.data;
    if (!readerId) {
      throw new HttpsError('invalid-argument', 'Reader ID is required');
    }

    const restaurantId = resolveRestaurantId(request);
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    await stripe.terminal.readers.cancelAction(readerId, stripeOptions);
    return { success: true };
  } catch (error) {
    console.error('Error canceling terminal action:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to cancel reader action'));
  }
});

/**
 * Server-driven: poll reader status to check if payment was collected.
 * Returns the reader's current action state and, if done, the PaymentIntent status.
 */
exports.getTerminalReaderStatus = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { readerId, paymentIntentId } = request.data;
    if (!readerId) {
      throw new HttpsError('invalid-argument', 'Reader ID is required');
    }

    const restaurantId = resolveRestaurantId(request);
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    const reader = await stripe.terminal.readers.retrieve(readerId, stripeOptions);

    const result = {
      readerId: reader.id,
      status: reader.status,
      actionType: reader.action?.type || null,
      actionStatus: reader.action?.status || null,
    };

    // If we have a paymentIntentId, check its status too
    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);
      result.paymentIntentStatus = pi.status;
    }

    return result;
  } catch (error) {
    console.error('Error getting reader status:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to get reader status'));
  }
});

/**
 * Create a simulated reader at the restaurant's terminal location.
 * Useful for testing the terminal flow without physical hardware.
 */
exports.createSimulatedReader = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const restaurantId = request.auth.uid;
    const db = admin.firestore();

    const terminalDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeTerminal`).get();
    if (!terminalDoc.exists || !terminalDoc.data().stripeLocationId) {
      throw new HttpsError('failed-precondition', 'Terminal location must be set up first');
    }

    const locationId = terminalDoc.data().stripeLocationId;
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    const reader = await stripe.testHelpers.terminal.readers.create({
      label: 'Simulated Reader',
      location: locationId,
      metadata: { restaurantId, platform: 'kodacarte' }
    }, stripeOptions);

    return {
      success: true,
      readerId: reader.id,
      label: reader.label,
      deviceType: reader.device_type,
      status: reader.status
    };
  } catch (error) {
    console.error('Error creating simulated reader:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to create simulated reader'));
  }
});

/**
 * Simulate a card present event on a simulated reader (test mode only).
 */
exports.simulateTerminalCardPresent = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { readerId } = request.data;
    if (!readerId) {
      throw new HttpsError('invalid-argument', 'Reader ID is required');
    }

    const restaurantId = resolveRestaurantId(request);
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId, stripeOptions);
    return { success: true };
  } catch (error) {
    console.error('Error simulating card present:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to simulate card present'));
  }
});

// ============================================
// CONTACT FORM SUBMISSION
// ============================================
exports.submitContactForm = onCall(async (request) => {
  try {
    // Rate limit: 3 contact form submissions per email per hour
    const { name, email, restaurant, message } = request.data;

    if (!name || !email || !message) {
      throw new HttpsError('invalid-argument', 'Name, email, and message are required');
    }

    // Basic email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email address');
    }

    // Rate limit by email to prevent spam
    if (!checkRateLimit(`contact_${email}`, 3, 3600000)) {
      throw new HttpsError('resource-exhausted', 'Too many submissions. Please try again later.');
    }

    // Save to Firestore
    const contactRef = admin.firestore().collection('contactSubmissions');
    await contactRef.add({
      name,
      email,
      restaurant: restaurant || '',
      message,
      status: 'new',
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error('Error submitting contact form:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to submit contact form'));
  }
});

// ============================================
// CUSTOMER PHONE VERIFICATION (OTP via Plivo; gated by SMS_ENABLED flag)
// ============================================
const { sendSMS } = require('./services/smsService');

/**
 * Send a 6-digit OTP code to a customer's phone number.
 * Stores the code in Firestore with a 10-minute expiry.
 */
exports.sendVerificationCode = onCall(
  { secrets: [plivoAuthId, plivoAuthToken, plivoFromNumber] },
  async (request) => {
    const { phone, restaurantId } = request.data;
    if (!phone) throw new HttpsError('invalid-argument', 'Phone number is required');

    // Rate limit: 3 OTPs per phone per hour to prevent SMS toll fraud
    const phoneKey = phone.replace(/\D/g, '');
    if (!checkRateLimit(`otp_${phoneKey}`, 3, 3600000)) {
      throw new HttpsError('resource-exhausted', 'Too many verification attempts. Please try again later.');
    }

    // Generate 6-digit code using cryptographic randomness
    const crypto = require('crypto');
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) throw new HttpsError('invalid-argument', 'Invalid phone number');

    const otpRef = admin.firestore().collection('phoneVerifications').doc(phoneDigits);
    await otpRef.set({
      code,
      phone,
      restaurantId: restaurantId || null,
      expiresAt: expiresAt.toISOString(),
      attempts: 0,
      verified: false,
      createdAt: FieldValue.serverTimestamp()
    });

    const result = await sendSMS(
      { to: phone, body: `Your Koda Carte verification code is: ${code}. It expires in 10 minutes.` },
      {
        authId: plivoAuthId.value(),
        authToken: plivoAuthToken.value(),
        fromNumber: plivoFromNumber.value()
      }
    );

    if (result.skipped) {
      // SMS is gated off awaiting 10DLC approval. Surface a clear error so
      // the UI can route users to an alternate flow (email verification).
      await otpRef.delete().catch(() => {});
      throw new HttpsError(
        'failed-precondition',
        'SMS verification is temporarily unavailable. Please use email sign-up instead.'
      );
    }

    if (!result.success) {
      console.error('Failed to send OTP SMS:', result.error);
      throw new HttpsError('internal', 'Failed to send verification code. Please try again.');
    }

    console.log(`OTP sent to ${phoneDigits.slice(-4)} for restaurant ${restaurantId}`);
    return { success: true, phoneLastFour: phoneDigits.slice(-4) };
  }
);

/**
 * Verify a customer's OTP code.
 * Returns success if code matches and is not expired.
 */
exports.verifyPhoneCode = onCall(async (request) => {
  const { phone, code } = request.data;
  if (!phone || !code) throw new HttpsError('invalid-argument', 'Phone and code are required');

  const phoneDigits = phone.replace(/\D/g, '');
  const otpRef = admin.firestore().collection('phoneVerifications').doc(phoneDigits);
  const otpDoc = await otpRef.get();

  if (!otpDoc.exists) {
    throw new HttpsError('not-found', 'No verification code found. Please request a new one.');
  }

  const otpData = otpDoc.data();

  // Check expiry
  if (new Date() > new Date(otpData.expiresAt)) {
    await otpRef.delete();
    throw new HttpsError('deadline-exceeded', 'Verification code has expired. Please request a new one.');
  }

  // Check attempts (max 5)
  if (otpData.attempts >= 5) {
    await otpRef.delete();
    throw new HttpsError('resource-exhausted', 'Too many attempts. Please request a new code.');
  }

  // Increment attempts
  await otpRef.update({ attempts: admin.firestore.FieldValue.increment(1) });

  // Verify code
  if (otpData.code !== code.trim()) {
    throw new HttpsError('permission-denied', 'Invalid code. Please try again.');
  }

  // Mark as verified and clean up
  await otpRef.update({ verified: true });

  console.log(`Phone ${phoneDigits.slice(-4)} verified successfully`);
  return { success: true, phone: otpData.phone };
});

// ============================================
// NOTIFICATION SYSTEM — Welcome Email + SMS
// ============================================
const { createNotificationService } = require('./services/notificationService');

/**
 * Firestore trigger: Send welcome email + SMS when a new restaurant signs up.
 * Fires on document creation in the `restaurants` collection.
 */
exports.onRestaurantCreated = onDocumentCreated(
  {
    document: 'restaurants/{restaurantId}',
    secrets: [resendApiKey, plivoAuthId, plivoAuthToken, plivoFromNumber]
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const restaurantId = event.params.restaurantId;
    console.log(`New restaurant signup: ${data.restaurantName || restaurantId}`);

    const notifier = createNotificationService({
      resendApiKey: resendApiKey.value(),
      plivoAuthId: plivoAuthId.value(),
      plivoAuthToken: plivoAuthToken.value(),
      plivoFromNumber: plivoFromNumber.value()
    });

    const results = await notifier.sendWelcomeRestaurant({
      restaurantName: data.restaurantName || 'Restaurant',
      email: data.email,
      phone: data.phone || null,
      tier: data.subscription?.tier || 'scout',
      username: data.username
    });

    // Log the notification results to the restaurant's activity
    try {
      await admin.firestore()
        .collection(`restaurants/${restaurantId}/activities`)
        .add({
          type: 'welcome_notification',
          message: `Welcome notifications sent — Email: ${results.email?.success ? 'Delivered' : 'Failed'}, SMS: ${results.sms?.success ? 'Delivered' : data.phone ? 'Failed' : 'No phone'}`,
          emailId: results.email?.id || null,
          smsSid: results.sms?.sid || null,
          createdAt: FieldValue.serverTimestamp()
        });
    } catch (err) {
      console.error('Error logging notification activity:', err);
    }
  }
);

// ============================================
// ORDER COMPLETION — RECEIPT NOTIFICATIONS
// ============================================

/**
 * Firestore trigger: when an order status changes to 'completed',
 * send a receipt to the customer via email and/or SMS.
 */
exports.onOrderCompleted = onDocumentUpdated(
  {
    document: 'restaurants/{restaurantId}/orders/{orderId}',
    secrets: [resendApiKey, plivoAuthId, plivoAuthToken, plivoFromNumber]
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Only fire when status transitions TO 'completed'
    if (before.status === 'completed' || after.status !== 'completed') return;

    const restaurantId = event.params.restaurantId;
    const orderId = event.params.orderId;

    console.log(`Order completed: ${orderId} for restaurant ${restaurantId}`);

    // Get customer contact info from the order
    const customerEmail = after.customer?.email || null;
    const customerPhone = after.customer?.phone || null;

    // No contact info — nothing to send
    if (!customerEmail && !customerPhone) {
      console.log(`No customer contact info for order ${orderId}, skipping receipt`);
      return;
    }

    // Get restaurant name
    let restaurantName = 'Restaurant';
    try {
      const restaurantDoc = await admin.firestore().doc(`restaurants/${restaurantId}`).get();
      if (restaurantDoc.exists) {
        restaurantName = restaurantDoc.data().restaurantName || 'Restaurant';
      }
    } catch (err) {
      console.error('Error fetching restaurant name:', err);
    }

    // Get customer's receipt preference (default to email)
    let receiptPreference = 'email';
    if (after.customerId) {
      try {
        const customerDoc = await admin.firestore()
          .doc(`restaurants/${restaurantId}/customers/${after.customerId}`)
          .get();
        if (customerDoc.exists && customerDoc.data().receiptPreference) {
          receiptPreference = customerDoc.data().receiptPreference;
        }
      } catch (err) {
        console.error('Error fetching customer preference:', err);
      }
    }
    // If customer only has phone and no email, default to SMS
    if (!customerEmail && customerPhone) {
      receiptPreference = 'sms';
    }

    const notifier = createNotificationService({
      resendApiKey: resendApiKey.value(),
      plivoAuthId: plivoAuthId.value(),
      plivoAuthToken: plivoAuthToken.value(),
      plivoFromNumber: plivoFromNumber.value()
    });

    try {
      const results = await notifier.sendOrderReceipt({
        order: after,
        restaurantName,
        customerEmail,
        customerPhone,
        receiptPreference
      });

      // Log receipt activity
      await admin.firestore()
        .collection(`restaurants/${restaurantId}/activities`)
        .add({
          type: 'receipt_sent',
          orderId,
          orderNumber: after.orderNumber || orderId,
          message: `Receipt sent — Email: ${results.email?.success ? 'Delivered' : customerEmail ? 'Failed' : 'N/A'}, SMS: ${results.sms?.success ? 'Delivered' : customerPhone ? 'Failed' : 'N/A'}`,
          emailId: results.email?.id || null,
          smsSid: results.sms?.sid || null,
          receiptPreference,
          createdAt: FieldValue.serverTimestamp()
        });
    } catch (err) {
      console.error(`Error sending receipt for order ${orderId}:`, err);
    }
  }
);

// ========================================
// Send Receipt On Demand (Email / SMS)
// ========================================
exports.sendReceiptOnDemand = onCall(
  { secrets: [resendApiKey, plivoAuthId, plivoAuthToken, plivoFromNumber] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

    const { receiptData, deliveryMethod, customerEmail, customerPhone } = request.data;
    if (!receiptData) throw new HttpsError('invalid-argument', 'receiptData is required');
    if (!deliveryMethod || !['email', 'sms'].includes(deliveryMethod)) {
      throw new HttpsError('invalid-argument', 'deliveryMethod must be email or sms');
    }
    if (deliveryMethod === 'email' && !customerEmail) {
      throw new HttpsError('invalid-argument', 'customerEmail is required for email delivery');
    }
    if (deliveryMethod === 'sms' && !customerPhone) {
      throw new HttpsError('invalid-argument', 'customerPhone is required for SMS delivery');
    }

    const { SMS_ENABLED } = require('./services/smsService');
    if (deliveryMethod === 'sms' && !SMS_ENABLED) {
      throw new HttpsError(
        'failed-precondition',
        'SMS delivery is temporarily unavailable. Please use email instead.'
      );
    }

    const notifier = createNotificationService({
      resendApiKey: resendApiKey.value(),
      plivoAuthId: plivoAuthId.value(),
      plivoAuthToken: plivoAuthToken.value(),
      plivoFromNumber: plivoFromNumber.value()
    });

    // Build order-like object for the notification service
    const order = {
      orderNumber: (receiptData.orderNumbers || []).join(', '),
      items: receiptData.items || [],
      subtotal: receiptData.subtotal || 0,
      tax: receiptData.taxAmount || 0,
      total: receiptData.total || 0,
      taxRate: receiptData.taxRate || 0,
      paymentMethod: receiptData.paymentMethod || 'cash',
      promoDiscount: receiptData.discountAmount || 0,
      orderType: 'dine_in',
      createdAt: receiptData.paidAt || new Date().toISOString()
    };

    const results = await notifier.sendOrderReceipt({
      order,
      restaurantName: receiptData.restaurantName || 'Restaurant',
      customerEmail: deliveryMethod === 'email' ? customerEmail : null,
      customerPhone: deliveryMethod === 'sms' ? customerPhone : null,
      receiptPreference: deliveryMethod
    });

    if (deliveryMethod === 'email' && results.email?.success) {
      return { success: true, message: `Receipt sent to ${customerEmail}` };
    }
    if (deliveryMethod === 'sms' && results.sms?.success) {
      return { success: true, message: `Receipt sent to ${customerPhone}` };
    }

    const errorMsg = deliveryMethod === 'email'
      ? (results.email?.error || 'Failed to send email')
      : (results.sms?.error || 'Failed to send SMS');
    throw new HttpsError('internal', errorMsg);
  }
);

// ============================================
// DOORDASH DRIVE DELIVERY FUNCTIONS
// ============================================

/**
 * Get a delivery quote from DoorDash Drive.
 * Called by customer portal when they select "Delivery" and enter an address.
 */
exports.getDeliveryQuote = onRequest({
  secrets: [doordashDeveloperId, doordashKeyId, doordashSigningSecret]
}, (request, response) => {
  cors(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
      }

      // Rate limit: 20 quotes per IP per minute
      const ip = getClientIp(request);
      if (!checkRateLimit(`quote_${ip}`, 20, 60000)) {
        return response.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      const { restaurantId, locationId, dropoffAddress, dropoffPhone, dropoffName, orderValueCents } = request.body;

      if (!restaurantId || !dropoffAddress) {
        return response.status(400).json({ error: 'Missing required fields: restaurantId, dropoffAddress' });
      }

      const db = admin.firestore();

      // Load restaurant data for pickup address
      const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();
      if (!restaurantDoc.exists) {
        return response.status(404).json({ error: 'Restaurant not found' });
      }
      const restaurantData = restaurantDoc.data();

      // Check delivery is enabled
      if (!restaurantData.deliverySettings || !restaurantData.deliverySettings.enabled) {
        return response.status(400).json({ error: 'Delivery is not enabled for this restaurant' });
      }

      // For multi-location, load location-specific address
      let pickupAddress = restaurantData.address || '';
      let pickupPhone = restaurantData.phone || '';
      let pickupName = restaurantData.name || 'Restaurant';
      let pickupInstructions = restaurantData.deliverySettings.pickupInstructions || '';

      if (locationId && locationId !== restaurantId) {
        const locationDoc = await db.doc(`restaurants/${restaurantId}/locations/${locationId}`).get();
        if (locationDoc.exists) {
          const locData = locationDoc.data();
          pickupAddress = locData.address || pickupAddress;
          pickupPhone = locData.phone || pickupPhone;
          pickupName = locData.name || pickupName;
          if (locData.deliverySettings) {
            pickupInstructions = locData.deliverySettings.pickupInstructions || pickupInstructions;
          }
        }
      }

      if (!pickupAddress) {
        return response.status(400).json({ error: 'Restaurant address not configured' });
      }

      console.log('Delivery quote request:', { hasPickupAddress: !!pickupAddress, hasDropoffAddress: !!dropoffAddress, hasDropoffPhone: !!dropoffPhone });

      const doordash = getDoordash();
      const externalDeliveryId = doordash.generateExternalDeliveryId(restaurantId);

      // Format phone numbers to E.164 (+1XXXXXXXXXX) for DoorDash
      function formatPhoneE164(phone) {
        if (!phone) return '';
        // Strip everything except digits and leading +
        let cleaned = phone.trim();
        if (cleaned.startsWith('+')) {
          const digits = cleaned.substring(1).replace(/\D/g, '');
          if (digits.length >= 10) return '+' + digits;
        }
        const digits = cleaned.replace(/\D/g, '');
        if (digits.length === 10) return '+1' + digits;
        if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
        if (digits.length > 11) return '+' + digits;
        return digits.length > 0 ? '+1' + digits : '';
      }

      // Parse customer name
      const nameParts = (dropoffName || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const formattedPickupPhone = formatPhoneE164(pickupPhone);
      const formattedDropoffPhone = formatPhoneE164(dropoffPhone);
      console.log('Formatted phones:', { pickupValid: !!formattedPickupPhone, dropoffValid: !!formattedDropoffPhone });

      if (!formattedPickupPhone) {
        // Fallback: use customer phone if restaurant phone missing (temporary workaround)
        if (formattedDropoffPhone) {
          console.warn('Restaurant phone missing, using customer phone as fallback for pickup');
        } else {
          return response.status(400).json({ error: 'Restaurant phone number not configured. Please add a phone number in Account settings.' });
        }
      }

      const quoteResult = await doordash.getQuote({
        externalDeliveryId,
        pickupAddress,
        pickupPhone: formattedPickupPhone || formattedDropoffPhone,
        pickupBusinessName: pickupName,
        pickupInstructions,
        dropoffAddress,
        dropoffPhone: formattedDropoffPhone,
        dropoffContactGivenName: firstName,
        dropoffContactFamilyName: lastName,
        orderValue: orderValueCents || 0,
      });

      response.json({
        success: true,
        quoteId: externalDeliveryId,
        fee: quoteResult.fee, // cents
        feeFormatted: `$${(quoteResult.fee / 100).toFixed(2)}`,
        estimatedPickupTime: quoteResult.pickup_time_estimated || null,
        estimatedDropoffTime: quoteResult.dropoff_time_estimated || null,
        currency: quoteResult.currency || 'USD',
      });
    } catch (error) {
      console.error('Error getting delivery quote:', error);
      const status = error.status || 500;
      response.status(status).json({
        error: safeError(error, 'Failed to get delivery quote'),
      });
    }
  });
});

/**
 * DoorDash webhook handler.
 * Receives delivery status updates from DoorDash and updates Firestore orders.
 * Public endpoint — no auth required (DoorDash sends these).
 */
exports.doordashWebhook = onRequest({
  secrets: [doordashDeveloperId, doordashKeyId, doordashSigningSecret, doordashWebhookToken]
}, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method not allowed');
    }

    // Verify webhook authorization header — hard reject on mismatch
    const expectedToken = doordashWebhookToken.value() || process.env.DOORDASH_WEBHOOK_TOKEN;
    const authHeader = req.headers['authorization'] || '';
    if (!expectedToken) {
      console.error('DOORDASH_WEBHOOK_TOKEN not configured — rejecting webhook');
      return res.status(500).send('Webhook token not configured');
    }
    const expectedHeader = expectedToken.startsWith('Bearer ') ? expectedToken : `Bearer ${expectedToken}`;
    if (authHeader !== expectedHeader) {
      console.error('DoorDash webhook auth REJECTED — invalid token');
      return res.status(401).send('Unauthorized');
    }

    const payload = req.body;
    console.log('DoorDash webhook received:', { event: payload.event_name, deliveryId: payload.external_delivery_id, status: payload.delivery_status });

    const externalDeliveryId = payload.external_delivery_id;
    const eventName = payload.event_name;

    if (!externalDeliveryId || !eventName) {
      console.error('Missing required webhook fields');
      return res.status(200).send('OK'); // Return 200 to prevent retries for malformed data
    }

    const doordash = getDoordash();

    // Parse restaurant ID from external delivery ID
    const restaurantId = doordash.parseExternalDeliveryId(externalDeliveryId);
    if (!restaurantId) {
      console.error('Could not parse restaurant ID from:', externalDeliveryId);
      return res.status(200).send('OK');
    }

    // Map the DoorDash event to internal status
    const ddStatus = doordash.mapWebhookEvent(eventName);
    if (!ddStatus) {
      console.log('Unhandled DoorDash event:', eventName);
      return res.status(200).send('OK');
    }

    const { deliveryStatus, orderStatus } = doordash.mapDeliveryStatus(ddStatus);

    // Find the order by externalDeliveryId
    const db = admin.firestore();
    const ordersRef = db.collection(`restaurants/${restaurantId}/orders`);
    const orderQuery = await ordersRef
      .where('doordash.externalDeliveryId', '==', externalDeliveryId)
      .limit(1)
      .get();

    if (orderQuery.empty) {
      console.error('No order found for externalDeliveryId:', externalDeliveryId);
      return res.status(200).send('OK');
    }

    const orderDoc = orderQuery.docs[0];
    const orderId = orderDoc.id;
    const existingDoordash = orderDoc.data().doordash || {};

    // Build update object
    const update = {
      'doordash.deliveryStatus': deliveryStatus,
    };

    // Update dasher info if provided
    if (payload.dasher) {
      const dasherInfo = doordash.extractDasherInfo(payload);
      if (dasherInfo) {
        if (dasherInfo.dasherName) update['doordash.dasherName'] = dasherInfo.dasherName;
        if (dasherInfo.dasherPhone) update['doordash.dasherPhone'] = dasherInfo.dasherPhone;
        if (dasherInfo.dasherVehicle) update['doordash.dasherVehicle'] = dasherInfo.dasherVehicle;
        if (dasherInfo.dasherLocation) update['doordash.dasherLocation'] = dasherInfo.dasherLocation;
      }
    }

    // Update timestamps
    if (payload.pickup_time_estimated) update['doordash.estimatedPickupTime'] = payload.pickup_time_estimated;
    if (payload.dropoff_time_estimated) update['doordash.estimatedDropoffTime'] = payload.dropoff_time_estimated;
    if (payload.pickup_time_actual) update['doordash.actualPickupTime'] = payload.pickup_time_actual;
    if (payload.dropoff_time_actual) update['doordash.actualDeliveryTime'] = payload.dropoff_time_actual;
    if (payload.tracking_url) update['doordash.trackingUrl'] = payload.tracking_url;
    if (payload.support_reference) update['doordash.supportReference'] = payload.support_reference;
    if (payload.dropoff_verification_image_url) update['doordash.proofOfDeliveryUrl'] = payload.dropoff_verification_image_url;
    if (payload.cancellation_reason) update['doordash.cancelReason'] = payload.cancellation_reason;

    // Key order status transitions
    if (orderStatus) {
      update.status = orderStatus;
      if (orderStatus === 'out_for_delivery') {
        update.outForDeliveryAt = FieldValue.serverTimestamp();
      } else if (orderStatus === 'completed') {
        update.completedAt = FieldValue.serverTimestamp();
      } else if (orderStatus === 'delivery_failed') {
        update.deliveryFailedAt = FieldValue.serverTimestamp();
      }
    }

    // Update both order collections
    await Promise.all([
      ordersRef.doc(orderId).update(update),
      db.collection('orders').doc(orderId).update(update),
    ]);

    console.log(`Order ${orderId} updated: deliveryStatus=${deliveryStatus}, orderStatus=${orderStatus || 'unchanged'}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error('DoorDash webhook error:', error);
    // Return 200 to prevent excessive retries, but log the error
    res.status(200).send('OK');
  }
});

/**
 * Cancel a delivery order. Called by restaurant admin.
 * Can only cancel before the driver has picked up.
 */
exports.cancelDeliveryOrder = onCall({
  secrets: [doordashDeveloperId, doordashKeyId, doordashSigningSecret]
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { orderId } = request.data;
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  // Load the order
  const orderDoc = await db.doc(`restaurants/${uid}/orders/${orderId}`).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found');
  }

  const order = orderDoc.data();
  if (order.orderType !== 'delivery') {
    throw new HttpsError('failed-precondition', 'Not a delivery order');
  }

  if (!order.doordash || !order.doordash.externalDeliveryId) {
    throw new HttpsError('failed-precondition', 'No DoorDash delivery associated with this order');
  }

  // Check if cancellation is still possible
  const nonCancellableStatuses = ['picked_up', 'driver_enroute_dropoff', 'driver_at_dropoff', 'delivered', 'cancelled'];
  if (nonCancellableStatuses.includes(order.doordash.deliveryStatus)) {
    throw new HttpsError('failed-precondition', `Cannot cancel delivery in status: ${order.doordash.deliveryStatus}`);
  }

  try {
    const doordash = getDoordash();
    await doordash.cancelDelivery(order.doordash.externalDeliveryId);

    const update = {
      status: 'delivery_failed',
      'doordash.deliveryStatus': 'cancelled',
      'doordash.cancelReason': 'Cancelled by restaurant',
      deliveryFailedAt: FieldValue.serverTimestamp(),
    };

    await Promise.all([
      db.doc(`restaurants/${uid}/orders/${orderId}`).update(update),
      db.doc(`orders/${orderId}`).update(update),
    ]);

    return { success: true, message: 'Delivery cancelled successfully' };
  } catch (error) {
    console.error('Error cancelling delivery:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to cancel delivery'));
  }
});

/**
 * Get fresh delivery status from DoorDash (on-demand refresh).
 * Supplements webhook updates.
 */
exports.getDeliveryStatus = onCall({
  secrets: [doordashDeveloperId, doordashKeyId, doordashSigningSecret]
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { orderId } = request.data;
  if (!orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  const orderDoc = await db.doc(`restaurants/${uid}/orders/${orderId}`).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', 'Order not found');
  }

  const order = orderDoc.data();
  if (!order.doordash || !order.doordash.externalDeliveryId) {
    throw new HttpsError('failed-precondition', 'No DoorDash delivery associated with this order');
  }

  try {
    const doordash = getDoordash();
    const deliveryData = await doordash.getDelivery(order.doordash.externalDeliveryId);
    const ddStatus = deliveryData.delivery_status;
    const { deliveryStatus, orderStatus } = doordash.mapDeliveryStatus(ddStatus);
    const updatedDoordash = doordash.buildOrderDoordashData(deliveryData, order.doordash);

    const update = { doordash: updatedDoordash };
    if (orderStatus && order.status !== orderStatus) {
      update.status = orderStatus;
    }

    await Promise.all([
      db.doc(`restaurants/${uid}/orders/${orderId}`).update(update),
      db.doc(`orders/${orderId}`).update(update),
    ]);

    return {
      success: true,
      deliveryStatus,
      orderStatus: orderStatus || order.status,
      trackingUrl: updatedDoordash.trackingUrl,
      dasherName: updatedDoordash.dasherName,
      dasherPhone: updatedDoordash.dasherPhone,
      estimatedDropoffTime: updatedDoordash.estimatedDropoffTime,
    };
  } catch (error) {
    console.error('Error getting delivery status:', error);
    throw new HttpsError('internal', safeError(error, 'Failed to get delivery status'));
  }
});

// ============================================
// CUSTOM DOMAIN MANAGEMENT
// ============================================

/**
 * Verify and connect a custom domain for a restaurant's website.
 * Checks DNS CNAME resolution and saves the domain to the restaurant doc.
 */
exports.verifyCustomDomain = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const { domain } = request.data;
  if (!domain) throw new HttpsError('invalid-argument', 'Domain is required');

  // Normalize domain: lowercase, strip protocol/trailing slash
  let cleanDomain = domain.toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  // Validate domain format
  const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
  if (!domainRegex.test(cleanDomain)) {
    throw new HttpsError('invalid-argument', 'Invalid domain format. Enter a domain like www.yourrestaurant.com');
  }

  // Derive both www and bare (apex) versions
  const isWww = cleanDomain.startsWith('www.');
  const bareDomain = isWww ? cleanDomain.slice(4) : cleanDomain;
  const wwwDomain = isWww ? cleanDomain : `www.${cleanDomain}`;

  const db = admin.firestore();
  const RESTAURANT_SITE = process.env.GCLOUD_PROJECT === 'kodacarte-861d8' ? 'kodacarte-sites' : 'koda-carte-sites';

  // Check neither domain variant is taken by another restaurant
  for (const d of [bareDomain, wwwDomain]) {
    const existingSnap = await db.collection('restaurants')
      .where('customDomain', '==', d)
      .limit(1)
      .get();
    if (!existingSnap.empty && existingSnap.docs[0].id !== uid) {
      throw new HttpsError('already-exists', `Domain ${d} is already connected to another restaurant`);
    }
  }

  // Register both domains with Firebase Hosting API for SSL provisioning
  const hostingResults = {};
  try {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token || tokenResponse;

    for (const d of [bareDomain, wwwDomain]) {
      try {
        const url = `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/${RESTAURANT_SITE}/customDomains?customDomainId=${d}`;
        const resp = await axios.post(url, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        hostingResults[d] = { registered: true, data: resp.data };
        console.log(`Registered ${d} with Firebase Hosting:`, resp.data.hostState, resp.data.ownershipState);
      } catch (err) {
        // 409 = already exists, which is fine
        if (err.response?.status === 409) {
          // Fetch current status
          try {
            const getUrl = `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/${RESTAURANT_SITE}/customDomains/${d}`;
            const getResp = await axios.get(getUrl, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            hostingResults[d] = { registered: true, data: getResp.data };
            console.log(`Domain ${d} already registered, current status:`, getResp.data.hostState);
          } catch (getErr) {
            console.error(`Failed to get status for ${d}:`, getErr.message);
            hostingResults[d] = { registered: true, data: null };
          }
        } else {
          console.error(`Failed to register ${d} with Firebase Hosting:`, err.response?.data || err.message);
          hostingResults[d] = { registered: false, error: err.response?.data?.error?.message || err.message };
        }
      }
    }
  } catch (authErr) {
    console.error('Firebase Hosting API auth failed:', authErr.message);
    // Continue without hosting registration — domain will still work via Firestore lookup
    // but won't have SSL until manually added to Firebase Hosting
  }

  // Extract DNS records from Firebase Hosting API responses
  const dnsRecords = { apex: [], www: [] };
  for (const [d, result] of Object.entries(hostingResults)) {
    const desired = result.data?.requiredDnsUpdates?.desired || [];
    const key = d === bareDomain ? 'apex' : 'www';
    dnsRecords[key] = desired.map(r => ({
      type: r.type,
      host: r.domainName?.replace(/\.$/, '') || d,
      value: (r.rrdatas || []).join(', '),
    }));
  }

  // Provide default DNS records if API didn't return them
  if (dnsRecords.apex.length === 0) {
    dnsRecords.apex = [
      { type: 'A', host: bareDomain, value: '199.36.158.100' },
      { type: 'TXT', host: bareDomain, value: `hosting-site=${RESTAURANT_SITE}` },
    ];
  }
  if (dnsRecords.www.length === 0) {
    dnsRecords.www = [
      { type: 'CNAME', host: wwwDomain, value: `${RESTAURANT_SITE}.web.app` },
    ];
  }

  // Verify DNS for both domains
  const dns = require('dns').promises;
  let wwwVerified = false;
  let apexVerified = false;

  // Check www CNAME
  try {
    const records = await dns.resolveCname(wwwDomain);
    const validTargets = [`${RESTAURANT_SITE}.web.app`, `${RESTAURANT_SITE}.firebaseapp.com`, `${PROJECT_ID}.web.app`];
    wwwVerified = records.some(r => validTargets.some(t => r.toLowerCase().includes(t.toLowerCase())));
  } catch (err) {
    console.log(`www DNS check for ${wwwDomain}:`, err.code || err.message);
  }

  // Check apex A records
  try {
    const records = await dns.resolve4(bareDomain);
    // Firebase Hosting IPs (may vary, check common ones)
    const firebaseIps = ['199.36.158.100'];
    apexVerified = records.some(r => firebaseIps.includes(r));
  } catch (err) {
    console.log(`Apex DNS check for ${bareDomain}:`, err.code || err.message);
  }

  const bothVerified = wwwVerified && apexVerified;
  const eitherVerified = wwwVerified || apexVerified;
  const status = bothVerified ? 'active' : (eitherVerified ? 'partial' : 'pending');
  const now = admin.firestore.FieldValue.serverTimestamp();

  // Save both domain variants to the restaurant document
  await db.doc(`restaurants/${uid}`).update({
    customDomain: bareDomain,
    customDomainWww: wwwDomain,
    customDomainStatus: status,
    customDomainDnsRecords: dnsRecords,
    ...(bothVerified ? { customDomainVerifiedAt: now } : {}),
    customDomainUpdatedAt: now,
  });

  console.log(`Custom domains ${bareDomain} + ${wwwDomain} status=${status} for restaurant ${uid}`);

  let message;
  if (bothVerified) {
    message = `Both ${bareDomain} and ${wwwDomain} are verified and active! SSL certificates are being provisioned (usually takes a few minutes).`;
  } else if (wwwVerified) {
    message = `${wwwDomain} DNS is verified. ${bareDomain} still needs A record setup — see the DNS records below.`;
  } else if (apexVerified) {
    message = `${bareDomain} DNS is verified. ${wwwDomain} still needs CNAME setup — see the DNS records below.`;
  } else {
    message = `Domains saved. DNS not yet verified for either domain. Add the DNS records below and click "Re-verify".`;
  }

  return {
    success: true,
    domain: bareDomain,
    wwwDomain,
    status,
    dnsVerified: bothVerified,
    wwwVerified,
    apexVerified,
    dnsRecords,
    hostingRegistered: Object.values(hostingResults).some(r => r.registered),
    message,
  };
});

/**
 * Remove a custom domain from a restaurant.
 */
exports.removeCustomDomain = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const db = admin.firestore();
  const RESTAURANT_SITE = process.env.GCLOUD_PROJECT === 'kodacarte-861d8' ? 'kodacarte-sites' : 'koda-carte-sites';

  // Get current domains before removing
  const restDoc = await db.doc(`restaurants/${uid}`).get();
  const restData = restDoc.data() || {};
  const domainsToRemove = [restData.customDomain, restData.customDomainWww].filter(Boolean);

  // Remove from Firebase Hosting API
  if (domainsToRemove.length > 0) {
    try {
      const { GoogleAuth } = require('google-auth-library');
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const accessToken = tokenResponse.token || tokenResponse;

      for (const d of domainsToRemove) {
        try {
          const url = `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/${RESTAURANT_SITE}/customDomains/${d}`;
          await axios.delete(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          console.log(`Removed ${d} from Firebase Hosting`);
        } catch (err) {
          // 404 = already removed, which is fine
          if (err.response?.status !== 404) {
            console.error(`Failed to remove ${d} from Firebase Hosting:`, err.response?.data || err.message);
          }
        }
      }
    } catch (authErr) {
      console.error('Firebase Hosting API auth failed during removal:', authErr.message);
    }
  }

  await db.doc(`restaurants/${uid}`).update({
    customDomain: admin.firestore.FieldValue.delete(),
    customDomainWww: admin.firestore.FieldValue.delete(),
    customDomainStatus: admin.firestore.FieldValue.delete(),
    customDomainDnsRecords: admin.firestore.FieldValue.delete(),
    customDomainVerifiedAt: admin.firestore.FieldValue.delete(),
    customDomainUpdatedAt: admin.firestore.FieldValue.delete(),
  });

  console.log(`Custom domain removed for restaurant ${uid}`);

  return { success: true, message: 'Custom domain removed' };
});

/**
 * Configure delivery settings for a restaurant.
 * Registers with DoorDash Business/Store on first enable.
 */
exports.configureDelivery = onCall({
  secrets: [doordashDeveloperId, doordashKeyId, doordashSigningSecret]
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const { enabled, pickupInstructions, defaultPrepTime, contactlessDefault, tipSuggestions, locationId } = request.data;

  const db = admin.firestore();
  const restaurantDoc = await db.doc(`restaurants/${uid}`).get();
  if (!restaurantDoc.exists) {
    throw new HttpsError('not-found', 'Restaurant not found');
  }

  const restaurantData = restaurantDoc.data();
  const existingSettings = restaurantData.deliverySettings || {};

  // Build updated settings
  const updatedSettings = {
    enabled: enabled !== undefined ? !!enabled : !!existingSettings.enabled,
    pickupInstructions: pickupInstructions !== undefined ? pickupInstructions : (existingSettings.pickupInstructions || ''),
    defaultPrepTime: defaultPrepTime !== undefined ? defaultPrepTime : (existingSettings.defaultPrepTime || 20),
    contactlessDefault: contactlessDefault !== undefined ? !!contactlessDefault : !!existingSettings.contactlessDefault,
    tipSuggestions: tipSuggestions || existingSettings.tipSuggestions || [15, 20, 25],
    doordashBusinessId: existingSettings.doordashBusinessId || null,
    doordashStoreId: existingSettings.doordashStoreId || null,
  };

  // Verify DoorDash credentials work on first enable
  if (enabled && !existingSettings.doordashBusinessId) {
    try {
      const doordash = getDoordash();
      // Verify JWT generation works (credentials are valid)
      doordash.getAccessToken();
      // Business/Store registration is done in DoorDash Developer Portal.
      // Use restaurant UID as the business/store ID reference.
      updatedSettings.doordashBusinessId = uid;
      updatedSettings.doordashStoreId = locationId || uid;
      console.log(`DoorDash delivery enabled for restaurant ${uid}`);
    } catch (ddErr) {
      console.error('DoorDash credential verification error:', ddErr.message);
      updatedSettings.registrationError = ddErr.message;
    }
  }

  // Save settings
  await db.doc(`restaurants/${uid}`).update({ deliverySettings: updatedSettings });

  // For multi-location, also save location-specific settings
  if (locationId && locationId !== uid) {
    const locationSettings = {
      'deliverySettings.doordashStoreId': updatedSettings.doordashStoreId,
      'deliverySettings.pickupInstructions': updatedSettings.pickupInstructions,
    };
    await db.doc(`restaurants/${uid}/locations/${locationId}`).update(locationSettings);
  }

  return {
    success: true,
    settings: updatedSettings,
  };
});

// ========================================
// Mobile App — Automated Build Pipeline
// ========================================

/**
 * publishMobileApp — Triggers the automated build pipeline.
 * 1. Validates config
 * 2. Saves config to Firestore with status 'queued'
 * 3. Triggers GitHub Actions workflow via GitHub API
 */
exports.publishMobileApp = onCall(
  { secrets: [githubPat, mobileAppWebhookToken, githubRepo, resendApiKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

    const db = admin.firestore();
    const data = request.data;
    if (!data.appName || !data.bundleSuffix || !data.logoUrl) {
      throw new HttpsError('invalid-argument', 'appName, bundleSuffix, and logoUrl are required');
    }

    const bundleId = `com.kodacarte.wl.${data.bundleSuffix}`;
    const isUpdate = data.existingStatus === 'live';

    // Save config to Firestore
    const configData = {
      appName: data.appName,
      bundleSuffix: data.bundleSuffix,
      bundleId,
      description: data.description || '',
      category: data.category || 'food-drink',
      keywords: data.keywords || '',
      supportEmail: data.supportEmail || '',
      supportUrl: data.supportUrl || '',
      privacyPolicyUrl: data.privacyPolicyUrl || '',
      marketingUrl: data.marketingUrl || null,
      customIconUrl: data.customIconUrl || null,
      customIconStoragePath: data.customIconStoragePath || null,
      platforms: data.platforms || ['ios', 'android'],
      status: 'queued',
      statusMessage: 'Build queued, waiting for pipeline to start...',
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedBy: uid,
      publishedAt: data.publishedAt || null,
      lastBuildAt: null,
      buildStartedAt: null,
      buildCompletedAt: null,
      submittedAt: null,
      iosAppId: data.iosAppId || null,
      iosBuildId: null,
      androidPackage: data.androidPackage || null,
      androidBuildId: null,
      version: isUpdate ? data.version || '1.0.0' : '1.0.0',
      buildNumber: isUpdate ? (data.buildNumber || 0) + 1 : 1,
      errorMessage: null,
      errorDetails: null
    };

    await db.doc(`restaurants/${uid}/mobileApp/config`).set(configData);

    // Reserve bundle suffix
    await db.doc(`mobileAppBundles/${data.bundleSuffix}`).set({
      restaurantId: uid,
      bundleId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Determine the webhook URL (this function's URL base)
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'restaurant-portal-6b147';
    const region = 'us-central1';
    const webhookUrl = `https://${region}-${projectId}.cloudfunctions.net/mobileAppBuildWebhook`;

    // Trigger GitHub Actions workflow
    const repo = githubRepo.value(); // e.g. "sanjeevbhatta0/customer-app"
    const token = githubPat.value();
    const platforms = (data.platforms || ['ios', 'android']).includes('ios') && (data.platforms || ['ios', 'android']).includes('android') ? 'both' : (data.platforms || ['ios'])[0];

    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/white-label-build.yml/dispatches`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              restaurantId: uid,
              bundleSuffix: data.bundleSuffix,
              appName: data.appName,
              platforms,
              logoUrl: data.logoUrl,
              primaryColor: data.primaryColor || '#2c3e50',
              webhookUrl,
              webhookToken: mobileAppWebhookToken.value()
            }
          })
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        logger.error('GitHub Actions trigger failed:', response.status, errText);

        // Update status to failed
        await db.doc(`restaurants/${uid}/mobileApp/config`).update({
          status: 'failed',
          statusMessage: 'Failed to start build pipeline.',
          errorDetails: `GitHub API returned ${response.status}: ${errText}`
        });

        throw new HttpsError('internal', 'Failed to trigger build pipeline');
      }

      // Update status to building
      await db.doc(`restaurants/${uid}/mobileApp/config`).update({
        status: 'generating_assets',
        statusMessage: 'Build pipeline started! Generating app assets...',
        buildStartedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info(`Mobile app build triggered for restaurant ${uid} (${data.appName})`);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('Error triggering GitHub Actions:', err.message);
      await db.doc(`restaurants/${uid}/mobileApp/config`).update({
        status: 'failed',
        statusMessage: 'Failed to start build pipeline.',
        errorDetails: err.message
      });
      throw new HttpsError('internal', 'Failed to trigger build pipeline');
    }

    // Send notification email (non-blocking)
    try {
      const { sendEmail } = require('./services/emailService');
      await sendEmail({
        to: 'sanjeev@kodacarte.com',
        subject: `Mobile App Build Started: ${data.appName}`,
        html: `<h3>Automated Build Pipeline Started</h3>
          <p><strong>Restaurant:</strong> ${data.restaurantName || data.appName}</p>
          <p><strong>Bundle ID:</strong> ${bundleId}</p>
          <p><strong>Platforms:</strong> ${platforms}</p>
          <p><strong>Restaurant ID:</strong> ${uid}</p>
          <p>The build pipeline has been triggered via GitHub Actions. Status updates are automatic.</p>`
      }, resendApiKey.value());
    } catch (emailErr) {
      logger.warn('Notification email failed (non-blocking):', emailErr.message);
    }

    return { success: true };
  }
);

/**
 * mobileAppBuildWebhook — HTTP endpoint for GitHub Actions to update build status.
 * Authenticated via Bearer token in Authorization header.
 */
exports.mobileAppBuildWebhook = onRequest(
  { secrets: [mobileAppWebhookToken] },
  async (req, res) => {
    // CORS preflight — restricted (webhook is called from GitHub Actions, not browsers)
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', 'null');
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).send('');
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify token
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || token !== mobileAppWebhookToken.value()) {
      logger.warn('mobileAppBuildWebhook: invalid auth token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = admin.firestore();
    const { restaurantId, status, statusMessage, errorDetails, iosBuildId, androidBuildId } = req.body;
    if (!restaurantId || !status) {
      return res.status(400).json({ error: 'restaurantId and status are required' });
    }

    // Build update object
    const update = {
      status,
      statusMessage: statusMessage || '',
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (errorDetails) update.errorDetails = errorDetails;
    if (iosBuildId) update.iosBuildId = iosBuildId;
    if (androidBuildId) update.androidBuildId = androidBuildId;
    if (status === 'submitted') {
      update.submittedAt = admin.firestore.FieldValue.serverTimestamp();
      update.buildCompletedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    if (status === 'failed') {
      update.errorMessage = statusMessage;
    }

    try {
      await db.doc(`restaurants/${restaurantId}/mobileApp/config`).update(update);
      logger.info(`Mobile app status updated: ${restaurantId} → ${status}`);
      return res.status(200).json({ success: true });
    } catch (err) {
      logger.error('Failed to update mobile app status:', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }
);

// ======================================
// Stripe Webhook — Subscription Lifecycle
// ======================================

/**
 * Stripe webhook handler for subscription events.
 * Keeps Firestore subscription status in sync with Stripe.
 *
 * Events handled:
 * - invoice.paid — Subscription payment succeeded (marks active, updates period)
 * - invoice.payment_failed — Payment failed (marks past_due)
 * - customer.subscription.updated — Trial ending, plan change, etc.
 * - customer.subscription.deleted — Subscription cancelled
 */
exports.stripeWebhook = onRequest({
  secrets: [stripeSecretKey, stripeWebhookSecret]
}, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = stripeWebhookSecret.value();

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    // Firebase Cloud Functions parse JSON automatically, but Stripe needs the raw body
    // Use req.rawBody which Firebase provides for webhook signature verification
    const stripeLib = require('stripe')(stripeSecretKey.value());
    event = stripeLib.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = admin.firestore();

  try {
    switch (event.type) {
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        const customerId = invoice.customer;

        if (!subscriptionId) break; // one-time payment, not subscription

        // Find the restaurant with this Stripe customer/subscription
        const snap = await db.collection('restaurants')
          .where('subscription.stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (snap.empty) {
          console.warn(`No restaurant found for Stripe customer ${customerId}`);
          break;
        }

        const restaurantDoc = snap.docs[0];
        const restaurantData = restaurantDoc.data();
        const periodEnd = new Date(invoice.lines.data[0]?.period?.end * 1000 || Date.now());
        const periodStart = new Date(invoice.lines.data[0]?.period?.start * 1000 || Date.now());

        const updateData = {
          'subscription.status': 'active',
          'subscription.stripeSubscriptionId': subscriptionId,
          'subscription.currentPeriodStart': periodStart.toISOString(),
          'subscription.currentPeriodEnd': periodEnd.toISOString(),
          'subscription.lastPaymentDate': new Date().toISOString(),
          'subscription.lastPaymentAmount': invoice.amount_paid / 100,
          // Reset order usage for the new billing period
          'orderUsage.currentCount': 0,
          'orderUsage.overageOrders': 0,
          'orderUsage.overageCharges': 0,
          'orderUsage.currentPeriodStart': periodStart.toISOString(),
          'orderUsage.currentPeriodEnd': periodEnd.toISOString(),
        };

        // Apply pending downgrade if scheduled
        const pendingDowngrade = restaurantData.subscription?.pendingDowngrade;
        if (pendingDowngrade?.newTier && pendingDowngrade?.newPriceId) {
          try {
            const stripeLib = require('stripe')(stripeSecretKey.value());
            const sub = await stripeLib.subscriptions.retrieve(subscriptionId);
            const currentItem = sub.items.data[0];
            if (currentItem) {
              await stripeLib.subscriptions.update(subscriptionId, {
                items: [{
                  id: currentItem.id,
                  price: pendingDowngrade.newPriceId,
                  quantity: pendingDowngrade.locationCount || 1,
                }],
                proration_behavior: 'none',
                metadata: {
                  tier: pendingDowngrade.newTier,
                  billingCycle: pendingDowngrade.newBillingCycle,
                  locationCount: (pendingDowngrade.locationCount || 1).toString(),
                },
              });

              updateData['subscription.tier'] = pendingDowngrade.newTier;
              updateData['subscription.billingCycle'] = pendingDowngrade.newBillingCycle;
              updateData['subscription.locationCount'] = pendingDowngrade.locationCount || 1;
              updateData['subscription.pendingDowngrade'] = admin.firestore.FieldValue.delete();
              console.log(`Applied pending downgrade to ${pendingDowngrade.newTier} for ${restaurantDoc.id}`);
            }
          } catch (downgradeError) {
            console.error('Error applying pending downgrade:', downgradeError);
          }
        }

        await restaurantDoc.ref.update(updateData);

        console.log(`Subscription payment succeeded for ${restaurantDoc.id}, period ${periodStart.toISOString()} - ${periodEnd.toISOString()}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) break;

        const snap = await db.collection('restaurants')
          .where('subscription.stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (snap.empty) break;

        await snap.docs[0].ref.update({
          'subscription.status': 'past_due',
          'subscription.lastPaymentError': invoice.last_payment_error?.message || 'Payment failed',
          'subscription.lastPaymentFailedDate': new Date().toISOString(),
        });

        console.warn(`Payment failed for restaurant ${snap.docs[0].id}`);
        // TODO: Send notification email to restaurant owner
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const snap = await db.collection('restaurants')
          .where('subscription.stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (snap.empty) break;

        const updates = {
          'subscription.stripeSubscriptionId': subscription.id,
          'subscription.status': subscription.status, // active, trialing, past_due, canceled
        };

        // Update trial end if applicable
        if (subscription.trial_end) {
          updates['subscription.trialEnd'] = new Date(subscription.trial_end * 1000).toISOString();
        }

        // Update period dates
        if (subscription.current_period_start) {
          updates['subscription.currentPeriodStart'] = new Date(subscription.current_period_start * 1000).toISOString();
        }
        if (subscription.current_period_end) {
          updates['subscription.currentPeriodEnd'] = new Date(subscription.current_period_end * 1000).toISOString();
        }

        await snap.docs[0].ref.update(updates);
        console.log(`Subscription updated for ${snap.docs[0].id}: status=${subscription.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const snap = await db.collection('restaurants')
          .where('subscription.stripeCustomerId', '==', customerId)
          .limit(1)
          .get();

        if (snap.empty) break;

        await snap.docs[0].ref.update({
          'subscription.status': 'canceled',
          'subscription.canceledAt': new Date().toISOString(),
          'subscription.stripeSubscriptionId': subscription.id,
        });

        console.log(`Subscription canceled for restaurant ${snap.docs[0].id}`);
        // TODO: Send cancellation confirmation email
        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing Stripe webhook:', error);
    // Return 200 to prevent Stripe retries for processing errors
    return res.status(200).json({ received: true, error: 'Processing error logged' });
  }
});