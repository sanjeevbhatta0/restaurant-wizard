import React from 'react';
import NewVsReturning from './NewVsReturning';
import CustomerSpendChart from './CustomerSpendChart';
import CustomerSummary from './CustomerSummary';

const CustomerInsights = ({ orders }) => {
  return (
    <div className="ca-tab-content">
      <div className="ca-chart-row">
        <div className="ca-chart-wide">
          <CustomerSummary orders={orders} />
        </div>
      </div>
      <div className="ca-chart-row">
        <div className="ca-chart-half">
          <NewVsReturning orders={orders} />
        </div>
        <div className="ca-chart-half">
          <CustomerSpendChart orders={orders} />
        </div>
      </div>
    </div>
  );
};

export default CustomerInsights;
