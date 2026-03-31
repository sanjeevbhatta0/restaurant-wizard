import React from 'react';
import OrderTrendChart from './OrderTrendChart';
import OrderStatusBars from './OrderStatusBars';
import PeakHoursChart from './PeakHoursChart';
import OrdersByDayChart from './OrdersByDayChart';
import OrderSourceBreakdown from './OrderSourceBreakdown';
import OrderTypeBreakdown from './OrderTypeBreakdown';

const OrdersOverview = ({ orders, prevOrders, startDate, endDate, granularity }) => {
  return (
    <div className="ca-tab-content">
      <div className="ca-chart-row">
        <div className="ca-chart-two-thirds">
          <OrderTrendChart orders={orders} prevOrders={prevOrders} startDate={startDate} endDate={endDate} granularity={granularity} />
        </div>
        <div className="ca-chart-one-third">
          <OrderStatusBars orders={orders} />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-half">
          <PeakHoursChart orders={orders} />
        </div>
        <div className="ca-chart-half">
          <OrdersByDayChart orders={orders} />
        </div>
      </div>

      <div className="ca-chart-row">
        <div className="ca-chart-half">
          <OrderSourceBreakdown orders={orders} />
        </div>
        <div className="ca-chart-half">
          <OrderTypeBreakdown orders={orders} />
        </div>
      </div>
    </div>
  );
};

export default OrdersOverview;
