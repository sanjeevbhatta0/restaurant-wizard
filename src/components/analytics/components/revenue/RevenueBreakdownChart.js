import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { calcRevenueBreakdown } from '../../utils/analyticsCalculations';

const COLORS = ['#667eea', '#4facfe', '#f093fb', '#f5576c'];

const RevenueBreakdownChart = ({ orders }) => {
  const data = useMemo(() => {
    const b = calcRevenueBreakdown(orders);
    return [
      { name: 'Subtotal', value: b.subtotal },
      { name: 'Tax', value: b.tax },
      { name: 'Tips', value: b.tips },
      { name: 'Discounts', value: b.discounts }
    ].filter(d => d.value > 0);
  }, [orders]);

  if (data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Revenue Breakdown</h6>
        <div className="ca-chart-empty">No revenue data</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Revenue Breakdown</h6>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RevenueBreakdownChart;
