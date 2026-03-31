/**
 * Pure calculation functions for analytics dashboard.
 * All functions take order/reimbursement arrays and return computed values.
 */

// ============================================
// Date helpers
// ============================================

export const toDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp instanceof Date) return timestamp;
  return new Date(timestamp);
};

// ============================================
// KPI Calculations
// ============================================

export const calcTotalRevenue = (orders) =>
  orders.reduce((sum, o) => sum + (o.total || 0), 0);

export const calcNetRevenue = (orders, reimbursements) =>
  calcTotalRevenue(orders) - reimbursements.reduce((sum, r) => sum + (r.amount || 0), 0);

export const calcTotalReimbursements = (reimbursements) =>
  reimbursements.reduce((sum, r) => sum + (r.amount || 0), 0);

export const calcAvgOrderValue = (orders) => {
  if (orders.length === 0) return 0;
  return calcTotalRevenue(orders) / orders.length;
};

export const calcTotalTips = (orders) =>
  orders.reduce((sum, o) => sum + (o.paymentDetails?.tipAmount || 0), 0);

export const calcAvgItemsPerOrder = (orders) => {
  if (orders.length === 0) return 0;
  const totalItems = orders.reduce((sum, o) => {
    return sum + (o.items || []).reduce((s, item) => s + (item.quantity || 1), 0);
  }, 0);
  return totalItems / orders.length;
};

export const calcReimbursementRate = (orders, reimbursements) => {
  if (orders.length === 0) return 0;
  return (reimbursements.length / orders.length) * 100;
};

export const calcAvgOrderTime = (orders) => {
  const completed = orders.filter(o =>
    o.status === 'completed' && o.createdAt && (o.completedAt || o.paymentDate)
  );
  if (completed.length === 0) return 0;
  const totalMs = completed.reduce((sum, o) => {
    const created = toDate(o.createdAt);
    const done = toDate(o.completedAt || o.paymentDate);
    return sum + (done - created);
  }, 0);
  return totalMs / completed.length / 60000; // minutes
};

// ============================================
// Period comparison: % change from previous period
// ============================================

export const calcPercentChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
};

// ============================================
// Revenue Breakdown
// ============================================

export const calcRevenueBreakdown = (orders) => {
  let subtotal = 0, tax = 0, tips = 0, discounts = 0;
  orders.forEach(order => {
    if (order.paymentDetails) {
      subtotal += order.paymentDetails.subtotal || 0;
      tax += order.paymentDetails.taxAmount || 0;
      tips += order.paymentDetails.tipAmount || 0;
      if (order.paymentDetails.discountAmount > 0) {
        if (order.paymentDetails.discountType === 'percentage') {
          discounts += (order.paymentDetails.subtotal || 0) * (order.paymentDetails.discountAmount / 100);
        } else {
          discounts += order.paymentDetails.discountAmount;
        }
      }
    } else {
      subtotal += order.total || 0;
    }
    // Add promo/points/reward discounts
    discounts += (order.promoDiscount || 0) + (order.pointsDiscount || 0) + (order.rewardDiscount || 0);
  });
  return { subtotal, tax, tips, discounts };
};

// ============================================
// Payment method breakdown
// ============================================

export const calcPaymentMethodBreakdown = (orders) => {
  const methods = { cash: 0, card: 0, online: 0 };
  orders.forEach(o => {
    const method = o.paymentMethod || 'cash';
    if (method === 'card' || method === 'stripe') methods.card += (o.total || 0);
    else if (method === 'payAtRestaurant') methods.cash += (o.total || 0);
    else if (method === 'online') methods.online += (o.total || 0);
    else methods.cash += (o.total || 0);
  });
  return methods;
};

// ============================================
// Source breakdown (POS vs website)
// ============================================

export const calcSourceBreakdown = (orders) => {
  const sources = { pos: 0, website: 0 };
  orders.forEach(o => {
    if (o.source === 'website' || o.source === 'online') sources.website++;
    else sources.pos++;
  });
  return sources;
};

export const calcSourceRevenueBreakdown = (orders) => {
  const sources = { pos: 0, website: 0 };
  orders.forEach(o => {
    if (o.source === 'website' || o.source === 'online') sources.website += (o.total || 0);
    else sources.pos += (o.total || 0);
  });
  return sources;
};

// ============================================
// Order type breakdown
// ============================================

