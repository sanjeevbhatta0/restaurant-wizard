import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { calcCategoryPerformance } from '../../utils/analyticsCalculations';
import { formatCompactCurrency } from '../../utils/formatters';

const COLORS = ['#667eea', '#43e97b', '#f093fb', '#4facfe', '#f7b731', '#ff6b6b', '#a55eea', '#26de81'];

const CategoryPerformance = ({ orders }) => {
  const data = useMemo(() => calcCategoryPerformance(orders), [orders]);

  if (data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Category Performance</h6>
        <div className="ca-chart-empty">No category data</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Category Performance</h6>
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} angle={-30} textAnchor="end" height={60} />
          <YAxis tickFormatter={formatCompactCurrency} tick={{ fontSize: 11, fill: '#888' }} />
          <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Revenue']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="revenue" radius={[6, 6, 0, 0]} barSize={30}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default CategoryPerformance;
