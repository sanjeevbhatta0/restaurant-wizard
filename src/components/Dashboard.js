import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Container, Row, Col, Card, Spinner, ProgressBar, Form, Button, ButtonGroup, Modal, Dropdown } from 'react-bootstrap';
import AIAnalytics from './AIAnalytics';
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
    averageOrderValue: 0,
    totalReimbursements: 0,
    netRevenue: 0
  });
  const [reimbursements, setReimbursements] = useState([]);
  const [revenueData, setRevenueData] = useState([]);
  const [orderStatusData, setOrderStatusData] = useState([]);
  const [topSellingItems, setTopSellingItems] = useState([]);
  const [averageOrderTime, setAverageOrderTime] = useState(0);
  const [showChartModal, setShowChartModal] = useState(false);
  const [revenueBreakdown, setRevenueBreakdown] = useState({ subtotal: 0, tax: 0, tips: 0, discounts: 0 });
  const [orderTrendData, setOrderTrendData] = useState([]);
  const [hoveredSegment, setHoveredSegment] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0, show: false });
  const [loading, setLoading] = useState(true);
  const [analyticsMode, setAnalyticsMode] = useState('classic'); // 'classic' or 'ai'
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
      filterOrdersByDateRange(ordersData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, isMultiLocation, selectedLocation]);

  // Load reimbursements
  useEffect(() => {
    if (!currentUser) return;

    const reimbursementsRef = collection(db, `restaurants/${currentUser.uid}/reimbursements`);
    const q = query(reimbursementsRef, orderBy('processedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let reimbursementsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter by location if multi-location
      if (isMultiLocation && selectedLocation) {
        reimbursementsData = reimbursementsData.filter(reimb => {
          return reimb.locationId === selectedLocation;
        });
      }

      setReimbursements(reimbursementsData);
    });

    return () => unsubscribe();
  }, [currentUser, isMultiLocation, selectedLocation]);

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
    calculateTopSellingItems(filtered);
    calculateAverageOrderTime(filtered);
    calculateRevenueBreakdown(filtered);
    calculateOrderTrend(filtered);
  };

  useEffect(() => {
    if (orders.length > 0) {
      calculateStats(filteredOrders);
    }
  }, [reimbursements, filteredOrders, dateRange, customDate]);

  const calculateStats = (ordersData) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Filter reimbursements by date range
    let filteredReimbursements = reimbursements;
    if (dateRange === 'last10hours') {
      const startDate = new Date(now.getTime() - 10 * 60 * 60 * 1000);
      filteredReimbursements = reimbursements.filter(reimb => {
        const reimbDate = reimb.processedAt?.toDate ? reimb.processedAt.toDate() : new Date(reimb.processedAt);
        return reimbDate >= startDate;
      });
    } else if (dateRange === 'last7days') {
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filteredReimbursements = reimbursements.filter(reimb => {
        const reimbDate = reimb.processedAt?.toDate ? reimb.processedAt.toDate() : new Date(reimb.processedAt);
        return reimbDate >= startDate;
      });
    } else if (dateRange === 'custom' && customDate) {
      const selectedDate = new Date(customDate);
      const startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      filteredReimbursements = reimbursements.filter(reimb => {
        const reimbDate = reimb.processedAt?.toDate ? reimb.processedAt.toDate() : new Date(reimb.processedAt);
        return reimbDate >= startDate && reimbDate < endDate;
      });
    }

    const todayOrders = ordersData.filter(order => {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      return orderDate >= todayStart;
    });

    const totalRevenue = ordersData.reduce((sum, order) => sum + (order.total || 0), 0);
    const totalReimbursements = filteredReimbursements.reduce((sum, reimb) => sum + (reimb.amount || 0), 0);
    const netRevenue = totalRevenue - totalReimbursements;
    const todayRevenue = todayOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const averageOrderValue = ordersData.length > 0 ? totalRevenue / ordersData.length : 0;

    setStats({
      totalRevenue,
      totalOrders: ordersData.length,
      todayRevenue,
      todayOrders: todayOrders.length,
      averageOrderValue,
      totalReimbursements,
      netRevenue
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
          reimbursement: 0,
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
          reimbursement: 0,
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
          reimbursement: 0,
          orders: 0
        });
      }
      bucketFormat = 'day';
    }

    // Process orders
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

    // Process reimbursements
    const now = new Date();
    let startDate = null;
    if (dateRange === 'last10hours') {
      startDate = new Date(now.getTime() - 10 * 60 * 60 * 1000);
    } else if (dateRange === 'last7days') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateRange === 'custom' && customDate) {
      const selectedDate = new Date(customDate);
      startDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    }

    reimbursements.forEach(reimb => {
      const reimbDate = reimb.processedAt?.toDate ? reimb.processedAt.toDate() : new Date(reimb.processedAt);

      if (startDate && reimbDate < startDate) return;

      if (bucketFormat === 'hour') {
        const hour = reimbDate.getHours();
        const bucket = timeBuckets.find(b => b.time === hour);
        if (bucket) {
          bucket.reimbursement += reimb.amount || 0;
        }
      } else {
        const reimbDay = new Date(reimbDate.getFullYear(), reimbDate.getMonth(), reimbDate.getDate()).getTime();
        const bucket = timeBuckets.find(b => {
          const bucketDay = new Date(b.time);
          const bucketDayTime = new Date(bucketDay.getFullYear(), bucketDay.getMonth(), bucketDay.getDate()).getTime();
          return bucketDayTime === reimbDay;
        });
        if (bucket) {
          bucket.reimbursement += reimb.amount || 0;
        }
      }
    });

    setRevenueData(timeBuckets);
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

  const calculateTopSellingItems = (ordersData) => {
    const itemCounts = {};

    ordersData.forEach(order => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const itemName = item.name || 'Unknown Item';
          const quantity = item.quantity || 1;
          if (itemCounts[itemName]) {
            itemCounts[itemName] += quantity;
          } else {
            itemCounts[itemName] = quantity;
          }
        });
      }
    });

    const topItems = Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    setTopSellingItems(topItems);
  };

  const calculateAverageOrderTime = (ordersData) => {
    const completedOrders = ordersData.filter(order =>
      order.status === 'completed' &&
      order.createdAt &&
      order.paymentDate
    );

    if (completedOrders.length === 0) {
      setAverageOrderTime(0);
      return;
    }

    let totalTime = 0;
    completedOrders.forEach(order => {
      const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
      const paymentDate = order.paymentDate?.toDate ? order.paymentDate.toDate() : new Date(order.paymentDate);
      const timeDiff = paymentDate - createdAt;
      totalTime += timeDiff;
    });

    const averageMs = totalTime / completedOrders.length;
    const averageMinutes = Math.round(averageMs / (1000 * 60));
    setAverageOrderTime(averageMinutes);
  };

  const calculateRevenueBreakdown = (ordersData) => {
    let subtotal = 0;
    let tax = 0;
    let tips = 0;
    let discounts = 0;

    ordersData.forEach(order => {
      if (order.paymentDetails) {
        subtotal += order.paymentDetails.subtotal || 0;
        tax += order.paymentDetails.taxAmount || 0;
        tips += order.paymentDetails.tipAmount || 0;

        // Calculate discount amount
        if (order.paymentDetails.discountAmount > 0) {
          if (order.paymentDetails.discountType === 'percentage') {
            discounts += (order.paymentDetails.subtotal || 0) * (order.paymentDetails.discountAmount / 100);
          } else {
            discounts += order.paymentDetails.discountAmount;
          }
        }
      } else {
        // Fallback to order total if no payment details
        subtotal += order.total || 0;
      }
    });

    setRevenueBreakdown({ subtotal, tax, tips, discounts });
  };

  const calculateOrderTrend = (ordersData) => {
    // Determine time buckets based on date range
    let timeBuckets = [];
    let bucketFormat = 'hour';

    if (dateRange === 'last10hours') {
      const now = new Date();
      for (let i = 9; i >= 0; i--) {
        const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
        const hourKey = `${hour.getFullYear()}-${hour.getMonth()}-${hour.getDate()}-${hour.getHours()}`;
        timeBuckets.push({
          label: `${hour.getHours()}:00`,
          time: hourKey,
          hourTime: hour.getTime(),
          orders: 0
        });
      }
      bucketFormat = 'hour';
    } else if (dateRange === 'custom' && customDate) {
      const selectedDate = new Date(customDate);
      for (let i = 0; i < 24; i++) {
        timeBuckets.push({
          label: `${i}:00`,
          time: `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}-${i}`,
          hourTime: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), i).getTime(),
          orders: 0
        });
      }
      bucketFormat = 'hour';
    } else {
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        timeBuckets.push({
          label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: day.getTime(),
          orders: 0
        });
      }
      bucketFormat = 'day';
    }

    // Count orders per bucket
    ordersData.forEach(order => {
      const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);

      if (bucketFormat === 'hour') {
        const orderHourKey = `${orderDate.getFullYear()}-${orderDate.getMonth()}-${orderDate.getDate()}-${orderDate.getHours()}`;
        const bucket = timeBuckets.find(b => b.time === orderHourKey);
        if (bucket) {
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
          bucket.orders += 1;
        }
      }
    });

    setOrderTrendData(timeBuckets);
  };

  const totalStatusOrders = orderStatusData.reduce((sum, item) => sum + item.value, 0);

  const renderPieChart = (data, centerX = 150, centerY = 150, radius = 120, isFullScreen = false, chartId = 'pie') => {
    const total = data.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) {
      return <text x={centerX} y={centerY} textAnchor="middle" fontSize="14" fill="#999">No data</text>;
    }

    let currentAngle = -90; // Start from top
    const segments = [];

    data.forEach((item, index) => {
      const percentage = (item.value / total) * 100;
      const angle = (item.value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;

      // Calculate path for pie slice
      const x1 = centerX + radius * Math.cos((startAngle * Math.PI) / 180);
      const y1 = centerY + radius * Math.sin((startAngle * Math.PI) / 180);
      const x2 = centerX + radius * Math.cos((endAngle * Math.PI) / 180);
      const y2 = centerY + radius * Math.sin((endAngle * Math.PI) / 180);

      const largeArcFlag = angle > 180 ? 1 : 0;

      const pathData = [
        `M ${centerX} ${centerY}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
        'Z'
      ].join(' ');

      const midAngle = currentAngle + angle / 2;
      const labelRadius = radius + 25;
      const labelX = centerX + labelRadius * Math.cos((midAngle * Math.PI) / 180);
      const labelY = centerY + labelRadius * Math.sin((midAngle * Math.PI) / 180);

      segments.push({
        path: pathData,
        color: item.color,
        label: item.label,
        value: item.value,
        percentage: percentage,
        midAngle: midAngle,
        labelX: labelX,
        labelY: labelY,
        index: index,
        chartId: chartId
      });

      currentAngle += angle;
    });

    const handleMouseEnter = (segment, event) => {
      setHoveredSegment({ ...segment, chartId });
      updateTooltipPosition(event);
    };

    const handleMouseMove = (event) => {
      if (hoveredSegment && hoveredSegment.chartId === chartId) {
        updateTooltipPosition(event);
      }
    };

    const handleMouseLeave = () => {
      if (hoveredSegment && hoveredSegment.chartId === chartId) {
        setHoveredSegment(null);
        setTooltipPosition({ x: 0, y: 0, show: false });
      }
    };

    const updateTooltipPosition = (event) => {
      const svg = event.currentTarget.closest('svg');
      if (svg) {
        const container = svg.closest('.pie-chart-container');
        if (container) {
          const rect = container.getBoundingClientRect();
          setTooltipPosition({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            show: true
          });
        }
      }
    };

    return (
      <g onMouseMove={handleMouseMove}>
        {segments.map((segment, index) => (
          <g key={index}>
            <path
              d={segment.path}
              fill={segment.color}
              stroke="#fff"
              strokeWidth="3"
              opacity={hoveredSegment && hoveredSegment.chartId === chartId && hoveredSegment.index !== segment.index ? 0.4 : 1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => handleMouseEnter(segment, e)}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              transform={hoveredSegment && hoveredSegment.chartId === chartId && hoveredSegment.index === segment.index
                ? `translate(${radius * 0.05 * Math.cos((segment.midAngle * Math.PI) / 180)}, ${radius * 0.05 * Math.sin((segment.midAngle * Math.PI) / 180)})`
                : ''}
            />
          </g>
        ))}
      </g>
    );
  };

  const renderOrderTrendChart = (viewBoxWidth = 800, viewBoxHeight = 250, isFullScreen = false) => {
    if (orderTrendData.length === 0) {
      return <div className="text-center text-muted py-5">No order data available</div>;
    }

    const chartHeight = isFullScreen ? 500 : viewBoxHeight;
    const chartWidth = isFullScreen ? 1200 : viewBoxWidth;
    const padding = 80;
    const chartAreaWidth = chartWidth - (padding * 2);
    const chartAreaHeight = chartHeight - 100;
    const maxOrders = Math.max(...orderTrendData.map(d => d.orders), 1);

    return (
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="chart-svg" style={{ width: '100%', height: '100%' }}>
        {/* Grid lines */}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <line
            key={i}
            x1={padding}
            y1={50 + i * (chartAreaHeight / 5)}
            x2={chartWidth - padding}
            y2={50 + i * (chartAreaHeight / 5)}
            stroke="#e0e0e0"
            strokeWidth="1"
          />
        ))}

        {/* Order count line */}
        {(() => {
          const ordersPath = orderTrendData.map((data, index) => {
            const x = padding + (index * (chartAreaWidth / orderTrendData.length));
            const y = chartHeight - 50 - (data.orders / maxOrders) * chartAreaHeight;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
          }).join(' ');

          return (
            <g>
              {/* Area under line */}
              <path
                d={`${ordersPath} L ${padding + ((orderTrendData.length - 1) * (chartAreaWidth / orderTrendData.length))} ${chartHeight - 50} L ${padding} ${chartHeight - 50} Z`}
                fill="url(#orderGradient)"
                opacity="0.3"
              />
              {/* Order line */}
              <path
                d={ordersPath}
                fill="none"
                stroke="#43e97b"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Data points */}
              {orderTrendData.map((data, index) => {
                const x = padding + (index * (chartAreaWidth / orderTrendData.length));
                const ordersY = chartHeight - 50 - (data.orders / maxOrders) * chartAreaHeight;
                return (
                  <g key={index}>
                    <circle cx={x} cy={ordersY} r="4" fill="#43e97b" />
                    <text
                      x={x}
                      y={ordersY - 10}
                      textAnchor="middle"
                      fontSize={isFullScreen ? "11" : "9"}
                      fill="#43e97b"
                      fontWeight="600"
                    >
                      {data.orders}
                    </text>
                    <text
                      x={x}
                      y={chartHeight - 20}
                      textAnchor="middle"
                      fontSize={isFullScreen ? "12" : "9"}
                      fill="#666"
                    >
                      {data.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Gradient definition */}
        <defs>
          <linearGradient id="orderGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#43e97b" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#43e97b" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  const renderChart = (viewBoxWidth = 800, viewBoxHeight = 250, isFullScreen = false) => {
    if (revenueData.length === 0) {
      return <div className="text-center text-muted py-5">No data available</div>;
    }

    const chartHeight = isFullScreen ? 500 : viewBoxHeight;
    const chartWidth = isFullScreen ? 1200 : viewBoxWidth;
    const padding = 80;
    const chartAreaWidth = chartWidth - (padding * 2);
    const chartAreaHeight = chartHeight - 100;

    return (
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="chart-svg" style={{ width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#667eea" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#667eea" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="reimbursementGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f5576c" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#f5576c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 1, 2, 3, 4, 5].map(i => (
          <line
            key={i}
            x1={padding}
            y1={50 + i * (chartAreaHeight / 5)}
            x2={chartWidth - padding}
            y2={50 + i * (chartAreaHeight / 5)}
            stroke="#e0e0e0"
            strokeWidth="1"
          />
        ))}

        {/* Calculate max values for scaling */}
        {(() => {
          const maxRevenue = Math.max(...revenueData.map(d => d.revenue), 1);
          const maxReimbursement = Math.max(...revenueData.map(d => d.reimbursement), 1);
          const maxOrders = Math.max(...revenueData.map(d => d.orders), 1);
          const maxValue = Math.max(maxRevenue, maxReimbursement, maxOrders * 10);

          // Draw revenue line
          const revenuePath = revenueData.map((data, index) => {
            const x = padding + (index * (chartAreaWidth / revenueData.length));
            const y = chartHeight - 50 - (data.revenue / maxValue) * chartAreaHeight;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
          }).join(' ');

          // Draw reimbursement line
          const reimbursementPath = revenueData.map((data, index) => {
            const x = padding + (index * (chartAreaWidth / revenueData.length));
            const y = chartHeight - 50 - (data.reimbursement / maxValue) * chartAreaHeight;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
          }).join(' ');

          // Draw orders line (scaled)
          const ordersPath = revenueData.map((data, index) => {
            const x = padding + (index * (chartAreaWidth / revenueData.length));
            const y = chartHeight - 50 - ((data.orders * 10) / maxValue) * chartAreaHeight;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
          }).join(' ');

          return (
            <g>
              {/* Revenue area */}
              <path
                d={`${revenuePath} L ${padding + ((revenueData.length - 1) * (chartAreaWidth / revenueData.length))} ${chartHeight - 50} L ${padding} ${chartHeight - 50} Z`}
                fill="url(#revenueGradient)"
              />
              {/* Revenue line */}
              <path
                d={revenuePath}
                fill="none"
                stroke="#667eea"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Reimbursement area */}
              <path
                d={`${reimbursementPath} L ${padding + ((revenueData.length - 1) * (chartAreaWidth / revenueData.length))} ${chartHeight - 50} L ${padding} ${chartHeight - 50} Z`}
                fill="url(#reimbursementGradient)"
              />
              {/* Reimbursement line */}
              <path
                d={reimbursementPath}
                fill="none"
                stroke="#f5576c"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Orders line */}
              <path
                d={ordersPath}
                fill="none"
                stroke="#43e97b"
                strokeWidth="2"
                strokeDasharray="5,5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Data points */}
              {revenueData.map((data, index) => {
                const x = padding + (index * (chartAreaWidth / revenueData.length));
                const revenueY = chartHeight - 50 - (data.revenue / maxValue) * chartAreaHeight;
                const reimbursementY = chartHeight - 50 - (data.reimbursement / maxValue) * chartAreaHeight;
                const ordersY = chartHeight - 50 - ((data.orders * 10) / maxValue) * chartAreaHeight;
                return (
                  <g key={index}>
                    <circle cx={x} cy={revenueY} r="4" fill="#667eea" />
                    {data.reimbursement > 0 && <circle cx={x} cy={reimbursementY} r="4" fill="#f5576c" />}
                    {data.orders > 0 && <circle cx={x} cy={ordersY} r="3" fill="#43e97b" />}
                    <text
                      x={x}
                      y={chartHeight - 20}
                      textAnchor="middle"
                      fontSize={isFullScreen ? "12" : "9"}
                      fill="#666"
                    >
                      {data.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Legend */}
        <g>
          <rect x={chartWidth - 200} y="20" width="15" height="3" fill="#667eea" />
          <text x={chartWidth - 180} y="25" fontSize={isFullScreen ? "14" : "11"} fill="#333">Revenue</text>
          <rect x={chartWidth - 200} y="35" width="15" height="3" fill="#f5576c" />
          <text x={chartWidth - 180} y="40" fontSize={isFullScreen ? "14" : "11"} fill="#333">Reimbursement</text>
          <line x1={chartWidth - 200} y1="50" x2={chartWidth - 185} y2="50" stroke="#43e97b" strokeWidth="2" strokeDasharray="5,5" />
          <text x={chartWidth - 180} y="54" fontSize={isFullScreen ? "14" : "11"} fill="#333">Orders (×10)</text>
        </g>
      </svg>
    );
  };

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
        <div className="notification-status">
          <Dropdown>
            <Dropdown.Toggle
              variant={analyticsMode === 'ai' ? 'light' : 'outline-light'}
              className="analytics-mode-toggle"
              style={{
                borderRadius: '50px',
                fontWeight: '600',
                background: analyticsMode === 'ai' ? 'white' : 'transparent',
                color: analyticsMode === 'ai' ? '#667eea' : 'white'
              }}
            >
              {analyticsMode === 'classic' ? (
                <><i className="bi bi-bar-chart-line me-2"></i>Classic Analytics</>
              ) : (
                <><i className="bi bi-stars me-2"></i>AI Analytics ✨</>
              )}
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item
                active={analyticsMode === 'classic'}
                onClick={() => setAnalyticsMode('classic')}
              >
                <i className="bi bi-bar-chart-line me-2"></i>
                Classic Analytics
              </Dropdown.Item>
              <Dropdown.Item
                active={analyticsMode === 'ai'}
                onClick={() => setAnalyticsMode('ai')}
              >
                <i className="bi bi-stars me-2"></i>
                AI Analytics ✨
                <span className="badge bg-primary ms-2">NEW</span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      {/* Render AI Analytics or Classic Analytics based on mode */}
      {analyticsMode === 'ai' ? (
        <AIAnalytics />
      ) : (
        <>
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
            <Col md={2} className="mb-3">
              <Card className="text-center stats-card">
                <Card.Body>
                  <Card.Title className="text-muted small">Total Revenue</Card.Title>
                  <h3 className="text-primary">${stats.totalRevenue.toFixed(2)}</h3>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2} className="mb-3">
              <Card className="text-center stats-card">
                <Card.Body>
                  <Card.Title className="text-muted small">Reimbursements</Card.Title>
                  <h3 className="text-warning">${stats.totalReimbursements.toFixed(2)}</h3>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2} className="mb-3">
              <Card className="text-center stats-card">
                <Card.Body>
                  <Card.Title className="text-muted small">Net Revenue</Card.Title>
                  <h3 className="text-success">${stats.netRevenue.toFixed(2)}</h3>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2} className="mb-3">
              <Card className="text-center stats-card">
                <Card.Body>
                  <Card.Title className="text-muted small">Total Orders</Card.Title>
                  <h3 className="text-info">{stats.totalOrders}</h3>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2} className="mb-3">
              <Card className="text-center stats-card">
                <Card.Body>
                  <Card.Title className="text-muted small">Today's Revenue</Card.Title>
                  <h3 className="text-success">${stats.todayRevenue.toFixed(2)}</h3>
                </Card.Body>
              </Card>
            </Col>
            <Col md={2} className="mb-3">
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
            <Col md={6}>
              <Card>
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Revenue Breakdown</h5>
                  <Button
                    variant="link"
                    className="p-0"
                    onClick={() => setShowChartModal(true)}
                    style={{ color: '#667eea', textDecoration: 'none' }}
                    title="Expand chart"
                  >
                    <i className="bi bi-arrows-fullscreen" style={{ fontSize: '1.2rem' }}></i>
                  </Button>
                </Card.Header>
                <Card.Body style={{ position: 'relative' }}>
                  <div className="d-flex justify-content-center align-items-center pie-chart-container" style={{ minHeight: '300px', position: 'relative' }}>
                    <svg
                      viewBox="0 0 300 300"
                      style={{ width: '100%', maxWidth: '400px', height: 'auto' }}
                      onMouseLeave={() => {
                        setHoveredSegment(null);
                        setTooltipPosition({ x: 0, y: 0, show: false });
                      }}
                    >
                      {renderPieChart([
                        { label: 'Subtotal', value: revenueBreakdown.subtotal, color: '#667eea' },
                        { label: 'Tax', value: revenueBreakdown.tax, color: '#4facfe' },
                        { label: 'Tips', value: revenueBreakdown.tips, color: '#f093fb' },
                        { label: 'Discounts', value: revenueBreakdown.discounts, color: '#f5576c' }
                      ].filter(item => item.value > 0), 150, 150, 120, false, 'revenue')}
                    </svg>
                    {/* Tooltip */}
                    {hoveredSegment && hoveredSegment.chartId === 'revenue' && tooltipPosition.show && (
                      <div
                        className="pie-tooltip"
                        style={{
                          position: 'absolute',
                          left: `${tooltipPosition.x + 15}px`,
                          top: `${tooltipPosition.y - 90}px`,
                          background: 'rgba(0, 0, 0, 0.9)',
                          color: '#fff',
                          padding: '12px 16px',
                          borderRadius: '10px',
                          border: `3px solid ${hoveredSegment.color}`,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                          pointerEvents: 'none',
                          zIndex: 1000,
                          minWidth: '180px',
                          transform: tooltipPosition.x > 200 ? 'translateX(-100%)' : 'none'
                        }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                          {hoveredSegment.label}
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: '700', color: hoveredSegment.color, marginBottom: '4px' }}>
                          ${hoveredSegment.value.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#ccc' }}>
                          {hoveredSegment.percentage.toFixed(1)}% of total
                        </div>
                      </div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            <Col md={6}>
              <Card>
                <Card.Header>
                  <h5>Reimbursement</h5>
                </Card.Header>
                <Card.Body style={{ position: 'relative' }}>
                  <div className="d-flex justify-content-center align-items-center pie-chart-container" style={{ minHeight: '300px', position: 'relative' }}>
                    {stats.totalReimbursements > 0 ? (
                      <>
                        <svg
                          viewBox="0 0 300 300"
                          style={{ width: '100%', maxWidth: '400px', height: 'auto' }}
                          onMouseLeave={() => {
                            setHoveredSegment(null);
                            setTooltipPosition({ x: 0, y: 0, show: false });
                          }}
                        >
                          {renderPieChart([
                            { label: 'Reimbursed', value: stats.totalReimbursements, color: '#f5576c' },
                            { label: 'Net Revenue', value: stats.netRevenue, color: '#43e97b' }
                          ], 150, 150, 120, false, 'reimbursement')}
                        </svg>
                        {/* Tooltip */}
                        {hoveredSegment && hoveredSegment.chartId === 'reimbursement' && tooltipPosition.show && (
                          <div
                            className="pie-tooltip"
                            style={{
                              position: 'absolute',
                              left: `${tooltipPosition.x + 15}px`,
                              top: `${tooltipPosition.y - 90}px`,
                              background: 'rgba(0, 0, 0, 0.9)',
                              color: '#fff',
                              padding: '12px 16px',
                              borderRadius: '10px',
                              border: `3px solid ${hoveredSegment.color}`,
                              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                              pointerEvents: 'none',
                              zIndex: 1000,
                              minWidth: '180px',
                              transform: tooltipPosition.x > 200 ? 'translateX(-100%)' : 'none'
                            }}
                          >
                            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                              {hoveredSegment.label}
                            </div>
                            <div style={{ fontSize: '18px', fontWeight: '700', color: hoveredSegment.color, marginBottom: '4px' }}>
                              ${hoveredSegment.value.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#ccc' }}>
                              {hoveredSegment.percentage.toFixed(1)}% of total
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center text-muted">
                        <h3 className="text-success">${stats.netRevenue.toFixed(2)}</h3>
                        <p>No reimbursements</p>
                      </div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Order Trend Chart */}
          <Row className="mb-4">
            <Col md={8}>
              <Card>
                <Card.Header>
                  <h5>Order Trend ({getDateRangeLabel()})</h5>
                </Card.Header>
                <Card.Body>
                  <div className="revenue-chart" style={{ height: '300px', overflow: 'hidden' }}>
                    {renderOrderTrendChart(800, 250, false)}
                  </div>
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

          {/* Full Screen Chart Modal */}
          <Modal
            show={showChartModal}
            onHide={() => setShowChartModal(false)}
            size="xl"
            fullscreen
            centered
          >
            <Modal.Header className="d-flex justify-content-between align-items-center">
              <Modal.Title>Revenue Breakdown ({getDateRangeLabel()})</Modal.Title>
              <Button
                variant="link"
                className="p-0"
                onClick={() => setShowChartModal(false)}
                style={{ color: '#666', textDecoration: 'none', fontSize: '1.5rem' }}
                title="Close"
              >
                <i className="bi bi-x-lg"></i>
              </Button>
            </Modal.Header>
            <Modal.Body style={{ height: '80vh', padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
              <div className="pie-chart-container" style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                <svg
                  viewBox="0 0 600 600"
                  style={{ width: '100%', maxWidth: '600px', height: 'auto' }}
                  onMouseLeave={() => {
                    setHoveredSegment(null);
                    setTooltipPosition({ x: 0, y: 0, show: false });
                  }}
                >
                  {renderPieChart([
                    { label: 'Subtotal', value: revenueBreakdown.subtotal, color: '#667eea' },
                    { label: 'Tax', value: revenueBreakdown.tax, color: '#4facfe' },
                    { label: 'Tips', value: revenueBreakdown.tips, color: '#f093fb' },
                    { label: 'Discounts', value: revenueBreakdown.discounts, color: '#f5576c' }
                  ].filter(item => item.value > 0), 300, 300, 200, true, 'revenue-modal')}
                </svg>
                {/* Tooltip */}
                {hoveredSegment && hoveredSegment.chartId === 'revenue-modal' && tooltipPosition.show && (
                  <div
                    className="pie-tooltip"
                    style={{
                      position: 'absolute',
                      left: `${tooltipPosition.x + 15}px`,
                      top: `${tooltipPosition.y - 90}px`,
                      background: 'rgba(0, 0, 0, 0.9)',
                      color: '#fff',
                      padding: '15px 20px',
                      borderRadius: '10px',
                      border: `3px solid ${hoveredSegment.color}`,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      pointerEvents: 'none',
                      zIndex: 1000,
                      minWidth: '200px',
                      transform: tooltipPosition.x > 400 ? 'translateX(-100%)' : 'none'
                    }}
                  >
                    <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '10px' }}>
                      {hoveredSegment.label}
                    </div>
                    <div style={{ fontSize: '22px', fontWeight: '700', color: hoveredSegment.color, marginBottom: '6px' }}>
                      ${hoveredSegment.value.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '13px', color: '#ccc' }}>
                      {hoveredSegment.percentage.toFixed(1)}% of total
                    </div>
                  </div>
                )}
              </div>
            </Modal.Body>
          </Modal>

          {/* Top Selling Items and Average Order Time */}
          <Row className="mb-4">
            <Col md={8}>
              <Card>
                <Card.Header>
                  <h5>Top Selling Items</h5>
                </Card.Header>
                <Card.Body>
                  {topSellingItems.length > 0 ? (
                    <div className="top-items-chart">
                      {topSellingItems.map((item, index) => {
                        const maxCount = topSellingItems[0]?.count || 1;
                        const percentage = (item.count / maxCount) * 100;
                        return (
                          <div key={index} className="mb-3">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <span className="item-name">{item.name}</span>
                              <span className="item-count"><strong>{item.count}</strong> sold</span>
                            </div>
                            <ProgressBar
                              now={percentage}
                              variant="success"
                              style={{ height: '25px', backgroundColor: '#e9ecef' }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-muted py-5">No items sold yet</div>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col md={4}>
              <Card>
                <Card.Header>
                  <h5>Average Order Time</h5>
                </Card.Header>
                <Card.Body className="text-center">
                  {averageOrderTime > 0 ? (
                    <div>
                      <h2 className="display-4 text-primary mb-3">{averageOrderTime}</h2>
                      <p className="text-muted mb-0">minutes</p>
                      <small className="text-muted">From order placement to payment cleared</small>
                    </div>
                  ) : (
                    <div className="text-center text-muted py-5">
                      <p>No completed orders yet</p>
                      <small>Average time will appear once orders are completed</small>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

        </>
      )}
    </Container>
  );
};

export default Dashboard;
