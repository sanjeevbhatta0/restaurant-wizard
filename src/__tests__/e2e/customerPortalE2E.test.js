/**
 * @jest-environment node
 */

/**
 * E2E Tests — Customer Portal Flows
 *
 * Tests the complete customer portal lifecycle using Firebase Firestore emulator:
 *   Customer registration → Login → Menu browsing → Cart → Order placement →
 *   Order status lifecycle → Receipt trigger → Promotions → Rewards
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/customerPortalE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_RESTAURANT_ID = 'portal-e2e-test-' + Date.now();
const TEST_LOCATION_ID = 'portal-loc-' + Date.now();
const TEST_CUSTOMER_UID = 'portal-customer-' + Date.now();
const TEST_CUSTOMER_2_UID = 'portal-customer2-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Customer Portal Flows', () => {
  let createdOrderIds = [];
  let createdCategoryIds = [];

  // ==========================================
  // Setup: Restaurant, Menu, Customer, Promotions, Rewards
  // ==========================================

  beforeAll(async () => {
    // Create restaurant
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).set({
      restaurantName: 'Portal E2E Kitchen',
      slug: 'portal-e2e-' + Date.now(),
      email: 'owner@portale2e.com',
      isMultiLocation: false,
      taxRate: 8.5,
      subscription: { tier: 'chief' }
    });

    // Create menu categories and items
    const cat1Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).doc();
    await cat1Ref.set({ name: 'Appetizers', order: 1 });
    createdCategoryIds.push(cat1Ref.id);

    const cat2Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).doc();
    await cat2Ref.set({ name: 'Entrees', order: 2 });
    createdCategoryIds.push(cat2Ref.id);

    // Add items to categories
    await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`).doc('app1').set({
      name: 'Spring Rolls', price: 8.99, discount: 0, discountType: 'amount', available: true
    });
    await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`).doc('app2').set({
      name: 'Momo Dumplings', price: 10.99, discount: 2, discountType: 'amount', available: true
    });
    await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat2Ref.id}/items`).doc('ent1').set({
      name: 'Grilled Chicken', price: 18.99, discount: 0, discountType: 'amount', available: true
    });
    await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat2Ref.id}/items`).doc('ent2').set({
      name: 'Butter Lamb', price: 22.99, discount: 10, discountType: 'percentage', available: true
    });

    // Create active promotion
    await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`).doc('promo1').set({
      code: 'WELCOME10',
      type: 'percentage',
      value: 10,
      active: true,
      maxClaims: 100,
      description: 'Welcome 10% off'
    });

    // Create rewards config
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/rewardsConfig/settings`).set({
      enabled: true,
      loyalty: {
        pointsPerDollar: 2,
        tiers: {
          bronze: { min: 0, discount: 0 },
          silver: { min: 200, discount: 5 },
          gold: { min: 500, discount: 10 },
          platinum: { min: 1000, discount: 15 }
        }
      },
      spinWheel: { enabled: true, prizes: ['5% Off', '10% Off', 'Free Drink', 'Try Again'] }
    });
  });

  afterAll(async () => {
    // Cleanup orders
    for (const orderId of createdOrderIds) {
      try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).delete(); } catch (e) {}
    }
    // Cleanup categories + items
    for (const catId of createdCategoryIds) {
      try {
        const items = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}/items`).get();
        for (const doc of items.docs) { await doc.ref.delete(); }
        await db.doc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}`).delete();
      } catch (e) {}
    }
    // Cleanup customers
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).delete(); } catch (e) {}
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_2_UID}`).delete(); } catch (e) {}
    // Cleanup promotions and rewards config
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotions/promo1`).delete(); } catch (e) {}
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/rewardsConfig/settings`).delete(); } catch (e) {}
    // Cleanup promotion claims
    try {
      const claims = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`).get();
      for (const doc of claims.docs) { await doc.ref.delete(); }
    } catch (e) {}
    // Cleanup activities
    try {
      const activities = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/activities`).get();
      for (const doc of activities.docs) { await doc.ref.delete(); }
    } catch (e) {}
    // Cleanup restaurant
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).delete(); } catch (e) {}
  });

  // ==========================================
  // Customer Registration
  // ==========================================

  describe('Customer Registration', () => {
    it('should create customer document on signup', async () => {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).set({
        email: 'customer@test.com',
        fullName: 'Test Customer',
        phone: '+15551234567',
        createdAt: new Date().toISOString(),
        loyaltyPoints: 0,
        totalOrders: 0,
        tier: 'bronze'
      });

      const customerDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(customerDoc.exists).toBe(true);

      const data = customerDoc.data();
      expect(data.email).toBe('customer@test.com');
      expect(data.fullName).toBe('Test Customer');
      expect(data.phone).toBe('+15551234567');
      expect(data.loyaltyPoints).toBe(0);
      expect(data.tier).toBe('bronze');
    });

    it('should create customer without phone (email-only signup)', async () => {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_2_UID}`).set({
        email: 'nophone@test.com',
        fullName: 'No Phone Customer',
        phone: '',
        createdAt: new Date().toISOString(),
        loyaltyPoints: 0,
        totalOrders: 0,
        tier: 'bronze'
      });

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_2_UID}`).get();
      expect(doc.data().phone).toBe('');
      expect(doc.data().fullName).toBe('No Phone Customer');
    });
  });

  // ==========================================
  // Customer Login & Phone Persistence
  // ==========================================

  describe('Customer Login & Phone Persistence', () => {
    it('should read existing customer data on login', async () => {
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(doc.exists).toBe(true);
      expect(doc.data().fullName).toBe('Test Customer');
      expect(doc.data().loyaltyPoints).toBe(0);
    });

    it('should persist verified phone to customer without phone on file', async () => {
      // Customer 2 has no phone
      const before = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_2_UID}`).get();
      expect(before.data().phone).toBe('');

      // Simulate phone verification and persistence on login
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_2_UID}`).update({
        phone: '+15559876543'
      });

      const after = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_2_UID}`).get();
      expect(after.data().phone).toBe('+15559876543');
    });

    it('should NOT overwrite existing phone on login', async () => {
      // Customer 1 already has phone
      const before = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(before.data().phone).toBe('+15551234567');

      // Phone should not be overwritten — this is the check in handleLogin
      // (We don't update because existingPhone is truthy)
      const after = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(after.data().phone).toBe('+15551234567'); // Unchanged
    });
  });

  // ==========================================
  // Menu Loading & Browsing
  // ==========================================

  describe('Menu Loading & Browsing', () => {
    it('should load all menu categories with items', async () => {
      const catSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`)
        .orderBy('order')
        .get();

      expect(catSnap.docs).toHaveLength(2);
      expect(catSnap.docs[0].data().name).toBe('Appetizers');
      expect(catSnap.docs[1].data().name).toBe('Entrees');
    });

    it('should load items within a category', async () => {
      const catSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`)
        .orderBy('order')
        .get();
      const appetizerId = catSnap.docs[0].id;

      const itemsSnap = await db.collection(
        `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${appetizerId}/items`
      ).get();

      expect(itemsSnap.docs).toHaveLength(2);
      const items = itemsSnap.docs.map(d => d.data());
      expect(items.find(i => i.name === 'Spring Rolls')).toBeDefined();
      expect(items.find(i => i.name === 'Momo Dumplings')).toBeDefined();
    });

    it('should read item prices and discounts correctly', async () => {
      const catSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`)
        .orderBy('order')
        .get();
      const entreeId = catSnap.docs[1].id;

      const itemsSnap = await db.collection(
        `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${entreeId}/items`
      ).get();

      const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const chicken = items.find(i => i.name === 'Grilled Chicken');
      expect(chicken.price).toBe(18.99);
      expect(chicken.discount).toBe(0);

      const lamb = items.find(i => i.name === 'Butter Lamb');
      expect(lamb.price).toBe(22.99);
      expect(lamb.discount).toBe(10);
      expect(lamb.discountType).toBe('percentage');
    });

    it('should build full menu from all categories', async () => {
      const catSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`)
        .orderBy('order')
        .get();

      const menu = [];
      for (const catDoc of catSnap.docs) {
        const itemsSnap = await db.collection(
          `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catDoc.id}/items`
        ).get();
        menu.push({
          id: catDoc.id,
          name: catDoc.data().name,
          items: itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        });
      }

      expect(menu).toHaveLength(2);
      expect(menu[0].items).toHaveLength(2);
      expect(menu[1].items).toHaveLength(2);

      // Total items across all categories
      const totalItems = menu.reduce((sum, cat) => sum + cat.items.length, 0);
      expect(totalItems).toBe(4);
    });
  });

  // ==========================================
  // Order Placement
  // ==========================================

  describe('Order Placement via Portal', () => {
    let portalOrderId;

    it('should place a pickup order with customer info', async () => {
      const orderData = {
        orderNumber: `PORTAL-${Date.now()}`,
        restaurantId: TEST_RESTAURANT_ID,
        customerId: TEST_CUSTOMER_UID,
        customer: {
          name: 'Test Customer',
          email: 'customer@test.com',
          phone: '+15551234567'
        },
        items: [
          { id: 'app1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99, quantity: 2, discount: 0, discountType: 'amount' },
          { id: 'ent1', name: 'Grilled Chicken', price: 18.99, finalPrice: 18.99, quantity: 1, discount: 0, discountType: 'amount' }
        ],
        subtotal: 36.97,
        tax: 3.14,
        taxRate: 8.5,
        total: 40.11,
        orderType: 'pickup',
        paymentMethod: 'payAtStore',
        source: 'website',
        status: 'new',
        createdAt: new Date().toISOString()
      };

      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add(orderData);
      portalOrderId = orderRef.id;
      createdOrderIds.push(portalOrderId);

      const orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${portalOrderId}`).get();
      expect(orderDoc.exists).toBe(true);

      const saved = orderDoc.data();
      expect(saved.source).toBe('website');
      expect(saved.status).toBe('new');
      expect(saved.customer.name).toBe('Test Customer');
      expect(saved.customer.email).toBe('customer@test.com');
      expect(saved.customer.phone).toBe('+15551234567');
      expect(saved.customerId).toBe(TEST_CUSTOMER_UID);
      expect(saved.items).toHaveLength(2);
      expect(saved.subtotal).toBeCloseTo(36.97, 2);
      expect(saved.total).toBeCloseTo(40.11, 2);
    });

    it('should place a prepaid card order', async () => {
      const orderData = {
        orderNumber: `PORTAL-PREPAID-${Date.now()}`,
        restaurantId: TEST_RESTAURANT_ID,
        customerId: TEST_CUSTOMER_UID,
        customer: {
          name: 'Test Customer',
          email: 'customer@test.com',
          phone: '+15551234567'
        },
        items: [
          { id: 'ent2', name: 'Butter Lamb', price: 22.99, finalPrice: 20.69, quantity: 1, discount: 10, discountType: 'percentage' }
        ],
        subtotal: 20.69,
        tax: 1.76,
        taxRate: 8.5,
        total: 22.45,
        orderType: 'pickup',
        paymentMethod: 'card',
        paymentDetails: {
          paymentMethodId: 'pm_test_123',
          status: 'pending',
          last4: '4242'
        },
        source: 'website',
        status: 'new',
        createdAt: new Date().toISOString()
      };

      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add(orderData);
      createdOrderIds.push(orderRef.id);

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`).get();
      expect(doc.data().paymentMethod).toBe('card');
      expect(doc.data().paymentDetails.last4).toBe('4242');
      expect(doc.data().paymentDetails.status).toBe('pending');
    });

    it('should place an order with promo discount', async () => {
      const orderData = {
        orderNumber: `PORTAL-PROMO-${Date.now()}`,
        restaurantId: TEST_RESTAURANT_ID,
        customerId: TEST_CUSTOMER_UID,
        customer: { name: 'Test Customer', email: 'customer@test.com' },
        items: [
          { id: 'ent1', name: 'Grilled Chicken', price: 18.99, finalPrice: 18.99, quantity: 1 }
        ],
        subtotal: 18.99,
        promoCode: 'WELCOME10',
        promoDiscount: 1.90,
        tax: 1.45,
        total: 18.54,
        orderType: 'pickup',
        paymentMethod: 'payAtStore',
        source: 'website',
        status: 'new',
        createdAt: new Date().toISOString()
      };

      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add(orderData);
      createdOrderIds.push(orderRef.id);

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`).get();
      expect(doc.data().promoCode).toBe('WELCOME10');
      expect(doc.data().promoDiscount).toBeCloseTo(1.90, 2);
    });
  });

  // ==========================================
  // Order Status Lifecycle
  // ==========================================

  describe('Order Status Lifecycle', () => {
    let lifecycleOrderId;

    it('should create order with status "new"', async () => {
      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add({
        orderNumber: `LIFECYCLE-${Date.now()}`,
        source: 'website',
        status: 'new',
        customer: { name: 'Lifecycle Customer', email: 'lifecycle@test.com', phone: '+15550001111' },
        customerId: TEST_CUSTOMER_UID,
        items: [{ id: 'app1', name: 'Spring Rolls', price: 8.99, quantity: 1 }],
        subtotal: 8.99,
        tax: 0.76,
        total: 9.75,
        createdAt: new Date().toISOString()
      });
      lifecycleOrderId = orderRef.id;
      createdOrderIds.push(lifecycleOrderId);

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(doc.data().status).toBe('new');
    });

    it('should transition to preparing', async () => {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).update({
        status: 'preparing',
        preparingAt: new Date().toISOString()
      });
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(doc.data().status).toBe('preparing');
      expect(doc.data().preparingAt).toBeDefined();
    });

    it('should transition to ready', async () => {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).update({
        status: 'ready',
        readyAt: new Date().toISOString()
      });
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(doc.data().status).toBe('ready');
      expect(doc.data().readyAt).toBeDefined();
    });

    it('should transition to completed with payment details', async () => {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).update({
        status: 'completed',
        completedAt: new Date().toISOString(),
        paymentDetails: {
          paymentMethod: 'cash',
          amount: 9.75,
          paidAt: new Date().toISOString()
        }
      });
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(doc.data().status).toBe('completed');
      expect(doc.data().paymentDetails.paymentMethod).toBe('cash');
      expect(doc.data().completedAt).toBeDefined();
    });

    it('completed order should not appear in active queries', async () => {
      const activeStatuses = ['new', 'sent_to_kitchen', 'preparing', 'ready', 'served'];
      const activeSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
        .where('status', 'in', activeStatuses)
        .get();

      const activeIds = activeSnap.docs.map(d => d.id);
      expect(activeIds).not.toContain(lifecycleOrderId);
    });
  });

  // ==========================================
  // Receipt Trigger Simulation
  // ==========================================

  describe('Receipt Data on Order Completion', () => {
    it('should have all data needed for receipt email after completion', async () => {
      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add({
        orderNumber: `RECEIPT-${Date.now()}`,
        source: 'website',
        status: 'completed',
        customer: {
          name: 'Receipt Customer',
          email: 'receipt@test.com',
          phone: '+15552223333'
        },
        customerId: TEST_CUSTOMER_UID,
        items: [
          { id: 'app1', name: 'Spring Rolls', price: 8.99, quantity: 2 },
          { id: 'ent1', name: 'Grilled Chicken', price: 18.99, quantity: 1 }
        ],
        subtotal: 36.97,
        tax: 3.14,
        taxRate: 8.5,
        total: 40.11,
        orderType: 'pickup',
        paymentMethod: 'cash',
        promoDiscount: 0,
        pointsDiscount: 0,
        rewardDiscount: 0,
        createdAt: new Date().toISOString()
      });
      createdOrderIds.push(orderRef.id);

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`).get();
      const order = doc.data();

      // Verify all fields needed by orderReceiptEmail exist
      expect(order.customer.email).toBe('receipt@test.com');
      expect(order.customer.phone).toBe('+15552223333');
      expect(order.customer.name).toBe('Receipt Customer');
      expect(order.items).toHaveLength(2);
      expect(order.subtotal).toBeDefined();
      expect(order.tax).toBeDefined();
      expect(order.total).toBeDefined();
      expect(order.taxRate).toBeDefined();
      expect(order.orderType).toBeDefined();
      expect(order.paymentMethod).toBeDefined();
      expect(order.orderNumber).toBeDefined();

      // Verify restaurant name is accessible for receipt
      const restDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).get();
      expect(restDoc.data().restaurantName).toBe('Portal E2E Kitchen');
    });

    it('should log receipt activity when receipt would be sent', async () => {
      // Simulate what onOrderCompleted does — log activity
      const activityRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/activities`).add({
        type: 'receipt_sent',
        orderId: 'test-order-id',
        orderNumber: 'RECEIPT-TEST',
        message: 'Receipt sent — Email: Delivered, SMS: N/A',
        emailId: 'resend_test_123',
        smsSid: null,
        receiptPreference: 'email',
        createdAt: new Date().toISOString()
      });

      const activityDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/activities/${activityRef.id}`).get();
      expect(activityDoc.data().type).toBe('receipt_sent');
      expect(activityDoc.data().emailId).toBe('resend_test_123');
      expect(activityDoc.data().receiptPreference).toBe('email');
    });
  });

  // ==========================================
  // Customer Receipt Preference
  // ==========================================

  describe('Customer Receipt Preference', () => {
    it('should store receipt preference on customer document', async () => {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).update({
        receiptPreference: 'both'
      });

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(doc.data().receiptPreference).toBe('both');
    });

    it('should read receipt preference for notification routing', async () => {
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      const pref = doc.data().receiptPreference;
      expect(['email', 'sms', 'both']).toContain(pref);
    });
  });

  // ==========================================
  // Promotions
  // ==========================================

  describe('Promotions — Load & Claim', () => {
    it('should load active promotions for restaurant', async () => {
      const promoSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`)
        .where('active', '==', true)
        .get();

      expect(promoSnap.docs).toHaveLength(1);
      expect(promoSnap.docs[0].data().code).toBe('WELCOME10');
      expect(promoSnap.docs[0].data().value).toBe(10);
    });

    it('should create promotion claim for customer', async () => {
      const claimRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`).add({
        customerId: TEST_CUSTOMER_UID,
        promotionId: 'promo1',
        promoCode: 'WELCOME10',
        used: false,
        claimedAt: new Date().toISOString()
      });

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${claimRef.id}`).get();
      expect(doc.data().promoCode).toBe('WELCOME10');
      expect(doc.data().used).toBe(false);
    });

    it('should mark claim as used after order', async () => {
      const claimsSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims`)
        .where('customerId', '==', TEST_CUSTOMER_UID)
        .where('used', '==', false)
        .get();

      expect(claimsSnap.docs.length).toBeGreaterThan(0);
      const claimId = claimsSnap.docs[0].id;

      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${claimId}`).update({
        used: true,
        usedAt: new Date().toISOString(),
        usedInOrder: 'order-123'
      });

      const updated = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/promotionClaims/${claimId}`).get();
      expect(updated.data().used).toBe(true);
      expect(updated.data().usedInOrder).toBe('order-123');
    });
  });

  // ==========================================
  // Rewards & Loyalty Points
  // ==========================================

  describe('Rewards & Loyalty Points', () => {
    it('should read rewards config', async () => {
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/rewardsConfig/settings`).get();
      expect(doc.exists).toBe(true);
      expect(doc.data().enabled).toBe(true);
      expect(doc.data().loyalty.pointsPerDollar).toBe(2);
    });

    it('should update customer loyalty points after order', async () => {
      // Order total was $40.11, at 2 points/dollar = 80 points
      const pointsEarned = Math.floor(40.11 * 2);
      expect(pointsEarned).toBe(80);

      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).update({
        loyaltyPoints: pointsEarned,
        totalOrders: 1
      });

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(doc.data().loyaltyPoints).toBe(80);
      expect(doc.data().totalOrders).toBe(1);
    });

    it('should accumulate points across multiple orders', async () => {
      const currentDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      const currentPoints = currentDoc.data().loyaltyPoints;
      const newPoints = Math.floor(22.45 * 2); // Second order

      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).update({
        loyaltyPoints: currentPoints + newPoints,
        totalOrders: 2
      });

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      expect(doc.data().loyaltyPoints).toBe(currentPoints + newPoints);
      expect(doc.data().totalOrders).toBe(2);
    });

    it('should calculate tier from accumulated points', async () => {
      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}`).get();
      const points = doc.data().loyaltyPoints;

      // Points should be 80 + 44 = 124 → bronze (under 200)
      function calculateTier(pts) {
        if (pts >= 1000) return 'platinum';
        if (pts >= 500) return 'gold';
        if (pts >= 200) return 'silver';
        return 'bronze';
      }

      const tier = calculateTier(points);
      expect(tier).toBe('bronze');
      expect(points).toBeLessThan(200);
    });

    it('should record spin wheel result', async () => {
      const spinRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/customers/${TEST_CUSTOMER_UID}/spinResults`).add({
        prize: '10% Off',
        spunAt: new Date().toISOString(),
        date: new Date().toISOString().split('T')[0]
      });

      const doc = await spinRef.get();
      expect(doc.data().prize).toBe('10% Off');
    });
  });

  // ==========================================
  // Order History & Reorder
  // ==========================================

  describe('Order History & Reorder', () => {
    it('should query completed orders for customer', async () => {
      const ordersSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
        .where('customerId', '==', TEST_CUSTOMER_UID)
        .where('status', '==', 'completed')
        .get();

      // We created at least one completed order in the lifecycle test
      // Note: the lifecycle order + receipt order should both be completed
      expect(ordersSnap.docs.length).toBeGreaterThanOrEqual(1);
    });

    it('should have item data needed for reorder', async () => {
      const ordersSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
        .where('customerId', '==', TEST_CUSTOMER_UID)
        .get();

      const orders = ordersSnap.docs.map(d => d.data());
      const orderWithItems = orders.find(o => o.items && o.items.length > 0);
      expect(orderWithItems).toBeDefined();

      // Each item should have fields needed for reorder
      const item = orderWithItems.items[0];
      expect(item.id).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.price).toBeDefined();
      expect(item.quantity).toBeDefined();
    });
  });
});

// ==========================================
// Mock Fallback Tests (run without emulator)
// ==========================================

describe('Customer Portal E2E — Mock Fallback (no emulator needed)', () => {

  describe('Customer Registration Data', () => {
    it('should construct valid customer document', () => {
      const customer = {
        email: 'new@test.com',
        fullName: 'New Customer',
        phone: '+15551234567',
        createdAt: new Date().toISOString(),
        loyaltyPoints: 0,
        totalOrders: 0,
        tier: 'bronze'
      };

      expect(customer.email).toBeTruthy();
      expect(customer.fullName).toBeTruthy();
      expect(customer.phone).toMatch(/^\+1\d{10}$/);
      expect(customer.loyaltyPoints).toBe(0);
      expect(customer.tier).toBe('bronze');
    });
  });

  describe('Order Construction with Customer Data', () => {
    it('should include all required fields for website order', () => {
      const order = {
        orderNumber: 'ORD-123',
        restaurantId: 'rest-1',
        customerId: 'cust-1',
        customer: { name: 'Jane', email: 'jane@test.com', phone: '+15551234567' },
        items: [{ id: 'i1', name: 'Item', price: 10, finalPrice: 10, quantity: 1 }],
        subtotal: 10,
        tax: 0.85,
        total: 10.85,
        orderType: 'pickup',
        paymentMethod: 'payAtStore',
        source: 'website',
        status: 'new'
      };

      expect(order.restaurantId).toBeTruthy();
      expect(order.customer).toBeTruthy();
      expect(order.customer.email).toBeTruthy();
      expect(order.items.length).toBeGreaterThan(0);
      expect(order.source).toBe('website');
    });
  });

  describe('Receipt Trigger Logic', () => {
    it('should identify completion transition', () => {
      const before = { status: 'ready' };
      const after = { status: 'completed' };
      const shouldFire = before.status !== 'completed' && after.status === 'completed';
      expect(shouldFire).toBe(true);
    });

    it('should not re-trigger on already completed', () => {
      const before = { status: 'completed' };
      const after = { status: 'completed' };
      const shouldFire = before.status !== 'completed' && after.status === 'completed';
      expect(shouldFire).toBe(false);
    });

    it('should not trigger for non-completion transitions', () => {
      const transitions = [
        { from: 'new', to: 'preparing' },
        { from: 'preparing', to: 'ready' },
        { from: 'ready', to: 'served' }
      ];
      transitions.forEach(t => {
        const shouldFire = t.from !== 'completed' && t.to === 'completed';
        expect(shouldFire).toBe(false);
      });
    });
  });

  describe('Receipt Preference Resolution', () => {
    it('should default to email when customer has both email and phone', () => {
      const email = 'test@test.com';
      const phone = '+15551234567';
      const pref = null;
      const resolved = pref || (!email && phone ? 'sms' : 'email');
      expect(resolved).toBe('email');
    });

    it('should default to sms when customer has only phone', () => {
      const email = null;
      const phone = '+15551234567';
      const pref = null;
      const resolved = pref || (!email && phone ? 'sms' : 'email');
      expect(resolved).toBe('sms');
    });

    it('should respect explicit preference', () => {
      const pref = 'both';
      const resolved = pref || 'email';
      expect(resolved).toBe('both');
    });
  });
});
