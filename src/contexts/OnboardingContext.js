import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';

const OnboardingContext = createContext();

export const useOnboarding = () => useContext(OnboardingContext);

// All onboarding steps in order
export const ONBOARDING_STEPS = [
  {
    id: 'restaurant_profile',
    title: 'Set Up Restaurant Profile',
    description: 'Add your restaurant name, address, phone number, hours, and logo',
    icon: 'bi-shop',
    link: '/account',
    category: 'setup',
    autoDetect: (data) => !!(data?.restaurantName && data?.address),
  },
  {
    id: 'menu_setup',
    title: 'Create Your Menu',
    description: 'Add categories and menu items with photos, prices, and descriptions',
    icon: 'bi-menu-button-wide-fill',
    link: '/menu-management',
    category: 'setup',
    autoDetect: null, // checked via subcollection
  },
  {
    id: 'table_layout',
    title: 'Design Table Layout',
    description: 'Set up your floor plan with tables, sections, and seating capacity',
    icon: 'bi-grid-3x3',
    link: '/table-layout',
    category: 'setup',
    autoDetect: null,
  },
  {
    id: 'staff_access',
    title: 'Set Up Staff Access',
    description: 'Create staff accounts for kitchen, servers, and POS operators with role-based access',
    icon: 'bi-people-fill',
    link: '/account?section=access_control',
    category: 'setup',
    autoDetect: null,
  },
  {
    id: 'reimbursement_pin',
    title: 'Set Reimbursement PIN',
    description: 'Create a secure manager PIN for approving refunds and reimbursements',
    icon: 'bi-shield-lock-fill',
    link: '/account?section=pin',
    category: 'setup',
    autoDetect: (data) => !!data?.reimbursementPin,
  },
  {
    id: 'stripe_setup',
    title: 'Connect Stripe Payments',
    description: 'Link your Stripe account to accept card payments from customers',
    icon: 'bi-credit-card-2-front-fill',
    link: '/account?section=payment_account',
    category: 'payments',
    autoDetect: null,
  },
  {
    id: 'stripe_terminal',
    title: 'Set Up Stripe Terminal',
    description: 'Configure your card reader for in-person tap/swipe payments at your POS',
    icon: 'bi-phone-fill',
    link: '/account?section=terminal',
    category: 'payments',
    autoDetect: null,
  },
  {
    id: 'pos_basics',
    title: 'Learn POS Basics',
    description: 'Take your first order — select items, assign a table, and send to kitchen',
    icon: 'bi-grid-3x3-gap-fill',
    link: '/pos',
    category: 'operations',
    autoDetect: null,
  },
  {
    id: 'kitchen_display',
    title: 'Explore Kitchen Display',
    description: 'See how orders appear in the kitchen and how to update order status',
    icon: 'bi-fire',
    link: '/kitchen',
    category: 'operations',
    autoDetect: null,
  },
  {
    id: 'server_view',
    title: 'Explore Server View',
    description: 'Learn how servers manage tables and track active orders',
    icon: 'bi-person-badge-fill',
    link: '/server',
    category: 'operations',
    autoDetect: null,
  },
  {
    id: 'payment_processing',
    title: 'Process a Payment',
    description: 'Learn how to process card/cash payments, split bills, and issue refunds',
    icon: 'bi-cash-stack',
    link: '/payments',
    category: 'operations',
    autoDetect: null,
  },
  {
    id: 'order_management',
    title: 'Manage Orders',
    description: 'View, filter, and track all orders through their lifecycle',
    icon: 'bi-cart-check-fill',
    link: '/orders',
    category: 'operations',
    autoDetect: null,
  },
  {
    id: 'website_builder',
    title: 'Build Your Website',
    description: 'Choose a template, customize colors and content, then publish your restaurant website',
    icon: 'bi-globe2',
    link: '/website-builder',
    category: 'growth',
    autoDetect: null,
  },
  {
    id: 'online_ordering',
    title: 'Enable Online Ordering',
    description: 'Get an embed code to add online ordering to your existing website',
    icon: 'bi-code-slash',
    link: '/website-integration',
    category: 'growth',
    autoDetect: null,
  },
  {
    id: 'promotions_rewards',
    title: 'Set Up Promotions & Rewards',
    description: 'Create promotions, loyalty rewards, and the spin-to-win wheel for customers',
    icon: 'bi-gift-fill',
    link: '/promotions',
    category: 'growth',
    autoDetect: null,
  },
  {
    id: 'analytics_dashboard',
    title: 'Review Analytics',
    description: 'Understand your dashboard — track revenue, orders, peak hours, and trends',
    icon: 'bi-bar-chart-fill',
    link: '/analytics',
    category: 'growth',
    autoDetect: null,
  },
  {
    id: 'seo_social',
    title: 'SEO & Social Media',
    description: 'Connect your social accounts and start posting to Facebook, Instagram, and more',
    icon: 'bi-megaphone-fill',
    link: '/seo-social',
    category: 'growth',
    autoDetect: null,
  },
];

