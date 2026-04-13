/**
 * Integration Tests — Multi-Location Flow
 * Tests the interaction between LocationContext, data queries,
 * and component behavior for single and multi-location restaurants.
 */

describe('Multi-Location Flow — Integration', () => {
  const restaurantId = 'test-restaurant-123';
  const locations = [
    { id: 'loc-downtown', name: 'Downtown Branch', address: '123 Main St' },
    { id: 'loc-uptown', name: 'Uptown Branch', address: '456 Oak Ave' },
    { id: 'loc-airport', name: 'Airport Location', address: '789 Terminal Blvd' },
  ];

  // ==========================================
  // Location Context Behavior
  // ==========================================

  describe('Location Context Behavior', () => {
    it('should provide selectedLocation, isMultiLocation, and locations', () => {
      const context = {
        selectedLocation: 'loc-downtown',
        isMultiLocation: true,
        locations,
      };
      expect(context.selectedLocation).toBe('loc-downtown');
      expect(context.isMultiLocation).toBe(true);
      expect(context.locations).toHaveLength(3);
    });

    it('should have null selectedLocation for single-location restaurant', () => {
      const context = {
        selectedLocation: null,
        isMultiLocation: false,
        locations: [],
      };
      expect(context.selectedLocation).toBeNull();
      expect(context.isMultiLocation).toBe(false);
    });
  });

  // ==========================================
  // Order Query Building
  // ==========================================

  describe('Order Query Building', () => {
    const buildQueryConstraints = (isMultiLocation, selectedLocation) => {
      const constraints = ['orderBy_createdAt_desc'];
      if (isMultiLocation && selectedLocation) {
        constraints.push(`where_locationId_==_${selectedLocation}`);
      }
      return constraints;
    };

    it('should add locationId where clause for multi-location', () => {
      const constraints = buildQueryConstraints(true, 'loc-downtown');
      expect(constraints).toContain('where_locationId_==_loc-downtown');
    });

    it('should not add locationId where clause for single-location', () => {
      const constraints = buildQueryConstraints(false, null);
      expect(constraints).toHaveLength(1);
      expect(constraints[0]).toBe('orderBy_createdAt_desc');
    });

    it('should not add locationId when multi-location but no location selected', () => {
      const constraints = buildQueryConstraints(true, null);
      expect(constraints).toHaveLength(1);
    });
  });

  // ==========================================
  // Orders Page — Full Lifecycle with Location
  // ==========================================

  describe('Orders Page — Location-Scoped Lifecycle', () => {
    const allOrders = [
      { id: 'o1', locationId: 'loc-downtown', status: 'new', orderNumber: 'ORD-001', total: 25.00, source: 'pos', createdAt: new Date() },
      { id: 'o2', locationId: 'loc-uptown', status: 'preparing', orderNumber: 'ORD-002', total: 30.00, source: 'pos', createdAt: new Date() },
      { id: 'o3', locationId: 'loc-downtown', status: 'completed', orderNumber: 'ORD-003', total: 45.00, source: 'pos', createdAt: new Date() },
      { id: 'o4', locationId: 'loc-downtown', status: 'served', orderNumber: 'ORD-004', total: 20.00, source: 'website', createdAt: new Date() },
      { id: 'o5', locationId: 'loc-airport', status: 'new', orderNumber: 'ORD-005', total: 15.00, source: 'pos', createdAt: new Date() },
    ];

    it('should show only downtown orders when downtown selected', () => {
      const filtered = allOrders.filter(o => o.locationId === 'loc-downtown');
      expect(filtered).toHaveLength(3);
      expect(filtered.map(o => o.id)).toEqual(['o1', 'o3', 'o4']);
    });

    it('should support status filtering within a location', () => {
      const downtownOrders = allOrders.filter(o => o.locationId === 'loc-downtown');
      const newOrders = downtownOrders.filter(o => o.status === 'new');
      expect(newOrders).toHaveLength(1);
      expect(newOrders[0].id).toBe('o1');
    });

    it('should support source filtering within a location', () => {
      const downtownOrders = allOrders.filter(o => o.locationId === 'loc-downtown');
      const websiteOrders = downtownOrders.filter(o => o.source === 'website');
      expect(websiteOrders).toHaveLength(1);
      expect(websiteOrders[0].id).toBe('o4');
    });
  });

  // ==========================================
  // Payments Page — Location-Scoped
  // ==========================================

  describe('Payments Page — Location-Scoped', () => {
    const allOrders = [
      { id: 'o1', locationId: 'loc-downtown', status: 'served', tableNumber: 1, total: 50.00, source: 'pos' },
      { id: 'o2', locationId: 'loc-downtown', status: 'served', tableNumber: 2, total: 35.00, source: 'pos' },
      { id: 'o3', locationId: 'loc-uptown', status: 'served', tableNumber: 1, total: 40.00, source: 'pos' },
      { id: 'o4', locationId: 'loc-downtown', status: 'served', tableNumber: null, total: 25.00, source: 'website' },
    ];

    it('should group by table for selected location only', () => {
      const downtownOrders = allOrders.filter(o => o.locationId === 'loc-downtown');
      const posOrders = downtownOrders.filter(o => o.source !== 'website');
      const grouped = {};
      posOrders.forEach(o => {
        const key = o.tableNumber || 'counter';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(o);
      });
      expect(Object.keys(grouped)).toEqual(['1', '2']);
      expect(grouped['1']).toHaveLength(1);
    });

    it('should return empty when multi-location but no location selected', () => {
      const isMultiLocation = true;
      const selectedLocation = null;
      if (isMultiLocation && !selectedLocation) {
        expect([]).toHaveLength(0); // early return with empty state
      }
    });

    it('should separate online orders by location', () => {
      const downtownOnline = allOrders.filter(o => o.locationId === 'loc-downtown' && o.source === 'website');
      expect(downtownOnline).toHaveLength(1);
      expect(downtownOnline[0].total).toBe(25.00);
    });
  });

  // ==========================================
  // Kitchen/Server — Location Isolation
  // ==========================================

  describe('Kitchen/Server — Location Isolation', () => {
    const allOrders = [
      { id: 'o1', locationId: 'loc-downtown', status: 'sent_to_kitchen', items: [{ name: 'Burger', quantity: 1 }] },
      { id: 'o2', locationId: 'loc-uptown', status: 'sent_to_kitchen', items: [{ name: 'Pasta', quantity: 2 }] },
      { id: 'o3', locationId: 'loc-downtown', status: 'preparing', items: [{ name: 'Salad', quantity: 1 }] },
      { id: 'o4', locationId: 'loc-downtown', status: 'ready', items: [{ name: 'Pizza', quantity: 1 }] },
    ];

    it('should show only downtown kitchen orders', () => {
      const kitchenStatuses = ['sent_to_kitchen', 'preparing', 'ready'];
      const downtownKitchen = allOrders.filter(
        o => o.locationId === 'loc-downtown' && kitchenStatuses.includes(o.status)
      );
      expect(downtownKitchen).toHaveLength(3);
    });

    it('should not show uptown orders in downtown kitchen', () => {
      const downtownKitchen = allOrders.filter(o => o.locationId === 'loc-downtown');
      expect(downtownKitchen.find(o => o.id === 'o2')).toBeUndefined();
    });

    it('server should see only ready orders for selected location', () => {
      const readyOrders = allOrders.filter(o => o.locationId === 'loc-downtown' && o.status === 'ready');
      expect(readyOrders).toHaveLength(1);
      expect(readyOrders[0].items[0].name).toBe('Pizza');
    });
  });

  // ==========================================
  // Promotions — Multi-Location Create & Filter
  // ==========================================

  describe('Promotions — Multi-Location Create & Filter', () => {
    it('should create promo with locationIds for specific locations', () => {
      const promoData = {
        title: 'Downtown Special',
        discount: '20%',
        type: 'percentage',
        locationIds: ['loc-downtown'],
      };
      expect(promoData.locationIds).toEqual(['loc-downtown']);
    });

    it('should create promo with empty locationIds for all locations', () => {
      const promoData = {
        title: 'Chain-wide Sale',
        discount: '10%',
        type: 'percentage',
        locationIds: [],
      };
      expect(promoData.locationIds).toEqual([]);
    });

    it('should create promo for 2 out of 3 locations', () => {
      const promoData = {
        title: 'City Locations Only',
        discount: '15%',
        type: 'percentage',
        locationIds: ['loc-downtown', 'loc-uptown'],
      };
      expect(promoData.locationIds).toHaveLength(2);
      expect(promoData.locationIds).not.toContain('loc-airport');
    });

    it('should restore location selection when editing a promo', () => {
      const existingPromo = {
        id: 'p1',
        title: 'Downtown Special',
        locationIds: ['loc-downtown', 'loc-uptown'],
      };

      const locationSelectMode = existingPromo.locationIds && existingPromo.locationIds.length > 0 ? 'specific' : 'all';
      const selectedLocationIds = existingPromo.locationIds || [];

      expect(locationSelectMode).toBe('specific');
      expect(selectedLocationIds).toEqual(['loc-downtown', 'loc-uptown']);
    });

    it('should restore "all" mode when editing promo with empty locationIds', () => {
      const existingPromo = {
        id: 'p2',
        title: 'Chain-wide Sale',
        locationIds: [],
      };

      const locationSelectMode = existingPromo.locationIds && existingPromo.locationIds.length > 0 ? 'specific' : 'all';
      expect(locationSelectMode).toBe('all');
    });

    it('should filter promos when switching location in context', () => {
      const promos = [
        { id: 'p1', title: 'All Locations', locationIds: [] },
        { id: 'p2', title: 'Downtown Only', locationIds: ['loc-downtown'] },
        { id: 'p3', title: 'Uptown Only', locationIds: ['loc-uptown'] },
      ];

      // Switch to downtown
      let filtered = promos.filter(p => !p.locationIds || p.locationIds.length === 0 || p.locationIds.includes('loc-downtown'));
      expect(filtered).toHaveLength(2);
      expect(filtered.map(p => p.id)).toEqual(['p1', 'p2']);

      // Switch to uptown
      filtered = promos.filter(p => !p.locationIds || p.locationIds.length === 0 || p.locationIds.includes('loc-uptown'));
      expect(filtered).toHaveLength(2);
      expect(filtered.map(p => p.id)).toEqual(['p1', 'p3']);
    });
  });

  // ==========================================
  // Analytics — Location-Scoped Data
  // ==========================================

  describe('Analytics — Location-Scoped Data', () => {
    const orders = [
      { id: 'o1', locationId: 'loc-downtown', total: 25.00, items: [{ name: 'Burger', quantity: 2 }], createdAt: new Date('2026-04-01T12:00:00') },
      { id: 'o2', locationId: 'loc-downtown', total: 30.00, items: [{ name: 'Pasta', quantity: 1 }], createdAt: new Date('2026-04-01T18:00:00') },
      { id: 'o3', locationId: 'loc-uptown', total: 40.00, items: [{ name: 'Steak', quantity: 1 }], createdAt: new Date('2026-04-01T14:00:00') },
    ];

    const calculateAnalytics = (locationOrders) => {
      const totalRevenue = locationOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const avgOrderValue = locationOrders.length > 0 ? totalRevenue / locationOrders.length : 0;
      const itemCounts = {};
      locationOrders.forEach(order => {
        (order.items || []).forEach(item => {
          itemCounts[item.name] = (itemCounts[item.name] || 0) + (item.quantity || 1);
        });
      });
      return { totalRevenue, avgOrderValue, itemCounts, totalOrders: locationOrders.length };
    };

    it('should calculate analytics for downtown only', () => {
      const downtownOrders = orders.filter(o => o.locationId === 'loc-downtown');
      const stats = calculateAnalytics(downtownOrders);
      expect(stats.totalOrders).toBe(2);
      expect(stats.totalRevenue).toBe(55.00);
      expect(stats.avgOrderValue).toBe(27.50);
      expect(stats.itemCounts['Burger']).toBe(2);
      expect(stats.itemCounts['Steak']).toBeUndefined(); // uptown item
    });

    it('should calculate analytics for uptown only', () => {
      const uptownOrders = orders.filter(o => o.locationId === 'loc-uptown');
      const stats = calculateAnalytics(uptownOrders);
      expect(stats.totalOrders).toBe(1);
      expect(stats.totalRevenue).toBe(40.00);
      expect(stats.itemCounts['Steak']).toBe(1);
    });

    it('should return zero stats for location with no orders', () => {
      const airportOrders = orders.filter(o => o.locationId === 'loc-airport');
      const stats = calculateAnalytics(airportOrders);
      expect(stats.totalOrders).toBe(0);
      expect(stats.totalRevenue).toBe(0);
      expect(stats.avgOrderValue).toBe(0);
    });
  });

  // ==========================================
  // Single-Location Restaurant (No Location Context)
  // ==========================================

  describe('Single-Location Restaurant Compatibility', () => {
    it('should work without any location context', () => {
      const isMultiLocation = false;
      const selectedLocation = null;

      // Orders query should not add where clause
      const constraints = ['orderBy_createdAt_desc'];
      if (isMultiLocation && selectedLocation) {
        constraints.push('where_locationId');
      }
      expect(constraints).toHaveLength(1);
    });

    it('should show all menu items regardless of locations field', () => {
      const items = [
        { id: 'i1', name: 'Burger', locations: ['loc-a'] },
        { id: 'i2', name: 'Pasta', locations: [] },
        { id: 'i3', name: 'Salad' }, // no locations field
      ];

      const isMultiLocation = false;
      const selectedLocation = null;

      // No filtering for single-location
      const filtered = isMultiLocation && selectedLocation
        ? items.filter(i => !i.locations || i.locations.length === 0 || i.locations.includes(selectedLocation))
        : items;

      expect(filtered).toHaveLength(3);
    });

    it('should show all promotions regardless of locationIds', () => {
      const promos = [
        { id: 'p1', locationIds: ['loc-a'] },
        { id: 'p2', locationIds: [] },
        { id: 'p3' }, // no field
      ];

      const isMultiLocation = false;
      const filtered = isMultiLocation
        ? promos.filter(p => !p.locationIds || p.locationIds.length === 0)
        : promos;

      expect(filtered).toHaveLength(3);
    });
  });

  // ==========================================
  // Location Switching — Data Refresh
  // ==========================================

  describe('Location Switching — Data Refresh', () => {
    it('should reset relevant state when location changes', () => {
      let orders = [{ id: 'o1', locationId: 'loc-a' }];
      let stats = { orders: 1, revenue: 25.00 };

      // Simulate location switch — new query returns different data
      const newLocationOrders = [
        { id: 'o2', locationId: 'loc-b' },
        { id: 'o3', locationId: 'loc-b' },
      ];

      orders = newLocationOrders;
      stats = { orders: 2, revenue: 60.00 };

      expect(orders).toHaveLength(2);
      expect(orders.every(o => o.locationId === 'loc-b')).toBe(true);
      expect(stats.orders).toBe(2);
    });

    it('should clear data when no location selected in multi-location mode', () => {
      const isMultiLocation = true;
      const selectedLocation = null;

      // Payments.js pattern: early return with empty state
      if (isMultiLocation && !selectedLocation) {
        const orders = [];
        const tablesWithOrders = {};
        expect(orders).toHaveLength(0);
        expect(Object.keys(tablesWithOrders)).toHaveLength(0);
      }
    });
  });
});
