import React, { useState } from 'react';
import { useAdmin } from '../../contexts/AdminContext';

const TIERS = ['scout', 'ally', 'guide', 'chief', 'elder'];
const BILLING_CYCLES = ['monthly', 'quarterly', 'annual'];

const PricingPreview = () => {
    const { draftConfig, publishedConfig } = useAdmin();
    const [billingCycle, setBillingCycle] = useState('annual');
    const [showComparison, setShowComparison] = useState(false);

    const calculatePrice = (config, tier) => {
        const basePrice = config.pricing?.[tier] || 0;
        const multiplier = config.billingMultipliers?.[billingCycle] || 1;

        // Check for active discounts
        let discountAmount = 0;
        const now = new Date();

        config.discounts?.forEach(discount => {
            const start = new Date(discount.startDate);
            const end = new Date(discount.endDate);

            if (now >= start && now <= end && discount.active) {
                if (discount.type === 'tier' && discount.target === tier) {
                    if (discount.isPercentage) {
                        discountAmount += basePrice * (discount.amount / 100);
                    } else {
                        discountAmount += discount.amount;
                    }
                } else if (discount.type === 'billing_cycle' && discount.target === billingCycle) {
                    if (discount.isPercentage) {
                        discountAmount += basePrice * (discount.amount / 100);
                    } else {
                        discountAmount += discount.amount;
                    }
                }
            }
        });

        const finalPrice = Math.max(0, (basePrice - discountAmount) * multiplier);
        return finalPrice.toFixed(2);
    };

    const getActiveDiscounts = (config, tier) => {
        const now = new Date();
        return config.discounts?.filter(discount => {
            const start = new Date(discount.startDate);
            const end = new Date(discount.endDate);
            return now >= start && now <= end && discount.active &&
                ((discount.type === 'tier' && discount.target === tier) ||
                    (discount.type === 'billing_cycle' && discount.target === billingCycle));
        }) || [];
    };

    const getTrialDays = (config, tier) => {
        if (config.freeTrials?.[tier]?.enabled) {
            return config.freeTrials[tier].days;
        }
        return 0;
    };

    const tierInfo = draftConfig.tierInfo || {};
    const features = draftConfig.features || {};

    // Get features for a tier (including lower tier features)
    const getFeaturesForTier = (tier) => {
        const tierIndex = TIERS.indexOf(tier);
        return Object.entries(features)
            .filter(([, feature]) => TIERS.indexOf(feature.tier) <= tierIndex)
            .map(([id, feature]) => ({ id, ...feature, isNew: feature.tier === tier }));
    };

    const renderPricingCard = (config, tier, isPreview = true) => {
        const price = calculatePrice(config, tier);
        const originalPrice = (config.pricing?.[tier] || 0) * (config.billingMultipliers?.[billingCycle] || 1);
        const hasDiscount = parseFloat(price) < originalPrice;
        const discounts = getActiveDiscounts(config, tier);
        const trialDays = getTrialDays(config, tier);
        const tierFeatures = getFeaturesForTier(tier);

        return (
            <div
                key={tier}
                className={`preview-pricing-card ${tierInfo[tier]?.popular ? 'popular' : ''}`}
                style={{ '--tier-color': tierInfo[tier]?.color }}
            >
                {tierInfo[tier]?.popular && (
                    <div className="preview-popular-badge">Most Popular</div>
                )}

                {trialDays > 0 && (
                    <div className="preview-trial-badge">
                        🎁 {trialDays}-day free trial
                    </div>
                )}

                <div className="preview-tier-header">
                    <span className="preview-tier-icon">{tierInfo[tier]?.icon || '📦'}</span>
                    <h3 className="preview-tier-name">{tierInfo[tier]?.name || tier}</h3>
                    <p className="preview-tier-tagline">{tierInfo[tier]?.tagline}</p>
                </div>

                <div className="preview-price">
                    {tier === 'scout' ? (
                        <>
                            <span className="preview-amount free">Free</span>
                            <span className="preview-period">forever</span>
                        </>
                    ) : (
                        <>
                            {hasDiscount && (
                                <span className="preview-original-price">${originalPrice.toFixed(2)}</span>
                            )}
                            <span className="preview-currency">$</span>
                            <span className="preview-amount">{price}</span>
                            <span className="preview-period">/mo</span>
                        </>
                    )}
                </div>

                {discounts.length > 0 && (
                    <div className="preview-discount-badge">
                        🏷️ {discounts[0].name} - {discounts[0].amount}{discounts[0].isPercentage ? '%' : '$'} off!
                    </div>
                )}

                <button className="preview-cta">
                    {tier === 'scout' ? 'Start Free' : (trialDays > 0 ? 'Start Free Trial' : 'Get Started')}
                </button>

                <ul className="preview-features">
                    {tierFeatures.slice(0, 6).map(feature => (
                        <li key={feature.id} className={`preview-feature ${feature.isNew ? 'new' : ''}`}>
                            <span className="preview-feature-check">✓</span>
                            <span>{feature.name}</span>
                            {feature.isNew && <span className="preview-feature-new">New</span>}
                        </li>
                    ))}
                    {tierFeatures.length > 6 && (
                        <li className="preview-feature more">
                            +{tierFeatures.length - 6} more features
                        </li>
                    )}
                </ul>
            </div>
        );
    };

    return (
        <div className="pricing-preview">
            {/* Preview Controls */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">👁️</span>
                        Live Preview
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <label className="admin-checkbox-group">
                            <input
                                type="checkbox"
                                className="admin-checkbox"
                                checked={showComparison}
                                onChange={(e) => setShowComparison(e.target.checked)}
                            />
                            <span>Compare with published</span>
                        </label>
                    </div>
                </div>

                {/* Billing Toggle */}
                <div className="preview-billing-toggle">
                    {BILLING_CYCLES.map(cycle => (
                        <button
                            key={cycle}
                            className={`preview-toggle-btn ${billingCycle === cycle ? 'active' : ''}`}
                            onClick={() => setBillingCycle(cycle)}
                        >
                            {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                            {cycle === 'monthly' && <span className="preview-toggle-badge red">+20%</span>}
                            {cycle === 'quarterly' && <span className="preview-toggle-badge yellow">+10%</span>}
                            {cycle === 'annual' && <span className="preview-toggle-badge green">Best Value</span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* Preview Container */}
            <div className="admin-preview-container">
                <div className="admin-preview-header">
                    <h2 className="admin-preview-title">Our Offerings</h2>
                    <span className="admin-preview-badge">Draft Preview</span>
                </div>

                <div className="preview-pricing-grid">
                    {TIERS.map(tier => renderPricingCard(draftConfig, tier))}
                </div>
            </div>

            {/* Comparison View */}
            {showComparison && (
                <div className="admin-card" style={{ marginTop: '2rem' }}>
                    <div className="admin-card-header">
                        <h2 className="admin-card-title">
                            <span className="admin-card-title-icon">📊</span>
                            Currently Published
                        </h2>
                        <span className="admin-status-badge published">
                            <span className="admin-status-dot"></span>
                            Live on Website
                        </span>
                    </div>

                    <div className="admin-preview-container" style={{ background: 'var(--admin-bg)' }}>
                        <div className="preview-pricing-grid">
                            {TIERS.map(tier => renderPricingCard(publishedConfig, tier, false))}
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
        .preview-billing-toggle {
          display: flex;
          justify-content: center;
          gap: 8px;
          padding: 6px;
          background: #f3f4f6;
          border-radius: 16px;
          width: fit-content;
          margin: 0 auto;
        }

        .preview-toggle-btn {
          padding: 12px 24px;
          border: none;
          background: transparent;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #666;
          transition: all 0.3s;
        }

        .preview-toggle-btn.active {
          background: white;
          color: #1a1a2e;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .preview-toggle-badge {
          font-size: 0.7rem;
          padding: 2px 6px;
          border-radius: 6px;
          font-weight: 700;
        }

        .preview-toggle-badge.red {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }

        .preview-toggle-badge.yellow {
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
        }

        .preview-toggle-badge.green {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
        }

        .preview-pricing-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 1.5rem;
          padding: 1rem 0;
        }

        .preview-pricing-card {
          background: #f8fafc;
          border-radius: 24px;
          padding: 1.5rem;
          position: relative;
          border: 1px solid #e2e8f0;
          transition: all 0.3s;
        }

        .preview-pricing-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
        }

        .preview-pricing-card.popular {
          border: 2px solid var(--tier-color);
          transform: scale(1.02);
        }

        .preview-popular-badge {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--tier-color);
          color: white;
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 700;
        }

        .preview-trial-badge {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(99, 102, 241, 0.1) 100%);
          border: 1px solid rgba(168, 85, 247, 0.2);
          padding: 8px 12px;
          border-radius: 10px;
          text-align: center;
          font-size: 0.85rem;
          font-weight: 600;
          color: #7c3aed;
          margin-bottom: 1rem;
        }

        .preview-tier-header {
          text-align: center;
          margin-bottom: 1rem;
        }

        .preview-tier-icon {
          font-size: 2rem;
          display: block;
          margin-bottom: 0.5rem;
        }

        .preview-tier-name {
          font-size: 1.25rem;
          font-weight: 800;
          color: #1a1a2e;
          margin: 0 0 0.25rem;
        }

        .preview-tier-tagline {
          color: var(--tier-color);
          font-weight: 600;
          font-size: 0.85rem;
          margin: 0;
        }

        .preview-price {
          text-align: center;
          margin-bottom: 1rem;
        }

        .preview-original-price {
          display: block;
          text-decoration: line-through;
          color: #999;
          font-size: 0.9rem;
        }

        .preview-currency {
          font-size: 1.25rem;
          color: #666;
          vertical-align: top;
        }

        .preview-amount {
          font-size: 2.5rem;
          font-weight: 800;
          color: #1a1a2e;
        }

        .preview-amount.free {
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .preview-period {
          font-size: 0.9rem;
          color: #666;
        }

        .preview-discount-badge {
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

        .preview-cta {
          width: 100%;
          padding: 12px;
          background: var(--tier-color);
          border: none;
          border-radius: 12px;
          color: white;
          font-weight: 700;
          font-size: 0.9rem;
          cursor: pointer;
          margin-bottom: 1rem;
        }

        .preview-features {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .preview-feature {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
          font-size: 0.85rem;
          color: #1a1a2e;
          border-bottom: 1px solid #f1f5f9;
        }

        .preview-feature:last-child {
          border-bottom: none;
        }

        .preview-feature-check {
          color: #22c55e;
          font-weight: bold;
        }

        .preview-feature-new {
          font-size: 0.65rem;
          background: var(--tier-color);
          color: white;
          padding: 2px 6px;
          border-radius: 8px;
          margin-left: auto;
        }

        .preview-feature.more {
          color: #999;
          font-style: italic;
        }

        @media (max-width: 1200px) {
          .preview-pricing-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 768px) {
          .preview-pricing-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
        </div>
    );
};

export default PricingPreview;
