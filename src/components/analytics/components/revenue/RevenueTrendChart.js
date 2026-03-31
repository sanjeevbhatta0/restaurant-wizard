import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { bucketByDay, bucketByHour } from '../../utils/analyticsCalculations';
import { formatCompactCurrency } from '../../utils/formatters';

const RevenueTrendChart = ({ orders, prevOrders, reimbursements, startDate, endDate, granularity }) => {
  const data = useMemo(() => {
    let currentBuckets, prevBuckets;

    if (granularity === 'hourly') {
      currentBuckets = bucketByHour(orders, startDate);
      prevBuckets = bucketByHour(prevOrders, startDate);
    } else {
      currentBuckets = bucketByDay(orders, startDate, endDate);
      const duration = endDate.getTime() - startDate.getTime();
      const prevStart = new Date(startDate.getTime() - duration);
      const prevEnd = new Date(startDate.getTime() - 1);
      prevBuckets = bucketByDay(prevOrders, prevStart, prevEnd);
    }

    return currentBuckets.map((b, i) => ({
      label: b.label,
      revenue: b.revenue,
      previousRevenue: prevBuckets[i]?.revenue || 0,
      reimbursements: b.reimbursements || 0
    }));
  }, [orders, prevOrders, startDate, endDate, granularity]);

  if (!data || data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Revenue Trend</h6>
        <div className="ca-chart-empty">No revenue data available</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Revenue Trend</h6>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#667eea" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#667eea" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorPrev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a0aec0" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#a0aec0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#888' }} />
          <YAxis tickFormatter={formatCompactCurrency} tick={{ fontSize: 12, fill: '#888' }} />
          <Tooltip
            formatter={(value, name) => [
              `$${Number(value).toFixed(2)}`,
              name === 'revenue' ? 'Current Period' : 'Previous Period'
            ]}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="previousRevenue"
            name="Previous Period"
            stroke="#a0aec0"
            strokeDasharray="5 5"
            fillOpacity={1}
            fill="url(#colorPrev)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Current Period"
            stroke="#667eea"
            fillOpacity={1}
            fill="url(#colorRevenue)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RevenueTrendChart;
