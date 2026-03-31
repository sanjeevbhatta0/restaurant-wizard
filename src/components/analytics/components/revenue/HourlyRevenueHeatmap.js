import React, { useMemo } from 'react';
import { calcHourlyHeatmap } from '../../utils/analyticsCalculations';
import { formatCompactCurrency } from '../../utils/formatters';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const getHeatColor = (value, maxValue) => {
  if (!value || maxValue === 0) return '#f7fafc';
  const intensity = value / maxValue;
  if (intensity < 0.2) return '#e8f0fe';
  if (intensity < 0.4) return '#bbdefb';
  if (intensity < 0.6) return '#64b5f6';
  if (intensity < 0.8) return '#1e88e5';
  return '#0d47a1';
};

const HourlyRevenueHeatmap = ({ orders }) => {
  const { grid, maxValue } = useMemo(() => {
    const g = calcHourlyHeatmap(orders);
    const max = Math.max(...g.flat(), 1);
    return { grid: g, maxValue: max };
  }, [orders]);

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Revenue Heatmap (Day x Hour)</h6>
      <div className="ca-heatmap-wrapper">
        <div className="ca-heatmap">
          <div className="ca-heatmap-corner"></div>
          {HOURS.filter((_, i) => i % 3 === 0).map(h => (
            <div key={h} className="ca-heatmap-hour-label" style={{ gridColumn: h + 2, gridColumnEnd: `span 3` }}>
              {h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}
            </div>
          ))}
          {DAYS.map((day, dayIdx) => (
            <React.Fragment key={day}>
              <div className="ca-heatmap-day-label">{day}</div>
              {HOURS.map(hour => (
                <div
                  key={`${dayIdx}-${hour}`}
                  className="ca-heatmap-cell"
                  style={{ backgroundColor: getHeatColor(grid[dayIdx][hour], maxValue) }}
                  title={`${day} ${hour}:00 - ${formatCompactCurrency(grid[dayIdx][hour])}`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
        <div className="ca-heatmap-legend">
          <span>Low</span>
          <div className="ca-heatmap-legend-bar"></div>
          <span>High</span>
        </div>
      </div>
    </div>
  );
};

export default HourlyRevenueHeatmap;
