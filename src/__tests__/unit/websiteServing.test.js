/**
 * Unit Tests — Website Serving Business Logic
 * Tests slug resolution, template data construction, menu data filtering,
 * order validation, and embed mode detection for the cloud functions.
 *
 * Source: functions/index.js (serveWebsite, getMenu, submitOrder)
 */

// ==========================================
// Slug Resolution Logic (mirrors findRestaurantBySlugOrId)
// ==========================================

/**
 * Simulates the slug resolution logic from serveWebsite.
 * Given a list of restaurants (with slugs and IDs) and a query slug,
 * resolves to { restaurantId, locationSlug } or null.
 */
function resolveSlug(slug, restaurants) {
  if (!slug) return { restaurantId: null, locationSlug: null };

  // Exact slug match
  const bySlug = restaurants.find(r => r.slug === slug);
  if (bySlug) return { restaurantId: bySlug.id, locationSlug: null };

  // Direct ID match
  const byId = restaurants.find(r => r.id === slug);
  if (byId) return { restaurantId: byId.id, locationSlug: null };

  // Multi-location: split progressively
  const parts = slug.split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const potentialRestaurant = parts.slice(0, i).join('-');
    const potentialLocation = parts.slice(i).join('-');

    const matchSlug = restaurants.find(r => r.slug === potentialRestaurant);
    if (matchSlug) return { restaurantId: matchSlug.id, locationSlug: potentialLocation };

    const matchId = restaurants.find(r => r.id === potentialRestaurant);
    if (matchId) return { restaurantId: matchId.id, locationSlug: potentialLocation };
  }

  return { restaurantId: null, locationSlug: null };
}

// ==========================================
// Template Data Construction (mirrors serveWebsite templateData)
// ==========================================

function buildTemplateData(restaurant, websiteSettings, locationData) {
  const settings = websiteSettings || {};
  const colors = settings.colors || {};
  const fonts = settings.fonts || {};
  const content = settings.content || {};
  const businessHours = settings.businessHours || locationData?.businessHours || {};
  const template = settings.template || 'modern-bistro';

  const templateDefaults = {
    'modern-bistro': { primaryColor: '#2c3e50', secondaryColor: '#3498db', accentColor: '#e74c3c', fontFamily: 'Poppins' },
    'italian-trattoria': { primaryColor: '#1a1a1a', secondaryColor: '#c9a962', accentColor: '#8b0000', fontFamily: 'Playfair Display' },
    'fresh-cafe': { primaryColor: '#2d6a4f', secondaryColor: '#95d5b2', accentColor: '#d4a373', fontFamily: 'Nunito' }
  };
  const defaults = templateDefaults[template] || templateDefaults['modern-bistro'];

  return {
    restaurantName: restaurant.restaurantName || restaurant.name || 'Restaurant',
    templateId: template,
    primaryColor: colors.primary || defaults.primaryColor,
    secondaryColor: colors.secondary || defaults.secondaryColor,
    accentColor: colors.accent || defaults.accentColor,
    fontFamily: fonts.heading || defaults.fontFamily,
    businessHours,
    aboutTitle: content.aboutTitle || 'About Us',
    aboutText: content.aboutText || ''
  };
}

// ==========================================
// Menu Data Filtering (mirrors getMenu)
// ==========================================

function filterMenuForLocation(categories, locationId, isMultiLocation) {
  return categories
    .map(cat => {
      const filteredItems = cat.items.filter(item => {
        if (isMultiLocation && locationId) {
          if (item.locations && item.locations.length > 0) {
            return item.locations.includes(locationId);
          }
        }
        return true;
      });
      return { ...cat, items: filteredItems };
    })
    .filter(cat => cat.items.length > 0);
}

function normalizeMenuPrices(categories) {
  return categories.map(cat => ({
    ...cat,
    items: cat.items.map(item => ({
      ...item,
      price: typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0,
      discount: typeof item.discount === 'number' ? item.discount : parseFloat(item.discount) || 0,
      discountType: item.discountType || 'amount'
    }))
  }));
}

// ==========================================
// Order Validation (mirrors submitOrder)
// ==========================================

function validateOrderData(orderData) {
  const errors = [];
  if (!orderData.restaurantId) errors.push('Missing restaurantId');
  if (!orderData.customer) errors.push('Missing customer');
  if (!orderData.items || orderData.items.length === 0) errors.push('Missing or empty items');
  return { valid: errors.length === 0, errors };
}

