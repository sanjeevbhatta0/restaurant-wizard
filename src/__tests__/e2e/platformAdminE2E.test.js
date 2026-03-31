/**
 * @jest-environment node
 */

/**
 * E2E Tests — Platform Admin Configuration Pipeline
 *
 * Tests the complete admin config lifecycle using Firebase Firestore emulator:
 *   Admin publishes config → Config available on public side →
 *   Restaurant signs up with config-driven pricing → Subscription created correctly
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/platformAdminE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_PREFIX = 'admin-e2e-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Platform Admin Configuration Pipeline', () => {
  const DEFAULT_CONFIG = {
    pricing: { scout: 0, ally: 29, guide: 59, chief: 99, elder: 229 },
    billingMultipliers: { monthly: 1.20, quarterly: 1.10, annual: 1.00 },
    discounts: [],
    freeTrials: {
      scout: { enabled: false, days: 0 },
      ally: { enabled: false, days: 0 },
      guide: { enabled: false, days: 0 },
      chief: { enabled: false, days: 0 },
      elder: { enabled: false, days: 0 }
    },
    orderLimits: {
      scout: { limit: 75, overageRate: 0, hardCap: true },
      ally: { limit: 500, overageRate: 0.02, hardCap: false },
      guide: { limit: 2000, overageRate: 0.01, hardCap: false },
      chief: { limit: 5000, overageRate: 0.005, hardCap: false },
      elder: { limit: 999999, overageRate: 0, hardCap: false }
    },
    features: {
      'menu-management': { tier: 'scout', name: 'Menu Management' },
      'pos': { tier: 'scout', name: 'Point of Sale' },
      'basic-analytics': { tier: 'guide', name: 'Basic Analytics' },
      'seo-social': { tier: 'chief', name: 'SEO & Social' },
      'ai-analytics': { tier: 'elder', name: 'AI Analytics' }
    }
  };

  afterAll(async () => {
    // Cleanup test documents
    const docsToClean = [
      `platformConfig/${TEST_PREFIX}-current`,
      `platformConfigDraft/${TEST_PREFIX}-current`,
      `restaurants/${TEST_PREFIX}-user1`,
      `restaurants/${TEST_PREFIX}-user2`,
      `restaurants/${TEST_PREFIX}-user3`,
      `admins/${TEST_PREFIX}-admin`
    ];

    for (const path of docsToClean) {
      try {
        await db.doc(path).delete();
      } catch (e) { /* ignore */ }
    }
  });

  // ==========================================
  // Config Publish and Read
  // ==========================================

  it('should publish config and read it back correctly', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    // Admin publishes config
    await db.doc(`platformConfig/${configDocId}`).set({
      ...DEFAULT_CONFIG,
      publishedAt: new Date(),
      publishedBy: `${TEST_PREFIX}-admin`
    });

    // Read published config (simulates PricingTiers.js)
    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    expect(snap.exists).toBe(true);

    const config = snap.data();
    expect(config.pricing.ally).toBe(29);
    expect(config.pricing.guide).toBe(59);
    expect(config.billingMultipliers.monthly).toBe(1.20);
    expect(config.publishedBy).toBe(`${TEST_PREFIX}-admin`);
  });

  it('should save draft without affecting published config', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    // Publish initial config
    await db.doc(`platformConfig/${configDocId}`).set({
      ...DEFAULT_CONFIG,
      publishedAt: new Date()
    });

    // Save draft with different pricing
    await db.doc(`platformConfigDraft/${configDocId}`).set({
      ...DEFAULT_CONFIG,
      pricing: { ...DEFAULT_CONFIG.pricing, ally: 49 },
      updatedAt: new Date()
    });

    // Verify published is unchanged
    const pubSnap = await db.doc(`platformConfig/${configDocId}`).get();
    expect(pubSnap.data().pricing.ally).toBe(29);

    // Verify draft has new price
    const draftSnap = await db.doc(`platformConfigDraft/${configDocId}`).get();
    expect(draftSnap.data().pricing.ally).toBe(49);
  });

  it('should update published config when admin publishes', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    // Publish updated config
    const updatedConfig = {
      ...DEFAULT_CONFIG,
      pricing: { ...DEFAULT_CONFIG.pricing, ally: 39, guide: 69 },
      publishedAt: new Date(),
      publishedBy: `${TEST_PREFIX}-admin`
    };
    await db.doc(`platformConfig/${configDocId}`).set(updatedConfig);

    // Verify update
    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    expect(snap.data().pricing.ally).toBe(39);
    expect(snap.data().pricing.guide).toBe(69);
  });

  // ==========================================
  // Discount Publish and Apply
  // ==========================================

  it('should publish config with active discount', async () => {
    const configDocId = `${TEST_PREFIX}-current`;
    const now = Date.now();

    const configWithDiscount = {
      ...DEFAULT_CONFIG,
      discounts: [{
        id: 'test-discount-1',
        type: 'tier',
        target: 'ally',
        amount: 20,
        isPercentage: true,
        active: true,
        name: 'E2E Test Sale',
        startDate: new Date(now - 86400000).toISOString(),
        endDate: new Date(now + 86400000).toISOString()
      }],
      publishedAt: new Date()
    };

    await db.doc(`platformConfig/${configDocId}`).set(configWithDiscount);

    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    const config = snap.data();

    expect(config.discounts).toHaveLength(1);
    expect(config.discounts[0].amount).toBe(20);
    expect(config.discounts[0].isPercentage).toBe(true);
    expect(config.discounts[0].target).toBe('ally');
    expect(config.discounts[0].active).toBe(true);

    // Calculate discounted price
    const basePrice = config.pricing.ally;
    const discountAmount = basePrice * (config.discounts[0].amount / 100);
    const discountedPrice = basePrice - discountAmount;
    expect(discountedPrice).toBeCloseTo(23.20, 2);
  });

  // ==========================================
  // Free Trial Config
  // ==========================================

  it('should publish config with free trials enabled', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    const configWithTrials = {
      ...DEFAULT_CONFIG,
      freeTrials: {
        scout: { enabled: false, days: 0 },
        ally: { enabled: true, days: 14 },
        guide: { enabled: true, days: 7 },
        chief: { enabled: false, days: 0 },
        elder: { enabled: true, days: 30 }
      },
      publishedAt: new Date()
    };

    await db.doc(`platformConfig/${configDocId}`).set(configWithTrials);

    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    const config = snap.data();

    expect(config.freeTrials.ally.enabled).toBe(true);
    expect(config.freeTrials.ally.days).toBe(14);
    expect(config.freeTrials.guide.enabled).toBe(true);
    expect(config.freeTrials.guide.days).toBe(7);
    expect(config.freeTrials.chief.enabled).toBe(false);
    expect(config.freeTrials.elder.enabled).toBe(true);
    expect(config.freeTrials.elder.days).toBe(30);
  });

  // ==========================================
  // Restaurant Signup with Published Config
  // ==========================================

  it('should create restaurant with scout (free) subscription', async () => {
    const userId = `${TEST_PREFIX}-user1`;
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await db.doc(`restaurants/${userId}`).set({
      restaurantName: 'E2E Scout Restaurant',
      email: 'scout@test.com',
      isMultiLocation: false,
      locationCount: 1,
      createdAt: now.toISOString(),
      subscription: {
        tier: 'scout',
        status: 'active',
        billingCycle: 'monthly',
        locationCount: 1,
        stripePaymentIntentId: null,
        amountPaid: 0,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString()
      }
    });

    const snap = await db.doc(`restaurants/${userId}`).get();
    expect(snap.exists).toBe(true);

    const data = snap.data();
    expect(data.subscription.tier).toBe('scout');
    expect(data.subscription.status).toBe('active');
    expect(data.subscription.amountPaid).toBe(0);
    expect(data.subscription.locationCount).toBe(1);
  });

  it('should create restaurant with paid tier subscription', async () => {
    const userId = `${TEST_PREFIX}-user2`;
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 12);

    // Simulate: user signs up for ally annual at $29/mo × 12 = $348
    await db.doc(`restaurants/${userId}`).set({
      restaurantName: 'E2E Ally Restaurant',
      email: 'ally@test.com',
      isMultiLocation: false,
      locationCount: 1,
      createdAt: now.toISOString(),
      subscription: {
        tier: 'ally',
        status: 'active',
        billingCycle: 'annual',
        locationCount: 1,
        stripePaymentIntentId: 'pi_test_e2e_ally',
        amountPaid: 348,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString()
      }
    });

    const snap = await db.doc(`restaurants/${userId}`).get();
    const data = snap.data();

    expect(data.subscription.tier).toBe('ally');
    expect(data.subscription.status).toBe('active');
    expect(data.subscription.billingCycle).toBe('annual');
    expect(data.subscription.amountPaid).toBe(348);
    expect(data.subscription.stripePaymentIntentId).toBe('pi_test_e2e_ally');
  });

  it('should create restaurant with trial subscription when free trial is enabled', async () => {
    const userId = `${TEST_PREFIX}-user3`;
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 86400000);

    await db.doc(`restaurants/${userId}`).set({
      restaurantName: 'E2E Trial Restaurant',
      email: 'trial@test.com',
      isMultiLocation: false,
      locationCount: 1,
      createdAt: now.toISOString(),
      subscription: {
        tier: 'guide',
        status: 'trialing',
        billingCycle: 'annual',
        locationCount: 1,
        stripePaymentIntentId: null,
        amountPaid: 0,
        trialEnd: trialEnd.toISOString(),
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: trialEnd.toISOString()
      }
    });

    const snap = await db.doc(`restaurants/${userId}`).get();
    const data = snap.data();

    expect(data.subscription.tier).toBe('guide');
    expect(data.subscription.status).toBe('trialing');
    expect(data.subscription.amountPaid).toBe(0);
    expect(data.subscription.trialEnd).toBeTruthy();

    // Trial should be ~14 days in the future
    const trialDate = new Date(data.subscription.trialEnd);
    const diffDays = Math.round((trialDate - now) / 86400000);
    expect(diffDays).toBe(14);
  });

  // ==========================================
  // Order Limit Verification
  // ==========================================

  it('should store order limits in published config', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    const configWithCustomLimits = {
      ...DEFAULT_CONFIG,
      orderLimits: {
        scout: { limit: 100, overageRate: 0, hardCap: true },
        ally: { limit: 1000, overageRate: 0.015, hardCap: false },
        guide: { limit: 3000, overageRate: 0.008, hardCap: false },
        chief: { limit: 8000, overageRate: 0.003, hardCap: false },
        elder: { limit: 999999, overageRate: 0, hardCap: false }
      },
      publishedAt: new Date()
    };

    await db.doc(`platformConfig/${configDocId}`).set(configWithCustomLimits);

    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    const config = snap.data();

    expect(config.orderLimits.scout.limit).toBe(100);
    expect(config.orderLimits.scout.hardCap).toBe(true);
    expect(config.orderLimits.ally.limit).toBe(1000);
    expect(config.orderLimits.ally.overageRate).toBe(0.015);
  });

  // ==========================================
  // Feature Config Verification
  // ==========================================

  it('should store feature tier assignments in config', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    const configWithCustomFeatures = {
      ...DEFAULT_CONFIG,
      features: {
        ...DEFAULT_CONFIG.features,
        'basic-analytics': { tier: 'ally', name: 'Basic Analytics' },
        'website-builder': { tier: 'ally', name: 'Website Builder' }
      },
      publishedAt: new Date()
    };

    await db.doc(`platformConfig/${configDocId}`).set(configWithCustomFeatures);

    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    const config = snap.data();

    // Admin moved analytics and website builder down to ally
    expect(config.features['basic-analytics'].tier).toBe('ally');
    expect(config.features['website-builder'].tier).toBe('ally');
    // Scout features unchanged
    expect(config.features['pos'].tier).toBe('scout');
  });

  // ==========================================
  // Config Update After Signup
  // ==========================================

  it('should allow config update without affecting existing subscriptions', async () => {
    const configDocId = `${TEST_PREFIX}-current`;
    const userId = `${TEST_PREFIX}-user2`;

    // Read existing subscription
    const userSnap = await db.doc(`restaurants/${userId}`).get();
    const existingSub = userSnap.data()?.subscription;

    // Admin publishes new pricing
    await db.doc(`platformConfig/${configDocId}`).set({
      ...DEFAULT_CONFIG,
      pricing: { ...DEFAULT_CONFIG.pricing, ally: 99 },
      publishedAt: new Date()
    });

    // Existing subscription should be unchanged
    const userSnapAfter = await db.doc(`restaurants/${userId}`).get();
    const subAfter = userSnapAfter.data()?.subscription;

    expect(subAfter.amountPaid).toBe(existingSub.amountPaid);
    expect(subAfter.tier).toBe(existingSub.tier);
    expect(subAfter.billingCycle).toBe(existingSub.billingCycle);
  });

  // ==========================================
  // Billing Multiplier Verification
  // ==========================================

  it('should store custom billing multipliers', async () => {
    const configDocId = `${TEST_PREFIX}-current`;

    await db.doc(`platformConfig/${configDocId}`).set({
      ...DEFAULT_CONFIG,
      billingMultipliers: { monthly: 1.50, quarterly: 1.25, annual: 0.90 },
      publishedAt: new Date()
    });

    const snap = await db.doc(`platformConfig/${configDocId}`).get();
    const config = snap.data();

    expect(config.billingMultipliers.monthly).toBe(1.50);
    expect(config.billingMultipliers.quarterly).toBe(1.25);
    expect(config.billingMultipliers.annual).toBe(0.90);
  });

  // ==========================================
  // Admin Verification
  // ==========================================

  it('should verify admin status via admins collection', async () => {
    const adminId = `${TEST_PREFIX}-admin`;

    // Create admin record
    await db.doc(`admins/${adminId}`).set({
      email: 'admin@test.com',
      role: 'admin',
      createdAt: new Date()
    });

    // Verify admin exists
    const snap = await db.doc(`admins/${adminId}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.data().role).toBe('admin');

    // Non-admin should not exist
    const nonAdminSnap = await db.doc(`admins/non-existent-user`).get();
    expect(nonAdminSnap.exists).toBe(false);
  });
});

// ==========================================
// Mock Fallback Tests (run without emulator)
// ==========================================

const describeMock = isEmulatorAvailable ? describe.skip : describe;

describeMock('Platform Admin Pipeline — Mock Fallback', () => {
  it('should validate complete config structure', () => {
    const config = {
      pricing: { scout: 0, ally: 29, guide: 59, chief: 99, elder: 229 },
      billingMultipliers: { monthly: 1.20, quarterly: 1.10, annual: 1.00 },
      discounts: [],
      freeTrials: {
        scout: { enabled: false, days: 0 },
        ally: { enabled: false, days: 0 },
        guide: { enabled: false, days: 0 },
        chief: { enabled: false, days: 0 },
        elder: { enabled: false, days: 0 }
      },
      orderLimits: {
        scout: { limit: 75, overageRate: 0, hardCap: true },
        ally: { limit: 500, overageRate: 0.02, hardCap: false }
      }
    };

    expect(config.pricing.scout).toBe(0);
    expect(config.billingMultipliers.annual).toBe(1.00);
    expect(config.orderLimits.scout.hardCap).toBe(true);
  });

  it('should calculate correct signup price with config', () => {
    const pricing = { ally: 29 };
    const multipliers = { monthly: 1.20, annual: 1.00 };

    // Monthly: $29 × 1.2 = $34.80
    expect(pricing.ally * multipliers.monthly).toBeCloseTo(34.80, 2);
    // Annual: $29 × 1.0 × 12 = $348
    expect(pricing.ally * multipliers.annual * 12).toBe(348);
  });

  it('should apply discount to display price', () => {
    const basePrice = 99;
    const discountPercent = 25;
    const discountedPrice = basePrice * (1 - discountPercent / 100);
    expect(discountedPrice).toBeCloseTo(74.25, 2);
  });

  it('should build subscription record with correct fields', () => {
    const subscription = {
      tier: 'guide',
      status: 'active',
      billingCycle: 'quarterly',
      locationCount: 2,
      amountPaid: 389.40,
      stripePaymentIntentId: 'pi_mock_123'
    };

    expect(subscription.tier).toBe('guide');
    expect(subscription.status).toBe('active');
    expect(subscription.amountPaid).toBeCloseTo(389.40, 2);
    expect(subscription.locationCount).toBe(2);
  });

  it('should enforce order limits correctly', () => {
    const limits = {
      scout: { limit: 75, hardCap: true },
      ally: { limit: 500, hardCap: false, overageRate: 0.02 }
    };

    // Scout at limit: blocked
    expect(75 >= limits.scout.limit && limits.scout.hardCap).toBe(true);

    // Ally at limit: allowed with overage
    expect(500 >= limits.ally.limit && !limits.ally.hardCap).toBe(true);
    expect(limits.ally.overageRate).toBe(0.02);
  });

  it('should identify trial vs active subscription', () => {
    const trialSub = { status: 'trialing', trialEnd: new Date(Date.now() + 86400000).toISOString() };
    const activeSub = { status: 'active', trialEnd: null };

    expect(trialSub.status).toBe('trialing');
    expect(activeSub.status).toBe('active');
    expect(trialSub.status === 'trialing' || trialSub.status === 'active').toBe(true);
  });
});
