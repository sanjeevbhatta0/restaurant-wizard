import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { adminAuth, adminDb } from '../adminFirebase';
import {
    getDraftConfig,
    getPublishedConfig,
    saveDraft as saveDraftService,
    publishConfig as publishConfigService,
    schedulePublish as schedulePublishService,
    getScheduledChanges,
    cancelScheduledChange,
    DEFAULT_CONFIG
} from '../services/adminConfigService';

const AdminContext = createContext();

export function useAdmin() {
    return useContext(AdminContext);
}

export function AdminProvider({ children }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [draftConfig, setDraftConfig] = useState(DEFAULT_CONFIG);
    const [publishedConfig, setPublishedConfig] = useState(DEFAULT_CONFIG);
    const [scheduledChanges, setScheduledChanges] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);

    // Listen to admin auth state (separate from restaurant auth)
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(adminAuth, (user) => {
            setCurrentUser(user);
            setAuthLoading(false);
        });
        return unsubscribe;
    }, []);

    // Check if current user is admin
    useEffect(() => {
        const checkAdmin = async () => {
            if (currentUser) {
                const adminDocSnap = await getDoc(doc(adminDb, 'admins', currentUser.uid));
                const adminStatus = adminDocSnap.exists();
                setIsAdmin(adminStatus);
            } else {
                setIsAdmin(false);
            }
            setLoading(false);
        };

        if (!authLoading) {
            checkAdmin();
        }
    }, [currentUser, authLoading]);

    // Load configurations
    useEffect(() => {
        const loadConfigs = async () => {
            if (isAdmin) {
                const [draft, published, scheduled] = await Promise.all([
                    getDraftConfig(),
                    getPublishedConfig(),
                    getScheduledChanges()
                ]);
                setDraftConfig(draft);
                setPublishedConfig(published);
                setScheduledChanges(scheduled);
            }
        };

        loadConfigs();
    }, [isAdmin]);

    // Update draft config
    const updateDraft = (updates) => {
        setDraftConfig(prev => {
            const newConfig = { ...prev, ...updates };
            setHasUnsavedChanges(true);
            return newConfig;
        });
    };

    // Update specific pricing
    const updatePricing = (tier, price) => {
        setDraftConfig(prev => ({
            ...prev,
            pricing: { ...prev.pricing, [tier]: parseFloat(price) || 0 }
        }));
        setHasUnsavedChanges(true);
    };

    // Update billing multipliers
    const updateBillingMultiplier = (cycle, multiplier) => {
        setDraftConfig(prev => ({
            ...prev,
            billingMultipliers: { ...prev.billingMultipliers, [cycle]: parseFloat(multiplier) || 1 }
        }));
        setHasUnsavedChanges(true);
    };

    // Add discount
    const addDiscount = (discount) => {
        setDraftConfig(prev => ({
            ...prev,
            discounts: [...prev.discounts, { id: Date.now().toString(), ...discount }]
        }));
        setHasUnsavedChanges(true);
    };

    // Remove discount
    const removeDiscount = (discountId) => {
        setDraftConfig(prev => ({
            ...prev,
            discounts: prev.discounts.filter(d => d.id !== discountId)
        }));
        setHasUnsavedChanges(true);
    };

    // Update discount
    const updateDiscount = (discountId, updates) => {
        setDraftConfig(prev => ({
            ...prev,
            discounts: prev.discounts.map(d =>
                d.id === discountId ? { ...d, ...updates } : d
            )
        }));
        setHasUnsavedChanges(true);
    };

    // Update free trial
    const updateFreeTrial = (tier, enabled, days) => {
        setDraftConfig(prev => ({
            ...prev,
            freeTrials: {
                ...prev.freeTrials,
                [tier]: { enabled, days: parseInt(days) || 0 }
            }
        }));
        setHasUnsavedChanges(true);
    };

    // Update feature tier assignment
    const updateFeatureTier = (featureId, newTier) => {
        setDraftConfig(prev => ({
            ...prev,
            features: {
                ...prev.features,
                [featureId]: { ...prev.features[featureId], tier: newTier }
            }
        }));
        setHasUnsavedChanges(true);
    };

    // Update order limits
    const updateOrderLimit = (tier, updates) => {
        setDraftConfig(prev => ({
            ...prev,
            orderLimits: {
                ...prev.orderLimits,
                [tier]: { ...prev.orderLimits[tier], ...updates }
            }
        }));
        setHasUnsavedChanges(true);
    };

    // Save draft to Firestore
    const saveDraft = async () => {
        if (!currentUser) return { success: false, error: 'Not authenticated' };

        setSaving(true);
        const result = await saveDraftService(draftConfig, currentUser.uid);
        setSaving(false);

        if (result.success) {
            setHasUnsavedChanges(false);
        }

        return result;
    };

    // Publish configuration
    const publish = async () => {
        if (!currentUser) return { success: false, error: 'Not authenticated' };

        setPublishing(true);
        const result = await publishConfigService(draftConfig, currentUser.uid);
        setPublishing(false);

        if (result.success) {
            setPublishedConfig(draftConfig);
            setHasUnsavedChanges(false);
        }

        return result;
    };

    // Schedule publish
    const schedulePublish = async (scheduledFor) => {
        if (!currentUser) return { success: false, error: 'Not authenticated' };

        const result = await schedulePublishService(draftConfig, scheduledFor, currentUser.uid);

        if (result.success) {
            const scheduled = await getScheduledChanges();
            setScheduledChanges(scheduled);
        }

        return result;
    };

    // Cancel scheduled change
    const cancelScheduled = async (changeId) => {
        const result = await cancelScheduledChange(changeId);

        if (result.success) {
            setScheduledChanges(prev => prev.filter(c => c.id !== changeId));
        }

        return result;
    };

    // Reset draft to published
    const resetToPublished = () => {
        setDraftConfig(publishedConfig);
        setHasUnsavedChanges(false);
    };

    const value = {
        currentUser,
        isAdmin,
        loading: loading || authLoading,
        draftConfig,
        publishedConfig,
        scheduledChanges,
        hasUnsavedChanges,
        saving,
        publishing,
        updateDraft,
        updatePricing,
        updateBillingMultiplier,
        addDiscount,
        removeDiscount,
        updateDiscount,
        updateFreeTrial,
        updateFeatureTier,
        updateOrderLimit,
        saveDraft,
        publish,
        schedulePublish,
        cancelScheduled,
        resetToPublished
    };

    return (
        <AdminContext.Provider value={value}>
            {children}
        </AdminContext.Provider>
    );
}
