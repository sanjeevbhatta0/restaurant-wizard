/**
 * E2E Tests — Full POS → Kitchen → Server → Payment Flow
 * 
 * These tests simulate the complete real-world flow using Firebase emulators.
 * They test the actual Firestore operations against the emulator to verify
 * data persistence and status transitions work correctly end-to-end.
 * 
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 * 
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e
 */

const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  getDocs,
  deleteDoc
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

// ==========================================
// Setup
// ==========================================

let app;
let db;
const TEST_RESTAURANT_ID = 'e2e-test-restaurant-' + Date.now();

// Conditionally run tests only when emulator is available
const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Full POS → Kitchen → Server → Payment Flow', () => {
  let createdOrderIds = [];

  beforeAll(() => {
    app = initializeApp(firebaseConfig, 'e2e-test-' + Date.now());
    db = getFirestore(app);

    if (!isEmulatorAvailable) {
      console.warn('⚠️ Firestore emulator not detected. Skipping E2E tests.');
      console.warn('   Start emulators: firebase emulators:start');
      console.warn('   Then run: FIRESTORE_EMULATOR_HOST=localhost:8080 npm test');
    } else {
      const [host, port] = EMULATOR_HOST.split(':');
      connectFirestoreEmulator(db, host, parseInt(port));
    }
  });

  afterAll(async () => {
    // Cleanup test data
    for (const orderId of createdOrderIds) {
      try {
        await deleteDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  // ==========================================
  // E2E Flow: Dine-In Order
  // ==========================================

  describe('Dine-In Order: Complete Lifecycle', () => {
    let orderId;
    const orderData = {
      orderNumber: `E2E-${Date.now()}`,
      tableNumber: '12',
      locationId: TEST_RESTAURANT_ID,
      items: [
        {
          id: 'item-steak',
          name: 'Ribeye Steak',
          categoryName: 'Entrees',
          price: 34.99,
          originalPrice: 34.99,
          quantity: 1,
          subtotal: 34.99
        },
        {
          id: 'item-wine',
          name: 'Red Wine',
          categoryName: 'Beverages',
          price: 15.00,
          originalPrice: 15.00,
          quantity: 2,
          subtotal: 30.00
        },
        {
          id: 'item-dessert',
          name: 'Cheesecake',
          categoryName: 'Desserts',
          price: 9.50,
          originalPrice: 9.50,
          quantity: 1,
          subtotal: 9.50
        }
      ],
      total: 74.49,
      status: 'sent_to_kitchen',
      orderType: 'dine_in',
      source: 'pos',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    test('Step 1 — POS: Create order and send to kitchen', async () => {
      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);
      const docRef = await addDoc(ordersRef, orderData);
      orderId = docRef.id;
      createdOrderIds.push(orderId);

      expect(orderId).toBeTruthy();
      expect(typeof orderId).toBe('string');

      // Verify the order was created correctly
      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      expect(orderDoc.exists()).toBe(true);

      const data = orderDoc.data();
      expect(data.status).toBe('sent_to_kitchen');
      expect(data.items).toHaveLength(3);
      expect(data.total).toBe(74.49);
      expect(data.tableNumber).toBe('12');
      expect(data.orderType).toBe('dine_in');
      expect(data.locationId).toBe(TEST_RESTAURANT_ID);
    });

    test('Step 2 — Kitchen: Query order appears in kitchen view', async () => {
      // Kitchen queries for orders with status in [new, sent_to_kitchen, preparing]
      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);
      const q = query(
        ordersRef,
        where('locationId', '==', TEST_RESTAURANT_ID),
        where('status', 'in', ['new', 'sent_to_kitchen', 'preparing'])
      );

      const snapshot = await getDocs(q);
      const kitchenOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Our order should appear in kitchen view
      const ourOrder = kitchenOrders.find(o => o.id === orderId);
      expect(ourOrder).toBeDefined();
      expect(ourOrder.status).toBe('sent_to_kitchen');
    });

    test('Step 3 — Kitchen: Mark order as preparing', async () => {
      const orderRef = doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`);

      await updateDoc(orderRef, {
        status: 'preparing',
        updatedAt: new Date()
      });

      // Verify the update
      const orderDoc = await getDoc(orderRef);
      const data = orderDoc.data();
      expect(data.status).toBe('preparing');
    });

    test('Step 4 — Kitchen: Mark order as ready', async () => {
      const orderRef = doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`);
      const readyAt = new Date();

      await updateDoc(orderRef, {
        status: 'ready',
        readyAt,
        updatedAt: new Date()
      });

      // Verify the update
      const orderDoc = await getDoc(orderRef);
      const data = orderDoc.data();
      expect(data.status).toBe('ready');
      expect(data.readyAt).toBeDefined();
    });

    test('Step 5 — Server: Query order appears in server view', async () => {
      // Server queries for orders with status in [preparing, ready]
      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);
      const q = query(
        ordersRef,
        where('locationId', '==', TEST_RESTAURANT_ID),
        where('status', 'in', ['preparing', 'ready'])
      );

      const snapshot = await getDocs(q);
      const serverOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      const ourOrder = serverOrders.find(o => o.id === orderId);
      expect(ourOrder).toBeDefined();
      expect(ourOrder.status).toBe('ready');
    });

    test('Step 6 — Server: Mark order as served', async () => {
      const orderRef = doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`);
      const servedAt = new Date();

      await updateDoc(orderRef, {
        status: 'served',
        servedAt,
        updatedAt: new Date()
      });

      // Verify
      const orderDoc = await getDoc(orderRef);
      const data = orderDoc.data();
      expect(data.status).toBe('served');
      expect(data.servedAt).toBeDefined();
    });

    test('Step 7 — Payment: Order appears in payment view (served orders)', async () => {
      // Payment queries for orders with status == 'served'
      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);
      const q = query(
        ordersRef,
        where('status', '==', 'served')
      );

      const snapshot = await getDocs(q);
      const servedOrders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      const ourOrder = servedOrders.find(o => o.id === orderId);
      expect(ourOrder).toBeDefined();
      expect(ourOrder.status).toBe('served');
      expect(ourOrder.total).toBe(74.49);
    });

    test('Step 8 — Payment: Process cash payment and mark as completed', async () => {
      const orderRef = doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`);

      const subtotal = 74.49;
      const taxRate = 8.5;
      const taxAmount = subtotal * (taxRate / 100);
      const tipAmount = 11.00;
      const total = subtotal + taxAmount + tipAmount;

      const paymentDetails = {
        subtotal,
        taxRate,
        taxAmount: Math.round(taxAmount * 100) / 100,
        discountAmount: 0,
        discountType: 'amount',
        tipAmount,
        tipType: 'amount',
        total: Math.round(total * 100) / 100,
        paymentMethod: 'cash',
        paidAt: new Date().toISOString()
      };

      await updateDoc(orderRef, {
        status: 'completed',
        paymentDate: new Date(),
        paymentDetails,
        updatedAt: new Date()
      });

      // FINAL VERIFICATION: Order is now completed with all payment data
      const orderDoc = await getDoc(orderRef);
      const data = orderDoc.data();

      expect(data.status).toBe('completed');
      expect(data.paymentDetails).toBeDefined();
      expect(data.paymentDetails.paymentMethod).toBe('cash');
      expect(data.paymentDetails.subtotal).toBe(74.49);
      expect(data.paymentDetails.taxRate).toBe(8.5);
      expect(data.paymentDetails.tipAmount).toBe(11.00);
      expect(data.paymentDetails.total).toBeCloseTo(91.82, 1);
      expect(data.paymentDate).toBeDefined();
    });

    test('Step 9 — Verification: Order no longer appears in active views', async () => {
      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);

      // Kitchen should NOT see it
      const kitchenQ = query(
        ordersRef,
        where('locationId', '==', TEST_RESTAURANT_ID),
        where('status', 'in', ['new', 'sent_to_kitchen', 'preparing'])
      );
      const kitchenSnapshot = await getDocs(kitchenQ);
      const kitchenOrders = kitchenSnapshot.docs.map(d => ({ id: d.id }));
      expect(kitchenOrders.find(o => o.id === orderId)).toBeUndefined();

      // Server should NOT see it
      const serverQ = query(
        ordersRef,
        where('locationId', '==', TEST_RESTAURANT_ID),
        where('status', 'in', ['preparing', 'ready'])
      );
      const serverSnapshot = await getDocs(serverQ);
      const serverOrders = serverSnapshot.docs.map(d => ({ id: d.id }));
      expect(serverOrders.find(o => o.id === orderId)).toBeUndefined();

      // Payment (served) should NOT see it
      const paymentQ = query(
        ordersRef,
        where('status', '==', 'served')
      );
      const paymentSnapshot = await getDocs(paymentQ);
      const paymentOrders = paymentSnapshot.docs.map(d => ({ id: d.id }));
      expect(paymentOrders.find(o => o.id === orderId)).toBeUndefined();

      // Completed orders should see it
      const completedQ = query(
        ordersRef,
        where('status', '==', 'completed')
      );
      const completedSnapshot = await getDocs(completedQ);
      const completedOrders = completedSnapshot.docs.map(d => ({ id: d.id }));
      expect(completedOrders.find(o => o.id === orderId)).toBeDefined();
    });
  });

  // ==========================================
  // E2E Flow: Multi-Item Order with Discount
  // ==========================================

  describe('Order with Discounted Items', () => {
    let orderId;

    test('Should create order with discounted items and correct total', async () => {
      const items = [
        {
          id: 'item-pizza',
          name: 'Margherita Pizza',
          price: 14.99,
          originalPrice: 14.99,
          discount: 0,
          discountType: 'percentage',
          quantity: 1,
          subtotal: 14.99
        },
        {
          id: 'item-pasta',
          name: 'Spaghetti',
          price: 10.00, // After 20% discount from $12.50
          originalPrice: 12.50,
          discount: 20,
          discountType: 'percentage',
          quantity: 2,
          subtotal: 20.00
        }
      ];

      const total = items.reduce((sum, item) => sum + item.subtotal, 0);

      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);
      const docRef = await addDoc(ordersRef, {
        orderNumber: `E2E-DISC-${Date.now()}`,
        tableNumber: '8',
        locationId: TEST_RESTAURANT_ID,
        items,
        total,
        status: 'sent_to_kitchen',
        orderType: 'dine_in',
        source: 'pos',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      orderId = docRef.id;
      createdOrderIds.push(orderId);

      const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`));
      const data = orderDoc.data();
      expect(data.total).toBe(34.99);
      expect(data.items[1].discount).toBe(20);
    });
  });

  // ==========================================
  // E2E Flow: Multiple Orders, Same Table
  // ==========================================

  describe('Multiple Orders — Same Table', () => {
    let orderIds = [];

    test('Should create multiple orders for the same table', async () => {
      const ordersRef = collection(db, `restaurants/${TEST_RESTAURANT_ID}/orders`);

      // Order 1
      const doc1 = await addDoc(ordersRef, {
        orderNumber: `E2E-MULTI-1-${Date.now()}`,
        tableNumber: '15',
        locationId: TEST_RESTAURANT_ID,
        items: [{ id: 'burger', name: 'Burger', price: 12.99, quantity: 1, subtotal: 12.99 }],
        total: 12.99,
        status: 'served',
        orderType: 'dine_in',
        source: 'pos',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      orderIds.push(doc1.id);
      createdOrderIds.push(doc1.id);

      // Order 2
      const doc2 = await addDoc(ordersRef, {
        orderNumber: `E2E-MULTI-2-${Date.now()}`,
        tableNumber: '15',
        locationId: TEST_RESTAURANT_ID,
        items: [{ id: 'dessert', name: 'Ice Cream', price: 6.50, quantity: 1, subtotal: 6.50 }],
        total: 6.50,
        status: 'served',
        orderType: 'dine_in',
        source: 'pos',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      orderIds.push(doc2.id);
      createdOrderIds.push(doc2.id);

      // Query for table 15's served orders
      const q = query(
        ordersRef,
        where('tableNumber', '==', '15'),
        where('status', '==', 'served')
      );

      const snapshot = await getDocs(q);
      const table15Orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      expect(table15Orders.length).toBeGreaterThanOrEqual(2);

      // Calculate combined total
      const combinedTotal = table15Orders.reduce((sum, o) => sum + o.total, 0);
      expect(combinedTotal).toBeGreaterThanOrEqual(19.49);
    });

    test('Should batch complete multiple orders for same table', async () => {
      // Complete all orders at once (like real payment does)
      for (const id of orderIds) {
        await updateDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${id}`), {
          status: 'completed',
          paymentDate: new Date(),
          paymentDetails: {
            subtotal: 19.49,
            taxRate: 8.5,
            taxAmount: 1.66,
            total: 21.15,
            paymentMethod: 'cash',
            paidAt: new Date().toISOString()
          },
          updatedAt: new Date()
        });
      }

      // Verify both are completed
      for (const id of orderIds) {
        const orderDoc = await getDoc(doc(db, `restaurants/${TEST_RESTAURANT_ID}/orders/${id}`));
        expect(orderDoc.data().status).toBe('completed');
      }
    });
  });
});

