import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

/**
 * Service for AI-powered analytics
 */
const analyticsAIService = {
    /**
     * Get AI analytics insights
     * @param {number} tier - 1, 2, or 3
     * @param {string} analysisType - Type of analysis
     * @param {Object} orderData - Summarized order data
     * @param {Object} menuData - Summarized menu data
     * @param {string} question - Optional question for AI chat
     */
    getAnalytics: async (tier, analysisType, orderData, menuData, question = null) => {
        try {
            const getAIAnalytics = httpsCallable(functions, 'getAIAnalytics');
            const result = await getAIAnalytics({
                tier,
                analysisType,
                orderData,
                menuData,
                question
            });
            return result.data;
        } catch (error) {
            console.error('Error getting AI analytics:', error);
            throw error;
        }
    },

    // Convenience methods for each tier

    // Tier 1: Essential
    getBusinessSummary: (orderData, menuData) =>
        analyticsAIService.getAnalytics(1, 'businessSummary', orderData, menuData),

    getSalesPrediction: (orderData) =>
        analyticsAIService.getAnalytics(1, 'salesPrediction', orderData, null),

    getAnomalyAlerts: (orderData, menuData) =>
        analyticsAIService.getAnalytics(1, 'anomalyAlerts', orderData, menuData),

    // Tier 2: Differentiation
    getMenuOptimization: (orderData, menuData) =>
        analyticsAIService.getAnalytics(2, 'menuOptimization', orderData, menuData),

    getStaffInsights: (orderData) =>
        analyticsAIService.getAnalytics(2, 'staffInsights', orderData, null),

    getOrderCombos: (orderData) =>
        analyticsAIService.getAnalytics(2, 'orderCombos', orderData, null),

    // Tier 3: Premium
    getMarketPosition: (menuData) =>
        analyticsAIService.getAnalytics(3, 'marketPosition', null, menuData),

    askAI: (question, orderData, menuData) =>
        analyticsAIService.getAnalytics(3, 'aiChat', orderData, menuData, question),

    getWeeklyReport: (orderData, menuData) =>
        analyticsAIService.getAnalytics(3, 'weeklyReport', orderData, menuData)
};

export default analyticsAIService;
