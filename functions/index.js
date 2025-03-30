const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors')({ origin: true });

admin.initializeApp();

exports.processSocialMediaPost = functions.firestore
  .document('socialMediaPosts/{postId}')
  .onCreate(async (snap, context) => {
    const postData = snap.data();
    const postId = context.params.postId;
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

// Public API endpoint to get restaurant menu
exports.getMenu = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    try {
      const restaurantId = request.query.restaurantId;
      if (!restaurantId) {
        return response.status(400).json({ error: 'Restaurant ID is required' });
      }

      console.log('Fetching menu for restaurant:', restaurantId);

      // Get all menu categories
      const categoriesSnapshot = await admin.firestore()
        .collection(`restaurants/${restaurantId}/menuCategories`)
        .orderBy('name')
        .get();

      const categories = [];
      
      // Get items for each category
      for (const categoryDoc of categoriesSnapshot.docs) {
        const category = {
          id: categoryDoc.id,
          ...categoryDoc.data(),
          items: []
        };

        const itemsSnapshot = await admin.firestore()
          .collection(`restaurants/${restaurantId}/menuCategories/${categoryDoc.id}/items`)
          .orderBy('name')
          .get();

        itemsSnapshot.forEach(itemDoc => {
          category.items.push({
            id: itemDoc.id,
            ...itemDoc.data()
          });
        });

        categories.push(category);
      }

      console.log('Returning menu data with categories:', categories.length);

      // Return the menu data
      response.json({ categories });
    } catch (error) {
      console.error('Error getting menu:', error);
      response.status(500).json({ error: 'Failed to get menu data: ' + error.message });
    }
  });
});

// Handle order submissions
exports.submitOrder = functions.https.onRequest((request, response) => {
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