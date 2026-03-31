import React from 'react';
import Sparkline from './Sparkline';
import ChangeIndicator from './ChangeIndicator';
import { formatCurrency, formatNumber, formatPercent, formatMinutes } from '../utils/formatters';
import { bucketByDay, bucketByHour } from '../utils/analyticsCalculations';

const KPI_DEFS = [
  {
    key: 'totalRevenue',
    label: 'Total Revenue',
    icon: 'bi-currency-dollar',
    format: formatCurrency,
    gradient: 'ca-grad-blue',
    sparkField: 'revenue'
  },
  {
    key: 'netRevenue',
    label: 'Net Revenue',
    icon: 'bi-graph-up-arrow',
    format: formatCurrency,
    gradient: 'ca-grad-green',
    sparkField: 'revenue'
  },
  {
    key: 'totalOrders',
    label: 'Orders',
    icon: 'bi-receipt',
    format: formatNumber,
    gradient: 'ca-grad-teal',
    sparkField: 'orders'
  },
  {
    key: 'avgOrderValue',
    label: 'Avg Order',
    icon: 'bi-cart3',
    format: formatCurrency,
    gradient: 'ca-grad-indigo',
    sparkField: 'revenue'
  },
  {
    key: 'totalTips',
    label: 'Tips',
    icon: 'bi-heart',
    format: formatCurrency,
    gradient: 'ca-grad-purple',
    sparkField: 'tips'
  },
  {
    key: 'avgItemsPerOrder',
    label: 'Items / Order',
    icon: 'bi-list-check',
    format: (v) => v.toFixed(1),
    gradient: 'ca-grad-cyan',
    sparkField: 'orders'
  },
  {
    key: 'reimbursementRate',
    label: 'Reimb. Rate',
    icon: 'bi-arrow-counterclockwise',
    format: formatPercent,
    gradient: 'ca-grad-amber',
    invertColors: true,
    sparkField: 'orders'
  },
  {
    key: 'avgOrderTime',
    label: 'Avg Time',
    icon: 'bi-clock',
    format: formatMinutes,
    gradient: 'ca-grad-rose',
    invertColors: true,
    sparkField: 'orders'
  }
];

const KPICards = ({ current, changes, orders, startDate, endDate, granularity }) => {
  // Build sparkline data
  const sparkData = React.useMemo(() => {
    if (!orders || orders.length === 0) return {};
    if (granularity === 'hourly') {
      const buckets = bucketByHour(orders, startDate);
      return {
        revenue: buckets.map(b => b.revenue),
        orders: buckets.map(b => b.orders),
        tips: buckets.map(b => b.tips)
      };
    }
    const buckets = bucketByDay(orders, startDate, endDate);
    return {
      revenue: buckets.map(b => b.revenue),
      orders: buckets.map(b => b.orders),
      tips: buckets.map(b => b.tips)
    };
  }, [orders, startDate, endDate, granularity]);

  return (
    <div className="ca-kpi-grid">
      {KPI_DEFS.map((kpi, idx) => (
        <div
          key={kpi.key}
          className={`ca-kpi-card ${kpi.gradient}`}
          style={{ animationDelay: `${idx * 60}ms` }}
        >
          <div className="ca-kpi-header">
            <i className={`bi ${kpi.icon} ca-kpi-icon`}></i>
            <ChangeIndicator value={changes[kpi.key]} invertColors={kpi.invertColors} compact />
          </div>
          <div className="ca-kpi-value">{kpi.format(current[kpi.key])}</div>
          <div className="ca-kpi-label">{kpi.label}</div>
          <div className="ca-kpi-spark">
            <Sparkline
              data={sparkData[kpi.sparkField] || []}
              width={90}
              height={28}
              color="rgba(255,255,255,0.8)"
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default KPICards;
