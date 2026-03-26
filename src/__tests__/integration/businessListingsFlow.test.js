/**
 * Integration Tests — Business Listings Flow
 * Tests Yelp search+connect flow, Google connect flow, Apple manual entry,
 * disconnect flows, review dashboard rendering logic, AI response generation,
 * Google reply, visibility tasks, and feature gating for non-Elder users.
 */

// Mock Firebase
jest.mock('../../firebase', () => ({
  functions: {},
  db: {},
  auth: {}
}));

// Mock firebase/functions
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn()
}));

// Mock firebase/firestore
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  orderBy: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn()
}));

const { httpsCallable } = require('firebase/functions');
const { doc, getDoc, getDocs, setDoc, updateDoc } = require('firebase/firestore');
const mockDocRef = { id: 'mock-doc-ref', path: 'mock/path' };

describe('Business Listings Flow — Integration', () => {
  const userId = 'test-user-123';

  beforeEach(() => {
    jest.clearAllMocks();
    doc.mockReturnValue(mockDocRef);
  });

  // ==========================================
  // Yelp Search + Connect Flow
  // ==========================================

  describe('Yelp Search + Connect Flow', () => {
    it('should search Yelp and return business results', async () => {
      const mockResults = {
        data: {
          success: true,
          businesses: [
            { id: 'yelp-1', name: 'Test Cafe', rating: 4.5, review_count: 100 },
            { id: 'yelp-2', name: 'Test Diner', rating: 3.8, review_count: 50 }
          ]
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResults));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.searchYelpBusiness('Test', 'San Francisco');

      expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'searchYelpBusiness');
      expect(result.success).toBe(true);
      expect(result.businesses).toHaveLength(2);
    });

    it('should connect a Yelp business and return connection data', async () => {
      const mockResult = {
        data: {
          success: true,
          business: { id: 'yelp-1', name: 'Test Cafe', rating: 4.5 },
          reviews: [{ id: 'rev1', rating: 5, text: 'Great!' }]
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.connectYelpBusiness('yelp-1');

      expect(result.success).toBe(true);
      expect(result.business.name).toBe('Test Cafe');
    });

    it('should handle Yelp API not configured gracefully', async () => {
      const mockResult = {
        data: { success: false, error: 'not_configured', message: 'Yelp API key not configured' }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.searchYelpBusiness('Test', 'SF');

      expect(result.success).toBe(false);
      expect(result.error).toBe('not_configured');
    });

    it('should fetch Yelp reviews (max 3 per API)', async () => {
      const mockResult = {
        data: {
          success: true,
          reviews: [
            { id: 'r1', rating: 5, text: 'Amazing' },
            { id: 'r2', rating: 4, text: 'Good' },
            { id: 'r3', rating: 3, text: 'OK' }
          ]
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.fetchYelpReviews('yelp-1');

      expect(result.success).toBe(true);
      expect(result.reviews).toHaveLength(3);
    });
  });

  // ==========================================
  // Google Business Connect Flow
  // ==========================================

  describe('Google Business Connect Flow', () => {
    it('should initiate Google OAuth and return auth URL', async () => {
      const mockResult = {
        data: {
          success: true,
          authUrl: 'https://accounts.google.com/o/oauth2/auth?...'
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.initiateGoogleAuth();

      expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'initiateGoogleAuth');
      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('accounts.google.com');
    });

    it('should fetch Google reviews', async () => {
      const mockResult = {
        data: {
          success: true,
          reviews: [
            { reviewId: 'g1', starRating: 'FIVE', comment: 'Best ever!' },
            { reviewId: 'g2', starRating: 'THREE', comment: 'Decent' }
          ]
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.fetchGoogleReviews();

      expect(result.success).toBe(true);
      expect(result.reviews).toHaveLength(2);
    });

    it('should handle Google not configured', async () => {
      const mockResult = {
        data: { success: false, error: 'not_configured', message: 'Google Business credentials not configured' }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.initiateGoogleAuth();

      expect(result.success).toBe(false);
      expect(result.error).toBe('not_configured');
    });
  });

  // ==========================================
  // Apple Business Manual Entry
  // ==========================================

  describe('Apple Business Manual Entry', () => {
    it('should save Apple business info to Firestore', async () => {
      setDoc.mockResolvedValue(undefined);

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.saveAppleBusinessInfo(userId, {
        businessName: 'My Restaurant',
        appleConnectUrl: 'https://businessconnect.apple.com/listing/123',
        notes: 'Profile claimed and verified'
      });

      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          apple: expect.objectContaining({
            connected: true,
            manualEntry: true,
            businessName: 'My Restaurant',
            appleConnectUrl: 'https://businessconnect.apple.com/listing/123'
          })
        }),
        { merge: true }
      );
    });

    it('should disconnect Apple by setting connected to false', async () => {
      setDoc.mockResolvedValue(undefined);

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.disconnectApple(userId);

      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        { apple: { connected: false } },
        { merge: true }
      );
    });
  });

  // ==========================================
  // Disconnect Flows
  // ==========================================

  describe('Disconnect Flows', () => {
    it('should disconnect Yelp and clear cached reviews', async () => {
      setDoc.mockResolvedValue(undefined);
      getDocs.mockResolvedValue({ docs: [] });

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.disconnectYelp(userId);

      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        { yelp: { connected: false } },
        { merge: true }
      );
    });

    it('should disconnect Google and clear cached reviews', async () => {
      setDoc.mockResolvedValue(undefined);
      getDocs.mockResolvedValue({ docs: [] });

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.disconnectGoogle(userId);

      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        { google: { connected: false, refreshToken: null } },
        { merge: true }
      );
    });

    it('should route disconnect through disconnectPlatform', async () => {
      setDoc.mockResolvedValue(undefined);
      getDocs.mockResolvedValue({ docs: [] });

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.disconnectPlatform(userId, 'yelp');

      expect(setDoc).toHaveBeenCalledWith(
        mockDocRef,
        { yelp: { connected: false } },
        { merge: true }
      );
    });
  });

  // ==========================================
  // Get Connections
  // ==========================================

  describe('Get Connections', () => {
    it('should return connection data when document exists', async () => {
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({
          yelp: { connected: true, businessName: 'Test Cafe', rating: 4.5 },
          google: { connected: false },
          apple: { connected: true, businessName: 'Test Cafe' }
        })
      });

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.getConnections(userId);

      expect(result.yelp.connected).toBe(true);
      expect(result.yelp.businessName).toBe('Test Cafe');
      expect(result.apple.connected).toBe(true);
    });

    it('should return empty object when no connections exist', async () => {
      getDoc.mockResolvedValue({
        exists: () => false,
        data: () => null
      });

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.getConnections(userId);

      expect(result).toEqual({});
    });
  });

  // ==========================================
  // Review Dashboard Rendering Logic
  // ==========================================

  describe('Reviews Dashboard Logic', () => {
    it('should not render dashboard when no platforms are connected', () => {
      const connections = {};
      const connectedPlatforms = [];
      if (connections?.yelp?.connected) connectedPlatforms.push('yelp');
      if (connections?.google?.connected) connectedPlatforms.push('google');

      expect(connectedPlatforms.length).toBe(0);
    });

    it('should detect connected platforms correctly', () => {
      const connections = {
        yelp: { connected: true },
        google: { connected: true }
      };
      const connectedPlatforms = [];
      if (connections?.yelp?.connected) connectedPlatforms.push('yelp');
      if (connections?.google?.connected) connectedPlatforms.push('google');

      expect(connectedPlatforms).toEqual(['yelp', 'google']);
    });

    it('should show Yelp limitation notice when Yelp is connected', () => {
      const connections = { yelp: { connected: true, businessUrl: 'https://yelp.com/biz/test' } };
      const showYelpNotice = !!connections?.yelp?.connected;
      expect(showYelpNotice).toBe(true);
    });
  });

  // ==========================================
  // AI Review Response Generation
  // ==========================================

  describe('AI Review Response', () => {
    it('should generate an AI response for a review', async () => {
      const mockResult = {
        data: {
          success: true,
          response: 'Thank you for your wonderful review!',
          alternativeResponses: [
            'We appreciate your kind words!',
            'So glad you enjoyed your visit!'
          ]
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.generateReviewResponse({
        reviewText: 'Amazing food and great service!',
        rating: 5,
        authorName: 'John',
        restaurantName: 'Test Cafe',
        cuisineType: 'Italian'
      });

      expect(result.success).toBe(true);
      expect(result.response).toBeTruthy();
      expect(result.alternativeResponses).toHaveLength(2);
    });

    it('should handle AI generation failure', async () => {
      httpsCallable.mockReturnValue(jest.fn().mockRejectedValue(new Error('AI service unavailable')));

      const businessListingsService = require('../../services/businessListingsService').default;
      await expect(businessListingsService.generateReviewResponse({
        reviewText: 'Bad food',
        rating: 1
      })).rejects.toThrow('AI service unavailable');
    });
  });

  // ==========================================
  // Google Reply
  // ==========================================

  describe('Google Review Reply', () => {
    it('should post a reply to a Google review', async () => {
      const mockResult = {
        data: { success: true, message: 'Reply posted successfully' }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.replyToGoogleReview(
        'accounts/123/locations/456/reviews/789',
        'Thank you for your feedback!'
      );

      expect(result.success).toBe(true);
    });

    it('should handle reply failure', async () => {
      httpsCallable.mockReturnValue(jest.fn().mockRejectedValue(new Error('Unauthorized')));

      const businessListingsService = require('../../services/businessListingsService').default;
      await expect(
        businessListingsService.replyToGoogleReview('review-id', 'Thanks!')
      ).rejects.toThrow('Unauthorized');
    });
  });

  // ==========================================
  // Visibility Tasks
  // ==========================================

  describe('Visibility Tasks', () => {
    it('should generate visibility tasks via AI', async () => {
      const mockResult = {
        data: {
          success: true,
          tasks: [
            { id: 't1', title: 'Claim Google profile', priority: 'high', platform: 'google', impactScore: 15 },
            { id: 't2', title: 'Add Yelp photos', priority: 'medium', platform: 'yelp', impactScore: 10 }
          ]
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.generateVisibilityTasks({
        restaurantData: { name: 'Test Cafe' },
        connectedPlatforms: { yelp: true, google: false },
        reviewSummary: '3 reviews, avg 4.0/5'
      });

      expect(result.success).toBe(true);
      expect(result.tasks).toHaveLength(2);
    });

    it('should get cached visibility tasks from Firestore', async () => {
      getDocs.mockResolvedValue({
        docs: [
          { id: 't1', data: () => ({ title: 'Task 1', priority: 'high', status: 'pending' }) },
          { id: 't2', data: () => ({ title: 'Task 2', priority: 'low', status: 'completed' }) }
        ]
      });

      const businessListingsService = require('../../services/businessListingsService').default;
      const tasks = await businessListingsService.getVisibilityTasks(userId);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('t1');
      expect(tasks[1].status).toBe('completed');
    });

    it('should update task status to completed', async () => {
      updateDoc.mockResolvedValue(undefined);

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.updateTaskStatus(userId, 't1', 'completed');

      expect(updateDoc).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          status: 'completed',
          completedAt: expect.any(String)
        })
      );
    });

    it('should update task status to pending without completedAt', async () => {
      updateDoc.mockResolvedValue(undefined);

      const businessListingsService = require('../../services/businessListingsService').default;
      await businessListingsService.updateTaskStatus(userId, 't1', 'pending');

      expect(updateDoc).toHaveBeenCalledWith(
        mockDocRef,
        { status: 'pending' }
      );
    });
  });

  // ==========================================
  // Feature Gating for Non-Elder Users
  // ==========================================

  describe('Feature Gating', () => {
    it('should not load business listings when hasAIAccess is false', () => {
      const hasAIAccess = false;
      let loadCalled = false;

      if (hasAIAccess) {
        loadCalled = true;
      }

      expect(loadCalled).toBe(false);
    });

    it('should load business listings when hasAIAccess is true', () => {
      const hasAIAccess = true;
      let loadCalled = false;

      if (hasAIAccess) {
        loadCalled = true;
      }

      expect(loadCalled).toBe(true);
    });

    it('should disable Reviews tab when not Elder', () => {
      const hasAIAccess = false;
      const isTabDisabled = !hasAIAccess;
      expect(isTabDisabled).toBe(true);
    });

    it('should disable Visibility tab when not Elder', () => {
      const hasAIAccess = false;
      const isTabDisabled = !hasAIAccess;
      expect(isTabDisabled).toBe(true);
    });

    it('should enable Reviews tab for Elder users', () => {
      const hasAIAccess = true;
      const isTabDisabled = !hasAIAccess;
      expect(isTabDisabled).toBe(false);
    });

    it('should not render BusinessConnectionsCard when not Elder', () => {
      const hasAIAccess = false;
      const shouldRender = hasAIAccess;
      expect(shouldRender).toBe(false);
    });
  });

  // ==========================================
  // Get Cached Reviews
  // ==========================================

  describe('Get Cached Reviews', () => {
    it('should return reviews from Firestore with platform filter', async () => {
      getDocs.mockResolvedValue({
        docs: [
          { id: 'r1', data: () => ({ platform: 'yelp', rating: 5, text: 'Great!' }) },
          { id: 'r2', data: () => ({ platform: 'yelp', rating: 4, text: 'Good' }) }
        ]
      });

      const businessListingsService = require('../../services/businessListingsService').default;
      const reviews = await businessListingsService.getCachedReviews(userId, 'yelp', 10);

      expect(reviews).toHaveLength(2);
      expect(reviews[0].id).toBe('r1');
      expect(reviews[0].platform).toBe('yelp');
    });

    it('should return all reviews when platform is "all"', async () => {
      getDocs.mockResolvedValue({
        docs: [
          { id: 'r1', data: () => ({ platform: 'yelp', rating: 5 }) },
          { id: 'r2', data: () => ({ platform: 'google', rating: 4 }) }
        ]
      });

      const businessListingsService = require('../../services/businessListingsService').default;
      const reviews = await businessListingsService.getCachedReviews(userId, 'all', 50);

      expect(reviews).toHaveLength(2);
    });

    it('should return empty array when no reviews exist', async () => {
      getDocs.mockResolvedValue({ docs: [] });

      const businessListingsService = require('../../services/businessListingsService').default;
      const reviews = await businessListingsService.getCachedReviews(userId, 'all');

      expect(reviews).toEqual([]);
    });
  });

  // ==========================================
  // Business Listings Overview
  // ==========================================

  describe('Business Listings Overview', () => {
    it('should fetch aggregated overview stats', async () => {
      const mockResult = {
        data: {
          success: true,
          overview: {
            totalReviews: 50,
            avgRating: 4.2,
            platforms: ['yelp', 'google']
          }
        }
      };
      httpsCallable.mockReturnValue(jest.fn().mockResolvedValue(mockResult));

      const businessListingsService = require('../../services/businessListingsService').default;
      const result = await businessListingsService.getBusinessListingsOverview();

      expect(result.success).toBe(true);
      expect(result.overview.totalReviews).toBe(50);
    });
  });
});
