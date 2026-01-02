/**
 * Order Usage Tracking Service
 * Tracks order volume per billing cycle and calculates overage charges
 */
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ORDER_LIMITS } from '../contexts/SubscriptionContext';

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
            lastUpdated: now.toISOString()
        };

        await updateDoc(restaurantRef, { orderUsage: resetUsage });
        return resetUsage;
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
 */
export const incrementOrderCount = async (restaurantId, orderTotal) => {
    const restaurantRef = doc(db, 'restaurants', restaurantId);
    const restaurantDoc = await getDoc(restaurantRef);

    if (!restaurantDoc.exists()) {
        throw new Error('Restaurant not found');
    }

    const data = restaurantDoc.data();
    const tier = data.subscription?.tier || 'ally';
    const tierLimits = ORDER_LIMITS[tier] || ORDER_LIMITS.ally;

    // Get current usage or initialize
    let usage = await getOrderUsage(restaurantId);

    const newCount = usage.currentPeriodCount + 1;
    let overageCharge = 0;
    let newOverageOrders = usage.overageOrders;
    let newOverageCharges = usage.overageCharges;

    // Check if this order exceeds the limit
    if (newCount > tierLimits.limit && tierLimits.limit !== Infinity) {
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
        newCount,
        limit: tierLimits.limit,
        isOverLimit: newCount > tierLimits.limit,
        overageCharge,
        totalOverageCharges: newOverageCharges
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
    const tierLimits = ORDER_LIMITS[tier] || ORDER_LIMITS.ally;
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
        isUnlimited: tierLimits.limit === Infinity
    };
};

export default {
    getOrderUsage,
    incrementOrderCount,
    getUsageStats
};
