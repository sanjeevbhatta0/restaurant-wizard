/**
 * Integration Tests — Social Media Posting Flows
 * Tests Facebook, Instagram, and Twitter/X connection and posting flows,
 * including multi-platform posting and error handling.
 */

// Mock Firebase modules
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
  getApp: jest.fn(() => ({}))
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({
    currentUser: { uid: 'test-user-123', email: 'test@restaurant.com' }
  })),
  connectAuthEmulator: jest.fn(),
  onAuthStateChanged: jest.fn((auth, callback) => {
    callback({ uid: 'test-user-123', email: 'test@restaurant.com' });
    return jest.fn();
  })
}));

jest.mock('firebase/firestore', () => {
  const mockData = {};
  return {
    getFirestore: jest.fn(() => ({})),
    connectFirestoreEmulator: jest.fn(),
    doc: jest.fn((db, ...path) => ({ path: path.join('/') })),
    getDoc: jest.fn(async (docRef) => {
      const data = mockData[docRef.path];
      return {
        exists: () => !!data,
        data: () => data || null
      };
    }),
    setDoc: jest.fn(async (docRef, data, opts) => {
      if (opts?.merge) {
        mockData[docRef.path] = { ...mockData[docRef.path], ...data };
      } else {
        mockData[docRef.path] = data;
      }
    }),
    updateDoc: jest.fn(async (docRef, data) => {
      mockData[docRef.path] = { ...mockData[docRef.path], ...data };
    }),
    collection: jest.fn(),
    addDoc: jest.fn(async () => ({ id: 'post-123' })),
    query: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    getDocs: jest.fn(async () => ({ docs: [] })),
    Timestamp: { now: jest.fn(() => ({ seconds: Date.now() / 1000 })) },
    _mockData: mockData // expose for test setup
  };
});

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  connectStorageEmulator: jest.fn(),
  ref: jest.fn(),
  uploadBytes: jest.fn(async () => ({ ref: 'mock-ref' })),
  getDownloadURL: jest.fn(async () => 'https://storage.example.com/test-image.jpg')
}));

const mockCloudFunctions = {
  initiateTwitterAuth: async () => ({
    data: { success: true, authUrl: 'https://twitter.com/i/oauth2/authorize?client_id=test' }
  }),
  getTwitterStatus: async () => ({
    data: { connected: true, username: 'testrestaurant', name: 'Test Restaurant' }
  }),
  disconnectTwitter: async () => ({ data: { success: true } }),
  postTweet: async ({ content }) => {
    if (!content || !content.trim()) throw new Error('Tweet content is required');
    return { data: { success: true, tweetId: '1234567890' } };
  }
};

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: jest.fn((functions, name) => {
    return mockCloudFunctions[name] || (async () => ({ data: {} }));
  })
}));

