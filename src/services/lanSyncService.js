/**
 * LAN Sync Service
 * WebSocket client that connects to the LAN relay server.
 * Handles order broadcasting, receiving, and auto-reconnection.
 */

const STORAGE_KEY = 'kodaCarte_relayConfig';
const DEFAULT_PORT = 8765;
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 5000;

class LANSyncService {
  constructor() {
    this.ws = null;
    this.listeners = {
      orderReceived: [],
      statusUpdate: [],
      batchUpdate: [],
      sync: [],
      connectionChange: []
    };
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.relayUrl = null;
    this.enabled = false;

    // Load config from localStorage
    this._loadConfig();
  }

  // ==========================================
  // Configuration
  // ==========================================

  _loadConfig() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const config = JSON.parse(stored);
        this.relayUrl = config.relayUrl || null;
        this.enabled = config.enabled || false;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  saveConfig(relayIp, port = DEFAULT_PORT, enabled = true) {
    const relayUrl = `ws://${relayIp}:${port}`;
    this.relayUrl = relayUrl;
    this.enabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        relayUrl,
        relayIp,
        port,
        enabled
      }));
    } catch (e) {
      console.warn('[LANSync] Failed to save config:', e);
    }

    if (enabled) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  getConfig() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : { relayUrl: null, relayIp: '', port: DEFAULT_PORT, enabled: false };
    } catch (e) {
      return { relayUrl: null, relayIp: '', port: DEFAULT_PORT, enabled: false };
    }
  }

  // ==========================================
  // Connection Management
  // ==========================================

  connect(url = null) {
    if (url) {
      this.relayUrl = url;
    }

    if (!this.relayUrl || !this.enabled) {
      return;
    }

    // Don't reconnect if already connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Close existing connection if any
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
    }

    try {
      this.ws = new WebSocket(this.relayUrl);

      this.ws.onopen = () => {
        console.log('[LANSync] Connected to relay:', this.relayUrl);
        this.connected = true;
        this.reconnectAttempts = 0;
        this._startHeartbeat();
        this._emit('connectionChange', { connected: true, relayUrl: this.relayUrl });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this._handleMessage(message);
        } catch (e) {
          console.warn('[LANSync] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[LANSync] Disconnected from relay');
        this.connected = false;
        this._stopHeartbeat();
        this._emit('connectionChange', { connected: false, relayUrl: this.relayUrl });
        this._scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        // Error event fires before close, so just log it
        console.warn('[LANSync] Connection error');
      };
    } catch (err) {
      console.warn('[LANSync] Failed to create WebSocket:', err.message);
      this._scheduleReconnect();
    }
  }

  disconnect() {
    this.enabled = false;
    this.connected = false;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
      this.ws = null;
    }
    this._emit('connectionChange', { connected: false, relayUrl: this.relayUrl });
  }

  _scheduleReconnect() {
    if (!this.enabled) return;

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`[LANSync] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect();
    }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._send({ type: 'PING', payload: { timestamp: Date.now() } });
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ==========================================
  // Message Handling
  // ==========================================

  _handleMessage(message) {
    switch (message.type) {
      case 'ORDER_CREATED':
        this._emit('orderReceived', message.payload);
        break;

      case 'ORDER_UPDATED':
        this._emit('statusUpdate', message.payload);
        break;

      case 'ORDER_BATCH_UPDATE':
        this._emit('batchUpdate', message.payload);
        break;

      case 'ORDER_SYNC':
        this._emit('sync', message.payload);
        break;

      case 'PONG':
        // Heartbeat response — connection is alive
        break;

      default:
        console.log('[LANSync] Unknown message type:', message.type);
    }
  }

  _send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.warn('[LANSync] Failed to send message:', err.message);
        return false;
      }
    }
    return false;
  }

  // ==========================================
  // Public API — Sending
  // ==========================================

  /**
   * Broadcast a new order to all devices via relay
   */
  sendOrder(orderData) {
    return this._send({
      type: 'ORDER_CREATED',
      payload: orderData
    });
  }

  /**
   * Broadcast an order status update to all devices
   */
  sendStatusUpdate(orderId, updates) {
    return this._send({
      type: 'ORDER_UPDATED',
      payload: { orderId, updates, timestamp: Date.now() }
    });
  }

  /**
   * Broadcast a batch status update (e.g., multiple orders paid at once)
   */
  sendBatchUpdate(orderIds, updates) {
    return this._send({
      type: 'ORDER_BATCH_UPDATE',
      payload: { orderIds, updates, timestamp: Date.now() }
    });
  }

  // ==========================================
  // Public API — Listening
  // ==========================================

  /**
   * Register a callback for new orders received from relay
   * Returns an unsubscribe function
   */
  onOrderReceived(callback) {
    this.listeners.orderReceived.push(callback);
    return () => {
      this.listeners.orderReceived = this.listeners.orderReceived.filter(cb => cb !== callback);
    };
  }

  /**
   * Register a callback for order status updates from relay
   * Returns an unsubscribe function
   */
  onStatusUpdate(callback) {
    this.listeners.statusUpdate.push(callback);
    return () => {
      this.listeners.statusUpdate = this.listeners.statusUpdate.filter(cb => cb !== callback);
    };
  }

  /**
   * Register a callback for batch updates from relay
   * Returns an unsubscribe function
   */
  onBatchUpdate(callback) {
    this.listeners.batchUpdate.push(callback);
    return () => {
      this.listeners.batchUpdate = this.listeners.batchUpdate.filter(cb => cb !== callback);
    };
  }

  /**
   * Register a callback for full order sync (on connect)
   * Returns an unsubscribe function
   */
  onSync(callback) {
    this.listeners.sync.push(callback);
    return () => {
      this.listeners.sync = this.listeners.sync.filter(cb => cb !== callback);
    };
  }

  /**
   * Register a callback for connection state changes
   * Returns an unsubscribe function
   */
  onConnectionChange(callback) {
    this.listeners.connectionChange.push(callback);
    // Immediately emit current state
    callback({ connected: this.connected, relayUrl: this.relayUrl });
    return () => {
      this.listeners.connectionChange = this.listeners.connectionChange.filter(cb => cb !== callback);
    };
  }

  // ==========================================
  // State
  // ==========================================

  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  isEnabled() {
    return this.enabled;
  }

  getRelayUrl() {
    return this.relayUrl;
  }

  // ==========================================
  // Internal
  // ==========================================

  _emit(eventType, data) {
    (this.listeners[eventType] || []).forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`[LANSync] Error in ${eventType} listener:`, err);
      }
    });
  }
}

// Singleton instance — shared across all components
const lanSyncService = new LANSyncService();

// Auto-connect on load if previously configured
if (lanSyncService.isEnabled()) {
  // Small delay to let the app initialize
  setTimeout(() => lanSyncService.connect(), 1000);
}

export default lanSyncService;
