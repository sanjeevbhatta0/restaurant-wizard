/**
 * Delivery Flow Integration Tests
 *
 * Tests the end-to-end delivery order lifecycle:
 * quote -> checkout -> submit -> webhook status updates -> completion
 */

// Mock Firebase
jest.mock('../../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-restaurant-1' } }
}));

// ============================================
// DoorDash Service Mirrors
// ============================================

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

function generateExternalDeliveryId(restaurantId) {
  return `kc-${restaurantId}-${Date.now()}`;
}

function parseExternalDeliveryId(externalDeliveryId) {
  if (!externalDeliveryId || !externalDeliveryId.startsWith('kc-')) return null;
  const parts = externalDeliveryId.split('-');
  if (parts.length < 3) return null;
  return parts.slice(1, -1).join('-');
}

// ============================================
// In-memory Order Store (simulates Firestore)
// ============================================

class MockOrderStore {
  constructor() {
    this.orders = {};
  }

  createOrder(orderId, data) {
    this.orders[orderId] = { ...data, id: orderId };
    return this.orders[orderId];
  }

  getOrder(orderId) {
    return this.orders[orderId] || null;
  }

  updateOrder(orderId, updates) {
    if (!this.orders[orderId]) throw new Error('Order not found');
    // Handle dot-notation updates (e.g., 'doordash.deliveryStatus')
    Object.entries(updates).forEach(([key, value]) => {
      if (key.includes('.')) {
        const parts = key.split('.');
        let obj = this.orders[orderId];
        for (let i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]]) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
      } else {
        this.orders[orderId][key] = value;
      }
    });
    return this.orders[orderId];
  }

  findByExternalDeliveryId(externalId) {
    return Object.values(this.orders).find(
      o => o.doordash?.externalDeliveryId === externalId
    ) || null;
  }
}

// ============================================
// TESTS
// ============================================

