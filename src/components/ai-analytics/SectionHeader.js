import React, { useState } from 'react';

const SectionHeader = ({ icon, title, onRefresh }) => {
  const [spinning, setSpinning] = useState(false);

  const handleRefresh = () => {
    if (!onRefresh) return;
    setSpinning(true);
    onRefresh();
    setTimeout(() => setSpinning(false), 1000);
  };

  return (
    <div className="ai-section-header">
      <h5><i className={`bi ${icon}`}></i>{title}</h5>
      {onRefresh && (
        <button
          className={`ai-section-refresh ${spinning ? 'spinning' : ''}`}
          onClick={handleRefresh}
        >
          <i className="bi bi-arrow-clockwise"></i>
        </button>
      )}
    </div>
  );
};

export default SectionHeader;
