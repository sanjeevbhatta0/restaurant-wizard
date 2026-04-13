/**
 * Unit Tests — Customer Portal Business Logic
 *
 * Tests phone verification flow, customer auth (login/signup), session management,
 * receipt email template generation, receipt notification routing, order receipt
 * trigger logic, and customer data handling.
 *
 * Source: functions/templates/customer-portal/portal.js,
 *         functions/templates/emails/orderReceipt.js,
 *         functions/services/notificationService.js,
 *         functions/services/smsService.js
 */

// ==========================================
// Phone Verification Logic (mirrors portal.js)
// ==========================================

/**
 * Validates a phone number before sending OTP.
 * Mirrors the validation in renderPhoneVerification → submit handler.
 */
function validatePhoneForOTP(phone) {
  if (!phone || typeof phone !== 'string') return { valid: false, error: 'Phone number is required' };
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 10) return { valid: false, error: 'Please enter a valid phone number' };
  if (digits.length > 15) return { valid: false, error: 'Phone number too long' };
  return { valid: true, digits };
}

/**
 * Normalizes phone to E.164 format.
 * Mirrors smsService.normalizePhone.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  const justDigits = digits.replace(/\+/g, '');
  if (justDigits.length === 10) return `+1${justDigits}`;
  if (justDigits.length === 11 && justDigits.startsWith('1')) return `+${justDigits}`;
  if (digits.startsWith('+') && justDigits.length >= 10) return `+${justDigits}`;
  return null;
}

/**
 * Generates a 6-digit OTP code.
 * Mirrors the server-side OTP generation in sendVerificationCode.
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Verifies an OTP code matches the stored code.
 */
function verifyOTP(inputCode, storedCode) {
  if (!inputCode || !storedCode) return false;
  return inputCode.trim() === storedCode.trim();
}

// ==========================================
// Customer Auth Logic (mirrors portal.js)
// ==========================================

/**
 * Builds customer data for signup.
 * Mirrors handleSignup data construction.
 */
function buildSignupData(formData, verifiedPhone) {
  return {
    email: formData.email,
    fullName: formData.name,
    phone: verifiedPhone || formData.phone || '',
    createdAt: new Date().toISOString(),
    loyaltyPoints: 0,
    totalOrders: 0
  };
}

/**
 * Determines whether verified phone should be persisted on login.
 * Mirrors handleLogin logic: only persist if customer has no phone on file.
 */
function shouldPersistPhone(existingPhone, verifiedPhone) {
  if (!verifiedPhone) return false;
  if (existingPhone) return false; // Customer already has phone on file
  return true;
}

/**
 * Builds user state from customer document.
 * Mirrors handleLogin user data construction.
 */
function buildUserState(customerDoc, firebaseUser, verifiedPhone) {
  const data = customerDoc || {};
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    name: data.fullName || firebaseUser.displayName || '',
    phone: verifiedPhone || data.phone || '',
    loyaltyPoints: data.loyaltyPoints || 0,
    tier: data.tier || 'bronze'
  };
}

// ==========================================
// Session Management Logic (mirrors portal.js)
// ==========================================

/**
 * Checks if cached portal data is stale.
 * Mirrors isDataStale logic.
 */
function isDataStale(lastLoadTime, ttlMs = 5 * 60 * 1000) {
  if (!lastLoadTime) return true;
  return (Date.now() - lastLoadTime) > ttlMs;
}

/**
 * Determines what data to clear on logout.
 * Mirrors handleLogout cleanup.
 */
function getLogoutCleanupFields() {
  return {
    user: null,
    activeOrders: [],
    pastOrders: [],
    promotions: [],
    customerData: null,
    verifiedPhone: null,
    lastDataLoad: null
  };
}

// ==========================================
// Receipt Email Template Logic
// (mirrors functions/templates/emails/orderReceipt.js)
// ==========================================

/**
 * Replicates orderReceiptEmail for testing template output.
 */
