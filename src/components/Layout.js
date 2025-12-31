import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Nav } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import './Layout.css';

const Layout = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const sidebarLinks = [
    { to: '/dashboard', icon: 'speedometer2', text: 'Dashboard' },
    { to: '/menu-management', icon: 'menu-button-wide', text: 'Menu Management' },
    { to: '/orders', icon: 'cart', text: 'Orders' },
    { to: '/pos', icon: 'grid-3x3-gap', text: 'POS' },
    { to: '/seo-social', icon: 'share', text: 'SEO & Social' },
    { to: '/website-integration', icon: 'code-slash', text: 'Website Integration' },
    { to: '/website-builder', icon: 'brush', text: 'Website Builder' }
  ];

  return (
    <div className="layout-container">
      <header className="header">
        <div className="logo">Restaurant Wizard</div>
        <button className="logout-button" onClick={handleLogout}>Logout</button>
      </header>
      <div className="content-wrapper">
        <nav className="sidebar">
          <Nav className="flex-column">
            {sidebarLinks.map((link, index) => (
              <Nav.Link key={index} as={Link} to={link.to} className="sidebar-link">
                <i className={`bi bi-${link.icon}`}></i> {link.text}
              </Nav.Link>
            ))}
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
