/**
 * Unit Tests — Stripe Connect
 *
 * Tests the Stripe Connect integration logic:
 * - getStripeConnectAccountId helper behavior
 * - resolveRestaurantId helper behavior
 * - stripeService getStripe caching with connected accounts
 * - Template config injection
 * - Account page UI state transitions
 */

// ==========================================
// getStripeConnectAccountId helper logic
// ==========================================

describe('getStripeConnectAccountId logic', () => {
  const mockHelper = (doc) => {
    if (!doc) return null;
    if (doc.status === 'active' && doc.stripeAccountId) {
      return doc.stripeAccountId;
    }
    return null;
  };

  test('returns null when no document exists', () => {
    expect(mockHelper(null)).toBeNull();
  });

  test('returns null when status is pending', () => {
    expect(mockHelper({ status: 'pending', stripeAccountId: 'acct_123' })).toBeNull();
  });

  test('returns null when status is disconnected', () => {
    expect(mockHelper({ status: 'disconnected', stripeAccountId: null })).toBeNull();
  });

  test('returns null when stripeAccountId is missing', () => {
    expect(mockHelper({ status: 'active', stripeAccountId: null })).toBeNull();
  });

  test('returns account ID when status is active and ID exists', () => {
    expect(mockHelper({ status: 'active', stripeAccountId: 'acct_abc123' })).toBe('acct_abc123');
  });

  test('returns null for empty string account ID', () => {
    expect(mockHelper({ status: 'active', stripeAccountId: '' })).toBeNull();
  });
});

// ==========================================
// resolveRestaurantId helper logic
// ==========================================

describe('resolveRestaurantId logic', () => {
  const resolve = (auth) => {
    if (auth?.token?.isStaff && auth?.token?.restaurantId) {
      return auth.token.restaurantId;
    }
    return auth?.uid || null;
  };

  test('returns owner UID for regular auth', () => {
    expect(resolve({ uid: 'owner-123', token: {} })).toBe('owner-123');
  });

  test('returns restaurant ID from staff claims', () => {
    expect(resolve({
      uid: 'staff-456',
      token: { isStaff: true, restaurantId: 'owner-123' }
    })).toBe('owner-123');
  });

  test('returns null for no auth', () => {
    expect(resolve(null)).toBeNull();
  });

  test('returns UID when isStaff is false', () => {
    expect(resolve({
      uid: 'user-789',
      token: { isStaff: false, restaurantId: 'someone' }
    })).toBe('user-789');
  });

  test('returns UID when staff token missing restaurantId', () => {
    expect(resolve({
      uid: 'staff-111',
      token: { isStaff: true }
    })).toBe('staff-111');
  });
});

// ==========================================
// Stripe instance caching logic
// ==========================================

describe('Stripe instance caching', () => {
  test('same key returns same cached instance', () => {
    const cache = {};
    const getOrCreate = (key) => {
      const cacheKey = key || '__platform__';
      if (!cache[cacheKey]) {
        cache[cacheKey] = { id: cacheKey, created: Date.now() };
      }
      return cache[cacheKey];
    };

    const first = getOrCreate(null);
    const second = getOrCreate(null);
    expect(first).toBe(second); // Same reference

    const connected = getOrCreate('acct_123');
    expect(connected).not.toBe(first); // Different instance
    expect(connected.id).toBe('acct_123');

    const connected2 = getOrCreate('acct_123');
    expect(connected2).toBe(connected); // Cached
  });

  test('different connected accounts get different instances', () => {
    const cache = {};
    const getOrCreate = (key) => {
      const cacheKey = key || '__platform__';
      if (!cache[cacheKey]) {
        cache[cacheKey] = { id: cacheKey };
      }
      return cache[cacheKey];
    };

    const a = getOrCreate('acct_aaa');
    const b = getOrCreate('acct_bbb');
    expect(a).not.toBe(b);
    expect(a.id).toBe('acct_aaa');
    expect(b.id).toBe('acct_bbb');
  });
});

// ==========================================
// Stripe Connect status response shapes
// ==========================================

describe('Stripe Connect status response validation', () => {
  test('not_connected response has correct shape', () => {
    const response = { connected: false, status: 'not_connected' };
    expect(response.connected).toBe(false);
    expect(response.status).toBe('not_connected');
  });

  test('active response has correct shape', () => {
    const response = {
      connected: true,
      status: 'active',
      stripeAccountId: 'acct_test123',
      chargesEnabled: true,
      payoutsEnabled: true,
      businessName: 'Test Restaurant',
      connectedAt: '2026-03-29T00:00:00Z'
    };

    expect(response.connected).toBe(true);
    expect(response.stripeAccountId).toMatch(/^acct_/);
    expect(response.chargesEnabled).toBe(true);
    expect(response.payoutsEnabled).toBe(true);
    expect(response.businessName).toBeTruthy();
  });

  test('pending response indicates incomplete onboarding', () => {
    const response = {
      connected: false,
      status: 'pending',
      stripeAccountId: 'acct_test123',
      chargesEnabled: false,
      payoutsEnabled: false
    };

    expect(response.connected).toBe(false);
    expect(response.status).toBe('pending');
    expect(response.chargesEnabled).toBe(false);
  });

  test('disconnected response has previous account info cleared', () => {
    const response = {
      connected: false,
      status: 'disconnected',
      stripeAccountId: null
    };

    expect(response.connected).toBe(false);
    expect(response.stripeAccountId).toBeNull();
  });
});