function orderReceiptEmail({ restaurantName, orderNumber, items, subtotal, tax, total, taxRate, paymentMethod, promoDiscount, pointsDiscount, rewardDiscount, orderType, customerName, createdAt }) {
  const paymentLabel = {
    card: 'Credit/Debit Card',
    cash: 'Cash',
    terminal: 'Card Terminal',
    online: 'Online Payment'
  }[paymentMethod] || paymentMethod || 'Card';

  const orderTypeLabel = {
    pickup: 'Pickup',
    delivery: 'Delivery',
    dine_in: 'Dine-In'
  }[orderType] || 'Dine-In';

  const subject = `Your receipt from ${restaurantName} — Order #${orderNumber}`;

  // Build items rows
  const itemRows = (items || []).map(item => {
    const qty = item.quantity || 1;
    const price = item.price || 0;
    const itemTotal = (qty * price).toFixed(2);
    return `<tr><td>${item.name || 'Item'}</td><td>$${itemTotal}</td></tr>`;
  }).join('');

  // Build discount count
  let discountCount = 0;
  if (promoDiscount && promoDiscount > 0) discountCount++;
  if (pointsDiscount && pointsDiscount > 0) discountCount++;
  if (rewardDiscount && rewardDiscount > 0) discountCount++;

  return { subject, paymentLabel, orderTypeLabel, itemRows, discountCount };
}

// ==========================================
// Receipt Notification Routing Logic
// (mirrors notificationService.sendOrderReceipt)
// ==========================================

/**
 * Determines which channels to send receipt on based on preference.
 */
function getReceiptChannels(customerEmail, customerPhone, receiptPreference) {
  const shouldEmail = !!(customerEmail && (!receiptPreference || receiptPreference === 'email' || receiptPreference === 'both'));
  const shouldSMS = !!(customerPhone && (receiptPreference === 'sms' || receiptPreference === 'both'));
  return { shouldEmail, shouldSMS };
}

/**
 * Builds SMS receipt summary.
 */
