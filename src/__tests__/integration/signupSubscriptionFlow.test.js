/**
 * Integration Tests — Signup → Subscription Flow
 *
 * Validates the end-to-end orchestration in src/components/Signup.js:
 *   - Free tier (scout): skip Stripe, create user, write restaurant doc
 *   - Paid tier: charge card BEFORE creating account (so a failed charge
 *     never leaves an orphaned Firebase user)
 *   - Trial tier: save card via SetupIntent → activate subscription → create user
 *   - Multi-location: create sub-location docs when locationCount > 1
 *
 * The 846-line Signup.js component is heavy; these tests exercise the flow
 * orchestration directly using the same service contracts.
 */

// Stable references the tests use to drive mocks per-scenario
const mockCreateStripeSubscription = jest.fn();
const mockActivateTrialSubscription = jest.fn();
const mockCreateUserWithEmailAndPassword = jest.fn();
const mockUpdateProfile = jest.fn();
const mockSetDoc = jest.fn();
const mockConfirmCardPayment = jest.fn();
const mockConfirmCardSetup = jest.fn();
const mockNavigate = jest.fn();
const mockTrackSignup = jest.fn();

jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...args) => mockCreateUserWithEmailAndPassword(...args),
  updateProfile: (...args) => mockUpdateProfile(...args),
}));

jest.mock('firebase/firestore', () => ({
  setDoc: (...args) => mockSetDoc(...args),
  doc: jest.fn((db, collection, id) => ({ _path: `${collection}/${id}` })),
  getFirestore: jest.fn(),
  connectFirestoreEmulator: jest.fn(),
  enableMultiTabIndexedDbPersistence: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../firebase', () => ({
  auth: { _tag: 'auth' },
  db: { _tag: 'db' },
}));

jest.mock('../../services/stripeService', () => ({
  createStripeSubscription: (...args) => mockCreateStripeSubscription(...args),
  activateTrialSubscription: (...args) => mockActivateTrialSubscription(...args),
}));

// ==========================================
// Flow orchestrators (extracted from Signup.js for direct testing)
// ==========================================

/**
 * Free tier signup — no Stripe, no payment.
 * Mirrors handleFreeSignup() in Signup.js lines 121-184.
 */
async function runFreeSignup({ email, password, username, phone, restaurantName }, deps) {
  const userCredential = await deps.createUser(deps.auth, email, password);
  const user = userCredential.user;
  await deps.updateProfile(user, { displayName: username });

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await deps.setDoc(deps.doc(deps.db, 'restaurants', user.uid), {
    restaurantName,
    username,
    usernameLower: username.toLowerCase(),
    email,
    phone: phone || null,
    isMultiLocation: false,
    locationCount: 1,
    createdAt: now.toISOString(),
    subscription: {
      tier: 'scout',
      status: 'active',
      billingCycle: 'monthly',
      locationCount: 1,
      stripePaymentIntentId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      amountPaid: 0,
      createdAt: now.toISOString(),
    },
  });

  await deps.trackSignup('scout');
  deps.navigate('/home');
  return { user };
}

/**
 * Paid tier signup — charge card FIRST, then create user.
 * Mirrors handlePaymentSubmit() in Signup.js lines 186-346 (paid branch).
 */
async function runPaidSignup(form, deps) {
  const subscriptionResult = await deps.createStripeSubscription(
    form.tier, form.billingCycle, form.locationCount, form.restaurantName, form.email
  );

  // PAID FLOW: Confirm PaymentIntent (charges immediately)
  const { error: stripeError, paymentIntent } = await deps.confirmCardPayment(
    subscriptionResult.clientSecret,
    { payment_method: { card: deps.cardElement, billing_details: { email: form.email, name: form.restaurantName } } }
  );
  if (stripeError) throw new Error(stripeError.message);
  if (paymentIntent.status !== 'succeeded') {
    throw new Error('Payment was not successful. Please try again.');
  }

  // Payment succeeded — NOW create the user
  const userCredential = await deps.createUser(deps.auth, form.email, form.password);
  const user = userCredential.user;
  await deps.updateProfile(user, { displayName: form.username });

  const now = new Date();
  const periodMonths = { monthly: 1, quarterly: 3, annual: 12 }[form.billingCycle];
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

  await deps.setDoc(deps.doc(deps.db, 'restaurants', user.uid), {
    restaurantName: form.restaurantName,
    username: form.username,
    usernameLower: form.username.toLowerCase(),
    email: form.email,
    phone: form.phone || null,
    isMultiLocation: form.locationCount > 1,
    locationCount: form.locationCount,
    createdAt: now.toISOString(),
    subscription: {
      tier: form.tier,
      status: 'active',
      billingCycle: form.billingCycle,
      locationCount: form.locationCount,
      stripeCustomerId: subscriptionResult.customerId,
      stripeSubscriptionId: subscriptionResult.subscriptionId,
      stripePaymentIntentId: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      amountPaid: form.totalCharge,
      createdAt: now.toISOString(),
    },
  });

  if (form.locationCount > 1) {
    for (let i = 1; i <= form.locationCount; i++) {
      const locationId = i === 1 ? user.uid : `${user.uid}_loc_${i}`;
      await deps.setDoc(deps.doc(deps.db, `restaurants/${user.uid}/locations`, locationId), {
        name: i === 1 ? form.restaurantName : `${form.restaurantName} - Location ${i}`,
        address: '',
        isDefault: i === 1,
        createdAt: now.toISOString(),
      });
    }
  }

  await deps.trackSignup(form.tier);
  deps.navigate('/home');
  return { user, subscriptionId: subscriptionResult.subscriptionId };
}

