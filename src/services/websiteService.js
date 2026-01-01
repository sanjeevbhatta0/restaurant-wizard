import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

/**
 * Save website configuration to Firestore and get preview URL
 * @param {string} restaurantId - The restaurant ID
 * @param {object} config - Website configuration object
 * @returns {Promise<object>} - Result with websiteUrl and previewUrl
 */
export const saveWebsiteConfig = async (restaurantId, config) => {
    try {
        const saveConfig = httpsCallable(functions, 'saveWebsiteConfig');
        const result = await saveConfig({ config });
        return result.data;
    } catch (error) {
        console.error('Error saving website config:', error);
        throw error;
    }
};

/**
 * Publish the website (make it live)
 * @param {string} restaurantId - The restaurant ID
 * @returns {Promise<object>} - Result with websiteUrl
 */
export const publishWebsite = async (restaurantId) => {
    try {
        const publish = httpsCallable(functions, 'publishWebsite');
        const result = await publish({});
        return result.data;
    } catch (error) {
        console.error('Error publishing website:', error);
        throw error;
    }
};

/**
 * Get website configuration from Firestore
 * @param {string} restaurantId - The restaurant ID
 * @returns {Promise<object|null>} - Website configuration or null
 */
export const getWebsiteConfig = async (restaurantId) => {
    try {
        const configDoc = await getDoc(doc(db, `restaurants/${restaurantId}/website/config`));
        if (configDoc.exists()) {
            return configDoc.data();
        }
        return null;
    } catch (error) {
        console.error('Error getting website config:', error);
        throw error;
    }
};

/**
 * Update specific fields in website configuration
 * @param {string} restaurantId - The restaurant ID
 * @param {object} updates - Fields to update
 */
export const updateWebsiteConfig = async (restaurantId, updates) => {
    try {
        await setDoc(
            doc(db, `restaurants/${restaurantId}/website/config`),
            { ...updates, updatedAt: new Date() },
            { merge: true }
        );
    } catch (error) {
        console.error('Error updating website config:', error);
        throw error;
    }
};

/**
 * Get the website URL for a restaurant
 * @param {string} restaurantId - The restaurant ID
 * @returns {Promise<string>} - The website URL
 */
export const getWebsiteUrl = async (restaurantId) => {
    try {
        const restaurantDoc = await getDoc(doc(db, `restaurants/${restaurantId}`));
        if (restaurantDoc.exists()) {
            const data = restaurantDoc.data();
            const slug = data.slug || restaurantId;
            return `https://${slug}.restaurant-portal-6b147.web.app`;
        }
        return null;
    } catch (error) {
        console.error('Error getting website URL:', error);
        throw error;
    }
};

/**
 * Generate a URL-friendly slug from text
 * @param {string} text - Text to convert to slug
 * @returns {string} - URL-friendly slug
 */
export const generateSlug = (text) => {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
};

// Legacy function for backwards compatibility
export const updateWebsiteData = async (restaurantId, data) => {
    console.warn('updateWebsiteData is deprecated. Use saveWebsiteConfig instead.');
    return saveWebsiteConfig(restaurantId, data);
};