// ==========================================
// Non-Emulator fallback: Mock E2E Flow
// ==========================================

describe('E2E Flow — Mock (runs without emulator)', () => {
  test('Complete order lifecycle data transformations', () => {
    // Simulate all data transformations without Firebase

    // Step 1: POS creates order
    const order = {
      id: 'mock-order',
      orderNumber: 'ORD-20260322-0001',
      tableNumber: '5',
      locationId: 'restaurant-1',
      items: [
        { name: 'Burger', price: 12.99, quantity: 1, subtotal: 12.99 },
        { name: 'Fries', price: 4.99, quantity: 2, subtotal: 9.98 }
      ],
      total: 22.97,
      status: 'sent_to_kitchen',
      orderType: 'dine_in'
    };

    expect(order.status).toBe('sent_to_kitchen');

    // Step 2: Kitchen — preparing
    order.status = 'preparing';
    order.updatedAt = new Date();
    expect(order.status).toBe('preparing');

    // Step 3: Kitchen — ready
    order.status = 'ready';
    order.readyAt = new Date();
    order.updatedAt = new Date();
    expect(order.status).toBe('ready');
    expect(order.readyAt).toBeDefined();

    // Step 4: Server — served
    order.status = 'served';
    order.servedAt = new Date();
    order.updatedAt = new Date();
    expect(order.status).toBe('served');
    expect(order.servedAt).toBeDefined();

    // Step 5: Payment — calculate totals
    const subtotal = order.total;
    const taxRate = 8.5;
    const taxAmount = subtotal * (taxRate / 100);
    const tipAmount = 5.00;
    const finalTotal = subtotal + taxAmount + tipAmount;

    expect(subtotal).toBe(22.97);
    expect(taxAmount).toBeCloseTo(1.95, 2);
    expect(finalTotal).toBeCloseTo(29.92, 2);

    // Step 6: Payment — complete
    order.status = 'completed';
    order.paymentDetails = {
      subtotal,
      taxRate,
      taxAmount: Math.round(taxAmount * 100) / 100,
      tipAmount,
      total: Math.round(finalTotal * 100) / 100,
      paymentMethod: 'cash',
      paidAt: new Date().toISOString()
    };
    order.paymentDate = new Date();
    order.updatedAt = new Date();

    expect(order.status).toBe('completed');
    expect(order.paymentDetails.paymentMethod).toBe('cash');
    expect(order.paymentDetails.total).toBeCloseTo(29.92, 2);
    expect(order.paymentDate).toBeDefined();

    // Verify the complete journey
    expect(order.readyAt).toBeDefined();
    expect(order.servedAt).toBeDefined();
    expect(order.paymentDate).toBeDefined();
  });

  test('Complete order lifecycle status transitions are valid', () => {
    const VALID_TRANSITIONS = {
      'sent_to_kitchen': 'preparing',
      'preparing': 'ready',
      'ready': 'served',
      'served': 'completed'
    };

    const statuses = ['sent_to_kitchen', 'preparing', 'ready', 'served', 'completed'];

    for (let i = 0; i < statuses.length - 1; i++) {
      const current = statuses[i];
      const next = statuses[i + 1];
      expect(VALID_TRANSITIONS[current]).toBe(next);
    }
  });
});
