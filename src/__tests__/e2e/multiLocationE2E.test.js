/**
 * @jest-environment node
 */

/**
 * E2E Tests — Multi-Location Data Isolation
 *
 * Verifies that orders, promotions, and menu items are correctly
 * scoped to their locations when stored and queried in Firestore.
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/multiLocation
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

const TEST_RESTAURANT_ID = 'e2e-multiloc-' + Date.now();
const LOC_A = 'loc-downtown';
const LOC_B = 'loc-uptown';

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Multi-Location Data Isolation', () => {
  const createdDocs = [];

  const trackDoc = (path) => createdDocs.push(path);

  afterAll(async () => {
    for (const path of createdDocs) {
      try {
        await db.doc(path).delete();
      } catch (e) { /* ignore */ }
    }
    // Clean up restaurant doc
    try {
      await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).delete();
    } catch (e) { /* ignore */ }
  });

  // ==========================================
  // Setup: Create test restaurant with locations
  // ==========================================

  it('should create a multi-location restaurant', async () => {
    await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).set({
      name: 'E2E Multi-Location Restaurant',
      isMultiLocation: true,
      locations: [LOC_A, LOC_B],
      createdAt: new Date(),
    });

    const snap = await db.doc(`restaurants/${TEST_RESTAURANT_ID}`).get();
    expect(snap.exists).toBe(true);
    expect(snap.data().isMultiLocation).toBe(true);
  });

  // ==========================================
  // Orders: Location Isolation
  // ==========================================

  describe('Orders — Location Isolation', () => {
    it('should create orders with locationId for each location', async () => {
      const ordersRef = db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`);

      // Downtown orders
      const o1 = await ordersRef.add({
        orderNumber: 'ML-001',
        locationId: LOC_A,
        status: 'completed',
        total: 25.00,
        items: [{ name: 'Burger', price: 12.50, quantity: 2 }],
        source: 'pos',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/orders/${o1.id}`);

      const o2 = await ordersRef.add({
        orderNumber: 'ML-002',
        locationId: LOC_A,
        status: 'preparing',
        total: 15.00,
        items: [{ name: 'Salad', price: 15.00, quantity: 1 }],
        source: 'pos',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/orders/${o2.id}`);

      // Uptown orders
      const o3 = await ordersRef.add({
        orderNumber: 'ML-003',
        locationId: LOC_B,
        status: 'served',
        total: 40.00,
        items: [{ name: 'Steak', price: 40.00, quantity: 1 }],
        source: 'pos',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/orders/${o3.id}`);

      expect(o1.id).toBeDefined();
      expect(o2.id).toBeDefined();
      expect(o3.id).toBeDefined();
    });

    it('should query orders filtered by locationId (downtown)', async () => {
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
        .where('locationId', '==', LOC_A)
        .get();

      expect(snap.size).toBe(2);
      snap.forEach(doc => {
        expect(doc.data().locationId).toBe(LOC_A);
      });
    });

    it('should query orders filtered by locationId (uptown)', async () => {
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
        .where('locationId', '==', LOC_B)
        .get();

      expect(snap.size).toBe(1);
      expect(snap.docs[0].data().locationId).toBe(LOC_B);
    });

    it('should support compound query: locationId + status', async () => {
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`)
        .where('locationId', '==', LOC_A)
        .where('status', '==', 'completed')
        .get();

      expect(snap.size).toBe(1);
      expect(snap.docs[0].data().orderNumber).toBe('ML-001');
    });

    it('should return all orders without location filter', async () => {
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/orders`).get();
      expect(snap.size).toBe(3);
    });
  });

  // ==========================================
  // Promotions: Location Targeting
  // ==========================================

  describe('Promotions — Location Targeting', () => {
    it('should create promos with different location scopes', async () => {
      const promosRef = db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`);

      // All-locations promo
      const p1 = await promosRef.add({
        title: 'Chain-wide 10% Off',
        type: 'percentage',
        discount: '10%',
        locationIds: [],
        status: 'active',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/promotions/${p1.id}`);

      // Downtown-only promo
      const p2 = await promosRef.add({
        title: 'Downtown Happy Hour',
        type: 'percentage',
        discount: '20%',
        locationIds: [LOC_A],
        status: 'active',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/promotions/${p2.id}`);

      // Uptown-only promo
      const p3 = await promosRef.add({
        title: 'Uptown Special',
        type: 'percentage',
        discount: '15%',
        locationIds: [LOC_B],
        status: 'active',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/promotions/${p3.id}`);

      expect(p1.id).toBeDefined();
      expect(p2.id).toBeDefined();
      expect(p3.id).toBeDefined();
    });

    it('should fetch all promos and filter client-side for downtown', async () => {
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`)
        .where('status', '==', 'active')
        .get();

      const allPromos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      expect(allPromos).toHaveLength(3);

      // Client-side filter for downtown
      const downtownPromos = allPromos.filter(p => {
        if (!p.locationIds || p.locationIds.length === 0) return true;
        return p.locationIds.includes(LOC_A);
      });

      expect(downtownPromos).toHaveLength(2); // chain-wide + downtown
      expect(downtownPromos.find(p => p.title === 'Uptown Special')).toBeUndefined();
    });

    it('should filter client-side for uptown', async () => {
      const snap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/promotions`)
        .where('status', '==', 'active')
        .get();

      const allPromos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const uptownPromos = allPromos.filter(p => {
        if (!p.locationIds || p.locationIds.length === 0) return true;
        return p.locationIds.includes(LOC_B);
      });

      expect(uptownPromos).toHaveLength(2); // chain-wide + uptown
      expect(uptownPromos.find(p => p.title === 'Downtown Happy Hour')).toBeUndefined();
    });
  });

  // ==========================================
  // Menu Items: Location Assignment
  // ==========================================

  describe('Menu Items — Location Assignment', () => {
    it('should create menu items with location assignments', async () => {
      const catRef = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).add({
        name: 'Appetizers',
        createdAt: new Date(),
      });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}`);

      const itemsRef = db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items`);

      // All-location item
      const i1 = await itemsRef.add({ name: 'Bread', price: 5.00, locations: [] });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items/${i1.id}`);

      // Downtown-only item
      const i2 = await itemsRef.add({ name: 'Spring Rolls', price: 8.00, locations: [LOC_A] });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items/${i2.id}`);

      // Uptown-only item
      const i3 = await itemsRef.add({ name: 'Bruschetta', price: 9.00, locations: [LOC_B] });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items/${i3.id}`);

      // Both locations item
      const i4 = await itemsRef.add({ name: 'Soup', price: 6.00, locations: [LOC_A, LOC_B] });
      trackDoc(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catRef.id}/items/${i4.id}`);

      const snap = await itemsRef.get();
      expect(snap.size).toBe(4);
    });

    it('should filter items for downtown location (client-side)', async () => {
      const catsSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories`).get();
      const catId = catsSnap.docs[0].id;

      const itemsSnap = await db.collection(`restaurants/${TEST_RESTAURANT_ID}/menuCategories/${catId}/items`).get();
      const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const downtownItems = items.filter(item => {
        if (!item.locations || item.locations.length === 0) return true;
        return item.locations.includes(LOC_A);
      });

      expect(downtownItems).toHaveLength(3); // Bread (all), Spring Rolls (downtown), Soup (both)
      expect(downtownItems.find(i => i.name === 'Bruschetta')).toBeUndefined();
    });
  });
});

// ==========================================
// Mock Fallback Tests (run without emulator)
// ==========================================

const describeMock = isEmulatorAvailable ? describe.skip : describe;

describeMock('Multi-Location E2E — Mock Fallback', () => {
  it('should verify location filtering logic without emulator', () => {
    const orders = [
      { id: 'o1', locationId: 'loc-a', status: 'completed' },
      { id: 'o2', locationId: 'loc-b', status: 'completed' },
    ];
    const filtered = orders.filter(o => o.locationId === 'loc-a');
    expect(filtered).toHaveLength(1);
  });

  it('should verify promo location targeting without emulator', () => {
    const promos = [
      { id: 'p1', locationIds: [] },
      { id: 'p2', locationIds: ['loc-a'] },
    ];
    const filtered = promos.filter(p => !p.locationIds || p.locationIds.length === 0 || p.locationIds.includes('loc-a'));
    expect(filtered).toHaveLength(2);
  });
});
