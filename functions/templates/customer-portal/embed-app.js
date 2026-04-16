/**
 * Koda Carte — Embed Application
 *
 * Full standalone experience for the embeddable widget.
 * Handles: menu browsing, cart, checkout, and view orchestration.
 * Delegates to CustomerPortal for account/orders/promotions/rewards.
 */

// HTML escape helper — prevents XSS when rendering user-controlled text via innerHTML
function _escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

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
    // Delivery state
    this.deliveryQuote = null; // { quoteId, fee, feeFormatted, estimatedDropoffTime }
    this.deliveryQuoteLoading = false;
    this.deliveryQuoteExpired = false;
    this._quoteExpiryTimer = null;
    this.placesAutocomplete = null;

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
              onclick="embedApp.selectCategory('${_escHtml(cat.id)}')">
        ${_escHtml(cat.name)}
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
      const hasSpice = item.spiceLevelEnabled && item.spiceLevels && item.spiceLevels.length > 0;
      const itemJson = JSON.stringify({
        id: item.id, name: item.name, price: price,
        finalPrice: finalPrice, discount: discount,
        discountType: discountType, imageUrl: item.imageUrl || '',
        spiceLevelEnabled: !!hasSpice,
        spiceLevels: hasSpice ? item.spiceLevels : []
      }).replace(/'/g, '&#39;').replace(/"/g, '&quot;');

      const addBtnAction = hasSpice
        ? `embedApp.showItemOptions(JSON.parse(decodeItemJson(this)))`
        : `embedApp.addToCart(JSON.parse(decodeItemJson(this)))`;

      return `
        <div class="ea-item-card">
          ${item.imageUrl ? `<img class="ea-item-img" src="${_escHtml(item.imageUrl)}" alt="${_escHtml(item.name)}" onerror="this.style.display='none'">` : `<div class="ea-item-img-placeholder"><i class="bi bi-egg-fried"></i></div>`}
          <div class="ea-item-body">
            <div class="ea-item-name">${_escHtml(item.name)}</div>
            ${item.description ? `<div class="ea-item-desc">${_escHtml(item.description)}</div>` : ''}
            ${hasSpice ? `<div class="ea-item-spice-hint"><i class="bi bi-fire"></i> Spice level selection required</div>` : ''}
            <div class="ea-item-footer">
              <div class="ea-item-price">
                ${discount > 0 ? `<span class="ea-price-original">$${price.toFixed(2)}</span>` : ''}
                <span class="ea-price-final">$${finalPrice.toFixed(2)}</span>
                ${discount > 0 ? `<span class="ea-price-badge">${discountType === 'percentage' ? discount + '% off' : '$' + discount.toFixed(2) + ' off'}</span>` : ''}
              </div>
              <button class="ea-add-btn" onclick="${addBtnAction}" data-item="${itemJson}">
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
  addToCart(item, notes, spiceLevel) {
    const itemNotes = notes || '';
    const itemSpice = spiceLevel || '';
    const existing = this.cart.find(i =>
      i.id === item.id &&
      (i.notes || '') === itemNotes &&
      (i.spiceLevel || '') === itemSpice
    );
    if (existing) {
      existing.qty += 1;
    } else {
      this.cart.push({ ...item, qty: 1, notes: itemNotes, spiceLevel: itemSpice });
    }
    this.saveCart();
    this.updateCartUI();
    this.showAddedFeedback(item.name);
    this.notifyParent('koda-cart-update', { count: this.cartItemCount(), total: this.cartTotal() });
  }

  // Show item options overlay for spice level and notes
  showItemOptions(item) {
    this._pendingItem = item;
    const spiceLevels = item.spiceLevels || [];
    const overlay = document.createElement('div');
    overlay.className = 'ea-item-options-overlay';
    overlay.innerHTML = `
      <div class="ea-item-options-panel">
        <div class="ea-item-options-header">
          <strong>${_escHtml(item.name)}</strong>
          <button class="ea-item-options-close" onclick="embedApp.closeItemOptions()">&times;</button>
        </div>
        ${spiceLevels.length > 0 ? `
          <div class="ea-item-options-section">
            <label>Spice Level <span style="color:#e74c3c">*</span></label>
            <div class="ea-spice-options">
              ${spiceLevels.map(level => `
                <button class="ea-spice-btn" data-level="${_escHtml(level)}" onclick="embedApp.selectSpice(this, '${_escHtml(level).replace(/'/g, "\\'")}')">${_escHtml(level)}</button>
              `).join('')}
            </div>
          </div>
        ` : ''}
        <div class="ea-item-options-section">
          <label>Notes (optional)</label>
          <textarea id="ea-item-notes" class="ea-item-notes-input" maxlength="200" placeholder="e.g. extra roasted, no ice"></textarea>
        </div>
        <button class="ea-item-options-add" id="ea-item-options-confirm" onclick="embedApp.confirmItemOptions()" ${spiceLevels.length > 0 ? 'disabled' : ''}>
          Add to Cart
        </button>
      </div>
    `;
    document.querySelector('.ea-app').appendChild(overlay);
    this._selectedSpice = '';
  }

  selectSpice(btn, level) {
    document.querySelectorAll('.ea-spice-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this._selectedSpice = level;
    const confirmBtn = document.getElementById('ea-item-options-confirm');
    if (confirmBtn) confirmBtn.disabled = false;
  }

  confirmItemOptions() {
    if (!this._pendingItem) return;
    const hasSpice = this._pendingItem.spiceLevelEnabled && this._pendingItem.spiceLevels?.length > 0;
    if (hasSpice && !this._selectedSpice) return;
    const notes = (document.getElementById('ea-item-notes')?.value || '').trim();
    this.addToCart(this._pendingItem, notes, this._selectedSpice || '');
    this.closeItemOptions();
  }

  closeItemOptions() {
    const overlay = document.querySelector('.ea-item-options-overlay');
    if (overlay) overlay.remove();
    this._pendingItem = null;
    this._selectedSpice = '';
  }

  // Edit note on an existing cart item
  editCartNote(index) {
    const item = this.cart[index];
    if (!item) return;
    this._editNoteIndex = index;
    const overlay = document.createElement('div');
    overlay.className = 'ea-item-options-overlay';
    overlay.innerHTML = `
      <div class="ea-item-options-panel">
        <div class="ea-item-options-header">
          <strong>${_escHtml(item.name)} — Note</strong>
          <button class="ea-item-options-close" onclick="embedApp.closeNoteEditor()">&times;</button>
        </div>
        <div class="ea-item-options-section">
          <textarea id="ea-edit-note" class="ea-item-notes-input" maxlength="200" placeholder="e.g. extra roasted, no ice">${_escHtml(item.notes || '')}</textarea>
        </div>
        <button class="ea-item-options-add" onclick="embedApp.saveCartNote()">Save Note</button>
      </div>
    `;
    document.querySelector('.ea-app').appendChild(overlay);
    setTimeout(() => document.getElementById('ea-edit-note')?.focus(), 100);
  }

  saveCartNote() {
    const idx = this._editNoteIndex;
    if (idx == null || !this.cart[idx]) return;
    const note = (document.getElementById('ea-edit-note')?.value || '').trim();
    this.cart[idx].notes = note;
    this.saveCart();
    this.closeNoteEditor();
    this.updateCartUI();
    if (this.cartOpen) this.renderCartPanel();
  }

  closeNoteEditor() {
    const overlay = document.querySelector('.ea-item-options-overlay');
    if (overlay) overlay.remove();
    this._editNoteIndex = null;
  }

  removeFromCart(index) {
    if (typeof index === 'number') {
      this.cart.splice(index, 1);
    } else {
      // Legacy: remove by id (backward compat)
      this.cart = this.cart.filter(i => i.id !== index);
    }
    this.saveCart();
    this.updateCartUI();
    this.notifyParent('koda-cart-update', { count: this.cartItemCount(), total: this.cartTotal() });
  }

  updateQty(index, delta) {
    if (typeof index === 'number') {
      if (!this.cart[index]) return;
      this.cart[index].qty += delta;
      if (this.cart[index].qty <= 0) {
        this.removeFromCart(index);
        return;
      }
    } else {
      // Legacy: by id
      const item = this.cart.find(i => i.id === index);
      if (!item) return;
      item.qty += delta;
      if (item.qty <= 0) {
        this.removeFromCart(index);
        return;
      }
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

    itemsEl.innerHTML = this.cart.map((item, idx) => `
      <div class="ea-cart-item">
        <div class="ea-cart-item-info">
          <div class="ea-cart-item-name">
            ${_escHtml(item.name)}
            <span class="ea-cart-note-btn" onclick="embedApp.editCartNote(${idx})" title="${item.notes ? 'Edit note' : 'Add note'}">
              <i class="bi bi-pencil${item.notes ? '-fill' : ''}"></i>
            </span>
          </div>
          ${item.spiceLevel ? `<div class="ea-cart-item-spice"><i class="bi bi-fire"></i> ${_escHtml(item.spiceLevel)}</div>` : ''}
          ${item.notes ? `<div class="ea-cart-item-notes">${_escHtml(item.notes)}</div>` : ''}
          <div class="ea-cart-item-price">$${(item.finalPrice * item.qty).toFixed(2)}</div>
        </div>
        <div class="ea-cart-item-controls">
          <button class="ea-qty-btn" onclick="embedApp.updateQty(${idx}, -1)">-</button>
          <span class="ea-qty">${item.qty}</span>
          <button class="ea-qty-btn" onclick="embedApp.updateQty(${idx}, 1)">+</button>
          <button class="ea-remove-btn" onclick="embedApp.removeFromCart(${idx})"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `).join('');

    const subtotal = this.cartTotal();
    const taxRate = parseFloat(this.config.taxRate) || 8;
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
    toast.innerHTML = `<i class="bi bi-check-circle"></i> ${_escHtml(name)} added to cart`;
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
    const taxRate = parseFloat(this.config.taxRate) || 8;
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
                <select id="ea-order-type" onchange="embedApp.onOrderTypeChange()">
                  <option value="pickup">Pickup</option>
                  <option value="dine-in">Dine-in</option>
                  ${this.config.deliveryEnabled ? '<option value="delivery">Delivery</option>' : ''}
                </select>
              </div>
              <div class="ea-field" id="ea-pickup-time-field">
                <label for="ea-pickup-time">Pickup Time</label>
                <select id="ea-pickup-time">${this.generatePickupTimes()}</select>
              </div>

              <!-- Delivery fields (hidden by default) -->
              <div id="ea-delivery-fields" class="ea-hidden">
                <div class="ea-field">
                  <label for="ea-delivery-address">Delivery Address *</label>
                  <input type="text" id="ea-delivery-address" placeholder="Start typing your address..." autocomplete="new-password" oninput="embedApp.onDeliveryAddressInput()">
                </div>
                <div id="ea-delivery-quote-area"></div>
                <div class="ea-field">
                  <label for="ea-delivery-instructions">Delivery Instructions</label>
                  <textarea id="ea-delivery-instructions" rows="2" placeholder="Apartment #, gate code, leave at door..."></textarea>
                </div>
                <div class="ea-field">
                  <label class="ea-checkbox-label">
                    <input type="checkbox" id="ea-contactless" ${this.config.deliveryContactlessDefault ? 'checked' : ''}>
                    Contactless delivery (leave at door)
                  </label>
                </div>
                <div class="ea-field">
                  <label>Driver Tip</label>
                  <div class="ea-tip-options">
                    <button type="button" class="ea-tip-btn" onclick="embedApp.selectTip(3)" data-tip="3">$3</button>
                    <button type="button" class="ea-tip-btn active" onclick="embedApp.selectTip(5)" data-tip="5">$5</button>
                    <button type="button" class="ea-tip-btn" onclick="embedApp.selectTip(8)" data-tip="8">$8</button>
                    <button type="button" class="ea-tip-btn" onclick="embedApp.selectTip('custom')" data-tip="custom">Custom</button>
                  </div>
                  <input type="number" id="ea-custom-tip" class="ea-hidden" min="0" step="0.50" placeholder="Enter tip amount" oninput="embedApp.updateDeliveryTotals()">
                </div>
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
                  <span>${item.qty}x ${_escHtml(item.name)}</span>
                  <span>$${(item.finalPrice * item.qty).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
            <div class="ea-order-totals" id="ea-order-totals">
              <div class="ea-summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
              <div class="ea-summary-row"><span>Tax (${taxRate}%)</span><span>$${tax.toFixed(2)}</span></div>
              <div class="ea-summary-row ea-summary-total"><span>Total</span><span id="ea-total-display">$${total.toFixed(2)}</span></div>
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
    const taxRate = parseFloat(this.config.taxRate) || 8;
    const tax = subtotal * (taxRate / 100);
    const orderType = document.getElementById('ea-order-type').value;
    const isDelivery = orderType === 'delivery';
    const deliveryFee = isDelivery ? this.getDeliveryFee() : 0;
    const driverTip = isDelivery ? this.getDriverTip() : 0;
    const total = subtotal + tax + deliveryFee + driverTip;

    // Validate delivery fields
    if (isDelivery) {
      const address = document.getElementById('ea-delivery-address')?.value?.trim();
      if (!address) {
        btn.disabled = false;
        btn.textContent = `Place Order — $${total.toFixed(2)}`;
        this.showToast('Please enter a delivery address.', 'error');
        return;
      }
      if (!this.deliveryQuote) {
        btn.disabled = false;
        btn.textContent = `Place Order — $${total.toFixed(2)}`;
        this.showToast('Please wait for the delivery quote or check your address.', 'error');
        return;
      }
      if (this.deliveryQuoteExpired) {
        btn.disabled = false;
        btn.textContent = `Place Order — $${total.toFixed(2)}`;
        this.showToast('Your delivery quote has expired. Please refresh the quote above before placing your order.', 'error');
        return;
      }
    }

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
        discount: i.discount || 0, discountType: i.discountType || 'amount',
        ...(i.notes && { notes: i.notes }),
        ...(i.spiceLevel && { spiceLevel: i.spiceLevel })
      })),
      subtotal: subtotal,
      tax: tax,
      total: total,
      orderType: orderType,
      pickupTime: isDelivery ? null : document.getElementById('ea-pickup-time').value,
      specialInstructions: document.getElementById('ea-notes').value,
      paymentMethod: isPayNow ? 'card' : 'payAtStore',
      paymentDetails: paymentDetails,
      source: 'widget',
      // Delivery-specific fields
      ...(isDelivery ? {
        deliveryAddress: { fullAddress: document.getElementById('ea-delivery-address').value.trim() },
        deliveryInstructions: document.getElementById('ea-delivery-instructions')?.value || '',
        contactlessDelivery: document.getElementById('ea-contactless')?.checked || false,
        deliveryFee: deliveryFee,
        driverTip: driverTip,
        doordashQuoteId: this.deliveryQuote?.quoteId || null,
      } : {})
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
        this.clearQuoteExpiryTimer();
        this.showOrderConfirmation(result.orderId || 'N/A', orderData, result.trackingUrl);
        this.clearCart();
        this.deliveryQuote = null;
        this.notifyParent('koda-order-placed', { orderId: result.orderId, trackingUrl: result.trackingUrl });
      } else if (result.error === 'quote_expired') {
        // Backend couldn't auto re-quote (fee changed too much or re-quote failed)
        this.deliveryQuote = null;
        this.deliveryQuoteExpired = true;
        this.clearQuoteExpiryTimer();
        btn.disabled = true;
        btn.textContent = 'Quote Expired — Refresh Above';
        const newFee = result.newFee ? `$${(result.newFee / 100).toFixed(2)}` : null;
        const msg = newFee
          ? `Delivery fee has changed to ${newFee}. Please refresh the quote and review the new total.`
          : 'Your delivery quote has expired. Please refresh the quote and try again.';
        this.showToast(msg, 'error');
        // Show refresh button in quote area
        const quoteArea = document.getElementById('ea-delivery-quote-area');
        if (quoteArea) {
          quoteArea.innerHTML = `
            <div class="ea-delivery-error" style="display:flex;flex-direction:column;gap:8px;">
              <div><i class="bi bi-exclamation-triangle"></i> ${msg}</div>
              <button type="button" onclick="embedApp.fetchDeliveryQuote()" style="align-self:flex-start;background:var(--embed-primary,#2d6a4f);color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:0.85rem;">
                <i class="bi bi-arrow-clockwise"></i> Refresh Quote
              </button>
            </div>
          `;
        }
      } else {
        throw new Error(result.error || 'Order failed');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Place Order — $' + total.toFixed(2);
      this.showToast(err.message || 'Failed to place order. Please try again.', 'error');
    }
  }

  showOrderConfirmation(orderId, orderData, trackingUrl) {
    const isDelivery = orderData.orderType === 'delivery';
    const el = document.getElementById('ea-checkout');
    el.innerHTML = `
      <div class="ea-confirmation">
        <div class="ea-conf-icon"><i class="bi bi-check-circle-fill"></i></div>
        <h2>Order Placed!</h2>
        <p class="ea-conf-id">Order #${orderId}</p>
        <p>Thank you, ${_escHtml(orderData.customer.name)}! Your ${_escHtml(orderData.orderType)} order has been received.</p>
        ${isDelivery && orderData.deliveryAddress ? `<p class="ea-conf-time"><i class="bi bi-geo-alt"></i> Delivering to: ${_escHtml(orderData.deliveryAddress.fullAddress)}</p>` : ''}
        ${isDelivery && trackingUrl ? `<a href="${_escHtml(trackingUrl)}" target="_blank" class="ea-track-btn"><i class="bi bi-truck"></i> Track Your Delivery</a>` : ''}
        ${!isDelivery && orderData.pickupTime ? `<p class="ea-conf-time"><i class="bi bi-clock"></i> Pickup: ${orderData.pickupTime === 'ASAP' ? 'ASAP' : new Date(orderData.pickupTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>` : ''}
        <p class="ea-conf-detail">We've sent a confirmation to <strong>${_escHtml(orderData.customer.email)}</strong></p>
        <button class="ea-checkout-btn" onclick="embedApp.hideCheckout(); embedApp.orderPlaced = false;">
          <i class="bi bi-arrow-left"></i> Back to Menu
        </button>
      </div>
    `;
  }

  generatePickupTimes() {
    const now = new Date();
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const todayKey = dayNames[now.getDay()];
    const todayHours = this.config.hours && this.config.hours[todayKey];

    let openTime = null;
    let closeTime = null;
    if (todayHours && todayHours.open) {
      const [oh, om] = todayHours.open.split(':').map(Number);
      openTime = new Date(now);
      openTime.setHours(oh, om, 0, 0);
    }
    if (todayHours && todayHours.close) {
      const [ch, cm] = todayHours.close.split(':').map(Number);
      closeTime = new Date(now);
      closeTime.setHours(ch, cm, 0, 0);
    }

    let start = new Date(now.getTime() + 60 * 60000);
    // If before opening time, push start to opening time
    if (openTime && start < openTime) {
      start = new Date(openTime);
    }
    const rem = start.getMinutes() % 20;
    if (rem !== 0) start.setMinutes(start.getMinutes() + (20 - rem));
    start.setSeconds(0, 0);

    let html = '<option value="ASAP">ASAP</option>';
    for (let i = 0; i < 18; i++) {
      const t = new Date(start.getTime() + i * 20 * 60000);
      if (closeTime && t > closeTime) break;
      html += `<option value="${t.toISOString()}">${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</option>`;
    }
    return html;
  }

  // =============================================
  // Delivery Methods
  // =============================================

  loadGoogleMapsScript(callback) {
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
      callback();
      return;
    }
    if (!this.config.googleMapsApiKey) return;
    if (!document.getElementById('googleMapsScript')) {
      const script = document.createElement('script');
      script.id = 'googleMapsScript';
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + this.config.googleMapsApiKey + '&libraries=places&callback=_gmapsReady';
      script.async = true;
      script.defer = true;
      window._gmapsCallback = callback;
      window._gmapsReady = function() {
        if (window._gmapsCallback) window._gmapsCallback();
      };
      document.head.appendChild(script);
    } else {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (typeof google !== 'undefined' && google.maps && google.maps.places) {
          clearInterval(poll);
          callback();
        } else if (attempts > 50) {
          clearInterval(poll);
        }
      }, 100);
    }
  }

  initPlacesAutocomplete() {
    if (this.placesAutocomplete) return;
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
      this.loadGoogleMapsScript(() => this.initPlacesAutocomplete());
      return;
    }
    const input = document.getElementById('ea-delivery-address');
    if (!input) return;
    this.placesAutocomplete = new google.maps.places.Autocomplete(input, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address', 'geometry']
    });
    input.setAttribute('autocomplete', 'new-password');
    setTimeout(() => { input.setAttribute('autocomplete', 'new-password'); }, 500);
    this.placesAutocomplete.addListener('place_changed', () => {
      const place = this.placesAutocomplete.getPlace();
      if (place && place.formatted_address) {
        input.value = place.formatted_address;
        clearTimeout(this._addressDebounce);
        this.fetchDeliveryQuote();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const pacContainer = document.querySelector('.pac-container');
        if (pacContainer && pacContainer.style.display !== 'none') {
          e.preventDefault();
        }
      }
    });
  }

  onOrderTypeChange() {
    const orderType = document.getElementById('ea-order-type').value;
    const deliveryFields = document.getElementById('ea-delivery-fields');
    const pickupTimeField = document.getElementById('ea-pickup-time-field');
    const payLaterOpt = document.getElementById('ea-pay-later-opt');

    if (orderType === 'delivery') {
      deliveryFields.classList.remove('ea-hidden');
      pickupTimeField.classList.add('ea-hidden');
      // Hide "Pay at Restaurant" for delivery — require prepayment
      if (payLaterOpt) payLaterOpt.style.display = 'none';
      this.selectPaymentMethod('payNow');
      // Default tip
      this.selectedTip = 5;
      this.initPlacesAutocomplete();
      this.updateDeliveryTotals();
    } else {
      deliveryFields.classList.add('ea-hidden');
      pickupTimeField.classList.remove('ea-hidden');
      if (payLaterOpt) payLaterOpt.style.display = '';
      this.deliveryQuote = null;
      this.clearQuoteExpiryTimer();
      this.updateDeliveryTotals();
    }
  }

  selectTip(amount) {
    document.querySelectorAll('.ea-tip-btn').forEach(btn => btn.classList.remove('active'));

    if (amount === 'custom') {
      document.querySelector('[data-tip="custom"]').classList.add('active');
      document.getElementById('ea-custom-tip').classList.remove('ea-hidden');
      this.selectedTip = parseFloat(document.getElementById('ea-custom-tip').value) || 0;
    } else {
      document.querySelector(`[data-tip="${amount}"]`).classList.add('active');
      document.getElementById('ea-custom-tip').classList.add('ea-hidden');
      this.selectedTip = amount;
    }
    this.updateDeliveryTotals();
  }

  getDeliveryFee() {
    return this.deliveryQuote ? this.deliveryQuote.fee / 100 : 0; // Convert cents to dollars
  }

  getDriverTip() {
    const customTipEl = document.getElementById('ea-custom-tip');
    if (customTipEl && !customTipEl.classList.contains('ea-hidden')) {
      return parseFloat(customTipEl.value) || 0;
    }
    return this.selectedTip || 0;
  }

  updateDeliveryTotals() {
    const orderType = document.getElementById('ea-order-type')?.value;
    const subtotal = this.cartTotal();
    const taxRate = parseFloat(this.config.taxRate) || 8;
    const tax = subtotal * (taxRate / 100);
    const deliveryFee = orderType === 'delivery' ? this.getDeliveryFee() : 0;
    const driverTip = orderType === 'delivery' ? this.getDriverTip() : 0;
    const total = subtotal + tax + deliveryFee + driverTip;

    const totalsEl = document.getElementById('ea-order-totals');
    if (!totalsEl) return;

    let html = `
      <div class="ea-summary-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="ea-summary-row"><span>Tax (${taxRate}%)</span><span>$${tax.toFixed(2)}</span></div>
    `;
    if (orderType === 'delivery') {
      html += `<div class="ea-summary-row"><span>Delivery Fee (DoorDash)</span><span>${deliveryFee > 0 ? '$' + deliveryFee.toFixed(2) : '--'}</span></div>`;
      html += `<div class="ea-summary-row"><span>Driver Tip</span><span>$${driverTip.toFixed(2)}</span></div>`;
    }
    html += `<div class="ea-summary-row ea-summary-total"><span>Total</span><span id="ea-total-display">$${total.toFixed(2)}</span></div>`;
    totalsEl.innerHTML = html;

    // Update place order button
    const btn = document.getElementById('ea-place-order-btn');
    if (btn && !btn.disabled) {
      btn.textContent = `Place Order — $${total.toFixed(2)}`;
    }
  }

  onDeliveryAddressInput() {
    // Debounce: fetch quote after user stops typing for 800ms
    clearTimeout(this._addressDebounce);
    this._addressDebounce = setTimeout(() => this.fetchDeliveryQuote(), 800);
  }

  async fetchDeliveryQuote() {
    const address = document.getElementById('ea-delivery-address')?.value?.trim();
    if (!address || address.length < 10) {
      this.deliveryQuote = null;
      this.clearQuoteExpiryTimer();
      this.updateDeliveryTotals();
      return;
    }

    const quoteArea = document.getElementById('ea-delivery-quote-area');
    quoteArea.innerHTML = '<div class="ea-delivery-loading" style="display:flex;align-items:center;gap:8px;padding:0.5rem;"><div style="width:16px;height:16px;border:2px solid #ddd;border-top:2px solid var(--embed-primary,#2d6a4f);border-radius:50%;animation:spin 0.8s linear infinite;"></div> Getting delivery estimate from our delivery partner...</div>';
    this.deliveryQuoteLoading = true;

    try {
      const res = await fetch(`${this.config.apiBaseUrl}/getDeliveryQuote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: this.config.restaurantId,
          locationId: this.config.locationId || this.config.restaurantId,
          dropoffAddress: address,
          dropoffPhone: document.getElementById('ea-phone')?.value || '',
          dropoffName: document.getElementById('ea-name')?.value || '',
          orderValueCents: Math.round(this.cartTotal() * 100),
        })
      });
      const data = await res.json();

      if (data.success) {
        this.deliveryQuote = data;
        this.deliveryQuoteExpired = false;
        this.startQuoteExpiryTimer();
        const eta = data.estimatedDropoffTime
          ? new Date(data.estimatedDropoffTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : null;
        quoteArea.innerHTML = `
          <div class="ea-delivery-quote">
            <div class="ea-quote-fee"><i class="bi bi-check-circle" style="color:#2d6a4f;"></i> Delivery available — <strong>${data.feeFormatted}</strong> via DoorDash</div>
            ${eta ? `<div class="ea-quote-eta"><i class="bi bi-clock"></i> Estimated delivery: <strong>${eta}</strong></div>` : ''}
          </div>
        `;
      } else {
        this.deliveryQuote = null;
        this.clearQuoteExpiryTimer();
        quoteArea.innerHTML = `<div class="ea-delivery-error"><i class="bi bi-exclamation-triangle"></i> ${data.error || 'Delivery not available to this address'}</div>`;
      }
    } catch (err) {
      this.deliveryQuote = null;
      this.clearQuoteExpiryTimer();
      quoteArea.innerHTML = '<div class="ea-delivery-error"><i class="bi bi-exclamation-triangle"></i> Could not get delivery estimate. Please try again.</div>';
    }

    this.deliveryQuoteLoading = false;
    this.updateDeliveryTotals();
  }

  startQuoteExpiryTimer() {
    this.clearQuoteExpiryTimer();
    // DoorDash quotes expire after 5 minutes; warn at 4.5 minutes
    this._quoteExpiryTimer = setTimeout(() => {
      this.deliveryQuoteExpired = true;
      const quoteArea = document.getElementById('ea-delivery-quote-area');
      if (quoteArea) {
        quoteArea.innerHTML = `
          <div class="ea-delivery-error" style="display:flex;flex-direction:column;gap:8px;">
            <div><i class="bi bi-exclamation-triangle"></i> Delivery quote expired. Please refresh for an updated estimate.</div>
            <button type="button" onclick="embedApp.fetchDeliveryQuote()" style="align-self:flex-start;background:var(--embed-primary,#2d6a4f);color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:0.85rem;">
              <i class="bi bi-arrow-clockwise"></i> Refresh Quote
            </button>
          </div>
        `;
      }
      // Disable place order button
      const btn = document.getElementById('ea-place-order-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Quote Expired — Refresh Above';
      }
    }, 270000); // 4.5 minutes = 270,000ms
  }

  clearQuoteExpiryTimer() {
    if (this._quoteExpiryTimer) {
      clearTimeout(this._quoteExpiryTimer);
      this._quoteExpiryTimer = null;
    }
    this.deliveryQuoteExpired = false;
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
      useMockData: false,
      skipPhoneVerification: this.config.skipPhoneVerification || false
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
    toast.innerHTML = `${type === 'error' ? '<i class="bi bi-exclamation-circle"></i>' : '<i class="bi bi-check-circle"></i>'} ${_escHtml(msg)}`;
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
