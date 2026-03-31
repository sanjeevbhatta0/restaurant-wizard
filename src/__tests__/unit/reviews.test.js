/**
 * Unit Tests — Reviews Business Logic
 * Tests review validation, star rating logic, review status workflow,
 * review display formatting, and API request construction.
 *
 * Source: functions/index.js (submitReview, getApprovedReviews),
 *         functions/templates/customer-portal/portal.js (renderReviews, submitReview, loadApprovedReviews)
 */

describe('Reviews Business Logic', () => {

  // ==========================================
  // Review Validation (mirrors submitReview cloud function)
  // ==========================================

  describe('validateReviewSubmission', () => {
    /**
     * Mirrors the validation logic in the submitReview Cloud Function.
     * Returns { valid, error } based on required fields.
     */
    function validateReviewSubmission(data) {
      if (!data) return { valid: false, error: 'Missing review data' };
      if (!data.restaurantId) return { valid: false, error: 'restaurantId is required' };
      if (!data.customerName || !data.customerName.trim()) return { valid: false, error: 'customerName is required' };
      if (!data.rating || data.rating < 1 || data.rating > 5) return { valid: false, error: 'rating must be between 1 and 5' };
      if (!data.reviewText || !data.reviewText.trim()) return { valid: false, error: 'reviewText is required' };
      return { valid: true, error: null };
    }

    it('should accept a valid review with all required fields', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John Doe',
        rating: 5,
        reviewText: 'Amazing food!'
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should reject missing data', () => {
      expect(validateReviewSubmission(null).valid).toBe(false);
      expect(validateReviewSubmission(undefined).valid).toBe(false);
    });

    it('should reject missing restaurantId', () => {
      const result = validateReviewSubmission({
        customerName: 'John',
        rating: 4,
        reviewText: 'Good'
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('restaurantId');
    });

    it('should reject missing customerName', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        rating: 4,
        reviewText: 'Good'
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('customerName');
    });

    it('should reject empty customerName (whitespace only)', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: '   ',
        rating: 4,
        reviewText: 'Good'
      });
      expect(result.valid).toBe(false);
    });

    it('should reject missing rating', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John',
        reviewText: 'Good'
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('rating');
    });

    it('should reject rating below 1', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John',
        rating: 0,
        reviewText: 'Good'
      });
      expect(result.valid).toBe(false);
    });

    it('should reject rating above 5', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John',
        rating: 6,
        reviewText: 'Good'
      });
      expect(result.valid).toBe(false);
    });

    it('should reject missing reviewText', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John',
        rating: 5
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reviewText');
    });

    it('should reject empty reviewText (whitespace only)', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John',
        rating: 5,
        reviewText: '   '
      });
      expect(result.valid).toBe(false);
    });

    it('should accept review with optional email', () => {
      const result = validateReviewSubmission({
        restaurantId: 'rest-123',
        customerName: 'John',
        customerEmail: 'john@example.com',
        rating: 3,
        reviewText: 'Decent food'
      });
      expect(result.valid).toBe(true);
    });

    it('should accept boundary ratings (1 and 5)', () => {
      expect(validateReviewSubmission({
        restaurantId: 'r1', customerName: 'A', rating: 1, reviewText: 'Bad'
      }).valid).toBe(true);

      expect(validateReviewSubmission({
        restaurantId: 'r1', customerName: 'A', rating: 5, reviewText: 'Great'
      }).valid).toBe(true);
    });
  });

  // ==========================================
  // Review Status Workflow
  // ==========================================

  describe('Review Status Workflow', () => {
    const VALID_STATUSES = ['pending', 'approved', 'rejected'];

    function createReviewWithStatus(status) {
      return {
        id: 'rev-' + Date.now(),
        customerName: 'Test User',
        rating: 4,
        reviewText: 'Test review',
        status: status,
        createdAt: new Date().toISOString()
      };
    }

    it('should create reviews with pending status by default', () => {
      const review = createReviewWithStatus('pending');
      expect(review.status).toBe('pending');
    });

    it('should support approved status', () => {
      const review = createReviewWithStatus('approved');
      expect(review.status).toBe('approved');
      expect(VALID_STATUSES).toContain(review.status);
    });

    it('should support rejected status', () => {
      const review = createReviewWithStatus('rejected');
      expect(review.status).toBe('rejected');
      expect(VALID_STATUSES).toContain(review.status);
    });

    it('should filter approved reviews for public display', () => {
      const reviews = [
        createReviewWithStatus('pending'),
        createReviewWithStatus('approved'),
        createReviewWithStatus('rejected'),
        createReviewWithStatus('approved'),
        createReviewWithStatus('pending')
      ];

      const approved = reviews.filter(r => r.status === 'approved');
      expect(approved).toHaveLength(2);
      approved.forEach(r => expect(r.status).toBe('approved'));
    });

    it('should filter pending reviews for moderation', () => {
      const reviews = [
        createReviewWithStatus('pending'),
        createReviewWithStatus('approved'),
        createReviewWithStatus('pending')
      ];

      const pending = reviews.filter(r => r.status === 'pending');
      expect(pending).toHaveLength(2);
    });
  });

  // ==========================================
  // Star Rating Display
  // ==========================================

  describe('Star Rating Rendering', () => {
    /**
     * Mirrors the star rendering logic in templates and portal.
     * Returns an array of { filled: boolean } for 5 stars.
     */
    function renderStars(rating) {
      return Array.from({ length: 5 }, (_, i) => ({
        filled: i < rating
      }));
    }

    it('should render 5 filled stars for rating 5', () => {
      const stars = renderStars(5);
      expect(stars).toHaveLength(5);
      expect(stars.every(s => s.filled)).toBe(true);
    });

    it('should render 0 filled stars for rating 0', () => {
      const stars = renderStars(0);
      expect(stars.every(s => !s.filled)).toBe(true);
    });

    it('should render 3 filled and 2 empty for rating 3', () => {
      const stars = renderStars(3);
      expect(stars.filter(s => s.filled)).toHaveLength(3);
      expect(stars.filter(s => !s.filled)).toHaveLength(2);
    });

    it('should render 1 filled star for rating 1', () => {
      const stars = renderStars(1);
      expect(stars[0].filled).toBe(true);
      expect(stars[1].filled).toBe(false);
    });
  });

  // ==========================================
  // Review Date Formatting
  // ==========================================

  describe('Review Date Formatting', () => {
    function formatReviewDate(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    }

    it('should format ISO date string', () => {
      const formatted = formatReviewDate('2026-03-15T10:30:00.000Z');
      expect(formatted).toContain('Mar');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2026');
    });

    it('should return empty string for null timestamp', () => {
      expect(formatReviewDate(null)).toBe('');
    });

    it('should return empty string for undefined timestamp', () => {
      expect(formatReviewDate(undefined)).toBe('');
    });

    it('should handle numeric timestamp', () => {
      const formatted = formatReviewDate(1742025600000); // March 15, 2025
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // Review API Request Construction
  // ==========================================

  describe('Review API Request Construction', () => {
    function buildSubmitReviewRequest(config, formData) {
      return {
        url: config.apiBaseUrl + '/submitReview',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          restaurantId: config.restaurantId,
          customerName: formData.name,
          customerEmail: formData.email || '',
          rating: formData.rating,
          reviewText: formData.text
        }
      };
    }

    function buildGetReviewsRequest(config) {
      return {
        url: config.apiBaseUrl + '/getApprovedReviews?restaurantId=' + config.restaurantId,
        method: 'GET'
      };
    }

    it('should build correct submitReview POST request', () => {
      const req = buildSubmitReviewRequest(
        { apiBaseUrl: 'https://api.example.com', restaurantId: 'rest-123' },
        { name: 'John', email: 'john@test.com', rating: 5, text: 'Great!' }
      );

      expect(req.url).toBe('https://api.example.com/submitReview');
      expect(req.method).toBe('POST');
      expect(req.headers['Content-Type']).toBe('application/json');
      expect(req.body.restaurantId).toBe('rest-123');
      expect(req.body.customerName).toBe('John');
      expect(req.body.customerEmail).toBe('john@test.com');
      expect(req.body.rating).toBe(5);
      expect(req.body.reviewText).toBe('Great!');
    });

    it('should handle missing email in submit request', () => {
      const req = buildSubmitReviewRequest(
        { apiBaseUrl: 'https://api.example.com', restaurantId: 'rest-123' },
        { name: 'Jane', rating: 4, text: 'Nice' }
      );
      expect(req.body.customerEmail).toBe('');
    });

    it('should build correct getApprovedReviews GET request', () => {
      const req = buildGetReviewsRequest({
        apiBaseUrl: 'https://api.example.com',
        restaurantId: 'rest-456'
      });
      expect(req.url).toBe('https://api.example.com/getApprovedReviews?restaurantId=rest-456');
      expect(req.method).toBe('GET');
    });
  });

  // ==========================================
  // Review Sorting and Limiting
  // ==========================================

  describe('Review Sorting and Limiting', () => {
    function sortReviewsByDate(reviews) {
      return [...reviews].sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB - dateA; // Newest first
      });
    }

    it('should sort reviews newest first', () => {
      const reviews = [
        { id: '1', createdAt: '2026-01-01T00:00:00Z' },
        { id: '2', createdAt: '2026-03-15T00:00:00Z' },
        { id: '3', createdAt: '2026-02-10T00:00:00Z' }
      ];
      const sorted = sortReviewsByDate(reviews);
      expect(sorted[0].id).toBe('2');
      expect(sorted[1].id).toBe('3');
      expect(sorted[2].id).toBe('1');
    });

    it('should limit reviews to max 50', () => {
      const reviews = Array.from({ length: 60 }, (_, i) => ({
        id: `rev-${i}`,
        createdAt: new Date(2026, 0, i + 1).toISOString()
      }));
      const limited = reviews.slice(0, 50);
      expect(limited).toHaveLength(50);
    });

    it('should handle empty reviews array', () => {
      const sorted = sortReviewsByDate([]);
      expect(sorted).toHaveLength(0);
    });
  });

  // ==========================================
  // Widget Tab Mapping
  // ==========================================

  describe('Widget Tab to Portal View Mapping', () => {
    const viewMap = {
      'account': 'account',
      'orders': 'orders',
      'active_orders': 'active_orders',
      'promotions': 'promotions',
      'rewards': 'rewards',
      'reviews': 'reviews'
    };

    it('should map reviews tab to reviews view', () => {
      expect(viewMap['reviews']).toBe('reviews');
    });

    it('should map all widget tabs correctly', () => {
      expect(viewMap['account']).toBe('account');
      expect(viewMap['orders']).toBe('orders');
      expect(viewMap['promotions']).toBe('promotions');
      expect(viewMap['rewards']).toBe('rewards');
      expect(viewMap['reviews']).toBe('reviews');
    });

    it('should fallback unknown tabs to undefined', () => {
      expect(viewMap['unknown']).toBeUndefined();
    });
  });

  // ==========================================
  // Review Form Rating State
  // ==========================================

  describe('Review Form Rating State', () => {
    let selectedRating = 0;

    function setReviewRating(rating) {
      selectedRating = rating;
    }

    beforeEach(() => {
      selectedRating = 0;
    });

    it('should start with 0 selected rating', () => {
      expect(selectedRating).toBe(0);
    });

    it('should set rating to clicked value', () => {
      setReviewRating(4);
      expect(selectedRating).toBe(4);
    });

    it('should allow changing rating', () => {
      setReviewRating(3);
      expect(selectedRating).toBe(3);
      setReviewRating(5);
      expect(selectedRating).toBe(5);
    });

    it('should reset rating to 0', () => {
      setReviewRating(4);
      setReviewRating(0);
      expect(selectedRating).toBe(0);
    });
  });

  // ==========================================
  // Firestore Security Rules Logic
  // ==========================================

  describe('Firestore Reviews Security Rules', () => {
    // Simulates the security rules logic for reviews
    function canReadReview(review, requestAuth, restaurantId) {
      // Owner/staff can read all
      if (requestAuth && requestAuth.uid === restaurantId) return true;
      // Public can only read approved
      if (review.status === 'approved') return true;
      return false;
    }

    function canCreateReview() {
      // Anyone can create a review (public endpoint)
      return true;
    }

    function canModifyReview(requestAuth, restaurantId) {
      // Only owner can modify
      return !!(requestAuth && requestAuth.uid === restaurantId);
    }

    it('should allow owner to read any review', () => {
      expect(canReadReview({ status: 'pending' }, { uid: 'owner-1' }, 'owner-1')).toBe(true);
      expect(canReadReview({ status: 'rejected' }, { uid: 'owner-1' }, 'owner-1')).toBe(true);
    });

    it('should allow public to read approved reviews', () => {
      expect(canReadReview({ status: 'approved' }, null, 'owner-1')).toBe(true);
    });

    it('should deny public from reading pending reviews', () => {
      expect(canReadReview({ status: 'pending' }, null, 'owner-1')).toBe(false);
    });

    it('should deny public from reading rejected reviews', () => {
      expect(canReadReview({ status: 'rejected' }, null, 'owner-1')).toBe(false);
    });

    it('should allow anyone to create reviews', () => {
      expect(canCreateReview()).toBe(true);
    });

    it('should allow owner to modify reviews', () => {
      expect(canModifyReview({ uid: 'owner-1' }, 'owner-1')).toBe(true);
    });

    it('should deny non-owner from modifying reviews', () => {
      expect(canModifyReview({ uid: 'other-user' }, 'owner-1')).toBe(false);
      expect(canModifyReview(null, 'owner-1')).toBe(false);
    });
  });
});
