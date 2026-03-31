import { useMemo } from 'react';
import {
  calcTotalRevenue,
  calcNetRevenue,
  calcTotalReimbursements,
  calcAvgOrderValue,
  calcTotalTips,
  calcAvgItemsPerOrder,
  calcReimbursementRate,
  calcAvgOrderTime,
  calcPercentChange
} from '../utils/analyticsCalculations';

const usePeriodComparison = (orders, reimbursements, prevOrders, prevReimbursements) => {
  return useMemo(() => {
    const current = {
      totalRevenue: calcTotalRevenue(orders),
      netRevenue: calcNetRevenue(orders, reimbursements),
      totalOrders: orders.length,
      avgOrderValue: calcAvgOrderValue(orders),
      totalTips: calcTotalTips(orders),
      avgItemsPerOrder: calcAvgItemsPerOrder(orders),
      reimbursementRate: calcReimbursementRate(orders, reimbursements),
      avgOrderTime: calcAvgOrderTime(orders),
      totalReimbursements: calcTotalReimbursements(reimbursements)
    };

    const previous = {
      totalRevenue: calcTotalRevenue(prevOrders),
      netRevenue: calcNetRevenue(prevOrders, prevReimbursements),
      totalOrders: prevOrders.length,
      avgOrderValue: calcAvgOrderValue(prevOrders),
      totalTips: calcTotalTips(prevOrders),
      avgItemsPerOrder: calcAvgItemsPerOrder(prevOrders),
      reimbursementRate: calcReimbursementRate(prevOrders, prevReimbursements),
      avgOrderTime: calcAvgOrderTime(prevOrders),
      totalReimbursements: calcTotalReimbursements(prevReimbursements)
    };

    const changes = {};
    Object.keys(current).forEach(key => {
      changes[key] = calcPercentChange(current[key], previous[key]);
    });

    return { current, previous, changes };
  }, [orders, reimbursements, prevOrders, prevReimbursements]);
};

export default usePeriodComparison;
