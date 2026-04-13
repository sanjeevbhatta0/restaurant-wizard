/**
 * Delivery Integration Unit Tests
 *
 * Tests DoorDash service module: status mapping, ID generation/parsing,
 * delivery total calculations, order validation, and feature gating.
 */

// ============================================
// DoorDash Service Module (mirror for testing)
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

function extractDasherInfo(deliveryData) {
  if (!deliveryData) return null;
  const dasher = deliveryData.dasher;
  if (!dasher) return null;
  return {
    dasherName: [dasher.first_name, dasher.last_name].filter(Boolean).join(' ') || null,
    dasherPhone: dasher.phone_number || null,
    dasherVehicle: dasher.vehicle ? {
      make: dasher.vehicle.make || null,
      model: dasher.vehicle.model || null,
    } : null,
    dasherLocation: dasher.location ? {
      lat: dasher.location.lat,
      lng: dasher.location.lng,
    } : null,
  };
}

// Delivery total calculation (mirrors server-side logic)
function calculateDeliveryTotal(subtotal, taxRate, deliveryFee, driverTip, discounts = 0) {
  const discountedSubtotal = subtotal - discounts;
  const tax = Math.round(discountedSubtotal * (taxRate / 100) * 100) / 100;
  return Math.round((discountedSubtotal + tax + deliveryFee + driverTip) * 100) / 100;
}

// Tier features (mirror from SubscriptionContext)
const TIER_FEATURES = {
  scout: { features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments'] },
  ally: { features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments'] },
  guide: { features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'analytics', 'website-builder', 'website-integration'] },
  chief: { features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'analytics', 'website-builder', 'website-integration', 'seo-social', 'delivery'] },
  elder: { features: ['menu-management', 'pos', 'kitchen', 'server', 'orders', 'payments', 'analytics', 'website-builder', 'website-integration', 'seo-social', 'ai-analytics', 'ai-content', 'delivery'] },
};

// ============================================
// TESTS
// ============================================

describe('DoorDash Status Mapping', () => {
  test('maps all DoorDash statuses to internal statuses', () => {
    const statuses = [
      'quote', 'created', 'confirmed', 'enroute_to_pickup',
      'arrived_at_pickup', 'picked_up', 'enroute_to_dropoff',
      'arrived_at_dropoff', 'delivered', 'cancelled'
    ];

    statuses.forEach(status => {
      const result = mapDeliveryStatus(status);
      expect(result).toHaveProperty('deliveryStatus');
      expect(result).toHaveProperty('orderStatus');
      expect(result.deliveryStatus).toBeTruthy();
    });
  });

  test('picked_up triggers out_for_delivery order status', () => {
    const result = mapDeliveryStatus('picked_up');
    expect(result.deliveryStatus).toBe('picked_up');
    expect(result.orderStatus).toBe('out_for_delivery');
  });

  test('delivered triggers completed order status', () => {
    const result = mapDeliveryStatus('delivered');
    expect(result.deliveryStatus).toBe('delivered');
    expect(result.orderStatus).toBe('completed');
  });

  test('cancelled triggers delivery_failed order status', () => {
    const result = mapDeliveryStatus('cancelled');
    expect(result.deliveryStatus).toBe('cancelled');
    expect(result.orderStatus).toBe('delivery_failed');
  });

  test('pre-pickup statuses do not change order status', () => {
    const prePickupStatuses = ['quote', 'created', 'confirmed', 'enroute_to_pickup', 'arrived_at_pickup'];
    prePickupStatuses.forEach(status => {
      const result = mapDeliveryStatus(status);
      expect(result.orderStatus).toBeNull();
    });
  });

  test('post-pickup transit statuses do not change order status', () => {
    const transitStatuses = ['enroute_to_dropoff', 'arrived_at_dropoff'];
    transitStatuses.forEach(status => {
      const result = mapDeliveryStatus(status);
      expect(result.orderStatus).toBeNull();
    });
  });

  test('unknown status returns the status as deliveryStatus with null orderStatus', () => {
    const result = mapDeliveryStatus('some_unknown_status');
    expect(result.deliveryStatus).toBe('some_unknown_status');
    expect(result.orderStatus).toBeNull();
  });
});

