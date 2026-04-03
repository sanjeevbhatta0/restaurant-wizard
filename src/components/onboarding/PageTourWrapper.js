import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import GuidedTour from './GuidedTour';
import { useOnboarding } from '../../contexts/OnboardingContext';

// Map routes to onboarding step IDs
const ROUTE_TO_STEP = {
  '/account': ['restaurant_profile', 'staff_access', 'reimbursement_pin'],
  '/menu-management': ['menu_setup'],
  '/table-layout': ['table_layout'],
  '/pos': ['pos_basics'],
  '/kitchen': ['kitchen_display'],
  '/server': ['server_view'],
  '/payments': ['stripe_setup', 'stripe_terminal', 'payment_processing'],
  '/orders': ['order_management'],
  '/website-builder': ['website_builder'],
  '/website-integration': ['online_ordering'],
  '/promotions': ['promotions_rewards'],
  '/analytics': ['analytics_dashboard'],
  '/seo-social': ['seo_social'],
};

const PageTourWrapper = () => {
  const location = useLocation();
  const { activeTour } = useOnboarding();

  // Get step IDs for current route
  const stepIds = ROUTE_TO_STEP[location.pathname] || [];

  // Render GuidedTour for the active tour if it matches current page
  if (!activeTour || !stepIds.includes(activeTour)) return null;

  return <GuidedTour stepId={activeTour} />;
};

export default PageTourWrapper;
