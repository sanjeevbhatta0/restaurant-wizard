/**
 * Customer Portal - Main JavaScript
 * 
 * Modular Customer Portal that inherits parent template theming.
 * Works with Firebase Auth for authentication and Firestore for data.
 */

class CustomerPortal {
  constructor(config = {}) {
    this.config = {
      restaurantId: config.restaurantId || '',
      themeConfig: config.themeConfig || {},
      firebaseConfig: config.firebaseConfig || null,
      useMockData: config.useMockData !== false // Default true for development
    };

    // State
    this.user = null;
    this.isAuthenticated = false;
    this.currentView = 'account'; // account, active_orders, orders, promotions, rewards
    this.isSpinning = false;
    this.checkoutPending = false;
    this.activeOrders = [];
    this.pastOrders = [];
    this.promotions = [];
    this.customerRewards = [];
    this.claimedPromotions = [];
    this.spinInfo = { streak: 0, lastSpinDate: null };

    // DOM elements (created on init)
    this.overlay = null;
    this.modal = null;
    this.portalRoot = null;

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

    // Check for existing session
    this.checkSession();

    // Update nav link based on auth state
    this.updateNavLink();

    console.log('Customer Portal initialized');
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
          } else {
            this.user = null;
            this.isAuthenticated = false;
          }
          this.updateNavLink();
        });
      }
    }
  }

  updateNavLink() {
    const navLink = document.getElementById('portal-nav-link');
    if (navLink) {
      if (this.isAuthenticated && this.user) {
        navLink.innerHTML = `<i class="bi bi-person-circle"></i> ${this.user.fullName.split(' ')[0]}`;
      } else {
        navLink.innerHTML = '<i class="bi bi-person-circle"></i> My Account';
      }
    }
  }

  async loadUserOrders() {
    if (!this.isAuthenticated || !this.user?.email) {
      console.log('loadUserOrders: Not authenticated or no email');
      return;
    }

    console.log('loadUserOrders: Loading for email:', this.user.email, 'restaurant:', this.config.restaurantId);

    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        const db = firebase.firestore();

        // Query without orderBy to avoid needing composite index
        // We'll sort client-side instead
        const ordersRef = db.collection('restaurants')
          .doc(this.config.restaurantId)
          .collection('orders')
          .where('customer.email', '==', this.user.email)
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
        const activeStatuses = ['new', 'pending', 'confirmed', 'preparing', 'ready'];

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
      const apiBaseUrl = this.config.apiBaseUrl || 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net';
      const response = await fetch(`${apiBaseUrl}/getPromotions?restaurantId=${this.config.restaurantId}`);
      const data = await response.json();

      if (data.success && data.promotions) {
        this.promotions = data.promotions;
        console.log(`Loaded ${this.promotions.length} promotions`);
      }
    } catch (err) {
      console.error('Error loading promotions:', err);
      // Fall back to mock data if available
      this.promotions = window.MockData?.promotions || [];
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
            }
          } catch (err) {
            console.log('Could not load rewards via function:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Error loading customer data:', err);
    }
  }

  calculateTier(points) {
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
    const accountPage = document.getElementById('account-page-container');

    // Load all data in parallel
    await Promise.all([
      this.loadUserOrders(),
      this.loadPromotions(),
      this.loadCustomerData()
    ]);

    // Create container if missing
    if (!accountPage) {
      const div = document.createElement('div');
      div.id = 'account-page-container';
      div.className = 'customer-portal'; // Add class to inherit CSS variables
      div.style.display = 'none';
      document.body.appendChild(div);
      this.renderFullPageDashboard();
    } else {
      this.renderFullPageDashboard();
    }

    // Toggle views
    if (mainContent) mainContent.style.display = 'none';
    const container = document.getElementById('account-page-container');
    container.style.display = 'block';

    // Scroll to top
    window.scrollTo(0, 0);
  }

  hideFullPageDashboard() {
    const mainContent = document.getElementById('main-content');
    const accountPage = document.getElementById('account-page-container');

    if (mainContent) mainContent.style.display = 'block';
    if (accountPage) accountPage.style.display = 'none';

    // Scroll to top
    window.scrollTo(0, 0);
  }

  showAuth(mode = 'signin') {
    this.modal.innerHTML = this.renderAuth(mode);
    this.overlay.classList.add('active');
    this.modal.classList.add('active');

    // Attach event listeners
    this.attachAuthListeners();
  }

  showDashboard() {
    this.modal.innerHTML = this.renderDashboard();
    this.overlay.classList.add('active');
    this.modal.classList.add('active');

    // Attach event listeners
    this.attachDashboardListeners();
  }

  close() {
    this.overlay.classList.remove('active');
    this.modal.classList.remove('active');
  }

  showPrizeModal(prize) {
    const prizeModal = document.createElement('div');
    prizeModal.className = 'cp-modal cp-prize-modal active';
    prizeModal.innerHTML = `
      <button class="cp-modal-close" onclick="customerPortal.closePrizeModal()">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="cp-prize-icon">${prize.icon}</div>
      <h3>${prize.type === 'none' ? 'Oh no!' : 'Congratulations!'}</h3>
      <p>${prize.message}</p>
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
    return `
      <button class="cp-modal-close" onclick="customerPortal.close()">
        <i class="bi bi-x-lg"></i>
      </button>
      <div class="cp-auth-container">
        <div class="cp-auth-header">
          <h2>Welcome</h2>
          <p>Sign in to access your account and rewards</p>
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
              <label class="cp-form-label">Phone Number</label>
              <input type="tel" class="cp-form-input" name="phone" placeholder="(555) 123-4567">
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
      }

      // Update nav and load orders
      this.updateNavLink();
      await this.loadUserOrders();

      this.close();

      if (this.checkoutPending) {
        this.checkoutPending = false;
        if (window.openCheckout) window.openCheckout();
      } else {
        this.showFullPageDashboard();
      }

    } catch (error) {
      let message = error.message;
      // Friendly Firebase error messages
      if (error.code === 'auth/user-not-found') message = 'No account found with this email';
      if (error.code === 'auth/wrong-password') message = 'Incorrect password';
      if (error.code === 'auth/invalid-email') message = 'Invalid email address';

      alertBox.innerHTML = `<div class="cp-alert cp-alert-error">${message}</div>`;
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="btn-text">Sign In</span>';
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
        phone: data.phone || '',
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

      // Show welcome message then dashboard
      alertBox.innerHTML = `<div class="cp-alert cp-alert-success">
        🎉 Welcome! You've earned 100 bonus points!
      </div>`;

      await this.delay(1500);

      // Update nav and load orders
      this.updateNavLink();
      await this.loadUserOrders();

      this.close();

      if (this.checkoutPending) {
        this.checkoutPending = false;
        if (window.openCheckout) window.openCheckout();
      } else {
        this.showFullPageDashboard();
      }

    } catch (error) {
      let message = error.message;
      // Friendly Firebase error messages
      if (error.code === 'auth/email-already-in-use') message = 'An account with this email already exists';
      if (error.code === 'auth/invalid-email') message = 'Invalid email address';
      if (error.code === 'auth/weak-password') message = 'Password is too weak';

      alertBox.innerHTML = `<div class="cp-alert cp-alert-error">${message}</div>`;
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
    localStorage.removeItem('cp_user');
    localStorage.removeItem('cp_lastSpin');
    this.updateNavLink();
    this.updateNavLink();
    this.close();
    this.hideFullPageDashboard();
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
            <h3>${user.fullName || 'Guest'}</h3>
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
        return this.renderOrderHistory();
      case 'promotions':
        return this.renderPromotions();
      case 'rewards':
        return this.renderDailySpin();
      default:
        return this.renderAccountOverview();
    }
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
            <span>${user.fullName || 'Not set'}</span>
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
    const promotions = this.promotions.length > 0 ? this.promotions : (window.MockData?.promotions || []);
    const claimedIds = new Set(this.claimedPromotions.map(c => c.promotionId));

    return `
      <div class="cp-content-header">
        <h2>Active Promotions</h2>
        <p>Exclusive offers just for you</p>
      </div>

      ${promotions.length === 0 ? `
        <div class="cp-card" style="text-align: center; padding: 3rem">
          <i class="bi bi-tag" style="font-size: 3rem; opacity: 0.3"></i>
          <p style="color: var(--cp-text-light); margin-top: 1rem">No promotions available right now</p>
          <p style="color: var(--cp-text-light); font-size: 0.9rem">Check back soon for exclusive offers!</p>
        </div>
      ` : `
        <div class="cp-promo-grid">
          ${promotions.map(promo => {
      const isClaimed = claimedIds.has(promo.id);
      const remainingText = promo.remainingClaims !== null
        ? `<span class="cp-promo-remaining">${promo.remainingClaims} remaining - claim fast!</span>`
        : '';

      return `
              <div class="cp-promo-card ${isClaimed ? 'claimed' : ''}">
                <div class="cp-promo-image" style="background-image: url('${promo.imageUrl || promo.image || 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=250&fit=crop'}')"> 
                  <span class="cp-promo-badge">${promo.discount || promo.type}</span>
                  ${isClaimed ? '<span class="cp-promo-claimed-badge">✓ Claimed</span>' : ''}
                </div>
                <div class="cp-promo-content">
                  <h4>${promo.title}</h4>
                  <p>${promo.description}</p>
                  ${remainingText}
                  ${isClaimed ? `
                    <div class="cp-promo-code">
                      <span>Your code:</span>
                      <strong>${promo.code}</strong>
                    </div>
                  ` : `
                    <button class="cp-promo-apply" onclick="customerPortal.claimPromo('${promo.id}', '${promo.code}')">
                      <i class="bi bi-gift"></i> Claim Offer
                    </button>
                  `}
                </div>
              </div>
            `;
    }).join('')}
        </div>
      `}
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
        ` : orders.map(order => `
          <div class="cp-order-card">
            <div class="cp-order-card-header">
              <div>
                <span class="cp-order-number">Order #${order.orderNumber || order.id.slice(-6).toUpperCase()}</span>
                <span class="cp-order-date">${this.formatDateTime(order.createdAt)}</span>
              </div>
              <span class="cp-order-status-badge ${order.status}">${this.formatStatus(order.status)}</span>
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
              <div class="cp-order-card-footer">
                <div class="cp-order-pickup">
                  <i class="bi bi-clock"></i>
                  <span>Pickup: ${this.formatPickupTime(order.pickupTime)}</span>
                </div>
                <div class="cp-order-total-display">
                  <strong>Total: $${order.total.toFixed(2)}</strong>
                </div>
              </div>
            </div>
            ${order.status === 'ready' ? `
              <div class="cp-order-ready-banner">
                <i class="bi bi-check-circle-fill"></i>
                Your order is ready for pickup!
              </div>
            ` : ''}
          </div>
        `).join('')}
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
            <span class="cp-order-status ${order.status}">${this.formatStatus(order.status)}</span>
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

  formatStatus(status) {
    const statusMap = {
      'new': 'Order Received',
      'pending': 'Pending',
      'confirmed': 'Confirmed',
      'preparing': 'Preparing',
      'ready': 'Ready for Pickup',
      'picked_up': 'Picked Up',
      'completed': 'Completed',
      'delivered': 'Delivered',
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
    const canSpin = this.canSpin();
    const cooldownTime = this.getCooldownTime();

    return `
  <div class="cp-spin-container" >
        <div class="cp-spin-header">
          <h3><i class="bi bi-stars"></i> The Daily Kitchen Spin</h3>
          <p>Spin once every 24 hours for a chance to win rewards!</p>
        </div>
        
        <div class="cp-wheel-wrapper">
          <div class="cp-wheel-pointer">▼</div>
          <div class="cp-wheel" id="cp-spin-wheel">
            <div class="cp-wheel-segment" style="transform: rotate(72deg)">Try Again</div>
            <div class="cp-wheel-segment" style="transform: rotate(180deg)">10% Off</div>
            <div class="cp-wheel-segment" style="transform: rotate(243deg)">50 Points</div>
            <div class="cp-wheel-segment" style="transform: rotate(288deg)">2x Points</div>
            <div class="cp-wheel-segment" style="transform: rotate(324deg)">Free Drink</div>
            <div class="cp-wheel-segment" style="transform: rotate(351deg)">Free Dessert</div>
          </div>
        </div>
        
        ${canSpin ? `
          <button class="cp-spin-btn" id="cp-spin-btn" onclick="customerPortal.spin()">
            🎰 SPIN TO WIN!
          </button>
        ` : `
          <button class="cp-spin-btn" disabled>
            Come Back Tomorrow
          </button>
          <div class="cp-spin-cooldown">
            <i class="bi bi-hourglass-split"></i>
            <p>Next spin available in <span class="time">${cooldownTime}</span></p>
          </div>
        `}
      </div>
  `;
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
  }

  // =========================================
  // Daily Spin Logic
  // =========================================

  canSpin() {
    const lastSpin = localStorage.getItem('cp_lastSpin');
    if (!lastSpin) return true;

    const lastSpinTime = parseInt(lastSpin, 10);
    const now = Date.now();
    const hoursSince = (now - lastSpinTime) / (1000 * 60 * 60);

    return hoursSince >= 24;
  }

  getCooldownTime() {
    const lastSpin = localStorage.getItem('cp_lastSpin');
    if (!lastSpin) return '0h 0m';

    const lastSpinTime = parseInt(lastSpin, 10);
    const nextSpinTime = lastSpinTime + (24 * 60 * 60 * 1000);
    const now = Date.now();
    const remaining = nextSpinTime - now;

    if (remaining <= 0) return '0h 0m';

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes} m`;
  }

  spin() {
    if (this.isSpinning || !this.canSpin()) return;

    this.isSpinning = true;
    const wheel = document.getElementById('cp-spin-wheel');
    const spinBtn = document.getElementById('cp-spin-btn');

    if (!wheel || !spinBtn) return;

    spinBtn.disabled = true;
    spinBtn.textContent = 'Spinning...';

    // Get prizes with weights
    const prizes = window.MockData?.prizes || [];

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

    // Calculate target rotation
    // Segments: Try Again (0-144°), 10% Off (144-216°), 50 Points (216-270°), 
    //           Double Points (270-306°), Free Drink (306-342°), Free Dessert (342-360°)
    const segmentMap = {
      'try_again': 72,      // Center of 0-144°
      'discount_10': 180,   // Center of 144-216°
      'bonus_50': 243,      // Center of 216-270°
      'double_points': 288, // Center of 270-306°
      'free_drink': 324,    // Center of 306-342°
      'free_dessert': 351   // Center of 342-360°
    };

    const targetSegment = segmentMap[selectedPrize.id] || 72;
    // Spin 5-8 full rotations plus offset to land on segment
    // The pointer is at top, so we need to position the segment at top (0° visual position)
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
            console.log('Spin saved! Streak:', result.data.streak);
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
          // Add to claimed list
          this.claimedPromotions.push({ promotionId: promoId, promoCode: code });

          // Show success message
          alert(`🎉 Promotion claimed! Your code is: ${code}\n\nUse this code at checkout to get your discount.`);

          // Refresh promotions view
          this.renderFullPageDashboard();
        }
      } else {
        // Fallback for mock mode
        this.applyPromo(code);
      }
    } catch (err) {
      console.error('Error claiming promotion:', err);
      alert(err.message || 'Failed to claim promotion. Please try again.');
    }
  }

  applyPromo(code) {
    // Copy promo code and notify user
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      alert(`Promo code "${code}" copied to clipboard! Apply it at checkout.`);
    } else {
      prompt('Copy this promo code:', code);
    }
  }

  reorder(orderId) {
    // Find order from our loaded orders
    const allOrders = [...this.activeOrders, ...this.pastOrders];
    const order = allOrders.find(o => o.id === orderId);

    if (order && order.items) {
      // Add items to cart (assumes global cart array exists)
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
        alert(`Added ${order.items.length} items to your cart!`);
        this.hideFullPageDashboard();
      } else {
        alert(`To re-order, please add these items to your cart:\n\n${order.items.map(i => `• ${i.quantity}x ${i.name}`).join('\n')}`);
      }
    } else {
      alert('Could not find order details. Please try again.');
    }
  }

  showEditProfile() {
    alert('Edit Profile form would open here. This is a placeholder for the full implementation.');
  }

  showChangePassword() {
    alert('Change Password form would open here. This is a placeholder for the full implementation.');
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
}

// Export for use
if (typeof window !== 'undefined') {
  window.CustomerPortal = CustomerPortal;
}
