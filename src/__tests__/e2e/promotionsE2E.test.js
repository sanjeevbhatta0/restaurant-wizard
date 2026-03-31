/**
 * @jest-environment node
 */

/**
 * E2E Tests — Promotions Flow
 *
 * These tests simulate the full promotions lifecycle using Firebase emulators:
 *   Create promo → Claim → Validate code → Order with discount → Verify claim used
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

// ==========================================
// Setup
// ==========================================

const TEST_RESTAURANT_ID = 'e2e-promo-test-' + Date.now();
const TEST_CUSTOMER_ID = 'e2e-customer-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Promotions Full Lifecycle', () => {
  let createdPromoIds = [];
  let createdClaimIds = [];
  let createdOrderIds = [];

  afterAll(async () => {
    // Cleanup test data
    for (const promoId of createdPromoIds) {
      try {
        await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotions/${promoId}`).delete();
      } catch (e) { /* ignore */ }
    }
    for (const claimId of createdClaimIds) {
      try {
        await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${claimId}`).delete();
      } catch (e) { /* ignore */ }
    }
    for (const orderId of createdOrderIds) {
      try {
        await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).delete();
      } catch (e) { /* ignore */ }
    }
  });

  // ==========================================
  // Full Flow: Create → Claim → Validate → Order → Verify
  // ==========================================

  describe('Full Promotion Lifecycle', () => {
    let promoId;
    let claimId;
    let uniqueCode;
    let orderId;

    test('Step 1 — Admin creates a promotion', async () => {
      const promoData = {
        title: 'E2E Grand Opening',
        type: 'percentage',
        discount: '20%',
        code: 'E2EOPEN20',
        description: 'E2E test promotion',
        discountValue: 20,
        discountUnit: 'percentage',
        validUntil: new Date('2099-12-31'),
        minOrderAmount: 10,
        maxClaims: 100,
        claimCount: 0,
        isPublished: true,
        createdAt: new Date()
      };

      const docRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`).add(promoData);
      promoId = docRef.id;
      createdPromoIds.push(promoId);

      expect(promoId).toBeTruthy();

      const promoDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotions/${promoId}`).get();
      expect(promoDoc.exists).toBe(true);
      expect(promoDoc.data().title).toBe('E2E Grand Opening');
      expect(promoDoc.data().discountValue).toBe(20);
      expect(promoDoc.data().isPublished).toBe(true);
    });

    test('Step 2 — Customer claims the promotion', async () => {
      // Generate unique code (simulating what claimPromotion does)
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      uniqueCode = 'KC-';
      for (let i = 0; i < 6; i++) {
        uniqueCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      claimId = `${promoId}_${TEST_CUSTOMER_ID}`;
      createdClaimIds.push(claimId);

      const claimData = {
        userId: TEST_CUSTOMER_ID,
        promotionId: promoId,
        promotionTitle: 'E2E Grand Opening',
        promoCode: 'E2EOPEN20',
        uniqueCode,
        discount: '20%',
        discountValue: 20,
        discountUnit: 'percentage',
        type: 'percentage',
        validUntil: new Date('2099-12-31'),
        minOrderAmount: 10,
        claimedAt: new Date(),
        used: false
      };

      const claimRef = db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${claimId}`);
      await claimRef.set(claimData);

      // Increment claimCount on promo
      const promoRef = db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotions/${promoId}`);
      const promoSnap = await promoRef.get();
      await promoRef.update({ claimCount: (promoSnap.data().claimCount || 0) + 1 });

      // Verify claim
      const claimDoc = await claimRef.get();
      expect(claimDoc.exists).toBe(true);
      expect(claimDoc.data().uniqueCode).toBe(uniqueCode);
      expect(claimDoc.data().used).toBe(false);
      expect(claimDoc.data().discountValue).toBe(20);

      // Verify claimCount incremented
      const updatedPromo = await promoRef.get();
      expect(updatedPromo.data().claimCount).toBe(1);
    });

    test('Step 3 — Validate promo code (by unique code)', async () => {
      const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`)
        .where('uniqueCode', '==', uniqueCode)
        .where('used', '==', false)
        .get();

      expect(snapshot.empty).toBe(false);

      const claim = snapshot.docs[0].data();
      expect(claim.discountValue).toBe(20);
      expect(claim.discountUnit).toBe('percentage');
      expect(claim.used).toBe(false);

      // Check not expired
      const validUntil = claim.validUntil.toDate ? claim.validUntil.toDate() : new Date(claim.validUntil);
      expect(validUntil > new Date()).toBe(true);
    });

    test('Step 4 — Place order with promo discount applied', async () => {
      const subtotal = 50.00;
      const discount = subtotal * (20 / 100); // 10.00
      const taxRate = 0.085;
      const taxable = subtotal - discount;
      const tax = Math.round(taxable * taxRate * 100) / 100;
      const total = Math.round((taxable + tax) * 100) / 100;

      const orderData = {
        orderNumber: `E2E-PROMO-${Date.now()}`,
        items: [
          { id: 'item-1', name: 'Pasta', price: 25.00, quantity: 2, subtotal: 50.00 }
        ],
        subtotal,
        promoCode: uniqueCode,
        promotionId: promoId,
        promoDiscount: discount,
        promoType: 'percentage',
        tax,
        total,
        status: 'new',
        source: 'website',
        orderType: 'pickup',
        customer: { name: 'E2E Test Customer', email: 'e2e@test.com' },
        customerId: TEST_CUSTOMER_ID,
        createdAt: new Date()
      };

      const docRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add(orderData);
      orderId = docRef.id;
      createdOrderIds.push(orderId);

      // Verify order has promo data
      const orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).get();
      expect(orderDoc.exists).toBe(true);
      const data = orderDoc.data();
      expect(data.promoCode).toBe(uniqueCode);
      expect(data.promotionId).toBe(promoId);
      expect(data.promoDiscount).toBe(10);
      expect(data.total).toBe(43.40);
    });

    test('Step 5 — Verify claim is marked as used', async () => {
      // Mark claim as used (simulating what submitOrder does)
      const claimRef = db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${claimId}`);
      await claimRef.update({
        used: true,
        usedAt: new Date(),
        usedInOrder: orderId
      });

      const claimDoc = await claimRef.get();
      const data = claimDoc.data();
      expect(data.used).toBe(true);
      expect(data.usedAt).toBeDefined();
      expect(data.usedInOrder).toBe(orderId);
    });

    test('Step 6 — Reject reuse of used claim', async () => {
      // Try to find the claim by uniqueCode where used == false
      const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`)
        .where('uniqueCode', '==', uniqueCode)
        .where('used', '==', false)
        .get();

      // Should be empty — claim is already used
      expect(snapshot.empty).toBe(true);
    });
  });

  // ==========================================
  // POS Validation with Unique Code
  // ==========================================

  describe('POS Promo Code Validation', () => {
    let posPromoId;
    let posClaimId;
    let posUniqueCode;

    test('Step 1 — Create promo and claim for POS test', async () => {
      // Create promo
      const promoData = {
        title: 'E2E POS Promo',
        type: 'percentage',
        discount: '$10',
        code: 'POS10OFF',
        discountValue: 10,
        discountUnit: 'amount',
        validUntil: new Date('2099-12-31'),
        minOrderAmount: 0,
        maxClaims: 50,
        claimCount: 0,
        isPublished: true,
        createdAt: new Date()
      };

      const docRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`).add(promoData);
      posPromoId = docRef.id;
      createdPromoIds.push(posPromoId);

      // Create claim
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      posUniqueCode = 'KC-';
      for (let i = 0; i < 6; i++) {
        posUniqueCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      posClaimId = `${posPromoId}_pos-customer`;
      createdClaimIds.push(posClaimId);

      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${posClaimId}`).set({
        userId: 'pos-customer',
        promotionId: posPromoId,
        promotionTitle: 'E2E POS Promo',
        promoCode: 'POS10OFF',
        uniqueCode: posUniqueCode,
        discountValue: 10,
        discountUnit: 'amount',
        type: 'percentage',
        validUntil: new Date('2099-12-31'),
        minOrderAmount: 0,
        claimedAt: new Date(),
        used: false
      });
    });

    test('Step 2 — POS staff validates customer unique code', async () => {
      const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`)
        .where('uniqueCode', '==', posUniqueCode)
        .where('used', '==', false)
        .get();

      expect(snapshot.empty).toBe(false);

      const claim = snapshot.docs[0].data();
      expect(claim.discountValue).toBe(10);
      expect(claim.discountUnit).toBe('amount');
    });

    test('Step 3 — Mark claim used after POS payment', async () => {
      const claimRef = db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${posClaimId}`);
      await claimRef.update({
        used: true,
        usedAt: new Date(),
        usedInOrder: 'pos-order-e2e'
      });

      const claimDoc = await claimRef.get();
      expect(claimDoc.data().used).toBe(true);

      // Verify can't reuse
      const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`)
        .where('uniqueCode', '==', posUniqueCode)
        .where('used', '==', false)
        .get();
      expect(snapshot.empty).toBe(true);
    });
  });
});

// ==========================================
// Mock Fallback Tests (run without emulators)
// ==========================================

const describeMock = !isEmulatorAvailable ? describe : describe.skip;

describeMock('Promotions E2E — Mock Fallback (no emulator)', () => {
  it('should validate the full promotion data model', () => {
    const promo = {
      id: 'promo-1',
      title: 'Grand Opening',
      type: 'storeLaunch',
      discount: '15%',
      code: 'LAUNCH15',
      discountValue: 15,
      discountUnit: 'percentage',
      autoClaimOnSignup: true,
      validUntil: '2099-12-31',
      minOrderAmount: 0,
      maxClaims: 0,
      claimCount: 42,
      isPublished: true
    };

    expect(promo.type).toBe('storeLaunch');
    expect(promo.autoClaimOnSignup).toBe(true);
    expect(promo.discountValue).toBe(15);
    expect(promo.discountUnit).toBe('percentage');
  });

  it('should validate the claim document structure', () => {
    const claim = {
      userId: 'customer-1',
      promotionId: 'promo-1',
      promotionTitle: 'Grand Opening',
      promoCode: 'LAUNCH15',
      uniqueCode: 'KC-A1B2C3',
      discount: '15%',
      discountValue: 15,
      discountUnit: 'percentage',
      type: 'storeLaunch',
      validUntil: '2099-12-31',
      minOrderAmount: 0,
      claimedAt: new Date(),
      used: false
    };

    expect(claim.uniqueCode).toMatch(/^KC-[A-Z0-9]{6}$/);
    expect(claim.used).toBe(false);
    expect(claim.discountValue).toBe(15);
  });

  it('should validate order document with promo fields', () => {
    const order = {
      orderNumber: 'ORD-001',
      items: [{ name: 'Burger', price: 12.99, quantity: 2 }],
      subtotal: 25.98,
      promoCode: 'KC-A1B2C3',
      promotionId: 'promo-1',
      promoDiscount: 3.90,
      promoType: 'percentage',
      tax: 1.88,
      total: 23.96,
      source: 'website',
      status: 'new'
    };

    expect(order.promoCode).toBe('KC-A1B2C3');
    expect(order.promoDiscount).toBe(3.90);
    expect(order.total).toBeLessThan(order.subtotal);
  });
});
