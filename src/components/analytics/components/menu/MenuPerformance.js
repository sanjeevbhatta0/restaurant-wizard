import React from 'react';
import TopItemsByRevenue from './TopItemsByRevenue';
import TopItemsByQuantity from './TopItemsByQuantity';
import BottomPerformers from './BottomPerformers';
import CategoryPerformance from './CategoryPerformance';
import ItemComboAnalysis from './ItemComboAnalysis';

const MenuPerformance = ({ orders }) => {
  return (
    <div className="ca-tab-content">
      <div className="ca-chart-row">
        <div className="ca-chart-half">
          <TopItemsByRevenue orders={orders} />
        </div>
        <div className="ca-chart-half">
          <TopItemsByQuantity orders={orders} />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-half">
          <CategoryPerformance orders={orders} />
        </div>
        <div className="ca-chart-half">
          <BottomPerformers orders={orders} />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-wide">
          <ItemComboAnalysis orders={orders} />
        </div>
      </div>
    </div>
  );
};

export default MenuPerformance;
