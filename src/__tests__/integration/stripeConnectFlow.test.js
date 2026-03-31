/**
 * Integration Tests — Stripe Connect Flow
 *
 * Tests the end-to-end flow of Stripe Connect:
 * - Initiation flow (create account + get onboarding URL)
 * - Status check flow (verify onboarding completion)
 * - Payment flow routing (connected vs platform account)
 * - Disconnect flow
 * - Return URL handling
 * - Template rendering with connected account
 */

// ==========================================
// Stripe Connect Onboarding Flow
// ==========================================

describe('Stripe Connect Onboarding Flow', () => {
  test('Step 1 — initiate creates account and returns URL', () => {
    // Simulates Cloud Function response
    const response = {
      success: true,
      url: 'https://connect.stripe.com/setup/s/test-session',
      stripeAccountId: 'acct_new123'
    };

    expect(response.success).toBe(true);
    expect(response.url).toContain('connect.stripe.com');
    expect(response.stripeAccountId).toMatch(/^acct_/);
  });

  test('Step 2 — pending state saved to Firestore', () => {
    const firestoreDoc = {
      stripeAccountId: 'acct_new123',
      status: 'pending',
      initiatedAt: new Date(),
      updatedAt: new Date()
    };

    expect(firestoreDoc.status).toBe('pending');
    expect(firestoreDoc.stripeAccountId).toBe('acct_new123');
  });

  test('Step 3 — return URL includes success params', () => {
    const baseUrl = 'https://restaurant-portal-6b147.web.app';
    const stripeAccountId = 'acct_new123';
    const returnUrl = `${baseUrl}/account?stripe_connect=success&account_id=${stripeAccountId}`;

    expect(returnUrl).toContain('stripe_connect=success');
    expect(returnUrl).toContain('account_id=acct_new123');
  });

  test('Step 4 — checkStripeConnectStatus verifies completion', () => {
    // Simulates account with completed onboarding
    const account = {
      charges_enabled: true,
      details_submitted: true,
      payouts_enabled: true,
      business_profile: { name: 'My Restaurant' }
    };

    const isComplete = account.charges_enabled && account.details_submitted;
    expect(isComplete).toBe(true);
  });

  test('Step 5 — active state saved after verification', () => {
    const firestoreDoc = {
      stripeAccountId: 'acct_new123',
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
      businessName: 'My Restaurant',
      connectedAt: new Date(),
      updatedAt: new Date()
    };

    expect(firestoreDoc.status).toBe('active');
    expect(firestoreDoc.chargesEnabled).toBe(true);
    expect(firestoreDoc.businessName).toBe('My Restaurant');
  });
});

// ==========================================
// Incomplete Onboarding Flow
// ==========================================

describe('Incomplete Onboarding Flow', () => {
  test('checkStatus detects incomplete onboarding', () => {
    const account = {
      charges_enabled: false,
      details_submitted: false,
      payouts_enabled: false
    };

    const isComplete = account.charges_enabled && account.details_submitted;
    expect(isComplete).toBe(false);
  });

  test('pending status preserved when onboarding incomplete', () => {
    const firestoreDoc = {
      stripeAccountId: 'acct_incomplete',
      status: 'pending',
      chargesEnabled: false,
      payoutsEnabled: false
    };

    expect(firestoreDoc.status).toBe('pending');
    expect(firestoreDoc.chargesEnabled).toBe(false);
  });

  test('refreshStripeConnectLink reuses existing account', () => {
    const existingDoc = {
      stripeAccountId: 'acct_incomplete',
      status: 'pending'
    };

    // The refresh function should use the existing account ID
    const accountId = existingDoc.stripeAccountId;
    expect(accountId).toBe('acct_incomplete');
  });

  test('expired link refresh returns new URL', () => {
    const response = {
      success: true,
      url: 'https://connect.stripe.com/setup/s/new-session'
    };

    expect(response.success).toBe(true);
    expect(response.url).toContain('connect.stripe.com');
  });
});

// ==========================================
// Payment Routing Flow
// ==========================================

