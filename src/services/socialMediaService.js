import { db } from '../firebase';
import { doc, setDoc, getDoc, updateDoc, collection } from 'firebase/firestore';

// Collection names
const SOCIAL_CONNECTIONS_COLLECTION = 'socialMediaConnections';
const SOCIAL_POSTS_COLLECTION = 'socialMediaPosts';

const socialMediaService = {
  // Get user's social media connections
  getConnections: async (userId) => {
    try {
      const docRef = doc(db, 'users', userId, 'settings', 'socialMedia');
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        console.log('Found existing connections:', docSnap.data());
        return docSnap.data();
      } else {
        console.log('No existing connections found');
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
      console.log('Updating connection for:', { userId, platform, connectionData });
      const docRef = doc(db, 'users', userId, 'settings', 'socialMedia');
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        // Update existing document
        await updateDoc(docRef, {
          [platform]: connectionData
        });
      } else {
        // Create new document
        await setDoc(docRef, {
          [platform]: connectionData
        });
      }
      console.log('Connection updated successfully');
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