import React, { createContext, useContext, useState, useEffect } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';

// Configurable trial period (in days) - set to 0 for no trial
export const TRIAL_PERIOD_DAYS = 0;

// Tier definitions with feature access
export const TIER_FEATURES = {
    scout: {
        name: 'Scout',
        icon: '🔍',
        level: 0,
        features: [
            'menu-management',
            'pos',
            'kitchen',
            'server',
            'orders',
            'payments'
        ]
    },
    ally: {
        name: 'Ally',
        icon: '🌱',
        level: 1,
        features: [
            'menu-management',
            'pos',
            'kitchen',
            'server',
            'orders',
            'payments'
            // Analytics moved to Guide tier
        ]
    },
    guide: {
        name: 'Guide',
        icon: '🧭',
        level: 2,
        features: [
            'menu-management',
            'pos',
            'kitchen',
            'server',
            'orders',
            'payments',
            'analytics',
            'website-builder',
            'website-integration'
        ]
    },
    chief: {
        name: 'Chief',
        icon: '🦅',
        level: 3,
        popular: true, // Most popular tier
        features: [
            'menu-management',
            'pos',
            'kitchen',
            'server',
            'orders',
            'payments',
            'analytics',
            'website-builder',
            'website-integration',
            'seo-social' // Without AI features
        ],
        // AI features visible but disabled
        previewFeatures: ['ai-analytics', 'ai-content']
    },
    elder: {
        name: 'Elder',
        icon: '👑',
        level: 4,
        features: [
            'menu-management',
            'pos',
            'kitchen',
            'server',
            'orders',
            'payments',
            'analytics',
            'website-builder',
            'website-integration',
            'seo-social',
            'ai-analytics',
            'ai-content'
        ],
        // Coming soon features to entice upgrades
        comingSoon: [
            'inventory-tracking',
            'ai-forecasting',
            'supplier-management',
            'smart-scheduling',
            'advanced-reports'
        ]
    }
};

// Pricing configuration
export const PRICING = {
    scout: 0,  // Free tier
    ally: 29,
    guide: 59,
    chief: 99,
    elder: 229
};

export const BILLING_MULTIPLIERS = {
    monthly: 1.20,
    quarterly: 1.10,
    annual: 1.00
};

// Order volume limits per tier (per billing cycle)
export const ORDER_LIMITS = {
    scout: { limit: 75, overageRate: 0, hardCap: true }, // Changed from 100 to 75, hard capped  // 100 orders, hard cap - no overage
    ally: { limit: 500, overageRate: 0.02 },      // 500 orders, 2% per order overage
    guide: { limit: 2000, overageRate: 0.01 },    // 2000 orders, 1% per order overage
    chief: { limit: 5000, overageRate: 0.005 },   // 5000 orders, 0.5% per order overage
    elder: { limit: Infinity, overageRate: 0 }    // Unlimited, no overage
};

// Menu limits per tier
export const MENU_LIMITS = {
    scout: { items: 10, reads: Infinity }, // Removed menu view limit (was 1000)  // Free tier limits
    ally: { items: Infinity, reads: Infinity },
    guide: { items: Infinity, reads: Infinity },
    chief: { items: Infinity, reads: Infinity },
    elder: { items: Infinity, reads: Infinity }
};

const SubscriptionContext = createContext();

export const useSubscription = () => {
    const context = useContext(SubscriptionContext);
    if (!context) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
};

