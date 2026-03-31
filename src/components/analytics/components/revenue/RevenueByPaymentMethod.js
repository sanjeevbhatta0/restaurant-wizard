import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { calcPaymentMethodBreakdown } from '../../utils/analyticsCalculations';
import { formatCompactCurrency } from '../../utils/formatters';

const COLORS = { cash: '#43e97b', card: '#667eea', online: '#f093fb' };

const RevenueByPaymentMethod = ({ orders }) => {
  const data = useMemo(() => {
    const b = calcPaymentMethodBreakdown(orders);
    return [
      { name: 'Cash', value: b.cash, color: COLORS.cash },
      { name: 'Card', value: b.card, color: COLORS.card },
      { name: 'Online', value: b.online, color: COLORS.online }
    ].filter(d => d.value > 0);
  }, [orders]);

  if (data.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">By Payment Method</h6>
        <div className="ca-chart-empty">No payment data</div>
      </div>
    );
  }

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">By Payment Method</h6>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#888' }} />
          <YAxis tickFormatter={formatCompactCurrency} tick={{ fontSize: 12, fill: '#888' }} />
          <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RevenueByPaymentMethod;
