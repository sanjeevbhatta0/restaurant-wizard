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
    if (!this.isAuthenticated || !this.user?.email) return;

    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        const db = firebase.firestore();
        const ordersRef = db.collection('restaurants')
          .doc(this.config.restaurantId)
          .collection('orders')
          .where('customer.email', '==', this.user.email)
          .orderBy('createdAt', 'desc')
          .limit(50);

        const snapshot = await ordersRef.get();
        const allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Separate active and past orders
        const activeStatuses = ['pending', 'confirmed', 'preparing', 'ready'];
        this.activeOrders = allOrders.filter(o => activeStatuses.includes(o.status));
        this.pastOrders = allOrders.filter(o => !activeStatuses.includes(o.status));

        console.log(`Loaded ${this.activeOrders.length} active orders, ${this.pastOrders.length} past orders`);
      }
    } catch (err) {
      console.error('Error loading orders:', err);
    }
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

    // Load orders first
    await this.loadUserOrders();

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
    const promotions = window.MockData?.promotions || [];

    return `
  <div class="cp-content-header" >
        <h2>Active Promotions</h2>
        <p>Exclusive offers just for you</p>
      </div>

  <div class="cp-promo-grid">
    ${promotions.map(promo => `
          <div class="cp-promo-card">
            <div class="cp-promo-image" style="background-image: url('${promo.image}')">
              <span class="cp-promo-badge">${promo.discount}</span>
            </div>
            <div class="cp-promo-content">
              <h4>${promo.title}</h4>
              <p>${promo.description}</p>
              <button class="cp-promo-apply" onclick="customerPortal.applyPromo('${promo.code}')">
                Apply to Order
              </button>
            </div>
          </div>
        `).join('')}
  </div>
`;
  }

  renderActiveOrders() {
    const activeStatuses = ['pending', 'confirmed', 'preparing', 'ready'];
    const orders = this.activeOrders.filter(o => activeStatuses.includes(o.status));

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

    // Save spin time
    localStorage.setItem('cp_lastSpin', Date.now().toString());

    // Show result after animation
    setTimeout(() => {
      this.isSpinning = false;
      this.showPrizeModal(selectedPrize);

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
    const orders = window.MockData?.orders || [];
    const order = orders.find(o => o.id === orderId);

    if (order) {
      // In production, would add items to cart
      alert(`Re - ordering ${order.items.length} items from order ${order.orderNumber}. This would add items to your cart.`);
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
