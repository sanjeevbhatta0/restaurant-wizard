import { db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc, collection } from 'firebase/firestore';

// Collection names
const SOCIAL_CONNECTIONS_COLLECTION = 'socialMediaConnections';
const SOCIAL_POSTS_COLLECTION = 'socialMediaPosts';

const socialMediaService = {
  // Get user's social media connections
  getConnections: async (userId) => {
    try {
      const docRef = doc(db, 'restaurants', userId, 'settings', 'socialMedia');
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return docSnap.data();
      } else {
        return {};
      }
    } catch (error) {
      console.error('Error getting connections:', error);
      throw error;
    }
  },

  // Update social media connection status
  updateConnection: async (userId, platform, connectionData) => {
    try {
      const docRef = doc(db, 'restaurants', userId, 'settings', 'socialMedia');
      await setDoc(docRef, {
        [platform]: connectionData
      }, { merge: true });
    } catch (error) {
      console.error('Error updating connection:', error);
      throw error;
    }
  },

  // Store social media post
  createPost: async (userId, postData) => {
    try {
      const postRef = doc(collection(db, 'users', userId, 'socialPosts'));
      await setDoc(postRef, {
        content: postData.content,
        imageUrl: postData.imageUrl || null,
        platforms: postData.platforms,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return postRef.id;
    } catch (error) {
      console.error('Error creating post:', error);
      throw error;
    }
  },

  // Get post status
  async getPostStatus(postId) {
    try {
      const postDoc = doc(db, SOCIAL_POSTS_COLLECTION, postId);
      const postSnap = await getDoc(postDoc);
      
      if (postSnap.exists()) {
        return postSnap.data();
      }
      throw new Error('Post not found');
    } catch (error) {
      console.error('Error getting post status:', error);
      throw error;
    }
  }
};

export default socialMediaService; 