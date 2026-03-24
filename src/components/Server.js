import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Container, Card, Button, Badge, Alert, Spinner } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import activityService from '../services/activityService';
import lanSyncService from '../services/lanSyncService';
import { initializeNotifications, notifyServer, unlockAudio } from '../services/notificationService';
import { initializeWakeLock, cleanupWakeLock, isWakeLockSupported } from '../services/wakeLockService';
import useFullscreen from '../hooks/useFullscreen';
import './PageHeader.css';
import './Server.css';

const Server = () => {
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const [orders, setOrders] = useState([]);
  const [claimedOrders, setClaimedOrders] = useState({}); // { orderId: serverId }
  const [loading, setLoading] = useState(true);
  const [updatingOrders, setUpdatingOrders] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Fullscreen mode
  const { isFullscreen, isFullscreenAvailable, toggleFullscreen } = useFullscreen();
  const serverContainerRef = useRef(null);

  // Enable notifications handler (with optional wake lock for tablets)
  const enableNotifications = useCallback(async () => {
    unlockAudio();
    const enabled = await initializeNotifications();
    setNotificationsEnabled(enabled);
    setShowNotificationPrompt(false);

    // Enable wake lock for tablets (optional for servers on mobile)
    if (isWakeLockSupported()) {
      await initializeWakeLock(setWakeLockActive);
    }
  }, []);

  // Cleanup wake lock on unmount
  useEffect(() => {
    return () => {
      cleanupWakeLock();
    };
  }, []);

  // Timer that updates every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load claimed orders from localStorage
  useEffect(() => {
    if (currentUser) {
      const savedClaims = localStorage.getItem(`serverClaims_${currentUser.uid}`);
      if (savedClaims) {
        setClaimedOrders(JSON.parse(savedClaims));
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    // Multi-location but no location selected
    if (isMultiLocation && !selectedLocation) {
      setOrders([]);
      setLoading(false);
      return;
    }

    // Query for orders that are preparing or ready
    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);

    // Build query with consistent locationId filtering
    let q;
    try {
      if (isMultiLocation && selectedLocation) {
        q = query(
          ordersRef,
          where('locationId', '==', selectedLocation),
          where('status', 'in', ['preparing', 'ready']),
          orderBy('createdAt', 'asc')
        );
      } else {
        // Single-location: filter by currentUser.uid (matches what POS sets)
        q = query(
          ordersRef,
          where('locationId', '==', currentUser.uid),
          where('status', 'in', ['preparing', 'ready']),
          orderBy('createdAt', 'asc')
        );
      }
    } catch (queryError) {
      console.error('Error building query:', queryError);
      // Fallback: try query without orderBy if index is missing
      try {
        if (isMultiLocation && selectedLocation) {
          q = query(
            ordersRef,
            where('locationId', '==', selectedLocation),
            where('status', 'in', ['preparing', 'ready'])
          );
        } else {
          q = query(
            ordersRef,
            where('locationId', '==', currentUser.uid),
            where('status', 'in', ['preparing', 'ready'])
          );
        }
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError);
        setLoading(false);
        return;
      }
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by createdAt manually if orderBy wasn't used in query
      ordersData.sort((a, b) => {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return aTime - bTime; // Oldest first
      });

      setOrders(prevOrders => {
        // Track status changes for notifications
        ordersData.forEach(order => {
          const existingOrder = prevOrders.find(o => o.id === order.id);
          if (existingOrder && existingOrder.status !== order.status) {
            // Status changed - add notification
            if (order.status === 'preparing' && existingOrder.status !== 'preparing') {
              addNotification(`Order #${order.orderNumber || order.id} for Table ${formatTableNumber(order.tableNumber)} is now being prepared`, 'info');
              // Play audio notification
              notifyServer.orderPreparing(order.orderNumber || order.id, order.tableNumber);
            }
            if (order.status === 'ready' && existingOrder.status !== 'ready') {
              const savedClaims = localStorage.getItem(`serverClaims_${currentUser.uid}`);
              const claims = savedClaims ? JSON.parse(savedClaims) : {};
              const isClaimed = claims[order.id] === currentUser.uid;
              if (isClaimed) {
                addNotification(`Order #${order.orderNumber || order.id} for Table ${formatTableNumber(order.tableNumber)} is READY!`, 'success', true);
              } else {
                addNotification(`Order #${order.orderNumber || order.id} for Table ${formatTableNumber(order.tableNumber)} is ready`, 'warning');
              }
              // Play audio notification for ready orders
              notifyServer.orderReady(order.orderNumber || order.id, order.tableNumber);
            }
          }
        });
        return ordersData;
      });
      setLoading(false);
    }, (error) => {
      console.error('Error fetching orders:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      // Check if it's an index error
      if (error.code === 'failed-precondition') {
        console.error('Missing Firestore index. Create index with:', {
          collection: `restaurants/${currentUser.uid}/orders`,
          fields: [
            { fieldPath: 'locationId', order: 'ASCENDING' },
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'ASCENDING' }
          ]
        });
      }
      setLoading(false);
    });

    // LAN Relay listeners — receive orders/updates from other devices even when offline
    const unsubRelayOrder = lanSyncService.onOrderReceived((order) => {
      setOrders(prev => {
        const exists = prev.find(o => o.id === order.id || o.orderNumber === order.orderNumber);
        if (exists) return prev;
        const serverStatuses = ['preparing', 'ready'];
        if (!serverStatuses.includes(order.status)) return prev;
        return [...prev, order].sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
          return aTime - bTime;
        });
      });
    });

    const unsubRelayStatus = lanSyncService.onStatusUpdate(({ orderId, updates }) => {
      setOrders(prev => {
        const serverStatuses = ['preparing', 'ready'];
        return prev.map(order => {
          if (order.id === orderId) {
            const updated = { ...order, ...updates };
            if (!serverStatuses.includes(updated.status)) return null;
            return updated;
          }
          return order;
        }).filter(Boolean);
      });
    });

    const unsubRelaySync = lanSyncService.onSync(({ orders: relayOrders }) => {
      if (relayOrders && relayOrders.length > 0) {
        setOrders(prev => {
          const serverStatuses = ['preparing', 'ready'];
          const relayServerOrders = relayOrders.filter(o => serverStatuses.includes(o.status));
          const merged = [...prev];
          relayServerOrders.forEach(ro => {
            if (!merged.find(o => o.id === ro.id || o.orderNumber === ro.orderNumber)) {
              merged.push(ro);
            }
          });
          return merged.sort((a, b) => {
            const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return aTime - bTime;
          });
        });
      }
    });

    return () => {
      unsubscribe();
      unsubRelayOrder();
      unsubRelayStatus();
      unsubRelaySync();
    };
  }, [currentUser, selectedLocation, isMultiLocation]);

  const addNotification = (message, type = 'info', urgent = false) => {
    const notification = {
      id: Date.now(),
      message,
      type,
      urgent,
      timestamp: new Date()
    };
    setNotifications(prev => [notification, ...prev].slice(0, 5)); // Keep last 5

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };

  const claimOrder = (orderId) => {
    const newClaims = { ...claimedOrders, [orderId]: currentUser.uid };
    setClaimedOrders(newClaims);
    localStorage.setItem(`serverClaims_${currentUser.uid}`, JSON.stringify(newClaims));
    addNotification('Order claimed successfully', 'success');
  };

  const unclaimOrder = (orderId) => {
    const newClaims = { ...claimedOrders };
    delete newClaims[orderId];
    setClaimedOrders(newClaims);
    localStorage.setItem(`serverClaims_${currentUser.uid}`, JSON.stringify(newClaims));
    addNotification('Order unclaimed', 'info');
  };

  const markAsPicked = async (orderId) => {
    setUpdatingOrders(prev => new Set(prev).add(orderId));
    try {
      const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${orderId}`);

      // Get order data for activity logging
      const order = orders.find(o => o.id === orderId);

      await updateDoc(orderRef, {
        status: 'served',
        updatedAt: new Date(),
        servedAt: new Date()
      });

      // Broadcast status change via LAN relay
      lanSyncService.sendStatusUpdate(orderId, {
        status: 'served',
        updatedAt: new Date(),
        servedAt: new Date()
      });

      // Log activity
      if (order) {
        const tableNumber = Array.isArray(order.tableNumber)
          ? order.tableNumber.join(' and ')
          : order.tableNumber;
        await activityService.logOrderActivity(currentUser.uid, 'status_changed', {
          orderNumber: order.orderNumber || orderId,
          orderId: orderId,
          tableNumber: tableNumber || 'N/A',
          status: 'served',
          locationId: order.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
        });
      }

      addNotification('Order marked as served', 'success');

      // Remove from claimed orders
      const newClaims = { ...claimedOrders };
      delete newClaims[orderId];
      setClaimedOrders(newClaims);
      localStorage.setItem(`serverClaims_${currentUser.uid}`, JSON.stringify(newClaims));
    } catch (error) {
      console.error('Error updating order status:', error);
      addNotification('Failed to update order: ' + error.message, 'danger');
    } finally {
      setUpdatingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    }
  };

  const formatTableNumber = (tableNumber) => {
    if (Array.isArray(tableNumber)) {
      return tableNumber.join(', ');
    }
    return tableNumber || 'N/A';
  };

  // Format order type for display
  const getOrderTypeInfo = (orderType) => {
    switch (orderType) {
      case 'dine_in':
        return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
      case 'pickup':
        return { label: 'Pickup', icon: 'bi-bag-check', variant: 'success' };
      case 'delivery':
        return { label: 'Delivery', icon: 'bi-truck', variant: 'warning' };
      default:
        return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
    }
  };

  const getTimeInStatus = (order) => {
    let startTime;
    if (order.status === 'ready' && order.readyAt) {
      startTime = order.readyAt.toDate ? order.readyAt.toDate() : new Date(order.readyAt);
    } else if (order.status === 'preparing') {
      // For preparing, check if there's an updatedAt timestamp, otherwise use createdAt
      if (order.updatedAt) {
        startTime = order.updatedAt.toDate ? order.updatedAt.toDate() : new Date(order.updatedAt);
      } else if (order.createdAt) {
        startTime = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      } else {
        return { minutes: 0, seconds: 0 };
      }
    } else if (order.createdAt) {
      startTime = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
    } else {
      return { minutes: 0, seconds: 0 };
    }

    const diffMs = currentTime - startTime;
    const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return { minutes, seconds };
  };

  // Separate orders into claimed and unclaimed
  const myClaimedOrders = orders.filter(order => claimedOrders[order.id] === currentUser.uid);
  const unclaimedOrders = orders.filter(order => !claimedOrders[order.id]);
  const readyClaimedOrders = myClaimedOrders.filter(order => order.status === 'ready');

  // Show warning if multi-location but no location selected
  if (isMultiLocation && !selectedLocation && !loading) {
    return (
      <Container className="py-4">
        <div className="page-header-gradient">
          <div className="header-content">
            <i className="bi bi-person-badge header-icon"></i>
            <div>
              <h2>Server</h2>
              <p>Track and serve orders</p>
            </div>
          </div>
        </div>
        <Alert variant="warning" className="mt-4">
          <i className="bi bi-exclamation-triangle"></i> Please select a location to view server orders.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className={`server-container ${isFullscreen ? 'fullscreen-mode' : ''}`} ref={serverContainerRef}>
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-person-badge header-icon"></i>
          <div>
            <h2>Server</h2>
            <p>Track and serve orders</p>
          </div>
        </div>
        {/* Notification and wake lock status */}
        <div className="notification-status d-flex gap-2 align-items-center">
          {wakeLockActive && (
            <Badge bg="info" className="notification-badge">
              <i className="bi bi-display"></i> Screen On
            </Badge>
          )}
          {notificationsEnabled ? (
            <Badge bg="success" className="notification-badge">
              <i className="bi bi-bell-fill"></i> Alerts + Vibration
            </Badge>
          ) : showNotificationPrompt ? (
            <Button
              variant="warning"
              size="sm"
              onClick={enableNotifications}
              className="enable-notifications-btn"
            >
              <i className="bi bi-phone-vibrate"></i> Enable Alerts
            </Button>
          ) : (
            <Badge bg="secondary" className="notification-badge">
              <i className="bi bi-bell-slash"></i> Alerts Off
            </Badge>
          )}
        </div>
        {/* Fullscreen Toggle */}
        {isFullscreenAvailable && (
          <Button
            variant={isFullscreen ? "light" : "outline-light"}
            size="sm"
            onClick={() => toggleFullscreen(serverContainerRef.current)}
            className="ms-2"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
            {isFullscreen ? ' Exit' : ' Fullscreen'}
          </Button>
        )}
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="server-notifications">
          {notifications.map(notification => (
            <Alert
              key={notification.id}
              variant={notification.type}
              className={`server-notification ${notification.urgent ? 'urgent' : ''}`}
              dismissible
              onClose={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
            >
              <i className={`bi bi-${notification.urgent ? 'bell-fill' : 'info-circle'}`}></i> {notification.message}
            </Alert>
          ))}
        </div>
      )}

      {loading ? (
        <div className="server-loading">
          <Spinner animation="border" variant="primary" />
          <p>Loading orders...</p>
        </div>
      ) : (
        <>
          {/* Ready Orders - Claimed by Me (Red/Urgent) */}
          {readyClaimedOrders.length > 0 && (
            <div className="server-section">
              <h3 className="section-title urgent-title">
                <i className="bi bi-exclamation-triangle-fill"></i> Ready for Pickup
              </h3>
              <div className="server-orders-grid">
                {readyClaimedOrders.map(order => {
                  const isUpdating = updatingOrders.has(order.id);
                  const timeInStatus = getTimeInStatus(order);
                  const orderTypeInfo = getOrderTypeInfo(order.orderType);
                  const isWebsiteOrder = order.source === 'website' || order.orderType === 'pickup' || order.orderType === 'delivery';

                  return (
                    <Card key={order.id} className="server-order-card urgent-card">
                      <Card.Header className="server-order-header urgent-header">
                        <div className="order-header-top">
                          <div className="order-badges">
                            <Badge bg="danger" className="order-status-badge">READY</Badge>
                            <Badge bg={orderTypeInfo.variant} className="order-type-badge">
                              <i className={`bi ${orderTypeInfo.icon}`}></i> {orderTypeInfo.label}
                            </Badge>
                            <span className="order-number">#{order.orderNumber || order.id}</span>
                          </div>
                          <div className="order-timer urgent-timer">
                            <i className="bi bi-clock"></i>
                            <span>{String(timeInStatus.minutes).padStart(2, '0')}:{String(timeInStatus.seconds).padStart(2, '0')}</span>
                          </div>
                        </div>
                        <div className="order-header-bottom">
                          {isWebsiteOrder && order.customer ? (
                            <span className="customer-info">
                              <i className="bi bi-person"></i>
                              {order.customer.name} {order.customer.phone && `• ${order.customer.phone}`}
                            </span>
                          ) : (
                            <span className="table-info">
                              <i className="bi bi-table"></i>
                              Table: {formatTableNumber(order.tableNumber)}
                            </span>
                          )}
                        </div>
                      </Card.Header>
                      <Card.Body>
                        <div className="order-items">
                          <h6 className="items-title">Items:</h6>
                          <ul className="items-list">
                            {order.items && order.items.map((item, index) => (
                              <li key={index} className="order-item">
                                <span className="item-quantity">{item.quantity}x</span>
                                <span className="item-name">{item.name}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="order-total">
                          <strong>Total: ${order.total?.toFixed(2) || '0.00'}</strong>
                        </div>
                      </Card.Body>
                      <Card.Footer className="server-order-footer">
                        <Button
                          variant="success"
                          className="server-action-button"
                          onClick={() => markAsPicked(order.id)}
                          disabled={isUpdating}
                        >
                          {isUpdating ? (
                            <>
                              <Spinner animation="border" size="sm" /> Updating...
                            </>
                          ) : (
                            <>
                              <i className="bi bi-check-circle"></i> Mark as Served
                            </>
                          )}
                        </Button>
                      </Card.Footer>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* My Claimed Orders (Preparing) */}
          {myClaimedOrders.filter(order => order.status === 'preparing').length > 0 && (
            <div className="server-section">
              <h3 className="section-title">
                <i className="bi bi-person-check"></i> My Claimed Orders
              </h3>
              <div className="server-orders-grid">
                {myClaimedOrders.filter(order => order.status === 'preparing').map(order => {
                  const timeInStatus = getTimeInStatus(order);
                  const orderTypeInfo = getOrderTypeInfo(order.orderType);
                  const isWebsiteOrder = order.source === 'website' || order.orderType === 'pickup' || order.orderType === 'delivery';

                  return (
                    <Card key={order.id} className="server-order-card claimed-card">
                      <Card.Header className="server-order-header">
                        <div className="order-header-top">
                          <div className="order-badges">
                            <Badge bg="warning" className="order-status-badge">Preparing</Badge>
                            <Badge bg={orderTypeInfo.variant} className="order-type-badge">
                              <i className={`bi ${orderTypeInfo.icon}`}></i> {orderTypeInfo.label}
                            </Badge>
                            <span className="order-number">#{order.orderNumber || order.id}</span>
                          </div>
                          <div className="order-timer">
                            <i className="bi bi-clock"></i>
                            <span>{String(timeInStatus.minutes).padStart(2, '0')}:{String(timeInStatus.seconds).padStart(2, '0')}</span>
                          </div>
                        </div>
                        <div className="order-header-bottom">
                          {isWebsiteOrder && order.customer ? (
                            <span className="customer-info">
                              <i className="bi bi-person"></i>
                              {order.customer.name}
                            </span>
                          ) : (
                            <span className="table-info">
                              <i className="bi bi-table"></i>
                              Table: {formatTableNumber(order.tableNumber)}
                            </span>
                          )}
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => unclaimOrder(order.id)}
                            className="unclaim-btn"
                          >
                            <i className="bi bi-x-circle"></i> Unclaim
                          </Button>
                        </div>
                      </Card.Header>
                      <Card.Body>
                        <div className="order-items">
                          <h6 className="items-title">Items:</h6>
                          <ul className="items-list">
                            {order.items && order.items.map((item, index) => (
                              <li key={index} className="order-item">
                                <span className="item-quantity">{item.quantity}x</span>
                                <span className="item-name">{item.name}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="order-total">
                          <strong>Total: ${order.total?.toFixed(2) || '0.00'}</strong>
                        </div>
                      </Card.Body>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available Orders */}
          {unclaimedOrders.length > 0 && (
            <div className="server-section">
              <h3 className="section-title">
                <i className="bi bi-list-ul"></i> Available Orders
              </h3>
              <div className="server-orders-grid">
                {unclaimedOrders.map(order => {
                  const isClaimed = claimedOrders[order.id] === currentUser.uid;
                  const timeInStatus = getTimeInStatus(order);
                  const orderTypeInfo = getOrderTypeInfo(order.orderType);
                  const isWebsiteOrder = order.source === 'website' || order.orderType === 'pickup' || order.orderType === 'delivery';

                  return (
                    <Card key={order.id} className={`server-order-card ${order.status === 'ready' ? 'ready-unclaimed' : ''}`}>
                      <Card.Header className={`server-order-header ${order.status === 'ready' ? 'ready-header' : ''}`}>
                        <div className="order-header-top">
                          <div className="order-badges">
                            <Badge bg={order.status === 'ready' ? 'success' : 'warning'} className="order-status-badge">
                              {order.status === 'ready' ? 'Ready' : 'Preparing'}
                            </Badge>
                            <Badge bg={orderTypeInfo.variant} className="order-type-badge">
                              <i className={`bi ${orderTypeInfo.icon}`}></i> {orderTypeInfo.label}
                            </Badge>
                            <span className="order-number">#{order.orderNumber || order.id}</span>
                          </div>
                          <div className="order-timer">
                            <i className="bi bi-clock"></i>
                            <span>{String(timeInStatus.minutes).padStart(2, '0')}:{String(timeInStatus.seconds).padStart(2, '0')}</span>
                          </div>
                        </div>
                        <div className="order-header-bottom">
                          {isWebsiteOrder && order.customer ? (
                            <span className="customer-info">
                              <i className="bi bi-person"></i>
                              {order.customer.name} {order.customer.phone && `• ${order.customer.phone}`}
                            </span>
                          ) : (
                            <span className="table-info">
                              <i className="bi bi-table"></i>
                              Table: {formatTableNumber(order.tableNumber)}
                            </span>
                          )}
                        </div>
                      </Card.Header>
                      <Card.Body>
                        <div className="order-items">
                          <h6 className="items-title">Items:</h6>
                          <ul className="items-list">
                            {order.items && order.items.map((item, index) => (
                              <li key={index} className="order-item">
                                <span className="item-quantity">{item.quantity}x</span>
                                <span className="item-name">{item.name}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="order-total">
                          <strong>Total: ${order.total?.toFixed(2) || '0.00'}</strong>
                        </div>
                      </Card.Body>
                      <Card.Footer className="server-order-footer">
                        {order.status === 'ready' ? (
                          <Button
                            variant="success"
                            className="server-action-button"
                            onClick={() => {
                              claimOrder(order.id);
                              markAsPicked(order.id);
                            }}
                            disabled={updatingOrders.has(order.id)}
                          >
                            {updatingOrders.has(order.id) ? (
                              <>
                                <Spinner animation="border" size="sm" /> Updating...
                              </>
                            ) : (
                              <>
                                <i className="bi bi-check-circle"></i> Claim & Mark Served
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            className="server-action-button"
                            onClick={() => claimOrder(order.id)}
                          >
                            <i className="bi bi-hand-thumbs-up"></i> Claim Order
                          </Button>
                        )}
                      </Card.Footer>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {orders.length === 0 && (
            <div className="server-empty">
              <i className="bi bi-inbox"></i>
              <h3>No Active Orders</h3>
              <p>Orders will appear here when kitchen starts preparing them</p>
            </div>
          )}
        </>
      )}
    </Container>
  );
};

export default Server;
