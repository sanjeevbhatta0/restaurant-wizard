import React from 'react';
import { useAdmin } from '../../contexts/AdminContext';

const TIERS = ['scout', 'ally', 'guide', 'chief', 'elder'];

const FEATURE_ICONS = {
    'menu-management': '🍽️',
    'pos': '💳',
    'kitchen': '👨‍🍳',
    'server': '🍷',
    'orders': '📋',
    'payments': '💰',
    'ai-menu-upload': '🤖',
    'basic-analytics': '📊',
    'website-builder': '🌐',
    'website-integration': '🔗',
    'seo-social': '📱',
    'ai-analytics': '🧠',
    'ai-content': '✨'
};

const FeatureManagement = ({ showToast }) => {
    const { draftConfig, updateFeatureTier } = useAdmin();

    const features = draftConfig.features || {};
    const tierInfo = draftConfig.tierInfo || {};

    // Group features by current tier
    const featuresByTier = TIERS.reduce((acc, tier) => {
        acc[tier] = Object.entries(features)
            .filter(([, feature]) => feature.tier === tier)
            .map(([id, feature]) => ({ id, ...feature }));
        return acc;
    }, {});

    const handleTierChange = (featureId, newTier) => {
        updateFeatureTier(featureId, newTier);
        showToast(`Feature moved to ${tierInfo[newTier]?.name || newTier}`, 'info');
    };

    return (
        <div className="feature-management">
            {/* Overview Cards */}
            <div className="admin-grid admin-grid-5" style={{ marginBottom: '2rem' }}>
                {TIERS.map(tier => (
                    <div key={tier} className="admin-stat-card">
                        <div className="admin-stat-header">
                            <div className="admin-stat-icon" style={{
                                background: `rgba(${tier === 'scout' ? '107, 114, 128' :
                                    tier === 'ally' ? '74, 222, 128' :
                                        tier === 'guide' ? '96, 165, 250' :
                                            tier === 'chief' ? '245, 158, 11' :
                                                '168, 85, 247'}, 0.15)`
                            }}>
                                {tierInfo[tier]?.icon || '📦'}
                            </div>
                        </div>
                        <div className="admin-stat-value">{featuresByTier[tier]?.length || 0}</div>
                        <div className="admin-stat-label">{tierInfo[tier]?.name || tier} Features</div>
                    </div>
                ))}
            </div>

            {/* Feature List */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">⚡</span>
                        Feature Tier Assignments
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)' }}>
                        Drag features or use dropdowns to reassign tiers
                    </span>
                </div>

                <div className="admin-feature-list">
                    {Object.entries(features).map(([featureId, feature]) => (
                        <div key={featureId} className="admin-feature-item">
                            <span className="admin-feature-icon">
                                {FEATURE_ICONS[featureId] || '📦'}
                            </span>

                            <div className="admin-feature-info">
                                <div className="admin-feature-name">{feature.name || featureId}</div>
                                <div className="admin-feature-desc">{feature.description}</div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                    fontSize: '0.8rem',
                                    color: 'var(--admin-text-muted)',
                                    whiteSpace: 'nowrap'
                                }}>
                                    Available in:
                                </span>
                                <select
                                    className="admin-input admin-select admin-feature-tier-select"
                                    value={feature.tier}
                                    onChange={(e) => handleTierChange(featureId, e.target.value)}
                                    style={{
                                        borderColor: `var(--admin-${feature.tier === 'scout' ? 'text-muted' :
                                            feature.tier === 'ally' ? 'green' :
                                                feature.tier === 'guide' ? 'cyan' :
                                                    feature.tier === 'chief' ? 'yellow' :
                                                        'accent-primary'})`
                                    }}
                                >
                                    {TIERS.map(tier => (
                                        <option key={tier} value={tier}>
                                            {tierInfo[tier]?.icon} {tierInfo[tier]?.name || tier}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tier Preview */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">👁️</span>
                        Tier Feature Distribution
                    </h2>
                </div>

                <div className="admin-grid admin-grid-5">
                    {TIERS.map(tier => (
                        <div key={tier} className="admin-tier-card">
                            <div className="admin-tier-header">
                                <span className="admin-tier-icon">{tierInfo[tier]?.icon || '📦'}</span>
                                <span className="admin-tier-name">{tierInfo[tier]?.name || tier}</span>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                {/* Show features from this tier and all lower tiers */}
                                {TIERS.slice(0, TIERS.indexOf(tier) + 1).map(t =>
                                    featuresByTier[t]?.map(feature => (
                                        <div
                                            key={feature.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                padding: '6px 0',
                                                fontSize: '0.85rem',
                                                color: t === tier ? 'var(--admin-text-primary)' : 'var(--admin-text-muted)',
                                                opacity: t === tier ? 1 : 0.6
                                            }}
                                        >
                                            <span style={{ color: 'var(--admin-green)' }}>✓</span>
                                            <span>{feature.name}</span>
                                            {t === tier && (
                                                <span style={{
                                                    fontSize: '0.65rem',
                                                    background: 'var(--admin-accent-gradient)',
                                                    color: 'white',
                                                    padding: '2px 6px',
                                                    borderRadius: '8px',
                                                    marginLeft: 'auto'
                                                }}>
                                                    NEW
                                                </span>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FeatureManagement;
