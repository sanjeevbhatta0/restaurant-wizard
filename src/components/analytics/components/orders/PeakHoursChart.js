import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { calcOrdersByHour } from '../../utils/analyticsCalculations';

const PeakHoursChart = ({ orders }) => {
  const data = useMemo(() => calcOrdersByHour(orders), [orders]);
  const maxCount = useMemo(() => Math.max(...data.map(d => d.count), 1), [data]);

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Peak Hours</h6>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888' }} interval={2} />
          <YAxis tick={{ fontSize: 12, fill: '#888' }} allowDecimals={false} />
          <Tooltip
            formatter={(v, name) => [v, name === 'count' ? 'Orders' : name]}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={14}>
            {data.map((entry, i) => {
              const intensity = entry.count / maxCount;
              const color = intensity > 0.7 ? '#667eea' : intensity > 0.3 ? '#a3bffa' : '#e2e8f0';
              return <Cell key={i} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PeakHoursChart;
