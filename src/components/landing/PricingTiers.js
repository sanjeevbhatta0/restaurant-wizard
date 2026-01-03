import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeToPublishedConfig, DEFAULT_CONFIG } from '../../services/adminConfigService';

// Fallback constants (used while loading or if Firestore fetch fails)
const FALLBACK_TRIAL_PERIOD_DAYS = 0;

const FALLBACK_PRICES = {
  scout: 0,
  ally: 29,
  guide: 59,
  chief: 99,
  elder: 229
};

const FALLBACK_MULTIPLIERS = {
  monthly: 1.20,
  quarterly: 1.10,
  annual: 1.00
};

const FALLBACK_ORDER_LIMITS = {
  scout: { limit: 75, overageRate: 0, hardCap: true },
  ally: { limit: 500, overageRate: 0.02 },
  guide: { limit: 2000, overageRate: 0.01 },
  chief: { limit: 5000, overageRate: 0.005 },
  elder: { limit: Infinity, overageRate: 0 }
};

const FALLBACK_TIER_FEATURES = {
  scout: {
    name: 'Scout',
    tagline: 'Start for free',
    description: 'Perfect for testing the waters',
    icon: '🔍',
    color: '#6b7280',
    features: [
      { name: 'Menu Management', included: true, description: 'Up to 10 menu items' },
      { name: 'Point of Sale (POS)', included: true, description: 'Tablet-friendly order taking' },
      { name: 'Kitchen Display', included: true, description: 'Real-time order display' },
      { name: 'Server View', included: true, description: 'Table management' },
      { name: 'Order Management', included: true, description: 'Up to 75 orders/month' },
      { name: 'Payment Processing', included: true, description: 'Integrated Stripe payments' },
      { name: 'AI Menu Upload', included: false, description: 'Available in Ally tier' },
      { name: 'Basic Analytics', included: false },
      { name: 'Website Builder', included: false },
    ],
    restrictions: [
      { icon: '📍', text: 'Single location only' },
      { icon: '🍽️', text: '10 menu items max' },
      { icon: '📦', text: '75 orders/month' },
    ]
  },
  ally: {
    name: 'Ally',
    tagline: 'Start your journey',
    description: 'Essential tools for restaurant operations',
    icon: '🌱',
    color: '#4ade80',
    features: [
      { name: 'Menu Management', included: true, description: 'Create and manage your menu with categories and items' },
      { name: 'Point of Sale (POS)', included: true, description: 'Tablet-friendly order taking interface' },
      { name: 'Kitchen Display', included: true, description: 'Real-time order display for kitchen staff' },
      { name: 'Server View', included: true, description: 'Table management and order status for servers' },
      { name: 'Order Management', included: true, description: 'Track orders from creation to completion' },
      { name: 'Payment Processing', included: true, description: 'Integrated Stripe payments' },
      { name: 'AI Menu Upload', included: true, description: 'Limited time bonus!' },
      { name: 'Basic Analytics', included: false, description: 'Available in Guide tier and above' },
      { name: 'Website Builder', included: false },
      { name: 'Website Integration', included: false },
      { name: 'SEO & Social', included: false },
      { name: 'AI-Powered Features', included: false },
    ]
  },
  guide: {
    name: 'Guide',
    tagline: 'Lead the way',
    description: 'Expand your online presence',
    icon: '🧭',
    color: '#60a5fa',
    features: [
      { name: 'Menu Management', included: true },
      { name: 'Point of Sale (POS)', included: true },
      { name: 'Kitchen Display', included: true },
      { name: 'Server View', included: true },
      { name: 'Order Management', included: true },
      { name: 'Payment Processing', included: true },
      { name: 'Basic Analytics', included: true, description: 'Sales reports and order insights' },
      { name: 'Website Builder', included: true, description: 'Create a beautiful website for your restaurant' },
      { name: 'Website Integration', included: true, description: 'Embed your menu on any external website' },
      { name: 'SEO & Social', included: false },
      { name: 'AI-Powered Features', included: false },
    ]
  },
  chief: {
    name: 'Chief',
    tagline: 'Command respect',
    description: 'Boost visibility with SEO & Social',
    icon: '🦅',
    color: '#f59e0b',
    popular: true,
    features: [
      { name: 'Menu Management', included: true },
      { name: 'Point of Sale (POS)', included: true },
      { name: 'Kitchen Display', included: true },
      { name: 'Server View', included: true },
      { name: 'Order Management', included: true },
      { name: 'Payment Processing', included: true },
      { name: 'Basic Analytics', included: true },
      { name: 'Website Builder', included: true },
      { name: 'Website Integration', included: true },
      { name: 'SEO & Social', included: true, description: 'Post to Facebook & Instagram (AI features excluded)' },
      { name: 'AI-Powered Features', included: 'preview', description: 'View only - upgrade to Elder to unlock' },
    ]
  },
  elder: {
    name: 'Elder',
    tagline: 'Achieve wisdom',
    description: 'Unlock the full power of AI',
    icon: '👑',
    color: '#a855f7',
    features: [
      { name: 'Menu Management', included: true },
      { name: 'Point of Sale (POS)', included: true },
      { name: 'Kitchen Display', included: true },
      { name: 'Server View', included: true },
      { name: 'Order Management', included: true },
      { name: 'Payment Processing', included: true },
      { name: 'Basic Analytics', included: true },
      { name: 'Website Builder', included: true },
      { name: 'Website Integration', included: true },
      { name: 'SEO & Social', included: true, description: 'Full access with AI content generation' },
      { name: 'AI-Powered Analytics', included: true, description: 'AI insights, predictions, and recommendations' },
    ],
    comingSoon: [
      { name: 'Inventory Tracking', icon: '📦', description: 'Real-time stock levels and alerts' },
      { name: 'AI Demand Forecasting', icon: '🔮', description: 'Predict busy periods and prep needs' },
      { name: 'Supplier Management', icon: '🤝', description: 'Manage vendors and automate ordering' },
      { name: 'Smart Staff Scheduling', icon: '📅', description: 'AI-optimized shift planning' },
      { name: 'Advanced Reporting', icon: '📊', description: 'Custom reports and dashboards' },
    ]
  }
};

