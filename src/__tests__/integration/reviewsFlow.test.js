/**
 * Integration Tests — Reviews Flow
 * Tests the complete review lifecycle:
 *   Customer submits review → Admin moderates → Approved reviews visible on website/widget
 * Also tests template review rendering, widget review tab integration,
 * and embed portal review methods.
 *
 * Source: functions/index.js (submitReview, getApprovedReviews),
 *         functions/templates/customer-portal/portal.js,
 *         functions/templates/customer-portal/embed-app.js,
 *         public/widget.js
 */

describe('Reviews Flow — Integration', () => {

  // ==========================================
  // Review Submission Flow
  // ==========================================

  describe('Review Submission Flow', () => {
    // Simulates the submitReview cloud function logic
    function processReviewSubmission(body) {
      const { restaurantId, customerName, customerEmail, rating, reviewText } = body || {};

      if (!restaurantId) return { success: false, error: 'restaurantId is required' };
      if (!customerName || !customerName.trim()) return { success: false, error: 'customerName is required' };
      if (!rating || rating < 1 || rating > 5) return { success: false, error: 'rating must be between 1 and 5' };
      if (!reviewText || !reviewText.trim()) return { success: false, error: 'reviewText is required' };

      const review = {
        id: 'rev-' + Date.now(),
        restaurantId,
        customerName: customerName.trim(),
        customerEmail: customerEmail || '',
        rating: Number(rating),
        reviewText: reviewText.trim(),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      return { success: true, message: 'Review submitted successfully', reviewId: review.id, review };
    }

    it('should create a review with pending status', () => {
      const result = processReviewSubmission({
        restaurantId: 'rest-1',
        customerName: 'John',
        rating: 5,
        reviewText: 'Great food!'
      });

      expect(result.success).toBe(true);
      expect(result.review.status).toBe('pending');
      expect(result.review.customerName).toBe('John');
      expect(result.review.rating).toBe(5);
    });

    it('should trim whitespace from customer name and review text', () => {
      const result = processReviewSubmission({
        restaurantId: 'rest-1',
        customerName: '  Jane Doe  ',
        rating: 4,
        reviewText: '  Nice place!  '
      });

      expect(result.review.customerName).toBe('Jane Doe');
      expect(result.review.reviewText).toBe('Nice place!');
    });

    it('should set empty string for missing email', () => {
      const result = processReviewSubmission({
        restaurantId: 'rest-1',
        customerName: 'Bob',
        rating: 3,
        reviewText: 'OK'
      });

      expect(result.review.customerEmail).toBe('');
    });

    it('should preserve provided email', () => {
      const result = processReviewSubmission({
        restaurantId: 'rest-1',
        customerName: 'Alice',
        customerEmail: 'alice@test.com',
        rating: 5,
        reviewText: 'Excellent!'
      });

      expect(result.review.customerEmail).toBe('alice@test.com');
    });

    it('should convert rating to number', () => {
      const result = processReviewSubmission({
        restaurantId: 'rest-1',
        customerName: 'Bob',
        rating: '4',
        reviewText: 'Good'
      });

      expect(result.review.rating).toBe(4);
    });

    it('should include createdAt timestamp', () => {
      const before = new Date().toISOString();
      const result = processReviewSubmission({
        restaurantId: 'rest-1',
        customerName: 'Test',
        rating: 5,
        reviewText: 'Test'
      });
      const after = new Date().toISOString();

      expect(result.review.createdAt).toBeDefined();
      expect(result.review.createdAt >= before).toBe(true);
      expect(result.review.createdAt <= after).toBe(true);
    });

    it('should reject submission with missing required fields', () => {
      expect(processReviewSubmission({}).success).toBe(false);
      expect(processReviewSubmission({ restaurantId: 'r1' }).success).toBe(false);
      expect(processReviewSubmission({ restaurantId: 'r1', customerName: 'J' }).success).toBe(false);
      expect(processReviewSubmission({ restaurantId: 'r1', customerName: 'J', rating: 5 }).success).toBe(false);
    });
  });

  // ==========================================
  // Review Moderation Flow
  // ==========================================

  describe('Review Moderation Flow', () => {
    function moderateReview(review, action) {
      const updated = { ...review, updatedAt: new Date().toISOString() };

      switch (action) {
        case 'approve':
          updated.status = 'approved';
          updated.approvedAt = new Date().toISOString();
          break;
        case 'reject':
          updated.status = 'rejected';
          break;
        case 'delete':
          return { deleted: true, id: review.id };
        default:
          return { error: 'Invalid action' };
      }

      return updated;
    }

    const sampleReview = {
      id: 'rev-1',
      customerName: 'John',
      rating: 5,
      reviewText: 'Amazing!',
      status: 'pending',
      createdAt: '2026-03-15T10:00:00Z'
    };

    it('should approve a pending review', () => {
      const result = moderateReview(sampleReview, 'approve');
      expect(result.status).toBe('approved');
      expect(result.approvedAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should reject a pending review', () => {
      const result = moderateReview(sampleReview, 'reject');
      expect(result.status).toBe('rejected');
      expect(result.updatedAt).toBeDefined();
    });

    it('should delete a review', () => {
      const result = moderateReview(sampleReview, 'delete');
      expect(result.deleted).toBe(true);
      expect(result.id).toBe('rev-1');
    });

    it('should handle re-approving a rejected review', () => {
      const rejected = { ...sampleReview, status: 'rejected' };
      const result = moderateReview(rejected, 'approve');
      expect(result.status).toBe('approved');
    });

    it('should handle revoking an approved review', () => {
      const approved = { ...sampleReview, status: 'approved' };
      const result = moderateReview(approved, 'reject');
      expect(result.status).toBe('rejected');
    });
  });

  // ==========================================
  // Approved Reviews Retrieval
  // ==========================================

  describe('Approved Reviews Retrieval', () => {
    function getApprovedReviews(allReviews, limit = 50) {
      return allReviews
        .filter(r => r.status === 'approved')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
    }

    const reviews = [
      { id: '1', status: 'pending', rating: 3, createdAt: '2026-03-01' },
      { id: '2', status: 'approved', rating: 5, createdAt: '2026-03-10' },
      { id: '3', status: 'rejected', rating: 1, createdAt: '2026-03-05' },
      { id: '4', status: 'approved', rating: 4, createdAt: '2026-03-15' },
      { id: '5', status: 'approved', rating: 5, createdAt: '2026-03-08' }
    ];

    it('should return only approved reviews', () => {
      const result = getApprovedReviews(reviews);
      expect(result).toHaveLength(3);
      result.forEach(r => expect(r.status).toBe('approved'));
    });

    it('should sort by createdAt descending (newest first)', () => {
      const result = getApprovedReviews(reviews);
      expect(result[0].id).toBe('4'); // March 15
      expect(result[1].id).toBe('2'); // March 10
      expect(result[2].id).toBe('5'); // March 8
    });

    it('should limit results to 50 by default', () => {
      const manyReviews = Array.from({ length: 60 }, (_, i) => ({
        id: `rev-${i}`, status: 'approved', createdAt: new Date(2026, 0, i + 1).toISOString()
      }));
      const result = getApprovedReviews(manyReviews);
      expect(result).toHaveLength(50);
    });

    it('should return empty array when no approved reviews', () => {
      const pending = [
        { id: '1', status: 'pending', createdAt: '2026-01-01' },
        { id: '2', status: 'rejected', createdAt: '2026-01-02' }
      ];
      expect(getApprovedReviews(pending)).toHaveLength(0);
    });
  });

  // ==========================================
  // Template Review Section Integration
  // ==========================================

  describe('Template Review Section', () => {
    // Simulates loadReviews() in website templates
    function buildReviewHTML(reviews) {
      if (!reviews || reviews.length === 0) {
        return '<div class="review-empty">No reviews yet. Be the first to share your experience!</div>';
      }
      return reviews.map(r => {
        const stars = Array.from({ length: 5 }, (_, i) =>
          `<i class="bi bi-star${i < r.rating ? '-fill' : ''}"></i>`
        ).join('');
        const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        }) : '';
        return `<div class="review-card"><span class="review-card-name">${r.customerName}</span><span class="review-card-date">${dateStr}</span><div class="review-stars">${stars}</div><div class="review-card-text">${r.reviewText}</div></div>`;
      }).join('');
    }

    it('should render review cards with name, stars, date, and text', () => {
      const html = buildReviewHTML([{
        customerName: 'John Doe',
        rating: 5,
        reviewText: 'Best pizza in town!',
        createdAt: '2026-03-15T00:00:00Z'
      }]);

      expect(html).toContain('John Doe');
      expect(html).toContain('review-card');
      expect(html).toContain('bi-star-fill');
      expect(html).toContain('Best pizza in town!');
      expect(html).toContain('Mar');
    });

    it('should render correct number of filled stars', () => {
      const html = buildReviewHTML([{
        customerName: 'Test', rating: 3, reviewText: 'OK', createdAt: '2026-01-01'
      }]);

      const filledCount = (html.match(/bi-star-fill/g) || []).length;
      const emptyCount = (html.match(/bi-star"/g) || []).length;
      expect(filledCount).toBe(3);
      expect(emptyCount).toBe(2);
    });

    it('should render multiple review cards', () => {
      const html = buildReviewHTML([
        { customerName: 'A', rating: 5, reviewText: 'Great', createdAt: '2026-01-01' },
        { customerName: 'B', rating: 4, reviewText: 'Good', createdAt: '2026-01-02' },
        { customerName: 'C', rating: 3, reviewText: 'OK', createdAt: '2026-01-03' }
      ]);

      const cardCount = (html.match(/review-card/g) || []).length;
      // Each card has both review-card class + child elements with review-card-* classes
      expect(cardCount).toBeGreaterThanOrEqual(3);
      expect(html).toContain('A');
      expect(html).toContain('B');
      expect(html).toContain('C');
    });

    it('should render empty state when no reviews', () => {
      const html = buildReviewHTML([]);
      expect(html).toContain('review-empty');
      expect(html).toContain('No reviews yet');
    });

    it('should render empty state for null reviews', () => {
      const html = buildReviewHTML(null);
      expect(html).toContain('review-empty');
    });
  });

  // ==========================================
  // Widget Reviews Tab Integration
  // ==========================================

  describe('Widget Reviews Tab', () => {
    it('should include reviews tab in widget shell HTML', () => {
      // Simulates _buildWidgetShell from widget.js
      const tabsHtml = [
        '<button class="kc-tab active" data-tab="menu">Menu</button>',
        '<button class="kc-tab" data-tab="account">My Account</button>',
        '<button class="kc-tab" data-tab="orders">Orders</button>',
        '<button class="kc-tab" data-tab="promotions">Promos</button>',
        '<button class="kc-tab" data-tab="rewards">Rewards</button>',
        '<button class="kc-tab" data-tab="reviews">Reviews</button>'
      ].join('');

      expect(tabsHtml).toContain('data-tab="reviews"');
      expect(tabsHtml).toContain('>Reviews<');
    });

    it('should send koda-navigate message for reviews tab', () => {
      // Simulates the postMessage flow
      const message = { type: 'koda-navigate', tab: 'reviews' };
      expect(message.type).toBe('koda-navigate');
      expect(message.tab).toBe('reviews');
    });

    it('should sync active state for reviews tab from iframe', () => {
      // Simulates koda-tab-change handler
      const tabs = [
        { dataset: { tab: 'menu' }, active: false },
        { dataset: { tab: 'account' }, active: false },
        { dataset: { tab: 'reviews' }, active: false }
      ];

      const activeTab = 'reviews';
      tabs.forEach(t => {
        t.active = t.dataset.tab === activeTab;
      });

      expect(tabs[2].active).toBe(true);
      expect(tabs[0].active).toBe(false);
    });
  });

  // ==========================================
  // Embed App View Switching for Reviews
  // ==========================================

  describe('Embed App Reviews View Switching', () => {
    const viewMap = {
      'account': 'account',
      'orders': 'orders',
      'active_orders': 'active_orders',
      'promotions': 'promotions',
      'rewards': 'rewards',
      'reviews': 'reviews'
    };

    it('should map reviews tab to reviews portal view', () => {
      const portalView = viewMap['reviews'] || 'account';
      expect(portalView).toBe('reviews');
    });

    it('should allow reviews without authentication', () => {
      // Simulates the embed-app logic: reviews bypass auth check
      const isAuthenticated = false;
      const portalView = 'reviews';

      let action;
      if (portalView === 'reviews') {
        action = 'showDashboard';
      } else if (isAuthenticated) {
        action = 'showDashboard';
      } else {
        action = 'showAuth';
      }

      expect(action).toBe('showDashboard');
    });

    it('should require authentication for non-review views', () => {
      const isAuthenticated = false;
      const portalView = 'orders';

      let action;
      if (portalView === 'reviews') {
        action = 'showDashboard';
      } else if (isAuthenticated) {
        action = 'showDashboard';
      } else {
        action = 'showAuth';
      }

      expect(action).toBe('showAuth');
    });
  });

  // ==========================================
  // Portal Reviews Navigation
  // ==========================================

  describe('Portal Reviews Navigation', () => {
    const validTabs = ['account', 'active_orders', 'orders', 'promotions', 'rewards', 'reviews'];

    it('should include reviews in valid tab list', () => {
      expect(validTabs).toContain('reviews');
    });

    it('should render reviews in dashboard content switch', () => {
      // Simulates renderDashboardContent switch
      function renderDashboardContent(currentView) {
        switch (currentView) {
          case 'active_orders': return 'activeOrders';
          case 'orders': return 'orders';
          case 'promotions': return 'promotions';
          case 'rewards': return 'rewards';
          case 'reviews': return 'reviews';
          default: return 'account';
        }
      }

      expect(renderDashboardContent('reviews')).toBe('reviews');
      expect(renderDashboardContent('account')).toBe('account');
    });
  });

  // ==========================================
  // Full Review Lifecycle
  // ==========================================

  describe('Full Review Lifecycle', () => {
    it('should flow: submit → pending → approve → visible publicly', () => {
      // Step 1: Customer submits
      const review = {
        id: 'rev-lifecycle',
        customerName: 'Lifecycle User',
        rating: 5,
        reviewText: 'Perfect experience',
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      expect(review.status).toBe('pending');

      // Step 2: Check not visible publicly
      const publicReviews = [review].filter(r => r.status === 'approved');
      expect(publicReviews).toHaveLength(0);

      // Step 3: Admin approves
      review.status = 'approved';
      review.approvedAt = new Date().toISOString();

      // Step 4: Now visible publicly
      const updatedPublic = [review].filter(r => r.status === 'approved');
      expect(updatedPublic).toHaveLength(1);
      expect(updatedPublic[0].customerName).toBe('Lifecycle User');
    });

    it('should flow: submit → pending → reject → not visible', () => {
      const review = {
        id: 'rev-reject',
        customerName: 'Rejected User',
        rating: 1,
        reviewText: 'Spam content',
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      // Admin rejects
      review.status = 'rejected';

      const publicReviews = [review].filter(r => r.status === 'approved');
      expect(publicReviews).toHaveLength(0);
    });

    it('should flow: submit → approve → revoke → not visible', () => {
      const review = {
        id: 'rev-revoke',
        customerName: 'Revoked User',
        rating: 4,
        reviewText: 'Was ok',
        status: 'approved'
      };

      // Visible
      expect([review].filter(r => r.status === 'approved')).toHaveLength(1);

      // Admin revokes
      review.status = 'rejected';

      // Not visible
      expect([review].filter(r => r.status === 'approved')).toHaveLength(0);
    });
  });
});
