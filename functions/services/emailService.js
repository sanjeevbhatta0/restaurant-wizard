/**
 * Email Service — Resend
 *
 * Provides email sending capabilities via the Resend API.
 * Designed to be provider-swappable (replace internals without changing the interface).
 */
const { logger } = require('firebase-functions');

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Send an email via Resend
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject line
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Plain text fallback
 * @param {string} [options.from] - Sender (defaults to Koda Carte)
 * @param {string} apiKey - Resend API key
 * @returns {Promise<{success: boolean, id?: string, error?: string}>}
 */
async function sendEmail({ to, subject, html, text, from }, apiKey) {
  if (!apiKey) {
    logger.warn('Email skipped — RESEND_API_KEY not configured');
    return { success: false, error: 'API key not configured' };
  }

  // Default sender — use onboarding@resend.dev until domain is verified in Resend
  const sender = from || 'Koda Carte <onboarding@resend.dev>';

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: sender,
        to: [to],
        subject,
        html,
        text: text || stripHtml(html)
      })
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error('Resend API error:', data);
      return { success: false, error: data.message || 'Email send failed' };
    }

    logger.info(`Email sent to ${to} — ID: ${data.id}`);
    return { success: true, id: data.id };
  } catch (error) {
    logger.error('Email send error:', error.message);
    return { success: false, error: error.message };
  }
}

/** Strip HTML tags for plain text fallback */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { sendEmail };
