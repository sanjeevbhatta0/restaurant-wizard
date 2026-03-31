import React from 'react';
import ExportButton from './ExportButton';

const DateRangeBar = ({
  rangeKey,
  setRange,
  rangeLabel,
  customStart,
  customEnd,
  setCustomStart,
  setCustomEnd,
  orders,
  RANGE_CONFIGS
}) => {
  const buttons = [
    'today', 'last24h', 'last7d', 'last30d', 'last90d',
    'thisMonth', 'lastMonth', 'thisYear', 'custom'
  ];

  return (
    <div className="ca-date-bar">
      <div className="ca-date-bar-inner">
        <div className="ca-range-buttons">
          {buttons.map(key => (
            <button
              key={key}
              className={`ca-range-btn ${rangeKey === key ? 'ca-range-btn-active' : ''}`}
              onClick={() => setRange(key)}
            >
              {RANGE_CONFIGS[key]?.shortLabel || key}
            </button>
          ))}
        </div>

        <div className="ca-date-bar-right">
          {rangeKey === 'custom' && (
            <div className="ca-custom-dates">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                max={customEnd || new Date().toISOString().split('T')[0]}
                className="ca-date-input"
              />
              <span className="ca-date-sep">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                min={customStart}
                max={new Date().toISOString().split('T')[0]}
                className="ca-date-input"
              />
            </div>
          )}
          {rangeKey !== 'custom' && (
            <span className="ca-showing-label">
              <i className="bi bi-calendar3 me-1"></i>
              {rangeLabel}
            </span>
          )}
          <ExportButton orders={orders} rangeLabel={rangeLabel} />
        </div>
      </div>
    </div>
  );
};

export default DateRangeBar;
