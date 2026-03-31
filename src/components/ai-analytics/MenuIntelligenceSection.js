import React from 'react';
import SectionHeader from './SectionHeader';
import SkeletonCard from './SkeletonCard';

const MenuIntelligenceSection = ({ data, onRefresh }) => {
  if (!data || data.loading) return <SkeletonCard lines={5} />;

  if (!data.success || !data.data) {
    return (
      <div className="ai-glass">
        <SectionHeader icon="bi-list-stars" title="Menu Intelligence" onRefresh={onRefresh} />
        <div className="ai-error-text">Could not load menu insights</div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-glass">
      <SectionHeader icon="bi-list-stars" title="Menu Intelligence" onRefresh={onRefresh} />

      {/* Menu Health Score */}
      {d.menuHealthScore != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12,
            background: d.menuHealthScore >= 70 ? 'rgba(67,233,123,0.12)' : 'rgba(251,215,134,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.3rem', fontWeight: 800,
            color: d.menuHealthScore >= 70 ? '#43e97b' : '#fbd786'
          }}>
            {d.menuHealthScore}
          </div>
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>Menu Score</div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>out of 100</div>
          </div>
        </div>
      )}

      {/* Stars */}
      {d.stars && d.stars.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Star Items
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.stars.map((item, i) => (
              <span key={i} style={{
                background: 'rgba(251,215,134,0.12)', border: '1px solid rgba(251,215,134,0.2)',
                borderRadius: 20, padding: '0.25rem 0.65rem', fontSize: '0.78rem', color: '#fbd786'
              }}>
                <i className="bi bi-star-fill" style={{ fontSize: '0.65rem', marginRight: 4 }}></i>
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Underperformers */}
      {d.underperformers && d.underperformers.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Needs Attention
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {d.underperformers.map((item, i) => (
              <span key={i} style={{
                background: 'rgba(247,108,108,0.1)', border: '1px solid rgba(247,108,108,0.2)',
                borderRadius: 20, padding: '0.25rem 0.65rem', fontSize: '0.78rem', color: '#f76c6c'
              }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {d.recommendations && d.recommendations.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8 }}>
            Recommendations
          </div>
          <div className="ai-insight-list">
            {d.recommendations.slice(0, 4).map((rec, i) => (
              <div key={i} className="ai-insight-item">
                <div className={`ai-insight-icon ${rec.priority || 'info'}`}>
                  <i className={`bi ${rec.type === 'remove' ? 'bi-trash' : rec.type === 'promote' ? 'bi-megaphone' : rec.type === 'reprice' ? 'bi-tag' : 'bi-box'}`}></i>
                </div>
                <div className="ai-insight-body">
                  <div className="ai-insight-title">{rec.item}</div>
                  <div className="ai-insight-desc">{rec.reason}</div>
                  {rec.expectedImpact && <span className="ai-insight-tag low">{rec.expectedImpact}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Quick Wins */}
      {d.quickWins && d.quickWins.length > 0 && (
        <div className="ai-takeaway" style={{ marginTop: 12 }}>
          <i className="bi bi-lightning"></i>
          <div>
            <strong>Quick Win:</strong> {d.quickWins[0]}
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuIntelligenceSection;
