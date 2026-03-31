import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import useDateRange from '../../analytics/hooks/useDateRange';
import useAnalyticsData from '../../analytics/hooks/useAnalyticsData';
import {
  calcTotalRevenue, calcAvgOrderValue, calcTopItems, calcBottomItems,
  calcPaymentMethodBreakdown, calcSourceBreakdown, calcOrderTypeBreakdown,
  calcTotalTips, calcAvgOrderTime, calcKitchenTime, calcCustomerInsights,
  calcCategoryPerformance, calcItemCombos, calcRevenueBreakdown,
  calcOrdersByHour, calcOrdersByDayOfWeek
} from '../../analytics/utils/analyticsCalculations';
import analyticsAIService from '../../../services/analyticsAIService';
import { useMenu } from '../../../contexts/MenuContext';
import { useAuth } from '../../../contexts/AuthContext';

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'ai_tab_';

function getCacheKey(uid, rangeKey, tabKey) {
  return `${CACHE_PREFIX}${uid}_${rangeKey}_${tabKey}`;
}

function readCache(uid, rangeKey, tabKey) {
  try {
    const raw = localStorage.getItem(getCacheKey(uid, rangeKey, tabKey));
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(getCacheKey(uid, rangeKey, tabKey));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeCache(uid, rangeKey, tabKey, data) {
  try {
    localStorage.setItem(getCacheKey(uid, rangeKey, tabKey), JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch {
    // Storage full — ignore
  }
}

// Tab configuration: key → analysis type sent to the Cloud Function
export const AI_TABS = [
  { key: 'summary', label: 'Overview', icon: 'bi-speedometer2', analysisType: 'businessSummary' },
  { key: 'revenue', label: 'Revenue', icon: 'bi-graph-up-arrow', analysisType: 'revenueIntelligence' },
  { key: 'menu', label: 'Menu', icon: 'bi-list-stars', analysisType: 'menuOptimization' },
  { key: 'operations', label: 'Operations', icon: 'bi-gear-wide-connected', analysisType: 'staffInsights' },
  { key: 'customers', label: 'Customers', icon: 'bi-people', analysisType: 'customerIntelligence' },
  { key: 'alerts', label: 'Alerts', icon: 'bi-shield-exclamation', analysisType: 'anomalyAlerts' },
  { key: 'digest', label: 'Digest', icon: 'bi-journal-text', analysisType: 'weeklyReport' }
];

const useAIDashboard = () => {
  const dateRange = useDateRange();
  const { orders, reimbursements, loading: dataLoading } = useAnalyticsData(
    dateRange.startDate,
    dateRange.endDate,
    dateRange.prevStartDate,
    dateRange.prevEndDate
  );
  const { categories } = useMenu();
  const { currentUser } = useAuth();

  const [activeTab, setActiveTab] = useState('summary');
  // Per-tab state: { [tabKey]: { data, loading, error } }
  const [tabState, setTabState] = useState({});
  const progressRef = useRef(null);
  const [loadProgress, setLoadProgress] = useState(0);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);

  const uid = currentUser?.uid;

  // Build enriched order data for AI
  const enrichedOrderData = useMemo(() => {
    if (!orders || orders.length === 0) return null;

    const topItems = calcTopItems(orders, 10, 'revenue');
    const bottomItems = calcBottomItems(orders, 5);
    const paymentMethods = calcPaymentMethodBreakdown(orders);
    const sourceBreakdown = calcSourceBreakdown(orders);
    const orderTypes = calcOrderTypeBreakdown(orders);
    const totalTips = calcTotalTips(orders);
    const avgOrderTime = calcAvgOrderTime(orders);
    const kitchenTime = calcKitchenTime(orders);
    const customerInsights = calcCustomerInsights(orders);
    const categoryPerformance = calcCategoryPerformance(orders);
    const itemCombos = calcItemCombos(orders, 5);
    const revenueBreakdown = calcRevenueBreakdown(orders);
    const ordersByHour = calcOrdersByHour(orders);
    const ordersByDay = calcOrdersByDayOfWeek(orders);

    return {
      totalOrders: orders.length,
      totalRevenue: calcTotalRevenue(orders),
      avgOrderValue: calcAvgOrderValue(orders),
      dateRange: {
        label: dateRange.rangeLabel,
        start: dateRange.startDate.toLocaleDateString(),
        end: dateRange.endDate.toLocaleDateString()
      },
      topItems,
      bottomItems,
      paymentMethods,
      sourceBreakdown,
      orderTypes,
      totalTips,
      avgTip: orders.length > 0 ? totalTips / orders.length : 0,
      avgOrderTime,
      kitchenTime,
      customerInsights,
      categoryPerformance,
      itemCombos,
      revenueBreakdown,
      ordersByHour,
      ordersByDay: ordersByDay.map(d => ({ day: d.name, count: d.count, revenue: d.revenue }))
    };
  }, [orders, dateRange.rangeLabel, dateRange.startDate, dateRange.endDate]);

  // Build menu summary
  const menuSummary = useMemo(() => {
    if (!categories || categories.length === 0) return null;
    let itemCount = 0, totalPrice = 0, minPrice = Infinity, maxPrice = 0, discountedItems = 0;
    categories.forEach(cat => {
      (cat.items || []).forEach(item => {
        itemCount++;
        const p = item.price || 0;
        totalPrice += p;
        if (p < minPrice) minPrice = p;
        if (p > maxPrice) maxPrice = p;
        if (item.discount > 0) discountedItems++;
      });
    });
    return {
      categoryCount: categories.length, itemCount,
      minPrice: minPrice === Infinity ? 0 : minPrice, maxPrice,
      avgPrice: itemCount > 0 ? totalPrice / itemCount : 0, discountedItems
    };
  }, [categories]);

  // Load a single tab's AI data
  const loadTab = useCallback(async (tabKey, forceRefresh = false) => {
    if (!enrichedOrderData || !uid) return;

    const tabConfig = AI_TABS.find(t => t.key === tabKey);
    if (!tabConfig) return;

    // Check cache first
    if (!forceRefresh) {
      const cached = readCache(uid, dateRange.rangeKey, tabKey);
      if (cached) {
        setTabState(prev => ({ ...prev, [tabKey]: { data: cached, loading: false, error: null } }));
        return;
      }
    }

    // Start loading with progress
    setTabState(prev => ({ ...prev, [tabKey]: { data: prev[tabKey]?.data || null, loading: true, error: null } }));
    setLoadProgress(2);

    // Continuous progress animation
    const startTime = Date.now();
    if (progressRef.current) clearInterval(progressRef.current);
    progressRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(92, 92 * (1 - Math.exp(-elapsed / 8)));
      setLoadProgress(Math.max(2, Math.round(pct)));
    }, 150);

    try {
      // Use batch mode with a single type — this routes through buildPromptForType()
      // which supports all analysis types, unlike the old tier-based single mode
      const result = await analyticsAIService.batchAnalyze(
        [tabConfig.analysisType], enrichedOrderData, menuSummary
      );

      clearInterval(progressRef.current);
      setLoadProgress(100);

      const tabResult = result?.data?.[tabConfig.analysisType];
      if (tabResult?.success && tabResult.data) {
        await new Promise(r => setTimeout(r, 300));
        setTabState(prev => ({ ...prev, [tabKey]: { data: tabResult.data, loading: false, error: null } }));
        writeCache(uid, dateRange.rangeKey, tabKey, tabResult.data);
      } else {
        const errMsg = tabResult?.error || 'Unexpected response format';
        setTabState(prev => ({ ...prev, [tabKey]: { data: null, loading: false, error: errMsg } }));
      }
    } catch (err) {
      clearInterval(progressRef.current);
      console.error(`AI tab "${tabKey}" failed:`, err);
      setTabState(prev => ({ ...prev, [tabKey]: { data: null, loading: false, error: err.message || 'Failed to load' } }));
    } finally {
      setLoadProgress(0);
    }
  }, [enrichedOrderData, menuSummary, uid, dateRange.rangeKey]);

  // When active tab changes, load it if not already loaded
  useEffect(() => {
    if (dataLoading || !enrichedOrderData || !uid) return;
    const current = tabState[activeTab];
    if (!current || (!current.data && !current.loading && !current.error)) {
      loadTab(activeTab);
    }
  }, [activeTab, dataLoading, enrichedOrderData, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load default tab when data arrives
  useEffect(() => {
    if (!dataLoading && enrichedOrderData && uid) {
      const current = tabState.summary;
      if (!current || (!current.data && !current.loading && !current.error)) {
        loadTab('summary');
      }
    }
  }, [dataLoading, enrichedOrderData, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset tab state when date range changes
  useEffect(() => {
    setTabState({});
  }, [dateRange.rangeKey]);

  // Refresh current tab (bypass cache)
  const refreshCurrentTab = useCallback(() => {
    loadTab(activeTab, true);
  }, [activeTab, loadTab]);

  // Chat with AI
  const sendChatMessage = useCallback(async (message) => {
    setChatMessages(prev => [...prev, { role: 'user', content: message }]);
    setChatLoading(true);
    try {
      const result = await analyticsAIService.askAI(message, enrichedOrderData, menuSummary);
      if (result.success && result.data) {
        setChatMessages(prev => [...prev, {
          role: 'ai',
          content: result.data.response || result.data.rawResponse || 'No response',
          followUpQuestions: result.data.followUpQuestions || []
        }]);
      }
    } catch {
      setChatMessages(prev => [...prev, {
        role: 'ai', content: 'Sorry, I couldn\'t process that. Please try again.', error: true
      }]);
    } finally {
      setChatLoading(false);
    }
  }, [enrichedOrderData, menuSummary]);

  // Current tab's state
  const currentTabState = tabState[activeTab] || { data: null, loading: false, error: null };

  // Health score from alerts tab (if loaded)
  const healthScore = useMemo(() => {
    const alerts = tabState.alerts;
    if (alerts?.data?.healthScore != null) return alerts.data.healthScore;
    return null;
  }, [tabState]);

  return {
    dateRange,
    orders,
    reimbursements,
    dataLoading,
    enrichedOrderData,
    menuSummary,
    // Tab navigation
    activeTab,
    setActiveTab,
    tabState,
    currentTabState,
    loadProgress,
    // Health
    healthScore,
    // Actions
    refreshCurrentTab,
    // Chat
    chatMessages,
    chatLoading,
    sendChatMessage
  };
};

export default useAIDashboard;
