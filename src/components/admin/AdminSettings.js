import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../firebase';

const AdminSettings = ({ showToast }) => {
    const { currentUser } = useAuth();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handlePasswordChange = async (e) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            showToast('New passwords do not match', 'error');
            return;
        }

        if (newPassword.length < 8) {
            showToast('Password must be at least 8 characters', 'error');
            return;
        }

        setLoading(true);

        try {
            // Re-authenticate user first
            const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
            await reauthenticateWithCredential(auth.currentUser, credential);

            // Update password
            await updatePassword(auth.currentUser, newPassword);

            showToast('Password updated successfully!', 'success');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (error) {
            console.error('Password change error:', error);
            if (error.code === 'auth/wrong-password') {
                showToast('Current password is incorrect', 'error');
            } else {
                showToast('Failed to update password: ' + error.message, 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        try {
            await auth.signOut();
            window.location.href = '/admin/login';
        } catch (error) {
            showToast('Failed to logout', 'error');
        }
    };

    return (
        <div className="admin-settings">
            {/* Account Information */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">👤</span>
                        Account Information
                    </h2>
                </div>

                <div className="admin-grid admin-grid-2">
                    <div className="admin-form-group">
                        <label className="admin-label">Email Address</label>
                        <input
                            type="email"
                            className="admin-input"
                            value={currentUser?.email || ''}
                            disabled
                        />
                    </div>

                    <div className="admin-form-group">
                        <label className="admin-label">Account Type</label>
                        <input
                            type="text"
                            className="admin-input"
                            value="Platform Administrator"
                            disabled
                        />
                    </div>
                </div>
            </div>

            {/* Change Password */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">🔒</span>
                        Change Password
                    </h2>
                </div>

                <form onSubmit={handlePasswordChange}>
                    <div className="admin-grid admin-grid-3">
                        <div className="admin-form-group">
                            <label className="admin-label">Current Password</label>
                            <input
                                type="password"
                                className="admin-input"
                                placeholder="Enter current password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                            />
                        </div>

                        <div className="admin-form-group">
                            <label className="admin-label">New Password</label>
                            <input
                                type="password"
                                className="admin-input"
                                placeholder="Enter new password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                minLength={8}
                            />
                        </div>

                        <div className="admin-form-group">
                            <label className="admin-label">Confirm New Password</label>
                            <input
                                type="password"
                                className="admin-input"
                                placeholder="Confirm new password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="admin-btn admin-btn-primary"
                        disabled={loading}
                    >
                        {loading ? '⏳ Updating...' : '🔐 Update Password'}
                    </button>
                </form>
            </div>

            {/* Quick Actions */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">⚡</span>
                        Quick Actions
                    </h2>
                </div>

                <div className="admin-grid admin-grid-3">
                    <div className="settings-action-card">
                        <div className="settings-action-icon">🌐</div>
                        <h4>View Website</h4>
                        <p>Open the public website in a new tab</p>
                        <a
                            href="/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="admin-btn admin-btn-secondary"
                        >
                            Open Website
                        </a>
                    </div>

                    <div className="settings-action-card">
                        <div className="settings-action-icon">📊</div>
                        <h4>Firebase Console</h4>
                        <p>Manage database and authentication</p>
                        <a
                            href="https://console.firebase.google.com/project/restaurant-portal-6b147/overview"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="admin-btn admin-btn-secondary"
                        >
                            Open Console
                        </a>
                    </div>

                    <div className="settings-action-card">
                        <div className="settings-action-icon">🚪</div>
                        <h4>Sign Out</h4>
                        <p>End your admin session</p>
                        <button
                            onClick={handleLogout}
                            className="admin-btn admin-btn-danger"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>

            {/* System Info */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">ℹ️</span>
                        System Information
                    </h2>
                </div>

                <div className="admin-grid admin-grid-4">
                    <div className="settings-info-item">
                        <span className="settings-info-label">Platform</span>
                        <span className="settings-info-value">Koda Carte Admin</span>
                    </div>
                    <div className="settings-info-item">
                        <span className="settings-info-label">Version</span>
                        <span className="settings-info-value">1.0.0</span>
                    </div>
                    <div className="settings-info-item">
                        <span className="settings-info-label">Environment</span>
                        <span className="settings-info-value">
                            {process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}
                        </span>
                    </div>
                    <div className="settings-info-item">
                        <span className="settings-info-label">Last Login</span>
                        <span className="settings-info-value">
                            {new Date().toLocaleDateString()}
                        </span>
                    </div>
                </div>
            </div>

            <style jsx>{`
        .settings-action-card {
          background: var(--admin-bg-tertiary);
          border: 1px solid var(--admin-border);
          border-radius: var(--admin-radius);
          padding: 1.5rem;
          text-align: center;
          transition: var(--admin-transition);
        }

        .settings-action-card:hover {
          border-color: var(--admin-accent-primary);
        }

        .settings-action-icon {
          font-size: 2.5rem;
          margin-bottom: 1rem;
        }

        .settings-action-card h4 {
          margin: 0 0 0.5rem;
          font-weight: 600;
        }

        .settings-action-card p {
          color: var(--admin-text-muted);
          font-size: 0.85rem;
          margin: 0 0 1rem;
        }

        .settings-info-item {
          background: var(--admin-bg-tertiary);
          border-radius: var(--admin-radius-sm);
          padding: 1rem;
        }

        .settings-info-label {
          display: block;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--admin-text-muted);
          margin-bottom: 0.5rem;
        }

        .settings-info-value {
          font-weight: 600;
        }
      `}</style>
        </div>
    );
};

export default AdminSettings;
