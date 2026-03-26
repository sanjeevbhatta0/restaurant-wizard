import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';

const aiContentService = {
  /**
   * Generate social media post content using AI
   * @param {Object} params - Generation parameters
   * @param {string} params.type - Type of content (menu_feature, promotion, event, general, engagement)
   * @param {string} params.platform - Target platform (facebook, instagram, twitter)
   * @param {string} params.tone - Tone of voice (professional, casual, fun, exciting, elegant)
   * @param {Object} params.context - Additional context (restaurant name, menu item, event details, etc.)
   * @returns {Promise<Object>} Generated content with caption and hashtags
   */
  generatePost: async (params) => {
    try {
      const generateContent = httpsCallable(functions, 'generateAIContent');
      const result = await generateContent({
        type: params.type,
        platform: params.platform,
        tone: params.tone,
        context: params.context
      });
      return result.data;
    } catch (error) {
      console.error('Error generating AI content:', error);
      throw error;
    }
  },

  /**
   * Improve/rewrite existing content
   * @param {string} content - Original content to improve
   * @param {string} instruction - What to improve (make_shorter, make_longer, more_engaging, add_emojis, etc.)
   * @returns {Promise<string>} Improved content
   */
  improveContent: async (content, instruction) => {
    try {
      const improveContent = httpsCallable(functions, 'improveAIContent');
      const result = await improveContent({ content, instruction });
      return result.data;
    } catch (error) {
      console.error('Error improving content:', error);
      throw error;
    }
  },

  /**
   * Generate hashtag suggestions
   * @param {string} content - Post content
   * @param {string} platform - Target platform
   * @param {number} count - Number of hashtags to generate
   * @returns {Promise<string[]>} Array of hashtag suggestions
   */
  generateHashtags: async (content, platform, count = 10) => {
    try {
      const generateHashtags = httpsCallable(functions, 'generateHashtags');
      const result = await generateHashtags({ content, platform, count });
      return result.data;
    } catch (error) {
      console.error('Error generating hashtags:', error);
      throw error;
    }
  },

  /**
   * Get SEO recommendations for the restaurant
   * @param {Object} restaurantData - Restaurant information
   * @returns {Promise<Object>} SEO analysis and recommendations
   */
  getSeoRecommendations: async (restaurantData) => {
    try {
      const getSeoRecs = httpsCallable(functions, 'getSeoRecommendations');
      const result = await getSeoRecs({ restaurantData });
      return result.data;
    } catch (error) {
      console.error('Error getting SEO recommendations:', error);
      throw error;
    }
  },

  /**
   * Generate content ideas based on trending topics and restaurant data
   * @param {Object} params - Parameters including restaurant type, cuisine, location
   * @returns {Promise<Object[]>} Array of content ideas
   */
  getContentIdeas: async (params) => {
    try {
      const getIdeas = httpsCallable(functions, 'getContentIdeas');
      const result = await getIdeas(params);
      return result.data;
    } catch (error) {
      console.error('Error getting content ideas:', error);
      throw error;
    }
  },

  /**
   * Generate post with business listings context (enhanced AI)
   * @param {Object} params - Standard generation params
   * @param {Object} businessContext - Data from connected business platforms
   * @returns {Promise<Object>} Generated content enriched with review/listing insights
   */
  generatePostWithContext: async (params, businessContext) => {
    try {
      const generateContent = httpsCallable(functions, 'generateAIContent');
      const result = await generateContent({
        type: params.type,
        platform: params.platform,
        tone: params.tone,
        context: params.context,
        businessContext
      });
      return result.data;
    } catch (error) {
      console.error('Error generating AI content with context:', error);
      throw error;
    }
  }
};

export default aiContentService;