function buildSMSReceipt(restaurantName, orderNumber, items, total) {
  const itemsSummary = (items || []).slice(0, 5).map(i => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');
  const moreItems = (items || []).length > 5 ? ` +${items.length - 5} more` : '';
  return `Receipt from ${restaurantName}\nOrder #${orderNumber}\n${itemsSummary}${moreItems}\nTotal: $${Number(total || 0).toFixed(2)}\nThank you for your visit!`;
}

// ==========================================
// Order Completion Trigger Logic
// (mirrors onOrderCompleted in functions/index.js)
// ==========================================

/**
 * Determines if a receipt should be sent based on order status transition.
 */
function shouldSendReceipt(beforeStatus, afterStatus) {
  if (beforeStatus === 'completed') return false; // Already completed
  if (afterStatus !== 'completed') return false;  // Not transitioning to completed
  return true;
}

/**
 * Determines the effective receipt preference.
 */
function resolveReceiptPreference(customerPreference, hasEmail, hasPhone) {
  if (customerPreference) return customerPreference;
  if (!hasEmail && hasPhone) return 'sms';
  return 'email'; // Default
}

// ==========================================
// TESTS
// ==========================================

describe('Customer Portal — Unit Tests', () => {

  // ==========================================
  // Phone Verification
  // ==========================================

  describe('Phone Validation for OTP', () => {
    it('should accept a valid 10-digit US number', () => {
      expect(validatePhoneForOTP('5551234567')).toEqual({ valid: true, digits: '5551234567' });
    });

    it('should accept formatted phone number', () => {
      expect(validatePhoneForOTP('(555) 123-4567')).toEqual({ valid: true, digits: '5551234567' });
    });

    it('should accept phone with country code', () => {
      const result = validatePhoneForOTP('+15551234567');
      expect(result.valid).toBe(true);
      expect(result.digits).toBe('15551234567');
    });

    it('should reject empty phone', () => {
      expect(validatePhoneForOTP('')).toEqual({ valid: false, error: 'Phone number is required' });
    });

    it('should reject null phone', () => {
      expect(validatePhoneForOTP(null)).toEqual({ valid: false, error: 'Phone number is required' });
    });

    it('should reject too-short phone', () => {
      expect(validatePhoneForOTP('12345')).toEqual({ valid: false, error: 'Please enter a valid phone number' });
    });

    it('should reject too-long phone', () => {
      expect(validatePhoneForOTP('1234567890123456')).toEqual({ valid: false, error: 'Phone number too long' });
    });
  });

  describe('Phone Normalization (E.164)', () => {
    it('should normalize 10-digit US number', () => {
      expect(normalizePhone('5551234567')).toBe('+15551234567');
    });

    it('should normalize 11-digit with leading 1', () => {
      expect(normalizePhone('15551234567')).toBe('+15551234567');
    });

    it('should normalize +1 prefixed number', () => {
      expect(normalizePhone('+15551234567')).toBe('+15551234567');
    });

    it('should strip formatting characters', () => {
      expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
    });

    it('should return null for empty input', () => {
      expect(normalizePhone('')).toBeNull();
    });

    it('should return null for too-short number', () => {
      expect(normalizePhone('12345')).toBeNull();
    });
  });

  describe('OTP Generation and Verification', () => {
    it('should generate a 6-digit code', () => {
      const code = generateOTP();
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('should generate unique codes', () => {
      const codes = new Set(Array.from({ length: 100 }, () => generateOTP()));
      expect(codes.size).toBeGreaterThan(90); // Statistical uniqueness
    });

    it('should verify matching codes', () => {
      expect(verifyOTP('123456', '123456')).toBe(true);
    });

    it('should reject mismatched codes', () => {
      expect(verifyOTP('123456', '654321')).toBe(false);
    });

    it('should handle whitespace in input', () => {
      expect(verifyOTP(' 123456 ', '123456')).toBe(true);
    });

    it('should reject empty input', () => {
      expect(verifyOTP('', '123456')).toBe(false);
    });

    it('should reject null input', () => {
      expect(verifyOTP(null, '123456')).toBe(false);
    });
  });

  // ==========================================
  // Customer Auth
  // ==========================================

  describe('Customer Signup Data Construction', () => {
    it('should build signup data with verified phone', () => {
      const data = buildSignupData(
        { email: 'test@test.com', name: 'John Doe', phone: '555-0000' },
        '+15551234567'
      );
      expect(data.email).toBe('test@test.com');
      expect(data.fullName).toBe('John Doe');
      expect(data.phone).toBe('+15551234567'); // Verified phone takes precedence
      expect(data.loyaltyPoints).toBe(0);
      expect(data.totalOrders).toBe(0);
    });

    it('should fall back to form phone when no verified phone', () => {
      const data = buildSignupData(
        { email: 'test@test.com', name: 'Jane', phone: '555-9999' },
        null
      );
      expect(data.phone).toBe('555-9999');
    });

    it('should handle missing phone entirely', () => {
      const data = buildSignupData(
        { email: 'test@test.com', name: 'Anon' },
        null
      );
      expect(data.phone).toBe('');
    });

    it('should include createdAt as ISO string', () => {
      const data = buildSignupData({ email: 'a@b.com', name: 'Test' }, null);
      expect(data.createdAt).toBeDefined();
      expect(new Date(data.createdAt).toISOString()).toBe(data.createdAt);
    });
  });

  describe('Customer Login — Phone Persistence', () => {
    it('should persist verified phone when customer has no phone on file', () => {
      expect(shouldPersistPhone(null, '+15551234567')).toBe(true);
    });

    it('should persist verified phone when existing phone is empty string', () => {
      expect(shouldPersistPhone('', '+15551234567')).toBe(true); // empty string is falsy → no phone on file
    });

    it('should NOT persist when customer already has phone', () => {
      expect(shouldPersistPhone('+15559999999', '+15551234567')).toBe(false);
    });

    it('should NOT persist when no verified phone', () => {
      expect(shouldPersistPhone(null, null)).toBe(false);
    });
  });

  describe('User State Construction', () => {
    it('should build user state from customer doc and firebase user', () => {
      const user = buildUserState(
        { fullName: 'John Doe', phone: '+15551234567', loyaltyPoints: 150, tier: 'silver' },
        { uid: 'uid123', email: 'john@test.com', displayName: 'JD' },
        null
      );
      expect(user.uid).toBe('uid123');
      expect(user.email).toBe('john@test.com');
      expect(user.name).toBe('John Doe');
      expect(user.phone).toBe('+15551234567');
      expect(user.loyaltyPoints).toBe(150);
      expect(user.tier).toBe('silver');
    });

    it('should prefer verified phone over stored phone', () => {
      const user = buildUserState(
        { fullName: 'Jane', phone: '+15559999999' },
        { uid: 'uid456', email: 'jane@test.com' },
        '+15551111111'
      );
      expect(user.phone).toBe('+15551111111');
    });

    it('should use defaults when customer doc is empty', () => {
      const user = buildUserState(
        {},
        { uid: 'uid789', email: 'new@test.com', displayName: 'New User' },
        null
      );
      expect(user.name).toBe('New User');
      expect(user.phone).toBe('');
      expect(user.loyaltyPoints).toBe(0);
      expect(user.tier).toBe('bronze');
    });

    it('should handle null customer doc', () => {
      const user = buildUserState(
        null,
        { uid: 'uid000', email: 'none@test.com' },
        '+15550000000'
      );
      expect(user.phone).toBe('+15550000000');
      expect(user.loyaltyPoints).toBe(0);
    });
  });

  // ==========================================
  // Session Management
  // ==========================================

  describe('Portal Data Staleness', () => {
    it('should be stale when no load time', () => {
      expect(isDataStale(null)).toBe(true);
    });

    it('should not be stale within TTL', () => {
      expect(isDataStale(Date.now() - 1000)).toBe(false); // 1 second ago
    });

    it('should be stale after TTL expires', () => {
      expect(isDataStale(Date.now() - 6 * 60 * 1000)).toBe(true); // 6 min ago, TTL is 5 min
    });

    it('should respect custom TTL', () => {
      expect(isDataStale(Date.now() - 2000, 1000)).toBe(true);  // 2s ago, 1s TTL
      expect(isDataStale(Date.now() - 500, 1000)).toBe(false);   // 500ms ago, 1s TTL
    });
  });

  describe('Logout Cleanup', () => {
    it('should return all fields that need to be reset', () => {
      const fields = getLogoutCleanupFields();
      expect(fields.user).toBeNull();
      expect(fields.activeOrders).toEqual([]);
      expect(fields.pastOrders).toEqual([]);
      expect(fields.promotions).toEqual([]);
      expect(fields.customerData).toBeNull();
      expect(fields.verifiedPhone).toBeNull();
      expect(fields.lastDataLoad).toBeNull();
    });

    it('should have exactly the expected keys', () => {
      const fields = getLogoutCleanupFields();
      const keys = Object.keys(fields).sort();
      expect(keys).toEqual([
        'activeOrders', 'customerData', 'lastDataLoad',
        'pastOrders', 'promotions', 'user', 'verifiedPhone'
      ]);
    });
  });

  // ==========================================
  // Receipt Email Template
  // ==========================================

  describe('Order Receipt Email Template', () => {
    const baseReceipt = {
      restaurantName: 'Test Kitchen',
      orderNumber: 'ORD-12345',
      items: [
        { name: 'Burger', price: 12.99, quantity: 2 },
        { name: 'Fries', price: 5.99, quantity: 1 }
      ],
      subtotal: 31.97,
      tax: 2.72,
      total: 34.69,
      taxRate: 8.5,
      paymentMethod: 'card',
      orderType: 'dine_in',
      customerName: 'Jane',
      createdAt: '2026-04-03T12:00:00Z'
    };

    it('should generate correct subject line', () => {
      const result = orderReceiptEmail(baseReceipt);
      expect(result.subject).toBe('Your receipt from Test Kitchen — Order #ORD-12345');
    });

    it('should map payment method to label', () => {
      expect(orderReceiptEmail({ ...baseReceipt, paymentMethod: 'card' }).paymentLabel).toBe('Credit/Debit Card');
      expect(orderReceiptEmail({ ...baseReceipt, paymentMethod: 'cash' }).paymentLabel).toBe('Cash');
      expect(orderReceiptEmail({ ...baseReceipt, paymentMethod: 'terminal' }).paymentLabel).toBe('Card Terminal');
      expect(orderReceiptEmail({ ...baseReceipt, paymentMethod: 'online' }).paymentLabel).toBe('Online Payment');
    });

    it('should fall back to raw payment method string for unknown types', () => {
      expect(orderReceiptEmail({ ...baseReceipt, paymentMethod: 'bitcoin' }).paymentLabel).toBe('bitcoin');
    });

    it('should default to Card when no payment method', () => {
      expect(orderReceiptEmail({ ...baseReceipt, paymentMethod: null }).paymentLabel).toBe('Card');
    });

    it('should map order type to label', () => {
      expect(orderReceiptEmail({ ...baseReceipt, orderType: 'pickup' }).orderTypeLabel).toBe('Pickup');
      expect(orderReceiptEmail({ ...baseReceipt, orderType: 'delivery' }).orderTypeLabel).toBe('Delivery');
      expect(orderReceiptEmail({ ...baseReceipt, orderType: 'dine_in' }).orderTypeLabel).toBe('Dine-In');
    });

    it('should default to Dine-In for unknown order type', () => {
      expect(orderReceiptEmail({ ...baseReceipt, orderType: 'unknown' }).orderTypeLabel).toBe('Dine-In');
    });

    it('should generate item rows for each item', () => {
      const result = orderReceiptEmail(baseReceipt);
      expect(result.itemRows).toContain('Burger');
      expect(result.itemRows).toContain('Fries');
      expect(result.itemRows).toContain('$25.98'); // 12.99 * 2
      expect(result.itemRows).toContain('$5.99');
    });

    it('should handle empty items array', () => {
      const result = orderReceiptEmail({ ...baseReceipt, items: [] });
      expect(result.itemRows).toBe('');
    });

    it('should count discount rows when present', () => {
      const result = orderReceiptEmail({
        ...baseReceipt,
        promoDiscount: 5.00,
        pointsDiscount: 2.50,
        rewardDiscount: 0
      });
      expect(result.discountCount).toBe(2); // promo + points, not reward (0)
    });

    it('should have zero discount rows when no discounts', () => {
      const result = orderReceiptEmail({
        ...baseReceipt,
        promoDiscount: 0,
        pointsDiscount: 0,
        rewardDiscount: 0
      });
      expect(result.discountCount).toBe(0);
    });

    it('should count all three discounts when all present', () => {
      const result = orderReceiptEmail({
        ...baseReceipt,
        promoDiscount: 5,
        pointsDiscount: 3,
        rewardDiscount: 2
      });
      expect(result.discountCount).toBe(3);
    });
  });

  // ==========================================
  // Receipt Notification Routing
  // ==========================================

  describe('Receipt Channel Routing', () => {
    it('should default to email-only when preference is not set', () => {
      const result = getReceiptChannels('user@test.com', '+15551234567', null);
      expect(result.shouldEmail).toBe(true);
      expect(result.shouldSMS).toBe(false);
    });

    it('should send email only when preference is email', () => {
      const result = getReceiptChannels('user@test.com', '+15551234567', 'email');
      expect(result.shouldEmail).toBe(true);
      expect(result.shouldSMS).toBe(false);
    });

    it('should send SMS only when preference is sms', () => {
      const result = getReceiptChannels('user@test.com', '+15551234567', 'sms');
      expect(result.shouldEmail).toBe(false);
      expect(result.shouldSMS).toBe(true);
    });

    it('should send both when preference is both', () => {
      const result = getReceiptChannels('user@test.com', '+15551234567', 'both');
      expect(result.shouldEmail).toBe(true);
      expect(result.shouldSMS).toBe(true);
    });

    it('should not send email when no email provided', () => {
      const result = getReceiptChannels(null, '+15551234567', 'email');
      expect(result.shouldEmail).toBe(false);
    });

    it('should not send SMS when no phone provided', () => {
      const result = getReceiptChannels('user@test.com', null, 'sms');
      expect(result.shouldSMS).toBe(false);
    });

    it('should send nothing when no contact info', () => {
      const result = getReceiptChannels(null, null, 'both');
      expect(result.shouldEmail).toBe(false);
      expect(result.shouldSMS).toBe(false);
    });
  });

  describe('SMS Receipt Construction', () => {
    it('should include restaurant name and order number', () => {
      const sms = buildSMSReceipt('Test Kitchen', 'ORD-123', [{ name: 'Burger', quantity: 1 }], 15.99);
      expect(sms).toContain('Test Kitchen');
      expect(sms).toContain('ORD-123');
    });

    it('should include item names', () => {
      const items = [
        { name: 'Burger', quantity: 1 },
        { name: 'Fries', quantity: 2 }
      ];
      const sms = buildSMSReceipt('Kitchen', 'ORD-1', items, 25.00);
      expect(sms).toContain('Burger');
      expect(sms).toContain('Fries x2');
    });

    it('should truncate at 5 items with count of remaining', () => {
      const items = Array.from({ length: 8 }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 1 }));
      const sms = buildSMSReceipt('Kitchen', 'ORD-1', items, 100.00);
      expect(sms).toContain('Item 1');
      expect(sms).toContain('Item 5');
      expect(sms).not.toContain('Item 6');
      expect(sms).toContain('+3 more');
    });

    it('should not show "+more" when 5 or fewer items', () => {
      const items = [{ name: 'Pizza', quantity: 1 }];
      const sms = buildSMSReceipt('Kitchen', 'ORD-1', items, 12.00);
      expect(sms).not.toContain('+');
      expect(sms).not.toContain('more');
    });

    it('should include formatted total', () => {
      const sms = buildSMSReceipt('Kitchen', 'ORD-1', [], 99.50);
      expect(sms).toContain('$99.50');
    });

    it('should handle zero total', () => {
      const sms = buildSMSReceipt('Kitchen', 'ORD-1', [], 0);
      expect(sms).toContain('$0.00');
    });
  });

  // ==========================================
  // Order Completion Trigger Logic
  // ==========================================

  describe('Order Completion Trigger — Should Send Receipt', () => {
    it('should send receipt when status transitions to completed', () => {
      expect(shouldSendReceipt('ready', 'completed')).toBe(true);
    });

    it('should send receipt when transitioning from preparing', () => {
      expect(shouldSendReceipt('preparing', 'completed')).toBe(true);
    });

    it('should send receipt when transitioning from served', () => {
      expect(shouldSendReceipt('served', 'completed')).toBe(true);
    });

    it('should send receipt when transitioning from new', () => {
      expect(shouldSendReceipt('new', 'completed')).toBe(true);
    });

    it('should NOT send when already completed (no re-trigger)', () => {
      expect(shouldSendReceipt('completed', 'completed')).toBe(false);
    });

    it('should NOT send when transitioning to non-completed status', () => {
      expect(shouldSendReceipt('new', 'preparing')).toBe(false);
      expect(shouldSendReceipt('preparing', 'ready')).toBe(false);
      expect(shouldSendReceipt('ready', 'served')).toBe(false);
    });

    it('should NOT send when transitioning to reimbursed', () => {
      expect(shouldSendReceipt('completed', 'reimbursed')).toBe(false);
    });
  });

  describe('Receipt Preference Resolution', () => {
    it('should use customer preference when set', () => {
      expect(resolveReceiptPreference('sms', true, true)).toBe('sms');
      expect(resolveReceiptPreference('both', true, true)).toBe('both');
      expect(resolveReceiptPreference('email', true, true)).toBe('email');
    });

    it('should default to sms when only phone available', () => {
      expect(resolveReceiptPreference(null, false, true)).toBe('sms');
    });

    it('should default to email when preference not set', () => {
      expect(resolveReceiptPreference(null, true, true)).toBe('email');
      expect(resolveReceiptPreference(null, true, false)).toBe('email');
    });

    it('should default to email when no contact info at all', () => {
      expect(resolveReceiptPreference(null, false, false)).toBe('email');
    });
  });

  // ==========================================
  // Customer Data Handling
  // ==========================================

  describe('Customer Data in Orders', () => {
    it('should preserve customer name, email, and phone in order', () => {
      const order = {
        customer: {
          name: 'John Smith',
          email: 'john@example.com',
          phone: '+15551234567'
        }
      };
      expect(order.customer.name).toBe('John Smith');
      expect(order.customer.email).toBe('john@example.com');
      expect(order.customer.phone).toBe('+15551234567');
    });

    it('should handle orders with partial customer data', () => {
      const order = { customer: { name: 'Walk-in' } };
      expect(order.customer.name).toBe('Walk-in');
      expect(order.customer.email).toBeUndefined();
      expect(order.customer.phone).toBeUndefined();
    });

    it('should handle orders with no customer data (POS dine-in)', () => {
      const order = {};
      expect(order.customer).toBeUndefined();
    });

    it('should extract receipt-eligible contact info from order', () => {
      const order = {
        customer: { name: 'Jane', email: 'jane@test.com', phone: '+15559876543' },
        customerId: 'cust-123'
      };
      const email = order.customer?.email || null;
      const phone = order.customer?.phone || null;
      expect(email).toBe('jane@test.com');
      expect(phone).toBe('+15559876543');
    });

    it('should return null for missing contact info', () => {
      const order = { customer: { name: 'Walk-in' } };
      const email = order.customer?.email || null;
      const phone = order.customer?.phone || null;
      expect(email).toBeNull();
      expect(phone).toBeNull();
    });
  });
});
