import React, { useState } from 'react';
import { Container, Dropdown } from 'react-bootstrap';
import AIAnalyticsDashboard from './ai-analytics/AIAnalyticsDashboard';
import ClassicAnalytics from './analytics/ClassicAnalytics';
import './Dashboard.css';
import './PageHeader.css';

const Dashboard = () => {
  const [analyticsMode, setAnalyticsMode] = useState('classic');

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
                <><i className="bi bi-stars me-2"></i>AI Analytics</>
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
                AI Analytics
                <span className="badge bg-primary ms-2">NEW</span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      {analyticsMode === 'ai' ? <AIAnalyticsDashboard /> : <ClassicAnalytics />}
    </Container>
  );
};

export default Dashboard;
