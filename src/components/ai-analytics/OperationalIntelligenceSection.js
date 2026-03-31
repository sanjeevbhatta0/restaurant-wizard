import React from 'react';
import SectionHeader from './SectionHeader';
import SkeletonCard from './SkeletonCard';

const OperationalIntelligenceSection = ({ data, onRefresh }) => {
  if (!data || data.loading) return <SkeletonCard lines={5} />;

  if (!data.success || !data.data) {
    return (
      <div className="ai-glass">
        <SectionHeader icon="bi-gear-wide-connected" title="Operational Intelligence" onRefresh={onRefresh} />
        <div className="ai-error-text">Could not load operational insights</div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-glass">
      <SectionHeader icon="bi-gear-wide-connected" title="Operational Intelligence" onRefresh={onRefresh} />

      {/* Peak Hours */}
      {d.peakHours && d.peakHours.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Peak Hours
          </div>
          <div className="ai-insight-list" style={{ marginBottom: 16 }}>
            {d.peakHours.slice(0, 4).map((peak, i) => (
              <div key={i} className="ai-insight-item">
                <div className="ai-insight-icon high"><i className="bi bi-clock"></i></div>
                <div className="ai-insight-body">
                  <div className="ai-insight-title">{peak.hour}</div>
                  <div className="ai-insight-desc">
                    Volume: {peak.orderVolume} · {peak.recommendation}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Slow Periods */}
      {d.slowPeriods && d.slowPeriods.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Slow Periods
          </div>
          <div className="ai-insight-list" style={{ marginBottom: 16 }}>
            {d.slowPeriods.slice(0, 3).map((slow, i) => (
              <div key={i} className="ai-insight-item">
                <div className="ai-insight-icon low"><i className="bi bi-clock-history"></i></div>
                <div className="ai-insight-body">
                  <div className="ai-insight-title">{slow.hour}</div>
                  <div className="ai-insight-desc">{slow.recommendation}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Scheduling */}
      {d.optimalSchedule && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Optimal Schedule
          </div>
          <div className="ai-stat-row">
            <span className="ai-stat-label">Weekday</span>
            <span className="ai-stat-value">{d.optimalSchedule.weekday}</span>
          </div>
          <div className="ai-stat-row" style={{ marginBottom: 12 }}>
            <span className="ai-stat-label">Weekend</span>
            <span className="ai-stat-value">{d.optimalSchedule.weekend}</span>
          </div>
        </>
      )}

      {/* Average Order Time */}
      {d.averageOrderTime && (
        <div className="ai-stat-row">
          <span className="ai-stat-label">Avg Order Time</span>
          <span className="ai-stat-value">{d.averageOrderTime}</span>
        </div>
      )}

      {/* Efficiency Tips */}
      {d.efficiencyTips && d.efficiencyTips.length > 0 && (
        <div className="ai-takeaway" style={{ marginTop: 12 }}>
          <i className="bi bi-lightbulb"></i>
          <div>{d.efficiencyTips[0]}</div>
        </div>
      )}
    </div>
  );
};

export default OperationalIntelligenceSection;
