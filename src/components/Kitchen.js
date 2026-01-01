import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Card, Button, Badge, Alert, Spinner } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import activityService from '../services/activityService';
import { initializeNotifications, notifyKitchen, unlockAudio } from '../services/notificationService';
import { initializeWakeLock, cleanupWakeLock, isWakeLockSupported } from '../services/wakeLockService';
import './PageHeader.css';
import './Kitchen.css';

const Kitchen = () => {
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingOrders, setUpdatingOrders] = useState(new Set());
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  
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
    if (!currentUser) return;

    // Multi-location but no location selected
    if (isMultiLocation && !selectedLocation) {
      setOrders([]);
      setLoading(false);
      return;
    }

    // Query for orders that are new (from website), sent to kitchen, or being prepared
    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    
    // Build query based on location
    // Note: For single-location, we still filter by locationId (currentUser.uid) to ensure consistency
    // Include 'new' status to capture website orders
    let q;
    try {
      if (isMultiLocation && selectedLocation) {
        // Multi-location: filter by selected location
        q = query(
          ordersRef,
          where('locationId', '==', selectedLocation),
          where('status', 'in', ['new', 'sent_to_kitchen', 'preparing']),
          orderBy('createdAt', 'asc') // Oldest first (FIFO)
        );
      } else {
        // Single-location: filter by currentUser.uid (which is what POS sets as locationId)
        // This ensures consistency between POS and Kitchen
        q = query(
          ordersRef,
          where('locationId', '==', currentUser.uid),
          where('status', 'in', ['new', 'sent_to_kitchen', 'preparing']),
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
            where('status', 'in', ['new', 'sent_to_kitchen', 'preparing'])
          );
        } else {
          q = query(
            ordersRef,
            where('locationId', '==', currentUser.uid),
            where('status', 'in', ['new', 'sent_to_kitchen', 'preparing'])
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
      
      // Detect new orders and trigger notifications
      if (!isInitialLoad.current) {
        const currentOrderIds = new Set(ordersData.map(o => o.id));
        
        // Find new orders (in current but not in previous)
        ordersData.forEach(order => {
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
        prevOrderIds.current = new Set(ordersData.map(o => o.id));
        isInitialLoad.current = false;
      }
      
      setOrders(ordersData);
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
            collection: `restaurants/${currentUser.uid}/orders`,
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

    return () => unsubscribe();
  }, [currentUser, selectedLocation, isMultiLocation]);

  const handleStatusChange = async (orderId, newStatus) => {
    setUpdatingOrders(prev => new Set(prev).add(orderId));
    try {
      const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${orderId}`);
      
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
      
      // Log activity
      if (order) {
        const tableNumber = Array.isArray(order.tableNumber) 
          ? order.tableNumber.join(' and ') 
          : order.tableNumber;
        await activityService.logOrderActivity(currentUser.uid, 'status_changed', {
          orderNumber: order.orderNumber || orderId,
          orderId: orderId,
          tableNumber: tableNumber || 'N/A',
          status: newStatus,
          locationId: order.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
        });
      }
    } catch (error) {
      console.error('Error updating order status:', error);
      alert('Failed to update order status: ' + error.message);
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
    <Container fluid className="kitchen-container">
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
            const orderTypeInfo = getOrderTypeInfo(order.orderType);
            const isWebsiteOrder = order.source === 'website' || order.orderType === 'pickup' || order.orderType === 'delivery';
            
            return (
              <Card key={order.id} className={`kitchen-order-card ${isPreparing ? 'preparing' : ''}`}>
                <Card.Header className="kitchen-order-header">
                  <div className="order-header-top">
                    <div className="order-badges">
                      <Badge bg={isPreparing ? 'warning' : 'primary'} className="order-status-badge">
                        {isPreparing ? 'Preparing' : 'New Order'}
                      </Badge>
                      <Badge bg={orderTypeInfo.variant} className="order-type-badge">
                        <i className={`bi ${orderTypeInfo.icon}`}></i> {orderTypeInfo.label}
                      </Badge>
                      <span className="order-number">#{order.orderNumber || order.id}</span>
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
                    ) : (
                      <span className="table-info">
                        <i className="bi bi-table"></i>
                        Table: {formatTableNumber(order.tableNumber)}
                      </span>
                    )}
                    {order.pickupTime && (
                      <span className="pickup-time">
                        <i className="bi bi-clock-history"></i>
                        Pickup: {order.pickupTime}
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
                          {item.categoryName && (
                            <Badge bg="secondary" className="item-category">
                              {item.categoryName}
                            </Badge>
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
                  {!isPreparing ? (
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
