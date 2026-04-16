/**
 * Notification Service — Orchestrator
 *
 * Central service that coordinates email and SMS delivery.
 * Uses template functions to generate content, then dispatches via
 * emailService / smsService. SMS is currently gated off by the
 * SMS_ENABLED flag in smsService.js (awaiting 10DLC approval); when
 * disabled, sendSMS short-circuits with { skipped: true } and this
 * orchestrator treats that as a successful skip (email remains the
 * canonical delivery path).
 *
 * Usage:
 *   const notifier = createNotificationService({
 *     resendApiKey,
 *     plivoAuthId,
 *     plivoAuthToken,
 *     plivoFromNumber
 *   });
 *   await notifier.sendWelcomeRestaurant({ restaurantName, email, phone, tier });
 */
const { logger } = require('firebase-functions');
const { sendEmail } = require('./emailService');
const { sendSMS, SMS_ENABLED } = require('./smsService');
const { welcomeRestaurantEmail } = require('../templates/emails/welcomeRestaurant');
const { orderReceiptEmail } = require('../templates/emails/orderReceipt');

function createNotificationService({ resendApiKey, plivoAuthId, plivoAuthToken, plivoFromNumber }) {
  const plivoCredentials = {
    authId: plivoAuthId,
    authToken: plivoAuthToken,
    fromNumber: plivoFromNumber,
  };

  return {
    async sendWelcomeRestaurant({ restaurantName, email, phone, tier, username }) {
      const results = { email: null, sms: null };

      if (email) {
        const { subject, html } = welcomeRestaurantEmail({ restaurantName, email, tier, username });
        results.email = await sendEmail({ to: email, subject, html }, resendApiKey);
      }

      if (phone && SMS_ENABLED) {
        const tierName = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Free';
        const smsBody = `Welcome to Koda Carte, ${restaurantName}! 🎉 Your ${tierName} plan is active. Log in at https://kodacarte.com to set up your menu, POS, and start taking orders. Need help? Reply to this text or email support@kodacarte.com`;
        results.sms = await sendSMS({ to: phone, body: smsBody }, plivoCredentials);
      }

      logger.info('Welcome notifications sent:', {
        restaurant: restaurantName,
        emailSent: results.email?.success || false,
        smsSent: results.sms?.success || false,
        smsEnabled: SMS_ENABLED,
      });

      return results;
    },

    async sendOrderReceipt({ order, restaurantName, customerEmail, customerPhone, receiptPreference }) {
      const results = { email: null, sms: null };

      const receiptData = {
        restaurantName,
        orderNumber: order.orderNumber || order.id,
        items: order.items || [],
        subtotal: order.subtotal || 0,
        tax: order.tax || 0,
        total: order.total || 0,
        taxRate: order.taxRate || 0,
        paymentMethod: order.paymentDetails?.paymentMethod || order.paymentMethod || 'card',
        promoDiscount: order.promoDiscount || 0,
        pointsDiscount: order.pointsDiscount || 0,
        rewardDiscount: order.rewardDiscount || 0,
        orderType: order.orderType || 'dine_in',
        customerName: order.customer?.name || '',
        createdAt: order.createdAt?._seconds ? new Date(order.createdAt._seconds * 1000).toISOString() : order.createdAt || null,
      };

      // While SMS is disabled, promote email whenever the customer has one.
      // If the customer only has a phone and no email, we skip and log.
      const smsRequested = receiptPreference === 'sms' || receiptPreference === 'both';
      const emailRequested = !receiptPreference || receiptPreference === 'email' || receiptPreference === 'both';
      const fallbackToEmail = smsRequested && !SMS_ENABLED && !!customerEmail;

      const shouldEmail = customerEmail && (emailRequested || fallbackToEmail);
      if (shouldEmail) {
        const { subject, html } = orderReceiptEmail(receiptData);
        results.email = await sendEmail({ to: customerEmail, subject, html }, resendApiKey);
      }

      if (customerPhone && smsRequested && SMS_ENABLED) {
        const itemsSummary = (order.items || []).slice(0, 5).map(i => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');
        const moreItems = (order.items || []).length > 5 ? ` +${order.items.length - 5} more` : '';
        const smsBody = `Receipt from ${restaurantName}\nOrder #${receiptData.orderNumber}\n${itemsSummary}${moreItems}\nTotal: $${Number(order.total || 0).toFixed(2)}\nThank you for your visit!`;
        results.sms = await sendSMS({ to: customerPhone, body: smsBody }, plivoCredentials);
      }

      logger.info('Order receipt sent:', {
        orderNumber: receiptData.orderNumber,
        restaurant: restaurantName,
        emailSent: results.email?.success || false,
        smsSent: results.sms?.success || false,
        preference: receiptPreference || 'email',
        smsEnabled: SMS_ENABLED,
        fellBackToEmail: fallbackToEmail,
      });

      return results;
    },

    async sendGenericEmail({ to, subject, html, text }) {
      return sendEmail({ to, subject, html, text }, resendApiKey);
    },

    async sendGenericSMS({ to, body }) {
      return sendSMS({ to, body }, plivoCredentials);
    },
  };
}

module.exports = { createNotificationService };
