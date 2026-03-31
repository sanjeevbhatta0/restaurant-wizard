import React, { useMemo } from 'react';
import { calcItemCombos } from '../../utils/analyticsCalculations';

const ItemComboAnalysis = ({ orders }) => {
  const combos = useMemo(() => calcItemCombos(orders, 10), [orders]);

  if (combos.length === 0) {
    return (
      <div className="ca-chart-panel">
        <h6 className="ca-chart-title">Frequently Ordered Together</h6>
        <div className="ca-chart-empty">Not enough multi-item orders for combo analysis</div>
      </div>
    );
  }

  const maxCount = combos[0]?.count || 1;

  return (
    <div className="ca-chart-panel">
      <h6 className="ca-chart-title">Frequently Ordered Together</h6>
      <div className="ca-combos-list">
        {combos.map((combo, i) => (
          <div key={i} className="ca-combo-item">
            <div className="ca-combo-rank">{i + 1}</div>
            <div className="ca-combo-info">
              <div className="ca-combo-name">{combo.combo}</div>
              <div className="ca-combo-bar-track">
                <div
                  className="ca-combo-bar-fill"
                  style={{ width: `${(combo.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
            <div className="ca-combo-count">{combo.count}x</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ItemComboAnalysis;