const PricingTiers = () => {
  const [billingCycle, setBillingCycle] = useState('annual');
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Subscribe to live config updates from Firestore
  useEffect(() => {
    const unsubscribe = subscribeToPublishedConfig((publishedConfig) => {
      setConfig(publishedConfig);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Use config values or fallbacks
  const BASE_PRICES = config?.pricing || FALLBACK_PRICES;
  const BILLING_MULTIPLIERS = config?.billingMultipliers || FALLBACK_MULTIPLIERS;
  const ORDER_LIMITS = config?.orderLimits || FALLBACK_ORDER_LIMITS;
  const TIER_FEATURES = FALLBACK_TIER_FEATURES; // Features still use fallback for display structure
  const TRIAL_PERIOD_DAYS = getMaxTrialDays();

  function getMaxTrialDays() {
    if (!config?.freeTrials) return FALLBACK_TRIAL_PERIOD_DAYS;
    return Math.max(...Object.values(config.freeTrials).map(t => t.enabled ? t.days : 0));
  }

  // Check for active discounts
  const getActiveDiscount = (tier) => {
    if (!config?.discounts) return null;
    const now = new Date();
    return config.discounts.find(d => {
      if (!d.active) return false;
      const start = new Date(d.startDate);
      const end = new Date(d.endDate);
      return now >= start && now <= end &&
        ((d.type === 'tier' && d.target === tier) ||
          (d.type === 'billing_cycle' && d.target === billingCycle));
    });
  };

  const calculatePrice = (baseTier) => {
    const basePrice = BASE_PRICES[baseTier] || 0;
    const multiplier = BILLING_MULTIPLIERS[billingCycle] || 1;
    const discount = getActiveDiscount(baseTier);

    let discountAmount = 0;
    if (discount) {
      if (discount.isPercentage) {
        discountAmount = basePrice * (discount.amount / 100);
      } else {
        discountAmount = discount.amount;
      }
    }

    return Math.max(0, (basePrice - discountAmount) * multiplier).toFixed(2);
  };

  const getOriginalPrice = (baseTier) => {
    const basePrice = BASE_PRICES[baseTier] || 0;
    const multiplier = BILLING_MULTIPLIERS[billingCycle] || 1;
    return (basePrice * multiplier).toFixed(2);
  };

  const hasDiscount = (tier) => {
    return getActiveDiscount(tier) !== null;
  };

  const getAnnualSavings = (baseTier) => {
    const basePrice = BASE_PRICES[baseTier] || 0;
    const monthlyPrice = basePrice * (BILLING_MULTIPLIERS.monthly || 1.20);
    const annualMonthly = basePrice;
    return ((monthlyPrice - annualMonthly) * 12).toFixed(0);
  };

  const getTierTrialDays = (tier) => {
    if (!config?.freeTrials?.[tier]?.enabled) return 0;
    return config.freeTrials[tier].days;
  };

  const handleSelectTier = (tierKey) => {
    navigate(`/signup?tier=${tierKey}&cycle=${billingCycle}`);
  };

  return (
    <div className="pricing-container">
      {/* Billing Toggle */}
      <div className="billing-toggle">
        <button
          className={`toggle-btn ${billingCycle === 'monthly' ? 'active' : ''}`}
          onClick={() => setBillingCycle('monthly')}
        >
          Monthly
          <span className="toggle-badge red">+20%</span>
        </button>
        <button
          className={`toggle-btn ${billingCycle === 'quarterly' ? 'active' : ''}`}
          onClick={() => setBillingCycle('quarterly')}
        >
          Quarterly
          <span className="toggle-badge yellow">+10%</span>
        </button>
        <button
          className={`toggle-btn ${billingCycle === 'annual' ? 'active' : ''}`}
          onClick={() => setBillingCycle('annual')}
        >
          Annual
          <span className="toggle-badge green">Best Value</span>
        </button>
      </div>

      {/* Tier Cards */}
      <div className="pricing-grid">
        {Object.entries(TIER_FEATURES).map(([key, tier]) => {
          const tierTrialDays = getTierTrialDays(key);
          const activeDiscount = getActiveDiscount(key);
          const originalPrice = getOriginalPrice(key);
          const discountedPrice = calculatePrice(key);
          const hasActiveDiscount = hasDiscount(key) && parseFloat(originalPrice) > parseFloat(discountedPrice);

          return (
            <div
              key={key}
              className={`pricing-card ${tier.popular ? 'popular' : ''}`}
              style={{ '--tier-color': tier.color }}
            >
              {tier.popular && <div className="popular-badge">Most Popular</div>}

              {/* Per-tier Free Trial Badge */}
              {tierTrialDays > 0 && key !== 'scout' && (
                <div className="tier-trial-badge">
                  🎁 {tierTrialDays}-day free trial
                </div>
              )}

              <div className="pricing-header">
                <span className="tier-icon">{tier.icon}</span>
                <h3 className="tier-name">{tier.name}</h3>
                <p className="tier-tagline">{tier.tagline}</p>
              </div>

              <div className="pricing-price">
                {key === 'scout' ? (
                  <>
                    <span className="amount free">Free</span>
                    <span className="period">forever</span>
                  </>
                ) : (
                  <>
                    {hasActiveDiscount && (
                      <span className="original-price">${originalPrice}</span>
                    )}
                    <span className="currency">$</span>
                    <span className="amount">{discountedPrice}</span>
                    <span className="period">/mo</span>
                  </>
                )}
              </div>

              {/* Discount Badge */}
              {hasActiveDiscount && activeDiscount && (
                <div className="discount-badge">
                  🏷️ {activeDiscount.name} - {activeDiscount.amount}{activeDiscount.isPercentage ? '%' : '$'} off!
                </div>
              )}

              {billingCycle === 'annual' && key !== 'scout' && parseFloat(getAnnualSavings(key)) > 0 && !hasActiveDiscount && (
                <div className="annual-savings">
                  Save ${getAnnualSavings(key)}/year
                </div>
              )}

              {/* Order Limit Display */}
              {/* Enabled for all tiers now, with custom style for scout */}
              <div
                className="order-limit-badge"
                style={key === 'scout' ? { background: '#f8fafc', borderColor: '#e2e8f0' } : {}}
              >
                {key === 'scout' ? (
                  <i className="bi bi-shield-lock" style={{ color: '#64748b' }}></i>
                ) : (
                  <i className="bi bi-bag-check"></i>
                )}

                {ORDER_LIMITS[key].limit === Infinity ? (
                  <span>Unlimited Orders</span>
                ) : (
                  <span>{ORDER_LIMITS[key].limit.toLocaleString()} orders/month</span>
                )}
                {ORDER_LIMITS[key].hardCap && (
                  <span className="hard-cap-badge">Hard cap</span>
                )}
                {ORDER_LIMITS[key].overageRate > 0 && (
                  <span className="overage-rate">{(ORDER_LIMITS[key].overageRate * 100)}% overage per order</span>
                )}
              </div>

              {/* Restrictions for Scout */}
              {
                tier.restrictions && (
                  <div className="restrictions-list">
                    {tier.restrictions.map((restriction, idx) => (
                      <div key={idx} className="restriction-item">
                        <span className="restriction-icon">{restriction.icon}</span>
                        <span>{restriction.text}</span>
                      </div>
                    ))}
                  </div>
                )
              }

              < p className="tier-description" > {tier.description}</p>

              <button
                className={`tier-cta ${key === 'scout' ? 'free-cta' : ''}`}
                onClick={() => handleSelectTier(key)}
              >
                {key === 'scout' ? 'Start Free' : (tierTrialDays > 0 ? 'Start Free Trial' : 'Get Started')}
              </button>

              <ul className="feature-list">
                {tier.features.map((feature, idx) => (
                  <li
                    key={idx}
                    className={`feature-item ${feature.included === true ? 'included' :
                      feature.included === 'preview' ? 'preview' : 'not-included'
                      }`}
                    title={feature.description || ''}
                  >
                    {feature.included === true && (
                      <svg className="feature-icon check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {feature.included === 'preview' && (
                      <svg className="feature-icon eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                    {feature.included === false && (
                      <svg className="feature-icon x" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                    <span>{feature.name}</span>
                    {feature.description && (
                      <span className="feature-tooltip">
                        <svg className="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <span className="tooltip-text">{feature.description}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {/* Coming Soon Section for Elder */}
              {tier.comingSoon && (
                <div className="coming-soon-section">
                  <div className="coming-soon-header">
                    <span className="coming-soon-badge">🚀 Coming Soon</span>
                  </div>
                  <ul className="coming-soon-list">
                    {tier.comingSoon.map((item, idx) => (
                      <li key={idx} className="coming-soon-item">
                        <span className="coming-soon-icon">{item.icon}</span>
                        <div className="coming-soon-content">
                          <span className="coming-soon-name">{item.name}</span>
                          <span className="coming-soon-desc">{item.description}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div >

      {/* Trust Badges */}
      < div className="trust-section" >
        <div className="trust-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Secure Payments</span>
        </div>
        <div className="trust-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 10h18" />
          </svg>
          <span>Cancel Anytime</span>
        </div>
        <div className="trust-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Easy Upgrades</span>
        </div>
      </div >

      <style jsx>{`
        .pricing-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 2rem 0;
        }

        .trial-banner {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(64, 224, 208, 0.1) 100%);
          border: 1px solid rgba(168, 85, 247, 0.2);
          border-radius: 12px;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 2rem;
          font-size: 1.1rem;
        }

        .trial-icon {
          font-size: 1.5rem;
        }

        .billing-toggle {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-bottom: 3rem;
          background: #f3f4f6;
          padding: 6px;
          border-radius: 16px;
          width: fit-content;
          margin-left: auto;
          margin-right: auto;
        }

        .toggle-btn {
          padding: 12px 24px;
          border: none;
          background: transparent;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #666;
        }

        .toggle-btn.active {
          background: white;
          color: #1a1a2e;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .toggle-badge {
          font-size: 0.7rem;
          padding: 2px 6px;
          border-radius: 6px;
          font-weight: 700;
        }

        .toggle-badge.red {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }

        .toggle-badge.yellow {
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
        }

        .toggle-badge.green {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
        }

        .pricing-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 1.5rem;
          align-items: stretch;
          justify-content: center;
          width: 100%;
        }

        .amount.free {
          font-size: 2.5rem;
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .free-cta {
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%) !important;
        }

        .hard-cap-badge {
          font-size: 0.7rem;
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          padding: 2px 8px;
          border-radius: 6px;
          font-weight: 600;
        }

        .restrictions-list {
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid rgba(239, 68, 68, 0.1);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 1rem;
        }

        .restriction-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8rem;
          color: #666;
          margin-bottom: 4px;
        }

        .restriction-item:last-child {
          margin-bottom: 0;
        }

        .restriction-icon {
          font-size: 0.9rem;
        }

        .pricing-card {
          background: white;
          border-radius: 24px;
          padding: 2rem;
          position: relative;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          transition: all 0.3s ease;
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .pricing-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
        }

        .pricing-card.popular {
          border: 2px solid var(--tier-color, #60a5fa);
          transform: scale(1.05);
        }

        .pricing-card.popular:hover {
          transform: scale(1.05) translateY(-8px);
        }

        .popular-badge {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--tier-color, #60a5fa);
          color: white;
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 0.8rem;
          font-weight: 700;
        }

        .tier-trial-badge {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%);
          border: 1px solid rgba(168, 85, 247, 0.3);
          padding: 8px 12px;
          border-radius: 10px;
          text-align: center;
          font-size: 0.85rem;
          font-weight: 600;
          color: #7c3aed;
          margin-bottom: 1rem;
        }

        .discount-badge {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(245, 158, 11, 0.15) 100%);
          border: 1px solid rgba(251, 191, 36, 0.3);
          padding: 8px 12px;
          border-radius: 10px;
          text-align: center;
          font-size: 0.8rem;
          font-weight: 600;
          color: #d97706;
          margin-bottom: 1rem;
        }

        .original-price {
          display: block;
          text-decoration: line-through;
          color: #999;
          font-size: 0.9rem;
          margin-bottom: 2px;
        }

        .pricing-header {
          text-align: center;
          margin-bottom: 1.5rem;
        }

        .tier-icon {
          font-size: 2.5rem;
          display: block;
          margin-bottom: 0.5rem;
        }

        .tier-name {
          font-size: 1.5rem;
          font-weight: 800;
          color: #1a1a2e;
          margin: 0 0 0.25rem;
        }

        .tier-tagline {
          color: var(--tier-color);
          font-weight: 600;
          font-size: 0.9rem;
          margin: 0;
        }

        .pricing-price {
          text-align: center;
          margin-bottom: 0.5rem;
        }

        .currency {
          font-size: 1.5rem;
          color: #666;
          vertical-align: top;
        }

        .amount {
          font-size: 3rem;
          font-weight: 800;
          color: #1a1a2e;
        }

        .period {
          font-size: 1rem;
          color: #666;
        }

        .annual-savings {
          text-align: center;
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 0.85rem;
          font-weight: 600;
          margin-bottom: 1rem;
        }

        .order-limit-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 12px 16px;
          background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
          border: 1px solid rgba(102, 126, 234, 0.2);
          border-radius: 10px;
          margin-bottom: 1rem;
          font-weight: 600;
          color: #667eea;
        }

        .order-limit-badge i {
          font-size: 1.2rem;
          margin-bottom: 2px;
        }

        .order-limit-badge .overage-rate {
          font-size: 0.75rem;
          color: #f59e0b;
          font-weight: 500;
        }

        .tier-description {
          text-align: center;
          color: #666;
          font-size: 0.95rem;
          margin-bottom: 1.5rem;
          min-height: 40px;
        }

        .tier-cta {
          width: 100%;
          padding: 14px;
          background: var(--tier-color);
          border: none;
          border-radius: 12px;
          color: white;
          font-weight: 700;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-bottom: 1.5rem;
          margin-top: auto;
        }

        .tier-cta:hover {
          transform: scale(1.02);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
        }

        .feature-list {
          list-style: none;
          padding: 0;
          margin: 0;
          flex-grow: 1;
        }

        .feature-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 0;
          font-size: 0.9rem;
          border-bottom: 1px solid #f3f4f6;
        }

        .feature-item:last-child {
          border-bottom: none;
        }

        .feature-item.included {
          color: #1a1a2e;
        }

        .feature-item.preview {
          color: #f59e0b;
        }

        .feature-item.not-included {
          color: #ccc;
        }

        .feature-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        .feature-icon.check {
          color: #22c55e;
        }

        .feature-icon.eye {
          color: #f59e0b;
        }

        .feature-icon.x {
          color: #ccc;
        }

        .feature-tooltip {
          position: relative;
          margin-left: auto;
          cursor: help;
        }

        .info-icon {
          width: 16px;
          height: 16px;
          color: #999;
        }

        .tooltip-text {
          position: absolute;
          right: 0;
          bottom: 100%;
          background: #1a1a2e;
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 0.8rem;
          width: 200px;
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s ease;
          z-index: 10;
          margin-bottom: 8px;
        }

        .feature-tooltip:hover .tooltip-text {
          opacity: 1;
          visibility: visible;
        }

        /* Coming Soon Section */
        .coming-soon-section {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 2px dashed rgba(168, 85, 247, 0.3);
        }

        .coming-soon-header {
          text-align: center;
          margin-bottom: 1rem;
        }

        .coming-soon-badge {
          background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%);
          color: white;
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 0.8rem;
          font-weight: 700;
          display: inline-block;
        }

        .coming-soon-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .coming-soon-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px solid #f3f4f6;
        }

        .coming-soon-item:last-child {
          border-bottom: none;
        }

        .coming-soon-icon {
          font-size: 1.2rem;
          flex-shrink: 0;
        }

        .coming-soon-content {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .coming-soon-name {
          font-weight: 600;
          color: #1a1a2e;
          font-size: 0.85rem;
        }

        .coming-soon-desc {
          font-size: 0.75rem;
          color: #666;
        }

        .trust-section {
          display: flex;
          justify-content: center;
          gap: 3rem;
          margin-top: 3rem;
          padding-top: 2rem;
          border-top: 1px solid #e5e7eb;
        }

        .trust-item {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #666;
          font-weight: 500;
        }

        .trust-item svg {
          color: #22c55e;
        }

        @media (max-width: 1200px) {
          .pricing-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .pricing-card.popular {
            transform: none;
          }

          .pricing-card.popular:hover {
            transform: translateY(-8px);
          }
        }

        @media (max-width: 768px) {
          .pricing-grid {
            grid-template-columns: 1fr;
            max-width: 400px;
            margin: 0 auto;
          }

          .billing-toggle {
            flex-direction: column;
            width: 100%;
            max-width: 300px;
          }

          .toggle-btn {
            justify-content: center;
          }

          .trust-section {
            flex-direction: column;
            align-items: center;
            gap: 1rem;
          }
        }
      `}</style>
    </div >
  );
};

export default PricingTiers;
