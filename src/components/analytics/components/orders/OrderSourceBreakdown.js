import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { calcSourceBreakdown } from '../../utils/analyticsCalculations';

const COLORS = ['#667eea', '#43e97b'];

const OrderSourceBreakdown = ({ orders }) => {
  const data = useMemo(() => {
    const s = calcSourceBreakdown(orders);
    return [
      { name: 'POS', value: s.pos },
      { name: 'Website', value: s.website }
    ].filter(d => d.value > 0);
  }, [orders]);

  if (data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Orders by Source</h6>
        <div className="ca-chart-empty">No source data</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Orders by Source</h6>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value">
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default OrderSourceBreakdown;
