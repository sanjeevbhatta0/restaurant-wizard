import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { adminAuth, adminDb, adminFunctions } from '../../adminFirebase';
import './AdminDashboard.css';

const AdminLogin = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [show2FA, setShow2FA] = useState(false);
    const [tfaCode, setTfaCode] = useState('');
    const [useBackupCode, setUseBackupCode] = useState(false);
    const [backupCode, setBackupCode] = useState('');
    const [backupWarning, setBackupWarning] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const userCredential = await signInWithEmailAndPassword(adminAuth, email, password);
            // Check admin status using adminDb (same Firebase app instance as adminAuth)
            const adminDocRef = doc(adminDb, 'admins', userCredential.user.uid);
            const adminDocSnap = await getDoc(adminDocRef);
            const isAdmin = adminDocSnap.exists();

            if (!isAdmin) {
                setError('You do not have admin access.');
                await adminAuth.signOut();
                setLoading(false);
                return;
            }

            // Check if 2FA is enabled
            const adminDoc = await getDoc(doc(adminDb, 'admins', userCredential.user.uid));
            const adminData = adminDoc.data();

            if (adminData?.twoFactorEnabled) {
                setShow2FA(true);
                setLoading(false);
            } else {
                navigate('/admin/pricing');
            }
        } catch (err) {
            console.error('Login error:', err);
            setError('Invalid credentials. Please try again.');
            setLoading(false);
        }
    };

    const handleVerify2FA = async (e) => {
        e.preventDefault();
        setError('');
        setBackupWarning('');
        setLoading(true);

        const codeToVerify = useBackupCode ? backupCode.trim() : tfaCode.trim();

        if (!codeToVerify) {
            setError(useBackupCode ? 'Please enter a backup code.' : 'Please enter the 6-digit code.');
            setLoading(false);
            return;
        }

        try {
            const verifyFn = httpsCallable(adminFunctions, 'verifyAdmin2FACode');
            const result = await verifyFn({ code: codeToVerify });

            if (result.data.method === 'backup' && result.data.remainingBackupCodes <= 2) {
                setBackupWarning(`You only have ${result.data.remainingBackupCodes} backup code${result.data.remainingBackupCodes === 1 ? '' : 's'} left. Go to Settings to generate new ones.`);
                // Brief delay so user can see the warning before navigating
                setTimeout(() => navigate('/admin/pricing'), 2500);
            } else {
                navigate('/admin/pricing');
            }
        } catch (err) {
            console.error('2FA verification error:', err);
            if (err.message?.includes('Invalid or already used backup')) {
                setError('That backup code is invalid or has already been used. Please try another one.');
            } else if (err.message?.includes('Incorrect code')) {
                setError('Incorrect code. Please check your authenticator app and try again.');
            } else {
                setError('Verification failed. Please try again.');
            }
            setLoading(false);
        }
    };

    const handleCancel2FA = async () => {
        await adminAuth.signOut();
        setShow2FA(false);
        setTfaCode('');
        setBackupCode('');
        setUseBackupCode(false);
        setError('');
        setBackupWarning('');
    };

    // 2FA Verification Screen
    if (show2FA) {
        return (
            <div className="admin-login-page">
                <div className="admin-login-container">
                    <div className="admin-login-header">
                        <img src="/koda-carte-logo.png" alt="Koda Carte" className="admin-login-logo" />
                        <h1 className="admin-login-title">Two-Factor Authentication</h1>
                        <p className="admin-login-subtitle">
                            {useBackupCode
                                ? 'Enter one of your backup codes'
                                : 'Enter the code from your authenticator app'
                            }
                        </p>
                    </div>

                    <form className="admin-login-form" onSubmit={handleVerify2FA}>
                        {error && (
                            <div className="admin-login-error">
                                {error}
                            </div>
                        )}

                        {backupWarning && (
                            <div className="tfa-login-warning">
                                {backupWarning}
                            </div>
                        )}

                        {!useBackupCode ? (
                            <div className="tfa-login-code-section">
                                <p className="tfa-login-instruction">
                                    Open your authenticator app and find the entry for <strong>Koda Carte Admin</strong>. Enter the 6-digit code shown below.
                                </p>
                                <input
                                    type="text"
                                    className="tfa-login-code-input"
                                    value={tfaCode}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                        setTfaCode(val);
                                    }}
                                    placeholder="000000"
                                    maxLength={6}
                                    autoFocus
                                    autoComplete="one-time-code"
                                />
                            </div>
                        ) : (
                            <div className="tfa-login-code-section">
                                <p className="tfa-login-instruction">
                                    Enter one of the backup codes you saved when you set up 2FA. Each code can only be used once.
                                </p>
                                <input
                                    type="text"
                                    className="tfa-login-backup-input"
                                    value={backupCode}
                                    onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                                    placeholder="XXXX-XXXX"
                                    maxLength={9}
                                    autoFocus
                                />
                            </div>
                        )}

                        <button
                            type="submit"
                            className="admin-btn admin-btn-primary admin-login-btn"
                            disabled={loading || (!useBackupCode && tfaCode.length !== 6) || (useBackupCode && backupCode.length < 9)}
                        >
                            {loading ? 'Verifying...' : 'Verify & Sign In'}
                        </button>
                    </form>

                    <div className="tfa-login-footer">
                        <button
                            className="tfa-login-toggle"
                            onClick={() => {
                                setUseBackupCode(!useBackupCode);
                                setError('');
                            }}
                        >
                            {useBackupCode
                                ? 'Use authenticator app instead'
                                : "Lost your phone? Use a backup code"
                            }
                        </button>
                        <button className="tfa-login-cancel" onClick={handleCancel2FA}>
                            Cancel sign in
                        </button>
                    </div>
                </div>

                <style jsx>{`
                    .tfa-login-code-section {
                        text-align: center;
                        margin-bottom: 1.5rem;
                    }

                    .tfa-login-instruction {
                        color: var(--admin-text-secondary);
                        font-size: 0.9rem;
                        line-height: 1.6;
                        margin: 0 0 1.25rem;
                        text-align: left;
                    }

                    .tfa-login-code-input {
                        width: 100%;
                        font-size: 2rem;
                        font-weight: 700;
                        letter-spacing: 12px;
                        text-align: center;
                        padding: 0.75rem 1rem;
                        background: var(--admin-bg);
                        border: 2px solid var(--admin-border);
                        border-radius: var(--admin-radius-sm);
                        color: var(--admin-text-primary);
                        outline: none;
                        transition: var(--admin-transition);
                        font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
                    }

                    .tfa-login-code-input:focus {
                        border-color: var(--admin-accent-primary);
                        box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
                    }

                    .tfa-login-code-input::placeholder {
                        letter-spacing: 12px;
                        color: var(--admin-text-muted);
                    }

                    .tfa-login-backup-input {
                        width: 100%;
                        font-size: 1.5rem;
                        font-weight: 700;
                        letter-spacing: 4px;
                        text-align: center;
                        padding: 0.75rem 1rem;
                        background: var(--admin-bg);
                        border: 2px solid var(--admin-border);
                        border-radius: var(--admin-radius-sm);
                        color: var(--admin-text-primary);
                        outline: none;
                        transition: var(--admin-transition);
                        font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
                    }

                    .tfa-login-backup-input:focus {
                        border-color: var(--admin-accent-primary);
                        box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
                    }

                    .tfa-login-backup-input::placeholder {
                        letter-spacing: 4px;
                        color: var(--admin-text-muted);
                    }

                    .tfa-login-warning {
                        background: rgba(251, 191, 36, 0.15);
                        border: 1px solid rgba(251, 191, 36, 0.3);
                        color: var(--admin-yellow);
                        padding: 0.75rem 1rem;
                        border-radius: var(--admin-radius-sm);
                        margin-bottom: 1rem;
                        font-size: 0.85rem;
                        line-height: 1.5;
                    }

                    .tfa-login-footer {
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        gap: 0.5rem;
                    }

                    .tfa-login-toggle {
                        background: none;
                        border: none;
                        color: var(--admin-accent-primary);
                        cursor: pointer;
                        font-size: 0.85rem;
                        padding: 0.5rem;
                        transition: var(--admin-transition);
                    }

                    .tfa-login-toggle:hover {
                        text-decoration: underline;
                    }

                    .tfa-login-cancel {
                        background: none;
                        border: none;
                        color: var(--admin-text-muted);
                        cursor: pointer;
                        font-size: 0.85rem;
                        padding: 0.25rem;
                        transition: var(--admin-transition);
                    }

                    .tfa-login-cancel:hover {
                        color: var(--admin-text-secondary);
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div className="admin-login-page">
            <div className="admin-login-container">
                <div className="admin-login-header">
                    <img src="/koda-carte-logo.png" alt="Koda Carte" className="admin-login-logo" />
                    <h1 className="admin-login-title">Admin Portal</h1>
                    <p className="admin-login-subtitle">Sign in to manage your platform</p>
                </div>

                <form className="admin-login-form" onSubmit={handleSubmit}>
                    {error && (
                        <div className="admin-login-error">
                            {error}
                        </div>
                    )}

                    <div className="admin-form-group">
                        <label className="admin-label">Email Address</label>
                        <div className="admin-input-with-icon">
                            <span className="admin-input-icon">&#x1F4E7;</span>
                            <input
                                type="email"
                                className="admin-input"
                                placeholder="admin@kodacarte.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="admin-form-group">
                        <label className="admin-label">Password</label>
                        <div className="admin-input-with-icon">
                            <span className="admin-input-icon">&#x1F512;</span>
                            <input
                                type="password"
                                className="admin-input"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="admin-btn admin-btn-primary admin-login-btn"
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="admin-login-footer">
                    <a href="/" className="admin-login-back">&larr; Back to Website</a>
                </div>
            </div>

            <style jsx>{`
        .admin-login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--admin-bg);
          padding: 2rem;
        }

        .admin-login-container {
          width: 100%;
          max-width: 420px;
          background: var(--admin-bg-secondary);
          border: 1px solid var(--admin-glass-border);
          border-radius: var(--admin-radius);
          padding: 2.5rem;
          box-shadow: var(--admin-shadow);
        }

        .admin-login-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .admin-login-logo {
          width: 80px;
          height: 80px;
          border-radius: 20px;
          margin-bottom: 1.5rem;
        }

        .admin-login-title {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 0.5rem;
          background: var(--admin-accent-gradient);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .admin-login-subtitle {
          color: var(--admin-text-muted);
          margin: 0;
        }

        .admin-login-form {
          margin-bottom: 1.5rem;
        }

        .admin-login-error {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: var(--admin-red);
          padding: 0.75rem 1rem;
          border-radius: var(--admin-radius-sm);
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }

        .admin-login-btn {
          width: 100%;
          padding: 1rem;
          font-size: 1rem;
        }

        .admin-login-footer {
          text-align: center;
        }

        .admin-login-back {
          color: var(--admin-text-muted);
          text-decoration: none;
          font-size: 0.9rem;
          transition: var(--admin-transition);
        }

        .admin-login-back:hover {
          color: var(--admin-text-primary);
        }
      `}</style>
        </div>
    );
};

export default AdminLogin;
