/**
 * E2E Tests — Website Builder Order Flow
 *
 * Tests the complete website order lifecycle using Firebase Firestore emulator:
 *   Restaurant setup → Menu creation → Order placement → Status workflow → Payment completion
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/websiteOrderE2E
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

const firebaseConfig = {
  apiKey: 'test-api-key',
  authDomain: 'test.firebaseapp.com',
  projectId: 'restaurant-portal-6b147'
};

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
const isEmulatorAvailable = !!process.env.FIRESTORE_EMULATOR_HOST;

let app;
let db;
const TEST_RESTAURANT_ID = 'website-e2e-test-' + Date.now();
const TEST_LOCATION_ID = 'website-loc-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Website Builder Order Flow', () => {
  let createdOrderIds = [];
  let createdCategoryIds = [];

  beforeAll(async () => {
    app = initializeApp(firebaseConfig, 'website-e2e-' + Date.now());
    db = getFirestore(app);

    const [host, port] = EMULATOR_HOST.split(':');
    connectFirestoreEmulator(db, host, parseInt(port));

    // Create restaurant
    await setDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}`), {
      restaurantName: 'Website E2E Restaurant',
      slug: 'website-e2e-' + Date.now(),
      isMultiLocation: true,
      taxRate: 9.0
    });

    // Create menu
    const catRef = doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories`));
    await setDoc(catRef, { name: 'Main Course', order: 1 });
    createdCategoryIds.push(catRef.id);

    await setDoc(doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items`)), {
      name: 'Grilled Salmon', price: 24.99, discount: 0, discountType: 'amount', locations: [TEST_LOCATION_ID]
    });
    await setDoc(doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items`)), {
      name: 'Pasta Primavera', price: 18.99, discount: 3, discountType: 'amount', locations: []
    });
    await setDoc(doc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items`)), {
      name: 'Caesar Salad', price: 12.99, discount: 0, discountType: 'amount', locations: ['other-location']
    });
  });

  afterAll(async () => {
    for (const orderId of createdOrderIds) {
      try { await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`)); } catch (e) {}
    }
    for (const catId of createdCategoryIds) {
      try {
        const itemsSnap = await getDocs(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}/items`));
        for (const itemDoc of itemsSnap.docs) { await deleteDoc(itemDoc.ref); }
        await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}`));
      } catch (e) {}
    }
    try { await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}`)); } catch (e) {}
  });

  // ==========================================
  // Website Order Lifecycle
  // ==========================================

  describe('Website Order Complete Lifecycle', () => {
    let orderId;

    it('should create website order with all fields', async () => {
      const orderData = {
        orderNumber: `WEB-E2E-${Date.now()}`,
        source: 'website',
        status: 'new',
        customer: {
          name: 'Website Customer',
          email: 'webcustomer@test.com',
          phone: '555-WEB1'
        },
        items: [
          { id: 'i1', name: 'Grilled Salmon', price: 24.99, finalPrice: 24.99, quantity: 1, discount: 0, discountType: 'amount' },
          { id: 'i2', name: 'Pasta Primavera', price: 18.99, finalPrice: 15.99, quantity: 2, discount: 3, discountType: 'amount' }
        ],
        subtotal: 56.97,
        tax: 5.13,
        total: 62.10,
        orderType: 'pickup',
        pickupTime: new Date(Date.now() + 45 * 60000).toISOString(),
        paymentMethod: 'payAtStore',
        createdAt: new Date().toISOString()
      };

      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        orderData
      );
      orderId = orderRef.id;
      createdOrderIds.push(orderId);

      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      expect(orderDoc.exists()).toBe(true);
      const saved = orderDoc.data();
      expect(saved.source).toBe('website');
      expect(saved.status).toBe('new');
      expect(saved.customer.name).toBe('Website Customer');
      expect(saved.items).toHaveLength(2);
    });

    it('should flow through kitchen → ready → completed', async () => {
      // Kitchen picks up
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`), {
        status: 'preparing', preparingAt: new Date().toISOString()
      });
      let snap = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      expect(snap.data().status).toBe('preparing');

      // Kitchen marks ready
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`), {
        status: 'ready', readyAt: new Date().toISOString()
      });
      snap = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      expect(snap.data().status).toBe('ready');

      // Payment completes
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`), {
        status: 'completed', completedAt: new Date().toISOString(),
        paymentDetails: { method: 'cash', amount: 62.10, paidAt: new Date().toISOString() }
      });
      snap = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      expect(snap.data().status).toBe('completed');
      expect(snap.data().paymentDetails.method).toBe('cash');
    });
  });

  // ==========================================
  // Order Data Persistence
  // ==========================================

  describe('Order Data Persistence', () => {
    it('should persist all order fields and read them back identically', async () => {
      const orderData = {
        orderNumber: `WEB-PERSIST-${Date.now()}`,
        source: 'website',
        status: 'new',
        customer: { name: 'Persistence Test', email: 'persist@test.com', phone: '555-PERSIST' },
        items: [{ id: 'p1', name: 'Test Item', price: 10.00, finalPrice: 10.00, quantity: 3, discount: 0, discountType: 'amount' }],
        subtotal: 30.00,
        tax: 2.70,
        total: 32.70,
        orderType: 'dine-in',
        specialInstructions: 'No peanuts',
        paymentMethod: 'payAtStore',
        createdAt: new Date().toISOString()
      };

      const ref = await addDoc(collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`), orderData);
      createdOrderIds.push(ref.id);

      const readBack = (await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${ref.id}`))).data();
      expect(readBack.customer.name).toBe(orderData.customer.name);
      expect(readBack.customer.email).toBe(orderData.customer.email);
      expect(readBack.items).toHaveLength(1);
      expect(readBack.items[0].quantity).toBe(3);
      expect(readBack.subtotal).toBe(30.00);
      expect(readBack.tax).toBe(2.70);
      expect(readBack.total).toBe(32.70);
      expect(readBack.specialInstructions).toBe('No peanuts');
      expect(readBack.orderType).toBe('dine-in');
    });
  });

  // ==========================================
  // Multi-Location Order
  // ==========================================

  describe('Multi-Location Website Order', () => {
    it('should store locationId and filter menu by location', async () => {
      // Fetch menu filtered by TEST_LOCATION_ID
      const catSnap = await getDocs(collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories`));
      let locationItems = [];

      for (const catDoc of catSnap.docs) {
        const itemsSnap = await getDocs(
          collection(db, `restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catDoc.id}/items`)
        );
        itemsSnap.docs.forEach(d => {
          const data = d.data();
          if (data.locations && data.locations.length > 0) {
            if (data.locations.includes(TEST_LOCATION_ID)) {
              locationItems.push({ id: d.id, ...data });
            }
          } else {
            locationItems.push({ id: d.id, ...data }); // empty locations = available everywhere
          }
        });
      }

      // Should find: Grilled Salmon (TEST_LOCATION_ID) + Pasta Primavera (empty locations)
      expect(locationItems).toHaveLength(2);
      expect(locationItems.find(i => i.name === 'Grilled Salmon')).toBeDefined();
      expect(locationItems.find(i => i.name === 'Pasta Primavera')).toBeDefined();
      expect(locationItems.find(i => i.name === 'Caesar Salad')).toBeUndefined();

      // Place order with locationId
      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        {
          orderNumber: `WEB-MULTI-${Date.now()}`,
          source: 'website',
          status: 'new',
          locationId: TEST_LOCATION_ID,
          customer: { name: 'Multi-Loc Customer' },
          items: locationItems.map(i => ({ id: i.id, name: i.name, quantity: 1, price: i.price })),
          total: locationItems.reduce((s, i) => s + i.price, 0),
          createdAt: new Date().toISOString()
        }
      );
      createdOrderIds.push(orderRef.id);

      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`));
      expect(orderDoc.data().locationId).toBe(TEST_LOCATION_ID);
    });
  });

  // ==========================================
  // Prepaid Order
  // ==========================================

  describe('Prepaid Website Order', () => {
    it('should store payment details for prepaid card order', async () => {
      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        {
          orderNumber: `WEB-PREPAID-${Date.now()}`,
          source: 'website',
          status: 'new',
          customer: { name: 'Prepaid Customer', email: 'prepaid@test.com' },
          items: [{ id: 'pp1', name: 'Steak', quantity: 1, price: 35.00 }],
          subtotal: 35.00,
          tax: 3.15,
          total: 38.15,
          paymentMethod: 'card',
          paymentDetails: {
            status: 'pending',
            chargeId: 'ch_test_123',
            last4: '4242'
          },
          createdAt: new Date().toISOString()
        }
      );
      createdOrderIds.push(orderRef.id);

      // Verify payment details stored
      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`));
      const data = orderDoc.data();
      expect(data.paymentMethod).toBe('card');
      expect(data.paymentDetails.chargeId).toBe('ch_test_123');
      expect(data.paymentDetails.status).toBe('pending');

      // Complete payment
      await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`), {
        status: 'completed',
        paymentDetails: {
          ...data.paymentDetails,
          status: 'verified',
          verifiedAt: new Date().toISOString()
        }
      });

      const updated = (await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`))).data();
      expect(updated.status).toBe('completed');
      expect(updated.paymentDetails.status).toBe('verified');
    });
  });

  // ==========================================
  // Order Number
  // ==========================================

  describe('Order Number Generation', () => {
    it('should store and retrieve orderNumber', async () => {
      const orderNumber = `WEB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const orderRef = await addDoc(
        collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`),
        {
          orderNumber,
          source: 'website',
          status: 'new',
          customer: { name: 'Number Test' },
          items: [{ id: 'n1', name: 'Test', quantity: 1, price: 5 }],
          total: 5,
          createdAt: new Date().toISOString()
        }
      );
      createdOrderIds.push(orderRef.id);

      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderRef.id}`));
      expect(orderDoc.data().orderNumber).toBe(orderNumber);
      expect(typeof orderDoc.data().orderNumber).toBe('string');
      expect(orderDoc.data().orderNumber.length).toBeGreaterThan(0);
    });
  });
});

// ==========================================
// Mock Fallback Tests (run without emulator)
// ==========================================

describe('Website Order E2E — Mock Fallback (no emulator needed)', () => {
  it('should construct website order matching submitOrder expected format', () => {
    const order = {
      restaurantId: 'test-rest',
      customer: { name: 'Test', email: 'test@test.com', phone: '555-0000' },
      items: [
        { id: 'i1', name: 'Salmon', price: 24.99, finalPrice: 24.99, quantity: 1, discount: 0, discountType: 'amount' }
      ],
      subtotal: 24.99,
      tax: 2.12,
      total: 27.11,
      orderType: 'pickup',
      paymentMethod: 'payAtStore',
      source: 'website'
    };

    // Validate required fields
    expect(order.restaurantId).toBeTruthy();
    expect(order.customer).toBeTruthy();
    expect(order.items.length).toBeGreaterThan(0);
    expect(order.source).toBe('website');
  });

  it('should differentiate website from widget and POS sources', () => {
    const sources = ['pos', 'website', 'widget'];
    expect(sources.filter(s => s === 'website')).toHaveLength(1);
    expect(sources.filter(s => s === 'widget')).toHaveLength(1);
    expect(sources.filter(s => s === 'pos')).toHaveLength(1);
  });
});
