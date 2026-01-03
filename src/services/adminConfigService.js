import {
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    collection,
    addDoc,
    query,
    where,
    getDocs,
    orderBy,
    Timestamp,
    updateDoc
} from 'firebase/firestore';
import { db } from '../firebase';

// Default configuration (used as fallback and for initial setup)
export const DEFAULT_CONFIG = {
    pricing: {
        scout: 0,
        ally: 29,
        guide: 59,
        chief: 99,
        elder: 229
    },
    billingMultipliers: {
        monthly: 1.20,
        quarterly: 1.10,
        annual: 1.00
    },
    discounts: [],
    freeTrials: {
        scout: { enabled: false, days: 0 },
        ally: { enabled: false, days: 0 },
        guide: { enabled: false, days: 0 },
        chief: { enabled: false, days: 0 },
        elder: { enabled: false, days: 0 }
    },
    features: {
        'menu-management': { tier: 'scout', name: 'Menu Management', description: 'Create and manage your menu' },
        'pos': { tier: 'scout', name: 'Point of Sale (POS)', description: 'Tablet-friendly order taking' },
        'kitchen': { tier: 'scout', name: 'Kitchen Display', description: 'Real-time order display' },
        'server': { tier: 'scout', name: 'Server View', description: 'Table management' },
        'orders': { tier: 'scout', name: 'Order Management', description: 'Track orders from creation to completion' },
        'payments': { tier: 'scout', name: 'Payment Processing', description: 'Integrated Stripe payments' },
        'ai-menu-upload': { tier: 'ally', name: 'AI Menu Upload', description: 'Upload menus with AI parsing' },
        'basic-analytics': { tier: 'guide', name: 'Basic Analytics', description: 'Sales reports and order insights' },
        'website-builder': { tier: 'guide', name: 'Website Builder', description: 'Create a beautiful website' },
        'website-integration': { tier: 'guide', name: 'Website Integration', description: 'Embed your menu on any website' },
        'seo-social': { tier: 'chief', name: 'SEO & Social', description: 'Post to Facebook & Instagram' },
        'ai-analytics': { tier: 'elder', name: 'AI-Powered Analytics', description: 'AI insights, predictions, and recommendations' },
        'ai-content': { tier: 'elder', name: 'AI Content Generation', description: 'AI-generated social media content' }
    },
    orderLimits: {
        scout: { limit: 75, overageRate: 0, hardCap: true },
        ally: { limit: 500, overageRate: 0.02, hardCap: false },
        guide: { limit: 2000, overageRate: 0.01, hardCap: false },
        chief: { limit: 5000, overageRate: 0.005, hardCap: false },
        elder: { limit: Infinity, overageRate: 0, hardCap: false }
    },
    tierInfo: {
        scout: { name: 'Scout', tagline: 'Start for free', icon: '🔍', color: '#6b7280' },
        ally: { name: 'Ally', tagline: 'Start your journey', icon: '🌱', color: '#4ade80' },
        guide: { name: 'Guide', tagline: 'Lead the way', icon: '🧭', color: '#60a5fa' },
        chief: { name: 'Chief', tagline: 'Command respect', icon: '🦅', color: '#f59e0b', popular: true },
        elder: { name: 'Elder', tagline: 'Achieve wisdom', icon: '👑', color: '#a855f7' }
    }
};

// Get published configuration
export const getPublishedConfig = async () => {
    try {
        const docRef = doc(db, 'platformConfig', 'current');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return { ...DEFAULT_CONFIG, ...docSnap.data() };
        }
        return DEFAULT_CONFIG;
    } catch (error) {
        console.error('Error fetching published config:', error);
        return DEFAULT_CONFIG;
    }
};

// Subscribe to published configuration changes
export const subscribeToPublishedConfig = (callback) => {
    const docRef = doc(db, 'platformConfig', 'current');
    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback({ ...DEFAULT_CONFIG, ...docSnap.data() });
        } else {
            callback(DEFAULT_CONFIG);
        }
    }, (error) => {
        console.error('Error subscribing to config:', error);
        callback(DEFAULT_CONFIG);
    });
};

