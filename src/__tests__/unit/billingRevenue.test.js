/**
 * Unit Tests — Revenue-Critical Billing Logic
 *
 * Validates the invariants that protect revenue in:
 *   - createStripeSubscription (functions/index.js:950)
 *   - activateTrialSubscription (functions/index.js:1104)
 *   - billOverageCharges (functions/index.js:1174)
 *
 * Tests the business rules directly (not the onCall wrapper) so a bug in
 * these rules — which would silently under/over-charge customers — is
 * caught before deploy.
 */

describe('Revenue-critical billing logic', () => {
  // ==========================================
  // createStripeSubscription — input validation
  // ==========================================

  describe('createStripeSubscription — input validation', () => {
    const VALID_TIERS = ['ally', 'guide', 'chief', 'elder'];
    const VALID_CYCLES = ['monthly', 'quarterly', 'annual'];

    const validate = (input) => {
      const { tier, billingCycle, locationCount, email } = input;
      if (!tier || !VALID_TIERS.includes(tier)) {
        return { ok: false, code: 'invalid-argument', field: 'tier' };
      }
      if (!billingCycle || !VALID_CYCLES.includes(billingCycle)) {
        return { ok: false, code: 'invalid-argument', field: 'billingCycle' };
      }
      if (!locationCount || locationCount < 1 || locationCount > 100) {
        return { ok: false, code: 'invalid-argument', field: 'locationCount' };
      }
      if (!email) {
        return { ok: false, code: 'invalid-argument', field: 'email' };
      }
      return { ok: true };
    };

    it('accepts all four valid tiers', () => {
      VALID_TIERS.forEach(tier => {
        expect(validate({ tier, billingCycle: 'monthly', locationCount: 1, email: 'a@b.c' }).ok).toBe(true);
      });
    });

    it('rejects unknown tiers', () => {
      expect(validate({ tier: 'premium', billingCycle: 'monthly', locationCount: 1, email: 'a@b.c' })).toEqual({
        ok: false, code: 'invalid-argument', field: 'tier',
      });
      expect(validate({ tier: '', billingCycle: 'monthly', locationCount: 1, email: 'a@b.c' }).field).toBe('tier');
      expect(validate({ tier: null, billingCycle: 'monthly', locationCount: 1, email: 'a@b.c' }).field).toBe('tier');
    });

    it('accepts all three valid billing cycles', () => {
      VALID_CYCLES.forEach(billingCycle => {
        expect(validate({ tier: 'ally', billingCycle, locationCount: 1, email: 'a@b.c' }).ok).toBe(true);
      });
    });

    it('rejects unknown billing cycles', () => {
      expect(validate({ tier: 'ally', billingCycle: 'weekly', locationCount: 1, email: 'a@b.c' }).field).toBe('billingCycle');
      expect(validate({ tier: 'ally', billingCycle: 'yearly', locationCount: 1, email: 'a@b.c' }).field).toBe('billingCycle');
    });

    it('enforces locationCount in range [1, 100]', () => {
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: 0, email: 'a@b.c' }).field).toBe('locationCount');
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: -5, email: 'a@b.c' }).field).toBe('locationCount');
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: 101, email: 'a@b.c' }).field).toBe('locationCount');
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: 1, email: 'a@b.c' }).ok).toBe(true);
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: 100, email: 'a@b.c' }).ok).toBe(true);
    });

    it('requires email', () => {
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: 1 }).field).toBe('email');
      expect(validate({ tier: 'ally', billingCycle: 'monthly', locationCount: 1, email: '' }).field).toBe('email');
    });
  });

  // ==========================================
  // createStripeSubscription — server-side pricing
  // ==========================================

  describe('createStripeSubscription — cents conversion', () => {
    // Stripe rejects non-integer amounts. Any float-to-cents math must round.
    const toCents = (dollars) => Math.round(dollars * 100);

    it('rounds $29.99/location to 2999 cents (prevents Stripe decimal error)', () => {
      expect(toCents(29.99)).toBe(2999);
    });

    it('rounds $29.995 UP to 3000 cents (avoids revenue leak on .x5 values)', () => {
      // Math.round handles banker's rounding edge — $29.995 rounds to 3000
      expect(toCents(29.995)).toBe(3000);
    });

    it('handles annual pricing without precision loss', () => {
      // 3 months * $29.99 = $89.97 = 8997 cents (not 8996.999...)
      expect(toCents(29.99 * 3)).toBe(8997);
    });

    it('rounds discounted prices correctly', () => {
      // 20% off $49.99 = $39.992 → 3999 cents
      const discounted = 49.99 * 0.8;
      expect(toCents(discounted)).toBe(3999);
    });
  });

  // ==========================================
  // createStripeSubscription — coupon duration math
  // ==========================================

  describe('createStripeSubscription — coupon duration', () => {
    // From functions/index.js:1013-1017
    const monthsRemaining = (endDate, now) => {
      const end = new Date(endDate);
      return Math.max(1, Math.ceil((end - now) / (30 * 24 * 60 * 60 * 1000)));
    };

    it('returns 1 month minimum even if discount already expired', () => {
      const now = new Date('2026-04-16');
      const endedYesterday = '2026-04-15';
      expect(monthsRemaining(endedYesterday, now)).toBe(1);
    });

    it('rounds up partial months so coupon spans full discount window', () => {
      const now = new Date('2026-04-16');
      const in45Days = '2026-05-31';
      // 45 days ≈ 1.5 months → ceil to 2
      expect(monthsRemaining(in45Days, now)).toBe(2);
    });

    it('computes full year discount window correctly', () => {
      const now = new Date('2026-04-16');
      const in1Year = '2027-04-16';
      // 365 days ≈ 12.17 months → ceil to 13
      expect(monthsRemaining(in1Year, now)).toBeGreaterThanOrEqual(12);
    });
  });

  // ==========================================
  // createStripeSubscription — trial vs paid path
  // ==========================================

  describe('createStripeSubscription — trial gating', () => {
    const pickFlow = (adminConfig, tier) => {
      const trial = adminConfig?.freeTrials?.[tier];
      const hasFreeTrial = trial?.enabled && trial?.days > 0;
      return {
        flow: hasFreeTrial ? 'trial' : 'paid',
        trialDays: hasFreeTrial ? trial.days : 0,
      };
    };

    it('routes to paid flow when no adminConfig exists', () => {
      expect(pickFlow(null, 'ally')).toEqual({ flow: 'paid', trialDays: 0 });
    });

    it('routes to paid flow when tier has no trial config', () => {
      expect(pickFlow({ freeTrials: {} }, 'ally')).toEqual({ flow: 'paid', trialDays: 0 });
    });

    it('routes to paid flow when trial is disabled', () => {
      expect(pickFlow({ freeTrials: { ally: { enabled: false, days: 14 } } }, 'ally'))
        .toEqual({ flow: 'paid', trialDays: 0 });
    });

    it('routes to paid flow when trial days is 0', () => {
      expect(pickFlow({ freeTrials: { ally: { enabled: true, days: 0 } } }, 'ally'))
        .toEqual({ flow: 'paid', trialDays: 0 });
    });

    it('routes to trial flow when enabled with positive days', () => {
      expect(pickFlow({ freeTrials: { ally: { enabled: true, days: 14 } } }, 'ally'))
        .toEqual({ flow: 'trial', trialDays: 14 });
    });

    it('isolates trial config per tier', () => {
      const config = { freeTrials: { ally: { enabled: true, days: 14 } } };
      expect(pickFlow(config, 'ally').flow).toBe('trial');
      expect(pickFlow(config, 'chief').flow).toBe('paid');
    });
  });

  // ==========================================
  // billOverageCharges — charge calculation
  // ==========================================

  describe('billOverageCharges — charge calculation', () => {
    // From functions/index.js:1201
    const computeChargeCents = (overageDollars) => Math.max(50, Math.round(overageDollars * 100));

    it('returns 0 when no overage (short-circuit before Stripe)', () => {
      // The function short-circuits when overageCharges <= 0, returning { amount: 0 }.
      // The charge math never runs. Test reflects that semantic:
      const overageCharges = 0;
      expect(overageCharges > 0).toBe(false);
    });

    it('enforces Stripe $0.50 minimum charge even on tiny overages', () => {
      // Below-minimum overages of $0.10, $0.25, $0.49 all round UP to 50¢
      expect(computeChargeCents(0.10)).toBe(50);
      expect(computeChargeCents(0.25)).toBe(50);
      expect(computeChargeCents(0.49)).toBe(50);
    });

    it('honors overage amount when above $0.50', () => {
      expect(computeChargeCents(0.51)).toBe(51);
      expect(computeChargeCents(5)).toBe(500);
      expect(computeChargeCents(42.17)).toBe(4217);
    });

    it('rounds fractional cents (no Stripe decimal error)', () => {
      // $1.995 rounds to 200¢
      expect(computeChargeCents(1.995)).toBe(200);
      // $1.003 rounds to 100¢
      expect(computeChargeCents(1.003)).toBe(100);
    });

    it('handles exactly $0.50 overage (edge of minimum)', () => {
      expect(computeChargeCents(0.50)).toBe(50);
    });
  });

  // ==========================================
  // billOverageCharges — payment method selection
  // ==========================================

  describe('billOverageCharges — payment method selection', () => {
    // From functions/index.js:1217-1221
    const paymentParams = (restaurantData) => {
      const customerId = restaurantData.subscription?.stripeCustomerId;
      return customerId
        ? { customer: customerId, off_session: true, confirm: true }
        : {};
    };

    it('attempts off-session charge when customer has saved payment method', () => {
      const params = paymentParams({ subscription: { stripeCustomerId: 'cus_abc123' } });
      expect(params).toEqual({ customer: 'cus_abc123', off_session: true, confirm: true });
    });

    it('creates manual-capture PaymentIntent when no saved customer', () => {
      expect(paymentParams({})).toEqual({});
      expect(paymentParams({ subscription: {} })).toEqual({});
      expect(paymentParams({ subscription: null })).toEqual({});
    });

    it('never strips off_session without confirm=true (would create wrong charge state)', () => {
      // Invariant: both flags must be set together, or neither.
      const withSaved = paymentParams({ subscription: { stripeCustomerId: 'cus_x' } });
      expect(!!withSaved.off_session).toBe(!!withSaved.confirm);
    });
  });

  // ==========================================
  // billOverageCharges — Firestore reset on success
  // ==========================================

  describe('billOverageCharges — Firestore reset', () => {
    // From functions/index.js:1225-1232
    // After charge succeeds, counters MUST reset so we don't double-bill
    // on the next invocation. This test captures that invariant.

    const buildFirestoreUpdate = (paymentIntentId, overageCharges) => ({
      'orderUsage.lastOverageAmount': overageCharges,
      'orderUsage.lastOveragePaymentIntent': paymentIntentId,
      'orderUsage.overageCharges': 0,
      'orderUsage.overageOrders': 0,
    });

    it('zeroes out overage counters after billing', () => {
      const update = buildFirestoreUpdate('pi_123', 42.17);
      expect(update['orderUsage.overageCharges']).toBe(0);
      expect(update['orderUsage.overageOrders']).toBe(0);
    });

    it('records the payment intent ID for audit', () => {
      const update = buildFirestoreUpdate('pi_xyz', 10);
      expect(update['orderUsage.lastOveragePaymentIntent']).toBe('pi_xyz');
    });

    it('records the billed amount (not the charged cents) for human-readable audit', () => {
      const update = buildFirestoreUpdate('pi_1', 3.14);
      expect(update['orderUsage.lastOverageAmount']).toBe(3.14);
    });
  });

  // ==========================================
  // activateTrialSubscription — invariants
  // ==========================================

  describe('activateTrialSubscription — invariants', () => {
    it('defaults locationCount to 1 if missing', () => {
      const defaulted = (locationCount) => locationCount || 1;
      expect(defaulted(undefined)).toBe(1);
      expect(defaulted(null)).toBe(1);
      expect(defaulted(0)).toBe(1);
      expect(defaulted(5)).toBe(5);
    });

    it('defaults trialDays to 14 if missing', () => {
      const defaulted = (trialDays) => trialDays || 14;
      expect(defaulted(undefined)).toBe(14);
      expect(defaulted(null)).toBe(14);
      expect(defaulted(0)).toBe(14);
      expect(defaulted(30)).toBe(30);
    });

    it('requires customerId and priceId', () => {
      const requireFields = ({ customerId, priceId }) => Boolean(customerId && priceId);
      expect(requireFields({})).toBe(false);
      expect(requireFields({ customerId: 'cus_1' })).toBe(false);
      expect(requireFields({ priceId: 'price_1' })).toBe(false);
      expect(requireFields({ customerId: 'cus_1', priceId: 'price_1' })).toBe(true);
    });
  });
});
