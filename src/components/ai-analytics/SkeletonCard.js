import React from 'react';

const SkeletonCard = ({ lines = 4 }) => (
  <div className="ai-glass ai-glass-loading">
    <div className="ai-skeleton ai-skeleton-title"></div>
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className="ai-skeleton ai-skeleton-line"></div>
    ))}
  </div>
);

export default SkeletonCard;
