/**
 * SMS Service — Plivo
 *
 * Sending SMS via Plivo's REST API:
 *   POST https://api.plivo.com/v1/Account/{authId}/Message/
 *   Auth: HTTP Basic (authId : authToken)
 *   Body: { src, dst, text }
 *
 * FEATURE FLAG — SMS_ENABLED is false until A2P 10DLC registration is
 * approved by the carriers. While disabled, sendSMS() short-circuits with
 * { success: false, skipped: true, reason: 'sms_disabled_pending_10dlc' }
 * and callers must fall back to email (or accept the skip).
 *
 * Flip SMS_ENABLED to true (and ensure PLIVO_* secrets are set) once 10DLC
 * registration completes.
 */
const { logger } = require('firebase-functions');

const SMS_ENABLED = false;

const PLIVO_API_BASE = 'https://api.plivo.com/v1/Account';

async function sendSMS({ to, body }, { authId, authToken, fromNumber }) {
  if (!SMS_ENABLED) {
    logger.info(`SMS skipped (flag off): would send to ${maskPhone(to)}`);
    return { success: false, skipped: true, reason: 'sms_disabled_pending_10dlc' };
  }

  if (!authId || !authToken || !fromNumber) {
    logger.warn('SMS skipped — Plivo credentials not configured');
    return { success: false, error: 'Plivo credentials not configured' };
  }

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    logger.warn(`SMS skipped — invalid phone number: ${to}`);
    return { success: false, error: 'Invalid phone number' };
  }

  const normalizedFrom = normalizePhone(fromNumber) || fromNumber;

  try {
    const url = `${PLIVO_API_BASE}/${authId}/Message/`;
    const auth = Buffer.from(`${authId}:${authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src: normalizedFrom,
        dst: normalizedTo,
        text: body,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.error('Plivo API error:', data);
      return { success: false, error: data.error || data.message || `Plivo error ${response.status}` };
    }

    // Plivo returns { api_id, message_uuid: [<id>] }
    const sid = Array.isArray(data.message_uuid) ? data.message_uuid[0] : data.api_id;
    logger.info(`SMS sent to ${normalizedTo} — Plivo ID: ${sid}`);
    return { success: true, sid, provider: 'plivo' };
  } catch (error) {
    logger.error('SMS send error:', error.message);
    return { success: false, error: error.message };
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d+]/g, '');
  const justDigits = digits.replace(/\+/g, '');

  if (justDigits.length === 10) return `+1${justDigits}`;
  if (justDigits.length === 11 && justDigits.startsWith('1')) return `+${justDigits}`;
  if (digits.startsWith('+') && justDigits.length >= 10) return `+${justDigits}`;

  return null;
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? `***${d.slice(-4)}` : '(none)';
}

module.exports = { sendSMS, normalizePhone, SMS_ENABLED };
