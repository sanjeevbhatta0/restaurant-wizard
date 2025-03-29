import { db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc, collection } from 'firebase/firestore';

// Collection names
const SOCIAL_CONNECTIONS_COLLECTION = 'socialMediaConnections';
const SOCIAL_POSTS_COLLECTION = 'socialMediaPosts';

export const socialMediaService = {
  // Get user's social media connections
  async getUserConnections(userId) {
    try {
      const docRef = doc(db, SOCIAL_CONNECTIONS_COLLECTION, userId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return docSnap.data();
      } else {
        // Initialize empty connections document
        const initialData = {
          facebook: { connected: false, token: null },
          instagram: { connected: false, token: null },
          twitter: { connected: false, token: null },
          userId
        };
        await setDoc(docRef, initialData);
        return initialData;
      }
    } catch (error) {
      console.error('Error getting user connections:', error);
      throw error;
    }
  },

  // Update social media connection status
  async updateConnection(userId, platform, connectionData) {
    try {
      const docRef = doc(db, SOCIAL_CONNECTIONS_COLLECTION, userId);
      await updateDoc(docRef, {
        [platform]: connectionData
      });
    } catch (error) {
      console.error('Error updating connection:', error);
      throw error;
    }
  },

  // Store social media post
  async createPost(userId, postData) {
    try {
      const postsCollection = collection(db, SOCIAL_POSTS_COLLECTION);
      const postDoc = doc(postsCollection);
      
      await setDoc(postDoc, {
        userId,
        content: postData.content,
        imageUrl: postData.imageUrl || null,
        platforms: postData.platforms,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      return postDoc.id;
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