/**
 * Integration Tests — Counter Service & Food Truck Flows
 * Tests the pay-first POS flow, kitchen pickup completion,
 * server filtering, and order data structure for counter/food truck modes.
 */

describe('Counter Service & Food Truck Flows', () => {
  // ==========================================
  // Helper: Build order data (mirrors POS.js logic)
  // ==========================================

  const calculateItemPrice = (item) => {
    let price = item.price;
    if (item.discount > 0) {
      if (item.discountType === 'percentage') {
        price = item.price - (item.price * item.discount / 100);
      } else {
        price = item.price - item.discount;
      }
    }
    return Math.max(0, price);
  };

  const buildOrderData = (items, options = {}) => {
    const {
      serviceMode = 'counter_service',
      selectedTables = [],
      taxRate = 8,
      paymentMethod = 'cash',
      stripePaymentIntentId = null
    } = options;

    const isPayFirst = serviceMode === 'counter_service' || serviceMode === 'food_truck';

    const subtotal = items.reduce((total, item) => {
      return total + (calculateItemPrice(item) * item.quantity);
    }, 0);
    const taxAmount = subtotal * (taxRate / 100);
    const totalWithTax = subtotal + taxAmount;

    const tableNumber = selectedTables.length > 0
      ? (selectedTables.length === 1 ? selectedTables[0] : selectedTables)
      : null;

    const orderData = {
      orderNumber: 'ORD-20260326-1234',
      locationId: 'test-location',
      items: items.map(item => ({
        id: item.id,
        name: item.name,
        price: calculateItemPrice(item),
        originalPrice: item.price,
        quantity: item.quantity,
        subtotal: calculateItemPrice(item) * item.quantity
      })),
      status: 'sent_to_kitchen',
      orderType: isPayFirst ? 'counter' : 'dine_in',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (tableNumber) {
      orderData.tableNumber = tableNumber;
    }

    if (isPayFirst) {
      orderData.paidAtPOS = true;
      orderData.total = totalWithTax;
      orderData.paymentDetails = {
        subtotal,
        taxRate,
        taxAmount,
        total: totalWithTax,
        paymentMethod,
        paidAt: new Date().toISOString(),
        ...(stripePaymentIntentId && { stripePaymentIntentId })
      };
    } else {
      orderData.total = subtotal;
    }

    return orderData;
  };

  const sampleItems = [
    { id: 'item1', name: 'Burger', price: 12.00, discount: 0, quantity: 2 },
    { id: 'item2', name: 'Fries', price: 5.00, discount: 0, quantity: 1 }
  ];

  // ==========================================
  // Pay-First Order Data Structure
  // ==========================================

  describe('pay-first order data structure', () => {
    it('should include paidAtPOS flag for counter service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service' });
      expect(order.paidAtPOS).toBe(true);
    });

    it('should include paidAtPOS flag for food truck', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'food_truck' });
      expect(order.paidAtPOS).toBe(true);
    });

    it('should NOT include paidAtPOS for full service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'full_service', selectedTables: ['5'] });
      expect(order.paidAtPOS).toBeUndefined();
    });

    it('should set orderType to counter for counter_service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service' });
      expect(order.orderType).toBe('counter');
    });

    it('should set orderType to counter for food_truck', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'food_truck' });
      expect(order.orderType).toBe('counter');
    });

    it('should set orderType to dine_in for full_service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'full_service', selectedTables: ['5'] });
      expect(order.orderType).toBe('dine_in');
    });

    it('should include paymentDetails for pay-first orders', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service', paymentMethod: 'cash' });
      expect(order.paymentDetails).toBeDefined();
      expect(order.paymentDetails.paymentMethod).toBe('cash');
      expect(order.paymentDetails.subtotal).toBeCloseTo(29.00, 2);
      expect(order.paymentDetails.taxRate).toBe(8);
      expect(order.paymentDetails.paidAt).toBeDefined();
    });

    it('should include stripePaymentIntentId for card payments', () => {
      const order = buildOrderData(sampleItems, {
        serviceMode: 'counter_service',
        paymentMethod: 'card',
        stripePaymentIntentId: 'pi_test_123'
      });
      expect(order.paymentDetails.paymentMethod).toBe('card');
      expect(order.paymentDetails.stripePaymentIntentId).toBe('pi_test_123');
    });

    it('should NOT include stripePaymentIntentId for cash payments', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service', paymentMethod: 'cash' });
      expect(order.paymentDetails.stripePaymentIntentId).toBeUndefined();
    });
  });

  // ==========================================
  // Tax Calculation in Pay-First
  // ==========================================

  describe('tax calculation', () => {
    it('should calculate tax at default 8% rate', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service', taxRate: 8 });
      // Subtotal: 2*12 + 1*5 = 29.00
      expect(order.paymentDetails.subtotal).toBeCloseTo(29.00, 2);
      expect(order.paymentDetails.taxAmount).toBeCloseTo(2.32, 2);
      expect(order.paymentDetails.total).toBeCloseTo(31.32, 2);
    });

    it('should calculate tax at custom rate', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service', taxRate: 10 });
      expect(order.paymentDetails.taxAmount).toBeCloseTo(2.90, 2);
      expect(order.paymentDetails.total).toBeCloseTo(31.90, 2);
    });

    it('should handle zero tax rate', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'food_truck', taxRate: 0 });
      expect(order.paymentDetails.taxAmount).toBe(0);
      expect(order.paymentDetails.total).toBeCloseTo(29.00, 2);
    });

    it('should NOT include tax in full_service orders (no paymentDetails)', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'full_service', selectedTables: ['5'] });
      expect(order.paymentDetails).toBeUndefined();
      expect(order.total).toBeCloseTo(29.00, 2); // Just subtotal, no tax at POS
    });
  });

  // ==========================================
  // Table Assignment
  // ==========================================

  describe('table assignment', () => {
    it('should have no tableNumber for food truck orders', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'food_truck' });
      expect(order.tableNumber).toBeUndefined();
    });

    it('should allow optional table for counter service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service', selectedTables: ['3'] });
      expect(order.tableNumber).toBe('3');
    });

    it('should have no tableNumber when no table selected in counter service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'counter_service' });
      expect(order.tableNumber).toBeUndefined();
    });

    it('should require table for full_service', () => {
      const order = buildOrderData(sampleItems, { serviceMode: 'full_service', selectedTables: ['7'] });
      expect(order.tableNumber).toBe('7');
    });
  });

  // ==========================================
  // Kitchen Pickup Flow
  // ==========================================

  describe('kitchen order filtering and pickup', () => {
    const kitchenFilter = (orders) => {
      return orders.filter(order => {
        if (order.status === 'ready' && !order.paidAtPOS) return false;
        return true;
      });
    };

    it('should show ready+paidAtPOS orders in kitchen', () => {
      const orders = [
        { id: '1', status: 'ready', paidAtPOS: true },
        { id: '2', status: 'preparing', paidAtPOS: true }
      ];
      const filtered = kitchenFilter(orders);
      expect(filtered).toHaveLength(2);
    });

    it('should hide ready dine-in orders from kitchen (they go to Server)', () => {
      const orders = [
        { id: '1', status: 'ready', paidAtPOS: false },
        { id: '2', status: 'ready' },
        { id: '3', status: 'preparing' }
      ];
      const filtered = kitchenFilter(orders);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('3');
    });

    it('should always show new, sent_to_kitchen, preparing orders', () => {
      const orders = [
        { id: '1', status: 'new' },
        { id: '2', status: 'sent_to_kitchen' },
        { id: '3', status: 'preparing' }
      ];
      const filtered = kitchenFilter(orders);
      expect(filtered).toHaveLength(3);
    });

    it('kitchen pickup should set correct status and timestamps', () => {
      // Simulate handleOrderPickedUp
      const order = { id: '1', status: 'ready', paidAtPOS: true };
      const updateData = {
        status: 'completed',
        pickedUpAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date()
      };
      const completed = { ...order, ...updateData };
      expect(completed.status).toBe('completed');
      expect(completed.pickedUpAt).toBeDefined();
      expect(completed.completedAt).toBeDefined();
    });
  });

  // ==========================================
  // Server Filtering
  // ==========================================

  describe('server order filtering', () => {
    const serverFilter = (orders) => {
      return orders.filter(order => !order.paidAtPOS);
    };

    it('should exclude paidAtPOS orders from server view', () => {
      const orders = [
        { id: '1', status: 'preparing', paidAtPOS: true },
        { id: '2', status: 'ready', paidAtPOS: true },
        { id: '3', status: 'ready', paidAtPOS: false },
        { id: '4', status: 'preparing' }
      ];
      const filtered = serverFilter(orders);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(o => o.id)).toEqual(['3', '4']);
    });

    it('should show all orders when none are paidAtPOS', () => {
      const orders = [
        { id: '1', status: 'preparing' },
        { id: '2', status: 'ready' }
      ];
      const filtered = serverFilter(orders);
      expect(filtered).toHaveLength(2);
    });
  });

  // ==========================================
  // Order Type Info Display
  // ==========================================

  describe('order type display', () => {
    const getOrderTypeInfo = (orderType) => {
      switch (orderType) {
        case 'dine_in':
          return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
        case 'counter':
          return { label: 'Counter', icon: 'bi-shop', variant: 'primary' };
        case 'pickup':
          return { label: 'Pickup', icon: 'bi-bag-check', variant: 'success' };
        case 'delivery':
          return { label: 'Delivery', icon: 'bi-truck', variant: 'warning' };
        default:
          return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
      }
    };

    it('should display Counter for counter orderType', () => {
      const info = getOrderTypeInfo('counter');
      expect(info.label).toBe('Counter');
      expect(info.variant).toBe('primary');
    });

    it('should display Dine-In for dine_in orderType', () => {
      const info = getOrderTypeInfo('dine_in');
      expect(info.label).toBe('Dine-In');
    });

    it('should default to Dine-In for unknown orderType', () => {
      const info = getOrderTypeInfo(undefined);
      expect(info.label).toBe('Dine-In');
    });
  });

  // ==========================================
  // Full Counter Service Lifecycle
  // ==========================================

  describe('full counter service lifecycle', () => {
    it('should flow: POS(pay) → kitchen → pickup → completed', () => {
      // Step 1: POS creates pay-first order
      const order = buildOrderData(sampleItems, {
        serviceMode: 'counter_service',
        paymentMethod: 'cash',
        taxRate: 8
      });
      expect(order.status).toBe('sent_to_kitchen');
      expect(order.paidAtPOS).toBe(true);
      expect(order.paymentDetails.paymentMethod).toBe('cash');

      // Step 2: Kitchen marks as preparing
      const preparing = { ...order, status: 'preparing', updatedAt: new Date() };
      expect(preparing.status).toBe('preparing');

      // Step 3: Kitchen marks as ready
      const ready = { ...preparing, status: 'ready', readyAt: new Date(), updatedAt: new Date() };
      expect(ready.status).toBe('ready');

      // Step 4: Kitchen marks as picked up (completed)
      const completed = {
        ...ready,
        status: 'completed',
        pickedUpAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date()
      };
      expect(completed.status).toBe('completed');
      expect(completed.pickedUpAt).toBeDefined();
      expect(completed.paidAtPOS).toBe(true);
      expect(completed.paymentDetails.total).toBeCloseTo(31.32, 2);
    });
  });

  // ==========================================
  // Full Food Truck Lifecycle
  // ==========================================

  describe('full food truck lifecycle', () => {
    it('should flow: POS(pay, no table) → kitchen → pickup → completed', () => {
      // Step 1: POS creates pay-first order (no table)
      const order = buildOrderData(sampleItems, {
        serviceMode: 'food_truck',
        paymentMethod: 'card',
        stripePaymentIntentId: 'pi_test_456',
        taxRate: 10
      });
      expect(order.status).toBe('sent_to_kitchen');
      expect(order.paidAtPOS).toBe(true);
      expect(order.tableNumber).toBeUndefined();
      expect(order.orderType).toBe('counter');
      expect(order.paymentDetails.paymentMethod).toBe('card');
      expect(order.paymentDetails.stripePaymentIntentId).toBe('pi_test_456');

      // Step 2-4: Same as counter service
      const completed = {
        ...order,
        status: 'completed',
        pickedUpAt: new Date(),
        completedAt: new Date()
      };
      expect(completed.status).toBe('completed');
      expect(completed.tableNumber).toBeUndefined();
    });
  });

  // ==========================================
  // Mixed Mode Safety
  // ==========================================

  describe('mixed mode safety', () => {
    it('paidAtPOS flag is per-order, not per-mode', () => {
      const counterOrder = buildOrderData(sampleItems, { serviceMode: 'counter_service' });
      const dineInOrder = buildOrderData(sampleItems, { serviceMode: 'full_service', selectedTables: ['5'] });

      // Both can coexist — flag is on the order, not global
      expect(counterOrder.paidAtPOS).toBe(true);
      expect(dineInOrder.paidAtPOS).toBeUndefined();
    });

    it('kitchen filter works correctly with mixed orders', () => {
      const kitchenFilter = (orders) => orders.filter(order => {
        if (order.status === 'ready' && !order.paidAtPOS) return false;
        return true;
      });

      const orders = [
        { id: '1', status: 'ready', paidAtPOS: true },   // Counter: show in kitchen
        { id: '2', status: 'ready', paidAtPOS: false },   // Dine-in: hide (goes to server)
        { id: '3', status: 'preparing', paidAtPOS: true }, // Counter: show
        { id: '4', status: 'preparing' }                   // Dine-in: show
      ];

      const filtered = kitchenFilter(orders);
      expect(filtered).toHaveLength(3);
      expect(filtered.map(o => o.id)).toEqual(['1', '3', '4']);
    });
  });
});
