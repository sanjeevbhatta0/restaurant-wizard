import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Spinner } from 'react-bootstrap';
import './Home.css';

const Home = () => {
  const [restaurantData, setRestaurantData] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [todayStats, setTodayStats] = useState({ orders: 0, revenue: 0, pendingOrders: 0 });
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getCurrentDate = () => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  useEffect(() => {
    if (!currentUser?.uid) return;

    const fetchRestaurantData = async () => {
      try {
        const docRef = doc(db, "restaurants", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setRestaurantData(docSnap.data());
        }
      } catch (error) {
        console.error("Error fetching restaurant data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRestaurantData();

    // Listen to recent orders
    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    const q = query(ordersRef, orderBy('createdAt', 'desc'), limit(5));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let orders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter by location if multi-location
      if (isMultiLocation && selectedLocation) {
        orders = orders.filter(order => {
          return order.locationId === selectedLocation;
        });
      }

      setRecentOrders(orders);

      // Calculate today's stats
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      let todayOrders = 0;
      let todayRevenue = 0;
      let pendingOrders = 0;

      orders.forEach(order => {
        const orderDate = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
        if (orderDate >= todayStart) {
          todayOrders++;
          todayRevenue += order.total || 0;
        }
        if (['new', 'sent_to_kitchen', 'preparing'].includes(order.status)) {
          pendingOrders++;
        }
      });

      setTodayStats({ orders: todayOrders, revenue: todayRevenue, pendingOrders });
    });

    return () => unsubscribe();
  }, [currentUser, isMultiLocation, selectedLocation]);

  const quickActions = [
    {
      icon: 'grid-3x3-gap-fill',
      title: 'Start POS',
      description: 'Take orders quickly',
      link: '/pos',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      iconBg: 'rgba(255,255,255,0.2)'
    },
    {
      icon: 'cart-check-fill',
      title: 'View Orders',
      description: 'Manage active orders',
      link: '/orders',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      iconBg: 'rgba(255,255,255,0.2)'
    },
    {
      icon: 'menu-button-wide-fill',
      title: 'Edit Menu',
      description: 'Update your offerings',
      link: '/menu-management',
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      iconBg: 'rgba(255,255,255,0.2)'
    },
    {
      icon: 'bar-chart-fill',
      title: 'Analytics',
      description: 'View performance',
      link: '/analytics',
      gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      iconBg: 'rgba(255,255,255,0.2)'
    },
    {
      icon: 'person-circle-fill',
      title: 'Account',
      description: 'Manage your account',
      link: '/account',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      iconBg: 'rgba(255,255,255,0.2)'
    }
  ];

  const getStatusColor = (status) => {
    const colors = {
      'new': '#667eea',
      'sent_to_kitchen': '#4facfe',
      'preparing': '#f5a623',
      'ready': '#43e97b',
      'completed': '#8e8e93'
    };
    return colors[status] || '#8e8e93';
  };

  const getTimeAgo = (date) => {
    const now = new Date();
    const orderDate = date?.toDate ? date.toDate() : new Date(date);
    const diffMs = now - orderDate;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return orderDate.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="home-loading">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  return (
    <div className="home-container">
      {/* Hero Section */}
      <div className="home-hero">
        <div className="hero-content">
          <div className="hero-text">
            <h1 className="greeting">{getGreeting()}, {restaurantData?.username || 'there'}!</h1>
            <p className="date">{getCurrentDate()}</p>
            {restaurantData?.restaurantName && (
              <p className="restaurant-name">
                <i className="bi bi-shop"></i> {restaurantData.restaurantName}
              </p>
            )}
          </div>
          <div className="hero-stats">
            <div className="stat-pill">
              <span className="stat-number">{todayStats.orders}</span>
              <span className="stat-label">Orders Today</span>
            </div>
            <div className="stat-pill revenue">
              <span className="stat-number">${todayStats.revenue.toFixed(2)}</span>
              <span className="stat-label">Revenue Today</span>
            </div>
            {todayStats.pendingOrders > 0 && (
              <div className="stat-pill pending">
                <span className="stat-number">{todayStats.pendingOrders}</span>
                <span className="stat-label">Pending</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <section className="quick-actions-section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="quick-actions-grid">
          {quickActions.map((action, index) => (
            <Link to={action.link} key={index} className="quick-action-card" style={{ background: action.gradient }}>
              <div className="action-icon" style={{ background: action.iconBg }}>
                <i className={`bi bi-${action.icon}`}></i>
              </div>
              <div className="action-content">
                <h3>{action.title}</h3>
                <p>{action.description}</p>
              </div>
              <i className="bi bi-arrow-right action-arrow"></i>
            </Link>
          ))}
        </div>
      </section>

      {/* Main Content Grid */}
      <div className="home-content-grid">
        {/* Recent Activity */}
        <section className="recent-activity-section">
          <div className="section-header">
            <h2 className="section-title">Recent Activity</h2>
            <Link to="/orders" className="view-all-link">View All <i className="bi bi-arrow-right"></i></Link>
          </div>
          <div className="activity-list">
            {recentOrders.length > 0 ? (
              recentOrders.map((order, index) => (
                <div key={order.id} className="activity-item" style={{ animationDelay: `${index * 0.1}s` }}>
                  <div className="activity-icon" style={{ background: getStatusColor(order.status) }}>
                    <i className="bi bi-receipt"></i>
                  </div>
                  <div className="activity-details">
                    <div className="activity-header">
                      <span className="order-number">{order.orderNumber || `#${order.id.slice(0, 6)}`}</span>
                      <span className="order-time">{getTimeAgo(order.createdAt)}</span>
                    </div>
                    <div className="activity-meta">
                      <span className="order-table">
                        <i className="bi bi-geo-alt"></i> Table {order.tableNumber || 'N/A'}
                      </span>
                      <span className="order-items">{order.items?.length || 0} items</span>
                      <span className="order-total">${(order.total || 0).toFixed(2)}</span>
                    </div>
                    <span className="order-status" style={{ background: getStatusColor(order.status) }}>
                      {order.status?.replace('_', ' ').toUpperCase() || 'NEW'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-activity">
                <i className="bi bi-inbox"></i>
                <p>No recent orders</p>
                <span>Orders will appear here when customers start ordering</span>
              </div>
            )}
          </div>
        </section>

        {/* Getting Started / Tips */}
        <section className="tips-section">
          <h2 className="section-title">Getting Started</h2>
          <div className="tips-list">
            <div className="tip-card">
              <div className="tip-number">1</div>
              <div className="tip-content">
                <h4>Set up your menu</h4>
                <p>Add categories and items with photos, prices, and descriptions</p>
                <Link to="/menu-management" className="tip-link">
                  Go to Menu <i className="bi bi-arrow-right"></i>
                </Link>
              </div>
            </div>
            <div className="tip-card">
              <div className="tip-number">2</div>
              <div className="tip-content">
                <h4>Start taking orders</h4>
                <p>Use the POS system to quickly process customer orders</p>
                <Link to="/pos" className="tip-link">
                  Open POS <i className="bi bi-arrow-right"></i>
                </Link>
              </div>
            </div>
            <div className="tip-card">
              <div className="tip-number">3</div>
              <div className="tip-content">
                <h4>Build your website</h4>
                <p>Create a beautiful online presence for your restaurant</p>
                <Link to="/website-builder" className="tip-link">
                  Build Website <i className="bi bi-arrow-right"></i>
                </Link>
              </div>
            </div>
            <div className="tip-card">
              <div className="tip-number">4</div>
              <div className="tip-content">
                <h4>Track performance</h4>
                <p>Monitor orders, revenue, and trends in analytics</p>
                <Link to="/analytics" className="tip-link">
                  View Analytics <i className="bi bi-arrow-right"></i>
                </Link>
              </div>
            </div>
            <div className="tip-card">
              <div className="tip-number">5</div>
              <div className="tip-content">
                <h4>Manage your account</h4>
                <p>Update your profile, address, and security settings</p>
                <Link to="/account" className="tip-link">
                  Go to Account <i className="bi bi-arrow-right"></i>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Floating Quick POS Button */}
      <Link to="/pos" className="floating-pos-button">
        <i className="bi bi-plus-lg"></i>
        <span>New Order</span>
      </Link>
    </div>
  );
};

export default Home;