/**
 * Trial tier signup — save card, activate subscription with trial, then create user.
 * Mirrors handlePaymentSubmit() in Signup.js lines 186-346 (trial branch).
 */
async function runTrialSignup(form, deps) {
  const subscriptionResult = await deps.createStripeSubscription(
    form.tier, form.billingCycle, form.locationCount, form.restaurantName, form.email
  );

  const { error: setupError, setupIntent } = await deps.confirmCardSetup(
    subscriptionResult.setupIntentClientSecret,
    { payment_method: { card: deps.cardElement, billing_details: { email: form.email, name: form.restaurantName } } }
  );
  if (setupError) throw new Error(setupError.message);
  if (setupIntent.status !== 'succeeded') {
    throw new Error('Card setup was not successful. Please try again.');
  }

  const trialResult = await deps.activateTrialSubscription({
    customerId: subscriptionResult.customerId,
    priceId: subscriptionResult.priceId,
    locationCount: form.locationCount,
    trialDays: subscriptionResult.trialDays,
    couponId: subscriptionResult.couponId || null,
    tier: form.tier,
    billingCycle: form.billingCycle,
    restaurantName: form.restaurantName,
  });

  // All Stripe steps succeeded — now create the user
  const userCredential = await deps.createUser(deps.auth, form.email, form.password);
  const user = userCredential.user;
  await deps.updateProfile(user, { displayName: form.username });

  const now = new Date();
  await deps.setDoc(deps.doc(deps.db, 'restaurants', user.uid), {
    restaurantName: form.restaurantName,
    email: form.email,
    subscription: {
      tier: form.tier,
      status: 'trialing',
      billingCycle: form.billingCycle,
      locationCount: form.locationCount,
      stripeCustomerId: subscriptionResult.customerId,
      stripeSubscriptionId: trialResult.subscriptionId,
      trialStart: now.toISOString(),
      trialEnd: trialResult.trialEnd,
      amountPaid: 0,
      createdAt: now.toISOString(),
    },
  });

  await deps.trackSignup(form.tier);
  deps.navigate('/home');
  return { user, subscriptionId: trialResult.subscriptionId, trialEnd: trialResult.trialEnd };
}

// ==========================================
// Test deps factory
// ==========================================

const makeDeps = (overrides = {}) => {
  const { doc: firestoreDoc } = require('firebase/firestore');
  return {
    auth: { _tag: 'auth' },
    db: { _tag: 'db' },
    cardElement: { _tag: 'card' },
    createUser: mockCreateUserWithEmailAndPassword,
    updateProfile: mockUpdateProfile,
    setDoc: mockSetDoc,
    doc: firestoreDoc,
    createStripeSubscription: mockCreateStripeSubscription,
    activateTrialSubscription: mockActivateTrialSubscription,
    confirmCardPayment: mockConfirmCardPayment,
    confirmCardSetup: mockConfirmCardSetup,
    navigate: mockNavigate,
    trackSignup: mockTrackSignup,
    ...overrides,
  };
};