export const calcOrderTypeBreakdown = (orders) => {
  const types = { dine_in: 0, counter: 0, pickup: 0, delivery: 0 };
  orders.forEach(o => {
    const type = o.orderType || 'dine_in';
    if (types.hasOwnProperty(type)) types[type]++;
    else types.dine_in++;
  });
  return types;
};

// ============================================
// Order status distribution
// ============================================

export const calcOrderStatusDistribution = (orders) => {
  const statuses = { new: 0, preparing: 0, ready: 0, completed: 0 };
  orders.forEach(o => {
    const s = o.status || 'new';
    if (s === 'sent_to_kitchen') statuses.new++;
    else if (statuses.hasOwnProperty(s)) statuses[s]++;
    else statuses.new++;
  });
  return statuses;
};

// ============================================
// Time-bucketed data for trend charts
// ============================================

export const bucketByDay = (orders, startDate, endDate) => {
  const buckets = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    buckets.push({
      date: new Date(d),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: 0,
      orders: 0,
      tips: 0,
      reimbursements: 0
    });
  }

  orders.forEach(o => {
    const orderDate = toDate(o.createdAt);
    if (!orderDate) return;
    const dayStart = new Date(orderDate);
    dayStart.setHours(0, 0, 0, 0);
    const bucket = buckets.find(b => b.date.getTime() === dayStart.getTime());
    if (bucket) {
      bucket.revenue += (o.total || 0);
      bucket.orders += 1;
      bucket.tips += (o.paymentDetails?.tipAmount || 0);
    }
  });

  return buckets;
};

export const bucketByHour = (orders, date) => {
  const buckets = [];
  for (let h = 0; h < 24; h++) {
    buckets.push({
      hour: h,
      label: h === 0 ? '12AM' : h === 12 ? '12PM' : h < 12 ? `${h}AM` : `${h - 12}PM`,
      revenue: 0,
      orders: 0,
      tips: 0
    });
  }

  orders.forEach(o => {
    const orderDate = toDate(o.createdAt);
    if (!orderDate) return;
    const hour = orderDate.getHours();
    buckets[hour].revenue += (o.total || 0);
    buckets[hour].orders += 1;
    buckets[hour].tips += (o.paymentDetails?.tipAmount || 0);
  });

  return buckets;
};

// ============================================
// Peak hours / day-of-week
// ============================================

export const calcOrdersByHour = (orders) => {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: i === 0 ? '12AM' : i === 12 ? '12PM' : i < 12 ? `${i}AM` : `${i - 12}PM`,
    count: 0,
    revenue: 0
  }));
  orders.forEach(o => {
    const d = toDate(o.createdAt);
    if (!d) return;
    hours[d.getHours()].count++;
    hours[d.getHours()].revenue += (o.total || 0);
  });
  return hours;
};

export const calcOrdersByDayOfWeek = (orders) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, i) => ({
    day: i, name, count: 0, revenue: 0
  }));
  orders.forEach(o => {
    const d = toDate(o.createdAt);
    if (!d) return;
    days[d.getDay()].count++;
    days[d.getDay()].revenue += (o.total || 0);
  });
  return days;
};

// ============================================
// Hourly revenue heatmap (7 days x 24 hours)
// ============================================

export const calcHourlyHeatmap = (orders) => {
  // grid[dayOfWeek][hour] = revenue
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  orders.forEach(o => {
    const d = toDate(o.createdAt);
    if (!d) return;
    grid[d.getDay()][d.getHours()] += (o.total || 0);
  });
  return grid;
};

// ============================================
// Top / bottom selling items
// ============================================

export const calcTopItems = (orders, limit = 10, sortBy = 'revenue') => {
  const items = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      const key = item.name || 'Unknown';
      if (!items[key]) items[key] = { name: key, quantity: 0, revenue: 0, category: item.categoryName || '' };
      items[key].quantity += (item.quantity || 1);
      items[key].revenue += (item.price || 0) * (item.quantity || 1);
    });
  });
  const sorted = Object.values(items).sort((a, b) => b[sortBy] - a[sortBy]);
  return sorted.slice(0, limit);
};

export const calcBottomItems = (orders, limit = 10) => {
  const items = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      const key = item.name || 'Unknown';
      if (!items[key]) items[key] = { name: key, quantity: 0, revenue: 0 };
      items[key].quantity += (item.quantity || 1);
      items[key].revenue += (item.price || 0) * (item.quantity || 1);
    });
  });
  return Object.values(items).sort((a, b) => a.quantity - b.quantity).slice(0, limit);
};

