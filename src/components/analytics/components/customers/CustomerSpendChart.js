import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { calcCustomerSpendDistribution } from '../../utils/analyticsCalculations';

const COLORS = ['#e2e8f0', '#a3bffa', '#667eea', '#4c51bf', '#312e81'];

const CustomerSpendChart = ({ orders }) => {
  const data = useMemo(() => calcCustomerSpendDistribution(orders), [orders]);

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Order Value Distribution</h6>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="range" tick={{ fontSize: 12, fill: '#888' }} />
          <YAxis tick={{ fontSize: 12, fill: '#888' }} allowDecimals={false} />
          <Tooltip formatter={(v) => [v, 'Orders']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={35}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CustomerSpendChart;
