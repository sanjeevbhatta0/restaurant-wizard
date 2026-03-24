#!/usr/bin/env node

/**
 * Koda Carte — LAN WebSocket Relay Server
 * 
 * Runs on one device in the restaurant (POS terminal or dedicated device).
 * All POS, Kitchen, and Server devices connect via LAN.
 * Orders and status updates flow through this relay even without internet.
 * 
 * Usage:
 *   node scripts/lan-relay.js
 *   node scripts/lan-relay.js --port 8765
 * 
 * Environment:
 *   PORT — WebSocket port (default: 8765)
 */

const WebSocket = require('ws');
const http = require('http');
const os = require('os');

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port') || process.env.PORT || '8765');

// ==========================================
// In-Memory Order Store
// ==========================================

const orders = new Map(); // orderId -> orderData
const clients = new Set();

// ==========================================
// HTTP Server (for health check)
// ==========================================

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: clients.size,
      orders: orders.size,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// ==========================================
// WebSocket Server
// ==========================================

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  clients.add(ws);
  console.log(`[Relay] Client connected from ${clientIp} (${clients.size} total)`);

  // Send current order state to newly connected client
  ws.send(JSON.stringify({
    type: 'ORDER_SYNC',
    payload: {
      orders: Array.from(orders.values()),
      timestamp: Date.now()
    }
  }));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'ORDER_CREATED': {
          const order = message.payload;
          orders.set(order.id || order.orderNumber, order);
          console.log(`[Relay] Order created: ${order.orderNumber} (Table ${order.tableNumber})`);
          broadcast(ws, message);
          break;
        }

        case 'ORDER_UPDATED': {
          const { orderId, updates } = message.payload;
          const existing = orders.get(orderId);
          if (existing) {
            const updated = { ...existing, ...updates };
            orders.set(orderId, updated);
            console.log(`[Relay] Order ${orderId} → ${updates.status}`);
          } else {
            // Order not in relay yet — store it anyway
            orders.set(orderId, { id: orderId, ...updates });
          }
          broadcast(ws, message);
          break;
        }

        case 'ORDER_BATCH_UPDATE': {
          const { orderIds, updates } = message.payload;
          (orderIds || []).forEach(orderId => {
            const existing = orders.get(orderId);
            if (existing) {
              orders.set(orderId, { ...existing, ...updates });
            }
          });
          console.log(`[Relay] Batch update: ${(orderIds || []).length} orders → ${updates.status}`);
          broadcast(ws, message);
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG', payload: { timestamp: Date.now() } }));
          break;
        }

        default:
          console.log(`[Relay] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error('[Relay] Error processing message:', err.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[Relay] Client disconnected (${clients.size} remaining)`);
  });

  ws.on('error', (err) => {
    console.error('[Relay] WebSocket error:', err.message);
    clients.delete(ws);
  });
});

/**
 * Broadcast message to all connected clients except the sender
 */
function broadcast(sender, message) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// ==========================================
// Cleanup: remove completed orders older than 4 hours
// ==========================================

setInterval(() => {
  const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
  let cleaned = 0;
  orders.forEach((order, key) => {
    if (
      (order.status === 'completed' || order.status === 'reimbursed') &&
      order.updatedAt && new Date(order.updatedAt).getTime() < fourHoursAgo
    ) {
      orders.delete(key);
      cleaned++;
    }
  });
  if (cleaned > 0) {
    console.log(`[Relay] Cleaned ${cleaned} completed orders from memory`);
  }
}, 30 * 60 * 1000); // Every 30 minutes

// ==========================================
// Start Server
// ==========================================

httpServer.listen(PORT, '0.0.0.0', () => {
  // Get LAN IP addresses
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        addresses.push(alias.address);
      }
    }
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       🍽️  Koda Carte LAN Relay Server       ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Port:     ${PORT}                             ║`);
  console.log(`║  Status:   Running                           ║`);
  console.log('║                                              ║');
  console.log('║  Connect devices using:                      ║');
  addresses.forEach(addr => {
    const url = `ws://${addr}:${PORT}`;
    const padded = url + ' '.repeat(Math.max(0, 36 - url.length));
    console.log(`║    ${padded}║`);
  });
  console.log('║                                              ║');
  console.log(`║  Health:   http://localhost:${PORT}/health       ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Relay] Shutting down...');
  wss.clients.forEach(client => client.close());
  httpServer.close(() => {
    console.log('[Relay] Server stopped');
    process.exit(0);
  });
});
