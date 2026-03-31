import React from 'react';
import SectionHeader from './SectionHeader';
import SkeletonCard from './SkeletonCard';

const WeeklyDigestSection = ({ data, onRefresh }) => {
  if (!data || data.loading) return <SkeletonCard lines={6} />;

  if (!data.success || !data.data) {
    return (
      <div className="ai-glass">
        <SectionHeader icon="bi-journal-text" title="Weekly Digest" onRefresh={onRefresh} />
        <div className="ai-error-text">Could not load weekly digest</div>
      </div>
    );
  }

  const d = data.data;

  return (
    <div className="ai-glass">
      <SectionHeader icon="bi-journal-text" title="Weekly Digest" onRefresh={onRefresh} />

      {/* Report Title & Period */}
      {d.reportTitle && (
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginBottom: 4 }}>
          {d.reportTitle}
        </div>
      )}
      {d.period && (
        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
          {d.period}
        </div>
      )}

      {/* Executive Summary */}
      {d.executiveSummary && (
        <div style={{
          background: 'rgba(102,126,234,0.08)',
          border: '1px solid rgba(102,126,234,0.15)',
          borderRadius: 10, padding: '0.85rem 1rem', marginBottom: 16,
          fontSize: '0.9rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.6
        }}>
          {d.executiveSummary}
        </div>
      )}

      {/* Sections */}
      {d.sections && d.sections.length > 0 && (
        d.sections.map((section, i) => (
          <div key={i} className="ai-digest-section">
            <div className="ai-digest-section-title">{section.title}</div>
            <div className="ai-digest-section-content">{section.content}</div>
            {section.highlight && (
              <span className="ai-digest-highlight">{section.highlight}</span>
            )}
          </div>
        ))
      )}

      {/* Action Items */}
      {d.actionItems && d.actionItems.length > 0 && (
        <>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 8 }}>
            Action Items
          </div>
          {d.actionItems.map((item, i) => (
            <div key={i} className="ai-action-item">
              <div className={`ai-action-priority ${item.priority || 'medium'}`}></div>
              <div>
                <div className="ai-action-text">{item.task}</div>
                {item.expectedImpact && (
                  <div className="ai-action-impact">{item.expectedImpact}</div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Next Week Focus */}
      {d.nextWeekFocus && (
        <div className="ai-takeaway">
          <i className="bi bi-bullseye"></i>
          <div><strong>Next Week Focus:</strong> {d.nextWeekFocus}</div>
        </div>
      )}
    </div>
  );
};

export default WeeklyDigestSection;
