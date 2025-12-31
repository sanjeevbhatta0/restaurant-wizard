import React from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Nav } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import './Layout.css';

const Layout = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const sidebarLinks = [
    { to: '/home', icon: 'house', text: 'Home' },
    { to: '/analytics', icon: 'bar-chart', text: 'Analytics' },
    { to: '/menu-management', icon: 'menu-button-wide', text: 'Menu Management' },
    { to: '/pos', icon: 'cash-coin', text: 'POS' },
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
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '10px' }}>
            <path d="M16 2L4 8V16C4 22.6 9.4 28 16 28C22.6 28 28 22.6 28 16V8L16 2Z" fill="#667eea"/>
            <path d="M16 6L8 10V16C8 20.4 11.6 24 16 24C20.4 24 24 20.4 24 16V10L16 6Z" fill="#764ba2"/>
            <circle cx="16" cy="16" r="4" fill="white"/>
            <path d="M14 14L16 16L18 14" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Koda Carte
        </div>
        <button className="logout-button" onClick={handleLogout}>Logout</button>
      </header>
      <div className="content-wrapper">
        <nav className="sidebar">
          <Nav className="flex-column">
            {sidebarLinks.map((link, index) => {
              const isActive = location.pathname === link.to;
              return (
                <Nav.Link 
                  key={index} 
                  as={Link} 
                  to={link.to} 
                  className={`sidebar-link ${isActive ? 'active' : ''}`}
                >
                  <i className={`bi bi-${link.icon}`}></i> {link.text}
                </Nav.Link>
              );
            })}
          </Nav>
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