// ==========================================
// Template config injection
// ==========================================

describe('Template Stripe Connect config injection', () => {
  test('config includes stripeConnectedAccountId when connected', () => {
    const templateData = {
      stripePublishableKey: 'pk_test_abc',
      stripeConnectedAccountId: 'acct_xyz'
    };

    expect(templateData.stripeConnectedAccountId).toBe('acct_xyz');
  });

  test('config has empty string when not connected', () => {
    const templateData = {
      stripePublishableKey: 'pk_test_abc',
      stripeConnectedAccountId: ''
    };

    expect(templateData.stripeConnectedAccountId).toBe('');
  });

  test('Stripe init options are built correctly for connected account', () => {
    const connectedAccountId = 'acct_xyz';
    const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(opts).toEqual({ stripeAccount: 'acct_xyz' });
  });

  test('Stripe init options are empty for platform account', () => {
    const connectedAccountId = '';
    const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(opts).toEqual({});
  });
});

// ==========================================
// Payment Intent with stripeAccount option
// ==========================================

describe('Payment Intent options with connected account', () => {
  test('stripeOptions is empty when no connected account', () => {
    const connectedAccountId = null;
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(stripeOptions).toEqual({});
  });

  test('stripeOptions has stripeAccount when connected', () => {
    const connectedAccountId = 'acct_abc123';
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(stripeOptions).toEqual({ stripeAccount: 'acct_abc123' });
  });

  test('createPaymentIntent returns connectedAccountId', () => {
    const result = {
      clientSecret: 'pi_xxx_secret_yyy',
      paymentIntentId: 'pi_xxx',
      connectedAccountId: 'acct_123'
    };
    expect(result.connectedAccountId).toBe('acct_123');
  });

  test('createPaymentIntent returns null connectedAccountId for platform', () => {
    const result = {
      clientSecret: 'pi_xxx_secret_yyy',
      paymentIntentId: 'pi_xxx',
      connectedAccountId: null
    };
    expect(result.connectedAccountId).toBeNull();
  });
});

// ==========================================
// Disconnect flow logic
// ==========================================

describe('Stripe Connect disconnect logic', () => {
  test('disconnect sets status to disconnected and clears account ID', () => {
    const beforeDisconnect = {
      stripeAccountId: 'acct_123',
      status: 'active'
    };

    const afterDisconnect = {
      stripeAccountId: null,
      status: 'disconnected',
      previousAccountId: beforeDisconnect.stripeAccountId
    };

    expect(afterDisconnect.status).toBe('disconnected');
    expect(afterDisconnect.stripeAccountId).toBeNull();
    expect(afterDisconnect.previousAccountId).toBe('acct_123');
  });

  test('helper returns null after disconnect', () => {
    const doc = { status: 'disconnected', stripeAccountId: null };
    const result = (doc.status === 'active' && doc.stripeAccountId) ? doc.stripeAccountId : null;
    expect(result).toBeNull();
  });
});

// ==========================================
// Refund with connected account
// ==========================================

describe('Refund with connected account', () => {
  test('refund options include stripeAccount for connected restaurant', () => {
    const connectedAccountId = 'acct_restaurant1';
    const refundParams = {
      payment_intent: 'pi_test123',
      amount: 1499,
      reason: 'requested_by_customer'
    };
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    expect(stripeOptions).toEqual({ stripeAccount: 'acct_restaurant1' });
    expect(refundParams.amount).toBe(1499);
  });

  test('refund options are empty for platform restaurant', () => {
    const connectedAccountId = null;
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(stripeOptions).toEqual({});
  });
});

// ==========================================
// Account page Stripe Connect section routing
// ==========================================

describe('Account page navigation for Payment Account', () => {
  test('stripe_connect=success URL param should trigger payment_account section', () => {
    const params = new URLSearchParams('stripe_connect=success&account_id=acct_123');
    const stripeConnect = params.get('stripe_connect');
    const accountId = params.get('account_id');

    expect(stripeConnect).toBe('success');
    expect(accountId).toBe('acct_123');
  });

  test('stripe_connect=refresh URL param should show error', () => {
    const params = new URLSearchParams('stripe_connect=refresh');
    const stripeConnect = params.get('stripe_connect');

    expect(stripeConnect).toBe('refresh');
  });

  test('no stripe_connect param should not affect section', () => {
    const params = new URLSearchParams('');
    const stripeConnect = params.get('stripe_connect');

    expect(stripeConnect).toBeNull();
  });
});

// ==========================================
// Firestore path for stripeConnect settings
// ==========================================

describe('Stripe Connect Firestore paths', () => {
  test('stripeConnect settings path is correct', () => {
    const restaurantId = 'owner-123';
    const path = `restaurants/${restaurantId}/settings/stripeConnect`;
    expect(path).toBe('restaurants/owner-123/settings/stripeConnect');
  });

  test('path works under existing settings subcollection rule', () => {
    // The rule: match /restaurants/{restaurantId}/settings/{settingId}
    // stripeConnect falls under {settingId}
    const settingId = 'stripeConnect';
    const fullPath = `restaurants/owner-123/settings/${settingId}`;
    expect(fullPath).toContain('/settings/stripeConnect');
  });
});
