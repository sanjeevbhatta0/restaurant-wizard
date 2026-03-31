import React, { useMemo } from 'react';
import { calcKitchenTime, calcServiceTime, calcFullCycleTime } from '../../utils/analyticsCalculations';
import { formatMinutes } from '../../utils/formatters';

const CONFIGS = {
  kitchen: { title: 'Kitchen Time', subtitle: 'Created to Ready', color: '#667eea', maxMinutes: 60 },
  service: { title: 'Service Time', subtitle: 'Ready to Served', color: '#43e97b', maxMinutes: 30 },
  fullCycle: { title: 'Full Cycle', subtitle: 'Created to Completed', color: '#f093fb', maxMinutes: 90 }
};

const KitchenEfficiency = ({ orders, metric }) => {
  const config = CONFIGS[metric] || CONFIGS.kitchen;

  const avgMinutes = useMemo(() => {
    if (metric === 'kitchen') return calcKitchenTime(orders);
    if (metric === 'service') return calcServiceTime(orders);
    return calcFullCycleTime(orders);
  }, [orders, metric]);

  const percentage = Math.min((avgMinutes / config.maxMinutes) * 100, 100);
  const circumference = 2 * Math.PI * 70;
  const offset = circumference - (percentage / 100) * circumference * 0.5; // half-circle

  return (
    <div className="ca-chart-panel ca-gauge-panel">
      <h6 className="ca-chart-title">{config.title}</h6>
      <p className="ca-chart-subtitle">{config.subtitle}</p>
      <div className="ca-gauge">
        <svg viewBox="0 0 160 100" width="160" height="100">
          {/* Background arc */}
          <path
            d="M 10 90 A 70 70 0 0 1 150 90"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Filled arc */}
          <path
            d="M 10 90 A 70 70 0 0 1 150 90"
            fill="none"
            stroke={config.color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${(percentage / 100) * 220} 220`}
            style={{ transition: 'stroke-dasharray 1s ease' }}
          />
        </svg>
        <div className="ca-gauge-value">{formatMinutes(avgMinutes)}</div>
      </div>
      {avgMinutes === 0 && <div className="ca-chart-empty-small">No timing data</div>}
    </div>
  );
};

export default KitchenEfficiency;
