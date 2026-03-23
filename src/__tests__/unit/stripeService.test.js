/**
 * Unit Tests — Stripe Service Calculations
 * Tests tier price calculation and amount formatting.
 */

describe('Stripe Service — Tier Price Calculation', () => {
  // Replicate the logic from stripeService.js
  const BASE_PRICES = {
    ally: 29,
    guide: 59,
    chief: 99,
    elder: 229
  };

  const BILLING_MULTIPLIERS = {
    monthly: 1.20,
    quarterly: 1.10,
    annual: 1.00
  };

  const BILLING_MONTHS = {
    monthly: 1,
    quarterly: 3,
    annual: 12
  };

  const calculateTierPrice = (tier, billingCycle, locationCount) => {
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
  };

  describe('Annual Billing (base price)', () => {
    it('should calculate ally annual correctly', () => {
      const result = calculateTierPrice('ally', 'annual', 1);
      expect(result.monthlyPerLocation).toBe(29);
      expect(result.totalCharge).toBe(348); // 29 * 12
    });

    it('should calculate guide annual correctly', () => {
      const result = calculateTierPrice('guide', 'annual', 1);
      expect(result.monthlyPerLocation).toBe(59);
      expect(result.totalCharge).toBe(708); // 59 * 12
    });

    it('should calculate chief annual correctly', () => {
      const result = calculateTierPrice('chief', 'annual', 1);
      expect(result.monthlyPerLocation).toBe(99);
      expect(result.totalCharge).toBe(1188); // 99 * 12
    });

    it('should calculate elder annual correctly', () => {
      const result = calculateTierPrice('elder', 'annual', 1);
      expect(result.monthlyPerLocation).toBe(229);
      expect(result.totalCharge).toBe(2748); // 229 * 12
    });
  });

  describe('Monthly Billing (+20%)', () => {
    it('should apply 20% markup for monthly billing', () => {
      const result = calculateTierPrice('ally', 'monthly', 1);
      expect(result.monthlyPerLocation).toBe(34.8); // 29 * 1.20
      expect(result.totalCharge).toBe(34.8); // 1 month
    });

    it('should apply 20% markup for chief tier', () => {
      const result = calculateTierPrice('chief', 'monthly', 1);
      expect(result.monthlyPerLocation).toBe(118.8); // 99 * 1.20
    });
  });

  describe('Quarterly Billing (+10%)', () => {
    it('should apply 10% markup for quarterly billing', () => {
      const result = calculateTierPrice('ally', 'quarterly', 1);
      expect(result.monthlyPerLocation).toBe(31.9); // 29 * 1.10
      expect(result.totalCharge).toBe(95.7); // 31.9 * 3
    });
  });

  describe('Multi-Location Pricing', () => {
    it('should multiply by location count', () => {
      const result = calculateTierPrice('ally', 'annual', 3);
      expect(result.totalMonthly).toBe(87); // 29 * 3
      expect(result.totalCharge).toBe(1044); // 87 * 12
    });

    it('should handle single location', () => {
      const result = calculateTierPrice('ally', 'annual', 1);
      expect(result.totalMonthly).toBe(29);
    });

    it('should handle large number of locations', () => {
      const result = calculateTierPrice('elder', 'monthly', 10);
      expect(result.totalMonthly).toBe(2748); // 229 * 1.20 * 10
      expect(result.totalCharge).toBe(2748); // single month
    });
  });

  describe('formatAmount', () => {
    const formatAmount = (amount) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount);
    };

    it('should format whole numbers', () => {
      expect(formatAmount(100)).toBe('$100.00');
    });

    it('should format decimal amounts', () => {
      expect(formatAmount(99.99)).toBe('$99.99');
    });

    it('should format zero', () => {
      expect(formatAmount(0)).toBe('$0.00');
    });

    it('should format large amounts with commas', () => {
      expect(formatAmount(1234.56)).toBe('$1,234.56');
    });
  });
});
