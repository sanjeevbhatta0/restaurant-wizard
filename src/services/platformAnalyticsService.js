// Platform Analytics Tracking Service
// Tracks page views, signups, and orders for the admin metrics dashboard

import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc, increment, getDoc } from 'firebase/firestore';

// Collection names
const ANALYTICS_EVENTS = 'analyticsEvents';
const DAILY_ANALYTICS = 'platformAnalytics';

// Session tracking to prevent duplicate page views
let sessionPageViews = new Set();

/**
 * Track a page view event
 * @param {string} page - The page identifier (e.g., 'homepage', 'pricing', 'signup')
 */
export const trackPageView = async (page) => {
    try {
        // Prevent duplicate tracking in same session
        const pageKey = `${page}-${new Date().toDateString()}`;
        if (sessionPageViews.has(pageKey)) {
            return; // Already tracked this page today in this session
        }
        sessionPageViews.add(pageKey);

        // Get today's date string for aggregation
        const today = new Date().toISOString().split('T')[0];

        // Log the event
        await addDoc(collection(db, ANALYTICS_EVENTS), {
            type: 'pageView',
            page,
            timestamp: serverTimestamp(),
            date: today,
            userAgent: navigator.userAgent,
            referrer: document.referrer || 'direct'
        });

        // Also update daily aggregate immediately for real-time display
        const dailyDocRef = doc(db, DAILY_ANALYTICS, today);
        const dailyDoc = await getDoc(dailyDocRef);

        if (dailyDoc.exists()) {
            // Update existing document
            await setDoc(dailyDocRef, {
                [`pageViews.${page}`]: increment(1),
                'pageViews.total': increment(1),
                lastUpdated: serverTimestamp()
            }, { merge: true });
        } else {
            // Create new document for today
            await setDoc(dailyDocRef, {
                date: today,
                pageViews: {
                    total: 1,
                    homepage: page === 'homepage' ? 1 : 0,
                    pricing: page === 'pricing' ? 1 : 0,
                    signup: page === 'signup' ? 1 : 0
                },
                signups: 0,
                orders: 0,
                activeUsers: 0,
                lastUpdated: serverTimestamp()
            });
        }

        console.log(`📊 Tracked page view: ${page}`);
    } catch (error) {
        // Silently fail - don't break the app for analytics
        console.error('Analytics error:', error.message);
    }
};

/**
 * Track a signup event
 * @param {string} tier - The subscription tier they signed up for
 */
export const trackSignup = async (tier = 'unknown') => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Log the event
        await addDoc(collection(db, ANALYTICS_EVENTS), {
            type: 'signup',
            tier,
            timestamp: serverTimestamp(),
            date: today
        });

        // Update daily aggregate
        const dailyDocRef = doc(db, DAILY_ANALYTICS, today);
        const dailyDoc = await getDoc(dailyDocRef);

        if (dailyDoc.exists()) {
            await setDoc(dailyDocRef, {
                signups: increment(1),
                lastUpdated: serverTimestamp()
            }, { merge: true });
        } else {
            await setDoc(dailyDocRef, {
                date: today,
                pageViews: { total: 0, homepage: 0, pricing: 0, signup: 0 },
                signups: 1,
                orders: 0,
                activeUsers: 0,
                lastUpdated: serverTimestamp()
            });
        }

        console.log(`📊 Tracked signup: ${tier}`);
    } catch (error) {
        console.error('Analytics error:', error.message);
    }
};

/**
 * Track an order event
 * @param {number} amount - The order amount
 */
export const trackOrder = async (amount = 0) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Log the event
        await addDoc(collection(db, ANALYTICS_EVENTS), {
            type: 'order',
            amount,
            timestamp: serverTimestamp(),
            date: today
        });

        // Update daily aggregate
        const dailyDocRef = doc(db, DAILY_ANALYTICS, today);
        const dailyDoc = await getDoc(dailyDocRef);

        if (dailyDoc.exists()) {
            await setDoc(dailyDocRef, {
                orders: increment(1),
                lastUpdated: serverTimestamp()
            }, { merge: true });
        } else {
            await setDoc(dailyDocRef, {
                date: today,
                pageViews: { total: 0, homepage: 0, pricing: 0, signup: 0 },
                signups: 0,
                orders: 1,
                activeUsers: 0,
                lastUpdated: serverTimestamp()
            });
        }

        console.log(`📊 Tracked order: $${amount}`);
    } catch (error) {
        console.error('Analytics error:', error.message);
    }
};

/**
 * Track active user (call when user logs in or performs authenticated action)
 */
export const trackActiveUser = async () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sessionKey = `activeUser-${today}`;

        // Only track once per day per session
        if (sessionStorage.getItem(sessionKey)) {
            return;
        }
        sessionStorage.setItem(sessionKey, 'true');

        // Update daily aggregate
        const dailyDocRef = doc(db, DAILY_ANALYTICS, today);
        await setDoc(dailyDocRef, {
            activeUsers: increment(1),
            lastUpdated: serverTimestamp()
        }, { merge: true });

        console.log('📊 Tracked active user');
    } catch (error) {
        console.error('Analytics error:', error.message);
    }
};

export default {
    trackPageView,
    trackSignup,
    trackOrder,
    trackActiveUser
};
