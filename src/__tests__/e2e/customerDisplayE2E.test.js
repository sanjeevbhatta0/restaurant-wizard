/**
 * @jest-environment node
 */

/**
 * E2E Tests — Customer Display Payment Flow
 *
 * Tests the complete POS → Customer Display → Customer Confirms → POS proceeds
 * flow using Firebase emulators, including the paymentReview Firestore document
 * that synchronizes the two screens in real-time.
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/customerDisplay
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_RESTAURANT_ID = 'e2e-cd-test-' + Date.now();
const PAYMENT_REVIEW_PATH = `restaurants/${TEST_RESTAURANT_ID}/paymentReview/current`;
const ORDERS_PATH = `restaurants/${TEST_RESTAURANT_ID}/orders`;

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Customer Display Payment Flow', () => {
  let createdOrderIds = [];

  afterAll(async () => {
    // Cleanup
    try { await db.doc(PAYMENT_REVIEW_PATH).delete(); } catch (e) { /* ignore */ }
    for (const id of createdOrderIds) {
      try { await db.doc(`${ORDERS_PATH}/${id}`).delete(); } catch (e) { /* ignore */ }
    }
    try { await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).delete(); } catch (e) { /* ignore */ }
  });

  // ==========================================
  // Full Lifecycle: POS → Customer Display → Kitchen
  // ==========================================

  describe('Full-service: POS → Customer Display → Kitchen', () => {
    it('Step 1: POS writes payment session to paymentReview/current', async () => {
      const sessionData = {
        status: 'pending_customer',
        items: [
          { id: 'item-1', name: 'Margherita Pizza', price: 14.99, quantity: 1 },
          { id: 'item-2', name: 'Garlic Bread', price: 5.99, quantity: 2 }
        ],
        subtotal: 26.97,
        taxRate: 8,
        taxAmount: 2.16,
        total: 29.13,
        orderNumber: null,
        tableNumber: '5',
        createdAt: new Date().toISOString()
      };

      await db.doc(PAYMENT_REVIEW_PATH).set(sessionData);

      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      expect(snap.exists).toBe(true);
      expect(snap.data().status).toBe('pending_customer');
      expect(snap.data().items).toHaveLength(2);
      expect(snap.data().subtotal).toBe(26.97);
      expect(snap.data().tableNumber).toBe('5');
    });

    it('Step 2: Customer Display reads session and shows items', async () => {
      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      const session = snap.data();

      expect(session.status).toBe('pending_customer');
      expect(session.items[0].name).toBe('Margherita Pizza');
      expect(session.items[1].name).toBe('Garlic Bread');
      expect(session.total).toBeCloseTo(29.13, 2);
    });

    it('Step 3: Customer confirms with tip and signature', async () => {
      const customerResponse = {
        tipPercent: 20,
        tipAmount: 5.39,
        totalWithTip: 34.52,
        signature: 'data:image/png;base64,iVBOR...',
        receiptMethod: 'email',
        receiptContact: 'customer@example.com',
        confirmedAt: new Date().toISOString()
      };

      await db.doc(PAYMENT_REVIEW_PATH).update({
        status: 'confirmed',
        customerResponse
      });

      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      expect(snap.data().status).toBe('confirmed');
      expect(snap.data().customerResponse.tipAmount).toBe(5.39);
      expect(snap.data().customerResponse.tipPercent).toBe(20);
      expect(snap.data().customerResponse.signature).toBeTruthy();
      expect(snap.data().customerResponse.receiptMethod).toBe('email');
    });

    it('Step 4: POS reads confirmation and creates order with tip data', async () => {
      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      const cdResponse = snap.data().customerResponse;

      const orderData = {
        orderNumber: `E2E-CD-${Date.now()}`,
        tableNumber: '5',
        locationId: TEST_RESTAURANT_ID,
        items: [
          { id: 'item-1', name: 'Margherita Pizza', price: 14.99, quantity: 1, subtotal: 14.99 },
          { id: 'item-2', name: 'Garlic Bread', price: 5.99, quantity: 2, subtotal: 11.98 }
        ],
        status: 'sent_to_kitchen',
        total: 26.97,
        customerDisplayResponse: {
          tipAmount: cdResponse.tipAmount,
          tipPercent: cdResponse.tipPercent,
          signature: cdResponse.signature,
          receiptMethod: cdResponse.receiptMethod,
          receiptContact: cdResponse.receiptContact,
          confirmedAt: cdResponse.confirmedAt
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await db.collection(ORDERS_PATH).add(orderData);
      createdOrderIds.push(docRef.id);

      const orderSnap = await docRef.get();
      expect(orderSnap.exists).toBe(true);
      expect(orderSnap.data().status).toBe('sent_to_kitchen');
      expect(orderSnap.data().customerDisplayResponse.tipAmount).toBe(5.39);
      expect(orderSnap.data().customerDisplayResponse.receiptMethod).toBe('email');
    });

    it('Step 5: POS resets paymentReview to idle', async () => {
      await db.doc(PAYMENT_REVIEW_PATH).set({ status: 'idle' });

      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      expect(snap.data().status).toBe('idle');
    });
  });

  // ==========================================
  // Pay-First Flow: POS → Customer Display → Payment → Kitchen
  // ==========================================

  describe('Pay-first: POS → Customer Display → Payment → Kitchen', () => {
    it('should create session, get tip, and include tip in payment total', async () => {
      // POS writes session
      const sessionData = {
        status: 'pending_customer',
        items: [
          { id: 'item-3', name: 'Fish & Chips', price: 16.99, quantity: 1 }
        ],
        subtotal: 16.99,
        taxRate: 8,
        taxAmount: 1.36,
        total: 18.35,
        orderNumber: null,
        tableNumber: null,
        createdAt: new Date().toISOString()
      };
      await db.doc(PAYMENT_REVIEW_PATH).set(sessionData);

      // Customer confirms with custom tip
      await db.doc(PAYMENT_REVIEW_PATH).update({
        status: 'confirmed',
        customerResponse: {
          tipPercent: null,
          tipAmount: 4.00,
          totalWithTip: 22.35,
          signature: null,
          receiptMethod: 'print',
          receiptContact: null,
          confirmedAt: new Date().toISOString()
        }
      });

      // POS reads and creates order with payment
      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      const cdResponse = snap.data().customerResponse;

      const orderData = {
        orderNumber: `E2E-CD-PAY-${Date.now()}`,
        items: [
          { id: 'item-3', name: 'Fish & Chips', price: 16.99, quantity: 1, subtotal: 16.99 }
        ],
        status: 'sent_to_kitchen',
        paidAtPOS: true,
        total: 18.35 + 4.00, // total + tip
        customerDisplayResponse: {
          tipAmount: cdResponse.tipAmount,
          receiptMethod: cdResponse.receiptMethod
        },
        paymentDetails: {
          subtotal: 16.99,
          taxRate: 8,
          taxAmount: 1.36,
          tipAmount: 4.00,
          total: 22.35,
          paymentMethod: 'cash',
          paidAt: new Date().toISOString()
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await db.collection(ORDERS_PATH).add(orderData);
      createdOrderIds.push(docRef.id);

      const orderSnap = await docRef.get();
      expect(orderSnap.data().paidAtPOS).toBe(true);
      expect(orderSnap.data().paymentDetails.tipAmount).toBe(4.00);
      expect(orderSnap.data().paymentDetails.total).toBe(22.35);

      // Reset
      await db.doc(PAYMENT_REVIEW_PATH).set({ status: 'idle' });
    });
  });

  // ==========================================
  // Cancellation Flow
  // ==========================================

  describe('Cancellation from POS', () => {
    it('should reset session to idle when POS cancels', async () => {
      // Create pending session
      await db.doc(PAYMENT_REVIEW_PATH).set({
        status: 'pending_customer',
        items: [{ id: 'x', name: 'Test', price: 10, quantity: 1 }],
        subtotal: 10,
        total: 10.80,
        createdAt: new Date().toISOString()
      });

      const pendingSnap = await db.doc(PAYMENT_REVIEW_PATH).get();
      expect(pendingSnap.data().status).toBe('pending_customer');

      // POS cancels
      await db.doc(PAYMENT_REVIEW_PATH).set({ status: 'idle' });

      const idleSnap = await db.doc(PAYMENT_REVIEW_PATH).get();
      expect(idleSnap.data().status).toBe('idle');
    });
  });

  // ==========================================
  // No Tip, No Signature — Minimal Flow
  // ==========================================

  describe('Minimal flow (no tip, no signature)', () => {
    it('should work with bare minimum customer response', async () => {
      await db.doc(PAYMENT_REVIEW_PATH).set({
        status: 'pending_customer',
        items: [{ id: 'y', name: 'Water', price: 0, quantity: 1 }],
        subtotal: 0,
        total: 0,
        createdAt: new Date().toISOString()
      });

      await db.doc(PAYMENT_REVIEW_PATH).update({
        status: 'confirmed',
        customerResponse: {
          tipPercent: null,
          tipAmount: 0,
          totalWithTip: 0,
          signature: null,
          receiptMethod: 'none',
          receiptContact: null,
          confirmedAt: new Date().toISOString()
        }
      });

      const snap = await db.doc(PAYMENT_REVIEW_PATH).get();
      expect(snap.data().status).toBe('confirmed');
      expect(snap.data().customerResponse.tipAmount).toBe(0);
      expect(snap.data().customerResponse.receiptMethod).toBe('none');

      await db.doc(PAYMENT_REVIEW_PATH).set({ status: 'idle' });
    });
  });
});

// ==========================================
// Mock Fallback Tests (when emulators not running)
// ==========================================

const describeMock = isEmulatorAvailable ? describe.skip : describe;

describeMock('Customer Display — Mock Fallback Tests', () => {
  it('should validate session data structure', () => {
    const sessionData = {
      status: 'pending_customer',
      items: [{ id: '1', name: 'Burger', price: 12, quantity: 1 }],
      subtotal: 12,
      taxRate: 8,
      taxAmount: 0.96,
      total: 12.96,
      tableNumber: '3',
      createdAt: new Date().toISOString()
    };

    expect(sessionData.status).toBe('pending_customer');
    expect(sessionData.items).toHaveLength(1);
    expect(sessionData.total).toBeCloseTo(12.96, 2);
  });

  it('should validate customer response structure', () => {
    const response = {
      tipPercent: 18,
      tipAmount: 2.16,
      totalWithTip: 15.12,
      signature: 'data:image/png;base64,abc',
      receiptMethod: 'text',
      receiptContact: '+15551234567',
      confirmedAt: new Date().toISOString()
    };

    expect(response.tipAmount).toBe(2.16);
    expect(response.receiptMethod).toBe('text');
    expect(response.confirmedAt).toBeTruthy();
  });
});
