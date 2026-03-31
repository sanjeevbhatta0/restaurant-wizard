/**
 * Koda Carte — Embed Application
 *
 * Full standalone experience for the embeddable widget.
 * Handles: menu browsing, cart, checkout, and view orchestration.
 * Delegates to CustomerPortal for account/orders/promotions/rewards.
 */
class EmbedApp {
  constructor(config) {
    this.config = config;
    this.cart = [];
    this.menuData = [];
    this.activeCategory = null;
    this.currentView = config.initialTab || 'menu';
    this.portal = null;
    this.cartOpen = false;
    this.checkoutOpen = false;
    this.orderPlaced = false;
    this.stripe = null;
    this.cardElement = null;
    this.selectedPaymentMethod = 'payLater'; // 'payLater' or 'payNow'
    this.portalDataLoaded = false;

    this.init();
  }

  async init() {
    this.loadCartFromStorage();
    this.initStripe();
    this.renderShell();
    await this.loadMenu();
    this.initPortal();
    this.listenForMessages();
    this.notifyParent('koda-embed-ready');
  }

  initStripe() {
    const key = this.config.stripeKey;
    if (key && key.startsWith('pk_') && typeof Stripe !== 'undefined') {
      try {
        const opts = this.config.stripeConnectedAccountId ? { stripeAccount: this.config.stripeConnectedAccountId } : {};
        this.stripe = Stripe(key, opts);
      } catch (err) {
        console.error('Stripe init error:', err);
      }
    }
  }

  // =============================================
  // Shell / Layout
  // =============================================
  renderShell() {
    const root = document.getElementById('embed-root');
    root.innerHTML = `
      <div class="ea-app">
        <div id="ea-view-menu" class="ea-view ea-active">
          <div id="ea-menu-loading" class="ea-loading">
            <div class="ea-spinner"></div>
            <p>Loading menu...</p>
          </div>
          <div id="ea-menu-content" style="display:none;">
            <div id="ea-categories" class="ea-categories"></div>
            <div id="ea-items" class="ea-items-grid"></div>
          </div>
        </div>
        <div id="ea-view-account" class="ea-view">
          <div id="customer-portal-root" class="customer-portal"></div>
        </div>
        <div id="ea-cart-bar" class="ea-cart-bar ea-hidden" onclick="embedApp.toggleCart()">
          <div class="ea-cart-bar-left">
            <span class="ea-cart-count" id="ea-cart-count">0</span>
            <span>items in cart</span>
          </div>
          <div class="ea-cart-bar-right">
            <span id="ea-cart-total">$0.00</span>
            <span class="ea-cart-bar-btn">View Cart</span>
          </div>
        </div>
        <div id="ea-cart-overlay" class="ea-cart-overlay ea-hidden" onclick="embedApp.toggleCart()"></div>
        <div id="ea-cart-panel" class="ea-cart-panel ea-hidden">
          <div class="ea-cart-header">
            <h3>Your Cart</h3>
            <button class="ea-cart-close" onclick="embedApp.toggleCart()">&times;</button>
          </div>
          <div id="ea-cart-items" class="ea-cart-items"></div>
          <div id="ea-cart-summary" class="ea-cart-summary"></div>
        </div>
        <div id="ea-checkout" class="ea-checkout ea-hidden"></div>
      </div>
    `;
  }

  // =============================================
  // Menu Loading (with pre-injection + cache)
  // =============================================
  getMenuCacheKey() {
    return `ea_menu_${this.config.restaurantId}_${this.config.locationId || 'all'}`;
  }

  getCachedMenu() {
    try {
      const raw = localStorage.getItem(this.getMenuCacheKey());
      if (!raw) return null;
      const cached = JSON.parse(raw);
      // 5-minute TTL
      if (Date.now() - cached.ts > 5 * 60 * 1000) {
        localStorage.removeItem(this.getMenuCacheKey());
        return null;
      }
      return cached.data;
    } catch { return null; }
  }

  cacheMenu(data) {
    try {
      localStorage.setItem(this.getMenuCacheKey(), JSON.stringify({ data, ts: Date.now() }));
    } catch { /* quota exceeded — ignore */ }
  }

