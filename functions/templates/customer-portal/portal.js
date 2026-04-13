/**
 * Customer Portal - Main JavaScript
 * 
 * Modular Customer Portal that inherits parent template theming.
 * Works with Firebase Auth for authentication and Firestore for data.
 */

// HTML escape helper — prevents XSS when rendering user-controlled text
function _escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

class CustomerPortal {
  constructor(config = {}) {
    this.config = {
      restaurantId: config.restaurantId || '',
      apiBaseUrl: config.apiBaseUrl || '',
      themeConfig: config.themeConfig || {},
      firebaseConfig: config.firebaseConfig || null,
      useMockData: config.useMockData !== false, // Default true for development
      skipPhoneVerification: config.skipPhoneVerification || false, // Bypass Twilio SMS when disabled
      promoId: config.promoId || '',
      embedMode: config.embedMode || false,
      initialTab: config.initialTab || 'menu'
    };

    // State
    this.user = null;
    this.isAuthenticated = false;
    this.currentView = 'account'; // account, active_orders, orders, promotions, rewards, reviews
    this.isSpinning = false;
    this.checkoutPending = false;
    this.activeOrders = [];
    this.pastOrders = [];
    this.promotions = [];
    this.customerRewards = [];
    this.claimedPromotions = [];
    this.spinInfo = { streak: 0, lastSpinDate: null };
    this.rewardsConfig = null; // Loaded from server
    this.customerPoints = 0;
    this.dataLoadedAt = null; // Timestamp when portal data was last loaded (for TTL)

    // DOM elements (created on init)
    this.overlay = null;
    this.modal = null;
    this.portalRoot = null;

    // Phone verification state
    this.verifiedPhone = null; // Phone number verified via OTP

    // Bind methods
    this.toggleAuth = this.toggleAuth.bind(this);
    this.close = this.close.bind(this);
    this.handleLogin = this.handleLogin.bind(this);
    this.handleSignup = this.handleSignup.bind(this);
    this.handleLogout = this.handleLogout.bind(this);
    this.spin = this.spin.bind(this);

    // Initialize
    this.init();
  }

  init() {
    // Create portal root if not exists
    this.portalRoot = document.getElementById('customer-portal-root');
    if (!this.portalRoot) {
      this.portalRoot = document.createElement('div');
      this.portalRoot.id = 'customer-portal-root';
      this.portalRoot.className = 'customer-portal';
      document.body.appendChild(this.portalRoot);
    }

    // Apply theme config as CSS variables
    if (this.config.themeConfig) {
      const tc = this.config.themeConfig;
      if (tc.primaryColor) this.portalRoot.style.setProperty('--primary-color', tc.primaryColor);
      if (tc.secondaryColor) this.portalRoot.style.setProperty('--secondary-color', tc.secondaryColor);
      if (tc.accentColor) this.portalRoot.style.setProperty('--accent-color', tc.accentColor);
      if (tc.fontFamily) this.portalRoot.style.setProperty('--font-family', tc.fontFamily);
    }

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'cp-overlay';
    this.overlay.addEventListener('click', this.close);
    this.portalRoot.appendChild(this.overlay);

    // Create modal container
    this.modal = document.createElement('div');
    this.modal.className = 'cp-modal';
    this.portalRoot.appendChild(this.modal);

    // Parse promo ID from config or URL for store launch auto-claim
    this.pendingPromoId = this.config.promoId || new URLSearchParams(window.location.search).get('promo') || null;
    this.pendingPromoData = null; // Will be loaded if pendingPromoId is set

    // Check for existing session
    this.checkSession();

    // Update nav link based on auth state
    this.updateNavLink();

    // Embed mode: portal is managed by EmbedApp — don't auto-show dashboard
    if (this.config.embedMode) {
      this.portalRoot.classList.add('cp-embed-mode');
      this.portalRoot.style.display = 'block';
      this.overlay.style.display = 'none';
      this.modal.style.display = 'block';
      // DON'T auto-show dashboard — EmbedApp controls when to show portal views
      // EmbedApp will call showDashboard() or showAuth() when user navigates to account tabs
    }

    // If promo param is in URL and user is not authenticated, auto-open signup
    if (this.pendingPromoId) {
      this.loadPendingPromoAndShowAuth();
    }

    console.log('Customer Portal initialized' + (this.config.embedMode ? ' (embed mode)' : ''));
  }

  // Navigate to a specific tab (used by embed postMessage)
  navigateToTab(tab) {
    if (['account', 'active_orders', 'orders', 'promotions', 'rewards', 'reviews'].includes(tab)) {
      this.currentView = tab;
      this.showDashboard();
    }
    // Notify parent of tab change
    this.postToParent({ type: 'koda-tab-change', tab: tab });
  }

  // Send postMessage to parent window (for embed mode)
  postToParent(data) {
    if (this.config.embedMode && window.parent !== window) {
      window.parent.postMessage(data, '*');
    }
  }

