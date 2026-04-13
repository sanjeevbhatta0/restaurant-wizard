import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { db } from '../firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, getDoc, setDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { getApiBaseUrl } from '../config';
import ConfirmModal from './ConfirmModal';
import './PromotionsRewards.css';
import './PageHeader.css';

/**
 * Parse discount string into numeric value and unit (client-side mirror of server helper)
 */
function parsePromoDiscountClient(type, discountStr) {
    if (!discountStr) return { discountValue: 0, discountUnit: 'percentage' };
    const s = String(discountStr);
    if (type === 'percentage' || type === 'flashSale' || type === 'storeLaunch') {
        if (s.includes('%')) return { discountValue: parseFloat(s.replace('%', '')) || 0, discountUnit: 'percentage' };
        if (s.startsWith('$')) return { discountValue: parseFloat(s.replace('$', '')) || 0, discountUnit: 'amount' };
        const val = parseFloat(s);
        if (!isNaN(val)) return { discountValue: val, discountUnit: 'percentage' };
    }
    if (s.includes('%')) return { discountValue: parseFloat(s.replace('%', '')) || 0, discountUnit: 'percentage' };
    if (s.startsWith('$')) return { discountValue: parseFloat(s.replace('$', '')) || 0, discountUnit: 'amount' };
    return { discountValue: 0, discountUnit: 'percentage' };
}

