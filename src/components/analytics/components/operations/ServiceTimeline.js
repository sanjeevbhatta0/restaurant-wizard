import React, { useMemo } from 'react';
import { calcKitchenTime, calcServiceTime, calcFullCycleTime } from '../../utils/analyticsCalculations';
import { formatMinutes } from '../../utils/formatters';

const ServiceTimeline = ({ orders }) => {
  const times = useMemo(() => {
    const kitchen = calcKitchenTime(orders);
    const service = calcServiceTime(orders);
    const full = calcFullCycleTime(orders);
    const payment = Math.max(full - kitchen - service, 0);
    const total = kitchen + service + payment || 1;
    return {
      kitchen, service, payment, total,
      kitchenPct: (kitchen / total) * 100,
      servicePct: (service / total) * 100,
      paymentPct: (payment / total) * 100
    };
  }, [orders]);

  if (times.total <= 0 || (times.kitchen === 0 && times.service === 0)) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Service Pipeline</h6>
        <div className="ca-chart-empty">No timing data available — orders need readyAt/servedAt/completedAt timestamps</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Service Pipeline</h6>
      <div className="ca-timeline">
        <div className="ca-timeline-bar">
          <div className="ca-timeline-segment ca-timeline-kitchen" style={{ width: `${times.kitchenPct}%` }}>
            <span className="ca-timeline-label">Kitchen</span>
          </div>
          <div className="ca-timeline-segment ca-timeline-service" style={{ width: `${times.servicePct}%` }}>
            <span className="ca-timeline-label">Service</span>
          </div>
          <div className="ca-timeline-segment ca-timeline-payment" style={{ width: `${times.paymentPct}%` }}>
            <span className="ca-timeline-label">Payment</span>
          </div>
        </div>
        <div className="ca-timeline-values">
          <span><i className="bi bi-fire me-1" style={{ color: '#667eea' }}></i>{formatMinutes(times.kitchen)}</span>
          <span><i className="bi bi-person-walking me-1" style={{ color: '#43e97b' }}></i>{formatMinutes(times.service)}</span>
          <span><i className="bi bi-credit-card me-1" style={{ color: '#f093fb' }}></i>{formatMinutes(times.payment)}</span>
          <span className="ca-timeline-total"><strong>Total: {formatMinutes(times.total)}</strong></span>
        </div>
      </div>
    </div>
  );
};

export default ServiceTimeline;
