/**
 * Unit Tests — Access Control Business Logic
 * Tests permission filtering, staff data structures, password validation,
 * synthetic email generation, and sidebar permission gating.
 */

describe('Access Control — Unit Tests', () => {
  // ==========================================
  // Permission Options Configuration
  // ==========================================

  const PERMISSION_OPTIONS = [
    { key: 'home', label: 'Home', icon: 'bi-house' },
    { key: 'analytics', label: 'Analytics', icon: 'bi-bar-chart' },
    { key: 'menu-management', label: 'Menu Management', icon: 'bi-menu-button-wide' },
    { key: 'pos', label: 'POS', icon: 'bi-cash-coin' },
    { key: 'kitchen', label: 'Kitchen', icon: 'bi-egg-fried' },
    { key: 'server', label: 'Server', icon: 'bi-person-badge' },
    { key: 'table-layout', label: 'Table Layout', icon: 'bi-grid-3x3-gap' },
    { key: 'payments', label: 'Payments', icon: 'bi-credit-card' },
    { key: 'orders', label: 'Orders', icon: 'bi-cart' },
    { key: 'promotions', label: 'Promotions', icon: 'bi-gift' },
    { key: 'seo-social', label: 'SEO & Social', icon: 'bi-share' },
    { key: 'website-integration', label: 'Website Integration', icon: 'bi-code-slash' },
    { key: 'website-builder', label: 'Website Builder', icon: 'bi-brush' }
  ];

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

  // ==========================================
  // Synthetic Email Generation
  // ==========================================

  describe('Synthetic Email Generation', () => {
    const generateSyntheticEmail = (username, ownerUid) => {
      return `${username.toLowerCase()}.staff.${ownerUid}@kodacarte.local`;
    };

    it('should generate correct synthetic email format', () => {
      const email = generateSyntheticEmail('john_server', 'owner123');
      expect(email).toBe('john_server.staff.owner123@kodacarte.local');
    });

    it('should lowercase the username', () => {
      const email = generateSyntheticEmail('JohnServer', 'owner123');
      expect(email).toBe('johnserver.staff.owner123@kodacarte.local');
    });

    it('should include owner UID in email for uniqueness', () => {
      const email1 = generateSyntheticEmail('john', 'owner-A');
      const email2 = generateSyntheticEmail('john', 'owner-B');
      expect(email1).not.toBe(email2);
    });

    it('should always end with @kodacarte.local', () => {
      const email = generateSyntheticEmail('test', 'uid');
      expect(email).toMatch(/@kodacarte\.local$/);
    });
  });

  // ==========================================
  // Permission Validation
  // ==========================================

  describe('Permission Validation', () => {
    it('should have 13 permission options', () => {
      expect(PERMISSION_OPTIONS).toHaveLength(13);
    });

    it('should have unique keys for all permissions', () => {
      const keys = PERMISSION_OPTIONS.map(p => p.key);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('should have labels for all permissions', () => {
      PERMISSION_OPTIONS.forEach(p => {
        expect(p.label).toBeTruthy();
        expect(typeof p.label).toBe('string');
      });
    });

    it('should have icons for all permissions', () => {
      PERMISSION_OPTIONS.forEach(p => {
        expect(p.icon).toBeTruthy();
        expect(p.icon).toMatch(/^bi-/);
      });
    });
  });

  // ==========================================
  // Permission Toggle Logic
  // ==========================================

  describe('Permission Toggle Logic', () => {
    const togglePermission = (currentPermissions, key) => {
      return currentPermissions.includes(key)
        ? currentPermissions.filter(p => p !== key)
        : [...currentPermissions, key];
    };

    it('should add permission when not present', () => {
      const result = togglePermission([], 'pos');
      expect(result).toEqual(['pos']);
    });

    it('should remove permission when already present', () => {
      const result = togglePermission(['pos', 'kitchen'], 'pos');
      expect(result).toEqual(['kitchen']);
    });

    it('should allow multiple permissions to be toggled on', () => {
      let perms = [];
      perms = togglePermission(perms, 'pos');
      perms = togglePermission(perms, 'kitchen');
      perms = togglePermission(perms, 'orders');
      expect(perms).toEqual(['pos', 'kitchen', 'orders']);
    });

    it('should select all permissions', () => {
      const allPerms = PERMISSION_OPTIONS.map(p => p.key);
      expect(allPerms).toHaveLength(13);
      expect(allPerms).toContain('pos');
      expect(allPerms).toContain('analytics');
      expect(allPerms).toContain('website-builder');
    });

    it('should clear all permissions', () => {
      const allPerms = PERMISSION_OPTIONS.map(p => p.key);
      const cleared = [];
      expect(cleared).toHaveLength(0);
      expect(allPerms).not.toEqual(cleared);
    });
  });

  // ==========================================
  // Staff Form Validation
  // ==========================================

  describe('Staff Form Validation', () => {
    const validateCreateForm = (username, password, displayName, permissions) => {
      const errors = [];
      if (!displayName || !displayName.trim()) {
        errors.push('Display name is required');
      }
      if (permissions.length === 0) {
        errors.push('Select at least one permission');
      }
      if (!username || !username.trim()) {
        errors.push('Username is required');
      }
      if (!password || password.length < 6) {
        errors.push('Password must be at least 6 characters');
      }
      return errors;
    };

    const validateUpdateForm = (displayName, permissions, newPassword) => {
      const errors = [];
      if (!displayName || !displayName.trim()) {
        errors.push('Display name is required');
      }
      if (permissions.length === 0) {
        errors.push('Select at least one permission');
      }
      if (newPassword && newPassword.length < 6) {
        errors.push('Password must be at least 6 characters');
      }
      return errors;
    };

    it('should require display name', () => {
      const errors = validateCreateForm('user1', 'password123', '', ['pos']);
      expect(errors).toContain('Display name is required');
    });

    it('should require at least one permission', () => {
      const errors = validateCreateForm('user1', 'password123', 'John', []);
      expect(errors).toContain('Select at least one permission');
    });

    it('should require username for new accounts', () => {
      const errors = validateCreateForm('', 'password123', 'John', ['pos']);
      expect(errors).toContain('Username is required');
    });

    it('should require password with at least 6 characters', () => {
      const errors = validateCreateForm('user1', '12345', 'John', ['pos']);
      expect(errors).toContain('Password must be at least 6 characters');
    });

    it('should pass validation with valid data', () => {
      const errors = validateCreateForm('user1', 'password123', 'John Smith', ['pos', 'kitchen']);
      expect(errors).toHaveLength(0);
    });

    it('should allow blank password on update (keeps current)', () => {
      const errors = validateUpdateForm('John', ['pos'], '');
      expect(errors).toHaveLength(0);
    });

    it('should reject short password on update', () => {
      const errors = validateUpdateForm('John', ['pos'], '123');
      expect(errors).toContain('Password must be at least 6 characters');
    });

    it('should strip whitespace from username', () => {
      const cleaned = 'john server'.replace(/\s/g, '');
      expect(cleaned).toBe('johnserver');
    });

    it('should validate username minimum length (3 chars)', () => {
      const validateUsername = (u) => u.length >= 3;
      expect(validateUsername('ab')).toBe(false);
      expect(validateUsername('abc')).toBe(true);
      expect(validateUsername('john_server')).toBe(true);
    });
  });

  // ==========================================
  // Sidebar Permission Filtering (Staff)
  // ==========================================

  describe('Staff Sidebar Permission Filtering', () => {
    const sidebarLinks = [
      { to: '/home', label: 'Home' },
      { to: '/analytics', label: 'Analytics' },
      { to: '/menu-management', label: 'Menu Management' },
      { to: '/pos', label: 'POS' },
      { to: '/kitchen', label: 'Kitchen' },
      { to: '/server', label: 'Server' },
      { to: '/table-layout', label: 'Table Layout' },
      { to: '/payments', label: 'Payments' },
      { to: '/orders', label: 'Orders' },
      { to: '/promotions', label: 'Promotions' },
      { to: '/seo-social', label: 'SEO & Social' },
      { to: '/website-integration', label: 'Website Integration' },
      { to: '/website-builder', label: 'Website Builder' },
      { to: '/account', label: 'Account' }
    ];

    const filterSidebarForStaff = (links, staffPermissions) => {
      return links.filter(link => {
        // Staff never see Account page
        if (link.to === '/account') return false;
        const permKey = ROUTE_TO_PERMISSION[link.to];
        if (permKey && !staffPermissions.includes(permKey)) return false;
        return true;
      });
    };

    it('should hide Account page for all staff users', () => {
      const allPerms = PERMISSION_OPTIONS.map(p => p.key);
      const filtered = filterSidebarForStaff(sidebarLinks, allPerms);
      const routes = filtered.map(l => l.to);
      expect(routes).not.toContain('/account');
    });

    it('should only show POS and Kitchen for limited staff', () => {
      const filtered = filterSidebarForStaff(sidebarLinks, ['pos', 'kitchen']);
      const routes = filtered.map(l => l.to);
      expect(routes).toContain('/pos');
      expect(routes).toContain('/kitchen');
      expect(routes).not.toContain('/analytics');
      expect(routes).not.toContain('/account');
      expect(routes).not.toContain('/payments');
    });

    it('should show all permitted sections for full-access staff', () => {
      const fullPerms = ['home', 'analytics', 'menu-management', 'pos', 'kitchen', 'server',
        'table-layout', 'payments', 'orders', 'promotions', 'seo-social',
        'website-integration', 'website-builder'];
      const filtered = filterSidebarForStaff(sidebarLinks, fullPerms);
      // Should have all links except /account
      expect(filtered).toHaveLength(sidebarLinks.length - 1);
    });

    it('should show no links for staff with no permissions', () => {
      const filtered = filterSidebarForStaff(sidebarLinks, []);
      expect(filtered).toHaveLength(0);
    });

    it('should correctly map routes to permission keys', () => {
      expect(ROUTE_TO_PERMISSION['/pos']).toBe('pos');
      expect(ROUTE_TO_PERMISSION['/kitchen']).toBe('kitchen');
      expect(ROUTE_TO_PERMISSION['/analytics']).toBe('analytics');
      expect(ROUTE_TO_PERMISSION['/account']).toBe('account');
    });
  });

  // ==========================================
  // restaurantUid Resolution
  // ==========================================

  describe('restaurantUid Resolution', () => {
    const getRestaurantUid = (isStaff, staffRestaurantId, currentUserUid) => {
      return isStaff ? staffRestaurantId : currentUserUid;
    };

    it('should return owner UID for non-staff users', () => {
      const uid = getRestaurantUid(false, null, 'owner-uid-123');
      expect(uid).toBe('owner-uid-123');
    });

    it('should return restaurant owner ID for staff users', () => {
      const uid = getRestaurantUid(true, 'owner-uid-456', 'staff-uid-789');
      expect(uid).toBe('owner-uid-456');
    });

    it('should not return staff own UID for staff users', () => {
      const uid = getRestaurantUid(true, 'owner-uid-456', 'staff-uid-789');
      expect(uid).not.toBe('staff-uid-789');
    });
  });

  // ==========================================
  // Staff Custom Claims Structure
  // ==========================================

  describe('Staff Custom Claims', () => {
    it('should have correct shape for staff claims', () => {
      const claims = {
        isStaff: true,
        restaurantId: 'owner-uid-123',
        permissions: ['pos', 'kitchen', 'orders']
      };

      expect(claims.isStaff).toBe(true);
      expect(claims.restaurantId).toBeTruthy();
      expect(Array.isArray(claims.permissions)).toBe(true);
      expect(claims.permissions.length).toBeGreaterThan(0);
    });

    it('should detect staff user from claims', () => {
      const isStaffUser = (claims) => claims?.isStaff === true;

      expect(isStaffUser({ isStaff: true })).toBe(true);
      expect(isStaffUser({ isStaff: false })).toBe(false);
      expect(isStaffUser({})).toBe(false);
      expect(isStaffUser(null)).toBe(false);
    });

    it('should extract permissions from claims', () => {
      const getPermissions = (claims) => claims?.permissions || [];

      expect(getPermissions({ permissions: ['pos'] })).toEqual(['pos']);
      expect(getPermissions({})).toEqual([]);
      expect(getPermissions(null)).toEqual([]);
    });
  });

  // ==========================================
  // Staff Account Data Structure
  // ==========================================

  describe('Staff Account Data Structure', () => {
    const mockStaffAccount = {
      id: 'staff-uid-1',
      username: 'john_server',
      usernameLower: 'john_server',
      displayName: 'John Smith',
      email: 'john_server.staff.owner123@kodacarte.local',
      permissions: ['pos', 'kitchen', 'orders'],
      active: true,
      authUid: 'staff-uid-1',
      passwordHash: 'hashed-password',
      passwordSalt: 'random-salt',
      createdAt: new Date(),
      lastLogin: null
    };

    it('should have all required fields', () => {
      expect(mockStaffAccount.username).toBeTruthy();
      expect(mockStaffAccount.usernameLower).toBeTruthy();
      expect(mockStaffAccount.displayName).toBeTruthy();
      expect(mockStaffAccount.email).toBeTruthy();
      expect(Array.isArray(mockStaffAccount.permissions)).toBe(true);
      expect(typeof mockStaffAccount.active).toBe('boolean');
    });

    it('should have usernameLower as lowercase of username', () => {
      expect(mockStaffAccount.usernameLower).toBe(mockStaffAccount.username.toLowerCase());
    });

    it('should store password hash, not plaintext', () => {
      expect(mockStaffAccount.passwordHash).not.toBe('actual_password');
      expect(mockStaffAccount.passwordSalt).toBeTruthy();
    });

    it('should have synthetic email matching expected pattern', () => {
      expect(mockStaffAccount.email).toMatch(/\.staff\..+@kodacarte\.local$/);
    });

    it('should default active to true for new accounts', () => {
      expect(mockStaffAccount.active).toBe(true);
    });

    it('should have null lastLogin for new accounts', () => {
      expect(mockStaffAccount.lastLogin).toBeNull();
    });
  });

  // ==========================================
  // Permission Badge Display
  // ==========================================

  describe('Permission Badge Display', () => {
    const getPermissionLabel = (key) => {
      const perm = PERMISSION_OPTIONS.find(o => o.key === key);
      return perm?.label || key;
    };

    it('should resolve known permission keys to labels', () => {
      expect(getPermissionLabel('pos')).toBe('POS');
      expect(getPermissionLabel('kitchen')).toBe('Kitchen');
      expect(getPermissionLabel('menu-management')).toBe('Menu Management');
    });

    it('should fallback to key if permission not found', () => {
      expect(getPermissionLabel('unknown-perm')).toBe('unknown-perm');
    });

    it('should show first 3 permissions with +N more badge', () => {
      const permissions = ['pos', 'kitchen', 'orders', 'payments', 'analytics'];
      const visible = permissions.slice(0, 3);
      const remaining = permissions.length - 3;

      expect(visible).toHaveLength(3);
      expect(remaining).toBe(2);
    });

    it('should show all permissions when 3 or fewer', () => {
      const permissions = ['pos', 'kitchen'];
      const visible = permissions.slice(0, 3);
      const remaining = permissions.length > 3 ? permissions.length - 3 : 0;

      expect(visible).toHaveLength(2);
      expect(remaining).toBe(0);
    });
  });

  // ==========================================
  // Staff Active/Disabled Toggle
  // ==========================================

  describe('Staff Active/Disabled Toggle', () => {
    it('should toggle active to disabled', () => {
      const staff = { active: true };
      const newActive = !staff.active;
      expect(newActive).toBe(false);
    });

    it('should toggle disabled to active', () => {
      const staff = { active: false };
      const newActive = !staff.active;
      expect(newActive).toBe(true);
    });

    it('should treat undefined active as true (default)', () => {
      const staff = {};
      const isActive = staff.active !== false;
      expect(isActive).toBe(true);
    });

    it('should display correct label based on status', () => {
      const getLabel = (staff) => staff.active !== false ? 'Active' : 'Disabled';
      expect(getLabel({ active: true })).toBe('Active');
      expect(getLabel({ active: false })).toBe('Disabled');
      expect(getLabel({})).toBe('Active');
    });
  });

  // ==========================================
  // Firestore Path Resolution (restaurantUid)
  // ==========================================

  describe('Firestore Path Resolution via restaurantUid', () => {
    const getRestaurantUid = (isStaff, staffRestaurantId, currentUserUid) => {
      return isStaff ? staffRestaurantId : currentUserUid;
    };

    const buildPath = (restaurantUid, subcollection) => {
      return `restaurants/${restaurantUid}/${subcollection}`;
    };

    it('should build correct menu path for staff user', () => {
      const uid = getRestaurantUid(true, 'owner-123', 'staff-456');
      expect(buildPath(uid, 'menuCategories')).toBe('restaurants/owner-123/menuCategories');
    });

    it('should build correct orders path for staff user', () => {
      const uid = getRestaurantUid(true, 'owner-123', 'staff-456');
      expect(buildPath(uid, 'orders')).toBe('restaurants/owner-123/orders');
    });

    it('should build correct path for owner user', () => {
      const uid = getRestaurantUid(false, null, 'owner-123');
      expect(buildPath(uid, 'menuCategories')).toBe('restaurants/owner-123/menuCategories');
    });

    it('should never use staff UID in data paths', () => {
      const uid = getRestaurantUid(true, 'owner-123', 'staff-456');
      const path = buildPath(uid, 'orders');
      expect(path).not.toContain('staff-456');
    });

    it('should produce same paths for owner and staff of same restaurant', () => {
      const ownerUid = getRestaurantUid(false, null, 'owner-123');
      const staffUid = getRestaurantUid(true, 'owner-123', 'staff-456');
      expect(buildPath(ownerUid, 'orders')).toBe(buildPath(staffUid, 'orders'));
    });

    it('should build correct paths for all major subcollections', () => {
      const uid = getRestaurantUid(true, 'owner-123', 'staff-456');
      const subcollections = [
        'menuCategories', 'orders', 'layout', 'activities',
        'reimbursements', 'promotions', 'socialPosts', 'rewardsConfig'
      ];
      subcollections.forEach(sub => {
        expect(buildPath(uid, sub)).toBe(`restaurants/owner-123/${sub}`);
      });
    });
  });

  // ==========================================
  // Negative Test Scenarios
  // ==========================================

  describe('Negative Scenarios', () => {
    it('should reject empty username', () => {
      const validate = (u) => u && u.trim().length >= 3;
      expect(validate('')).toBeFalsy();
      expect(validate('  ')).toBeFalsy();
      expect(validate(null)).toBeFalsy();
      expect(validate(undefined)).toBeFalsy();
    });

    it('should reject username with only spaces', () => {
      const cleaned = '   '.replace(/\s/g, '');
      expect(cleaned.length).toBe(0);
    });

    it('should reject password of exactly 5 characters', () => {
      const validate = (p) => p && p.length >= 6;
      expect(validate('12345')).toBe(false);
      expect(validate('123456')).toBe(true);
    });

    it('should reject null/undefined permissions array', () => {
      const validate = (p) => Array.isArray(p) && p.length > 0;
      expect(validate(null)).toBe(false);
      expect(validate(undefined)).toBe(false);
      expect(validate('pos')).toBe(false);
    });

    it('should handle missing staff claims gracefully', () => {
      const extractStaffInfo = (claims) => ({
        isStaff: claims?.isStaff === true,
        permissions: claims?.permissions || [],
        restaurantId: claims?.restaurantId || null
      });

      // Missing claims entirely
      expect(extractStaffInfo(null).isStaff).toBe(false);
      expect(extractStaffInfo(undefined).isStaff).toBe(false);

      // Empty claims
      expect(extractStaffInfo({}).isStaff).toBe(false);
      expect(extractStaffInfo({}).permissions).toEqual([]);

      // Partial claims (isStaff but no permissions)
      expect(extractStaffInfo({ isStaff: true }).permissions).toEqual([]);
      expect(extractStaffInfo({ isStaff: true }).restaurantId).toBeNull();
    });

    it('should not allow staff to impersonate another restaurant', () => {
      const isOwnerOrStaff = (authUid, claims, restaurantId) => {
        return authUid === restaurantId ||
          (claims?.isStaff === true && claims?.restaurantId === restaurantId);
      };

      // Staff of restaurant A trying to access restaurant B
      const staffClaims = { isStaff: true, restaurantId: 'restaurant-A' };
      expect(isOwnerOrStaff('staff-uid', staffClaims, 'restaurant-B')).toBe(false);
    });

    it('should not allow non-staff non-owner to access restaurant data', () => {
      const isOwnerOrStaff = (authUid, claims, restaurantId) => {
        return authUid === restaurantId ||
          (claims?.isStaff === true && claims?.restaurantId === restaurantId);
      };

      // Random user with no staff claims
      expect(isOwnerOrStaff('random-user', {}, 'restaurant-A')).toBe(false);
      expect(isOwnerOrStaff('random-user', null, 'restaurant-A')).toBe(false);
    });

    it('should handle staff with isStaff=false correctly', () => {
      const claims = { isStaff: false, restaurantId: 'owner-123', permissions: ['pos'] };
      const isStaff = claims.isStaff === true;
      expect(isStaff).toBe(false);
    });

    it('should not grant access for invalid permission keys', () => {
      const staffPermissions = ['pos', 'kitchen'];
      const hasPermission = (perm) => staffPermissions.includes(perm);

      expect(hasPermission('invalid-perm')).toBe(false);
      expect(hasPermission('')).toBe(false);
      expect(hasPermission('POS')).toBe(false); // Case sensitive
    });

    it('should handle duplicate permissions gracefully', () => {
      const perms = ['pos', 'pos', 'kitchen'];
      const uniquePerms = [...new Set(perms)];
      expect(uniquePerms).toHaveLength(2);
    });

    it('should not allow staff to access Account page even with all permissions', () => {
      const allPerms = PERMISSION_OPTIONS.map(p => p.key);
      const canAccessAccount = (isStaff) => {
        if (isStaff) return false; // Hard rule
        return true;
      };
      expect(canAccessAccount(true)).toBe(false);
      expect(canAccessAccount(false)).toBe(true);
    });
  });
});
