import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

const TwoFactorSetup = ({ onComplete, onCancel, showToast, setupFnName = 'setupAdmin2FA', verifyFnName = 'verifyAndEnable2FA', functionsInstance }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [manualEntryKey, setManualEntryKey] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [backupCodes, setBackupCodes] = useState([]);
    const [backupCodesCopied, setBackupCodesCopied] = useState(false);
    const [showManualKey, setShowManualKey] = useState(false);

    const totalSteps = 5;
    const functions = functionsInstance || getFunctions();

    const handleStartSetup = async () => {
        setLoading(true);
        try {
            const setupFn = httpsCallable(functions, setupFnName);
            const result = await setupFn();
            setQrCodeDataUrl(result.data.qrCodeDataUrl);
            setManualEntryKey(result.data.manualEntryKey);
            setStep(3);
        } catch (error) {
            console.error('2FA setup error:', error);
            showToast('Failed to start 2FA setup. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyCode = async () => {
        if (verificationCode.length !== 6) {
            showToast('Please enter the full 6-digit code.', 'error');
            return;
        }

        setLoading(true);
        try {
            const verifyFn = httpsCallable(functions, verifyFnName);
            const result = await verifyFn({ code: verificationCode });
            setBackupCodes(result.data.backupCodes);
            setStep(5);
        } catch (error) {
            console.error('2FA verification error:', error);
            const message = error.message?.includes('Incorrect code')
                ? 'That code didn\'t match. Make sure you\'re looking at the code for "Koda Carte Admin" in your authenticator app, and that it hasn\'t expired.'
                : error.message?.includes('expired')
                    ? 'The setup session has expired. Please start again.'
                    : 'Verification failed. Please try again.';
            showToast(message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCopyBackupCodes = () => {
        const codesText = backupCodes.join('\n');
        navigator.clipboard.writeText(codesText).then(() => {
            setBackupCodesCopied(true);
            showToast('Backup codes copied to clipboard!', 'success');
        }).catch(() => {
            showToast('Could not copy. Please write them down manually.', 'error');
        });
    };

    const handleDownloadBackupCodes = () => {
        const content = `KODA CARTE ADMIN — 2FA BACKUP CODES
========================================
Generated: ${new Date().toLocaleDateString()}

These are one-time use emergency codes.
Keep them somewhere safe. Each code can
only be used once.

${backupCodes.map((code, i) => `${i + 1}. ${code}`).join('\n')}

If you run out of codes, you can generate
new ones from Admin Settings > Security.
========================================`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'koda-carte-backup-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleFinish = () => {
        onComplete();
    };

    const renderProgressBar = () => (
        <div className="tfa-progress">
            {[1, 2, 3, 4, 5].map(s => (
                <div key={s} className={`tfa-progress-step ${s <= step ? 'active' : ''} ${s === step ? 'current' : ''}`}>
                    <div className="tfa-progress-dot">{s < step ? '\u2713' : s}</div>
                    <span className="tfa-progress-label">
                        {s === 1 && 'Why 2FA'}
                        {s === 2 && 'Get App'}
                        {s === 3 && 'Scan Code'}
                        {s === 4 && 'Verify'}
                        {s === 5 && 'Backup'}
                    </span>
                </div>
            ))}
        </div>
    );

    return (
        <div className="tfa-overlay">
            <div className="tfa-modal">
                <button className="tfa-close" onClick={onCancel} title="Cancel setup">&times;</button>

                {renderProgressBar()}

                {/* STEP 1: Why 2FA */}
                {step === 1 && (
                    <div className="tfa-step">
                        <div className="tfa-step-icon">&#x1F6E1;&#xFE0F;</div>
                        <h2 className="tfa-step-title">Protect Your Restaurant's Data</h2>

                        <div className="tfa-explanation">
                            <p className="tfa-text-large">
                                Two-factor authentication (2FA) adds an extra layer of security to your admin account.
                            </p>

                            <div className="tfa-info-cards">
                                <div className="tfa-info-card">
                                    <span className="tfa-info-icon">&#x1F512;</span>
                                    <div>
                                        <strong>What is it?</strong>
                                        <p>After entering your password, you'll also enter a short code from your phone. This means even if someone guesses your password, they still can't get in.</p>
                                    </div>
                                </div>

                                <div className="tfa-info-card">
                                    <span className="tfa-info-icon">&#x23F1;&#xFE0F;</span>
                                    <div>
                                        <strong>How long does it take?</strong>
                                        <p>Setup takes about 2 minutes. After that, logging in adds just 5 seconds — open your app, type the code, done.</p>
                                    </div>
                                </div>

                                <div className="tfa-info-card">
                                    <span className="tfa-info-icon">&#x1F4B0;</span>
                                    <div>
                                        <strong>Why does it matter?</strong>
                                        <p>Your admin account controls your restaurant's menu, orders, payments, and customer data. This keeps all of that safe.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="tfa-actions">
                            <button className="admin-btn admin-btn-secondary" onClick={onCancel}>
                                Maybe Later
                            </button>
                            <button className="admin-btn admin-btn-primary" onClick={() => setStep(2)}>
                                Let's Set It Up &rarr;
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 2: Download Authenticator App */}
                {step === 2 && (
                    <div className="tfa-step">
                        <div className="tfa-step-icon">&#x1F4F1;</div>
                        <h2 className="tfa-step-title">Get an Authenticator App</h2>

                        <div className="tfa-explanation">
                            <p className="tfa-text-large">
                                You'll need a free authenticator app on your phone. It generates a new 6-digit code every 30 seconds. Here are the most popular options:
                            </p>

                            <div className="tfa-app-options">
                                <div className="tfa-app-card">
                                    <div className="tfa-app-header">
                                        <span className="tfa-app-logo">G</span>
                                        <div>
                                            <strong>Google Authenticator</strong>
                                            <span className="tfa-app-badge">Recommended</span>
                                        </div>
                                    </div>
                                    <p>Simple and straightforward. Made by Google.</p>
                                    <div className="tfa-app-links">
                                        <a href="https://apps.apple.com/app/google-authenticator/id388497605" target="_blank" rel="noopener noreferrer" className="tfa-store-link">
                                            &#x1F34E; App Store (iPhone)
                                        </a>
                                        <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" target="_blank" rel="noopener noreferrer" className="tfa-store-link">
                                            &#x1F4F1; Play Store (Android)
                                        </a>
                                    </div>
                                </div>

                                <div className="tfa-app-card">
                                    <div className="tfa-app-header">
                                        <span className="tfa-app-logo" style={{ background: 'linear-gradient(135deg, #ec3750, #ff6b6b)' }}>A</span>
                                        <div>
                                            <strong>Authy</strong>
                                            <span className="tfa-app-badge alt">Multi-device</span>
                                        </div>
                                    </div>
                                    <p>Syncs across multiple devices. Great if you have more than one phone or tablet.</p>
                                    <div className="tfa-app-links">
                                        <a href="https://apps.apple.com/app/authy/id494168017" target="_blank" rel="noopener noreferrer" className="tfa-store-link">
                                            &#x1F34E; App Store (iPhone)
                                        </a>
                                        <a href="https://play.google.com/store/apps/details?id=com.authy.authy" target="_blank" rel="noopener noreferrer" className="tfa-store-link">
                                            &#x1F4F1; Play Store (Android)
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div className="tfa-tip">
                                <strong>&#x1F4A1; Tip:</strong> If you already have an authenticator app installed (like for your bank or email), you can use that same app — no need to download a new one. Just look for a "+" or "Add account" button inside your existing app.
                            </div>
                        </div>

                        <div className="tfa-actions">
                            <button className="admin-btn admin-btn-secondary" onClick={() => setStep(1)}>
                                &larr; Back
                            </button>
                            <button
                                className="admin-btn admin-btn-primary"
                                onClick={handleStartSetup}
                                disabled={loading}
                            >
                                {loading ? 'Preparing...' : 'I Have the App \u2192'}
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: Scan QR Code */}
                {step === 3 && (
                    <div className="tfa-step">
                        <div className="tfa-step-icon">&#x1F4F7;</div>
                        <h2 className="tfa-step-title">Link Your Authenticator App</h2>

                        <div className="tfa-explanation">
                            <div className="tfa-instructions-box">
                                <h3>Follow these 3 steps:</h3>
                                <ol className="tfa-steps-list">
                                    <li>
                                        <strong>Open</strong> your authenticator app on your phone
                                    </li>
                                    <li>
                                        <strong>Tap the "+" button</strong> (usually at the bottom or top right corner)
                                    </li>
                                    <li>
                                        <strong>Point your camera</strong> at the code below
                                    </li>
                                </ol>
                            </div>

                            <div className="tfa-qr-container">
                                {qrCodeDataUrl ? (
                                    <img src={qrCodeDataUrl} alt="QR Code for authenticator setup" className="tfa-qr-code" />
                                ) : (
                                    <div className="tfa-qr-loading">Loading QR code...</div>
                                )}
                                <p className="tfa-qr-label">Scan this with your authenticator app</p>
                            </div>

                            <div className="tfa-manual-entry">
                                <button
                                    className="tfa-manual-toggle"
                                    onClick={() => setShowManualKey(!showManualKey)}
                                >
                                    {showManualKey ? 'Hide manual key' : "Can't scan? Enter the code manually instead"}
                                </button>
                                {showManualKey && (
                                    <div className="tfa-manual-key-box">
                                        <p>In your authenticator app, choose "Enter manually" or "Enter a setup key", then type this code:</p>
                                        <div className="tfa-manual-key">{manualEntryKey}</div>
                                        <p className="tfa-manual-note">
                                            Account name: <strong>Koda Carte Admin</strong><br />
                                            Key type: <strong>Time-based (TOTP)</strong>
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="tfa-actions">
                            <button className="admin-btn admin-btn-secondary" onClick={() => setStep(2)}>
                                &larr; Back
                            </button>
                            <button className="admin-btn admin-btn-primary" onClick={() => setStep(4)}>
                                I've Scanned It &rarr;
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 4: Verify Code */}
                {step === 4 && (
                    <div className="tfa-step">
                        <div className="tfa-step-icon">&#x2705;</div>
                        <h2 className="tfa-step-title">Verify It's Working</h2>

                        <div className="tfa-explanation">
                            <p className="tfa-text-large">
                                Your authenticator app should now be showing a <strong>6-digit code</strong> that changes every 30 seconds. Enter the current code below to confirm everything is set up correctly.
                            </p>

                            <div className="tfa-verify-container">
                                <label className="tfa-verify-label">Enter the 6-digit code from your app:</label>
                                <input
                                    type="text"
                                    className="tfa-code-input"
                                    value={verificationCode}
                                    onChange={(e) => {
                                        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                        setVerificationCode(val);
                                    }}
                                    placeholder="000000"
                                    maxLength={6}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && verificationCode.length === 6) {
                                            handleVerifyCode();
                                        }
                                    }}
                                />
                                <p className="tfa-verify-hint">
                                    Look for "Koda Carte Admin" in your authenticator app. The code refreshes every 30 seconds — if it's about to change, wait for the new one.
                                </p>
                            </div>
                        </div>

                        <div className="tfa-actions">
                            <button className="admin-btn admin-btn-secondary" onClick={() => setStep(3)}>
                                &larr; Back
                            </button>
                            <button
                                className="admin-btn admin-btn-primary"
                                onClick={handleVerifyCode}
                                disabled={loading || verificationCode.length !== 6}
                            >
                                {loading ? 'Verifying...' : 'Verify & Activate'}
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 5: Backup Codes */}
                {step === 5 && (
                    <div className="tfa-step">
                        <div className="tfa-step-icon">&#x1F389;</div>
                        <h2 className="tfa-step-title">2FA Is Now Active!</h2>

                        <div className="tfa-explanation">
                            <div className="tfa-success-banner">
                                Your account is now protected with two-factor authentication.
                            </div>

                            <div className="tfa-backup-section">
                                <h3>&#x1F6A8; Save Your Emergency Backup Codes</h3>
                                <p>
                                    If you ever lose your phone or can't access your authenticator app, you can use one of these <strong>one-time backup codes</strong> to sign in. Each code can only be used once.
                                </p>

                                <div className="tfa-backup-codes-grid">
                                    {backupCodes.map((code, index) => (
                                        <div key={index} className="tfa-backup-code">
                                            <span className="tfa-backup-code-num">{index + 1}.</span>
                                            {code}
                                        </div>
                                    ))}
                                </div>

                                <div className="tfa-backup-actions">
                                    <button className="admin-btn admin-btn-secondary" onClick={handleCopyBackupCodes}>
                                        {backupCodesCopied ? '\u2713 Copied!' : 'Copy Codes'}
                                    </button>
                                    <button className="admin-btn admin-btn-secondary" onClick={handleDownloadBackupCodes}>
                                        Download as File
                                    </button>
                                </div>

                                <div className="tfa-tip warning">
                                    <strong>Important:</strong> This is the only time these codes will be shown. Save them somewhere safe — like a password manager, a printed note in a secure location, or a locked file on your computer. If you lose both your phone and these codes, you will need to contact support to regain access.
                                </div>
                            </div>
                        </div>

                        <div className="tfa-actions">
                            <button className="admin-btn admin-btn-primary tfa-btn-finish" onClick={handleFinish}>
                                I've Saved My Codes — Done
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <style jsx>{`
                .tfa-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    padding: 1rem;
                    overflow-y: auto;
                }

                .tfa-modal {
                    background: var(--admin-bg-secondary);
                    border: 1px solid var(--admin-glass-border);
                    border-radius: var(--admin-radius);
                    max-width: 640px;
                    width: 100%;
                    max-height: 90vh;
                    overflow-y: auto;
                    padding: 2rem;
                    position: relative;
                    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
                }

                .tfa-close {
                    position: absolute;
                    top: 1rem;
                    right: 1rem;
                    background: none;
                    border: none;
                    color: var(--admin-text-muted);
                    font-size: 1.5rem;
                    cursor: pointer;
                    padding: 0.5rem;
                    line-height: 1;
                    transition: var(--admin-transition);
                }

                .tfa-close:hover {
                    color: var(--admin-text-primary);
                }

                /* Progress Bar */
                .tfa-progress {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 2rem;
                    padding: 0 1rem;
                }

                .tfa-progress-step {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.5rem;
                    flex: 1;
                    position: relative;
                }

                .tfa-progress-step:not(:last-child)::after {
                    content: '';
                    position: absolute;
                    top: 14px;
                    left: 55%;
                    width: 90%;
                    height: 2px;
                    background: var(--admin-border);
                }

                .tfa-progress-step.active:not(:last-child)::after {
                    background: var(--admin-accent-primary);
                }

                .tfa-progress-dot {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: var(--admin-bg-tertiary);
                    border: 2px solid var(--admin-border);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.75rem;
                    font-weight: 600;
                    z-index: 1;
                    transition: var(--admin-transition);
                }

                .tfa-progress-step.active .tfa-progress-dot {
                    background: var(--admin-accent-primary);
                    border-color: var(--admin-accent-primary);
                    color: #fff;
                }

                .tfa-progress-step.current .tfa-progress-dot {
                    box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.3);
                }

                .tfa-progress-label {
                    font-size: 0.7rem;
                    color: var(--admin-text-muted);
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .tfa-progress-step.active .tfa-progress-label {
                    color: var(--admin-text-secondary);
                }

                /* Step Content */
                .tfa-step {
                    text-align: center;
                }

                .tfa-step-icon {
                    font-size: 3rem;
                    margin-bottom: 1rem;
                }

                .tfa-step-title {
                    font-size: 1.5rem;
                    font-weight: 700;
                    margin: 0 0 1.5rem;
                    background: var(--admin-accent-gradient);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }

                .tfa-explanation {
                    text-align: left;
                    margin-bottom: 2rem;
                }

                .tfa-text-large {
                    font-size: 1.05rem;
                    line-height: 1.7;
                    color: var(--admin-text-secondary);
                    margin-bottom: 1.5rem;
                }

                /* Info Cards */
                .tfa-info-cards {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .tfa-info-card {
                    display: flex;
                    gap: 1rem;
                    background: var(--admin-bg-tertiary);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                }

                .tfa-info-icon {
                    font-size: 1.5rem;
                    flex-shrink: 0;
                }

                .tfa-info-card strong {
                    display: block;
                    margin-bottom: 0.25rem;
                    color: var(--admin-text-primary);
                }

                .tfa-info-card p {
                    margin: 0;
                    color: var(--admin-text-secondary);
                    font-size: 0.95rem;
                    line-height: 1.5;
                }

                /* App Options */
                .tfa-app-options {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                    margin-bottom: 1.5rem;
                }

                .tfa-app-card {
                    background: var(--admin-bg-tertiary);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                }

                .tfa-app-header {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    margin-bottom: 0.75rem;
                }

                .tfa-app-logo {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    background: linear-gradient(135deg, #4285f4, #34a853);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: 1.2rem;
                    color: #fff;
                    flex-shrink: 0;
                }

                .tfa-app-badge {
                    display: inline-block;
                    font-size: 0.65rem;
                    padding: 0.15rem 0.5rem;
                    border-radius: 999px;
                    background: rgba(168, 85, 247, 0.2);
                    color: var(--admin-accent-primary);
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-left: 0.5rem;
                }

                .tfa-app-badge.alt {
                    background: rgba(34, 211, 238, 0.15);
                    color: var(--admin-cyan);
                }

                .tfa-app-card p {
                    margin: 0 0 0.75rem;
                    color: var(--admin-text-secondary);
                    font-size: 0.9rem;
                }

                .tfa-app-links {
                    display: flex;
                    gap: 0.75rem;
                    flex-wrap: wrap;
                }

                .tfa-store-link {
                    display: inline-block;
                    padding: 0.5rem 1rem;
                    background: var(--admin-bg);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    color: var(--admin-text-secondary);
                    text-decoration: none;
                    font-size: 0.85rem;
                    transition: var(--admin-transition);
                }

                .tfa-store-link:hover {
                    border-color: var(--admin-accent-primary);
                    color: var(--admin-text-primary);
                }

                .tfa-tip {
                    background: rgba(168, 85, 247, 0.1);
                    border: 1px solid rgba(168, 85, 247, 0.25);
                    border-radius: var(--admin-radius-sm);
                    padding: 1rem 1.25rem;
                    font-size: 0.9rem;
                    color: var(--admin-text-secondary);
                    line-height: 1.5;
                }

                .tfa-tip.warning {
                    background: rgba(251, 191, 36, 0.1);
                    border-color: rgba(251, 191, 36, 0.3);
                }

                /* QR Code */
                .tfa-instructions-box {
                    background: var(--admin-bg-tertiary);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                    margin-bottom: 1.5rem;
                }

                .tfa-instructions-box h3 {
                    margin: 0 0 0.75rem;
                    font-size: 1rem;
                    color: var(--admin-text-primary);
                }

                .tfa-steps-list {
                    margin: 0;
                    padding-left: 1.5rem;
                    color: var(--admin-text-secondary);
                    line-height: 1.8;
                }

                .tfa-steps-list li {
                    margin-bottom: 0.25rem;
                }

                .tfa-qr-container {
                    text-align: center;
                    margin: 1.5rem 0;
                }

                .tfa-qr-code {
                    width: 220px;
                    height: 220px;
                    border-radius: 12px;
                    border: 4px solid #fff;
                    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
                }

                .tfa-qr-loading {
                    width: 220px;
                    height: 220px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--admin-bg-tertiary);
                    border-radius: 12px;
                    margin: 0 auto;
                    color: var(--admin-text-muted);
                }

                .tfa-qr-label {
                    margin-top: 0.75rem;
                    color: var(--admin-text-muted);
                    font-size: 0.85rem;
                }

                .tfa-manual-entry {
                    text-align: center;
                }

                .tfa-manual-toggle {
                    background: none;
                    border: none;
                    color: var(--admin-accent-primary);
                    cursor: pointer;
                    font-size: 0.9rem;
                    padding: 0.5rem;
                    transition: var(--admin-transition);
                }

                .tfa-manual-toggle:hover {
                    text-decoration: underline;
                }

                .tfa-manual-key-box {
                    background: var(--admin-bg-tertiary);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    padding: 1.25rem;
                    margin-top: 1rem;
                    text-align: left;
                }

                .tfa-manual-key-box p {
                    margin: 0 0 0.75rem;
                    color: var(--admin-text-secondary);
                    font-size: 0.9rem;
                }

                .tfa-manual-key {
                    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
                    font-size: 1.3rem;
                    font-weight: 700;
                    letter-spacing: 3px;
                    color: var(--admin-accent-primary);
                    background: var(--admin-bg);
                    padding: 0.75rem 1rem;
                    border-radius: var(--admin-radius-sm);
                    text-align: center;
                    word-break: break-all;
                    margin-bottom: 0.75rem;
                }

                .tfa-manual-note {
                    font-size: 0.85rem;
                    color: var(--admin-text-muted);
                    margin: 0;
                }

                /* Verification */
                .tfa-verify-container {
                    text-align: center;
                    margin: 1.5rem 0;
                }

                .tfa-verify-label {
                    display: block;
                    font-size: 1rem;
                    color: var(--admin-text-secondary);
                    margin-bottom: 1rem;
                }

                .tfa-code-input {
                    width: 240px;
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

                .tfa-code-input:focus {
                    border-color: var(--admin-accent-primary);
                    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2);
                }

                .tfa-code-input::placeholder {
                    color: var(--admin-text-muted);
                    letter-spacing: 12px;
                }

                .tfa-verify-hint {
                    margin-top: 1rem;
                    font-size: 0.85rem;
                    color: var(--admin-text-muted);
                    line-height: 1.5;
                }

                /* Success / Backup Codes */
                .tfa-success-banner {
                    background: rgba(34, 197, 94, 0.15);
                    border: 1px solid rgba(34, 197, 94, 0.3);
                    color: var(--admin-green);
                    padding: 1rem 1.5rem;
                    border-radius: var(--admin-radius-sm);
                    font-weight: 600;
                    font-size: 1rem;
                    text-align: center;
                    margin-bottom: 1.5rem;
                }

                .tfa-backup-section h3 {
                    margin: 0 0 0.5rem;
                    font-size: 1.1rem;
                    color: var(--admin-text-primary);
                }

                .tfa-backup-section > p {
                    color: var(--admin-text-secondary);
                    font-size: 0.95rem;
                    line-height: 1.5;
                    margin: 0 0 1.25rem;
                }

                .tfa-backup-codes-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 0.5rem;
                    margin-bottom: 1.25rem;
                }

                .tfa-backup-code {
                    font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
                    font-size: 1rem;
                    font-weight: 600;
                    padding: 0.6rem 1rem;
                    background: var(--admin-bg);
                    border: 1px solid var(--admin-border);
                    border-radius: var(--admin-radius-sm);
                    color: var(--admin-text-primary);
                }

                .tfa-backup-code-num {
                    color: var(--admin-text-muted);
                    margin-right: 0.5rem;
                    font-size: 0.8rem;
                }

                .tfa-backup-actions {
                    display: flex;
                    gap: 0.75rem;
                    margin-bottom: 1.25rem;
                }

                /* Actions */
                .tfa-actions {
                    display: flex;
                    justify-content: space-between;
                    gap: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid var(--admin-border);
                }

                .tfa-btn-finish {
                    width: 100%;
                }

                /* Responsive */
                @media (max-width: 640px) {
                    .tfa-modal {
                        padding: 1.5rem;
                        max-height: 95vh;
                    }

                    .tfa-progress-label {
                        display: none;
                    }

                    .tfa-app-links {
                        flex-direction: column;
                    }

                    .tfa-backup-codes-grid {
                        grid-template-columns: 1fr;
                    }

                    .tfa-backup-actions {
                        flex-direction: column;
                    }

                    .tfa-code-input {
                        width: 100%;
                    }
                }
            `}</style>
        </div>
    );
};

export default TwoFactorSetup;
