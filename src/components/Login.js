import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApiBaseUrl } from '../config';
import { auth, db } from '../firebase';
import { Container, Card, Form, Button, Alert } from 'react-bootstrap';
import PasswordInput from './PasswordInput';
import 'bootstrap/dist/css/bootstrap.min.css';
import './Login.css';

const Login = () => {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [tfaCode, setTfaCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [backupWarning, setBackupWarning] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const navigate = useNavigate();
  const functions = getFunctions();

  // Helper function to check if input is an email
  const isEmail = (str) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  };

  // Look up email by username using Cloud Function (checks restaurant owners + staff)
  const getEmailByUsername = async (username) => {
    try {
      const baseUrl = getApiBaseUrl();

      // Try owner lookup first
      const ownerResponse = await fetch(`${baseUrl}/lookupEmailByUsername`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (ownerResponse.ok) {
        const data = await ownerResponse.json();
        return data.email;
      }

      // Try staff lookup
      const staffResponse = await fetch(`${baseUrl}/lookupStaffEmail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (staffResponse.ok) {
        const data = await staffResponse.json();
        return data.email;
      }

      return null;
    } catch (error) {
      console.error('Error looking up username:', error);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);

      let email = usernameOrEmail;

      // If input is not an email, try to look it up as username
      if (!isEmail(usernameOrEmail)) {
        const foundEmail = await getEmailByUsername(usernameOrEmail);
        if (!foundEmail) {
          setError('Username or email not found');
          setLoading(false);
          return;
        }
        email = foundEmail;
      }

      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      // Check if this is a staff user via custom claims
      const tokenResult = await userCredential.user.getIdTokenResult();
      if (tokenResult.claims.isStaff) {
        // Staff users go straight to home (permissions enforced by Layout)
        navigate('/home');
        return;
      }

      // Check if 2FA is enabled for this restaurant user
      const restaurantDoc = await getDoc(doc(db, 'restaurants', userCredential.user.uid));
      if (restaurantDoc.exists() && restaurantDoc.data().twoFactorEnabled) {
        setShow2FA(true);
        setLoading(false);
        return;
      }

      navigate('/home');
    } catch (error) {
      const friendlyErrors = {
        'auth/user-not-found': 'No account found with that email or username.',
        'auth/wrong-password': 'Incorrect password. Please try again.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/invalid-login-credentials': 'Invalid email/username or password. Please try again.',
        'auth/invalid-credential': 'Invalid email/username or password. Please try again.',
        'auth/too-many-requests': 'Too many failed attempts. Please wait a moment and try again.',
        'auth/user-disabled': 'This account has been disabled. Please contact support.',
        'auth/network-request-failed': 'Network error. Please check your connection and try again.',
      };
      setError(friendlyErrors[error.code] || 'Unable to sign in. Please try again.');
    }
    setLoading(false);
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
      const verifyFn = httpsCallable(functions, 'verifyRestaurant2FACode');
      const result = await verifyFn({ code: codeToVerify });

      if (result.data.method === 'backup' && result.data.remainingBackupCodes <= 2) {
        setBackupWarning(`You only have ${result.data.remainingBackupCodes} backup code${result.data.remainingBackupCodes === 1 ? '' : 's'} left. Go to Account > Security to generate new ones.`);
        setTimeout(() => navigate('/home'), 2500);
      } else {
        navigate('/home');
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

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail.trim()) {
      setError('Please enter your email address.');
      return;
    }
    try {
      setResetLoading(true);
      setError('');
      await sendPasswordResetEmail(auth, resetEmail);
      setResetSent(true);
    } catch (error) {
      const friendlyErrors = {
        'auth/user-not-found': 'No account found with that email address.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many requests. Please wait a moment and try again.',
      };
      setError(friendlyErrors[error.code] || 'Unable to send reset email. Please try again.');
    }
    setResetLoading(false);
  };

  const handleCancel2FA = async () => {
    await auth.signOut();
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
      <div className="auth-page">
        <div className="auth-background"></div>
        <Container className="auth-container">
          <div className="auth-card-wrapper">
            <Card className="auth-card">
              <div className="auth-card-header">
                <div className="auth-logo">
                  <img src="/koda-carte-logo.png" alt="Koda Carte" style={{ height: '48px', width: 'auto' }} onError={(e) => { e.target.style.display = 'none'; }} />
                  <span className="auth-brand-name">Koda Carte</span>
                </div>
                <h2>Two-Factor Authentication</h2>
                <p>{useBackupCode ? 'Enter one of your backup codes' : 'Enter the code from your authenticator app'}</p>
              </div>
              <Card.Body className="auth-card-body">
                {error && <Alert variant="danger" className="auth-alert">{error}</Alert>}
                {backupWarning && (
                  <Alert variant="warning" className="auth-alert">{backupWarning}</Alert>
                )}
                <Form onSubmit={handleVerify2FA}>
                  {!useBackupCode ? (
                    <div className="mb-3">
                      <p className="text-muted small mb-3">
                        Open your authenticator app and find the entry for <strong>Koda Carte</strong>. Enter the 6-digit code shown.
                      </p>
                      <Form.Control
                        type="text"
                        className="auth-input text-center"
                        value={tfaCode}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setTfaCode(val);
                        }}
                        placeholder="000000"
                        maxLength={6}
                        autoFocus
                        autoComplete="one-time-code"
                        style={{ fontSize: '1.5rem', fontWeight: '700', letterSpacing: '8px', fontFamily: 'monospace' }}
                      />
                    </div>
                  ) : (
                    <div className="mb-3">
                      <p className="text-muted small mb-3">
                        Enter one of the backup codes you saved when you set up 2FA. Each code can only be used once.
                      </p>
                      <Form.Control
                        type="text"
                        className="auth-input text-center"
                        value={backupCode}
                        onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                        placeholder="XXXX-XXXX"
                        maxLength={9}
                        autoFocus
                        style={{ fontSize: '1.3rem', fontWeight: '700', letterSpacing: '4px', fontFamily: 'monospace' }}
                      />
                    </div>
                  )}

                  <Button
                    disabled={loading || (!useBackupCode && tfaCode.length !== 6) || (useBackupCode && backupCode.length < 9)}
                    className="auth-button w-100"
                    type="submit"
                  >
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </Button>
                </Form>

                <div className="text-center mt-3">
                  <button
                    className="btn btn-link text-decoration-none"
                    style={{ fontSize: '0.85rem' }}
                    onClick={() => {
                      setUseBackupCode(!useBackupCode);
                      setError('');
                    }}
                  >
                    {useBackupCode ? 'Use authenticator app instead' : "Lost your phone? Use a backup code"}
                  </button>
                  <br />
                  <button
                    className="btn btn-link text-muted text-decoration-none"
                    style={{ fontSize: '0.8rem' }}
                    onClick={handleCancel2FA}
                  >
                    Cancel sign in
                  </button>
                </div>
              </Card.Body>
            </Card>
          </div>
        </Container>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-background"></div>
      <Container className="auth-container">
        <div className="auth-card-wrapper">
          <Card className="auth-card">
            <div className="auth-card-header">
              <div className="auth-logo">
                <img src="/koda-carte-logo.png" alt="Koda Carte" style={{ height: '48px', width: 'auto' }} onError={(e) => { e.target.style.display = 'none'; }} />
                <span className="auth-brand-name">Koda Carte</span>
              </div>
              <h2>Welcome Back</h2>
              <p>Sign in to Koda Carte</p>
            </div>
            <Card.Body className="auth-card-body">
              {error && <Alert variant="danger" className="auth-alert">{error}</Alert>}

              {showForgotPassword ? (
                /* Forgot Password Form */
                resetSent ? (
                  <div className="text-center" style={{ padding: '20px 0' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📧</div>
                    <h5 style={{ marginBottom: '12px' }}>Check Your Email</h5>
                    <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '20px' }}>
                      We've sent a password reset link to <strong>{resetEmail}</strong>. Check your inbox and follow the instructions.
                    </p>
                    <Button
                      className="auth-button w-100"
                      onClick={() => { setShowForgotPassword(false); setResetSent(false); setResetEmail(''); setError(''); }}
                    >
                      Back to Login
                    </Button>
                  </div>
                ) : (
                  <Form onSubmit={handleForgotPassword}>
                    <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '16px' }}>
                      Enter your email address and we'll send you a link to reset your password.
                    </p>
                    <Form.Group className="mb-3">
                      <Form.Label>Email Address</Form.Label>
                      <Form.Control
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        required
                        className="auth-input"
                        placeholder="your@email.com"
                        autoFocus
                      />
                    </Form.Group>
                    <Button
                      disabled={resetLoading}
                      className="auth-button w-100"
                      type="submit"
                    >
                      {resetLoading ? 'Sending...' : 'Send Reset Link'}
                    </Button>
                    <div className="text-center mt-3">
                      <button
                        type="button"
                        className="btn btn-link text-decoration-none"
                        style={{ fontSize: '0.85rem' }}
                        onClick={() => { setShowForgotPassword(false); setError(''); }}
                      >
                        ← Back to Login
                      </button>
                    </div>
                  </Form>
                )
              ) : (
                /* Normal Login Form */
                <Form onSubmit={handleSubmit}>
                  <Form.Group className="mb-3">
                    <Form.Label>Username or Email</Form.Label>
                    <Form.Control
                      type="text"
                      value={usernameOrEmail}
                      onChange={(e) => setUsernameOrEmail(e.target.value)}
                      required
                      className="auth-input"
                      placeholder="Enter your username or email"
                    />
                    <Form.Text className="text-muted">
                      You can login with either your username or email address
                    </Form.Text>
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Password</Form.Label>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="auth-input"
                    />
                  </Form.Group>
                  <div className="text-end mb-3">
                    <button
                      type="button"
                      className="btn btn-link p-0 text-decoration-none"
                      style={{ fontSize: '0.85rem', color: '#40e0d0' }}
                      onClick={() => { setShowForgotPassword(true); setError(''); setResetEmail(usernameOrEmail.includes('@') ? usernameOrEmail : ''); }}
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <Button
                    disabled={loading}
                    className="auth-button w-100"
                    type="submit"
                  >
                    {loading ? 'Signing in...' : 'Log In'}
                  </Button>
                </Form>
              )}
            </Card.Body>
            <Card.Footer className="auth-card-footer">
              <div className="text-center">
                Don't have an account? <Link to="/signup" className="auth-link">Sign Up</Link>
              </div>
            </Card.Footer>
          </Card>
        </div>
      </Container>
    </div>
  );
};

export default Login;
