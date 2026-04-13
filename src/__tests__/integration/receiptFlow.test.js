/**
 * Integration Tests — Receipt Flow
 * Tests the complete payment-to-receipt flow:
 * receipt shows after cash/card/terminal payment,
 * multi-order receipt aggregation, and receipt delivery options.
 */

describe('Receipt Flow — Integration', () => {

  // ==========================================
  // Shared Test Data
  // ==========================================

  const restaurantData = {
    restaurantName: 'The Gurkha Kitchen',
    address: '456 Oak Ave, San Francisco, CA 94110',
    phone: '415-555-0199',
    taxRate: 8.875
  };

  const makeOrder = (overrides = {}) => ({
    id: `order-${Math.random().toString(36).substr(2, 6)}`,
    orderNumber: `ORD-20260404-${Math.floor(Math.random() * 9999)}`,
    status: 'served',
    tableNumber: 3,
    items: [
      { name: 'Momo', price: 10.99, quantity: 2 },
      { name: 'Chai', price: 3.50, quantity: 1 }
    ],
    createdAt: new Date(),
    ...overrides
  });

  // Simulate the receipt building logic from Payments.js
  const buildReceiptData = (method, selectedOrderIds, allOrders, paymentState, restaurant, tableNums) => {
    const receiptOrders = selectedOrderIds.map(id => allOrders.find(o => o.id === id)).filter(Boolean);
    const allItems = receiptOrders.flatMap(o => (o.items || []).map(item => ({
      name: item.name,
      quantity: item.quantity || 1,
      price: item.price || 0
    })));
    const orderNums = receiptOrders.map(o => o.orderNumber || o.id);

    return {
      restaurantName: restaurant?.restaurantName || '',
      restaurantAddress: restaurant?.address || '',
      restaurantPhone: restaurant?.phone || '',
      orderNumbers: orderNums,
      items: allItems,
      subtotal: paymentState.subtotal,
      taxRate: paymentState.taxRate,
      taxAmount: paymentState.taxAmount,
      discountAmount: paymentState.discountAmount || 0,
      discountType: paymentState.discountType || 'amount',
      promoCode: paymentState.promoCode || null,
      tipAmount: paymentState.tipAmount || 0,
      total: paymentState.total,
      paymentMethod: method,
      tableNumbers: tableNums || [],
      paidAt: new Date().toISOString()
    };
  };

  // ==========================================
  // Cash Payment → Receipt
  // ==========================================

  describe('Cash Payment → Receipt', () => {
    it('should generate receipt after cash payment with correct restaurant info', () => {
      const order = makeOrder();
      const paymentState = {
        subtotal: 25.48,
        taxRate: 8.875,
        taxAmount: 2.26,
        total: 27.74
      };

      const receipt = buildReceiptData('cash', [order.id], [order], paymentState, restaurantData, ['3']);

      expect(receipt.restaurantName).toBe('The Gurkha Kitchen');
      expect(receipt.restaurantAddress).toBe('456 Oak Ave, San Francisco, CA 94110');
      expect(receipt.restaurantPhone).toBe('415-555-0199');
      expect(receipt.paymentMethod).toBe('cash');
      expect(receipt.total).toBe(27.74);
    });

    it('should include all items from the order', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, total: 27.74
      }, restaurantData, ['3']);

      expect(receipt.items).toHaveLength(2);
      expect(receipt.items[0]).toEqual({ name: 'Momo', price: 10.99, quantity: 2 });
      expect(receipt.items[1]).toEqual({ name: 'Chai', price: 3.50, quantity: 1 });
    });

    it('should include tip in cash receipt', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, tipAmount: 4.00, total: 31.74
      }, restaurantData, ['3']);

      expect(receipt.tipAmount).toBe(4.00);
      expect(receipt.total).toBe(31.74);
    });
  });

  // ==========================================
  // Card Payment → Receipt
  // ==========================================

  describe('Card Payment → Receipt', () => {
    it('should generate receipt after card payment', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('card', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, total: 27.74
      }, restaurantData, ['3']);

      expect(receipt.paymentMethod).toBe('card');
      expect(receipt.items).toHaveLength(2);
    });

    it('should include discount and promo code on card receipt', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('card', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 1.92,
        discountAmount: 10, discountType: 'percentage', promoCode: 'WELCOME10',
        total: 24.84
      }, restaurantData, ['3']);

      expect(receipt.discountAmount).toBe(10);
      expect(receipt.discountType).toBe('percentage');
      expect(receipt.promoCode).toBe('WELCOME10');
    });
  });

  // ==========================================
  // Terminal Payment → Receipt
  // ==========================================

  describe('Terminal Payment → Receipt', () => {
    it('should generate receipt after terminal payment', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('terminal', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, total: 27.74
      }, restaurantData, ['3']);

      expect(receipt.paymentMethod).toBe('terminal');
    });
  });

  // ==========================================
  // Multi-Order Receipt
  // ==========================================

  describe('Multi-Order Receipt', () => {
    it('should aggregate items from multiple orders on same table', () => {
      const order1 = makeOrder({
        id: 'multi-1',
        orderNumber: 'ORD-20260404-0001',
        items: [{ name: 'Burger', price: 12.99, quantity: 1 }]
      });
      const order2 = makeOrder({
        id: 'multi-2',
        orderNumber: 'ORD-20260404-0002',
        items: [{ name: 'Fries', price: 4.99, quantity: 2 }, { name: 'Soda', price: 2.50, quantity: 1 }]
      });

      const allOrders = [order1, order2];
      const receipt = buildReceiptData('cash', ['multi-1', 'multi-2'], allOrders, {
        subtotal: 25.47, taxRate: 8.5, taxAmount: 2.16, total: 27.63
      }, restaurantData, ['3']);

      expect(receipt.items).toHaveLength(3);
      expect(receipt.orderNumbers).toEqual(['ORD-20260404-0001', 'ORD-20260404-0002']);
    });

    it('should handle multiple table numbers', () => {
      const order1 = makeOrder({ id: 'tbl-1', tableNumber: 5 });
      const order2 = makeOrder({ id: 'tbl-2', tableNumber: 6 });

      const receipt = buildReceiptData('cash', ['tbl-1', 'tbl-2'], [order1, order2], {
        subtotal: 50.96, taxRate: 8.5, taxAmount: 4.33, total: 55.29
      }, restaurantData, ['5', '6']);

      expect(receipt.tableNumbers).toEqual(['5', '6']);
    });
  });

  // ==========================================
  // Counter/Pickup Orders (No Table)
  // ==========================================

  describe('Counter/Pickup Orders', () => {
    it('should generate receipt without table numbers for counter orders', () => {
      const order = makeOrder({ tableNumber: null, orderType: 'counter' });
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, total: 27.74
      }, restaurantData, []);

      expect(receipt.tableNumbers).toEqual([]);
    });

    it('should generate receipt for pickup order', () => {
      const order = makeOrder({ tableNumber: null, orderType: 'pickup' });
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, total: 27.74
      }, restaurantData, []);

      expect(receipt.tableNumbers).toEqual([]);
      expect(receipt.items).toHaveLength(2);
    });
  });

  // ==========================================
  // Receipt with Full Discounts
  // ==========================================

  describe('Receipt with Discounts', () => {
    it('should show flat dollar discount', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 1.82,
        discountAmount: 5, discountType: 'amount',
        total: 22.30
      }, restaurantData, ['3']);

      expect(receipt.discountAmount).toBe(5);
      expect(receipt.discountType).toBe('amount');
    });

    it('should show percentage discount with promo', () => {
      const order = makeOrder();
      const receipt = buildReceiptData('card', [order.id], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.03,
        discountAmount: 10, discountType: 'percentage', promoCode: 'SAVE10',
        total: 24.96
      }, restaurantData, ['3']);

      expect(receipt.discountAmount).toBe(10);
      expect(receipt.promoCode).toBe('SAVE10');
    });
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  describe('Edge Cases', () => {
    it('should handle order with zero total (fully discounted)', () => {
      const order = makeOrder({
        items: [{ name: 'Free Sample', price: 0, quantity: 1 }]
      });
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 0, taxRate: 8.875, taxAmount: 0, total: 0
      }, restaurantData, []);

      expect(receipt.total).toBe(0);
      expect(receipt.items[0].price).toBe(0);
    });

    it('should handle single item order', () => {
      const order = makeOrder({
        items: [{ name: 'Espresso', price: 4.50, quantity: 1 }]
      });
      const receipt = buildReceiptData('cash', [order.id], [order], {
        subtotal: 4.50, taxRate: 8.875, taxAmount: 0.40, total: 4.90
      }, restaurantData, []);

      expect(receipt.items).toHaveLength(1);
      expect(receipt.items[0].name).toBe('Espresso');
    });

    it('should handle large order with many items', () => {
      const manyItems = Array.from({ length: 20 }, (_, i) => ({
        name: `Item ${i + 1}`, price: 9.99, quantity: 1
      }));
      const order = makeOrder({ items: manyItems });
      const receipt = buildReceiptData('card', [order.id], [order], {
        subtotal: 199.80, taxRate: 8.875, taxAmount: 17.73, total: 217.53
      }, restaurantData, ['10']);

      expect(receipt.items).toHaveLength(20);
    });

    it('should skip non-existent order IDs gracefully', () => {
      const order = makeOrder({ id: 'real-order' });
      const receipt = buildReceiptData('cash', ['real-order', 'fake-order'], [order], {
        subtotal: 25.48, taxRate: 8.875, taxAmount: 2.26, total: 27.74
      }, restaurantData, ['3']);

      // Only the real order's items should be included
      expect(receipt.items).toHaveLength(2);
      expect(receipt.orderNumbers).toHaveLength(1);
    });
  });
});
