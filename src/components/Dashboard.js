import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Container, Row, Col, Card, Table, Badge, Spinner, ProgressBar } from 'react-bootstrap';
import './Dashboard.css';
import './PageHeader.css';

const Dashboard = () => {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    todayRevenue: 0,
    todayOrders: 0,
    averageOrderValue: 0
  });
  const [revenueData, setRevenueData] = useState([]);
  const [orderStatusData, setOrderStatusData] = useState([]);
  const [loading, setLoading] = useState(true);
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
      calculateStats(ordersData);
      calculateRevenueChart(ordersData);
      calculateOrderStatus(ordersData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const calculateStats = (ordersData) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const todayOrders = ordersData.filter(order => {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      return orderDate >= todayStart;
    });

    const totalRevenue = ordersData.reduce((sum, order) => sum + (order.total || 0), 0);
    const todayRevenue = todayOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const averageOrderValue = ordersData.length > 0 ? totalRevenue / ordersData.length : 0;

    setStats({
      totalRevenue,
      totalOrders: ordersData.length,
      todayRevenue,
      todayOrders: todayOrders.length,
      averageOrderValue
    });
  };

  const calculateRevenueChart = (ordersData) => {
    // Group orders by hour for the last 24 hours
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i}:00`,
      revenue: 0,
      orders: 0
    }));

    ordersData.forEach(order => {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      const hour = orderDate.getHours();
      if (hours[hour]) {
        hours[hour].revenue += order.total || 0;
        hours[hour].orders += 1;
      }
    });

    // Only show hours with data, or show last 12 hours
    const filteredHours = hours.filter(h => h.revenue > 0 || h.orders > 0);
    setRevenueData(filteredHours.length > 0 ? filteredHours : hours.slice(12, 24));
  };

  const calculateOrderStatus = (ordersData) => {
    const statusCounts = {
      'new': 0,
      'preparing': 0,
      'ready': 0,
      'completed': 0,
      'sent_to_kitchen': 0
    };

    ordersData.forEach(order => {
      const status = order.status || 'new';
      if (statusCounts.hasOwnProperty(status)) {
        statusCounts[status]++;
      } else {
        statusCounts['new']++;
      }
    });

    setOrderStatusData([
      { name: 'New', value: statusCounts['new'] + statusCounts['sent_to_kitchen'], color: '#667eea' },
      { name: 'Preparing', value: statusCounts['preparing'], color: '#f093fb' },
      { name: 'Ready', value: statusCounts['ready'], color: '#4facfe' },
      { name: 'Completed', value: statusCounts['completed'], color: '#43e97b' }
    ]);
  };

  const getStatusBadge = (status) => {
    const variants = {
      'new': 'primary',
      'sent_to_kitchen': 'info',
      'preparing': 'warning',
      'ready': 'success',
      'completed': 'secondary'
    };
    return <Badge bg={variants[status] || 'secondary'}>{status.replace('_', ' ').toUpperCase()}</Badge>;
  };

  const latestOrders = orders.slice(0, 5);
  const maxRevenue = revenueData.length > 0 ? Math.max(...revenueData.map(d => d.revenue)) : 1;
  const totalStatusOrders = orderStatusData.reduce((sum, item) => sum + item.value, 0);

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
        <Spinner animation="border" />
      </div>
    );
  }

  return (
    <Container fluid>
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-bar-chart header-icon"></i>
          <div>
            <h2>Analytics</h2>
            <p>Track your restaurant's performance and insights</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <Row className="mb-4">
        <Col md={3} className="mb-3">
          <Card className="text-center stats-card">
            <Card.Body>
              <Card.Title className="text-muted small">Total Revenue</Card.Title>
              <h3 className="text-primary">${stats.totalRevenue.toFixed(2)}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3} className="mb-3">
          <Card className="text-center stats-card">
            <Card.Body>
              <Card.Title className="text-muted small">Total Orders</Card.Title>
              <h3 className="text-info">{stats.totalOrders}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3} className="mb-3">
          <Card className="text-center stats-card">
            <Card.Body>
              <Card.Title className="text-muted small">Today's Revenue</Card.Title>
              <h3 className="text-success">${stats.todayRevenue.toFixed(2)}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3} className="mb-3">
          <Card className="text-center stats-card">
            <Card.Body>
              <Card.Title className="text-muted small">Avg Order Value</Card.Title>
              <h3 className="text-warning">${stats.averageOrderValue.toFixed(2)}</h3>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Charts Row */}
      <Row className="mb-4">
        <Col md={8}>
          <Card>
            <Card.Header>
              <h5>Revenue by Hour (Last 24 Hours)</h5>
            </Card.Header>
            <Card.Body>
              {revenueData.length > 0 ? (
                <div className="revenue-chart">
                  <svg viewBox="0 0 800 300" className="chart-svg">
                    <defs>
                      <linearGradient id="revenueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#667eea" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#667eea" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* Grid lines */}
                    {[0, 1, 2, 3, 4].map(i => (
                      <line
                        key={i}
                        x1="50"
                        y1={50 + i * 50}
                        x2="750"
                        y2={50 + i * 50}
                        stroke="#e0e0e0"
                        strokeWidth="1"
                      />
                    ))}
                    {/* Revenue bars */}
                    {revenueData.map((data, index) => {
                      const x = 50 + (index * (700 / revenueData.length));
                      const height = (data.revenue / maxRevenue) * 200;
                      const y = 250 - height;
                      return (
                        <g key={index}>
                          <rect
                            x={x}
                            y={y}
                            width={700 / revenueData.length - 10}
                            height={height}
                            fill="#667eea"
                            rx="4"
                          />
                          <text
                            x={x + (700 / revenueData.length - 10) / 2}
                            y={y - 5}
                            textAnchor="middle"
                            fontSize="10"
                            fill="#333"
                          >
                            ${data.revenue.toFixed(0)}
                          </text>
                          <text
                            x={x + (700 / revenueData.length - 10) / 2}
                            y={270}
                            textAnchor="middle"
                            fontSize="10"
                            fill="#666"
                          >
                            {data.hour}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              ) : (
                <div className="text-center text-muted py-5">No revenue data available</div>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card>
            <Card.Header>
              <h5>Orders by Status</h5>
            </Card.Header>
            <Card.Body>
              {totalStatusOrders > 0 ? (
                <div className="status-chart">
                  {orderStatusData.map((item, index) => {
                    const percentage = (item.value / totalStatusOrders) * 100;
                    return (
                      <div key={index} className="status-item mb-3">
                        <div className="d-flex justify-content-between mb-1">
                          <span className="status-label">{item.name}</span>
                          <span className="status-value">{item.value} ({percentage.toFixed(0)}%)</span>
                        </div>
                        <ProgressBar
                          now={percentage}
                          variant="info"
                          style={{ backgroundColor: item.color, height: '20px' }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-muted py-5">No orders yet</div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Latest Orders Table */}
      <Row>
        <Col>
          <Card>
            <Card.Header>
              <h5>Latest Orders</h5>
            </Card.Header>
            <Card.Body>
              {latestOrders.length > 0 ? (
                <Table responsive hover>
                  <thead>
                    <tr>
                      <th>Order #</th>
                      <th>Table</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestOrders.map(order => {
                      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
                      return (
                        <tr key={order.id}>
                          <td>{order.orderNumber || order.id.slice(0, 8)}</td>
                          <td>{order.tableNumber || 'N/A'}</td>
                          <td>{order.items?.length || 0} items</td>
                          <td>${(order.total || 0).toFixed(2)}</td>
                          <td>{getStatusBadge(order.status)}</td>
                          <td>{orderDate.toLocaleTimeString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              ) : (
                <p className="text-center text-muted">No orders yet. Start taking orders to see them here!</p>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default Dashboard;
