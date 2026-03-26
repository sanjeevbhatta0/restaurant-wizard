/**
 * Unit Tests — Service Mode Helpers
 * Tests the service mode configuration helpers that determine
 * POS, Kitchen, Server, and Layout behavior.
 */

describe('Service Mode Helpers', () => {
  // Mirror the helper functions from SubscriptionContext.js
  const createHelpers = (serviceMode) => ({
    getServiceMode: () => serviceMode,
    isPayFirst: () => serviceMode === 'counter_service' || serviceMode === 'food_truck',
    requiresTables: () => serviceMode === 'full_service',
    hasServerRole: () => serviceMode === 'full_service'
  });

  // ==========================================
  // getServiceMode
  // ==========================================

  describe('getServiceMode', () => {
    it('should return full_service by default', () => {
      const { getServiceMode } = createHelpers('full_service');
      expect(getServiceMode()).toBe('full_service');
    });

    it('should return counter_service when set', () => {
      const { getServiceMode } = createHelpers('counter_service');
      expect(getServiceMode()).toBe('counter_service');
    });

    it('should return food_truck when set', () => {
      const { getServiceMode } = createHelpers('food_truck');
      expect(getServiceMode()).toBe('food_truck');
    });
  });

  // ==========================================
  // isPayFirst
  // ==========================================

  describe('isPayFirst', () => {
    it('should return false for full_service', () => {
      const { isPayFirst } = createHelpers('full_service');
      expect(isPayFirst()).toBe(false);
    });

    it('should return true for counter_service', () => {
      const { isPayFirst } = createHelpers('counter_service');
      expect(isPayFirst()).toBe(true);
    });

    it('should return true for food_truck', () => {
      const { isPayFirst } = createHelpers('food_truck');
      expect(isPayFirst()).toBe(true);
    });
  });

  // ==========================================
  // requiresTables
  // ==========================================

  describe('requiresTables', () => {
    it('should return true for full_service', () => {
      const { requiresTables } = createHelpers('full_service');
      expect(requiresTables()).toBe(true);
    });

    it('should return false for counter_service', () => {
      const { requiresTables } = createHelpers('counter_service');
      expect(requiresTables()).toBe(false);
    });

    it('should return false for food_truck', () => {
      const { requiresTables } = createHelpers('food_truck');
      expect(requiresTables()).toBe(false);
    });
  });

  // ==========================================
  // hasServerRole
  // ==========================================

  describe('hasServerRole', () => {
    it('should return true for full_service', () => {
      const { hasServerRole } = createHelpers('full_service');
      expect(hasServerRole()).toBe(true);
    });

    it('should return false for counter_service', () => {
      const { hasServerRole } = createHelpers('counter_service');
      expect(hasServerRole()).toBe(false);
    });

    it('should return false for food_truck', () => {
      const { hasServerRole } = createHelpers('food_truck');
      expect(hasServerRole()).toBe(false);
    });
  });

  // ==========================================
  // Backward Compatibility
  // ==========================================

  describe('backward compatibility', () => {
    it('should default to full_service when serviceMode is undefined', () => {
      // Simulate how SubscriptionContext handles missing field
      const serviceMode = undefined || 'full_service';
      const helpers = createHelpers(serviceMode);
      expect(helpers.getServiceMode()).toBe('full_service');
      expect(helpers.isPayFirst()).toBe(false);
      expect(helpers.requiresTables()).toBe(true);
      expect(helpers.hasServerRole()).toBe(true);
    });

    it('should default to full_service when serviceMode is null', () => {
      const serviceMode = null || 'full_service';
      const helpers = createHelpers(serviceMode);
      expect(helpers.getServiceMode()).toBe('full_service');
      expect(helpers.isPayFirst()).toBe(false);
    });

    it('should default to full_service when serviceMode is empty string', () => {
      const serviceMode = '' || 'full_service';
      const helpers = createHelpers(serviceMode);
      expect(helpers.getServiceMode()).toBe('full_service');
    });
  });

  // ==========================================
  // Layout Navigation Filtering
  // ==========================================

  describe('layout navigation filtering', () => {
    const sidebarLinks = [
      { to: '/home', text: 'Home' },
      { to: '/pos', text: 'POS' },
      { to: '/kitchen', text: 'Kitchen' },
      { to: '/server', text: 'Server' },
      { to: '/table-layout', text: 'Table Layout' },
      { to: '/payments', text: 'Payments' },
      { to: '/orders', text: 'Orders' },
      { to: '/account', text: 'Account' }
    ];

    const filterLinks = (serviceMode) => {
      return sidebarLinks.filter(link => {
        if (link.to === '/server' && serviceMode !== 'full_service') return false;
        if (link.to === '/table-layout' && serviceMode === 'food_truck') return false;
        return true;
      });
    };

    it('should show all links for full_service', () => {
      const links = filterLinks('full_service');
      expect(links).toHaveLength(8);
      expect(links.find(l => l.to === '/server')).toBeDefined();
      expect(links.find(l => l.to === '/table-layout')).toBeDefined();
    });

    it('should hide Server for counter_service', () => {
      const links = filterLinks('counter_service');
      expect(links.find(l => l.to === '/server')).toBeUndefined();
      expect(links.find(l => l.to === '/table-layout')).toBeDefined();
    });

    it('should hide Server and Table Layout for food_truck', () => {
      const links = filterLinks('food_truck');
      expect(links.find(l => l.to === '/server')).toBeUndefined();
      expect(links.find(l => l.to === '/table-layout')).toBeUndefined();
    });

    it('should always show POS, Kitchen, Payments, Orders', () => {
      ['full_service', 'counter_service', 'food_truck'].forEach(mode => {
        const links = filterLinks(mode);
        expect(links.find(l => l.to === '/pos')).toBeDefined();
        expect(links.find(l => l.to === '/kitchen')).toBeDefined();
        expect(links.find(l => l.to === '/payments')).toBeDefined();
        expect(links.find(l => l.to === '/orders')).toBeDefined();
      });
    });
  });
});
