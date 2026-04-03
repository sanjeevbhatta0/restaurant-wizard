/**
 * Environment-aware configuration for Koda Carte.
 *
 * Reads REACT_APP_FIREBASE_ENV to decide between dev and production URLs.
 * All hardcoded project references should use helpers from this file.
 */

const isProd = process.env.REACT_APP_FIREBASE_ENV === 'production';
const isEmulator = process.env.REACT_APP_USE_EMULATOR === 'true';

const PROJECT_ID = isProd ? 'kodacarte-861d8' : 'restaurant-portal-6b147';

/** Base URL for Cloud Functions HTTP endpoints */
const getApiBaseUrl = () => {
  if (isEmulator) {
    const host = process.env.REACT_APP_EMULATOR_HOST || 'localhost';
    const port = process.env.REACT_APP_FUNCTIONS_EMULATOR_PORT || '5001';
    return `http://${host}:${port}/${PROJECT_ID}/us-central1`;
  }
  return `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;
};

/** Base URL of the hosted web app */
const getAppBaseUrl = () => {
  if (isEmulator) return 'http://localhost:3000';
  return `https://${PROJECT_ID}.web.app`;
};

/** Full URL for a restaurant website served by the serveWebsite Cloud Function */
const getWebsiteUrl = (slug) => {
  return `${getApiBaseUrl()}/serveWebsite?restaurant=${slug}`;
};

/** Preview URL for a restaurant website (adds preview flag) */
const getWebsitePreviewUrl = (slug, locationParam = '') => {
  return `${getApiBaseUrl()}/serveWebsite?restaurant=${slug}&preview=true${locationParam}`;
};

/** URL for the widget.js script */
const getWidgetScriptUrl = () => {
  return `${getAppBaseUrl()}/widget.js`;
};

/** Firebase Console URL for the current project */
const getFirebaseConsoleUrl = () => {
  return `https://console.firebase.google.com/project/${PROJECT_ID}/overview`;
};

export {
  PROJECT_ID,
  isProd,
  isEmulator,
  getApiBaseUrl,
  getAppBaseUrl,
  getWebsiteUrl,
  getWebsitePreviewUrl,
  getWidgetScriptUrl,
  getFirebaseConsoleUrl
};
