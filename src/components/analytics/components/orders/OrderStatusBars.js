import React, { useMemo } from 'react';
import { calcOrderStatusDistribution } from '../../utils/analyticsCalculations';

const STATUS_COLORS = {
  new: '#667eea',
  preparing: '#f093fb',
  ready: '#4facfe',
  completed: '#43e97b'
};

const STATUS_LABELS = {
  new: 'New / Sent to Kitchen',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed'
};

const OrderStatusBars = ({ orders }) => {
  const { statuses, total } = useMemo(() => {
    const s = calcOrderStatusDistribution(orders);
    const t = Object.values(s).reduce((sum, v) => sum + v, 0);
    return { statuses: s, total: t };
  }, [orders]);

  if (total === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Orders by Status</h6>
        <div className="ca-chart-empty">No orders</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Orders by Status</h6>
      <div className="ca-status-bars">
        {Object.entries(statuses).map(([key, value]) => {
          const pct = (value / total) * 100;
          return (
            <div key={key} className="ca-status-bar-item">
              <div className="ca-status-bar-header">
                <span className="ca-status-bar-label">{STATUS_LABELS[key]}</span>
                <span className="ca-status-bar-count">{value} ({pct.toFixed(0)}%)</span>
              </div>
              <div className="ca-status-bar-track">
                <div
                  className="ca-status-bar-fill"
                  style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[key] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderStatusBars;