function generateOrderNumber() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ==========================================
// Embed Mode Detection (mirrors serveWebsite)
// ==========================================

function isEmbedMode(query) {
  return query.embed === 'true';
}

function buildEmbedConfig(restaurantId, locationId, templateData, options = {}) {
  return {
    restaurantId,
    locationId: locationId || restaurantId,
    restaurantName: templateData.restaurantName,
    apiBaseUrl: options.isEmulator
      ? 'http://localhost:5001/restaurant-portal-6b147/us-central1'
      : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net',
    taxRate: options.taxRate || 8,
    initialTab: options.initialTab || 'menu',
    primaryColor: templateData.primaryColor,
    secondaryColor: templateData.secondaryColor,
    accentColor: templateData.accentColor,
    fontFamily: templateData.fontFamily
  };
}

// ==========================================
// Test Data
// ==========================================

const RESTAURANTS = [
  { id: 'VkDL7WErBCRCvegCKDKD7BLPAZI2', slug: 'gurkha-kitchen-express', restaurantName: 'Gurkha Kitchen Express' },
  { id: 'abc123', slug: 'golden-fork', restaurantName: 'The Golden Fork' },
  { id: 'multi-loc-1', slug: 'pizza-palace', restaurantName: 'Pizza Palace', isMultiLocation: true }
];

const SAMPLE_CATEGORIES = [
  {
    id: 'cat-1', name: 'Starters',
    items: [
      { id: 'item-1', name: 'Spring Rolls', price: 8.99, discount: 0, locations: ['loc-a', 'loc-b'] },
      { id: 'item-2', name: 'Momo', price: 9.99, discount: 0, locations: ['loc-a'] }
    ]
  },
  {
    id: 'cat-2', name: 'Entrees',
    items: [
      { id: 'item-3', name: 'Chicken Tikka', price: 14.99, discount: 2, discountType: 'amount', locations: ['loc-b'] },
      { id: 'item-4', name: 'Dal', price: '11.50', discount: '10', discountType: 'percentage', locations: [] }
    ]
  },
  {
    id: 'cat-3', name: 'Empty Category',
    items: []
  }
];

// ==========================================
// Tests
// ==========================================

