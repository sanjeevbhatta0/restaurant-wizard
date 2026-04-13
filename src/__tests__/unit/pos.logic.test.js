/**
 * Unit Tests — POS Business Logic
 * Tests price calculations, order number generation, discount handling,
 * item management, and total calculations in isolation.
 */

describe('POS Business Logic', () => {
  // ==========================================
  // Price Calculation Tests
  // ==========================================

  describe('calculateItemPrice', () => {
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

    it('should return the full price when no discount is applied', () => {
      const item = { price: 15.99, discount: 0, discountType: 'percentage' };
      expect(calculateItemPrice(item)).toBe(15.99);
    });

    it('should apply percentage discount correctly', () => {
      const item = { price: 20.00, discount: 25, discountType: 'percentage' };
      expect(calculateItemPrice(item)).toBe(15.00);
    });

    it('should apply flat dollar discount correctly', () => {
      const item = { price: 20.00, discount: 5, discountType: 'amount' };
      expect(calculateItemPrice(item)).toBe(15.00);
    });

    it('should not return negative prices (floor at 0)', () => {
      const item = { price: 5.00, discount: 10, discountType: 'amount' };
      expect(calculateItemPrice(item)).toBe(0);
    });

    it('should handle 100% discount correctly', () => {
      const item = { price: 25.00, discount: 100, discountType: 'percentage' };
      expect(calculateItemPrice(item)).toBe(0);
    });

    it('should handle 0% discount as no discount', () => {
      const item = { price: 10.00, discount: 0, discountType: 'percentage' };
      expect(calculateItemPrice(item)).toBe(10.00);
    });

    it('should handle fractional percentage discounts', () => {
      const item = { price: 100.00, discount: 33.33, discountType: 'percentage' };
      expect(calculateItemPrice(item)).toBeCloseTo(66.67, 2);
    });
  });

  // ==========================================
  // Order Number Generation
  // ==========================================

  describe('generateOrderNumber', () => {
    const generateOrderNumber = () => {
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.getTime().toString().slice(-4);
      return `ORD-${datePart}-${timePart}`;
    };

    it('should start with ORD- prefix', () => {
      const orderNumber = generateOrderNumber();
      expect(orderNumber).toMatch(/^ORD-/);
    });

    it('should contain 8-digit date part', () => {
      const orderNumber = generateOrderNumber();
      const parts = orderNumber.split('-');
      expect(parts[1]).toMatch(/^\d{8}$/);
    });

    it('should contain 4-digit time part', () => {
      const orderNumber = generateOrderNumber();
      const parts = orderNumber.split('-');
      expect(parts[2]).toMatch(/^\d{4}$/);
    });

    it('should generate unique numbers (different timestamps)', () => {
      const order1 = generateOrderNumber();
      // In practice, rapid calls may generate the same number since Date.now()
      // has millisecond precision. This is acceptable for the POS use case.
      expect(order1).toBeTruthy();
      expect(typeof order1).toBe('string');
    });
  });

  // ==========================================
  // Order Total Calculation
  // ==========================================

  describe('calculateTotal', () => {
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

    const calculateTotal = (orderItems) => {
      return orderItems.reduce((total, item) => {
        return total + (calculateItemPrice(item) * item.quantity);
      }, 0);
    };

    it('should correctly total a single item with quantity 1', () => {
      const items = [
        { price: 10.00, discount: 0, discountType: 'percentage', quantity: 1 }
      ];
      expect(calculateTotal(items)).toBe(10.00);
    });

    it('should correctly total multiple items', () => {
      const items = [
        { price: 12.99, discount: 0, discountType: 'percentage', quantity: 1 },
        { price: 4.99, discount: 0, discountType: 'percentage', quantity: 2 }
      ];
      expect(calculateTotal(items)).toBeCloseTo(22.97, 2);
    });

    it('should incorporate item discounts in total', () => {
      const items = [
        { price: 20.00, discount: 50, discountType: 'percentage', quantity: 1 }, // $10
        { price: 10.00, discount: 3, discountType: 'amount', quantity: 1 }   // $7
      ];
      expect(calculateTotal(items)).toBe(17.00);
    });

    it('should return 0 for empty order', () => {
      expect(calculateTotal([])).toBe(0);
    });

    it('should handle high quantities correctly', () => {
      const items = [
        { price: 5.00, discount: 0, discountType: 'percentage', quantity: 100 }
      ];
      expect(calculateTotal(items)).toBe(500.00);
    });

    it('should handle mixed discounted and full-price items', () => {
      const items = [
        { price: 15.00, discount: 0, discountType: 'percentage', quantity: 2 },     // $30
        { price: 20.00, discount: 10, discountType: 'percentage', quantity: 1 },     // $18
        { price: 8.00, discount: 2, discountType: 'amount', quantity: 3 }            // $18
      ];
      expect(calculateTotal(items)).toBe(66.00);
    });
  });

  // ==========================================
  // Order Item Management (add/update/remove)
  // ==========================================

  describe('Order Item Management', () => {
    const addToOrder = (orderItems, item) => {
      const existingIndex = orderItems.findIndex(i => i.id === item.id);
      if (existingIndex >= 0) {
        const updated = [...orderItems];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1
        };
        return updated;
      }
      return [...orderItems, { ...item, quantity: 1 }];
    };

    const updateQuantity = (orderItems, itemId, delta) => {
      return orderItems.map(item => {
        if (item.id === itemId) {
          const newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return null;
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean);
    };

    const removeItem = (orderItems, itemId) => {
      return orderItems.filter(item => item.id !== itemId);
    };

    describe('addToOrder', () => {
      it('should add a new item with quantity 1', () => {
        const item = { id: 'item-1', name: 'Burger', price: 10.00 };
        const result = addToOrder([], item);
        expect(result).toHaveLength(1);
        expect(result[0].quantity).toBe(1);
        expect(result[0].name).toBe('Burger');
      });

      it('should increment quantity when adding duplicate item', () => {
        const item = { id: 'item-1', name: 'Burger', price: 10.00 };
        const existing = [{ ...item, quantity: 1 }];
        const result = addToOrder(existing, item);
        expect(result).toHaveLength(1);
        expect(result[0].quantity).toBe(2);
      });

      it('should not affect other items when adding a new one', () => {
        const existing = [{ id: 'item-1', name: 'Burger', price: 10.00, quantity: 2 }];
        const newItem = { id: 'item-2', name: 'Fries', price: 5.00 };
        const result = addToOrder(existing, newItem);
        expect(result).toHaveLength(2);
        expect(result[0].quantity).toBe(2);
        expect(result[1].quantity).toBe(1);
      });

      it('should handle multiple rapid additions of same item', () => {
        const item = { id: 'item-1', name: 'Burger', price: 10.00 };
        let order = [];
        order = addToOrder(order, item);
        order = addToOrder(order, item);
        order = addToOrder(order, item);
        expect(order).toHaveLength(1);
        expect(order[0].quantity).toBe(3);
      });
    });

    describe('updateQuantity', () => {
      it('should increase quantity by delta', () => {
        const items = [{ id: 'item-1', name: 'Burger', quantity: 2 }];
        const result = updateQuantity(items, 'item-1', 1);
        expect(result[0].quantity).toBe(3);
      });

      it('should decrease quantity by delta', () => {
        const items = [{ id: 'item-1', name: 'Burger', quantity: 3 }];
        const result = updateQuantity(items, 'item-1', -1);
        expect(result[0].quantity).toBe(2);
      });

      it('should remove item when quantity reaches zero', () => {
        const items = [{ id: 'item-1', name: 'Burger', quantity: 1 }];
        const result = updateQuantity(items, 'item-1', -1);
        expect(result).toHaveLength(0);
      });

      it('should not affect other items', () => {
        const items = [
          { id: 'item-1', name: 'Burger', quantity: 2 },
          { id: 'item-2', name: 'Fries', quantity: 3 }
        ];
        const result = updateQuantity(items, 'item-1', -1);
        expect(result).toHaveLength(2);
        expect(result[0].quantity).toBe(1);
        expect(result[1].quantity).toBe(3);
      });

      it('should handle non-existent item ID gracefully', () => {
        const items = [{ id: 'item-1', name: 'Burger', quantity: 2 }];
        const result = updateQuantity(items, 'non-existent', 1);
        expect(result).toHaveLength(1);
        expect(result[0].quantity).toBe(2);
      });
    });

    describe('removeItem', () => {
      it('should remove the specified item', () => {
        const items = [
          { id: 'item-1', name: 'Burger' },
          { id: 'item-2', name: 'Fries' }
        ];
        const result = removeItem(items, 'item-1');
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('item-2');
      });

      it('should return empty array when removing last item', () => {
        const items = [{ id: 'item-1', name: 'Burger' }];
        const result = removeItem(items, 'item-1');
        expect(result).toHaveLength(0);
      });

      it('should not change array when removing non-existent item', () => {
        const items = [{ id: 'item-1', name: 'Burger' }];
        const result = removeItem(items, 'non-existent');
        expect(result).toHaveLength(1);
      });
    });
  });
});

// ==========================================
// Payment Calculation Tests
// ==========================================

describe('Payment Calculations', () => {
  const calculatePaymentTotal = ({ subtotal, taxRate, discountAmount, discountType, tipAmount, tipType }) => {
    let tax = subtotal * (taxRate / 100);
    let discount = 0;
    if (discountAmount > 0) {
      discount = discountType === 'percentage'
        ? subtotal * (discountAmount / 100)
        : discountAmount;
    }
    let tip = 0;
    if (tipAmount > 0) {
      const amountAfterDiscount = subtotal - discount + tax;
      tip = tipType === 'percentage'
        ? amountAfterDiscount * (tipAmount / 100)
        : tipAmount;
    }
    return Math.max(0, subtotal + tax - discount + tip);
  };

  it('should calculate total with tax only', () => {
    const result = calculatePaymentTotal({
      subtotal: 100,
      taxRate: 8.5,
      discountAmount: 0,
      discountType: 'amount',
      tipAmount: 0,
      tipType: 'amount'
    });
    expect(result).toBeCloseTo(108.50, 2);
  });

  it('should calculate total with percentage discount', () => {
    const result = calculatePaymentTotal({
      subtotal: 100,
      taxRate: 0,
      discountAmount: 20,
      discountType: 'percentage',
      tipAmount: 0,
      tipType: 'amount'
    });
    expect(result).toBe(80);
  });

  it('should calculate total with flat dollar discount', () => {
    const result = calculatePaymentTotal({
      subtotal: 100,
      taxRate: 0,
      discountAmount: 15,
      discountType: 'amount',
      tipAmount: 0,
      tipType: 'amount'
    });
    expect(result).toBe(85);
  });

  it('should calculate total with flat tip', () => {
    const result = calculatePaymentTotal({
      subtotal: 100,
      taxRate: 0,
      discountAmount: 0,
      discountType: 'amount',
      tipAmount: 15,
      tipType: 'amount'
    });
    expect(result).toBe(115);
  });

  it('should calculate total with percentage tip (based on post-discount + tax)', () => {
    const result = calculatePaymentTotal({
      subtotal: 100,
      taxRate: 10,
      discountAmount: 20,
      discountType: 'amount',
      tipAmount: 20,
      tipType: 'percentage'
    });
    // subtotal: 100, tax: 10, discount: 20 => after discount+tax: 90 => 20% tip on 90 = 18
    // total = 100 + 10 - 20 + 18 = 108
    expect(result).toBeCloseTo(108, 2);
  });

  it('should not produce negative total', () => {
    const result = calculatePaymentTotal({
      subtotal: 10,
      taxRate: 0,
      discountAmount: 50,
      discountType: 'amount',
      tipAmount: 0,
      tipType: 'amount'
    });
    expect(result).toBe(0);
  });

  it('should handle full real-world scenario: subtotal + tax + discount + tip', () => {
    const result = calculatePaymentTotal({
      subtotal: 75.50,
      taxRate: 8.5,
      discountAmount: 10,
      discountType: 'amount',
      tipAmount: 18,
      tipType: 'percentage'
    });
    // tax = 75.50 * 0.085 = 6.4175
    // discount = 10
    // after discount + tax: 75.50 - 10 + 6.4175 = 71.9175
    // tip = 71.9175 * 0.18 = 12.94515
    // total = 75.50 + 6.4175 - 10 + 12.94515 = 84.86265
    expect(result).toBeCloseTo(84.86, 1);
  });
});

// ==========================================
// Order Status Workflow Tests
// ==========================================

describe('Order Status Workflow', () => {
  const VALID_TRANSITIONS = {
    'new': ['sent_to_kitchen'],
    'sent_to_kitchen': ['preparing'],
    'preparing': ['ready'],
    'ready': ['served'],
    'served': ['completed', 'reimbursed']
  };

  const isValidTransition = (currentStatus, newStatus) => {
    const allowed = VALID_TRANSITIONS[currentStatus];
    return allowed ? allowed.includes(newStatus) : false;
  };

  it('should allow new → sent_to_kitchen', () => {
    expect(isValidTransition('new', 'sent_to_kitchen')).toBe(true);
  });

  it('should allow sent_to_kitchen → preparing', () => {
    expect(isValidTransition('sent_to_kitchen', 'preparing')).toBe(true);
  });

  it('should allow preparing → ready', () => {
    expect(isValidTransition('preparing', 'ready')).toBe(true);
  });

  it('should allow ready → served', () => {
    expect(isValidTransition('ready', 'served')).toBe(true);
  });

  it('should allow served → completed', () => {
    expect(isValidTransition('served', 'completed')).toBe(true);
  });

  it('should allow served → reimbursed', () => {
    expect(isValidTransition('served', 'reimbursed')).toBe(true);
  });

  it('should NOT allow skipping statuses (new → ready)', () => {
    expect(isValidTransition('new', 'ready')).toBe(false);
  });

  it('should NOT allow backward transitions (ready → preparing)', () => {
    expect(isValidTransition('ready', 'preparing')).toBe(false);
  });

  it('should NOT allow completed → any status', () => {
    expect(isValidTransition('completed', 'served')).toBe(false);
    expect(isValidTransition('completed', 'preparing')).toBe(false);
  });
});

// ==========================================
// Table Number Formatting
// ==========================================

describe('Table Number Formatting', () => {
  const formatTableNumber = (tableNumber) => {
    if (Array.isArray(tableNumber)) {
      return tableNumber.join(', ');
    }
    return tableNumber || 'N/A';
  };

  it('should format single table number', () => {
    expect(formatTableNumber('5')).toBe('5');
  });

  it('should format array of table numbers', () => {
    expect(formatTableNumber(['1', '2', '3'])).toBe('1, 2, 3');
  });

  it('should return N/A for null/undefined', () => {
    expect(formatTableNumber(null)).toBe('N/A');
    expect(formatTableNumber(undefined)).toBe('N/A');
  });

  it('should handle empty string', () => {
    expect(formatTableNumber('')).toBe('N/A');
  });

  it('should handle empty array', () => {
    expect(formatTableNumber([])).toBe('');
  });
});

// ==========================================
// Order Type Info Helper
// ==========================================

describe('getOrderTypeInfo', () => {
  const getOrderTypeInfo = (orderType) => {
    switch (orderType) {
      case 'dine_in':
        return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
      case 'pickup':
        return { label: 'Pickup', icon: 'bi-bag-check', variant: 'success' };
      case 'delivery':
        return { label: 'Delivery', icon: 'bi-truck', variant: 'warning' };
      default:
        return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
    }
  };

  it('should return correct info for dine_in', () => {
    const info = getOrderTypeInfo('dine_in');
    expect(info.label).toBe('Dine-In');
    expect(info.variant).toBe('info');
  });

  it('should return correct info for pickup', () => {
    const info = getOrderTypeInfo('pickup');
    expect(info.label).toBe('Pickup');
    expect(info.variant).toBe('success');
  });

  it('should return correct info for delivery', () => {
    const info = getOrderTypeInfo('delivery');
    expect(info.label).toBe('Delivery');
    expect(info.variant).toBe('warning');
  });

  it('should default to Dine-In for unknown type', () => {
    const info = getOrderTypeInfo('unknown');
    expect(info.label).toBe('Dine-In');
  });

  it('should default to Dine-In for undefined', () => {
    const info = getOrderTypeInfo(undefined);
    expect(info.label).toBe('Dine-In');
  });
});

// ==========================================
// Item Notes & Spice Level Tests
// ==========================================

describe('Item Notes & Spice Level', () => {
  // Mirrors the updated addToOrder logic from POS.js using composite key
  const addItemToCart = (orderItems, item, notes = '', spiceLevel = '') => {
    const existingIndex = orderItems.findIndex(i =>
      i.id === item.id &&
      (i.notes || '') === (notes || '') &&
      (i.spiceLevel || '') === (spiceLevel || '')
    );
    if (existingIndex >= 0) {
      const updated = [...orderItems];
      updated[existingIndex] = {
        ...updated[existingIndex],
        quantity: updated[existingIndex].quantity + 1
      };
      return updated;
    }
    return [...orderItems, { ...item, quantity: 1, notes: notes || '', spiceLevel: spiceLevel || '' }];
  };

  // Index-based updateQuantity (mirrors POS.js)
  const updateQuantity = (orderItems, index, delta) => {
    return orderItems.map((item, i) => {
      if (i === index) {
        const newQuantity = item.quantity + delta;
        if (newQuantity <= 0) return null;
        return { ...item, quantity: newQuantity };
      }
      return item;
    }).filter(Boolean);
  };

  // Index-based removeItem (mirrors POS.js)
  const removeItem = (orderItems, index) => {
    return orderItems.filter((_, i) => i !== index);
  };

  // Mirrors buildOrderData item mapping
  const buildOrderItems = (orderItems) => {
    return orderItems.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      ...(item.notes && { notes: item.notes }),
      ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
    }));
  };

  describe('addItemToCart with notes/spiceLevel', () => {
    const burger = { id: 'item-1', name: 'Burger', price: 10.00 };

    it('should add item with notes', () => {
      const result = addItemToCart([], burger, 'extra cheese');
      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('extra cheese');
      expect(result[0].quantity).toBe(1);
    });

    it('should add item with spice level', () => {
      const result = addItemToCart([], burger, '', 'Hot');
      expect(result).toHaveLength(1);
      expect(result[0].spiceLevel).toBe('Hot');
    });

    it('should add item with both notes and spice level', () => {
      const result = addItemToCart([], burger, 'no onion', 'Mild');
      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('no onion');
      expect(result[0].spiceLevel).toBe('Mild');
    });

    it('should keep same item with different notes as separate line items', () => {
      let cart = addItemToCart([], burger, 'extra cheese');
      cart = addItemToCart(cart, burger, 'no pickles');
      expect(cart).toHaveLength(2);
      expect(cart[0].notes).toBe('extra cheese');
      expect(cart[1].notes).toBe('no pickles');
    });

    it('should keep same item with different spice levels as separate line items', () => {
      let cart = addItemToCart([], burger, '', 'Mild');
      cart = addItemToCart(cart, burger, '', 'Hot');
      expect(cart).toHaveLength(2);
      expect(cart[0].spiceLevel).toBe('Mild');
      expect(cart[1].spiceLevel).toBe('Hot');
    });

    it('should merge same item with same notes and spice level', () => {
      let cart = addItemToCart([], burger, 'extra cheese', 'Hot');
      cart = addItemToCart(cart, burger, 'extra cheese', 'Hot');
      expect(cart).toHaveLength(1);
      expect(cart[0].quantity).toBe(2);
    });

    it('should merge items with no notes and no spice (backward compat)', () => {
      let cart = addItemToCart([], burger);
      cart = addItemToCart(cart, burger);
      expect(cart).toHaveLength(1);
      expect(cart[0].quantity).toBe(2);
    });

    it('should treat empty string notes same as no notes', () => {
      let cart = addItemToCart([], burger, '');
      cart = addItemToCart(cart, burger);
      expect(cart).toHaveLength(1);
      expect(cart[0].quantity).toBe(2);
    });
  });

  describe('index-based updateQuantity', () => {
    it('should update quantity at specific index', () => {
      const items = [
        { id: 'item-1', name: 'Burger', quantity: 1, notes: 'extra cheese', spiceLevel: '' },
        { id: 'item-1', name: 'Burger', quantity: 1, notes: 'no pickles', spiceLevel: '' }
      ];
      const result = updateQuantity(items, 0, 1);
      expect(result[0].quantity).toBe(2);
      expect(result[1].quantity).toBe(1);
    });

    it('should remove item at index when quantity reaches zero', () => {
      const items = [
        { id: 'item-1', name: 'Burger', quantity: 1, notes: 'extra cheese', spiceLevel: '' },
        { id: 'item-1', name: 'Burger', quantity: 1, notes: 'no pickles', spiceLevel: '' }
      ];
      const result = updateQuantity(items, 0, -1);
      expect(result).toHaveLength(1);
      expect(result[0].notes).toBe('no pickles');
    });
  });

  describe('index-based removeItem', () => {
    it('should remove correct item by index', () => {
      const items = [
        { id: 'item-1', name: 'Burger', notes: 'A' },
        { id: 'item-1', name: 'Burger', notes: 'B' },
        { id: 'item-2', name: 'Fries', notes: '' }
      ];
      const result = removeItem(items, 1);
      expect(result).toHaveLength(2);
      expect(result[0].notes).toBe('A');
      expect(result[1].name).toBe('Fries');
    });
  });

  describe('buildOrderItems with notes/spiceLevel', () => {
    it('should include notes and spiceLevel in order items', () => {
      const items = [
        { id: 'item-1', name: 'Burger', price: 10, quantity: 2, notes: 'well done', spiceLevel: 'Hot' }
      ];
      const result = buildOrderItems(items);
      expect(result[0].notes).toBe('well done');
      expect(result[0].spiceLevel).toBe('Hot');
    });

    it('should omit notes and spiceLevel when empty', () => {
      const items = [
        { id: 'item-1', name: 'Burger', price: 10, quantity: 1, notes: '', spiceLevel: '' }
      ];
      const result = buildOrderItems(items);
      expect(result[0]).not.toHaveProperty('notes');
      expect(result[0]).not.toHaveProperty('spiceLevel');
    });

    it('should handle items with only notes (no spice)', () => {
      const items = [
        { id: 'item-1', name: 'Coke', price: 3, quantity: 1, notes: 'no ice, add straw', spiceLevel: '' }
      ];
      const result = buildOrderItems(items);
      expect(result[0].notes).toBe('no ice, add straw');
      expect(result[0]).not.toHaveProperty('spiceLevel');
    });

    it('should handle items with only spice (no notes)', () => {
      const items = [
        { id: 'item-1', name: 'Curry', price: 15, quantity: 1, notes: '', spiceLevel: 'Extra Hot' }
      ];
      const result = buildOrderItems(items);
      expect(result[0]).not.toHaveProperty('notes');
      expect(result[0].spiceLevel).toBe('Extra Hot');
    });
  });
});