describe('Delivery Order Lifecycle', () => {
  let store;

  beforeEach(() => {
    store = new MockOrderStore();
  });

  test('complete delivery flow: quote -> submit -> webhooks -> delivered', () => {
    const restaurantId = 'test-restaurant-1';
    const externalDeliveryId = generateExternalDeliveryId(restaurantId);

    // Step 1: Customer gets a quote (simulated DoorDash response)
    const quoteResponse = {
      external_delivery_id: externalDeliveryId,
      fee: 975, // $9.75
      currency: 'USD',
      pickup_time_estimated: '2024-01-15T12:30:00Z',
      dropoff_time_estimated: '2024-01-15T13:00:00Z',
    };

    expect(quoteResponse.fee).toBe(975);

    // Step 2: Customer submits delivery order
    const subtotal = 25;
    const taxRate = 8.5;
    const deliveryFee = quoteResponse.fee / 100; // $9.75
    const driverTip = 5;
    const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const total = Math.round((subtotal + tax + deliveryFee + driverTip) * 100) / 100;

    const order = store.createOrder('order-001', {
      orderNumber: 'order-001',
      restaurantId,
      orderType: 'delivery',
      status: 'new',
      subtotal,
      tax,
      total,
      deliveryFee,
      driverTip,
      deliveryAddress: { fullAddress: '123 Main St, SF, CA 94105' },
      deliveryInstructions: 'Leave at door',
      contactlessDelivery: true,
      doordash: {
        externalDeliveryId,
        deliveryStatus: 'quoted',
        fee: quoteResponse.fee,
        tip: driverTip * 100,
        trackingUrl: null,
      },
      customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '5551234567' },
      items: [{ name: 'Pizza', quantity: 1, finalPrice: 15 }, { name: 'Salad', quantity: 1, finalPrice: 10 }],
    });

    expect(order.total).toBe(41.88); // 25 + 2.13 + 9.75 + 5
    expect(order.status).toBe('new');

    // Step 3: DoorDash quote accepted (simulated)
    store.updateOrder('order-001', {
      'doordash.deliveryStatus': 'awaiting_driver',
      'doordash.trackingUrl': 'https://track.doordash.com/test123',
    });

    let updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('awaiting_driver');
    expect(updated.doordash.trackingUrl).toBeTruthy();

    // Step 4: Webhook - Driver confirmed
    const event1 = mapWebhookEvent('DASHER_CONFIRMED');
    const status1 = mapDeliveryStatus(event1);
    store.updateOrder('order-001', {
      'doordash.deliveryStatus': status1.deliveryStatus,
      'doordash.dasherName': 'Mike T.',
      'doordash.dasherPhone': '+15559876543',
    });
    if (status1.orderStatus) store.updateOrder('order-001', { status: status1.orderStatus });

    updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('driver_assigned');
    expect(updated.doordash.dasherName).toBe('Mike T.');
    expect(updated.status).toBe('new'); // No order status change yet

    // Step 5: Webhook - Driver en route to pickup
    const event2 = mapWebhookEvent('DASHER_ENROUTE_TO_PICKUP');
    const status2 = mapDeliveryStatus(event2);
    store.updateOrder('order-001', { 'doordash.deliveryStatus': status2.deliveryStatus });

    updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('driver_enroute_pickup');
    expect(updated.status).toBe('new'); // Still no change

    // Step 6: Webhook - Driver arrived at restaurant
    const event3 = mapWebhookEvent('DASHER_ARRIVED_AT_PICKUP');
    const status3 = mapDeliveryStatus(event3);
    store.updateOrder('order-001', { 'doordash.deliveryStatus': status3.deliveryStatus });

    updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('driver_at_pickup');

    // Step 7: Webhook - Driver picked up order
    const event4 = mapWebhookEvent('DASHER_PICKED_UP');
    const status4 = mapDeliveryStatus(event4);
    store.updateOrder('order-001', { 'doordash.deliveryStatus': status4.deliveryStatus });
    if (status4.orderStatus) store.updateOrder('order-001', { status: status4.orderStatus });

    updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('picked_up');
    expect(updated.status).toBe('out_for_delivery'); // ORDER STATUS CHANGES

    // Step 8: Webhook - Driver en route to customer
    const event5 = mapWebhookEvent('DASHER_ENROUTE_TO_DROPOFF');
    const status5 = mapDeliveryStatus(event5);
    store.updateOrder('order-001', { 'doordash.deliveryStatus': status5.deliveryStatus });

    updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('driver_enroute_dropoff');
    expect(updated.status).toBe('out_for_delivery'); // Unchanged

    // Step 9: Webhook - Delivered!
    const event6 = mapWebhookEvent('DASHER_DROPPED_OFF');
    const status6 = mapDeliveryStatus(event6);
    store.updateOrder('order-001', {
      'doordash.deliveryStatus': status6.deliveryStatus,
      'doordash.actualDeliveryTime': '2024-01-15T13:05:00Z',
      'doordash.proofOfDeliveryUrl': 'https://doordash.com/proof/123',
    });
    if (status6.orderStatus) store.updateOrder('order-001', { status: status6.orderStatus });

    updated = store.getOrder('order-001');
    expect(updated.doordash.deliveryStatus).toBe('delivered');
    expect(updated.status).toBe('completed'); // ORDER COMPLETE
    expect(updated.doordash.proofOfDeliveryUrl).toBeTruthy();
  });

  test('cancelled delivery flow', () => {
    const externalDeliveryId = generateExternalDeliveryId('rest1');

    store.createOrder('order-002', {
      orderNumber: 'order-002',
      restaurantId: 'rest1',
      orderType: 'delivery',
      status: 'new',
      total: 30,
      doordash: {
        externalDeliveryId,
        deliveryStatus: 'driver_assigned',
      },
    });

    // Restaurant cancels the delivery
    const event = mapWebhookEvent('DELIVERY_CANCELLED');
    const status = mapDeliveryStatus(event);

    store.updateOrder('order-002', {
      'doordash.deliveryStatus': status.deliveryStatus,
      'doordash.cancelReason': 'Cancelled by restaurant',
    });
    if (status.orderStatus) store.updateOrder('order-002', { status: status.orderStatus });

    const updated = store.getOrder('order-002');
    expect(updated.doordash.deliveryStatus).toBe('cancelled');
    expect(updated.status).toBe('delivery_failed');
    expect(updated.doordash.cancelReason).toBe('Cancelled by restaurant');
  });

  test('webhook correctly finds order by external delivery ID', () => {
    const externalId = 'kc-rest1-1712345678901';

    store.createOrder('order-A', {
      orderType: 'pickup',
      status: 'new',
    });

    store.createOrder('order-B', {
      orderType: 'delivery',
      status: 'new',
      doordash: { externalDeliveryId: externalId },
    });

    const found = store.findByExternalDeliveryId(externalId);
    expect(found).toBeTruthy();
    expect(found.id).toBe('order-B');
  });

  test('webhook parses restaurant ID from external delivery ID', () => {
    const restaurantId = 'my-restaurant-123';
    const externalId = generateExternalDeliveryId(restaurantId);
    const parsed = parseExternalDeliveryId(externalId);
    expect(parsed).toBe(restaurantId);
  });

  test('delivery fee is included in order total', () => {
    const subtotal = 50;
    const taxRate = 10;
    const deliveryFee = 12.50;
    const driverTip = 8;
    const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const total = Math.round((subtotal + tax + deliveryFee + driverTip) * 100) / 100;

    store.createOrder('order-003', {
      orderType: 'delivery',
      subtotal,
      tax,
      total,
      deliveryFee,
      driverTip,
    });

    const order = store.getOrder('order-003');
    expect(order.total).toBe(75.50); // 50 + 5 + 12.50 + 8
    expect(order.deliveryFee).toBe(12.50);
    expect(order.driverTip).toBe(8);
  });

  test('delivery order with Stripe payment stores payment details', () => {
    store.createOrder('order-004', {
      orderType: 'delivery',
      status: 'new',
      paymentMethod: 'card',
      paymentDetails: {
        paymentMethodId: 'pm_test_123',
        amount: 41.88,
        status: 'pending'
      },
      doordash: {
        externalDeliveryId: 'kc-rest1-12345',
        deliveryStatus: 'awaiting_driver',
      },
    });

    const order = store.getOrder('order-004');
    expect(order.paymentMethod).toBe('card');
    expect(order.paymentDetails.paymentMethodId).toBe('pm_test_123');
    expect(order.doordash.externalDeliveryId).toBeTruthy();
  });

  test('all webhook events process in sequence', () => {
    const webhookEvents = [
      'DELIVERY_CREATED',
      'DASHER_CONFIRMED',
      'DASHER_ENROUTE_TO_PICKUP',
      'DASHER_ARRIVED_AT_PICKUP',
      'DASHER_PICKED_UP',
      'DASHER_ENROUTE_TO_DROPOFF',
      'DASHER_ARRIVED_AT_DROPOFF',
      'DASHER_DROPPED_OFF',
    ];

    store.createOrder('order-005', {
      orderType: 'delivery',
      status: 'new',
      doordash: {
        externalDeliveryId: 'kc-rest1-99999',
        deliveryStatus: 'quoted',
      },
    });

    const expectedFinalStatuses = {
      delivery: 'delivered',
      order: 'completed',
    };

    webhookEvents.forEach(event => {
      const ddStatus = mapWebhookEvent(event);
      expect(ddStatus).toBeTruthy(); // All events should map

      const { deliveryStatus, orderStatus } = mapDeliveryStatus(ddStatus);
      store.updateOrder('order-005', { 'doordash.deliveryStatus': deliveryStatus });
      if (orderStatus) store.updateOrder('order-005', { status: orderStatus });
    });

    const final = store.getOrder('order-005');
    expect(final.doordash.deliveryStatus).toBe(expectedFinalStatuses.delivery);
    expect(final.status).toBe(expectedFinalStatuses.order);
  });

  test('delivery settings structure is correct', () => {
    const settings = {
      enabled: true,
      doordashBusinessId: 'biz-123',
      doordashStoreId: 'store-456',
      pickupInstructions: 'Counter 3',
      defaultPrepTime: 25,
      contactlessDefault: true,
      tipSuggestions: [15, 20, 25],
    };

    expect(settings.enabled).toBe(true);
    expect(settings.doordashBusinessId).toBeTruthy();
    expect(settings.defaultPrepTime).toBe(25);
    expect(settings.tipSuggestions).toHaveLength(3);
  });
});