  async loadMenu() {
    try {
      // Priority 1: Server-side preloaded menu (instant, no network)
      if (typeof PRELOADED_MENU !== 'undefined' && Array.isArray(PRELOADED_MENU) && PRELOADED_MENU.length > 0) {
        this.menuData = PRELOADED_MENU.filter(c => c.items && c.items.length > 0);
        if (this.menuData.length > 0) this.activeCategory = this.menuData[0].id;
        this.cacheMenu(this.menuData);
        this.renderMenu();
        return;
      }

      // Priority 2: localStorage cache (fast, no network)
      const cached = this.getCachedMenu();
      if (cached && cached.length > 0) {
        this.menuData = cached;
        if (this.menuData.length > 0) this.activeCategory = this.menuData[0].id;
        this.renderMenu();
        // Refresh cache in background (silent, no spinner)
        this.refreshMenuInBackground();
        return;
      }

      // Priority 3: API fetch (network call)
      await this.fetchMenuFromAPI();
    } catch (err) {
      console.error('Menu load error:', err);
      document.getElementById('ea-menu-loading').innerHTML = `
        <p class="ea-error">Unable to load menu. Please try again later.</p>
      `;
    }
  }

  async fetchMenuFromAPI() {
    const locationParam = this.config.locationId && this.config.locationId !== this.config.restaurantId
      ? `&locationId=${encodeURIComponent(this.config.locationId)}` : '';
    const url = `${this.config.apiBaseUrl}/getMenu?restaurantId=${encodeURIComponent(this.config.restaurantId)}${locationParam}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load menu');
    const data = await res.json();
    this.menuData = (data.categories || []).filter(c => c.items && c.items.length > 0);
    if (this.menuData.length > 0) this.activeCategory = this.menuData[0].id;
    this.cacheMenu(this.menuData);
    this.renderMenu();
  }

  async refreshMenuInBackground() {
    try {
      const locationParam = this.config.locationId && this.config.locationId !== this.config.restaurantId
        ? `&locationId=${encodeURIComponent(this.config.locationId)}` : '';
      const url = `${this.config.apiBaseUrl}/getMenu?restaurantId=${encodeURIComponent(this.config.restaurantId)}${locationParam}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const fresh = (data.categories || []).filter(c => c.items && c.items.length > 0);
      this.cacheMenu(fresh);
      // If menu changed, update silently
      if (JSON.stringify(fresh) !== JSON.stringify(this.menuData)) {
        this.menuData = fresh;
        if (this.menuData.length > 0 && !this.menuData.find(c => c.id === this.activeCategory)) {
          this.activeCategory = this.menuData[0].id;
        }
        this.renderMenu();
      }
    } catch { /* silent background refresh */ }
  }

  renderMenu() {
    document.getElementById('ea-menu-loading').style.display = 'none';
    document.getElementById('ea-menu-content').style.display = 'block';

    // Categories
    const catHtml = this.menuData.map(cat => `
      <button class="ea-cat-btn ${cat.id === this.activeCategory ? 'active' : ''}"
              onclick="embedApp.selectCategory('${cat.id}')">
        ${cat.name}
        <span class="ea-cat-count">${cat.items.length}</span>
      </button>
    `).join('');
    document.getElementById('ea-categories').innerHTML = catHtml;

    // Items for active category
    this.renderItems();
  }

  renderItems() {
    const category = this.menuData.find(c => c.id === this.activeCategory);
    if (!category) return;
    const items = category.items || [];

    const html = items.map(item => {
      const price = parseFloat(item.price) || 0;
      const discount = parseFloat(item.discount) || 0;
      const discountType = item.discountType || 'amount';
      let finalPrice = price;
      if (discount > 0) {
        finalPrice = discountType === 'percentage'
          ? price * (1 - discount / 100)
          : price - discount;
      }
      finalPrice = Math.max(0, finalPrice);
      const itemJson = JSON.stringify({
        id: item.id, name: item.name, price: price,
        finalPrice: finalPrice, discount: discount,
        discountType: discountType, imageUrl: item.imageUrl || ''
      }).replace(/'/g, '&#39;').replace(/"/g, '&quot;');

      return `
        <div class="ea-item-card">
          ${item.imageUrl ? `<img class="ea-item-img" src="${item.imageUrl}" alt="${item.name}" onerror="this.style.display='none'">` : `<div class="ea-item-img-placeholder"><i class="bi bi-egg-fried"></i></div>`}
          <div class="ea-item-body">
            <div class="ea-item-name">${item.name}</div>
            ${item.description ? `<div class="ea-item-desc">${item.description}</div>` : ''}
            <div class="ea-item-footer">
              <div class="ea-item-price">
                ${discount > 0 ? `<span class="ea-price-original">$${price.toFixed(2)}</span>` : ''}
                <span class="ea-price-final">$${finalPrice.toFixed(2)}</span>
                ${discount > 0 ? `<span class="ea-price-badge">${discountType === 'percentage' ? discount + '% off' : '$' + discount.toFixed(2) + ' off'}</span>` : ''}
              </div>
              <button class="ea-add-btn" onclick="embedApp.addToCart(JSON.parse(decodeItemJson(this)))" data-item="${itemJson}">
                <i class="bi bi-plus"></i> Add
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('ea-items').innerHTML = html || '<p class="ea-empty">No items in this category.</p>';
  }

  selectCategory(catId) {
    this.activeCategory = catId;
    // Update active state
    document.querySelectorAll('.ea-cat-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.trim().startsWith(
        (this.menuData.find(c => c.id === catId) || {}).name || ''
      ));
    });
    this.renderMenu();
  }

  // =============================================
  // Cart
  // =============================================
  addToCart(item) {
    const existing = this.cart.find(i => i.id === item.id);
    if (existing) {
      existing.qty += 1;
    } else {
      this.cart.push({ ...item, qty: 1 });
    }
    this.saveCart();
    this.updateCartUI();
    this.showAddedFeedback(item.name);
    this.notifyParent('koda-cart-update', { count: this.cartItemCount(), total: this.cartTotal() });
  }

  removeFromCart(itemId) {
    this.cart = this.cart.filter(i => i.id !== itemId);
    this.saveCart();
    this.updateCartUI();
    this.notifyParent('koda-cart-update', { count: this.cartItemCount(), total: this.cartTotal() });
  }

  updateQty(itemId, delta) {
    const item = this.cart.find(i => i.id === itemId);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      this.removeFromCart(itemId);
      return;
    }
    this.saveCart();
    this.updateCartUI();
    this.notifyParent('koda-cart-update', { count: this.cartItemCount(), total: this.cartTotal() });
  }

  clearCart() {
    this.cart = [];
    this.saveCart();
    this.updateCartUI();
    this.notifyParent('koda-cart-update', { count: 0, total: 0 });
  }

  cartItemCount() {
    return this.cart.reduce((sum, i) => sum + i.qty, 0);
  }

  cartTotal() {
    return this.cart.reduce((sum, i) => sum + i.finalPrice * i.qty, 0);
  }

  saveCart() {
    try {
      localStorage.setItem('ea_cart_' + this.config.restaurantId, JSON.stringify(this.cart));
    } catch (e) {}
  }

  loadCartFromStorage() {
    try {
      const saved = localStorage.getItem('ea_cart_' + this.config.restaurantId);
      if (saved) this.cart = JSON.parse(saved);
    } catch (e) {
      this.cart = [];
    }
  }

  updateCartUI() {
    const count = this.cartItemCount();
    const total = this.cartTotal();
    const bar = document.getElementById('ea-cart-bar');
    const countEl = document.getElementById('ea-cart-count');
    const totalEl = document.getElementById('ea-cart-total');

    if (count > 0) {
      bar.classList.remove('ea-hidden');
      countEl.textContent = count;
      totalEl.textContent = '$' + total.toFixed(2);
    } else {
      bar.classList.add('ea-hidden');
    }

    // Update cart panel if open
    if (this.cartOpen) this.renderCartPanel();
  }

  toggleCart() {
    this.cartOpen = !this.cartOpen;
    document.getElementById('ea-cart-panel').classList.toggle('ea-hidden', !this.cartOpen);
    document.getElementById('ea-cart-overlay').classList.toggle('ea-hidden', !this.cartOpen);
    if (this.cartOpen) this.renderCartPanel();
  }

  renderCartPanel() {
    const itemsEl = document.getElementById('ea-cart-items');
    const summaryEl = document.getElementById('ea-cart-summary');

    if (this.cart.length === 0) {
      itemsEl.innerHTML = '<p class="ea-cart-empty">Your cart is empty</p>';
      summaryEl.innerHTML = '';
      return;
    }

    itemsEl.innerHTML = this.cart.map(item => `
      <div class="ea-cart-item">
        <div class="ea-cart-item-info">
          <div class="ea-cart-item-name">${item.name}</div>
          <div class="ea-cart-item-price">$${(item.finalPrice * item.qty).toFixed(2)}</div>
        </div>
        <div class="ea-cart-item-controls">
          <button class="ea-qty-btn" onclick="embedApp.updateQty('${item.id}', -1)">-</button>
          <span class="ea-qty">${item.qty}</span>
          <button class="ea-qty-btn" onclick="embedApp.updateQty('${item.id}', 1)">+</button>
          <button class="ea-remove-btn" onclick="embedApp.removeFromCart('${item.id}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `).join('');

    const subtotal = this.cartTotal();
    const taxRate = parseFloat(this.config.taxRate) || 8.5;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    summaryEl.innerHTML = `
      <div class="ea-summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="ea-summary-row"><span>Tax (${taxRate}%)</span><span>$${tax.toFixed(2)}</span></div>
      <div class="ea-summary-row ea-summary-total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
      <button class="ea-checkout-btn" onclick="embedApp.showCheckout()">Proceed to Checkout</button>
      <button class="ea-clear-btn" onclick="embedApp.clearCart()">Clear Cart</button>
    `;
  }

  showAddedFeedback(name) {
    const existing = document.querySelector('.ea-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'ea-toast';
    toast.innerHTML = `<i class="bi bi-check-circle"></i> ${name} added to cart`;
    document.querySelector('.ea-app').appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 2000);
  }

  // =============================================
  // Checkout
  // =============================================
  showCheckout() {
    this.cartOpen = false;
    document.getElementById('ea-cart-panel').classList.add('ea-hidden');
    document.getElementById('ea-cart-overlay').classList.add('ea-hidden');
    this.checkoutOpen = true;
    // Reset Stripe card element for fresh mount
    if (this.cardElement) {
      this.cardElement.destroy();
      this.cardElement = null;
    }
    this.selectedPaymentMethod = 'payLater';

    const subtotal = this.cartTotal();
    const taxRate = parseFloat(this.config.taxRate) || 8.5;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    const el = document.getElementById('ea-checkout');
    el.classList.remove('ea-hidden');
    el.innerHTML = `
      <div class="ea-checkout-inner">
        <div class="ea-checkout-header">
          <button class="ea-back-btn" onclick="embedApp.hideCheckout()"><i class="bi bi-arrow-left"></i> Back to Menu</button>
          <h2>Checkout</h2>
        </div>

        <div class="ea-checkout-grid">
          <div class="ea-checkout-form-section">
            <h3>Your Details</h3>
            <form id="ea-checkout-form" onsubmit="embedApp.placeOrder(event)">
              <div class="ea-field">
                <label for="ea-name">Full Name *</label>
                <input type="text" id="ea-name" required placeholder="John Doe">
              </div>
              <div class="ea-field">
                <label for="ea-email">Email *</label>
                <input type="email" id="ea-email" required placeholder="john@example.com">
              </div>
              <div class="ea-field">
                <label for="ea-phone">Phone *</label>
                <input type="tel" id="ea-phone" required placeholder="(555) 123-4567">
              </div>
              <div class="ea-field">
                <label for="ea-order-type">Order Type</label>
                <select id="ea-order-type">
                  <option value="pickup">Pickup</option>
                  <option value="dine-in">Dine-in</option>
                </select>
              </div>
              <div class="ea-field">
                <label for="ea-pickup-time">Pickup Time</label>
                <select id="ea-pickup-time">${this.generatePickupTimes()}</select>
              </div>
              <div class="ea-field">
                <label for="ea-notes">Special Instructions</label>
                <textarea id="ea-notes" rows="2" placeholder="Any allergies or special requests?"></textarea>
              </div>

              <div class="ea-field">
                <label>Payment Method</label>
                <div class="ea-payment-options">
                  <label class="ea-payment-option active" id="ea-pay-later-opt" onclick="embedApp.selectPaymentMethod('payLater')">
                    <input type="radio" name="ea-payment" value="payLater" checked>
                    <i class="bi bi-shop"></i>
                    <div>
                      <strong>Pay at Restaurant</strong>
                      <span>Cash or card when you arrive</span>
                    </div>
                  </label>
                  <label class="ea-payment-option" id="ea-pay-now-opt" onclick="embedApp.selectPaymentMethod('payNow')">
                    <input type="radio" name="ea-payment" value="payNow">
                    <i class="bi bi-credit-card"></i>
                    <div>
                      <strong>Pay Now</strong>
                      <span>Secure payment with card</span>
                    </div>
                  </label>
                </div>
              </div>

              <div id="ea-card-container" class="ea-hidden">
                <div class="ea-field">
                  <label>Card Details</label>
                  <div id="ea-card-element"></div>
                  <div id="ea-card-errors" class="ea-card-errors"></div>
                </div>
              </div>

              <button type="submit" class="ea-place-order-btn" id="ea-place-order-btn">
                Place Order — $${total.toFixed(2)}
              </button>
            </form>
          </div>

          <div class="ea-checkout-summary-section">
            <h3>Order Summary</h3>
            <div class="ea-order-items">
              ${this.cart.map(item => `
                <div class="ea-order-item">
                  <span>${item.qty}x ${item.name}</span>
                  <span>$${(item.finalPrice * item.qty).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
            <div class="ea-order-totals">
              <div class="ea-summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
              <div class="ea-summary-row"><span>Tax (${taxRate}%)</span><span>$${tax.toFixed(2)}</span></div>
              <div class="ea-summary-row ea-summary-total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Pre-fill if user is logged in
    if (this.portal && this.portal.user) {
      const u = this.portal.user;
      if (u.fullName) document.getElementById('ea-name').value = u.fullName;
      if (u.email) document.getElementById('ea-email').value = u.email;
      if (u.phone) document.getElementById('ea-phone').value = u.phone;
    }
  }

  hideCheckout() {
    this.checkoutOpen = false;
    document.getElementById('ea-checkout').classList.add('ea-hidden');
  }

  selectPaymentMethod(method) {
    this.selectedPaymentMethod = method;

    // Update active states
    document.querySelectorAll('.ea-payment-option').forEach(el => el.classList.remove('active'));
    document.getElementById(method === 'payNow' ? 'ea-pay-now-opt' : 'ea-pay-later-opt').classList.add('active');

    const cardContainer = document.getElementById('ea-card-container');

    if (method === 'payNow') {
      cardContainer.classList.remove('ea-hidden');

      if (this.stripe && !this.cardElement) {
        setTimeout(() => {
          try {
            const elements = this.stripe.elements();
            this.cardElement = elements.create('card', {
              style: {
                base: {
                  fontSize: '16px',
                  color: '#2d3436',
                  fontFamily: 'var(--ea-font)',
                  '::placeholder': { color: '#aab7c4' }
                },
                invalid: { color: '#e74c3c' }
              }
            });
            this.cardElement.mount('#ea-card-element');
            this.cardElement.on('change', (event) => {
              const errEl = document.getElementById('ea-card-errors');
              errEl.textContent = event.error ? event.error.message : '';
            });
          } catch (err) {
            console.error('Stripe card element error:', err);
            document.getElementById('ea-card-errors').textContent = 'Error loading payment form.';
          }
        }, 150);
      } else if (!this.stripe) {
        document.getElementById('ea-card-errors').textContent = 'Online payment is currently unavailable. Please select "Pay at Restaurant".';
      }
    } else {
      cardContainer.classList.add('ea-hidden');
    }
  }

  async placeOrder(e) {
    e.preventDefault();
    const btn = document.getElementById('ea-place-order-btn');
    btn.disabled = true;
    btn.textContent = 'Placing order...';

    const subtotal = this.cartTotal();
    const taxRate = parseFloat(this.config.taxRate) || 8.5;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    // Handle card payment if "Pay Now" selected
    let paymentDetails = null;
    const isPayNow = this.selectedPaymentMethod === 'payNow';

    if (isPayNow && this.stripe && this.cardElement) {
      const customerName = document.getElementById('ea-name').value;
      const customerEmail = document.getElementById('ea-email').value;
      const customerPhone = document.getElementById('ea-phone').value;

      const { error, paymentMethod: pm } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.cardElement,
        billing_details: { name: customerName, email: customerEmail, phone: customerPhone }
      });

      if (error) {
        btn.disabled = false;
        btn.textContent = 'Place Order — $' + total.toFixed(2);
        document.getElementById('ea-card-errors').textContent = error.message;
        return;
      }

      paymentDetails = {
        paymentMethodId: pm.id,
        amount: total,
        status: 'pending'
      };
    } else if (isPayNow && !this.stripe) {
      btn.disabled = false;
      btn.textContent = 'Place Order — $' + total.toFixed(2);
      this.showToast('Online payment is unavailable. Please select "Pay at Restaurant".', 'error');
      return;
    }

    const orderData = {
      restaurantId: this.config.restaurantId,
      locationId: this.config.locationId || this.config.restaurantId,
      customerId: this.portal?.user?.id || null,
      customer: {
        name: document.getElementById('ea-name').value,
        email: document.getElementById('ea-email').value,
        phone: document.getElementById('ea-phone').value
      },
      items: this.cart.map(i => ({
        id: i.id, name: i.name, price: i.price,
        finalPrice: i.finalPrice, quantity: i.qty,
        discount: i.discount || 0, discountType: i.discountType || 'amount'
      })),
      subtotal: subtotal,
      tax: tax,
      total: total,
      orderType: document.getElementById('ea-order-type').value,
      pickupTime: document.getElementById('ea-pickup-time').value,
      specialInstructions: document.getElementById('ea-notes').value,
      paymentMethod: isPayNow ? 'card' : 'payAtStore',
      paymentDetails: paymentDetails,
      source: 'widget'
    };

    try {
      const res = await fetch(`${this.config.apiBaseUrl}/submitOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
      const result = await res.json();

      if (result.success || result.orderId) {
        this.orderPlaced = true;
        this.showOrderConfirmation(result.orderId || 'N/A', orderData);
        this.clearCart();
        this.notifyParent('koda-order-placed', { orderId: result.orderId });
      } else {
        throw new Error(result.error || 'Order failed');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Place Order — $' + total.toFixed(2);
      this.showToast(err.message || 'Failed to place order. Please try again.', 'error');
    }
  }

  showOrderConfirmation(orderId, orderData) {
    const el = document.getElementById('ea-checkout');
    el.innerHTML = `
      <div class="ea-confirmation">
        <div class="ea-conf-icon"><i class="bi bi-check-circle-fill"></i></div>
        <h2>Order Placed!</h2>
        <p class="ea-conf-id">Order #${orderId}</p>
        <p>Thank you, ${orderData.customer.name}! Your ${orderData.orderType} order has been received.</p>
        ${orderData.pickupTime ? `<p class="ea-conf-time"><i class="bi bi-clock"></i> Pickup: ${new Date(orderData.pickupTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>` : ''}
        <p class="ea-conf-detail">We've sent a confirmation to <strong>${orderData.customer.email}</strong></p>
        <button class="ea-checkout-btn" onclick="embedApp.hideCheckout(); embedApp.orderPlaced = false;">
          <i class="bi bi-arrow-left"></i> Back to Menu
        </button>
      </div>
    `;
  }

  generatePickupTimes() {
    const now = new Date();
    const start = new Date(now.getTime() + 30 * 60000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15);
    let html = '';
    for (let i = 0; i < 12; i++) {
      const t = new Date(start.getTime() + i * 15 * 60000);
      html += `<option value="${t.toISOString()}">${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</option>`;
    }
    return html;
  }

  // =============================================
  // View Switching
  // =============================================
  async switchView(tab) {
    this.currentView = tab;
    const menuView = document.getElementById('ea-view-menu');
    const accountView = document.getElementById('ea-view-account');
    const cartBar = document.getElementById('ea-cart-bar');
    const checkout = document.getElementById('ea-checkout');

    // Close cart panel if open
    if (this.cartOpen) this.toggleCart();

    if (tab === 'menu') {
      menuView.classList.add('ea-active');
      accountView.classList.remove('ea-active');
      checkout.classList.add('ea-hidden');
      this.checkoutOpen = false;
      // Show cart bar if items
      if (this.cartItemCount() > 0) cartBar.classList.remove('ea-hidden');
    } else {
      menuView.classList.remove('ea-active');
      accountView.classList.add('ea-active');
      checkout.classList.add('ea-hidden');
      this.checkoutOpen = false;
      cartBar.classList.add('ea-hidden');

      // Map widget tabs to portal views
      const viewMap = {
        'account': 'account',
        'orders': 'orders',
        'active_orders': 'active_orders',
        'promotions': 'promotions',
        'rewards': 'rewards',
        'reviews': 'reviews'
      };
      const portalView = viewMap[tab] || 'account';

      if (this.portal) {
        // Reviews are accessible without authentication
        if (portalView === 'reviews') {
          this.portal.currentView = portalView;
          this.portal.showDashboard();
        } else if (this.portal.isAuthenticated) {
          this.portal.currentView = portalView;
          // Load portal data (orders, promotions, rewards) if not yet loaded
          if (!this.portalDataLoaded) {
            // Show loading spinner while data loads
            this.portal.showLoadingState();
            await Promise.all([
              this.portal.loadUserOrders(),
              this.portal.loadPromotions(),
              this.portal.loadCustomerData()
            ]);
            this.portalDataLoaded = true;
          }
          this.portal.showDashboard();
        } else {
          this.portal.showAuth();
        }
      }
    }

    this.notifyParent('koda-tab-change', { tab: tab });
  }

  // =============================================
  // Portal Integration
  // =============================================
  initPortal() {
    this.portal = new CustomerPortal({
      restaurantId: this.config.restaurantId,
      apiBaseUrl: this.config.apiBaseUrl,
      promoId: this.config.promoId || '',
      embedMode: true,
      initialTab: this.config.initialTab || 'menu',
      themeConfig: {
        primaryColor: this.config.primaryColor,
        secondaryColor: this.config.secondaryColor,
        accentColor: this.config.accentColor,
        fontFamily: this.config.fontFamily
      },
      useMockData: false
    });

    // Expose portal as global so onclick handlers (claimPromo, spin, etc.) work
    window.customerPortal = this.portal;

    // Hide portal initially (menu is shown first)
    const portalRoot = document.getElementById('customer-portal-root');
    if (portalRoot) {
      portalRoot.style.display = 'block';
    }

    // Pre-fetch portal data in background if user has existing session
    if (this.portal.isAuthenticated && !this.portalDataLoaded) {
      this.prefetchPortalData();
    }
  }

  async prefetchPortalData() {
    try {
      await Promise.all([
        this.portal.loadUserOrders(),
        this.portal.loadPromotions(),
        this.portal.loadCustomerData()
      ]);
      this.portalDataLoaded = true;
    } catch (err) {
      console.log('Background portal data prefetch failed:', err.message);
    }
  }

  // =============================================
  // Messaging
  // =============================================
  listenForMessages() {
    window.addEventListener('message', (e) => {
      if (!e.data || typeof e.data.type !== 'string') return;
      if (e.data.type === 'koda-navigate') {
        this.switchView(e.data.tab);
      }
    });
  }

  notifyParent(type, data = {}) {
    if (window.parent !== window) {
      window.parent.postMessage({ type, ...data }, '*');
    }
  }

  showToast(msg, type = 'success') {
    const existing = document.querySelector('.ea-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `ea-toast ea-toast-${type}`;
    toast.innerHTML = `${type === 'error' ? '<i class="bi bi-exclamation-circle"></i>' : '<i class="bi bi-check-circle"></i>'} ${msg}`;
    document.querySelector('.ea-app').appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, type === 'error' ? 5000 : 2500);
  }
}

// Helper for decoding item JSON from button data attribute
function decodeItemJson(btn) {
  const raw = btn.getAttribute('data-item');
  const decoded = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return decoded;
}