export const CATEGORIES = {
  setup: { label: 'Initial Setup', icon: 'bi-gear-fill', color: '#667eea' },
  payments: { label: 'Payment Setup', icon: 'bi-credit-card-fill', color: '#f5576c' },
  operations: { label: 'Daily Operations', icon: 'bi-lightning-fill', color: '#43e97b' },
  growth: { label: 'Growth & Marketing', icon: 'bi-rocket-takeoff-fill', color: '#fa709a' },
};

export const OnboardingProvider = ({ children }) => {
  const { currentUser, restaurantUid } = useAuth();
  const [completedSteps, setCompletedSteps] = useState({});
  const [dismissed, setDismissed] = useState(false);
  const [activeTour, setActiveTour] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load onboarding state from Firestore
  useEffect(() => {
    if (!restaurantUid) {
      setLoading(false);
      return;
    }

    const loadOnboarding = async () => {
      try {
        const docRef = doc(db, `restaurants/${restaurantUid}/settings/onboarding`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCompletedSteps(data.completedSteps || {});
          setDismissed(data.dismissed || false);
        }
      } catch (error) {
        console.error('Error loading onboarding state:', error);
      } finally {
        setLoading(false);
      }
    };

    loadOnboarding();
  }, [restaurantUid]);

  // Save onboarding state to Firestore
  const saveOnboarding = useCallback(async (updates) => {
    if (!restaurantUid) return;
    try {
      const docRef = doc(db, `restaurants/${restaurantUid}/settings/onboarding`);
      await setDoc(docRef, {
        ...updates,
        updatedAt: new Date(),
      }, { merge: true });
    } catch (error) {
      console.error('Error saving onboarding state:', error);
    }
  }, [restaurantUid]);

  const completeStep = useCallback(async (stepId) => {
    const updated = { ...completedSteps, [stepId]: new Date().toISOString() };
    setCompletedSteps(updated);
    await saveOnboarding({ completedSteps: updated });
  }, [completedSteps, saveOnboarding]);

  const dismissOnboarding = useCallback(async () => {
    setDismissed(true);
    await saveOnboarding({ dismissed: true });
  }, [saveOnboarding]);

  const resetOnboarding = useCallback(async () => {
    setCompletedSteps({});
    setDismissed(false);
    await saveOnboarding({ completedSteps: {}, dismissed: false });
  }, [saveOnboarding]);

  const startTour = useCallback((stepId) => {
    setActiveTour(stepId);
  }, []);

  const endTour = useCallback((stepId) => {
    setActiveTour(null);
    if (stepId) {
      completeStep(stepId);
    }
  }, [completeStep]);

  const completedCount = Object.keys(completedSteps).length;
  const totalSteps = ONBOARDING_STEPS.length;
  const progress = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
  const isComplete = completedCount >= totalSteps;

  const value = {
    completedSteps,
    dismissed,
    activeTour,
    loading,
    progress,
    completedCount,
    totalSteps,
    isComplete,
    completeStep,
    dismissOnboarding,
    resetOnboarding,
    startTour,
    endTour,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};
