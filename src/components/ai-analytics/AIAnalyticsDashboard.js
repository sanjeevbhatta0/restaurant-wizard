import React, { useState, useEffect } from 'react';
import useAIDashboard, { AI_TABS } from './hooks/useAIDashboard';
import DateRangeBar from '../analytics/components/DateRangeBar';
import AISummaryBanner from './AISummaryBanner';
import RevenueIntelligenceSection from './RevenueIntelligenceSection';
import MenuIntelligenceSection from './MenuIntelligenceSection';
import OperationalIntelligenceSection from './OperationalIntelligenceSection';
import CustomerIntelligenceSection from './CustomerIntelligenceSection';
import AnomalyAlertsSection from './AnomalyAlertsSection';
import WeeklyDigestSection from './WeeklyDigestSection';
import AIFloatingChat from './AIFloatingChat';
import './AIAnalyticsDashboard.css';

const TAB_LOADING_MESSAGES = {
  summary: [
    "Analyzing your restaurant's overall performance...",
    'Building your executive summary...',
    'Identifying key trends and insights...'
  ],
  revenue: [
    'Forecasting next week\'s revenue...',
    'Evaluating pricing opportunities...',
    'Finding revenue growth ideas...'
  ],
  menu: [
    'Scoring your menu performance...',
    'Identifying star items and underperformers...',
    'Crafting menu optimization tips...'
  ],
  operations: [
    'Analyzing your peak and slow hours...',
    'Building optimal staffing recommendations...',
    'Calculating efficiency metrics...'
  ],
  customers: [
    'Segmenting your customer base...',
    'Analyzing retention and behavior patterns...',
    'Building personalization strategies...'
  ],
  alerts: [
    'Scanning for anomalies in your data...',
    'Assessing your business health score...',
    'Checking for risks and opportunities...'
  ],
  digest: [
    'Compiling your weekly performance report...',
    'Summarizing key highlights...',
    'Building your action item list...'
  ]
};

const TabLoadingScreen = ({ tabKey, progress }) => {
  const messages = TAB_LOADING_MESSAGES[tabKey] || TAB_LOADING_MESSAGES.summary;
  const [msgIndex, setMsgIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setMsgIndex(0);
    setFading(false);
  }, [tabKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setMsgIndex(prev => (prev + 1) % messages.length);
        setFading(false);
      }, 350);
    }, 3000);
    return () => clearInterval(interval);
  }, [messages]);

  return (
    <div className="ai-tab-loading">
      <div className="ai-tab-loading-icon">
        <i className="bi bi-stars"></i>
      </div>
      <div className={`ai-tab-loading-message ${fading ? 'fading' : ''}`}>
        {messages[msgIndex]}
      </div>
      <div className="ai-tab-loading-bar-track">
        <div
          className="ai-tab-loading-bar-fill"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <div className="ai-tab-loading-percent">{Math.round(progress)}%</div>
    </div>
  );
};

const TabContent = ({ tabKey, data, healthScore }) => {
  // Wrap each section's data in the format the components expect
  const wrapped = { success: true, data };

  switch (tabKey) {
    case 'summary':
      return <AISummaryBanner data={wrapped} healthScore={healthScore} loading={false} />;
    case 'revenue':
      return <RevenueIntelligenceSection data={wrapped} />;
    case 'menu':
      return <MenuIntelligenceSection data={wrapped} />;
    case 'operations':
      return <OperationalIntelligenceSection data={wrapped} />;
    case 'customers':
      return <CustomerIntelligenceSection data={wrapped} />;
    case 'alerts':
      return <AnomalyAlertsSection data={wrapped} />;
    case 'digest':
      return <WeeklyDigestSection data={wrapped} />;
    default:
      return null;
  }
};

const AIAnalyticsDashboard = () => {
  const {
    dateRange,
    orders,
    dataLoading,
    activeTab,
    setActiveTab,
    tabState,
    currentTabState,
    loadProgress,
    healthScore,
    refreshCurrentTab,
    chatMessages,
    chatLoading,
    sendChatMessage
  } = useAIDashboard();

  if (dataLoading) {
    return (
      <div className="ai-dashboard">
        <div className="ai-loading-overlay">
          <div className="ai-loading-spinner"></div>
          <div className="ai-loading-text">Loading your data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-dashboard">
      {/* Top Bar */}
      <div className="ai-top-bar">
        <DateRangeBar
          rangeKey={dateRange.rangeKey}
          setRange={dateRange.setRange}
          rangeLabel={dateRange.rangeLabel}
          customStart={dateRange.customStart}
          customEnd={dateRange.customEnd}
          setCustomStart={dateRange.setCustomStart}
          setCustomEnd={dateRange.setCustomEnd}
          orders={orders}
          RANGE_CONFIGS={dateRange.RANGE_CONFIGS}
        />
        <button
          className="ai-refresh-all"
          onClick={refreshCurrentTab}
          disabled={currentTabState.loading}
        >
          <i className={`bi bi-arrow-clockwise ${currentTabState.loading ? 'spinning' : ''}`}></i>
          {currentTabState.loading ? 'Analyzing...' : 'Refresh'}
        </button>
      </div>

      {/* Empty State */}
      {!orders || orders.length === 0 ? (
        <div className="ai-empty">
          <i className="bi bi-bar-chart-line"></i>
          <p>No order data found for this period. Select a different date range or start taking orders to see AI-powered insights.</p>
        </div>
      ) : (
        <>
          {/* Tab Navigation */}
          <div className="ai-tab-nav">
            {AI_TABS.map(tab => {
              const state = tabState[tab.key];
              const isCached = state?.data && !state.loading;
              return (
                <button
                  key={tab.key}
                  className={`ai-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <i className={`bi ${tab.icon}`}></i>
                  <span>{tab.label}</span>
                  {isCached && <span className="ai-tab-cached-dot"></span>}
                </button>
              );
            })}
          </div>

          {/* Tab Content Area */}
          <div className="ai-tab-content">
            {currentTabState.loading ? (
              <TabLoadingScreen tabKey={activeTab} progress={loadProgress} />
            ) : currentTabState.error ? (
              <div className="ai-error">
                <div className="ai-error-icon"><i className="bi bi-exclamation-triangle"></i></div>
                <div className="ai-error-text">{currentTabState.error}</div>
                <button className="ai-error-retry" onClick={refreshCurrentTab}>Try Again</button>
              </div>
            ) : currentTabState.data ? (
              <div className="ai-dashboard-content">
                <TabContent
                  tabKey={activeTab}
                  data={currentTabState.data}
                  healthScore={healthScore}
                />
              </div>
            ) : (
              <div className="ai-empty" style={{ padding: '3rem' }}>
                <i className="bi bi-stars" style={{ fontSize: '2rem', opacity: 0.4 }}></i>
                <p>Click a tab to generate AI insights for that category.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Floating Chat */}
      <AIFloatingChat
        messages={chatMessages}
        loading={chatLoading}
        onSend={sendChatMessage}
      />
    </div>
  );
};

export default AIAnalyticsDashboard;
