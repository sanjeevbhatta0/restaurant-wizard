import { loadStripe } from '@stripe/stripe-js';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { STRIPE_PUBLISHABLE_KEY } from '../config';

// Cache Stripe instances: platform + connected accounts
const stripeInstances = {};

/**
 * Initialize Stripe with the publishable key.
 * Uses environment-aware key from config (dev = pk_test, prod = pk_live).
 * If connectedAccountId is provided, creates a Stripe instance targeting that connected account.
 * @param {string} [connectedAccountId] - Optional Stripe Connect account ID
 */
export const getStripe = async (connectedAccountId) => {
  const cacheKey = connectedAccountId || '__platform__';
  if (!stripeInstances[cacheKey]) {
    const publishableKey = STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      console.error('Stripe publishable key is not set');
      return null;
    }
    const opts = connectedAccountId ? { stripeAccount: connectedAccountId } : {};
    stripeInstances[cacheKey] = loadStripe(publishableKey, opts);
  }
  return stripeInstances[cacheKey];
};

/**
 * Fetch the Stripe Connect status for the current restaurant.
 * Returns { connected, connectedAccountId, ... } or { connected: false }.
 */
export const getStripeConnectStatus = async () => {
  try {
    const functions = getFunctions();
    const fn = httpsCallable(functions, 'getStripeConnectStatus');
    const result = await fn();
    return result.data;
  } catch (error) {
    console.error('Error fetching Stripe Connect status:', error);
    return { connected: false, status: 'error' };
  }
};

/**
 * Create a PaymentIntent for processing card payments
 * @param {number} amount - Amount in dollars
 * @param {Array<string>} orderIds - List of order IDs being paid
 * @param {Array<string>} tableNumbers - List of table numbers
 * @param {string} restaurantId - Restaurant ID (user UID)
 * @returns {Promise<{clientSecret: string, paymentIntentId: string}>}
 */
export const createPaymentIntent = async (amount, orderIds, tableNumbers, restaurantId, source) => {
  try {
    const functions = getFunctions();
    const createPaymentIntentFn = httpsCallable(functions, 'createPaymentIntent');

    const params = {
      amount,
      currency: 'usd',
      orderIds,
      tableNumbers,
      restaurantId
    };
    if (source) params.source = source;

    const result = await createPaymentIntentFn(params);

    return result.data;
  } catch (error) {
    console.error('Error creating payment intent:', error);
    throw new Error(error.message || 'Failed to create payment intent');
  }
};

/**
 * Confirm payment after successful Stripe card payment
 * @param {string} paymentIntentId - Stripe PaymentIntent ID
 * @param {Array<string>} orderIds - List of order IDs
 * @param {Object} paymentDetails - Payment details (subtotal, tax, etc.)
 * @param {string} restaurantId - Restaurant ID
 */
export const confirmPayment = async (paymentIntentId, orderIds, paymentDetails, restaurantId) => {
  try {
    const functions = getFunctions();
    const confirmPaymentFn = httpsCallable(functions, 'confirmStripePayment');

    const result = await confirmPaymentFn({
      paymentIntentId,
      orderIds,
      paymentDetails,
      restaurantId
    });

    return result.data;
  } catch (error) {
    console.error('Error confirming payment:', error);
    throw new Error(error.message || 'Failed to confirm payment');
  }
};

/**
 * Process a refund through Stripe
 * @param {string} orderId - Order ID to refund
 * @param {string} restaurantId - Restaurant ID
 * @param {number} refundAmount - Amount to refund in dollars
 * @param {string} refundType - 'full' or 'partial'
 */
export const processRefund = async (orderId, restaurantId, refundAmount, refundType) => {
  try {
    const functions = getFunctions();
    const processRefundFn = httpsCallable(functions, 'processStripeRefund');

    const result = await processRefundFn({
      orderId,
      restaurantId,
      refundAmount,
      refundType
    });

    return result.data;
  } catch (error) {
    console.error('Error processing refund:', error);
    throw new Error(error.message || 'Failed to process refund');
  }
};

/**
 * Format amount for display
 * @param {number} amount - Amount in dollars
 * @returns {string} Formatted amount
 */
export const formatAmount = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
};

/**
 * Create a PaymentIntent for one-time tier payment during signup
 * TODO: Replace with Stripe Subscriptions for recurring billing
 * 
 * @param {number} amount - Amount in dollars (tier price * locations * billing period)
 * @param {string} tier - Selected tier (ally, guide, chief, elder)
 * @param {string} billingCycle - Billing cycle (monthly, quarterly, annual)
 * @param {number} locationCount - Number of locations
 * @param {string} restaurantName - Restaurant name for metadata
 * @param {string} email - Customer email
 * @returns {Promise<{clientSecret: string, paymentIntentId: string}>}
 */
export const createTierPayment = async (amount, tier, billingCycle, locationCount, restaurantName, email) => {
  try {
    const functions = getFunctions();
    const createTierPaymentFn = httpsCallable(functions, 'createTierPayment');

    const result = await createTierPaymentFn({
      amount,
      currency: 'usd',
      tier,
      billingCycle,
      locationCount,
      restaurantName,
      email,
      // TODO: When implementing subscriptions, add priceId here
      // priceId: STRIPE_PRICE_IDS[tier][billingCycle]
    });

    return result.data;
  } catch (error) {
    console.error('Error creating tier payment:', error);
    throw new Error(error.message || 'Failed to create payment');
  }
};

// Default pricing fallbacks (used when admin config hasn't loaded yet)
const DEFAULT_BASE_PRICES = {
  scout: 0,
  ally: 29,
  guide: 59,
  chief: 99,
  elder: 229
};