export const SubscriptionProvider = ({ children }) => {
    const { currentUser } = useAuth();
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentUser?.uid) {
            setSubscription(null);
            setLoading(false);
            return;
        }

        // Listen to subscription changes in real-time
        const unsubscribe = onSnapshot(
            doc(db, 'restaurants', currentUser.uid),
            (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setSubscription(data.subscription || null);
                } else {
                    setSubscription(null);
                }
                setLoading(false);
            },
            (error) => {
                console.error('Error fetching subscription:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [currentUser]);

    // Get current tier (default to 'ally' if no subscription)
    const getCurrentTier = () => {
        return subscription?.tier || 'ally';
    };

    // Check if user has access to a specific feature
    const hasFeatureAccess = (featureId) => {
        const tier = getCurrentTier();
        const tierInfo = TIER_FEATURES[tier];
        return tierInfo?.features?.includes(featureId) || false;
    };

    // Check if feature is in preview mode (visible but disabled)
    const isFeaturePreview = (featureId) => {
        const tier = getCurrentTier();
        const tierInfo = TIER_FEATURES[tier];
        return tierInfo?.previewFeatures?.includes(featureId) || false;
    };

    // Get tiers that have a specific feature
    const getFeatureTiers = (featureId) => {
        return Object.entries(TIER_FEATURES)
            .filter(([_, info]) => info.features?.includes(featureId))
            .map(([tier, _]) => tier);
    };

    // Get the minimum tier required for a feature
    const getMinimumTierForFeature = (featureId) => {
        const tiers = getFeatureTiers(featureId);
        if (tiers.length === 0) return 'elder';

        return tiers.reduce((min, tier) => {
            return TIER_FEATURES[tier].level < TIER_FEATURES[min].level ? tier : min;
        });
    };

    // Check if current tier can upgrade
    const canUpgrade = () => {
        const tier = getCurrentTier();
        return TIER_FEATURES[tier]?.level < 4;
    };

    // Get next available tier
    const getNextTier = () => {
        const tier = getCurrentTier();
        const currentLevel = TIER_FEATURES[tier]?.level || 1;

        return Object.entries(TIER_FEATURES)
            .find(([_, info]) => info.level === currentLevel + 1)?.[0] || null;
    };

    // Calculate price for a tier and billing cycle
    const calculatePrice = (tier, billingCycle = 'annual') => {
        const basePrice = PRICING[tier] || 0;
        const multiplier = BILLING_MULTIPLIERS[billingCycle] || 1;
        return (basePrice * multiplier).toFixed(2);
    };

    // Check subscription status
    const isSubscriptionActive = () => {
        return subscription?.status === 'active' || subscription?.status === 'trialing';
    };

    // Get days remaining in trial
    const getTrialDaysRemaining = () => {
        if (subscription?.status !== 'trialing' || !subscription?.trialEnd) return 0;

        const trialEnd = subscription.trialEnd.toDate ? subscription.trialEnd.toDate() : new Date(subscription.trialEnd);
        const now = new Date();
        const diffTime = trialEnd - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return Math.max(0, diffDays);
    };

    // Get order limit for current tier
    const getOrderLimit = () => {
        const tier = getCurrentTier();
        return ORDER_LIMITS[tier] || ORDER_LIMITS.ally;
    };

    // Calculate overage charge for an order amount
    const calculateOverageCharge = (orderTotal) => {
        const tier = getCurrentTier();
        const overageRate = ORDER_LIMITS[tier]?.overageRate || 0;
        return orderTotal * overageRate;
    };

    // Check if current usage is over limit
    const isOverOrderLimit = (currentCount) => {
        const { limit } = getOrderLimit();
        return currentCount > limit;
    };

    // Get menu limits for current tier
    const getMenuLimit = () => {
        const tier = getCurrentTier();
        return MENU_LIMITS[tier] || MENU_LIMITS.ally;
    };

    // Check if order is hard capped (no overage allowed)
    const isOrderHardCapped = () => {
        const tier = getCurrentTier();
        return ORDER_LIMITS[tier]?.hardCap === true;
    };

    const value = {
        subscription,
        loading,
        getCurrentTier,
        hasFeatureAccess,
        isFeaturePreview,
        getMinimumTierForFeature,
        canUpgrade,
        getNextTier,
        calculatePrice,
        isSubscriptionActive,
        getTrialDaysRemaining,
        TIER_FEATURES,
        PRICING,
        TRIAL_PERIOD_DAYS,
        ORDER_LIMITS,
        MENU_LIMITS,
        getOrderLimit,
        getMenuLimit,
        calculateOverageCharge,
        isOverOrderLimit,
        isOrderHardCapped
    };

    return (
        <SubscriptionContext.Provider value={value}>
            {children}
        </SubscriptionContext.Provider>
    );
};
