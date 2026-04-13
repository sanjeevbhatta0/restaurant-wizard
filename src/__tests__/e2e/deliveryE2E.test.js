/**
 * Delivery E2E Tests
 *
 * Tests the full delivery lifecycle using Firestore emulator when available,
 * falling back to mock-based tests otherwise.
 *
 * Run with emulators:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=deliveryE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

// DoorDash service mirrors
function mapDeliveryStatus(doordashStatus) {
  const mapping = {
    'quote': { deliveryStatus: 'quoted', orderStatus: null },
    'created': { deliveryStatus: 'awaiting_driver', orderStatus: null },
    'confirmed': { deliveryStatus: 'driver_assigned', orderStatus: null },
    'enroute_to_pickup': { deliveryStatus: 'driver_enroute_pickup', orderStatus: null },
    'arrived_at_pickup': { deliveryStatus: 'driver_at_pickup', orderStatus: null },
    'picked_up': { deliveryStatus: 'picked_up', orderStatus: 'out_for_delivery' },
    'enroute_to_dropoff': { deliveryStatus: 'driver_enroute_dropoff', orderStatus: null },
    'arrived_at_dropoff': { deliveryStatus: 'driver_at_dropoff', orderStatus: null },
    'delivered': { deliveryStatus: 'delivered', orderStatus: 'completed' },
    'cancelled': { deliveryStatus: 'cancelled', orderStatus: 'delivery_failed' },
  };
  return mapping[doordashStatus] || { deliveryStatus: doordashStatus, orderStatus: null };
}

function mapWebhookEvent(eventName) {
  const eventMapping = {
    'DELIVERY_CREATED': 'created',
    'DASHER_CONFIRMED': 'confirmed',
    'DASHER_ENROUTE_TO_PICKUP': 'enroute_to_pickup',
    'DASHER_ARRIVED_AT_PICKUP': 'arrived_at_pickup',
    'DASHER_PICKED_UP': 'picked_up',
    'DASHER_ENROUTE_TO_DROPOFF': 'enroute_to_dropoff',
    'DASHER_ARRIVED_AT_DROPOFF': 'arrived_at_dropoff',
    'DASHER_DROPPED_OFF': 'delivered',
    'DELIVERY_CANCELLED': 'cancelled',
  };
  return eventMapping[eventName] || null;
}

const TEST_RESTAURANT_ID = 'e2e-delivery-test-' + Date.now();

// ============================================
// EMULATOR-BASED TESTS
// ============================================

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Delivery Order Lifecycle with Emulator', () => {
  const admin = require('firebase-admin');
  let createdOrderIds = [];

  beforeAll(async () => {
    // Set up restaurant with delivery enabled
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).set({
      name: 'E2E Delivery Test Restaurant',
      address: '100 Test St, San Francisco, CA 94105',
      phone: '+14155551234',
      deliverySettings: {
        enabled: true,
        doordashBusinessId: 'biz-e2e-1',
        doordashStoreId: 'store-e2e-1',
        pickupInstructions: 'Counter #3',
        defaultPrepTime: 20,
        contactlessDefault: true,
        tipSuggestions: [15, 20, 25]
      }
    });
  });

  afterAll(async () => {
    // Cleanup
    for (const orderId of createdOrderIds) {
      try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).delete(); } catch (e) {}
    }
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).delete(); } catch (e) {}
  });

  test('delivery order created with all required fields', async () => {
    const orderId = `del-${Date.now()}-1`;
    createdOrderIds.push(orderId);

    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).set({
      orderNumber: orderId,
      restaurantId: TEST_RESTAURANT_ID,
      orderType: 'delivery',
      status: 'new',
      subtotal: 25,
      tax: 2.13,
      total: 41.88,
      deliveryFee: 9.75,
      driverTip: 5,
      deliveryAddress: { fullAddress: '456 Delivery Ave, SF, CA 94102' },
      deliveryInstructions: 'Ring bell twice',
      contactlessDelivery: true,
      doordash: {
        externalDeliveryId: `kc-${TEST_RESTAURANT_ID}-${Date.now()}`,
        deliveryStatus: 'awaiting_driver',
        trackingUrl: 'https://track.doordash.com/e2e-test',
        fee: 975,
        tip: 500,
      },
      customer: { name: 'E2E Customer', email: 'e2e@test.com', phone: '5551234567' },
      items: [{ name: 'Burger', quantity: 2, finalPrice: 12.50 }],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).get();
    expect(doc.exists).toBe(true);

    const data = doc.data();
    expect(data.orderType).toBe('delivery');
    expect(data.deliveryFee).toBe(9.75);
    expect(data.driverTip).toBe(5);
    expect(data.total).toBe(41.88);
    expect(data.deliveryAddress.fullAddress).toContain('456 Delivery Ave');
    expect(data.doordash.trackingUrl).toBeTruthy();
    expect(data.doordash.fee).toBe(975);
  });

  test('full webhook lifecycle updates statuses correctly', async () => {
    const orderId = `del-${Date.now()}-2`;
    createdOrderIds.push(orderId);
    const externalId = `kc-${TEST_RESTAURANT_ID}-lifecycle`;

    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).set({
      orderNumber: orderId,
      restaurantId: TEST_RESTAURANT_ID,
      orderType: 'delivery',
      status: 'new',
      doordash: { externalDeliveryId: externalId, deliveryStatus: 'quoted' },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const webhookSequence = [
      { event: 'DASHER_CONFIRMED', expectedDD: 'driver_assigned', expectedOrder: 'new' },
      { event: 'DASHER_ENROUTE_TO_PICKUP', expectedDD: 'driver_enroute_pickup', expectedOrder: 'new' },
      { event: 'DASHER_ARRIVED_AT_PICKUP', expectedDD: 'driver_at_pickup', expectedOrder: 'new' },
      { event: 'DASHER_PICKED_UP', expectedDD: 'picked_up', expectedOrder: 'out_for_delivery' },
      { event: 'DASHER_ENROUTE_TO_DROPOFF', expectedDD: 'driver_enroute_dropoff', expectedOrder: 'out_for_delivery' },
      { event: 'DASHER_DROPPED_OFF', expectedDD: 'delivered', expectedOrder: 'completed' },
    ];

    for (const { event, expectedDD, expectedOrder } of webhookSequence) {
      const ddStatus = mapWebhookEvent(event);
      const { deliveryStatus, orderStatus } = mapDeliveryStatus(ddStatus);

      const update = { 'doordash.deliveryStatus': deliveryStatus };
      if (orderStatus) update.status = orderStatus;

      await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).update(update);

      const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).get();
      expect(doc.data().doordash.deliveryStatus).toBe(expectedDD);
      expect(doc.data().status).toBe(expectedOrder);
    }
  });

  test('delivery order appears in kitchen query', async () => {
    const orderId = `del-${Date.now()}-3`;
    createdOrderIds.push(orderId);

    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).set({
      orderNumber: orderId,
      restaurantId: TEST_RESTAURANT_ID,
      orderType: 'delivery',
      status: 'preparing',
      deliveryAddress: { fullAddress: '789 Kitchen Ave' },
      doordash: { externalDeliveryId: `kc-test-kitchen`, deliveryStatus: 'awaiting_driver' },
      items: [{ name: 'Pasta', quantity: 1, finalPrice: 15 }],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const snapshot = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
      .where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready'])
      .get();

    const deliveryOrders = snapshot.docs.map(d => d.data()).filter(o => o.orderType === 'delivery');
    expect(deliveryOrders.length).toBeGreaterThanOrEqual(1);
    expect(deliveryOrders.some(o => o.orderNumber === orderId)).toBe(true);
  });

  test('delivery cancellation flow', async () => {
    const orderId = `del-${Date.now()}-4`;
    createdOrderIds.push(orderId);

    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).set({
      orderNumber: orderId,
      restaurantId: TEST_RESTAURANT_ID,
      orderType: 'delivery',
      status: 'new',
      doordash: { externalDeliveryId: `kc-test-cancel`, deliveryStatus: 'driver_assigned' },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Simulate cancellation webhook
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).update({
      status: 'delivery_failed',
      'doordash.deliveryStatus': 'cancelled',
      'doordash.cancelReason': 'Restaurant cancelled',
    });

    const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId}`).get();
    expect(doc.data().status).toBe('delivery_failed');
    expect(doc.data().doordash.deliveryStatus).toBe('cancelled');
  });

  test('query delivery orders by orderType index', async () => {
    const orderId1 = `del-${Date.now()}-5a`;
    const orderId2 = `del-${Date.now()}-5b`;
    createdOrderIds.push(orderId1, orderId2);

    await Promise.all([
      db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId1}`).set({
        orderType: 'pickup', status: 'new', createdAt: admin.firestore.FieldValue.serverTimestamp()
      }),
      db.doc(`restaurants/${TEST_RESTAURANT_ID}/orders/${orderId2}`).set({
        orderType: 'delivery', status: 'new',
        doordash: { externalDeliveryId: `kc-test-query` },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }),
    ]);

    const deliveryOrders = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
      .where('orderType', '==', 'delivery')
      .get();

    expect(deliveryOrders.size).toBeGreaterThanOrEqual(1);
    deliveryOrders.docs.forEach(d => {
      expect(d.data().orderType).toBe('delivery');
    });
  });

  test('delivery settings stored on restaurant document', async () => {
    const doc = await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).get();
    const settings = doc.data().deliverySettings;

    expect(settings.enabled).toBe(true);
    expect(settings.doordashBusinessId).toBe('biz-e2e-1');
    expect(settings.defaultPrepTime).toBe(20);
    expect(settings.tipSuggestions).toEqual([15, 20, 25]);
  });
});

// ============================================
// MOCK FALLBACK TESTS
// ============================================

describe('Delivery E2E (mock fallback)', () => {
  test('full webhook sequence produces completed order', () => {
    const events = [
      'DELIVERY_CREATED', 'DASHER_CONFIRMED', 'DASHER_ENROUTE_TO_PICKUP',
      'DASHER_ARRIVED_AT_PICKUP', 'DASHER_PICKED_UP', 'DASHER_ENROUTE_TO_DROPOFF',
      'DASHER_ARRIVED_AT_DROPOFF', 'DASHER_DROPPED_OFF'
    ];

    let orderStatus = 'new';
    let deliveryStatus = 'quoted';

    events.forEach(event => {
      const ddStatus = mapWebhookEvent(event);
      expect(ddStatus).toBeTruthy();
      const result = mapDeliveryStatus(ddStatus);
      deliveryStatus = result.deliveryStatus;
      if (result.orderStatus) orderStatus = result.orderStatus;
    });

    expect(deliveryStatus).toBe('delivered');
    expect(orderStatus).toBe('completed');
  });

  test('delivery total includes fee and tip', () => {
    const subtotal = 30.97;
    const taxRate = 8.875;
    const deliveryFee = 9.75;
    const driverTip = 5;
    const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const total = Math.round((subtotal + tax + deliveryFee + driverTip) * 100) / 100;

    expect(total).toBeCloseTo(48.47, 2);
  });
});
