import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../firebase';
import { checkIsAdmin } from '../../services/adminConfigService';
import './AdminDashboard.css';

const AdminLogin = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const isAdmin = await checkIsAdmin(userCredential.user.uid);

            if (isAdmin) {
                navigate('/admin/pricing');
            } else {
                setError('You do not have admin access.');
                await auth.signOut();
            }
        } catch (err) {
            console.error('Login error:', err);
            setError('Invalid credentials. Please try again.');
        } finally {
            setLoading(false);
        }
    };

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
                            ⚠️ {error}
                        </div>
                    )}

                    <div className="admin-form-group">
                        <label className="admin-label">Email Address</label>
                        <div className="admin-input-with-icon">
                            <span className="admin-input-icon">📧</span>
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
                            <span className="admin-input-icon">🔒</span>
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
                        {loading ? '⏳ Signing in...' : '🚀 Sign In'}
                    </button>
                </form>

                <div className="admin-login-footer">
                    <a href="/" className="admin-login-back">← Back to Website</a>
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
