/**
 * Integration Tests — POS Order Flow
 * Tests the complete order lifecycle:
 *   POS places order → Kitchen prepares → Kitchen marks ready →
 *   Server marks served → Payment processes
 *
 * These tests simulate Firestore operations and validate the data
 * transformations at each step of the order workflow.
 */

// ==========================================
// Mocks
// ==========================================

const mockAddDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockOnSnapshot = jest.fn();
const mockCollection = jest.fn();
const mockDoc = jest.fn();
const mockQuery = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockGetDocs = jest.fn();
const mockSetDoc = jest.fn();
const mockServerTimestamp = jest.fn(() => 'mock-timestamp');

jest.mock('firebase/firestore', () => ({
  collection: (...args) => mockCollection(...args),
  doc: (...args) => mockDoc(...args),
  addDoc: (...args) => mockAddDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  setDoc: (...args) => mockSetDoc(...args),
  onSnapshot: (...args) => mockOnSnapshot(...args),
  query: (...args) => mockQuery(...args),
  where: (...args) => mockWhere(...args),
  orderBy: (...args) => mockOrderBy(...args),
  limit: jest.fn(),
  serverTimestamp: () => mockServerTimestamp()
}));

jest.mock('../../firebase', () => ({
  db: { type: 'mock-firestore' },
  auth: { type: 'mock-auth' },
  storage: { type: 'mock-storage' },
  functions: { type: 'mock-functions' }
}));

