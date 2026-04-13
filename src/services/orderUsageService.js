/**
 * Order Usage Tracking Service
 * Tracks order volume per billing cycle and calculates overage charges.
 * Order limits are read from platformConfig/current in Firestore (admin-configured),
 * falling back to hardcoded defaults if the config is unavailable.
 */
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ORDER_LIMITS as FALLBACK_ORDER_LIMITS, MENU_LIMITS } from '../contexts/SubscriptionContext';

// Cache the platform config to avoid reading it on every order
let _cachedOrderLimits = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get order limits from platform config, with caching and fallback
 */
const getOrderLimitsFromConfig = async () => {
    const now = Date.now();
    if (_cachedOrderLimits && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedOrderLimits;
    }

    try {
        const configDoc = await getDoc(doc(db, 'platformConfig', 'current'));
        if (configDoc.exists() && configDoc.data().orderLimits) {
            _cachedOrderLimits = configDoc.data().orderLimits;
            _cacheTimestamp = now;
            return _cachedOrderLimits;
        }
    } catch (err) {
        console.error('Failed to load platform order limits, using fallback:', err);
    }

    return FALLBACK_ORDER_LIMITS;
};

/**
 * Get or initialize order usage data for a restaurant
 */
export const getOrderUsage = async (restaurantId) => {
    const restaurantRef = doc(db, 'restaurants', restaurantId);
    const restaurantDoc = await getDoc(restaurantRef);

    if (!restaurantDoc.exists()) {
        throw new Error('Restaurant not found');
    }

    const data = restaurantDoc.data();
    const subscription = data.subscription || {};

    // If no orderUsage exists, initialize it
    if (!data.orderUsage) {
        const now = new Date();
        const periodEnd = calculatePeriodEnd(now, subscription.billingCycle || 'monthly');

        const initialUsage = {
            currentPeriodCount: 0,
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: periodEnd.toISOString(),
            overageOrders: 0,
            overageCharges: 0,
            menuViewCount: 0,  // Track menu views for scout tier
            lastUpdated: now.toISOString()
        };

        await updateDoc(restaurantRef, { orderUsage: initialUsage });
        return initialUsage;
    }

    // Check if billing period has ended and reset if needed
    const usage = data.orderUsage;
    const periodEnd = new Date(usage.currentPeriodEnd);
    const now = new Date();

    if (now > periodEnd) {
        // Period has ended, reset usage
        const newPeriodEnd = calculatePeriodEnd(now, subscription.billingCycle || 'monthly');
        const resetUsage = {
            currentPeriodCount: 0,
            currentPeriodStart: now.toISOString(),
            currentPeriodEnd: newPeriodEnd.toISOString(),
            overageOrders: 0,
            overageCharges: 0,
            menuViewCount: 0,  // Reset menu views
            lastUpdated: now.toISOString()
        };

        await updateDoc(restaurantRef, { orderUsage: resetUsage });
        return resetUsage;
    }

    // Ensure menuViewCount exists (for existing users without it)
    if (usage.menuViewCount === undefined) {
        usage.menuViewCount = 0;
    }

    return usage;
};

/**
 * Calculate the end of the billing period based on cycle type
 */
const calculatePeriodEnd = (startDate, billingCycle) => {
    const end = new Date(startDate);

    switch (billingCycle) {
        case 'annual':
            end.setFullYear(end.getFullYear() + 1);
            break;
        case 'quarterly':
            end.setMonth(end.getMonth() + 3);
            break;
        case 'monthly':
        default:
            end.setMonth(end.getMonth() + 1);
            break;
    }

    return end;
};

/**
 * Increment order count and calculate any overage charges
 * Returns the overage charge for this order (if any)
 * For hard-capped tiers (scout), blocks orders when limit is reached
 */
