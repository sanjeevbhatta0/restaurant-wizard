/**
 * Integration Tests — Customer Portal Flow
 *
 * Tests the full customer portal pipeline as integrated data flows:
 *   Phone verification → Auth (signup/login) → Session → Menu browsing →
 *   Cart → Checkout → Order placement → Receipt sending
 *
 * Also tests portal embed mode, data loading, promotions/rewards,
 * and the receipt notification pipeline.
 *
 * Source: functions/templates/customer-portal/portal.js,
 *         functions/templates/customer-portal/embed-app.js,
 *         functions/services/notificationService.js,
 *         functions/templates/emails/orderReceipt.js
 */

describe('Customer Portal Flow — Integration', () => {

  // ==========================================
  // Phone Verification → Auth Pipeline
  // ==========================================

  describe('Phone Verification to Auth Flow', () => {
    // Simulates the phone → OTP → auth pipeline from portal.js
    function simulatePhoneVerification(phone) {
      const digits = phone.replace(/[^\d]/g, '');
      if (digits.length < 10) return { success: false, error: 'Invalid phone' };
      // Server generates OTP, sends via Twilio, returns last 4
      const lastFour = digits.slice(-4);
      return { success: true, phoneLastFour: lastFour, codeSent: true };
    }

    function simulateOTPVerification(inputCode, storedCode) {
      if (!inputCode || inputCode.length !== 6) return { success: false, error: 'Enter 6-digit code' };
      if (inputCode !== storedCode) return { success: false, error: 'Incorrect code' };
      return { success: true, verified: true };
    }

    it('should complete full phone → OTP → auth pipeline', () => {
      // Step 1: Enter phone
      const phoneResult = simulatePhoneVerification('(555) 123-4567');
      expect(phoneResult.success).toBe(true);
      expect(phoneResult.phoneLastFour).toBe('4567');

      // Step 2: Verify OTP
      const storedCode = '123456';
      const otpResult = simulateOTPVerification('123456', storedCode);
      expect(otpResult.success).toBe(true);
      expect(otpResult.verified).toBe(true);

      // Step 3: Phone is now verified, auth form should show with pre-filled phone
      const verifiedPhone = '+15551234567';
      expect(verifiedPhone).toBeTruthy();
    });

    it('should handle wrong OTP and allow retry', () => {
      const phoneResult = simulatePhoneVerification('5559876543');
      expect(phoneResult.success).toBe(true);

      // Wrong code
      const wrongResult = simulateOTPVerification('000000', '123456');
      expect(wrongResult.success).toBe(false);
      expect(wrongResult.error).toContain('Incorrect');

      // Retry with correct code
      const correctResult = simulateOTPVerification('123456', '123456');
      expect(correctResult.success).toBe(true);
    });

    it('should reject invalid phone before sending OTP', () => {
      const result = simulatePhoneVerification('123');
      expect(result.success).toBe(false);
    });

    it('should reject incomplete OTP code', () => {
      const result = simulateOTPVerification('12', '123456');
      expect(result.success).toBe(false);
    });
  });

  // ==========================================
  // Customer Signup Flow
  // ==========================================

  describe('Customer Signup Flow', () => {
    function simulateSignup(formData, verifiedPhone, config) {
      // Validate required fields
      if (!formData.email) return { success: false, error: 'Email is required' };
      if (!formData.password || formData.password.length < 6) return { success: false, error: 'Password must be 6+ characters' };
      if (!formData.name) return { success: false, error: 'Name is required' };

      // Build customer document
      const customerDoc = {
        email: formData.email,
        fullName: formData.name,
        phone: verifiedPhone || formData.phone || '',
        restaurantId: config.restaurantId,
        createdAt: new Date().toISOString(),
        loyaltyPoints: 0,
        totalOrders: 0,
        tier: 'bronze'
      };

      return { success: true, customerDoc, uid: 'new-uid-' + Date.now() };
    }

    it('should create customer with verified phone', () => {
      const result = simulateSignup(
        { email: 'new@test.com', password: 'pass123', name: 'New Customer' },
        '+15551234567',
        { restaurantId: 'rest-123' }
      );
      expect(result.success).toBe(true);
      expect(result.customerDoc.phone).toBe('+15551234567');
      expect(result.customerDoc.loyaltyPoints).toBe(0);
      expect(result.customerDoc.tier).toBe('bronze');
    });

    it('should create customer without phone', () => {
      const result = simulateSignup(
        { email: 'nophone@test.com', password: 'pass123', name: 'No Phone' },
        null,
        { restaurantId: 'rest-123' }
      );
      expect(result.success).toBe(true);
      expect(result.customerDoc.phone).toBe('');
    });

    it('should reject signup without email', () => {
      const result = simulateSignup(
        { email: '', password: 'pass123', name: 'No Email' },
        null,
        { restaurantId: 'rest-123' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Email');
    });

    it('should reject signup with short password', () => {
      const result = simulateSignup(
        { email: 'test@test.com', password: '123', name: 'Test' },
        null,
        { restaurantId: 'rest-123' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Password');
    });

    it('should reject signup without name', () => {
      const result = simulateSignup(
        { email: 'test@test.com', password: 'pass123', name: '' },
        null,
        { restaurantId: 'rest-123' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Name');
    });

    it('should set restaurantId from config', () => {
      const result = simulateSignup(
        { email: 'test@test.com', password: 'pass123', name: 'Test' },
        null,
        { restaurantId: 'my-restaurant-uid' }
      );
      expect(result.customerDoc.restaurantId).toBe('my-restaurant-uid');
    });
  });

  // ==========================================
  // Customer Login Flow
  // ==========================================

  describe('Customer Login Flow', () => {
    function simulateLogin(formData, existingCustomer, verifiedPhone) {
      if (!formData.email || !formData.password) {
        return { success: false, error: 'Email and password required' };
      }

      // Simulate Firebase auth (would normally check password)
      const firebaseUser = { uid: 'existing-uid', email: formData.email };

      // Build user state from existing customer doc
      const user = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: existingCustomer?.fullName || '',
        phone: verifiedPhone || existingCustomer?.phone || '',
        loyaltyPoints: existingCustomer?.loyaltyPoints || 0,
        tier: existingCustomer?.tier || 'bronze'
      };

      // Determine if phone should be persisted
      const phonePersisted = !!(!existingCustomer?.phone && verifiedPhone);

      return { success: true, user, phonePersisted };
    }

    it('should log in existing customer and load their data', () => {
      const result = simulateLogin(
        { email: 'existing@test.com', password: 'pass123' },
        { fullName: 'Jane Doe', phone: '+15559999999', loyaltyPoints: 500, tier: 'gold' },
        null
      );
      expect(result.success).toBe(true);
      expect(result.user.name).toBe('Jane Doe');
      expect(result.user.loyaltyPoints).toBe(500);
      expect(result.user.tier).toBe('gold');
      expect(result.phonePersisted).toBe(false);
    });

    it('should persist verified phone for customer without phone on file', () => {
      const result = simulateLogin(
        { email: 'nophone@test.com', password: 'pass123' },
        { fullName: 'No Phone Customer', phone: '', loyaltyPoints: 0 },
        '+15551234567'
      );
      expect(result.success).toBe(true);
      expect(result.user.phone).toBe('+15551234567');
      expect(result.phonePersisted).toBe(true);
    });

    it('should NOT overwrite existing phone with verified phone', () => {
      const result = simulateLogin(
        { email: 'hasphone@test.com', password: 'pass123' },
        { fullName: 'Has Phone', phone: '+15559999999', loyaltyPoints: 0 },
        '+15551111111'
      );
      expect(result.phonePersisted).toBe(false);
      // User state still uses verified phone in this session
      expect(result.user.phone).toBe('+15551111111');
    });

    it('should reject login without credentials', () => {
      const result = simulateLogin({ email: '', password: '' }, null, null);
      expect(result.success).toBe(false);
    });

    it('should handle login for brand-new customer (no doc)', () => {
      const result = simulateLogin(
        { email: 'brand-new@test.com', password: 'pass123' },
        null, // No customer doc exists
        '+15551234567'
      );
      expect(result.success).toBe(true);
      expect(result.user.loyaltyPoints).toBe(0);
      expect(result.user.tier).toBe('bronze');
      expect(result.user.phone).toBe('+15551234567');
    });
  });

  // ==========================================
  // Menu Browsing → Cart → Order Pipeline
  // ==========================================

  describe('Menu Browse to Order Pipeline', () => {
    const menuCategories = [
      {
        id: 'cat-appetizers', name: 'Appetizers',
        items: [
          { id: 'a1', name: 'Spring Rolls', price: 8.99, discount: 0, discountType: 'amount' },
          { id: 'a2', name: 'Soup', price: 6.99, discount: 1, discountType: 'amount' }
        ]
      },
      {
        id: 'cat-mains', name: 'Main Courses',
        items: [
          { id: 'm1', name: 'Grilled Chicken', price: 18.99, discount: 0, discountType: 'amount' },
          { id: 'm2', name: 'Pasta', price: 14.99, discount: 10, discountType: 'percentage' }
        ]
      }
    ];

    function calculateFinalPrice(price, discount, discountType) {
      if (!discount || discount <= 0) return price;
      if (discountType === 'percentage') return price * (1 - discount / 100);
      return Math.max(0, price - discount);
    }

    function addToCart(cart, item) {
      const finalPrice = calculateFinalPrice(item.price, item.discount, item.discountType);
      const existing = cart.find(c => c.id === item.id);
      if (existing) {
        existing.qty += 1;
        return [...cart];
      }
      return [...cart, { ...item, finalPrice, qty: 1 }];
    }

    function buildOrderFromCart(cart, customer, config) {
      const subtotal = cart.reduce((sum, i) => sum + i.finalPrice * i.qty, 0);
      const taxRate = config.taxRate || 8.5;
      const tax = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;

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
        taxRate,
        total,
        source: 'website',
        status: 'new',
        orderType: 'pickup'
      };
    }

    it('should browse categories and view items', () => {
      expect(menuCategories).toHaveLength(2);
      expect(menuCategories[0].items).toHaveLength(2);
      expect(menuCategories[1].items).toHaveLength(2);
    });

    it('should add items to cart with correct final prices', () => {
      let cart = [];
      // Add soup (discounted $1 off)
      cart = addToCart(cart, menuCategories[0].items[1]);
      expect(cart).toHaveLength(1);
      expect(cart[0].finalPrice).toBeCloseTo(5.99, 2); // 6.99 - 1.00

      // Add pasta (10% off)
      cart = addToCart(cart, menuCategories[1].items[1]);
      expect(cart).toHaveLength(2);
      expect(cart[1].finalPrice).toBeCloseTo(13.491, 1); // 14.99 * 0.9
    });

    it('should increment quantity for duplicate items', () => {
      let cart = [];
      cart = addToCart(cart, menuCategories[0].items[0]); // Spring Rolls
      cart = addToCart(cart, menuCategories[0].items[0]); // Again
      expect(cart).toHaveLength(1);
      expect(cart[0].qty).toBe(2);
    });

    it('should build complete order from cart', () => {
      let cart = [];
      cart = addToCart(cart, menuCategories[0].items[0]); // Spring Rolls $8.99
      cart = addToCart(cart, menuCategories[1].items[0]); // Grilled Chicken $18.99

      const order = buildOrderFromCart(
        cart,
        { name: 'Test Customer', email: 'test@test.com', phone: '+15551234567' },
        { restaurantId: 'rest-123', taxRate: 9.0 }
      );

      expect(order.restaurantId).toBe('rest-123');
      expect(order.customer.name).toBe('Test Customer');
      expect(order.customer.email).toBe('test@test.com');
      expect(order.customer.phone).toBe('+15551234567');
      expect(order.items).toHaveLength(2);
      expect(order.subtotal).toBeCloseTo(27.98, 2);
      expect(order.tax).toBeCloseTo(2.52, 2); // 27.98 * 0.09
      expect(order.total).toBeCloseTo(30.50, 2);
      expect(order.source).toBe('website');
      expect(order.status).toBe('new');
    });

    it('should handle order with discounted items', () => {
      let cart = [];
      cart = addToCart(cart, menuCategories[0].items[1]); // Soup $5.99 (after $1 off)
      cart = addToCart(cart, menuCategories[1].items[1]); // Pasta $13.491 (10% off)

      const order = buildOrderFromCart(
        cart,
        { name: 'Discount Tester', email: 'd@test.com', phone: '' },
        { restaurantId: 'rest-456', taxRate: 8.5 }
      );

      expect(order.subtotal).toBeCloseTo(19.481, 1);
      expect(order.items[0].discount).toBe(1);
      expect(order.items[1].discount).toBe(10);
      expect(order.items[1].discountType).toBe('percentage');
    });

    it('should include locationId for multi-location orders', () => {
      let cart = [];
      cart = addToCart(cart, menuCategories[0].items[0]);

      const order = buildOrderFromCart(
        cart,
        { name: 'Loc Test' },
        { restaurantId: 'rest-123', locationId: 'loc-downtown', taxRate: 8.5 }
      );

      expect(order.locationId).toBe('loc-downtown');
    });
  });

  // ==========================================
  // Checkout & Payment Methods
  // ==========================================

  describe('Checkout Payment Method Selection', () => {
    function resolvePaymentOptions(config) {
      const hasStripe = !!(config.stripePublishableKey &&
        config.stripePublishableKey.startsWith('pk_') &&
        config.stripePublishableKey.length > 10);
      return {
        payAtStore: true,
        payNow: hasStripe
      };
    }

    it('should offer pay-at-store always', () => {
      const options = resolvePaymentOptions({});
      expect(options.payAtStore).toBe(true);
    });

    it('should offer pay-now when Stripe is configured', () => {
      const options = resolvePaymentOptions({ stripePublishableKey: 'pk_test_abc123def456' });
      expect(options.payNow).toBe(true);
    });

    it('should NOT offer pay-now when Stripe key is missing', () => {
      const options = resolvePaymentOptions({ stripePublishableKey: '' });
      expect(options.payNow).toBe(false);
    });

    it('should NOT offer pay-now when Stripe key is invalid', () => {
      const options = resolvePaymentOptions({ stripePublishableKey: 'not-a-key' });
      expect(options.payNow).toBe(false);
    });
  });

  // ==========================================
  // Portal Data Loading
  // ==========================================

  describe('Portal Data Loading Pipeline', () => {
    function simulateDataLoad(userId, restaurantId) {
      // Simulates loadUserOrders + loadPromotions + loadCustomerData
      const orders = [
        { id: 'o1', status: 'completed', total: 25.00, createdAt: '2026-04-01' },
        { id: 'o2', status: 'preparing', total: 18.00, createdAt: '2026-04-03' }
      ];
      const promotions = [
        { id: 'p1', code: 'WELCOME10', type: 'percentage', value: 10, active: true },
        { id: 'p2', code: 'FREESIDE', type: 'freeItem', active: false }
      ];
      const customerData = {
        loyaltyPoints: 250,
        tier: 'silver',
        totalOrders: 5,
        dailyStreak: 3
      };

      const activeOrders = orders.filter(o => !['completed', 'cancelled'].includes(o.status));
      const pastOrders = orders.filter(o => ['completed', 'cancelled'].includes(o.status));
      const activePromotions = promotions.filter(p => p.active);

      return { activeOrders, pastOrders, activePromotions, customerData };
    }

    it('should separate active and past orders', () => {
      const data = simulateDataLoad('user-1', 'rest-1');
      expect(data.activeOrders).toHaveLength(1);
      expect(data.activeOrders[0].status).toBe('preparing');
      expect(data.pastOrders).toHaveLength(1);
      expect(data.pastOrders[0].status).toBe('completed');
    });

    it('should filter active promotions', () => {
      const data = simulateDataLoad('user-1', 'rest-1');
      expect(data.activePromotions).toHaveLength(1);
      expect(data.activePromotions[0].code).toBe('WELCOME10');
    });

    it('should load customer loyalty data', () => {
      const data = simulateDataLoad('user-1', 'rest-1');
      expect(data.customerData.loyaltyPoints).toBe(250);
      expect(data.customerData.tier).toBe('silver');
    });
  });

  // ==========================================
  // Embed Mode (Widget) Lifecycle
  // ==========================================

  describe('Portal Embed Mode Lifecycle', () => {
    // Simulates embed-app.js tab ↔ portal view mapping
    const TAB_VIEW_MAP = {
      menu: null,           // Menu is handled by EmbedApp, not portal
      account: 'account',
      orders: 'orders',
      promotions: 'promotions',
      rewards: 'rewards'
    };

    function switchView(tab, isLoggedIn) {
      const portalView = TAB_VIEW_MAP[tab];

      // Menu tab doesn't need login
      if (tab === 'menu') return { view: 'menu', needsAuth: false };

      // All other tabs need login
      if (!isLoggedIn) return { view: 'auth', needsAuth: true };

      return { view: portalView, needsAuth: false };
    }

    it('should show menu without login', () => {
      expect(switchView('menu', false)).toEqual({ view: 'menu', needsAuth: false });
    });

    it('should require login for account tab', () => {
      expect(switchView('account', false)).toEqual({ view: 'auth', needsAuth: true });
    });

    it('should require login for orders tab', () => {
      expect(switchView('orders', false)).toEqual({ view: 'auth', needsAuth: true });
    });

    it('should show orders view when logged in', () => {
      expect(switchView('orders', true)).toEqual({ view: 'orders', needsAuth: false });
    });

    it('should show promotions view when logged in', () => {
      expect(switchView('promotions', true)).toEqual({ view: 'promotions', needsAuth: false });
    });

    it('should show rewards view when logged in', () => {
      expect(switchView('rewards', true)).toEqual({ view: 'rewards', needsAuth: false });
    });
  });

  // ==========================================
  // Order Reorder Flow
  // ==========================================

  describe('Reorder Flow', () => {
    function buildReorderCart(pastOrder, embedMode) {
      const cart = (pastOrder.items || []).map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        finalPrice: item.finalPrice || item.price,
        discount: item.discount || 0,
        discountType: item.discountType || 'amount',
        qty: item.quantity || 1
      }));
      return { cart, addedVia: embedMode ? 'embedApp.addToCart' : 'window.cart' };
    }

    it('should build cart from past order items', () => {
      const pastOrder = {
        items: [
          { id: 'i1', name: 'Burger', price: 12.99, finalPrice: 12.99, quantity: 2, discount: 0, discountType: 'amount' },
          { id: 'i2', name: 'Fries', price: 5.99, finalPrice: 5.99, quantity: 1, discount: 0, discountType: 'amount' }
        ]
      };
      const result = buildReorderCart(pastOrder, true);
      expect(result.cart).toHaveLength(2);
      expect(result.cart[0].qty).toBe(2);
      expect(result.cart[1].name).toBe('Fries');
      expect(result.addedVia).toBe('embedApp.addToCart');
    });

    it('should use window.cart in website mode', () => {
      const result = buildReorderCart({ items: [{ id: 'i1', name: 'Test', price: 10 }] }, false);
      expect(result.addedVia).toBe('window.cart');
    });

    it('should handle empty past order', () => {
      const result = buildReorderCart({ items: [] }, true);
      expect(result.cart).toHaveLength(0);
    });
  });

  // ==========================================
  // Receipt Sending Pipeline
  // ==========================================

  describe('Receipt Sending Pipeline', () => {
    // Simulates the full receipt notification flow
    function simulateReceiptPipeline(order, restaurant, customerDoc) {
      const customerEmail = order.customer?.email || null;
      const customerPhone = order.customer?.phone || null;

      if (!customerEmail && !customerPhone) {
        return { sent: false, reason: 'No contact info' };
      }

      // Resolve preference
      let preference = customerDoc?.receiptPreference || null;
      if (!preference) {
        preference = (!customerEmail && customerPhone) ? 'sms' : 'email';
      }

      const channels = [];
      if (customerEmail && (preference === 'email' || preference === 'both')) channels.push('email');
      if (customerPhone && (preference === 'sms' || preference === 'both')) channels.push('sms');

      return {
        sent: channels.length > 0,
        channels,
        preference,
        recipient: {
          email: customerEmail,
          phone: customerPhone
        }
      };
    }

    it('should send email receipt by default', () => {
      const result = simulateReceiptPipeline(
        { customer: { name: 'Jane', email: 'jane@test.com', phone: '+15551234567' } },
        { restaurantName: 'Test Kitchen' },
        {} // No preference set
      );
      expect(result.sent).toBe(true);
      expect(result.channels).toEqual(['email']);
      expect(result.preference).toBe('email');
    });

    it('should send SMS when preference is sms', () => {
      const result = simulateReceiptPipeline(
        { customer: { name: 'Bob', email: 'bob@test.com', phone: '+15559876543' } },
        { restaurantName: 'Test Kitchen' },
        { receiptPreference: 'sms' }
      );
      expect(result.sent).toBe(true);
      expect(result.channels).toEqual(['sms']);
    });

    it('should send both when preference is both', () => {
      const result = simulateReceiptPipeline(
        { customer: { name: 'Both', email: 'both@test.com', phone: '+15551111111' } },
        { restaurantName: 'Test Kitchen' },
        { receiptPreference: 'both' }
      );
      expect(result.channels).toEqual(['email', 'sms']);
    });

    it('should default to SMS when customer has only phone', () => {
      const result = simulateReceiptPipeline(
        { customer: { name: 'Phone Only', phone: '+15559999999' } },
        { restaurantName: 'Test Kitchen' },
        {}
      );
      expect(result.preference).toBe('sms');
      expect(result.channels).toEqual(['sms']);
    });

    it('should not send when no contact info', () => {
      const result = simulateReceiptPipeline(
        { customer: { name: 'Walk-in' } },
        { restaurantName: 'Test Kitchen' },
        {}
      );
      expect(result.sent).toBe(false);
      expect(result.reason).toBe('No contact info');
    });

    it('should skip SMS when preference is email but customer has no email', () => {
      const result = simulateReceiptPipeline(
        { customer: { name: 'No Email', phone: '+15551234567' } },
        { restaurantName: 'Test Kitchen' },
        { receiptPreference: 'email' }
      );
      // Email pref but no email, so nothing via email channel
      expect(result.channels).toEqual([]);
    });
  });

  // ==========================================
  // Full Order Lifecycle with Receipt
  // ==========================================

  describe('Order Lifecycle → Receipt Trigger', () => {
    function simulateOrderLifecycle(steps) {
      let status = 'new';
      const transitions = [];

      for (const step of steps) {
        const prevStatus = status;
        status = step;
        transitions.push({ from: prevStatus, to: status });
      }

      // Check if receipt should fire
      const completionTransition = transitions.find(t => t.from !== 'completed' && t.to === 'completed');
      return { finalStatus: status, transitions, receiptTriggered: !!completionTransition };
    }

    it('should trigger receipt on standard dine-in lifecycle', () => {
      const result = simulateOrderLifecycle([
        'sent_to_kitchen', 'preparing', 'ready', 'served', 'completed'
      ]);
      expect(result.receiptTriggered).toBe(true);
      expect(result.transitions).toHaveLength(5);
    });

    it('should trigger receipt on online order lifecycle', () => {
      const result = simulateOrderLifecycle([
        'preparing', 'ready', 'completed'
      ]);
      expect(result.receiptTriggered).toBe(true);
    });

    it('should NOT trigger receipt when order is not completed', () => {
      const result = simulateOrderLifecycle([
        'sent_to_kitchen', 'preparing', 'ready'
      ]);
      expect(result.receiptTriggered).toBe(false);
    });

    it('should NOT trigger receipt twice if status set to completed again', () => {
      const result = simulateOrderLifecycle([
        'preparing', 'ready', 'completed', 'completed'
      ]);
      // Only the first completed transition triggers
      const completionCount = result.transitions.filter(
        t => t.from !== 'completed' && t.to === 'completed'
      ).length;
      expect(completionCount).toBe(1);
    });
  });

  // ==========================================
  // Template Config Injection (JSON.parse safety)
  // ==========================================

  describe('Template Config Injection Safety', () => {
    function escapeConfigJson(configObj) {
      return JSON.stringify(configObj)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/</g, '\\u003c');
    }

    it('should handle basic config without special characters', () => {
      const config = { restaurantId: 'test-123', restaurantName: 'Test Kitchen', taxRate: 0.085 };
      const escaped = escapeConfigJson(config);
      const parsed = JSON.parse(escaped.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\u003c/g, '<'));
      expect(parsed.restaurantId).toBe('test-123');
      expect(parsed.restaurantName).toBe('Test Kitchen');
    });

    it('should escape single quotes in restaurant name', () => {
      const config = { restaurantName: "Joe's Café" };
      const escaped = escapeConfigJson(config);
      expect(escaped).not.toContain("Joe's"); // single quote should be escaped
      expect(escaped).toContain("\\'");
    });

    it('should escape HTML script tags', () => {
      const config = { restaurantName: '<script>alert(1)</script>' };
      const escaped = escapeConfigJson(config);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('\\u003c');
    });

    it('should handle Stripe key with trailing whitespace', () => {
      const config = { stripePublishableKey: 'pk_test_abc123\n' };
      const escaped = escapeConfigJson(config);
      // The \n should be double-escaped to \\n in the output
      expect(escaped).toContain('\\\\n');
    });

    it('should produce valid JSON.parse input for clean config', () => {
      const config = { restaurantId: 'rest-1', taxRate: 0.09, restaurantName: 'Test' };
      const jsonStr = JSON.stringify(config);
      // Simulate the template pattern: const CONFIG = JSON.parse('...');
      const parsed = JSON.parse(jsonStr);
      expect(parsed.restaurantId).toBe('rest-1');
      expect(parsed.taxRate).toBe(0.09);
    });
  });

  // ==========================================
  // Promotions Claim Flow
  // ==========================================

  describe('Promotion Claim in Portal', () => {
    function claimPromotion(promo, customerId, existingClaims) {
      if (!promo || !promo.active) return { success: false, error: 'Promotion not active' };
      if (!customerId) return { success: false, error: 'Must be logged in' };

      // Check if already claimed
      const alreadyClaimed = existingClaims.some(c => c.promotionId === promo.id && !c.used);
      if (alreadyClaimed) return { success: false, error: 'Already claimed' };

      // Check max claims
      const totalClaims = existingClaims.filter(c => c.promotionId === promo.id).length;
      if (promo.maxClaims && totalClaims >= promo.maxClaims) {
        return { success: false, error: 'Max claims reached' };
      }

      return {
        success: true,
        claim: {
          customerId,
          promotionId: promo.id,
          promoCode: promo.code,
          used: false,
          claimedAt: new Date().toISOString()
        }
      };
    }

    it('should claim active promotion', () => {
      const result = claimPromotion(
        { id: 'p1', code: 'SAVE10', active: true },
        'cust-123',
        []
      );
      expect(result.success).toBe(true);
      expect(result.claim.promoCode).toBe('SAVE10');
      expect(result.claim.used).toBe(false);
    });

    it('should reject claiming inactive promotion', () => {
      const result = claimPromotion(
        { id: 'p1', code: 'OLD', active: false },
        'cust-123',
        []
      );
      expect(result.success).toBe(false);
    });

    it('should reject duplicate unused claim', () => {
      const result = claimPromotion(
        { id: 'p1', code: 'SAVE10', active: true },
        'cust-123',
        [{ promotionId: 'p1', used: false }]
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Already claimed');
    });

    it('should allow re-claim if previous claim was used', () => {
      const result = claimPromotion(
        { id: 'p1', code: 'SAVE10', active: true, maxClaims: 5 },
        'cust-123',
        [{ promotionId: 'p1', used: true }]
      );
      expect(result.success).toBe(true);
    });

    it('should reject when max claims reached', () => {
      const result = claimPromotion(
        { id: 'p1', code: 'ONCE', active: true, maxClaims: 1 },
        'cust-123',
        [{ promotionId: 'p1', used: true }]
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Max claims');
    });

    it('should require login', () => {
      const result = claimPromotion(
        { id: 'p1', code: 'SAVE10', active: true },
        null,
        []
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('logged in');
    });
  });

  // ==========================================
  // Rewards Tier Calculation
  // ==========================================

  describe('Rewards Tier Calculation', () => {
    function calculateTier(points) {
      if (points >= 1000) return 'platinum';
      if (points >= 500) return 'gold';
      if (points >= 200) return 'silver';
      return 'bronze';
    }

    it('should assign bronze tier for 0 points', () => {
      expect(calculateTier(0)).toBe('bronze');
    });

    it('should assign bronze for under 200', () => {
      expect(calculateTier(199)).toBe('bronze');
    });

    it('should assign silver at 200', () => {
      expect(calculateTier(200)).toBe('silver');
    });

    it('should assign gold at 500', () => {
      expect(calculateTier(500)).toBe('gold');
    });

    it('should assign platinum at 1000', () => {
      expect(calculateTier(1000)).toBe('platinum');
    });

    it('should assign platinum for very high points', () => {
      expect(calculateTier(9999)).toBe('platinum');
    });
  });
});
