import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAdmin } from '../../contexts/AdminContext';
import PricingManagement from './PricingManagement';
import FeatureManagement from './FeatureManagement';
import PricingPreview from './PricingPreview';
import MetricsDashboard from './MetricsDashboard';
import AdminSettings from './AdminSettings';
import PublishScheduler from './PublishScheduler';
import './AdminDashboard.css';

const AdminDashboard = () => {
    const {
        currentUser,
        isAdmin,
        loading,
        hasUnsavedChanges,
        saving,
        publishing,
        saveDraft,
        publish
    } = useAdmin();
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showScheduler, setShowScheduler] = useState(false);
    const [toast, setToast] = useState(null);

    // Redirect if not admin
    useEffect(() => {
        if (!loading && !isAdmin) {
            navigate('/admin/login');
        }
    }, [loading, isAdmin, navigate]);

    // Get current section from path
    const getCurrentSection = () => {
        const path = location.pathname.replace('/admin', '').replace('/', '');
        return path || 'pricing';
    };

    const navItems = [
        { id: 'pricing', label: 'Pricing', icon: '💰', path: '/admin/pricing' },
        { id: 'features', label: 'Features', icon: '⚡', path: '/admin/features' },
        { id: 'preview', label: 'Preview', icon: '👁️', path: '/admin/preview' },
        { id: 'metrics', label: 'Metrics', icon: '📊', path: '/admin/metrics' },
        { id: 'settings', label: 'Settings', icon: '⚙️', path: '/admin/settings' }
    ];

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleSaveDraft = async () => {
        const result = await saveDraft();
        if (result.success) {
            showToast('Draft saved successfully!', 'success');
        } else {
            showToast('Failed to save draft: ' + result.error, 'error');
        }
    };

    const handlePublish = async () => {
        const result = await publish();
        if (result.success) {
            showToast('Changes published successfully!', 'success');
        } else {
            showToast('Failed to publish: ' + result.error, 'error');
        }
    };

    if (loading) {
        return (
            <div className="admin-layout">
                <div className="admin-loading">
                    <div className="admin-spinner"></div>
                </div>
            </div>
        );
    }

    if (!isAdmin) {
        return <Navigate to="/admin/login" />;
    }

    return (
        <div className="admin-layout">
            {/* Sidebar */}
            <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
                <div className="admin-sidebar-header">
                    <a href="/" className="admin-logo">
                        <img src="/koda-carte-logo.png" alt="Koda Carte" />
                        <div>
                            <span className="admin-logo-text">Koda Carte</span>
                        </div>
                        <span className="admin-logo-badge">ADMIN</span>
                    </a>
                </div>

                <nav className="admin-nav">
                    <div className="admin-nav-section">
                        <div className="admin-nav-section-title">Configuration</div>
                        {navItems.slice(0, 3).map(item => (
                            <button
                                key={item.id}
                                className={`admin-nav-item ${getCurrentSection() === item.id ? 'active' : ''}`}
                                onClick={() => {
                                    navigate(item.path);
                                    setSidebarOpen(false);
                                }}
                            >
                                <span className="admin-nav-item-icon">{item.icon}</span>
                                <span>{item.label}</span>
                                {item.id === 'pricing' && hasUnsavedChanges && (
                                    <span className="admin-nav-item-badge">Draft</span>
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="admin-nav-section">
                        <div className="admin-nav-section-title">Analytics</div>
                        {navItems.slice(3, 4).map(item => (
                            <button
                                key={item.id}
                                className={`admin-nav-item ${getCurrentSection() === item.id ? 'active' : ''}`}
                                onClick={() => {
                                    navigate(item.path);
                                    setSidebarOpen(false);
                                }}
                            >
                                <span className="admin-nav-item-icon">{item.icon}</span>
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="admin-nav-section">
                        <div className="admin-nav-section-title">Account</div>
                        {navItems.slice(4).map(item => (
                            <button
                                key={item.id}
                                className={`admin-nav-item ${getCurrentSection() === item.id ? 'active' : ''}`}
                                onClick={() => {
                                    navigate(item.path);
                                    setSidebarOpen(false);
                                }}
                            >
                                <span className="admin-nav-item-icon">{item.icon}</span>
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="admin-sidebar-footer">
                    <div className="admin-user-info">
                        <div className="admin-user-avatar">
                            {currentUser?.email?.charAt(0).toUpperCase() || 'A'}
                        </div>
                        <div className="admin-user-details">
                            <div className="admin-user-name">Admin</div>
                            <div className="admin-user-role">{currentUser?.email}</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="admin-main">
                <header className="admin-header">
                    <div className="admin-header-left">
                        <button
                            className="admin-btn admin-btn-ghost admin-btn-icon mobile-menu-btn"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            style={{ display: 'none' }}
                        >
                            ☰
                        </button>
                        <h1 className="admin-page-title">
                            {navItems.find(i => i.id === getCurrentSection())?.label || 'Dashboard'}
                        </h1>
                        {hasUnsavedChanges ? (
                            <span className="admin-status-badge draft">
                                <span className="admin-status-dot"></span>
                                Unsaved Changes
                            </span>
                        ) : (
                            <span className="admin-status-badge published">
                                <span className="admin-status-dot"></span>
                                Published
                            </span>
                        )}
                    </div>

                    <div className="admin-header-actions">
                        <button
                            className="admin-btn admin-btn-secondary"
                            onClick={handleSaveDraft}
                            disabled={!hasUnsavedChanges || saving}
                        >
                            {saving ? '⏳ Saving...' : '💾 Save Draft'}
                        </button>
                        <button
                            className="admin-btn admin-btn-secondary"
                            onClick={() => setShowScheduler(true)}
                            disabled={!hasUnsavedChanges}
                        >
                            📅 Schedule
                        </button>
                        <button
                            className="admin-btn admin-btn-success"
                            onClick={handlePublish}
                            disabled={!hasUnsavedChanges || publishing}
                        >
                            {publishing ? '⏳ Publishing...' : '🚀 Publish Now'}
                        </button>
                    </div>
                </header>

                <div className="admin-content">
                    <Routes>
                        <Route path="/" element={<Navigate to="/admin/pricing" />} />
                        <Route path="/pricing" element={<PricingManagement showToast={showToast} />} />
                        <Route path="/features" element={<FeatureManagement showToast={showToast} />} />
                        <Route path="/preview" element={<PricingPreview />} />
                        <Route path="/metrics" element={<MetricsDashboard />} />
                        <Route path="/settings" element={<AdminSettings showToast={showToast} />} />
                    </Routes>
                </div>
            </main>

            {/* Scheduler Modal */}
            {showScheduler && (
                <PublishScheduler
                    onClose={() => setShowScheduler(false)}
                    showToast={showToast}
                />
            )}

            {/* Toast Notification */}
            {toast && (
                <div className={`admin-toast ${toast.type}`}>
                    {toast.type === 'success' && '✅'}
                    {toast.type === 'error' && '❌'}
                    {toast.type === 'info' && 'ℹ️'}
                    <span>{toast.message}</span>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
