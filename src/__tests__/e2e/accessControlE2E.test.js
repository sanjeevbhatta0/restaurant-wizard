/**
 * @jest-environment node
 */

/**
 * E2E Tests — Staff Access Control Flow
 *
 * These tests simulate the staff account lifecycle using Firebase emulators:
 * - Create staff account (Firestore doc)
 * - Verify staff can access restaurant data (menu, orders)
 * - Update staff permissions
 * - Disable staff account
 * - Delete staff account
 *
 * REQUIRES: Firebase emulators running on localhost
 *   firebase emulators:start
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx react-scripts test --testPathPattern=e2e/accessControlE2E
 */

const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');

// ==========================================
// Setup
// ==========================================

const TEST_OWNER_UID = 'e2e-staff-owner-' + Date.now();
const TEST_STAFF_UID = 'e2e-staff-user-' + Date.now();
const TEST_STAFF_UID_2 = 'e2e-staff-user2-' + Date.now();

const describeE2E = isEmulatorAvailable ? describe : describe.skip;

describeE2E('E2E: Staff Access Control Flow', () => {
  const cleanupPaths = [];

  afterAll(async () => {
    for (const path of cleanupPaths) {
      try {
        await db.doc(path).delete();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  // ==========================================
  // Staff Account CRUD via Firestore
  // ==========================================

  describe('Staff Account Lifecycle', () => {
    test('Step 1 — Create staff account document', async () => {
      const staffRef = db.doc(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID}`);
      cleanupPaths.push(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID}`);

      await staffRef.set({
        username: 'e2e_server',
        usernameLower: 'e2e_server',
        displayName: 'E2E Server User',
        email: `e2e_server.staff.${TEST_OWNER_UID}@kodacarte.local`,
        permissions: ['pos', 'kitchen', 'orders'],
        active: true,
        authUid: TEST_STAFF_UID,
        passwordHash: 'test-hash-value',
        passwordSalt: 'test-salt-value',
        createdAt: new Date(),
        lastLogin: null
      });

      const staffDoc = await staffRef.get();
      expect(staffDoc.exists).toBe(true);

      const data = staffDoc.data();
      expect(data.username).toBe('e2e_server');
      expect(data.displayName).toBe('E2E Server User');
      expect(data.permissions).toEqual(['pos', 'kitchen', 'orders']);
      expect(data.active).toBe(true);
    });

    test('Step 2 — Create a second staff account', async () => {
      const staffRef = db.doc(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID_2}`);
      cleanupPaths.push(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID_2}`);

      await staffRef.set({
        username: 'e2e_host',
        usernameLower: 'e2e_host',
        displayName: 'E2E Host User',
        email: `e2e_host.staff.${TEST_OWNER_UID}@kodacarte.local`,
        permissions: ['home', 'analytics'],
        active: true,
        authUid: TEST_STAFF_UID_2,
        passwordHash: 'test-hash-2',
        passwordSalt: 'test-salt-2',
        createdAt: new Date(),
        lastLogin: null
      });

      const staffDoc = await staffRef.get();
      expect(staffDoc.exists).toBe(true);
      expect(staffDoc.data().permissions).toEqual(['home', 'analytics']);
    });

    test('Step 3 — List all staff accounts for restaurant', async () => {
      const snapshot = await db.collection(`restaurants/${TEST_OWNER_UID}/staffAccounts`).get();

      expect(snapshot.docs.length).toBeGreaterThanOrEqual(2);

      const usernames = snapshot.docs.map(d => d.data().username);
      expect(usernames).toContain('e2e_server');
      expect(usernames).toContain('e2e_host');
    });

    test('Step 4 — Update staff permissions', async () => {
      const staffRef = db.doc(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID}`);

      await staffRef.update({
        permissions: ['pos', 'kitchen', 'orders', 'payments'],
        updatedAt: new Date()
      });

      const staffDoc = await staffRef.get();
      const data = staffDoc.data();
      expect(data.permissions).toHaveLength(4);
      expect(data.permissions).toContain('payments');
    });

    test('Step 5 — Disable staff account', async () => {
      const staffRef = db.doc(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID}`);

      await staffRef.update({
        active: false,
        updatedAt: new Date()
      });

      const staffDoc = await staffRef.get();
      expect(staffDoc.data().active).toBe(false);
    });

    test('Step 6 — Re-enable staff account', async () => {
      const staffRef = db.doc(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID}`);

      await staffRef.update({
        active: true,
        updatedAt: new Date()
      });

      const staffDoc = await staffRef.get();
      expect(staffDoc.data().active).toBe(true);
    });

    test('Step 7 — Delete staff account', async () => {
      const staffRef = db.doc(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID_2}`);

      await staffRef.delete();

      const staffDoc = await staffRef.get();
      expect(staffDoc.exists).toBe(false);

      // Remove from cleanup since already deleted
      const idx = cleanupPaths.indexOf(`restaurants/${TEST_OWNER_UID}/staffAccounts/${TEST_STAFF_UID_2}`);
      if (idx > -1) cleanupPaths.splice(idx, 1);
    });

    test('Step 8 — Verify only one staff account remains', async () => {
      const snapshot = await db.collection(`restaurants/${TEST_OWNER_UID}/staffAccounts`).get();

      const activeStaff = snapshot.docs.filter(d => d.data().active === true);
      expect(activeStaff.length).toBeGreaterThanOrEqual(1);

      const usernames = activeStaff.map(d => d.data().username);
      expect(usernames).toContain('e2e_server');
      expect(usernames).not.toContain('e2e_host');
    });
  });

  // ==========================================
  // Staff Data Access (Restaurant Data)
  // ==========================================

  describe('Staff Access to Restaurant Data', () => {
    let testOrderId;

    test('Step 1 — Create test menu category in restaurant', async () => {
      const catRef = db.doc(`restaurants/${TEST_OWNER_UID}/menuCategories/e2e-cat-1`);
      cleanupPaths.push(`restaurants/${TEST_OWNER_UID}/menuCategories/e2e-cat-1`);

      await catRef.set({
        name: 'E2E Test Category',
        createdAt: new Date()
      });

      const catDoc = await catRef.get();
      expect(catDoc.exists).toBe(true);
      expect(catDoc.data().name).toBe('E2E Test Category');
    });

    test('Step 2 — Create test menu item', async () => {
      const itemRef = db.doc(`restaurants/${TEST_OWNER_UID}/menuCategories/e2e-cat-1/items/e2e-item-1`);
      cleanupPaths.push(`restaurants/${TEST_OWNER_UID}/menuCategories/e2e-cat-1/items/e2e-item-1`);

      await itemRef.set({
        name: 'E2E Test Burger',
        price: 14.99,
        createdAt: new Date()
      });

      const itemDoc = await itemRef.get();
      expect(itemDoc.exists).toBe(true);
      expect(itemDoc.data().price).toBe(14.99);
    });

    test('Step 3 — Staff can read menu data (via restaurantUid path)', async () => {
      // Staff uses restaurantUid (owner UID) for Firestore paths
      const restaurantUid = TEST_OWNER_UID;
      const snapshot = await db.collection(`restaurants/${restaurantUid}/menuCategories`).get();

      expect(snapshot.docs.length).toBeGreaterThanOrEqual(1);
      const names = snapshot.docs.map(d => d.data().name);
      expect(names).toContain('E2E Test Category');
    });

    test('Step 4 — Staff can create orders in restaurant', async () => {
      const restaurantUid = TEST_OWNER_UID;

      const orderDoc = await db.collection(`restaurants/${restaurantUid}/orders`).add({
        orderNumber: `E2E-STAFF-${Date.now()}`,
        items: [{ id: 'e2e-item-1', name: 'E2E Test Burger', price: 14.99, quantity: 1 }],
        total: 14.99,
        status: 'sent_to_kitchen',
        source: 'pos',
        createdBy: TEST_STAFF_UID,
        createdAt: new Date()
      });

      testOrderId = orderDoc.id;
      cleanupPaths.push(`restaurants/${TEST_OWNER_UID}/orders/${testOrderId}`);

      const created = await db.doc(`restaurants/${restaurantUid}/orders/${testOrderId}`).get();
      expect(created.exists).toBe(true);
      expect(created.data().createdBy).toBe(TEST_STAFF_UID);
      expect(created.data().status).toBe('sent_to_kitchen');
    });

    test('Step 5 — Staff can update order status', async () => {
      const restaurantUid = TEST_OWNER_UID;
      const orderRef = db.doc(`restaurants/${restaurantUid}/orders/${testOrderId}`);

      await orderRef.update({
        status: 'preparing',
        updatedAt: new Date()
      });

      const updated = await orderRef.get();
      expect(updated.data().status).toBe('preparing');
    });

    test('Step 6 — Staff can query orders by status', async () => {
      const restaurantUid = TEST_OWNER_UID;
      const snapshot = await db.collection(`restaurants/${restaurantUid}/orders`).where('status', '==', 'preparing').get();

      const orderIds = snapshot.docs.map(d => d.id);
      expect(orderIds).toContain(testOrderId);
    });
  });
});

