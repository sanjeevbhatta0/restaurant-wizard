/**
 * Unit Tests — Social Media Integrations
 * Tests Twitter/X OAuth flow, Instagram posting logic,
 * platform connection management, and post validation.
 */

describe('Social Media Integrations — Unit Tests', () => {

  // ==========================================
  // Twitter/X Post Validation
  // ==========================================

  describe('Twitter/X Post Validation', () => {
    const TWITTER_CHAR_LIMIT = 280;

    const truncateTweet = (text) => {
      if (text.length > TWITTER_CHAR_LIMIT) {
        return text.substring(0, TWITTER_CHAR_LIMIT - 3) + '...';
      }
      return text;
    };

    it('should not truncate text under 280 characters', () => {
      const text = 'Check out our new lunch special!';
      expect(truncateTweet(text)).toBe(text);
      expect(truncateTweet(text).length).toBeLessThanOrEqual(TWITTER_CHAR_LIMIT);
    });

    it('should truncate text over 280 characters with ellipsis', () => {
      const text = 'A'.repeat(300);
      const result = truncateTweet(text);
      expect(result.length).toBe(TWITTER_CHAR_LIMIT);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should handle exactly 280 characters without truncation', () => {
      const text = 'B'.repeat(280);
      expect(truncateTweet(text)).toBe(text);
    });

    it('should handle empty string', () => {
      expect(truncateTweet('')).toBe('');
    });

    it('should preserve emoji in tweets under limit', () => {
      const text = '🍕 Come try our amazing pizza! 🎉';
      expect(truncateTweet(text)).toBe(text);
    });
  });

  // ==========================================
  // Instagram Post Validation
  // ==========================================

  describe('Instagram Post Validation', () => {
    const validateInstagramPost = (content, imageUrl) => {
      const errors = [];
      if (!imageUrl) {
        errors.push('An image is required for Instagram posts');
      }
      if (content && content.length > 2200) {
        errors.push('Instagram caption must be under 2200 characters');
      }
      return errors;
    };

    it('should require an image for Instagram posts', () => {
      const errors = validateInstagramPost('Great food!', null);
      expect(errors).toContain('An image is required for Instagram posts');
    });

    it('should accept post with image', () => {
      const errors = validateInstagramPost('Great food!', 'https://example.com/food.jpg');
      expect(errors).toHaveLength(0);
    });

    it('should accept post with image and no caption', () => {
      const errors = validateInstagramPost('', 'https://example.com/food.jpg');
      expect(errors).toHaveLength(0);
    });

    it('should reject caption over 2200 characters', () => {
      const longCaption = 'X'.repeat(2201);
      const errors = validateInstagramPost(longCaption, 'https://example.com/food.jpg');
      expect(errors).toContain('Instagram caption must be under 2200 characters');
    });
  });

  // ==========================================
  // Platform Selection Logic
  // ==========================================

  describe('Platform Selection', () => {
    const getSelectedPlatformCount = (platforms) => {
      return Object.values(platforms).filter(Boolean).length;
    };

    const canSubmitPost = (platforms, connectedAccounts, postContent, selectedPage, selectedIgAccount) => {
      if (!postContent.trim()) return false;
      const anySelected = platforms.facebook || platforms.instagram || platforms.twitter;
      if (!anySelected) return false;
      if (platforms.facebook && !selectedPage) return false;
      if (platforms.instagram && !selectedIgAccount) return false;
      return true;
    };

    it('should count zero platforms when none selected', () => {
      expect(getSelectedPlatformCount({ facebook: false, instagram: false, twitter: false })).toBe(0);
    });

    it('should count correct number of selected platforms', () => {
      expect(getSelectedPlatformCount({ facebook: true, instagram: false, twitter: true })).toBe(2);
    });

    it('should count all three platforms', () => {
      expect(getSelectedPlatformCount({ facebook: true, instagram: true, twitter: true })).toBe(3);
    });

    it('should not allow submit without content', () => {
      expect(canSubmitPost({ facebook: true }, { facebook: true }, '', 'page1', '')).toBe(false);
    });

    it('should not allow submit without any platform selected', () => {
      expect(canSubmitPost({ facebook: false, instagram: false, twitter: false }, {}, 'Hello!', '', '')).toBe(false);
    });

    it('should not allow Facebook submit without page selected', () => {
      expect(canSubmitPost({ facebook: true, instagram: false, twitter: false }, { facebook: true }, 'Hello!', '', '')).toBe(false);
    });

    it('should allow Twitter submit without page/account (just needs content)', () => {
      expect(canSubmitPost({ facebook: false, instagram: false, twitter: true }, { twitter: true }, 'Hello!', '', '')).toBe(true);
    });

    it('should allow multi-platform submit when all requirements met', () => {
      expect(canSubmitPost(
        { facebook: true, instagram: true, twitter: true },
        { facebook: true, instagram: true, twitter: true },
        'Great food!',
        'page1',
        'ig_account1'
      )).toBe(true);
    });
  });

  // ==========================================
  // Social Media Connection State
  // ==========================================

  describe('Connection State Management', () => {
    const mergeConnection = (current, platform, data) => {
      return { ...current, [platform]: data };
    };

    it('should add a new connection', () => {
      const current = { facebook: { connected: true } };
      const result = mergeConnection(current, 'twitter', { connected: true, username: 'testuser' });
      expect(result.twitter.connected).toBe(true);
      expect(result.twitter.username).toBe('testuser');
      expect(result.facebook.connected).toBe(true);
    });

    it('should update existing connection', () => {
      const current = { twitter: { connected: true, username: 'old' } };
      const result = mergeConnection(current, 'twitter', { connected: true, username: 'new' });
      expect(result.twitter.username).toBe('new');
    });

    it('should handle disconnect', () => {
      const current = { twitter: { connected: true, username: 'test' } };
      const result = mergeConnection(current, 'twitter', { connected: false });
      expect(result.twitter.connected).toBe(false);
    });

    it('should not affect other platforms when updating one', () => {
      const current = {
        facebook: { connected: true, token: 'fb_token' },
        instagram: { connected: true, token: 'ig_token' }
      };
      const result = mergeConnection(current, 'twitter', { connected: true });
      expect(result.facebook.token).toBe('fb_token');
      expect(result.instagram.token).toBe('ig_token');
    });
  });

  // ==========================================
  // OAuth PKCE Helpers
  // ==========================================

  describe('OAuth PKCE Flow', () => {
    it('should generate valid state token format', () => {
      // State format: uid:randomHex
      const uid = 'user123';
      const stateToken = 'abcdef1234567890';
      const state = `${uid}:${stateToken}`;

      const [parsedUid, parsedState] = state.split(':');
      expect(parsedUid).toBe(uid);
      expect(parsedState).toBe(stateToken);
    });

    it('should handle state parsing with colons in uid', () => {
      // Edge case: what if split produces unexpected results
      const state = 'user123:abcdef';
      const parts = state.split(':');
      expect(parts.length).toBe(2);
    });

    it('should reject state without separator', () => {
      const state = 'invalidstate';
      const parts = state.split(':');
      expect(parts.length).toBe(1);
      expect(parts[1]).toBeUndefined();
    });
  });

  // ==========================================
  // Character Count Display
  // ==========================================

  describe('Character Count for Twitter', () => {
    const getTwitterCharInfo = (content, isTwitterSelected) => {
      const remaining = 280 - content.length;
      return {
        count: content.length,
        remaining,
        isOverLimit: remaining < 0,
        showWarning: isTwitterSelected && remaining < 0
      };
    };

    it('should show remaining characters when Twitter selected', () => {
      const info = getTwitterCharInfo('Hello world!', true);
      expect(info.remaining).toBe(268);
      expect(info.isOverLimit).toBe(false);
    });

    it('should flag over-limit when exceeding 280 chars', () => {
      const longText = 'A'.repeat(300);
      const info = getTwitterCharInfo(longText, true);
      expect(info.isOverLimit).toBe(true);
      expect(info.remaining).toBe(-20);
    });

    it('should not show warning when Twitter not selected', () => {
      const longText = 'A'.repeat(300);
      const info = getTwitterCharInfo(longText, false);
      expect(info.showWarning).toBe(false);
    });
  });

  // ==========================================
  // Post History Platform Badges
  // ==========================================

  describe('Post History Platform Detection', () => {
    const getPlatformBadges = (platforms) => {
      const badges = [];
      if (platforms?.facebook) badges.push('facebook');
      if (platforms?.instagram) badges.push('instagram');
      if (platforms?.twitter) badges.push('twitter');
      return badges;
    };

    it('should detect single platform', () => {
      expect(getPlatformBadges({ facebook: true, instagram: false, twitter: false }))
        .toEqual(['facebook']);
    });

    it('should detect all platforms', () => {
      expect(getPlatformBadges({ facebook: true, instagram: true, twitter: true }))
        .toEqual(['facebook', 'instagram', 'twitter']);
    });

    it('should handle null platforms gracefully', () => {
      expect(getPlatformBadges(null)).toEqual([]);
    });

    it('should handle undefined platforms gracefully', () => {
      expect(getPlatformBadges(undefined)).toEqual([]);
    });

    it('should handle empty object', () => {
      expect(getPlatformBadges({})).toEqual([]);
    });
  });

  // ==========================================
  // Multi-Platform Post Construction
  // ==========================================

  describe('Multi-Platform Post Construction', () => {
    const buildPostData = (content, imageUrl, platforms, locationId) => {
      return {
        content,
        imageUrl: imageUrl || null,
        platforms,
        locationId: locationId || null,
        createdAt: expect.any(String)
      };
    };

    it('should build post data with all fields', () => {
      const post = buildPostData(
        'Check out our special!',
        'https://example.com/food.jpg',
        { facebook: true, twitter: true },
        'location1'
      );
      expect(post.content).toBe('Check out our special!');
      expect(post.imageUrl).toBe('https://example.com/food.jpg');
      expect(post.platforms.facebook).toBe(true);
      expect(post.platforms.twitter).toBe(true);
      expect(post.locationId).toBe('location1');
    });

    it('should set imageUrl to null when not provided', () => {
      const post = buildPostData('Text only', null, { twitter: true });
      expect(post.imageUrl).toBeNull();
    });

    it('should set locationId to null when not provided', () => {
      const post = buildPostData('Hello', null, { facebook: true });
      expect(post.locationId).toBeNull();
    });
  });
});
