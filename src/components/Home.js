import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Spinner } from 'react-bootstrap';
import './Home.css';

const Home = () => {
  const [restaurantData, setRestaurantData] = useState(null);
  const [recentActivities, setRecentActivities] = useState([]);
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

    // Listen to recent activities
    // Use simple query without locationId filter for backward compatibility
    // Then filter client-side to handle both old activities (no locationId) and new ones
    const activitiesRef = collection(db, `restaurants/${currentUser.uid}/activities`);
    const activitiesQuery = query(
      activitiesRef,
      orderBy('createdAt', 'desc'),
      limit(50) // Get more to filter client-side
    );

    const unsubscribeActivities = onSnapshot(activitiesQuery, (snapshot) => {
      let activities = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Client-side filtering by locationId for backward compatibility
      // Old activities without locationId are included for single-location restaurants
      if (isMultiLocation && selectedLocation) {
        // Multi-location: only show activities for selected location
        // Include old activities without locationId (they're from before multi-location)
        activities = activities.filter(activity => {
          // If activity has no locationId, it's old data - exclude it for multi-location
          // Only include if it matches the selected location
          return activity.locationId === selectedLocation;
        });
      } else {
        // Single-location: include all activities (old ones without locationId + new ones with currentUser.uid)
        activities = activities.filter(activity => {
          // Include if no locationId (old data) or if locationId matches currentUser.uid
          return !activity.locationId || activity.locationId === currentUser.uid;
        });
      }

      // Limit to 10 after filtering
      activities = activities.slice(0, 10);

      setRecentActivities(activities);
    }, (error) => {
      console.error('Error fetching activities:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      
      // Don't show error to user - activities are not critical
      // Just set empty array so the page still loads
      setRecentActivities([]);
    });

    // Still listen to orders for stats calculation
    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    const ordersQuery = query(ordersRef, orderBy('createdAt', 'desc'), limit(50));

    const unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
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

    return () => {
      unsubscribeActivities();
      unsubscribeOrders();
    };
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

  const getTimeAgo = (date) => {
    const now = new Date();
    const activityDate = date?.toDate ? date.toDate() : new Date(date || date?.timestamp);
    const diffMs = now - activityDate;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return activityDate.toLocaleDateString();
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
          </div>
          <div className="activity-list">
            {recentActivities.length > 0 ? (
              recentActivities.map((activity, index) => (
                <div key={activity.id} className="activity-item-plain" style={{ animationDelay: `${index * 0.05}s` }}>
                  <div className="activity-text">
                    {activity.message}
                  </div>
                  <div className="activity-time">
                    {getTimeAgo(activity.createdAt || activity.timestamp)}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-activity">
                <i className="bi bi-inbox"></i>
                <p>No recent activity</p>
                <span>Activities will appear here as they happen</span>
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
