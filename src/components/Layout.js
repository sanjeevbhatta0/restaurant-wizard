import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Nav, Form, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation as useLocationContext } from '../contexts/LocationContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import NetworkStatus from './NetworkStatus';
import './Layout.css';

// Feature mapping: maps sidebar routes to feature IDs
const ROUTE_TO_FEATURE = {
  '/home': 'menu-management', // Home is always accessible
  '/analytics': 'analytics',
  '/menu-management': 'menu-management',
  '/pos': 'pos',
  '/kitchen': 'kitchen',
  '/server': 'server',
  '/table-layout': 'menu-management', // Part of basic features
  '/payments': 'payments',
  '/orders': 'orders',
  '/promotions': 'menu-management', // Promotions is accessible to all tiers
  '/seo-social': 'seo-social',
  '/website-integration': 'website-integration',
  '/website-builder': 'website-builder',
  '/reviews': 'menu-management', // Reviews is accessible to all tiers
  '/account': 'menu-management' // Account is always accessible
};

// Maps sidebar routes to staff permission keys
const ROUTE_TO_PERMISSION = {
  '/home': 'home',
  '/analytics': 'analytics',
  '/menu-management': 'menu-management',
  '/pos': 'pos',
  '/kitchen': 'kitchen',
  '/server': 'server',
  '/table-layout': 'table-layout',
  '/payments': 'payments',
  '/orders': 'orders',
  '/promotions': 'promotions',
  '/seo-social': 'seo-social',
  '/website-integration': 'website-integration',
  '/website-builder': 'website-builder',
  '/reviews': 'reviews',
  '/account': 'account'
};

// Tier names for upgrade prompts
const TIER_NAMES = {
  ally: 'Ally',
  guide: 'Guide',
  chief: 'Chief',
  elder: 'Elder'
};