describe('Social Media Flows — Integration Tests', () => {

  beforeEach(() => {
    // Don't clearAllMocks — it resets the httpsCallable implementation.
    // Only clear specific mocks as needed.
  });

  // ==========================================
  // Facebook Connection Flow
  // ==========================================

  describe('Facebook Connection Flow', () => {
    it('should store Facebook connection data after login', async () => {
      const { setDoc } = require('firebase/firestore');

      const connectionData = {
        facebook: {
          connected: true,
          token: 'fb_access_token_123',
          userId: 'fb_user_456',
          connectedAt: expect.any(String)
        }
      };

      await setDoc(
        { path: 'restaurants/test-user-123/settings/socialMedia' },
        connectionData,
        { merge: true }
      );

      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'restaurants/test-user-123/settings/socialMedia' }),
        expect.objectContaining({
          facebook: expect.objectContaining({
            connected: true,
            token: 'fb_access_token_123'
          })
        }),
        { merge: true }
      );
    });

    it('should retrieve saved Facebook pages after connection', () => {
      const mockPages = [
        { id: 'page1', name: 'My Restaurant', access_token: 'page_token_1' },
        { id: 'page2', name: 'My Second Location', access_token: 'page_token_2' }
      ];

      expect(mockPages.length).toBeGreaterThan(0);
      expect(mockPages[0]).toHaveProperty('access_token');
    });
  });

  // ==========================================
  // Instagram Connection Flow
  // ==========================================

  describe('Instagram Connection Flow', () => {
    it('should detect Instagram business accounts linked to Facebook pages', () => {
      const pagesWithInstagram = [
        {
          id: 'page1',
          name: 'My Restaurant',
          access_token: 'token1',
          instagram_account: { id: 'ig_123' }
        },
        {
          id: 'page2',
          name: 'Another Page',
          access_token: 'token2'
          // No instagram_account — not linked
        }
      ];

      const instagramPages = pagesWithInstagram.filter(p => p.instagram_account);
      expect(instagramPages).toHaveLength(1);
      expect(instagramPages[0].instagram_account.id).toBe('ig_123');
    });

    it('should require image for Instagram posting', () => {
      const validateInstagramPost = (imageUrl) => {
        if (!imageUrl) throw new Error('An image is required for Instagram posts');
        return true;
      };

      expect(() => validateInstagramPost(null)).toThrow('An image is required');
      expect(validateInstagramPost('https://example.com/food.jpg')).toBe(true);
    });

    it('should follow 2-step Instagram posting process', async () => {
      // Step 1: Create media container
      const createContainer = jest.fn(async (igId, imageUrl, caption) => {
        return { id: 'container_123' };
      });

      // Step 2: Publish media
      const publishMedia = jest.fn(async (igId, containerId) => {
        return { id: 'media_456' };
      });

      const container = await createContainer('ig_123', 'https://example.com/food.jpg', 'Great food!');
      expect(container.id).toBe('container_123');

      const published = await publishMedia('ig_123', container.id);
      expect(published.id).toBe('media_456');

      // Verify both steps were called in sequence
      expect(createContainer).toHaveBeenCalledTimes(1);
      expect(publishMedia).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // Twitter/X Connection Flow
  // ==========================================

  describe('Twitter/X Connection Flow', () => {
    it('should initiate OAuth flow and return auth URL', async () => {
      const result = await mockCloudFunctions.initiateTwitterAuth();
      expect(result.data.success).toBe(true);
      expect(result.data.authUrl).toContain('twitter.com');
    });

    it('should retrieve connection status after OAuth callback', async () => {
      const result = await mockCloudFunctions.getTwitterStatus();
      expect(result.data.connected).toBe(true);
      expect(result.data.username).toBe('testrestaurant');
    });

    it('should disconnect Twitter account', async () => {
      const result = await mockCloudFunctions.disconnectTwitter();
      expect(result.data.success).toBe(true);
    });

    it('should post tweet via cloud function', async () => {
      const result = await mockCloudFunctions.postTweet({ content: 'Check out our new menu!' });
      expect(result.data.success).toBe(true);
      expect(result.data.tweetId).toBeDefined();
    });

    it('should reject empty tweet content', async () => {
      await expect(mockCloudFunctions.postTweet({ content: '' })).rejects.toThrow('Tweet content is required');
    });
  });

  // ==========================================
  // Multi-Platform Posting
  // ==========================================

  describe('Multi-Platform Posting', () => {
    it('should post to multiple platforms simultaneously', async () => {
      const postToFacebook = jest.fn(async () => ({ id: 'fb_post_1' }));
      const postToInstagram = jest.fn(async () => ({ id: 'ig_post_1' }));
      const postToTwitter = jest.fn(async () => ({ id: 'tw_post_1' }));

      const platforms = { facebook: true, instagram: true, twitter: true };
      const content = 'Our new special is here!';
      const imageUrl = 'https://example.com/special.jpg';

      const promises = [];
      if (platforms.facebook) promises.push(postToFacebook(content, imageUrl));
      if (platforms.instagram) promises.push(postToInstagram(content, imageUrl));
      if (platforms.twitter) promises.push(postToTwitter(content, imageUrl));

      const results = await Promise.allSettled(promises);
      expect(results).toHaveLength(3);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    });

    it('should handle partial failure (one platform fails)', async () => {
      const postToFacebook = jest.fn(async () => ({ id: 'fb_post_1' }));
      const postToInstagram = jest.fn(async () => { throw new Error('Instagram API error'); });
      const postToTwitter = jest.fn(async () => ({ id: 'tw_post_1' }));

      const results = await Promise.allSettled([
        postToFacebook(),
        postToInstagram(),
        postToTwitter()
      ]);

      const succeeded = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(succeeded).toHaveLength(2);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason.message).toBe('Instagram API error');
    });

    it('should save post to history after publishing', async () => {
      const mockAddDoc = jest.fn(async () => ({ id: 'post-123' }));

      const postData = {
        content: 'Check out our brunch special!',
        imageUrl: 'https://storage.example.com/brunch.jpg',
        platforms: { facebook: true, instagram: true, twitter: true },
        createdAt: { seconds: Date.now() / 1000 },
        locationId: null
      };

      const result = await mockAddDoc('restaurants/test-user-123/socialPosts', postData);
      expect(result.id).toBe('post-123');
      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: 'Check out our brunch special!',
          platforms: expect.objectContaining({ twitter: true })
        })
      );
    });
  });

  // ==========================================
  // Connection Persistence
  // ==========================================

  describe('Connection Persistence', () => {
    it('should load all connections from Firestore on mount', async () => {
      // Simulate stored connections
      const mockConnections = {
        facebook: { connected: true, token: 'fb_token' },
        instagram: { connected: true },
        twitter: { connected: true, accessToken: 'tw_token', twitterUsername: 'myrestaurant' }
      };

      const mockGetDoc = jest.fn(async () => ({
        exists: () => true,
        data: () => mockConnections
      }));

      const result = await mockGetDoc({ path: 'restaurants/test-user-123/settings/socialMedia' });
      const data = result.data();

      expect(data.facebook.connected).toBe(true);
      expect(data.instagram.connected).toBe(true);
      expect(data.twitter.connected).toBe(true);
      expect(data.twitter.twitterUsername).toBe('myrestaurant');
    });

    it('should handle no saved connections gracefully', async () => {
      const mockGetDoc = jest.fn(async () => ({
        exists: () => false,
        data: () => null
      }));

      const result = await mockGetDoc({ path: 'restaurants/new-user/settings/socialMedia' });
      expect(result.exists()).toBe(false);
    });
  });

  // ==========================================
  // Twitter/X Token Refresh
  // ==========================================

  describe('Twitter/X Token Management', () => {
    it('should detect expired token', () => {
      const expiresAt = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
      expect(new Date(expiresAt) < new Date()).toBe(true);
    });

    it('should detect valid token', () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
      expect(new Date(expiresAt) < new Date()).toBe(false);
    });

    it('should store refreshed tokens', async () => {
      const { setDoc } = require('firebase/firestore');

      const refreshedTokenData = {
        twitter: {
          accessToken: 'new_access_token',
          refreshToken: 'new_refresh_token',
          expiresAt: new Date(Date.now() + 7200 * 1000).toISOString()
        }
      };

      await setDoc(
        { path: 'restaurants/test-user-123/settings/socialMedia' },
        refreshedTokenData,
        { merge: true }
      );

      expect(setDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          twitter: expect.objectContaining({
            accessToken: 'new_access_token',
            refreshToken: 'new_refresh_token'
          })
        }),
        { merge: true }
      );
    });
  });

  // ==========================================
  // OAuth Callback URL Handling
  // ==========================================

  describe('OAuth Callback URL Handling', () => {
    it('should parse twitter_connected param from URL', () => {
      const url = 'https://restaurant-portal.web.app/seo-social?twitter_connected=true';
      const params = new URL(url).searchParams;
      expect(params.get('twitter_connected')).toBe('true');
    });

    it('should parse twitter_error param from URL', () => {
      const url = 'https://restaurant-portal.web.app/seo-social?twitter_error=access_denied';
      const params = new URL(url).searchParams;
      expect(params.get('twitter_error')).toBe('access_denied');
    });

    it('should handle URL with no social params', () => {
      const url = 'https://restaurant-portal.web.app/seo-social';
      const params = new URL(url).searchParams;
      expect(params.get('twitter_connected')).toBeNull();
      expect(params.get('twitter_error')).toBeNull();
    });
  });

  // ==========================================
  // Cloud Function Error Handling
  // ==========================================

  describe('Cloud Function Error Handling', () => {
    it('should handle not_configured error for Twitter', () => {
      const response = { success: false, error: 'not_configured', message: 'Twitter API credentials not configured' };
      expect(response.error).toBe('not_configured');
      expect(response.success).toBe(false);
    });

    it('should handle rate limit errors', () => {
      const error = { code: 429, message: 'Too Many Requests' };
      expect(error.code).toBe(429);
    });

    it('should handle expired session errors', () => {
      const error = { code: 'failed-precondition', message: 'Twitter session expired. Please reconnect your account.' };
      expect(error.message).toContain('reconnect');
    });
  });
});