// ============================================
// Category performance
// ============================================

export const calcCategoryPerformance = (orders) => {
  const cats = {};
  orders.forEach(o => {
    (o.items || []).forEach(item => {
      const cat = item.categoryName || 'Uncategorized';
      if (!cats[cat]) cats[cat] = { name: cat, revenue: 0, quantity: 0, orders: 0 };
      cats[cat].revenue += (item.price || 0) * (item.quantity || 1);
      cats[cat].quantity += (item.quantity || 1);
    });
  });
  return Object.values(cats).sort((a, b) => b.revenue - a.revenue);
};

// ============================================
// Item combos (frequently ordered together)
// ============================================

export const calcItemCombos = (orders, limit = 10) => {
  const pairs = {};
  orders.forEach(o => {
    const itemNames = [...new Set((o.items || []).map(i => i.name).filter(Boolean))];
    for (let i = 0; i < itemNames.length; i++) {
      for (let j = i + 1; j < itemNames.length; j++) {
        const key = [itemNames[i], itemNames[j]].sort().join(' + ');
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
  });
  return Object.entries(pairs)
    .map(([combo, count]) => ({ combo, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};

// ============================================
// Kitchen / service time calculations
// ============================================

export const calcKitchenTime = (orders) => {
  const relevant = orders.filter(o => o.createdAt && o.readyAt);
  if (relevant.length === 0) return 0;
  const totalMs = relevant.reduce((sum, o) => {
    return sum + (toDate(o.readyAt) - toDate(o.createdAt));
  }, 0);
  return totalMs / relevant.length / 60000;
};

export const calcServiceTime = (orders) => {
  const relevant = orders.filter(o => o.readyAt && o.servedAt);
  if (relevant.length === 0) return 0;
  const totalMs = relevant.reduce((sum, o) => {
    return sum + (toDate(o.servedAt) - toDate(o.readyAt));
  }, 0);
  return totalMs / relevant.length / 60000;
};

export const calcFullCycleTime = (orders) => {
  const relevant = orders.filter(o => o.createdAt && (o.completedAt || o.paymentDate));
  if (relevant.length === 0) return 0;
  const totalMs = relevant.reduce((sum, o) => {
    return sum + (toDate(o.completedAt || o.paymentDate) - toDate(o.createdAt));
  }, 0);
  return totalMs / relevant.length / 60000;
};

// ============================================
// Customer insights
// ============================================

export const calcCustomerInsights = (orders) => {
  const customers = {};
  orders.forEach(o => {
    const id = o.customerId || o.customer?.name || 'walk-in-' + o.id;
    if (!customers[id]) customers[id] = { orders: 0, revenue: 0, firstOrder: null, lastOrder: null };
    customers[id].orders++;
    customers[id].revenue += (o.total || 0);
    const d = toDate(o.createdAt);
    if (d) {
      if (!customers[id].firstOrder || d < customers[id].firstOrder) customers[id].firstOrder = d;
      if (!customers[id].lastOrder || d > customers[id].lastOrder) customers[id].lastOrder = d;
    }
  });

  const vals = Object.values(customers);
  const uniqueCustomers = vals.length;
  const returning = vals.filter(c => c.orders > 1).length;
  const newCustomers = uniqueCustomers - returning;
  const avgOrdersPerCustomer = uniqueCustomers > 0 ? orders.length / uniqueCustomers : 0;
  const avgLifetimeValue = uniqueCustomers > 0 ? vals.reduce((s, c) => s + c.revenue, 0) / uniqueCustomers : 0;

  return { uniqueCustomers, newCustomers, returning, avgOrdersPerCustomer, avgLifetimeValue };
};

export const calcCustomerSpendDistribution = (orders) => {
  const buckets = [
    { range: '$0-10', min: 0, max: 10, count: 0 },
    { range: '$10-25', min: 10, max: 25, count: 0 },
    { range: '$25-50', min: 25, max: 50, count: 0 },
    { range: '$50-100', min: 50, max: 100, count: 0 },
    { range: '$100+', min: 100, max: Infinity, count: 0 }
  ];
  orders.forEach(o => {
    const total = o.total || 0;
    const bucket = buckets.find(b => total >= b.min && total < b.max);
    if (bucket) bucket.count++;
  });
  return buckets;
};
