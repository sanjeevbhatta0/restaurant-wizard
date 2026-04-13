import React, { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../contexts/AdminContext';

const TIERS = ['scout', 'ally', 'guide', 'chief', 'elder'];
const BILLING_CYCLES = ['monthly', 'quarterly', 'annual'];

// Number input that allows clearing and proper editing
const NumberInput = ({ value, onChange, min, max, step, disabled, className, prefix, suffix }) => {
    const [localValue, setLocalValue] = useState(value?.toString() ?? '');

    // Sync when parent value changes (but not on every keystroke)
    useEffect(() => {
        setLocalValue(value?.toString() ?? '');
    }, [value]);

    const handleChange = (e) => {
        // Allow empty string for clearing
        setLocalValue(e.target.value);
    };

    const handleBlur = () => {
        // On blur, convert to number and update parent
        const numValue = parseFloat(localValue);
        if (localValue === '' || isNaN(numValue)) {
            onChange(0);
            setLocalValue('0');
        } else {
            onChange(numValue);
        }
    };

    return (
        <input
            type="number"
            className={className}
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
        />
    );
};

// Separate component for discount item to manage local state and prevent re-renders
const DiscountItem = ({ discount, tierInfo, onUpdate, onRemove }) => {
    // Local state for controlled inputs - prevents parent re-renders on every keystroke
    const [localDiscount, setLocalDiscount] = useState(discount);

    // Sync local state when parent discount changes (e.g., after save)
    useEffect(() => {
        setLocalDiscount(discount);
    }, [discount.id]); // Only sync on ID change, not every prop change

    const handleLocalChange = (field, value) => {
        setLocalDiscount(prev => ({ ...prev, [field]: value }));
    };

    const handleBlur = (field) => {
        // Only update parent state when user finishes editing
        if (localDiscount[field] !== discount[field]) {
            onUpdate(discount.id, { [field]: localDiscount[field] });
        }
    };

    const isDiscountActive = () => {
        const now = new Date();
        const start = new Date(localDiscount.startDate);
        const end = new Date(localDiscount.endDate);
        return now >= start && now <= end && localDiscount.active;
    };

    return (
        <div className="admin-discount-item">
            <div className="admin-discount-header">
                <div className="admin-discount-type">
                    <span>{localDiscount.type === 'tier' ? '🎯' : '📅'}</span>
                    <span>{localDiscount.name || 'Unnamed Discount'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`admin-discount-active ${isDiscountActive() ? 'active' : 'inactive'}`}>
                        {isDiscountActive() ? '● Active' : '○ Inactive'}
                    </span>
                    <button
                        className="admin-btn admin-btn-ghost admin-btn-icon"
                        onClick={() => onRemove(discount.id)}
                    >
                        🗑️
                    </button>
                </div>
            </div>

            <div className="admin-discount-grid">
                <div className="admin-form-group">
                    <label className="admin-label">Type</label>
                    <select
                        className="admin-input admin-select"
                        value={localDiscount.type}
                        onChange={(e) => {
                            handleLocalChange('type', e.target.value);
                            onUpdate(discount.id, { type: e.target.value });
                        }}
                    >
                        <option value="tier">Per Tier</option>
                        <option value="billing_cycle">Per Billing Cycle</option>
                    </select>
                </div>

                <div className="admin-form-group">
                    <label className="admin-label">Target</label>
                    <select
                        className="admin-input admin-select"
                        value={localDiscount.target}
                        onChange={(e) => {
                            handleLocalChange('target', e.target.value);
                            onUpdate(discount.id, { target: e.target.value });
                        }}
                    >
                        {localDiscount.type === 'tier' ? (
                            TIERS.filter(t => t !== 'scout').map(t => (
                                <option key={t} value={t}>{tierInfo[t]?.name || t}</option>
                            ))
                        ) : (
                            BILLING_CYCLES.map(c => (
                                <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>
                            ))
                        )}
                    </select>
                </div>

                <div className="admin-form-group">
                    <label className="admin-label">Discount Amount</label>
                    <div className="admin-price-input-group">
                        <input
                            type="number"
                            className="admin-input"
                            value={localDiscount.amount}
                            onChange={(e) => handleLocalChange('amount', parseFloat(e.target.value) || 0)}
                            onBlur={() => handleBlur('amount')}
                            min="0"
                            max={localDiscount.isPercentage ? 100 : 1000}
                        />
                        <span className="admin-price-suffix">
                            {localDiscount.isPercentage ? '%' : '$'}
                        </span>
                    </div>
                </div>

                <div className="admin-form-group">
                    <label className="admin-label">Start Date</label>
                    <input
                        type="datetime-local"
                        className="admin-input"
                        value={localDiscount.startDate}
                        onChange={(e) => handleLocalChange('startDate', e.target.value)}
                        onBlur={() => handleBlur('startDate')}
                    />
                </div>

                <div className="admin-form-group">
                    <label className="admin-label">End Date</label>
                    <input
                        type="datetime-local"
                        className="admin-input"
                        value={localDiscount.endDate}
                        onChange={(e) => handleLocalChange('endDate', e.target.value)}
                        onBlur={() => handleBlur('endDate')}
                    />
                </div>
            </div>
        </div>
    );
};

const PricingManagement = ({ showToast }) => {
    const {
        draftConfig,
        updatePricing,
        updateBillingMultiplier,
        updateFreeTrial,
        updateOrderLimit,
        addDiscount,
        removeDiscount,
        updateDiscount
    } = useAdmin();

    const [showDiscountModal, setShowDiscountModal] = useState(false);
    const [newDiscount, setNewDiscount] = useState({
        type: 'tier',
        target: 'ally',
        amount: 10,
        isPercentage: true,
        startDate: '',
        endDate: '',
        name: ''
    });

    const tierInfo = draftConfig?.tierInfo || {};
    const discounts = draftConfig?.discounts || [];

    const handleAddDiscount = () => {
        if (!newDiscount.name || !newDiscount.startDate || !newDiscount.endDate) {
            showToast('Please fill all discount fields', 'error');
            return;
        }

        addDiscount({
            ...newDiscount,
            active: true
        });

        setNewDiscount({
            type: 'tier',
            target: 'ally',
            amount: 10,
            isPercentage: true,
            startDate: '',
            endDate: '',
            name: ''
        });
        setShowDiscountModal(false);
        showToast('Discount added!', 'success');
    };

    return (
        <div className="pricing-management">
            {/* Base Pricing Section */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">💰</span>
                        Base Pricing
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)' }}>
                        Set the base annual price for each tier
                    </span>
                </div>

                <div className="admin-grid admin-grid-5">
                    {TIERS.map(tier => (
                        <div key={tier} className="admin-tier-card">
                            <div className="admin-tier-header">
                                <span className="admin-tier-icon">{tierInfo[tier]?.icon || '📦'}</span>
                                <span className="admin-tier-name">{tierInfo[tier]?.name || tier}</span>
                                {tier === 'scout' && <span className="admin-tier-badge free">Free</span>}
                                {tierInfo[tier]?.popular && <span className="admin-tier-badge popular">Popular</span>}
                            </div>

                            <div className="admin-form-group">
                                <label className="admin-label">Base Price (Annual)</label>
                                <div className="admin-price-input-group">
                                    <span className="admin-price-prefix">$</span>
                                    <NumberInput
                                        className="admin-input"
                                        value={draftConfig.pricing?.[tier] ?? 0}
                                        onChange={(val) => updatePricing(tier, val)}
                                        min={0}
                                        step={1}
                                        disabled={tier === 'scout'}
                                    />
                                    <span className="admin-price-suffix">/mo</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Billing Cycle Multipliers */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">📅</span>
                        Billing Cycle Multipliers
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)' }}>
                        Adjust pricing based on billing frequency
                    </span>
                </div>

                <div className="admin-grid admin-grid-3">
                    {BILLING_CYCLES.map(cycle => (
                        <div key={cycle} className="admin-tier-card">
                            <div className="admin-tier-header">
                                <span className="admin-tier-name" style={{ textTransform: 'capitalize' }}>
                                    {cycle}
                                </span>
                                {cycle === 'annual' && <span className="admin-tier-badge popular">Best Value</span>}
                            </div>

                            <div className="admin-form-group">
                                <label className="admin-label">Multiplier</label>
                                <div className="admin-price-input-group">
                                    <NumberInput
                                        className="admin-input"
                                        value={draftConfig.billingMultipliers?.[cycle] ?? 1}
                                        onChange={(val) => updateBillingMultiplier(cycle, val)}
                                        min={0.5}
                                        max={2}
                                        step={0.05}
                                    />
                                    <span className="admin-price-suffix">×</span>
                                </div>
                                <small style={{ color: 'var(--admin-text-muted)', marginTop: '8px', display: 'block' }}>
                                    {cycle === 'monthly' && 'Usually +20% premium'}
                                    {cycle === 'quarterly' && 'Usually +10% premium'}
                                    {cycle === 'annual' && 'Base price (1.0×)'}
                                </small>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Free Trials */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">🎁</span>
                        Free Trials
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)' }}>
                        Configure trial periods for each tier
                    </span>
                </div>

                <div className="admin-grid admin-grid-5">
                    {TIERS.filter(t => t !== 'scout').map(tier => (
                        <div key={tier} className="admin-tier-card">
                            <div className="admin-tier-header">
                                <span className="admin-tier-icon">{tierInfo[tier]?.icon || '📦'}</span>
                                <span className="admin-tier-name">{tierInfo[tier]?.name || tier}</span>
                            </div>

                            <div className="admin-form-group">
                                <div className="admin-checkbox-group" style={{ marginBottom: '12px' }}>
                                    <div
                                        className={`admin-toggle ${draftConfig.freeTrials?.[tier]?.enabled ? 'active' : ''}`}
                                        onClick={() => updateFreeTrial(
                                            tier,
                                            !draftConfig.freeTrials?.[tier]?.enabled,
                                            draftConfig.freeTrials?.[tier]?.days || 14
                                        )}
                                    />
                                    <span>{draftConfig.freeTrials?.[tier]?.enabled ? 'Enabled' : 'Disabled'}</span>
                                </div>

                                {draftConfig.freeTrials?.[tier]?.enabled && (
                                    <div>
                                        <label className="admin-label">Trial Duration</label>
                                        <div className="admin-price-input-group">
                                            <input
                                                type="number"
                                                className="admin-input"
                                                value={draftConfig.freeTrials?.[tier]?.days || 14}
                                                onChange={(e) => updateFreeTrial(tier, true, e.target.value)}
                                                min="1"
                                                max="90"
                                            />
                                            <span className="admin-price-suffix">days</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Discounts & Promotions */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">🏷️</span>
                        Discounts & Promotions
                    </h2>
                    <button
                        className="admin-btn admin-btn-primary"
                        onClick={() => setShowDiscountModal(true)}
                    >
                        + Add Discount
                    </button>
                </div>

                {discounts.length > 0 ? (
                    <div>
                        {discounts.map(discount => (
                            <DiscountItem
                                key={discount.id}
                                discount={discount}
                                tierInfo={tierInfo}
                                onUpdate={updateDiscount}
                                onRemove={removeDiscount}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="admin-empty">
                        <div className="admin-empty-icon">🏷️</div>
                        <div className="admin-empty-title">No discounts configured</div>
                        <p>Add a discount to run promotions like Black Friday sales.</p>
                    </div>
                )}
            </div>

            {/* Order Limits */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">📦</span>
                        Order Limits
                    </h2>
                    <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-muted)' }}>
                        Configure order volume limits per tier
                    </span>
                </div>

                <div className="admin-grid admin-grid-5">
                    {TIERS.map(tier => (
                        <div key={tier} className="admin-tier-card">
                            <div className="admin-tier-header">
                                <span className="admin-tier-icon">{tierInfo[tier]?.icon || '📦'}</span>
                                <span className="admin-tier-name">{tierInfo[tier]?.name || tier}</span>
                            </div>

                            <div className="admin-form-group">
                                <label className="admin-label">Order Limit</label>
                                <input
                                    type={tier === 'elder' ? 'text' : 'number'}
                                    className="admin-input"
                                    value={tier === 'elder' ? '∞ Unlimited' : (draftConfig.orderLimits?.[tier]?.limit || 0)}
                                    onChange={(e) => updateOrderLimit(tier, { limit: parseInt(e.target.value) })}
                                    disabled={tier === 'elder'}
                                />
                            </div>

                            {tier !== 'scout' && tier !== 'elder' && (
                                <div className="admin-form-group">
                                    <label className="admin-label">Overage Rate (%)</label>
                                    <div className="admin-price-input-group">
                                        <input
                                            type="number"
                                            className="admin-input"
                                            value={+((draftConfig.orderLimits?.[tier]?.overageRate || 0) * 100).toFixed(4)}
                                            onChange={(e) => updateOrderLimit(tier, { overageRate: +(parseFloat(e.target.value) / 100).toFixed(6) })}
                                            min="0"
                                            max="100"
                                            step="0.01"
                                        />
                                        <span className="admin-price-suffix">%</span>
                                    </div>
                                </div>
                            )}

                            {tier === 'scout' && (
                                <div className="admin-checkbox-group">
                                    <div
                                        className={`admin-toggle ${draftConfig.orderLimits?.[tier]?.hardCap ? 'active' : ''}`}
                                        onClick={() => updateOrderLimit(tier, { hardCap: !draftConfig.orderLimits?.[tier]?.hardCap })}
                                    />
                                    <span>Hard Cap</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Add Discount Modal */}
            {showDiscountModal && (
                <div className="admin-modal-overlay" onClick={() => setShowDiscountModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="admin-modal-header">
                            <h3 className="admin-modal-title">Add New Discount</h3>
                            <button className="admin-modal-close" onClick={() => setShowDiscountModal(false)}>×</button>
                        </div>

                        <div className="admin-modal-body">
                            <div className="admin-form-group">
                                <label className="admin-label">Discount Name</label>
                                <input
                                    type="text"
                                    className="admin-input"
                                    placeholder="e.g., Black Friday 2026"
                                    value={newDiscount.name}
                                    onChange={(e) => setNewDiscount({ ...newDiscount, name: e.target.value })}
                                />
                            </div>

                            <div className="admin-grid admin-grid-2">
                                <div className="admin-form-group">
                                    <label className="admin-label">Type</label>
                                    <select
                                        className="admin-input admin-select"
                                        value={newDiscount.type}
                                        onChange={(e) => setNewDiscount({ ...newDiscount, type: e.target.value })}
                                    >
                                        <option value="tier">Per Tier</option>
                                        <option value="billing_cycle">Per Billing Cycle</option>
                                    </select>
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-label">Target</label>
                                    <select
                                        className="admin-input admin-select"
                                        value={newDiscount.target}
                                        onChange={(e) => setNewDiscount({ ...newDiscount, target: e.target.value })}
                                    >
                                        {newDiscount.type === 'tier' ? (
                                            TIERS.filter(t => t !== 'scout').map(t => (
                                                <option key={t} value={t}>{tierInfo[t]?.name || t}</option>
                                            ))
                                        ) : (
                                            BILLING_CYCLES.map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))
                                        )}
                                    </select>
                                </div>
                            </div>

                            <div className="admin-grid admin-grid-2">
                                <div className="admin-form-group">
                                    <label className="admin-label">Amount</label>
                                    <input
                                        type="number"
                                        className="admin-input"
                                        value={newDiscount.amount}
                                        onChange={(e) => setNewDiscount({ ...newDiscount, amount: parseFloat(e.target.value) })}
                                        min="0"
                                    />
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-label">Type</label>
                                    <select
                                        className="admin-input admin-select"
                                        value={newDiscount.isPercentage ? 'percent' : 'fixed'}
                                        onChange={(e) => setNewDiscount({ ...newDiscount, isPercentage: e.target.value === 'percent' })}
                                    >
                                        <option value="percent">Percentage (%)</option>
                                        <option value="fixed">Fixed Amount ($)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="admin-grid admin-grid-2">
                                <div className="admin-form-group">
                                    <label className="admin-label">Start Date</label>
                                    <input
                                        type="datetime-local"
                                        className="admin-input"
                                        value={newDiscount.startDate}
                                        onChange={(e) => setNewDiscount({ ...newDiscount, startDate: e.target.value })}
                                    />
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-label">End Date</label>
                                    <input
                                        type="datetime-local"
                                        className="admin-input"
                                        value={newDiscount.endDate}
                                        onChange={(e) => setNewDiscount({ ...newDiscount, endDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="admin-modal-footer">
                            <button
                                className="admin-btn admin-btn-secondary"
                                onClick={() => setShowDiscountModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="admin-btn admin-btn-primary"
                                onClick={handleAddDiscount}
                            >
                                Add Discount
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PricingManagement;
