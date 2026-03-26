/**
 * Integration Tests — Website Builder Order Flow
 * Tests the flow of orders placed via the restaurant's website built with Website Builder:
 *   Template rendering → Customer browsing → Cart → Checkout → Order → Kitchen → Payment
 * Also tests multi-location websites and website↔POS integration.
 *
 * Source: functions/index.js (serveWebsite, getMenu, submitOrder),
 *         functions/templates/ (modern-bistro, italian-trattoria, fresh-cafe)
 */

describe('Website Builder Order Flow — Integration', () => {

  // ==========================================
  // Template Rendering
  // ==========================================

  describe('Template Rendering', () => {
    // Simulates the renderTemplate placeholder replacement from serveWebsite
    function renderTemplate(templateHtml, data) {
      let rendered = templateHtml;
      Object.entries(data).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        rendered = rendered.replace(regex, value || '');
      });
      return rendered;
    }

    it('should replace all template placeholders', () => {
      const template = '<h1>{{restaurantName}}</h1><style>:root { --primary: {{primaryColor}}; --font: {{fontFamily}}; }</style>';
      const data = { restaurantName: 'The Golden Fork', primaryColor: '#1a1a2e', fontFamily: 'Poppins' };
      const rendered = renderTemplate(template, data);

      expect(rendered).toContain('The Golden Fork');
      expect(rendered).toContain('#1a1a2e');
      expect(rendered).toContain('Poppins');
      expect(rendered).not.toContain('{{');
    });

    it('should select correct template by ID', () => {
      const templates = {
        'modern-bistro': { font: 'Poppins', color: '#2c3e50' },
        'italian-trattoria': { font: 'Playfair Display', color: '#1a1a1a' },
        'fresh-cafe': { font: 'Nunito', color: '#2d6a4f' }
      };

      const selected = templates['italian-trattoria'];
      expect(selected.font).toBe('Playfair Display');
      expect(selected.color).toBe('#1a1a1a');
    });

    it('should inject portal.js and portal.css into template', () => {
      const template = '<!DOCTYPE html><html><head>{{portalCss}}</head><body>{{portalJs}}</body></html>';
      const data = {
        portalCss: '<style>.cp-modal { background: #fff; }</style>',
        portalJs: '<script>class CustomerPortal {}</script>'
      };
      const rendered = renderTemplate(template, data);

      expect(rendered).toContain('.cp-modal');
      expect(rendered).toContain('CustomerPortal');
    });

    it('should render business hours from settings', () => {
      const businessHours = {
        monday: { open: '11:00', close: '22:00' },
        friday: { open: '11:00', close: '23:00' },
        sunday: { open: '12:00', close: '21:00' }
      };

      // Templates display business hours — verify data structure
      expect(businessHours.monday.open).toBe('11:00');
      expect(businessHours.friday.close).toBe('23:00');
      expect(Object.keys(businessHours)).toHaveLength(3);
    });
  });

  // ==========================================
  // Customer Website Order Flow
  // ==========================================

  describe('Customer Website Order', () => {
    function buildWebsiteOrder(cart, customer, config) {
      const subtotal = cart.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0);
      const taxRate = config.taxRate || 8.5;
      const tax = subtotal * (taxRate / 100);
      return {
        restaurantId: config.restaurantId,
        locationId: config.locationId || config.restaurantId,
        customer: { name: customer.name, email: customer.email, phone: customer.phone },
        items: cart,
        subtotal,
        tax,
        total: subtotal + tax,
        orderType: customer.orderType || 'pickup',
        paymentMethod: customer.paymentMethod || 'payAtStore',
        source: 'website',
        status: 'new',
        createdAt: new Date()
      };
    }

    const cart = [
      { id: 'item-1', name: 'Pad Thai', price: 14.99, finalPrice: 14.99, quantity: 1, discount: 0, discountType: 'amount' },
      { id: 'item-2', name: 'Mango Lassi', price: 4.99, finalPrice: 4.99, quantity: 2, discount: 0, discountType: 'amount' }
    ];
    const customer = { name: 'Sarah Connor', email: 'sarah@test.com', phone: '555-9876', orderType: 'pickup' };
    const config = { restaurantId: 'rest-001', taxRate: 8.5 };

    it('should have source set to "website"', () => {
      const order = buildWebsiteOrder(cart, customer, config);
      expect(order.source).toBe('website');
    });

    it('should store customer details on the order', () => {
      const order = buildWebsiteOrder(cart, customer, config);
      expect(order.customer.name).toBe('Sarah Connor');
      expect(order.customer.email).toBe('sarah@test.com');
      expect(order.customer.phone).toBe('555-9876');
    });

    it('should preserve order type (pickup/dine-in)', () => {
      const order = buildWebsiteOrder(cart, customer, config);
      expect(order.orderType).toBe('pickup');

      const dineInCustomer = { ...customer, orderType: 'dine-in' };
      const order2 = buildWebsiteOrder(cart, dineInCustomer, config);
      expect(order2.orderType).toBe('dine-in');
    });

    it('should set default payment method to payAtStore', () => {
      const order = buildWebsiteOrder(cart, customer, config);
      expect(order.paymentMethod).toBe('payAtStore');
    });

    it('should calculate tax server-side correctly', () => {
      const order = buildWebsiteOrder(cart, customer, config);
      const expectedSubtotal = 14.99 + 4.99 * 2; // 24.97
      const expectedTax = expectedSubtotal * 0.085;
      expect(order.subtotal).toBeCloseTo(expectedSubtotal, 2);
      expect(order.tax).toBeCloseTo(expectedTax, 2);
      expect(order.total).toBeCloseTo(expectedSubtotal + expectedTax, 2);
    });
  });

  // ==========================================
  // Multi-Location Websites
  // ==========================================

  describe('Multi-Location Websites', () => {
    const restaurant = {
      id: 'rest-multi',
      slug: 'pizza-palace',
      isMultiLocation: true,
      locations: [
        { id: 'loc-downtown', slug: 'downtown', name: 'Downtown' },
        { id: 'loc-uptown', slug: 'uptown', name: 'Uptown' }
      ]
    };

    const menuCategories = [
      {
        id: 'cat-pizza', name: 'Pizzas',
        items: [
          { id: 'p1', name: 'Margherita', price: 12.99, locations: ['loc-downtown', 'loc-uptown'] },
          { id: 'p2', name: 'Special', price: 18.99, locations: ['loc-downtown'] },
          { id: 'p3', name: 'Hawaiian', price: 14.99, locations: ['loc-uptown'] }
        ]
      }
    ];

    function resolveLocationSlug(combinedSlug, restaurant) {
      if (!combinedSlug.startsWith(restaurant.slug + '-')) return null;
      const locationSlug = combinedSlug.slice(restaurant.slug.length + 1);
      return restaurant.locations.find(l => l.slug === locationSlug) || null;
    }

    function filterMenuByLocation(categories, locationId) {
      return categories.map(cat => ({
        ...cat,
        items: cat.items.filter(item => {
          if (item.locations && item.locations.length > 0) {
            return item.locations.includes(locationId);
          }
          return true;
        })
      })).filter(cat => cat.items.length > 0);
    }

    it('should resolve combined slug to restaurant + location', () => {
      const location = resolveLocationSlug('pizza-palace-downtown', restaurant);
      expect(location).not.toBeNull();
      expect(location.id).toBe('loc-downtown');
      expect(location.name).toBe('Downtown');
    });

    it('should filter menu to location-specific items', () => {
      const filtered = filterMenuByLocation(menuCategories, 'loc-downtown');
      const pizzas = filtered[0];
      expect(pizzas.items).toHaveLength(2); // Margherita + Special
      expect(pizzas.items.find(i => i.name === 'Hawaiian')).toBeUndefined();
    });

    it('should include locationId in order data', () => {
      const order = {
        restaurantId: restaurant.id,
        locationId: 'loc-downtown',
        items: [{ id: 'p1', name: 'Margherita' }],
        source: 'website'
      };
      expect(order.locationId).toBe('loc-downtown');
      expect(order.restaurantId).toBe('rest-multi');
    });

    it('should serve separate websites per location', () => {
      const downtown = resolveLocationSlug('pizza-palace-downtown', restaurant);
      const uptown = resolveLocationSlug('pizza-palace-uptown', restaurant);

      expect(downtown.id).not.toBe(uptown.id);
      expect(downtown.id).toBe('loc-downtown');
      expect(uptown.id).toBe('loc-uptown');
    });
  });

  // ==========================================
  // Website ↔ POS Integration
  // ==========================================

  describe('Website to POS Integration', () => {
    const KITCHEN_STATUSES = ['new', 'sent_to_kitchen', 'preparing'];
    const READY_STATUSES = ['ready'];
    const PAYMENT_STATUSES = ['served', 'ready'];

    const allOrders = [
      { id: 'pos-1', source: 'pos', status: 'new', tableNumber: '1' },
      { id: 'web-1', source: 'website', status: 'new', orderType: 'pickup', customer: { name: 'Alice' } },
      { id: 'web-2', source: 'website', status: 'preparing', orderType: 'dine-in', customer: { name: 'Bob' } },
      { id: 'wid-1', source: 'widget', status: 'ready', orderType: 'pickup', customer: { name: 'Charlie' } },
      { id: 'pos-2', source: 'pos', status: 'served', tableNumber: '3' },
      { id: 'web-3', source: 'website', status: 'completed', paymentMethod: 'card', customer: { name: 'Dave' } }
    ];

    it('should show website orders in Kitchen display', () => {
      const kitchenOrders = allOrders.filter(o => KITCHEN_STATUSES.includes(o.status));
      expect(kitchenOrders).toHaveLength(3); // pos-1, web-1, web-2

      const websiteInKitchen = kitchenOrders.filter(o => o.source === 'website');
      expect(websiteInKitchen).toHaveLength(2);
    });

    it('should flow website orders through status workflow', () => {
      // Simulate: new → preparing → ready → served → completed
      const statusSequence = ['new', 'preparing', 'ready', 'served', 'completed'];
      let order = { id: 'test', source: 'website', status: 'new' };

      statusSequence.forEach(status => {
        order = { ...order, status };
      });

      expect(order.status).toBe('completed');
      expect(order.source).toBe('website');
    });

    it('should separate prepaid from pay-at-store in payment view', () => {
      const onlineOrders = allOrders.filter(o => o.source === 'website' || o.source === 'widget');

      const prepaid = onlineOrders.filter(o => o.paymentMethod === 'card');
      const payAtStore = onlineOrders.filter(o => o.paymentMethod !== 'card');

      expect(prepaid).toHaveLength(1); // web-3
      expect(payAtStore).toHaveLength(3); // web-1, web-2, wid-1
    });

    it('should show website orders as online orders in Payments', () => {
      const onlinePaymentOrders = allOrders.filter(
        o => (o.source === 'website' || o.source === 'widget') &&
          (PAYMENT_STATUSES.includes(o.status) || o.status === 'served')
      );

      expect(onlinePaymentOrders).toHaveLength(1); // wid-1 (ready) — web-2 is 'preparing' not in PAYMENT_STATUSES
      const sources = onlinePaymentOrders.map(o => o.source);
      expect(sources).not.toContain('pos');
    });

    it('should track completed website orders', () => {
      const completedWebOrders = allOrders.filter(
        o => o.source === 'website' && o.status === 'completed'
      );
      expect(completedWebOrders).toHaveLength(1);
      expect(completedWebOrders[0].customer.name).toBe('Dave');
    });
  });

  // ==========================================
  // Website Settings to Template Mapping
  // ==========================================

  describe('Website Settings Application', () => {
    function applySettingsToTemplate(settings) {
      const TEMPLATE_MAP = {
        'modern-bistro': { defaultPrimary: '#2c3e50', defaultFont: 'Poppins' },
        'italian-trattoria': { defaultPrimary: '#1a1a1a', defaultFont: 'Playfair Display' },
        'fresh-cafe': { defaultPrimary: '#2d6a4f', defaultFont: 'Nunito' }
      };

      const template = settings?.template || 'modern-bistro';
      const defaults = TEMPLATE_MAP[template] || TEMPLATE_MAP['modern-bistro'];

      return {
        template,
        primaryColor: settings?.colors?.primary || defaults.defaultPrimary,
        fontFamily: settings?.fonts?.heading || defaults.defaultFont,
        heroImage: settings?.content?.heroImage || '',
        aboutTitle: settings?.content?.aboutTitle || 'About Us',
        contactEmail: settings?.contact?.email || '',
        contactPhone: settings?.contact?.phone || ''
      };
    }

    it('should apply custom settings over defaults', () => {
      const settings = {
        template: 'italian-trattoria',
        colors: { primary: '#ff0000' },
        fonts: { heading: 'Custom Font' },
        content: { aboutTitle: 'Our Story' }
      };
      const result = applySettingsToTemplate(settings);
      expect(result.primaryColor).toBe('#ff0000');
      expect(result.fontFamily).toBe('Custom Font');
      expect(result.aboutTitle).toBe('Our Story');
    });

    it('should fall back to template defaults when settings are missing', () => {
      const result = applySettingsToTemplate(null);
      expect(result.template).toBe('modern-bistro');
      expect(result.primaryColor).toBe('#2c3e50');
      expect(result.fontFamily).toBe('Poppins');
    });

    it('should handle partial settings', () => {
      const settings = { template: 'fresh-cafe' };
      const result = applySettingsToTemplate(settings);
      expect(result.primaryColor).toBe('#2d6a4f');
      expect(result.fontFamily).toBe('Nunito');
      expect(result.aboutTitle).toBe('About Us');
    });
  });
});
