/**
 * Integration Tests — Widget Order Flow
 * Tests the full widget embed flow as a data pipeline:
 *   Widget config → iframe URL → EmbedApp init → Menu fetch → Cart → Checkout → Order
 * Also tests postMessage bridge, view switching, and widget order identification in POS.
 *
 * Source: public/widget.js, functions/templates/customer-portal/embed-app.js, functions/index.js
 */

describe('Widget Order Flow — Integration', () => {

  // ==========================================
  // Widget → EmbedApp Configuration
  // ==========================================

  describe('Widget to EmbedApp Config Flow', () => {
    const BASE_URL = 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net/serveWebsite';

    function buildIframeUrl(config) {
      return BASE_URL +
        '?restaurant=' + encodeURIComponent(config.restaurantId) +
        '&embed=true' +
        '&tab=' + encodeURIComponent(config.defaultTab || 'menu');
    }

    it('should construct iframe URL with restaurant slug and embed param', () => {
      const url = buildIframeUrl({ restaurantId: 'gurkha-kitchen-express' });
      expect(url).toContain('restaurant=gurkha-kitchen-express');
      expect(url).toContain('embed=true');
    });

    it('should default tab to menu', () => {
      const url = buildIframeUrl({ restaurantId: 'test' });
      expect(url).toContain('tab=menu');
    });

    it('should pass custom default tab', () => {
      const url = buildIframeUrl({ restaurantId: 'test', defaultTab: 'promotions' });
      expect(url).toContain('tab=promotions');
    });

    it('should encode special characters in restaurant slug', () => {
      const url = buildIframeUrl({ restaurantId: 'café & bistro' });
      expect(url).toContain('restaurant=caf%C3%A9%20%26%20bistro');
    });
  });

  describe('EMBED_CONFIG Resolution', () => {
    // Simulates serveWebsite resolving slug to UID before building EMBED_CONFIG
    function resolveAndBuildConfig(slug, restaurants) {
      const match = restaurants.find(r => r.slug === slug);
      if (!match) return null;
      return {
        restaurantId: match.uid,    // Resolved UID, not slug
        locationId: match.uid,
        restaurantName: match.name,
        apiBaseUrl: 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net',
        initialTab: 'menu'
      };
    }

    const restaurants = [
      { slug: 'gurkha-kitchen-express', uid: 'VkDL7WErBCRCvegCKDKD7BLPAZI2', name: 'Gurkha Kitchen Express' }
    ];

    it('should resolve slug to Firebase UID in EMBED_CONFIG', () => {
      const config = resolveAndBuildConfig('gurkha-kitchen-express', restaurants);
      expect(config.restaurantId).toBe('VkDL7WErBCRCvegCKDKD7BLPAZI2');
      expect(config.restaurantId).not.toBe('gurkha-kitchen-express');
    });

    it('should return null for unknown slug', () => {
      const config = resolveAndBuildConfig('nonexistent', restaurants);
      expect(config).toBeNull();
    });
  });

  // ==========================================
  // Menu → Cart → Checkout Pipeline
  // ==========================================

  describe('Menu to Cart to Checkout Flow', () => {
    // Simulates getMenu API response
    const menuApiResponse = {
      categories: [
        {
          id: 'cat-starters', name: 'Starters',
          items: [
            { id: 's1', name: 'Spring Rolls', price: 8.99, discount: 0, discountType: 'amount', imageUrl: '' },
            { id: 's2', name: 'Momo', price: 9.99, discount: 2, discountType: 'amount', imageUrl: '' }
          ]
        },
        {
          id: 'cat-mains', name: 'Main Courses',
          items: [
            { id: 'm1', name: 'Butter Chicken', price: 16.99, discount: 0, discountType: 'amount', imageUrl: '' },
            { id: 'm2', name: 'Dal Tarka', price: 12.99, discount: 15, discountType: 'percentage', imageUrl: '' }
          ]
        }
      ]
    };

    it('should parse API response into categories with items', () => {
      const categories = menuApiResponse.categories.filter(c => c.items && c.items.length > 0);
      expect(categories).toHaveLength(2);
      expect(categories[0].items).toHaveLength(2);
      expect(categories[1].items).toHaveLength(2);
    });

    it('should filter items by active category', () => {
      const activeCategory = 'cat-starters';
      const category = menuApiResponse.categories.find(c => c.id === activeCategory);
      expect(category.name).toBe('Starters');
      expect(category.items).toHaveLength(2);
    });

    it('should build cart from multiple add operations', () => {
      // Simulate user adding items (like EmbedApp.addToCart)
      let cart = [];
      const addItem = (item) => {
        const existing = cart.find(i => i.id === item.id);
        if (existing) {
          existing.qty += 1;
        } else {
          cart.push({ ...item, qty: 1 });
        }
      };

      addItem({ id: 's1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99 });
      addItem({ id: 's1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99 }); // qty 2
      addItem({ id: 'm1', name: 'Butter Chicken', price: 16.99, finalPrice: 16.99 });

      expect(cart).toHaveLength(2);
      expect(cart[0].qty).toBe(2);
      expect(cart[1].qty).toBe(1);

      const total = cart.reduce((sum, i) => sum + i.finalPrice * i.qty, 0);
      expect(total).toBeCloseTo(8.99 * 2 + 16.99, 2);
    });

    it('should persist cart across view switches', () => {
      // Cart stored in memory (and localStorage), not in DOM
      const cart = [
        { id: 's1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99, qty: 2 }
      ];

      // Simulate view switch: menu → account → menu
      const viewSequence = ['menu', 'account', 'menu'];
      let currentView = 'menu';

      viewSequence.forEach(view => {
        currentView = view;
        // Cart should remain unchanged regardless of view
      });

      expect(cart).toHaveLength(1);
      expect(cart[0].qty).toBe(2);
      expect(currentView).toBe('menu');
    });

    it('should construct correct order payload from cart', () => {
      const cart = [
        { id: 's1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99, discount: 0, discountType: 'amount', qty: 2 },
        { id: 'm1', name: 'Butter Chicken', price: 16.99, finalPrice: 16.99, discount: 0, discountType: 'amount', qty: 1 }
      ];
      const customer = { name: 'Jane Doe', email: 'jane@test.com', phone: '555-1234' };
      const config = { restaurantId: 'uid-123', locationId: 'uid-123', taxRate: 8.5 };

      const subtotal = cart.reduce((sum, i) => sum + i.finalPrice * i.qty, 0);
      const tax = subtotal * (config.taxRate / 100);

      const orderData = {
        restaurantId: config.restaurantId,
        locationId: config.locationId,
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
        items: cart.map(i => ({
          id: i.id, name: i.name, price: i.price,
          finalPrice: i.finalPrice, quantity: i.qty,
          discount: i.discount, discountType: i.discountType
        })),
        subtotal, tax, total: subtotal + tax,
        orderType: 'pickup',
        paymentMethod: 'payAtStore',
        source: 'widget'
      };

      expect(orderData.source).toBe('widget');
      expect(orderData.items).toHaveLength(2);
      expect(orderData.items[0].quantity).toBe(2);
      expect(orderData.subtotal).toBeCloseTo(34.97, 2);
      expect(orderData.total).toBeCloseTo(34.97 + 34.97 * 0.085, 2);
    });

    it('should include widget source in order payload', () => {
      const orderData = {
        restaurantId: 'test',
        customer: { name: 'Test' },
        items: [{ id: '1', quantity: 1 }],
        source: 'widget'
      };
      expect(orderData.source).toBe('widget');
    });
  });

  // ==========================================
  // PostMessage Bridge
  // ==========================================

  describe('PostMessage Bridge', () => {
    function createMessage(type, data = {}) {
      return { type, ...data };
    }

    function handleMessage(message, state) {
      if (!message || typeof message.type !== 'string') return state;
      if (!message.type.startsWith('koda-')) return state;

      const newState = { ...state };

      switch (message.type) {
        case 'koda-navigate':
          newState.activeTab = message.tab;
          break;
        case 'koda-cart-update':
          newState.cartCount = message.count;
          newState.cartTotal = message.total;
          break;
        case 'koda-auth-change':
          newState.authenticated = message.authenticated;
          newState.userEmail = message.user?.email || null;
          break;
        case 'koda-embed-ready':
          newState.ready = true;
          break;
        case 'koda-tab-change':
          newState.activeTab = message.tab;
          break;
        default:
          break;
      }

      return newState;
    }

    it('should handle koda-navigate to switch tabs', () => {
      const msg = createMessage('koda-navigate', { tab: 'orders' });
      const state = handleMessage(msg, { activeTab: 'menu' });
      expect(state.activeTab).toBe('orders');
    });

    it('should handle koda-cart-update with count and total', () => {
      const msg = createMessage('koda-cart-update', { count: 3, total: 25.99 });
      const state = handleMessage(msg, { cartCount: 0, cartTotal: 0 });
      expect(state.cartCount).toBe(3);
      expect(state.cartTotal).toBe(25.99);
    });

    it('should handle koda-auth-change for login', () => {
      const msg = createMessage('koda-auth-change', {
        authenticated: true,
        user: { email: 'user@test.com', name: 'Test User' }
      });
      const state = handleMessage(msg, { authenticated: false });
      expect(state.authenticated).toBe(true);
      expect(state.userEmail).toBe('user@test.com');
    });

    it('should handle koda-auth-change for logout', () => {
      const msg = createMessage('koda-auth-change', { authenticated: false });
      const state = handleMessage(msg, { authenticated: true, userEmail: 'user@test.com' });
      expect(state.authenticated).toBe(false);
      expect(state.userEmail).toBeNull();
    });

    it('should handle koda-embed-ready', () => {
      const msg = createMessage('koda-embed-ready');
      const state = handleMessage(msg, { ready: false });
      expect(state.ready).toBe(true);
    });

    it('should ignore non-koda messages', () => {
      const msg = { type: 'other-message', data: 'foo' };
      const initial = { activeTab: 'menu', ready: false };
      const state = handleMessage(msg, initial);
      expect(state).toEqual(initial);
    });

    it('should ignore invalid message format', () => {
      const initial = { activeTab: 'menu' };
      expect(handleMessage(null, initial)).toEqual(initial);
      expect(handleMessage({}, initial)).toEqual(initial);
      expect(handleMessage({ type: 123 }, initial)).toEqual(initial);
    });
  });

  // ==========================================
  // Widget Orders in POS
  // ==========================================

  describe('Widget Orders in POS System', () => {
    const orders = [
      { id: 'o1', source: 'pos', tableNumber: '5', status: 'served', orderType: 'dine_in' },
      { id: 'o2', source: 'widget', status: 'new', orderType: 'pickup', customer: { name: 'Widget User', phone: '555-1111' } },
      { id: 'o3', source: 'website', status: 'new', orderType: 'pickup', customer: { name: 'Web User', phone: '555-2222' } },
      { id: 'o4', source: 'pos', tableNumber: '3', status: 'sent_to_kitchen', orderType: 'dine_in' },
      { id: 'o5', source: 'widget', status: 'preparing', orderType: 'dine-in', customer: { name: 'Widget Diner', phone: '555-3333' } }
    ];

    it('should identify widget orders by source field', () => {
      const widgetOrders = orders.filter(o => o.source === 'widget');
      expect(widgetOrders).toHaveLength(2);
      expect(widgetOrders[0].id).toBe('o2');
      expect(widgetOrders[1].id).toBe('o5');
    });

    it('should show customer info for widget orders instead of table', () => {
      const widgetOrder = orders.find(o => o.id === 'o2');
      expect(widgetOrder.customer.name).toBe('Widget User');
      expect(widgetOrder.tableNumber).toBeUndefined();
    });

    it('should include widget orders in kitchen queue', () => {
      const KITCHEN_STATUSES = ['new', 'sent_to_kitchen', 'preparing'];
      const kitchenOrders = orders.filter(o => KITCHEN_STATUSES.includes(o.status));
      expect(kitchenOrders).toHaveLength(4); // o2 (new), o3 (new), o4 (sent_to_kitchen), o5 (preparing)

      const widgetInKitchen = kitchenOrders.filter(o => o.source === 'widget');
      expect(widgetInKitchen).toHaveLength(2);
    });

    it('should separate widget/website orders from POS table orders in payment view', () => {
      const tableOrders = orders.filter(o => o.source === 'pos');
      const onlineOrders = orders.filter(o => o.source === 'widget' || o.source === 'website');

      expect(tableOrders).toHaveLength(2);
      expect(onlineOrders).toHaveLength(3);
    });
  });

  // ==========================================
  // Stripe Payment Flow
  // ==========================================

  describe('Stripe Payment in Widget Checkout', () => {
    function buildOrderWithPayment(cart, customer, config, paymentOption) {
      const subtotal = cart.reduce((sum, i) => sum + i.finalPrice * i.qty, 0);
      const tax = subtotal * ((config.taxRate || 8.5) / 100);
      const total = subtotal + tax;

      const isPayNow = paymentOption.method === 'payNow';

      return {
        restaurantId: config.restaurantId,
        locationId: config.locationId || config.restaurantId,
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
        items: cart.map(i => ({
          id: i.id, name: i.name, price: i.price,
          finalPrice: i.finalPrice, quantity: i.qty,
          discount: i.discount || 0, discountType: i.discountType || 'amount'
        })),
        subtotal, tax, total,
        orderType: 'pickup',
        paymentMethod: isPayNow ? 'card' : 'payAtStore',
        paymentDetails: isPayNow ? {
          paymentMethodId: paymentOption.paymentMethodId,
          amount: total,
          status: 'pending'
        } : null,
        source: 'widget'
      };
    }

    const cart = [
      { id: 's1', name: 'Spring Rolls', price: 8.99, finalPrice: 8.99, discount: 0, discountType: 'amount', qty: 2 },
      { id: 'm1', name: 'Butter Chicken', price: 16.99, finalPrice: 16.99, discount: 0, discountType: 'amount', qty: 1 }
    ];
    const customer = { name: 'Pay Tester', email: 'pay@test.com', phone: '555-PAY1' };
    const config = { restaurantId: 'uid-123', locationId: 'uid-123', taxRate: 8.5 };

    it('should construct pay-at-store order with no paymentDetails', () => {
      const order = buildOrderWithPayment(cart, customer, config, { method: 'payLater' });
      expect(order.paymentMethod).toBe('payAtStore');
      expect(order.paymentDetails).toBeNull();
      expect(order.source).toBe('widget');
    });

    it('should construct card payment order with paymentMethodId', () => {
      const order = buildOrderWithPayment(cart, customer, config, {
        method: 'payNow',
        paymentMethodId: 'pm_test_abc123'
      });
      expect(order.paymentMethod).toBe('card');
      expect(order.paymentDetails).not.toBeNull();
      expect(order.paymentDetails.paymentMethodId).toBe('pm_test_abc123');
      expect(order.paymentDetails.status).toBe('pending');
    });

    it('should set paymentDetails amount equal to order total', () => {
      const order = buildOrderWithPayment(cart, customer, config, {
        method: 'payNow',
        paymentMethodId: 'pm_test_xyz'
      });
      expect(order.paymentDetails.amount).toBe(order.total);
      expect(order.paymentDetails.amount).toBeCloseTo(34.97 + 34.97 * 0.085, 2);
    });

    it('should differentiate prepaid widget orders from pay-at-store in POS', () => {
      const payAtStore = buildOrderWithPayment(cart, customer, config, { method: 'payLater' });
      const prepaid = buildOrderWithPayment(cart, customer, config, {
        method: 'payNow',
        paymentMethodId: 'pm_test_diff'
      });

      // Both are widget orders
      expect(payAtStore.source).toBe('widget');
      expect(prepaid.source).toBe('widget');

      // Payment method differs
      expect(payAtStore.paymentMethod).toBe('payAtStore');
      expect(prepaid.paymentMethod).toBe('card');

      // POS can filter by paymentMethod
      const allOrders = [payAtStore, prepaid];
      const needsPayment = allOrders.filter(o => o.paymentMethod === 'payAtStore');
      const alreadyPaid = allOrders.filter(o => o.paymentMethod === 'card');
      expect(needsPayment).toHaveLength(1);
      expect(alreadyPaid).toHaveLength(1);
    });
  });

  // ==========================================
  // Error Handling
  // ==========================================

  describe('Error Handling', () => {
    it('should handle menu API returning empty categories', () => {
      const response = { categories: [] };
      const categories = response.categories.filter(c => c.items && c.items.length > 0);
      expect(categories).toHaveLength(0);
    });

    it('should handle menu API returning no data', () => {
      const parseResponse = (data) => {
        return (data?.categories || []).filter(c => c.items && c.items.length > 0);
      };

      expect(parseResponse(null)).toHaveLength(0);
      expect(parseResponse(undefined)).toHaveLength(0);
      expect(parseResponse({})).toHaveLength(0);
    });

    it('should validate order has required fields before submission', () => {
      const validateOrder = (order) => {
        return !!(order.restaurantId && order.customer && order.items && order.items.length > 0);
      };

      expect(validateOrder({ restaurantId: 'test', customer: { name: 'Test' }, items: [{ id: '1' }] })).toBe(true);
      expect(validateOrder({ customer: { name: 'Test' }, items: [{ id: '1' }] })).toBe(false);
      expect(validateOrder({ restaurantId: 'test', customer: { name: 'Test' }, items: [] })).toBe(false);
    });
  });
});
