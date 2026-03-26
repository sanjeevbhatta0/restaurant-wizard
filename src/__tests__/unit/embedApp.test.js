/**
 * Unit Tests — Embed App Business Logic
 * Tests cart calculations, price/discount handling, tax, order data construction,
 * pickup time generation, and localStorage persistence for the embeddable widget.
 *
 * Source: functions/templates/customer-portal/embed-app.js
 */

// ==========================================
// Cart Logic (mirrors EmbedApp methods)
// ==========================================

function addToCart(cart, item) {
  const existing = cart.find(i => i.id === item.id);
  if (existing) {
    existing.qty += 1;
    return [...cart];
  }
  return [...cart, { ...item, qty: 1 }];
}

function removeFromCart(cart, itemId) {
  return cart.filter(i => i.id !== itemId);
}

function updateQty(cart, itemId, delta) {
  const item = cart.find(i => i.id === itemId);
  if (!item) return cart;
  item.qty += delta;
  if (item.qty <= 0) {
    return removeFromCart(cart, itemId);
  }
  return [...cart];
}

function cartItemCount(cart) {
  return cart.reduce((sum, i) => sum + i.qty, 0);
}

function cartTotal(cart) {
  return cart.reduce((sum, i) => sum + i.finalPrice * i.qty, 0);
}

function clearCart() {
  return [];
}

// ==========================================
// Price/Discount Logic (mirrors renderItems)
// ==========================================

function calculateFinalPrice(price, discount, discountType) {
  let finalPrice = price;
  if (discount > 0) {
    finalPrice = discountType === 'percentage'
      ? price * (1 - discount / 100)
      : price - discount;
  }
  return Math.max(0, finalPrice);
}

// ==========================================
// Tax Calculation (mirrors renderCartPanel / showCheckout)
// ==========================================

function calculateOrderTotals(cart, taxRate) {
  const rate = parseFloat(taxRate) || 8.5;
  const subtotal = cartTotal(cart);
  const tax = subtotal * (rate / 100);
  const total = subtotal + tax;
  return { subtotal, tax, total, taxRate: rate };
}

// ==========================================
// Order Data Construction (mirrors placeOrder)
// ==========================================

function buildOrderData(cart, customer, config, options = {}) {
  const subtotal = cartTotal(cart);
  const taxRate = parseFloat(config.taxRate) || 8.5;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const isPayNow = options.paymentMethod === 'payNow';

  return {
    restaurantId: config.restaurantId,
    locationId: config.locationId || config.restaurantId,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone
    },
    items: cart.map(i => ({
      id: i.id,
      name: i.name,
      price: i.price,
      finalPrice: i.finalPrice,
      quantity: i.qty,
      discount: i.discount || 0,
      discountType: i.discountType || 'amount'
    })),
    subtotal,
    tax,
    total,
    orderType: options.orderType || 'pickup',
    pickupTime: options.pickupTime || '',
    specialInstructions: options.specialInstructions || '',
    paymentMethod: isPayNow ? 'card' : 'payAtStore',
    paymentDetails: isPayNow && options.paymentMethodId ? {
      paymentMethodId: options.paymentMethodId,
      amount: total,
      status: 'pending'
    } : null,
    source: 'widget'
  };
}

// ==========================================
// Stripe Payment Method Selection (mirrors selectPaymentMethod)
// ==========================================

function selectPaymentMethod(method, stripeAvailable) {
  if (method === 'payNow' && !stripeAvailable) {
    return { selected: 'payLater', showCard: false, error: 'Stripe not available' };
  }
  return {
    selected: method === 'payNow' ? 'payNow' : 'payLater',
    showCard: method === 'payNow',
    error: null
  };
}

function validateStripeConfig(config) {
  const key = config?.stripeKey;
  if (!key) return { valid: false, reason: 'no key' };
  if (!key.startsWith('pk_')) return { valid: false, reason: 'invalid key format' };
  return { valid: true, reason: null };
}

