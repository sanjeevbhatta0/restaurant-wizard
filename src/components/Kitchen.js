import React, { useState, useEffect } from 'react';
import { Container, Card, Button, Badge, Alert, Spinner } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import './PageHeader.css';
import './Kitchen.css';

const Kitchen = () => {
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingOrders, setUpdatingOrders] = useState(new Set());

  useEffect(() => {
    if (!currentUser) return;

    // Query for orders that are sent to kitchen or being prepared
    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    
    // Build query based on location
    let q;
    if (isMultiLocation && selectedLocation) {
      q = query(
        ordersRef,
        where('locationId', '==', selectedLocation),
        where('status', 'in', ['sent_to_kitchen', 'preparing']),
        orderBy('createdAt', 'asc') // Oldest first (FIFO)
      );
    } else if (!isMultiLocation) {
      q = query(
        ordersRef,
        where('status', 'in', ['sent_to_kitchen', 'preparing']),
        orderBy('createdAt', 'asc')
      );
    } else {
      // Multi-location but no location selected
      setOrders([]);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setOrders(ordersData);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching orders:', error);
      setError('Failed to load orders. Please refresh the page.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, selectedLocation, isMultiLocation]);

  const handleStatusChange = async (orderId, newStatus) => {
    setUpdatingOrders(prev => new Set(prev).add(orderId));
    try {
      const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${orderId}`);
      await updateDoc(orderRef, {
        status: newStatus,
        updatedAt: new Date()
      });
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
            
            return (
              <Card key={order.id} className={`kitchen-order-card ${isPreparing ? 'preparing' : ''}`}>
                <Card.Header className="kitchen-order-header">
                  <div className="order-header-top">
                    <div>
                      <Badge bg={isPreparing ? 'warning' : 'primary'} className="order-status-badge">
                        {isPreparing ? 'Preparing' : 'New Order'}
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
                    <span className="table-info">
                      <i className="bi bi-table"></i>
                      Table: {formatTableNumber(order.tableNumber)}
                    </span>
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
