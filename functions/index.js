const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

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