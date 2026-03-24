/**
 * Offline Service
 * Monitors network connectivity and coordinates between Firestore and LAN relay.
 * Provides a single source of truth for the app's connectivity state.
 */

import lanSyncService from './lanSyncService';

// Connectivity states
export const CONNECTIVITY_STATE = {
  ONLINE: 'online',           // Internet + relay (or internet without relay)
  LAN_ONLY: 'lan_only',       // No internet, relay connected — orders flow locally
  OFFLINE: 'offline'          // No internet, no relay — single device cache only
};

class OfflineService {
  constructor() {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isRelayConnected = false;
    this.listeners = [];
    this.state = this.isOnline ? CONNECTIVITY_STATE.ONLINE : CONNECTIVITY_STATE.OFFLINE;

    this._setupListeners();
  }

  _setupListeners() {
    if (typeof window === 'undefined') return;

    // Browser online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this._updateState();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this._updateState();
    });

    // LAN relay connection changes
    lanSyncService.onConnectionChange(({ connected }) => {
      this.isRelayConnected = connected;
      this._updateState();
    });
  }

  _updateState() {
    let newState;

    if (this.isOnline) {
      newState = CONNECTIVITY_STATE.ONLINE;
    } else if (this.isRelayConnected) {
      newState = CONNECTIVITY_STATE.LAN_ONLY;
    } else {
      newState = CONNECTIVITY_STATE.OFFLINE;
    }

    if (newState !== this.state) {
      const oldState = this.state;
      this.state = newState;
      console.log(`[Offline] State changed: ${oldState} → ${newState}`);
      this._emit({ state: newState, isOnline: this.isOnline, isRelayConnected: this.isRelayConnected });
    }
  }

  /**
   * Get current connectivity state
   */
  getState() {
    return {
      state: this.state,
      isOnline: this.isOnline,
      isRelayConnected: this.isRelayConnected
    };
  }

  /**
   * Check if card payments are available (requires internet)
   */
  canProcessCardPayment() {
    return this.isOnline;
  }

  /**
   * Check if orders can flow between devices
   */
  canSyncOrders() {
    return this.isOnline || this.isRelayConnected;
  }

  /**
   * Subscribe to connectivity state changes
   * Returns unsubscribe function
   */
  onStateChange(callback) {
    this.listeners.push(callback);
    // Immediately emit current state
    callback({ state: this.state, isOnline: this.isOnline, isRelayConnected: this.isRelayConnected });
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  _emit(data) {
    this.listeners.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[Offline] Listener error:', e); }
    });
  }
}

// Singleton
const offlineService = new OfflineService();
export default offlineService;
