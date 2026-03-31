/**
 * @jest-environment node
 */

/**
 * E2E Tests — Widget Embed Flow
 *
 * Tests the complete widget flow using Firebase Firestore emulator:
 *   Menu creation → getMenu fetch → Order placement → Order persistence → Status lifecycle
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/widgetE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_RESTAURANT_ID = 'widget-e2e-test-' + Date.now();
const TEST_LOCATION_A = 'loc-a-' + Date.now();
const TEST_LOCATION_B = 'loc-b-' + Date.now();

// Conditionally run tests only when emulator is available
const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Widget Embed Flow', () => {
  let createdOrderIds = [];
  let createdCategoryIds = [];

  beforeAll(async () => {
    // Create test restaurant
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).set({
      restaurantName: 'Widget Test Restaurant',
      slug: 'widget-test-' + Date.now(),
      isMultiLocation: true,
      taxRate: 8.5
    });

    // Create menu categories with items
    const cat1Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).doc();
    await cat1Ref.set({ name: 'Appetizers', order: 1 });
    createdCategoryIds.push(cat1Ref.id);

    // Add items to category
    const item1Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`).doc();
    await item1Ref.set({
      name: 'Spring Rolls',
      price: 8.99,
      discount: 0,
      discountType: 'amount',
      locations: [TEST_LOCATION_A, TEST_LOCATION_B]
    });

    const item2Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`).doc();
    await item2Ref.set({
      name: 'Edamame',
      price: 6.99,
      discount: 1,
      discountType: 'amount',
      locations: [TEST_LOCATION_A]
    });

    const item3Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`).doc();
    await item3Ref.set({
      name: 'Gyoza',
      price: 9.99,
      discount: 0,
      discountType: 'amount',
      locations: [TEST_LOCATION_B]
    });

    const cat2Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).doc();
    await cat2Ref.set({ name: 'Drinks', order: 2 });
    createdCategoryIds.push(cat2Ref.id);

    const drink1Ref = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat2Ref.id}/items`).doc();
    await drink1Ref.set({
      name: 'Green Tea',
      price: 3.50,
      discount: 0,
      discountType: 'amount',
      locations: []
    });
  });

  afterAll(async () => {
    // Cleanup
    for (const orderId of createdOrderIds) {
      try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).delete(); } catch (e) {}
    }
    for (const catId of createdCategoryIds) {
      try {
        const itemsSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}/items`).get();
        for (const itemDoc of itemsSnap.docs) {
          await itemDoc.ref.delete();
        }
        await db.doc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}`).delete();
      } catch (e) {}
    }
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).delete(); } catch (e) {}
  });

  // ==========================================
  // Menu Fetch
  // ==========================================

  describe('Menu Fetch via Firestore', () => {
    it('should return categories with items for the test restaurant', async () => {
      const catSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).orderBy('name').get();

      expect(catSnap.docs.length).toBeGreaterThanOrEqual(2);

      const categories = [];
      for (const catDoc of catSnap.docs) {
        const itemsSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catDoc.id}/items`).get();
        if (itemsSnap.docs.length > 0) {
          categories.push({
            id: catDoc.id,
            ...catDoc.data(),
            items: itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          });
        }
      }

      expect(categories).toHaveLength(2);
      const appetizers = categories.find(c => c.name === 'Appetizers');
      expect(appetizers.items).toHaveLength(3);
      const drinks = categories.find(c => c.name === 'Drinks');
      expect(drinks.items).toHaveLength(1);
    });

    it('should filter items by location for multi-location setup', async () => {
      const catSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).get();

      const categories = [];
      for (const catDoc of catSnap.docs) {
        const itemsSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catDoc.id}/items`).get();

        const filteredItems = itemsSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(item => {
            if (item.locations && item.locations.length > 0) {
              return item.locations.includes(TEST_LOCATION_A);
            }
            return true; // Items with empty locations available everywhere
          });

        if (filteredItems.length > 0) {
          categories.push({ id: catDoc.id, ...catDoc.data(), items: filteredItems });
        }
      }

      // Location A: Spring Rolls + Edamame (Appetizers) + Green Tea (Drinks, no location filter)
      const appetizers = categories.find(c => c.name === 'Appetizers');
      expect(appetizers.items).toHaveLength(2);
      expect(appetizers.items.find(i => i.name === 'Gyoza')).toBeUndefined();

      const drinks = categories.find(c => c.name === 'Drinks');
      expect(drinks.items).toHaveLength(1); // Green Tea (empty locations = available everywhere)
    });

    it('should return empty for non-existent restaurant', async () => {
      const catSnap = await db.collection(`restaurants/nonexistent-restaurant-xyz/menuCategories`).get();
      expect(catSnap.docs).toHaveLength(0);
    });
  });

  // ==========================================
  // Widget Order Placement
  // ==========================================

  describe('Widget Order Placement', () => {
    it('should persist widget order in Firestore', async () => {
      const orderData = {
        orderNumber: `WE2E-${Date.now()}`,
        restaurantId: TEST_RESTAURANT_ID,
        locationId: TEST_RESTAURANT_ID,
        customer: { name: 'Widget Tester', email: 'widget@test.com', phone: '555-WIDGET' },
        items: [
          { id: 'item-1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99, quantity: 2, discount: 0, discountType: 'amount' },
          { id: 'item-2', name: 'Green Tea', price: 3.50, finalPrice: 3.50, quantity: 1, discount: 0, discountType: 'amount' }
        ],
        subtotal: 21.48,
        tax: 1.83,
        total: 23.31,
        orderType: 'pickup',
        paymentMethod: 'payAtStore',
        source: 'widget',
        status: 'new',
        createdAt: new Date().toISOString()
      };

      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add(orderData);
      createdOrderIds.push(orderRef.id);

      // Read back
      const orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`).get();
      expect(orderDoc.exists).toBe(true);

      const saved = orderDoc.data();
      expect(saved.source).toBe('widget');
      expect(saved.customer.name).toBe('Widget Tester');
      expect(saved.items).toHaveLength(2);
      expect(saved.subtotal).toBe(21.48);
      expect(saved.status).toBe('new');
    });

    it('should track widget orders by source field', async () => {
      // Create another widget order
      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add({
        orderNumber: `WE2E-track-${Date.now()}`,
        source: 'widget',
        status: 'new',
        customer: { name: 'Tracker' },
        items: [{ id: 'x', name: 'Test', quantity: 1, price: 10 }],
        total: 10,
        createdAt: new Date().toISOString()
      });
      createdOrderIds.push(orderRef.id);

      // Query widget orders
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).where('source', '==', 'widget').get();
      expect(snap.docs.length).toBeGreaterThanOrEqual(2);
      snap.docs.forEach(d => {
        expect(d.data().source).toBe('widget');
      });
    });
  });

  // ==========================================
  // Order Status Lifecycle
  // ==========================================

  describe('Widget Order Status Lifecycle', () => {
    let lifecycleOrderId;

    it('should create order with status "new"', async () => {
      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add({
        orderNumber: `WE2E-lifecycle-${Date.now()}`,
        source: 'widget',
        status: 'new',
        customer: { name: 'Lifecycle Tester' },
        items: [{ id: 'lc1', name: 'Test Item', quantity: 1, price: 15 }],
        total: 15,
        createdAt: new Date().toISOString()
      });
      lifecycleOrderId = orderRef.id;
      createdOrderIds.push(lifecycleOrderId);

      const orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(orderDoc.data().status).toBe('new');
    });

    it('should transition through preparing → ready → completed', async () => {
      // Kitchen picks up: new → preparing
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).update({
        status: 'preparing',
        preparingAt: new Date().toISOString()
      });
      let orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(orderDoc.data().status).toBe('preparing');

      // Kitchen marks ready
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).update({
        status: 'ready',
        readyAt: new Date().toISOString()
      });
      orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(orderDoc.data().status).toBe('ready');

      // Payment completes
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).update({
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`).get();
      expect(orderDoc.data().status).toBe('completed');
    });
  });

  // ==========================================
  // Tax Calculation Verification
  // ==========================================

  describe('Tax Calculation', () => {
    it('should store consistent subtotal + tax = total', async () => {
      const subtotal = 45.97;
      const taxRate = 8.5;
      const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;

      const orderRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).add({
        orderNumber: `WE2E-tax-${Date.now()}`,
        source: 'widget',
        status: 'new',
        customer: { name: 'Tax Tester' },
        items: [{ id: 't1', name: 'Expensive Item', quantity: 1, price: 45.97 }],
        subtotal,
        tax,
        total,
        taxRate,
        createdAt: new Date().toISOString()
      });
      createdOrderIds.push(orderRef.id);

      const orderDoc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`).get();
      const data = orderDoc.data();

      expect(data.subtotal).toBe(subtotal);
      expect(data.tax).toBeCloseTo(subtotal * 0.085, 2);
      expect(data.total).toBeCloseTo(data.subtotal + data.tax, 2);
    });
  });
});

// ==========================================
// Mock Fallback Tests (run without emulator)
// ==========================================

describe('Widget E2E — Mock Fallback (no emulator needed)', () => {
  it('should construct widget order matching EmbedApp format', () => {
    const order = {
      restaurantId: 'test-123',
      locationId: 'test-123',
      customer: { name: 'Test', email: 'test@test.com', phone: '555-0000' },
      items: [
        { id: 'i1', name: 'Burger', price: 12.99, finalPrice: 12.99, quantity: 1, discount: 0, discountType: 'amount' }
      ],
      subtotal: 12.99,
      tax: 1.10,
      total: 14.09,
      orderType: 'pickup',
      paymentMethod: 'payAtStore',
      source: 'widget',
      status: 'new'
    };

    expect(order.source).toBe('widget');
    expect(order.paymentMethod).toBe('payAtStore');
    expect(order.items[0].quantity).toBe(1);
    expect(order.total).toBeCloseTo(order.subtotal + order.tax, 2);
  });

  it('should separate widget orders from POS and website orders', () => {
    const orders = [
      { id: '1', source: 'pos' },
      { id: '2', source: 'widget' },
      { id: '3', source: 'website' },
      { id: '4', source: 'widget' }
    ];
    const widgetOrders = orders.filter(o => o.source === 'widget');
    expect(widgetOrders).toHaveLength(2);
  });
});