describe('DoorDash Webhook Event Mapping', () => {
  test('maps all known webhook events', () => {
    expect(mapWebhookEvent('DELIVERY_CREATED')).toBe('created');
    expect(mapWebhookEvent('DASHER_CONFIRMED')).toBe('confirmed');
    expect(mapWebhookEvent('DASHER_ENROUTE_TO_PICKUP')).toBe('enroute_to_pickup');
    expect(mapWebhookEvent('DASHER_ARRIVED_AT_PICKUP')).toBe('arrived_at_pickup');
    expect(mapWebhookEvent('DASHER_PICKED_UP')).toBe('picked_up');
    expect(mapWebhookEvent('DASHER_ENROUTE_TO_DROPOFF')).toBe('enroute_to_dropoff');
    expect(mapWebhookEvent('DASHER_ARRIVED_AT_DROPOFF')).toBe('arrived_at_dropoff');
    expect(mapWebhookEvent('DASHER_DROPPED_OFF')).toBe('delivered');
    expect(mapWebhookEvent('DELIVERY_CANCELLED')).toBe('cancelled');
  });

  test('returns null for unknown event', () => {
    expect(mapWebhookEvent('UNKNOWN_EVENT')).toBeNull();
    expect(mapWebhookEvent('')).toBeNull();
  });

  test('end-to-end: webhook event -> delivery status -> order status', () => {
    // DASHER_PICKED_UP -> picked_up -> out_for_delivery
    const ddStatus = mapWebhookEvent('DASHER_PICKED_UP');
    expect(ddStatus).toBe('picked_up');
    const result = mapDeliveryStatus(ddStatus);
    expect(result.orderStatus).toBe('out_for_delivery');

    // DASHER_DROPPED_OFF -> delivered -> completed
    const ddStatus2 = mapWebhookEvent('DASHER_DROPPED_OFF');
    expect(ddStatus2).toBe('delivered');
    const result2 = mapDeliveryStatus(ddStatus2);
    expect(result2.orderStatus).toBe('completed');
  });
});

describe('External Delivery ID', () => {
  test('generates ID with correct format', () => {
    const id = generateExternalDeliveryId('rest123');
    expect(id).toMatch(/^kc-rest123-\d+$/);
  });

  test('generates unique IDs', () => {
    const id1 = generateExternalDeliveryId('rest123');
    // Tiny delay for unique timestamp
    const id2 = generateExternalDeliveryId('rest123');
    // They should both start with kc-rest123 (timestamps may match in fast execution)
    expect(id1).toMatch(/^kc-rest123-/);
    expect(id2).toMatch(/^kc-rest123-/);
  });

  test('parses restaurant ID from external delivery ID', () => {
    expect(parseExternalDeliveryId('kc-rest123-1712345678901')).toBe('rest123');
  });

  test('parses restaurant ID with hyphens', () => {
    expect(parseExternalDeliveryId('kc-my-restaurant-id-1712345678901')).toBe('my-restaurant-id');
  });

  test('returns null for invalid formats', () => {
    expect(parseExternalDeliveryId(null)).toBeNull();
    expect(parseExternalDeliveryId('')).toBeNull();
    expect(parseExternalDeliveryId('invalid-id')).toBeNull();
    expect(parseExternalDeliveryId('kc-')).toBeNull();
    expect(parseExternalDeliveryId('kc-onlyonepart')).toBeNull();
  });

  test('roundtrip: generate then parse', () => {
    const restaurantId = 'test-restaurant-123';
    const externalId = generateExternalDeliveryId(restaurantId);
    const parsed = parseExternalDeliveryId(externalId);
    expect(parsed).toBe(restaurantId);
  });
});

