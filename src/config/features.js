/**
 * Feature flags — UI-facing.
 *
 * Keep this file in sync with the backend counterparts:
 *   - SMS_ENABLED mirrors functions/services/smsService.js :: SMS_ENABLED
 *
 * Flip SMS_ENABLED to true (here AND in smsService.js) once the A2P 10DLC
 * registration with the carrier aggregator is approved, and the PLIVO_*
 * Firebase Functions secrets are set.
 */
export const SMS_ENABLED = false;
