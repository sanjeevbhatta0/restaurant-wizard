import React from 'react';
import HealthScoreRing from './HealthScoreRing';
import SkeletonCard from './SkeletonCard';

const AISummaryBanner = ({ data, healthScore, loading, orders }) => {
  if (loading) {
    return (
      <div className="ai-banner ai-glass-loading">
        <div className="ai-skeleton" style={{ width: 120, height: 120, borderRadius: '50%' }}></div>
        <div>
          <div className="ai-skeleton" style={{ height: 28, width: '60%', marginBottom: 12, borderRadius: 8 }}></div>
          <div className="ai-skeleton" style={{ height: 14, width: '90%', marginBottom: 8, borderRadius: 6 }}></div>
          <div className="ai-skeleton" style={{ height: 14, width: '70%', borderRadius: 6 }}></div>
        </div>
        <div></div>
      </div>
    );
  }

  if (!data?.success || !data?.data) {
    return (
      <div className="ai-banner">
        <HealthScoreRing score={healthScore || 0} />
        <div className="ai-banner-content">
          <div className="ai-banner-headline">Your Restaurant Overview</div>
          <div className="ai-banner-summary">
            {orders?.length > 0
              ? 'AI insights are loading. Please wait a moment...'
              : 'No order data available for this period. Try selecting a different date range.'}
          </div>
        </div>
        <div></div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-banner">
      <div className="ai-banner-ring">
        <HealthScoreRing score={healthScore || 75} size={130} />
      </div>
      <div className="ai-banner-content">
        <div className="ai-banner-headline">{d.headline || 'Business Performance Summary'}</div>
        <div className="ai-banner-summary">{d.summary || ''}</div>
        {d.keyMetrics && d.keyMetrics.length > 0 && (
          <div className="ai-banner-kpis">
            {d.keyMetrics.slice(0, 4).map((m, i) => (
              <div key={i} className="ai-banner-kpi">
                <div className="ai-banner-kpi-value">{m.value}</div>
                <div className="ai-banner-kpi-label">{m.label}</div>
                {m.trend && (
                  <div className={`ai-banner-kpi-trend ${m.trend}`}>
                    {m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : '→'} {m.insight || ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {d.topInsight && (
        <div style={{ maxWidth: 200, textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Key Insight
          </div>
          <div style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 600, lineHeight: 1.4 }}>
            {d.topInsight}
          </div>
        </div>
      )}
    </div>
  );
};

export default AISummaryBanner;
