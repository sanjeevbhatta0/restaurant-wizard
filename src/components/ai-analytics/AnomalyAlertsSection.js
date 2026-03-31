import React from 'react';
import SectionHeader from './SectionHeader';
import SkeletonCard from './SkeletonCard';

const AnomalyAlertsSection = ({ data, onRefresh }) => {
  if (!data || data.loading) return <SkeletonCard lines={4} />;

  if (!data.success || !data.data) {
    return (
      <div className="ai-glass">
        <SectionHeader icon="bi-shield-exclamation" title="Anomaly Alerts" onRefresh={onRefresh} />
        <div className="ai-error-text">Could not load alerts</div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-glass">
      <SectionHeader icon="bi-shield-exclamation" title="Anomaly Alerts" onRefresh={onRefresh} />

      {/* Health Description */}
      {d.healthDescription && (
        <div style={{
          fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)', marginBottom: 16, lineHeight: 1.6
        }}>
          {d.healthDescription}
        </div>
      )}

      {/* Alerts */}
      {d.alerts && d.alerts.length > 0 ? (
        <div className="ai-insight-list">
          {d.alerts.map((alert, i) => (
            <div key={i} className="ai-insight-item">
              <div className={`ai-insight-icon ${alert.severity || 'medium'}`}>
                <i className={`bi ${alert.severity === 'high' ? 'bi-exclamation-triangle' : alert.severity === 'low' ? 'bi-check-circle' : 'bi-info-circle'}`}></i>
              </div>
              <div className="ai-insight-body">
                <div className="ai-insight-title">{alert.title}</div>
                <div className="ai-insight-desc">{alert.description}</div>
                {alert.recommendation && (
                  <div className="ai-insight-desc" style={{ color: '#a78bfa', marginTop: 4 }}>
                    <i className="bi bi-arrow-right-short"></i> {alert.recommendation}
                  </div>
                )}
                <span className={`ai-insight-tag ${alert.severity || 'medium'}`}>{alert.severity}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'rgba(255,255,255,0.4)' }}>
          <i className="bi bi-check-circle" style={{ fontSize: '1.5rem', color: '#43e97b', display: 'block', marginBottom: 8 }}></i>
          No anomalies detected — everything looks healthy!
        </div>
      )}
    </div>
  );
};

export default AnomalyAlertsSection;
