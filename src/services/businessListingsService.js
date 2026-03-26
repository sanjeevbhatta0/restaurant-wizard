import { functions, db } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, orderBy, where, getDocs, limit as firestoreLimit } from 'firebase/firestore';

const businessListingsService = {
  // ---- YELP ----

  searchYelpBusiness: async (name, location) => {
    const fn = httpsCallable(functions, 'searchYelpBusiness');
    const result = await fn({ name, location });
    return result.data;
  },

  connectYelpBusiness: async (businessId) => {
    const fn = httpsCallable(functions, 'connectYelpBusiness');
    const result = await fn({ businessId });
    return result.data;
  },

  fetchYelpReviews: async (businessId) => {
    const fn = httpsCallable(functions, 'fetchYelpReviews');
    const result = await fn({ businessId });
    return result.data;
  },

  disconnectYelp: async (userId) => {
    const docRef = doc(db, `restaurants/${userId}/settings/businessListings`);
    await setDoc(docRef, { yelp: { connected: false } }, { merge: true });

    // Delete cached Yelp reviews
    const reviewsQuery = query(
      collection(db, `restaurants/${userId}/businessReviews`),
      where('platform', '==', 'yelp')
    );
    const snapshot = await getDocs(reviewsQuery);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  },

  // ---- GOOGLE BUSINESS ----

  initiateGoogleAuth: async (redirectUri) => {
    const fn = httpsCallable(functions, 'initiateGoogleAuth');
    const result = await fn({ redirectUri });
    return result.data;
  },

  fetchGoogleReviews: async () => {
    const fn = httpsCallable(functions, 'fetchGoogleReviews');
    const result = await fn({});
    return result.data;
  },

  replyToGoogleReview: async (reviewName, replyText) => {
    const fn = httpsCallable(functions, 'replyToGoogleReview');
    const result = await fn({ reviewName, replyText });
    return result.data;
  },

  disconnectGoogle: async (userId) => {
    const docRef = doc(db, `restaurants/${userId}/settings/businessListings`);
    await setDoc(docRef, { google: { connected: false, refreshToken: null } }, { merge: true });

    // Delete cached Google reviews
    const reviewsQuery = query(
      collection(db, `restaurants/${userId}/businessReviews`),
      where('platform', '==', 'google')
    );
    const snapshot = await getDocs(reviewsQuery);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  },

  // ---- APPLE BUSINESS (Firestore only) ----

  saveAppleBusinessInfo: async (userId, info) => {
    const docRef = doc(db, `restaurants/${userId}/settings/businessListings`);
    await setDoc(docRef, {
      apple: {
        connected: true,
        manualEntry: true,
        businessName: info.businessName || '',
        appleConnectUrl: info.appleConnectUrl || '',
        notes: info.notes || '',
        connectedAt: new Date().toISOString()
      }
    }, { merge: true });
  },

  disconnectApple: async (userId) => {
    const docRef = doc(db, `restaurants/${userId}/settings/businessListings`);
    await setDoc(docRef, { apple: { connected: false } }, { merge: true });
  },

  // ---- CROSS-PLATFORM ----

  getConnections: async (userId) => {
    const docRef = doc(db, `restaurants/${userId}/settings/businessListings`);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : {};
  },

  disconnectPlatform: async (userId, platform) => {
    if (platform === 'yelp') return businessListingsService.disconnectYelp(userId);
    if (platform === 'google') return businessListingsService.disconnectGoogle(userId);
    if (platform === 'apple') return businessListingsService.disconnectApple(userId);
  },

  // ---- REVIEWS ----

  getCachedReviews: async (userId, platform, limitCount = 50) => {
    let reviewsQuery;
    if (platform && platform !== 'all') {
      reviewsQuery = query(
        collection(db, `restaurants/${userId}/businessReviews`),
        where('platform', '==', platform),
        orderBy('createdAt', 'desc'),
        firestoreLimit(limitCount)
      );
    } else {
      reviewsQuery = query(
        collection(db, `restaurants/${userId}/businessReviews`),
        orderBy('createdAt', 'desc'),
        firestoreLimit(limitCount)
      );
    }
    const snapshot = await getDocs(reviewsQuery);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // ---- AI ----

  generateReviewResponse: async (params) => {
    const fn = httpsCallable(functions, 'generateReviewResponse');
    const result = await fn(params);
    return result.data;
  },

  generateVisibilityTasks: async (params) => {
    const fn = httpsCallable(functions, 'generateVisibilityTasks');
    const result = await fn(params);
    return result.data;
  },

  // ---- VISIBILITY TASKS ----

  getVisibilityTasks: async (userId) => {
    const tasksQuery = query(
      collection(db, `restaurants/${userId}/visibilityTasks`),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(tasksQuery);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  updateTaskStatus: async (userId, taskId, status) => {
    const taskRef = doc(db, `restaurants/${userId}/visibilityTasks/${taskId}`);
    const updateData = { status };
    if (status === 'completed') updateData.completedAt = new Date().toISOString();
    await updateDoc(taskRef, updateData);
  },

  // ---- OVERVIEW ----

  getBusinessListingsOverview: async () => {
    const fn = httpsCallable(functions, 'getBusinessListingsOverview');
    const result = await fn({});
    return result.data;
  }
};

export default businessListingsService;
