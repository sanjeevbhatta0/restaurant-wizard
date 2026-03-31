import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { calcTopItems } from '../../utils/analyticsCalculations';
import { formatCompactCurrency } from '../../utils/formatters';

const TopItemsByRevenue = ({ orders }) => {
  const data = useMemo(() => calcTopItems(orders, 10, 'revenue'), [orders]);

  if (data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Top 10 Items by Revenue</h6>
        <div className="ca-chart-empty">No item data</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Top 10 Items by Revenue</h6>
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
          <XAxis type="number" tickFormatter={formatCompactCurrency} tick={{ fontSize: 11, fill: '#888' }} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#555' }} />
          <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Revenue']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="revenue" fill="#667eea" radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TopItemsByRevenue;
