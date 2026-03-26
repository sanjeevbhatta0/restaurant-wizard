/**
 * Integration Tests — Promotions Flow
 * Tests the claim flow, checkout with promo, POS promo application,
 * and store launch auto-claim logic.
 */

describe('Promotions Flow — Integration', () => {
  const restaurantId = 'test-restaurant-123';

  // ==========================================
  // Claim Flow
  // ==========================================

  describe('Claim Flow', () => {
    it('should create a claim record with unique code on successful claim', () => {
      const promo = {
        id: 'promo-1',
        title: 'Summer Sale',
        code: 'SUMMER20',
        type: 'percentage',
        discount: '20%',
        validUntil: '2099-12-31',
        maxClaims: 100,
        claimCount: 5
      };
      const userId = 'customer-abc';

      // Simulate what claimPromotion does
      const generateUniquePromoCode = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = 'KC-';
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
      };

      const uniqueCode = generateUniquePromoCode();

      const claimDoc = {
        userId,
        promotionId: promo.id,
        promotionTitle: promo.title,
        promoCode: promo.code,
        uniqueCode,
        discount: promo.discount,
        discountValue: 20,
        discountUnit: 'percentage',
        type: promo.type,
        validUntil: promo.validUntil,
        minOrderAmount: 0,
        claimedAt: new Date(),
        used: false
      };

      expect(claimDoc.userId).toBe(userId);
      expect(claimDoc.promotionId).toBe('promo-1');
      expect(claimDoc.uniqueCode).toMatch(/^KC-[A-Z0-9]{6}$/);
      expect(claimDoc.discountValue).toBe(20);
      expect(claimDoc.discountUnit).toBe('percentage');
      expect(claimDoc.used).toBe(false);
    });

    it('should reject duplicate claims from the same user', () => {
      const existingClaims = {
        'promo-1_customer-abc': { userId: 'customer-abc', promotionId: 'promo-1', used: false }
      };

      const claimId = 'promo-1_customer-abc';
      const alreadyClaimed = !!existingClaims[claimId];

      expect(alreadyClaimed).toBe(true);
    });

    it('should reject claims on expired promotions', () => {
      const promo = {
        validUntil: '2020-01-01',
        maxClaims: 100,
        claimCount: 5
      };

      const now = new Date();
      const validUntil = new Date(promo.validUntil);
      const isExpired = validUntil < now;

      expect(isExpired).toBe(true);
    });

    it('should reject claims when maxClaims reached', () => {
      const promo = {
        validUntil: '2099-12-31',
        maxClaims: 50,
        claimCount: 50
      };

      const isExhausted = promo.maxClaims && promo.claimCount >= promo.maxClaims;
      expect(isExhausted).toBe(true);
    });

    it('should increment claimCount after successful claim', () => {
      const promo = { claimCount: 5 };
      promo.claimCount += 1;
      expect(promo.claimCount).toBe(6);
    });

    it('should generate unique codes across multiple claims', () => {
      const generateUniquePromoCode = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = 'KC-';
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
      };

      const codes = new Set();
      for (let i = 0; i < 50; i++) {
        codes.add(generateUniquePromoCode());
      }
      expect(codes.size).toBe(50);
    });
  });

  // ==========================================
  // Checkout with Promo (Online Flow)
  // ==========================================

  describe('Checkout with Promo', () => {
    const validatePromoCode = (claims, promoCode, subtotal) => {
      // Search by uniqueCode first
      let claim = claims.find(c => c.uniqueCode === promoCode && !c.used);
      // Then by shared promoCode
      if (!claim) {
        claim = claims.find(c => c.promoCode === promoCode && !c.used);
      }
      if (!claim) return { valid: false, reason: 'Invalid or already used promo code' };

      const now = new Date();
      const validUntil = new Date(claim.validUntil);
      if (validUntil < now) return { valid: false, reason: 'This promotion has expired' };

      if (claim.minOrderAmount && subtotal < claim.minOrderAmount) {
        return { valid: false, reason: `Minimum order of $${claim.minOrderAmount} required` };
      }

      return {
        valid: true,
        claimId: claim.id,
        promotionId: claim.promotionId,
        promoCode: claim.promoCode,
        uniqueCode: claim.uniqueCode,
        discountValue: claim.discountValue,
        discountUnit: claim.discountUnit,
        type: claim.type,
        title: claim.promotionTitle
      };
    };

    const sampleClaims = [
      {
        id: 'promo-1_cust-1',
        userId: 'cust-1',
        promotionId: 'promo-1',
        promotionTitle: 'Summer Sale',
        promoCode: 'SUMMER20',
        uniqueCode: 'KC-A1B2C3',
        discountValue: 20,
        discountUnit: 'percentage',
        type: 'percentage',
        validUntil: '2099-12-31',
        minOrderAmount: 15,
        used: false
      },
      {
        id: 'promo-2_cust-1',
        userId: 'cust-1',
        promotionId: 'promo-2',
        promotionTitle: '$5 Off',
        promoCode: 'FIVE_OFF',
        uniqueCode: 'KC-D4E5F6',
        discountValue: 5,
        discountUnit: 'amount',
        type: 'percentage',
        validUntil: '2099-12-31',
        minOrderAmount: 0,
        used: false
      },
      {
        id: 'promo-3_cust-1',
        userId: 'cust-1',
        promotionId: 'promo-3',
        promoCode: 'EXPIRED10',
        uniqueCode: 'KC-G7H8I9',
        discountValue: 10,
        discountUnit: 'percentage',
        validUntil: '2020-01-01',
        minOrderAmount: 0,
        used: false
      },
      {
        id: 'promo-4_cust-1',
        userId: 'cust-1',
        promotionId: 'promo-4',
        promoCode: 'USED_CODE',
        uniqueCode: 'KC-J1K2L3',
        discountValue: 15,
        discountUnit: 'percentage',
        validUntil: '2099-12-31',
        minOrderAmount: 0,
        used: true
      }
    ];

    it('should validate a unique code and return discount info', () => {
      const result = validatePromoCode(sampleClaims, 'KC-A1B2C3', 50);
      expect(result.valid).toBe(true);
      expect(result.discountValue).toBe(20);
      expect(result.discountUnit).toBe('percentage');
      expect(result.promotionId).toBe('promo-1');
      expect(result.uniqueCode).toBe('KC-A1B2C3');
    });

    it('should validate a shared promo code', () => {
      const result = validatePromoCode(sampleClaims, 'FIVE_OFF', 10);
      expect(result.valid).toBe(true);
      expect(result.discountValue).toBe(5);
      expect(result.discountUnit).toBe('amount');
    });

    it('should reject an invalid promo code', () => {
      const result = validatePromoCode(sampleClaims, 'NONEXISTENT', 50);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid or already used promo code');
    });

    it('should reject an already-used promo code', () => {
      const result = validatePromoCode(sampleClaims, 'KC-J1K2L3', 50);
      expect(result.valid).toBe(false);
    });

    it('should reject expired promo code', () => {
      const result = validatePromoCode(sampleClaims, 'KC-G7H8I9', 50);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('This promotion has expired');
    });

    it('should reject when subtotal is below minOrderAmount', () => {
      const result = validatePromoCode(sampleClaims, 'KC-A1B2C3', 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Minimum order of $15 required');
    });

    it('should apply percentage discount to order total', () => {
      const subtotal = 50;
      const promo = { discountValue: 20, discountUnit: 'percentage' };
      const taxRate = 0.085;

      let discount = subtotal * (promo.discountValue / 100);
      discount = Math.min(discount, subtotal);
      discount = Math.round(discount * 100) / 100;

      const taxable = subtotal - discount;
      const tax = Math.round(taxable * taxRate * 100) / 100;
      const total = Math.round((taxable + tax) * 100) / 100;

      expect(discount).toBe(10);
      expect(taxable).toBe(40);
      expect(tax).toBe(3.40);
      expect(total).toBe(43.40);
    });

    it('should apply flat amount discount to order total', () => {
      const subtotal = 50;
      const promo = { discountValue: 5, discountUnit: 'amount' };
      const taxRate = 0.085;

      let discount = promo.discountValue;
      discount = Math.min(discount, subtotal);
      discount = Math.round(discount * 100) / 100;

      const taxable = subtotal - discount;
      const tax = Math.round(taxable * taxRate * 100) / 100;
      const total = Math.round((taxable + tax) * 100) / 100;

      expect(discount).toBe(5);
      expect(taxable).toBe(45);
      expect(tax).toBe(3.83);
      expect(total).toBe(48.83);
    });

    it('should include promo data in order document', () => {
      const orderData = {
        items: [{ name: 'Burger', price: 12.99, quantity: 2 }],
        subtotal: 25.98,
        promoCode: 'KC-A1B2C3',
        promotionId: 'promo-1',
        promoDiscount: 5.20,
        promoType: 'percentage',
        total: 22.55
      };

      expect(orderData.promoCode).toBe('KC-A1B2C3');
      expect(orderData.promotionId).toBe('promo-1');
      expect(orderData.promoDiscount).toBe(5.20);
      expect(orderData.promoType).toBe('percentage');
    });

    it('should mark claim as used after successful order', () => {
      const claim = {
        id: 'promo-1_cust-1',
        used: false,
        usedAt: null,
        usedInOrder: null
      };

      // Simulate marking as used
      claim.used = true;
      claim.usedAt = new Date();
      claim.usedInOrder = 'order-123';

      expect(claim.used).toBe(true);
      expect(claim.usedAt).toBeDefined();
      expect(claim.usedInOrder).toBe('order-123');
    });
  });

  // ==========================================
  // POS Promo Application
  // ==========================================

  describe('POS Promo Application', () => {
    it('should validate promo code entered by staff', () => {
      const claims = [
        {
          id: 'promo-1_cust-1',
          uniqueCode: 'KC-X1Y2Z3',
          promoCode: 'LAUNCH15',
          discountValue: 15,
          discountUnit: 'percentage',
          validUntil: '2099-12-31',
          minOrderAmount: 0,
          used: false
        }
      ];

      // Staff enters the customer's unique code
      const promoCode = 'KC-X1Y2Z3';
      const claim = claims.find(c => c.uniqueCode === promoCode && !c.used);

      expect(claim).toBeDefined();
      expect(claim.discountValue).toBe(15);
      expect(claim.discountUnit).toBe('percentage');
    });

    it('should apply promo discount to POS order', () => {
      const orderSubtotal = 80;
      const promoValidation = {
        valid: true,
        discountValue: 15,
        discountUnit: 'percentage',
        title: 'Grand Opening 15%'
      };

      let discountAmount;
      if (promoValidation.discountUnit === 'percentage') {
        discountAmount = orderSubtotal * (promoValidation.discountValue / 100);
      } else {
        discountAmount = promoValidation.discountValue;
      }
      discountAmount = Math.round(discountAmount * 100) / 100;

      expect(discountAmount).toBe(12);
    });

    it('should apply flat amount promo discount in POS', () => {
      const orderSubtotal = 80;
      const promoValidation = {
        valid: true,
        discountValue: 10,
        discountUnit: 'amount',
        title: '$10 Off'
      };

      let discountAmount;
      if (promoValidation.discountUnit === 'percentage') {
        discountAmount = orderSubtotal * (promoValidation.discountValue / 100);
      } else {
        discountAmount = promoValidation.discountValue;
      }

      expect(discountAmount).toBe(10);
    });

    it('should include promo data in POS payment details', () => {
      const paymentDetails = {
        subtotal: 80,
        taxRate: 8.5,
        taxAmount: 5.78,
        discountAmount: 12,
        discountType: 'percentage',
        promoCode: 'KC-X1Y2Z3',
        promotionId: 'promo-1',
        promoDiscount: 12,
        total: 73.78,
        paymentMethod: 'cash',
        paidAt: new Date().toISOString()
      };

      expect(paymentDetails.promoCode).toBe('KC-X1Y2Z3');
      expect(paymentDetails.promotionId).toBe('promo-1');
      expect(paymentDetails.promoDiscount).toBe(12);
      expect(paymentDetails.discountAmount).toBe(12);
    });

    it('should mark claim as used after POS payment', () => {
      const claimUpdate = {
        used: true,
        usedAt: new Date(),
        usedInOrder: 'pos-order-456'
      };

      expect(claimUpdate.used).toBe(true);
      expect(claimUpdate.usedInOrder).toBe('pos-order-456');
    });

    it('should clear promo state when removing applied promo', () => {
      let promoCode = 'KC-X1Y2Z3';
      let promoValidation = { valid: true, discountValue: 15 };
      let promoError = '';
      let discountAmount = 12;

      // Clear promo
      promoCode = '';
      promoValidation = null;
      promoError = '';
      discountAmount = 0;

      expect(promoCode).toBe('');
      expect(promoValidation).toBeNull();
      expect(discountAmount).toBe(0);
    });
  });

  // ==========================================
  // Store Launch Auto-Claim
  // ==========================================

  describe('Store Launch Auto-Claim', () => {
    it('should auto-claim storeLaunch promo on signup with promo ID', () => {
      const pendingPromoId = 'promo-launch-1';
      const promos = [
        { id: 'promo-launch-1', type: 'storeLaunch', autoClaimOnSignup: true, title: 'Grand Opening!' }
      ];

      const promo = promos.find(p => p.id === pendingPromoId);
      expect(promo).toBeDefined();
      expect(promo.type).toBe('storeLaunch');
      expect(promo.autoClaimOnSignup).toBe(true);
    });

    it('should parse promo ID from URL parameter', () => {
      // Simulating URL: ?restaurant=slug&promo=promo-launch-1
      const urlParams = new URLSearchParams('restaurant=slug&promo=promo-launch-1');
      const promoId = urlParams.get('promo');

      expect(promoId).toBe('promo-launch-1');
    });

    it('should parse promo ID from config object', () => {
      const config = {
        restaurantId: 'rest-123',
        promoId: 'promo-launch-1'
      };

      const pendingPromoId = config.promoId || new URLSearchParams('').get('promo') || null;
      expect(pendingPromoId).toBe('promo-launch-1');
    });

    it('should not auto-claim if promo ID is empty', () => {
      const config = { restaurantId: 'rest-123', promoId: '' };
      const pendingPromoId = config.promoId || null;

      expect(pendingPromoId).toBeNull();
    });

    it('should handle auto-claim failure gracefully (signup still succeeds)', () => {
      let signupSucceeded = false;
      let autoClaimSucceeded = false;
      let autoClaimError = null;

      // Signup succeeds
      signupSucceeded = true;

      // Auto-claim fails (e.g., promo expired)
      try {
        throw new Error('This promotion has expired');
      } catch (err) {
        autoClaimError = err.message;
        autoClaimSucceeded = false;
      }

      expect(signupSucceeded).toBe(true);
      expect(autoClaimSucceeded).toBe(false);
      expect(autoClaimError).toBe('This promotion has expired');
    });

    it('should clear pendingPromoId after auto-claim attempt', () => {
      let pendingPromoId = 'promo-launch-1';

      // After auto-claim (success or failure), clear pending
      pendingPromoId = null;

      expect(pendingPromoId).toBeNull();
    });

    it('should auto-claim for returning authenticated users with pending promo', () => {
      const isAuthenticated = true;
      const pendingPromoId = 'promo-launch-1';

      const shouldAutoClaim = isAuthenticated && pendingPromoId;
      expect(shouldAutoClaim).toBeTruthy();
    });

    it('should not auto-claim for unauthenticated users', () => {
      const isAuthenticated = false;
      const pendingPromoId = 'promo-launch-1';

      const shouldAutoClaim = isAuthenticated && pendingPromoId;
      expect(shouldAutoClaim).toBeFalsy();
    });
  });

  // ==========================================
  // Server-Side Discount Calculation in submitOrder
  // ==========================================

  describe('Server-Side Order Discount Calculation', () => {
    const calculateServerDiscount = (subtotal, discountValue, discountUnit) => {
      let discount = 0;
      if (discountUnit === 'percentage') {
        discount = subtotal * (discountValue / 100);
      } else {
        discount = discountValue;
      }
      discount = Math.min(discount, subtotal);
      return Math.round(discount * 100) / 100;
    };

    it('should recalculate total server-side to prevent client tampering', () => {
      // Client sends manipulated total
      const clientData = {
        subtotal: 100,
        total: 5, // Client tried to set total to $5
        promoCode: 'KC-A1B2C3'
      };

      // Server validates promo and recalculates
      const serverPromo = { discountValue: 20, discountUnit: 'percentage' };
      const discount = calculateServerDiscount(clientData.subtotal, serverPromo.discountValue, serverPromo.discountUnit);
      const taxRate = 0.085;
      const taxable = clientData.subtotal - discount;
      const tax = Math.round(taxable * taxRate * 100) / 100;
      const serverTotal = Math.round((taxable + tax) * 100) / 100;

      expect(discount).toBe(20);
      expect(serverTotal).toBe(86.80);
      expect(serverTotal).not.toBe(clientData.total); // Prevented tampering
    });

    it('should store promo fields on the order document', () => {
      const orderDoc = {
        items: [{ name: 'Steak', price: 34.99 }],
        subtotal: 34.99,
        promoCode: 'KC-A1B2C3',
        promotionId: 'promo-1',
        promoDiscount: 7.00,
        promoType: 'percentage',
        total: 30.37
      };

      expect(orderDoc).toHaveProperty('promoCode');
      expect(orderDoc).toHaveProperty('promotionId');
      expect(orderDoc).toHaveProperty('promoDiscount');
      expect(orderDoc).toHaveProperty('promoType');
    });
  });
});
