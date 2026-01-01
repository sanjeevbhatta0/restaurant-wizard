/**
 * Wake Lock Service
 * Prevents the device screen from dimming or locking while the app is open
 * Uses the Screen Wake Lock API (supported in Chrome, Edge, Safari 16.4+)
 */

let wakeLock = null;
let isSupported = false;
let onStatusChange = null;

/**
 * Check if Wake Lock API is supported
 */
export const isWakeLockSupported = () => {
  return 'wakeLock' in navigator;
};

/**
 * Request a screen wake lock
 * Keeps the screen on while the app is active
 */
export const requestWakeLock = async () => {
  if (!isWakeLockSupported()) {
    console.warn('Wake Lock API not supported in this browser');
    return false;
  }

  try {
    wakeLock = await navigator.wakeLock.request('screen');
    isSupported = true;
    
    console.log('Screen Wake Lock acquired - screen will stay on');
    
    // Handle wake lock release (happens when tab loses visibility)
    wakeLock.addEventListener('release', () => {
      console.log('Screen Wake Lock released');
      if (onStatusChange) onStatusChange(false);
    });
    
    if (onStatusChange) onStatusChange(true);
    return true;
  } catch (err) {
    console.warn('Wake Lock request failed:', err.message);
    return false;
  }
};

/**
 * Release the wake lock
 */
export const releaseWakeLock = async () => {
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    console.log('Screen Wake Lock manually released');
    if (onStatusChange) onStatusChange(false);
  }
};

/**
 * Check if wake lock is currently active
 */
export const isWakeLockActive = () => {
  return wakeLock !== null && !wakeLock.released;
};

/**
 * Set callback for wake lock status changes
 */
export const setWakeLockStatusCallback = (callback) => {
  onStatusChange = callback;
};

/**
 * Re-acquire wake lock when page becomes visible again
 * Should be called on visibilitychange event
 */
export const handleVisibilityChange = async () => {
  if (document.visibilityState === 'visible' && isSupported && !isWakeLockActive()) {
    console.log('Page visible again, re-acquiring wake lock...');
    await requestWakeLock();
  }
};

/**
 * Initialize wake lock with automatic re-acquisition
 * Call this once when the component mounts
 */
export const initializeWakeLock = async (statusCallback) => {
  if (statusCallback) {
    onStatusChange = statusCallback;
  }
  
  // Request initial wake lock
  const success = await requestWakeLock();
  
  // Set up visibility change listener to re-acquire when tab becomes visible
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  return success;
};

/**
 * Cleanup wake lock and event listeners
 * Call this when the component unmounts
 */
export const cleanupWakeLock = () => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  releaseWakeLock();
};

export default {
  isSupported: isWakeLockSupported,
  request: requestWakeLock,
  release: releaseWakeLock,
  isActive: isWakeLockActive,
  initialize: initializeWakeLock,
  cleanup: cleanupWakeLock,
  setStatusCallback: setWakeLockStatusCallback
};
