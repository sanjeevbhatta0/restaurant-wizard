import React, { useState, useEffect } from 'react';
import { Container, Table, Badge, Dropdown, Form, Row, Col } from 'react-bootstrap';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    const q = query(ordersRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setOrders(ordersData);
      filterOrders(ordersData, statusFilter);
    });

    return () => unsubscribe();
  }, [currentUser]);

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
      case 'preparing':
        return 'warning';
      case 'ready':
        return 'success';
      case 'completed':
        return 'info';
      case 'cancelled':
        return 'danger';
      default:
        return 'secondary';
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
      <Row className="mb-4 align-items-center">
        <Col>
          <h2 className="mb-0">Orders</h2>
        </Col>
        <Col xs="auto">
          <Form.Group>
            <Form.Select 
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              style={{ minWidth: '200px' }}
            >
              <option value="all">All Orders</option>
              <option value="new">New Orders</option>
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
              <td>{order.id}</td>
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
                  {order.status}
                </Badge>
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