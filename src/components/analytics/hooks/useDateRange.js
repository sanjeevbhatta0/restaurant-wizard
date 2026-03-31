import { useState, useMemo, useCallback } from 'react';

const RANGE_CONFIGS = {
  today: { label: 'Today', shortLabel: 'Today' },
  last24h: { label: 'Last 24 Hours', shortLabel: '24H' },
  last7d: { label: 'Last 7 Days', shortLabel: '7D' },
  last30d: { label: 'Last 30 Days', shortLabel: '30D' },
  last90d: { label: 'Last 90 Days', shortLabel: '90D' },
  thisMonth: { label: 'This Month', shortLabel: 'Month' },
  lastMonth: { label: 'Last Month', shortLabel: 'Last Mo' },
  thisYear: { label: 'This Year', shortLabel: 'Year' },
  custom: { label: 'Custom', shortLabel: 'Custom' }
};

const useDateRange = () => {
  const [rangeKey, setRangeKey] = useState('last7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    let start, end;

    switch (rangeKey) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = now;
        break;
      case 'last24h':
        start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'last7d':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'last30d':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'last90d':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        end = now;
        break;
      case 'thisMonth':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        break;
      case 'lastMonth': {
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        start = lastMonthDate;
        end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      }
      case 'thisYear':
        start = new Date(now.getFullYear(), 0, 1);
        end = now;
        break;
      case 'custom':
        start = customStart ? new Date(customStart + 'T00:00:00') : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = customEnd ? new Date(customEnd + 'T23:59:59.999') : now;
        break;
      default:
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
    }

    return { startDate: start, endDate: end };
  }, [rangeKey, customStart, customEnd]);

  // Previous period for comparison
  const { prevStartDate, prevEndDate } = useMemo(() => {
    const durationMs = endDate.getTime() - startDate.getTime();
    return {
      prevStartDate: new Date(startDate.getTime() - durationMs),
      prevEndDate: new Date(startDate.getTime() - 1)
    };
  }, [startDate, endDate]);

  const rangeLabel = useMemo(() => {
    if (rangeKey === 'custom' && customStart && customEnd) {
      const s = new Date(customStart + 'T00:00:00');
      const e = new Date(customEnd + 'T00:00:00');
      return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return RANGE_CONFIGS[rangeKey]?.label || 'Last 7 Days';
  }, [rangeKey, customStart, customEnd]);

  // Determine granularity: hourly for <3 days, daily otherwise
  const granularity = useMemo(() => {
    const durationHrs = (endDate - startDate) / (1000 * 60 * 60);
    if (durationHrs <= 72) return 'hourly';
    return 'daily';
  }, [startDate, endDate]);

  const setRange = useCallback((key) => {
    setRangeKey(key);
  }, []);

  return {
    rangeKey,
    setRange,
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    rangeLabel,
    granularity,
    customStart,
    customEnd,
    setCustomStart,
    setCustomEnd,
    RANGE_CONFIGS
  };
};

export default useDateRange;
