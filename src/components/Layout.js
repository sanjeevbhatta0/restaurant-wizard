import React, { useState, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Nav, Form } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useLocation as useLocationContext } from '../contexts/LocationContext';
import './Layout.css';

const Layout = () => {
  const { currentUser } = useAuth();
  const { isMultiLocation, locations, selectedLocation, setSelectedLocation } = useLocationContext();
  const location = useLocation();
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
    { to: '/seo-social', icon: 'share', text: 'SEO & Social' },
    { to: '/website-integration', icon: 'code-slash', text: 'Website Integration' },
    { to: '/website-builder', icon: 'brush', text: 'Website Builder' },
    { to: '/account', icon: 'person-circle', text: 'Account' }
  ];

  return (
    <div className="layout-container">
      <header className="header">
        <div className="header-left">
          <button className="mobile-menu-toggle" onClick={toggleSidebar} aria-label="Toggle menu">
            <i className="bi bi-list"></i>
          </button>
          <div className="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '10px' }}>
              <path d="M16 2L4 8V16C4 22.6 9.4 28 16 28C22.6 28 28 22.6 28 16V8L16 2Z" fill="#667eea"/>
              <path d="M16 6L8 10V16C8 20.4 11.6 24 16 24C20.4 24 24 20.4 24 16V10L16 6Z" fill="#764ba2"/>
              <circle cx="16" cy="16" r="4" fill="white"/>
              <path d="M14 14L16 16L18 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="logo-text">
              <span className="logo-word-koda">Koda</span>{' '}
              <span className="logo-word-carte">Carte</span>
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
            {sidebarLinks.map((link, index) => {
              const isActive = location.pathname === link.to;
              return (
                <Nav.Link 
                  key={index} 
                  as={Link} 
                  to={link.to} 
                  className={`sidebar-link ${isActive ? 'active' : ''}`}
                  onClick={closeSidebar}
                  title={isCollapsed ? link.text : ''}
                >
                  <i className={`bi bi-${link.icon}`}></i> 
                  <span className="sidebar-link-text">{link.text}</span>
                </Nav.Link>
              );
            })}
          </Nav>
          <div className="sidebar-footer">
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
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