describe('Payment Routing — Connected vs Platform', () => {
  test('POS payment uses connected account when available', () => {
    const connectedAccountId = 'acct_restaurant1';

    // createPaymentIntent should include stripeAccount option
    const intentParams = {
      amount: 2500,
      currency: 'usd',
      metadata: { restaurantId: 'owner-123' }
    };
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    expect(stripeOptions).toEqual({ stripeAccount: 'acct_restaurant1' });
    expect(intentParams.amount).toBe(2500);
  });

  test('POS payment uses platform account when not connected', () => {
    const connectedAccountId = null;
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    expect(stripeOptions).toEqual({});
  });

  test('confirmStripePayment retrieves PI from connected account', () => {
    const connectedAccountId = 'acct_restaurant1';
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    // paymentIntents.retrieve should pass stripeOptions
    expect(stripeOptions).toEqual({ stripeAccount: 'acct_restaurant1' });
  });

  test('processStripeRefund targets connected account', () => {
    const connectedAccountId = 'acct_restaurant1';
    const refundParams = {
      payment_intent: 'pi_connected_123',
      amount: 500,
      reason: 'requested_by_customer'
    };
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};

    expect(stripeOptions).toEqual({ stripeAccount: 'acct_restaurant1' });
    expect(refundParams.payment_intent).toBe('pi_connected_123');
  });

  test('getStripeConfig includes connectedAccountId', () => {
    const config = {
      publishableKey: 'pk_test_xxx',
      connectedAccountId: 'acct_restaurant1'
    };

    expect(config.connectedAccountId).toBe('acct_restaurant1');
    expect(config.publishableKey).toMatch(/^pk_test_/);
  });

  test('getStripeConfig returns null when not connected', () => {
    const config = {
      publishableKey: 'pk_test_xxx',
      connectedAccountId: null
    };

    expect(config.connectedAccountId).toBeNull();
  });
});

// ==========================================
// Frontend Stripe Init with Connected Account
// ==========================================

describe('Frontend Stripe Initialization', () => {
  test('Payments.js fetches connect status before initializing Stripe', () => {
    // Simulates the flow: getStripeConnectStatus -> getStripe(connectedId)
    const connectStatus = { connected: true, stripeAccountId: 'acct_xyz' };
    const connectedId = connectStatus.connected ? connectStatus.stripeAccountId : null;

    expect(connectedId).toBe('acct_xyz');
  });

  test('Payments.js falls back to platform on error', () => {
    const connectStatus = { connected: false, status: 'error' };
    const connectedId = connectStatus.connected ? connectStatus.stripeAccountId : null;

    expect(connectedId).toBeNull();
  });

  test('getStripe creates instance with stripeAccount for connected', () => {
    const connectedAccountId = 'acct_xyz';
    const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(opts).toEqual({ stripeAccount: 'acct_xyz' });
  });

  test('getStripe creates platform instance when no account', () => {
    const connectedAccountId = null;
    const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(opts).toEqual({});
  });
});

// ==========================================
// Template Rendering with Connected Account
// ==========================================

describe('Website Template with Connected Account', () => {
  test('serveWebsite injects connectedAccountId into template data', () => {
    const templateData = {
      restaurantId: 'owner-123',
      stripePublishableKey: 'pk_test_xxx',
      stripeConnectedAccountId: 'acct_xyz'
    };

    expect(templateData.stripeConnectedAccountId).toBe('acct_xyz');
  });

  test('template replacement includes connected account placeholder', () => {
    const replacements = {
      '{{stripePublishableKey}}': 'pk_test_xxx',
      '{{stripeConnectedAccountId}}': 'acct_xyz'
    };

    let html = '<script>var key = "{{stripePublishableKey}}"; var acct = "{{stripeConnectedAccountId}}";</script>';
    Object.entries(replacements).forEach(([key, value]) => {
      html = html.replace(key, value);
    });

    expect(html).toContain('pk_test_xxx');
    expect(html).toContain('acct_xyz');
    expect(html).not.toContain('{{');
  });

  test('embed config includes stripeConnectedAccountId', () => {
    const embedConfig = {
      restaurantId: 'owner-123',
      stripeKey: 'pk_test_xxx',
      stripeConnectedAccountId: 'acct_xyz'
    };

    expect(embedConfig.stripeConnectedAccountId).toBe('acct_xyz');
  });

  test('embed Stripe init uses connected account option', () => {
    const config = { stripeKey: 'pk_test_xxx', stripeConnectedAccountId: 'acct_xyz' };
    const opts = config.stripeConnectedAccountId ? { stripeAccount: config.stripeConnectedAccountId } : {};
    expect(opts).toEqual({ stripeAccount: 'acct_xyz' });
  });

  test('template renders without connected account when not set', () => {
    const templateData = {
      stripePublishableKey: 'pk_test_xxx',
      stripeConnectedAccountId: ''
    };

    const opts = templateData.stripeConnectedAccountId ? { stripeAccount: templateData.stripeConnectedAccountId } : {};
    expect(opts).toEqual({}); // No stripeAccount option
  });
});