export const incrementOrderCount = async (restaurantId, orderTotal) => {
    const restaurantRef = doc(db, 'restaurants', restaurantId);
    const restaurantDoc = await getDoc(restaurantRef);

    if (!restaurantDoc.exists()) {
        throw new Error('Restaurant not found');
    }

    const data = restaurantDoc.data();
    const tier = data.subscription?.tier || 'ally';
    const ORDER_LIMITS = await getOrderLimitsFromConfig();
    const tierLimits = ORDER_LIMITS[tier] || ORDER_LIMITS.ally;

    // Get current usage or initialize
    let usage = await getOrderUsage(restaurantId);

    const newCount = usage.currentPeriodCount + 1;

    // Check if this is a hard-capped tier and limit is reached
    if (tierLimits.hardCap && newCount > tierLimits.limit) {
        return {
            blocked: true,
            reason: `Order limit of ${tierLimits.limit} reached. Please upgrade your plan to continue taking orders.`,
            currentCount: usage.currentPeriodCount,
            limit: tierLimits.limit,
            isHardCapped: true
        };
    }

    let overageCharge = 0;
    let newOverageOrders = usage.overageOrders;
    let newOverageCharges = usage.overageCharges;

    // Check if this order exceeds the limit (for overage-based tiers)
    if (newCount > tierLimits.limit && tierLimits.limit !== Infinity && !tierLimits.hardCap) {
        // This is an overage order
        overageCharge = orderTotal * tierLimits.overageRate;
        newOverageOrders += 1;
        newOverageCharges += overageCharge;
    }

    // Update usage in Firestore
    await updateDoc(restaurantRef, {
        'orderUsage.currentPeriodCount': newCount,
        'orderUsage.overageOrders': newOverageOrders,
        'orderUsage.overageCharges': newOverageCharges,
        'orderUsage.lastUpdated': new Date().toISOString()
    });

    return {
        blocked: false,
        newCount,
        limit: tierLimits.limit,
        isOverLimit: newCount > tierLimits.limit,
        overageCharge,
        totalOverageCharges: newOverageCharges,
        isHardCapped: tierLimits.hardCap || false
    };
};

/**
 * Get usage statistics for display
 */
export const getUsageStats = async (restaurantId) => {
    const restaurantRef = doc(db, 'restaurants', restaurantId);
    const restaurantDoc = await getDoc(restaurantRef);

    if (!restaurantDoc.exists()) {
        return null;
    }

    const data = restaurantDoc.data();
    const tier = data.subscription?.tier || 'ally';
    const ORDER_LIMITS = await getOrderLimitsFromConfig();
    const tierLimits = ORDER_LIMITS[tier] || ORDER_LIMITS.ally;
    const menuLimits = MENU_LIMITS[tier] || MENU_LIMITS.ally;
    const usage = await getOrderUsage(restaurantId);

    const periodEnd = new Date(usage.currentPeriodEnd);
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24)));

    return {
        tier,
        limit: tierLimits.limit,
        overageRate: tierLimits.overageRate,
        currentCount: usage.currentPeriodCount,
        overageOrders: usage.overageOrders,
        overageCharges: usage.overageCharges,
        percentUsed: tierLimits.limit === Infinity
            ? 0
            : Math.min(100, (usage.currentPeriodCount / tierLimits.limit) * 100),
        isOverLimit: usage.currentPeriodCount > tierLimits.limit,
        periodStart: usage.currentPeriodStart,
        periodEnd: usage.currentPeriodEnd,
        daysRemaining,
        isUnlimited: tierLimits.limit === Infinity,
        isHardCapped: tierLimits.hardCap || false,
        // Menu view stats for scout tier
        menuViewCount: usage.menuViewCount || 0,
        menuViewLimit: menuLimits.reads,
        menuViewPercentUsed: menuLimits.reads === Infinity
            ? 0
            : Math.min(100, ((usage.menuViewCount || 0) / menuLimits.reads) * 100),
        hasMenuViewLimit: menuLimits.reads !== Infinity
    };
};

/**
 * Increment menu view count (for scout tier tracking)
 * Called when a customer views the public menu
 */
export const incrementMenuViewCount = async (restaurantId) => {
    const restaurantRef = doc(db, 'restaurants', restaurantId);
    const restaurantDoc = await getDoc(restaurantRef);

    if (!restaurantDoc.exists()) {
        return { success: false, error: 'Restaurant not found' };
    }

    // Get current usage or initialize
    const usage = await getOrderUsage(restaurantId);
    const newCount = (usage.menuViewCount || 0) + 1;

    // Update menu view count in Firestore
    await updateDoc(restaurantRef, {
        'orderUsage.menuViewCount': newCount,
        'orderUsage.lastUpdated': new Date().toISOString()
    });

    return {
        success: true,
        newCount,
        limit: 1000 // Scout tier limit
    };
};

export default {
    getOrderUsage,
    incrementOrderCount,
    incrementMenuViewCount,
    getUsageStats
};