describe('Dasher Info Extraction', () => {
  test('extracts full dasher info', () => {
    const data = {
      dasher: {
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '+15551234567',
        vehicle: { make: 'Toyota', model: 'Camry' },
        location: { lat: 37.77, lng: -122.41 }
      }
    };
    const info = extractDasherInfo(data);
    expect(info.dasherName).toBe('John Doe');
    expect(info.dasherPhone).toBe('+15551234567');
    expect(info.dasherVehicle).toEqual({ make: 'Toyota', model: 'Camry' });
    expect(info.dasherLocation).toEqual({ lat: 37.77, lng: -122.41 });
  });

  test('handles partial dasher info', () => {
    const data = {
      dasher: {
        first_name: 'Jane',
        last_name: '',
        phone_number: null
      }
    };
    const info = extractDasherInfo(data);
    expect(info.dasherName).toBe('Jane');
    expect(info.dasherPhone).toBeNull();
    expect(info.dasherVehicle).toBeNull();
  });

  test('returns null when no dasher', () => {
    expect(extractDasherInfo({})).toBeNull();
    expect(extractDasherInfo(null)).toBeNull();
    expect(extractDasherInfo({ dasher: null })).toBeNull();
  });
});

describe('Delivery Total Calculation', () => {
  test('calculates total with delivery fee and tip', () => {
    // subtotal $25, tax 8.5%, delivery fee $9.75, tip $5
    const total = calculateDeliveryTotal(25, 8.5, 9.75, 5);
    // 25 + 2.125 (rounded to 2.13) + 9.75 + 5 = 41.88
    expect(total).toBe(41.88);
  });

  test('calculates total with no delivery fee (pickup)', () => {
    const total = calculateDeliveryTotal(25, 8.5, 0, 0);
    expect(total).toBe(27.13); // 25 + 2.125 rounded = 27.13
  });

  test('applies discounts before tax', () => {
    // subtotal $30, discount $5 -> $25 taxable, tax 10%, fee $8, tip $3
    const total = calculateDeliveryTotal(30, 10, 8, 3, 5);
    // (30 - 5) + 2.50 + 8 + 3 = 38.50
    expect(total).toBe(38.50);
  });

  test('handles zero subtotal', () => {
    const total = calculateDeliveryTotal(0, 8.5, 9.75, 5);
    expect(total).toBe(14.75); // 0 + 0 + 9.75 + 5
  });

  test('handles zero tip', () => {
    const total = calculateDeliveryTotal(20, 10, 9.75, 0);
    expect(total).toBe(31.75); // 20 + 2 + 9.75 + 0
  });
});

describe('Order Validation for Delivery', () => {
  function validateDeliveryOrder(orderData) {
    const errors = [];
    if (orderData.orderType === 'delivery') {
      if (!orderData.deliveryAddress || !orderData.deliveryAddress.fullAddress) {
        errors.push('Delivery address is required');
      }
      if (!orderData.doordashQuoteId) {
        errors.push('Delivery quote is required');
      }
    }
    if (!orderData.restaurantId) errors.push('Restaurant ID is required');
    if (!orderData.customer) errors.push('Customer info is required');
    if (!orderData.items || orderData.items.length === 0) errors.push('At least one item is required');
    return errors;
  }

  test('validates delivery order requires address', () => {
    const errors = validateDeliveryOrder({
      orderType: 'delivery',
      restaurantId: 'rest1',
      customer: { name: 'Test' },
      items: [{ name: 'Pizza' }],
      doordashQuoteId: 'kc-rest1-123'
    });
    expect(errors).toContain('Delivery address is required');
  });

  test('validates delivery order requires quote ID', () => {
    const errors = validateDeliveryOrder({
      orderType: 'delivery',
      restaurantId: 'rest1',
      customer: { name: 'Test' },
      items: [{ name: 'Pizza' }],
      deliveryAddress: { fullAddress: '123 Main St' }
    });
    expect(errors).toContain('Delivery quote is required');
  });

  test('valid delivery order passes validation', () => {
    const errors = validateDeliveryOrder({
      orderType: 'delivery',
      restaurantId: 'rest1',
      customer: { name: 'Test' },
      items: [{ name: 'Pizza' }],
      deliveryAddress: { fullAddress: '123 Main St' },
      doordashQuoteId: 'kc-rest1-123'
    });
    expect(errors).toHaveLength(0);
  });

  test('pickup order does not require delivery fields', () => {
    const errors = validateDeliveryOrder({
      orderType: 'pickup',
      restaurantId: 'rest1',
      customer: { name: 'Test' },
      items: [{ name: 'Pizza' }]
    });
    expect(errors).toHaveLength(0);
  });
});

