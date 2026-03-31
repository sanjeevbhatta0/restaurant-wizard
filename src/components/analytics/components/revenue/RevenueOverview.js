import React from 'react';
import RevenueTrendChart from './RevenueTrendChart';
import RevenueBreakdownChart from './RevenueBreakdownChart';
import RevenueByPaymentMethod from './RevenueByPaymentMethod';
import RevenueBySource from './RevenueBySource';
import TipsAnalysis from './TipsAnalysis';
import HourlyRevenueHeatmap from './HourlyRevenueHeatmap';

const RevenueOverview = ({ orders, prevOrders, reimbursements, startDate, endDate, granularity }) => {
  return (
    <div className="ca-tab-content">
      <div className="ca-chart-row">
        <div className="ca-chart-wide">
          <RevenueTrendChart
            orders={orders}
            prevOrders={prevOrders}
            reimbursements={reimbursements}
            startDate={startDate}
            endDate={endDate}
            granularity={granularity}
          />
        </div>
      </div>

      <div className="ca-chart-row ca-chart-row-3">
        <div className="ca-chart-card">
          <RevenueBreakdownChart orders={orders} />
        </div>
        <div className="ca-chart-card">
          <RevenueByPaymentMethod orders={orders} />
        </div>
        <div className="ca-chart-card">
          <RevenueBySource orders={orders} />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-half">
          <TipsAnalysis orders={orders} startDate={startDate} endDate={endDate} granularity={granularity} />
        </div>
        <div className="ca-chart-half">
          <HourlyRevenueHeatmap orders={orders} />
        </div>
      </div>
    </div>
  );
};

export default RevenueOverview;
