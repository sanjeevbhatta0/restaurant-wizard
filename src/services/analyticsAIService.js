import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

const analyticsAIService = {
    getAnalytics: async (tier, analysisType, orderData, menuData, question = null) => {
        try {
            const getAIAnalytics = httpsCallable(functions, 'getAIAnalytics');
            const result = await getAIAnalytics({ tier, analysisType, orderData, menuData, question });
            return result.data;
        } catch (error) {
            console.error('Error getting AI analytics:', error);
            throw error;
        }
    },

    /**
     * Batch analyze — fires multiple AI analysis types in one Cloud Function call.
     * Used by the premium AI Analytics Dashboard.
     * @param {string[]} types - Array of analysis type keys
     * @param {Object} orderData - Enriched order data summary
     * @param {Object} menuData - Menu data summary
     * @returns {Object} { success, batch, data: { [type]: { success, data } } }
     */
    batchAnalyze: async (types, orderData, menuData) => {
        try {
            const getAIAnalytics = httpsCallable(functions, 'getAIAnalytics');
            const result = await getAIAnalytics({
                batchTypes: types,
                orderData,
                menuData
            });
            return result.data;
        } catch (error) {
            console.error('Error in batch AI analytics:', error);
            throw error;
        }
    },

    // Convenience methods (backward compat)
    getBusinessSummary: (orderData, menuData) =>
        analyticsAIService.getAnalytics(1, 'businessSummary', orderData, menuData),
    getSalesPrediction: (orderData) =>
        analyticsAIService.getAnalytics(1, 'salesPrediction', orderData, null),
    getAnomalyAlerts: (orderData, menuData) =>
        analyticsAIService.getAnalytics(1, 'anomalyAlerts', orderData, menuData),
    getMenuOptimization: (orderData, menuData) =>
        analyticsAIService.getAnalytics(2, 'menuOptimization', orderData, menuData),
    getStaffInsights: (orderData) =>
        analyticsAIService.getAnalytics(2, 'staffInsights', orderData, null),
    getOrderCombos: (orderData) =>
        analyticsAIService.getAnalytics(2, 'orderCombos', orderData, null),
    getMarketPosition: (menuData) =>
        analyticsAIService.getAnalytics(3, 'marketPosition', null, menuData),
    askAI: (question, orderData, menuData) =>
        analyticsAIService.getAnalytics(3, 'aiChat', orderData, menuData, question),
    getWeeklyReport: (orderData, menuData) =>
        analyticsAIService.getAnalytics(3, 'weeklyReport', orderData, menuData)
};

export default analyticsAIService;
