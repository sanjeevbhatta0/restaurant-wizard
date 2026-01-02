import { loadStripe } from '@stripe/stripe-js';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Stripe publishable key - will be fetched from backend or use test key
let stripePromise = null;

/**
 * Initialize Stripe with the publishable key
 * For sandbox/test mode, use your test publishable key
 */
export const getStripe = async () => {
  if (!stripePromise) {
    // You can either hardcode the test key here or fetch from backend
    // For production, consider fetching from a secure backend endpoint
    const publishableKey = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || 'pk_test_51SkXC0KckjWrEVo2Ds2i9mmr5IONkNEYa5an7d4lEr2qg29M3y88UzQRCZoqSzJ92qoTBffVm1AWEPB5uYxdhpsD00bsPkUN15';
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};

/**
 * Create a PaymentIntent for processing card payments
 * @param {number} amount - Amount in dollars
 * @param {Array<string>} orderIds - List of order IDs being paid
 * @param {Array<string>} tableNumbers - List of table numbers
 * @param {string} restaurantId - Restaurant ID (user UID)
 * @returns {Promise<{clientSecret: string, paymentIntentId: string}>}
 */
export const createPaymentIntent = async (amount, orderIds, tableNumbers, restaurantId) => {
  try {
    const functions = getFunctions();
    const createPaymentIntentFn = httpsCallable(functions, 'createPaymentIntent');

    const result = await createPaymentIntentFn({
      amount,
      currency: 'usd',
      orderIds,
      tableNumbers,
      restaurantId
    });

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

/**
 * Calculate total price for tier signup
 * @param {string} tier - Tier name
 * @param {string} billingCycle - monthly, quarterly, annual
 * @param {number} locationCount - Number of locations
 * @returns {{monthlyPerLocation: number, totalMonthly: number, billingMonths: number, totalCharge: number}}
 */
export const calculateTierPrice = (tier, billingCycle, locationCount) => {
  // Base prices (annual rate - this is the advertised price)
  const BASE_PRICES = {
    ally: 29,
    guide: 59,
    chief: 99,
    elder: 229
  };

  // Billing multipliers
  const BILLING_MULTIPLIERS = {
    monthly: 1.20,   // 20% extra
    quarterly: 1.10, // 10% extra
    annual: 1.00     // Base price
  };

  // Billing periods in months
  const BILLING_MONTHS = {
    monthly: 1,
    quarterly: 3,
    annual: 12
  };

  const basePrice = BASE_PRICES[tier] || 29;
  const multiplier = BILLING_MULTIPLIERS[billingCycle] || 1;
  const billingMonths = BILLING_MONTHS[billingCycle] || 1;

  const monthlyPerLocation = basePrice * multiplier;
  const totalMonthly = monthlyPerLocation * locationCount;
  const totalCharge = totalMonthly * billingMonths;

  return {
    monthlyPerLocation: Math.round(monthlyPerLocation * 100) / 100,
    totalMonthly: Math.round(totalMonthly * 100) / 100,
    billingMonths,
    totalCharge: Math.round(totalCharge * 100) / 100
  };
};

export default {
  getStripe,
  createPaymentIntent,
  confirmPayment,
  processRefund,
  formatAmount,
  createTierPayment,
  calculateTierPrice
};

