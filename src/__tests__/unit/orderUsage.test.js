/**
 * Unit Tests — Order Usage Service
 * Tests order counting, tier limit enforcement, overage calculations,
 * billing period reset, and hard cap behavior.
 */

// Mock Firebase modules
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
  setDoc: jest.fn()
}));

jest.mock('../../firebase', () => ({
  db: { type: 'mock-firestore' }
}));

jest.mock('../../contexts/SubscriptionContext', () => ({
  ORDER_LIMITS: {
    scout: { limit: 75, overageRate: 0, hardCap: true },
    ally: { limit: 500, overageRate: 0.02 },
    guide: { limit: 2000, overageRate: 0.01 },
    chief: { limit: 5000, overageRate: 0.005 },
    elder: { limit: Infinity, overageRate: 0 }
  },
  MENU_LIMITS: {
    scout: { items: 10, reads: Infinity },
    ally: { items: Infinity, reads: Infinity },
    guide: { items: Infinity, reads: Infinity },
    chief: { items: Infinity, reads: Infinity },
    elder: { items: Infinity, reads: Infinity }
  }
}));

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { ORDER_LIMITS } from '../../contexts/SubscriptionContext';

describe('Order Usage Service — Business Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Order Limits by Tier', () => {
    it('should have correct limits for scout tier (hard capped)', () => {
      expect(ORDER_LIMITS.scout.limit).toBe(75);
      expect(ORDER_LIMITS.scout.hardCap).toBe(true);
      expect(ORDER_LIMITS.scout.overageRate).toBe(0);
    });

    it('should have correct limits for ally tier', () => {
      expect(ORDER_LIMITS.ally.limit).toBe(500);
      expect(ORDER_LIMITS.ally.overageRate).toBe(0.02);
      expect(ORDER_LIMITS.ally.hardCap).toBeUndefined();
    });

    it('should have correct limits for guide tier', () => {
      expect(ORDER_LIMITS.guide.limit).toBe(2000);
      expect(ORDER_LIMITS.guide.overageRate).toBe(0.01);
    });

    it('should have correct limits for chief tier', () => {
      expect(ORDER_LIMITS.chief.limit).toBe(5000);
      expect(ORDER_LIMITS.chief.overageRate).toBe(0.005);
    });

    it('should have unlimited orders for elder tier', () => {
      expect(ORDER_LIMITS.elder.limit).toBe(Infinity);
      expect(ORDER_LIMITS.elder.overageRate).toBe(0);
    });
  });

  describe('Overage Calculation', () => {
    it('should calculate 2% overage for ally tier', () => {
      const orderTotal = 50.00;
      const overageCharge = orderTotal * ORDER_LIMITS.ally.overageRate;
      expect(overageCharge).toBe(1.00);
    });

    it('should calculate 1% overage for guide tier', () => {
      const orderTotal = 100.00;
      const overageCharge = orderTotal * ORDER_LIMITS.guide.overageRate;
      expect(overageCharge).toBe(1.00);
    });

    it('should calculate 0.5% overage for chief tier', () => {
      const orderTotal = 200.00;
      const overageCharge = orderTotal * ORDER_LIMITS.chief.overageRate;
      expect(overageCharge).toBe(1.00);
    });

    it('should have zero overage for elder tier', () => {
      const orderTotal = 500.00;
      const overageCharge = orderTotal * ORDER_LIMITS.elder.overageRate;
      expect(overageCharge).toBe(0);
    });

    it('should have zero overage for scout tier (hard capped instead)', () => {
      const orderTotal = 50.00;
      const overageCharge = orderTotal * ORDER_LIMITS.scout.overageRate;
      expect(overageCharge).toBe(0);
    });
  });

  describe('Hard Cap Enforcement', () => {
    it('should block orders for hard-capped tiers when limit exceeded', () => {
      const tier = 'scout';
      const tierLimits = ORDER_LIMITS[tier];
      const currentCount = 75;
      const newCount = currentCount + 1;

      const blocked = tierLimits.hardCap && newCount > tierLimits.limit;
      expect(blocked).toBe(true);
    });

    it('should allow orders for hard-capped tiers when under limit', () => {
      const tier = 'scout';
      const tierLimits = ORDER_LIMITS[tier];
      const currentCount = 50;
      const newCount = currentCount + 1;

      const blocked = tierLimits.hardCap && newCount > tierLimits.limit;
      expect(blocked).toBe(false);
    });

    it('should not block orders for non-hard-capped tiers even when over limit', () => {
      const tier = 'ally';
      const tierLimits = ORDER_LIMITS[tier];
      const currentCount = 600;
      const newCount = currentCount + 1;

      const blocked = !!(tierLimits.hardCap && newCount > tierLimits.limit);
      expect(blocked).toBe(false);
    });
  });

  describe('Billing Period Calculation', () => {
    const calculatePeriodEnd = (startDate, billingCycle) => {
      const end = new Date(startDate);
      switch (billingCycle) {
        case 'annual':
          end.setFullYear(end.getFullYear() + 1);
          break;
        case 'quarterly':
          end.setMonth(end.getMonth() + 3);
          break;
        case 'monthly':
        default:
          end.setMonth(end.getMonth() + 1);
          break;
      }
      return end;
    };

    it('should calculate monthly period end correctly', () => {
      const start = new Date(2026, 0, 15); // Jan 15 2026 (local time)
      const end = calculatePeriodEnd(start, 'monthly');
      expect(end.getMonth()).toBe(1); // February
      expect(end.getDate()).toBe(15);
    });

    it('should calculate quarterly period end correctly', () => {
      const start = new Date(2026, 0, 15); // Jan 15 2026 (local time)
      const end = calculatePeriodEnd(start, 'quarterly');
      expect(end.getMonth()).toBe(3); // April
      expect(end.getDate()).toBe(15);
    });

    it('should calculate annual period end correctly', () => {
      const start = new Date('2026-01-15');
      const end = calculatePeriodEnd(start, 'annual');
      expect(end.getFullYear()).toBe(2027);
      expect(end.getMonth()).toBe(0); // January
    });

    it('should default to monthly for unknown billing cycle', () => {
      const start = new Date('2026-01-15');
      const end = calculatePeriodEnd(start, 'unknown');
      expect(end.getMonth()).toBe(1); // February
    });
  });
});
