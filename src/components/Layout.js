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

  return (
    <div className="layout-container">
      <header className="header">
        <div className="logo">Restaurant Wizard</div>
        <button className="logout-button" onClick={handleLogout}>Logout</button>
      </header>
      <div className="content-wrapper">
        <nav className="sidebar">
          <Nav className="flex-column">
            <Nav.Link as={Link} to="/home" className="sidebar-link">
              <i className="bi bi-speedometer2"></i> Dashboard
            </Nav.Link>
            <Nav.Link as={Link} to="/menu-management" className="sidebar-link">
              <i className="bi bi-menu-button-wide"></i> Menu Management
            </Nav.Link>
            <Nav.Link as={Link} to="/orders" className="sidebar-link">
              <i className="bi bi-bag"></i> Orders
            </Nav.Link>
            <Nav.Link as={Link} to="/seo-social" className="sidebar-link">
              <i className="bi bi-share"></i> SEO & Social
            </Nav.Link>
            <Nav.Link as={Link} to="/website-integration" className="sidebar-link">
              <i className="bi bi-code-slash"></i> Website Integration
            </Nav.Link>
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