  checkSession() {
    if (this.config.useMockData) {
      // Check localStorage for demo/mock mode
      const savedUser = localStorage.getItem('cp_user');
      if (savedUser) {
        try {
          this.user = JSON.parse(savedUser);
          this.isAuthenticated = true;
        } catch (e) {
          localStorage.removeItem('cp_user');
        }
      }
    } else {
      // Use Firebase Auth listener
      if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(async (firebaseUser) => {
          if (firebaseUser) {
            // User is signed in, load customer data from Firestore
            try {
              const customerDoc = await firebase.firestore()
                .doc(`restaurants/${this.config.restaurantId}/customers/${firebaseUser.uid}`)
                .get();

              if (customerDoc.exists) {
                this.user = { id: firebaseUser.uid, email: firebaseUser.email, ...customerDoc.data() };
              } else {
                this.user = { id: firebaseUser.uid, email: firebaseUser.email, fullName: firebaseUser.displayName || 'Customer' };
              }
              this.isAuthenticated = true;
            } catch (err) {
              console.error('Error loading customer data:', err);
              this.user = { id: firebaseUser.uid, email: firebaseUser.email, fullName: 'Customer' };
              this.isAuthenticated = true;
            }
            // Auto-claim pending promo for returning users
            if (this.pendingPromoId) {
              this.autoClaimPendingPromo();
            }
          } else {
            this.user = null;
            this.isAuthenticated = false;
          }
          this.updateNavLink();
        });
      }
    }
  }

  async autoClaimPendingPromo() {
    if (!this.pendingPromoId || !this.isAuthenticated) return;
    try {
      const claimPromotion = firebase.functions().httpsCallable('claimPromotion');
      const result = await claimPromotion({
        restaurantId: this.config.restaurantId,
        promotionId: this.pendingPromoId
      });
      console.log('Auto-claimed promo:', result.data);

      // Add to local claimed list so it shows immediately in dashboard
      if (result.data.success) {
        this.claimedPromotions.push({
          promotionId: this.pendingPromoId,
          promoCode: result.data.promoCode,
          uniqueCode: result.data.uniqueCode,
          discount: result.data.discount,
          discountValue: result.data.discountValue,
          discountUnit: result.data.discountUnit,
          type: result.data.type,
          promotionTitle: result.data.title || '',
          used: false
        });
      }
      this.pendingPromoId = null;
    } catch (err) {
      // Already claimed or invalid — not a problem
      console.log('Auto-claim skipped:', err.message);
      this.pendingPromoId = null;
    }
  }

  async loadPendingPromoAndShowAuth() {
    try {
      // Load the promo details so we can show title/discount on the auth form
      const apiBaseUrl = this.config.apiBaseUrl || window.location.origin;
      const response = await fetch(`${apiBaseUrl}/getPromotions?restaurantId=${this.config.restaurantId}`);
      const data = await response.json();
      if (data.success && data.promotions) {
        this.pendingPromoData = data.promotions.find(p => p.id === this.pendingPromoId) || null;
      }
    } catch (err) {
      console.log('Could not load promo details:', err.message);
    }

    // Wait briefly for Firebase auth to resolve (onAuthStateChanged)
    await this.delay(800);

    // Only show auth if user is still not authenticated
    if (!this.isAuthenticated) {
      this.showAuth('signup');
    }
  }

  updateNavLink() {
    const navLink = document.getElementById('portal-nav-link');
    if (navLink) {
      if (this.isAuthenticated && this.user) {
        navLink.innerHTML = `<i class="bi bi-person-circle"></i> ${_escHtml(this.user.fullName.split(' ')[0])}`;
      } else {
        navLink.innerHTML = '<i class="bi bi-person-circle"></i> My Account';
      }
    }
  }

  isDataStale() {
    if (!this.dataLoadedAt) return true;
    // 3-minute TTL for portal data
    return Date.now() - this.dataLoadedAt > 3 * 60 * 1000;
  }

  async refreshDataIfNeeded() {
    if (!this.isDataStale() || !this.isAuthenticated) return;
    try {
      await Promise.all([
        this.loadUserOrders(),
        this.loadPromotions(),
        this.loadCustomerData()
      ]);
    } catch (err) {
      console.log('Background data refresh failed:', err.message);
    }
  }

  async loadUserOrders() {
    if (!this.isAuthenticated || !this.user?.id) {
      console.log('loadUserOrders: Not authenticated or no user id');
      return;
    }

    console.log('loadUserOrders: Loading for customerId:', this.user.id, 'restaurant:', this.config.restaurantId);

    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        const db = firebase.firestore();

        // Query by customerId (Firebase Auth UID) to align with Firestore security rules
        // which allow customers to read orders where customerId == auth.uid
        const ordersRef = db.collection('restaurants')
          .doc(this.config.restaurantId)
          .collection('orders')
          .where('customerId', '==', this.user.id)
          .limit(50);

        console.log('loadUserOrders: Executing query...');
        const snapshot = await ordersRef.get();
        console.log('loadUserOrders: Query returned', snapshot.docs.length, 'documents');

        let allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Sort client-side by createdAt (descending)
        allOrders.sort((a, b) => {
          const timeA = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
          const timeB = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
          return timeB - timeA;
        });

        // Time-based active orders: within 30 minutes OR has active status
        const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
        const activeStatuses = ['new', 'pending', 'confirmed', 'sent_to_kitchen', 'preparing', 'ready', 'out_for_delivery'];

        this.activeOrders = allOrders.filter(o => {
          const orderTime = o.createdAt?.toMillis?.() || o.createdAt?.seconds * 1000 || 0;
          const isRecent = orderTime > thirtyMinutesAgo;
          const isActiveStatus = activeStatuses.includes(o.status);
          return isActiveStatus || isRecent;
        });

        // Past orders: not in active list
        const activeIds = new Set(this.activeOrders.map(o => o.id));
        this.pastOrders = allOrders.filter(o => !activeIds.has(o.id));

        console.log(`Loaded ${this.activeOrders.length} active orders, ${this.pastOrders.length} past orders`);
      } else {
        console.log('loadUserOrders: Firebase not available');
      }
    } catch (err) {
      console.error('Error loading orders:', err);
      console.error('Error details:', err.code, err.message);
    }
  }

  async loadPromotions() {
    try {
      const apiBaseUrl = this.config.apiBaseUrl || window.location.origin;
      const response = await fetch(`${apiBaseUrl}/getPromotions?restaurantId=${this.config.restaurantId}`);
      const data = await response.json();

      if (data.success && data.promotions) {
        this.promotions = data.promotions;
        console.log(`Loaded ${this.promotions.length} promotions`);
      }
    } catch (err) {
      console.error('Error loading promotions:', err);
      this.promotions = [];
    }
  }

  async loadCustomerData() {
    if (!this.isAuthenticated || !this.user?.id) return;

    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        const db = firebase.firestore();

        // Load customer document for loyalty points
        const customerDoc = await db
          .doc(`restaurants/${this.config.restaurantId}/customers/${this.user.id}`)
          .get();

        if (customerDoc.exists) {
          const data = customerDoc.data();
          this.user.rewardPoints = data.rewardPoints || 0;
          this.user.tier = data.tier || this.calculateTier(data.rewardPoints || 0);
          this.user.totalOrders = data.totalOrders || 0;
        }

        // Load rewards via Cloud Function
        if (typeof firebase.functions !== 'undefined') {
          try {
            const getCustomerRewards = firebase.functions().httpsCallable('getCustomerRewards');
            const result = await getCustomerRewards({ restaurantId: this.config.restaurantId });
            if (result.data.success) {
              this.customerRewards = result.data.rewards || [];
              this.claimedPromotions = result.data.claimedPromotions || [];
              this.spinInfo = result.data.spinInfo || { streak: 0, lastSpinDate: null };
              if (result.data.rewardsConfig) this.rewardsConfig = result.data.rewardsConfig;
              if (result.data.customerPoints !== undefined) {
                this.customerPoints = result.data.customerPoints;
                if (this.user) this.user.rewardPoints = result.data.customerPoints;
              }
            }
          } catch (err) {
            console.log('Could not load rewards via function:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Error loading customer data:', err);
    }
    // Mark data as freshly loaded
    this.dataLoadedAt = Date.now();
  }

  calculateTier(points) {
    if (this.rewardsConfig?.loyalty?.tiers) {
      const tiers = [...this.rewardsConfig.loyalty.tiers].sort((a, b) => b.minPoints - a.minPoints);
      for (const tier of tiers) {
        if (points >= tier.minPoints) return tier.name;
      }
      return tiers[tiers.length - 1]?.name || 'Bronze';
    }
    if (points >= 2000) return 'Platinum';
    if (points >= 1000) return 'Gold';
    if (points >= 500) return 'Silver';
    return 'Bronze';
  }

  // =========================================
  // Modal Controls
  // =========================================

  toggleAuth() {
    if (this.isAuthenticated) {
      this.showFullPageDashboard();
    } else {
      this.showAuth();
    }
  }

  async showFullPageDashboard() {
    const mainContent = document.getElementById('main-content');
    let accountPage = document.getElementById('account-page-container');

    // Create container if missing
    if (!accountPage) {
      const div = document.createElement('div');
      div.id = 'account-page-container';
      div.className = 'customer-portal';
      div.style.display = 'none';
      document.body.appendChild(div);
      accountPage = div;
    }

    // Show loading state immediately
    accountPage.innerHTML = `
      <div class="cp-loading-container">
        <div class="cp-loading-spinner"></div>
        <p class="cp-loading-text">Loading your account...</p>
      </div>
    `;
    if (mainContent) mainContent.style.display = 'none';
    accountPage.style.display = 'block';
    window.scrollTo(0, 0);

    // Load all data in parallel
    await Promise.all([
      this.loadUserOrders(),
      this.loadPromotions(),
      this.loadCustomerData()
    ]);

    // Render the full dashboard
    this.renderFullPageDashboard();
  }

  hideFullPageDashboard() {
    // In embed mode, switch back to menu via embedApp
    if (this.config.embedMode && typeof embedApp !== 'undefined') {
      embedApp.switchView('menu');
      return;
    }

    const mainContent = document.getElementById('main-content');
    const accountPage = document.getElementById('account-page-container');

    if (mainContent) mainContent.style.display = 'block';
    if (accountPage) accountPage.style.display = 'none';

    // Scroll to top
    window.scrollTo(0, 0);
  }

  showAuth(mode = 'signin') {
    // If phone already verified this session, go straight to auth form
    if (this.verifiedPhone) {
      this.modal.innerHTML = this.renderAuth(mode);
      this.overlay.classList.add('active');
      this.modal.classList.add('active');
      this.attachAuthListeners();
      return;
    }

    // Otherwise, start with phone verification
    this.modal.innerHTML = this.renderPhoneVerification();
    this.overlay.classList.add('active');
    this.modal.classList.add('active');
    this.attachPhoneVerificationListeners();
  }

  renderPhoneVerification() {
    const promo = this.pendingPromoData;
    const promoBanner = promo ? `
      <div class="cp-promo-banner">
        <div class="cp-promo-banner-icon"><i class="bi bi-gift-fill"></i></div>
        <div class="cp-promo-banner-text">
          <strong>${promo.discount} OFF — ${promo.title}</strong>
          <span>Verify your phone to claim your exclusive discount!</span>
        </div>
      </div>
    ` : '';

    return `
      <button class="cp-modal-close" onclick="customerPortal.close()">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="cp-auth-container">
        ${promoBanner}
        <div class="cp-auth-header">
          <div class="cp-phone-icon"><i class="bi bi-phone-fill"></i></div>
          <h2>Verify Your Phone</h2>
          <p>Enter your phone number to get started. We'll send you a verification code.</p>
        </div>

        <div id="cp-auth-alert"></div>

        <form id="cp-phone-form">
          <div class="cp-form-group">
            <label class="cp-form-label">Phone Number</label>
            <input type="tel" class="cp-form-input" name="phone" placeholder="(555) 123-4567" required
              style="font-size:1.1rem; letter-spacing:1px; text-align:center;">
          </div>

          <button type="submit" class="cp-btn cp-btn-primary" id="cp-phone-submit">
            <span class="btn-text">Send Verification Code</span>
          </button>
        </form>
      </div>
    `;
  }

  renderOTPVerification(phoneLastFour) {
    return `
      <button class="cp-modal-close" onclick="customerPortal.close()">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="cp-auth-container">
        <div class="cp-auth-header">
          <div class="cp-phone-icon"><i class="bi bi-shield-lock-fill"></i></div>
          <h2>Enter Verification Code</h2>
          <p>We sent a 6-digit code to the number ending in <strong>${phoneLastFour}</strong></p>
        </div>

        <div id="cp-auth-alert"></div>

        <form id="cp-otp-form">
          <div class="cp-form-group">
            <label class="cp-form-label">Verification Code</label>
            <input type="text" class="cp-form-input" name="code" placeholder="000000" required
              maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code"
              style="font-size:1.8rem; letter-spacing:8px; text-align:center; font-weight:700;">
          </div>

          <button type="submit" class="cp-btn cp-btn-primary" id="cp-otp-submit">
            <span class="btn-text">Verify Code</span>
          </button>
        </form>

        <div style="text-align:center; margin-top:12px;">
          <button class="cp-text-btn" onclick="customerPortal.resendOTP()" id="cp-resend-btn">
            Didn't receive it? Resend code
          </button>
        </div>
      </div>
    `;
  }

  attachPhoneVerificationListeners() {
    const form = this.modal.querySelector('#cp-phone-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = form.querySelector('input[name="phone"]').value.trim();
      if (!phone) return;

      const submitBtn = form.querySelector('#cp-phone-submit');
      const alertBox = this.modal.querySelector('#cp-auth-alert');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<div class="cp-spinner"></div>';
      alertBox.innerHTML = '';

      try {
        this._pendingPhone = phone;

        if (this.config.skipPhoneVerification) {
          // Twilio bypass: auto-approve phone and go straight to auth
          await this.delay(500);
          this.verifiedPhone = phone;
          this.modal.innerHTML = this.renderAuth('signin');
          this.attachAuthListeners();
          return;
        }

        if (this.config.useMockData) {
          // Mock mode: skip real SMS
          await this.delay(1000);
          this.modal.innerHTML = this.renderOTPVerification('0000');
          this.attachOTPListeners();
          return;
        }

        const sendCode = firebase.functions().httpsCallable('sendVerificationCode');
        const result = await sendCode({ phone, restaurantId: this.config.restaurantId });

        this.modal.innerHTML = this.renderOTPVerification(result.data.phoneLastFour);
        this.attachOTPListeners();

      } catch (error) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-text">Send Verification Code</span>';
        alertBox.innerHTML = `<div class="cp-alert cp-alert-error">${error.message || 'Failed to send code'}</div>`;
      }
    });
  }

  attachOTPListeners() {
    const form = this.modal.querySelector('#cp-otp-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = form.querySelector('input[name="code"]').value.trim();
      if (!code) return;

      const submitBtn = form.querySelector('#cp-otp-submit');
      const alertBox = this.modal.querySelector('#cp-auth-alert');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<div class="cp-spinner"></div>';
      alertBox.innerHTML = '';

      try {
        if (this.config.useMockData) {
          // Mock mode: accept any 6-digit code
          await this.delay(800);
          this.verifiedPhone = this._pendingPhone;
        } else {
          const verifyCode = firebase.functions().httpsCallable('verifyPhoneCode');
          const result = await verifyCode({ phone: this._pendingPhone, code });
          this.verifiedPhone = result.data.phone || this._pendingPhone;
        }

        // Phone verified — proceed to sign-in/sign-up form
        this.modal.innerHTML = this.renderAuth('signin');
        this.attachAuthListeners();

      } catch (error) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-text">Verify Code</span>';
        alertBox.innerHTML = `<div class="cp-alert cp-alert-error">${error.message || 'Invalid code'}</div>`;
      }
    });
  }

  async resendOTP() {
    const btn = this.modal.querySelector('#cp-resend-btn');
    if (btn) btn.textContent = 'Sending...';

    try {
      if (!this.config.useMockData) {
        const sendCode = firebase.functions().httpsCallable('sendVerificationCode');
        await sendCode({ phone: this._pendingPhone, restaurantId: this.config.restaurantId });
      } else {
        await this.delay(1000);
      }
      if (btn) btn.textContent = 'Code resent!';
      setTimeout(() => { if (btn) btn.textContent = "Didn't receive it? Resend code"; }, 3000);
    } catch (error) {
      if (btn) btn.textContent = 'Failed — try again';
    }
  }

  showLoadingState() {
    const loadingHtml = `
      <div class="cp-loading-container">
        <div class="cp-loading-spinner"></div>
        <p class="cp-loading-text">Loading your account...</p>
      </div>
    `;
    this.modal.innerHTML = loadingHtml;
    this.overlay.classList.add('active');
    this.modal.classList.add('active');
  }

  showDashboard() {
    this.modal.innerHTML = this.renderDashboard();
    this.overlay.classList.add('active');
    this.modal.classList.add('active');

    // Attach event listeners
    this.attachDashboardListeners();

    // Load reviews if on reviews tab
    if (this.currentView === 'reviews') {
      this.loadApprovedReviews();
    }

    // Background refresh if data is stale (re-renders dashboard when done)
    if (this.isDataStale() && this.isAuthenticated) {
      this.refreshDataIfNeeded().then(() => {
        this.modal.innerHTML = this.renderDashboard();
        this.attachDashboardListeners();
        if (this.currentView === 'reviews') {
          this.loadApprovedReviews();
        }
      });
    }
  }

  close() {
    this.overlay.classList.remove('active');
    this.modal.classList.remove('active');
  }

  showPrizeModal(prize) {
    const message = prize.type === 'none'
      ? 'Better luck next time! Come back tomorrow for another spin.'
      : prize.type === 'points'
        ? `You won ${prize.value} reward points!`
        : `You won a ${prize.name} reward! Check My Rewards below.`;

    const prizeModal = document.createElement('div');
    prizeModal.className = 'cp-modal cp-prize-modal active';
    prizeModal.innerHTML = `
      <button class="cp-modal-close" onclick="customerPortal.closePrizeModal()">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="cp-prize-icon">${prize.icon}</div>
      <h3>${prize.type === 'none' ? 'Oh no!' : 'Congratulations!'}</h3>
      <p>${message}</p>
      ${prize.type !== 'none' ? `
        <div class="cp-prize-value">${prize.name}</div>
      ` : ''}
      <button class="cp-btn cp-btn-primary" onclick="customerPortal.closePrizeModal()">
        ${prize.type === 'none' ? 'Try Again Tomorrow' : 'Awesome!'}
      </button>
    `;
    this.portalRoot.appendChild(prizeModal);
  }

  closePrizeModal() {
    const prizeModal = this.portalRoot.querySelector('.cp-prize-modal');
    if (prizeModal) {
      prizeModal.remove();
    }
  }

  // =========================================
  // Authentication
  // =========================================

  renderAuth(mode = 'signin') {
    const promo = this.pendingPromoData;
    const promoBanner = promo ? `
      <div class="cp-promo-banner">
        <div class="cp-promo-banner-icon"><i class="bi bi-gift-fill"></i></div>
        <div class="cp-promo-banner-text">
          <strong>${promo.discount} OFF — ${promo.title}</strong>
          <span>${mode === 'signin' ? 'Sign in' : 'Create an account'} to claim your exclusive discount!</span>
        </div>
      </div>
    ` : '';

    return `
      <button class="cp-modal-close" onclick="customerPortal.close()">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="cp-auth-container">
        ${promoBanner}
        <div class="cp-auth-header">
          <h2>${promo ? 'Claim Your Offer' : 'Welcome'}</h2>
          <p>${promo ? (mode === 'signin' ? 'Sign in to claim your promotion' : 'Register to get your exclusive promo code') : 'Sign in to access your account and rewards'}</p>
        </div>
        
        <div class="cp-auth-tabs">
          <button class="cp-auth-tab ${mode === 'signin' ? 'active' : ''}" data-mode="signin">
            Sign In
          </button>
          <button class="cp-auth-tab ${mode === 'signup' ? 'active' : ''}" data-mode="signup">
            Sign Up
          </button>
        </div>
        
        <div id="cp-auth-alert"></div>
        
        <form id="cp-auth-form" class="${mode === 'signin' ? 'signin-form' : 'signup-form'}">
          ${mode === 'signup' ? `
            <div class="cp-form-group">
              <label class="cp-form-label">Full Name</label>
              <input type="text" class="cp-form-input" name="fullName" placeholder="John Doe" required>
            </div>
          ` : ''}
          
          <div class="cp-form-group">
            <label class="cp-form-label">Email Address</label>
            <input type="email" class="cp-form-input" name="email" placeholder="you@example.com" required>
          </div>
          
          ${mode === 'signup' ? `
            <div class="cp-form-group">
              <label class="cp-form-label">Phone Number <span style="opacity:0.5">(Verified ✓)</span></label>
              <input type="tel" class="cp-form-input" name="phone" value="${this.verifiedPhone || ''}" readonly
                style="background:#f0f0f0; cursor:not-allowed; opacity:0.8;">
            </div>

            <div class="cp-form-group">
              <label class="cp-form-label">Address <span style="opacity: 0.5">(Optional)</span></label>
              <input type="text" class="cp-form-input" name="address" placeholder="123 Main St, City, State">
            </div>
          ` : ''}
          
          <div class="cp-form-group">
            <label class="cp-form-label">Password</label>
            <input type="password" class="cp-form-input" name="password" 
              placeholder="${mode === 'signup' ? 'Create a password' : 'Enter your password'}" 
              minlength="6" required>
            ${mode === 'signup' ? '<span class="cp-form-hint">Must be at least 6 characters</span>' : ''}
          </div>
          
          <button type="submit" class="cp-btn cp-btn-primary" id="cp-auth-submit">
            <span class="btn-text">${mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
          </button>
        </form>
      </div>
    `;
  }

  attachAuthListeners() {
    // Tab switching
    const tabs = this.modal.querySelectorAll('.cp-auth-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        this.showAuth(mode);
      });
    });

    // Form submission
    const form = this.modal.querySelector('#cp-auth-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const isSignUp = form.classList.contains('signup-form');

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      if (isSignUp) {
        this.handleSignup(data);
      } else {
        this.handleLogin(data);
      }
    });
  }

  async handleLogin(data) {
    const submitBtn = this.modal.querySelector('#cp-auth-submit');
    const alertBox = this.modal.querySelector('#cp-auth-alert');

    // Show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="cp-spinner"></div>';
    alertBox.innerHTML = '';

    try {
      if (!data.email || !data.password) {
        throw new Error('Please enter email and password');
      }

      if (this.config.useMockData) {
        // Mock mode: simulate login
        await this.delay(1000);
        this.user = {
          ...window.MockData?.user || {},
          email: data.email,
          fullName: data.email.split('@')[0].replace('.', ' ').replace(/\b\w/g, l => l.toUpperCase())
        };
        this.isAuthenticated = true;
        localStorage.setItem('cp_user', JSON.stringify(this.user));
      } else {
        // Firebase Auth: real login
        const userCredential = await firebase.auth().signInWithEmailAndPassword(data.email, data.password);
        const firebaseUser = userCredential.user;

        // Load customer data from Firestore
        const customerDoc = await firebase.firestore()
          .doc(`restaurants/${this.config.restaurantId}/customers/${firebaseUser.uid}`)
          .get();

        if (customerDoc.exists) {
          this.user = { id: firebaseUser.uid, email: firebaseUser.email, ...customerDoc.data() };
        } else {
          this.user = { id: firebaseUser.uid, email: firebaseUser.email, fullName: firebaseUser.displayName || 'Customer' };
        }
        this.isAuthenticated = true;

        // Persist verified phone to customer record if not already saved
        if (this.verifiedPhone) {
          const existingPhone = customerDoc.exists && customerDoc.data().phone;
          if (!existingPhone) {
            await firebase.firestore()
              .doc(`restaurants/${this.config.restaurantId}/customers/${firebaseUser.uid}`)
              .set({ phone: this.verifiedPhone }, { merge: true });
            this.user.phone = this.verifiedPhone;
          }
        }
      }

      // Show loading state while data loads (replaces tiny button spinner with full loading screen)
      this.updateNavLink();
      this.showLoadingState();

      await Promise.all([
        this.loadUserOrders(),
        this.loadPromotions(),
        this.loadCustomerData()
      ]);
      this.postToParent({ type: 'koda-auth-change', authenticated: true, user: { email: this.user?.email, name: this.user?.fullName } });

      if (this.config.embedMode) {
        // In embed mode, just refresh the dashboard view
        if (typeof embedApp !== 'undefined') embedApp.portalDataLoaded = true;
        this.showDashboard();
      } else {
        this.close();

        if (this.checkoutPending) {
          this.checkoutPending = false;
          if (window.openCheckout) window.openCheckout();
        } else {
          this.showFullPageDashboard();
        }
      }

    } catch (error) {
      let message = error.message;
      // Friendly Firebase error messages
      if (error.code === 'auth/user-not-found') message = 'No account found with this email';
      if (error.code === 'auth/wrong-password') message = 'Incorrect password';
      if (error.code === 'auth/invalid-email') message = 'Invalid email address';

      // Show auth form again on error
      this.showAuth('signin');
      const newAlertBox = this.modal.querySelector('#cp-auth-alert');
      if (newAlertBox) newAlertBox.innerHTML = `<div class="cp-alert cp-alert-error">${message}</div>`;
    }
  }

  async handleSignup(data) {
    const submitBtn = this.modal.querySelector('#cp-auth-submit');
    const alertBox = this.modal.querySelector('#cp-auth-alert');

    // Show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="cp-spinner"></div>';
    alertBox.innerHTML = '';

    try {
      // Validate
      if (!data.fullName || !data.email || !data.password) {
        throw new Error('Please fill in all required fields');
      }

      if (data.password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      const customerData = {
        fullName: data.fullName,
        phone: this.verifiedPhone || data.phone || '',
        address: data.address || '',
        rewardPoints: 100, // Welcome bonus
        nextRewardAt: 500,
        memberSince: new Date().toISOString().split('T')[0],
        tier: 'New Member'
      };

      if (this.config.useMockData) {
        // Mock mode: simulate signup
        await this.delay(1500);
        this.user = {
          id: 'user_' + Date.now(),
          email: data.email,
          ...customerData
        };
        this.isAuthenticated = true;
        localStorage.setItem('cp_user', JSON.stringify(this.user));
      } else {
        // Firebase Auth: real signup
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(data.email, data.password);
        const firebaseUser = userCredential.user;

        // Update display name
        await firebaseUser.updateProfile({ displayName: data.fullName });

        // Create customer document in Firestore
        await firebase.firestore()
          .doc(`restaurants/${this.config.restaurantId}/customers/${firebaseUser.uid}`)
          .set({
            ...customerData,
            email: data.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });

        this.user = { id: firebaseUser.uid, email: data.email, ...customerData };
        this.isAuthenticated = true;
      }

      // Show welcome message briefly, then loading state
      alertBox.innerHTML = `<div class="cp-alert cp-alert-success">
        Welcome! You've earned 100 bonus points!
      </div>`;
      await this.delay(1500);

      // Show loading state while data loads
      this.updateNavLink();
      this.showLoadingState();

      await Promise.all([
        this.loadUserOrders(),
        this.loadPromotions(),
        this.loadCustomerData()
      ]);
      this.postToParent({ type: 'koda-auth-change', authenticated: true, user: { email: this.user?.email, name: this.user?.fullName } });

      // Auto-claim store launch promotion if promo ID is in URL
      if (this.pendingPromoId) {
        await this.autoClaimPendingPromo();
      }

      if (this.config.embedMode) {
        if (typeof embedApp !== 'undefined') embedApp.portalDataLoaded = true;
        this.showDashboard();
      } else {
        this.close();

        if (this.checkoutPending) {
          this.checkoutPending = false;
          if (window.openCheckout) window.openCheckout();
        } else {
          this.showFullPageDashboard();
        }
      }

    } catch (error) {
      let message = error.message;
      // Friendly Firebase error messages
      if (error.code === 'auth/email-already-in-use') message = 'An account with this email already exists';
      if (error.code === 'auth/invalid-email') message = 'Invalid email address';
      if (error.code === 'auth/weak-password') message = 'Password is too weak';

      this.showAuth('signup');
      const newAlertBox = this.modal.querySelector('#cp-auth-alert');
      if (newAlertBox) newAlertBox.innerHTML = `<div class="cp-alert cp-alert-error">${message}</div>`;
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="btn-text">Create Account</span>';
    }
  }

  handleLogout() {
    if (!this.config.useMockData && typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut().catch(err => console.error('Logout error:', err));
    }

    this.user = null;
    this.isAuthenticated = false;
    this.verifiedPhone = null;
    this.promotions = [];
    this.activeOrders = [];
    this.pastOrders = [];
    this.customerRewards = [];
    this.claimedPromotions = [];
    this.customerPoints = 0;
    localStorage.removeItem('cp_user');
    localStorage.removeItem('cp_lastSpin');
    this.updateNavLink();
    this.postToParent({ type: 'koda-auth-change', authenticated: false });

    // Reset data loaded flag and cache timestamp so data reloads on next login
    this.dataLoadedAt = null;
    if (this.config.embedMode && typeof embedApp !== 'undefined') {
      embedApp.portalDataLoaded = false;
    }

    if (this.config.embedMode) {
      // In embed mode, show login form instead of closing
      this.showAuth();
    } else {
      this.close();
      this.hideFullPageDashboard();
    }
  }

  // =========================================
  // Dashboard
  // =========================================

  renderDashboard() {
    const user = this.user || {};
    const orders = window.MockData?.orders || [];
    const promotions = window.MockData?.promotions || [];

    return `
      <div class="cp-dashboard">
        <aside class="cp-sidebar">
          <div class="cp-sidebar-header">
            <h3>${_escHtml(user.fullName || 'Guest')}</h3>
            <p>${user.tier || 'Member'}</p>
          </div>
          
          <nav class="cp-nav">
            <button class="cp-nav-item ${this.currentView === 'account' ? 'active' : ''}" data-view="account">
              <i class="bi bi-person"></i>
              <span>Account</span>
            </button>
            <button class="cp-nav-item ${this.currentView === 'active_orders' ? 'active' : ''}" data-view="active_orders">
              <i class="bi bi-clock-history"></i>
              <span>Active Orders</span>
              ${this.activeOrders.length > 0 ? `<span class="cp-nav-badge">${this.activeOrders.length}</span>` : ''}
            </button>
            <button class="cp-nav-item ${this.currentView === 'orders' ? 'active' : ''}" data-view="orders">
              <i class="bi bi-receipt"></i>
              <span>Past Orders</span>
            </button>
            <button class="cp-nav-item ${this.currentView === 'promotions' ? 'active' : ''}" data-view="promotions">
              <i class="bi bi-tag"></i>
              <span>Promotions</span>
            </button>
            <button class="cp-nav-item ${this.currentView === 'rewards' ? 'active' : ''}" data-view="rewards">
              <i class="bi bi-gift"></i>
              <span>Fun Rewards</span>
            </button>
            <button class="cp-nav-item ${this.currentView === 'reviews' ? 'active' : ''}" data-view="reviews">
              <i class="bi bi-chat-quote"></i>
              <span>Reviews</span>
            </button>
            <div style="height: 1px; background: rgba(255,255,255,0.1); margin: 1rem 0;"></div>
            <button class="cp-nav-item" onclick="customerPortal.hideFullPageDashboard()">
              <i class="bi bi-arrow-left"></i>
              <span>Back to Menu</span>
            </button>
          </nav>
          
          <div class="cp-sidebar-footer">
            <button class="cp-logout-btn" onclick="customerPortal.handleLogout()">
              <i class="bi bi-box-arrow-left"></i>
              Sign Out
            </button>
          </div>
        </aside>
        
        <main class="cp-content" id="cp-dashboard-content">
          ${this.renderDashboardContent()}
          ${this.config.embedMode ? `
            <div class="cp-embed-footer">
              <button class="cp-embed-logout-btn" onclick="customerPortal.handleLogout()">
                <i class="bi bi-box-arrow-left"></i> Sign Out
              </button>
            </div>
          ` : ''}
        </main>
      </div>
    `;
  }

  renderFullPageDashboard() {
    const container = document.getElementById('account-page-container');
    if (!container) return;

    // Reuse renderDashboard logic but update container
    container.innerHTML = this.renderDashboard();

    // Attach listeners
    this.attachFullPageDashboardListeners();
  }

  attachFullPageDashboardListeners() {
    const container = document.getElementById('account-page-container');
    if (!container) return;

    // Nav item clicks
    const navItems = container.querySelectorAll('.cp-nav-item[data-view]');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.currentView = item.dataset.view;
        this.renderFullPageDashboard(); // Re-render full page
      });
    });
  }


  renderDashboardContent() {
    switch (this.currentView) {
      case 'active_orders':
        return this.renderActiveOrders();
      case 'orders':
        // In embed mode, show both active and past orders combined
        if (this.config.embedMode) {
          return this.renderAllOrders();
        }
        return this.renderOrderHistory();
      case 'promotions':
        return this.renderPromotions();
      case 'rewards':
        return this.renderDailySpin();
      case 'reviews':
        return this.renderReviews();
      default:
        return this.renderAccountOverview();
    }
  }

  renderAllOrders() {
    const activeOrders = this.activeOrders || [];
    const completedStatuses = ['completed', 'picked_up', 'delivered', 'cancelled'];
    const pastOrders = this.pastOrders.filter(o => completedStatuses.includes(o.status));

    return `
      ${activeOrders.length > 0 ? `
        <div class="cp-content-header">
          <h2>Active Orders</h2>
          <p>Track your current orders</p>
        </div>
        <div class="cp-order-list">
          ${activeOrders.map(order => this.renderOrderCard(order, true)).join('')}
        </div>
      ` : ''}

      <div class="cp-content-header" ${activeOrders.length > 0 ? 'style="margin-top: 2rem;"' : ''}>
        <h2>Past Orders</h2>
        <p>Your order history and quick reorder</p>
      </div>
      <div class="cp-order-list">
        ${pastOrders.length === 0 && activeOrders.length === 0 ? `
          <div class="cp-card" style="text-align: center; padding: 3rem">
            <i class="bi bi-receipt" style="font-size: 3rem; opacity: 0.3"></i>
            <p style="color: var(--cp-text-light); margin-top: 1rem">No orders yet</p>
            <p style="color: var(--cp-text-light); font-size: 0.9rem">Place an order from the menu to get started!</p>
          </div>
        ` : pastOrders.length === 0 ? `
          <div class="cp-card" style="text-align: center; padding: 2rem">
            <p style="color: var(--cp-text-light);">No past orders yet</p>
          </div>
        ` : pastOrders.map(order => this.renderOrderCard(order, false)).join('')}
      </div>
    `;
  }

  renderOrderCard(order, isActive) {
    const statusBadge = isActive
      ? `<span class="cp-order-status-badge cp-status-active">${this.formatStatus(order.status, order.orderType)}</span>`
      : `<span class="cp-order-status ${order.status}">${this.formatStatus(order.status, order.orderType)}</span>`;

    const items = order.items || [];
    const itemSummary = items.map(i => `${i.quantity || 1}x ${i.name}`).join(', ');
    const orderTime = this.formatDate(order.createdAt || order.date);
    const total = typeof order.total === 'number' ? order.total.toFixed(2) : '0.00';
    const isDelivery = order.orderType === 'delivery';

    let pickupHtml = '';
    if (!isDelivery && isActive) {
      pickupHtml = `
        <div style="margin-top:8px; padding:10px; background:#f5faf7; border-radius:8px; border-left:3px solid var(--cp-primary, #2d6a4f);">
          <div style="font-weight:600; font-size:0.85rem; margin-bottom:6px;"><i class="bi bi-bag-check"></i> Pickup Details</div>
          ${order.pickupTime ? '<div style="font-size:0.85rem; color:var(--cp-text-light); margin-bottom:6px;"><i class="bi bi-clock"></i> Pickup time: <strong>' + new Date(order.pickupTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</strong></div>' : ''}
          <div>${this.getPickupSteps(order.status)}</div>
        </div>
      `;
    } else if (!isDelivery && order.pickupTime) {
      pickupHtml = `
        <div style="font-size: 0.85rem; color: var(--cp-text-light); margin-top: 4px;">
          <i class="bi bi-clock"></i> Pickup: ${new Date(order.pickupTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </div>
      `;
    }

    // Delivery tracking info for active delivery orders
    let deliveryHtml = '';
    if (isDelivery && isActive) {
      const dd = order.doordash || {};
      const steps = this.getDeliverySteps(dd.deliveryStatus, order.status);
      const eta = dd.estimatedDropoffTime
        ? new Date(dd.estimatedDropoffTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : null;

      deliveryHtml = `
        <div class="cp-delivery-tracker" style="margin-top: 8px;">
          <div class="cp-delivery-steps">${steps}</div>
          ${dd.dasherName ? `<div style="font-size: 0.85rem; margin-top: 6px;"><i class="bi bi-person-fill"></i> Driver: ${dd.dasherName}</div>` : ''}
          ${eta ? `<div style="font-size: 0.85rem; color: var(--cp-text-light);"><i class="bi bi-clock"></i> ETA: ${eta}</div>` : ''}
          ${dd.trackingUrl ? `<a href="${dd.trackingUrl}" target="_blank" class="cp-track-link" style="display: inline-block; margin-top: 6px; font-size: 0.85rem; color: var(--cp-primary); text-decoration: none;"><i class="bi bi-truck"></i> Track Delivery</a>` : ''}
        </div>
      `;
    } else if (isDelivery && !isActive) {
      deliveryHtml = `
        <div style="font-size: 0.85rem; color: var(--cp-text-light); margin-top: 4px;">
          <i class="bi bi-truck"></i> Delivery to: ${order.deliveryAddress?.fullAddress || 'N/A'}
        </div>
      `;
    }

    // Order type badge
    const typeBadge = isDelivery
      ? '<span style="font-size: 0.75rem; background: #e3f2fd; color: #1565c0; padding: 2px 6px; border-radius: 4px; margin-left: 6px;"><i class="bi bi-truck"></i> Delivery</span>'
      : '';

    return `
      <div class="cp-order-card ${isActive ? 'cp-order-active' : ''}">
        <div class="cp-order-card-header">
          <div>
            <strong>Order #${order.orderNumber || order.id}</strong>${typeBadge}
            <span style="color: var(--cp-text-light); font-size: 0.85rem; margin-left: 8px;">${orderTime}</span>
          </div>
          ${statusBadge}
        </div>
        <div class="cp-order-card-body">
          <div style="font-size: 0.9rem; color: var(--cp-text-light);">${itemSummary}</div>
          ${pickupHtml}
          ${deliveryHtml}
        </div>
        <div class="cp-order-card-footer">
          <strong>Total: $${total}</strong>
          ${!isActive ? `<button class="cp-order-reorder" onclick="customerPortal.reorder('${order.id}')"><i class="bi bi-arrow-repeat"></i> Re-order</button>` : ''}
        </div>
      </div>
    `;
  }

  getDeliverySteps(deliveryStatus, orderStatus) {
    const allSteps = [
      { key: 'placed', label: 'Order Placed', icon: 'bi-check-circle' },
      { key: 'preparing', label: 'Preparing', icon: 'bi-fire' },
      { key: 'driver_assigned', label: 'Driver Assigned', icon: 'bi-person-check' },
      { key: 'picked_up', label: 'Picked Up', icon: 'bi-box-seam' },
      { key: 'on_the_way', label: 'On The Way', icon: 'bi-truck' },
      { key: 'delivered', label: 'Delivered', icon: 'bi-house-check' },
    ];

    // Map DoorDash deliveryStatus to step index
    const statusToStep = {
      'quoted': 0, 'awaiting_driver': 1,
      'driver_assigned': 2, 'driver_enroute_pickup': 2, 'driver_at_pickup': 2,
      'picked_up': 3,
      'driver_enroute_dropoff': 4, 'driver_at_dropoff': 4,
      'delivered': 5,
      'cancelled': -1,
    };

    // Use the furthest-along of DoorDash status and order status
    const ddStep = statusToStep[deliveryStatus] ?? 0;
    const orderToStep = { 'new': 0, 'sent_to_kitchen': 0, 'preparing': 1, 'ready': 1, 'out_for_delivery': 4, 'completed': 5 };
    const orderStep = orderToStep[orderStatus] ?? 0;
    let currentStep = deliveryStatus === 'cancelled' ? -1 : Math.max(ddStep, orderStep);

    if (deliveryStatus === 'cancelled') {
      return '<div style="color: #e74c3c; font-size: 0.85rem;"><i class="bi bi-x-circle"></i> Delivery cancelled</div>';
    }

    return `<div style="display:flex; gap:2px; flex-wrap:wrap; align-items:center;">${allSteps.map((step, i) => {
      const isComplete = i <= currentStep;
      const isCurrent = i === currentStep;
      const bg = isComplete ? 'var(--cp-primary, #2d6a4f)' : '#e0e0e0';
      const textColor = isComplete ? 'white' : '#999';
      const scale = isCurrent ? 'transform:scale(1.05);' : '';
      return `<div style="display:flex; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; padding:4px 6px; border-radius:6px; background:${isCurrent ? bg : 'transparent'}; ${scale}">
          <i class="${step.icon}" style="font-size:0.8rem; color:${isComplete ? 'var(--cp-primary, #2d6a4f)' : '#ccc'};${isCurrent ? 'color:white;' : ''}"></i>
          <span style="font-size:0.65rem; color:${isCurrent ? 'white' : (isComplete ? 'var(--cp-primary, #2d6a4f)' : '#999')}; white-space:nowrap; font-weight:${isCurrent ? '600' : '400'};">${step.label}</span>
        </div>
        ${i < allSteps.length - 1 ? '<div style="width:12px; height:2px; background:' + (i < currentStep ? 'var(--cp-primary, #2d6a4f)' : '#e0e0e0') + '; margin:0 1px;"></div>' : ''}
      </div>`;
    }).join('')}</div>`;
  }

  getPickupSteps(orderStatus) {
    const allSteps = [
      { key: 'placed', label: 'Order Placed', icon: 'bi-check-circle' },
      { key: 'preparing', label: 'Preparing', icon: 'bi-fire' },
      { key: 'ready', label: 'Ready for Pickup', icon: 'bi-bag-check' },
      { key: 'completed', label: 'Picked Up', icon: 'bi-hand-thumbs-up' },
    ];

    const statusToStep = {
      'new': 0, 'sent_to_kitchen': 0, 'pending': 0, 'confirmed': 0,
      'preparing': 1,
      'ready': 2,
      'completed': 3, 'picked_up': 3,
      'cancelled': -1,
    };

    const currentStep = statusToStep[orderStatus] ?? 0;

    if (orderStatus === 'cancelled') {
      return '<div style="color: #e74c3c; font-size: 0.85rem;"><i class="bi bi-x-circle"></i> Order cancelled</div>';
    }

    return `<div style="display:flex; gap:2px; flex-wrap:wrap; align-items:center;">${allSteps.map((step, i) => {
      const isComplete = i <= currentStep;
      const isCurrent = i === currentStep;
      return `<div style="display:flex; align-items:center;">
        <div style="display:flex; flex-direction:column; align-items:center; padding:4px 8px; border-radius:6px; background:${isCurrent ? 'var(--cp-primary, #2d6a4f)' : 'transparent'}; ${isCurrent ? 'transform:scale(1.05);' : ''}">
          <i class="${step.icon}" style="font-size:0.8rem; color:${isCurrent ? 'white' : (isComplete ? 'var(--cp-primary, #2d6a4f)' : '#ccc')};"></i>
          <span style="font-size:0.65rem; color:${isCurrent ? 'white' : (isComplete ? 'var(--cp-primary, #2d6a4f)' : '#999')}; white-space:nowrap; font-weight:${isCurrent ? '600' : '400'};">${step.label}</span>
        </div>
        ${i < allSteps.length - 1 ? '<div style="width:16px; height:2px; background:' + (i < currentStep ? 'var(--cp-primary, #2d6a4f)' : '#e0e0e0') + '; margin:0 2px;"></div>' : ''}
      </div>`;
    }).join('')}</div>`;
  }

  renderAccountOverview() {
    const user = this.user || {};
    const points = user.rewardPoints || 0;
    const nextReward = user.nextRewardAt || 500;
    const progress = Math.min((points / nextReward) * 100, 100);

    return `
  <div class="cp-content-header" >
        <h2>Account Overview</h2>
        <p>Manage your profile and track your rewards</p>
      </div>
      
      <div class="cp-loyalty-tracker">
        <div class="cp-loyalty-header">
          <h4><i class="bi bi-star-fill"></i> Loyalty Points</h4>
          <span class="cp-loyalty-points">${points}</span>
        </div>
        <div class="cp-loyalty-progress">
          <div class="cp-loyalty-bar" style="width: ${progress}%"></div>
        </div>
        <div class="cp-loyalty-info">
          <span>${nextReward - points} points to next reward</span>
          <span>${user.tier || 'Member'}</span>
        </div>
      </div>
      
      <div class="cp-card">
        <div class="cp-card-header">
          <span class="cp-card-title"><i class="bi bi-person"></i> Personal Information</span>
          <button class="cp-btn-outline" style="padding: 0.5rem 1rem; font-size: 0.8rem" onclick="customerPortal.showEditProfile()">
            <i class="bi bi-pencil"></i> Edit
          </button>
        </div>
        <div class="cp-user-info">
          <div class="cp-info-item">
            <label>Full Name</label>
            <span>${_escHtml(user.fullName || 'Not set')}</span>
          </div>
          <div class="cp-info-item">
            <label>Email</label>
            <span>${user.email || 'Not set'}</span>
          </div>
          <div class="cp-info-item">
            <label>Phone</label>
            <span>${user.phone || 'Not set'}</span>
          </div>
          <div class="cp-info-item">
            <label>Address</label>
            <span>${user.address || 'Not set'}</span>
          </div>
        </div>
      </div>
      
      <div class="cp-card">
        <div class="cp-card-header">
          <span class="cp-card-title"><i class="bi bi-shield-lock"></i> Security</span>
        </div>
        <button class="cp-btn cp-btn-outline" style="width: auto" onclick="customerPortal.showChangePassword()">
          Change Password
        </button>
      </div>
`;
  }

  renderPromotions() {
    const promotions = this.promotions;
    const claimedMap = {};
    this.claimedPromotions.forEach(c => { claimedMap[c.promotionId] = c; });

    // Split into claimed and available
    const claimedPromos = promotions.filter(p => !!claimedMap[p.id]);
    const availablePromos = promotions.filter(p => !claimedMap[p.id]);

    // Also include claimed promos that may not be in the promotions list (e.g. expired but still claimed)
    const claimedPromoIds = new Set(claimedPromos.map(p => p.id));
    const extraClaimed = this.claimedPromotions.filter(c => !claimedPromoIds.has(c.promotionId));

    const renderClaimedCard = (promo, claim) => {
      const validDate = promo.validUntil ? new Date(promo.validUntil).toLocaleDateString() : '';
      const uniqueCode = claim?.uniqueCode || claim?.promoCode || promo.code;
      const discountText = claim?.discount || promo.discount || promo.type || '';
      const isUsed = !!claim?.used;

      return `
        <div class="cp-promo-card claimed ${isUsed ? 'cp-promo-used' : ''}">
          <div class="cp-promo-image" style="background-image: url('${promo.imageUrl || promo.image || ''}')">
            <span class="cp-promo-badge">${discountText}</span>
            <span class="cp-promo-claimed-badge ${isUsed ? 'cp-badge-used' : ''}">${isUsed ? 'Used' : 'Ready to Use'}</span>
          </div>
          <div class="cp-promo-content">
            <h4>${promo.title}</h4>
            <p>${promo.description || ''}</p>
            ${isUsed ? `
              <div style="font-size:0.85rem; color: var(--cp-text-light); margin-top: 6px;">
                This promotion has been redeemed
              </div>
            ` : `
              <div class="cp-promo-code">
                <span>Your promo code:</span>
                <strong onclick="navigator.clipboard.writeText('${uniqueCode}').then(()=>{this.style.color='var(--cp-success,#28a745)';this.textContent='Copied!';setTimeout(()=>{this.style.color='';this.textContent='${uniqueCode}'},1500)})" style="cursor:pointer; font-size: 1.1rem; letter-spacing: 2px;" title="Click to copy">${uniqueCode}</strong>
              </div>
              <div style="font-size:0.85rem; color: var(--cp-text-light); margin-top: 6px;">
                ${validDate ? `Valid until ${validDate} &bull; ` : ''}Use at checkout or show at restaurant
              </div>
            `}
          </div>
        </div>
      `;
    };

    const hasAnyClaimed = claimedPromos.length > 0 || extraClaimed.length > 0;
    const noPromosAtAll = promotions.length === 0 && !hasAnyClaimed;

    return `
      ${hasAnyClaimed ? `
        <div class="cp-content-header">
          <h2>My Promotions</h2>
          <p>Your claimed offers and promo codes</p>
        </div>
        <div class="cp-promo-grid">
          ${claimedPromos.map(promo => renderClaimedCard(promo, claimedMap[promo.id])).join('')}
          ${extraClaimed.map(claim => renderClaimedCard({
            id: claim.promotionId,
            title: claim.promotionTitle || 'Promotion',
            description: '',
            discount: claim.discount || '',
            code: claim.promoCode,
            validUntil: claim.validUntil,
            imageUrl: ''
          }, claim)).join('')}
        </div>
      ` : ''}

      ${availablePromos.length > 0 ? `
        <div class="cp-content-header" ${hasAnyClaimed ? 'style="margin-top: 2rem;"' : ''}>
          <h2>${hasAnyClaimed ? 'More Promotions' : 'Active Promotions'}</h2>
          <p>Exclusive offers just for you</p>
        </div>
        <div class="cp-promo-grid">
          ${availablePromos.map(promo => {
            const remainingText = promo.remainingClaims !== null
              ? `<span class="cp-promo-remaining">${promo.remainingClaims} remaining - claim fast!</span>`
              : '';
            return `
              <div class="cp-promo-card">
                <div class="cp-promo-image" style="background-image: url('${promo.imageUrl || promo.image || ''}')">
                  <span class="cp-promo-badge">${promo.discount || promo.type}</span>
                </div>
                <div class="cp-promo-content">
                  <h4>${promo.title}</h4>
                  <p>${promo.description}</p>
                  ${remainingText}
                  <button class="cp-promo-apply" onclick="customerPortal.claimPromo('${promo.id}', '${promo.code}')">
                    <i class="bi bi-gift"></i> Claim Offer
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${noPromosAtAll ? `
        <div class="cp-content-header">
          <h2>Promotions</h2>
          <p>Exclusive offers just for you</p>
        </div>
        <div class="cp-card" style="text-align: center; padding: 3rem">
          <i class="bi bi-tag" style="font-size: 3rem; opacity: 0.3"></i>
          <p style="color: var(--cp-text-light); margin-top: 1rem">No promotions available right now</p>
          <p style="color: var(--cp-text-light); font-size: 0.9rem">Check back soon for exclusive offers!</p>
        </div>
      ` : ''}

      ${!noPromosAtAll && availablePromos.length === 0 && !hasAnyClaimed ? '' : ''}
    `;
  }

  renderActiveOrders() {
    // Use all active orders (already filtered by time + status in loadUserOrders)
    const orders = this.activeOrders;

    return `
      <div class="cp-content-header">
        <h2>Active Orders</h2>
        <p>Track your current orders</p>
      </div>

      <div class="cp-order-list">
        ${orders.length === 0 ? `
          <div class="cp-card" style="text-align: center; padding: 3rem">
            <i class="bi bi-bag-check" style="font-size: 3rem; opacity: 0.3"></i>
            <p style="color: var(--cp-text-light); margin-top: 1rem">No active orders</p>
            <button class="cp-btn cp-btn-primary" style="margin-top: 1rem; width: auto; padding: 0.75rem 2rem;" onclick="customerPortal.hideFullPageDashboard()">
              Order Now
            </button>
          </div>
        ` : orders.map(order => {
          const isDelivery = order.orderType === 'delivery';
          const dd = order.doordash || {};
          const eta = dd.estimatedDropoffTime
            ? new Date(dd.estimatedDropoffTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : null;
          return `
          <div class="cp-order-card">
            <div class="cp-order-card-header">
              <div>
                <span class="cp-order-number">Order #${order.orderNumber || order.id.slice(-6).toUpperCase()}</span>
                ${isDelivery ? '<span style="font-size:0.75rem; background:#e3f2fd; color:#1565c0; padding:2px 8px; border-radius:4px; margin-left:6px;"><i class="bi bi-truck"></i> Delivery</span>' : ''}
                <span class="cp-order-date">${this.formatDateTime(order.createdAt)}</span>
              </div>
              <span class="cp-order-status-badge ${order.status}">${this.formatStatus(order.status, order.orderType)}</span>
            </div>
            <div class="cp-order-card-body">
              <div class="cp-order-items">
                ${order.items.map(item => `
                  <div class="cp-order-item-row">
                    <span>${item.quantity}x ${item.name}</span>
                    <span>$${(item.finalPrice * item.quantity).toFixed(2)}</span>
                  </div>
                `).join('')}
              </div>

              ${isDelivery ? `
              <div style="margin-top:10px; padding:12px; background:#f8f9ff; border-radius:8px; border-left:3px solid #1565c0;">
                <div style="font-weight:600; font-size:0.9rem; margin-bottom:8px;"><i class="bi bi-truck"></i> Delivery Details</div>
                <div style="font-size:0.85rem; color:var(--cp-text-light); margin-bottom:4px;"><i class="bi bi-geo-alt"></i> ${order.deliveryAddress?.fullAddress || 'Address on file'}</div>
                ${eta ? '<div style="font-size:0.85rem; color:var(--cp-text-light); margin-bottom:4px;"><i class="bi bi-clock"></i> Estimated arrival: <strong>' + eta + '</strong></div>' : ''}
                ${dd.dasherName ? '<div style="font-size:0.85rem; color:var(--cp-text-light); margin-bottom:4px;"><i class="bi bi-person-fill"></i> Driver: <strong>' + dd.dasherName + '</strong>' + (dd.dasherVehicle ? ' (' + dd.dasherVehicle.make + ' ' + dd.dasherVehicle.model + ')' : '') + '</div>' : ''}
                <div style="margin-top:8px;">${this.getDeliverySteps(dd.deliveryStatus || 'quoted', order.status)}</div>
                ${dd.trackingUrl ? '<a href="' + dd.trackingUrl + '" target="_blank" style="display:inline-block; margin-top:8px; padding:6px 14px; background:#1565c0; color:white; border-radius:6px; font-size:0.85rem; text-decoration:none;"><i class="bi bi-truck"></i> Track Live on DoorDash</a>' : ''}
              </div>
              ` : `
              <div style="margin-top:10px; padding:12px; background:#f5faf7; border-radius:8px; border-left:3px solid var(--cp-primary, #2d6a4f);">
                <div style="font-weight:600; font-size:0.9rem; margin-bottom:8px;"><i class="bi bi-bag-check"></i> Pickup Details</div>
                ${order.pickupTime ? '<div style="font-size:0.85rem; color:var(--cp-text-light); margin-bottom:8px;"><i class="bi bi-clock"></i> Pickup time: <strong>' + this.formatPickupTime(order.pickupTime) + '</strong></div>' : ''}
                <div style="margin-top:4px;">${this.getPickupSteps(order.status)}</div>
              </div>
              `}

              <div class="cp-order-card-footer" style="margin-top:8px;">
                ${isDelivery && order.deliveryFee ? '<div style="font-size:0.85rem; color:var(--cp-text-light);"><span>Delivery Fee (DoorDash): $' + order.deliveryFee.toFixed(2) + '</span>' + (order.driverTip ? ' &bull; Tip: $' + order.driverTip.toFixed(2) : '') + '</div>' : ''}
                <div class="cp-order-total-display">
                  <strong>Total: $${order.total.toFixed(2)}</strong>
                </div>
              </div>
            </div>
            ${!isDelivery && order.status === 'ready' ? `
              <div class="cp-order-ready-banner">
                <i class="bi bi-check-circle-fill"></i>
                Your order is ready for pickup!
              </div>
            ` : ''}
            ${isDelivery && order.status === 'out_for_delivery' ? `
              <div class="cp-order-ready-banner" style="background:#e3f2fd; color:#1565c0;">
                <i class="bi bi-truck"></i>
                Your order is on its way!
              </div>
            ` : ''}
          </div>
        `}).join('')}
      </div>
    `;
  }

  renderOrderHistory() {
    const completedStatuses = ['completed', 'picked_up', 'delivered', 'cancelled'];
    const orders = this.pastOrders.filter(o => completedStatuses.includes(o.status));

    return `
      <div class="cp-content-header">
        <h2>Past Orders</h2>
        <p>Your order history and quick reorder</p>
      </div>

      <div class="cp-order-list">
        ${orders.length === 0 ? `
          <div class="cp-card" style="text-align: center; padding: 3rem">
            <i class="bi bi-receipt" style="font-size: 3rem; opacity: 0.3"></i>
            <p style="color: var(--cp-text-light); margin-top: 1rem">No past orders yet</p>
          </div>
        ` : orders.map(order => `
          <div class="cp-order-row">
            <span class="cp-order-date">${this.formatDate(order.createdAt || order.date)}</span>
            <span class="cp-order-total">$${order.total.toFixed(2)}</span>
            <span class="cp-order-status ${order.status}">${this.formatStatus(order.status, order.orderType)}</span>
            <span style="flex: 1; color: var(--cp-text-light); font-size: 0.85rem">
              ${order.items.length} item${order.items.length > 1 ? 's' : ''}
            </span>
            <button class="cp-order-reorder" onclick="customerPortal.reorder('${order.id}')">
              <i class="bi bi-arrow-repeat"></i> Re-order
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  formatStatus(status, orderType) {
    const statusMap = {
      'new': 'Order Received',
      'pending': 'Pending',
      'confirmed': 'Confirmed',
      'sent_to_kitchen': 'Order Received',
      'preparing': 'Preparing',
      'ready': orderType === 'delivery' ? 'Awaiting Driver' : 'Ready for Pickup',
      'picked_up': 'Picked Up',
      'out_for_delivery': 'Out for Delivery',
      'completed': orderType === 'delivery' ? 'Delivered' : 'Completed',
      'delivered': 'Delivered',
      'delivery_failed': 'Delivery Failed',
      'cancelled': 'Cancelled'
    };
    return statusMap[status] || status.replace('_', ' ');
  }

  formatDateTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  formatPickupTime(timestamp) {
    if (!timestamp) return 'ASAP';
    const date = typeof timestamp === 'string' ? new Date(timestamp) :
      timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  renderDailySpin() {
    const config = this.rewardsConfig?.spinWheel;
    if (config && !config.enabled) {
      return `<div class="cp-card" style="text-align:center;padding:3rem">
        <i class="bi bi-stars" style="font-size:3rem;opacity:0.3"></i>
        <p style="color:var(--cp-text-light);margin-top:1rem">Spin wheel is currently unavailable</p>
      </div>`;
    }

    const canSpin = this.canSpin();
    const cooldownTime = this.getCooldownTime();
    const prizes = this.getSpinPrizes();

    // Build dynamic conic-gradient and segments from prizes
    const totalWeight = prizes.reduce((s, p) => s + p.weight, 0);
    let currentDeg = 0;
    const gradientParts = [];
    const segments = [];
    prizes.forEach(p => {
      const sliceDeg = (p.weight / totalWeight) * 360;
      const endDeg = currentDeg + sliceDeg;
      gradientParts.push(`${p.color} ${currentDeg.toFixed(1)}deg ${endDeg.toFixed(1)}deg`);
      const midDeg = currentDeg + sliceDeg / 2;
      segments.push(`<div class="cp-wheel-segment" style="transform: rotate(${midDeg.toFixed(1)}deg)">${p.icon || ''} ${p.name}</div>`);
      currentDeg = endDeg;
    });
    const gradient = `conic-gradient(from 0deg, ${gradientParts.join(', ')})`;

    // Show available rewards
    const activeRewards = this.customerRewards.filter(r => !r.used);
    const rewardsHtml = activeRewards.length > 0 ? `
      <div class="cp-my-rewards">
        <h4><i class="bi bi-trophy"></i> My Rewards</h4>
        <div class="cp-rewards-list">
          ${activeRewards.map(r => `
            <div class="cp-reward-card">
              <div class="cp-reward-info">
                <strong>${r.prizeName}</strong>
                <span>Code: ${r.rewardCode || 'N/A'}</span>
                <span class="cp-reward-expires">Expires: ${r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : 'N/A'}</span>
              </div>
              <span class="cp-reward-badge">Ready to Use</span>
            </div>
          `).join('')}
        </div>
        <p class="cp-rewards-hint">These rewards will be automatically available at checkout.</p>
      </div>
    ` : '';

    // Points summary
    const points = this.user?.rewardPoints || this.customerPoints || 0;
    const rc = this.rewardsConfig?.loyalty;
    const minRedeem = rc?.minRedeemPoints || 100;
    const redemptionRate = rc?.redemptionRate || 100;
    const canRedeem = points >= minRedeem;
    const redeemValue = (points / redemptionRate).toFixed(2);

    const pointsHtml = `
      <div class="cp-points-summary">
        <div class="cp-points-balance">
          <span class="cp-points-number">${points}</span>
          <span class="cp-points-label">Reward Points</span>
        </div>
        <div class="cp-points-detail">
          ${canRedeem
            ? `<span class="cp-points-redeemable">Worth <strong>$${redeemValue}</strong> at checkout!</span>`
            : `<span class="cp-points-needed">${minRedeem - points} more points to start redeeming</span>`
          }
          <span class="cp-points-rate">${rc?.pointsPerDollar || 1} point(s) per $1 spent &bull; ${redemptionRate} points = $1 discount</span>
        </div>
      </div>
    `;

    return `
      <div class="cp-content-header">
        <h2>Fun Rewards</h2>
        <p>Spin, earn, and save on your orders!</p>
      </div>

      ${pointsHtml}
      ${rewardsHtml}

      <div class="cp-spin-container">
        <div class="cp-spin-header">
          <h3><i class="bi bi-stars"></i> The Daily Kitchen Spin</h3>
          <p>Spin for a chance to win rewards!</p>
        </div>

        <div class="cp-wheel-wrapper">
          <div class="cp-wheel-pointer">▼</div>
          <div class="cp-wheel" id="cp-spin-wheel" style="background: ${gradient}">
            ${segments.join('')}
          </div>
        </div>

        ${canSpin ? `
          <button class="cp-spin-btn" id="cp-spin-btn" onclick="customerPortal.spin()">
            🎰 SPIN TO WIN!
          </button>
        ` : `
          <button class="cp-spin-btn" disabled>
            Come Back Later
          </button>
          <div class="cp-spin-cooldown">
            <i class="bi bi-hourglass-split"></i>
            <p>Next spin available in <span class="time">${cooldownTime}</span></p>
          </div>
        `}
      </div>
    `;
  }

  renderReviews() {
    return `
      <div class="cp-content-header">
        <h2><i class="bi bi-chat-quote"></i> Reviews</h2>
        <p>See what others are saying and share your experience</p>
      </div>
      <div id="cp-reviews-list" class="cp-reviews-list">
        <div class="cp-loading-container">
          <div class="cp-loading-spinner"></div>
          <div class="cp-loading-text">Loading reviews...</div>
        </div>
      </div>
      <div class="cp-review-form-section">
        <h3 class="cp-review-form-title">Write a Review</h3>
        <div class="cp-review-star-input" id="cp-review-star-input">
          <span>Your Rating:</span>
          <div class="cp-review-stars-select">
            ${[1,2,3,4,5].map(i => `<i class="bi bi-star" data-rating="${i}" onclick="customerPortal.setReviewRating(${i})" style="cursor:pointer;font-size:1.5rem;color:#d1d5db;transition:color 0.2s"></i>`).join('')}
          </div>
        </div>
        <div class="cp-form-group">
          <label class="cp-form-label">Name</label>
          <input type="text" class="cp-form-input" id="cp-review-name" placeholder="Your name" value="${_escHtml(this.user?.fullName || '')}" />
        </div>
        <div class="cp-form-group">
          <label class="cp-form-label">Email (optional)</label>
          <input type="email" class="cp-form-input" id="cp-review-email" placeholder="your@email.com" value="${this.user?.email || ''}" />
        </div>
        <div class="cp-form-group">
          <label class="cp-form-label">Your Review</label>
          <textarea class="cp-form-input cp-review-textarea" id="cp-review-text" placeholder="Tell us about your experience..." rows="4"></textarea>
        </div>
        <div id="cp-review-form-message"></div>
        <button class="cp-btn cp-btn-primary" id="cp-review-submit-btn" onclick="customerPortal.submitReview()">Submit Review</button>
      </div>
    `;
  }

  setReviewRating(rating) {
    this._selectedReviewRating = rating;
    const stars = document.querySelectorAll('#cp-review-star-input .cp-review-stars-select i');
    stars.forEach((star, i) => {
      star.className = i < rating ? 'bi bi-star-fill' : 'bi bi-star';
      star.style.color = i < rating ? '#f59e0b' : '#d1d5db';
    });
  }

  async submitReview() {
    const name = document.getElementById('cp-review-name')?.value?.trim();
    const email = document.getElementById('cp-review-email')?.value?.trim();
    const text = document.getElementById('cp-review-text')?.value?.trim();
    const rating = this._selectedReviewRating || 0;
    const msgEl = document.getElementById('cp-review-form-message');
    const btn = document.getElementById('cp-review-submit-btn');

    if (!name) { msgEl.innerHTML = '<div class="cp-alert cp-alert-error">Please enter your name.</div>'; return; }
    if (rating === 0) { msgEl.innerHTML = '<div class="cp-alert cp-alert-error">Please select a rating.</div>'; return; }
    if (!text) { msgEl.innerHTML = '<div class="cp-alert cp-alert-error">Please write a review.</div>'; return; }

    btn.disabled = true;
    btn.innerHTML = '<div class="cp-spinner"></div> Submitting...';
    msgEl.innerHTML = '';

    try {
      const resp = await fetch(this.config.apiBaseUrl + '/submitReview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: this.config.restaurantId,
          customerName: name,
          customerEmail: email,
          rating: rating,
          reviewText: text
        })
      });
      const data = await resp.json();
      if (data.success) {
        msgEl.innerHTML = '<div class="cp-alert cp-alert-success">Thank you! Your review has been submitted and will be visible after approval.</div>';
        document.getElementById('cp-review-text').value = '';
        this._selectedReviewRating = 0;
        this.setReviewRating(0);
      } else {
        msgEl.innerHTML = '<div class="cp-alert cp-alert-error">' + (data.error || 'Failed to submit review.') + '</div>';
      }
    } catch (err) {
      msgEl.innerHTML = '<div class="cp-alert cp-alert-error">Failed to submit review. Please try again.</div>';
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Submit Review';
    }
  }

  async loadApprovedReviews() {
    try {
      const resp = await fetch(this.config.apiBaseUrl + '/getApprovedReviews?restaurantId=' + this.config.restaurantId);
      const data = await resp.json();
      const container = document.getElementById('cp-reviews-list');
      if (!container) return;

      if (data.success && data.reviews && data.reviews.length > 0) {
        const reviews = data.reviews;
        const totalCount = reviews.length;
        const avgRating = (reviews.reduce((sum, r) => sum + r.rating, 0) / totalCount).toFixed(1);
        const avgStars = Array.from({length: 5}, (_, i) => {
          const diff = parseFloat(avgRating) - i;
          if (diff >= 0.75) return `<i class="bi bi-star-fill" style="color:#f59e0b;font-size:1.3rem"></i>`;
          if (diff >= 0.25) return `<i class="bi bi-star-half" style="color:#f59e0b;font-size:1.3rem"></i>`;
          return `<i class="bi bi-star" style="color:#d1d5db;font-size:1.3rem"></i>`;
        }).join('');

        const summaryHtml = `
          <div style="display:flex;align-items:center;gap:16px;padding:20px 24px;background:rgba(245,158,11,0.08);border-radius:12px;margin-bottom:20px;flex-wrap:wrap">
            <div style="font-size:2.8rem;font-weight:700;color:#f59e0b;line-height:1">${avgRating}</div>
            <div>
              <div style="margin-bottom:4px">${avgStars}</div>
              <div style="font-size:0.85rem;color:#6b7280">Based on ${totalCount} review${totalCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
        `;

        const reviewCards = reviews.map(r => {
          const stars = Array.from({length: 5}, (_, i) =>
            `<i class="bi bi-star${i < r.rating ? '-fill' : ''}" style="color:${i < r.rating ? '#f59e0b' : '#d1d5db'};font-size:0.9rem"></i>`
          ).join('');
          const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
          return `
            <div class="cp-review-card">
              <div class="cp-review-card-header">
                <strong>${r.customerName}</strong>
                <span class="cp-review-date">${dateStr}</span>
              </div>
              <div class="cp-review-card-stars">${stars}</div>
              <p class="cp-review-card-text">${r.reviewText}</p>
            </div>
          `;
        }).join('');

        container.innerHTML = summaryHtml + reviewCards;
      } else {
        container.innerHTML = '<div class="cp-review-empty"><i class="bi bi-chat-quote" style="font-size:2.5rem;color:#d1d5db;display:block;margin-bottom:0.75rem"></i>No reviews yet. Be the first to share your experience!</div>';
      }
    } catch (e) {
      const container = document.getElementById('cp-reviews-list');
      if (container) {
        container.innerHTML = '<div class="cp-review-empty"><i class="bi bi-chat-quote" style="font-size:2.5rem;color:#d1d5db;display:block;margin-bottom:0.75rem"></i>No reviews yet. Be the first to share your experience!</div>';
      }
    }
  }

  attachDashboardListeners() {
    // Nav item clicks
    const navItems = this.modal.querySelectorAll('.cp-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.currentView = item.dataset.view;
        this.refreshDashboard();
      });
    });
  }

  refreshDashboard() {
    const content = this.modal.querySelector('#cp-dashboard-content');
    if (content) {
      content.innerHTML = this.renderDashboardContent();
    }

    // Update nav active state
    const navItems = this.modal.querySelectorAll('.cp-nav-item');
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === this.currentView);
    });

    // Load reviews data if on reviews tab
    if (this.currentView === 'reviews') {
      this.loadApprovedReviews();
    }
  }

  // =========================================
  // Daily Spin Logic
  // =========================================

  getSpinCooldownHours() {
    return this.rewardsConfig?.spinWheel?.cooldownHours || 24;
  }

  getSpinPrizes() {
    return this.rewardsConfig?.spinWheel?.prizes || window.MockData?.prizes || [
      { id: 'p1', name: '10 Points', type: 'points', value: 10, weight: 30, color: '#3498db', icon: '⭐' },
      { id: 'p2', name: '25 Points', type: 'points', value: 25, weight: 20, color: '#2ecc71', icon: '🌟' },
      { id: 'p3', name: '50 Points', type: 'points', value: 50, weight: 10, color: '#e74c3c', icon: '💎' },
      { id: 'p4', name: '5% Off', type: 'discount', value: 5, weight: 15, color: '#f39c12', icon: '🎫' },
      { id: 'p5', name: '10% Off', type: 'discount', value: 10, weight: 8, color: '#9b59b6', icon: '🏷️' },
      { id: 'p6', name: 'Try Again', type: 'none', value: 0, weight: 17, color: '#95a5a6', icon: '🔄' }
    ];
  }

  canSpin() {
    const lastSpin = localStorage.getItem('cp_lastSpin');
    if (!lastSpin) return true;

    const lastSpinTime = parseInt(lastSpin, 10);
    const now = Date.now();
    const hoursSince = (now - lastSpinTime) / (1000 * 60 * 60);

    return hoursSince >= this.getSpinCooldownHours();
  }

  getCooldownTime() {
    const lastSpin = localStorage.getItem('cp_lastSpin');
    if (!lastSpin) return '0h 0m';

    const cooldownMs = this.getSpinCooldownHours() * 60 * 60 * 1000;
    const lastSpinTime = parseInt(lastSpin, 10);
    const nextSpinTime = lastSpinTime + cooldownMs;
    const now = Date.now();
    const remaining = nextSpinTime - now;

    if (remaining <= 0) return '0h 0m';

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  }

  spin() {
    if (this.isSpinning || !this.canSpin()) return;

    this.isSpinning = true;
    const wheel = document.getElementById('cp-spin-wheel');
    const spinBtn = document.getElementById('cp-spin-btn');

    if (!wheel || !spinBtn) return;

    spinBtn.disabled = true;
    spinBtn.textContent = 'Spinning...';

    // Get prizes with weights (dynamic from config)
    const prizes = this.getSpinPrizes();
    if (prizes.length === 0) return;

    // Weighted random selection
    const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedPrize = prizes[0];

    for (const prize of prizes) {
      random -= prize.weight;
      if (random <= 0) {
        selectedPrize = prize;
        break;
      }
    }

    // Calculate target rotation dynamically based on prize weights
    let currentDeg = 0;
    let targetSegment = 0;
    for (const prize of prizes) {
      const sliceDeg = (prize.weight / totalWeight) * 360;
      if (prize.id === selectedPrize.id || prize === selectedPrize) {
        targetSegment = currentDeg + sliceDeg / 2; // Center of segment
        break;
      }
      currentDeg += sliceDeg;
    }

    const rotations = 5 + Math.floor(Math.random() * 4);
    const targetDeg = (rotations * 360) + (360 - targetSegment);

    wheel.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    wheel.style.transform = `rotate(${targetDeg}deg)`;

    // Save spin time (keep localStorage for initial check, but also save to Firestore)
    localStorage.setItem('cp_lastSpin', Date.now().toString());

    // Show result after animation
    setTimeout(async () => {
      this.isSpinning = false;
      this.showPrizeModal(selectedPrize);

      // Save result to Firestore via Cloud Function
      if (typeof firebase !== 'undefined' && firebase.functions) {
        try {
          const saveDailySpinResult = firebase.functions().httpsCallable('saveDailySpinResult');
          const result = await saveDailySpinResult({
            restaurantId: this.config.restaurantId,
            prizeId: selectedPrize.id,
            prizeName: selectedPrize.name,
            prizeType: selectedPrize.type,
            prizeValue: selectedPrize.value
          });

          if (result.data.success) {
            this.spinInfo.streak = result.data.streak;
            // Add reward to local list so it appears immediately in My Rewards
            if (selectedPrize.type !== 'none' && result.data.rewardCode) {
              this.customerRewards.push({
                prizeName: selectedPrize.name,
                prizeType: selectedPrize.type,
                prizeValue: selectedPrize.value,
                rewardCode: result.data.rewardCode,
                used: false,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                source: 'daily_spin'
              });
            }
          }
        } catch (err) {
          console.error('Error saving spin result:', err);
        }
      }

      // Add points if applicable
      if (selectedPrize.type === 'points' && this.user) {
        this.user.rewardPoints = (this.user.rewardPoints || 0) + selectedPrize.value;
        localStorage.setItem('cp_user', JSON.stringify(this.user));
      }

      // Refresh dashboard to show cooldown
      this.refreshDashboard();
    }, 4500);
  }

  // =========================================
  // Actions
  // =========================================

  async claimPromo(promoId, code) {
    if (!this.isAuthenticated) {
      this.showAuth('signin');
      return;
    }

    try {
      if (typeof firebase !== 'undefined' && firebase.functions) {
        const claimPromotion = firebase.functions().httpsCallable('claimPromotion');
        const result = await claimPromotion({
          restaurantId: this.config.restaurantId,
          promotionId: promoId
        });

        if (result.data.success) {
          // Add to claimed list with unique code from server
          this.claimedPromotions.push({
            promotionId: promoId,
            promoCode: result.data.promoCode || code,
            uniqueCode: result.data.uniqueCode,
            discount: result.data.discount,
            discountValue: result.data.discountValue,
            discountUnit: result.data.discountUnit,
            type: result.data.type,
            used: false
          });

          // Re-render dashboard to show claimed state (no popup)
          if (this.config.embedMode && typeof embedApp !== 'undefined') {
            this.showDashboard();
          } else {
            this.renderFullPageDashboard();
          }
        }
      } else {
        // Fallback for mock mode
        this.applyPromo(code);
      }
    } catch (err) {
      console.error('Error claiming promotion:', err);
      this.showToast(err.message || 'Failed to claim promotion. Please try again.', 'error');
    }
  }

  applyPromo(code) {
    // Copy promo code and notify user
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      this.showToast(`Promo code "${code}" copied to clipboard! Apply it at checkout.`);
    } else {
      this.showToast(`Your promo code is: ${code}. Apply it at checkout.`);
    }
  }

  reorder(orderId) {
    // Find order from our loaded orders
    const allOrders = [...this.activeOrders, ...this.pastOrders];
    const order = allOrders.find(o => o.id === orderId);

    if (order && order.items) {
      // Embed mode: use embedApp's cart
      if (this.config.embedMode && typeof embedApp !== 'undefined') {
        order.items.forEach(item => {
          const cartItem = {
            id: item.id,
            name: item.name,
            price: item.price,
            finalPrice: item.finalPrice || item.price,
            discount: item.discount || 0,
            discountType: item.discountType || 'amount'
          };
          for (let i = 0; i < (item.quantity || 1); i++) {
            embedApp.addToCart(cartItem, item.notes || item.specialInstructions || '', item.spiceLevel || '');
          }
        });
        embedApp.updateCartBar();
        this.showToast(`Added ${order.items.length} items to your cart!`);
        embedApp.switchView('menu');
        return;
      }

      // Website builder mode: use global cart
      if (typeof window.cart !== 'undefined' && typeof window.saveCart === 'function') {
        order.items.forEach(item => {
          const existing = window.cart.find(i => i.id === item.id);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            window.cart.push({
              id: item.id,
              name: item.name,
              price: item.price,
              finalPrice: item.finalPrice || item.price,
              quantity: item.quantity
            });
          }
        });
        window.saveCart();
        if (typeof window.updateCartUI === 'function') {
          window.updateCartUI();
        }
        this.showToast(`Added ${order.items.length} items to your cart!`);
        this.hideFullPageDashboard();
      } else {
        this.showToast(`To re-order, please add these items from the menu: ${order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}`);
      }
    } else {
      this.showToast('Could not find order details. Please try again.', 'error');
    }
  }

  showEditProfile() {
    this.showToast('Edit Profile coming soon!', 'info');
  }

  showChangePassword() {
    this.showToast('Change Password coming soon!', 'info');
  }

  // =========================================
  // Utilities
  // =========================================

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  showToast(message, type = 'success') {
    // Remove existing toast if any
    const existing = document.querySelector('.cp-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `cp-toast cp-toast-${type}`;
    toast.innerHTML = `<span>${type === 'error' ? '⚠' : '✓'} ${message}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;font-size:1.2rem;cursor:pointer;padding:0 0 0 12px;">×</button>`;

    // Insert at top of portal container or body
    const container = document.querySelector('.cp-dashboard') || document.querySelector('.cp-portal') || document.body;
    container.insertBefore(toast, container.firstChild);

    setTimeout(() => { if (toast.parentElement) toast.remove(); }, type === 'error' ? 6000 : 4000);
  }
}

// Export for use
if (typeof window !== 'undefined') {
  window.CustomerPortal = CustomerPortal;
}
