import React from 'react';
import SectionHeader from './SectionHeader';
import SkeletonCard from './SkeletonCard';

const CustomerIntelligenceSection = ({ data, onRefresh }) => {
  if (!data || data.loading) return <SkeletonCard lines={5} />;

  if (!data.success || !data.data) {
    return (
      <div className="ai-glass">
        <SectionHeader icon="bi-people" title="Customer Intelligence" onRefresh={onRefresh} />
        <div className="ai-error-text">Could not load customer insights</div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-glass">
      <SectionHeader icon="bi-people" title="Customer Intelligence" onRefresh={onRefresh} />

      {/* Segments */}
      {d.segments && d.segments.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Customer Segments
          </div>
          {d.segments.map((seg, i) => (
            <div key={i} className="ai-segment">
              <div className="ai-segment-header">
                <span className="ai-segment-name">
                  {seg.name === 'High-Value Regulars' && <i className="bi bi-gem me-1" style={{ color: '#fbd786' }}></i>}
                  {seg.name === 'At-Risk' && <i className="bi bi-exclamation-triangle me-1" style={{ color: '#f76c6c' }}></i>}
                  {seg.name === 'New Customers' && <i className="bi bi-person-plus me-1" style={{ color: '#43e97b' }}></i>}
                  {seg.name === 'Occasional Visitors' && <i className="bi bi-person me-1" style={{ color: '#4facfe' }}></i>}
                  {seg.name}
                </span>
                <span className="ai-segment-count">{seg.count}</span>
              </div>
              {seg.avgSpend && <div className="ai-segment-detail">Avg Spend: {seg.avgSpend}</div>}
              {seg.behavior && <div className="ai-segment-detail">{seg.behavior}</div>}
              {seg.strategy && <div className="ai-segment-strategy">Strategy: {seg.strategy}</div>}
            </div>
          ))}
        </>
      )}

      {/* Retention */}
      {d.retentionInsights && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8 }}>
            Retention
          </div>
          <div className="ai-stat-row">
            <span className="ai-stat-label">Return Rate</span>
            <span className="ai-stat-value">{d.retentionInsights.returningRate}</span>
          </div>
          <div className="ai-stat-row">
            <span className="ai-stat-label">Visit Frequency</span>
            <span className="ai-stat-value">{d.retentionInsights.avgVisitFrequency}</span>
          </div>
          <div className="ai-stat-row">
            <span className="ai-stat-label">Churn Risk</span>
            <span className="ai-stat-value">{d.retentionInsights.churnRisk}</span>
          </div>
        </>
      )}

      {/* Behavior Patterns */}
      {d.behaviorPatterns && d.behaviorPatterns.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8 }}>
            Behavior Patterns
          </div>
          <div className="ai-insight-list">
            {d.behaviorPatterns.slice(0, 3).map((bp, i) => (
              <div key={i} className="ai-insight-item">
                <div className="ai-insight-icon info"><i className="bi bi-eye"></i></div>
                <div className="ai-insight-body">
                  <div className="ai-insight-title">{bp.pattern}</div>
                  <div className="ai-insight-desc">{bp.implication}</div>
                  {bp.action && <span className="ai-insight-tag low">{bp.action}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {d.summaryInsight && (
        <div className="ai-takeaway">
          <i className="bi bi-lightbulb"></i>
          {d.summaryInsight}
        </div>
      )}
    </div>
  );
};

export default CustomerIntelligenceSection;
