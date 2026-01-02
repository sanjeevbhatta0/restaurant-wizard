const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');
const cors = require('cors')({ origin: true });

admin.initializeApp();

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

    const { amount, currency = 'usd', orderIds, tableNumbers, restaurantId, metadata = {} } = request.data;

    // Validate amount
    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid payment amount');
    }

    // Validate restaurant ownership
    if (restaurantId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Not authorized for this restaurant');
    }

    // Convert amount to cents (Stripe uses smallest currency unit)
    const amountInCents = Math.round(amount * 100);

    // Create a PaymentIntent with the order details
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        restaurantId: restaurantId,
        orderIds: JSON.stringify(orderIds),
        tableNumbers: JSON.stringify(tableNumbers),
        ...metadata
      }
    });

    // Return the client secret for the frontend
    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
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

    // Verify restaurant ownership
    if (restaurantId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Not authorized for this restaurant');
    }

    // Retrieve the payment intent to verify it's actually paid
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

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

    // Verify restaurant ownership
    if (restaurantId !== request.auth.uid) {
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

    // Create Stripe refund
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundAmountCents,
      reason: reason,
      metadata: {
        orderId: orderId,
        restaurantId: restaurantId,
        refundType: refundType
      }
    });

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

    return {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY'
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
    // Get user's social media tokens
    const userConnections = await db
      .collection('socialMediaConnections')
      .doc(postData.userId)
      .get();

    if (!userConnections.exists) {
      throw new Error('User social media connections not found');
    }

    const connections = userConnections.data();
    const updates = [];

    // Post to each selected platform
    if (postData.platforms.facebook && connections.facebook.connected) {
      updates.push(postToFacebook(postData, connections.facebook.token));
    }

    if (postData.platforms.instagram && connections.instagram.connected) {
      updates.push(postToInstagram(postData, connections.instagram.token));
    }

    if (postData.platforms.twitter && connections.twitter.connected) {
      updates.push(postToTwitter(postData, connections.twitter.token));
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
  // TODO: Implement actual Instagram API call
  console.log('Posting to Instagram:', postData);
  return Promise.resolve();
}

async function postToTwitter(postData, token) {
  // TODO: Implement actual Twitter API call
  console.log('Posting to Twitter:', postData);
  return Promise.resolve();
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
  let html = template;

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
    '{{year}}': new Date().getFullYear().toString(),
    '{{apiBaseUrl}}': data.apiBaseUrl || 'https://restaurant-portal-6b147.web.app',
    '{{stripePublishableKey}}': data.stripePublishableKey || '',
    '{{hoursJson}}': JSON.stringify(data.hours || {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '12:00', close: '23:00' },
      sunday: { open: '12:00', close: '21:00' }
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
        taxRate: finalTaxRate
      };

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

      // Create the order document
      // For website orders, locationId defaults to restaurantId (single location setup)
      // orderType: 'pickup' or 'delivery' from website, 'dine_in' from POS
      const orderDoc = {
        orderNumber,
        restaurantId: orderData.restaurantId,
        locationId: orderData.locationId || orderData.restaurantId, // Default to restaurantId for single-location
        customer: orderData.customer,
        items: orderData.items,
        subtotal: orderData.subtotal || 0,
        tax: orderData.tax || 0,
        taxRate: orderData.taxRate || 0, // Store tax rate used
        total: orderData.total,
        pickupTime: orderData.pickupTime,
        orderType: orderData.orderType || 'pickup', // Default to pickup for website orders
        paymentMethod: orderData.paymentMethod,
        paymentDetails: orderData.paymentDetails || null, // Store Stripe payment details
        source: orderData.source || 'website', // Track order source
        status: 'new', // Website orders start as 'new', POS orders are 'sent_to_kitchen'
        createdAt: FieldValue.serverTimestamp()
      };

      // Save order to Firestore
      const orderRef = await admin.firestore()
        .collection('orders')
        .doc(orderNumber)
        .set(orderDoc);

      // Also save a reference in the restaurant's orders collection
      await admin.firestore()
        .collection(`restaurants/${orderData.restaurantId}/orders`)
        .doc(orderNumber)
        .set(orderDoc);

      // Return success with order ID
      response.json({
        success: true,
        orderId: orderNumber,
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

// Gemini API key - set via Firebase Functions config or environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Helper function to call Gemini API
 */
async function callGeminiAPI(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY environment variable.');
  }

  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
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
exports.generateAIContent = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { type, platform, tone, context } = request.data;

    // Build the prompt based on content type
    let prompt = `You are a social media expert for restaurants. Generate a ${platform} post for a restaurant.

Restaurant Name: ${context.restaurantName || 'Our Restaurant'}
Cuisine Type: ${context.cuisineType || 'Restaurant'}
`;

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
exports.improveAIContent = onCall(async (request) => {
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
exports.generateHashtags = onCall(async (request) => {
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
exports.getSeoRecommendations = onCall(async (request) => {
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
exports.getContentIdeas = onCall(async (request) => {
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
exports.parseMenuImage = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { imageData, mimeType } = request.data;

    if (!imageData) {
      throw new HttpsError('invalid-argument', 'Image data is required');
    }

    if (!GEMINI_API_KEY) {
      throw new HttpsError('failed-precondition', 'Gemini API key not configured');
    }

    console.log('Parsing menu image, mimeType:', mimeType);

    // Use Gemini Vision API to parse the menu
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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

/**
 * Get AI-powered analytics insights
 * Supports 3 tiers: essential, differentiation, premium
 */
exports.getAIAnalytics = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { tier, analysisType, orderData, menuData, question } = request.data;

    if (!GEMINI_API_KEY) {
      throw new HttpsError('failed-precondition', 'Gemini API key not configured');
    }

    let prompt = '';
    let systemContext = `You are an expert restaurant business analyst. Analyze the provided data and give actionable insights. Be specific with numbers and percentages. Use a friendly, professional tone suitable for restaurant owners.`;

    // Build context from order data
    const orderSummary = orderData ? `
Restaurant Order Data Summary:
- Total Orders: ${orderData.totalOrders || 0}
- Total Revenue: $${(orderData.totalRevenue || 0).toFixed(2)}
- Average Order Value: $${(orderData.avgOrderValue || 0).toFixed(2)}
- Top Selling Items: ${(orderData.topItems || []).slice(0, 5).map(i => `${i.name} (${i.count})`).join(', ')}
- Orders by Day: ${JSON.stringify(orderData.ordersByDay || {})}
- Orders by Hour: ${JSON.stringify(orderData.ordersByHour || {})}
- Recent Order Trend: ${orderData.trend || 'stable'}
` : 'No order data available.';

    const menuSummary = menuData ? `
Menu Data:
- Total Categories: ${menuData.categoryCount || 0}
- Total Items: ${menuData.itemCount || 0}
- Price Range: $${menuData.minPrice || 0} - $${menuData.maxPrice || 0}
- Average Item Price: $${(menuData.avgPrice || 0).toFixed(2)}
- Items with Discounts: ${menuData.discountedItems || 0}
` : 'No menu data available.';

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
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
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