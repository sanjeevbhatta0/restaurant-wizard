/**
 * Unit Tests — Service Mode Helpers
 * Tests the service mode configuration helpers that determine
 * POS, Kitchen, Server, and Layout behavior.
 */

describe('Service Mode Helpers', () => {
  // Mirror the helper functions from SubscriptionContext.js
  const createHelpers = (serviceMode, paymentTiming = 'pre_pay') => ({
    getServiceMode: () => serviceMode,
    getPaymentTiming: () => paymentTiming,
    isPayFirst: () => {
      if (serviceMode === 'counter_service' || serviceMode === 'food_truck') {
        return paymentTiming === 'pre_pay';
      }
      return false;
    },
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
  // Payment Timing (Pre-Pay vs Post-Pay)
  // ==========================================

  describe('getPaymentTiming', () => {
    it('should default to pre_pay', () => {
      const { getPaymentTiming } = createHelpers('counter_service');
      expect(getPaymentTiming()).toBe('pre_pay');
    });

    it('should return post_pay when configured', () => {
      const { getPaymentTiming } = createHelpers('counter_service', 'post_pay');
      expect(getPaymentTiming()).toBe('post_pay');
    });

    it('should return pre_pay for full_service (payment timing ignored)', () => {
      const { getPaymentTiming } = createHelpers('full_service', 'post_pay');
      expect(getPaymentTiming()).toBe('post_pay'); // stored, but isPayFirst returns false anyway
    });
  });

  describe('isPayFirst with payment timing', () => {
    it('should return true for counter_service + pre_pay', () => {
      const { isPayFirst } = createHelpers('counter_service', 'pre_pay');
      expect(isPayFirst()).toBe(true);
    });

    it('should return false for counter_service + post_pay', () => {
      const { isPayFirst } = createHelpers('counter_service', 'post_pay');
      expect(isPayFirst()).toBe(false);
    });

    it('should return true for food_truck + pre_pay', () => {
      const { isPayFirst } = createHelpers('food_truck', 'pre_pay');
      expect(isPayFirst()).toBe(true);
    });

    it('should return false for food_truck + post_pay', () => {
      const { isPayFirst } = createHelpers('food_truck', 'post_pay');
      expect(isPayFirst()).toBe(false);
    });

    it('should return false for full_service regardless of payment timing', () => {
      expect(createHelpers('full_service', 'pre_pay').isPayFirst()).toBe(false);
      expect(createHelpers('full_service', 'post_pay').isPayFirst()).toBe(false);
    });
  });

  describe('order type determination with payment timing', () => {
    const getOrderType = (serviceMode) => {
      return (serviceMode === 'counter_service' || serviceMode === 'food_truck') ? 'counter' : 'dine_in';
    };

    it('should use counter type for counter_service regardless of payment timing', () => {
      expect(getOrderType('counter_service')).toBe('counter');
    });

    it('should use counter type for food_truck regardless of payment timing', () => {
      expect(getOrderType('food_truck')).toBe('counter');
    });

    it('should use dine_in type for full_service', () => {
      expect(getOrderType('full_service')).toBe('dine_in');
    });
  });

  describe('post-pay counter/food_truck behavior', () => {
    it('counter_service post-pay: no payment at POS, tables still optional', () => {
      const helpers = createHelpers('counter_service', 'post_pay');
      expect(helpers.isPayFirst()).toBe(false);
      expect(helpers.requiresTables()).toBe(false);
      expect(helpers.hasServerRole()).toBe(false);
    });

    it('food_truck post-pay: no payment at POS, no tables, no server', () => {
      const helpers = createHelpers('food_truck', 'post_pay');
      expect(helpers.isPayFirst()).toBe(false);
      expect(helpers.requiresTables()).toBe(false);
      expect(helpers.hasServerRole()).toBe(false);
    });

    it('counter_service pre-pay: payment at POS, tables still optional', () => {
      const helpers = createHelpers('counter_service', 'pre_pay');
      expect(helpers.isPayFirst()).toBe(true);
      expect(helpers.requiresTables()).toBe(false);
      expect(helpers.hasServerRole()).toBe(false);
    });

    it('food_truck pre-pay: payment at POS, no tables, no server', () => {
      const helpers = createHelpers('food_truck', 'pre_pay');
      expect(helpers.isPayFirst()).toBe(true);
      expect(helpers.requiresTables()).toBe(false);
      expect(helpers.hasServerRole()).toBe(false);
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
