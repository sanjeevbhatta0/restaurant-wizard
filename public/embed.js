// Restaurant Menu Embed Script
window.RestaurantMenu = {
  init: async function(config) {
    console.log('Initializing RestaurantMenu with config:', config);
    
    if (!config.restaurantId || !config.container) {
      console.error('RestaurantMenu: restaurantId and container are required');
      return;
    }

    this.config = config;
    this.cart.restaurantId = config.restaurantId;

    const container = document.getElementById(config.container);
    if (!container) {
      console.error(`RestaurantMenu: Container '${config.container}' not found`);
      return;
    }

    container.innerHTML = `
      <div class="restaurant-menu-container">
        <div class="restaurant-loading">Loading menu...</div>
      </div>
    `;

    try {
      const menuUrl = `https://us-central1-restaurant-portal-6b147.cloudfunctions.net/getMenu?restaurantId=${encodeURIComponent(config.restaurantId)}`;
      console.log('Fetching menu from:', menuUrl);
      
      const response = await fetch(menuUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Menu data received:', data);

      if (!data || !Array.isArray(data.categories)) {
        console.error('Invalid menu data structure:', data);
        throw new Error('Invalid menu data structure received');
      }

      // Normalize the data
      const normalizedCategories = data.categories.map(category => ({
        id: category.id || '',
        name: category.name || 'Unnamed Category',
        items: Array.isArray(category.items) ? category.items.map(item => ({
          id: item.id || '',
          name: item.name || 'Unnamed Item',
          description: item.description || '',
          price: typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0,
          discount: typeof item.discount === 'number' ? item.discount : parseFloat(item.discount) || 0,
          discountType: item.discountType || 'amount',
          imageUrl: item.imageUrl || ''
        })) : []
      }));

      console.log('Normalized categories:', normalizedCategories);

      container.innerHTML = `
        <div class="restaurant-menu-container">
          <div id="restaurant-menu-categories"></div>
          <div id="restaurant-menu-items"></div>
          <div id="restaurant-cart"></div>
        </div>
      `;

      this.renderMenu(normalizedCategories);
      this.cart.loadCart();
      this.addStyles();
    } catch (error) {
      console.error('Error loading menu:', error);
      container.innerHTML = `
        <div class="restaurant-menu-container">
          <div class="restaurant-error">
            Failed to load menu. Please try again later.<br>
            Error: ${error.message}
          </div>
        </div>
      `;
    }
  },

  renderMenu: function(categories) {
    console.log('Rendering menu with categories:', categories);
    this.renderCategories(categories);
    this.renderItems(categories);
  },

  renderCategories: function(categories) {
    const categoriesContainer = document.getElementById('restaurant-menu-categories');
    if (!categoriesContainer) {
      console.error('Categories container not found');
      return;
    }

    categoriesContainer.innerHTML = `
      <div class="restaurant-categories">
        ${categories.map(category => `
          <div class="restaurant-category" onclick="RestaurantMenu.selectCategory('${category.id}')">
            <h3>${category.name || 'Unnamed Category'}</h3>
            <span class="restaurant-category-count">${Array.isArray(category.items) ? category.items.length : 0} items</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderItems: function(categories) {
    console.log('Rendering items for categories:', categories);
    const itemsContainer = document.getElementById('restaurant-menu-items');
    if (!itemsContainer) {
      console.error('Items container not found');
      return;
    }

    itemsContainer.innerHTML = `
      ${categories.map(category => `
        <div class="restaurant-category-items" id="category-${category.id}">
          <h2>${category.name || 'Unnamed Category'}</h2>
          <div class="restaurant-items-grid">
            ${(category.items || []).map(item => this.renderItemCard(item)).join('')}
          </div>
          ${(!category.items || category.items.length === 0) ? `
            <p class="restaurant-no-items">No items in this category</p>
          ` : ''}
        </div>
      `).join('')}
    `;
  },

  renderItemCard: function(item) {
    if (!item) {
      console.warn('Attempted to render undefined item');
      return '';
    }

    console.log('Rendering item:', item);

    // Ensure all required fields have default values
    const name = item.name || 'Unnamed Item';
    const description = item.description || '';
    const price = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    const discount = typeof item.discount === 'number' ? item.discount : parseFloat(item.discount) || 0;
    const discountType = item.discountType || 'amount';
    
    // Calculate final price with proper validation
    let finalPrice = price;
    if (discount > 0) {
      finalPrice = discountType === 'percentage' 
        ? price * (1 - (discount / 100))
        : price - discount;
    }

    // Ensure finalPrice is never negative and is a valid number
    const displayPrice = Math.max(0, isNaN(finalPrice) ? price : finalPrice);

    // Create a safe version of the item for JSON stringification
    const safeItem = {
      id: item.id || '',
      name: name,
      description: description,
      price: price,
      discount: discount,
      discountType: discountType,
      finalPrice: displayPrice,
      imageUrl: item.imageUrl || ''
    };

    return `
      <div class="restaurant-item-card">
        ${item.imageUrl ? `
          <div class="restaurant-item-image">
            <img src="${item.imageUrl}" alt="${name}" onerror="this.style.display='none'">
          </div>
        ` : ''}
        <div class="restaurant-item-details">
          <h3>${name}</h3>
          <p>${description}</p>
          <div class="restaurant-item-price">
            ${discount > 0 ? `
              <span class="restaurant-item-original-price">$${price.toFixed(2)}</span>
              <span class="restaurant-item-final-price">$${displayPrice.toFixed(2)}</span>
              <span class="restaurant-item-discount">
                ${discountType === 'percentage' ? `${discount}% off` : `$${discount.toFixed(2)} off`}
              </span>
            ` : `
              <span class="restaurant-item-final-price">$${displayPrice.toFixed(2)}</span>
            `}
          </div>
          <button onclick='RestaurantMenu.cart.addItem(${JSON.stringify(safeItem)})' class="restaurant-button-primary">
            Add to Cart
          </button>
        </div>
      </div>
    `;
  },

  selectCategory: function(categoryId) {
    const categories = document.querySelectorAll('.restaurant-category');
    categories.forEach(cat => cat.classList.remove('active'));
    
    const selectedCategory = document.querySelector(`.restaurant-category[onclick*="${categoryId}"]`);
    if (selectedCategory) {
      selectedCategory.classList.add('active');
    }

    const categoryItems = document.querySelectorAll('.restaurant-category-items');
    categoryItems.forEach(items => {
      if (items.id === `category-${categoryId}`) {
        items.scrollIntoView({ behavior: 'smooth' });
      }
    });
  },

  addStyles: function() {
    const styles = `
      .restaurant-menu-container {
        display: grid;
        grid-template-columns: 1fr 3fr;
        gap: 20px;
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
        position: relative;
      }

      .restaurant-loading {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px;
        font-size: 18px;
        color: #666;
      }

      .restaurant-error {
        grid-column: 1 / -1;
        text-align: center;
        padding: 40px;
        color: #dc3545;
        background: #f8d7da;
        border-radius: 8px;
        margin: 20px 0;
      }

      .restaurant-categories {
        position: sticky;
        top: 20px;
        background: white;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .restaurant-category {
        padding: 10px 15px;
        margin-bottom: 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .restaurant-category:hover,
      .restaurant-category.active {
        background-color: #f0f0f0;
      }

      .restaurant-category h3 {
        margin: 0;
        font-size: 16px;
      }

      .restaurant-category-items {
        margin-bottom: 40px;
      }

      .restaurant-items-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 20px;
      }

      .restaurant-item-card {
        background: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: transform 0.2s;
      }

      .restaurant-item-card:hover {
        transform: translateY(-4px);
      }

      .restaurant-item-image {
        width: 100%;
        height: 200px;
        overflow: hidden;
      }

      .restaurant-item-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .restaurant-item-details {
        padding: 15px;
      }

      .restaurant-item-details h3 {
        margin: 0 0 10px 0;
        font-size: 18px;
      }

      .restaurant-item-details p {
        margin: 0 0 15px 0;
        color: #666;
        font-size: 14px;
      }

      .restaurant-item-price {
        margin-bottom: 15px;
      }

      .restaurant-item-original-price {
        text-decoration: line-through;
        color: #999;
        margin-right: 10px;
      }

      .restaurant-item-final-price {
        color: #e41749;
        font-weight: bold;
      }

      .restaurant-item-discount {
        background: #e41749;
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        margin-left: 8px;
      }

      .restaurant-button-primary {
        background: #0d6efd;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        width: 100%;
        transition: background 0.2s;
      }

      .restaurant-button-primary:hover {
        background: #0b5ed7;
      }

      .restaurant-cart {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 300px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        padding: 15px;
      }

      .restaurant-cart-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #eee;
      }

      .restaurant-cart-item-info h4 {
        margin: 0;
        font-size: 14px;
      }

      .restaurant-cart-item-price {
        color: #666;
        font-size: 14px;
        margin: 5px 0 0 0;
      }

      .restaurant-cart-item-quantity {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .restaurant-cart-item-quantity button {
        background: #f0f0f0;
        border: none;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
      }

      .restaurant-cart-total {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 2px solid #eee;
      }

      .restaurant-cart-actions {
        display: flex;
        gap: 10px;
        margin-top: 15px;
      }

      .restaurant-button-secondary {
        background: #f0f0f0;
        color: #333;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        flex: 1;
      }

      @media (max-width: 768px) {
        .restaurant-menu-container {
          grid-template-columns: 1fr;
        }

        .restaurant-categories {
          position: static;
          margin-bottom: 20px;
        }

        .restaurant-items-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
  },

  cart: {
    items: [],
    restaurantId: null,

    addItem: function(item, quantity = 1) {
      const existingItem = this.items.find(i => i.id === item.id);
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        this.items.push({ ...item, quantity });
      }
      this.updateCartUI();
      this.saveCart();
    },

    removeItem: function(itemId) {
      this.items = this.items.filter(item => item.id !== itemId);
      this.updateCartUI();
      this.saveCart();
    },

    updateQuantity: function(itemId, quantity) {
      const item = this.items.find(i => i.id === itemId);
      if (item) {
        item.quantity = Math.max(0, quantity);
        if (item.quantity === 0) {
          this.removeItem(itemId);
        } else {
          this.updateCartUI();
          this.saveCart();
        }
      }
    },

    clearCart: function() {
      this.items = [];
      this.updateCartUI();
      this.saveCart();
    },

    getTotal: function() {
      return this.items.reduce((total, item) => total + (item.finalPrice * item.quantity), 0);
    },

    saveCart: function() {
      localStorage.setItem(`restaurant-cart-${this.restaurantId}`, JSON.stringify(this.items));
    },

    loadCart: function() {
      const saved = localStorage.getItem(`restaurant-cart-${this.restaurantId}`);
      if (saved) {
        this.items = JSON.parse(saved);
        this.updateCartUI();
      }
    },

    updateCartUI: function() {
      const cartContainer = document.getElementById('restaurant-cart');
      if (!cartContainer) return;

      if (this.items.length === 0) {
        cartContainer.innerHTML = `
          <div class="restaurant-cart-empty">
            <p>Your cart is empty</p>
          </div>
        `;
        return;
      }

      cartContainer.innerHTML = `
        <div class="restaurant-cart-items">
          ${this.items.map(item => `
            <div class="restaurant-cart-item">
              <div class="restaurant-cart-item-info">
                <h4>${item.name}</h4>
                <p class="restaurant-cart-item-price">$${(item.finalPrice * item.quantity).toFixed(2)}</p>
              </div>
              <div class="restaurant-cart-item-quantity">
                <button onclick="RestaurantMenu.cart.updateQuantity('${item.id}', ${item.quantity - 1})">-</button>
                <span>${item.quantity}</span>
                <button onclick="RestaurantMenu.cart.updateQuantity('${item.id}', ${item.quantity + 1})">+</button>
              </div>
            </div>
          `).join('')}
          <div class="restaurant-cart-total">
            <h3>Total: $${this.getTotal().toFixed(2)}</h3>
          </div>
          <div class="restaurant-cart-actions">
            <button onclick="RestaurantMenu.cart.clearCart()" class="restaurant-button-secondary">Clear Cart</button>
            <button onclick="RestaurantMenu.showCheckout()" class="restaurant-button-primary">Checkout</button>
          </div>
        </div>
      `;
    }
  },

  showCheckout: function() {
    const checkoutContainer = document.createElement('div');
    checkoutContainer.className = 'restaurant-checkout-modal';
    
    checkoutContainer.innerHTML = `
      <div class="restaurant-checkout-content">
        <h2>Checkout</h2>
        <form id="restaurant-checkout-form">
          <div class="form-group">
            <label>Name</label>
            <input type="text" id="customer-name" required>
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input type="tel" id="customer-phone" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="customer-email" required>
          </div>
          <div class="form-group">
            <label>Pickup Time</label>
            <select id="pickup-time" required>
              ${this.generatePickupTimes()}
            </select>
          </div>
          <div class="form-group">
            <label>Order Type</label>
            <div class="order-type-options">
              <label class="order-type-option">
                <input type="radio" name="order-type" value="pickup" checked>
                Pickup
              </label>
              <label class="order-type-option disabled">
                <input type="radio" name="order-type" value="delivery" disabled>
                Delivery (Coming Soon)
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>Payment Method</label>
            <div class="payment-method-options">
              <label class="payment-method-option">
                <input type="radio" name="payment-method" value="pay-at-restaurant" checked>
                Pay at Restaurant
              </label>
              <label class="payment-method-option disabled">
                <input type="radio" name="payment-method" value="online" disabled>
                Online Payment (Coming Soon)
              </label>
            </div>
          </div>
          <div class="order-summary">
            <h3>Order Summary</h3>
            ${this.cart.items.map(item => `
              <div class="order-item">
                <span>${item.quantity}x ${item.name}</span>
                <span>$${(item.finalPrice * item.quantity).toFixed(2)}</span>
              </div>
            `).join('')}
            <div class="order-total">
              <strong>Total:</strong>
              <strong>$${this.cart.getTotal().toFixed(2)}</strong>
            </div>
          </div>
          <div class="checkout-actions">
            <button type="button" onclick="RestaurantMenu.closeCheckout()" class="restaurant-button-secondary">Back</button>
            <button type="submit" class="restaurant-button-primary">Place Order</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(checkoutContainer);

    document.getElementById('restaurant-checkout-form').onsubmit = (e) => {
      e.preventDefault();
      this.submitOrder();
    };
  },

  closeCheckout: function() {
    const modal = document.querySelector('.restaurant-checkout-modal');
    if (modal) {
      modal.remove();
    }
  },

  generatePickupTimes: function() {
    const now = new Date();
    const times = [];
    const startTime = new Date(now.setMinutes(now.getMinutes() + 30));
    startTime.setMinutes(Math.ceil(startTime.getMinutes() / 15) * 15);

    for (let i = 0; i < 12; i++) {
      const time = new Date(startTime.getTime() + i * 15 * 60000);
      times.push(`
        <option value="${time.toISOString()}">
          ${time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </option>
      `);
    }

    return times.join('');
  },

  submitOrder: async function() {
    const form = document.getElementById('restaurant-checkout-form');
    const orderData = {
      restaurantId: this.cart.restaurantId,
      customerName: form.querySelector('#customer-name').value,
      customerPhone: form.querySelector('#customer-phone').value,
      customerEmail: form.querySelector('#customer-email').value,
      pickupTime: form.querySelector('#pickup-time').value,
      orderType: form.querySelector('input[name="order-type"]:checked').value,
      paymentMethod: form.querySelector('input[name="payment-method"]:checked').value,
      items: this.cart.items,
      total: this.cart.getTotal(),
      status: 'new',
      createdAt: new Date().toISOString()
    };

    try {
      const response = await fetch('https://us-central1-restaurant-portal-6b147.cloudfunctions.net/submitOrder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderData)
      });

      if (!response.ok) throw new Error('Failed to submit order');

      const result = await response.json();
      this.showOrderConfirmation(result.orderId);
      this.cart.clearCart();
    } catch (error) {
      console.error('Error submitting order:', error);
      alert('Failed to submit order. Please try again.');
    }
  },

  showOrderConfirmation: function(orderId) {
    const confirmationContainer = document.createElement('div');
    confirmationContainer.className = 'restaurant-confirmation-modal';
    
    confirmationContainer.innerHTML = `
      <div class="restaurant-confirmation-content">
        <h2>Order Confirmed!</h2>
        <p>Your order number is: #${orderId}</p>
        <p>We'll notify you when your order is ready.</p>
        <button onclick="RestaurantMenu.closeConfirmation()" class="restaurant-button-primary">
          Close
        </button>
      </div>
    `;

    document.body.appendChild(confirmationContainer);
  },

  closeConfirmation: function() {
    const modal = document.querySelector('.restaurant-confirmation-modal');
    if (modal) {
      modal.remove();
    }
  }
}; 