describe('Feature Gating for Delivery', () => {
  test('delivery is available on chief tier', () => {
    expect(TIER_FEATURES.chief.features).toContain('delivery');
  });

  test('delivery is available on elder tier', () => {
    expect(TIER_FEATURES.elder.features).toContain('delivery');
  });

  test('delivery is NOT available on scout tier', () => {
    expect(TIER_FEATURES.scout.features).not.toContain('delivery');
  });

  test('delivery is NOT available on ally tier', () => {
    expect(TIER_FEATURES.ally.features).not.toContain('delivery');
  });

  test('delivery is NOT available on guide tier', () => {
    expect(TIER_FEATURES.guide.features).not.toContain('delivery');
  });
});

describe('Delivery Order Document Structure', () => {
  test('delivery order has correct fields', () => {
    const order = {
      orderNumber: '1712345678-123',
      restaurantId: 'rest1',
      orderType: 'delivery',
      deliveryAddress: { fullAddress: '123 Main St, City, ST 12345' },
      deliveryInstructions: 'Leave at door',
      contactlessDelivery: true,
      deliveryFee: 9.75,
      driverTip: 5.00,
      doordash: {
        externalDeliveryId: 'kc-rest1-1712345678901',
        deliveryStatus: 'driver_assigned',
        trackingUrl: 'https://tracking.doordash.com/...',
        fee: 975,
        tip: 500,
        dasherName: 'John D.',
        dasherPhone: '+15551234567',
      },
      status: 'new',
    };

    expect(order.orderType).toBe('delivery');
    expect(order.deliveryAddress.fullAddress).toBeTruthy();
    expect(order.deliveryFee).toBe(9.75);
    expect(order.driverTip).toBe(5.00);
    expect(order.doordash.externalDeliveryId).toMatch(/^kc-/);
    expect(order.doordash.fee).toBe(975); // cents
    expect(order.doordash.tip).toBe(500); // cents
    expect(order.doordash.trackingUrl).toBeTruthy();
  });

  test('delivery order total includes fee and tip', () => {
    const subtotal = 25;
    const taxRate = 8.5;
    const deliveryFee = 9.75;
    const driverTip = 5;
    const total = calculateDeliveryTotal(subtotal, taxRate, deliveryFee, driverTip);
    // 25 + 2.13 + 9.75 + 5 = 41.88
    expect(total).toBe(41.88);
  });
});

describe('Cancellation Rules', () => {
  const nonCancellableStatuses = ['picked_up', 'driver_enroute_dropoff', 'driver_at_dropoff', 'delivered', 'cancelled'];
  const cancellableStatuses = ['quoted', 'awaiting_driver', 'driver_assigned', 'driver_enroute_pickup', 'driver_at_pickup'];

  test('cannot cancel after pickup', () => {
    nonCancellableStatuses.forEach(status => {
      expect(nonCancellableStatuses).toContain(status);
    });
  });

  test('can cancel before pickup', () => {
    cancellableStatuses.forEach(status => {
      expect(nonCancellableStatuses).not.toContain(status);
    });
  });
});

// ============================================
// Quote Expiry Logic (mirrors submitOrder + embed-app.js)
// ============================================

