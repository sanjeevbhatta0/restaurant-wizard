import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { bucketByDay, bucketByHour, calcTotalTips } from '../../utils/analyticsCalculations';
import { formatCurrency } from '../../utils/formatters';

const TipsAnalysis = ({ orders, startDate, endDate, granularity }) => {
  const totalTips = useMemo(() => calcTotalTips(orders), [orders]);
  const avgTipPercent = useMemo(() => {
    const tipped = orders.filter(o => (o.paymentDetails?.tipAmount || 0) > 0);
    if (tipped.length === 0) return 0;
    const avgPercent = tipped.reduce((sum, o) => {
      const sub = o.paymentDetails?.subtotal || o.total || 1;
      return sum + ((o.paymentDetails?.tipAmount || 0) / sub) * 100;
    }, 0) / tipped.length;
    return avgPercent;
  }, [orders]);

  const data = useMemo(() => {
    if (granularity === 'hourly') {
      return bucketByHour(orders, startDate).map(b => ({ label: b.label, tips: b.tips }));
    }
    return bucketByDay(orders, startDate, endDate).map(b => ({ label: b.label, tips: b.tips }));
  }, [orders, startDate, endDate, granularity]);

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Tips Analysis</h6>
      <div className="ca-tips-stats">
        <div className="ca-tip-stat">
          <span className="ca-tip-stat-value">{formatCurrency(totalTips)}</span>
          <span className="ca-tip-stat-label">Total Tips</span>
        </div>
        <div className="ca-tip-stat">
          <span className="ca-tip-stat-value">{avgTipPercent.toFixed(1)}%</span>
          <span className="ca-tip-stat-label">Avg Tip %</span>
        </div>
        <div className="ca-tip-stat">
          <span className="ca-tip-stat-value">{orders.filter(o => (o.paymentDetails?.tipAmount || 0) > 0).length}</span>
          <span className="ca-tip-stat-label">Tipped Orders</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#888' }} />
          <YAxis tick={{ fontSize: 11, fill: '#888' }} />
          <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Tips']}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
          />
          <Line type="monotone" dataKey="tips" stroke="#f093fb" strokeWidth={2.5} dot={{ fill: '#f093fb', r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TipsAnalysis;
