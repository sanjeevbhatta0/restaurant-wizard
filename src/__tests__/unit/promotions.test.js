/**
 * Unit Tests — Promotions Business Logic
 * Tests promo discount parsing, calculation, cart totals with promos,
 * unique code generation, and promo eligibility validation.
 */

describe('Promotions Business Logic', () => {
  // ==========================================
  // parsePromoDiscount — mirrors server helper
  // ==========================================

  describe('parsePromoDiscount', () => {
    const parsePromoDiscount = (promo) => {
      if (!promo || !promo.discount) return { discountValue: 0, discountUnit: 'percentage' };
      const discountStr = String(promo.discount);

      if (promo.type === 'percentage' || promo.type === 'flashSale' || promo.type === 'storeLaunch') {
        if (discountStr.includes('%')) {
          return { discountValue: parseFloat(discountStr.replace('%', '')) || 0, discountUnit: 'percentage' };
        }
        if (discountStr.startsWith('$')) {
          return { discountValue: parseFloat(discountStr.replace('$', '')) || 0, discountUnit: 'amount' };
        }
        const val = parseFloat(discountStr);
        if (!isNaN(val)) return { discountValue: val, discountUnit: 'percentage' };
      }
      if (promo.type === 'bogo') return { discountValue: 0, discountUnit: 'percentage' };
      if (promo.type === 'freeItem') return { discountValue: 0, discountUnit: 'amount' };
      if (discountStr.includes('%')) return { discountValue: parseFloat(discountStr.replace('%', '')) || 0, discountUnit: 'percentage' };
      if (discountStr.startsWith('$')) return { discountValue: parseFloat(discountStr.replace('$', '')) || 0, discountUnit: 'amount' };
      return { discountValue: 0, discountUnit: 'percentage' };
    };

    it('should parse "20%" as percentage discount', () => {
      expect(parsePromoDiscount({ type: 'percentage', discount: '20%' }))
        .toEqual({ discountValue: 20, discountUnit: 'percentage' });
    });

    it('should parse "30%" flash sale', () => {
      expect(parsePromoDiscount({ type: 'flashSale', discount: '30%' }))
        .toEqual({ discountValue: 30, discountUnit: 'percentage' });
    });

    it('should parse "15%" store launch', () => {
      expect(parsePromoDiscount({ type: 'storeLaunch', discount: '15%' }))
        .toEqual({ discountValue: 15, discountUnit: 'percentage' });
    });

    it('should parse "$5" store launch as amount', () => {
      expect(parsePromoDiscount({ type: 'storeLaunch', discount: '$5' }))
        .toEqual({ discountValue: 5, discountUnit: 'amount' });
    });

    it('should parse bare number for percentage type as percentage', () => {
      expect(parsePromoDiscount({ type: 'percentage', discount: '25' }))
        .toEqual({ discountValue: 25, discountUnit: 'percentage' });
    });

    it('should return 0 for BOGO type', () => {
      expect(parsePromoDiscount({ type: 'bogo', discount: 'BOGO' }))
        .toEqual({ discountValue: 0, discountUnit: 'percentage' });
    });

    it('should return 0 for freeItem type', () => {
      expect(parsePromoDiscount({ type: 'freeItem', discount: 'Free Item' }))
        .toEqual({ discountValue: 0, discountUnit: 'amount' });
    });

    it('should handle null promo', () => {
      expect(parsePromoDiscount(null))
        .toEqual({ discountValue: 0, discountUnit: 'percentage' });
    });

    it('should handle empty discount string', () => {
      expect(parsePromoDiscount({ type: 'percentage', discount: '' }))
        .toEqual({ discountValue: 0, discountUnit: 'percentage' });
    });

    it('should handle unknown type with percentage string', () => {
      expect(parsePromoDiscount({ type: 'unknown', discount: '10%' }))
        .toEqual({ discountValue: 10, discountUnit: 'percentage' });
    });

    it('should handle unknown type with dollar string', () => {
      expect(parsePromoDiscount({ type: 'unknown', discount: '$7.50' }))
        .toEqual({ discountValue: 7.5, discountUnit: 'amount' });
    });
  });

  // ==========================================
  // calculatePromoDiscount
  // ==========================================

  describe('calculatePromoDiscount', () => {
    const calculatePromoDiscount = (subtotal, discountValue, discountUnit) => {
      let discount = 0;
      if (discountUnit === 'percentage') {
        discount = subtotal * (discountValue / 100);
      } else {
        discount = discountValue;
      }
      discount = Math.min(discount, subtotal);
      return Math.round(discount * 100) / 100;
    };

    it('should apply percentage discount correctly', () => {
      expect(calculatePromoDiscount(100, 20, 'percentage')).toBe(20);
    });

    it('should apply flat amount discount correctly', () => {
      expect(calculatePromoDiscount(100, 15, 'amount')).toBe(15);
    });

    it('should cap discount at subtotal for percentage', () => {
      expect(calculatePromoDiscount(50, 120, 'percentage')).toBe(50);
    });

    it('should cap discount at subtotal for amount', () => {
      expect(calculatePromoDiscount(10, 25, 'amount')).toBe(10);
    });

    it('should return 0 discount when values are 0', () => {
      expect(calculatePromoDiscount(100, 0, 'percentage')).toBe(0);
    });

    it('should handle 100% discount (free order)', () => {
      expect(calculatePromoDiscount(49.99, 100, 'percentage')).toBe(49.99);
    });

    it('should round to 2 decimal places', () => {
      expect(calculatePromoDiscount(33.33, 10, 'percentage')).toBe(3.33);
    });

    it('should handle small subtotals', () => {
      expect(calculatePromoDiscount(1.50, 20, 'percentage')).toBe(0.30);
    });
  });

  // ==========================================
  // getCartTotalsWithPromo
  // ==========================================

  describe('getCartTotalsWithPromo', () => {
    const getCartTotals = (items, taxRate, appliedPromo) => {
      const subtotal = items.reduce((sum, item) => sum + (item.finalPrice * item.quantity), 0);
      let discount = 0;
      if (appliedPromo) {
        if (appliedPromo.discountUnit === 'percentage') {
          discount = subtotal * (appliedPromo.discountValue / 100);
        } else {
          discount = appliedPromo.discountValue;
        }
        discount = Math.min(discount, subtotal);
        discount = Math.round(discount * 100) / 100;
      }
      const taxable = subtotal - discount;
      const tax = Math.round(taxable * taxRate * 100) / 100;
      const total = Math.round((taxable + tax) * 100) / 100;
      return { subtotal, discount, tax, total };
    };

    const sampleItems = [
      { finalPrice: 12.99, quantity: 2 },
      { finalPrice: 8.50, quantity: 1 }
    ];
    const taxRate = 0.085;

    it('should calculate totals without promo', () => {
      const result = getCartTotals(sampleItems, taxRate, null);
      expect(result.subtotal).toBeCloseTo(34.48, 2);
      expect(result.discount).toBe(0);
      expect(result.tax).toBeCloseTo(2.93, 2);
      expect(result.total).toBeCloseTo(37.41, 2);
    });

    it('should calculate totals with percentage promo', () => {
      const promo = { discountValue: 20, discountUnit: 'percentage' };
      const result = getCartTotals(sampleItems, taxRate, promo);
      expect(result.subtotal).toBeCloseTo(34.48, 2);
      expect(result.discount).toBeCloseTo(6.90, 2);
      expect(result.tax).toBeCloseTo(2.34, 2);
      expect(result.total).toBeCloseTo(29.92, 2);
    });

    it('should calculate totals with flat amount promo', () => {
      const promo = { discountValue: 5, discountUnit: 'amount' };
      const result = getCartTotals(sampleItems, taxRate, promo);
      expect(result.subtotal).toBeCloseTo(34.48, 2);
      expect(result.discount).toBe(5);
      expect(result.tax).toBeCloseTo(2.51, 2);
      expect(result.total).toBeCloseTo(31.99, 2);
    });

    it('should calculate tax on post-discount amount', () => {
      const promo = { discountValue: 50, discountUnit: 'percentage' };
      const result = getCartTotals(sampleItems, taxRate, promo);
      // Tax should be on half the subtotal
      const expectedTaxable = 34.48 - 17.24;
      const expectedTax = Math.round(expectedTaxable * taxRate * 100) / 100;
      expect(result.tax).toBe(expectedTax);
    });

    it('should handle empty cart', () => {
      const result = getCartTotals([], taxRate, null);
      expect(result.subtotal).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  // ==========================================
  // generateUniquePromoCode
  // ==========================================

  describe('generateUniquePromoCode', () => {
    const generateUniquePromoCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = 'KC-';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };

    it('should generate 9-char code with KC- prefix', () => {
      const code = generateUniquePromoCode();
      expect(code).toMatch(/^KC-[A-Z0-9]{6}$/);
      expect(code.length).toBe(9);
    });

    it('should generate unique codes (no duplicates in 100 iterations)', () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(generateUniquePromoCode());
      }
      expect(codes.size).toBe(100);
    });

    it('should only contain uppercase alphanumeric characters after prefix', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateUniquePromoCode();
        expect(code.substring(3)).toMatch(/^[A-Z0-9]+$/);
      }
    });
  });

  // ==========================================
  // Promo eligibility checks
  // ==========================================

  describe('promoEligibility', () => {
    const isPromoEligible = (promo, subtotal) => {
      const now = new Date();
      if (!promo) return { eligible: false, reason: 'No promotion' };
      if (promo.used) return { eligible: false, reason: 'Already used' };
      const validUntil = new Date(promo.validUntil);
      if (validUntil < now) return { eligible: false, reason: 'Expired' };
      if (promo.minOrderAmount && subtotal < promo.minOrderAmount) {
        return { eligible: false, reason: `Minimum order $${promo.minOrderAmount} required` };
      }
      if (promo.maxClaims && promo.claimCount >= promo.maxClaims) {
        return { eligible: false, reason: 'Claim limit reached' };
      }
      return { eligible: true };
    };

    it('should reject null promo', () => {
      expect(isPromoEligible(null, 50).eligible).toBe(false);
    });

    it('should reject already-used promo', () => {
      const promo = { used: true, validUntil: '2099-12-31' };
      expect(isPromoEligible(promo, 50).eligible).toBe(false);
      expect(isPromoEligible(promo, 50).reason).toBe('Already used');
    });

    it('should reject expired promo', () => {
      const promo = { validUntil: '2020-01-01', used: false };
      expect(isPromoEligible(promo, 50).eligible).toBe(false);
      expect(isPromoEligible(promo, 50).reason).toBe('Expired');
    });

    it('should reject when subtotal below minOrderAmount', () => {
      const promo = { validUntil: '2099-12-31', used: false, minOrderAmount: 25 };
      expect(isPromoEligible(promo, 10).eligible).toBe(false);
    });

    it('should reject when maxClaims reached', () => {
      const promo = { validUntil: '2099-12-31', used: false, maxClaims: 10, claimCount: 10 };
      expect(isPromoEligible(promo, 50).eligible).toBe(false);
    });

    it('should accept valid promo', () => {
      const promo = { validUntil: '2099-12-31', used: false, minOrderAmount: 10, maxClaims: 100, claimCount: 5 };
      expect(isPromoEligible(promo, 50).eligible).toBe(true);
    });

    it('should accept promo with no minOrderAmount', () => {
      const promo = { validUntil: '2099-12-31', used: false };
      expect(isPromoEligible(promo, 1).eligible).toBe(true);
    });

    it('should accept promo with unlimited claims (maxClaims=0)', () => {
      const promo = { validUntil: '2099-12-31', used: false, maxClaims: 0, claimCount: 999 };
      expect(isPromoEligible(promo, 50).eligible).toBe(true);
    });
  });
});