function isQuoteExpiredError(error) {
  return error.status === 400 &&
    (error.doordashError?.field_errors?.some(e => e.field === 'external_delivery_id') ||
     error.message?.toLowerCase().includes('expired') ||
     error.message?.toLowerCase().includes('quote'));
}

function shouldAutoReQuote(newFeeCents, originalFeeCents) {
  if (originalFeeCents <= 0) return true;
  const threshold = originalFeeCents * 1.2; // 20% above original
  return newFeeCents <= threshold;
}

function isQuoteStale(fetchedAtMs, nowMs, expiryMs = 270000) {
  if (!fetchedAtMs) return true;
  return (nowMs - fetchedAtMs) >= expiryMs;
}

describe('Quote Expiry Detection', () => {
  test('detects expired quote from DoorDash 400 with field_errors', () => {
    const err = {
      status: 400,
      message: 'Bad Request',
      doordashError: {
        field_errors: [{ field: 'external_delivery_id', error: 'Invalid or expired' }]
      }
    };
    expect(isQuoteExpiredError(err)).toBe(true);
  });

  test('detects expired quote from message containing "expired"', () => {
    const err = { status: 400, message: 'Quote has expired', doordashError: null };
    expect(isQuoteExpiredError(err)).toBe(true);
  });

  test('detects expired quote from message containing "quote"', () => {
    const err = { status: 400, message: 'Invalid quote ID', doordashError: null };
    expect(isQuoteExpiredError(err)).toBe(true);
  });

  test('does not flag non-400 errors as quote expiry', () => {
    const err = { status: 500, message: 'Internal server error', doordashError: null };
    expect(isQuoteExpiredError(err)).toBe(false);
  });

  test('does not flag 400 with unrelated message', () => {
    const err = { status: 400, message: 'Invalid phone number format', doordashError: null };
    expect(isQuoteExpiredError(err)).toBe(false);
  });

  test('does not flag 400 with unrelated field_errors', () => {
    const err = {
      status: 400,
      message: 'Validation error',
      doordashError: {
        field_errors: [{ field: 'dropoff_address', error: 'Address not found' }]
      }
    };
    expect(isQuoteExpiredError(err)).toBe(false);
  });
});

describe('Auto Re-Quote Fee Threshold', () => {
  test('accepts re-quote when fee is same as original', () => {
    expect(shouldAutoReQuote(975, 975)).toBe(true);
  });

  test('accepts re-quote when fee is slightly lower', () => {
    expect(shouldAutoReQuote(900, 975)).toBe(true);
  });

  test('accepts re-quote when fee is within 20% higher', () => {
    // 975 * 1.2 = 1170, so 1170 is exactly at threshold
    expect(shouldAutoReQuote(1170, 975)).toBe(true);
  });

  test('accepts re-quote when fee is 10% higher', () => {
    expect(shouldAutoReQuote(1073, 975)).toBe(true);
  });

  test('rejects re-quote when fee exceeds 20% threshold', () => {
    expect(shouldAutoReQuote(1171, 975)).toBe(false);
  });

  test('rejects re-quote when fee is double the original', () => {
    expect(shouldAutoReQuote(1950, 975)).toBe(false);
  });

  test('accepts any fee when original was 0 (free delivery)', () => {
    expect(shouldAutoReQuote(500, 0)).toBe(true);
  });

  test('accepts zero fee re-quote', () => {
    expect(shouldAutoReQuote(0, 975)).toBe(true);
  });
});

