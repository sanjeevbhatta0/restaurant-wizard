/**
 * Notification Service — Orchestrator
 *
 * Central service that coordinates email and SMS delivery.
 * Uses template functions to generate content, then dispatches via emailService / smsService.
 *
 * Usage:
 *   const notifier = createNotificationService({ resendApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber });
 *   await notifier.sendWelcomeRestaurant({ restaurantName, email, phone, tier });
 */
const { logger } = require('firebase-functions');
const { sendEmail } = require('./emailService');
const { sendSMS } = require('./smsService');
const { welcomeRestaurantEmail } = require('../templates/emails/welcomeRestaurant');
const { orderReceiptEmail } = require('../templates/emails/orderReceipt');

/**
 * Create a notification service instance with credentials
 */
function createNotificationService({ resendApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber }) {
  const twilioCredentials = {
    accountSid: twilioAccountSid,
    authToken: twilioAuthToken,
    fromNumber: twilioFromNumber
  };

  return {
    /**
     * Send welcome notifications to a new restaurant admin
     */
    async sendWelcomeRestaurant({ restaurantName, email, phone, tier, username }) {
      const results = { email: null, sms: null };

      // 1. Send welcome email
      if (email) {
        const { subject, html } = welcomeRestaurantEmail({ restaurantName, email, tier, username });
        results.email = await sendEmail({ to: email, subject, html }, resendApiKey);
      }

      // 2. Send welcome SMS (only if phone provided)
      if (phone) {
        const tierName = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Free';
        const smsBody = `Welcome to Koda Carte, ${restaurantName}! 🎉 Your ${tierName} plan is active. Log in at https://kodacarte.com to set up your menu, POS, and start taking orders. Need help? Reply to this text or email support@kodacarte.com`;

        results.sms = await sendSMS({ to: phone, body: smsBody }, twilioCredentials);
      }

      logger.info('Welcome notifications sent:', {
        restaurant: restaurantName,
        emailSent: results.email?.success || false,
        smsSent: results.sms?.success || false
      });

      return results;
    },

    /**
     * Send order receipt to customer via email and/or SMS
     */
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
        createdAt: order.createdAt?._seconds ? new Date(order.createdAt._seconds * 1000).toISOString() : order.createdAt || null
      };

      // Send email receipt if customer has email and preference allows it
      const shouldEmail = customerEmail && (!receiptPreference || receiptPreference === 'email' || receiptPreference === 'both');
      if (shouldEmail) {
        const { subject, html } = orderReceiptEmail(receiptData);
        results.email = await sendEmail({ to: customerEmail, subject, html }, resendApiKey);
      }

      // Send SMS receipt if customer has phone and preference allows it
      const shouldSMS = customerPhone && (receiptPreference === 'sms' || receiptPreference === 'both');
      if (shouldSMS) {
        const itemsSummary = (order.items || []).slice(0, 5).map(i => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', ');
        const moreItems = (order.items || []).length > 5 ? ` +${order.items.length - 5} more` : '';
        const smsBody = `Receipt from ${restaurantName}\nOrder #${receiptData.orderNumber}\n${itemsSummary}${moreItems}\nTotal: $${Number(order.total || 0).toFixed(2)}\nThank you for your visit!`;

        results.sms = await sendSMS({ to: customerPhone, body: smsBody }, twilioCredentials);
      }

      logger.info('Order receipt sent:', {
        orderNumber: receiptData.orderNumber,
        restaurant: restaurantName,
        emailSent: results.email?.success || false,
        smsSent: results.sms?.success || false,
        preference: receiptPreference || 'email'
      });

      return results;
    },

    /**
     * Send a generic email (for future use — order confirmations, customer emails, etc.)
     */
    async sendGenericEmail({ to, subject, html, text }) {
      return sendEmail({ to, subject, html, text }, resendApiKey);
    },

    /**
     * Send a generic SMS (for future use — order updates, customer notifications, etc.)
     */
    async sendGenericSMS({ to, body }) {
      return sendSMS({ to, body }, twilioCredentials);
    }
  };
}

module.exports = { createNotificationService };
