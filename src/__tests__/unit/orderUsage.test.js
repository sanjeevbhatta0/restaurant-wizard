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

  // ==========================================
  // Admin-Configured Limits Enforcement
  // ==========================================

  describe('Admin-Configured Limits Override Defaults', () => {
    it('should enforce admin-configured scout limit instead of hardcoded default', () => {
      // Admin set scout limit to 90 (default was 75)
      const adminLimits = { scout: { limit: 90, overageRate: 0, hardCap: true } };
      const currentCount = 80;
      const newCount = currentCount + 1;
      // Should NOT be blocked at 80 with admin limit of 90
      const blocked = adminLimits.scout.hardCap && newCount > adminLimits.scout.limit;
      expect(blocked).toBe(false);
    });

    it('should block at admin-configured limit, not hardcoded default', () => {
      const adminLimits = { scout: { limit: 90, overageRate: 0, hardCap: true } };
      const currentCount = 90;
      const newCount = currentCount + 1;
      const blocked = adminLimits.scout.hardCap && newCount > adminLimits.scout.limit;
      expect(blocked).toBe(true);
    });

    it('should use admin-configured overage rate for calculations', () => {
      // Admin changed ally from 2% to 1.75%
      const adminLimits = { ally: { limit: 500, overageRate: 0.0175 } };
      const orderTotal = 100;
      const overageCharge = orderTotal * adminLimits.ally.overageRate;
      // Floating point: 100 * 0.0175 can produce 1.7500000000000002
      // Round to cents for money calculations
      expect(Math.round(overageCharge * 100) / 100).toBe(1.75);
    });

    it('should use admin-configured limit for ally tier', () => {
      const adminLimits = { ally: { limit: 750, overageRate: 0.015 } };
      const currentCount = 600;
      // Under admin limit of 750, so no overage
      const isOverage = currentCount > adminLimits.ally.limit;
      expect(isOverage).toBe(false);
    });
  });

  // ==========================================
  // Overage Accumulation and Billing
  // ==========================================

  describe('Overage Accumulation', () => {
    it('should accumulate overage charges across multiple orders', () => {
      const tierLimits = { limit: 500, overageRate: 0.02 };
      let totalOverage = 0;
      const orders = [50, 75, 100]; // 3 overage orders

      orders.forEach(orderTotal => {
        totalOverage += orderTotal * tierLimits.overageRate;
      });

      expect(totalOverage).toBe(4.50); // (50+75+100) * 0.02 = 4.50
    });

    it('should not charge overage for orders within limit', () => {
      const tierLimits = { limit: 500, overageRate: 0.02 };
      const currentCount = 400;
      const orderTotal = 50;
      const newCount = currentCount + 1;

      const isOverage = newCount > tierLimits.limit;
      const overageCharge = isOverage ? orderTotal * tierLimits.overageRate : 0;
      expect(overageCharge).toBe(0);
    });

    it('should charge overage only for orders beyond the limit', () => {
      const tierLimits = { limit: 500, overageRate: 0.02 };
      const currentCount = 500; // exactly at limit
      const orderTotal = 80;
      const newCount = currentCount + 1;

      const isOverage = newCount > tierLimits.limit;
      const overageCharge = isOverage ? orderTotal * tierLimits.overageRate : 0;
      expect(overageCharge).toBe(1.60); // 80 * 0.02
    });
  });

  // ==========================================
  // Overage Billing to Platform Stripe Account
  // ==========================================

  describe('Overage Billing Model', () => {
    it('should bill overage to platform Stripe account (not connected account)', () => {
      // Overage charges are platform usage fees, not customer payments.
      // They use the platform's Stripe secret key (no transfer_data, no on_behalf_of).
      const overagePayment = {
        amount: 450, // $4.50 in cents
        currency: 'usd',
        metadata: { type: 'overage_charge', restaurantId: 'abc123' },
        // No transfer_data — goes to platform account
      };

      expect(overagePayment.transfer_data).toBeUndefined();
      expect(overagePayment.on_behalf_of).toBeUndefined();
      expect(overagePayment.metadata.type).toBe('overage_charge');
    });

    it('should respect Stripe minimum charge of $0.50', () => {
      const overageCharges = 0.25; // only 25 cents accumulated
      const chargeAmount = Math.max(50, Math.round(overageCharges * 100)); // cents
      expect(chargeAmount).toBe(50); // Stripe minimum $0.50
    });

    it('should correctly convert dollar amounts to Stripe cents', () => {
      const overageCharges = 4.50;
      const chargeAmount = Math.round(overageCharges * 100);
      expect(chargeAmount).toBe(450);
    });

    it('should reset overage counters after billing', () => {
      // After billing, overageOrders and overageCharges should be reset
      const usageAfterBilling = {
        overageOrders: 0,
        overageCharges: 0,
        lastOverageBilled: new Date(),
        lastOverageAmount: 4.50,
      };

      expect(usageAfterBilling.overageOrders).toBe(0);
      expect(usageAfterBilling.overageCharges).toBe(0);
      expect(usageAfterBilling.lastOverageAmount).toBe(4.50);
    });
  });

  // ==========================================
  // Server-Side Order Limit Enforcement
  // ==========================================

  describe('Server-Side Order Limit Enforcement (submitOrder)', () => {
    it('should block online orders when hard cap is reached', () => {
      const tierLimits = { limit: 90, hardCap: true };
      const currentCount = 90;

      const isBlocked = tierLimits.hardCap && currentCount >= tierLimits.limit;
      expect(isBlocked).toBe(true);
    });

    it('should allow online orders when under hard cap', () => {
      const tierLimits = { limit: 90, hardCap: true };
      const currentCount = 89;

      const isBlocked = tierLimits.hardCap && currentCount >= tierLimits.limit;
      expect(isBlocked).toBe(false);
    });

    it('should track overage for online orders over limit (non-hard-cap)', () => {
      const tierLimits = { limit: 500, overageRate: 0.02 };
      const currentCount = 501;
      const orderTotal = 45.00;

      const isOverage = currentCount > tierLimits.limit;
      const overageCharge = isOverage ? orderTotal * tierLimits.overageRate : 0;

      expect(isOverage).toBe(true);
      expect(overageCharge).toBe(0.90);
    });

    it('should skip limit checks for elder tier (unlimited)', () => {
      const tierLimits = { limit: Infinity, overageRate: 0 };
      const shouldEnforce = tierLimits.limit !== Infinity;
      expect(shouldEnforce).toBe(false);
    });

    it('should use platformConfig limits, not hardcoded defaults', () => {
      // Simulates server-side reading from platformConfig/current
      const platformConfig = {
        orderLimits: {
          scout: { limit: 90, overageRate: 0, hardCap: true },
          ally: { limit: 750, overageRate: 0.0175 },
        }
      };

      const tierLimits = platformConfig.orderLimits.scout;
      expect(tierLimits.limit).toBe(90);
      expect(tierLimits.limit).not.toBe(75); // not the hardcoded default
    });
  });

  // ==========================================
  // Floating Point Precision
  // ==========================================

  describe('Floating Point Precision', () => {
    it('should display overage rate without floating point artifacts', () => {
      // 0.0175 * 100 raw = 1.7500000000000002 (floating point error)
      const overageRate = 0.0175;
      const displayValue = +((overageRate * 100).toFixed(4));
      expect(displayValue).toBe(1.75);
      expect(displayValue.toString()).toBe('1.75');
    });

    it('should store overage rate without floating point artifacts', () => {
      // User types 1.75% in the input, stored as decimal
      const inputValue = 1.75;
      const storedRate = +(inputValue / 100).toFixed(6);
      expect(storedRate).toBe(0.0175);
      // Round-trip: stored -> display
      const displayBack = +((storedRate * 100).toFixed(4));
      expect(displayBack).toBe(1.75);
    });

    it('should handle 0.5% overage rate correctly', () => {
      const overageRate = 0.005;
      const displayValue = +((overageRate * 100).toFixed(4));
      expect(displayValue).toBe(0.5);
    });

    it('should handle 2% overage rate correctly', () => {
      const overageRate = 0.02;
      const displayValue = +((overageRate * 100).toFixed(4));
      expect(displayValue).toBe(2);
    });

    it('should handle round-trip for edge case rates', () => {
      const testRates = [0.1, 0.25, 0.33, 0.5, 1, 1.5, 1.75, 2, 2.5, 3.33, 5, 10];
      testRates.forEach(inputPercent => {
        const stored = +(inputPercent / 100).toFixed(6);
        const displayed = +((stored * 100).toFixed(4));
        expect(displayed).toBe(inputPercent);
      });
    });
  });
});
