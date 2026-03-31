import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { calcOrdersByDayOfWeek } from '../../utils/analyticsCalculations';

const DAY_COLORS = ['#f093fb', '#667eea', '#4facfe', '#43e97b', '#f7b731', '#ff6b6b', '#a55eea'];

const OrdersByDayChart = ({ orders }) => {
  const data = useMemo(() => calcOrdersByDayOfWeek(orders), [orders]);

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Orders by Day of Week</h6>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#888' }} />
          <YAxis tick={{ fontSize: 12, fill: '#888' }} allowDecimals={false} />
          <Tooltip
            formatter={(v) => [v, 'Orders']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={30}>
            {data.map((_, i) => (
              <Cell key={i} fill={DAY_COLORS[i]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OrdersByDayChart;
