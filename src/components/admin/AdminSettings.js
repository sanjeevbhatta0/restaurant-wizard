import React, { useState, useEffect } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseConsoleUrl } from '../../config';
import { adminAuth, adminDb, adminFunctions } from '../../adminFirebase';
import TwoFactorSetup from './TwoFactorSetup';

const AdminSettings = ({ showToast }) => {
    const { currentUser } = useAdmin();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    // 2FA state
    const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
    const [showSetupWizard, setShowSetupWizard] = useState(false);
    const [showDisableConfirm, setShowDisableConfirm] = useState(false);
    const [disableCode, setDisableCode] = useState('');
    const [disableLoading, setDisableLoading] = useState(false);
    const [showRegenConfirm, setShowRegenConfirm] = useState(false);
    const [regenCode, setRegenCode] = useState('');
    const [regenLoading, setRegenLoading] = useState(false);
    const [regenBackupCodes, setRegenBackupCodes] = useState([]);
    const [tfaLoading, setTfaLoading] = useState(true);

    // Check current 2FA status
    useEffect(() => {
        const check2FAStatus = async () => {
            if (currentUser) {
                try {
                    const adminDoc = await getDoc(doc(adminDb, 'admins', currentUser.uid));
                    const adminData = adminDoc.data();
                    setTwoFactorEnabled(adminData?.twoFactorEnabled || false);
                } catch (err) {
                    console.error('Error checking 2FA status:', err);
                }
            }
            setTfaLoading(false);
        };
        check2FAStatus();
    }, [currentUser]);

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
            await reauthenticateWithCredential(adminAuth.currentUser, credential);

            // Update password
            await updatePassword(adminAuth.currentUser, newPassword);

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
            await adminAuth.signOut();
            window.location.href = '/admin/login';
        } catch (error) {
            showToast('Failed to logout', 'error');
        }
    };

    const handle2FASetupComplete = () => {
        setShowSetupWizard(false);
        setTwoFactorEnabled(true);
        showToast('Two-factor authentication enabled successfully!', 'success');
    };

    const handleDisable2FA = async () => {
        if (!disableCode) {
            showToast('Please enter your authenticator code.', 'error');
            return;
        }

        setDisableLoading(true);
        try {
            const disableFn = httpsCallable(adminFunctions, 'disableAdmin2FA');
            await disableFn({ code: disableCode });
            setTwoFactorEnabled(false);
            setShowDisableConfirm(false);
            setDisableCode('');
            showToast('Two-factor authentication has been disabled.', 'success');
        } catch (error) {
            console.error('Error disabling 2FA:', error);
            showToast(error.message?.includes('Incorrect') ? 'Incorrect code. Please try again.' : 'Failed to disable 2FA.', 'error');
        } finally {
            setDisableLoading(false);
        }
    };

    const handleRegenerateBackupCodes = async () => {
        if (!regenCode || regenCode.length !== 6) {
            showToast('Please enter a valid 6-digit code.', 'error');
            return;
        }

        setRegenLoading(true);
        try {
            const regenFn = httpsCallable(adminFunctions, 'regenerateBackupCodes');
            const result = await regenFn({ code: regenCode });
            setRegenBackupCodes(result.data.backupCodes);
            setRegenCode('');
            showToast('New backup codes generated!', 'success');
        } catch (error) {
            console.error('Error regenerating codes:', error);
            showToast(error.message?.includes('Incorrect') ? 'Incorrect code. Please try again.' : 'Failed to regenerate codes.', 'error');
        } finally {
            setRegenLoading(false);
        }
    };

    const handleCopyRegenCodes = () => {
        navigator.clipboard.writeText(regenBackupCodes.join('\n')).then(() => {
            showToast('Backup codes copied to clipboard!', 'success');
        });
    };

    const handleDownloadRegenCodes = () => {
        const content = `KODA CARTE ADMIN — 2FA BACKUP CODES (Regenerated)
========================================
Generated: ${new Date().toLocaleDateString()}

${regenBackupCodes.map((code, i) => `${i + 1}. ${code}`).join('\n')}

Each code can only be used once.
========================================`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'koda-carte-backup-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="admin-settings">
            {/* Account Information */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">&#x1F464;</span>
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

            {/* Two-Factor Authentication */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">&#x1F6E1;&#xFE0F;</span>
                        Two-Factor Authentication
                    </h2>
                    {!tfaLoading && (
                        <span className={`tfa-status-badge ${twoFactorEnabled ? 'active' : 'inactive'}`}>
                            {twoFactorEnabled ? 'Active' : 'Not Active'}
                        </span>
                    )}
                </div>

                {tfaLoading ? (
                    <p style={{ color: 'var(--admin-text-muted)', padding: '1rem 0' }}>Checking security status...</p>
                ) : !twoFactorEnabled ? (
                    /* 2FA Not Enabled */
                    <div className="tfa-settings-section">
                        <div className="tfa-settings-info">
                            <div className="tfa-settings-icon-large">&#x1F512;</div>
                            <div>
                                <h3>Add an extra layer of security</h3>
                                <p>
                                    Two-factor authentication protects your admin account by requiring a code from your phone
                                    in addition to your password. This means even if someone knows your password, they can't
                                    access your restaurant's data without your phone.
                                </p>
                                <p className="tfa-settings-time">Setup takes about 2 minutes.</p>
                            </div>
                        </div>
                        <button
                            className="admin-btn admin-btn-primary"
                            onClick={() => setShowSetupWizard(true)}
                        >
                            Enable Two-Factor Authentication
                        </button>
                    </div>
                ) : (
                    /* 2FA Enabled */
                    <div className="tfa-settings-section">
                        <div className="tfa-settings-active">
                            <div className="tfa-active-status">
                                <span className="tfa-active-icon">&#x2705;</span>
                                <div>
                                    <strong>Your account is protected</strong>
                                    <p>Two-factor authentication is active. You'll be asked for a code from your authenticator app each time you sign in.</p>
                                </div>
                            </div>

                            <div className="tfa-settings-actions">
                                {/* Regenerate Backup Codes */}
                                {!showRegenConfirm ? (
                                    <button
                                        className="admin-btn admin-btn-secondary"
                                        onClick={() => setShowRegenConfirm(true)}
                                    >
                                        Generate New Backup Codes
                                    </button>
                                ) : regenBackupCodes.length > 0 ? (
                                    <div className="tfa-regen-result">
                                        <h4>Your New Backup Codes</h4>
                                        <p>Save these somewhere safe. Your old codes no longer work.</p>
                                        <div className="tfa-regen-codes-grid">
                                            {regenBackupCodes.map((code, i) => (
                                                <div key={i} className="tfa-regen-code">{i + 1}. {code}</div>
                                            ))}
                                        </div>
                                        <div className="tfa-regen-actions">
                                            <button className="admin-btn admin-btn-secondary" onClick={handleCopyRegenCodes}>
                                                Copy Codes
                                            </button>
                                            <button className="admin-btn admin-btn-secondary" onClick={handleDownloadRegenCodes}>
                                                Download
                                            </button>
                                            <button className="admin-btn admin-btn-secondary" onClick={() => { setShowRegenConfirm(false); setRegenBackupCodes([]); }}>
                                                Done
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="tfa-confirm-box">
                                        <p>Enter your authenticator code to generate new backup codes:</p>
                                        <div className="tfa-confirm-input-row">
                                            <input
                                                type="text"
                                                className="admin-input tfa-confirm-input"
                                                value={regenCode}
                                                onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="6-digit code"
                                                maxLength={6}
                                            />
                                            <button
                                                className="admin-btn admin-btn-primary"
                                                onClick={handleRegenerateBackupCodes}
                                                disabled={regenLoading || regenCode.length !== 6}
                                            >
                                                {regenLoading ? 'Generating...' : 'Generate'}
                                            </button>
                                            <button
                                                className="admin-btn admin-btn-secondary"
                                                onClick={() => { setShowRegenConfirm(false); setRegenCode(''); }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Disable 2FA */}
                                {!showDisableConfirm ? (
                                    <button
                                        className="admin-btn admin-btn-danger"
                                        onClick={() => setShowDisableConfirm(true)}
                                    >
                                        Disable Two-Factor Authentication
                                    </button>
                                ) : (
                                    <div className="tfa-confirm-box danger">
                                        <p><strong>Are you sure?</strong> Disabling 2FA will make your account less secure. Enter your authenticator code to confirm:</p>
                                        <div className="tfa-confirm-input-row">
                                            <input
                                                type="text"
                                                className="admin-input tfa-confirm-input"
                                                value={disableCode}
                                                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="6-digit code"
                                                maxLength={6}
                                            />
                                            <button
                                                className="admin-btn admin-btn-danger"
                                                onClick={handleDisable2FA}
                                                disabled={disableLoading || disableCode.length !== 6}
                                            >
                                                {disableLoading ? 'Disabling...' : 'Confirm Disable'}
                                            </button>
                                            <button
                                                className="admin-btn admin-btn-secondary"
                                                onClick={() => { setShowDisableConfirm(false); setDisableCode(''); }}
                                            >
                                                Keep Enabled
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Change Password */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">&#x1F512;</span>
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
                        {loading ? 'Updating...' : 'Update Password'}
                    </button>
                </form>
            </div>

            {/* Quick Actions */}
            <div className="admin-card">
                <div className="admin-card-header">
                    <h2 className="admin-card-title">
                        <span className="admin-card-title-icon">&#x26A1;</span>
                        Quick Actions
                    </h2>
                </div>

                <div className="admin-grid admin-grid-3">
                    <div className="settings-action-card">
                        <div className="settings-action-icon">&#x1F310;</div>
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
                        <div className="settings-action-icon">&#x1F4CA;</div>
                        <h4>Firebase Console</h4>
                        <p>Manage database and authentication</p>
                        <a
                            href={getFirebaseConsoleUrl()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="admin-btn admin-btn-secondary"
                        >
                            Open Console
                        </a>
                    </div>

                    <div className="settings-action-card">
                        <div className="settings-action-icon">&#x1F6AA;</div>
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
                        <span className="admin-card-title-icon">&#x2139;&#xFE0F;</span>
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
                        <span className="settings-info-label">2FA Status</span>
                        <span className="settings-info-value">
                            {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>
                </div>
            </div>

            {/* 2FA Setup Wizard Modal */}
            {showSetupWizard && (
                <TwoFactorSetup
                    onComplete={handle2FASetupComplete}
                    onCancel={() => setShowSetupWizard(false)}
                    showToast={showToast}
                    functionsInstance={adminFunctions}
                />
            )}

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

                /* 2FA Settings Styles */
                .tfa-status-badge {
                    display: inline-block;
                    font-size: 0.75rem;
                    padding: 0.25rem 0.75rem;
                    border-radius: 999px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .tfa-status-badge.active {
                    background: rgba(34, 197, 94, 0.15);
                    color: var(--admin-green);
                }

                .tfa-status-badge.inactive {
                    background: rgba(255, 255, 255, 0.08);
                    color: var(--admin-text-muted);
                }

                .tfa-settings-section {
                    padding: 0.5rem 0;
                }

                .tfa-settings-info {
                    display: flex;
                    gap: 1.5rem;
                    align-items: flex-start;
                    margin-bottom: 1.5rem;
                }

                .tfa-settings-icon-large {
                    font-size: 2.5rem;
                    flex-shrink: 0;
                }

                .tfa-settings-info h3 {
                    margin: 0 0 0.5rem;
                    font-size: 1.1rem;
                    color: var(--admin-text-primary);
                }

                .tfa-settings-info p {
                    margin: 0;
                    color: var(--admin-text-secondary);
                    font-size: 0.95rem;
                    line-height: 1.6;
                }

                .tfa-settings-time {
                    margin-top: 0.5rem !important;
                    color: var(--admin-accent-primary) !important;
                    font-size: 0.85rem !important;
                    font-weight: 500;
                }

                .tfa-settings-active {
                    display: flex;
                    flex-direction: column;
                    gap: 1.25rem;
                }

                .tfa-active-status {
                    display: flex;
                    gap: 1rem;
                    align-items: flex-start;
                    background: rgba(34, 197, 94, 0.08);
                    border: 1px solid rgba(34, 197, 94, 0.2);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                }

                .tfa-active-icon {
                    font-size: 1.5rem;
                    flex-shrink: 0;
                }

                .tfa-active-status strong {
                    display: block;
                    margin-bottom: 0.25rem;
                }

                .tfa-active-status p {
                    margin: 0;
                    color: var(--admin-text-secondary);
                    font-size: 0.9rem;
                    line-height: 1.5;
                }

                .tfa-settings-actions {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .tfa-confirm-box {
                    background: var(--admin-bg-tertiary);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                }

                .tfa-confirm-box.danger {
                    border-color: rgba(239, 68, 68, 0.3);
                    background: rgba(239, 68, 68, 0.05);
                }

                .tfa-confirm-box p {
                    margin: 0 0 0.75rem;
                    color: var(--admin-text-secondary);
                    font-size: 0.9rem;
                    line-height: 1.5;
                }

                .tfa-confirm-input-row {
                    display: flex;
                    gap: 0.75rem;
                    align-items: center;
                    flex-wrap: wrap;
                }

                .tfa-confirm-input {
                    max-width: 160px;
                    font-family: 'SF Mono', 'Fira Code', monospace;
                    letter-spacing: 2px;
                    text-align: center;
                }

                .tfa-regen-result {
                    background: var(--admin-bg-tertiary);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                }

                .tfa-regen-result h4 {
                    margin: 0 0 0.5rem;
                    color: var(--admin-text-primary);
                }

                .tfa-regen-result > p {
                    margin: 0 0 1rem;
                    color: var(--admin-text-secondary);
                    font-size: 0.9rem;
                }

                .tfa-regen-codes-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 0.5rem;
                    margin-bottom: 1rem;
                }

                .tfa-regen-code {
                    font-family: 'SF Mono', 'Fira Code', monospace;
                    font-size: 0.9rem;
                    font-weight: 600;
                    padding: 0.5rem 0.75rem;
                    background: var(--admin-bg);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    color: var(--admin-text-primary);
                }

                .tfa-regen-actions {
                    display: flex;
                    gap: 0.75rem;
                    flex-wrap: wrap;
                }

                @media (max-width: 768px) {
                    .tfa-settings-info {
                        flex-direction: column;
                    }

                    .tfa-confirm-input-row {
                        flex-direction: column;
                        align-items: stretch;
                    }

                    .tfa-confirm-input {
                        max-width: 100%;
                    }

                    .tfa-regen-codes-grid {
                        grid-template-columns: 1fr;
                    }
                }
            `}</style>
        </div>
    );
};

export default AdminSettings;