const PromotionsRewards = () => {
    const { currentUser: user, restaurantUid } = useAuth();
    const { selectedLocation, isMultiLocation, locations } = useLocation();
    const [activeTab, setActiveTab] = useState('promotions');
    const [promotions, setPromotions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingPromo, setEditingPromo] = useState(null);
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        type: 'percentage',
        discount: '',
        code: '',
        imageUrl: '',
        maxClaims: '',
        validFrom: '',
        validUntil: '',
        minOrderAmount: '',
        bogoItems: [],
        bogoQuantityLimit: '',
        freeItemName: '',
        autoClaimOnSignup: false
    });
    const [selectedLocationIds, setSelectedLocationIds] = useState([]); // for multi-location promo targeting
    const [locationSelectMode, setLocationSelectMode] = useState('all'); // 'all' | 'specific'
    const [showFlyer, setShowFlyer] = useState(null);
    const [confirmState, setConfirmState] = useState(null);
    const [restaurantSlug, setRestaurantSlug] = useState('');
    const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' }
    const toastTimerRef = useRef(null);
    const showToast = (message, type = 'success') => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ message, type });
        toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 6000 : 4000);
    };
    const [rewardsConfig, setRewardsConfig] = useState({
        loyalty: {
            pointsPerDollar: 1,
            redemptionRate: 100,
            minRedeemPoints: 100,
            tiers: [
                { name: 'Bronze', icon: '🥉', minPoints: 0 },
                { name: 'Silver', icon: '🥈', minPoints: 500 },
                { name: 'Gold', icon: '🥇', minPoints: 1000 },
                { name: 'Platinum', icon: '💎', minPoints: 2000 }
            ]
        },
        spinWheel: {
            enabled: true,
            cooldownHours: 24,
            prizes: [
                { id: 'try_again', name: 'Try Again', type: 'none', value: 0, weight: 40, icon: '😅', color: '#6c757d', message: 'Better luck next time!' },
                { id: 'discount_10', name: '10% Off', type: 'discount', value: 10, weight: 20, icon: '🎉', color: '#3498db', message: 'You won 10% off your next order!' },
                { id: 'bonus_50', name: '50 Bonus Points', type: 'points', value: 50, weight: 15, icon: '⭐', color: '#27ae60', message: '50 bonus points added!' },
                { id: 'double_points', name: 'Double Points', type: 'multiplier', value: 2, weight: 10, icon: '✨', color: '#9b59b6', message: 'Next order earns DOUBLE points!' },
                { id: 'free_drink', name: 'Free Drink', type: 'freeItem', value: 'drink', weight: 10, icon: '🥤', color: '#e67e22', message: 'Enjoy a FREE drink!' },
                { id: 'free_dessert', name: 'Free Dessert', type: 'freeItem', value: 'dessert', weight: 5, icon: '🍰', color: '#f1c40f', message: 'You won a FREE dessert!' }
            ]
        }
    });
    const [rewardsSaving, setRewardsSaving] = useState(false);

    useEffect(() => {
        if (user) {
            loadPromotions();
            loadRewardsConfig();
            // Load restaurant slug for flyer URL generation
            getDoc(doc(db, 'restaurants', restaurantUid)).then(snap => {
                if (snap.exists()) setRestaurantSlug(snap.data().slug || restaurantUid);
            }).catch(() => {});
        }
    }, [user, selectedLocation]);

    const loadRewardsConfig = async () => {
        try {
            const configDoc = await getDoc(doc(db, `restaurants/${restaurantUid}/rewardsConfig/settings`));
            if (configDoc.exists()) {
                setRewardsConfig(configDoc.data());
            }
        } catch (err) {
            console.error('Error loading rewards config:', err);
        }
    };

    const saveRewardsConfig = async () => {
        try {
            setRewardsSaving(true);
            await setDoc(doc(db, `restaurants/${restaurantUid}/rewardsConfig/settings`), {
                ...rewardsConfig,
                updatedAt: serverTimestamp()
            });
            showToast('Rewards configuration saved successfully!');
        } catch (err) {
            console.error('Error saving rewards config:', err);
            showToast('Failed to save rewards config: ' + (err.message || 'Unknown error'), 'error');
        } finally {
            setRewardsSaving(false);
        }
    };

    const loadPromotions = async () => {
        try {
            setLoading(true);
            const promoRef = collection(db, `restaurants/${restaurantUid}/promotions`);
            const q = query(promoRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            let promos = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                validFrom: doc.data().validFrom?.toDate?.()?.toISOString().split('T')[0] || '',
                validUntil: doc.data().validUntil?.toDate?.()?.toISOString().split('T')[0] || ''
            }));

            // Filter by selected location for multi-location restaurants
            if (isMultiLocation && selectedLocation) {
                promos = promos.filter(p => {
                    // Show if no locationIds (legacy/all-locations promo) or if selected location is included
                    if (!p.locationIds || p.locationIds.length === 0) return true;
                    return p.locationIds.includes(selectedLocation);
                });
            }

            setPromotions(promos);
        } catch (err) {
            console.error('Error loading promotions:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        try {
            const promoData = {
                title: formData.title,
                description: formData.description,
                type: formData.type,
                discount: formData.discount,
                code: formData.code.toUpperCase(),
                imageUrl: formData.imageUrl || getDefaultImage(formData.type),
                maxClaims: parseInt(formData.maxClaims) || 0,
                claimCount: editingPromo?.claimCount || 0,
                validFrom: formData.validFrom ? new Date(formData.validFrom) : new Date(),
                validUntil: new Date(formData.validUntil),
                minOrderAmount: parseFloat(formData.minOrderAmount) || 0,
                isPublished: false,
                updatedAt: serverTimestamp()
            };

            // Add parsed discount values for programmatic use
            const { discountValue, discountUnit } = parsePromoDiscountClient(formData.type, formData.discount);
            promoData.discountValue = discountValue;
            promoData.discountUnit = discountUnit;

            // Add type-specific fields
            if (formData.type === 'bogo') {
                promoData.bogoItems = formData.bogoItems;
                promoData.bogoQuantityLimit = parseInt(formData.bogoQuantityLimit) || 1;
            }
            if (formData.type === 'freeItem') {
                promoData.freeItemName = formData.freeItemName;
            }
            if (formData.type === 'storeLaunch') {
                promoData.autoClaimOnSignup = formData.autoClaimOnSignup;
            }

            // Multi-location: store which locations this promo applies to
            if (isMultiLocation) {
                promoData.locationIds = locationSelectMode === 'all' ? [] : selectedLocationIds;
            }

            if (editingPromo) {
                await updateDoc(doc(db, `restaurants/${restaurantUid}/promotions`, editingPromo.id), promoData);
            } else {
                promoData.createdAt = serverTimestamp();
                await addDoc(collection(db, `restaurants/${restaurantUid}/promotions`), promoData);
            }

            setShowForm(false);
            setEditingPromo(null);
            resetForm();
            loadPromotions();
        } catch (err) {
            console.error('Error saving promotion:', err);
            showToast('Failed to save promotion: ' + (err.message || err.code || 'Unknown error'), 'error');
        }
    };

    const getDefaultImage = (type) => {
        const images = {
            percentage: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=250&fit=crop',
            bogo: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=250&fit=crop',
            freeItem: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400&h=250&fit=crop',
            flashSale: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=250&fit=crop',
            storeLaunch: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=250&fit=crop',
            festive: 'https://images.unsplash.com/photo-1482049016gy-a5cdbc892d5d?w=400&h=250&fit=crop'
        };
        return images[type] || images.percentage;
    };

    const resetForm = () => {
        setFormData({
            title: '',
            description: '',
            type: 'percentage',
            discount: '',
            code: '',
            imageUrl: '',
            maxClaims: '',
            validFrom: '',
            validUntil: '',
            minOrderAmount: '',
            bogoItems: [],
            bogoQuantityLimit: '',
            freeItemName: '',
            autoClaimOnSignup: false
        });
        setLocationSelectMode('all');
        setSelectedLocationIds([]);
    };

    const handleEdit = (promo) => {
        setFormData({
            title: promo.title,
            description: promo.description,
            type: promo.type,
            discount: promo.discount,
            code: promo.code,
            imageUrl: promo.imageUrl || '',
            maxClaims: promo.maxClaims?.toString() || '',
            validFrom: promo.validFrom || '',
            validUntil: promo.validUntil || '',
            minOrderAmount: promo.minOrderAmount?.toString() || '',
            bogoItems: promo.bogoItems || [],
            bogoQuantityLimit: promo.bogoQuantityLimit?.toString() || '',
            freeItemName: promo.freeItemName || '',
            autoClaimOnSignup: promo.autoClaimOnSignup || false
        });
        setEditingPromo(promo);
        // Restore location selection when editing
        if (promo.locationIds && promo.locationIds.length > 0) {
            setLocationSelectMode('specific');
            setSelectedLocationIds(promo.locationIds);
        } else {
            setLocationSelectMode('all');
            setSelectedLocationIds([]);
        }
        setShowForm(true);
    };

    const handleDelete = (promoId) => {
        setConfirmState({
            title: 'Delete Promotion',
            message: 'Are you sure you want to delete this promotion?',
            confirmText: 'Delete',
            onConfirm: () => doDeletePromotion(promoId)
        });
    };

    const doDeletePromotion = async (promoId) => {
        try {
            await deleteDoc(doc(db, `restaurants/${restaurantUid}/promotions`, promoId));
            loadPromotions();
        } catch (err) {
            console.error('Error deleting promotion:', err);
            showToast('Failed to delete promotion', 'error');
        }
    };

    const togglePublish = async (promo) => {
        try {
            await updateDoc(doc(db, `restaurants/${restaurantUid}/promotions`, promo.id), {
                isPublished: !promo.isPublished,
                updatedAt: serverTimestamp()
            });
            loadPromotions();
        } catch (err) {
            console.error('Error toggling publish:', err);
            showToast('Failed to update promotion', 'error');
        }
    };

    const generatePromoCode = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setFormData({ ...formData, code });
    };

    const getStatusBadge = (promo) => {
        const now = new Date();
        const validUntil = new Date(promo.validUntil);
        const validFrom = new Date(promo.validFrom);

        if (!promo.isPublished) return <span className="status-badge draft">Draft</span>;
        if (validUntil < now) return <span className="status-badge expired">Expired</span>;
        if (validFrom > now) return <span className="status-badge scheduled">Scheduled</span>;
        return <span className="status-badge active">Active</span>;
    };

    const promoTemplates = [
        {
            id: 'festive',
            name: '🎉 Festive Discount',
            description: 'Holiday or seasonal percentage discount',
            defaults: { type: 'percentage', discount: '20%', title: 'Holiday Special!' }
        },
        {
            id: 'bogo',
            name: '🍕 Buy 1 Get 1 Free',
            description: 'BOGO offer with quantity limits',
            defaults: { type: 'bogo', discount: 'BOGO', title: 'Buy One Get One Free!' }
        },
        {
            id: 'freeItem',
            name: '🎁 Free Item',
            description: 'Free item with minimum order',
            defaults: { type: 'freeItem', discount: 'Free Item', title: 'Free Dessert with Order!' }
        },
        {
            id: 'flashSale',
            name: '⚡ Flash Sale',
            description: 'Limited-time discount with urgency',
            defaults: { type: 'percentage', discount: '30%', title: 'Flash Sale - Today Only!' }
        },
        {
            id: 'storeLaunch',
            name: '🚀 Store Launch',
            description: 'Grand opening promo with QR code flyer',
            defaults: { type: 'storeLaunch', discount: '15%', title: 'Grand Opening Special!', autoClaimOnSignup: true }
        }
    ];

    const applyTemplate = (template) => {
        setFormData({
            ...formData,
            ...template.defaults,
            code: ''
        });
        generatePromoCode();
        setShowForm(true);
    };

    return (
        <div className="promotions-rewards">
            {toast && (
                <div className={`pr-toast pr-toast-${toast.type}`} onClick={() => setToast(null)}>
                    <span>{toast.type === 'error' ? '⚠' : '✓'} {toast.message}</span>
                    <button className="pr-toast-close" onClick={() => setToast(null)}>×</button>
                </div>
            )}
            <div className="page-header-gradient" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="header-content">
                    <i className="bi bi-gift header-icon"></i>
                    <div>
                        <h2>Promotions & Rewards</h2>
                        <p>Create and manage promotions for your customers</p>
                    </div>
                </div>
                <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }} style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', color: 'white' }}>
                    <i className="bi bi-plus-lg"></i> Create Promotion
                </button>
            </div>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'promotions' ? 'active' : ''}`}
                    onClick={() => setActiveTab('promotions')}
                >
                    <i className="bi bi-tag"></i> Promotions
                </button>
                <button
                    className={`tab ${activeTab === 'analytics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('analytics')}
                >
                    <i className="bi bi-graph-up"></i> Analytics
                </button>
                <button
                    className={`tab ${activeTab === 'rewards' ? 'active' : ''}`}
                    onClick={() => setActiveTab('rewards')}
                >
                    <i className="bi bi-gift"></i> Rewards Config
                </button>
            </div>

            {activeTab === 'promotions' && (
                <>
                    {!showForm && (
                        <div className="template-grid">
                            <h3>Quick Start Templates</h3>
                            <div className="templates">
                                {promoTemplates.map(template => (
                                    <div key={template.id} className="template-card" onClick={() => applyTemplate(template)}>
                                        <h4>{template.name}</h4>
                                        <p>{template.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {showForm && (
                        <div className="promo-form-container">
                            <div className="form-header">
                                <h3>{editingPromo ? 'Edit Promotion' : 'Create New Promotion'}</h3>
                                <button className="btn-ghost" onClick={() => { setShowForm(false); setEditingPromo(null); }}>
                                    <i className="bi bi-x-lg"></i>
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="promo-form">
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Promotion Title *</label>
                                        <input
                                            type="text"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                            placeholder="e.g., Weekend Special 20% Off"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Type *</label>
                                        <select
                                            value={formData.type}
                                            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                        >
                                            <option value="percentage">Percentage Discount</option>
                                            <option value="bogo">Buy 1 Get 1 Free</option>
                                            <option value="freeItem">Free Item</option>
                                            <option value="flashSale">Flash Sale</option>
                                            <option value="storeLaunch">Store Launch</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Description *</label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        placeholder="Describe your promotion..."
                                        rows={3}
                                        required
                                    />
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Discount Value *</label>
                                        <input
                                            type="text"
                                            value={formData.discount}
                                            onChange={(e) => setFormData({ ...formData, discount: e.target.value })}
                                            placeholder="e.g., 20% or $5 off"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Promo Code *</label>
                                        <div className="code-input">
                                            <input
                                                type="text"
                                                value={formData.code}
                                                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                                placeholder="e.g., SAVE20"
                                                required
                                            />
                                            <button type="button" className="btn-ghost" onClick={generatePromoCode}>
                                                Generate
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {formData.type === 'freeItem' && (
                                    <div className="form-group">
                                        <label>Free Item Name *</label>
                                        <input
                                            type="text"
                                            value={formData.freeItemName}
                                            onChange={(e) => setFormData({ ...formData, freeItemName: e.target.value })}
                                            placeholder="e.g., Free Chocolate Cake"
                                        />
                                    </div>
                                )}

                                {formData.type === 'storeLaunch' && (
                                    <div className="form-group">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={formData.autoClaimOnSignup}
                                                onChange={(e) => setFormData({ ...formData, autoClaimOnSignup: e.target.checked })}
                                            />
                                            <span>Auto-claim when customer signs up via QR code link</span>
                                        </label>
                                    </div>
                                )}

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Valid From</label>
                                        <input
                                            type="date"
                                            value={formData.validFrom}
                                            onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Valid Until *</label>
                                        <input
                                            type="date"
                                            value={formData.validUntil}
                                            onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Max Claims (0 = unlimited)</label>
                                        <input
                                            type="number"
                                            value={formData.maxClaims}
                                            onChange={(e) => setFormData({ ...formData, maxClaims: e.target.value })}
                                            placeholder="50"
                                            min="0"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Min Order Amount ($)</label>
                                        <input
                                            type="number"
                                            value={formData.minOrderAmount}
                                            onChange={(e) => setFormData({ ...formData, minOrderAmount: e.target.value })}
                                            placeholder="0"
                                            min="0"
                                            step="0.01"
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Image URL (optional)</label>
                                    <input
                                        type="url"
                                        value={formData.imageUrl}
                                        onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                                        placeholder="https://..."
                                    />
                                </div>

                                {/* Multi-location: Select which locations this promo applies to */}
                                {isMultiLocation && locations.length > 1 && (
                                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                                        <label><i className="bi bi-geo-alt"></i> Apply to Locations</label>
                                        <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                            <button
                                                type="button"
                                                className={`btn-ghost ${locationSelectMode === 'all' ? 'active' : ''}`}
                                                style={{
                                                    padding: '6px 16px',
                                                    borderRadius: '20px',
                                                    border: locationSelectMode === 'all' ? '2px solid #667eea' : '1px solid #ddd',
                                                    background: locationSelectMode === 'all' ? '#667eea' : 'white',
                                                    color: locationSelectMode === 'all' ? 'white' : '#333',
                                                    fontSize: '0.85rem',
                                                    cursor: 'pointer'
                                                }}
                                                onClick={() => { setLocationSelectMode('all'); setSelectedLocationIds([]); }}
                                            >
                                                All Locations
                                            </button>
                                            <button
                                                type="button"
                                                className={`btn-ghost ${locationSelectMode === 'specific' ? 'active' : ''}`}
                                                style={{
                                                    padding: '6px 16px',
                                                    borderRadius: '20px',
                                                    border: locationSelectMode === 'specific' ? '2px solid #667eea' : '1px solid #ddd',
                                                    background: locationSelectMode === 'specific' ? '#667eea' : 'white',
                                                    color: locationSelectMode === 'specific' ? 'white' : '#333',
                                                    fontSize: '0.85rem',
                                                    cursor: 'pointer'
                                                }}
                                                onClick={() => setLocationSelectMode('specific')}
                                            >
                                                Specific Locations
                                            </button>
                                        </div>
                                        {locationSelectMode === 'specific' && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                {locations.map(loc => (
                                                    <label
                                                        key={loc.id}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '6px 12px',
                                                            borderRadius: '8px',
                                                            border: selectedLocationIds.includes(loc.id) ? '2px solid #27ae60' : '1px solid #ddd',
                                                            background: selectedLocationIds.includes(loc.id) ? '#e8f5e9' : '#f9f9f9',
                                                            cursor: 'pointer',
                                                            fontSize: '0.85rem'
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedLocationIds.includes(loc.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setSelectedLocationIds([...selectedLocationIds, loc.id]);
                                                                } else {
                                                                    setSelectedLocationIds(selectedLocationIds.filter(id => id !== loc.id));
                                                                }
                                                            }}
                                                        />
                                                        <i className="bi bi-geo-alt-fill" style={{ color: selectedLocationIds.includes(loc.id) ? '#27ae60' : '#999' }}></i>
                                                        {loc.name}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="form-actions">
                                    <button type="button" className="btn-ghost" onClick={() => { setShowForm(false); setEditingPromo(null); }}>
                                        Cancel
                                    </button>
                                    <button type="submit" className="btn-primary">
                                        {editingPromo ? 'Update Promotion' : 'Create Promotion'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="promotions-list">
                        <h3>Your Promotions</h3>
                        {loading ? (
                            <div className="loading">Loading promotions...</div>
                        ) : promotions.length === 0 ? (
                            <div className="empty-state">
                                <i className="bi bi-tag"></i>
                                <p>No promotions yet. Create your first promotion!</p>
                            </div>
                        ) : (
                            <div className="promo-cards">
                                {promotions.map(promo => (
                                    <div key={promo.id} className={`promo-card ${promo.isPublished ? 'published' : 'draft'}`}>
                                        <div className="promo-image" style={{ backgroundImage: `url(${promo.imageUrl || getDefaultImage(promo.type)})` }}>
                                            {getStatusBadge(promo)}
                                            <span className="promo-discount-badge">{promo.discount}</span>
                                        </div>
                                        <div className="promo-details">
                                            <h4>{promo.title}</h4>
                                            <p>{promo.description}</p>
                                            <div className="promo-meta">
                                                <span><i className="bi bi-upc"></i> {promo.code}</span>
                                                <span><i className="bi bi-people"></i> {promo.claimCount || 0} / {promo.maxClaims || '∞'} claims</span>
                                            </div>
                                            <div className="promo-dates">
                                                <span>Valid: {promo.validFrom || 'Now'} → {promo.validUntil}</span>
                                            </div>
                                        </div>
                                        <div className="promo-actions">
                                            <button
                                                className={`btn-publish ${promo.isPublished ? 'unpublish' : ''}`}
                                                onClick={() => togglePublish(promo)}
                                            >
                                                {promo.isPublished ? 'Unpublish' : 'Publish'}
                                            </button>
                                            <button className="btn-flyer" onClick={() => setShowFlyer(promo)} title="Generate Flyer with QR Code">
                                                <i className="bi bi-qr-code"></i> Flyer
                                            </button>
                                            <button className="btn-ghost" onClick={() => handleEdit(promo)}>
                                                <i className="bi bi-pencil"></i>
                                            </button>
                                            <button className="btn-ghost danger" onClick={() => handleDelete(promo.id)}>
                                                <i className="bi bi-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {activeTab === 'analytics' && (
                <div className="analytics-section">
                    <h3>Promotion Analytics</h3>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-value">{promotions.length}</div>
                            <div className="stat-label">Total Promotions</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{promotions.filter(p => p.isPublished).length}</div>
                            <div className="stat-label">Active Promotions</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{promotions.reduce((sum, p) => sum + (p.claimCount || 0), 0)}</div>
                            <div className="stat-label">Total Claims</div>
                        </div>
                    </div>
                    <p className="coming-soon">Detailed analytics coming soon!</p>
                </div>
            )}

            {showFlyer && (
                <StoreLaunchFlyer
                    promo={showFlyer}
                    restaurantSlug={restaurantSlug}
                    onClose={() => setShowFlyer(null)}
                />
            )}

            {activeTab === 'rewards' && (
                <div className="rewards-config">
                    <div className="rewards-config-header">
                        <h3>Rewards Configuration</h3>
                        <button className="btn-primary" onClick={saveRewardsConfig} disabled={rewardsSaving}>
                            {rewardsSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>

                    <div className="config-section">
                        <h4>Loyalty Points System</h4>
                        <div className="config-row">
                            <div className="config-field">
                                <label>Points earned per $1 spent</label>
                                <input type="number" min="0" step="0.5" value={rewardsConfig.loyalty.pointsPerDollar}
                                    onChange={e => setRewardsConfig(prev => ({
                                        ...prev,
                                        loyalty: { ...prev.loyalty, pointsPerDollar: parseFloat(e.target.value) || 0 }
                                    }))} />
                            </div>
                            <div className="config-field">
                                <label>Points needed for $1 discount</label>
                                <input type="number" min="1" value={rewardsConfig.loyalty.redemptionRate}
                                    onChange={e => setRewardsConfig(prev => ({
                                        ...prev,
                                        loyalty: { ...prev.loyalty, redemptionRate: parseInt(e.target.value) || 100 }
                                    }))} />
                            </div>
                            <div className="config-field">
                                <label>Minimum points to redeem</label>
                                <input type="number" min="0" value={rewardsConfig.loyalty.minRedeemPoints}
                                    onChange={e => setRewardsConfig(prev => ({
                                        ...prev,
                                        loyalty: { ...prev.loyalty, minRedeemPoints: parseInt(e.target.value) || 0 }
                                    }))} />
                            </div>
                        </div>

                        <h5 style={{ marginTop: '1.5rem', marginBottom: '0.75rem' }}>Loyalty Tiers</h5>
                        <div className="tier-grid">
                            {rewardsConfig.loyalty.tiers.map((tier, idx) => (
                                <div className={`tier-card ${tier.name.toLowerCase()}`} key={idx}>
                                    <div className="tier-card-edit">
                                        <input type="text" value={tier.icon} className="tier-icon-input"
                                            onChange={e => {
                                                const tiers = [...rewardsConfig.loyalty.tiers];
                                                tiers[idx] = { ...tiers[idx], icon: e.target.value };
                                                setRewardsConfig(prev => ({ ...prev, loyalty: { ...prev.loyalty, tiers } }));
                                            }} />
                                        <input type="text" value={tier.name} className="tier-name-input"
                                            onChange={e => {
                                                const tiers = [...rewardsConfig.loyalty.tiers];
                                                tiers[idx] = { ...tiers[idx], name: e.target.value };
                                                setRewardsConfig(prev => ({ ...prev, loyalty: { ...prev.loyalty, tiers } }));
                                            }} />
                                    </div>
                                    <div className="tier-points-input">
                                        <label>Min Points</label>
                                        <input type="number" min="0" value={tier.minPoints}
                                            onChange={e => {
                                                const tiers = [...rewardsConfig.loyalty.tiers];
                                                tiers[idx] = { ...tiers[idx], minPoints: parseInt(e.target.value) || 0 };
                                                setRewardsConfig(prev => ({ ...prev, loyalty: { ...prev.loyalty, tiers } }));
                                            }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="config-hint">
                            Example: With {rewardsConfig.loyalty.pointsPerDollar} point(s) per $1 and {rewardsConfig.loyalty.redemptionRate} points = $1 discount, a customer spending $50 earns {Math.floor(50 * rewardsConfig.loyalty.pointsPerDollar)} points.
                            Redeeming {rewardsConfig.loyalty.redemptionRate} points saves $1.
                        </p>
                    </div>

                    <div className="config-section">
                        <div className="config-section-header">
                            <h4>Daily Spin Wheel</h4>
                            <label className="toggle-label">
                                <input type="checkbox" checked={rewardsConfig.spinWheel.enabled}
                                    onChange={e => setRewardsConfig(prev => ({
                                        ...prev,
                                        spinWheel: { ...prev.spinWheel, enabled: e.target.checked }
                                    }))} />
                                <span>{rewardsConfig.spinWheel.enabled ? 'Enabled' : 'Disabled'}</span>
                            </label>
                        </div>

                        <div className="config-row" style={{ marginBottom: '1rem' }}>
                            <div className="config-field">
                                <label>Cooldown (hours between spins)</label>
                                <input type="number" min="1" max="168" value={rewardsConfig.spinWheel.cooldownHours}
                                    onChange={e => setRewardsConfig(prev => ({
                                        ...prev,
                                        spinWheel: { ...prev.spinWheel, cooldownHours: parseInt(e.target.value) || 24 }
                                    }))} />
                            </div>
                        </div>

                        <div className="spin-prizes-table">
                            <div className="spin-prizes-header">
                                <span>Icon</span>
                                <span>Prize Name</span>
                                <span>Type</span>
                                <span>Value</span>
                                <span>Weight %</span>
                                <span>Color</span>
                                <span></span>
                            </div>
                            {rewardsConfig.spinWheel.prizes.map((prize, idx) => (
                                <div className="spin-prize-row" key={prize.id || idx}>
                                    <input type="text" value={prize.icon} className="prize-icon-input"
                                        onChange={e => {
                                            const prizes = [...rewardsConfig.spinWheel.prizes];
                                            prizes[idx] = { ...prizes[idx], icon: e.target.value };
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }} />
                                    <input type="text" value={prize.name}
                                        onChange={e => {
                                            const prizes = [...rewardsConfig.spinWheel.prizes];
                                            prizes[idx] = { ...prizes[idx], name: e.target.value };
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }} />
                                    <select value={prize.type}
                                        onChange={e => {
                                            const prizes = [...rewardsConfig.spinWheel.prizes];
                                            prizes[idx] = { ...prizes[idx], type: e.target.value };
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }}>
                                        <option value="none">No Prize</option>
                                        <option value="discount">% Discount</option>
                                        <option value="points">Bonus Points</option>
                                        <option value="multiplier">Point Multiplier</option>
                                        <option value="freeItem">Free Item</option>
                                        <option value="flatDiscount">$ Off</option>
                                    </select>
                                    <input type="text" value={prize.value}
                                        onChange={e => {
                                            const prizes = [...rewardsConfig.spinWheel.prizes];
                                            const val = prize.type === 'freeItem' ? e.target.value : (parseFloat(e.target.value) || 0);
                                            prizes[idx] = { ...prizes[idx], value: val };
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }} />
                                    <input type="number" min="0" max="100" value={prize.weight}
                                        onChange={e => {
                                            const prizes = [...rewardsConfig.spinWheel.prizes];
                                            prizes[idx] = { ...prizes[idx], weight: parseInt(e.target.value) || 0 };
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }} />
                                    <input type="color" value={prize.color}
                                        onChange={e => {
                                            const prizes = [...rewardsConfig.spinWheel.prizes];
                                            prizes[idx] = { ...prizes[idx], color: e.target.value };
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }} />
                                    <button className="btn-ghost danger" title="Remove"
                                        onClick={() => {
                                            const prizes = rewardsConfig.spinWheel.prizes.filter((_, i) => i !== idx);
                                            setRewardsConfig(prev => ({ ...prev, spinWheel: { ...prev.spinWheel, prizes } }));
                                        }}>
                                        <i className="bi bi-trash"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button className="btn-ghost" style={{ marginTop: '0.75rem' }}
                            onClick={() => {
                                const newPrize = {
                                    id: `prize_${Date.now()}`,
                                    name: 'New Prize',
                                    type: 'none',
                                    value: 0,
                                    weight: 10,
                                    icon: '🎁',
                                    color: '#95a5a6',
                                    message: 'You won a prize!'
                                };
                                setRewardsConfig(prev => ({
                                    ...prev,
                                    spinWheel: { ...prev.spinWheel, prizes: [...prev.spinWheel.prizes, newPrize] }
                                }));
                            }}>
                            <i className="bi bi-plus-circle"></i> Add Prize
                        </button>
                        <p className="config-hint" style={{ marginTop: '0.75rem' }}>
                            Total weight: {rewardsConfig.spinWheel.prizes.reduce((sum, p) => sum + p.weight, 0)}%
                            {rewardsConfig.spinWheel.prizes.reduce((sum, p) => sum + p.weight, 0) !== 100 &&
                                <span className="config-warning"> (should equal 100%)</span>
                            }
                        </p>
                    </div>
                </div>
            )}
            <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
        </div>
    );
};

const StoreLaunchFlyer = ({ promo, restaurantSlug, onClose }) => {
    const flyerRef = useRef(null);
    const websiteBaseUrl = `${getApiBaseUrl()}/serveWebsite`;
    const defaultUrl = `${websiteBaseUrl}?restaurant=${restaurantSlug}&promo=${promo.id}`;
    const [customUrl, setCustomUrl] = useState('');
    const [urlMode, setUrlMode] = useState('default'); // 'default' or 'custom'

    // Build the final QR target URL
    const flyerUrl = urlMode === 'custom' && customUrl.trim()
        ? `${customUrl.trim()}${customUrl.trim().includes('?') ? '&' : '?'}koda_promo=${promo.id}`
        : defaultUrl;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(flyerUrl)}`;
    const qrDownloadUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(flyerUrl)}&format=png`;

    const isStoreLaunch = promo.type === 'storeLaunch';
    const headerTitle = isStoreLaunch ? "You're Invited!" : "Special Offer!";
    const headerSubtitle = isStoreLaunch ? "We're excited to welcome you" : "Don't miss this exclusive deal";
    const scanText = isStoreLaunch
        ? "Scan to register & claim your offer!"
        : "Scan to claim your discount!";

    const handlePrint = () => {
        const printContent = flyerRef.current;
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html><head><title>Promotion Flyer</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', system-ui, sans-serif; display: flex; justify-content: center; padding: 20px; }
                .flyer { width: 600px; border: 3px solid #333; border-radius: 16px; overflow: hidden; text-align: center; }
                .flyer-header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 40px 30px 30px; }
                .flyer-header h1 { font-size: 32px; margin-bottom: 8px; }
                .flyer-header p { font-size: 16px; opacity: 0.9; }
                .flyer-body { padding: 30px; }
                .flyer-discount { font-size: 64px; font-weight: 800; color: #667eea; margin: 10px 0; }
                .flyer-title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
                .flyer-desc { font-size: 16px; color: #555; margin-bottom: 20px; }
                .flyer-qr { margin: 20px auto; }
                .flyer-qr img { border: 4px solid #eee; border-radius: 12px; }
                .flyer-scan { font-size: 18px; font-weight: 600; color: #333; margin: 12px 0 4px; }
                .flyer-code { font-size: 14px; color: #888; margin-bottom: 8px; }
                .flyer-footer { background: #f8f9fa; padding: 16px; font-size: 13px; color: #888; }
                @media print { body { padding: 0; } .flyer { border: none; } }
            </style></head><body>
            ${printContent.innerHTML}
            </body></html>
        `);
        printWindow.document.close();
        printWindow.print();
    };

    return (
        <div className="flyer-modal-overlay" onClick={onClose}>
            <div className="flyer-modal" onClick={e => e.stopPropagation()}>
                <div className="flyer-modal-header">
                    <h3>Promotion Flyer</h3>
                    <button className="btn-ghost" onClick={onClose}><i className="bi bi-x-lg"></i></button>
                </div>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', background: '#fafbfc' }}>
                    <label style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px', display: 'block' }}>QR Code Destination</label>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="radio" name="urlMode" value="default" checked={urlMode === 'default'} onChange={() => setUrlMode('default')} />
                            Koda Carte hosted site
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                            <input type="radio" name="urlMode" value="custom" checked={urlMode === 'custom'} onChange={() => setUrlMode('custom')} />
                            My own website
                        </label>
                    </div>
                    {urlMode === 'custom' && (
                        <div style={{ marginBottom: '8px' }}>
                            <input
                                type="url"
                                placeholder="https://myrestaurant.com"
                                value={customUrl}
                                onChange={e => setCustomUrl(e.target.value)}
                                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' }}
                            />
                            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                                Your site must have the Koda Carte widget installed. The promo will auto-open in the widget.
                            </div>
                        </div>
                    )}
                    <div style={{ fontSize: '12px', color: '#666', background: '#f0f0f0', padding: '8px 10px', borderRadius: '6px', wordBreak: 'break-all' }}>
                        <strong>QR points to:</strong> {flyerUrl}
                    </div>
                </div>
                <div ref={flyerRef}>
                    <div className="flyer">
                        <div className="flyer-header">
                            <h1>{headerTitle}</h1>
                            <p>{headerSubtitle}</p>
                        </div>
                        <div className="flyer-body">
                            <div className="flyer-discount">{promo.discount}</div>
                            <div className="flyer-title">{promo.title}</div>
                            <div className="flyer-desc">{promo.description}</div>
                            <div className="flyer-qr">
                                <img src={qrCodeUrl} alt="Scan to claim offer" width="200" height="200" />
                            </div>
                            <div className="flyer-scan">{scanText}</div>
                            <div className="flyer-code">
                                Valid until: {promo.validUntil ? new Date(promo.validUntil).toLocaleDateString() : 'N/A'}
                            </div>
                        </div>
                        <div className="flyer-footer">
                            Powered by Koda Carte
                        </div>
                    </div>
                </div>
                <div className="flyer-modal-actions">
                    <button className="btn-primary" onClick={handlePrint}>
                        <i className="bi bi-printer"></i> Print Flyer
                    </button>
                    <a href={qrDownloadUrl} download={`promo-qr-${promo.code}.png`} className="btn-ghost">
                        <i className="bi bi-download"></i> Download QR Code
                    </a>
                </div>
            </div>
        </div>
    );
};

export default PromotionsRewards;