const DEFAULT_BILLING_MULTIPLIERS = {
  monthly: 1.20,
  quarterly: 1.10,
  annual: 1.00
};

/**
 * Calculate total price for tier signup.
 * Accepts optional adminConfig to use live pricing from platformConfig/current.
 * Falls back to hardcoded defaults if no config provided.
 *
 * @param {string} tier - Tier name
 * @param {string} billingCycle - monthly, quarterly, annual
 * @param {number} locationCount - Number of locations
 * @param {Object} [adminConfig] - Live admin config from platformConfig/current
 * @returns {{monthlyPerLocation: number, totalMonthly: number, billingMonths: number, totalCharge: number}}
 */
export const calculateTierPrice = (tier, billingCycle, locationCount, adminConfig) => {
  const basePrices = adminConfig?.pricing || DEFAULT_BASE_PRICES;
  const billingMultipliers = adminConfig?.billingMultipliers || DEFAULT_BILLING_MULTIPLIERS;

  const BILLING_MONTHS = {
    monthly: 1,
    quarterly: 3,
    annual: 12
  };

  const basePrice = basePrices[tier] ?? DEFAULT_BASE_PRICES[tier] ?? 29;
  const multiplier = billingMultipliers[billingCycle] ?? DEFAULT_BILLING_MULTIPLIERS[billingCycle] ?? 1;
  const billingMonths = BILLING_MONTHS[billingCycle] || 1;

  // Check for active discounts (same logic as PricingTiers.js)
  let discountAmount = 0;
  let activeDiscount = null;
  if (adminConfig?.discounts) {
    const now = new Date();
    activeDiscount = adminConfig.discounts.find(d => {
      if (!d.active) return false;
      const start = new Date(d.startDate);
      const end = new Date(d.endDate);
      return now >= start && now <= end &&
        ((d.type === 'tier' && d.target === tier) ||
         (d.type === 'billing_cycle' && d.target === billingCycle));
    });

    if (activeDiscount) {
      if (activeDiscount.isPercentage) {
        discountAmount = basePrice * (activeDiscount.amount / 100);
      } else {
        discountAmount = activeDiscount.amount;
      }
    }
  }

  const discountedBasePrice = Math.max(0, basePrice - discountAmount);
  const monthlyPerLocation = discountedBasePrice * multiplier;
  const originalMonthly = basePrice * multiplier;
  const totalMonthly = monthlyPerLocation * locationCount;
  const totalCharge = totalMonthly * billingMonths;

  return {
    monthlyPerLocation: Math.round(monthlyPerLocation * 100) / 100,
    originalMonthlyPerLocation: activeDiscount ? Math.round(originalMonthly * 100) / 100 : null,
    totalMonthly: Math.round(totalMonthly * 100) / 100,
    billingMonths,
    totalCharge: Math.round(totalCharge * 100) / 100,
    discount: activeDiscount ? {
      name: activeDiscount.name,
      amount: activeDiscount.amount,
      isPercentage: activeDiscount.isPercentage,
    } : null,
  };
};

/**
 * Create a Stripe Subscription for a new restaurant signup.
 * Handles recurring billing, free trials, and discounts.
 *
 * @param {string} tier - Selected tier (ally, guide, chief, elder)
 * @param {string} billingCycle - Billing cycle (monthly, quarterly, annual)
 * @param {number} locationCount - Number of locations
 * @param {string} restaurantName - Restaurant name
 * @param {string} email - Customer email
 * @returns {Promise<{type: 'trial'|'subscription', ...}>}
 */
export const createStripeSubscription = async (tier, billingCycle, locationCount, restaurantName, email) => {
  try {
    const functions = getFunctions();
    const fn = httpsCallable(functions, 'createStripeSubscription');

    const result = await fn({
      tier,
      billingCycle,
      locationCount,
      restaurantName,
      email,
    });

    return result.data;
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw new Error(error.message || 'Failed to create subscription');
  }
};

/**
 * Activate a trial subscription after the SetupIntent is confirmed.
 * Creates the actual Stripe Subscription with trial_period_days.
 *
 * @param {Object} params - Subscription parameters from createStripeSubscription response
 * @returns {Promise<{subscriptionId: string, trialEnd: string, status: string}>}
 */
export const activateTrialSubscription = async (params) => {
  try {
    const functions = getFunctions();
    const fn = httpsCallable(functions, 'activateTrialSubscription');

    const result = await fn(params);
    return result.data;
  } catch (error) {
    console.error('Error activating trial subscription:', error);
    throw new Error(error.message || 'Failed to activate trial');
  }
};

/**
 * Update an existing subscription plan (upgrade or downgrade).
 * Upgrades are prorated immediately. Downgrades are scheduled at period end.
 *
 * @param {string} newTier - New tier (ally, guide, chief, elder, scout)
 * @param {string} newBillingCycle - New billing cycle
 * @param {number} locationCount - Number of locations
 * @returns {Promise<{type: 'upgrade_applied'|'downgrade_scheduled', ...}>}
 */
export const updateSubscriptionPlan = async (newTier, newBillingCycle, locationCount) => {
  try {
    const functions = getFunctions();
    const fn = httpsCallable(functions, 'updateSubscriptionPlan');

    const result = await fn({ newTier, newBillingCycle, locationCount });
    return result.data;
  } catch (error) {
    console.error('Error updating subscription plan:', error);
    throw new Error(error.message || 'Failed to update plan');
  }
};

export default {
  getStripe,
  getStripeConnectStatus,
  createPaymentIntent,
  confirmPayment,
  processRefund,
  formatAmount,
  createTierPayment,
  calculateTierPrice,
  createStripeSubscription,
  activateTrialSubscription,
  updateSubscriptionPlan,
};