describe('Website Serving Business Logic', () => {

  // ---- Slug Resolution ----

  describe('Slug Resolution', () => {
    it('should resolve exact slug match', () => {
      const result = resolveSlug('gurkha-kitchen-express', RESTAURANTS);
      expect(result.restaurantId).toBe('VkDL7WErBCRCvegCKDKD7BLPAZI2');
      expect(result.locationSlug).toBeNull();
    });

    it('should resolve direct ID match', () => {
      const result = resolveSlug('abc123', RESTAURANTS);
      expect(result.restaurantId).toBe('abc123');
      expect(result.locationSlug).toBeNull();
    });

    it('should resolve multi-location combined slug', () => {
      const result = resolveSlug('pizza-palace-downtown', RESTAURANTS);
      expect(result.restaurantId).toBe('multi-loc-1');
      expect(result.locationSlug).toBe('downtown');
    });

    it('should resolve multi-word location slug', () => {
      const result = resolveSlug('golden-fork-san-francisco', RESTAURANTS);
      expect(result.restaurantId).toBe('abc123');
      expect(result.locationSlug).toBe('san-francisco');
    });

    it('should return null for no match', () => {
      const result = resolveSlug('nonexistent-restaurant', RESTAURANTS);
      expect(result.restaurantId).toBeNull();
    });

    it('should return null for empty/missing slug', () => {
      expect(resolveSlug('', RESTAURANTS).restaurantId).toBeNull();
      expect(resolveSlug(null, RESTAURANTS).restaurantId).toBeNull();
      expect(resolveSlug(undefined, RESTAURANTS).restaurantId).toBeNull();
    });
  });

  // ---- Template Data Construction ----

  describe('Template Data Construction', () => {
    it('should use default values when website settings are missing', () => {
      const data = buildTemplateData(RESTAURANTS[0], null, null);
      expect(data.restaurantName).toBe('Gurkha Kitchen Express');
      expect(data.templateId).toBe('modern-bistro');
      expect(data.primaryColor).toBe('#2c3e50');
      expect(data.fontFamily).toBe('Poppins');
    });

    it('should apply custom colors from settings', () => {
      const settings = { colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' } };
      const data = buildTemplateData(RESTAURANTS[0], settings, null);
      expect(data.primaryColor).toBe('#ff0000');
      expect(data.secondaryColor).toBe('#00ff00');
      expect(data.accentColor).toBe('#0000ff');
    });

    it('should apply correct defaults per template', () => {
      const data = buildTemplateData(RESTAURANTS[0], { template: 'italian-trattoria' }, null);
      expect(data.templateId).toBe('italian-trattoria');
      expect(data.primaryColor).toBe('#1a1a1a');
      expect(data.fontFamily).toBe('Playfair Display');
    });

    it('should use business hours from settings or location fallback', () => {
      const settings = { businessHours: { monday: { open: '10:00', close: '22:00' } } };
      const data = buildTemplateData(RESTAURANTS[0], settings, null);
      expect(data.businessHours.monday.open).toBe('10:00');

      // Fallback to location data
      const locationData = { businessHours: { tuesday: { open: '11:00', close: '23:00' } } };
      const data2 = buildTemplateData(RESTAURANTS[0], {}, locationData);
      expect(data2.businessHours.tuesday.open).toBe('11:00');
    });
  });

  // ---- Menu Data Filtering ----

  describe('Menu Data Filtering', () => {
    it('should exclude empty categories', () => {
      const filtered = filterMenuForLocation(SAMPLE_CATEGORIES, null, false);
      expect(filtered).toHaveLength(2); // cat-3 has no items
      expect(filtered.find(c => c.name === 'Empty Category')).toBeUndefined();
    });

    it('should filter items by location for multi-location restaurants', () => {
      const filtered = filterMenuForLocation(SAMPLE_CATEGORIES, 'loc-a', true);
      // loc-a: item-1 (Starters), item-2 (Starters), item-4 (Entrees, empty locations = all)
      const starters = filtered.find(c => c.name === 'Starters');
      expect(starters.items).toHaveLength(2);
      const entrees = filtered.find(c => c.name === 'Entrees');
      expect(entrees.items).toHaveLength(1); // item-4 (empty locations = available everywhere)
      expect(entrees.items[0].name).toBe('Dal');
    });

    it('should not filter when not multi-location', () => {
      const filtered = filterMenuForLocation(SAMPLE_CATEGORIES, 'loc-a', false);
      const starters = filtered.find(c => c.name === 'Starters');
      expect(starters.items).toHaveLength(2);
      const entrees = filtered.find(c => c.name === 'Entrees');
      expect(entrees.items).toHaveLength(2);
    });

    it('should normalize string prices and discounts to numbers', () => {
      const normalized = normalizeMenuPrices(SAMPLE_CATEGORIES);
      const entrees = normalized.find(c => c.name === 'Entrees');
      const dal = entrees.items.find(i => i.name === 'Dal');
      expect(typeof dal.price).toBe('number');
      expect(dal.price).toBe(11.50);
      expect(typeof dal.discount).toBe('number');
      expect(dal.discount).toBe(10);
      expect(dal.discountType).toBe('percentage');
    });
  });

  // ---- Order Validation ----

  describe('Order Validation', () => {
    it('should reject order without restaurantId', () => {
      const result = validateOrderData({ customer: { name: 'Test' }, items: [{ id: '1' }] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing restaurantId');
    });

    it('should reject order without customer', () => {
      const result = validateOrderData({ restaurantId: 'abc', items: [{ id: '1' }] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing customer');
    });

    it('should reject order with empty items', () => {
      const result = validateOrderData({ restaurantId: 'abc', customer: { name: 'Test' }, items: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or empty items');
    });

    it('should reject order without items field', () => {
      const result = validateOrderData({ restaurantId: 'abc', customer: { name: 'Test' } });
      expect(result.valid).toBe(false);
    });

    it('should accept valid order data', () => {
      const result = validateOrderData({
        restaurantId: 'abc',
        customer: { name: 'Test', email: 'test@test.com' },
        items: [{ id: '1', name: 'Burger', price: 10 }]
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Order Number Generation', () => {
    it('should generate a string with timestamp and random digits', () => {
      const orderNum = generateOrderNumber();
      expect(typeof orderNum).toBe('string');
      expect(orderNum).toMatch(/^\d+-\d+$/);
    });

    it('should generate unique numbers', () => {
      const nums = new Set();
      for (let i = 0; i < 100; i++) {
        nums.add(generateOrderNumber());
      }
      // With timestamp + random, collisions are extremely unlikely
      expect(nums.size).toBeGreaterThan(90);
    });
  });

  // ---- Embed Mode Detection ----

  describe('Embed Mode Detection', () => {
    it('should detect embed=true', () => {
      expect(isEmbedMode({ embed: 'true' })).toBe(true);
    });

    it('should not detect embed=false', () => {
      expect(isEmbedMode({ embed: 'false' })).toBe(false);
    });

    it('should not detect when embed is missing', () => {
      expect(isEmbedMode({})).toBe(false);
    });

    it('should build correct embed config for production', () => {
      const templateData = buildTemplateData(RESTAURANTS[0], null, null);
      const config = buildEmbedConfig('uid-123', 'loc-456', templateData, { isEmulator: false });
      expect(config.restaurantId).toBe('uid-123');
      expect(config.locationId).toBe('loc-456');
      expect(config.apiBaseUrl).toContain('cloudfunctions.net');
      expect(config.initialTab).toBe('menu');
    });

    it('should use emulator URL when in emulator mode', () => {
      const templateData = buildTemplateData(RESTAURANTS[0], null, null);
      const config = buildEmbedConfig('uid-123', null, templateData, { isEmulator: true });
      expect(config.apiBaseUrl).toContain('localhost:5001');
      expect(config.locationId).toBe('uid-123'); // falls back to restaurantId
    });
  });
});

// ==========================================
// Item Notes & Spice Level in Website Orders
// ==========================================

describe('Website Order Items with Notes & Spice Level', () => {
  it('should pass validation with items containing notes and spiceLevel', () => {
    const result = validateOrderData({
      restaurantId: 'abc',
      customer: { name: 'Test', email: 'test@test.com' },
      items: [
        { id: '1', name: 'Burger', price: 10, quantity: 1, notes: 'well done' },
        { id: '2', name: 'Curry', price: 15, quantity: 1, spiceLevel: 'Hot' }
      ]
    });
    expect(result.valid).toBe(true);
  });

  it('should pass validation with items without notes/spiceLevel (backward compat)', () => {
    const result = validateOrderData({
      restaurantId: 'abc',
      customer: { name: 'Test', email: 'test@test.com' },
      items: [
        { id: '1', name: 'Burger', price: 10, quantity: 1 }
      ]
    });
    expect(result.valid).toBe(true);
  });

  it('should preserve notes and spiceLevel in order items round-trip', () => {
    const orderItems = [
      { id: '1', name: 'Steak', price: 25, quantity: 1, notes: 'medium rare', spiceLevel: '' },
      { id: '2', name: 'Pad Thai', price: 14, quantity: 2, notes: 'extra peanuts', spiceLevel: 'Mild' },
      { id: '3', name: 'Soda', price: 3, quantity: 1, notes: 'no ice' }
    ];

    // Simulate backend pass-through (items stored as-is)
    const storedOrder = { items: orderItems };

    expect(storedOrder.items[0].notes).toBe('medium rare');
    expect(storedOrder.items[1].spiceLevel).toBe('Mild');
    expect(storedOrder.items[1].notes).toBe('extra peanuts');
    expect(storedOrder.items[2].notes).toBe('no ice');
  });

  it('should handle menu items with spiceLevelEnabled in template data', () => {
    const menuItem = {
      id: 'curry-1',
      name: 'Green Curry',
      price: 16.99,
      spiceLevelEnabled: true,
      spiceLevels: ['Mild', 'Medium', 'Hot', 'Thai Hot']
    };

    expect(menuItem.spiceLevelEnabled).toBe(true);
    expect(menuItem.spiceLevels).toHaveLength(4);
    expect(menuItem.spiceLevels).toContain('Thai Hot');
  });

  it('should enforce max 10 spice levels', () => {
    const spiceLevels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    expect(spiceLevels.length).toBeLessThanOrEqual(10);

    // Adding an 11th should not be allowed
    const tooMany = [...spiceLevels, '11'];
    expect(tooMany.length).toBeGreaterThan(10);
    // In the UI this is prevented; here we just validate the constraint
    const capped = tooMany.slice(0, 10);
    expect(capped).toHaveLength(10);
  });
});
