import React from 'react';
import KitchenEfficiency from './KitchenEfficiency';
import ServiceTimeline from './ServiceTimeline';
import PeakVsOffPeak from './PeakVsOffPeak';

const OperationalInsights = ({ orders }) => {
  return (
    <div className="ca-tab-content">
      <div className="ca-chart-row ca-chart-row-3">
        <div className="ca-chart-card">
          <KitchenEfficiency orders={orders} metric="kitchen" />
        </div>
        <div className="ca-chart-card">
          <KitchenEfficiency orders={orders} metric="service" />
        </div>
        <div className="ca-chart-card">
          <KitchenEfficiency orders={orders} metric="fullCycle" />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-wide">
          <ServiceTimeline orders={orders} />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-wide">
          <PeakVsOffPeak orders={orders} />
        </div>
      </div>
    </div>
  );
};

export default OperationalInsights;
