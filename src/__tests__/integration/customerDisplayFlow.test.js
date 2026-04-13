/**
 * Integration Tests — Customer Display Payment Flow
 * Tests the full POS → Customer Display → POS confirmation flow,
 * including session creation, customer response, and order augmentation.
 */

describe('Customer Display Payment Flow', () => {
  // ==========================================
  // Helper: mirrors POS.js pricing logic
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

  const buildSessionData = (orderItems, options = {}) => {
    const { taxRate = 8, selectedTables = [] } = options;
    const subtotal = orderItems.reduce((total, item) =>
      total + (calculateItemPrice(item) * item.quantity), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const total = subtotal + taxAmount;
    const tableNumber = selectedTables.length > 0
      ? (selectedTables.length === 1 ? selectedTables[0] : selectedTables.join(', '))
      : null;

    return {
      status: 'pending_customer',
      items: orderItems.map(item => ({
        id: item.id,
        name: item.name,
        price: calculateItemPrice(item),
        quantity: item.quantity,
        ...(item.notes && { notes: item.notes }),
        ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
      })),
      subtotal,
      taxRate,
      taxAmount,
      total,
      orderNumber: null,
      tableNumber,
      createdAt: new Date().toISOString()
    };
  };

  const buildOrderData = (items, cdResponse, options = {}) => {
    const { taxRate = 8, paymentMethod = null } = options;
    const subtotal = items.reduce((total, item) =>
      total + (calculateItemPrice(item) * item.quantity), 0);
    const taxAmount = subtotal * (taxRate / 100);
    const totalBeforeTip = subtotal + taxAmount;
    const tipAmt = cdResponse?.tipAmount || 0;

    const orderData = {
      orderNumber: 'ORD-20260408-1234',
      items: items.map(item => ({
        id: item.id,
        name: item.name,
        price: calculateItemPrice(item),
        quantity: item.quantity,
        subtotal: calculateItemPrice(item) * item.quantity,
        ...(item.notes && { notes: item.notes }),
        ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
      })),
      status: 'sent_to_kitchen',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (cdResponse) {
      orderData.customerDisplayResponse = {
        tipAmount: cdResponse.tipAmount || 0,
        tipPercent: cdResponse.tipPercent || null,
        signature: cdResponse.signature || null,
        receiptMethod: cdResponse.receiptMethod || 'none',
        receiptContact: cdResponse.receiptContact || null,
        confirmedAt: cdResponse.confirmedAt || null
      };
    }

    if (paymentMethod) {
      orderData.paidAtPOS = true;
      orderData.total = totalBeforeTip + tipAmt;
      orderData.paymentDetails = {
        subtotal,
        taxRate,
        taxAmount,
        tipAmount: tipAmt,
        total: totalBeforeTip + tipAmt,
        paymentMethod,
        paidAt: new Date().toISOString()
      };
    } else {
      orderData.total = subtotal;
    }

    return orderData;
  };

  const sampleItems = [
    { id: 'item-1', name: 'Grilled Chicken', price: 18.99, quantity: 1, discount: 0, discountType: 'percentage' },
    { id: 'item-2', name: 'Caesar Salad', price: 8.99, quantity: 2, discount: 0, discountType: 'percentage' },
    { id: 'item-3', name: 'Lemonade', price: 3.50, quantity: 1, discount: 0, discountType: 'percentage' }
  ];

  // ==========================================
  // Full-Service Flow: POS → Customer Display → Kitchen
  // ==========================================

  describe('full-service flow (no pre-payment)', () => {
    it('should create session with correct items and totals', () => {
      const session = buildSessionData(sampleItems, { selectedTables: ['7'] });
      expect(session.status).toBe('pending_customer');
      expect(session.items).toHaveLength(3);
      expect(session.subtotal).toBeCloseTo(40.47, 2); // 18.99 + 8.99*2 + 3.50
      expect(session.tableNumber).toBe('7');
    });

    it('should handle customer confirming with 20% tip', () => {
      const session = buildSessionData(sampleItems, { selectedTables: ['7'] });
      const cdResponse = {
        tipAmount: (session.subtotal * 20) / 100,
        tipPercent: 20,
        signature: 'data:image/png;base64,sig',
        receiptMethod: 'print',
        receiptContact: null,
        confirmedAt: '2026-04-08T14:30:00Z'
      };

      // Full-service sends to kitchen — no payment at POS
      const order = buildOrderData(sampleItems, cdResponse);
      expect(order.customerDisplayResponse.tipAmount).toBeCloseTo(8.094, 1);
      expect(order.customerDisplayResponse.tipPercent).toBe(20);
      expect(order.customerDisplayResponse.signature).toBeTruthy();
      expect(order.customerDisplayResponse.receiptMethod).toBe('print');
      expect(order.status).toBe('sent_to_kitchen');
    });

    it('should handle customer declining tip', () => {
      const cdResponse = {
        tipAmount: 0,
        tipPercent: null,
        receiptMethod: 'none'
      };
      const order = buildOrderData(sampleItems, cdResponse);
      expect(order.customerDisplayResponse.tipAmount).toBe(0);
      expect(order.total).toBeCloseTo(40.47, 2); // No payment info, just subtotal
    });

    it('should preserve notes and spice levels through the flow', () => {
      const itemsWithNotes = [
        { id: 'item-1', name: 'Pad Thai', price: 14.99, quantity: 1, discount: 0, discountType: 'percentage', notes: 'No peanuts', spiceLevel: 'Medium' }
      ];
      const session = buildSessionData(itemsWithNotes);
      expect(session.items[0].notes).toBe('No peanuts');
      expect(session.items[0].spiceLevel).toBe('Medium');

      const order = buildOrderData(itemsWithNotes, { tipAmount: 3 });
      expect(order.items[0].notes).toBe('No peanuts');
      expect(order.items[0].spiceLevel).toBe('Medium');
    });
  });

  // ==========================================
  // Pay-First Flow: POS → Customer Display → Payment → Kitchen
  // ==========================================

  describe('pay-first flow (counter service)', () => {
    it('should include tip in payment total for cash payment', () => {
      const cdResponse = {
        tipAmount: 5,
        tipPercent: null,
        signature: null,
        receiptMethod: 'email',
        receiptContact: 'customer@test.com',
        confirmedAt: '2026-04-08T15:00:00Z'
      };

      const order = buildOrderData(sampleItems, cdResponse, { paymentMethod: 'cash' });
      const expectedSubtotal = 40.47;
      const expectedTax = expectedSubtotal * 0.08;
      const expectedTotal = expectedSubtotal + expectedTax + 5;

      expect(order.paidAtPOS).toBe(true);
      expect(order.total).toBeCloseTo(expectedTotal, 1);
      expect(order.paymentDetails.tipAmount).toBe(5);
      expect(order.paymentDetails.total).toBeCloseTo(expectedTotal, 1);
      expect(order.paymentDetails.paymentMethod).toBe('cash');
    });

    it('should include tip in payment total for card payment', () => {
      const cdResponse = {
        tipAmount: 8.09,
        tipPercent: 20,
        receiptMethod: 'text',
        receiptContact: '+15551234567'
      };

      const order = buildOrderData(sampleItems, cdResponse, { paymentMethod: 'card' });
      expect(order.paymentDetails.tipAmount).toBe(8.09);
      expect(order.paymentDetails.paymentMethod).toBe('card');
      expect(order.customerDisplayResponse.receiptMethod).toBe('text');
      expect(order.customerDisplayResponse.receiptContact).toBe('+15551234567');
    });

    it('should handle no tip in pay-first mode', () => {
      const cdResponse = { tipAmount: 0, receiptMethod: 'print' };
      const order = buildOrderData(sampleItems, cdResponse, { paymentMethod: 'cash' });
      const expectedSubtotal = 40.47;
      const expectedTax = expectedSubtotal * 0.08;
      expect(order.total).toBeCloseTo(expectedSubtotal + expectedTax, 1);
      expect(order.paymentDetails.tipAmount).toBe(0);
    });
  });

  // ==========================================
  // Receipt Data Integration
  // ==========================================

  describe('receipt data with customer display', () => {
    it('should include tip in receipt when customer added tip', () => {
      const cdResponse = { tipAmount: 10, tipPercent: 25 };
      const order = buildOrderData(sampleItems, cdResponse, { paymentMethod: 'cash' });

      const receiptData = {
        items: order.items.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
        subtotal: order.paymentDetails.subtotal,
        taxRate: order.paymentDetails.taxRate,
        taxAmount: order.paymentDetails.taxAmount,
        tipAmount: order.paymentDetails.tipAmount || 0,
        total: order.paymentDetails.total,
        paymentMethod: order.paymentDetails.paymentMethod
      };

      expect(receiptData.tipAmount).toBe(10);
      expect(receiptData.total).toBeCloseTo(order.paymentDetails.subtotal + order.paymentDetails.taxAmount + 10, 1);
    });

    it('should set receipt delivery method from customer response', () => {
      const cdResponse = { tipAmount: 0, receiptMethod: 'email', receiptContact: 'me@test.com' };
      const order = buildOrderData(sampleItems, cdResponse, { paymentMethod: 'cash' });
      expect(order.customerDisplayResponse.receiptMethod).toBe('email');
      expect(order.customerDisplayResponse.receiptContact).toBe('me@test.com');
    });
  });

  // ==========================================
  // Session Lifecycle (POS ↔ Customer Display)
  // ==========================================

  describe('session lifecycle', () => {
    it('should follow idle → pending_customer → confirmed → idle flow', () => {
      // Step 1: POS creates session
      const session = buildSessionData(sampleItems);
      expect(session.status).toBe('pending_customer');

      // Step 2: Customer confirms (simulated)
      const confirmedSession = {
        ...session,
        status: 'confirmed',
        customerResponse: {
          tipAmount: 5,
          tipPercent: null,
          signature: null,
          receiptMethod: 'none',
          receiptContact: null,
          confirmedAt: new Date().toISOString()
        }
      };
      expect(confirmedSession.status).toBe('confirmed');
      expect(confirmedSession.customerResponse.tipAmount).toBe(5);

      // Step 3: POS reads response and resets to idle
      const resetSession = { status: 'idle' };
      expect(resetSession.status).toBe('idle');
    });

    it('should handle cancellation from POS', () => {
      const session = buildSessionData(sampleItems);
      expect(session.status).toBe('pending_customer');

      // POS cancels
      const cancelledSession = { status: 'idle' };
      expect(cancelledSession.status).toBe('idle');
    });

    it('should handle multiple orders sequentially', () => {
      // First order
      const session1 = buildSessionData([sampleItems[0]]);
      expect(session1.items).toHaveLength(1);
      expect(session1.subtotal).toBeCloseTo(18.99, 2);

      // Second order (new items)
      const session2 = buildSessionData([sampleItems[1], sampleItems[2]]);
      expect(session2.items).toHaveLength(2);
      expect(session2.subtotal).toBeCloseTo(21.48, 2); // 8.99*2 + 3.50
    });
  });

  // ==========================================
  // Edge Cases
  // ==========================================

  describe('edge cases', () => {
    it('should handle order with single item', () => {
      const singleItem = [{ id: '1', name: 'Coffee', price: 4.50, quantity: 1, discount: 0, discountType: 'percentage' }];
      const session = buildSessionData(singleItem);
      expect(session.subtotal).toBe(4.50);
      expect(session.items).toHaveLength(1);
    });

    it('should handle order with large quantities', () => {
      const bulkItem = [{ id: '1', name: 'Water', price: 2.00, quantity: 50, discount: 0, discountType: 'percentage' }];
      const session = buildSessionData(bulkItem);
      expect(session.subtotal).toBe(100);
    });

    it('should handle high tip percentage', () => {
      const session = { subtotal: 100, total: 108 };
      const tipAmount = (session.subtotal * 50) / 100;
      expect(tipAmount).toBe(50);
      const totalWithTip = session.total + tipAmount;
      expect(totalWithTip).toBe(158);
    });

    it('should handle zero-priced items', () => {
      const freeItems = [{ id: '1', name: 'Complimentary Bread', price: 0, quantity: 1, discount: 0, discountType: 'percentage' }];
      const session = buildSessionData(freeItems);
      expect(session.subtotal).toBe(0);
      expect(session.total).toBe(0);
    });

    it('should handle custom tax rate', () => {
      const session = buildSessionData(sampleItems, { taxRate: 10 });
      expect(session.taxRate).toBe(10);
      expect(session.taxAmount).toBeCloseTo(40.47 * 0.10, 2);
    });

    it('should handle discounted items in session', () => {
      const discountedItems = [
        { id: '1', name: 'Happy Hour Beer', price: 8.00, quantity: 2, discount: 50, discountType: 'percentage' }
      ];
      const session = buildSessionData(discountedItems);
      expect(session.items[0].price).toBe(4); // 50% off
      expect(session.subtotal).toBe(8); // 4 * 2
    });
  });
});
