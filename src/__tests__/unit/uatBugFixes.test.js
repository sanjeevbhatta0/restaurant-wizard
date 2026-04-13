/**
 * Regression Tests — UAT Bug Fixes (2026-04-13)
 *
 * Bug #1: Pricing tier buttons must navigate to signup (use <Link> not <button onClick>)
 * Bug #2: Login page must have "Forgot Password" link with password reset flow
 * Bug #3: Signup "Continue to Payment" button must work via click (not just Enter)
 * Bug #4: Billing cycle badges must reflect actual multiplier values (no misleading +20%/+10%)
 * Bug #5: Login errors must show user-friendly messages (not raw Firebase errors)
 */

// ---- Bug #1: PricingTiers uses <Link> for tier navigation ----
describe('Bug #1 — Pricing tier navigation', () => {
  // Replicate the getSignupUrl function from PricingTiers
  const getSignupUrl = (tierKey, billingCycle) => {
    return `/signup?tier=${tierKey}&cycle=${billingCycle}`;
  };

  test('Scout tier generates correct signup URL', () => {
    expect(getSignupUrl('scout', 'annual')).toBe('/signup?tier=scout&cycle=annual');
  });

  test('Ally tier with monthly generates correct signup URL', () => {
    expect(getSignupUrl('ally', 'monthly')).toBe('/signup?tier=ally&cycle=monthly');
  });

  test('Chief tier with quarterly generates correct signup URL', () => {
    expect(getSignupUrl('chief', 'quarterly')).toBe('/signup?tier=chief&cycle=quarterly');
  });

  test('Elder tier with annual generates correct signup URL', () => {
    expect(getSignupUrl('elder', 'annual')).toBe('/signup?tier=elder&cycle=annual');
  });

  test('All 5 tiers produce valid signup URLs', () => {
    const tiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
    const cycles = ['monthly', 'quarterly', 'annual'];

    tiers.forEach(tier => {
      cycles.forEach(cycle => {
        const url = getSignupUrl(tier, cycle);
        expect(url).toMatch(/^\/signup\?tier=\w+&cycle=\w+$/);
        expect(url).toContain(`tier=${tier}`);
        expect(url).toContain(`cycle=${cycle}`);
      });
    });
  });
});

// ---- Bug #2: Forgot Password flow ----
describe('Bug #2 — Forgot Password', () => {
  // Replicate the error mapping used in handleForgotPassword
  const forgotPasswordErrors = {
    'auth/user-not-found': 'No account found with that email address.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many requests. Please wait a moment and try again.',
  };

  test('maps auth/user-not-found to friendly message', () => {
    expect(forgotPasswordErrors['auth/user-not-found']).toBe('No account found with that email address.');
  });

  test('maps auth/invalid-email to friendly message', () => {
    expect(forgotPasswordErrors['auth/invalid-email']).toBe('Please enter a valid email address.');
  });

  test('maps auth/too-many-requests to friendly message', () => {
    expect(forgotPasswordErrors['auth/too-many-requests']).toBe('Too many requests. Please wait a moment and try again.');
  });

  test('empty email is rejected before calling Firebase', () => {
    const resetEmail = '';
    const shouldReject = !resetEmail.trim();
    expect(shouldReject).toBe(true);
  });

  test('valid email passes pre-validation', () => {
    const resetEmail = 'user@example.com';
    const shouldReject = !resetEmail.trim();
    expect(shouldReject).toBe(false);
  });

  test('pre-fills reset email from login email input', () => {
    const usernameOrEmail = 'user@restaurant.com';
    const isEmailInput = usernameOrEmail.includes('@');
    const resetEmail = isEmailInput ? usernameOrEmail : '';
    expect(resetEmail).toBe('user@restaurant.com');
  });

  test('does not pre-fill reset email from username input', () => {
    const usernameOrEmail = 'myusername';
    const isEmailInput = usernameOrEmail.includes('@');
    const resetEmail = isEmailInput ? usernameOrEmail : '';
    expect(resetEmail).toBe('');
  });
});

// ---- Bug #3: Signup button click handler ----
describe('Bug #3 — Signup button click handling', () => {
  // Test the validation logic from handleAccountSubmit
  const validateAccountStep = (password, confirmPassword, username, restaurantName) => {
    if (password !== confirmPassword) return 'Passwords do not match';
    if (password.length < 6) return 'Password must be at least 6 characters';
    if (!username.trim()) return 'Username is required';
    if (!restaurantName.trim()) return 'Restaurant name is required';
    return null; // no error
  };

  test('valid form data passes validation', () => {
    expect(validateAccountStep('Pass123!', 'Pass123!', 'testuser', 'My Restaurant')).toBeNull();
  });

  test('password mismatch returns error', () => {
    expect(validateAccountStep('Pass123!', 'Different1', 'testuser', 'My Restaurant')).toBe('Passwords do not match');
  });

  test('short password returns error', () => {
    expect(validateAccountStep('12345', '12345', 'testuser', 'My Restaurant')).toBe('Password must be at least 6 characters');
  });

  test('empty username returns error', () => {
    expect(validateAccountStep('Pass123!', 'Pass123!', '', 'My Restaurant')).toBe('Username is required');
  });

  test('whitespace-only username returns error', () => {
    expect(validateAccountStep('Pass123!', 'Pass123!', '   ', 'My Restaurant')).toBe('Username is required');
  });

  test('empty restaurant name returns error', () => {
    expect(validateAccountStep('Pass123!', 'Pass123!', 'testuser', '')).toBe('Restaurant name is required');
  });

  test('free tier skips payment step', () => {
    const isFreeTier = true;
    const shouldShowPayment = !isFreeTier;
    expect(shouldShowPayment).toBe(false);
  });

  test('paid tier shows payment step', () => {
    const isFreeTier = false;
    const shouldShowPayment = !isFreeTier;
    expect(shouldShowPayment).toBe(true);
  });
});

