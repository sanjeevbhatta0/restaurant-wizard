import React from 'react';
import SectionHeader from './SectionHeader';
import SkeletonCard from './SkeletonCard';

const RevenueIntelligenceSection = ({ data, onRefresh }) => {
  if (!data || data.loading) return <SkeletonCard lines={5} />;

  if (!data.success || !data.data) {
    return (
      <div className="ai-glass">
        <SectionHeader icon="bi-graph-up-arrow" title="Revenue Intelligence" onRefresh={onRefresh} />
        <div className="ai-error-text">Could not load revenue insights</div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-glass">
      <SectionHeader icon="bi-graph-up-arrow" title="Revenue Intelligence" onRefresh={onRefresh} />

      {/* Prediction */}
      {d.prediction && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Next Week Forecast
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#43e97b', marginBottom: 12 }}>
            ${(d.prediction.nextWeekRevenue || 0).toLocaleString()}
          </div>
          {d.prediction.dailyBreakdown && (
            <div className="ai-prediction-grid">
              {d.prediction.dailyBreakdown.map((day, i) => (
                <div key={i} className="ai-prediction-day">
                  <div className="ai-prediction-day-name">{(day.day || '').substring(0, 3)}</div>
                  <div className="ai-prediction-day-value">${day.predicted || 0}</div>
                  <div className={`ai-prediction-confidence ${day.confidence || 'medium'}`}>
                    {day.confidence || 'med'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Pricing Recommendations */}
      {d.pricingRecommendations && d.pricingRecommendations.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 8 }}>
            Pricing Strategy
          </div>
          <div className="ai-insight-list">
            {d.pricingRecommendations.slice(0, 3).map((rec, i) => (
              <div key={i} className="ai-insight-item">
                <div className="ai-insight-icon info"><i className="bi bi-tag"></i></div>
                <div className="ai-insight-body">
                  <div className="ai-insight-title">{rec.item}</div>
                  <div className="ai-insight-desc">{rec.suggestion}</div>
                  {rec.estimatedImpact && (
                    <span className="ai-insight-tag low">{rec.estimatedImpact}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Growth Ideas */}
      {d.revenueGrowthIdeas && d.revenueGrowthIdeas.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 8 }}>
            Growth Opportunities
          </div>
          <div className="ai-insight-list">
            {d.revenueGrowthIdeas.slice(0, 3).map((idea, i) => (
              <div key={i} className="ai-insight-item">
                <div className="ai-insight-icon star"><i className="bi bi-rocket-takeoff"></i></div>
                <div className="ai-insight-body">
                  <div className="ai-insight-title">{idea.idea}</div>
                  <div className="ai-insight-desc">
                    <strong>Effort:</strong> {idea.effort} · <strong>Impact:</strong> {idea.potentialImpact}
                    {idea.timeframe && <> · <strong>Timeline:</strong> {idea.timeframe}</>}
                  </div>
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

export default RevenueIntelligenceSection;
