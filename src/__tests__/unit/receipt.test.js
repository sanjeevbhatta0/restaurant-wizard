/**
 * Unit Tests — Receipt Feature
 * Tests receipt data construction, formatting, display logic,
 * and delivery option validation.
 */

describe('Receipt Feature — Unit Tests', () => {

  // ==========================================
  // Receipt Data Construction
  // ==========================================

  describe('buildReceiptData', () => {
    const orders = [
      {
        id: 'order-1',
        orderNumber: 'ORD-20260404-1234',
        tableNumber: 5,
        items: [
          { name: 'Burger', price: 12.99, quantity: 2 },
          { name: 'Fries', price: 4.99, quantity: 1 }
        ]
      },
      {
        id: 'order-2',
        orderNumber: 'ORD-20260404-5678',
        tableNumber: 5,
        items: [
          { name: 'Soda', price: 2.50, quantity: 3 }
        ]
      }
    ];

    const restaurantData = {
      restaurantName: 'The Burger Place',
      address: '123 Main St, New York, NY 10001',
      phone: '555-123-4567'
    };

    // Simulate the buildAndShowReceipt logic
    const buildReceiptData = (method, orderIds, tableNums, paymentState, restaurant) => {
      const receiptOrders = orderIds.map(id => orders.find(o => o.id === id)).filter(Boolean);
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
        discountAmount: paymentState.discountAmount,
        discountType: paymentState.discountType,
        promoCode: paymentState.promoCode,
        tipAmount: paymentState.tipAmount,
        total: paymentState.total,
        paymentMethod: method,
        tableNumbers: tableNums || [],
        paidAt: '2026-04-04T12:00:00.000Z'
      };
    };

    it('should include restaurant name, address, and phone', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);

      expect(receipt.restaurantName).toBe('The Burger Place');
      expect(receipt.restaurantAddress).toBe('123 Main St, New York, NY 10001');
      expect(receipt.restaurantPhone).toBe('555-123-4567');
    });

    it('should collect items from all selected orders', () => {
      const receipt = buildReceiptData('cash', ['order-1', 'order-2'], ['5'], {
        subtotal: 38.47, taxRate: 8.5, taxAmount: 3.27, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 41.74
      }, restaurantData);

      expect(receipt.items).toHaveLength(3);
      expect(receipt.items[0].name).toBe('Burger');
      expect(receipt.items[0].quantity).toBe(2);
      expect(receipt.items[0].price).toBe(12.99);
      expect(receipt.items[1].name).toBe('Fries');
      expect(receipt.items[2].name).toBe('Soda');
      expect(receipt.items[2].quantity).toBe(3);
    });

    it('should collect order numbers from all selected orders', () => {
      const receipt = buildReceiptData('cash', ['order-1', 'order-2'], ['5'], {
        subtotal: 38.47, taxRate: 8.5, taxAmount: 3.27, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 41.74
      }, restaurantData);

      expect(receipt.orderNumbers).toEqual(['ORD-20260404-1234', 'ORD-20260404-5678']);
    });

    it('should include tax rate and tax amount', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 10.0, taxAmount: 3.10, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 34.07
      }, restaurantData);

      expect(receipt.taxRate).toBe(10.0);
      expect(receipt.taxAmount).toBe(3.10);
    });

    it('should include tip amount', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 5.00, total: 38.60
      }, restaurantData);

      expect(receipt.tipAmount).toBe(5.00);
    });

    it('should include discount with promo code', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.20, discountAmount: 15,
        discountType: 'percentage', promoCode: 'SUMMER15', tipAmount: 0, total: 28.52
      }, restaurantData);

      expect(receipt.discountAmount).toBe(15);
      expect(receipt.discountType).toBe('percentage');
      expect(receipt.promoCode).toBe('SUMMER15');
    });

    it('should set correct payment method for cash', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);
      expect(receipt.paymentMethod).toBe('cash');
    });

    it('should set correct payment method for card', () => {
      const receipt = buildReceiptData('card', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);
      expect(receipt.paymentMethod).toBe('card');
    });

    it('should set correct payment method for terminal', () => {
      const receipt = buildReceiptData('terminal', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);
      expect(receipt.paymentMethod).toBe('terminal');
    });

    it('should include table numbers', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5', '6'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);
      expect(receipt.tableNumbers).toEqual(['5', '6']);
    });

    it('should handle empty table numbers', () => {
      const receipt = buildReceiptData('cash', ['order-1'], [], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);
      expect(receipt.tableNumbers).toEqual([]);
    });

    it('should handle missing restaurant data gracefully', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, null);

      expect(receipt.restaurantName).toBe('');
      expect(receipt.restaurantAddress).toBe('');
      expect(receipt.restaurantPhone).toBe('');
    });

    it('should handle orders with no items', () => {
      const emptyOrders = [{ id: 'empty-1', orderNumber: 'ORD-EMPTY', items: [] }];
      const origOrders = [...orders];
      orders.push(emptyOrders[0]);

      const receipt = buildReceiptData('cash', ['empty-1'], [], {
        subtotal: 0, taxRate: 8.5, taxAmount: 0, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 0
      }, restaurantData);

      expect(receipt.items).toHaveLength(0);
      expect(receipt.total).toBe(0);

      // Cleanup
      orders.length = origOrders.length;
    });

    it('should use order ID as fallback when orderNumber is missing', () => {
      const noNumOrders = [{ id: 'no-num-order', items: [{ name: 'Test', price: 5, quantity: 1 }] }];
      orders.push(noNumOrders[0]);

      const receipt = buildReceiptData('cash', ['no-num-order'], [], {
        subtotal: 5, taxRate: 0, taxAmount: 0, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 5
      }, restaurantData);

      expect(receipt.orderNumbers).toContain('no-num-order');

      orders.pop();
    });

    it('should include paidAt timestamp', () => {
      const receipt = buildReceiptData('cash', ['order-1'], ['5'], {
        subtotal: 30.97, taxRate: 8.5, taxAmount: 2.63, discountAmount: 0,
        discountType: 'amount', promoCode: null, tipAmount: 0, total: 33.60
      }, restaurantData);

      expect(receipt.paidAt).toBeDefined();
      expect(typeof receipt.paidAt).toBe('string');
    });
  });

  // ==========================================
  // Receipt Display Formatting
  // ==========================================

  describe('Receipt Formatting', () => {
    const formatDate = (dateStr) => {
      const d = dateStr ? new Date(dateStr) : new Date();
      return d.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    };

    const getPaymentMethodLabel = (method) => {
      switch (method) {
        case 'cash': return 'Cash';
        case 'card': return 'Credit/Debit Card';
        case 'terminal': return 'Card Terminal';
        default: return method || 'N/A';
      }
    };

    it('should format date correctly', () => {
      const formatted = formatDate('2026-04-04T15:30:00.000Z');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('Apr');
    });

    it('should handle null date gracefully (use current date)', () => {
      const formatted = formatDate(null);
      expect(formatted).toBeTruthy();
    });

    it('should label cash payment correctly', () => {
      expect(getPaymentMethodLabel('cash')).toBe('Cash');
    });

    it('should label card payment correctly', () => {
      expect(getPaymentMethodLabel('card')).toBe('Credit/Debit Card');
    });

    it('should label terminal payment correctly', () => {
      expect(getPaymentMethodLabel('terminal')).toBe('Card Terminal');
    });

    it('should handle unknown payment method', () => {
      expect(getPaymentMethodLabel('bitcoin')).toBe('bitcoin');
    });

    it('should handle null/undefined payment method', () => {
      expect(getPaymentMethodLabel(null)).toBe('N/A');
      expect(getPaymentMethodLabel(undefined)).toBe('N/A');
    });
  });

  // ==========================================
  // Receipt Delivery Validation
  // ==========================================

  describe('Receipt Delivery Validation', () => {
    const validateDelivery = (method, email, phone) => {
      if (method === 'email' && (!email || !email.trim())) {
        return { valid: false, error: 'Please enter an email address.' };
      }
      if (method === 'sms' && (!phone || !phone.trim())) {
        return { valid: false, error: 'Please enter a phone number.' };
      }
      return { valid: true, error: null };
    };

    it('should reject email delivery without email address', () => {
      const result = validateDelivery('email', '', '');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('email');
    });

    it('should reject email delivery with whitespace-only email', () => {
      const result = validateDelivery('email', '   ', '');
      expect(result.valid).toBe(false);
    });

    it('should accept email delivery with valid email', () => {
      const result = validateDelivery('email', 'test@example.com', '');
      expect(result.valid).toBe(true);
    });

    it('should reject SMS delivery without phone number', () => {
      const result = validateDelivery('sms', '', '');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('phone');
    });

    it('should reject SMS delivery with whitespace-only phone', () => {
      const result = validateDelivery('sms', '', '   ');
      expect(result.valid).toBe(false);
    });

    it('should accept SMS delivery with valid phone', () => {
      const result = validateDelivery('sms', '', '555-123-4567');
      expect(result.valid).toBe(true);
    });

    it('should accept print (no validation needed)', () => {
      const result = validateDelivery('print', '', '');
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================
  // Receipt Total Calculations
  // ==========================================

  describe('Receipt Total Calculations', () => {
    it('should calculate correct subtotal from items', () => {
      const items = [
        { name: 'Burger', price: 12.99, quantity: 2 },
        { name: 'Fries', price: 4.99, quantity: 1 },
        { name: 'Soda', price: 2.50, quantity: 3 }
      ];
      const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      expect(subtotal).toBeCloseTo(38.47, 2);
    });

    it('should calculate tax correctly', () => {
      const subtotal = 38.47;
      const taxRate = 8.5;
      const taxAmount = subtotal * (taxRate / 100);
      expect(taxAmount).toBeCloseTo(3.27, 2);
    });

    it('should calculate percentage discount correctly', () => {
      const subtotal = 38.47;
      const discountAmount = 15; // 15%
      const discount = subtotal * (discountAmount / 100);
      expect(discount).toBeCloseTo(5.77, 2);
    });

    it('should calculate flat discount correctly', () => {
      const subtotal = 38.47;
      const discountAmount = 5.00; // $5 off
      const afterDiscount = subtotal - discountAmount;
      expect(afterDiscount).toBeCloseTo(33.47, 2);
    });

    it('should calculate grand total with tax and tip', () => {
      const subtotal = 38.47;
      const taxAmount = 3.27;
      const tipAmount = 5.00;
      const total = subtotal + taxAmount + tipAmount;
      expect(total).toBeCloseTo(46.74, 2);
    });

    it('should calculate grand total with discount, tax, and tip', () => {
      const subtotal = 38.47;
      const discount = 5.77; // 15%
      const afterDiscount = subtotal - discount;
      const taxAmount = afterDiscount * 0.085;
      const tipAmount = 5.00;
      const total = afterDiscount + taxAmount + tipAmount;
      expect(total).toBeCloseTo(40.48, 1);
    });
  });

  // ==========================================
  // POS Receipt Data (Pre-Pay Mode)
  // ==========================================

  describe('POS Receipt Data Construction', () => {
    // Mirrors the receipt data building in POS.js submitOrder
    const buildPosReceiptData = (orderData, orderNumber, tableDisplay, restaurantData) => {
      if (!orderData.paidAtPOS || !orderData.paymentDetails) return null;

      return {
        restaurantName: restaurantData?.restaurantName || '',
        restaurantAddress: restaurantData?.address || '',
        restaurantPhone: restaurantData?.phone || '',
        orderNumbers: [orderNumber],
        items: orderData.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })),
        subtotal: orderData.paymentDetails.subtotal,
        taxRate: orderData.paymentDetails.taxRate,
        taxAmount: orderData.paymentDetails.taxAmount,
        discountAmount: 0,
        discountType: 'amount',
        promoCode: null,
        tipAmount: 0,
        total: orderData.paymentDetails.total,
        paymentMethod: orderData.paymentDetails.paymentMethod,
        tableNumbers: tableDisplay ? [tableDisplay] : [],
        paidAt: orderData.paymentDetails.paidAt
      };
    };

    const restaurant = {
      restaurantName: 'Taco Truck',
      address: '100 Food Truck Alley',
      phone: '555-TACO'
    };

    it('should build receipt data for cash pre-pay POS order', () => {
      const orderData = {
        paidAtPOS: true,
        items: [
          { name: 'Taco', price: 3.50, quantity: 3 },
          { name: 'Agua', price: 2.00, quantity: 1 }
        ],
        paymentDetails: {
          subtotal: 12.50,
          taxRate: 8,
          taxAmount: 1.00,
          total: 13.50,
          paymentMethod: 'cash',
          paidAt: '2026-04-04T12:00:00.000Z'
        }
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-20260404-1234', null, restaurant);
      expect(receipt).not.toBeNull();
      expect(receipt.restaurantName).toBe('Taco Truck');
      expect(receipt.items).toHaveLength(2);
      expect(receipt.subtotal).toBe(12.50);
      expect(receipt.taxAmount).toBe(1.00);
      expect(receipt.total).toBe(13.50);
      expect(receipt.paymentMethod).toBe('cash');
      expect(receipt.tableNumbers).toEqual([]);
    });

    it('should build receipt data for card pre-pay POS order with table', () => {
      const orderData = {
        paidAtPOS: true,
        items: [{ name: 'Burger', price: 10.00, quantity: 1 }],
        paymentDetails: {
          subtotal: 10.00,
          taxRate: 8.5,
          taxAmount: 0.85,
          total: 10.85,
          paymentMethod: 'card',
          stripePaymentIntentId: 'pi_test',
          paidAt: '2026-04-04T12:00:00.000Z'
        }
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-20260404-5678', '3', restaurant);
      expect(receipt.paymentMethod).toBe('card');
      expect(receipt.tableNumbers).toEqual(['3']);
      expect(receipt.orderNumbers).toEqual(['ORD-20260404-5678']);
    });

    it('should build receipt data for terminal pre-pay POS order', () => {
      const orderData = {
        paidAtPOS: true,
        items: [{ name: 'Coffee', price: 4.00, quantity: 2 }],
        paymentDetails: {
          subtotal: 8.00,
          taxRate: 0,
          taxAmount: 0,
          total: 8.00,
          paymentMethod: 'terminal',
          paidAt: '2026-04-04T12:00:00.000Z'
        }
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-20260404-9999', null, restaurant);
      expect(receipt.paymentMethod).toBe('terminal');
      expect(receipt.total).toBe(8.00);
    });

    it('should return null for non-pre-pay orders (no receipt at POS)', () => {
      const orderData = {
        items: [{ name: 'Steak', price: 25.00, quantity: 1 }],
        total: 25.00
        // No paidAtPOS, no paymentDetails
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-20260404-0000', '5', restaurant);
      expect(receipt).toBeNull();
    });

    it('should return null for post-pay counter orders (no receipt at POS)', () => {
      const orderData = {
        paidAtPOS: false,
        items: [{ name: 'Wrap', price: 8.00, quantity: 1 }],
        total: 8.00
        // No paymentDetails
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-20260404-1111', null, restaurant);
      expect(receipt).toBeNull();
    });

    it('should handle missing restaurant data', () => {
      const orderData = {
        paidAtPOS: true,
        items: [{ name: 'Item', price: 5.00, quantity: 1 }],
        paymentDetails: {
          subtotal: 5.00, taxRate: 0, taxAmount: 0, total: 5.00,
          paymentMethod: 'cash', paidAt: '2026-04-04T12:00:00.000Z'
        }
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-TEST', null, null);
      expect(receipt.restaurantName).toBe('');
      expect(receipt.restaurantAddress).toBe('');
      expect(receipt.restaurantPhone).toBe('');
    });

    it('should include correct item mapping from order data', () => {
      const orderData = {
        paidAtPOS: true,
        items: [
          { id: 'a', name: 'Burrito', price: 9.99, originalPrice: 9.99, quantity: 2, subtotal: 19.98 },
          { id: 'b', name: 'Chips', price: 3.50, originalPrice: 3.50, quantity: 1, subtotal: 3.50 }
        ],
        paymentDetails: {
          subtotal: 23.48, taxRate: 8, taxAmount: 1.88, total: 25.36,
          paymentMethod: 'cash', paidAt: '2026-04-04T12:00:00.000Z'
        }
      };

      const receipt = buildPosReceiptData(orderData, 'ORD-MAP', null, restaurant);
      // Receipt items should only have name, quantity, price (no id, originalPrice, subtotal)
      expect(receipt.items[0]).toEqual({ name: 'Burrito', quantity: 2, price: 9.99 });
      expect(receipt.items[1]).toEqual({ name: 'Chips', quantity: 1, price: 3.50 });
    });
  });
});