// ==========================================
// Pickup Time Generation (mirrors generatePickupTimes)
// ==========================================

function generatePickupTimes(now) {
  const start = new Date(now.getTime() + 30 * 60000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15);
  const times = [];
  for (let i = 0; i < 12; i++) {
    const t = new Date(start.getTime() + i * 15 * 60000);
    times.push(t.toISOString());
  }
  return times;
}

// ==========================================
// localStorage Persistence (mirrors saveCart / loadCartFromStorage)
// ==========================================

function saveCart(cart, restaurantId) {
  const key = 'ea_cart_' + restaurantId;
  if (cart.length === 0) {
    return { key, value: JSON.stringify([]) };
  }
  return { key, value: JSON.stringify(cart) };
}

function loadCartFromStorage(stored) {
  try {
    if (stored) return JSON.parse(stored);
  } catch (e) {
    // corrupted data
  }
  return [];
}

// ==========================================
// Test Data
// ==========================================

const ITEM_BURGER = { id: 'burger-1', name: 'Classic Burger', price: 12.99, finalPrice: 12.99, discount: 0, discountType: 'amount' };
const ITEM_FRIES = { id: 'fries-1', name: 'French Fries', price: 5.99, finalPrice: 5.99, discount: 0, discountType: 'amount' };
const ITEM_DISCOUNTED = { id: 'salad-1', name: 'Caesar Salad', price: 10.00, finalPrice: 7.50, discount: 25, discountType: 'percentage' };
const ITEM_FLAT_DISCOUNT = { id: 'soup-1', name: 'Tomato Soup', price: 8.00, finalPrice: 5.00, discount: 3, discountType: 'amount' };

const TEST_CONFIG = {
  restaurantId: 'VkDL7WErBCRCvegCKDKD7BLPAZI2',
  locationId: 'VkDL7WErBCRCvegCKDKD7BLPAZI2',
  taxRate: 8.5
};

// ==========================================
// Tests
// ==========================================

