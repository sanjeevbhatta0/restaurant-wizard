const { onRequest, onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors')({ origin: true });

admin.initializeApp();

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
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch (error) {
      console.error('Error processing social media post:', error);
      await snap.ref.update({
        status: 'failed',
        error: error.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
        createdAt: admin.firestore.FieldValue.serverTimestamp()
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

const { HttpsError } = require('firebase-functions/v2/https');

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