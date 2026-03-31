import React, { useMemo } from 'react';
import { calcCustomerInsights } from '../../utils/analyticsCalculations';
import { formatNumber, formatCurrency } from '../../utils/formatters';

const CustomerSummary = ({ orders }) => {
  const insights = useMemo(() => calcCustomerInsights(orders), [orders]);

  const cards = [
    { label: 'Unique Customers', value: formatNumber(insights.uniqueCustomers), icon: 'bi-people', color: '#667eea' },
    { label: 'New Customers', value: formatNumber(insights.newCustomers), icon: 'bi-person-plus', color: '#43e97b' },
    { label: 'Returning', value: formatNumber(insights.returning), icon: 'bi-arrow-repeat', color: '#f093fb' },
    { label: 'Avg Orders/Customer', value: insights.avgOrdersPerCustomer.toFixed(1), icon: 'bi-bag-check', color: '#4facfe' },
    { label: 'Avg Lifetime Value', value: formatCurrency(insights.avgLifetimeValue), icon: 'bi-gem', color: '#f7b731' }
  ];

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Customer Summary</h6>
      <div className="ca-summary-cards">
        {cards.map((card, i) => (
          <div key={i} className="ca-summary-card" style={{ borderLeftColor: card.color }}>
            <i className={`bi ${card.icon}`} style={{ color: card.color, fontSize: '1.4rem' }}></i>
            <div className="ca-summary-card-value">{card.value}</div>
            <div className="ca-summary-card-label">{card.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomerSummary;
