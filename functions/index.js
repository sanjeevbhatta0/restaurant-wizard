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
        '{{year}}': new Date().getFullYear().toString(),
        '{{apiBaseUrl}}': data.apiBaseUrl || 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net',
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
                // Use emulator URL if running in emulator, otherwise production
                apiBaseUrl: process.env.FUNCTIONS_EMULATOR === 'true' 
                    ? 'http://localhost:5001/restaurant-portal-6b147/us-central1'
                    : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net',
                stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51SkXC0KckjWrEVo2Ds2i9mmr5IONkNEYa5an7d4lEr2qg29M3y88UzQRCZoqSzJ92qoTBffVm1AWEPB5uYxdhpsD00bsPkUN15'
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
        const db = admin.firestore();

        // Mark website as published
        await db.doc(`restaurants/${restaurantId}/website/config`).update({
            isPublished: true,
            publishedAt: FieldValue.serverTimestamp()
        });

        // Get slug for URL
        const restaurantDoc = await db.doc(`restaurants/${restaurantId}`).get();
        const slug = restaurantDoc.data().slug || restaurantId;

        return { 
            success: true, 
            websiteUrl: `https://${slug}.restaurant-portal-6b147.web.app`,
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
        total: orderData.total,
        pickupTime: orderData.pickupTime,
        orderType: orderData.orderType || 'pickup', // Default to pickup for website orders
        paymentMethod: orderData.paymentMethod,
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