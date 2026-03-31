/**
 * Shared E2E Test Firebase Helper
 *
 * Uses firebase-admin SDK which:
 * 1. Auto-detects FIRESTORE_EMULATOR_HOST env var
 * 2. Bypasses all Firestore security rules
 * 3. Uses a completely separate Firestore client (@google-cloud/firestore)
 *    so there are no "INTERNAL ASSERTION FAILED" conflicts with the client SDK
 *
 * Usage in test files:
 *   const { db, isEmulatorAvailable } = require('../helpers/e2eFirebase');
 */

// Polyfill setImmediate for jsdom environment (CRA default test env)
// The firebase-admin SDK's gRPC transport requires setImmediate
if (typeof setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}
if (typeof clearImmediate === 'undefined') {
  global.clearImmediate = (id) => clearTimeout(id);
}

// Increase Jest timeout for E2E tests (emulator operations can be slow)
if (typeof jest !== 'undefined') {
  jest.setTimeout(30000);
}

const admin = require('firebase-admin');

const PROJECT_ID = 'restaurant-portal-6b147';

// Initialize admin app once (idempotent — checks for existing apps)
if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();

const isEmulatorAvailable = !!process.env.FIRESTORE_EMULATOR_HOST;

module.exports = { db, admin, isEmulatorAvailable, PROJECT_ID };
