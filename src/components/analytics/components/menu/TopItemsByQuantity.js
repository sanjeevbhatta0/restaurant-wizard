import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { calcTopItems } from '../../utils/analyticsCalculations';

const TopItemsByQuantity = ({ orders }) => {
  const data = useMemo(() => calcTopItems(orders, 10, 'quantity'), [orders]);

  if (data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Top 10 Items by Quantity</h6>
        <div className="ca-chart-empty">No item data</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Top 10 Items by Quantity</h6>
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
          <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#555' }} />
          <Tooltip formatter={(v) => [v, 'Sold']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="quantity" fill="#43e97b" radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TopItemsByQuantity;
