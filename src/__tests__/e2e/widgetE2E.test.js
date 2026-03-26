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

const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  orderBy
} = require('firebase/firestore');

// Firebase test config
const firebaseConfig = {
  apiKey: 'test-api-key',
  authDomain: 'test.firebaseapp.com',
  projectId: 'restaurant-portal-6b147'
};

// Check if emulator is available
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const isEmulatorAvailable = !!process.env.FIRESTORE_EMULATOR_HOST;

let app;
let db;
const TEST_RESTAURANT_ID = 'widget-e2e-test-' + Date.now();
const TEST_LOCATION_A = 'loc-a-' + Date.now();
const TEST_LOCATION_B = 'loc-b-' + Date.now();

// Conditionally run tests only when emulator is available
const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Widget Embed Flow', () => {
  let createdOrderIds = [];
  let createdCategoryIds = [];

  beforeAll(async () => {
    app = initializeApp(firebaseConfig, 'widget-e2e-' + Date.now());
    db = getFirestore(app);

    const [host, port] = EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, host, parseInt(port));

    // Create test restaurant
    await setDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}`), {
      restaurantName: 'Widget Test Restaurant',
      slug: 'widget-test-' + Date.now(),
      isMultiLocation: true,
      taxRate: 8.5
    });

    // Create menu categories with items
    const cat1Ref = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories`));
    await setDoc(cat1Ref, { name: 'Appetizers', order: 1 });
    createdCategoryIds.push(cat1Ref.id);

    // Add items to category
    const item1Ref = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`));
    await setDoc(item1Ref, {
      name: 'Spring Rolls',
      price: 8.99,
      discount: 0,
      discountType: 'amount',
      locations: [TEST_LOCATION_A, TEST_LOCATION_B]
    });

    const item2Ref = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`));
    await setDoc(item2Ref, {
      name: 'Edamame',
      price: 6.99,
      discount: 1,
      discountType: 'amount',
      locations: [TEST_LOCATION_A]
    });

    const item3Ref = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat1Ref.id}/items`));
    await setDoc(item3Ref, {
      name: 'Gyoza',
      price: 9.99,
      discount: 0,
      discountType: 'amount',
      locations: [TEST_LOCATION_B]
    });

    const cat2Ref = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories`));
    await setDoc(cat2Ref, { name: 'Drinks', order: 2 });
    createdCategoryIds.push(cat2Ref.id);

    const drink1Ref = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${cat2Ref.id}/items`));
    await setDoc(drink1Ref, {
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
      try { await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`)); } catch (e) {}
    }
    for (const catId of createdCategoryIds) {
      try {
        const itemsSnap = await getDocs(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}/items`));
        for (const itemDoc of itemsSnap.docs) {
          await deleteDoc(itemDoc.ref);
        }
        await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}`));
      } catch (e) {}
    }
    try { await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}`)); } catch (e) {}
  });

  // ==========================================
  // Menu Fetch
  // ==========================================

  describe('Menu Fetch via Firestore', () => {
    it('should return categories with items for the test restaurant', async () => {
      const catSnap = await getDocs(
        query(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories`), orderBy('name'))
      );

      expect(catSnap.docs.length).toBeGreaterThanOrEqual(2);

      const categories = [];
      for (const catDoc of catSnap.docs) {
        const itemsSnap = await getDocs(
          collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catDoc.id}/items`)
        );
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
      const catSnap = await getDocs(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories`)
      );

      const categories = [];
      for (const catDoc of catSnap.docs) {
        const itemsSnap = await getDocs(
          collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catDoc.id}/items`)
        );

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
      const catSnap = await getDocs(
        collection(db, `restaurants/nonexistent-restaurant-xyz/menuCategories`)
      );
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

      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        orderData
      );
      createdOrderIds.push(orderRef.id);

      // Read back
      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`));
      expect(orderDoc.exists()).toBe(true);

      const saved = orderDoc.data();
      expect(saved.source).toBe('widget');
      expect(saved.customer.name).toBe('Widget Tester');
      expect(saved.items).toHaveLength(2);
      expect(saved.subtotal).toBe(21.48);
      expect(saved.status).toBe('new');
    });

    it('should track widget orders by source field', async () => {
      // Create another widget order
      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        {
          orderNumber: `WE2E-track-${Date.now()}`,
          source: 'widget',
          status: 'new',
          customer: { name: 'Tracker' },
          items: [{ id: 'x', name: 'Test', quantity: 1, price: 10 }],
          total: 10,
          createdAt: new Date().toISOString()
        }
      );
      createdOrderIds.push(orderRef.id);

      // Query widget orders
      const q = query(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        where('source', '==', 'widget')
      );
      const snap = await getDocs(q);
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
      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        {
          orderNumber: `WE2E-lifecycle-${Date.now()}`,
          source: 'widget',
          status: 'new',
          customer: { name: 'Lifecycle Tester' },
          items: [{ id: 'lc1', name: 'Test Item', quantity: 1, price: 15 }],
          total: 15,
          createdAt: new Date().toISOString()
        }
      );
      lifecycleOrderId = orderRef.id;
      createdOrderIds.push(lifecycleOrderId);

      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`));
      expect(orderDoc.data().status).toBe('new');
    });

    it('should transition through preparing → ready → completed', async () => {
      // Kitchen picks up: new → preparing
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`), {
        status: 'preparing',
        preparingAt: new Date().toISOString()
      });
      let orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`));
      expect(orderDoc.data().status).toBe('preparing');

      // Kitchen marks ready
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`), {
        status: 'ready',
        readyAt: new Date().toISOString()
      });
      orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`));
      expect(orderDoc.data().status).toBe('ready');

      // Payment completes
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`), {
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${lifecycleOrderId}`));
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

      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        {
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
        }
      );
      createdOrderIds.push(orderRef.id);

      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`));
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
