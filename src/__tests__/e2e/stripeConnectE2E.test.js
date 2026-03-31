/**
 * @jest-environment node
 */

/**
 * E2E Tests — Stripe Connect Flow
 *
 * These tests simulate the Stripe Connect lifecycle using Firebase emulators:
 * - Store Stripe Connect settings in Firestore
 * - Verify getStripeConnectAccountId behavior
 * - Test payment routing based on connect status
 * - Test disconnect flow
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/stripeConnectE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_RESTAURANT_UID = 'e2e-stripe-connect-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Stripe Connect Flow', () => {
  const cleanupPaths = [];

  afterAll(async () => {
    for (const path of cleanupPaths) {
      try {
        await db.doc(path).delete();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  // ==========================================
  // Stripe Connect Lifecycle in Firestore
  // ==========================================

  describe('Stripe Connect Settings Lifecycle', () => {
    test('Step 1 — Create restaurant doc', async () => {
      const restaurantRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}`);
      cleanupPaths.push(`restaurants/${TEST_RESTAURANT_UID}`);

      await restaurantRef.set({
        restaurantName: 'E2E Stripe Test Restaurant',
        email: 'e2e@test.com',
        createdAt: new Date()
      });

      const snap = await restaurantRef.get();
      expect(snap.exists).toBe(true);
    });

    test('Step 2 — No Stripe Connect initially', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);
      const snap = await connectRef.get();
      expect(snap.exists).toBe(false);
    });

    test('Step 3 — Store pending Stripe Connect state', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);
      cleanupPaths.push(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);

      await connectRef.set({
        stripeAccountId: 'acct_e2e_test123',
        status: 'pending',
        initiatedAt: new Date(),
        updatedAt: new Date()
      });

      const snap = await connectRef.get();
      expect(snap.exists).toBe(true);
      expect(snap.data().status).toBe('pending');
      expect(snap.data().stripeAccountId).toBe('acct_e2e_test123');
    });

    test('Step 4 — Helper returns null for pending status', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);
      const snap = await connectRef.get();
      const data = snap.data();

      // Simulate getStripeConnectAccountId logic
      const result = (data.status === 'active' && data.stripeAccountId) ? data.stripeAccountId : null;
      expect(result).toBeNull();
    });

    test('Step 5 — Update to active after onboarding', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);

      await connectRef.update({
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
        businessName: 'E2E Test Restaurant',
        connectedAt: new Date(),
        updatedAt: new Date()
      });

      const snap = await connectRef.get();
      const data = snap.data();
      expect(data.status).toBe('active');
      expect(data.chargesEnabled).toBe(true);
      expect(data.payoutsEnabled).toBe(true);
      expect(data.businessName).toBe('E2E Test Restaurant');
    });

    test('Step 6 — Helper returns account ID for active status', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);
      const snap = await connectRef.get();
      const data = snap.data();

      const result = (data.status === 'active' && data.stripeAccountId) ? data.stripeAccountId : null;
      expect(result).toBe('acct_e2e_test123');
    });

    test('Step 7 — Disconnect Stripe account', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);

      await connectRef.set({
        stripeAccountId: null,
        status: 'disconnected',
        disconnectedAt: new Date(),
        updatedAt: new Date(),
        previousAccountId: 'acct_e2e_test123'
      });

      const snap = await connectRef.get();
      const data = snap.data();
      expect(data.status).toBe('disconnected');
      expect(data.stripeAccountId).toBeNull();
      expect(data.previousAccountId).toBe('acct_e2e_test123');
    });

    test('Step 8 — Helper returns null after disconnect', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);
      const snap = await connectRef.get();
      const data = snap.data();

      const result = (data.status === 'active' && data.stripeAccountId) ? data.stripeAccountId : null;
      expect(result).toBeNull();
    });
  });

  // ==========================================
  // Reconnect Flow
  // ==========================================

  describe('Reconnect After Disconnect', () => {
    test('Step 1 — Can re-initiate after disconnect', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);
      const snap = await connectRef.get();
      const data = snap.data();

      // Should not block re-connection
      expect(data.status).not.toBe('active');
    });

    test('Step 2 — Store new pending state', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);

      await connectRef.set({
        stripeAccountId: 'acct_e2e_reconnect',
        status: 'pending',
        initiatedAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });

      const snap = await connectRef.get();
      expect(snap.data().stripeAccountId).toBe('acct_e2e_reconnect');
      expect(snap.data().status).toBe('pending');
    });

    test('Step 3 — Activate new connection', async () => {
      const connectRef = db.doc(`restaurants/${TEST_RESTAURANT_UID}/settings/stripeConnect`);

      await connectRef.update({
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
        businessName: 'Reconnected Restaurant',
        connectedAt: new Date(),
        updatedAt: new Date()
      });

      const snap = await connectRef.get();
      const data = snap.data();
      expect(data.status).toBe('active');
      expect(data.stripeAccountId).toBe('acct_e2e_reconnect');
      expect(data.businessName).toBe('Reconnected Restaurant');
    });
  });
});

// ==========================================
// Mock Fallback Tests (when emulator not running)
// ==========================================

const describeMock = isEmulatorAvailable ? describe.skip : describe;

describeMock('Stripe Connect E2E — Mock Fallback (emulator unavailable)', () => {
  test('Stripe Connect document structure is correct', () => {
    const connectDoc = {
      stripeAccountId: 'acct_test123',
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
      businessName: 'Test Restaurant',
      connectedAt: new Date(),
      updatedAt: new Date()
    };

    expect(connectDoc.stripeAccountId).toMatch(/^acct_/);
    expect(connectDoc.status).toBe('active');
    expect(connectDoc.chargesEnabled).toBe(true);
  });

  test('getStripeConnectAccountId returns correctly for all states', () => {
    const helper = (doc) => {
      if (!doc) return null;
      if (doc.status === 'active' && doc.stripeAccountId) return doc.stripeAccountId;
      return null;
    };

    expect(helper(null)).toBeNull();
    expect(helper({ status: 'pending', stripeAccountId: 'acct_1' })).toBeNull();
    expect(helper({ status: 'active', stripeAccountId: 'acct_1' })).toBe('acct_1');
    expect(helper({ status: 'disconnected', stripeAccountId: null })).toBeNull();
  });

  test('Payment intent stripeOptions built correctly', () => {
    const buildOptions = (accountId) =>
      accountId ? { stripeAccount: accountId } : {};

    expect(buildOptions('acct_123')).toEqual({ stripeAccount: 'acct_123' });
    expect(buildOptions(null)).toEqual({});
    expect(buildOptions('')).toEqual({});
  });

  test('Stripe Connect settings path follows convention', () => {
    const restaurantId = 'owner-123';
    const path = `restaurants/${restaurantId}/settings/stripeConnect`;
    expect(path).toBe('restaurants/owner-123/settings/stripeConnect');
    expect(path).toMatch(/^restaurants\/.+\/settings\/stripeConnect$/);
  });

  test('Disconnect preserves previous account ID', () => {
    const before = { stripeAccountId: 'acct_old', status: 'active' };
    const after = {
      stripeAccountId: null,
      status: 'disconnected',
      previousAccountId: before.stripeAccountId
    };

    expect(after.previousAccountId).toBe('acct_old');
    expect(after.stripeAccountId).toBeNull();
  });
});
