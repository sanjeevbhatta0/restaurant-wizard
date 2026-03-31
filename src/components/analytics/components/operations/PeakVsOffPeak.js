import React, { useMemo } from 'react';
import { toDate, calcAvgOrderValue } from '../../utils/analyticsCalculations';
import { formatCurrency, formatNumber, formatMinutes } from '../../utils/formatters';

const PeakVsOffPeak = ({ orders }) => {
  const { peak, offPeak } = useMemo(() => {
    // Peak = 11am-2pm and 5pm-9pm, offPeak = everything else
    const peakOrders = orders.filter(o => {
      const d = toDate(o.createdAt);
      if (!d) return false;
      const h = d.getHours();
      return (h >= 11 && h < 14) || (h >= 17 && h < 21);
    });
    const offPeakOrders = orders.filter(o => {
      const d = toDate(o.createdAt);
      if (!d) return false;
      const h = d.getHours();
      return !((h >= 11 && h < 14) || (h >= 17 && h < 21));
    });
    return {
      peak: {
        orders: peakOrders.length,
        revenue: peakOrders.reduce((s, o) => s + (o.total || 0), 0),
        avgValue: calcAvgOrderValue(peakOrders)
      },
      offPeak: {
        orders: offPeakOrders.length,
        revenue: offPeakOrders.reduce((s, o) => s + (o.total || 0), 0),
        avgValue: calcAvgOrderValue(offPeakOrders)
      }
    };
  }, [orders]);

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Peak vs Off-Peak</h6>
      <p className="ca-chart-subtitle">Peak hours: 11am-2pm, 5pm-9pm</p>
      <div className="ca-peak-comparison">
        <div className="ca-peak-card ca-peak-on">
          <div className="ca-peak-badge">Peak Hours</div>
          <div className="ca-peak-metrics">
            <div className="ca-peak-metric">
              <span className="ca-peak-metric-value">{formatNumber(peak.orders)}</span>
              <span className="ca-peak-metric-label">Orders</span>
            </div>
            <div className="ca-peak-metric">
              <span className="ca-peak-metric-value">{formatCurrency(peak.revenue)}</span>
              <span className="ca-peak-metric-label">Revenue</span>
            </div>
            <div className="ca-peak-metric">
              <span className="ca-peak-metric-value">{formatCurrency(peak.avgValue)}</span>
              <span className="ca-peak-metric-label">Avg Order</span>
            </div>
          </div>
        </div>
        <div className="ca-peak-vs">VS</div>
        <div className="ca-peak-card ca-peak-off">
          <div className="ca-peak-badge">Off-Peak</div>
          <div className="ca-peak-metrics">
            <div className="ca-peak-metric">
              <span className="ca-peak-metric-value">{formatNumber(offPeak.orders)}</span>
              <span className="ca-peak-metric-label">Orders</span>
            </div>
            <div className="ca-peak-metric">
              <span className="ca-peak-metric-value">{formatCurrency(offPeak.revenue)}</span>
              <span className="ca-peak-metric-label">Revenue</span>
            </div>
            <div className="ca-peak-metric">
              <span className="ca-peak-metric-value">{formatCurrency(offPeak.avgValue)}</span>
              <span className="ca-peak-metric-label">Avg Order</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PeakVsOffPeak;
