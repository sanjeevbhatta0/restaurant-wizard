/**
 * Unit Tests — Platform Admin Configuration Management
 *
 * Tests pricing calculation, billing multipliers, discounts, free trials,
 * order limits, feature gating, config defaults/fallbacks, and the
 * draft/publish lifecycle logic.
 *
 * Source: src/services/adminConfigService.js, src/services/stripeService.js,
 *         src/contexts/SubscriptionContext.js, src/components/landing/PricingTiers.js
 */

describe('Platform Admin Configuration', () => {

  // ==========================================
  // Default Config Structure
  // ==========================================

  const DEFAULT_CONFIG = {
    pricing: {
      scout: 0,
      ally: 29,
      guide: 59,
      chief: 99,
      elder: 229
    },
    billingMultipliers: {
      monthly: 1.20,
      quarterly: 1.10,
      annual: 1.00
    },
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
      elder: { limit: Infinity, overageRate: 0, hardCap: false }
    },
    features: {
      'menu-management': { tier: 'scout', name: 'Menu Management', description: 'Create and manage your menu' },
      'pos': { tier: 'scout', name: 'Point of Sale (POS)', description: 'Tablet-friendly order taking' },
      'kitchen': { tier: 'scout', name: 'Kitchen Display', description: 'Real-time order display' },
      'server': { tier: 'scout', name: 'Server View', description: 'Table management' },
      'orders': { tier: 'scout', name: 'Order Management', description: 'Track orders from creation to completion' },
      'payments': { tier: 'scout', name: 'Payment Processing', description: 'Integrated Stripe payments' },
      'ai-menu-upload': { tier: 'ally', name: 'AI Menu Upload', description: 'Upload menus with AI parsing' },
      'basic-analytics': { tier: 'guide', name: 'Basic Analytics', description: 'Sales reports and order insights' },
      'website-builder': { tier: 'guide', name: 'Website Builder', description: 'Create a beautiful website' },
      'website-integration': { tier: 'guide', name: 'Website Integration', description: 'Embed your menu on any website' },
      'seo-social': { tier: 'chief', name: 'SEO & Social', description: 'Post to Facebook & Instagram' },
      'ai-analytics': { tier: 'elder', name: 'AI-Powered Analytics', description: 'AI insights, predictions, and recommendations' },
      'ai-content': { tier: 'elder', name: 'AI Content Generation', description: 'AI-generated social media content' }
    },
    tierInfo: {
      scout: { name: 'Scout', tagline: 'Start for free', icon: '🔍', color: '#6b7280' },
      ally: { name: 'Ally', tagline: 'Start your journey', icon: '🌱', color: '#4ade80' },
      guide: { name: 'Guide', tagline: 'Lead the way', icon: '🧭', color: '#60a5fa' },
      chief: { name: 'Chief', tagline: 'Command respect', icon: '🦅', color: '#f59e0b', popular: true },
      elder: { name: 'Elder', tagline: 'Achieve wisdom', icon: '👑', color: '#a855f7' }
    }
  };

  // ==========================================
  // Pricing Calculation Logic
  // ==========================================

  describe('Pricing Calculation', () => {
    /**
     * Mirrors the calculatePrice logic from PricingTiers.js.
     * Formula: (basePrice - discountAmount) × multiplier
     */
    function calculatePrice(config, tier, billingCycle) {
      const basePrice = config.pricing[tier] || 0;
      const multiplier = config.billingMultipliers[billingCycle] || 1;
      const discount = getActiveDiscount(config, tier, billingCycle);

      let discountAmount = 0;
      if (discount) {
        if (discount.isPercentage) {
          discountAmount = basePrice * (discount.amount / 100);
        } else {
          discountAmount = discount.amount;
        }
      }

      return Math.max(0, (basePrice - discountAmount) * multiplier);
    }

    function getActiveDiscount(config, tier, billingCycle) {
      if (!config.discounts) return null;
      const now = new Date();
      return config.discounts.find(d => {
        if (!d.active) return false;
        const start = new Date(d.startDate);
        const end = new Date(d.endDate);
        return now >= start && now <= end &&
          ((d.type === 'tier' && d.target === tier) ||
           (d.type === 'billing_cycle' && d.target === billingCycle));
      });
    }

    it('should calculate annual pricing correctly (multiplier = 1.0)', () => {
      const price = calculatePrice(DEFAULT_CONFIG, 'ally', 'annual');
      expect(price).toBe(29);
    });

    it('should calculate monthly pricing with 1.2x multiplier', () => {
      const price = calculatePrice(DEFAULT_CONFIG, 'ally', 'monthly');
      expect(price).toBeCloseTo(34.80, 2);
    });

    it('should calculate quarterly pricing with 1.1x multiplier', () => {
      const price = calculatePrice(DEFAULT_CONFIG, 'guide', 'quarterly');
      expect(price).toBeCloseTo(64.90, 2);
    });

    it('should return 0 for scout tier regardless of billing cycle', () => {
      expect(calculatePrice(DEFAULT_CONFIG, 'scout', 'monthly')).toBe(0);
      expect(calculatePrice(DEFAULT_CONFIG, 'scout', 'quarterly')).toBe(0);
      expect(calculatePrice(DEFAULT_CONFIG, 'scout', 'annual')).toBe(0);
    });

    it('should calculate elder tier pricing correctly', () => {
      const monthly = calculatePrice(DEFAULT_CONFIG, 'elder', 'monthly');
      expect(monthly).toBeCloseTo(274.80, 2);

      const annual = calculatePrice(DEFAULT_CONFIG, 'elder', 'annual');
      expect(annual).toBe(229);
    });

    it('should calculate chief tier pricing correctly', () => {
      const monthly = calculatePrice(DEFAULT_CONFIG, 'chief', 'monthly');
      expect(monthly).toBeCloseTo(118.80, 2);
    });

    it('should handle custom pricing values from admin', () => {
      const customConfig = {
        ...DEFAULT_CONFIG,
        pricing: { ...DEFAULT_CONFIG.pricing, ally: 39 }
      };
      const price = calculatePrice(customConfig, 'ally', 'annual');
      expect(price).toBe(39);
    });

    it('should handle custom billing multipliers from admin', () => {
      const customConfig = {
        ...DEFAULT_CONFIG,
        billingMultipliers: { ...DEFAULT_CONFIG.billingMultipliers, monthly: 1.50 }
      };
      const price = calculatePrice(customConfig, 'ally', 'monthly');
      expect(price).toBeCloseTo(43.50, 2);
    });

    it('should return 0 for unknown tier', () => {
      const price = calculatePrice(DEFAULT_CONFIG, 'nonexistent', 'annual');
      expect(price).toBe(0);
    });

    it('should use multiplier 1.0 for unknown billing cycle', () => {
      const price = calculatePrice(DEFAULT_CONFIG, 'ally', 'unknown');
      expect(price).toBe(29);
    });

    it('should never return negative price', () => {
      const configWithBigDiscount = {
        ...DEFAULT_CONFIG,
        discounts: [{
          id: '1', type: 'tier', target: 'ally', amount: 50,
          isPercentage: false, active: true,
          startDate: new Date(Date.now() - 86400000).toISOString(),
          endDate: new Date(Date.now() + 86400000).toISOString()
        }]
      };
      const price = calculatePrice(configWithBigDiscount, 'ally', 'annual');
      expect(price).toBe(0);
    });
  });

  // ==========================================
  // Stripe Tier Price Calculation
  // ==========================================

  describe('Stripe Tier Price Calculation', () => {
    /**
     * Mirrors calculateTierPrice from stripeService.js.
     * Used during signup to calculate total charge.
     */
    function calculateTierPrice(tier, billingCycle, locationCount) {
      const BASE_PRICES = { ally: 29, guide: 59, chief: 99, elder: 229 };
      const BILLING_MULTIPLIERS = { monthly: 1.20, quarterly: 1.10, annual: 1.00 };
      const BILLING_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

      const basePrice = BASE_PRICES[tier] || 29;
      const multiplier = BILLING_MULTIPLIERS[billingCycle] || 1;
      const billingMonths = BILLING_MONTHS[billingCycle] || 1;

      const monthlyPerLocation = basePrice * multiplier;
      const totalMonthly = monthlyPerLocation * locationCount;
      const totalCharge = totalMonthly * billingMonths;

      return {
        monthlyPerLocation: Math.round(monthlyPerLocation * 100) / 100,
        totalMonthly: Math.round(totalMonthly * 100) / 100,
        billingMonths,
        totalCharge: Math.round(totalCharge * 100) / 100
      };
    }

    it('should calculate single location annual ally correctly', () => {
      const result = calculateTierPrice('ally', 'annual', 1);
      expect(result.monthlyPerLocation).toBe(29);
      expect(result.totalMonthly).toBe(29);
      expect(result.billingMonths).toBe(12);
      expect(result.totalCharge).toBe(348);
    });

    it('should calculate single location monthly ally correctly', () => {
      const result = calculateTierPrice('ally', 'monthly', 1);
      expect(result.monthlyPerLocation).toBe(34.80);
      expect(result.totalMonthly).toBe(34.80);
      expect(result.billingMonths).toBe(1);
      expect(result.totalCharge).toBe(34.80);
    });

    it('should calculate multi-location pricing correctly', () => {
      const result = calculateTierPrice('ally', 'quarterly', 2);
      expect(result.monthlyPerLocation).toBe(31.90);
      expect(result.totalMonthly).toBe(63.80);
      expect(result.billingMonths).toBe(3);
      expect(result.totalCharge).toBe(191.40);
    });

    it('should calculate elder tier multi-location annual', () => {
      const result = calculateTierPrice('elder', 'annual', 3);
      expect(result.monthlyPerLocation).toBe(229);
      expect(result.totalMonthly).toBe(687);
      expect(result.totalCharge).toBe(8244);
    });

    it('should handle single location for all tiers', () => {
      const tiers = ['ally', 'guide', 'chief', 'elder'];
      const expectedMonthly = [29, 59, 99, 229];

      tiers.forEach((tier, i) => {
        const result = calculateTierPrice(tier, 'annual', 1);
        expect(result.monthlyPerLocation).toBe(expectedMonthly[i]);
      });
    });

    it('should scale linearly with location count', () => {
      const single = calculateTierPrice('guide', 'annual', 1);
      const double = calculateTierPrice('guide', 'annual', 2);
      const triple = calculateTierPrice('guide', 'annual', 3);

      expect(double.totalMonthly).toBe(single.totalMonthly * 2);
      expect(triple.totalMonthly).toBe(single.totalMonthly * 3);
      expect(double.totalCharge).toBe(single.totalCharge * 2);
    });

    it('should default to ally pricing for unknown tier', () => {
      const result = calculateTierPrice('nonexistent', 'annual', 1);
      expect(result.monthlyPerLocation).toBe(29);
    });
  });

  // ==========================================
  // Discount Logic
  // ==========================================

  describe('Discount Application', () => {
    function getActiveDiscount(config, tier, billingCycle) {
      if (!config.discounts) return null;
      const now = new Date();
      return config.discounts.find(d => {
        if (!d.active) return false;
        const start = new Date(d.startDate);
        const end = new Date(d.endDate);
        return now >= start && now <= end &&
          ((d.type === 'tier' && d.target === tier) ||
           (d.type === 'billing_cycle' && d.target === billingCycle));
      }) || null;
    }

    function applyDiscount(basePrice, discount) {
      if (!discount) return 0;
      if (discount.isPercentage) {
        return basePrice * (discount.amount / 100);
      }
      return discount.amount;
    }

    const now = Date.now();
    const activeDiscount = {
      id: '1', type: 'tier', target: 'ally', amount: 10,
      isPercentage: true, active: true,
      startDate: new Date(now - 86400000).toISOString(),
      endDate: new Date(now + 86400000).toISOString()
    };

    it('should find active percentage discount for matching tier', () => {
      const config = { ...DEFAULT_CONFIG, discounts: [activeDiscount] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).not.toBeNull();
      expect(discount.amount).toBe(10);
      expect(discount.isPercentage).toBe(true);
    });

    it('should not find discount for non-matching tier', () => {
      const config = { ...DEFAULT_CONFIG, discounts: [activeDiscount] };
      const discount = getActiveDiscount(config, 'guide', 'annual');
      expect(discount).toBeNull();
    });

    it('should apply percentage discount correctly', () => {
      const discountAmount = applyDiscount(29, { amount: 10, isPercentage: true });
      expect(discountAmount).toBeCloseTo(2.90, 2);
    });

    it('should apply fixed dollar discount correctly', () => {
      const discountAmount = applyDiscount(29, { amount: 5, isPercentage: false });
      expect(discountAmount).toBe(5);
    });

    it('should return 0 discount when no discount is active', () => {
      const discountAmount = applyDiscount(29, null);
      expect(discountAmount).toBe(0);
    });

    it('should ignore inactive discounts', () => {
      const inactiveDiscount = { ...activeDiscount, active: false };
      const config = { ...DEFAULT_CONFIG, discounts: [inactiveDiscount] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).toBeNull();
    });

    it('should ignore expired discounts', () => {
      const expiredDiscount = {
        ...activeDiscount,
        startDate: new Date(now - 172800000).toISOString(),
        endDate: new Date(now - 86400000).toISOString()
      };
      const config = { ...DEFAULT_CONFIG, discounts: [expiredDiscount] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).toBeNull();
    });

    it('should ignore future discounts', () => {
      const futureDiscount = {
        ...activeDiscount,
        startDate: new Date(now + 86400000).toISOString(),
        endDate: new Date(now + 172800000).toISOString()
      };
      const config = { ...DEFAULT_CONFIG, discounts: [futureDiscount] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).toBeNull();
    });

    it('should find billing_cycle type discount', () => {
      const billingDiscount = {
        id: '2', type: 'billing_cycle', target: 'monthly', amount: 15,
        isPercentage: true, active: true,
        startDate: new Date(now - 86400000).toISOString(),
        endDate: new Date(now + 86400000).toISOString()
      };
      const config = { ...DEFAULT_CONFIG, discounts: [billingDiscount] };
      const discount = getActiveDiscount(config, 'ally', 'monthly');
      expect(discount).not.toBeNull();
      expect(discount.target).toBe('monthly');
    });

    it('should not match billing_cycle discount to wrong cycle', () => {
      const billingDiscount = {
        id: '2', type: 'billing_cycle', target: 'monthly', amount: 15,
        isPercentage: true, active: true,
        startDate: new Date(now - 86400000).toISOString(),
        endDate: new Date(now + 86400000).toISOString()
      };
      const config = { ...DEFAULT_CONFIG, discounts: [billingDiscount] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).toBeNull();
    });

    it('should handle 100% discount (free)', () => {
      const discountAmount = applyDiscount(99, { amount: 100, isPercentage: true });
      expect(discountAmount).toBe(99);
    });

    it('should handle discount larger than base price', () => {
      const discountAmount = applyDiscount(29, { amount: 50, isPercentage: false });
      expect(discountAmount).toBe(50);
    });

    it('should return first matching discount when multiple exist', () => {
      const discount1 = {
        ...activeDiscount, id: '1', amount: 10
      };
      const discount2 = {
        ...activeDiscount, id: '2', amount: 20
      };
      const config = { ...DEFAULT_CONFIG, discounts: [discount1, discount2] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount.id).toBe('1');
      expect(discount.amount).toBe(10);
    });

    it('should handle config with no discounts array', () => {
      const config = { ...DEFAULT_CONFIG, discounts: undefined };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).toBeNull();
    });

    it('should handle empty discounts array', () => {
      const config = { ...DEFAULT_CONFIG, discounts: [] };
      const discount = getActiveDiscount(config, 'ally', 'annual');
      expect(discount).toBeNull();
    });
  });

  // ==========================================
  // Free Trial Configuration
  // ==========================================

  describe('Free Trial Configuration', () => {
    function getMaxTrialDays(config) {
      if (!config.freeTrials) return 0;
      return Math.max(...Object.values(config.freeTrials)
        .map(t => t.enabled ? t.days : 0));
    }

    function getTierTrialDays(config, tier) {
      if (!config.freeTrials || !config.freeTrials[tier]) return 0;
      return config.freeTrials[tier].enabled ? config.freeTrials[tier].days : 0;
    }

    function isTrialAvailable(config, tier) {
      if (tier === 'scout') return false;
      return config.freeTrials?.[tier]?.enabled === true && config.freeTrials[tier].days > 0;
    }

    it('should return 0 max trial days when no trials enabled', () => {
      expect(getMaxTrialDays(DEFAULT_CONFIG)).toBe(0);
    });

    it('should return max trial days across all tiers', () => {
      const config = {
        ...DEFAULT_CONFIG,
        freeTrials: {
          scout: { enabled: false, days: 0 },
          ally: { enabled: true, days: 14 },
          guide: { enabled: true, days: 7 },
          chief: { enabled: false, days: 0 },
          elder: { enabled: true, days: 30 }
        }
      };
      expect(getMaxTrialDays(config)).toBe(30);
    });

    it('should return tier-specific trial days', () => {
      const config = {
        ...DEFAULT_CONFIG,
        freeTrials: {
          ...DEFAULT_CONFIG.freeTrials,
          ally: { enabled: true, days: 14 },
          guide: { enabled: true, days: 7 }
        }
      };
      expect(getTierTrialDays(config, 'ally')).toBe(14);
      expect(getTierTrialDays(config, 'guide')).toBe(7);
      expect(getTierTrialDays(config, 'chief')).toBe(0);
    });

    it('should return 0 for disabled trial', () => {
      const config = {
        ...DEFAULT_CONFIG,
        freeTrials: {
          ...DEFAULT_CONFIG.freeTrials,
          ally: { enabled: false, days: 14 }
        }
      };
      expect(getTierTrialDays(config, 'ally')).toBe(0);
    });

    it('should never allow free trial for scout tier', () => {
      const config = {
        ...DEFAULT_CONFIG,
        freeTrials: {
          ...DEFAULT_CONFIG.freeTrials,
          scout: { enabled: true, days: 30 }
        }
      };
      expect(isTrialAvailable(config, 'scout')).toBe(false);
    });

    it('should allow free trial for paid tiers when enabled', () => {
      const config = {
        ...DEFAULT_CONFIG,
        freeTrials: {
          ...DEFAULT_CONFIG.freeTrials,
          ally: { enabled: true, days: 14 }
        }
      };
      expect(isTrialAvailable(config, 'ally')).toBe(true);
    });

    it('should not allow trial when days is 0', () => {
      const config = {
        ...DEFAULT_CONFIG,
        freeTrials: {
          ...DEFAULT_CONFIG.freeTrials,
          ally: { enabled: true, days: 0 }
        }
      };
      expect(isTrialAvailable(config, 'ally')).toBe(false);
    });

    it('should handle missing freeTrials config', () => {
      const config = { ...DEFAULT_CONFIG, freeTrials: undefined };
      expect(getMaxTrialDays(config)).toBe(0);
      expect(getTierTrialDays(config, 'ally')).toBe(0);
    });

    it('should handle missing tier in freeTrials', () => {
      expect(getTierTrialDays(DEFAULT_CONFIG, 'nonexistent')).toBe(0);
    });
  });

  // ==========================================
  // Order Limits
  // ==========================================

  describe('Order Limit Enforcement', () => {
    function getOrderLimit(config, tier) {
      return config.orderLimits[tier] || config.orderLimits.ally;
    }

    function isOverLimit(config, tier, currentCount) {
      const { limit } = getOrderLimit(config, tier);
      return currentCount > limit;
    }

    function isHardCapped(config, tier) {
      return getOrderLimit(config, tier).hardCap === true;
    }

    function canPlaceOrder(config, tier, currentCount) {
      const limitInfo = getOrderLimit(config, tier);
      if (currentCount >= limitInfo.limit) {
        return !limitInfo.hardCap;
      }
      return true;
    }

    function calculateOverageCharge(config, tier, orderTotal) {
      const { overageRate } = getOrderLimit(config, tier);
      return orderTotal * overageRate;
    }

    it('should return correct limits for each tier', () => {
      expect(getOrderLimit(DEFAULT_CONFIG, 'scout').limit).toBe(75);
      expect(getOrderLimit(DEFAULT_CONFIG, 'ally').limit).toBe(500);
      expect(getOrderLimit(DEFAULT_CONFIG, 'guide').limit).toBe(2000);
      expect(getOrderLimit(DEFAULT_CONFIG, 'chief').limit).toBe(5000);
      expect(getOrderLimit(DEFAULT_CONFIG, 'elder').limit).toBe(Infinity);
    });

    it('should detect when over order limit', () => {
      expect(isOverLimit(DEFAULT_CONFIG, 'scout', 76)).toBe(true);
      expect(isOverLimit(DEFAULT_CONFIG, 'scout', 75)).toBe(false);
      expect(isOverLimit(DEFAULT_CONFIG, 'scout', 74)).toBe(false);
    });

    it('should identify hard-capped tiers', () => {
      expect(isHardCapped(DEFAULT_CONFIG, 'scout')).toBe(true);
      expect(isHardCapped(DEFAULT_CONFIG, 'ally')).toBe(false);
      expect(isHardCapped(DEFAULT_CONFIG, 'guide')).toBe(false);
      expect(isHardCapped(DEFAULT_CONFIG, 'chief')).toBe(false);
      expect(isHardCapped(DEFAULT_CONFIG, 'elder')).toBe(false);
    });

    it('should block orders for hard-capped tier at limit', () => {
      expect(canPlaceOrder(DEFAULT_CONFIG, 'scout', 75)).toBe(false);
      expect(canPlaceOrder(DEFAULT_CONFIG, 'scout', 76)).toBe(false);
    });

    it('should allow orders for hard-capped tier under limit', () => {
      expect(canPlaceOrder(DEFAULT_CONFIG, 'scout', 74)).toBe(true);
      expect(canPlaceOrder(DEFAULT_CONFIG, 'scout', 0)).toBe(true);
    });

    it('should allow overage orders for non-hard-capped tiers', () => {
      expect(canPlaceOrder(DEFAULT_CONFIG, 'ally', 500)).toBe(true);
      expect(canPlaceOrder(DEFAULT_CONFIG, 'ally', 600)).toBe(true);
    });

    it('should calculate overage charges correctly', () => {
      const charge = calculateOverageCharge(DEFAULT_CONFIG, 'ally', 25);
      expect(charge).toBeCloseTo(0.50, 2); // 2% of $25

      const guideCharge = calculateOverageCharge(DEFAULT_CONFIG, 'guide', 50);
      expect(guideCharge).toBeCloseTo(0.50, 2); // 1% of $50

      const chiefCharge = calculateOverageCharge(DEFAULT_CONFIG, 'chief', 100);
      expect(chiefCharge).toBeCloseTo(0.50, 2); // 0.5% of $100
    });

    it('should calculate zero overage for elder tier', () => {
      const charge = calculateOverageCharge(DEFAULT_CONFIG, 'elder', 100);
      expect(charge).toBe(0);
    });

    it('should calculate zero overage for scout tier', () => {
      const charge = calculateOverageCharge(DEFAULT_CONFIG, 'scout', 25);
      expect(charge).toBe(0);
    });

    it('should never be over limit for elder tier', () => {
      expect(isOverLimit(DEFAULT_CONFIG, 'elder', 999999)).toBe(false);
    });

    it('should handle custom order limits from admin', () => {
      const customConfig = {
        ...DEFAULT_CONFIG,
        orderLimits: {
          ...DEFAULT_CONFIG.orderLimits,
          ally: { limit: 1000, overageRate: 0.01, hardCap: false }
        }
      };
      expect(getOrderLimit(customConfig, 'ally').limit).toBe(1000);
      expect(isOverLimit(customConfig, 'ally', 500)).toBe(false);
      expect(isOverLimit(customConfig, 'ally', 1001)).toBe(true);
    });

    it('should fallback to ally limits for unknown tier', () => {
      const limit = getOrderLimit(DEFAULT_CONFIG, 'nonexistent');
      expect(limit.limit).toBe(500);
    });
  });

  // ==========================================
  // Feature Gating by Tier
  // ==========================================

  describe('Feature Gating', () => {
    const TIER_FEATURES = {
      scout: {
        level: 0,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments']
      },
      ally: {
        level: 1,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload']
      },
      guide: {
        level: 2,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload', 'basic-analytics', 'website-builder', 'website-integration']
      },
      chief: {
        level: 3,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload', 'basic-analytics', 'website-builder', 'website-integration', 'seo-social'],
        previewFeatures: ['ai-analytics', 'ai-content']
      },
      elder: {
        level: 4,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload', 'basic-analytics', 'website-builder', 'website-integration', 'seo-social', 'ai-analytics', 'ai-content']
      }
    };

    function hasFeatureAccess(tier, featureId) {
      const tierInfo = TIER_FEATURES[tier];
      return tierInfo?.features?.includes(featureId) || false;
    }

    function isFeaturePreview(tier, featureId) {
      const tierInfo = TIER_FEATURES[tier];
      return tierInfo?.previewFeatures?.includes(featureId) || false;
    }

    function getMinimumTierForFeature(featureId) {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      for (const tier of tiers) {
        if (TIER_FEATURES[tier].features.includes(featureId)) return tier;
      }
      return null;
    }

    it('should grant all tiers access to basic features', () => {
      const basicFeatures = ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments'];
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];

      tiers.forEach(tier => {
        basicFeatures.forEach(feature => {
          expect(hasFeatureAccess(tier, feature)).toBe(true);
        });
      });
    });

    it('should restrict AI menu upload to ally and above', () => {
      expect(hasFeatureAccess('scout', 'ai-menu-upload')).toBe(false);
      expect(hasFeatureAccess('ally', 'ai-menu-upload')).toBe(true);
      expect(hasFeatureAccess('guide', 'ai-menu-upload')).toBe(true);
    });

    it('should restrict analytics and website to guide and above', () => {
      expect(hasFeatureAccess('scout', 'basic-analytics')).toBe(false);
      expect(hasFeatureAccess('ally', 'basic-analytics')).toBe(false);
      expect(hasFeatureAccess('guide', 'basic-analytics')).toBe(true);
      expect(hasFeatureAccess('chief', 'basic-analytics')).toBe(true);
      expect(hasFeatureAccess('elder', 'basic-analytics')).toBe(true);
    });

    it('should restrict SEO & social to chief and above', () => {
      expect(hasFeatureAccess('guide', 'seo-social')).toBe(false);
      expect(hasFeatureAccess('chief', 'seo-social')).toBe(true);
      expect(hasFeatureAccess('elder', 'seo-social')).toBe(true);
    });

    it('should restrict AI features to elder only', () => {
      expect(hasFeatureAccess('chief', 'ai-analytics')).toBe(false);
      expect(hasFeatureAccess('chief', 'ai-content')).toBe(false);
      expect(hasFeatureAccess('elder', 'ai-analytics')).toBe(true);
      expect(hasFeatureAccess('elder', 'ai-content')).toBe(true);
    });

    it('should show AI features as preview for chief tier', () => {
      expect(isFeaturePreview('chief', 'ai-analytics')).toBe(true);
      expect(isFeaturePreview('chief', 'ai-content')).toBe(true);
    });

    it('should not show preview for tiers that have full access', () => {
      expect(isFeaturePreview('elder', 'ai-analytics')).toBe(false);
    });

    it('should not show preview for tiers below chief', () => {
      expect(isFeaturePreview('guide', 'ai-analytics')).toBe(false);
      expect(isFeaturePreview('ally', 'ai-analytics')).toBe(false);
    });

    it('should return correct minimum tier for each feature', () => {
      expect(getMinimumTierForFeature('pos')).toBe('scout');
      expect(getMinimumTierForFeature('ai-menu-upload')).toBe('ally');
      expect(getMinimumTierForFeature('basic-analytics')).toBe('guide');
      expect(getMinimumTierForFeature('website-builder')).toBe('guide');
      expect(getMinimumTierForFeature('seo-social')).toBe('chief');
      expect(getMinimumTierForFeature('ai-analytics')).toBe('elder');
    });

    it('should return null for unknown feature', () => {
      expect(getMinimumTierForFeature('nonexistent')).toBeNull();
    });

    it('should return false for unknown tier', () => {
      expect(hasFeatureAccess('nonexistent', 'pos')).toBe(false);
    });

    it('should have increasing feature count by tier level', () => {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      for (let i = 1; i < tiers.length; i++) {
        expect(TIER_FEATURES[tiers[i]].features.length)
          .toBeGreaterThan(TIER_FEATURES[tiers[i - 1]].features.length);
      }
    });
  });

  // ==========================================
  // Admin Config ↔ Runtime Feature Consistency
  // ==========================================

  describe('Admin Config ↔ Runtime Feature Consistency', () => {
    // Mirrors SubscriptionContext.TIER_FEATURES — must stay in sync
    const RUNTIME_TIER_FEATURES = {
      scout: {
        level: 0,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments']
      },
      ally: {
        level: 1,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload']
      },
      guide: {
        level: 2,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload', 'basic-analytics', 'website-builder', 'website-integration']
      },
      chief: {
        level: 3,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload', 'basic-analytics', 'website-builder', 'website-integration', 'seo-social'],
      },
      elder: {
        level: 4,
        features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'ai-menu-upload', 'basic-analytics', 'website-builder', 'website-integration', 'seo-social', 'ai-analytics', 'ai-content']
      }
    };

    it('should have all admin config features mapped in runtime TIER_FEATURES', () => {
      const adminFeatures = Object.keys(DEFAULT_CONFIG.features);
      const runtimeFeatures = new Set();
      Object.values(RUNTIME_TIER_FEATURES).forEach(tier => {
        tier.features.forEach(f => runtimeFeatures.add(f));
      });

      adminFeatures.forEach(featureId => {
        const isInRuntime = runtimeFeatures.has(featureId);
        expect(isInRuntime).toBe(true);
      });
    });

    it('should enforce features at the tier specified in admin config', () => {
      const tierOrder = ['scout', 'ally', 'guide', 'chief', 'elder'];

      Object.entries(DEFAULT_CONFIG.features).forEach(([featureId, config]) => {
        const requiredTier = config.tier;
        const requiredLevel = tierOrder.indexOf(requiredTier);

        // Feature should NOT be accessible below its required tier
        tierOrder.forEach((tier, level) => {
          const hasAccess = RUNTIME_TIER_FEATURES[tier]?.features?.includes(featureId) || false;
          if (level < requiredLevel) {
            expect(hasAccess).toBe(false);
          }
        });

        // Feature SHOULD be accessible at its required tier
        expect(RUNTIME_TIER_FEATURES[requiredTier]?.features?.includes(featureId)).toBe(true);
      });
    });

    it('should have order limits in admin config match enforcement defaults', () => {
      const adminLimits = DEFAULT_CONFIG.orderLimits;
      expect(adminLimits.scout.limit).toBe(75);
      expect(adminLimits.scout.hardCap).toBe(true);
      expect(adminLimits.ally.limit).toBe(500);
      expect(adminLimits.guide.limit).toBe(2000);
      expect(adminLimits.chief.limit).toBe(5000);
      expect(adminLimits.elder.limit).toBe(Infinity);
    });
  });

  // ==========================================
  // Config Draft/Publish Lifecycle
  // ==========================================

  describe('Config Draft/Publish Lifecycle', () => {
    function mergeWithDefaults(published) {
      return { ...DEFAULT_CONFIG, ...published };
    }

    function createDraft(config, updates) {
      return { ...config, ...updates };
    }

    function validateConfig(config) {
      const errors = [];

      // Pricing validation
      if (!config.pricing) errors.push('Missing pricing');
      else {
        const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
        tiers.forEach(tier => {
          if (config.pricing[tier] === undefined) errors.push(`Missing pricing for ${tier}`);
          if (config.pricing[tier] < 0) errors.push(`Negative pricing for ${tier}`);
        });
        if (config.pricing.scout !== 0) errors.push('Scout must be free');
      }

      // Billing multipliers validation
      if (!config.billingMultipliers) errors.push('Missing billing multipliers');
      else {
        ['monthly', 'quarterly', 'annual'].forEach(cycle => {
          const mult = config.billingMultipliers[cycle];
          if (mult === undefined) errors.push(`Missing multiplier for ${cycle}`);
          if (mult < 0.5 || mult > 2.0) errors.push(`Multiplier out of range for ${cycle}`);
        });
      }

      // Order limits validation
      if (config.orderLimits) {
        const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
        tiers.forEach(tier => {
          const limit = config.orderLimits[tier];
          if (limit && limit.limit < 0) errors.push(`Negative order limit for ${tier}`);
          if (limit && limit.overageRate < 0) errors.push(`Negative overage rate for ${tier}`);
        });
      }

      return { valid: errors.length === 0, errors };
    }

    it('should merge published config with defaults', () => {
      const published = { pricing: { scout: 0, ally: 39, guide: 69, chief: 109, elder: 249 } };
      const merged = mergeWithDefaults(published);
      expect(merged.pricing.ally).toBe(39);
      expect(merged.billingMultipliers.monthly).toBe(1.20);
    });

    it('should preserve all default fields when merging empty config', () => {
      const merged = mergeWithDefaults({});
      expect(merged).toEqual(DEFAULT_CONFIG);
    });

    it('should create draft with updated pricing', () => {
      const draft = createDraft(DEFAULT_CONFIG, {
        pricing: { ...DEFAULT_CONFIG.pricing, ally: 49 }
      });
      expect(draft.pricing.ally).toBe(49);
      expect(draft.pricing.guide).toBe(59);
    });

    it('should validate valid config', () => {
      const result = validateConfig(DEFAULT_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject negative pricing', () => {
      const config = {
        ...DEFAULT_CONFIG,
        pricing: { ...DEFAULT_CONFIG.pricing, ally: -10 }
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Negative pricing'))).toBe(true);
    });

    it('should reject non-free scout', () => {
      const config = {
        ...DEFAULT_CONFIG,
        pricing: { ...DEFAULT_CONFIG.pricing, scout: 5 }
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Scout must be free'))).toBe(true);
    });

    it('should reject multiplier out of range', () => {
      const config = {
        ...DEFAULT_CONFIG,
        billingMultipliers: { ...DEFAULT_CONFIG.billingMultipliers, monthly: 3.0 }
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('out of range'))).toBe(true);
    });

    it('should reject missing pricing config', () => {
      const config = { ...DEFAULT_CONFIG, pricing: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject missing billing multipliers', () => {
      const config = { ...DEFAULT_CONFIG, billingMultipliers: undefined };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject negative order limits', () => {
      const config = {
        ...DEFAULT_CONFIG,
        orderLimits: { ...DEFAULT_CONFIG.orderLimits, ally: { limit: -1, overageRate: 0.02, hardCap: false } }
      };
      const result = validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================
  // Subscription Status
  // ==========================================

  describe('Subscription Status', () => {
    function isSubscriptionActive(subscription) {
      return subscription?.status === 'active' || subscription?.status === 'trialing';
    }

    function getTrialDaysRemaining(subscription) {
      if (subscription?.status !== 'trialing' || !subscription?.trialEnd) return 0;
      const trialEnd = new Date(subscription.trialEnd);
      const diffDays = Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    }

    function getPeriodEnd(subscription) {
      if (!subscription?.currentPeriodEnd) return null;
      return new Date(subscription.currentPeriodEnd);
    }

    it('should consider active subscription as active', () => {
      expect(isSubscriptionActive({ status: 'active' })).toBe(true);
    });

    it('should consider trialing subscription as active', () => {
      expect(isSubscriptionActive({ status: 'trialing' })).toBe(true);
    });

    it('should not consider cancelled subscription as active', () => {
      expect(isSubscriptionActive({ status: 'cancelled' })).toBe(false);
    });

    it('should not consider expired subscription as active', () => {
      expect(isSubscriptionActive({ status: 'expired' })).toBe(false);
    });

    it('should not consider null subscription as active', () => {
      expect(isSubscriptionActive(null)).toBe(false);
      expect(isSubscriptionActive(undefined)).toBe(false);
    });

    it('should calculate remaining trial days correctly', () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const days = getTrialDaysRemaining({
        status: 'trialing',
        trialEnd: futureDate.toISOString()
      });
      expect(days).toBe(7);
    });

    it('should return 0 trial days for non-trialing subscription', () => {
      const days = getTrialDaysRemaining({
        status: 'active',
        trialEnd: new Date(Date.now() + 86400000).toISOString()
      });
      expect(days).toBe(0);
    });

    it('should return 0 trial days for expired trial', () => {
      const days = getTrialDaysRemaining({
        status: 'trialing',
        trialEnd: new Date(Date.now() - 86400000).toISOString()
      });
      expect(days).toBe(0);
    });

    it('should return 0 trial days when no trialEnd', () => {
      const days = getTrialDaysRemaining({ status: 'trialing' });
      expect(days).toBe(0);
    });

    it('should get period end date', () => {
      const endDate = '2026-12-31T23:59:59.000Z';
      const result = getPeriodEnd({ currentPeriodEnd: endDate });
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe(endDate);
    });

    it('should return null for missing period end', () => {
      expect(getPeriodEnd({})).toBeNull();
      expect(getPeriodEnd(null)).toBeNull();
    });
  });

  // ==========================================
  // Signup Subscription Record
  // ==========================================

  describe('Signup Subscription Record Construction', () => {
    function buildSubscription(tier, billingCycle, locationCount, amountPaid, paymentIntentId) {
      const now = new Date();
      const BILLING_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };
      const months = BILLING_MONTHS[billingCycle] || 1;
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + months);

      return {
        tier,
        status: 'active',
        billingCycle,
        locationCount,
        stripePaymentIntentId: paymentIntentId || null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        amountPaid,
        createdAt: now.toISOString()
      };
    }

    function buildFreeSubscription() {
      const now = new Date();
      const oneMonthLater = new Date(now);
      oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

      return {
        tier: 'scout',
        status: 'active',
        billingCycle: 'monthly',
        locationCount: 1,
        stripePaymentIntentId: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: oneMonthLater.toISOString(),
        amountPaid: 0,
        createdAt: now.toISOString()
      };
    }

    it('should build correct free tier subscription', () => {
      const sub = buildFreeSubscription();
      expect(sub.tier).toBe('scout');
      expect(sub.status).toBe('active');
      expect(sub.amountPaid).toBe(0);
      expect(sub.locationCount).toBe(1);
      expect(sub.stripePaymentIntentId).toBeNull();
    });

    it('should build correct paid tier subscription', () => {
      const sub = buildSubscription('ally', 'annual', 1, 348, 'pi_12345');
      expect(sub.tier).toBe('ally');
      expect(sub.status).toBe('active');
      expect(sub.billingCycle).toBe('annual');
      expect(sub.amountPaid).toBe(348);
      expect(sub.stripePaymentIntentId).toBe('pi_12345');
    });

    it('should set correct period end for monthly billing', () => {
      const sub = buildSubscription('ally', 'monthly', 1, 34.80, 'pi_1');
      const start = new Date(sub.currentPeriodStart);
      const end = new Date(sub.currentPeriodEnd);
      const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      expect(diffMonths).toBe(1);
    });

    it('should set correct period end for quarterly billing', () => {
      const sub = buildSubscription('guide', 'quarterly', 1, 194.70, 'pi_2');
      const start = new Date(sub.currentPeriodStart);
      const end = new Date(sub.currentPeriodEnd);
      const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      expect(diffMonths).toBe(3);
    });

    it('should set correct period end for annual billing', () => {
      const sub = buildSubscription('chief', 'annual', 1, 1188, 'pi_3');
      const start = new Date(sub.currentPeriodStart);
      const end = new Date(sub.currentPeriodEnd);
      const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      expect(diffMonths).toBe(12);
    });

    it('should store multi-location count', () => {
      const sub = buildSubscription('elder', 'annual', 5, 13740, 'pi_4');
      expect(sub.locationCount).toBe(5);
    });

    it('should always have status active on creation', () => {
      const sub = buildSubscription('ally', 'monthly', 1, 34.80, 'pi_5');
      expect(sub.status).toBe('active');
    });

    it('should have null stripe fields for future subscription migration', () => {
      const sub = buildSubscription('guide', 'annual', 1, 708, 'pi_6');
      expect(sub.stripeCustomerId).toBeNull();
      expect(sub.stripeSubscriptionId).toBeNull();
    });
  });

  // ==========================================
  // Config Tier Validation for Signup
  // ==========================================

  describe('Signup Tier Validation', () => {
    const VALID_TIERS = ['scout', 'ally', 'guide', 'chief', 'elder'];
    const VALID_CYCLES = ['monthly', 'quarterly', 'annual'];

    function validateSignupTier(tier) {
      return VALID_TIERS.includes(tier) ? tier : 'ally';
    }

    function validateBillingCycle(cycle) {
      return VALID_CYCLES.includes(cycle) ? cycle : 'annual';
    }

    function isFreeTier(tier) {
      return tier === 'scout';
    }

    function getEffectiveLocationCount(tier, requestedCount) {
      if (isFreeTier(tier)) return 1;
      return Math.max(1, requestedCount);
    }

    it('should accept all valid tiers', () => {
      VALID_TIERS.forEach(tier => {
        expect(validateSignupTier(tier)).toBe(tier);
      });
    });

    it('should default invalid tier to ally', () => {
      expect(validateSignupTier('nonexistent')).toBe('ally');
      expect(validateSignupTier('')).toBe('ally');
      expect(validateSignupTier(undefined)).toBe('ally');
    });

    it('should accept all valid billing cycles', () => {
      VALID_CYCLES.forEach(cycle => {
        expect(validateBillingCycle(cycle)).toBe(cycle);
      });
    });

    it('should default invalid billing cycle to annual', () => {
      expect(validateBillingCycle('weekly')).toBe('annual');
      expect(validateBillingCycle('')).toBe('annual');
    });

    it('should identify scout as free tier', () => {
      expect(isFreeTier('scout')).toBe(true);
      expect(isFreeTier('ally')).toBe(false);
    });

    it('should force single location for scout', () => {
      expect(getEffectiveLocationCount('scout', 3)).toBe(1);
      expect(getEffectiveLocationCount('scout', 1)).toBe(1);
    });

    it('should allow multiple locations for paid tiers', () => {
      expect(getEffectiveLocationCount('ally', 3)).toBe(3);
      expect(getEffectiveLocationCount('guide', 5)).toBe(5);
    });

    it('should enforce minimum 1 location for paid tiers', () => {
      expect(getEffectiveLocationCount('ally', 0)).toBe(1);
      expect(getEffectiveLocationCount('ally', -1)).toBe(1);
    });
  });

  // ==========================================
  // Billing Period Calculation
  // ==========================================

  describe('Billing Period Calculation', () => {
    function getBillingMonths(cycle) {
      const map = { monthly: 1, quarterly: 3, annual: 12 };
      return map[cycle] || 1;
    }

    function getBillingLabel(cycle) {
      const map = { monthly: '/month', quarterly: '/quarter', annual: '/year' };
      return map[cycle] || '/month';
    }

    function getMonthlyEquivalent(totalCharge, cycle) {
      const months = getBillingMonths(cycle);
      return Math.round((totalCharge / months) * 100) / 100;
    }

    it('should return correct billing months', () => {
      expect(getBillingMonths('monthly')).toBe(1);
      expect(getBillingMonths('quarterly')).toBe(3);
      expect(getBillingMonths('annual')).toBe(12);
    });

    it('should default unknown cycle to 1 month', () => {
      expect(getBillingMonths('weekly')).toBe(1);
    });

    it('should return correct billing labels', () => {
      expect(getBillingLabel('monthly')).toBe('/month');
      expect(getBillingLabel('quarterly')).toBe('/quarter');
      expect(getBillingLabel('annual')).toBe('/year');
    });

    it('should calculate monthly equivalent from annual charge', () => {
      // Ally annual: $29/month × 12 = $348 total
      const monthly = getMonthlyEquivalent(348, 'annual');
      expect(monthly).toBe(29);
    });

    it('should calculate monthly equivalent from quarterly charge', () => {
      // Ally quarterly: $31.90/month × 3 = $95.70 total
      const monthly = getMonthlyEquivalent(95.70, 'quarterly');
      expect(monthly).toBe(31.90);
    });
  });

  // ==========================================
  // Discount + Multiplier Combined Scenarios
  // ==========================================

  describe('Combined Pricing Scenarios', () => {
    function calculateFullPrice(config, tier, billingCycle, locationCount) {
      const basePrice = config.pricing[tier] || 0;
      const multiplier = config.billingMultipliers[billingCycle] || 1;
      const billingMonths = { monthly: 1, quarterly: 3, annual: 12 }[billingCycle] || 1;

      // Get active discount
      const now = new Date();
      const discount = (config.discounts || []).find(d => {
        if (!d.active) return false;
        const start = new Date(d.startDate);
        const end = new Date(d.endDate);
        return now >= start && now <= end &&
          ((d.type === 'tier' && d.target === tier) ||
           (d.type === 'billing_cycle' && d.target === billingCycle));
      });

      let discountAmount = 0;
      if (discount) {
        discountAmount = discount.isPercentage
          ? basePrice * (discount.amount / 100)
          : discount.amount;
      }

      const monthlyPrice = Math.max(0, (basePrice - discountAmount) * multiplier);
      const totalCharge = monthlyPrice * locationCount * billingMonths;

      return {
        monthlyPrice: Math.round(monthlyPrice * 100) / 100,
        totalCharge: Math.round(totalCharge * 100) / 100
      };
    }

    const now = Date.now();

    it('should calculate full price with no discount', () => {
      const result = calculateFullPrice(DEFAULT_CONFIG, 'chief', 'monthly', 1);
      expect(result.monthlyPrice).toBe(118.80);
      expect(result.totalCharge).toBe(118.80);
    });

    it('should calculate full price with percentage discount + multiplier', () => {
      const config = {
        ...DEFAULT_CONFIG,
        discounts: [{
          id: '1', type: 'tier', target: 'chief', amount: 20,
          isPercentage: true, active: true,
          startDate: new Date(now - 86400000).toISOString(),
          endDate: new Date(now + 86400000).toISOString()
        }]
      };
      // Base: $99, 20% off = $19.80 discount, so $79.20 × 1.2 = $95.04
      const result = calculateFullPrice(config, 'chief', 'monthly', 1);
      expect(result.monthlyPrice).toBeCloseTo(95.04, 2);
    });

    it('should calculate full price with fixed discount + multiplier', () => {
      const config = {
        ...DEFAULT_CONFIG,
        discounts: [{
          id: '1', type: 'tier', target: 'ally', amount: 10,
          isPercentage: false, active: true,
          startDate: new Date(now - 86400000).toISOString(),
          endDate: new Date(now + 86400000).toISOString()
        }]
      };
      // Base: $29, $10 off = $19 × 1.1 = $20.90 quarterly
      const result = calculateFullPrice(config, 'ally', 'quarterly', 1);
      expect(result.monthlyPrice).toBeCloseTo(20.90, 2);
      expect(result.totalCharge).toBeCloseTo(62.70, 2);
    });

    it('should calculate multi-location with discount', () => {
      const config = {
        ...DEFAULT_CONFIG,
        discounts: [{
          id: '1', type: 'tier', target: 'guide', amount: 50,
          isPercentage: true, active: true,
          startDate: new Date(now - 86400000).toISOString(),
          endDate: new Date(now + 86400000).toISOString()
        }]
      };
      // Base: $59, 50% off = $29.50, × 1.0 annual = $29.50/mo, × 3 locations × 12 months
      const result = calculateFullPrice(config, 'guide', 'annual', 3);
      expect(result.monthlyPrice).toBeCloseTo(29.50, 2);
      expect(result.totalCharge).toBeCloseTo(1062, 0);
    });

    it('should handle billing_cycle discount applied to monthly', () => {
      const config = {
        ...DEFAULT_CONFIG,
        discounts: [{
          id: '1', type: 'billing_cycle', target: 'monthly', amount: 5,
          isPercentage: false, active: true,
          startDate: new Date(now - 86400000).toISOString(),
          endDate: new Date(now + 86400000).toISOString()
        }]
      };
      // Ally: $29 - $5 = $24 × 1.2 = $28.80 monthly
      const result = calculateFullPrice(config, 'ally', 'monthly', 1);
      expect(result.monthlyPrice).toBeCloseTo(28.80, 2);
    });

    it('should not apply discount to wrong billing cycle', () => {
      const config = {
        ...DEFAULT_CONFIG,
        discounts: [{
          id: '1', type: 'billing_cycle', target: 'annual', amount: 10,
          isPercentage: false, active: true,
          startDate: new Date(now - 86400000).toISOString(),
          endDate: new Date(now + 86400000).toISOString()
        }]
      };
      // Monthly should not get the annual discount
      const monthly = calculateFullPrice(config, 'ally', 'monthly', 1);
      expect(monthly.monthlyPrice).toBe(34.80); // No discount applied
    });
  });

  // ==========================================
  // Config Field Completeness
  // ==========================================

  describe('Config Field Completeness', () => {
    it('should have pricing for all 5 tiers', () => {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      tiers.forEach(tier => {
        expect(DEFAULT_CONFIG.pricing[tier]).toBeDefined();
        expect(typeof DEFAULT_CONFIG.pricing[tier]).toBe('number');
      });
    });

    it('should have billing multipliers for all 3 cycles', () => {
      expect(DEFAULT_CONFIG.billingMultipliers.monthly).toBeDefined();
      expect(DEFAULT_CONFIG.billingMultipliers.quarterly).toBeDefined();
      expect(DEFAULT_CONFIG.billingMultipliers.annual).toBeDefined();
    });

    it('should have order limits for all 5 tiers', () => {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      tiers.forEach(tier => {
        const limit = DEFAULT_CONFIG.orderLimits[tier];
        expect(limit).toBeDefined();
        expect(limit.limit).toBeDefined();
        expect(limit.overageRate).toBeDefined();
        expect(limit.hardCap).toBeDefined();
      });
    });

    it('should have free trials for all 5 tiers', () => {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      tiers.forEach(tier => {
        const trial = DEFAULT_CONFIG.freeTrials[tier];
        expect(trial).toBeDefined();
        expect(typeof trial.enabled).toBe('boolean');
        expect(typeof trial.days).toBe('number');
      });
    });

    it('should have tier info for all 5 tiers', () => {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      tiers.forEach(tier => {
        const info = DEFAULT_CONFIG.tierInfo[tier];
        expect(info).toBeDefined();
        expect(info.name).toBeTruthy();
        expect(info.tagline).toBeTruthy();
        expect(info.icon).toBeTruthy();
        expect(info.color).toBeTruthy();
      });
    });

    it('should have features assigned to valid tiers', () => {
      const validTiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      Object.values(DEFAULT_CONFIG.features).forEach(feature => {
        expect(validTiers).toContain(feature.tier);
      });
    });

    it('should have increasing tier prices', () => {
      const prices = DEFAULT_CONFIG.pricing;
      expect(prices.scout).toBeLessThan(prices.ally);
      expect(prices.ally).toBeLessThan(prices.guide);
      expect(prices.guide).toBeLessThan(prices.chief);
      expect(prices.chief).toBeLessThan(prices.elder);
    });

    it('should have increasing order limits', () => {
      const limits = DEFAULT_CONFIG.orderLimits;
      expect(limits.scout.limit).toBeLessThan(limits.ally.limit);
      expect(limits.ally.limit).toBeLessThan(limits.guide.limit);
      expect(limits.guide.limit).toBeLessThan(limits.chief.limit);
      expect(limits.chief.limit).toBeLessThan(limits.elder.limit);
    });

    it('should have decreasing overage rates for higher tiers', () => {
      const rates = DEFAULT_CONFIG.orderLimits;
      expect(rates.ally.overageRate).toBeGreaterThan(rates.guide.overageRate);
      expect(rates.guide.overageRate).toBeGreaterThan(rates.chief.overageRate);
      expect(rates.chief.overageRate).toBeGreaterThan(rates.elder.overageRate);
    });

    it('should have annual multiplier as base (1.0)', () => {
      expect(DEFAULT_CONFIG.billingMultipliers.annual).toBe(1.0);
    });

    it('should have monthly multiplier higher than quarterly', () => {
      expect(DEFAULT_CONFIG.billingMultipliers.monthly)
        .toBeGreaterThan(DEFAULT_CONFIG.billingMultipliers.quarterly);
    });

    it('should only have chief tier marked as popular', () => {
      const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
      tiers.forEach(tier => {
        if (tier === 'chief') {
          expect(DEFAULT_CONFIG.tierInfo[tier].popular).toBe(true);
        } else {
          expect(DEFAULT_CONFIG.tierInfo[tier].popular).toBeFalsy();
        }
      });
    });
  });

  // ==========================================
  // Admin Config → Display Consistency
  // ==========================================

  describe('Admin Order Limit Config → Display Consistency', () => {
    // Mirrors the FALLBACK_TIER_FEATURES from PricingTiers.js
    // These have dynamicDescription/dynamicRestrictions that must use ORDER_LIMITS
    const FALLBACK_ORDER_LIMITS = {
      scout: { limit: 75, overageRate: 0, hardCap: true },
      ally: { limit: 500, overageRate: 0.02 },
      guide: { limit: 2000, overageRate: 0.01 },
      chief: { limit: 5000, overageRate: 0.005 },
      elder: { limit: Infinity, overageRate: 0 }
    };

    // Simulates the dynamic feature descriptions from PricingTiers.js
    function getScoutOrderDescription(limits) {
      return `Up to ${limits.scout.limit.toLocaleString()} orders/month`;
    }

    function getAllyOrderDescription(limits) {
      return `Up to ${limits.ally.limit.toLocaleString()} orders/month`;
    }

    function getScoutRestrictions(limits) {
      return [
        { icon: '📍', text: 'Single location only' },
        { icon: '🍽️', text: '10 menu items max' },
        { icon: '📦', text: `${limits.scout.limit.toLocaleString()} orders/month` },
      ];
    }

    it('should display admin-configured scout order limit in feature descriptions', () => {
      const customLimits = { ...FALLBACK_ORDER_LIMITS, scout: { limit: 90, overageRate: 0, hardCap: true } };
      expect(getScoutOrderDescription(customLimits)).toBe('Up to 90 orders/month');
    });

    it('should display admin-configured scout order limit in restrictions', () => {
      const customLimits = { ...FALLBACK_ORDER_LIMITS, scout: { limit: 90, overageRate: 0, hardCap: true } };
      const restrictions = getScoutRestrictions(customLimits);
      expect(restrictions[2].text).toBe('90 orders/month');
    });

    it('should display admin-configured ally order limit in feature descriptions', () => {
      const customLimits = { ...FALLBACK_ORDER_LIMITS, ally: { limit: 1000, overageRate: 0.015 } };
      expect(getAllyOrderDescription(customLimits)).toBe('Up to 1,000 orders/month');
    });

    it('should use fallback order limits when no admin config is provided', () => {
      expect(getScoutOrderDescription(FALLBACK_ORDER_LIMITS)).toBe('Up to 75 orders/month');
      expect(getAllyOrderDescription(FALLBACK_ORDER_LIMITS)).toBe('Up to 500 orders/month');
    });

    it('should format large order limits with commas', () => {
      const customLimits = { ...FALLBACK_ORDER_LIMITS, scout: { limit: 1500, overageRate: 0, hardCap: true } };
      expect(getScoutOrderDescription(customLimits)).toBe('Up to 1,500 orders/month');
      const restrictions = getScoutRestrictions(customLimits);
      expect(restrictions[2].text).toBe('1,500 orders/month');
    });

    it('should display order limit badge from config, not hardcoded', () => {
      // Simulates the order-limit-badge rendering from PricingTiers.js
      const tiers = ['scout', 'ally', 'guide', 'chief'];
      const customLimits = {
        scout: { limit: 90, overageRate: 0, hardCap: true },
        ally: { limit: 750, overageRate: 0.02 },
        guide: { limit: 3000, overageRate: 0.01 },
        chief: { limit: 7500, overageRate: 0.005 },
        elder: { limit: Infinity, overageRate: 0 }
      };

      tiers.forEach(tier => {
        const limit = customLimits[tier];
        const displayText = limit.limit === Infinity
          ? 'Unlimited Orders'
          : `${limit.limit.toLocaleString()} orders/month`;
        expect(displayText).toContain(limit.limit.toLocaleString());
      });

      // Elder should show unlimited
      expect(customLimits.elder.limit).toBe(Infinity);
    });

    it('restrictions and feature descriptions should match the order-limit-badge value', () => {
      // This test ensures all 3 display locations for scout order limits stay in sync
      const customLimits = { ...FALLBACK_ORDER_LIMITS, scout: { limit: 120, overageRate: 0, hardCap: true } };

      const badgeText = `${customLimits.scout.limit.toLocaleString()} orders/month`;
      const featureDesc = getScoutOrderDescription(customLimits);
      const restrictions = getScoutRestrictions(customLimits);

      // All three must reference the same limit value
      expect(badgeText).toBe('120 orders/month');
      expect(featureDesc).toBe('Up to 120 orders/month');
      expect(restrictions[2].text).toBe('120 orders/month');
    });

    it('should never have hardcoded order limit strings in display functions', () => {
      // Changing the config should change ALL display strings — no hardcoded "75" or "500"
      const weirdLimit = { ...FALLBACK_ORDER_LIMITS, scout: { limit: 42, overageRate: 0, hardCap: true } };

      const desc = getScoutOrderDescription(weirdLimit);
      const restrictions = getScoutRestrictions(weirdLimit);

      expect(desc).not.toContain('75');
      expect(restrictions[2].text).not.toContain('75');
      expect(desc).toContain('42');
      expect(restrictions[2].text).toContain('42');
    });
  });
});