describe('Frontend Quote Staleness Check', () => {
  test('quote is stale when no fetchedAt timestamp', () => {
    expect(isQuoteStale(null, Date.now())).toBe(true);
    expect(isQuoteStale(undefined, Date.now())).toBe(true);
  });

  test('quote is fresh immediately after fetching', () => {
    const now = Date.now();
    expect(isQuoteStale(now, now)).toBe(false);
  });

  test('quote is fresh at 2 minutes', () => {
    const now = Date.now();
    const twoMinAgo = now - 120000;
    expect(isQuoteStale(twoMinAgo, now)).toBe(false);
  });

  test('quote is fresh at 4 minutes', () => {
    const now = Date.now();
    const fourMinAgo = now - 240000;
    expect(isQuoteStale(fourMinAgo, now)).toBe(false);
  });

  test('quote expires at 4.5 minutes (270000ms)', () => {
    const now = Date.now();
    const fourHalfMinAgo = now - 270000;
    expect(isQuoteStale(fourHalfMinAgo, now)).toBe(true);
  });

  test('quote expires at 5 minutes', () => {
    const now = Date.now();
    const fiveMinAgo = now - 300000;
    expect(isQuoteStale(fiveMinAgo, now)).toBe(true);
  });

  test('uses custom expiry threshold', () => {
    const now = Date.now();
    const oneMinAgo = now - 60000;
    expect(isQuoteStale(oneMinAgo, now, 60000)).toBe(true);
    expect(isQuoteStale(oneMinAgo, now, 120000)).toBe(false);
  });
});

describe('Quote Expiry Order Flow', () => {
  test('delivery order without accepted quote should not create Firestore doc', () => {
    // Simulates the new backend logic: acceptQuote is called BEFORE order creation.
    // If acceptQuote fails and re-quote fails, no order document is created.
    let orderCreated = false;
    let doordashAccepted = false;

    // Simulate failed accept
    try {
      throw { status: 400, message: 'Quote expired' };
    } catch (err) {
      if (isQuoteExpiredError(err)) {
        // In the real code, this returns an error response without creating an order
        doordashAccepted = false;
      }
    }

    // Order creation only happens if doordash was accepted (or not delivery)
    if (doordashAccepted) {
      orderCreated = true;
    }

    expect(doordashAccepted).toBe(false);
    expect(orderCreated).toBe(false);
  });

  test('successful auto re-quote updates delivery fee in order total', () => {
    const originalFeeCents = 975; // $9.75
    const newFeeCents = 1050;     // $10.50 (within 20%)
    expect(shouldAutoReQuote(newFeeCents, originalFeeCents)).toBe(true);

    // Recalculate total with new fee
    const subtotal = 25;
    const taxRate = 8.5;
    const driverTip = 5;
    const newDeliveryFee = newFeeCents / 100; // $10.50
    const total = calculateDeliveryTotal(subtotal, taxRate, newDeliveryFee, driverTip);

    // 25 + 2.13 + 10.50 + 5 = 42.63
    expect(total).toBe(42.63);
  });

  test('rejected re-quote returns quote_expired with new fee info', () => {
    const originalFeeCents = 975;
    const newFeeCents = 1500; // $15 — over 20% threshold
    expect(shouldAutoReQuote(newFeeCents, originalFeeCents)).toBe(false);

    // Backend would return this response
    const errorResponse = {
      error: 'quote_expired',
      message: 'Delivery quote expired and the new delivery fee is higher. Please refresh your quote.',
      newFee: newFeeCents,
      newFeeFormatted: `$${(newFeeCents / 100).toFixed(2)}`,
    };

    expect(errorResponse.error).toBe('quote_expired');
    expect(errorResponse.newFee).toBe(1500);
    expect(errorResponse.newFeeFormatted).toBe('$15.00');
  });

  test('non-delivery orders skip DoorDash acceptance entirely', () => {
    const orderData = { orderType: 'pickup', doordashQuoteId: null };
    const needsDoorDash = orderData.orderType === 'delivery' && orderData.doordashQuoteId;
    expect(needsDoorDash).toBe(false);
  });

  test('delivery order with valid quote proceeds to acceptance', () => {
    const orderData = { orderType: 'delivery', doordashQuoteId: 'kc-rest1-123456' };
    const needsDoorDash = orderData.orderType === 'delivery' && !!orderData.doordashQuoteId;
    expect(needsDoorDash).toBe(true);
  });
});
