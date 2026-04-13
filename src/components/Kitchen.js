import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Card, Button, Badge, Alert, Spinner } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import activityService from '../services/activityService';
import lanSyncService from '../services/lanSyncService';
import { initializeNotifications, notifyKitchen, unlockAudio } from '../services/notificationService';
import { initializeWakeLock, cleanupWakeLock, isWakeLockSupported } from '../services/wakeLockService';
import useFullscreen from '../hooks/useFullscreen';
import './PageHeader.css';
import './Kitchen.css';

const Kitchen = () => {
  const { currentUser, restaurantUid } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingOrders, setUpdatingOrders] = useState(new Set());
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Fullscreen mode
  const { isFullscreen, isFullscreenAvailable, toggleFullscreen } = useFullscreen();
  const kitchenContainerRef = useRef(null);

  // Track previous order IDs to detect new orders
  const prevOrderIds = useRef(new Set());
  const isInitialLoad = useRef(true);

  // Enable notifications and wake lock handler
  const enableNotifications = useCallback(async () => {
    unlockAudio(); // Unlock audio on user interaction
    const enabled = await initializeNotifications();
    setNotificationsEnabled(enabled);
    setShowNotificationPrompt(false);

    // Also enable wake lock to keep screen on
    if (isWakeLockSupported()) {
      const wakeLockEnabled = await initializeWakeLock(setWakeLockActive);
      if (wakeLockEnabled) {
        console.log('Kitchen: Screen will stay on');
      }
    }

    if (enabled) {
      console.log('Kitchen notifications enabled!');
    }
  }, []);

  // Cleanup wake lock on unmount
  useEffect(() => {
    return () => {
      cleanupWakeLock();
    };
  }, []);

  useEffect(() => {
    if (!currentUser || !restaurantUid) return;

    // Multi-location but no location selected
    if (isMultiLocation && !selectedLocation) {
      setOrders([]);
      setLoading(false);
      return;
    }

    // Query for orders that are new (from website), sent to kitchen, or being prepared
    const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);

    // Build query based on location
    // Note: For single-location, we still filter by locationId (restaurantUid) to ensure consistency
    // Include 'new' status to capture website orders
    let q;
    try {
      if (isMultiLocation && selectedLocation) {
        // Multi-location: filter by selected location
        q = query(
          ordersRef,
          where('locationId', '==', selectedLocation),
          where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready']),
          orderBy('createdAt', 'asc') // Oldest first (FIFO)
        );
      } else {
        // Single-location: filter by restaurantUid (which is what POS sets as locationId)
        // This ensures consistency between POS and Kitchen
        q = query(
          ordersRef,
          where('locationId', '==', restaurantUid),
          where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready']),
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
            where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready'])
          );
        } else {
          q = query(
            ordersRef,
            where('locationId', '==', restaurantUid),
            where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready'])
          );
        }
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError);
        setError('Failed to load orders. Please check Firestore indexes.');
        setLoading(false);
        return;
      }
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort by createdAt manually if orderBy wasn't used
      ordersData.sort((a, b) => {
        const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return aTime - bTime; // Oldest first
      });

      // Filter: only show 'ready' orders in kitchen if they were paid at POS
      // (regular dine-in 'ready' orders belong to Server view)
      const filteredOrders = ordersData.filter(order => {
        if (order.status === 'ready' && !order.paidAtPOS) return false;
        return true;
      });

      // Detect new orders and trigger notifications
      if (!isInitialLoad.current) {
        const currentOrderIds = new Set(filteredOrders.map(o => o.id));

        // Find new orders (in current but not in previous)
        filteredOrders.forEach(order => {
          if (!prevOrderIds.current.has(order.id)) {
            // New order detected!
            console.log('New order detected:', order.orderNumber || order.id);
            notifyKitchen.newOrder(
              order.orderNumber || order.id,
              order.orderType || 'dine_in',
              order.source || 'pos'
            );
          }
        });

        prevOrderIds.current = currentOrderIds;
      } else {
        // Initial load - just record the IDs without notifying
        prevOrderIds.current = new Set(filteredOrders.map(o => o.id));
        isInitialLoad.current = false;
      }

      setOrders(filteredOrders);
      setLoading(false);
      setError(''); // Clear any previous errors
    }, (error) => {
      console.error('Error fetching orders:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      // Check if it's an index error
      if (error.code === 'failed-precondition') {
        // Extract index link from error message if available
        const indexLinkMatch = error.message?.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
        const indexLink = indexLinkMatch ? indexLinkMatch[0] : null;

        if (indexLink) {
          console.error('Missing Firestore index. Click here to create it:', indexLink);
          setError(`Firestore index required. Click this link to create it: ${indexLink} (Also check browser console)`);
        } else {
          setError('Firestore index required. Please create the composite index for orders query. Check console for details.');
          console.error('Missing Firestore index. Create index with:', {
            collection: `restaurants/${restaurantUid}/orders`,
            fields: [
              { fieldPath: 'locationId', order: 'ASCENDING' },
              { fieldPath: 'status', order: 'ASCENDING' },
              { fieldPath: 'createdAt', order: 'ASCENDING' }
            ]
          });
          console.error('To deploy via CLI, run: firebase deploy --only firestore:indexes');
        }
      } else {
        setError('Failed to load orders: ' + error.message);
      }
      setLoading(false);
    });

    // LAN Relay listeners — receive orders from other devices even when offline
    const unsubRelayOrder = lanSyncService.onOrderReceived((order) => {
      setOrders(prev => {
        // Only add if not already present and status matches kitchen view
        const exists = prev.find(o => o.id === order.id || o.orderNumber === order.orderNumber);
        if (exists) return prev;
        const kitchenStatuses = ['new', 'sent_to_kitchen', 'preparing', 'ready'];
        if (!kitchenStatuses.includes(order.status)) return prev;
        const sorted = [...prev, order].sort((a, b) => {
          const aTime = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
          const bTime = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
          return aTime - bTime;
        });
        return sorted;
      });
    });

    const unsubRelayStatus = lanSyncService.onStatusUpdate(({ orderId, updates }) => {
      setOrders(prev => prev.map(order => {
        if (order.id === orderId) {
          const updated = { ...order, ...updates };
          // Remove from kitchen view if no longer in kitchen statuses
          const kitchenStatuses = ['new', 'sent_to_kitchen', 'preparing', 'ready'];
          if (!kitchenStatuses.includes(updated.status)) return null;
          return updated;
        }
        return order;
      }).filter(Boolean));
    });

    const unsubRelaySync = lanSyncService.onSync(({ orders: relayOrders }) => {
      if (relayOrders && relayOrders.length > 0) {
        setOrders(prev => {
          const kitchenStatuses = ['new', 'sent_to_kitchen', 'preparing', 'ready'];
          const relayKitchenOrders = relayOrders.filter(o => kitchenStatuses.includes(o.status));
          const merged = [...prev];
          relayKitchenOrders.forEach(ro => {
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
  }, [currentUser, restaurantUid, selectedLocation, isMultiLocation]);

  const handleStatusChange = async (orderId, newStatus) => {
    setUpdatingOrders(prev => new Set(prev).add(orderId));
    try {
      const orderRef = doc(db, `restaurants/${restaurantUid}/orders/${orderId}`);

      // Get order data for activity logging
      const order = orders.find(o => o.id === orderId);

      const updateData = {
        status: newStatus,
        updatedAt: new Date()
      };

      // Set readyAt timestamp when marking as ready
      if (newStatus === 'ready') {
        updateData.readyAt = new Date();
      }

      await updateDoc(orderRef, updateData);

      // Broadcast status change via LAN relay
      lanSyncService.sendStatusUpdate(orderId, updateData);

      // Log activity
      if (order) {
        const tableNumber = Array.isArray(order.tableNumber)
          ? order.tableNumber.join(' and ')
          : order.tableNumber;
        await activityService.logOrderActivity(restaurantUid, 'status_changed', {
          orderNumber: order.orderNumber || orderId,
          orderId: orderId,
          tableNumber: tableNumber || 'N/A',
          status: newStatus,
          locationId: order.locationId || (isMultiLocation && selectedLocation ? selectedLocation : restaurantUid)
        });
      }
    } catch (error) {
      console.error('Error updating order status:', error);
      setError('Failed to update order status: ' + error.message);
    } finally {
      setUpdatingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return '1 hour ago';
    return `${diffHours} hours ago`;
  };

  const formatTableNumber = (tableNumber) => {
    if (Array.isArray(tableNumber)) {
      return tableNumber.join(', ');
    }
    return tableNumber || 'N/A';
  };

  // Handle "Order Picked Up" for pay-first orders (marks as completed directly)
  const handleOrderPickedUp = async (orderId) => {
    setUpdatingOrders(prev => new Set(prev).add(orderId));
    try {
      const orderRef = doc(db, `restaurants/${restaurantUid}/orders/${orderId}`);
      const order = orders.find(o => o.id === orderId);

      const updateData = {
        status: 'completed',
        pickedUpAt: new Date(),
        completedAt: new Date(),
        updatedAt: new Date()
      };

      await updateDoc(orderRef, updateData);
      lanSyncService.sendStatusUpdate(orderId, updateData);

      if (order) {
        const tableNumber = Array.isArray(order.tableNumber)
          ? order.tableNumber.join(' and ')
          : order.tableNumber;
        await activityService.logOrderActivity(restaurantUid, 'picked_up', {
          orderNumber: order.orderNumber || orderId,
          orderId: orderId,
          tableNumber: tableNumber || 'Counter',
          status: 'completed',
          locationId: order.locationId || (isMultiLocation && selectedLocation ? selectedLocation : restaurantUid)
        });
      }
    } catch (error) {
      console.error('Error completing order:', error);
      setError('Failed to complete order: ' + error.message);
    } finally {
      setUpdatingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    }
  };

  // Format order type for display
  const getOrderTypeInfo = (orderType) => {
    switch (orderType) {
      case 'dine_in':
        return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
      case 'counter':
        return { label: 'Counter', icon: 'bi-shop', variant: 'primary' };
      case 'pickup':
        return { label: 'Pickup', icon: 'bi-bag-check', variant: 'success' };
      case 'delivery':
        return { label: 'Delivery', icon: 'bi-truck', variant: 'warning' };
      default:
        return { label: 'Dine-In', icon: 'bi-cup-hot', variant: 'info' };
    }
  };

  // Show warning if multi-location but no location selected
  if (isMultiLocation && !selectedLocation && !loading) {
    return (
      <Container className="py-4">
        <div className="page-header-gradient">
          <div className="header-content">
            <i className="bi bi-egg-fried header-icon"></i>
            <div>
              <h2>Kitchen</h2>
              <p>Manage orders from the kitchen</p>
            </div>
          </div>
        </div>
        <Alert variant="warning" className="mt-4">
          <i className="bi bi-exclamation-triangle"></i> Please select a location to view kitchen orders.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className={`kitchen-container ${isFullscreen ? 'fullscreen-mode' : ''}`} ref={kitchenContainerRef}>
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-egg-fried header-icon"></i>
          <div>
            <h2>Kitchen</h2>
            <p>Manage orders from the kitchen</p>
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
              <i className="bi bi-bell-fill"></i> Alerts On
            </Badge>
          ) : showNotificationPrompt ? (
            <Button
              variant="warning"
              size="sm"
              onClick={enableNotifications}
              className="enable-notifications-btn"
            >
              <i className="bi bi-bell"></i> Enable Alerts & Keep Screen On
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
            onClick={() => toggleFullscreen(kitchenContainerRef.current)}
            className="ms-2"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
            {isFullscreen ? ' Exit' : ' Fullscreen'}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="danger" className="mt-4" onClose={() => setError('')} dismissible>
          <i className="bi bi-exclamation-triangle"></i> {error}
        </Alert>
      )}

      {loading ? (
        <div className="kitchen-loading">
          <Spinner animation="border" variant="primary" />
          <p>Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="kitchen-empty">
          <i className="bi bi-inbox"></i>
          <h3>No Orders</h3>
          <p>Orders sent from POS will appear here automatically</p>
        </div>
      ) : (
        <div className="kitchen-orders-grid">
          {orders.map(order => {
            const isUpdating = updatingOrders.has(order.id);
            const isPreparing = order.status === 'preparing';
            const isReady = order.status === 'ready';
            const orderTypeInfo = getOrderTypeInfo(order.orderType);
            const isWebsiteOrder = order.source === 'website' || order.orderType === 'pickup' || order.orderType === 'delivery';
            const isCounterOrder = order.paidAtPOS || order.orderType === 'counter';

            return (
              <Card key={order.id} className={`kitchen-order-card ${isPreparing ? 'preparing' : ''} ${isReady ? 'ready-pickup' : ''}`}>
                <Card.Header className="kitchen-order-header">
                  <div className="order-header-top">
                    <div className="order-badges">
                      <Badge bg={isReady ? 'success' : isPreparing ? 'warning' : 'primary'} className="order-status-badge">
                        {isReady ? 'Ready for Pickup' : isPreparing ? 'Preparing' : 'New Order'}
                      </Badge>
                      <Badge bg={orderTypeInfo.variant} className="order-type-badge">
                        <i className={`bi ${orderTypeInfo.icon}`}></i> {orderTypeInfo.label}
                      </Badge>
                      {order.paidAtPOS && (
                        <Badge bg="success" className="paid-badge">
                          <i className="bi bi-check-circle"></i> PAID
                        </Badge>
                      )}
                      <span className={`order-number ${isCounterOrder ? 'order-number-prominent' : ''}`}>
                        #{order.orderNumber || order.id}
                      </span>
                    </div>
                    <div className="order-time">
                      <i className="bi bi-clock"></i>
                      <span>{formatTime(order.createdAt)}</span>
                      <small className="time-ago">{getTimeAgo(order.createdAt)}</small>
                    </div>
                  </div>
                  <div className="order-header-bottom">
                    {isWebsiteOrder && order.customer ? (
                      <span className="customer-info">
                        <i className="bi bi-person"></i>
                        {order.customer.name} {order.customer.phone && `• ${order.customer.phone}`}
                      </span>
                    ) : isCounterOrder && !order.tableNumber ? (
                      <span className="counter-info">
                        <i className="bi bi-shop"></i>
                        Counter Order
                        {order.paymentDetails && ` • ${order.paymentDetails.paymentMethod === 'card' ? 'Card' : 'Cash'}`}
                      </span>
                    ) : (
                      <span className="table-info">
                        <i className="bi bi-table"></i>
                        Table: {formatTableNumber(order.tableNumber)}
                      </span>
                    )}
                    {order.orderType === 'delivery' && order.deliveryAddress && (
                      <span className="pickup-time" title={order.deliveryAddress.fullAddress}>
                        <i className="bi bi-geo-alt"></i>
                        {(order.deliveryAddress.fullAddress || '').substring(0, 30)}...
                      </span>
                    )}
                    {order.orderType !== 'delivery' && order.pickupTime && (
                      <span className="pickup-time">
                        <i className="bi bi-clock-history"></i>
                        Pickup: {order.pickupTime}
                      </span>
                    )}
                  </div>
                </Card.Header>
                <Card.Body>
                  {/* Delivery driver status */}
                  {order.orderType === 'delivery' && order.doordash && (
                    <div style={{
                      padding: '8px 12px', marginBottom: '10px',
                      background: '#e3f2fd', borderRadius: '8px', fontSize: '0.85rem'
                    }}>
                      <i className="bi bi-truck" style={{ marginRight: '4px' }}></i>
                      <strong>
                        {order.doordash.deliveryStatus === 'driver_assigned' || order.doordash.deliveryStatus === 'driver_enroute_pickup'
                          ? 'Driver on the way to pick up'
                          : order.doordash.deliveryStatus === 'driver_at_pickup'
                          ? 'Driver is here!'
                          : order.doordash.deliveryStatus === 'picked_up' || order.doordash.deliveryStatus === 'driver_enroute_dropoff'
                          ? 'Out for delivery'
                          : order.doordash.deliveryStatus === 'awaiting_driver'
                          ? 'Awaiting DoorDash driver'
                          : order.doordash.deliveryStatus || 'Delivery dispatched'}
                      </strong>
                      {order.doordash.dasherName && <span style={{ marginLeft: '8px' }}>({order.doordash.dasherName})</span>}
                    </div>
                  )}
                  <div className="order-items">
                    <h6 className="items-title">Items:</h6>
                    <ul className="items-list">
                      {order.items && order.items.map((item, index) => (
                        <li key={index} className="order-item">
                          <span className="item-quantity">{item.quantity}x</span>
                          <span className="item-name">{item.name}</span>
                          {item.categoryName && (
                            <Badge bg="secondary" className="item-category">
                              {item.categoryName}
                            </Badge>
                          )}
                          {item.spiceLevel && (
                            <Badge bg="danger" className="item-category" style={{ marginLeft: '4px' }}>
                              {item.spiceLevel}
                            </Badge>
                          )}
                          {(item.notes || item.specialInstructions) && (
                            <div style={{ fontSize: '0.8rem', color: '#e67e22', fontStyle: 'italic', marginLeft: '28px' }}>
                              {item.notes || item.specialInstructions}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="order-total">
                    <strong>Total: ${order.total?.toFixed(2) || '0.00'}</strong>
                  </div>
                </Card.Body>
                <Card.Footer className="kitchen-order-footer">
                  {isReady && order.orderType === 'delivery' ? (
                    <Button
                      variant="info"
                      className="kitchen-action-button"
                      disabled
                      style={{ opacity: 0.8 }}
                    >
                      <i className="bi bi-truck"></i> Awaiting DoorDash Pickup
                    </Button>
                  ) : isReady && order.paidAtPOS ? (
                    <Button
                      variant="success"
                      className="kitchen-action-button kitchen-pickup-btn"
                      onClick={() => handleOrderPickedUp(order.id)}
                      disabled={isUpdating}
                    >
                      {isUpdating ? (
                        <>
                          <Spinner animation="border" size="sm" /> Completing...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-bag-check-fill"></i> Order Picked Up
                        </>
                      )}
                    </Button>
                  ) : !isPreparing ? (
                    <Button
                      variant="warning"
                      className="kitchen-action-button"
                      onClick={() => handleStatusChange(order.id, 'preparing')}
                      disabled={isUpdating}
                    >
                      {isUpdating ? (
                        <>
                          <Spinner animation="border" size="sm" /> Updating...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-play-circle"></i> Start Preparing
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="success"
                      className="kitchen-action-button"
                      onClick={() => handleStatusChange(order.id, 'ready')}
                      disabled={isUpdating}
                    >
                      {isUpdating ? (
                        <>
                          <Spinner animation="border" size="sm" /> Updating...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check-circle"></i> Mark as Ready
                        </>
                      )}
                    </Button>
                  )}
                </Card.Footer>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
};

export default Kitchen;
