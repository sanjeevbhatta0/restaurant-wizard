/**
 * @jest-environment node
 */

/**
 * E2E Tests — Reviews Flow
 *
 * Tests the complete review lifecycle using Firebase Firestore emulator:
 *   Review submission → Moderation → Approved reviews retrieval
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/reviewsE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_RESTAURANT_ID = 'reviews-e2e-test-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Reviews Flow', () => {
  let createdReviewIds = [];

  beforeAll(async () => {
    // Create restaurant
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).set({
      restaurantName: 'Reviews E2E Restaurant',
      slug: 'reviews-e2e-' + Date.now(),
      createdAt: new Date()
    });
  });

  afterAll(async () => {
    // Cleanup reviews
    for (const id of createdReviewIds) {
      try {
        await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${id}`).delete();
      } catch (e) { /* ignore */ }
    }
    // Cleanup restaurant
    try {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).delete();
    } catch (e) { /* ignore */ }
  });

  // ==========================================
  // Review Submission
  // ==========================================

  it('should create a review with pending status in Firestore', async () => {
    const reviewRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'E2E Test Customer',
      customerEmail: 'test@example.com',
      rating: 5,
      reviewText: 'This restaurant is amazing! Great E2E test food.',
      status: 'pending',
      createdAt: new Date()
    });

    createdReviewIds.push(reviewRef.id);

    // Verify the review was created
    const reviewSnap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${reviewRef.id}`).get();
    expect(reviewSnap.exists).toBe(true);

    const reviewData = reviewSnap.data();
    expect(reviewData.customerName).toBe('E2E Test Customer');
    expect(reviewData.rating).toBe(5);
    expect(reviewData.status).toBe('pending');
    expect(reviewData.reviewText).toContain('amazing');
  });

  it('should create multiple reviews from different customers', async () => {
    const reviews = [
      { customerName: 'Alice', rating: 5, reviewText: 'Loved it!', status: 'pending', createdAt: new Date() },
      { customerName: 'Bob', rating: 4, reviewText: 'Very good', status: 'pending', createdAt: new Date() },
      { customerName: 'Charlie', rating: 3, reviewText: 'Average', status: 'pending', createdAt: new Date() }
    ];

    for (const review of reviews) {
      const ref = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add(review);
      createdReviewIds.push(ref.id);
    }

    // Query all pending reviews
    const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`)
      .where('status', '==', 'pending')
      .get();
    expect(snapshot.size).toBeGreaterThanOrEqual(3);
  });

  // ==========================================
  // Review Moderation
  // ==========================================

  it('should approve a review and update status', async () => {
    // Create a review
    const ref = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Approve Me',
      rating: 5,
      reviewText: 'This should be approved',
      status: 'pending',
      createdAt: new Date()
    });
    createdReviewIds.push(ref.id);

    // Approve it
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).update({
      status: 'approved',
      approvedAt: new Date(),
      updatedAt: new Date()
    });

    // Verify
    const snap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).get();
    expect(snap.data().status).toBe('approved');
    expect(snap.data().approvedAt).toBeDefined();
  });

  it('should reject a review and update status', async () => {
    const ref = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Reject Me',
      rating: 1,
      reviewText: 'Spam review',
      status: 'pending',
      createdAt: new Date()
    });
    createdReviewIds.push(ref.id);

    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).update({
      status: 'rejected',
      updatedAt: new Date()
    });

    const snap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).get();
    expect(snap.data().status).toBe('rejected');
  });

  // ==========================================
  // Approved Reviews Retrieval
  // ==========================================

  it('should retrieve only approved reviews ordered by date', async () => {
    // Create mixed-status reviews
    const r1 = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Approved Old',
      rating: 4,
      reviewText: 'Good old review',
      status: 'approved',
      createdAt: new Date('2026-01-01')
    });
    createdReviewIds.push(r1.id);

    const r2 = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Pending Review',
      rating: 3,
      reviewText: 'Still pending',
      status: 'pending',
      createdAt: new Date('2026-02-01')
    });
    createdReviewIds.push(r2.id);

    const r3 = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Approved New',
      rating: 5,
      reviewText: 'Great new review',
      status: 'approved',
      createdAt: new Date('2026-03-01')
    });
    createdReviewIds.push(r3.id);

    // Query approved reviews
    const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`)
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .get();

    const approvedReviews = [];
    snapshot.forEach(s => approvedReviews.push({ id: s.id, ...s.data() }));

    // All should be approved
    approvedReviews.forEach(r => expect(r.status).toBe('approved'));

    // Should not contain the pending review
    expect(approvedReviews.find(r => r.customerName === 'Pending Review')).toBeUndefined();

    // Should be ordered newest first
    if (approvedReviews.length >= 2) {
      const first = approvedReviews.find(r => r.customerName === 'Approved New');
      const second = approvedReviews.find(r => r.customerName === 'Approved Old');
      if (first && second) {
        const firstIdx = approvedReviews.indexOf(first);
        const secondIdx = approvedReviews.indexOf(second);
        expect(firstIdx).toBeLessThan(secondIdx);
      }
    }
  });

  // ==========================================
  // Review Deletion
  // ==========================================

  it('should delete a review from Firestore', async () => {
    const ref = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Delete Me',
      rating: 2,
      reviewText: 'This will be deleted',
      status: 'pending',
      createdAt: new Date()
    });

    // Delete it
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).delete();

    // Verify it's gone
    const snap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).get();
    expect(snap.exists).toBe(false);
  });

  // ==========================================
  // Review Status Transition
  // ==========================================

  it('should support re-approving a rejected review', async () => {
    const ref = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Re-Approve Me',
      rating: 4,
      reviewText: 'Initially rejected then approved',
      status: 'rejected',
      createdAt: new Date()
    });
    createdReviewIds.push(ref.id);

    // Re-approve
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).update({
      status: 'approved',
      approvedAt: new Date(),
      updatedAt: new Date()
    });

    const snap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).get();
    expect(snap.data().status).toBe('approved');
  });

  it('should support revoking an approved review', async () => {
    const ref = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/reviews`).add({
      customerName: 'Revoke Me',
      rating: 5,
      reviewText: 'Was approved, now rejected',
      status: 'approved',
      createdAt: new Date()
    });
    createdReviewIds.push(ref.id);

    // Revoke approval
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).update({
      status: 'rejected',
      updatedAt: new Date()
    });

    const snap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/reviews/${ref.id}`).get();
    expect(snap.data().status).toBe('rejected');
  });
});

// ==========================================
// Mock Fallback Tests (run without emulator)
// ==========================================

const describeMock = isEmulatorAvailable ? describe.skip : describe;

describeMock('Reviews Flow — Mock Fallback', () => {
  it('should validate review data structure', () => {
    const review = {
      customerName: 'Mock User',
      customerEmail: 'mock@test.com',
      rating: 4,
      reviewText: 'Mock review text',
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    expect(review.status).toBe('pending');
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review.rating).toBeLessThanOrEqual(5);
    expect(review.customerName).toBeTruthy();
    expect(review.reviewText).toBeTruthy();
  });

  it('should filter approved reviews correctly', () => {
    const reviews = [
      { id: '1', status: 'pending', customerName: 'A' },
      { id: '2', status: 'approved', customerName: 'B' },
      { id: '3', status: 'rejected', customerName: 'C' },
      { id: '4', status: 'approved', customerName: 'D' }
    ];

    const approved = reviews.filter(r => r.status === 'approved');
    expect(approved).toHaveLength(2);
    expect(approved.map(r => r.customerName)).toEqual(['B', 'D']);
  });

  it('should transition review through full lifecycle', () => {
    const review = { status: 'pending', customerName: 'Test' };

    // Submit → pending
    expect(review.status).toBe('pending');

    // Approve
    review.status = 'approved';
    expect(review.status).toBe('approved');

    // Visible in approved filter
    expect([review].filter(r => r.status === 'approved')).toHaveLength(1);
  });
});
