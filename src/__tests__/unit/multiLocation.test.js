/**
 * Unit Tests — Multi-Location Business Logic
 * Tests location-scoped filtering, cache key isolation, promotion location targeting,
 * and order/analytics location filtering logic.
 */

describe('Multi-Location Business Logic', () => {
  // ==========================================
  // Location-Scoped Order Filtering
  // ==========================================

  describe('Order Location Filtering', () => {
    const orders = [
      { id: 'o1', locationId: 'loc-a', status: 'completed', total: 25.00, createdAt: new Date('2026-04-01') },
      { id: 'o2', locationId: 'loc-b', status: 'completed', total: 30.00, createdAt: new Date('2026-04-01') },
      { id: 'o3', locationId: 'loc-a', status: 'preparing', total: 15.00, createdAt: new Date('2026-04-02') },
      { id: 'o4', locationId: 'loc-c', status: 'served', total: 40.00, createdAt: new Date('2026-04-02') },
      { id: 'o5', total: 10.00, status: 'completed', createdAt: new Date('2026-03-15') }, // old order, no locationId
    ];

    const filterByLocation = (orders, selectedLocation, isMultiLocation) => {
      if (!isMultiLocation || !selectedLocation) return orders;
      return orders.filter(o => o.locationId === selectedLocation);
    };

    it('should return only orders for selected location', () => {
      const filtered = filterByLocation(orders, 'loc-a', true);
      expect(filtered).toHaveLength(2);
      expect(filtered.every(o => o.locationId === 'loc-a')).toBe(true);
    });

    it('should return all orders when not multi-location', () => {
      const filtered = filterByLocation(orders, 'loc-a', false);
      expect(filtered).toHaveLength(5);
    });

    it('should return all orders when no location selected', () => {
      const filtered = filterByLocation(orders, null, true);
      expect(filtered).toHaveLength(5);
    });

    it('should return empty array for location with no orders', () => {
      const filtered = filterByLocation(orders, 'loc-z', true);
      expect(filtered).toHaveLength(0);
    });

    it('should exclude old orders without locationId for multi-location', () => {
      const filtered = filterByLocation(orders, 'loc-a', true);
      expect(filtered.find(o => !o.locationId)).toBeUndefined();
    });
  });

  // ==========================================
  // Menu Cache Key Isolation
  // ==========================================

  describe('Menu Cache Key Isolation', () => {
    const MENU_CACHE_KEY = 'restaurant_menu_cache';

    const getCacheKey = (restaurantUid, selectedLocation) => {
      return selectedLocation
        ? `${MENU_CACHE_KEY}_${restaurantUid}_${selectedLocation}`
        : `${MENU_CACHE_KEY}_${restaurantUid}`;
    };

    it('should include locationId in cache key when location selected', () => {
      const key = getCacheKey('rest-123', 'loc-a');
      expect(key).toBe('restaurant_menu_cache_rest-123_loc-a');
    });

    it('should not include locationId when no location selected', () => {
      const key = getCacheKey('rest-123', null);
      expect(key).toBe('restaurant_menu_cache_rest-123');
    });

    it('should produce different keys for different locations', () => {
      const keyA = getCacheKey('rest-123', 'loc-a');
      const keyB = getCacheKey('rest-123', 'loc-b');
      expect(keyA).not.toBe(keyB);
    });

    it('should produce different keys for different restaurants', () => {
      const key1 = getCacheKey('rest-123', 'loc-a');
      const key2 = getCacheKey('rest-456', 'loc-a');
      expect(key1).not.toBe(key2);
    });
  });

  // ==========================================
  // Promotion Location Targeting
  // ==========================================

  describe('Promotion Location Targeting', () => {
    const promotions = [
      { id: 'p1', title: 'All Locations Sale', locationIds: [], discount: '10%', type: 'percentage' },
      { id: 'p2', title: 'Downtown Only', locationIds: ['loc-a'], discount: '20%', type: 'percentage' },
      { id: 'p3', title: 'Two Locations', locationIds: ['loc-a', 'loc-b'], discount: '15%', type: 'percentage' },
      { id: 'p4', title: 'Uptown Only', locationIds: ['loc-c'], discount: '25%', type: 'percentage' },
      { id: 'p5', title: 'Legacy Promo (no locationIds)', discount: '5%', type: 'percentage' }, // no locationIds field
    ];

    const filterPromosByLocation = (promos, selectedLocation, isMultiLocation) => {
      if (!isMultiLocation || !selectedLocation) return promos;
      return promos.filter(p => {
        if (!p.locationIds || p.locationIds.length === 0) return true; // all-location promos
        return p.locationIds.includes(selectedLocation);
      });
    };

    it('should show all promos when not multi-location', () => {
      const filtered = filterPromosByLocation(promotions, null, false);
      expect(filtered).toHaveLength(5);
    });

    it('should include all-location promos (empty locationIds) for any location', () => {
      const filtered = filterPromosByLocation(promotions, 'loc-a', true);
      expect(filtered.find(p => p.id === 'p1')).toBeDefined(); // empty array = all
    });

    it('should include legacy promos (no locationIds field) for any location', () => {
      const filtered = filterPromosByLocation(promotions, 'loc-a', true);
      expect(filtered.find(p => p.id === 'p5')).toBeDefined(); // undefined = all
    });

    it('should include location-specific promo when location matches', () => {
      const filtered = filterPromosByLocation(promotions, 'loc-a', true);
      expect(filtered.find(p => p.id === 'p2')).toBeDefined(); // loc-a only
      expect(filtered.find(p => p.id === 'p3')).toBeDefined(); // loc-a + loc-b
    });

    it('should exclude location-specific promo when location does not match', () => {
      const filtered = filterPromosByLocation(promotions, 'loc-a', true);
      expect(filtered.find(p => p.id === 'p4')).toBeUndefined(); // loc-c only
    });

    it('should filter correctly for loc-b', () => {
      const filtered = filterPromosByLocation(promotions, 'loc-b', true);
      expect(filtered).toHaveLength(3); // p1 (all), p3 (loc-a+loc-b), p5 (legacy)
      expect(filtered.find(p => p.id === 'p2')).toBeUndefined(); // loc-a only
      expect(filtered.find(p => p.id === 'p4')).toBeUndefined(); // loc-c only
    });

    it('should show only all-location + legacy promos for unknown location', () => {
      const filtered = filterPromosByLocation(promotions, 'loc-z', true);
      expect(filtered).toHaveLength(2); // p1 (all), p5 (legacy)
    });

    it('should return all when selectedLocation is null even if multi-location', () => {
      const filtered = filterPromosByLocation(promotions, null, true);
      expect(filtered).toHaveLength(5);
    });
  });

  // ==========================================
  // Promotion Location Selection Modes
  // ==========================================

  describe('Promotion Location Selection on Save', () => {
    const locations = [
      { id: 'loc-a', name: 'Downtown' },
      { id: 'loc-b', name: 'Uptown' },
      { id: 'loc-c', name: 'Airport' },
    ];

    const buildLocationIds = (locationSelectMode, selectedLocationIds) => {
      if (locationSelectMode === 'all') return [];
      return selectedLocationIds;
    };

    it('should save empty array for "all" mode', () => {
      const ids = buildLocationIds('all', ['loc-a']);
      expect(ids).toEqual([]);
    });

    it('should save selected IDs for "specific" mode', () => {
      const ids = buildLocationIds('specific', ['loc-a', 'loc-b']);
      expect(ids).toEqual(['loc-a', 'loc-b']);
    });

    it('should save single ID for single-location selection', () => {
      const ids = buildLocationIds('specific', ['loc-c']);
      expect(ids).toEqual(['loc-c']);
    });

    it('should save empty array when "specific" but nothing selected', () => {
      const ids = buildLocationIds('specific', []);
      expect(ids).toEqual([]);
    });
  });

  // ==========================================
  // Menu Item Location Filtering
  // ==========================================

  describe('Menu Item Location Filtering', () => {
    const categories = [
      {
        id: 'cat-1', name: 'Appetizers',
        items: [
          { id: 'i1', name: 'Spring Rolls', price: 8.00, locations: ['loc-a', 'loc-b'] },
          { id: 'i2', name: 'Soup', price: 5.00, locations: [] }, // all locations
          { id: 'i3', name: 'Nachos', price: 10.00, locations: ['loc-c'] },
          { id: 'i4', name: 'Bread', price: 3.00 }, // no locations field = all
        ]
      },
      {
        id: 'cat-2', name: 'Entrees',
        items: [
          { id: 'i5', name: 'Burger', price: 14.00, locations: ['loc-a'] },
          { id: 'i6', name: 'Pasta', price: 12.00, locations: ['loc-b', 'loc-c'] },
        ]
      }
    ];

    const filterMenuByLocation = (categories, selectedLocation, isMultiLocation) => {
      if (!isMultiLocation || !selectedLocation) return categories;
      return categories.map(cat => ({
        ...cat,
        items: (cat.items || []).filter(item => {
          if (!item.locations || item.locations.length === 0) return true;
          return item.locations.includes(selectedLocation);
        })
      }));
    };

    it('should return all items when not multi-location', () => {
      const result = filterMenuByLocation(categories, null, false);
      expect(result[0].items).toHaveLength(4);
      expect(result[1].items).toHaveLength(2);
    });

    it('should filter items to selected location (loc-a)', () => {
      const result = filterMenuByLocation(categories, 'loc-a', true);
      // Appetizers: Spring Rolls (loc-a), Soup (all), Bread (no field = all) = 3
      expect(result[0].items).toHaveLength(3);
      // Entrees: Burger (loc-a) = 1
      expect(result[1].items).toHaveLength(1);
      expect(result[1].items[0].name).toBe('Burger');
    });

    it('should filter items to selected location (loc-b)', () => {
      const result = filterMenuByLocation(categories, 'loc-b', true);
      // Appetizers: Spring Rolls (loc-a+b), Soup (all), Bread (all) = 3
      expect(result[0].items).toHaveLength(3);
      // Entrees: Pasta (loc-b+c) = 1
      expect(result[1].items).toHaveLength(1);
      expect(result[1].items[0].name).toBe('Pasta');
    });

    it('should include items with empty locations array at all locations', () => {
      const result = filterMenuByLocation(categories, 'loc-c', true);
      const soupItem = result[0].items.find(i => i.name === 'Soup');
      expect(soupItem).toBeDefined();
    });

    it('should include items with no locations field at all locations', () => {
      const result = filterMenuByLocation(categories, 'loc-c', true);
      const breadItem = result[0].items.find(i => i.name === 'Bread');
      expect(breadItem).toBeDefined();
    });

    it('should not mutate original category items array', () => {
      filterMenuByLocation(categories, 'loc-a', true);
      expect(categories[0].items).toHaveLength(4); // original unchanged
    });
  });

  // ==========================================
  // Today Stats — Location-Scoped
  // ==========================================

  describe('Today Stats Calculation (Location-Scoped)', () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(todayStart.getTime() - 86400000);

    const orders = [
      { id: 'o1', locationId: 'loc-a', status: 'completed', total: 25.00, createdAt: now },
      { id: 'o2', locationId: 'loc-a', status: 'preparing', total: 15.00, createdAt: now },
      { id: 'o3', locationId: 'loc-b', status: 'completed', total: 30.00, createdAt: now },
      { id: 'o4', locationId: 'loc-a', status: 'completed', total: 20.00, createdAt: yesterday },
    ];

    const calculateStats = (orders) => {
      let todayOrders = 0, todayRevenue = 0, pendingOrders = 0;
      orders.forEach(order => {
        const orderDate = order.createdAt;
        if (orderDate >= todayStart) {
          todayOrders++;
          todayRevenue += order.total || 0;
        }
        if (['new', 'sent_to_kitchen', 'preparing'].includes(order.status)) {
          pendingOrders++;
        }
      });
      return { orders: todayOrders, revenue: todayRevenue, pendingOrders };
    };

    it('should count only today orders for loc-a (after server-side filter)', () => {
      // Simulate server-side filtering (only loc-a orders returned)
      const locAOrders = orders.filter(o => o.locationId === 'loc-a');
      const stats = calculateStats(locAOrders);
      expect(stats.orders).toBe(2); // o1 + o2 (today), o4 excluded (yesterday)
      expect(stats.revenue).toBe(40.00); // 25 + 15
      expect(stats.pendingOrders).toBe(1); // o2 (preparing)
    });

    it('should count only today orders for loc-b', () => {
      const locBOrders = orders.filter(o => o.locationId === 'loc-b');
      const stats = calculateStats(locBOrders);
      expect(stats.orders).toBe(1);
      expect(stats.revenue).toBe(30.00);
      expect(stats.pendingOrders).toBe(0);
    });

    it('should not count yesterday orders in today stats', () => {
      const locAOrders = orders.filter(o => o.locationId === 'loc-a');
      const stats = calculateStats(locAOrders);
      // o4 is from yesterday, should not be in today count
      expect(stats.orders).toBe(2); // only today
    });
  });

  // ==========================================
  // Reimbursement Location Filtering
  // ==========================================

  describe('Reimbursement Location Filtering', () => {
    const reimbursements = [
      { id: 'r1', locationId: 'loc-a', amount: 10, processedAt: new Date() },
      { id: 'r2', locationId: 'loc-b', amount: 20, processedAt: new Date() },
      { id: 'r3', locationId: 'loc-a', amount: 5, processedAt: new Date() },
      { id: 'r4', amount: 15, processedAt: new Date() }, // old, no locationId
    ];

    it('should filter reimbursements by location', () => {
      const filtered = reimbursements.filter(r => r.locationId === 'loc-a');
      expect(filtered).toHaveLength(2);
      expect(filtered.reduce((sum, r) => sum + r.amount, 0)).toBe(15);
    });

    it('should return all when not filtering', () => {
      expect(reimbursements).toHaveLength(4);
    });
  });
});