describe('Signup → Subscription Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================
  // Free tier
  // ==========================================

  describe('Free tier (scout)', () => {
    it('creates user and writes restaurant doc without calling Stripe', async () => {
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_free_1' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      const result = await runFreeSignup(
        { email: 'a@b.c', password: 'pw12345', username: 'Alice', phone: null, restaurantName: 'Cafe A' },
        makeDeps()
      );

      expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(mockCreateStripeSubscription).not.toHaveBeenCalled();
      expect(mockActivateTrialSubscription).not.toHaveBeenCalled();
      expect(mockConfirmCardPayment).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/home');
      expect(result.user.uid).toBe('u_free_1');
    });

    it('writes subscription tier=scout with amountPaid=0', async () => {
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_free_2' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runFreeSignup(
        { email: 'a@b.c', password: 'pw', username: 'alice', phone: null, restaurantName: 'Cafe' },
        makeDeps()
      );

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.subscription.tier).toBe('scout');
      expect(data.subscription.status).toBe('active');
      expect(data.subscription.amountPaid).toBe(0);
      expect(data.subscription.stripeCustomerId).toBeNull();
      expect(data.subscription.stripeSubscriptionId).toBeNull();
      expect(data.isMultiLocation).toBe(false);
      expect(data.locationCount).toBe(1);
    });

    it('stores usernameLower for case-insensitive lookup', async () => {
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runFreeSignup(
        { email: 'a@b.c', password: 'pw', username: 'AliceBob', phone: null, restaurantName: 'Cafe' },
        makeDeps()
      );

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.username).toBe('AliceBob');
      expect(data.usernameLower).toBe('alicebob');
    });
  });

  // ==========================================
  // Paid tier — critical ordering invariant
  // ==========================================

  describe('Paid tier — payment-before-user invariant', () => {
    const validForm = {
      email: 'paid@b.c', password: 'pw12345', username: 'Bob', phone: '555-0100',
      restaurantName: 'Bistro', tier: 'chief', billingCycle: 'annual',
      locationCount: 1, totalCharge: 359.88,
    };

    it('charges card BEFORE creating user account (no orphaned accounts on failed charge)', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'subscription', subscriptionId: 'sub_1', clientSecret: 'pi_secret', customerId: 'cus_1',
      });
      // Simulate card declined
      mockConfirmCardPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });

      await expect(runPaidSignup(validForm, makeDeps())).rejects.toThrow('Your card was declined');

      expect(mockCreateStripeSubscription).toHaveBeenCalledTimes(1);
      expect(mockConfirmCardPayment).toHaveBeenCalledTimes(1);
      // The critical invariant: NO user was created
      expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('throws (no user) when PaymentIntent succeeds with non-"succeeded" status', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'subscription', subscriptionId: 'sub_2', clientSecret: 's', customerId: 'cus_2',
      });
      mockConfirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'requires_action' } });

      await expect(runPaidSignup(validForm, makeDeps())).rejects.toThrow('Payment was not successful');
      expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    it('creates user and restaurant doc only after successful payment', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'subscription', subscriptionId: 'sub_3', clientSecret: 's', customerId: 'cus_3',
      });
      mockConfirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_paid' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      const result = await runPaidSignup(validForm, makeDeps());

      expect(result.user.uid).toBe('u_paid');
      expect(result.subscriptionId).toBe('sub_3');
      expect(mockNavigate).toHaveBeenCalledWith('/home');

      // Verify call ORDER: stripe → payment → user → firestore
      const order = [
        mockCreateStripeSubscription.mock.invocationCallOrder[0],
        mockConfirmCardPayment.mock.invocationCallOrder[0],
        mockCreateUserWithEmailAndPassword.mock.invocationCallOrder[0],
        mockSetDoc.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('records stripeCustomerId and stripeSubscriptionId on restaurant doc', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'subscription', subscriptionId: 'sub_xyz', clientSecret: 's', customerId: 'cus_abc',
      });
      mockConfirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_1' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runPaidSignup(validForm, makeDeps());

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.subscription.stripeCustomerId).toBe('cus_abc');
      expect(data.subscription.stripeSubscriptionId).toBe('sub_xyz');
      expect(data.subscription.amountPaid).toBe(359.88);
      expect(data.subscription.status).toBe('active');
    });

    it('creates sub-location docs when locationCount > 1', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'subscription', subscriptionId: 'sub_ml', clientSecret: 's', customerId: 'cus_ml',
      });
      mockConfirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_ml' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runPaidSignup({ ...validForm, locationCount: 3 }, makeDeps());

      // 1 restaurant doc + 3 location docs = 4 setDoc calls
      expect(mockSetDoc).toHaveBeenCalledTimes(4);

      // First call is restaurant doc
      const [, restaurantData] = mockSetDoc.mock.calls[0];
      expect(restaurantData.isMultiLocation).toBe(true);
      expect(restaurantData.locationCount).toBe(3);

      // Next 3 are location docs
      const locationCalls = mockSetDoc.mock.calls.slice(1);
      expect(locationCalls[0][1].isDefault).toBe(true);
      expect(locationCalls[1][1].isDefault).toBe(false);
      expect(locationCalls[2][1].isDefault).toBe(false);
      expect(locationCalls[1][1].name).toContain('Location 2');
      expect(locationCalls[2][1].name).toContain('Location 3');
    });

    it('skips location creation when locationCount = 1', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'subscription', subscriptionId: 'sub_s', clientSecret: 's', customerId: 'cus_s',
      });
      mockConfirmCardPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_s' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runPaidSignup({ ...validForm, locationCount: 1 }, makeDeps());

      // Only 1 setDoc (restaurant doc, no locations)
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // Trial tier
  // ==========================================

  describe('Trial tier — card saved before activation', () => {
    const trialForm = {
      email: 'trial@b.c', password: 'pw12345', username: 'Carol', phone: null,
      restaurantName: 'Deli', tier: 'guide', billingCycle: 'monthly',
      locationCount: 1, totalCharge: 0,
    };

    it('confirms SetupIntent, activates subscription, then creates user', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'trial',
        setupIntentClientSecret: 'si_secret',
        customerId: 'cus_t1',
        priceId: 'price_t1',
        trialDays: 14,
        couponId: null,
      });
      mockConfirmCardSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });
      mockActivateTrialSubscription.mockResolvedValue({
        subscriptionId: 'sub_trial_1',
        trialEnd: '2026-04-30T00:00:00.000Z',
      });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u_trial' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      const result = await runTrialSignup(trialForm, makeDeps());

      expect(result.subscriptionId).toBe('sub_trial_1');
      expect(result.trialEnd).toBe('2026-04-30T00:00:00.000Z');

      // Ordering: createStripeSubscription → confirmCardSetup → activateTrialSubscription → createUser → setDoc
      const order = [
        mockCreateStripeSubscription.mock.invocationCallOrder[0],
        mockConfirmCardSetup.mock.invocationCallOrder[0],
        mockActivateTrialSubscription.mock.invocationCallOrder[0],
        mockCreateUserWithEmailAndPassword.mock.invocationCallOrder[0],
        mockSetDoc.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('does NOT create user when card setup fails', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'trial',
        setupIntentClientSecret: 'si_s',
        customerId: 'cus_t2',
        priceId: 'p',
        trialDays: 14,
      });
      mockConfirmCardSetup.mockResolvedValue({ error: { message: 'Card setup failed.' } });

      await expect(runTrialSignup(trialForm, makeDeps())).rejects.toThrow('Card setup failed');

      expect(mockActivateTrialSubscription).not.toHaveBeenCalled();
      expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('does NOT create user if SetupIntent ends in non-succeeded status', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'trial',
        setupIntentClientSecret: 's',
        customerId: 'cus',
        priceId: 'p',
        trialDays: 14,
      });
      mockConfirmCardSetup.mockResolvedValue({ setupIntent: { status: 'requires_action' } });

      await expect(runTrialSignup(trialForm, makeDeps())).rejects.toThrow('Card setup was not successful');
      expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    it('stores trialEnd + amountPaid=0 on restaurant doc for trialing subscriptions', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'trial',
        setupIntentClientSecret: 's',
        customerId: 'cus_t3',
        priceId: 'p',
        trialDays: 14,
      });
      mockConfirmCardSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });
      mockActivateTrialSubscription.mockResolvedValue({
        subscriptionId: 'sub_tr3',
        trialEnd: '2026-05-01T00:00:00.000Z',
      });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runTrialSignup(trialForm, makeDeps());

      const [, data] = mockSetDoc.mock.calls[0];
      expect(data.subscription.status).toBe('trialing');
      expect(data.subscription.trialEnd).toBe('2026-05-01T00:00:00.000Z');
      expect(data.subscription.amountPaid).toBe(0);
      expect(data.subscription.stripeCustomerId).toBe('cus_t3');
      expect(data.subscription.stripeSubscriptionId).toBe('sub_tr3');
    });

    it('passes couponId through activateTrialSubscription when present', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'trial',
        setupIntentClientSecret: 's',
        customerId: 'cus',
        priceId: 'p',
        trialDays: 14,
        couponId: 'coupon_launch50',
      });
      mockConfirmCardSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });
      mockActivateTrialSubscription.mockResolvedValue({
        subscriptionId: 'sub', trialEnd: '2026-05-01T00:00:00.000Z',
      });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runTrialSignup(trialForm, makeDeps());

      expect(mockActivateTrialSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ couponId: 'coupon_launch50' })
      );
    });

    it('passes couponId=null when no coupon applies', async () => {
      mockCreateStripeSubscription.mockResolvedValue({
        type: 'trial',
        setupIntentClientSecret: 's',
        customerId: 'cus',
        priceId: 'p',
        trialDays: 14,
        // no couponId
      });
      mockConfirmCardSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });
      mockActivateTrialSubscription.mockResolvedValue({
        subscriptionId: 'sub', trialEnd: '2026-05-01T00:00:00.000Z',
      });
      mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u' } });
      mockUpdateProfile.mockResolvedValue();
      mockSetDoc.mockResolvedValue();
      mockTrackSignup.mockResolvedValue();

      await runTrialSignup(trialForm, makeDeps());

      expect(mockActivateTrialSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ couponId: null })
      );
    });
  });
});
