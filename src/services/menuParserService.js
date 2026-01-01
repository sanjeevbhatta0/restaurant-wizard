import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

/**
 * Service for parsing menu images using AI
 */
const menuParserService = {
    /**
     * Parse a menu image and extract categories and items
     * @param {string} imageData - Base64 encoded image data (without data URL prefix)
     * @param {string} mimeType - MIME type of the image (e.g., 'image/jpeg', 'image/png', 'application/pdf')
     * @returns {Promise<Object>} Parsed menu data with categories and items
     */
    parseMenuImage: async (imageData, mimeType) => {
        try {
            const parseMenu = httpsCallable(functions, 'parseMenuImage');
            const result = await parseMenu({ imageData, mimeType });
            return result.data;
        } catch (error) {
            console.error('Error parsing menu image:', error);
            throw error;
        }
    }
};

export default menuParserService;
