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

export default {
  getStripe,
  createPaymentIntent,
  confirmPayment,
  processRefund,
  formatAmount
};
