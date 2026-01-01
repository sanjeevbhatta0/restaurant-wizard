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
    await db.collection(`restaurants/${restaurantId}/reimbursements`).add({
      orderId: orderId,
      orderNumber: orderData.orderNumber || orderId,
      tableNumber: orderData.tableNumber,
      amount: refundAmount,
      type: refundType,
      originalOrderTotal: orderData.total || 0,
      stripeRefundId: refund.id,
      stripePaymentIntentId: paymentIntentId,
      processedAt: FieldValue.serverTimestamp(),
      processedBy: request.auth.uid
    });

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

// Serve restaurant websites
exports.serveWebsite = onRequest(async (req, res) => {
    return cors(req, res, async () => {
        try {
            // Get restaurant identifier from the host
            const host = req.hostname;
            console.log('Incoming request hostname:', host);

            // Handle both subdomain.restaurant-portal-6b147.web.app and direct function URL cases
            let restaurantId;
            let restaurant;

            if (host.includes('restaurant-portal-6b147.web.app')) {
                const subdomain = host.split('.')[0];
                // Try to find restaurant by slug first
                restaurant = await getRestaurantBySlug(subdomain);
                if (restaurant) {
                    restaurantId = restaurant.id;
                } else {
                    // Fallback to using subdomain as ID
                    restaurantId = subdomain;
                }
            } else {
                // If accessed directly via function URL, try to get restaurant ID from query param
                const slug = req.query.restaurant;
                if (slug) {
                    restaurant = await getRestaurantBySlug(slug);
                    if (restaurant) {
                        restaurantId = restaurant.id;
                    }
                }
            }

            if (!restaurantId) {
                console.error('No restaurant found:', { host, query: req.query });
                res.status(404).send(`
                    <html>
                        <head>
                            <title>Restaurant Not Found</title>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                                .error-container { max-width: 600px; margin: 40px auto; }
                            </style>
                        </head>
                        <body>
                            <div class="error-container">
                                <h1>Restaurant Not Found</h1>
                                <p>The restaurant you're looking for doesn't exist.</p>
                            </div>
                        </body>
                    </html>
                `);
                return;
            }

            // Get the website HTML from storage
            const bucket = admin.storage().bucket();
            const file = bucket.file(`websites/${restaurantId}/index.html`);
            
            // Check if file exists
            const [exists] = await file.exists();
            if (!exists) {
                console.error('Website file not found for restaurant:', restaurantId);
                res.status(404).send(`
                    <html>
                        <head>
                            <title>Website Not Found</title>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                                .error-container { max-width: 600px; margin: 40px auto; }
                            </style>
                        </head>
                        <body>
                            <div class="error-container">
                                <h1>Website Not Published</h1>
                                <p>This restaurant's website hasn't been published yet.</p>
                            </div>
                        </body>
                    </html>
                `);
                return;
            }

            // Set security headers
            res.set({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; img-src 'self' https: data: blob:;",
                'Access-Control-Allow-Origin': '*'
            });

            // Stream the file to the response
            file.createReadStream()
                .on('error', (error) => {
                    console.error('Error streaming file:', error);
                    res.status(500).send(`
                        <html>
                            <head>
                                <title>Error</title>
                                <style>
                                    body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                                    .error-container { max-width: 600px; margin: 40px auto; }
                                </style>
                            </head>
                            <body>
                                <div class="error-container">
                                    <h1>Error</h1>
                                    <p>An error occurred while loading the website. Please try again later.</p>
                                </div>
                            </body>
                        </html>
                    `);
                })
                .pipe(res);
        } catch (error) {
            console.error('Error serving website:', error);
            res.status(500).send(`
                <html>
                    <head>
                        <title>Error</title>
                        <style>
                            body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
                            .error-container { max-width: 600px; margin: 40px auto; }
                        </style>
                    </head>
                    <body>
                        <div class="error-container">
                            <h1>Error</h1>
                            <p>An error occurred while loading the website. Please try again later.</p>
                        </div>
                    </body>
                </html>
            `);
        }
    });
});

// Serve menu data
exports.getMenu = onRequest(async (req, res) => {
    return cors(req, res, async () => {
        try {
            // Get restaurant ID from query parameter
            const restaurantId = req.query.restaurantId;
            console.log('Getting menu for restaurant:', restaurantId);
            
            if (!restaurantId) {
                console.error('No restaurant ID provided');
                return res.status(400).json({ error: 'Restaurant ID is required' });
            }
            
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
                    // Ensure price and discount are numbers
                    categoryData.items.push({
                        id: itemDoc.id,
                        ...itemData,
                        price: typeof itemData.price === 'number' ? itemData.price : parseFloat(itemData.price) || 0,
                        discount: typeof itemData.discount === 'number' ? itemData.discount : parseFloat(itemData.discount) || 0,
                        discountType: itemData.discountType || 'amount'
                    });
                });
                
                categories.push(categoryData);
            }

            console.log('Menu data loaded successfully:', categories.length, 'categories');
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
      const orderDoc = {
        orderNumber,
        restaurantId: orderData.restaurantId,
        customer: orderData.customer,
        items: orderData.items,
        total: orderData.total,
        pickupTime: orderData.pickupTime,
        orderType: orderData.orderType,
        paymentMethod: orderData.paymentMethod,
        status: 'new',
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