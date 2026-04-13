/**
 * SMS Service — Twilio
 *
 * Provides SMS sending capabilities via the Twilio API.
 * Designed to be provider-swappable.
 */
const { logger } = require('firebase-functions');

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Send an SMS via Twilio
 * @param {Object} options
 * @param {string} options.to - Recipient phone number (E.164 format preferred, e.g. +19373619400)
 * @param {string} options.body - Message text (max 1600 chars)
 * @param {Object} credentials
 * @param {string} credentials.accountSid - Twilio Account SID
 * @param {string} credentials.authToken - Twilio Auth Token
 * @param {string} credentials.fromNumber - Twilio phone number (E.164)
 * @returns {Promise<{success: boolean, sid?: string, error?: string}>}
 */
async function sendSMS({ to, body }, { accountSid, authToken, fromNumber }) {
  if (!accountSid || !authToken || !fromNumber) {
    logger.warn('SMS skipped — Twilio credentials not configured');
    return { success: false, error: 'Twilio credentials not configured' };
  }

  // Normalize phone number to E.164
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    logger.warn(`SMS skipped — invalid phone number: ${to}`);
    return { success: false, error: 'Invalid phone number' };
  }

  const normalizedFrom = normalizePhone(fromNumber);

  try {
    const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('To', normalizedTo);
    params.append('From', normalizedFrom);
    params.append('Body', body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error('Twilio API error:', data);
      return { success: false, error: data.message || 'SMS send failed' };
    }

    logger.info(`SMS sent to ${normalizedTo} — SID: ${data.sid}`);
    return { success: true, sid: data.sid };
  } catch (error) {
    logger.error('SMS send error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Normalize a phone number to E.164 format
 * Handles: 9373619400, (937)361-9400, +19373619400, 19373619400
 */
function normalizePhone(phone) {
  if (!phone) return null;
  // Strip everything except digits and leading +
  const digits = phone.replace(/[^\d+]/g, '');
  const justDigits = digits.replace(/\+/g, '');

  if (justDigits.length === 10) {
    return `+1${justDigits}`; // US number without country code
  }
  if (justDigits.length === 11 && justDigits.startsWith('1')) {
    return `+${justDigits}`; // US number with country code
  }
  if (digits.startsWith('+') && justDigits.length >= 10) {
    return `+${justDigits}`; // International with +
  }

  return null; // Can't normalize
}

module.exports = { sendSMS, normalizePhone };