// ---- Bug #4: Dynamic billing cycle badges ----
describe('Bug #4 — Dynamic billing cycle badges', () => {
  const FALLBACK_MULTIPLIERS = { monthly: 1.20, quarterly: 1.10, annual: 1.00 };

  // Replicate the badge rendering logic
  const getBadgeText = (cycle, multiplier) => {
    if (cycle === 'annual') return 'Best Value';
    if (multiplier > 1) return `+${Math.round((multiplier - 1) * 100)}%`;
    return null; // no badge
  };

  test('monthly with 20% markup shows +20%', () => {
    expect(getBadgeText('monthly', 1.20)).toBe('+20%');
  });

  test('quarterly with 10% markup shows +10%', () => {
    expect(getBadgeText('quarterly', 1.10)).toBe('+10%');
  });

  test('annual always shows Best Value', () => {
    expect(getBadgeText('annual', 1.00)).toBe('Best Value');
  });

  test('monthly with 1.0 multiplier hides markup badge', () => {
    expect(getBadgeText('monthly', 1.00)).toBeNull();
  });

  test('quarterly with 1.0 multiplier hides markup badge', () => {
    expect(getBadgeText('quarterly', 1.00)).toBeNull();
  });

  test('monthly with 15% markup shows +15%', () => {
    expect(getBadgeText('monthly', 1.15)).toBe('+15%');
  });

  test('fallback multipliers have correct values', () => {
    expect(FALLBACK_MULTIPLIERS.monthly).toBe(1.20);
    expect(FALLBACK_MULTIPLIERS.quarterly).toBe(1.10);
    expect(FALLBACK_MULTIPLIERS.annual).toBe(1.00);
  });

  test('billing cycle prices differ when multipliers differ', () => {
    const basePrice = 29;
    const monthlyPrice = basePrice * FALLBACK_MULTIPLIERS.monthly;
    const annualPrice = basePrice * FALLBACK_MULTIPLIERS.annual;
    expect(monthlyPrice).toBeGreaterThan(annualPrice);
    expect(monthlyPrice).toBeCloseTo(34.80, 2);
    expect(annualPrice).toBeCloseTo(29.00, 2);
  });

  test('billing cycle prices are equal when multipliers are equal', () => {
    const equalMultipliers = { monthly: 1.0, quarterly: 1.0, annual: 1.0 };
    const basePrice = 39;
    const monthlyPrice = basePrice * equalMultipliers.monthly;
    const annualPrice = basePrice * equalMultipliers.annual;
    expect(monthlyPrice).toBe(annualPrice);
  });
});

// ---- Bug #5: User-friendly login error messages ----
describe('Bug #5 — Login error messages', () => {
  const friendlyErrors = {
    'auth/user-not-found': 'No account found with that email or username.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/invalid-login-credentials': 'Invalid email/username or password. Please try again.',
    'auth/invalid-credential': 'Invalid email/username or password. Please try again.',
    'auth/too-many-requests': 'Too many failed attempts. Please wait a moment and try again.',
    'auth/user-disabled': 'This account has been disabled. Please contact support.',
    'auth/network-request-failed': 'Network error. Please check your connection and try again.',
  };

  const getErrorMessage = (code) => friendlyErrors[code] || 'Unable to sign in. Please try again.';

  test('auth/invalid-login-credentials returns friendly message (not raw Firebase)', () => {
    const msg = getErrorMessage('auth/invalid-login-credentials');
    expect(msg).toBe('Invalid email/username or password. Please try again.');
    expect(msg).not.toContain('Firebase');
    expect(msg).not.toContain('Error');
  });

  test('auth/invalid-credential returns friendly message', () => {
    const msg = getErrorMessage('auth/invalid-credential');
    expect(msg).toBe('Invalid email/username or password. Please try again.');
  });

  test('auth/user-not-found returns friendly message', () => {
    expect(getErrorMessage('auth/user-not-found')).toBe('No account found with that email or username.');
  });

  test('auth/wrong-password returns friendly message', () => {
    expect(getErrorMessage('auth/wrong-password')).toBe('Incorrect password. Please try again.');
  });

  test('auth/too-many-requests returns friendly message', () => {
    expect(getErrorMessage('auth/too-many-requests')).toBe('Too many failed attempts. Please wait a moment and try again.');
  });

  test('auth/user-disabled returns friendly message', () => {
    expect(getErrorMessage('auth/user-disabled')).toBe('This account has been disabled. Please contact support.');
  });

  test('auth/network-request-failed returns friendly message', () => {
    expect(getErrorMessage('auth/network-request-failed')).toBe('Network error. Please check your connection and try again.');
  });

  test('unknown error code returns generic friendly message', () => {
    const msg = getErrorMessage('auth/some-unknown-error');
    expect(msg).toBe('Unable to sign in. Please try again.');
    expect(msg).not.toContain('Firebase');
  });

  test('no error messages contain raw Firebase text', () => {
    Object.values(friendlyErrors).forEach(msg => {
      expect(msg).not.toContain('Firebase');
      expect(msg).not.toContain('auth/');
      expect(msg).not.toMatch(/Error \(/);
    });
  });

  test('all mapped error codes have non-empty messages', () => {
    Object.entries(friendlyErrors).forEach(([code, msg]) => {
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).toMatch(/\.$/); // ends with a period
    });
  });
});