describe('Embed App Business Logic', () => {

  // ---- Cart Calculations ----

  describe('Cart Operations', () => {
    it('should add a new item to empty cart with qty 1', () => {
      const cart = addToCart([], ITEM_BURGER);
      expect(cart).toHaveLength(1);
      expect(cart[0].id).toBe('burger-1');
      expect(cart[0].qty).toBe(1);
    });

    it('should increment qty when adding existing item', () => {
      let cart = addToCart([], ITEM_BURGER);
      cart = addToCart(cart, ITEM_BURGER);
      expect(cart).toHaveLength(1);
      expect(cart[0].qty).toBe(2);
    });

    it('should add multiple different items', () => {
      let cart = addToCart([], ITEM_BURGER);
      cart = addToCart(cart, ITEM_FRIES);
      expect(cart).toHaveLength(2);
    });

    it('should remove item from cart by id', () => {
      let cart = addToCart([], ITEM_BURGER);
      cart = addToCart(cart, ITEM_FRIES);
      cart = removeFromCart(cart, 'burger-1');
      expect(cart).toHaveLength(1);
      expect(cart[0].id).toBe('fries-1');
    });

    it('should increment qty with updateQty +1', () => {
      let cart = addToCart([], ITEM_BURGER);
      cart = updateQty(cart, 'burger-1', 1);
      expect(cart[0].qty).toBe(2);
    });

    it('should decrement qty with updateQty -1', () => {
      let cart = addToCart([], ITEM_BURGER);
      cart = addToCart(cart, ITEM_BURGER); // qty = 2
      cart = updateQty(cart, 'burger-1', -1);
      expect(cart[0].qty).toBe(1);
    });

    it('should remove item when qty reaches 0', () => {
      let cart = addToCart([], ITEM_BURGER); // qty = 1
      cart = updateQty(cart, 'burger-1', -1); // qty = 0
      expect(cart).toHaveLength(0);
    });

    it('should clear entire cart', () => {
      const cart = clearCart();
      expect(cart).toHaveLength(0);
      expect(cartItemCount(cart)).toBe(0);
    });
  });

  describe('Cart Totals', () => {
    it('should count total items across all cart entries', () => {
      let cart = addToCart([], ITEM_BURGER);
      cart = addToCart(cart, ITEM_BURGER); // qty 2
      cart = addToCart(cart, ITEM_FRIES);  // qty 1
      expect(cartItemCount(cart)).toBe(3);
    });

    it('should calculate total using finalPrice * qty', () => {
      let cart = addToCart([], ITEM_BURGER); // 12.99
      cart = addToCart(cart, ITEM_FRIES);    // 5.99
      expect(cartTotal(cart)).toBeCloseTo(18.98, 2);
    });

    it('should use discounted finalPrice for total', () => {
      let cart = addToCart([], ITEM_DISCOUNTED); // finalPrice 7.50
      expect(cartTotal(cart)).toBeCloseTo(7.50, 2);
    });

    it('should return 0 for empty cart', () => {
      expect(cartTotal([])).toBe(0);
      expect(cartItemCount([])).toBe(0);
    });
  });

  // ---- Price/Discount ----

  describe('Price and Discount Calculations', () => {
    it('should return full price when no discount', () => {
      expect(calculateFinalPrice(15.99, 0, 'percentage')).toBe(15.99);
    });

    it('should apply percentage discount correctly', () => {
      expect(calculateFinalPrice(20.00, 25, 'percentage')).toBe(15.00);
    });

    it('should apply flat dollar discount correctly', () => {
      expect(calculateFinalPrice(20.00, 5, 'amount')).toBe(15.00);
    });

    it('should floor at 0 for excessive discount', () => {
      expect(calculateFinalPrice(5.00, 10, 'amount')).toBe(0);
    });

    it('should handle 100% discount', () => {
      expect(calculateFinalPrice(25.00, 100, 'percentage')).toBe(0);
    });
  });

  // ---- Tax Calculation ----

  describe('Tax Calculation', () => {
    it('should apply default 8.5% tax rate', () => {
      const cart = [{ ...ITEM_BURGER, qty: 1 }]; // $12.99
      const totals = calculateOrderTotals(cart, undefined);
      expect(totals.taxRate).toBe(8.5);
      expect(totals.tax).toBeCloseTo(12.99 * 0.085, 2);
      expect(totals.total).toBeCloseTo(12.99 + 12.99 * 0.085, 2);
    });

    it('should apply custom tax rate', () => {
      const cart = [{ ...ITEM_BURGER, qty: 1 }]; // $12.99
      const totals = calculateOrderTotals(cart, 10);
      expect(totals.taxRate).toBe(10);
      expect(totals.tax).toBeCloseTo(1.299, 2);
    });

    it('should calculate tax on discounted subtotal', () => {
      const cart = [{ ...ITEM_DISCOUNTED, qty: 1 }]; // finalPrice 7.50
      const totals = calculateOrderTotals(cart, 8.5);
      expect(totals.subtotal).toBeCloseTo(7.50, 2);
      expect(totals.tax).toBeCloseTo(7.50 * 0.085, 2);
    });

    it('should return zero tax for empty cart', () => {
      const totals = calculateOrderTotals([], 8.5);
      expect(totals.subtotal).toBe(0);
      expect(totals.tax).toBe(0);
      expect(totals.total).toBe(0);
    });
  });

  // ---- Order Data Construction ----

  describe('Order Data Construction', () => {
    it('should include all required fields', () => {
      const cart = [{ ...ITEM_BURGER, qty: 2 }];
      const customer = { name: 'John Doe', email: 'john@test.com', phone: '555-1234' };
      const order = buildOrderData(cart, customer, TEST_CONFIG);

      expect(order.restaurantId).toBe(TEST_CONFIG.restaurantId);
      expect(order.customer.name).toBe('John Doe');
      expect(order.customer.email).toBe('john@test.com');
      expect(order.items).toHaveLength(1);
      expect(order.subtotal).toBeGreaterThan(0);
      expect(order.tax).toBeGreaterThan(0);
      expect(order.total).toBeGreaterThan(0);
    });

    it('should map cart qty to items quantity field', () => {
      const cart = [{ ...ITEM_BURGER, qty: 3 }];
      const customer = { name: 'Jane', email: 'jane@test.com', phone: '555-5678' };
      const order = buildOrderData(cart, customer, TEST_CONFIG);

      expect(order.items[0].quantity).toBe(3);
      expect(order.items[0].qty).toBeUndefined();
    });

    it('should set source to "widget"', () => {
      const cart = [{ ...ITEM_BURGER, qty: 1 }];
      const customer = { name: 'Test', email: 'test@test.com', phone: '555-0000' };
      const order = buildOrderData(cart, customer, TEST_CONFIG);

      expect(order.source).toBe('widget');
    });

    it('should default payment method to payAtStore', () => {
      const cart = [{ ...ITEM_BURGER, qty: 1 }];
      const customer = { name: 'Test', email: 'test@test.com', phone: '555-0000' };
      const order = buildOrderData(cart, customer, TEST_CONFIG);

      expect(order.paymentMethod).toBe('payAtStore');
      expect(order.paymentDetails).toBeNull();
    });

    it('should set payment method to card when payNow selected', () => {
      const cart = [{ ...ITEM_BURGER, qty: 1 }];
      const customer = { name: 'Test', email: 'test@test.com', phone: '555-0000' };
      const order = buildOrderData(cart, customer, TEST_CONFIG, {
        paymentMethod: 'payNow',
        paymentMethodId: 'pm_test_123'
      });

      expect(order.paymentMethod).toBe('card');
      expect(order.paymentDetails).not.toBeNull();
      expect(order.paymentDetails.paymentMethodId).toBe('pm_test_123');
      expect(order.paymentDetails.status).toBe('pending');
    });

    it('should include correct amount in paymentDetails', () => {
      const cart = [{ ...ITEM_BURGER, qty: 2 }]; // 12.99 * 2 = 25.98
      const customer = { name: 'Test', email: 'test@test.com', phone: '555-0000' };
      const order = buildOrderData(cart, customer, TEST_CONFIG, {
        paymentMethod: 'payNow',
        paymentMethodId: 'pm_test_456'
      });

      expect(order.paymentDetails.amount).toBe(order.total);
      expect(order.paymentDetails.amount).toBeCloseTo(25.98 + 25.98 * 0.085, 2);
    });

    it('should set paymentDetails to null when payNow but no paymentMethodId', () => {
      const cart = [{ ...ITEM_BURGER, qty: 1 }];
      const customer = { name: 'Test', email: 'test@test.com', phone: '555-0000' };
      const order = buildOrderData(cart, customer, TEST_CONFIG, {
        paymentMethod: 'payNow'
      });

      expect(order.paymentMethod).toBe('card');
      expect(order.paymentDetails).toBeNull();
    });

    it('should calculate correct subtotal, tax, and total', () => {
      const cart = [
        { ...ITEM_BURGER, qty: 2 },   // 12.99 * 2 = 25.98
        { ...ITEM_FRIES, qty: 1 }     // 5.99 * 1 = 5.99
      ];
      const customer = { name: 'Test', email: 'test@test.com', phone: '555-0000' };
      const order = buildOrderData(cart, customer, TEST_CONFIG);

      const expectedSubtotal = 25.98 + 5.99;
      const expectedTax = expectedSubtotal * 0.085;
      expect(order.subtotal).toBeCloseTo(expectedSubtotal, 2);
      expect(order.tax).toBeCloseTo(expectedTax, 2);
      expect(order.total).toBeCloseTo(expectedSubtotal + expectedTax, 2);
    });
  });

  // ---- Pickup Time Generation ----

  describe('Pickup Time Generation', () => {
    it('should generate 12 time slots', () => {
      const now = new Date('2026-03-26T12:00:00');
      const times = generatePickupTimes(now);
      expect(times).toHaveLength(12);
    });

    it('should start at least 30 minutes from now', () => {
      const now = new Date('2026-03-26T12:00:00');
      const times = generatePickupTimes(now);
      const firstTime = new Date(times[0]);
      const diffMinutes = (firstTime - now) / 60000;
      expect(diffMinutes).toBeGreaterThanOrEqual(30);
    });

    it('should use 15-minute intervals between slots', () => {
      const now = new Date('2026-03-26T12:00:00');
      const times = generatePickupTimes(now);
      for (let i = 1; i < times.length; i++) {
        const diff = new Date(times[i]) - new Date(times[i - 1]);
        expect(diff).toBe(15 * 60000); // 15 minutes in ms
      }
    });

    it('should return valid ISO string format', () => {
      const now = new Date('2026-03-26T12:00:00');
      const times = generatePickupTimes(now);
      times.forEach(t => {
        expect(() => new Date(t)).not.toThrow();
        expect(new Date(t).toISOString()).toBe(t);
      });
    });
  });

  // ---- Payment Method Selection ----

  describe('Payment Method Selection', () => {
    it('should select payLater by default', () => {
      const result = selectPaymentMethod('payLater', true);
      expect(result.selected).toBe('payLater');
      expect(result.showCard).toBe(false);
    });

    it('should select payNow when Stripe is available', () => {
      const result = selectPaymentMethod('payNow', true);
      expect(result.selected).toBe('payNow');
      expect(result.showCard).toBe(true);
    });

    it('should fall back to payLater when Stripe is not available', () => {
      const result = selectPaymentMethod('payNow', false);
      expect(result.selected).toBe('payLater');
      expect(result.showCard).toBe(false);
      expect(result.error).toBe('Stripe not available');
    });

    it('should validate Stripe config with valid key', () => {
      expect(validateStripeConfig({ stripeKey: 'pk_test_abc123' })).toEqual({ valid: true, reason: null });
      expect(validateStripeConfig({ stripeKey: 'pk_live_xyz789' })).toEqual({ valid: true, reason: null });
    });

    it('should reject Stripe config with missing key', () => {
      expect(validateStripeConfig({})).toEqual({ valid: false, reason: 'no key' });
      expect(validateStripeConfig(null)).toEqual({ valid: false, reason: 'no key' });
    });

    it('should reject Stripe config with invalid key format', () => {
      expect(validateStripeConfig({ stripeKey: 'sk_test_abc123' })).toEqual({ valid: false, reason: 'invalid key format' });
      expect(validateStripeConfig({ stripeKey: 'not-a-key' })).toEqual({ valid: false, reason: 'invalid key format' });
    });
  });

  // ---- Menu Caching ----

  describe('Menu Caching', () => {
    function getMenuCacheKey(restaurantId, locationId) {
      return `ea_menu_${restaurantId}_${locationId || 'all'}`;
    }

    function cacheMenu(restaurantId, locationId, data) {
      const key = getMenuCacheKey(restaurantId, locationId);
      return { key, value: JSON.stringify({ data, ts: Date.now() }) };
    }

    function getCachedMenu(raw, maxAge = 5 * 60 * 1000) {
      if (!raw) return null;
      try {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts > maxAge) return null;
        return cached.data;
      } catch { return null; }
    }

    const SAMPLE_MENU = [
      { id: 'cat1', name: 'Mains', items: [{ id: 'item1', name: 'Burger', price: 12.99 }] },
      { id: 'cat2', name: 'Sides', items: [{ id: 'item2', name: 'Fries', price: 5.99 }] }
    ];

    it('should generate correct cache key with restaurantId and locationId', () => {
      expect(getMenuCacheKey('rest-1', 'loc-1')).toBe('ea_menu_rest-1_loc-1');
      expect(getMenuCacheKey('rest-1', null)).toBe('ea_menu_rest-1_all');
      expect(getMenuCacheKey('rest-1', undefined)).toBe('ea_menu_rest-1_all');
    });

    it('should cache and retrieve menu data', () => {
      const { value } = cacheMenu('rest-1', 'loc-1', SAMPLE_MENU);
      const result = getCachedMenu(value);
      expect(result).toEqual(SAMPLE_MENU);
      expect(result).toHaveLength(2);
    });

    it('should return null for expired cache (TTL exceeded)', () => {
      const staleData = JSON.stringify({ data: SAMPLE_MENU, ts: Date.now() - 6 * 60 * 1000 });
      const result = getCachedMenu(staleData);
      expect(result).toBeNull();
    });

    it('should return valid data within TTL', () => {
      const freshData = JSON.stringify({ data: SAMPLE_MENU, ts: Date.now() - 2 * 60 * 1000 });
      const result = getCachedMenu(freshData);
      expect(result).toEqual(SAMPLE_MENU);
    });

    it('should return null for corrupted cache data', () => {
      expect(getCachedMenu('{{bad json}}')).toBeNull();
      expect(getCachedMenu(null)).toBeNull();
      expect(getCachedMenu(undefined)).toBeNull();
    });

    it('should use preloaded menu over cache when available', () => {
      // Simulates the priority: PRELOADED_MENU > cache > API
      const preloaded = [{ id: 'cat-new', name: 'New', items: [{ id: 'x', name: 'X', price: 1 }] }];
      const cached = SAMPLE_MENU;
      const menuData = (preloaded && preloaded.length > 0) ? preloaded : cached;
      expect(menuData).toBe(preloaded);
      expect(menuData[0].id).toBe('cat-new');
    });
  });

  // ---- Portal Data Staleness ----

  describe('Portal Data Staleness', () => {
    function isDataStale(loadedAt, ttlMs = 3 * 60 * 1000) {
      if (!loadedAt) return true;
      return Date.now() - loadedAt > ttlMs;
    }

    it('should be stale when no data loaded yet', () => {
      expect(isDataStale(null)).toBe(true);
      expect(isDataStale(undefined)).toBe(true);
    });

    it('should not be stale within TTL', () => {
      const recent = Date.now() - 60 * 1000; // 1 minute ago
      expect(isDataStale(recent)).toBe(false);
    });

    it('should be stale after TTL expires', () => {
      const old = Date.now() - 4 * 60 * 1000; // 4 minutes ago
      expect(isDataStale(old)).toBe(true);
    });

    it('should respect custom TTL', () => {
      const ts = Date.now() - 30 * 1000; // 30 seconds ago
      expect(isDataStale(ts, 60 * 1000)).toBe(false); // 1-min TTL: fresh
      expect(isDataStale(ts, 20 * 1000)).toBe(true);  // 20-sec TTL: stale
    });
  });

  // ---- localStorage Persistence ----

  describe('Cart Persistence', () => {
    it('should serialize and deserialize cart correctly', () => {
      const cart = [{ ...ITEM_BURGER, qty: 2 }, { ...ITEM_FRIES, qty: 1 }];
      const saved = saveCart(cart, 'test-restaurant');
      const loaded = loadCartFromStorage(saved.value);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('burger-1');
      expect(loaded[0].qty).toBe(2);
    });

    it('should return empty array for corrupted data', () => {
      const loaded = loadCartFromStorage('{{invalid json}}');
      expect(loaded).toEqual([]);
    });

    it('should include restaurantId in storage key', () => {
      const saved = saveCart([ITEM_BURGER], 'my-restaurant');
      expect(saved.key).toBe('ea_cart_my-restaurant');
    });

    it('should return empty array for null/undefined stored data', () => {
      expect(loadCartFromStorage(null)).toEqual([]);
      expect(loadCartFromStorage(undefined)).toEqual([]);
    });
  });
});