const Layout = ({ children }) => {
  const { currentUser, isStaff, staffPermissions } = useAuth();
  const { isMultiLocation, locations, selectedLocation, setSelectedLocation } = useLocationContext();
  const { hasFeatureAccess, getMinimumTierForFeature, getCurrentTier, getServiceMode } = useSubscription();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  });

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  // Close sidebar when route changes on mobile
  useEffect(() => {
    closeSidebar();
  }, [location.pathname]);

  // Save sidebar collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', isCollapsed.toString());
  }, [isCollapsed]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Check if a route is accessible based on tier
  const isRouteAccessible = (route) => {
    const featureId = ROUTE_TO_FEATURE[route];
    if (!featureId) return true; // Unknown routes are accessible
    return hasFeatureAccess(featureId);
  };

  // Get the minimum tier required for a route
  const getRequiredTierForRoute = (route) => {
    const featureId = ROUTE_TO_FEATURE[route];
    if (!featureId) return null;
    return getMinimumTierForFeature(featureId);
  };

  const sidebarLinks = [
    { to: '/home', icon: 'house', text: 'Home' },
    { to: '/analytics', icon: 'bar-chart', text: 'Analytics' },
    { to: '/menu-management', icon: 'menu-button-wide', text: 'Menu Management' },
    { to: '/pos', icon: 'cash-coin', text: 'POS' },
    { to: '/kitchen', icon: 'egg-fried', text: 'Kitchen' },
    { to: '/server', icon: 'person-badge', text: 'Server' },
    { to: '/table-layout', icon: 'grid-3x3-gap', text: 'Table Layout' },
    { to: '/payments', icon: 'credit-card', text: 'Payments' },
    { to: '/orders', icon: 'cart', text: 'Orders' },
    { to: '/promotions', icon: 'gift', text: 'Promotions' },
    { to: '/reviews', icon: 'chat-quote', text: 'Reviews' },
    { to: '/seo-social', icon: 'share', text: 'SEO & Social' },
    { to: '/website-integration', icon: 'code-slash', text: 'Website Integration' },
    { to: '/website-builder', icon: 'brush', text: 'Website Builder' },
    { to: '/account', icon: 'person-circle', text: 'Account' }
  ];

  const handleLockedLinkClick = (e, link) => {
    e.preventDefault();
    const requiredTier = getRequiredTierForRoute(link.to);
    const tierName = TIER_NAMES[requiredTier] || requiredTier;

    // Show alert with upgrade prompt
    if (window.confirm(
      `The "${link.text}" feature requires the ${tierName} plan or higher.\n\nWould you like to view upgrade options?`
    )) {
      navigate('/account');
      // Scroll to subscription section after navigation
      setTimeout(() => {
        const subscriptionBtn = document.querySelector('[data-section="subscription"]');
        if (subscriptionBtn) subscriptionBtn.click();
      }, 100);
    }
  };

  return (
    <div className="layout-container">
      <NetworkStatus />
      <header className="header">
        <div className="header-left">
          <button className="mobile-menu-toggle" onClick={toggleSidebar} aria-label="Toggle menu">
            <i className="bi bi-list"></i>
          </button>
          <div className="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 2L4 8V16C4 22.6 9.4 28 16 28C22.6 28 28 22.6 28 16V8L16 2Z" fill="#667eea" />
              <path d="M16 6L8 10V16C8 20.4 11.6 24 16 24C20.4 24 24 20.4 24 16V10L16 6Z" fill="#764ba2" />
              <circle cx="16" cy="16" r="4" fill="white" />
              <path d="M14 14L16 16L18 14" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="logo-text">
              <span className="logo-word-koda">Koda</span>
              <span className="logo-word-carte"> Carte</span>
            </span>
          </div>
        </div>
        <div className="header-actions">
          {isMultiLocation && locations.length > 0 && (
            <>
              <Form.Select
                value={selectedLocation || ''}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="location-selector"
              >
                <option value="">Select Location</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </Form.Select>
              {!selectedLocation && (
                <span className="location-warning">
                  <i className="bi bi-exclamation-triangle"></i> <span className="warning-text">Please select a location</span>
                </span>
              )}
            </>
          )}
        </div>
      </header>
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar}></div>}
      <div className="content-wrapper">
        <nav
          className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''} ${isCollapsed ? 'collapsed' : ''}`}
        >
          <div className="sidebar-header">
            {!isCollapsed && <span className="sidebar-title">Menu</span>}
            <button className="sidebar-close" onClick={closeSidebar} aria-label="Close menu">
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
          <Nav className="flex-column sidebar-nav">
            {sidebarLinks.filter(link => {
              // Staff permission filter — hide routes staff don't have access to
              if (isStaff) {
                const permKey = ROUTE_TO_PERMISSION[link.to];
                // Staff never see Account page (admin only)
                if (link.to === '/account') return false;
                if (permKey && !staffPermissions.includes(permKey)) return false;
              }
              const mode = getServiceMode();
              if (link.to === '/server' && mode !== 'full_service') return false;
              if (link.to === '/table-layout' && mode === 'food_truck') return false;
              return true;
            }).map((link, index) => {
              const isActive = location.pathname === link.to;
              const isAccessible = isRouteAccessible(link.to);
              const requiredTier = getRequiredTierForRoute(link.to);

              const linkContent = (
                <Nav.Link
                  key={index}
                  as={isAccessible ? Link : 'a'}
                  to={isAccessible ? link.to : undefined}
                  href={isAccessible ? undefined : '#'}
                  className={`sidebar-link ${isActive ? 'active' : ''} ${!isAccessible ? 'locked' : ''}`}
                  onClick={isAccessible ? closeSidebar : (e) => handleLockedLinkClick(e, link)}
                  title={isCollapsed ? link.text : ''}
                  style={!isAccessible ? {
                    opacity: 0.5,
                    cursor: 'not-allowed',
                    position: 'relative'
                  } : undefined}
                >
                  <i className={`bi bi-${link.icon}`}></i>
                  <span className="sidebar-link-text">{link.text}</span>
                  {!isAccessible && (
                    <i className="bi bi-lock-fill" style={{
                      marginLeft: 'auto',
                      fontSize: '0.75rem',
                      color: '#f59e0b'
                    }}></i>
                  )}
                </Nav.Link>
              );

              // Add tooltip for locked features
              if (!isAccessible && requiredTier) {
                return (
                  <OverlayTrigger
                    key={index}
                    placement="right"
                    overlay={
                      <Tooltip id={`tooltip-${index}`}>
                        Requires {TIER_NAMES[requiredTier]} plan
                      </Tooltip>
                    }
                  >
                    {linkContent}
                  </OverlayTrigger>
                );
              }

              return linkContent;
            })}
          </Nav>
          <div className="sidebar-footer">
            <button
              className="sidebar-logout-btn"
              onClick={async () => { await signOut(auth); navigate('/login'); }}
              aria-label="Sign out"
            >
              <i className="bi bi-box-arrow-right"></i>
              {!isCollapsed && <span>Sign Out</span>}
            </button>
            <button
              className="sidebar-collapse-btn"
              onClick={toggleCollapse}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <i className={`bi bi-chevron-${isCollapsed ? 'right' : 'left'}`}></i>
              {!isCollapsed && <span>Collapse</span>}
            </button>
          </div>
        </nav>
        <main className="content">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
};

export default Layout;