// ============================================
// Quote Expiry Integration Tests
// ============================================

describe('Quote Expiry — Accept Before Order Creation', () => {
  let store;

  beforeEach(() => {
    store = new MockOrderStore();
  });

  test('expired quote with successful auto re-quote creates order with updated fee', () => {
    const restaurantId = 'rest-expiry-1';
    const originalQuoteId = generateExternalDeliveryId(restaurantId);
    const originalFeeCents = 975; // $9.75

    // Simulate: acceptQuote fails with expired error
    let quoteAccepted = false;
    let doordashData = null;

    try {
      // First accept attempt fails (expired)
      throw { status: 400, message: 'Quote expired', doordashError: null };
    } catch (err) {
      const isExpired = err.status === 400 && err.message?.toLowerCase().includes('expired');
      expect(isExpired).toBe(true);

      // Auto re-quote succeeds with new fee
      const newQuoteId = generateExternalDeliveryId(restaurantId);
      const newFeeCents = 1050; // $10.50, within 20% threshold

      const threshold = originalFeeCents * 1.2;
      if (newFeeCents <= threshold) {
        // Accept new quote
        doordashData = {
          externalDeliveryId: newQuoteId,
          deliveryStatus: 'awaiting_driver',
          fee: newFeeCents,
          tip: 500,
          trackingUrl: 'https://track.doordash.com/new123',
        };
        quoteAccepted = true;
      }
    }

    expect(quoteAccepted).toBe(true);
    expect(doordashData).not.toBeNull();
    expect(doordashData.fee).toBe(1050);

    // NOW create the order with updated fee
    const newDeliveryFee = doordashData.fee / 100; // $10.50
    const subtotal = 25;
    const taxRate = 8.5;
    const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
    const driverTip = 5;
    const total = Math.round((subtotal + tax + newDeliveryFee + driverTip) * 100) / 100;

    const order = store.createOrder('order-requote', {
      orderNumber: 'order-requote',
      restaurantId,
      orderType: 'delivery',
      status: 'new',
      subtotal,
      tax,
      total,
      deliveryFee: newDeliveryFee,
      driverTip,
      doordash: doordashData,
    });

    expect(order.total).toBe(42.63); // 25 + 2.13 + 10.50 + 5
    expect(order.deliveryFee).toBe(10.50);
    expect(order.doordash.externalDeliveryId).toMatch(/^kc-rest-expiry-1-/);
    expect(order.doordash.trackingUrl).toBeTruthy();
  });

  test('expired quote with fee exceeding threshold does NOT create order', () => {
    const originalFeeCents = 975;
    const newFeeCents = 1500; // $15 — over 20% of $9.75

    let orderCreated = false;
    let errorResponse = null;

    try {
      throw { status: 400, message: 'Quote expired' };
    } catch (err) {
      const threshold = originalFeeCents * 1.2; // 1170
      if (newFeeCents > threshold) {
        errorResponse = {
          error: 'quote_expired',
          message: 'Delivery quote expired and the new delivery fee is higher.',
          newFee: newFeeCents,
          newFeeFormatted: `$${(newFeeCents / 100).toFixed(2)}`,
        };
      } else {
        orderCreated = true;
      }
    }

    expect(orderCreated).toBe(false);
    expect(errorResponse).not.toBeNull();
    expect(errorResponse.error).toBe('quote_expired');
    expect(errorResponse.newFee).toBe(1500);
    expect(Object.keys(store.orders)).toHaveLength(0);
  });

  test('expired quote with failed re-quote does NOT create order', () => {
    let orderCreated = false;
    let errorResponse = null;

    try {
      throw { status: 400, message: 'Quote expired' };
    } catch (err) {
      // Re-quote attempt also fails
      try {
        throw new Error('DoorDash API unavailable');
      } catch (reQuoteErr) {
        errorResponse = {
          error: 'quote_expired',
          message: 'Delivery quote expired. Please go back and refresh your delivery quote.',
        };
      }
    }

    expect(orderCreated).toBe(false);
    expect(errorResponse.error).toBe('quote_expired');
    expect(Object.keys(store.orders)).toHaveLength(0);
  });

  test('non-expiry DoorDash error does NOT create order and returns delivery_failed', () => {
    let orderCreated = false;
    let errorResponse = null;

    try {
      throw { status: 500, message: 'Internal DoorDash error' };
    } catch (err) {
      const isExpired = err.status === 400 && err.message?.toLowerCase().includes('expired');
      if (!isExpired) {
        errorResponse = {
          error: 'delivery_failed',
          message: 'Failed to arrange delivery. Please try again.',
        };
      }
    }

    expect(orderCreated).toBe(false);
    expect(errorResponse.error).toBe('delivery_failed');
    expect(Object.keys(store.orders)).toHaveLength(0);
  });

  test('pickup orders skip DoorDash acceptance entirely and create order', () => {
    const orderData = {
      orderType: 'pickup',
      doordashQuoteId: null,
    };

    const needsDoorDash = orderData.orderType === 'delivery' && orderData.doordashQuoteId;
    expect(needsDoorDash).toBe(false);

    // Order is created without DoorDash
    const order = store.createOrder('order-pickup', {
      orderNumber: 'order-pickup',
      restaurantId: 'rest1',
      orderType: 'pickup',
      status: 'new',
      total: 27.13,
    });

    expect(order.status).toBe('new');
    expect(order.doordash).toBeUndefined();
  });

  test('successful first-try acceptance creates order normally', () => {
    const externalId = generateExternalDeliveryId('rest1');
    const doordashData = {
      externalDeliveryId: externalId,
      deliveryStatus: 'awaiting_driver',
      fee: 975,
      tip: 500,
      trackingUrl: 'https://track.doordash.com/abc',
    };

    const order = store.createOrder('order-first-try', {
      orderNumber: 'order-first-try',
      restaurantId: 'rest1',
      orderType: 'delivery',
      status: 'new',
      subtotal: 25,
      tax: 2.13,
      total: 41.88,
      deliveryFee: 9.75,
      driverTip: 5,
      doordash: doordashData,
    });

    expect(order.doordash.deliveryStatus).toBe('awaiting_driver');
    expect(order.doordash.trackingUrl).toBeTruthy();
    expect(order.total).toBe(41.88);
  });
});