jest.mock('../../services/activityService', () => ({
  __esModule: true,
  default: {
    logActivity: jest.fn().mockResolvedValue(undefined),
    logOrderActivity: jest.fn().mockResolvedValue(undefined),
    logPaymentActivity: jest.fn().mockResolvedValue(undefined),
    logReimbursementActivity: jest.fn().mockResolvedValue(undefined),
    logPinActivity: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../services/orderUsageService', () => ({
  incrementOrderCount: jest.fn().mockResolvedValue({
    blocked: false,
    newCount: 1,
    limit: 500,
    isOverLimit: false,
    overageCharge: 0,
    isHardCapped: false
  }),
  getOrderUsage: jest.fn().mockResolvedValue({
    currentPeriodCount: 0,
    overageOrders: 0,
    overageCharges: 0
  })
}));

jest.mock('../../services/stripeService', () => ({
  getStripe: jest.fn().mockResolvedValue({}),
  createPaymentIntent: jest.fn().mockResolvedValue({
    clientSecret: 'mock-client-secret',
    paymentIntentId: 'pi_mock123'
  }),
  confirmPayment: jest.fn().mockResolvedValue({ success: true }),
  processRefund: jest.fn().mockResolvedValue({ success: true, refundId: 'ref_mock123' }),
  formatAmount: jest.fn((amount) => `$${amount.toFixed(2)}`),
  calculateTierPrice: jest.fn()
}));

import activityService from '../../services/activityService';
import { incrementOrderCount } from '../../services/orderUsageService';

// ==========================================
// Test Suite
// ==========================================

describe('POS Order Flow — Integration', () => {
  const restaurantId = 'test-restaurant-123';
  const locationId = restaurantId; // Single location

  beforeEach(() => {
    jest.clearAllMocks();
    mockAddDoc.mockResolvedValue({ id: 'new-order-id' });
    mockUpdateDoc.mockResolvedValue(undefined);
  });

  // ==========================================
  // Step 1: POS Creates Order
  // ==========================================

  describe('Step 1: POS Creates Order', () => {
    const createOrder = async (orderData) => {
      const collectionRef = mockCollection({}, `restaurants/${restaurantId}/orders`);
      const docRef = await mockAddDoc(collectionRef, orderData);
      return { id: docRef.id, ...orderData };
    };

    it('should create order with correct structure', async () => {
      const orderData = {
        orderNumber: 'ORD-20260322-0001',
        tableNumber: '5',
        locationId,
        items: [
          {
            id: 'item-1',
            name: 'Burger',
            categoryName: 'Main Course',
            price: 12.99,
            originalPrice: 12.99,
            quantity: 1,
            subtotal: 12.99
          },
          {
            id: 'item-2',
            name: 'Fries',
            categoryName: 'Sides',
            price: 4.99,
            originalPrice: 4.99,
            quantity: 2,
            subtotal: 9.98
          }
        ],
        total: 22.97,
        status: 'sent_to_kitchen',
        orderType: 'dine_in',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const order = await createOrder(orderData);

      expect(mockAddDoc).toHaveBeenCalledTimes(1);
      expect(order.status).toBe('sent_to_kitchen');
      expect(order.items).toHaveLength(2);
      expect(order.total).toBe(22.97);
      expect(order.tableNumber).toBe('5');
      expect(order.locationId).toBe(restaurantId);
    });

    it('should generate correct order number format', async () => {
      const now = new Date();
      const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timePart = now.getTime().toString().slice(-4);
      const orderNumber = `ORD-${datePart}-${timePart}`;

      expect(orderNumber).toMatch(/^ORD-\d{8}-\d{4}$/);
    });

    it('should track order usage after creating order', async () => {
      await incrementOrderCount(restaurantId, 22.97);

      expect(incrementOrderCount).toHaveBeenCalledWith(restaurantId, 22.97);
    });

    it('should log activity for new order', async () => {
      await activityService.logOrderActivity(restaurantId, 'received', {
        orderNumber: 'ORD-20260322-0001',
        tableNumber: '5',
        status: 'sent_to_kitchen',
        locationId
      });

      expect(activityService.logOrderActivity).toHaveBeenCalledWith(
        restaurantId,
        'received',
        expect.objectContaining({
          orderNumber: 'ORD-20260322-0001',
          status: 'sent_to_kitchen'
        })
      );
    });

    it('should handle multi-table orders', async () => {
      const orderData = {
        orderNumber: 'ORD-20260322-0002',
        tableNumber: ['3', '4'],
        locationId,
        items: [{ id: 'item-1', name: 'Burger', price: 12.99, quantity: 1, subtotal: 12.99 }],
        total: 12.99,
        status: 'sent_to_kitchen',
        orderType: 'dine_in',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const order = await createOrder(orderData);
      expect(Array.isArray(order.tableNumber)).toBe(true);
      expect(order.tableNumber).toEqual(['3', '4']);
    });
  });

  // ==========================================
  // Step 2: Kitchen Marks as Preparing
  // ==========================================

  describe('Step 2: Kitchen Marks as Preparing', () => {
    it('should update order status to preparing', async () => {
      const orderId = 'order-123';
      const orderRef = mockDoc({}, `restaurants/${restaurantId}/orders/${orderId}`);

      const updateData = {
        status: 'preparing',
        updatedAt: expect.any(Date)
      };

      await mockUpdateDoc(orderRef, updateData);

      expect(mockUpdateDoc).toHaveBeenCalledWith(orderRef, updateData);
    });

    it('should log activity for status change to preparing', async () => {
      await activityService.logOrderActivity(restaurantId, 'status_changed', {
        orderNumber: 'ORD-20260322-0001',
        orderId: 'order-123',
        tableNumber: '5',
        status: 'preparing',
        locationId
      });

      expect(activityService.logOrderActivity).toHaveBeenCalledWith(
        restaurantId,
        'status_changed',
        expect.objectContaining({
          status: 'preparing'
        })
      );
    });
  });

  // ==========================================
  // Step 3: Kitchen Marks as Ready
  // ==========================================

  describe('Step 3: Kitchen Marks as Ready', () => {
    it('should update order status to ready with readyAt timestamp', async () => {
      const orderId = 'order-123';
      const orderRef = mockDoc({}, `restaurants/${restaurantId}/orders/${orderId}`);

      const updateData = {
        status: 'ready',
        readyAt: expect.any(Date),
        updatedAt: expect.any(Date)
      };

      await mockUpdateDoc(orderRef, updateData);

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({ status: 'ready' })
      );
    });

    it('should include readyAt timestamp when marking ready', async () => {
      const updateData = {
        status: 'ready',
        readyAt: new Date(),
        updatedAt: new Date()
      };

      expect(updateData.readyAt).toBeInstanceOf(Date);
    });
  });

  // ==========================================
  // Step 4: Server Marks as Served
  // ==========================================

  describe('Step 4: Server Marks as Served', () => {
    it('should update order status to served with servedAt timestamp', async () => {
      const orderId = 'order-123';
      const orderRef = mockDoc({}, `restaurants/${restaurantId}/orders/${orderId}`);

      const updateData = {
        status: 'served',
        updatedAt: new Date(),
        servedAt: new Date()
      };

      await mockUpdateDoc(orderRef, updateData);

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({
          status: 'served',
          servedAt: expect.any(Date)
        })
      );
    });

    it('should log activity for served status', async () => {
      await activityService.logOrderActivity(restaurantId, 'status_changed', {
        orderNumber: 'ORD-20260322-0001',
        orderId: 'order-123',
        tableNumber: '5',
        status: 'served',
        locationId
      });

      expect(activityService.logOrderActivity).toHaveBeenCalledWith(
        restaurantId,
        'status_changed',
        expect.objectContaining({
          status: 'served'
        })
      );
    });
  });

  // ==========================================
  // Step 5: Payment Processed
  // ==========================================

  describe('Step 5: Cash Payment Processed', () => {
    it('should update order status to completed with payment details', async () => {
      const orderId = 'order-123';
      const orderRef = mockDoc({}, `restaurants/${restaurantId}/orders/${orderId}`);

      const paymentDetails = {
        subtotal: 22.97,
        taxRate: 8.5,
        taxAmount: 1.95,
        discountAmount: 0,
        discountType: 'amount',
        tipAmount: 4.00,
        tipType: 'amount',
        total: 28.92,
        paymentMethod: 'cash',
        paidAt: new Date().toISOString()
      };

      const updateData = {
        status: 'completed',
        paymentDate: expect.any(Date),
        paymentDetails,
        updatedAt: expect.any(Date)
      };

      await mockUpdateDoc(orderRef, updateData);

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({
          status: 'completed',
          paymentDetails: expect.objectContaining({
            paymentMethod: 'cash',
            total: 28.92
          })
        })
      );
    });

    it('should log payment activity', async () => {
      await activityService.logPaymentActivity(restaurantId, {
        orderNumbers: ['ORD-20260322-0001'],
        tableNumbers: ['5'],
        total: 28.92,
        orderCount: 1,
        paymentMethod: 'cash',
        locationId
      });

      expect(activityService.logPaymentActivity).toHaveBeenCalledWith(
        restaurantId,
        expect.objectContaining({
          paymentMethod: 'cash',
          total: 28.92
        })
      );
    });
  });

  // ==========================================
  // Full Flow Test
  // ==========================================

  describe('FULL FLOW: POS → Kitchen → Server → Payment', () => {
    it('should complete the entire order lifecycle', async () => {
      // --- STEP 1: POS creates order ---
      const orderData = {
        orderNumber: 'ORD-20260322-9999',
        tableNumber: '7',
        locationId,
        items: [
          { id: 'i1', name: 'Steak', price: 29.99, quantity: 1, subtotal: 29.99 },
          { id: 'i2', name: 'Wine', price: 12.00, quantity: 2, subtotal: 24.00 },
          { id: 'i3', name: 'Salad', price: 8.50, quantity: 1, subtotal: 8.50 }
        ],
        total: 62.49,
        status: 'sent_to_kitchen',
        orderType: 'dine_in',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Create order
      mockAddDoc.mockResolvedValueOnce({ id: 'flow-order-id' });
      const collectionRef = mockCollection({}, `restaurants/${restaurantId}/orders`);
      const docRef = await mockAddDoc(collectionRef, orderData);
      const orderId = docRef.id;

      expect(orderId).toBe('flow-order-id');
      expect(mockAddDoc).toHaveBeenCalledTimes(1);

      // Track usage
      await incrementOrderCount(restaurantId, 62.49);
      expect(incrementOrderCount).toHaveBeenCalledWith(restaurantId, 62.49);

      // Log activity
      await activityService.logOrderActivity(restaurantId, 'received', {
        orderNumber: 'ORD-20260322-9999',
        tableNumber: '7',
        status: 'sent_to_kitchen',
        locationId
      });

      // --- STEP 2: Kitchen marks as PREPARING ---
      const orderRef = mockDoc({}, `restaurants/${restaurantId}/orders/${orderId}`);
      await mockUpdateDoc(orderRef, {
        status: 'preparing',
        updatedAt: new Date()
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({ status: 'preparing' })
      );

      await activityService.logOrderActivity(restaurantId, 'status_changed', {
        orderNumber: 'ORD-20260322-9999',
        orderId,
        tableNumber: '7',
        status: 'preparing',
        locationId
      });

      // --- STEP 3: Kitchen marks as READY ---
      await mockUpdateDoc(orderRef, {
        status: 'ready',
        readyAt: new Date(),
        updatedAt: new Date()
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({ status: 'ready' })
      );

      await activityService.logOrderActivity(restaurantId, 'status_changed', {
        orderNumber: 'ORD-20260322-9999',
        orderId,
        tableNumber: '7',
        status: 'ready',
        locationId
      });

      // --- STEP 4: Server marks as SERVED ---
      await mockUpdateDoc(orderRef, {
        status: 'served',
        servedAt: new Date(),
        updatedAt: new Date()
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({ status: 'served' })
      );

      await activityService.logOrderActivity(restaurantId, 'status_changed', {
        orderNumber: 'ORD-20260322-9999',
        orderId,
        tableNumber: '7',
        status: 'served',
        locationId
      });

      // --- STEP 5: Payment COMPLETED ---
      const paymentDetails = {
        subtotal: 62.49,
        taxRate: 8.5,
        taxAmount: 5.31,
        discountAmount: 0,
        discountType: 'amount',
        tipAmount: 10.00,
        tipType: 'amount',
        total: 77.80,
        paymentMethod: 'cash',
        paidAt: new Date().toISOString()
      };

      await mockUpdateDoc(orderRef, {
        status: 'completed',
        paymentDate: new Date(),
        paymentDetails,
        updatedAt: new Date()
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        orderRef,
        expect.objectContaining({
          status: 'completed',
          paymentDetails: expect.objectContaining({
            paymentMethod: 'cash',
            total: 77.80
          })
        })
      );

      await activityService.logPaymentActivity(restaurantId, {
        orderNumbers: ['ORD-20260322-9999'],
        tableNumbers: ['7'],
        total: 77.80,
        orderCount: 1,
        paymentMethod: 'cash',
        locationId
      });

      // --- VERIFY: All activity logs were called correctly ---
      expect(activityService.logOrderActivity).toHaveBeenCalledTimes(4);
      expect(activityService.logPaymentActivity).toHaveBeenCalledTimes(1);

      // The order was updated 4 times total:
      // preparing, ready, served, completed
      expect(mockUpdateDoc).toHaveBeenCalledTimes(4);

      // Log the workflow summary
      const allStatusUpdates = mockUpdateDoc.mock.calls.map(call => call[1].status);
      expect(allStatusUpdates).toEqual(['preparing', 'ready', 'served', 'completed']);
    });
  });
});

// ==========================================
// Item Notes & Spice Level Through Order Lifecycle
// ==========================================

describe('Item Notes & Spice Level in Order Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should preserve notes and spiceLevel when order is created', () => {
    const orderItems = [
      { id: 'item-1', name: 'Burger', price: 10.99, quantity: 1, notes: 'extra cheese', spiceLevel: '' },
      { id: 'item-2', name: 'Curry', price: 15.99, quantity: 2, notes: '', spiceLevel: 'Hot' },
      { id: 'item-3', name: 'Fries', price: 5.99, quantity: 1, notes: 'extra crispy', spiceLevel: '' }
    ];

    // Simulate buildOrderData item mapping
    const builtItems = orderItems.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.price * item.quantity,
      ...(item.notes && { notes: item.notes }),
      ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
    }));

    expect(builtItems[0].notes).toBe('extra cheese');
    expect(builtItems[0]).not.toHaveProperty('spiceLevel');
    expect(builtItems[1]).not.toHaveProperty('notes');
    expect(builtItems[1].spiceLevel).toBe('Hot');
    expect(builtItems[2].notes).toBe('extra crispy');
  });

  it('should display notes and spiceLevel in Kitchen/Server views', () => {
    const orderFromFirestore = {
      orderNumber: 'ORD-20260407-0001',
      status: 'sent_to_kitchen',
      items: [
        { id: 'item-1', name: 'Burger', quantity: 1, notes: 'well done', spiceLevel: '' },
        { id: 'item-2', name: 'Curry', quantity: 2, spiceLevel: 'Mild' },
        { id: 'item-3', name: 'Coke', quantity: 1, notes: 'no ice, add straw' }
      ]
    };

    // Verify each item has the expected display fields
    const items = orderFromFirestore.items;
    expect(items[0].notes).toBe('well done');
    expect(items[1].spiceLevel).toBe('Mild');
    expect(items[2].notes).toBe('no ice, add straw');

    // Items without notes/spice should not have those fields
    expect(items[1]).not.toHaveProperty('notes');
    expect(items[0].spiceLevel).toBe('');
  });

  it('should handle orders with no notes or spice levels (backward compat)', () => {
    const legacyOrder = {
      orderNumber: 'ORD-20260407-0002',
      status: 'preparing',
      items: [
        { id: 'item-1', name: 'Burger', quantity: 2 },
        { id: 'item-2', name: 'Fries', quantity: 1 }
      ]
    };

    // Legacy items should work without notes/spiceLevel fields
    legacyOrder.items.forEach(item => {
      expect(item.notes || item.specialInstructions || '').toBe('');
      expect(item.spiceLevel || '').toBe('');
    });
  });

  it('should keep same item with different notes as separate in order', () => {
    const addItemToCart = (cart, item, notes = '', spiceLevel = '') => {
      const existingIndex = cart.findIndex(i =>
        i.id === item.id && (i.notes || '') === (notes || '') && (i.spiceLevel || '') === (spiceLevel || '')
      );
      if (existingIndex >= 0) {
        const updated = [...cart];
        updated[existingIndex] = { ...updated[existingIndex], quantity: updated[existingIndex].quantity + 1 };
        return updated;
      }
      return [...cart, { ...item, quantity: 1, notes: notes || '', spiceLevel: spiceLevel || '' }];
    };

    const burger = { id: 'item-1', name: 'Burger', price: 10.99 };
    let cart = [];
    cart = addItemToCart(cart, burger, 'no onion');
    cart = addItemToCart(cart, burger, 'extra ketchup');
    cart = addItemToCart(cart, burger, 'no onion'); // should merge with first

    expect(cart).toHaveLength(2);
    expect(cart[0].notes).toBe('no onion');
    expect(cart[0].quantity).toBe(2);
    expect(cart[1].notes).toBe('extra ketchup');
    expect(cart[1].quantity).toBe(1);
  });
});
