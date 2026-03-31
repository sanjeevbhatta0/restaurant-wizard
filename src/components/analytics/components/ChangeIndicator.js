import React from 'react';

const ChangeIndicator = ({ value, invertColors = false, compact = false }) => {
  if (value == null || isNaN(value) || value === 0) {
    return <span className="ca-change ca-change-neutral">--</span>;
  }

  const isPositive = value > 0;
  // For some metrics (reimbursement rate, avg time), decrease is good
  const isGood = invertColors ? !isPositive : isPositive;
  const arrow = isPositive ? '\u2191' : '\u2193';
  const className = `ca-change ${isGood ? 'ca-change-up' : 'ca-change-down'}`;

  return (
    <span className={className}>
      {arrow} {compact ? `${Math.abs(value).toFixed(0)}%` : `${Math.abs(value).toFixed(1)}%`}
    </span>
  );
};

export default ChangeIndicator;
