import React, { useState, useEffect } from 'react';
import { Container, Table, Badge, Dropdown, Form, Row, Col } from 'react-bootstrap';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import './PageHeader.css';

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();

  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    const q = query(ordersRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter by location if multi-location
      if (isMultiLocation && selectedLocation) {
        ordersData = ordersData.filter(order => {
          return order.locationId === selectedLocation;
        });
      }

      setOrders(ordersData);
      filterOrders(ordersData, statusFilter);
    });

    return () => unsubscribe();
  }, [currentUser, isMultiLocation, selectedLocation]);

  const filterOrders = (ordersData, status) => {
    if (status === 'all') {
      setFilteredOrders(ordersData);
    } else {
      setFilteredOrders(ordersData.filter(order => order.status === status));
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${orderId}`);
      await updateDoc(orderRef, {
        status: newStatus,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating order status:', error);
    }
  };

  const handleFilterChange = (status) => {
    setStatusFilter(status);
    filterOrders(orders, status);
  };

  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case 'new':
        return 'primary';
      case 'sent_to_kitchen':
        return 'info';
      case 'preparing':
        return 'warning';
      case 'ready':
        return 'success';
      case 'completed':
        return 'dark';
      case 'cancelled':
        return 'danger';
      default:
        return 'secondary';
    }
  };

  const formatStatus = (status) => {
    switch (status) {
      case 'sent_to_kitchen':
        return 'Sent to Kitchen';
      case 'new':
        return 'New';
      case 'preparing':
        return 'Preparing';
      case 'ready':
        return 'Ready';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate();
    return new Intl.DateTimeFormat('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date);
  };

  const formatPrice = (price) => {
    return typeof price === 'number' ? `$${price.toFixed(2)}` : '$0.00';
  };

  return (
    <Container className="py-4">
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-cart header-icon"></i>
          <div>
            <h2>Orders</h2>
            <p>Manage and track all customer orders</p>
          </div>
        </div>
      </div>
      <Row className="mb-4 align-items-center">
        <Col xs="auto">
          <Form.Group>
            <Form.Select 
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              style={{ minWidth: '200px' }}
            >
              <option value="all">All Orders</option>
              <option value="new">New Orders</option>
              <option value="sent_to_kitchen">Sent to Kitchen</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready for Pickup</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      <Table responsive>
        <thead>
          <tr>
            <th>Order #</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Items</th>
            <th>Total</th>
            <th>Pickup Time</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredOrders.map(order => (
            <tr key={order.id}>
              <td>{order.orderNumber || order.id.slice(0, 8)}</td>
              <td>{formatDate(order.createdAt)}</td>
              <td>
                {order.customerName}<br />
                <small className="text-muted">{order.customerPhone}</small>
              </td>
              <td>
                {order.items?.map((item, index) => (
                  <div key={index}>
                    {item.quantity}x {item.name}
                  </div>
                ))}
              </td>
              <td>{formatPrice(order.total)}</td>
              <td>{order.pickupTime}</td>
              <td>
                <Badge bg={getStatusBadgeVariant(order.status)}>
                  {formatStatus(order.status)}
                </Badge>
                {order.tableNumber && (
                  <div><small className="text-muted">Table #{order.tableNumber}</small></div>
                )}
              </td>
              <td>
                <Dropdown>
                  <Dropdown.Toggle variant="outline-secondary" size="sm">
                    Update Status
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    <Dropdown.Item onClick={() => handleStatusChange(order.id, 'new')}>
                      New
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleStatusChange(order.id, 'sent_to_kitchen')}>
                      Sent to Kitchen
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleStatusChange(order.id, 'preparing')}>
                      Preparing
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleStatusChange(order.id, 'ready')}>
                      Ready
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleStatusChange(order.id, 'completed')}>
                      Completed
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => handleStatusChange(order.id, 'cancelled')}>
                      Cancelled
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {filteredOrders.length === 0 && (
        <div className="text-center py-4">
          <p className="text-muted">
            {statusFilter === 'all' 
              ? 'No orders yet' 
              : `No ${statusFilter} orders`}
          </p>
        </div>
      )}
    </Container>
  );
};

export default Orders; 