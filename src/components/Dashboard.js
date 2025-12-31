import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Container, Row, Col, Card, Table, Badge, Spinner, ProgressBar, Form, Button, ButtonGroup } from 'react-bootstrap';
import './Dashboard.css';
import './PageHeader.css';

const Dashboard = () => {
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [dateRange, setDateRange] = useState('last7days'); // 'last10hours', 'last7days', 'custom'
  const [customDate, setCustomDate] = useState('');
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
      filterOrdersByDateRange(ordersData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (orders.length > 0) {
      filterOrdersByDateRange(orders);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customDate]);

  const filterOrdersByDateRange = (ordersData) => {
    const now = new Date();
    let startDate = null;

    switch (dateRange) {
      case 'last10hours':
        startDate = new Date(now.getTime() - 10 * 60 * 60 * 1000);
        break;
      case 'last7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'custom':
        if (customDate) {
          const selectedDate = new Date(customDate);
          startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + 1);
          const filtered = ordersData.filter(order => {
            const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
            return orderDate >= startDate && orderDate < endDate;
          });
          setFilteredOrders(filtered);
          calculateStats(filtered);
          calculateRevenueChart(filtered);
          calculateOrderStatus(filtered);
          return;
        }
        break;
      default:
        startDate = new Date(0); // All time
    }

    const filtered = ordersData.filter(order => {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      return startDate ? orderDate >= startDate : true;
    });

    setFilteredOrders(filtered);
    calculateStats(filtered);
    calculateRevenueChart(filtered);
    calculateOrderStatus(filtered);
  };

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

  const getDateRangeLabel = () => {
    switch (dateRange) {
      case 'last10hours':
        return 'Last 10 Hours';
      case 'last7days':
        return 'Last 7 Days';
      case 'custom':
        if (customDate) {
          const date = new Date(customDate);
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        return 'Select Date';
      default:
        return 'All Time';
    }
  };

  const calculateRevenueChart = (ordersData) => {
    if (ordersData.length === 0) {
      setRevenueData([]);
      return;
    }

    // Determine time buckets based on date range
    let timeBuckets = [];
    let bucketFormat = 'hour';

    if (dateRange === 'last10hours') {
      // Group by hour for last 10 hours
      const now = new Date();
      for (let i = 9; i >= 0; i--) {
        const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
        timeBuckets.push({
          label: `${hour.getHours()}:00`,
          time: hour.getHours(),
          revenue: 0,
          orders: 0
        });
      }
      bucketFormat = 'hour';
    } else if (dateRange === 'custom' && customDate) {
      // Group by hour for custom date
      for (let i = 0; i < 24; i++) {
        timeBuckets.push({
          label: `${i}:00`,
          time: i,
          revenue: 0,
          orders: 0
        });
      }
      bucketFormat = 'hour';
    } else {
      // Group by day for last 7 days
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        timeBuckets.push({
          label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: day.getTime(),
          revenue: 0,
          orders: 0
        });
      }
      bucketFormat = 'day';
    }

    ordersData.forEach(order => {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      
      if (bucketFormat === 'hour') {
        const hour = orderDate.getHours();
        const bucket = timeBuckets.find(b => b.time === hour);
        if (bucket) {
          bucket.revenue += order.total || 0;
          bucket.orders += 1;
        }
      } else {
        const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate()).getTime();
        const bucket = timeBuckets.find(b => {
          const bucketDay = new Date(b.time);
          const bucketDayTime = new Date(bucketDay.getFullYear(), bucketDay.getMonth(), bucketDay.getDate()).getTime();
          return bucketDayTime === orderDay;
        });
        if (bucket) {
          bucket.revenue += order.total || 0;
          bucket.orders += 1;
        }
      }
    });

    // Filter out empty buckets if needed, or show all
    const filteredBuckets = timeBuckets.filter(b => b.revenue > 0 || b.orders > 0);
    setRevenueData(filteredBuckets.length > 0 ? filteredBuckets : timeBuckets);
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

  const latestOrders = filteredOrders.slice(0, 5);
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

      {/* Date Range Selector */}
      <Card className="mb-4">
        <Card.Body>
          <Row className="align-items-center">
            <Col md={6}>
              <Form.Label className="mb-0"><strong>Date Range:</strong></Form.Label>
              <ButtonGroup className="mt-2">
                <Button
                  variant={dateRange === 'last10hours' ? 'primary' : 'outline-primary'}
                  onClick={() => setDateRange('last10hours')}
                  size="sm"
                >
                  Last 10 Hours
                </Button>
                <Button
                  variant={dateRange === 'last7days' ? 'primary' : 'outline-primary'}
                  onClick={() => setDateRange('last7days')}
                  size="sm"
                >
                  Last 7 Days
                </Button>
                <Button
                  variant={dateRange === 'custom' ? 'primary' : 'outline-primary'}
                  onClick={() => setDateRange('custom')}
                  size="sm"
                >
                  Select Date
                </Button>
              </ButtonGroup>
            </Col>
            <Col md={6}>
              {dateRange === 'custom' && (
                <div>
                  <Form.Label className="mb-0"><strong>Select Date:</strong></Form.Label>
                  <Form.Control
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="mt-2"
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}
              {dateRange !== 'custom' && (
                <div className="text-muted mt-2">
                  <i className="bi bi-calendar3"></i> Showing: <strong>{getDateRangeLabel()}</strong>
                </div>
              )}
            </Col>
          </Row>
        </Card.Body>
      </Card>

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
              <h5>Revenue {dateRange === 'last10hours' || (dateRange === 'custom' && customDate) ? 'by Hour' : 'by Day'} ({getDateRangeLabel()})</h5>
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
                            {data.label || data.hour}
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