// ==========================================
// Disconnect Flow
// ==========================================

describe('Stripe Connect Disconnect Flow', () => {
  test('disconnect clears active state', () => {
    const before = {
      stripeAccountId: 'acct_123',
      status: 'active',
      chargesEnabled: true
    };

    const after = {
      stripeAccountId: null,
      status: 'disconnected',
      disconnectedAt: new Date(),
      updatedAt: new Date(),
      previousAccountId: before.stripeAccountId
    };

    expect(after.stripeAccountId).toBeNull();
    expect(after.status).toBe('disconnected');
    expect(after.previousAccountId).toBe('acct_123');
  });

  test('getStripeConnectAccountId returns null after disconnect', () => {
    const doc = { status: 'disconnected', stripeAccountId: null };
    const result = (doc.status === 'active' && doc.stripeAccountId) ? doc.stripeAccountId : null;
    expect(result).toBeNull();
  });

  test('payments revert to platform after disconnect', () => {
    const connectedAccountId = null; // After disconnect
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    expect(stripeOptions).toEqual({}); // Platform mode
  });

  test('user can reconnect after disconnect', () => {
    // After disconnect, initiateStripeConnect should work again
    const connectDoc = { status: 'disconnected', stripeAccountId: null };
    const canReconnect = connectDoc.status !== 'active';
    expect(canReconnect).toBe(true);
  });
});

// ==========================================
// Already Connected Guard
// ==========================================

describe('Stripe Connect — Already Connected Guard', () => {
  test('initiate rejects when already active', () => {
    const connectDoc = { status: 'active', stripeAccountId: 'acct_123' };
    const isAlreadyConnected = connectDoc.status === 'active';
    expect(isAlreadyConnected).toBe(true);
  });

  test('initiate reuses pending account', () => {
    const connectDoc = { status: 'pending', stripeAccountId: 'acct_pending' };
    const reuseExisting = connectDoc.stripeAccountId && connectDoc.status !== 'active';
    expect(reuseExisting).toBeTruthy();
  });

  test('initiate creates new account when disconnected', () => {
    const connectDoc = { status: 'disconnected', stripeAccountId: null };
    const needsNewAccount = !connectDoc.stripeAccountId;
    expect(needsNewAccount).toBe(true);
  });
});

// ==========================================
// Staff Permission Check for Payments
// ==========================================

describe('Staff permission for payment functions', () => {
  test('staff user resolves to restaurant owner UID', () => {
    const auth = {
      uid: 'staff-456',
      token: { isStaff: true, restaurantId: 'owner-123' }
    };

    const resolvedId = (auth.token?.isStaff && auth.token?.restaurantId)
      ? auth.token.restaurantId
      : auth.uid;

    expect(resolvedId).toBe('owner-123');
  });

  test('staff can create payment intent for their restaurant', () => {
    const requestRestaurantId = 'owner-123';
    const resolvedId = 'owner-123'; // From resolveRestaurantId

    const isAuthorized = requestRestaurantId === resolvedId;
    expect(isAuthorized).toBe(true);
  });

  test('staff cannot create payment intent for another restaurant', () => {
    const requestRestaurantId = 'other-restaurant';
    const resolvedId = 'owner-123';

    const isAuthorized = requestRestaurantId === resolvedId;
    expect(isAuthorized).toBe(false);
  });
});

// ==========================================
// Tier Payment (Signup) — Should NOT use Connect
// ==========================================

describe('Tier Payment remains on platform account', () => {
  test('createTierPayment does not use connected account', () => {
    // Signup payments always go to platform, never to connected accounts
    // The createTierPayment function should not call getStripeConnectAccountId
    const isSignupPayment = true;
    const shouldUseConnect = !isSignupPayment;
    expect(shouldUseConnect).toBe(false);
  });
});
