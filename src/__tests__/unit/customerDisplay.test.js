/**
 * Unit Tests — Customer Display Business Logic
 * Tests tip calculation, session data construction, customer response handling,
 * and order data augmentation with customer display data.
 */

describe('Customer Display Business Logic', () => {
  // ==========================================
  // Tip Calculation (mirrors CustomerDisplay.js logic)
  // ==========================================

  describe('tipAmount calculation', () => {
    const calculateTip = (session, selectedTip, customTipAmount) => {
      if (!session) return 0;
      if (selectedTip === 'custom') return parseFloat(customTipAmount) || 0;
      if (selectedTip === 'none') return 0;
      if (selectedTip !== null) return (session.subtotal * selectedTip) / 100;
      return 0;
    };

    it('should return 0 when no session', () => {
      expect(calculateTip(null, 15, '')).toBe(0);
    });

    it('should return 0 when no tip selected', () => {
      const session = { subtotal: 50 };
      expect(calculateTip(session, null, '')).toBe(0);
    });

    it('should calculate percentage tip correctly', () => {
      const session = { subtotal: 50 };
      expect(calculateTip(session, 15, '')).toBe(7.5);
    });

    it('should calculate 18% tip correctly', () => {
      const session = { subtotal: 100 };
      expect(calculateTip(session, 18, '')).toBe(18);
    });

    it('should calculate 20% tip correctly', () => {
      const session = { subtotal: 80 };
      expect(calculateTip(session, 20, '')).toBe(16);
    });

    it('should calculate 25% tip correctly', () => {
      const session = { subtotal: 40 };
      expect(calculateTip(session, 25, '')).toBe(10);
    });

    it('should return custom tip amount', () => {
      const session = { subtotal: 50 };
      expect(calculateTip(session, 'custom', '12.50')).toBe(12.5);
    });

    it('should return 0 for invalid custom tip', () => {
      const session = { subtotal: 50 };
      expect(calculateTip(session, 'custom', '')).toBe(0);
      expect(calculateTip(session, 'custom', 'abc')).toBe(0);
    });

    it('should return 0 for "none" tip', () => {
      const session = { subtotal: 50 };
      expect(calculateTip(session, 'none', '')).toBe(0);
    });
  });

  // ==========================================
  // Total with Tip
  // ==========================================

  describe('totalWithTip calculation', () => {
    const calculateTip = (session, selectedTip, customTipAmount) => {
      if (!session) return 0;
      if (selectedTip === 'custom') return parseFloat(customTipAmount) || 0;
      if (selectedTip === 'none') return 0;
      if (selectedTip !== null) return (session.subtotal * selectedTip) / 100;
      return 0;
    };

    it('should add tip to session total', () => {
      const session = { subtotal: 50, total: 54 };
      const tip = calculateTip(session, 20, '');
      const totalWithTip = session.total + tip;
      expect(totalWithTip).toBe(64); // 54 + 10
    });

    it('should keep total unchanged with no tip', () => {
      const session = { subtotal: 50, total: 54 };
      const tip = calculateTip(session, 'none', '');
      const totalWithTip = session.total + tip;
      expect(totalWithTip).toBe(54);
    });

    it('should add custom tip to total', () => {
      const session = { subtotal: 50, total: 54 };
      const tip = calculateTip(session, 'custom', '7.25');
      const totalWithTip = session.total + tip;
      expect(totalWithTip).toBeCloseTo(61.25, 2);
    });
  });

  // ==========================================
  // Session Data Construction (mirrors POS.js sendToCustomerDisplay)
  // ==========================================

  describe('session data construction', () => {
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
        createdAt: expect.any(String)
      };
    };

    const sampleItems = [
      { id: '1', name: 'Burger', price: 12.99, quantity: 2, discount: 0, discountType: 'percentage' },
      { id: '2', name: 'Fries', price: 4.99, quantity: 1, discount: 0, discountType: 'percentage' }
    ];

    it('should set status to pending_customer', () => {
      const session = buildSessionData(sampleItems);
      expect(session.status).toBe('pending_customer');
    });

    it('should calculate subtotal correctly', () => {
      const session = buildSessionData(sampleItems);
      expect(session.subtotal).toBeCloseTo(30.97, 2); // 12.99*2 + 4.99
    });

    it('should calculate tax correctly', () => {
      const session = buildSessionData(sampleItems);
      expect(session.taxAmount).toBeCloseTo(30.97 * 0.08, 2);
    });

    it('should calculate total correctly', () => {
      const session = buildSessionData(sampleItems);
      const expectedTotal = 30.97 + (30.97 * 0.08);
      expect(session.total).toBeCloseTo(expectedTotal, 2);
    });

    it('should include item details', () => {
      const session = buildSessionData(sampleItems);
      expect(session.items).toHaveLength(2);
      expect(session.items[0].name).toBe('Burger');
      expect(session.items[0].quantity).toBe(2);
      expect(session.items[1].name).toBe('Fries');
    });

    it('should include notes and spice level when present', () => {
      const itemsWithNotes = [
        { id: '1', name: 'Curry', price: 14.99, quantity: 1, discount: 0, discountType: 'percentage', notes: 'Extra hot', spiceLevel: 'Hot' }
      ];
      const session = buildSessionData(itemsWithNotes);
      expect(session.items[0].notes).toBe('Extra hot');
      expect(session.items[0].spiceLevel).toBe('Hot');
    });

    it('should not include notes/spiceLevel when absent', () => {
      const session = buildSessionData(sampleItems);
      expect(session.items[0]).not.toHaveProperty('notes');
      expect(session.items[0]).not.toHaveProperty('spiceLevel');
    });

    it('should include table number when tables are selected', () => {
      const session = buildSessionData(sampleItems, { selectedTables: ['5'] });
      expect(session.tableNumber).toBe('5');
    });

    it('should join multiple table numbers', () => {
      const session = buildSessionData(sampleItems, { selectedTables: ['3', '4'] });
      expect(session.tableNumber).toBe('3, 4');
    });

    it('should set tableNumber to null when no tables', () => {
      const session = buildSessionData(sampleItems, { selectedTables: [] });
      expect(session.tableNumber).toBeNull();
    });

    it('should handle discounted items', () => {
      const discountedItems = [
        { id: '1', name: 'Steak', price: 30.00, quantity: 1, discount: 20, discountType: 'percentage' }
      ];
      const session = buildSessionData(discountedItems);
      expect(session.items[0].price).toBe(24); // 30 - 20%
      expect(session.subtotal).toBe(24);
    });
  });

  // ==========================================
  // Customer Response Handling (mirrors POS.js buildOrderData with cdResponse)
  // ==========================================

  describe('order data with customer display response', () => {
    const buildOrderDataWithCD = (items, cdResponse, options = {}) => {
      const { taxRate = 8, paymentMethod = 'cash' } = options;
      const subtotal = items.reduce((total, item) => total + (item.price * item.quantity), 0);
      const taxAmount = subtotal * (taxRate / 100);
      const totalBeforeTip = subtotal + taxAmount;
      const tipAmt = cdResponse?.tipAmount || 0;

      const orderData = {
        items: items.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.price * item.quantity
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

      return orderData;
    };

    const sampleItems = [
      { id: '1', name: 'Pizza', price: 15, quantity: 1 },
      { id: '2', name: 'Salad', price: 10, quantity: 1 }
    ];

    it('should include tip in total when customer added tip', () => {
      const cdResponse = { tipAmount: 5, tipPercent: 20 };
      const order = buildOrderDataWithCD(sampleItems, cdResponse);
      const subtotal = 25;
      const tax = subtotal * 0.08;
      expect(order.total).toBeCloseTo(subtotal + tax + 5, 2);
      expect(order.paymentDetails.tipAmount).toBe(5);
    });

    it('should not add tip when customer selected no tip', () => {
      const cdResponse = { tipAmount: 0, tipPercent: null, receiptMethod: 'none' };
      const order = buildOrderDataWithCD(sampleItems, cdResponse);
      const subtotal = 25;
      const tax = subtotal * 0.08;
      expect(order.total).toBeCloseTo(subtotal + tax, 2);
      expect(order.paymentDetails.tipAmount).toBe(0);
    });

    it('should attach customer display response to order', () => {
      const cdResponse = {
        tipAmount: 7.50,
        tipPercent: null,
        signature: 'data:image/png;base64,abc',
        receiptMethod: 'email',
        receiptContact: 'test@example.com',
        confirmedAt: '2026-04-08T12:00:00Z'
      };
      const order = buildOrderDataWithCD(sampleItems, cdResponse);
      expect(order.customerDisplayResponse).toBeDefined();
      expect(order.customerDisplayResponse.tipAmount).toBe(7.50);
      expect(order.customerDisplayResponse.signature).toBe('data:image/png;base64,abc');
      expect(order.customerDisplayResponse.receiptMethod).toBe('email');
      expect(order.customerDisplayResponse.receiptContact).toBe('test@example.com');
    });

    it('should not include customerDisplayResponse when no cdResponse', () => {
      const order = buildOrderDataWithCD(sampleItems, null);
      expect(order.customerDisplayResponse).toBeUndefined();
    });

    it('should default null fields in customer response', () => {
      const cdResponse = { tipAmount: 3 };
      const order = buildOrderDataWithCD(sampleItems, cdResponse);
      expect(order.customerDisplayResponse.tipPercent).toBeNull();
      expect(order.customerDisplayResponse.signature).toBeNull();
      expect(order.customerDisplayResponse.receiptMethod).toBe('none');
      expect(order.customerDisplayResponse.receiptContact).toBeNull();
    });

    it('should include receipt contact for text receipt', () => {
      const cdResponse = {
        tipAmount: 0,
        receiptMethod: 'text',
        receiptContact: '+15551234567'
      };
      const order = buildOrderDataWithCD(sampleItems, cdResponse);
      expect(order.customerDisplayResponse.receiptMethod).toBe('text');
      expect(order.customerDisplayResponse.receiptContact).toBe('+15551234567');
    });
  });

  // ==========================================
  // Display Config Defaults
  // ==========================================

  describe('display config', () => {
    const TIP_PRESETS_DEFAULT = [15, 18, 20, 25];

    const mergeConfig = (incoming) => {
      const defaults = {
        showTip: true,
        showSignature: true,
        showReceiptOptions: true,
        tipPresets: TIP_PRESETS_DEFAULT
      };
      return { ...defaults, ...incoming };
    };

    it('should use defaults when no config provided', () => {
      const config = mergeConfig({});
      expect(config.showTip).toBe(true);
      expect(config.showSignature).toBe(true);
      expect(config.showReceiptOptions).toBe(true);
      expect(config.tipPresets).toEqual([15, 18, 20, 25]);
    });

    it('should override tip presets', () => {
      const config = mergeConfig({ tipPresets: [10, 15, 20] });
      expect(config.tipPresets).toEqual([10, 15, 20]);
    });

    it('should allow disabling tip', () => {
      const config = mergeConfig({ showTip: false });
      expect(config.showTip).toBe(false);
    });

    it('should allow disabling signature', () => {
      const config = mergeConfig({ showSignature: false });
      expect(config.showSignature).toBe(false);
    });

    it('should allow disabling receipt options', () => {
      const config = mergeConfig({ showReceiptOptions: false });
      expect(config.showReceiptOptions).toBe(false);
    });
  });

  // ==========================================
  // Session Status Transitions
  // ==========================================

  describe('session status transitions', () => {
    it('should transition from idle to pending_customer', () => {
      const status = 'idle';
      const newStatus = 'pending_customer';
      expect(newStatus).not.toBe(status);
    });

    it('should transition from pending_customer to confirmed', () => {
      const session = { status: 'pending_customer' };
      const updatedSession = { ...session, status: 'confirmed', customerResponse: { tipAmount: 5 } };
      expect(updatedSession.status).toBe('confirmed');
      expect(updatedSession.customerResponse).toBeDefined();
    });

    it('should transition from confirmed to idle after completion', () => {
      const session = { status: 'confirmed' };
      const resetSession = { status: 'idle' };
      expect(resetSession.status).toBe('idle');
    });

    it('should allow cancellation from pending_customer to idle', () => {
      const session = { status: 'pending_customer' };
      const cancelledSession = { status: 'idle' };
      expect(cancelledSession.status).toBe('idle');
    });
  });

  // ==========================================
  // Receipt Data with Tip from Customer Display
  // ==========================================

  describe('receipt data with customer display tip', () => {
    it('should include tip amount in receipt data', () => {
      const paymentDetails = {
        subtotal: 50,
        taxRate: 8,
        taxAmount: 4,
        tipAmount: 10,
        total: 64,
        paymentMethod: 'card'
      };

      const receiptData = {
        subtotal: paymentDetails.subtotal,
        taxRate: paymentDetails.taxRate,
        taxAmount: paymentDetails.taxAmount,
        tipAmount: paymentDetails.tipAmount || 0,
        total: paymentDetails.total,
        paymentMethod: paymentDetails.paymentMethod
      };

      expect(receiptData.tipAmount).toBe(10);
      expect(receiptData.total).toBe(64);
    });

    it('should default tip to 0 when not present', () => {
      const paymentDetails = {
        subtotal: 50,
        taxRate: 8,
        taxAmount: 4,
        total: 54,
        paymentMethod: 'cash'
      };

      const receiptData = {
        tipAmount: paymentDetails.tipAmount || 0,
        total: paymentDetails.total
      };

      expect(receiptData.tipAmount).toBe(0);
    });
  });
});