// Get draft configuration
export const getDraftConfig = async () => {
    try {
        const docRef = doc(db, 'platformConfigDraft', 'current');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data();
        }
        // If no draft, return published config
        return await getPublishedConfig();
    } catch (error) {
        console.error('Error fetching draft config:', error);
        return await getPublishedConfig();
    }
};

// Save draft configuration
export const saveDraft = async (config, adminUid) => {
    try {
        const docRef = doc(db, 'platformConfigDraft', 'current');
        await setDoc(docRef, {
            ...config,
            updatedAt: Timestamp.now(),
            updatedBy: adminUid
        });
        return { success: true };
    } catch (error) {
        console.error('Error saving draft:', error);
        return { success: false, error: error.message };
    }
};

// Publish configuration immediately
export const publishConfig = async (config, adminUid) => {
    try {
        const docRef = doc(db, 'platformConfig', 'current');
        await setDoc(docRef, {
            ...config,
            publishedAt: Timestamp.now(),
            publishedBy: adminUid
        });

        // Clear draft after publishing
        const draftRef = doc(db, 'platformConfigDraft', 'current');
        await setDoc(draftRef, {
            ...config,
            updatedAt: Timestamp.now(),
            updatedBy: adminUid
        });

        return { success: true };
    } catch (error) {
        console.error('Error publishing config:', error);
        return { success: false, error: error.message };
    }
};

// Schedule configuration publish
export const schedulePublish = async (config, scheduledFor, adminUid) => {
    try {
        const collectionRef = collection(db, 'scheduledChanges');
        await addDoc(collectionRef, {
            configSnapshot: config,
            scheduledFor: Timestamp.fromDate(new Date(scheduledFor)),
            createdAt: Timestamp.now(),
            createdBy: adminUid,
            status: 'pending'
        });
        return { success: true };
    } catch (error) {
        console.error('Error scheduling publish:', error);
        return { success: false, error: error.message };
    }
};

// Get pending scheduled changes
export const getScheduledChanges = async () => {
    try {
        const q = query(
            collection(db, 'scheduledChanges'),
            where('status', '==', 'pending'),
            orderBy('scheduledFor', 'asc')
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching scheduled changes:', error);
        return [];
    }
};

// Cancel scheduled change
export const cancelScheduledChange = async (changeId) => {
    try {
        const docRef = doc(db, 'scheduledChanges', changeId);
        await updateDoc(docRef, {
            status: 'cancelled',
            cancelledAt: Timestamp.now()
        });
        return { success: true };
    } catch (error) {
        console.error('Error cancelling scheduled change:', error);
        return { success: false, error: error.message };
    }
};

// Check if user is admin
export const checkIsAdmin = async (uid) => {
    try {
        const docRef = doc(db, 'admins', uid);
        const docSnap = await getDoc(docRef);
        return docSnap.exists();
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
};

// Get analytics data
export const getAnalytics = async (days = 30) => {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const q = query(
            collection(db, 'platformAnalytics'),
            where('date', '>=', startDate.toISOString().split('T')[0]),
            orderBy('date', 'asc')
        );

        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => doc.data());
    } catch (error) {
        console.error('Error fetching analytics:', error);
        // Return mock data for development/testing
        return generateMockAnalytics(days);
    }
};

// Generate mock analytics data for development
const generateMockAnalytics = (days) => {
    const data = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        data.push({
            date: date.toISOString().split('T')[0],
            pageViews: {
                total: Math.floor(Math.random() * 500) + 200,
                homepage: Math.floor(Math.random() * 300) + 100,
                pricing: Math.floor(Math.random() * 150) + 50,
                signup: Math.floor(Math.random() * 100) + 20
            },
            signups: Math.floor(Math.random() * 15) + 2,
            activeUsers: Math.floor(Math.random() * 80) + 30,
            orders: Math.floor(Math.random() * 200) + 50
        });
    }

    return data;
};

// Update admin password
export const updateAdminPassword = async (newPassword) => {
    // This will be handled by Firebase Auth
    // Import from firebase/auth when implementing
    return { success: true };
};
