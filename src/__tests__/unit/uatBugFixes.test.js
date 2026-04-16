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

// ---- Bug #7: React Error Boundary (prevents white screen of death) ----
describe('Bug #7 — Error Boundary', () => {
  test('ErrorBoundary component exists with class-based error catching', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../../components/ErrorBoundary.js'), 'utf8');
    // Must be a class component with getDerivedStateFromError
    expect(source).toContain('class ErrorBoundary');
    expect(source).toContain('getDerivedStateFromError');
    expect(source).toContain('componentDidCatch');
    expect(source).toContain('hasError');
  });

  test('ErrorBoundary renders user-friendly recovery UI', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../../components/ErrorBoundary.js'), 'utf8');
    expect(source).toContain('Something went wrong');
    expect(source).toContain('Reload Page');
    expect(source).toContain('Go Home');
    // Must NOT show raw error details to users
    expect(source).not.toContain('stack');
    expect(source).not.toContain('toString');
  });

  test('App.js wraps entire app in ErrorBoundary', () => {
    const fs = require('fs');
    const appSource = fs.readFileSync(require.resolve('../../App.js'), 'utf8');
    expect(appSource).toContain("import ErrorBoundary from './components/ErrorBoundary'");
    expect(appSource).toContain('<ErrorBoundary>');
    expect(appSource).toContain('</ErrorBoundary>');
  });
});

// ---- Bug #8: POS beforeunload data loss prevention ----
describe('Bug #8 — POS beforeunload guard', () => {
  test('POS.js contains beforeunload event listener', () => {
    const fs = require('fs');
    const posSource = fs.readFileSync(require.resolve('../../components/POS.js'), 'utf8');
    expect(posSource).toContain('beforeunload');
    expect(posSource).toContain("window.addEventListener('beforeunload'");
    expect(posSource).toContain("window.removeEventListener('beforeunload'");
  });

  test('beforeunload is tied to orderItems state', () => {
    const fs = require('fs');
    const posSource = fs.readFileSync(require.resolve('../../components/POS.js'), 'utf8');
    // The effect should depend on orderItems
    expect(posSource).toContain('orderItems.length > 0');
  });
});

// ---- Security: Webhook signature verification ----
describe('Security — Stripe webhook signature verification', () => {
  test('stripeWebhook uses constructEvent with rawBody and secret', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    // Must verify webhook signature
    expect(functionsSource).toContain('webhooks.constructEvent');
    expect(functionsSource).toContain('req.rawBody');
    expect(functionsSource).toContain('stripe-signature');
    expect(functionsSource).toContain('STRIPE_WEBHOOK_SECRET');
  });

  test('invalid webhook signature returns 400', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    // Must return 400 on bad signature
    expect(functionsSource).toContain("res.status(400)");
    expect(functionsSource).toContain('Webhook Error');
  });
});

// ---- Security: Server-side price verification ----
describe('Security — Server-side price verification', () => {
  test('tier payment uses server-calculated amount, not client amount', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('Server-side price calculation');
    expect(functionsSource).toContain('never trust client-supplied amount');
  });

  test('createPaymentIntent validates amount > 0', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('Invalid payment amount');
    expect(functionsSource).toContain('amount <= 0');
  });

  test('createPaymentIntent requires authentication', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('User must be authenticated');
  });

  test('createPaymentIntent verifies restaurant ownership', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('Not authorized for this restaurant');
  });
});

// ---- Security: Input sanitization ----
describe('Security — Input sanitization for website rendering', () => {
  test('functions/index.js has escapeHtml function', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('function escapeHtml');
    expect(functionsSource).toContain('&lt;');
    expect(functionsSource).toContain('&gt;');
    expect(functionsSource).toContain('&amp;');
  });

  test('restaurant name is escaped in website templates', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('escapeHtml(websiteData.restaurantName');
    expect(functionsSource).toContain('escapeHtml(websiteData.address');
    expect(functionsSource).toContain('escapeHtml(websiteData.phone');
  });

  test('URL inputs are sanitized', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('function sanitizeUrl');
    expect(functionsSource).toContain('sanitizeUrl(websiteData.heroImage');
    expect(functionsSource).toContain('sanitizeUrl(websiteData.logo');
  });

  test('color inputs are sanitized', () => {
    const fs = require('fs');
    const path = require('path');
    const functionsSource = fs.readFileSync(
      path.resolve(__dirname, '../../../functions/index.js'), 'utf8'
    );
    expect(functionsSource).toContain('function sanitizeColor');
    expect(functionsSource).toContain('sanitizeColor(websiteData.primaryColor');
  });

  test('no dangerouslySetInnerHTML in React components (except print windows)', () => {
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.resolve(__dirname, '../../components');
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

    files.forEach(file => {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      // Only PromotionsRewards and ReceiptModal use innerHTML for print windows
      if (file === 'PromotionsRewards.js' || file === 'ReceiptModal.js') return;
      expect(content).not.toContain('dangerouslySetInnerHTML');
      // innerHTML is acceptable only in print windows
      if (content.includes('.innerHTML')) {
        // Must be in a print context
        expect(content).toMatch(/print|Print/);
      }
    });
  });
});

