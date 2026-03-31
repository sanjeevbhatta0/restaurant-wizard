const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');
const cors = require('cors')({ origin: true });
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');

admin.initializeApp();

// ============================================
// PROMOTIONS HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique per-customer promo code (e.g., KC-A3X9B2)
 */
function generateUniquePromoCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'KC-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
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

// Initialize Stripe with your secret key
// For production, use Firebase Functions config or environment secrets
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_51SkXC0KckjWrEVo26MbeTN0GKkdb14sF3deZsHZt1CrCMFK0PR0su3CKJoa1rMUC4n0fo2nQcXNYJfdpwzOoRKMx00jKjdD6yZ');

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

      const { username } = req.body;

      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
      }

      const db = admin.firestore();
      const restaurantsRef = db.collection('restaurants');

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

      return res.status(404).json({ error: 'Username not found' });
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
exports.createPaymentIntent = onCall(async (request) => {
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

    // Check for connected Stripe account
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);

    // Convert amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(amount * 100);

    // Build intent params
    let intentParams = {
      amount: amountInCents,
      currency: currency,
      metadata: {
        restaurantId: restaurantId,
        orderIds: JSON.stringify(orderIds),
        tableNumbers: JSON.stringify(tableNumbers),
        ...metadata
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

    // Create PaymentIntent — on connected account if available, else platform
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    const paymentIntent = await stripe.paymentIntents.create(intentParams, stripeOptions);

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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Confirm payment and update order status
 * Called after successful Stripe payment
 */
exports.confirmStripePayment = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { paymentIntentId, orderIds, paymentDetails, restaurantId } = request.data;

    // Verify restaurant ownership (support staff users)
    const resolvedRestaurantId = resolveRestaurantId(request);
    if (restaurantId !== resolvedRestaurantId) {
      throw new HttpsError('permission-denied', 'Not authorized for this restaurant');
    }

    // Check for connected Stripe account
    const connectedAccountId = await getStripeConnectAccountId(restaurantId);
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    // Retrieve the payment intent to verify it's actually paid
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);

    if (paymentIntent.status !== 'succeeded') {
      throw new HttpsError('failed-precondition', `Payment not completed. Status: ${paymentIntent.status}`);
    }

    // Update orders in Firestore with payment details
    const db = admin.firestore();
    const batch = db.batch();

    for (const orderId of orderIds) {
      const orderRef = db.doc(`restaurants/${restaurantId}/orders/${orderId}`);
      batch.update(orderRef, {
        status: 'completed',
        paymentDate: FieldValue.serverTimestamp(),
        paymentDetails: {
          ...paymentDetails,
          stripePaymentIntentId: paymentIntentId,
          paymentMethod: 'card',
          paidAt: new Date().toISOString()
        },
        updatedAt: FieldValue.serverTimestamp()
      });
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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Process a Stripe refund for a completed order
 */
exports.processStripeRefund = onCall(async (request) => {
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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Get Stripe publishable key for frontend
 */
exports.getStripeConfig = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Resolve restaurant ID (supports staff users)
    const restaurantId = resolveRestaurantId(request);
    const connectedAccountId = restaurantId ? await getStripeConnectAccountId(restaurantId) : null;

    return {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY',
      connectedAccountId: connectedAccountId || null
    };
  } catch (error) {
    console.error('Error getting Stripe config:', error);
    throw new HttpsError('internal', error.message);
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
exports.createTierPayment = onCall(async (request) => {
  try {
    // Note: Allow unauthenticated calls since this is called during signup before user is created
    const { amount, currency = 'usd', tier, billingCycle, locationCount, restaurantName, email } = request.data;

    // Validate required fields
    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid payment amount');
    }

    if (!tier || !['ally', 'guide', 'chief', 'elder'].includes(tier)) {
      throw new HttpsError('invalid-argument', 'Invalid tier selection');
    }

    if (!billingCycle || !['monthly', 'quarterly', 'annual'].includes(billingCycle)) {
      throw new HttpsError('invalid-argument', 'Invalid billing cycle');
    }

    if (!locationCount || locationCount < 1) {
      throw new HttpsError('invalid-argument', 'Invalid location count');
    }

    // Convert amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(amount * 100);

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
    throw new HttpsError('internal', error.message);
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

// Helper function to get restaurant by slug
async function getRestaurantBySlug(slug) {
  const snapshot = await admin.firestore()
    .collection('restaurants')
    .where('slug', '==', slug)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    ...doc.data()
  };
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
    '{{heroImage}}': data.heroImage || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920',
    '{{aboutImage}}': data.aboutImage || 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800',
    '{{aboutContent}}': data.aboutContent || '<p>Welcome to our restaurant! We are passionate about serving delicious food made with the freshest ingredients.</p>',
    '{{address}}': data.address || '123 Main Street, City, State 12345',
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
    '{{taxRate}}': data.taxRate !== undefined ? data.taxRate : 8.5,
    '{{promoId}}': data.promoId || '',
    '{{year}}': new Date().getFullYear().toString(),
    '{{apiBaseUrl}}': data.apiBaseUrl || 'https://restaurant-portal-6b147.web.app',
    '{{stripePublishableKey}}': data.stripePublishableKey || '',
    '{{stripeConnectedAccountId}}': data.stripeConnectedAccountId || '',
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
    // Firebase config for customer-facing auth
    '{{firebaseConfigJson}}': JSON.stringify({
      apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyACOWtwR1QMedvnzMxzlh4JZU2buNl-vO0',
      authDomain: 'restaurant-portal-6b147.firebaseapp.com',
      projectId: 'restaurant-portal-6b147',
      storageBucket: 'restaurant-portal-6b147.appspot.com'
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
exports.serveWebsite = onRequest(async (req, res) => {
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

      // Handle subdomain or query param
      if (host.includes('restaurant-portal-6b147.web.app') || host.includes('cloudfunctions.net')) {
        const subdomain = host.split('.')[0];
        if (subdomain !== 'restaurant-portal-6b147' && subdomain !== 'us-central1-restaurant-portal-6b147') {
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
      const promoId = req.query.promo || '';

      // Check if this is a preview request (allows viewing unpublished sites)
      const isPreview = req.query.preview === 'true';

      // Check if website is published (unless it's a preview request)
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

      const templateId = websiteData.template || 'modern-bistro';
      const templateDefaults = TEMPLATES[templateId] || TEMPLATES['modern-bistro'];

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
        (restaurantData.taxRate !== undefined ? restaurantData.taxRate : 8.5);

      console.log('Tax rate sources - Location:', locationTaxRate, 'Restaurant:', restaurantData.taxRate, 'Final:', finalTaxRate);

      // Build template data
      const templateData = {
        restaurantId: restaurantId,
        locationId: effectiveLocationId,
        restaurantName: websiteData.restaurantName || restaurantData.name || 'Restaurant',
        tagline: websiteData.tagline || 'Welcome to our restaurant',
        description: websiteData.description || 'Delicious food made with love',
        heroImage: websiteData.heroImage || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80',
        aboutImage: websiteData.aboutImage || 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
        aboutContent: websiteData.aboutContent || '<p>Welcome to our restaurant! We are passionate about serving delicious food.</p>',
        address: websiteData.address || restaurantData.address || '',
        phone: websiteData.phone || restaurantData.phone || '',
        email: websiteData.email || restaurantData.email || '',
        logo: websiteData.logo || restaurantData.logo || '',
        primaryColor: websiteData.primaryColor || templateDefaults.primaryColor,
        secondaryColor: websiteData.secondaryColor || templateDefaults.secondaryColor,
        accentColor: websiteData.accentColor || templateDefaults.accentColor,
        fontFamily: websiteData.fontFamily || templateDefaults.fontFamily,
        facebook: websiteData.facebook || '',
        instagram: websiteData.instagram || '',
        twitter: websiteData.twitter || '',
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
          ? 'http://localhost:5001/restaurant-portal-6b147/us-central1'
          : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net',
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51SkXC0KckjWrEVo2Ds2i9mmr5IONkNEYa5an7d4lEr2qg29M3y88UzQRCZoqSzJ92qoTBffVm1AWEPB5uYxdhpsD00bsPkUN15',
        stripeConnectedAccountId: await getStripeConnectAccountId(restaurantId) || '',
        taxRate: finalTaxRate,
        promoId: promoId
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

        const initialTab = req.query.tab || 'menu';
        const firebaseConfig = JSON.stringify({
          apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyACOWtwR1QMedvnzMxzlh4JZU2buNl-vO0',
          authDomain: 'restaurant-portal-6b147.firebaseapp.com',
          projectId: 'restaurant-portal-6b147',
          storageBucket: 'restaurant-portal-6b147.appspot.com'
        });

        const embedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${templateData.restaurantName}</title>
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
    var EMBED_CONFIG = {
      restaurantId: '${restaurantId}',
      locationId: '${effectiveLocationId}',
      restaurantName: ${JSON.stringify(templateData.restaurantName)},
      apiBaseUrl: '${templateData.apiBaseUrl}',
      taxRate: ${templateData.taxRate},
      promoId: '${promoId}',
      initialTab: '${initialTab}',
      primaryColor: '${templateData.primaryColor}',
      secondaryColor: '${templateData.secondaryColor}',
      accentColor: '${templateData.accentColor}',
      fontFamily: '${templateData.fontFamily}',
      stripeKey: '${templateData.stripePublishableKey}',
      stripeConnectedAccountId: '${templateData.stripeConnectedAccountId || ''}'
    };
    var PRELOADED_MENU = ${JSON.stringify(preloadedMenu)};
  <\/script>
  <script>${portalJs}<\/script>
  <script>${embedAppJs}<\/script>
  <script>
    var embedApp = new EmbedApp(EMBED_CONFIG);
  <\/script>
</body>
</html>`;

        res.set({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'ALLOWALL'
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
                        <body><div class="container"><h1>⚠️ Template Not Found</h1><p>Template "${templateId}" needs to be uploaded to storage or added to local templates.</p></div></body></html>
                    `);
        }
      }

      // Render template with data
      const renderedHtml = renderTemplate(templateHtml, templateData);

      // Set headers
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff'
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

// Upload templates to storage (admin function)
exports.uploadTemplate = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { templateId, templateHtml } = request.data;

    if (!templateId || !templateHtml) {
      throw new HttpsError('invalid-argument', 'Template ID and HTML are required');
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
    throw new HttpsError('internal', error.message);
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
      websiteUrl: `https://${slug}.restaurant-portal-6b147.web.app`,
      previewUrl: `https://us-central1-restaurant-portal-6b147.cloudfunctions.net/serveWebsite?restaurant=${slug}&preview=true${locationParam}`
    };
  } catch (error) {
    console.error('Error saving website config:', error);
    throw new HttpsError('internal', error.message);
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
      websiteUrl: `https://us-central1-restaurant-portal-6b147.cloudfunctions.net/serveWebsite?restaurant=${slug}`,
      message: 'Website published successfully!'
    };
  } catch (error) {
    console.error('Error publishing website:', error);
    throw new HttpsError('internal', error.message);
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

      console.log('Menu data loaded successfully:', categories.length, 'categories for location:', locationId || 'all');
      res.json({ categories });
    } catch (error) {
      console.error('Error serving menu:', error);
      res.status(500).json({ error: 'Error loading menu: ' + error.message });
    }
  });
});

// Handle order submissions
exports.submitOrder = onRequest((request, response) => {
  cors(request, response, async () => {
    try {
      if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
      }

      const orderData = request.body;
      console.log('Received order data:', orderData);

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

      // Generate order number (timestamp + random digits)
      const orderNumber = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      const db = admin.firestore();
      const subtotal = orderData.subtotal || 0;
      const taxRate = orderData.taxRate || 0;

      // Validate and apply promo code if provided
      let promoDiscount = 0;
      let promoValidation = null;
      if (orderData.promoCode) {
        promoValidation = await validatePromoInternal(db, orderData.restaurantId, orderData.promoCode, subtotal);
        if (promoValidation.valid) {
          if (promoValidation.discountUnit === 'percentage') {
            promoDiscount = subtotal * (promoValidation.discountValue / 100);
          } else {
            promoDiscount = promoValidation.discountValue;
          }
          promoDiscount = Math.min(promoDiscount, subtotal); // Cap at subtotal
          promoDiscount = Math.round(promoDiscount * 100) / 100; // Round to 2 decimals
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
      const serverTotal = Math.round((discountedSubtotal + serverTax) * 100) / 100;

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

      // Create the order document
      // For website orders, locationId defaults to restaurantId (single location setup)
      // orderType: 'pickup' or 'delivery' from website, 'dine_in' from POS
      const orderDoc = {
        orderNumber,
        restaurantId: orderData.restaurantId,
        locationId: orderData.locationId || orderData.restaurantId, // Default to restaurantId for single-location
        customerId: orderData.customerId || null, // Track authenticated customer
        customer: orderData.customer,
        items: orderData.items,
        subtotal: subtotal,
        tax: serverTax,
        taxRate: taxRate, // Store tax rate used
        total: serverTotal,
        promoCode: promoValidation?.valid ? orderData.promoCode : null,
        promotionId: promoValidation?.valid ? promoValidation.promotionId : null,
        promoDiscount: promoDiscount,
        promoType: promoValidation?.valid ? promoValidation.type : null,
        pointsRedeemed: pointsRedeemed || 0,
        pointsDiscount: pointsDiscount || 0,
        rewardId: redeemedRewardId || null,
        rewardDiscount: rewardDiscount || 0,
        loyaltyPointsEarned, // Track points earned for this order
        pickupTime: orderData.pickupTime,
        orderType: orderData.orderType || 'pickup', // Default to pickup for website orders
        paymentMethod: orderData.paymentMethod,
        paymentDetails: orderData.paymentDetails || null, // Store Stripe payment details
        source: orderData.source || 'website', // Track order source
        status: 'new', // Website orders start as 'new', POS orders are 'sent_to_kitchen'
        createdAt: FieldValue.serverTimestamp()
      };

      // Save order to Firestore
      await db.collection('orders').doc(orderNumber).set(orderDoc);

      // Also save a reference in the restaurant's orders collection
      await db
        .collection(`restaurants/${orderData.restaurantId}/orders`)
        .doc(orderNumber)
        .set(orderDoc);

      // Mark promo claim as used
      if (promoValidation?.valid && promoValidation.claimId) {
        try {
          await db.doc(`restaurants/${orderData.restaurantId}/promotionClaims/${promoValidation.claimId}`).update({
            used: true,
            usedAt: FieldValue.serverTimestamp(),
            usedInOrder: orderNumber
          });
          console.log(`Marked promo claim ${promoValidation.claimId} as used in order ${orderNumber}`);
        } catch (promoErr) {
          console.error('Error marking promo claim as used:', promoErr);
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
      response.json({
        success: true,
        orderId: orderNumber,
        loyaltyPointsEarned,
        message: 'Order submitted successfully'
      });
    } catch (error) {
      console.error('Error submitting order:', error);
      response.status(500).json({ error: 'Failed to submit order: ' + error.message });
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
      ? `https://${slug}.restaurant-portal-6b147.web.app`
      : `https://${restaurantId}.restaurant-portal-6b147.web.app`;

    return {
      success: true,
      websiteUrl: websiteUrl,
      message: 'Website updated successfully'
    };
  } catch (error) {
    console.error('Error in updateWebsite:', error);
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message || 'Failed to parse menu image');
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
    throw new HttpsError('internal', error.message || 'Failed to generate AI analytics');
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
      `&redirect_uri=${encodeURIComponent(redirectUri || 'https://restaurant-portal-6b147.web.app/auth/google-business/callback')}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    return { success: true, authUrl };
  } catch (error) {
    console.error('Error initiating Google auth:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
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
        redirect_uri: req.query.redirect_uri || 'https://restaurant-portal-6b147.web.app/auth/google-business/callback',
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
      res.redirect('https://restaurant-portal-6b147.web.app/seo-social?google_connected=true');
    } catch (error) {
      console.error('Error in Google auth callback:', error.response?.data || error.message);
      res.redirect('https://restaurant-portal-6b147.web.app/seo-social?google_error=true');
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
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
    throw new HttpsError('internal', error.message);
  }
});

// ============================================
// STRIPE TERMINAL FUNCTIONS (Mobile POS App)
// ============================================

/**
 * Create a connection token for the Stripe Terminal SDK.
 * Called on app launch and whenever the SDK needs to reconnect.
 */
exports.createTerminalConnectionToken = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const params = {};
    if (request.data && request.data.locationId) {
      params.location = request.data.locationId;
    }

    const connectionToken = await stripe.terminal.connectionTokens.create(params);

    return { secret: connectionToken.secret };
  } catch (error) {
    console.error('Error creating terminal connection token:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Create a Stripe Terminal Location for the restaurant.
 * A location is required to connect a Tap to Pay reader.
 */
exports.createTerminalLocation = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const { displayName, address } = request.data;

    if (!displayName || !address || !address.line1 || !address.city || !address.state || !address.postal_code) {
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
        restaurantId: request.auth.uid,
      },
    });

    // Save location ID to Firestore for future use
    const db = admin.firestore();
    const settingsRef = db.doc(`restaurants/${request.auth.uid}/settings/terminal`);
    await settingsRef.set(
      { stripeTerminalLocationId: location.id, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    return {
      locationId: location.id,
      displayName: location.display_name,
    };
  } catch (error) {
    console.error('Error creating terminal location:', error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Retrieve the restaurant's Terminal Location from Stripe.
 */
exports.getTerminalLocation = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const db = admin.firestore();
    const settingsDoc = await db.doc(
      `restaurants/${request.auth.uid}/settings/terminal`
    ).get();

    const locationId = settingsDoc.data()?.stripeTerminalLocationId;
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
    throw new HttpsError('internal', error.message);
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
  const codes = [];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  for (let i = 0; i < 8; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      if (j === 4) code += '-';
      code += chars.charAt(Math.floor(Math.random() * chars.length));
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
    ? 'http://localhost:5001/restaurant-portal-6b147/us-central1/handleTwitterCallback'
    : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net/handleTwitterCallback';

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
      ? 'http://localhost:5001/restaurant-portal-6b147/us-central1/handleTwitterCallback'
      : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net/handleTwitterCallback';

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
    const appUrl = isEmulator ? 'http://localhost:3000' : 'https://restaurant-portal-6b147.web.app';
    return res.redirect(`${appUrl}/seo-social?twitter_connected=true`);
  } catch (error) {
    console.error('Twitter OAuth callback error:', error.response?.data || error.message);
    const appUrl = process.env.FUNCTIONS_EMULATOR === 'true'
      ? 'http://localhost:3000'
      : 'https://restaurant-portal-6b147.web.app';
    return res.redirect(`${appUrl}/seo-social?twitter_error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * Helper to get app URL
 */
function getAppUrl() {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  return isEmulator ? 'http://localhost:3000' : 'https://restaurant-portal-6b147.web.app';
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
    throw new HttpsError('internal', 'Failed to create staff auth account: ' + err.message);
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
 * Returns null if the restaurant hasn't connected Stripe (fallback to platform account).
 */
async function getStripeConnectAccountId(restaurantId) {
  if (!restaurantId) return null;
  try {
    const db = admin.firestore();
    const connectDoc = await db.doc(`restaurants/${restaurantId}/settings/stripeConnect`).get();
    if (!connectDoc.exists) return null;
    const data = connectDoc.data();
    if (data.status === 'active' && data.stripeAccountId) {
      return data.stripeAccountId;
    }
    return null;
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
exports.initiateStripeConnect = onCall(async (request) => {
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
    const baseUrl = request.data?.returnUrl || 'https://restaurant-portal-6b147.web.app';
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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Refresh a Stripe Connect onboarding link (if the previous one expired).
 */
exports.refreshStripeConnectLink = onCall(async (request) => {
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
    const baseUrl = request.data?.returnUrl || 'https://restaurant-portal-6b147.web.app';
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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Check if a Stripe Connect account has completed onboarding.
 * Called after the user returns from Stripe onboarding.
 */
exports.checkStripeConnectStatus = onCall(async (request) => {
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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Get current Stripe Connect status for the restaurant.
 */
exports.getStripeConnectStatus = onCall(async (request) => {
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
    throw new HttpsError('internal', error.message);
  }
});

/**
 * Disconnect a restaurant's Stripe Connect account.
 */
exports.disconnectStripeConnect = onCall(async (request) => {
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
    throw new HttpsError('internal', error.message);
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