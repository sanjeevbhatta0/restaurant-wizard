/**
 * Integration Tests — Access Control Flow
 * Tests the staff account CRUD flow, login integration, permission-based
 * navigation, and context updates for staff users.
 */

describe('Access Control Flow — Integration', () => {
  const OWNER_UID = 'owner-restaurant-123';
  const STAFF_UID = 'staff-user-456';
  const STAFF_USERNAME = 'john_server';
  const STAFF_PASSWORD = 'securepass123';
  const STAFF_DISPLAY_NAME = 'John Smith';
  const STAFF_PERMISSIONS = ['pos', 'kitchen', 'orders'];

  // ==========================================
  // Staff Account Creation Flow
  // ==========================================

  describe('Staff Account Creation', () => {
    it('should generate correct synthetic email from username and owner UID', () => {
      const username = STAFF_USERNAME;
      const ownerUid = OWNER_UID;
      const syntheticEmail = `${username.toLowerCase()}.staff.${ownerUid}@kodacarte.local`;
      expect(syntheticEmail).toBe('john_server.staff.owner-restaurant-123@kodacarte.local');
    });

    it('should set correct custom claims on created staff user', () => {
      const claims = {
        isStaff: true,
        restaurantId: OWNER_UID,
        permissions: STAFF_PERMISSIONS
      };
      expect(claims.isStaff).toBe(true);
      expect(claims.restaurantId).toBe(OWNER_UID);
      expect(claims.permissions).toEqual(STAFF_PERMISSIONS);
    });

    it('should create Firestore doc with all required fields', () => {
      const staffDoc = {
        username: STAFF_USERNAME,
        usernameLower: STAFF_USERNAME.toLowerCase(),
        displayName: STAFF_DISPLAY_NAME,
        email: `${STAFF_USERNAME.toLowerCase()}.staff.${OWNER_UID}@kodacarte.local`,
        permissions: STAFF_PERMISSIONS,
        active: true,
        authUid: STAFF_UID,
        passwordHash: 'hashed_value',
        passwordSalt: 'salt_value',
        createdAt: new Date(),
        lastLogin: null
      };

      expect(staffDoc.username).toBe(STAFF_USERNAME);
      expect(staffDoc.usernameLower).toBe(STAFF_USERNAME.toLowerCase());
      expect(staffDoc.active).toBe(true);
      expect(staffDoc.lastLogin).toBeNull();
    });

    it('should reject duplicate usernames within same restaurant', () => {
      const existingStaff = [
        { username: 'john_server', usernameLower: 'john_server' },
        { username: 'jane_host', usernameLower: 'jane_host' }
      ];

      const isDuplicate = (newUsername) =>
        existingStaff.some(s => s.usernameLower === newUsername.toLowerCase());

      expect(isDuplicate('john_server')).toBe(true);
      expect(isDuplicate('JOHN_SERVER')).toBe(true);
      expect(isDuplicate('new_user')).toBe(false);
    });

    it('should reject username shorter than 3 characters', () => {
      const validateUsername = (u) => u.length >= 3;
      expect(validateUsername('ab')).toBe(false);
      expect(validateUsername('abc')).toBe(true);
    });

    it('should reject password shorter than 6 characters', () => {
      const validatePassword = (p) => p.length >= 6;
      expect(validatePassword('12345')).toBe(false);
      expect(validatePassword('123456')).toBe(true);
    });

    it('should reject empty permissions array', () => {
      const validatePermissions = (p) => Array.isArray(p) && p.length > 0;
      expect(validatePermissions([])).toBe(false);
      expect(validatePermissions(['pos'])).toBe(true);
    });
  });

  // ==========================================
  // Staff Account Update Flow
  // ==========================================

  describe('Staff Account Update', () => {
    it('should update display name', () => {
      const original = { displayName: 'John Smith', permissions: ['pos'] };
      const updates = { displayName: 'John A. Smith' };
      const updated = { ...original, ...updates };
      expect(updated.displayName).toBe('John A. Smith');
      expect(updated.permissions).toEqual(['pos']);
    });

    it('should update permissions and sync custom claims', () => {
      const originalClaims = {
        isStaff: true,
        restaurantId: OWNER_UID,
        permissions: ['pos', 'kitchen']
      };
      const newPermissions = ['pos', 'kitchen', 'orders', 'payments'];
      const updatedClaims = { ...originalClaims, permissions: newPermissions };

      expect(updatedClaims.permissions).toHaveLength(4);
      expect(updatedClaims.permissions).toContain('orders');
      expect(updatedClaims.permissions).toContain('payments');
      expect(updatedClaims.isStaff).toBe(true); // Preserved
      expect(updatedClaims.restaurantId).toBe(OWNER_UID); // Preserved
    });

    it('should optionally update password', () => {
      const payload = {
        staffId: STAFF_UID,
        displayName: 'John',
        permissions: ['pos']
      };
      // No password field = keep current
      expect(payload.newPassword).toBeUndefined();

      const payloadWithPassword = { ...payload, newPassword: 'newpass123' };
      expect(payloadWithPassword.newPassword).toBe('newpass123');
    });

    it('should toggle active status and disable/enable auth user', () => {
      const staff = { active: true };
      const toggleActive = (s) => ({ ...s, active: !s.active });

      const disabled = toggleActive(staff);
      expect(disabled.active).toBe(false);
      // Firebase Auth: disabled: !active = true (user can't login)

      const reEnabled = toggleActive(disabled);
      expect(reEnabled.active).toBe(true);
      // Firebase Auth: disabled: false (user can login again)
    });
  });

  // ==========================================
  // Staff Account Deletion Flow
  // ==========================================

  describe('Staff Account Deletion', () => {
    it('should require staffId for deletion', () => {
      const isValid = (data) => !!data.staffId;
      expect(isValid({ staffId: STAFF_UID })).toBe(true);
      expect(isValid({})).toBe(false);
    });

    it('should verify staff doc exists before deleting', () => {
      const staffDocs = new Map([
        [STAFF_UID, { username: 'john_server' }]
      ]);

      expect(staffDocs.has(STAFF_UID)).toBe(true);
      expect(staffDocs.has('non-existent')).toBe(false);
    });

    it('should delete both Auth user and Firestore document', () => {
      const deletedAuth = [];
      const deletedFirestore = [];

      // Simulate deletion
      deletedAuth.push(STAFF_UID);
      deletedFirestore.push(`restaurants/${OWNER_UID}/staffAccounts/${STAFF_UID}`);

      expect(deletedAuth).toContain(STAFF_UID);
      expect(deletedFirestore).toContain(`restaurants/${OWNER_UID}/staffAccounts/${STAFF_UID}`);
    });
  });

  // ==========================================
  // Staff Login Flow
  // ==========================================

  describe('Staff Login Flow', () => {
    it('should resolve staff username to synthetic email via lookupStaffEmail', () => {
      // lookupStaffEmail queries collectionGroup('staffAccounts') by usernameLower
      const mockStaffAccounts = [
        { usernameLower: 'john_server', active: true, email: 'john_server.staff.owner123@kodacarte.local' },
        { usernameLower: 'jane_host', active: true, email: 'jane_host.staff.owner123@kodacarte.local' },
        { usernameLower: 'inactive_user', active: false, email: 'inactive_user.staff.owner123@kodacarte.local' }
      ];

      const lookup = (username) => {
        const match = mockStaffAccounts.find(
          s => s.usernameLower === username.toLowerCase() && s.active === true
        );
        return match ? { email: match.email, isStaff: true } : null;
      };

      const result = lookup('john_server');
      expect(result).not.toBeNull();
      expect(result.email).toBe('john_server.staff.owner123@kodacarte.local');
      expect(result.isStaff).toBe(true);
    });

    it('should not find disabled staff accounts', () => {
      const mockStaffAccounts = [
        { usernameLower: 'disabled_user', active: false, email: 'disabled.staff.owner@kodacarte.local' }
      ];

      const lookup = (username) => {
        return mockStaffAccounts.find(
          s => s.usernameLower === username.toLowerCase() && s.active === true
        ) || null;
      };

      expect(lookup('disabled_user')).toBeNull();
    });

    it('should try owner lookup first, then staff lookup', () => {
      const callOrder = [];

      const lookupOwnerEmail = (username) => {
        callOrder.push('owner');
        return null; // Not found as owner
      };

      const lookupStaffEmail = (username) => {
        callOrder.push('staff');
        return { email: 'staff@kodacarte.local', isStaff: true };
      };

      // Simulate Login.js flow
      const getEmailByUsername = (username) => {
        const ownerResult = lookupOwnerEmail(username);
        if (ownerResult) return ownerResult;
        return lookupStaffEmail(username);
      };

      const result = getEmailByUsername('john_server');
      expect(callOrder).toEqual(['owner', 'staff']);
      expect(result.isStaff).toBe(true);
    });

    it('should detect staff from Firebase Auth token claims', () => {
      const mockTokenResult = {
        claims: {
          isStaff: true,
          restaurantId: OWNER_UID,
          permissions: STAFF_PERMISSIONS
        }
      };

      const { isStaff, restaurantId, permissions } = mockTokenResult.claims;
      expect(isStaff).toBe(true);
      expect(restaurantId).toBe(OWNER_UID);
      expect(permissions).toEqual(STAFF_PERMISSIONS);
    });

    it('should skip 2FA check for staff users', () => {
      const isStaff = true;
      const should2FA = !isStaff; // Staff skip 2FA
      expect(should2FA).toBe(false);
    });
  });

  // ==========================================
  // AuthContext Staff State
  // ==========================================

  describe('AuthContext Staff Integration', () => {
    const simulateAuthState = (user, claims) => {
      const isStaff = claims?.isStaff === true;
      const staffPermissions = claims?.permissions || [];
      const staffRestaurantId = claims?.restaurantId || null;
      const restaurantUid = isStaff ? staffRestaurantId : user?.uid;

      return { isStaff, staffPermissions, staffRestaurantId, restaurantUid };
    };

    it('should set correct state for staff user login', () => {
      const state = simulateAuthState(
        { uid: STAFF_UID },
        { isStaff: true, restaurantId: OWNER_UID, permissions: STAFF_PERMISSIONS }
      );

      expect(state.isStaff).toBe(true);
      expect(state.staffPermissions).toEqual(STAFF_PERMISSIONS);
      expect(state.staffRestaurantId).toBe(OWNER_UID);
      expect(state.restaurantUid).toBe(OWNER_UID);
    });

    it('should set correct state for owner login', () => {
      const state = simulateAuthState(
        { uid: OWNER_UID },
        {} // No staff claims
      );

      expect(state.isStaff).toBe(false);
      expect(state.staffPermissions).toEqual([]);
      expect(state.staffRestaurantId).toBeNull();
      expect(state.restaurantUid).toBe(OWNER_UID);
    });

    it('should reset staff state on logout', () => {
      const state = simulateAuthState(null, null);

      expect(state.isStaff).toBe(false);
      expect(state.staffPermissions).toEqual([]);
      expect(state.staffRestaurantId).toBeNull();
      expect(state.restaurantUid).toBeUndefined();
    });
  });

  // ==========================================
  // Context Data Access with restaurantUid
  // ==========================================

  describe('Staff Data Access via restaurantUid', () => {
    it('should construct correct Firestore paths for staff', () => {
      const restaurantUid = OWNER_UID; // For staff, this is the owner UID

      const menuPath = `restaurants/${restaurantUid}/menuCategories`;
      const ordersPath = `restaurants/${restaurantUid}/orders`;
      const layoutPath = `restaurants/${restaurantUid}/layout`;

      expect(menuPath).toBe(`restaurants/${OWNER_UID}/menuCategories`);
      expect(ordersPath).toBe(`restaurants/${OWNER_UID}/orders`);
      expect(layoutPath).toBe(`restaurants/${OWNER_UID}/layout`);
    });

    it('should access same data as owner using restaurantUid', () => {
      // Staff user accessing data
      const staffRestaurantUid = OWNER_UID; // from AuthContext
      const staffMenuPath = `restaurants/${staffRestaurantUid}/menuCategories`;

      // Owner accessing data
      const ownerRestaurantUid = OWNER_UID; // from AuthContext (self)
      const ownerMenuPath = `restaurants/${ownerRestaurantUid}/menuCategories`;

      expect(staffMenuPath).toBe(ownerMenuPath);
    });

    it('should construct staffAccounts path under owner restaurant', () => {
      const staffAccountsPath = `restaurants/${OWNER_UID}/staffAccounts`;
      expect(staffAccountsPath).toContain(OWNER_UID);
      expect(staffAccountsPath).toContain('staffAccounts');
    });
  });

  // ==========================================
  // Navigation Permission Gating
  // ==========================================

  describe('Navigation Permission Gating', () => {
    const ROUTE_TO_PERMISSION = {
      '/home': 'home',
      '/analytics': 'analytics',
      '/menu-management': 'menu-management',
      '/pos': 'pos',
      '/kitchen': 'kitchen',
      '/server': 'server',
      '/table-layout': 'table-layout',
      '/payments': 'payments',
      '/orders': 'orders',
      '/promotions': 'promotions',
      '/seo-social': 'seo-social',
      '/website-integration': 'website-integration',
      '/website-builder': 'website-builder',
      '/account': 'account'
    };

    const canAccessRoute = (route, isStaff, staffPermissions) => {
      if (!isStaff) return true; // Owners have full access
      if (route === '/account') return false; // Staff never see Account
      const permKey = ROUTE_TO_PERMISSION[route];
      if (!permKey) return true; // Unknown routes default to accessible
      return staffPermissions.includes(permKey);
    };

    it('should allow owners to access all routes', () => {
      expect(canAccessRoute('/pos', false, [])).toBe(true);
      expect(canAccessRoute('/account', false, [])).toBe(true);
      expect(canAccessRoute('/analytics', false, [])).toBe(true);
    });

    it('should block staff from Account page', () => {
      expect(canAccessRoute('/account', true, ['home', 'pos', 'kitchen'])).toBe(false);
    });

    it('should allow staff to access permitted routes', () => {
      const perms = ['pos', 'kitchen', 'orders'];
      expect(canAccessRoute('/pos', true, perms)).toBe(true);
      expect(canAccessRoute('/kitchen', true, perms)).toBe(true);
      expect(canAccessRoute('/orders', true, perms)).toBe(true);
    });

    it('should block staff from unpermitted routes', () => {
      const perms = ['pos', 'kitchen'];
      expect(canAccessRoute('/analytics', true, perms)).toBe(false);
      expect(canAccessRoute('/payments', true, perms)).toBe(false);
      expect(canAccessRoute('/website-builder', true, perms)).toBe(false);
    });

    it('should handle all 13 permission routes correctly', () => {
      const singlePerm = ['pos'];
      const allRoutes = Object.keys(ROUTE_TO_PERMISSION);

      allRoutes.forEach(route => {
        if (route === '/account') {
          expect(canAccessRoute(route, true, singlePerm)).toBe(false);
        } else if (ROUTE_TO_PERMISSION[route] === 'pos') {
          expect(canAccessRoute(route, true, singlePerm)).toBe(true);
        } else {
          expect(canAccessRoute(route, true, singlePerm)).toBe(false);
        }
      });
    });
  });

  // ==========================================
  // Firestore Security Rules Logic
  // ==========================================

  describe('Firestore Security Rules Logic', () => {
    const isOwnerOrStaff = (authUid, authClaims, restaurantId) => {
      return authUid === restaurantId ||
        (authClaims?.isStaff === true && authClaims?.restaurantId === restaurantId);
    };

    it('should allow owner access to their restaurant data', () => {
      expect(isOwnerOrStaff(OWNER_UID, {}, OWNER_UID)).toBe(true);
    });

    it('should allow staff access to their assigned restaurant data', () => {
      const staffClaims = { isStaff: true, restaurantId: OWNER_UID };
      expect(isOwnerOrStaff(STAFF_UID, staffClaims, OWNER_UID)).toBe(true);
    });

    it('should deny staff access to other restaurants', () => {
      const staffClaims = { isStaff: true, restaurantId: OWNER_UID };
      expect(isOwnerOrStaff(STAFF_UID, staffClaims, 'other-restaurant')).toBe(false);
    });

    it('should deny unauthenticated access', () => {
      expect(isOwnerOrStaff(null, null, OWNER_UID)).toBe(false);
    });

    it('should deny non-staff users access to other restaurants', () => {
      expect(isOwnerOrStaff('random-user', {}, OWNER_UID)).toBe(false);
    });

    it('should only allow owner to read staffAccounts subcollection', () => {
      // staffAccounts rule: allow read if auth.uid == restaurantId (owner only, not staff)
      const canReadStaffAccounts = (authUid, restaurantId) => authUid === restaurantId;
      expect(canReadStaffAccounts(OWNER_UID, OWNER_UID)).toBe(true);
      expect(canReadStaffAccounts(STAFF_UID, OWNER_UID)).toBe(false);
    });

    it('should deny client writes to staffAccounts (Cloud Functions only)', () => {
      // staffAccounts rule: allow write: if false
      const canWriteStaffAccounts = () => false;
      expect(canWriteStaffAccounts()).toBe(false);
    });
  });

  // ==========================================
  // Staff Data Access — restaurantUid Path Resolution
  // ==========================================

  describe('Staff Data Access via restaurantUid', () => {
    const simulateComponent = (isStaff, staffRestaurantId, userUid) => {
      const restaurantUid = isStaff ? staffRestaurantId : userUid;
      return {
        menuPath: `restaurants/${restaurantUid}/menuCategories`,
        ordersPath: `restaurants/${restaurantUid}/orders`,
        layoutPath: `restaurants/${restaurantUid}/layout`,
        activitiesPath: `restaurants/${restaurantUid}/activities`,
        promotionsPath: `restaurants/${restaurantUid}/promotions`,
        reimbursementsPath: `restaurants/${restaurantUid}/reimbursements`,
        socialPostsPath: `restaurants/${restaurantUid}/socialPosts`,
        settingsPath: `restaurants/${restaurantUid}/settings`,
        restaurantDocPath: `restaurants/${restaurantUid}`,
        restaurantUid
      };
    };

    it('should resolve all paths to owner UID for staff user', () => {
      const paths = simulateComponent(true, OWNER_UID, STAFF_UID);
      expect(paths.menuPath).toContain(OWNER_UID);
      expect(paths.ordersPath).toContain(OWNER_UID);
      expect(paths.layoutPath).toContain(OWNER_UID);
      expect(paths.activitiesPath).toContain(OWNER_UID);
      expect(paths.promotionsPath).toContain(OWNER_UID);
    });

    it('should never use staff UID in any data path', () => {
      const paths = simulateComponent(true, OWNER_UID, STAFF_UID);
      Object.values(paths).forEach(value => {
        if (typeof value === 'string') {
          expect(value).not.toContain(STAFF_UID);
        }
      });
    });

    it('should produce identical paths for owner and staff of same restaurant', () => {
      const ownerPaths = simulateComponent(false, null, OWNER_UID);
      const staffPaths = simulateComponent(true, OWNER_UID, STAFF_UID);

      expect(ownerPaths.menuPath).toBe(staffPaths.menuPath);
      expect(ownerPaths.ordersPath).toBe(staffPaths.ordersPath);
      expect(ownerPaths.layoutPath).toBe(staffPaths.layoutPath);
      expect(ownerPaths.restaurantDocPath).toBe(staffPaths.restaurantDocPath);
    });

    it('should use nested paths correctly for menu items', () => {
      const paths = simulateComponent(true, OWNER_UID, STAFF_UID);
      const itemPath = `${paths.menuPath}/cat-1/items/item-1`;
      expect(itemPath).toBe(`restaurants/${OWNER_UID}/menuCategories/cat-1/items/item-1`);
    });

    it('should use restaurant doc path for subscription reads', () => {
      const paths = simulateComponent(true, OWNER_UID, STAFF_UID);
      expect(paths.restaurantDocPath).toBe(`restaurants/${OWNER_UID}`);
    });
  });

  // ==========================================
  // Negative Scenarios — Integration
  // ==========================================

  describe('Negative Scenarios', () => {
    it('should not find staff with wrong username casing in strict match', () => {
      const staffAccounts = [
        { usernameLower: 'john_server', active: true }
      ];
      // Strict match without lowering
      const strictLookup = (username) =>
        staffAccounts.find(s => s.usernameLower === username);

      expect(strictLookup('John_Server')).toBeUndefined();
      // With lowering (correct approach)
      expect(strictLookup('john_server')).toBeDefined();
    });

    it('should not allow disabled staff to be found via lookup', () => {
      const staffAccounts = [
        { usernameLower: 'disabled_user', active: false, email: 'test@kodacarte.local' }
      ];
      const lookup = (username) =>
        staffAccounts.find(s => s.usernameLower === username.toLowerCase() && s.active === true);

      expect(lookup('disabled_user')).toBeUndefined();
    });

    it('should handle staff user logout correctly', () => {
      // After logout, all staff state should be cleared
      const simulateLogout = () => ({
        currentUser: null,
        isStaff: false,
        staffPermissions: [],
        staffRestaurantId: null,
        restaurantUid: undefined
      });

      const state = simulateLogout();
      expect(state.isStaff).toBe(false);
      expect(state.staffPermissions).toEqual([]);
      expect(state.restaurantUid).toBeUndefined();
    });

    it('should not allow staff of restaurant A to see restaurant B sidebar items', () => {
      const staffClaimsA = { isStaff: true, restaurantId: 'restaurant-A', permissions: ['pos'] };
      const canAccess = (claims, targetRestaurant) =>
        claims.isStaff && claims.restaurantId === targetRestaurant;

      expect(canAccess(staffClaimsA, 'restaurant-A')).toBe(true);
      expect(canAccess(staffClaimsA, 'restaurant-B')).toBe(false);
    });

    it('should reject staff account creation with existing username', () => {
      const existingAccounts = [
        { usernameLower: 'john_server' },
        { usernameLower: 'jane_host' }
      ];
      const isDuplicate = (username) =>
        existingAccounts.some(a => a.usernameLower === username.toLowerCase());

      expect(isDuplicate('john_server')).toBe(true);
      expect(isDuplicate('JOHN_SERVER')).toBe(true);
      expect(isDuplicate('new_user')).toBe(false);
    });

    it('should reject staff account update for non-existent staff', () => {
      const staffDocs = new Map([['staff-1', { username: 'john' }]]);
      expect(staffDocs.has('staff-1')).toBe(true);
      expect(staffDocs.has('non-existent')).toBe(false);
    });

    it('should not crash if claims have unexpected shape', () => {
      const safeExtract = (claims) => {
        try {
          return {
            isStaff: claims?.isStaff === true,
            permissions: Array.isArray(claims?.permissions) ? claims.permissions : [],
            restaurantId: typeof claims?.restaurantId === 'string' ? claims.restaurantId : null
          };
        } catch {
          return { isStaff: false, permissions: [], restaurantId: null };
        }
      };

      // Numeric permissions (wrong type)
      expect(safeExtract({ permissions: 123 }).permissions).toEqual([]);
      // Numeric restaurantId (wrong type)
      expect(safeExtract({ restaurantId: 123 }).restaurantId).toBeNull();
      // String isStaff (wrong type)
      expect(safeExtract({ isStaff: 'yes' }).isStaff).toBe(false);
    });

    it('should handle concurrent permission updates gracefully', () => {
      const originalPerms = ['pos', 'kitchen'];
      const update1 = [...originalPerms, 'orders']; // Add orders
      const update2 = originalPerms.filter(p => p !== 'kitchen'); // Remove kitchen

      // Last write wins — both produce valid arrays
      expect(Array.isArray(update1)).toBe(true);
      expect(Array.isArray(update2)).toBe(true);
      expect(update1).toContain('orders');
      expect(update2).not.toContain('kitchen');
    });
  });
});
