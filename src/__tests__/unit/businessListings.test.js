/**
 * Unit Tests — Business Listings Logic
 * Tests review sentiment classification, rating aggregation, filter/sort logic,
 * Yelp/Google response parsing, graceful API-not-configured handling,
 * task priority sorting, visibility score calculation, and Apple manual entry.
 */

describe('Business Listings — Unit Tests', () => {
  // ==========================================
  // Review Sentiment Classification
  // ==========================================

  describe('Review Sentiment Classification', () => {
    const classifySentiment = (rating) => {
      if (rating >= 4) return 'positive';
      if (rating === 3) return 'neutral';
      return 'negative';
    };

    it('should classify 5-star as positive', () => {
      expect(classifySentiment(5)).toBe('positive');
    });

    it('should classify 4-star as positive', () => {
      expect(classifySentiment(4)).toBe('positive');
    });

    it('should classify 3-star as neutral', () => {
      expect(classifySentiment(3)).toBe('neutral');
    });

    it('should classify 2-star as negative', () => {
      expect(classifySentiment(2)).toBe('negative');
    });

    it('should classify 1-star as negative', () => {
      expect(classifySentiment(1)).toBe('negative');
    });

    it('should classify 0 as negative', () => {
      expect(classifySentiment(0)).toBe('negative');
    });
  });

  // ==========================================
  // Rating Aggregation
  // ==========================================

  describe('Rating Aggregation', () => {
    const computeStats = (reviews) => {
      const all = reviews || [];
      const total = all.length;
      const avgRating = total > 0 ? all.reduce((s, r) => s + (r.rating || 0), 0) / total : 0;
      const positive = all.filter(r => r.rating >= 4).length;
      const neutral = all.filter(r => r.rating === 3).length;
      const negative = all.filter(r => r.rating <= 2).length;
      const responded = all.filter(r => r.ownerResponse).length;

      return {
        total,
        avgRating: Math.round(avgRating * 10) / 10,
        positive,
        neutral,
        negative,
        responded,
        responseRate: total > 0 ? Math.round((responded / total) * 100) : 0
      };
    };

    it('should calculate correct average for mixed reviews', () => {
      const reviews = [
        { rating: 5 }, { rating: 4 }, { rating: 3 }, { rating: 2 }, { rating: 1 }
      ];
      expect(computeStats(reviews).avgRating).toBe(3);
    });

    it('should handle all 5-star reviews', () => {
      const reviews = [{ rating: 5 }, { rating: 5 }, { rating: 5 }];
      expect(computeStats(reviews).avgRating).toBe(5);
    });

    it('should return 0 for empty reviews', () => {
      expect(computeStats([]).avgRating).toBe(0);
      expect(computeStats([]).total).toBe(0);
    });

    it('should handle null reviews', () => {
      expect(computeStats(null).avgRating).toBe(0);
    });

    it('should count sentiment categories correctly', () => {
      const reviews = [
        { rating: 5 }, { rating: 4 }, { rating: 3 }, { rating: 2 }, { rating: 1 }
      ];
      const stats = computeStats(reviews);
      expect(stats.positive).toBe(2);
      expect(stats.neutral).toBe(1);
      expect(stats.negative).toBe(2);
    });

    it('should calculate response rate', () => {
      const reviews = [
        { rating: 5, ownerResponse: 'Thanks!' },
        { rating: 3, ownerResponse: 'We apologize' },
        { rating: 1 },
        { rating: 4 }
      ];
      expect(computeStats(reviews).responseRate).toBe(50);
    });

    it('should return 0% response rate for no reviews', () => {
      expect(computeStats([]).responseRate).toBe(0);
    });

    it('should return 100% when all reviews have responses', () => {
      const reviews = [
        { rating: 5, ownerResponse: 'Thanks!' },
        { rating: 4, ownerResponse: 'Glad you enjoyed!' }
      ];
      expect(computeStats(reviews).responseRate).toBe(100);
    });

    it('should round average to one decimal', () => {
      const reviews = [{ rating: 5 }, { rating: 4 }, { rating: 4 }];
      expect(computeStats(reviews).avgRating).toBe(4.3);
    });

    it('should handle reviews with missing rating (treat as 0)', () => {
      const reviews = [{ rating: 5 }, {}];
      expect(computeStats(reviews).avgRating).toBe(2.5);
    });
  });

  // ==========================================
  // Review Filtering
  // ==========================================

  describe('Review Filtering', () => {
    const sampleReviews = [
      { id: '1', platform: 'yelp', rating: 5, text: 'Great food', createdAt: '2026-03-20' },
      { id: '2', platform: 'google', rating: 4, text: 'Nice ambiance', createdAt: '2026-03-21' },
      { id: '3', platform: 'yelp', rating: 3, text: 'OK experience', createdAt: '2026-03-19' },
      { id: '4', platform: 'google', rating: 2, text: 'Too slow', createdAt: '2026-03-22' },
      { id: '5', platform: 'yelp', rating: 1, text: 'Terrible', createdAt: '2026-03-18' }
    ];

    const filterReviews = (reviews, { platform, rating, sentiment }) => {
      let result = [...reviews];
      if (platform && platform !== 'all') {
        result = result.filter(r => r.platform === platform);
      }
      if (rating && rating !== 'all') {
        result = result.filter(r => r.rating === parseInt(rating));
      }
      if (sentiment && sentiment !== 'all') {
        if (sentiment === 'positive') result = result.filter(r => r.rating >= 4);
        else if (sentiment === 'neutral') result = result.filter(r => r.rating === 3);
        else if (sentiment === 'negative') result = result.filter(r => r.rating <= 2);
      }
      return result;
    };

    it('should filter by platform: yelp', () => {
      const result = filterReviews(sampleReviews, { platform: 'yelp' });
      expect(result).toHaveLength(3);
      expect(result.every(r => r.platform === 'yelp')).toBe(true);
    });

    it('should filter by platform: google', () => {
      const result = filterReviews(sampleReviews, { platform: 'google' });
      expect(result).toHaveLength(2);
    });

    it('should return all reviews when platform is "all"', () => {
      const result = filterReviews(sampleReviews, { platform: 'all' });
      expect(result).toHaveLength(5);
    });

    it('should filter by exact rating', () => {
      const result = filterReviews(sampleReviews, { rating: '5' });
      expect(result).toHaveLength(1);
      expect(result[0].rating).toBe(5);
    });

    it('should filter by positive sentiment', () => {
      const result = filterReviews(sampleReviews, { sentiment: 'positive' });
      expect(result).toHaveLength(2);
    });

    it('should filter by neutral sentiment', () => {
      const result = filterReviews(sampleReviews, { sentiment: 'neutral' });
      expect(result).toHaveLength(1);
    });

    it('should filter by negative sentiment', () => {
      const result = filterReviews(sampleReviews, { sentiment: 'negative' });
      expect(result).toHaveLength(2);
    });

    it('should combine platform and sentiment filters', () => {
      const result = filterReviews(sampleReviews, { platform: 'yelp', sentiment: 'positive' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should return empty when no reviews match', () => {
      const result = filterReviews(sampleReviews, { platform: 'apple' });
      expect(result).toHaveLength(0);
    });
  });

  // ==========================================
  // Review Sorting
  // ==========================================

  describe('Review Sorting', () => {
    const reviews = [
      { id: '1', rating: 3, createdAt: '2026-03-20' },
      { id: '2', rating: 5, createdAt: '2026-03-22' },
      { id: '3', rating: 1, createdAt: '2026-03-18' }
    ];

    const sortReviews = (reviews, sortBy) => {
      const result = [...reviews];
      result.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        if (sortBy === 'newest') return dateB - dateA;
        if (sortBy === 'oldest') return dateA - dateB;
        if (sortBy === 'highest') return (b.rating || 0) - (a.rating || 0);
        if (sortBy === 'lowest') return (a.rating || 0) - (b.rating || 0);
        return 0;
      });
      return result;
    };

    it('should sort newest first', () => {
      const sorted = sortReviews(reviews, 'newest');
      expect(sorted[0].id).toBe('2');
      expect(sorted[2].id).toBe('3');
    });

    it('should sort oldest first', () => {
      const sorted = sortReviews(reviews, 'oldest');
      expect(sorted[0].id).toBe('3');
      expect(sorted[2].id).toBe('2');
    });

    it('should sort highest rated first', () => {
      const sorted = sortReviews(reviews, 'highest');
      expect(sorted[0].rating).toBe(5);
      expect(sorted[2].rating).toBe(1);
    });

    it('should sort lowest rated first', () => {
      const sorted = sortReviews(reviews, 'lowest');
      expect(sorted[0].rating).toBe(1);
      expect(sorted[2].rating).toBe(5);
    });
  });

  // ==========================================
  // Yelp API Response Parsing
  // ==========================================

  describe('Yelp Response Parsing', () => {
    const parseYelpBusiness = (business) => ({
      businessId: business.id,
      businessName: business.name,
      rating: business.rating || 0,
      reviewCount: business.review_count || 0,
      businessUrl: business.url || '',
      address: business.location?.display_address?.join(', ') || '',
      categories: (business.categories || []).map(c => c.title).join(', '),
      imageUrl: business.image_url || ''
    });

    it('should parse a full Yelp business object', () => {
      const yelpBusiness = {
        id: 'abc123',
        name: 'Test Restaurant',
        rating: 4.5,
        review_count: 200,
        url: 'https://yelp.com/biz/test',
        location: { display_address: ['123 Main St', 'San Francisco, CA'] },
        categories: [{ title: 'Italian' }, { title: 'Pizza' }],
        image_url: 'https://img.yelp.com/photo.jpg'
      };
      const parsed = parseYelpBusiness(yelpBusiness);
      expect(parsed.businessId).toBe('abc123');
      expect(parsed.businessName).toBe('Test Restaurant');
      expect(parsed.rating).toBe(4.5);
      expect(parsed.reviewCount).toBe(200);
      expect(parsed.address).toBe('123 Main St, San Francisco, CA');
      expect(parsed.categories).toBe('Italian, Pizza');
    });

    it('should handle missing fields gracefully', () => {
      const parsed = parseYelpBusiness({ id: 'xyz', name: 'Bare' });
      expect(parsed.rating).toBe(0);
      expect(parsed.reviewCount).toBe(0);
      expect(parsed.address).toBe('');
      expect(parsed.categories).toBe('');
      expect(parsed.imageUrl).toBe('');
    });

    const parseYelpReview = (review) => ({
      externalId: review.id,
      authorName: review.user?.name || 'Anonymous',
      authorImageUrl: review.user?.image_url || '',
      rating: review.rating || 0,
      text: review.text || '',
      createdAt: review.time_created || null,
      platform: 'yelp',
      platformUrl: review.url || ''
    });

    it('should parse a Yelp review', () => {
      const yelpReview = {
        id: 'rev1',
        user: { name: 'John D.', image_url: 'https://img.jpg' },
        rating: 5,
        text: 'Amazing food!',
        time_created: '2026-03-20',
        url: 'https://yelp.com/review/rev1'
      };
      const parsed = parseYelpReview(yelpReview);
      expect(parsed.externalId).toBe('rev1');
      expect(parsed.authorName).toBe('John D.');
      expect(parsed.rating).toBe(5);
      expect(parsed.platform).toBe('yelp');
    });

    it('should default to Anonymous for missing user', () => {
      const parsed = parseYelpReview({ id: 'rev2', rating: 3 });
      expect(parsed.authorName).toBe('Anonymous');
    });
  });

  // ==========================================
  // Google Business Response Parsing
  // ==========================================

  describe('Google Business Response Parsing', () => {
    const parseGoogleReview = (review) => ({
      externalId: review.reviewId || review.name,
      authorName: review.reviewer?.displayName || 'Google User',
      authorImageUrl: review.reviewer?.profilePhotoUrl || '',
      rating: review.starRating ? ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[review.starRating] || 0) : 0,
      text: review.comment || '',
      createdAt: review.createTime || null,
      platform: 'google',
      ownerResponse: review.reviewReply?.comment || null,
      platformUrl: ''
    });

    it('should parse a Google review with FIVE star rating', () => {
      const review = {
        reviewId: 'grev1',
        reviewer: { displayName: 'Jane S.', profilePhotoUrl: 'https://photo.jpg' },
        starRating: 'FIVE',
        comment: 'Wonderful experience!',
        createTime: '2026-03-21T10:00:00Z'
      };
      const parsed = parseGoogleReview(review);
      expect(parsed.externalId).toBe('grev1');
      expect(parsed.rating).toBe(5);
      expect(parsed.authorName).toBe('Jane S.');
      expect(parsed.platform).toBe('google');
    });

    it('should parse star rating enums correctly', () => {
      expect(parseGoogleReview({ starRating: 'ONE' }).rating).toBe(1);
      expect(parseGoogleReview({ starRating: 'TWO' }).rating).toBe(2);
      expect(parseGoogleReview({ starRating: 'THREE' }).rating).toBe(3);
      expect(parseGoogleReview({ starRating: 'FOUR' }).rating).toBe(4);
    });

    it('should extract owner response if present', () => {
      const review = {
        starRating: 'FIVE',
        reviewReply: { comment: 'Thank you for visiting!' }
      };
      expect(parseGoogleReview(review).ownerResponse).toBe('Thank you for visiting!');
    });

    it('should handle missing owner response', () => {
      expect(parseGoogleReview({ starRating: 'THREE' }).ownerResponse).toBeNull();
    });

    it('should default to Google User for missing reviewer', () => {
      expect(parseGoogleReview({}).authorName).toBe('Google User');
    });
  });

  // ==========================================
  // Graceful API-Not-Configured Handling
  // ==========================================

  describe('API Not Configured Handling', () => {
    const handleApiResult = (result) => {
      if (!result.success && result.error === 'not_configured') {
        return { showSetup: true, message: result.message || 'API key not configured' };
      }
      if (!result.success) {
        return { showSetup: false, error: result.error };
      }
      return { showSetup: false, data: result.data || result };
    };

    it('should detect not_configured error and show setup', () => {
      const result = handleApiResult({ success: false, error: 'not_configured', message: 'Yelp API key not configured' });
      expect(result.showSetup).toBe(true);
      expect(result.message).toBe('Yelp API key not configured');
    });

    it('should handle generic error without showing setup', () => {
      const result = handleApiResult({ success: false, error: 'network_error' });
      expect(result.showSetup).toBe(false);
      expect(result.error).toBe('network_error');
    });

    it('should pass through successful results', () => {
      const result = handleApiResult({ success: true, data: { reviews: [] } });
      expect(result.showSetup).toBe(false);
      expect(result.data).toEqual({ reviews: [] });
    });
  });

  // ==========================================
  // Visibility Task Priority Sorting
  // ==========================================

  describe('Visibility Task Priority Sorting', () => {
    const tasks = [
      { id: '1', title: 'Add photos', priority: 'low', status: 'pending' },
      { id: '2', title: 'Claim profile', priority: 'high', status: 'pending' },
      { id: '3', title: 'Update hours', priority: 'medium', status: 'completed' },
      { id: '4', title: 'Respond to reviews', priority: 'high', status: 'pending' },
      { id: '5', title: 'Add menu', priority: 'medium', status: 'pending' }
    ];

    const groupByPriority = (tasks) => ({
      high: tasks.filter(t => t.priority === 'high'),
      medium: tasks.filter(t => t.priority === 'medium'),
      low: tasks.filter(t => t.priority === 'low')
    });

    it('should group tasks by priority', () => {
      const groups = groupByPriority(tasks);
      expect(groups.high).toHaveLength(2);
      expect(groups.medium).toHaveLength(2);
      expect(groups.low).toHaveLength(1);
    });

    it('should correctly assign tasks to high priority', () => {
      const groups = groupByPriority(tasks);
      expect(groups.high.map(t => t.id)).toEqual(['2', '4']);
    });

    it('should handle empty task list', () => {
      const groups = groupByPriority([]);
      expect(groups.high).toHaveLength(0);
      expect(groups.medium).toHaveLength(0);
      expect(groups.low).toHaveLength(0);
    });
  });

  // ==========================================
  // Visibility Progress Calculation
  // ==========================================

  describe('Visibility Progress', () => {
    const calcProgress = (tasks) => {
      const total = tasks.length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      return total > 0 ? Math.round((completed / total) * 100) : 0;
    };

    it('should calculate 0% for no completed tasks', () => {
      const tasks = [{ status: 'pending' }, { status: 'pending' }];
      expect(calcProgress(tasks)).toBe(0);
    });

    it('should calculate 50% for half completed', () => {
      const tasks = [{ status: 'completed' }, { status: 'pending' }];
      expect(calcProgress(tasks)).toBe(50);
    });

    it('should calculate 100% for all completed', () => {
      const tasks = [{ status: 'completed' }, { status: 'completed' }];
      expect(calcProgress(tasks)).toBe(100);
    });

    it('should return 0 for empty tasks array', () => {
      expect(calcProgress([])).toBe(0);
    });

    it('should round to nearest integer', () => {
      const tasks = [
        { status: 'completed' },
        { status: 'pending' },
        { status: 'pending' }
      ];
      expect(calcProgress(tasks)).toBe(33);
    });
  });

  // ==========================================
  // Visibility Score Calculation
  // ==========================================

  describe('Visibility Score Calculation', () => {
    const calcTotalImpact = (tasks) => {
      return tasks.reduce((sum, t) => sum + (t.impactScore || 5), 0);
    };

    it('should sum impact scores', () => {
      const tasks = [
        { impactScore: 10 }, { impactScore: 15 }, { impactScore: 5 }
      ];
      expect(calcTotalImpact(tasks)).toBe(30);
    });

    it('should use default of 5 when impactScore is missing', () => {
      const tasks = [{ impactScore: 10 }, {}, { impactScore: 8 }];
      expect(calcTotalImpact(tasks)).toBe(23);
    });

    it('should return 0 for empty tasks', () => {
      expect(calcTotalImpact([])).toBe(0);
    });

    const getUniquePlatforms = (tasks) => {
      return [...new Set(tasks.map(t => t.platform))];
    };

    it('should extract unique platforms', () => {
      const tasks = [
        { platform: 'yelp' }, { platform: 'google' }, { platform: 'yelp' }, { platform: 'general' }
      ];
      expect(getUniquePlatforms(tasks)).toEqual(['yelp', 'google', 'general']);
    });

    const getUniqueCategories = (tasks) => {
      return [...new Set(tasks.map(t => t.category).filter(Boolean))];
    };

    it('should extract unique categories, filtering nulls', () => {
      const tasks = [
        { category: 'profile' }, { category: 'reviews' }, { category: 'profile' }, {}
      ];
      expect(getUniqueCategories(tasks)).toEqual(['profile', 'reviews']);
    });
  });

  // ==========================================
  // Apple Business Manual Entry
  // ==========================================

  describe('Apple Business Manual Entry', () => {
    const buildAppleConnection = (info) => ({
      connected: true,
      manualEntry: true,
      businessName: info.businessName || '',
      appleConnectUrl: info.appleConnectUrl || '',
      notes: info.notes || '',
      connectedAt: expect.any(String)
    });

    it('should build connection with all fields', () => {
      const info = {
        businessName: 'My Restaurant',
        appleConnectUrl: 'https://businessconnect.apple.com/...',
        notes: 'Profile claimed'
      };
      const conn = buildAppleConnection(info);
      expect(conn.connected).toBe(true);
      expect(conn.manualEntry).toBe(true);
      expect(conn.businessName).toBe('My Restaurant');
      expect(conn.appleConnectUrl).toBe('https://businessconnect.apple.com/...');
    });

    it('should default to empty strings for missing fields', () => {
      const conn = buildAppleConnection({});
      expect(conn.businessName).toBe('');
      expect(conn.appleConnectUrl).toBe('');
      expect(conn.notes).toBe('');
    });
  });

  // ==========================================
  // Business Context for AI Post Generation
  // ==========================================

  describe('Business Context Builder', () => {
    const buildBusinessContext = (reviews, connections) => {
      if (!reviews || reviews.length === 0) return null;

      const avgRating = reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length;
      const positiveReviews = reviews.filter(r => r.rating >= 4);
      const negativeReviews = reviews.filter(r => r.rating <= 2);

      const topPraises = positiveReviews
        .slice(0, 5)
        .map(r => r.text)
        .filter(Boolean)
        .join('; ')
        .substring(0, 200);

      const commonComplaints = negativeReviews
        .slice(0, 3)
        .map(r => r.text)
        .filter(Boolean)
        .join('; ')
        .substring(0, 200);

      return {
        avgRating: Math.round(avgRating * 10) / 10,
        totalReviews: reviews.length,
        topPraises: topPraises || undefined,
        commonComplaints: commonComplaints || undefined,
        connectedPlatforms: Object.keys(connections || {}).filter(p => connections[p]?.connected)
      };
    };

    it('should build context from reviews', () => {
      const reviews = [
        { rating: 5, text: 'Great pasta!' },
        { rating: 4, text: 'Loved the ambiance' },
        { rating: 2, text: 'Slow service' }
      ];
      const connections = { yelp: { connected: true }, google: { connected: true } };
      const ctx = buildBusinessContext(reviews, connections);

      expect(ctx.avgRating).toBe(3.7);
      expect(ctx.totalReviews).toBe(3);
      expect(ctx.topPraises).toContain('Great pasta!');
      expect(ctx.commonComplaints).toContain('Slow service');
      expect(ctx.connectedPlatforms).toEqual(['yelp', 'google']);
    });

    it('should return null for empty reviews', () => {
      expect(buildBusinessContext([], {})).toBeNull();
      expect(buildBusinessContext(null, {})).toBeNull();
    });

    it('should only include connected platforms', () => {
      const reviews = [{ rating: 5 }];
      const connections = {
        yelp: { connected: true },
        google: { connected: false },
        apple: { connected: true }
      };
      const ctx = buildBusinessContext(reviews, connections);
      expect(ctx.connectedPlatforms).toEqual(['yelp', 'apple']);
    });
  });

  // ==========================================
  // Connection Status Logic
  // ==========================================

  describe('Connection Status', () => {
    const getConnectionStatus = (connections) => {
      const platforms = ['yelp', 'google', 'apple'];
      return platforms.map(p => ({
        platform: p,
        connected: !!connections?.[p]?.connected,
        name: connections?.[p]?.businessName || null,
        rating: connections?.[p]?.rating || null
      }));
    };

    it('should detect connected platforms', () => {
      const connections = {
        yelp: { connected: true, businessName: 'My Cafe', rating: 4.5 },
        google: { connected: false },
        apple: { connected: true, businessName: 'My Cafe' }
      };
      const statuses = getConnectionStatus(connections);
      expect(statuses.filter(s => s.connected)).toHaveLength(2);
      expect(statuses[0].name).toBe('My Cafe');
      expect(statuses[0].rating).toBe(4.5);
    });

    it('should handle null connections', () => {
      const statuses = getConnectionStatus(null);
      expect(statuses.every(s => !s.connected)).toBe(true);
    });

    it('should handle empty object', () => {
      const statuses = getConnectionStatus({});
      expect(statuses.every(s => !s.connected)).toBe(true);
    });
  });

  // ==========================================
  // Review Date Formatting
  // ==========================================

  describe('Review Date Formatting', () => {
    const formatDate = (timestamp) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    it('should format ISO date string', () => {
      // Use a full datetime to avoid timezone edge-case shifts
      const result = formatDate('2026-03-20T12:00:00');
      expect(result).toMatch(/Mar 20, 2026/);
    });

    it('should return empty string for null', () => {
      expect(formatDate(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(formatDate(undefined)).toBe('');
    });
  });

  // ==========================================
  // Platform Color/Badge Mapping
  // ==========================================

  describe('Platform Mapping', () => {
    const getPlatformConfig = (platform) => {
      const configs = {
        yelp: { bg: 'danger', label: 'Yelp', color: '#d32323' },
        google: { bg: 'primary', label: 'Google', color: '#4285F4' },
        apple: { bg: 'dark', label: 'Apple', color: '#000' }
      };
      return configs[platform] || { bg: 'secondary', label: platform, color: '#6c757d' };
    };

    it('should return Yelp config', () => {
      expect(getPlatformConfig('yelp').label).toBe('Yelp');
      expect(getPlatformConfig('yelp').color).toBe('#d32323');
    });

    it('should return Google config', () => {
      expect(getPlatformConfig('google').label).toBe('Google');
    });

    it('should return Apple config', () => {
      expect(getPlatformConfig('apple').label).toBe('Apple');
    });

    it('should return fallback for unknown platform', () => {
      expect(getPlatformConfig('tripadvisor').bg).toBe('secondary');
    });
  });
});
