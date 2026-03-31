import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { bucketByDay, bucketByHour } from '../../utils/analyticsCalculations';

const OrderTrendChart = ({ orders, prevOrders, startDate, endDate, granularity }) => {
  const data = useMemo(() => {
    let currentBuckets, prevBuckets;
    if (granularity === 'hourly') {
      currentBuckets = bucketByHour(orders, startDate);
      prevBuckets = bucketByHour(prevOrders, startDate);
    } else {
      currentBuckets = bucketByDay(orders, startDate, endDate);
      const duration = endDate.getTime() - startDate.getTime();
      prevBuckets = bucketByDay(prevOrders, new Date(startDate.getTime() - duration), new Date(startDate.getTime() - 1));
    }
    return currentBuckets.map((b, i) => ({
      label: b.label,
      orders: b.orders,
      previousOrders: prevBuckets[i]?.orders || 0
    }));
  }, [orders, prevOrders, startDate, endDate, granularity]);

  if (!data || data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Order Trend</h6>
        <div className="ca-chart-empty">No order data available</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Order Trend</h6>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#43e97b" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#43e97b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#888' }} />
          <YAxis tick={{ fontSize: 12, fill: '#888' }} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} />
          <Legend />
          <Area type="monotone" dataKey="previousOrders" name="Previous Period" stroke="#a0aec0" strokeDasharray="5 5" fill="transparent" strokeWidth={2} />
          <Area type="monotone" dataKey="orders" name="Current Period" stroke="#43e97b" fillOpacity={1} fill="url(#colorOrders)" strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OrderTrendChart;
