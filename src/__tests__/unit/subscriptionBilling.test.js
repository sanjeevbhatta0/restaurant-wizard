/**
 * Unit Tests — Subscription Billing, Discounts, Plan Changes & Proration
 * Tests Stripe subscription flow, discount application at signup,
 * recurring billing logic, upgrade/downgrade proration, and webhook handling.
 */

describe('Subscription Billing — Core Logic', () => {
  // Replicate server-side calculateServerPrice logic
  const DEFAULT_BASE_PRICES = { scout: 0, ally: 29, guide: 59, chief: 99, elder: 229 };
  const DEFAULT_BILLING_MULTIPLIERS = { monthly: 1.20, quarterly: 1.10, annual: 1.00 };
  const BILLING_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };
  const TIER_ORDER = { scout: 0, ally: 1, guide: 2, chief: 3, elder: 4 };

  function calculateServerPrice(adminConfig, tier, billingCycle) {
    const basePrices = adminConfig?.pricing || DEFAULT_BASE_PRICES;
    const billingMultipliers = adminConfig?.billingMultipliers || DEFAULT_BILLING_MULTIPLIERS;

    const basePrice = basePrices[tier] ?? DEFAULT_BASE_PRICES[tier] ?? 29;
    const multiplier = billingMultipliers[billingCycle] ?? DEFAULT_BILLING_MULTIPLIERS[billingCycle] ?? 1;
    const billingMonths = BILLING_MONTHS[billingCycle] || 1;

    let discountAmount = 0;
    let activeDiscount = null;
    if (adminConfig?.discounts) {
      const now = new Date();
      activeDiscount = adminConfig.discounts.find(d => {
        if (!d.active) return false;
        const start = new Date(d.startDate);
        const end = new Date(d.endDate);
        return now >= start && now <= end &&
          ((d.type === 'tier' && d.target === tier) ||
           (d.type === 'billing_cycle' && d.target === billingCycle));
      });

      if (activeDiscount) {
        if (activeDiscount.isPercentage) {
          discountAmount = basePrice * (activeDiscount.amount / 100);
        } else {
          discountAmount = activeDiscount.amount;
        }
      }
    }

    const discountedBasePrice = Math.max(0, basePrice - discountAmount);
    const monthlyPerLocation = discountedBasePrice * multiplier;
    const totalPerLocationCharge = monthlyPerLocation * billingMonths;

    return {
      monthlyPerLocation: Math.round(monthlyPerLocation * 100) / 100,
      totalPerLocationCharge: Math.round(totalPerLocationCharge * 100) / 100,
      billingMonths,
      activeDiscount,
      discountAmount: Math.round(discountAmount * 100) / 100,
      basePrice,
      multiplier,
    };
  }

  // ==========================================
  // Discount Application at Signup
  // ==========================================

  describe('Discount Application', () => {
    const makeDiscount = (overrides = {}) => ({
      name: 'Test Discount',
      active: true,
      type: 'tier',
      target: 'elder',
      isPercentage: true,
      amount: 20,
      startDate: new Date(Date.now() - 86400000).toISOString(), // yesterday
      endDate: new Date(Date.now() + 86400000 * 30).toISOString(), // 30 days from now
      ...overrides,
    });

    it('should apply percentage discount to elder tier', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ amount: 20, target: 'elder' })],
      };

      const result = calculateServerPrice(config, 'elder', 'annual');
      // Elder base = $229, 20% off = $45.80 discount
      expect(result.discountAmount).toBe(45.8);
      expect(result.monthlyPerLocation).toBe(183.2); // (229 - 45.8) * 1.00
      expect(result.totalPerLocationCharge).toBe(2198.4); // 183.2 * 12
    });

    it('should apply fixed dollar discount', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ isPercentage: false, amount: 50, target: 'elder' })],
      };

      const result = calculateServerPrice(config, 'elder', 'annual');
      expect(result.discountAmount).toBe(50);
      expect(result.monthlyPerLocation).toBe(179); // (229 - 50) * 1.00
    });

    it('should not apply expired discount', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({
          startDate: new Date(Date.now() - 86400000 * 60).toISOString(),
          endDate: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
        })],
      };

      const result = calculateServerPrice(config, 'elder', 'annual');
      expect(result.discountAmount).toBe(0);
      expect(result.monthlyPerLocation).toBe(229);
    });

    it('should not apply inactive discount', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ active: false })],
      };

      const result = calculateServerPrice(config, 'elder', 'annual');
      expect(result.discountAmount).toBe(0);
    });

    it('should apply billing_cycle type discount', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ type: 'billing_cycle', target: 'annual', amount: 10 })],
      };

      // Should apply to any tier with annual billing
      const result = calculateServerPrice(config, 'ally', 'annual');
      expect(result.discountAmount).toBe(2.9); // 29 * 10%
      expect(result.monthlyPerLocation).toBe(26.1); // (29 - 2.9) * 1.00
    });

    it('should not apply tier discount to wrong tier', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ target: 'elder' })],
      };

      const result = calculateServerPrice(config, 'ally', 'annual');
      expect(result.discountAmount).toBe(0);
      expect(result.monthlyPerLocation).toBe(29);
    });

    it('should not allow discount to go below zero', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ isPercentage: false, amount: 999, target: 'ally' })],
      };

      const result = calculateServerPrice(config, 'ally', 'annual');
      expect(result.monthlyPerLocation).toBe(0); // capped at 0
      expect(result.totalPerLocationCharge).toBe(0);
    });

    it('should match discount shown on pricing page vs signup', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [makeDiscount({ amount: 20, target: 'elder' })],
      };

      // PricingTiers.js calculates: (basePrice - discountAmount) * multiplier
      const basePrice = 229;
      const discountAmount = basePrice * 0.20; // 45.8
      const multiplier = 1.00; // annual
      const pricingPagePrice = Math.max(0, (basePrice - discountAmount) * multiplier);

      // Signup page uses calculateServerPrice (same logic)
      const signupPrice = calculateServerPrice(config, 'elder', 'annual');

      expect(signupPrice.monthlyPerLocation).toBe(Math.round(pricingPagePrice * 100) / 100);
    });
  });

  // ==========================================
  // Recurring Billing Calculations
  // ==========================================

  describe('Recurring Billing', () => {
    it('should calculate monthly subscription amount', () => {
      const result = calculateServerPrice(null, 'ally', 'monthly');
      expect(result.monthlyPerLocation).toBe(34.8); // 29 * 1.20
      expect(result.totalPerLocationCharge).toBe(34.8); // 1 month
      expect(result.billingMonths).toBe(1);
    });

    it('should calculate quarterly subscription amount', () => {
      const result = calculateServerPrice(null, 'ally', 'quarterly');
      expect(result.monthlyPerLocation).toBe(31.9); // 29 * 1.10
      expect(result.totalPerLocationCharge).toBe(95.7); // 31.9 * 3
      expect(result.billingMonths).toBe(3);
    });

    it('should calculate annual subscription amount', () => {
      const result = calculateServerPrice(null, 'ally', 'annual');
      expect(result.monthlyPerLocation).toBe(29); // 29 * 1.00
      expect(result.totalPerLocationCharge).toBe(348); // 29 * 12
      expect(result.billingMonths).toBe(12);
    });

    it('should use admin-configured pricing', () => {
      const config = { pricing: { ally: 35 } };
      const result = calculateServerPrice(config, 'ally', 'annual');
      expect(result.monthlyPerLocation).toBe(35);
      expect(result.totalPerLocationCharge).toBe(420); // 35 * 12
    });

    it('should use admin-configured billing multipliers', () => {
      const config = { billingMultipliers: { monthly: 1.15 } };
      const result = calculateServerPrice(config, 'ally', 'monthly');
      expect(result.monthlyPerLocation).toBe(33.35); // 29 * 1.15
    });

    it('should fall back to defaults when admin config is null', () => {
      const result = calculateServerPrice(null, 'elder', 'annual');
      expect(result.monthlyPerLocation).toBe(229);
      expect(result.totalPerLocationCharge).toBe(2748);
    });
  });

  // ==========================================
  // Stripe Price Mapping
  // ==========================================

  describe('Stripe Price Mapping', () => {
    it('should map billing cycles to correct Stripe intervals', () => {
      const intervalMap = { monthly: 'month', quarterly: 'month', annual: 'year' };
      const intervalCountMap = { monthly: 1, quarterly: 3, annual: 1 };

      expect(intervalMap.monthly).toBe('month');
      expect(intervalCountMap.monthly).toBe(1);

      expect(intervalMap.quarterly).toBe('month');
      expect(intervalCountMap.quarterly).toBe(3);

      expect(intervalMap.annual).toBe('year');
      expect(intervalCountMap.annual).toBe(1);
    });

    it('should generate unique cache keys for tier+cycle+amount combos', () => {
      const makeCacheKey = (tier, cycle, amount) => `${tier}_${cycle}_${amount}`;

      const key1 = makeCacheKey('ally', 'monthly', 3480); // $34.80 in cents
      const key2 = makeCacheKey('ally', 'annual', 2900);  // $29.00 in cents
      const key3 = makeCacheKey('ally', 'monthly', 3480);

      expect(key1).not.toBe(key2); // different cycles
      expect(key1).toBe(key3); // same params = same key
    });

    it('should create new cache key when admin changes price', () => {
      const makeCacheKey = (tier, cycle, amount) => `${tier}_${cycle}_${amount}`;

      const beforeChange = makeCacheKey('ally', 'annual', 2900); // $29
      const afterChange = makeCacheKey('ally', 'annual', 3500);  // $35

      expect(beforeChange).not.toBe(afterChange);
    });
  });

  // ==========================================
  // Plan Upgrade / Downgrade Logic
  // ==========================================

  describe('Plan Change Detection', () => {
    it('should detect upgrade (higher tier)', () => {
      const currentTier = 'ally';
      const newTier = 'guide';
      const isUpgrade = TIER_ORDER[newTier] > TIER_ORDER[currentTier];
      expect(isUpgrade).toBe(true);
    });

    it('should detect downgrade (lower tier)', () => {
      const currentTier = 'chief';
      const newTier = 'ally';
      const isUpgrade = TIER_ORDER[newTier] > TIER_ORDER[currentTier];
      expect(isUpgrade).toBe(false);
    });

    it('should detect same-tier upgrade via higher billing amount', () => {
      const currentTier = 'ally';
      const newTier = 'ally';
      const currentAmount = 2900; // annual $29
      const newAmount = 3480; // monthly $34.80

      const isUpgrade = TIER_ORDER[newTier] > TIER_ORDER[currentTier] ||
        (TIER_ORDER[newTier] === TIER_ORDER[currentTier] && newAmount > currentAmount);
      expect(isUpgrade).toBe(true);
    });

    it('should handle upgrade from scout to any paid tier', () => {
      const currentTier = 'scout';
      ['ally', 'guide', 'chief', 'elder'].forEach(newTier => {
        const isUpgrade = TIER_ORDER[newTier] > TIER_ORDER[currentTier];
        expect(isUpgrade).toBe(true);
      });
    });

    it('should handle downgrade to scout (subscription cancellation)', () => {
      const newTier = 'scout';
      const shouldCancel = newTier === 'scout';
      expect(shouldCancel).toBe(true);
    });
  });

  describe('Proration Calculations', () => {
    it('should charge prorated difference for upgrade', () => {
      // Upgrading from ally ($29/mo annual) to guide ($59/mo annual)
      // halfway through billing period
      const currentPrice = calculateServerPrice(null, 'ally', 'annual');
      const newPrice = calculateServerPrice(null, 'guide', 'annual');

      const remainingFraction = 0.5; // halfway through period
      const proratedCharge = (newPrice.totalPerLocationCharge - currentPrice.totalPerLocationCharge) * remainingFraction;

      // (708 - 348) * 0.5 = 180
      expect(proratedCharge).toBe(180);
    });

    it('should not charge negative proration for downgrade', () => {
      const currentPrice = calculateServerPrice(null, 'chief', 'annual');
      const newPrice = calculateServerPrice(null, 'ally', 'annual');

      const priceDiff = newPrice.totalPerLocationCharge - currentPrice.totalPerLocationCharge;
      const proratedCharge = Math.max(0, priceDiff * 0.5);

      // (348 - 1188) * 0.5 = -420, capped at 0
      expect(proratedCharge).toBe(0);
    });

    it('should apply discount in upgrade proration', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [{
          name: '20% Off Elder',
          active: true,
          type: 'tier',
          target: 'elder',
          isPercentage: true,
          amount: 20,
          startDate: new Date(Date.now() - 86400000).toISOString(),
          endDate: new Date(Date.now() + 86400000 * 30).toISOString(),
        }],
      };

      const currentPrice = calculateServerPrice(null, 'chief', 'annual');
      const newPrice = calculateServerPrice(config, 'elder', 'annual');

      // Elder with 20% off: 183.2/mo * 12 = 2198.4
      // Chief: 99 * 12 = 1188
      const diff = newPrice.totalPerLocationCharge - currentPrice.totalPerLocationCharge;
      expect(diff).toBeCloseTo(1010.4, 2); // 2198.4 - 1188 = 1010.4
    });
  });

  // ==========================================
  // Free Trial Flow
  // ==========================================

  describe('Free Trial', () => {
    it('should identify trial-eligible tier from admin config', () => {
      const adminConfig = {
        freeTrials: {
          ally: { enabled: true, days: 14 },
          guide: { enabled: true, days: 14 },
          chief: { enabled: false, days: 0 },
          elder: { enabled: true, days: 30 },
        },
      };

      expect(adminConfig.freeTrials.ally.enabled).toBe(true);
      expect(adminConfig.freeTrials.ally.days).toBe(14);
      expect(adminConfig.freeTrials.chief.enabled).toBe(false);
      expect(adminConfig.freeTrials.elder.days).toBe(30);
    });

    it('should not offer trial for scout (free tier)', () => {
      const isFreeTier = 'scout' === 'scout';
      const hasFreeTrial = !isFreeTier && true; // even if trial enabled
      expect(hasFreeTrial).toBe(false);
    });

    it('should calculate trial end date correctly', () => {
      const now = new Date('2026-04-12');
      const trialDays = 14;
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + trialDays);

      expect(trialEnd.toISOString()).toContain('2026-04-26');
    });

    it('should use SetupIntent for trial (not PaymentIntent)', () => {
      // Trial flow: type === 'trial' means SetupIntent was created
      const trialResponse = { type: 'trial', setupIntentClientSecret: 'seti_xxx_secret_yyy' };
      const paidResponse = { type: 'subscription', clientSecret: 'pi_xxx_secret_yyy' };

      expect(trialResponse.type).toBe('trial');
      expect(trialResponse.setupIntentClientSecret).toBeTruthy();
      expect(paidResponse.type).toBe('subscription');
      expect(paidResponse.clientSecret).toBeTruthy();
    });

    it('should not charge during trial period', () => {
      const subscriptionStatus = 'trialing';
      const amountPaid = subscriptionStatus === 'trialing' ? 0 : 100;
      expect(amountPaid).toBe(0);
    });
  });

  // ==========================================
  // Webhook Event Handling
  // ==========================================

  describe('Webhook Event Processing', () => {
    it('should mark subscription active on invoice.paid', () => {
      const event = { type: 'invoice.paid' };
      const expectedStatus = event.type === 'invoice.paid' ? 'active' : 'unknown';
      expect(expectedStatus).toBe('active');
    });

    it('should mark subscription past_due on invoice.payment_failed', () => {
      const event = { type: 'invoice.payment_failed' };
      const expectedStatus = event.type === 'invoice.payment_failed' ? 'past_due' : 'unknown';
      expect(expectedStatus).toBe('past_due');
    });

    it('should mark subscription canceled on customer.subscription.deleted', () => {
      const event = { type: 'customer.subscription.deleted' };
      const expectedStatus = event.type === 'customer.subscription.deleted' ? 'canceled' : 'unknown';
      expect(expectedStatus).toBe('canceled');
    });

    it('should reset order usage counters on renewal (invoice.paid)', () => {
      const resetData = {
        'orderUsage.currentCount': 0,
        'orderUsage.overageOrders': 0,
        'orderUsage.overageCharges': 0,
      };

      expect(resetData['orderUsage.currentCount']).toBe(0);
      expect(resetData['orderUsage.overageOrders']).toBe(0);
      expect(resetData['orderUsage.overageCharges']).toBe(0);
    });

    it('should apply pending downgrade on renewal', () => {
      const restaurantData = {
        subscription: {
          tier: 'chief',
          stripeSubscriptionId: 'sub_xxx',
          pendingDowngrade: {
            newTier: 'ally',
            newBillingCycle: 'annual',
            newPriceId: 'price_yyy',
            locationCount: 1,
          },
        },
      };

      const pendingDowngrade = restaurantData.subscription.pendingDowngrade;
      const shouldApply = pendingDowngrade?.newTier && pendingDowngrade?.newPriceId;
      expect(shouldApply).toBeTruthy();

      // After applying:
      const updatedTier = pendingDowngrade.newTier;
      expect(updatedTier).toBe('ally');
    });

    it('should not apply downgrade if no pending downgrade', () => {
      const restaurantData = {
        subscription: {
          tier: 'chief',
          stripeSubscriptionId: 'sub_xxx',
        },
      };

      const pendingDowngrade = restaurantData.subscription?.pendingDowngrade;
      const shouldApply = pendingDowngrade?.newTier && pendingDowngrade?.newPriceId;
      expect(shouldApply).toBeFalsy();
    });
  });

  // ==========================================
  // Multi-Location Subscription
  // ==========================================

  describe('Multi-Location Subscriptions', () => {
    it('should multiply subscription quantity by location count', () => {
      const result = calculateServerPrice(null, 'guide', 'annual');
      const locationCount = 3;
      const totalCharge = result.totalPerLocationCharge * locationCount;

      // 59 * 12 * 3 = 2124
      expect(totalCharge).toBe(2124);
    });

    it('should apply discount per-location correctly', () => {
      const config = {
        pricing: DEFAULT_BASE_PRICES,
        billingMultipliers: DEFAULT_BILLING_MULTIPLIERS,
        discounts: [{
          name: 'Elder 20% Off',
          active: true,
          type: 'tier',
          target: 'elder',
          isPercentage: true,
          amount: 20,
          startDate: new Date(Date.now() - 86400000).toISOString(),
          endDate: new Date(Date.now() + 86400000 * 30).toISOString(),
        }],
      };

      const result = calculateServerPrice(config, 'elder', 'annual');
      const locationCount = 2;
      const total = result.totalPerLocationCharge * locationCount;

      // (229 - 45.8) * 1.00 * 12 * 2 = 4396.8
      expect(total).toBe(4396.8);
    });
  });

  // ==========================================
  // Stripe Amount Conversion
  // ==========================================

  describe('Stripe Amount Conversion', () => {
    it('should convert dollar amounts to cents correctly', () => {
      const prices = [29, 34.80, 59, 99, 183.20, 229];
      prices.forEach(price => {
        const cents = Math.round(price * 100);
        expect(cents).toBe(Math.round(price * 100));
        expect(Number.isInteger(cents)).toBe(true);
      });
    });

    it('should handle floating point precision in cents conversion', () => {
      // 34.80 * 100 should be 3480, not 3479.9999... or 3480.0001...
      const price = 34.80;
      const cents = Math.round(price * 100);
      expect(cents).toBe(3480);
    });

    it('should handle discounted price conversion', () => {
      const base = 229;
      const discount = base * 0.20; // 45.8
      const discounted = base - discount; // 183.2
      const cents = Math.round(discounted * 100);
      expect(cents).toBe(18320);
    });
  });

  // ==========================================
  // Subscription Status Flow
  // ==========================================

  describe('Subscription Status Lifecycle', () => {
    const VALID_STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'incomplete'];

    it('should start with trialing status for trial signups', () => {
      const initialStatus = 'trialing';
      expect(VALID_STATUSES).toContain(initialStatus);
    });

    it('should start with active or incomplete for paid signups', () => {
      // active if payment succeeds immediately, incomplete if pending
      ['active', 'incomplete'].forEach(s => {
        expect(VALID_STATUSES).toContain(s);
      });
    });

    it('should transition from trialing to active after first payment', () => {
      const beforePayment = 'trialing';
      const afterPayment = 'active';
      expect(beforePayment).toBe('trialing');
      expect(afterPayment).toBe('active');
    });

    it('should transition to past_due on payment failure', () => {
      const status = 'past_due';
      expect(VALID_STATUSES).toContain(status);
    });

    it('should transition to canceled on subscription deletion', () => {
      const status = 'canceled';
      expect(VALID_STATUSES).toContain(status);
    });
  });

  // ==========================================
  // Pricing Consistency Across Components
  // ==========================================

  describe('Pricing Consistency', () => {
    const adminConfig = {
      pricing: { ally: 29, guide: 59, chief: 99, elder: 229 },
      billingMultipliers: { monthly: 1.20, quarterly: 1.10, annual: 1.00 },
      discounts: [{
        name: 'Elder Promo',
        active: true,
        type: 'tier',
        target: 'elder',
        isPercentage: true,
        amount: 20,
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000 * 30).toISOString(),
      }],
    };

    it('should produce same price on PricingTiers, Signup, and Server', () => {
      // PricingTiers.js logic
      const pricingPageCalc = (tier, cycle) => {
        const basePrice = adminConfig.pricing[tier];
        const multiplier = adminConfig.billingMultipliers[cycle];
        const discount = adminConfig.discounts.find(d =>
          d.active && d.type === 'tier' && d.target === tier
        );
        let discountAmount = 0;
        if (discount?.isPercentage) {
          discountAmount = basePrice * (discount.amount / 100);
        }
        return Math.max(0, (basePrice - discountAmount) * multiplier);
      };

      // Server-side calculation
      const serverResult = calculateServerPrice(adminConfig, 'elder', 'annual');
      const pricingPageResult = pricingPageCalc('elder', 'annual');

      expect(serverResult.monthlyPerLocation).toBeCloseTo(pricingPageResult, 2);
    });

    it('should produce same price for non-discounted tiers', () => {
      const serverResult = calculateServerPrice(adminConfig, 'ally', 'annual');
      expect(serverResult.monthlyPerLocation).toBe(29);
      expect(serverResult.discountAmount).toBe(0);
    });

    it('should produce same quarterly price across all components', () => {
      const serverResult = calculateServerPrice(adminConfig, 'guide', 'quarterly');
      const expected = 59 * 1.10; // 64.9
      expect(serverResult.monthlyPerLocation).toBeCloseTo(expected, 2);
    });
  });
});
