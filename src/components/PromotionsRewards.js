import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import './PromotionsRewards.css';

const PromotionsRewards = () => {
    const { user } = useAuth();
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
        freeItemName: ''
    });

    useEffect(() => {
        if (user) {
            loadPromotions();
        }
    }, [user]);

    const loadPromotions = async () => {
        try {
            setLoading(true);
            const promoRef = collection(db, `restaurants/${user.uid}/promotions`);
            const q = query(promoRef, orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);

            const promos = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                validFrom: doc.data().validFrom?.toDate?.()?.toISOString().split('T')[0] || '',
                validUntil: doc.data().validUntil?.toDate?.()?.toISOString().split('T')[0] || ''
            }));

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

            // Add type-specific fields
            if (formData.type === 'bogo') {
                promoData.bogoItems = formData.bogoItems;
                promoData.bogoQuantityLimit = parseInt(formData.bogoQuantityLimit) || 1;
            }
            if (formData.type === 'freeItem') {
                promoData.freeItemName = formData.freeItemName;
            }

            if (editingPromo) {
                await updateDoc(doc(db, `restaurants/${user.uid}/promotions`, editingPromo.id), promoData);
            } else {
                promoData.createdAt = serverTimestamp();
                await addDoc(collection(db, `restaurants/${user.uid}/promotions`), promoData);
            }

            setShowForm(false);
            setEditingPromo(null);
            resetForm();
            loadPromotions();
        } catch (err) {
            console.error('Error saving promotion:', err);
            alert('Failed to save promotion');
        }
    };

    const getDefaultImage = (type) => {
        const images = {
            percentage: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&h=250&fit=crop',
            bogo: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=250&fit=crop',
            freeItem: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400&h=250&fit=crop',
            flashSale: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=250&fit=crop',
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
            freeItemName: ''
        });
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
            freeItemName: promo.freeItemName || ''
        });
        setEditingPromo(promo);
        setShowForm(true);
    };

    const handleDelete = async (promoId) => {
        if (!window.confirm('Are you sure you want to delete this promotion?')) return;

        try {
            await deleteDoc(doc(db, `restaurants/${user.uid}/promotions`, promoId));
            loadPromotions();
        } catch (err) {
            console.error('Error deleting promotion:', err);
            alert('Failed to delete promotion');
        }
    };

    const togglePublish = async (promo) => {
        try {
            await updateDoc(doc(db, `restaurants/${user.uid}/promotions`, promo.id), {
                isPublished: !promo.isPublished,
                updatedAt: serverTimestamp()
            });
            loadPromotions();
        } catch (err) {
            console.error('Error toggling publish:', err);
            alert('Failed to update promotion');
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
            <div className="page-header">
                <div>
                    <h1>🎁 Promotions & Rewards</h1>
                    <p>Create and manage promotions for your customers</p>
                </div>
                <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
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

            {activeTab === 'rewards' && (
                <div className="rewards-config">
                    <h3>Rewards Configuration</h3>
                    <div className="config-section">
                        <h4>Loyalty Points System</h4>
                        <p>Customers earn <strong>1 point per $1</strong> spent on orders.</p>
                        <div className="tier-grid">
                            <div className="tier-card bronze">
                                <h5>🥉 Bronze</h5>
                                <p>0 - 499 points</p>
                            </div>
                            <div className="tier-card silver">
                                <h5>🥈 Silver</h5>
                                <p>500 - 999 points</p>
                            </div>
                            <div className="tier-card gold">
                                <h5>🥇 Gold</h5>
                                <p>1000 - 1999 points</p>
                            </div>
                            <div className="tier-card platinum">
                                <h5>💎 Platinum</h5>
                                <p>2000+ points</p>
                            </div>
                        </div>
                    </div>
                    <div className="config-section">
                        <h4>Daily Spin Wheel</h4>
                        <p>Customers can spin once every 24 hours for a chance to win rewards:</p>
                        <ul className="spin-prizes">
                            <li>😅 Try Again (40% chance)</li>
                            <li>🎉 10% Off (20% chance)</li>
                            <li>⭐ 50 Bonus Points (15% chance)</li>
                            <li>✨ Double Points on Next Order (10% chance)</li>
                            <li>🥤 Free Drink (10% chance)</li>
                            <li>🍰 Free Dessert (5% chance)</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PromotionsRewards;