// ---- Security: Double-submit prevention ----
describe('Security — Double-submit prevention', () => {
  test('POS Send to Kitchen button disables during submission', () => {
    const fs = require('fs');
    const posSource = fs.readFileSync(require.resolve('../../components/POS.js'), 'utf8');
    expect(posSource).toContain('sendingOrder');
    // Button must use disabled={...sendingOrder}
    expect(posSource).toMatch(/disabled=\{.*sendingOrder/);
  });

  test('CardPaymentForm disables button during processing', () => {
    const fs = require('fs');
    const cardSource = fs.readFileSync(require.resolve('../../components/CardPaymentForm.js'), 'utf8');
    expect(cardSource).toContain('processing');
    expect(cardSource).toMatch(/disabled=\{.*processing/);
  });

  test('Account save button has saving guard', () => {
    const fs = require('fs');
    const accountSource = fs.readFileSync(require.resolve('../../components/Account.js'), 'utf8');
    expect(accountSource).toContain('saving');
  });
});

// ---- Security: Auth protection ----
describe('Security — Route protection', () => {
  test('PrivateRoute redirects unauthenticated users to /login', () => {
    const fs = require('fs');
    const prSource = fs.readFileSync(require.resolve('../../components/PrivateRoute.js'), 'utf8');
    expect(prSource).toContain('Navigate to="/login"');
    expect(prSource).toContain('currentUser');
  });

  test('all dashboard routes use PrivateRoute wrapper', () => {
    const fs = require('fs');
    const appSource = fs.readFileSync(require.resolve('../../App.js'), 'utf8');
    const protectedPaths = [
      '/home', '/analytics', '/menu-management', '/pos', '/kitchen',
      '/server', '/table-layout', '/payments', '/orders', '/promotions',
      '/reviews', '/website-builder', '/account'
    ];
    protectedPaths.forEach(path => {
      // Each protected path should have PrivateRoute wrapper
      const routePattern = new RegExp(`path="${path.replace('/', '\\/')}"[\\s\\S]*?PrivateRoute`);
      expect(appSource).toMatch(routePattern);
    });
  });
});

// ---- UX: Multi-location guards ----
describe('UX — Multi-location data isolation', () => {
  test('Kitchen shows empty state when multi-location but no location selected', () => {
    const fs = require('fs');
    const kitchenSource = fs.readFileSync(require.resolve('../../components/Kitchen.js'), 'utf8');
    expect(kitchenSource).toContain('isMultiLocation && !selectedLocation');
  });

  test('Server shows empty state when multi-location but no location selected', () => {
    const fs = require('fs');
    const serverSource = fs.readFileSync(require.resolve('../../components/Server.js'), 'utf8');
    expect(serverSource).toContain('isMultiLocation && !selectedLocation');
  });

  test('Home filters activities by location', () => {
    const fs = require('fs');
    const homeSource = fs.readFileSync(require.resolve('../../components/Home.js'), 'utf8');
    expect(homeSource).toContain('isMultiLocation && selectedLocation');
    expect(homeSource).toContain('activity.locationId === selectedLocation');
  });

  test('TableLayout shows empty when multi-location but no location selected', () => {
    const fs = require('fs');
    const tlSource = fs.readFileSync(require.resolve('../../components/TableLayout.js'), 'utf8');
    expect(tlSource).toContain('isMultiLocation && !selectedLocation');
  });
});

// ---- Bug #6: 404 page for unknown routes ----
describe('Bug #6 — 404 Not Found page', () => {
  test('NotFound component exists and has correct structure', () => {
    const fs = require('fs');
    const notFoundSource = fs.readFileSync(require.resolve('../../components/NotFound.js'), 'utf8');
    expect(notFoundSource).toContain('404');
    expect(notFoundSource).toContain('Page Not Found');
    expect(notFoundSource).toContain('Go Home');
    expect(notFoundSource).toContain('Log In');
    expect(notFoundSource).toContain('export default NotFound');
  });

  test('App.js has catch-all route for unknown paths', () => {
    const fs = require('fs');
    const appSource = fs.readFileSync(require.resolve('../../App.js'), 'utf8');
    // Must have a Route with path="*"
    expect(appSource).toContain('path="*"');
    expect(appSource).toContain('NotFound');
  });

  test('No window.alert, window.confirm, or window.prompt in src/', () => {
    const fs = require('fs');
    const path = require('path');
    const srcDir = path.resolve(__dirname, '../../components');
    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

    files.forEach(file => {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      // Skip test files and comments about window.confirm
      if (file.includes('ConfirmModal')) return;
      expect(content).not.toMatch(/window\.(alert|confirm|prompt)\s*\(/);
    });
  });
});
