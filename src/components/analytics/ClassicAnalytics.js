import React, { useState } from 'react';
import { Spinner } from 'react-bootstrap';
import useDateRange from './hooks/useDateRange';
import useAnalyticsData from './hooks/useAnalyticsData';
import usePeriodComparison from './hooks/usePeriodComparison';
import DateRangeBar from './components/DateRangeBar';
import KPICards from './components/KPICards';
import RevenueOverview from './components/revenue/RevenueOverview';
import OrdersOverview from './components/orders/OrdersOverview';
import MenuPerformance from './components/menu/MenuPerformance';
import OperationalInsights from './components/operations/OperationalInsights';
import CustomerInsights from './components/customers/CustomerInsights';
import './ClassicAnalytics.css';

const TABS = [
  { key: 'revenue', label: 'Revenue', icon: 'bi-currency-dollar' },
  { key: 'orders', label: 'Orders', icon: 'bi-receipt' },
  { key: 'menu', label: 'Menu', icon: 'bi-list-ul' },
  { key: 'operations', label: 'Operations', icon: 'bi-gear' },
  { key: 'customers', label: 'Customers', icon: 'bi-people' }
];

const ClassicAnalytics = () => {
  const [activeTab, setActiveTab] = useState('revenue');
  const dateRange = useDateRange();
  const { orders, reimbursements, prevOrders, prevReimbursements, loading } = useAnalyticsData(
    dateRange.startDate,
    dateRange.endDate,
    dateRange.prevStartDate,
    dateRange.prevEndDate
  );
  const { current, changes } = usePeriodComparison(orders, reimbursements, prevOrders, prevReimbursements);

  if (loading) {
    return (
      <div className="ca-loading">
        <Spinner animation="border" variant="primary" />
        <span>Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="ca-root">
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

      <KPICards
        current={current}
        changes={changes}
        orders={orders}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
        granularity={dateRange.granularity}
      />

      <div className="ca-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`ca-tab ${activeTab === tab.key ? 'ca-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <i className={`bi ${tab.icon} me-1`}></i>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ca-tab-panel">
        {activeTab === 'revenue' && (
          <RevenueOverview
            orders={orders}
            prevOrders={prevOrders}
            reimbursements={reimbursements}
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            granularity={dateRange.granularity}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersOverview
            orders={orders}
            prevOrders={prevOrders}
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            granularity={dateRange.granularity}
          />
        )}
        {activeTab === 'menu' && (
          <MenuPerformance orders={orders} />
        )}
        {activeTab === 'operations' && (
          <OperationalInsights orders={orders} />
        )}
        {activeTab === 'customers' && (
          <CustomerInsights orders={orders} />
        )}
      </div>
    </div>
  );
};

export default ClassicAnalytics;