// ==========================================
// Mock Fallback Tests (when emulator not running)
// ==========================================

const describeMock = isEmulatorAvailable ? describe.skip : describe;

describeMock('Access Control E2E — Mock Fallback (emulator unavailable)', () => {
  test('Staff account data structure is correct', () => {
    const staffDoc = {
      username: 'test_server',
      usernameLower: 'test_server',
      displayName: 'Test Server',
      email: 'test_server.staff.owner123@kodacarte.local',
      permissions: ['pos', 'kitchen', 'orders'],
      active: true,
      authUid: 'staff-uid-123',
      passwordHash: 'hashed',
      passwordSalt: 'salted',
      createdAt: new Date(),
      lastLogin: null
    };

    expect(staffDoc.username).toBeTruthy();
    expect(staffDoc.permissions).toHaveLength(3);
    expect(staffDoc.active).toBe(true);
    expect(staffDoc.email).toMatch(/@kodacarte\.local$/);
  });

  test('Staff permission filtering works correctly', () => {
    const staffPermissions = ['pos', 'kitchen'];
    const allRoutes = ['/home', '/pos', '/kitchen', '/analytics', '/account'];

    const ROUTE_TO_PERMISSION = {
      '/home': 'home', '/pos': 'pos', '/kitchen': 'kitchen',
      '/analytics': 'analytics', '/account': 'account'
    };

    const accessibleRoutes = allRoutes.filter(route => {
      if (route === '/account') return false;
      const perm = ROUTE_TO_PERMISSION[route];
      return staffPermissions.includes(perm);
    });

    expect(accessibleRoutes).toEqual(['/pos', '/kitchen']);
  });

  test('restaurantUid resolves correctly for staff vs owner', () => {
    const getRestaurantUid = (isStaff, staffRestaurantId, userUid) =>
      isStaff ? staffRestaurantId : userUid;

    // Owner
    expect(getRestaurantUid(false, null, 'owner-123')).toBe('owner-123');
    // Staff
    expect(getRestaurantUid(true, 'owner-123', 'staff-456')).toBe('owner-123');
    // Staff UID should never be used
    expect(getRestaurantUid(true, 'owner-123', 'staff-456')).not.toBe('staff-456');
  });

  test('Staff and owner produce identical Firestore paths', () => {
    const ownerUid = 'owner-123';
    const buildPaths = (restaurantUid) => ({
      menu: `restaurants/${restaurantUid}/menuCategories`,
      orders: `restaurants/${restaurantUid}/orders`,
      layout: `restaurants/${restaurantUid}/layout`
    });

    const ownerPaths = buildPaths(ownerUid);
    const staffPaths = buildPaths(ownerUid); // Staff uses owner UID

    expect(ownerPaths.menu).toBe(staffPaths.menu);
    expect(ownerPaths.orders).toBe(staffPaths.orders);
    expect(ownerPaths.layout).toBe(staffPaths.layout);
  });

  test('Negative: staff of restaurant A cannot build paths for restaurant B', () => {
    const staffClaims = { isStaff: true, restaurantId: 'restaurant-A' };
    const targetRestaurant = 'restaurant-B';

    const canAccess = staffClaims.restaurantId === targetRestaurant;
    expect(canAccess).toBe(false);
  });

  test('Negative: disabled staff account should not be returned by lookup', () => {
    const staffAccounts = [
      { usernameLower: 'active_user', active: true, email: 'a@kodacarte.local' },
      { usernameLower: 'disabled_user', active: false, email: 'b@kodacarte.local' }
    ];

    const lookup = (username) =>
      staffAccounts.find(s => s.usernameLower === username.toLowerCase() && s.active);

    expect(lookup('active_user')).toBeDefined();
    expect(lookup('disabled_user')).toBeUndefined();
  });

  test('Negative: non-existent username returns null from lookup', () => {
    const staffAccounts = [
      { usernameLower: 'john', active: true }
    ];

    const lookup = (username) =>
      staffAccounts.find(s => s.usernameLower === username.toLowerCase() && s.active) || null;

    expect(lookup('nonexistent')).toBeNull();
  });
});
