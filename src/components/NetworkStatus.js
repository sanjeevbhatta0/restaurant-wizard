import React, { useState, useEffect } from 'react';
import offlineService, { CONNECTIVITY_STATE } from '../services/offlineService';
import './NetworkStatus.css';

/**
 * NetworkStatus — Floating banner showing connectivity state.
 * Shows nothing when fully online, yellow for LAN-only, red for offline.
 */
const NetworkStatus = () => {
  const [networkState, setNetworkState] = useState(offlineService.getState());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unsubscribe = offlineService.onStateChange((state) => {
      setNetworkState(state);
      // Reset dismissed when state changes
      setDismissed(false);
    });
    return unsubscribe;
  }, []);

  // Don't show banner when fully online or when dismissed
  if (networkState.state === CONNECTIVITY_STATE.ONLINE || dismissed) {
    return null;
  }

  const isLanOnly = networkState.state === CONNECTIVITY_STATE.LAN_ONLY;
  const isOffline = networkState.state === CONNECTIVITY_STATE.OFFLINE;

  return (
    <div className={`network-status-banner ${isLanOnly ? 'lan-only' : 'offline'}`}>
      <div className="network-status-content">
        <span className="network-status-icon">
          {isLanOnly ? '🟡' : '🔴'}
        </span>
        <span className="network-status-text">
          {isLanOnly ? (
            <>
              <strong>LAN Only Mode</strong> — No internet connection. Orders are syncing via local network. Card payments unavailable.
            </>
          ) : (
            <>
              <strong>Offline Mode</strong> — No internet or local network. Data is saved locally and will sync when connection returns.
            </>
          )}
        </span>
        <button
          className="network-status-dismiss"
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default NetworkStatus;
