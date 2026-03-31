import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, collection, addDoc, deleteDoc, getDocs, setDoc } from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider, signOut } from 'firebase/auth';
import { db, auth } from '../firebase';
import lanSyncService from '../services/lanSyncService';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { useSubscription, TIER_FEATURES, PRICING, BILLING_MULTIPLIERS, ORDER_LIMITS } from '../contexts/SubscriptionContext';
import { useNavigate } from 'react-router-dom';
import { Container, Card, Form, Button, Alert, Spinner, Modal, Table, Badge, ProgressBar } from 'react-bootstrap';
import AddressAutocomplete from './AddressAutocomplete';
import PasswordInput from './PasswordInput';
import activityService from '../services/activityService';
import { getUsageStats } from '../services/orderUsageService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import TwoFactorSetup from './admin/TwoFactorSetup';
import AccessControl from './AccessControl';
import {
  getTerminalConfig,
  createTerminalLocation,
  registerReader,
  listReaders,
  deleteReader,
  createSimulatedReader,
  getReaderConnectionType
} from '../services/terminalService';
import './Account.css';

const Account = () => {
  const { currentUser } = useAuth();
  const { isMultiLocation, locations, loadRestaurantData } = useLocation();
  const { subscription, getCurrentTier, canUpgrade, getNextTier, calculatePrice } = useSubscription();
  const navigate = useNavigate();
  const [restaurantData, setRestaurantData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Account details
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [address, setAddress] = useState('');
  const [taxRate, setTaxRate] = useState(8); // Default 8%

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Reimbursement PIN
  const [showPinForm, setShowPinForm] = useState(false);
  const [pinPassword, setPinPassword] = useState('');
  const [reimbursementPin, setReimbursementPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [hasPin, setHasPin] = useState(false);

  // Location management
  const [locationList, setLocationList] = useState([]);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [locationForm, setLocationForm] = useState({ name: '', address: '' });

  // Service mode
  const [serviceMode, setServiceMode] = useState('full_service');

  // Sidebar navigation
  const [activeSection, setActiveSection] = useState('account');

  // Plan change modal state
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState(null);

  // Order usage tracking
  const [usageStats, setUsageStats] = useState(null);
  const [usageLoading, setUsageLoading] = useState(true);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [showTfaSetup, setShowTfaSetup] = useState(false);
  const [showTfaDisable, setShowTfaDisable] = useState(false);
  const [tfaDisableCode, setTfaDisableCode] = useState('');
  const [tfaDisableLoading, setTfaDisableLoading] = useState(false);
  const [showTfaRegen, setShowTfaRegen] = useState(false);
  const [tfaRegenCode, setTfaRegenCode] = useState('');
  const [tfaRegenLoading, setTfaRegenLoading] = useState(false);
  const [tfaRegenCodes, setTfaRegenCodes] = useState([]);
  // Stripe Connect state
  const [stripeConnectStatus, setStripeConnectStatus] = useState(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);

  // Stripe Terminal state
  const [terminalConfig, setTerminalConfig] = useState(null);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [terminalReaders, setTerminalReaders] = useState([]);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [terminalLocationForm, setTerminalLocationForm] = useState({
    displayName: '', addressLine1: '', city: '', state: '', postalCode: '', country: 'US'
  });
  const [showReaderForm, setShowReaderForm] = useState(false);
  const [readerAddMode, setReaderAddMode] = useState(null); // 'code', 'simulated', or null (shows picker)
  const [readerRegistrationCode, setReaderRegistrationCode] = useState('');
  const [readerLabel, setReaderLabel] = useState('');
  const [terminalSaving, setTerminalSaving] = useState(false);

  const functions = getFunctions();

  useEffect(() => {
    if (!currentUser?.uid) return;

    const fetchAccountData = async () => {
      try {
        const docRef = doc(db, "restaurants", currentUser.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setRestaurantData(data);
          setUsername(data.username || '');
          setRestaurantName(data.restaurantName || '');
          setAddress(data.address || '');
          setTaxRate(data.taxRate !== undefined ? data.taxRate : 8);
          setServiceMode(data.serviceMode || 'full_service');
          setHasPin(!!data.reimbursementPin);
          setTwoFactorEnabled(!!data.twoFactorEnabled);
        }

        if (currentUser.email) {
          setEmail(currentUser.email);
        }
      } catch (error) {
        console.error("Error fetching account data:", error);
        setError('Failed to load account data');
      } finally {
        setLoading(false);
      }
    };

    fetchAccountData();
  }, [currentUser]);

  // Sync locations from context
  useEffect(() => {
    if (isMultiLocation && locations) {
      setLocationList(locations);
    } else {
      setLocationList([]);
    }
  }, [isMultiLocation, locations]);

  // Load order usage stats
  useEffect(() => {
    if (!currentUser?.uid) return;

    const loadUsageStats = async () => {
      try {
        setUsageLoading(true);
        const stats = await getUsageStats(currentUser.uid);
        setUsageStats(stats);
      } catch (error) {
        console.error('Error loading usage stats:', error);
      } finally {
        setUsageLoading(false);
      }
    };

    loadUsageStats();
  }, [currentUser]);

  // Fetch Stripe Connect status
  const fetchStripeConnectStatus = async () => {
    try {
      const fn = httpsCallable(functions, 'getStripeConnectStatus');
      const result = await fn();
      setStripeConnectStatus(result.data);
    } catch (error) {
      console.error('Error fetching Stripe Connect status:', error);
    }
  };

  useEffect(() => {
    if (!currentUser?.uid) return;
    fetchStripeConnectStatus();
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Stripe Connect return URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeConnect = params.get('stripe_connect');
    const accountId = params.get('account_id');

    if (stripeConnect === 'success' && accountId) {
      setActiveSection('payment_account');
      // Check onboarding status
      const checkStatus = async () => {
        try {
          setStripeConnectLoading(true);
          const fn = httpsCallable(functions, 'checkStripeConnectStatus');
          const result = await fn({ stripeAccountId: accountId });
          setStripeConnectStatus({
            connected: result.data.status === 'active',
            status: result.data.status,
            stripeAccountId: accountId,
            chargesEnabled: result.data.chargesEnabled,
            payoutsEnabled: result.data.payoutsEnabled
          });
          if (result.data.status === 'active') {
            setSuccess('Stripe account connected successfully! Payments will now go to your Stripe account.');
          } else {
            setError('Stripe onboarding is not complete yet. Please click "Continue Setup" to finish.');
          }
        } catch (err) {
          console.error('Error checking Stripe Connect status:', err);
          setError('Could not verify Stripe connection. Please try again.');
        } finally {
          setStripeConnectLoading(false);
        }
      };
      checkStatus();
      // Clean URL params
      window.history.replaceState({}, '', window.location.pathname);
    } else if (stripeConnect === 'refresh') {
      setActiveSection('payment_account');
      setError('The Stripe setup link expired. Please click "Connect Stripe Account" to try again.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stripe Connect handlers
  const handleConnectStripe = async () => {
    setStripeConnectLoading(true);
    setError('');
    try {
      const baseUrl = window.location.origin;
      const fn = httpsCallable(functions, 'initiateStripeConnect');
      const result = await fn({ returnUrl: baseUrl });
      if (result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err) {
      console.error('Error initiating Stripe Connect:', err);
      if (err.message?.includes('already-exists')) {
        setError('A Stripe account is already connected.');
        fetchStripeConnectStatus();
      } else {
        setError('Failed to start Stripe connection. Please try again.');
      }
    } finally {
      setStripeConnectLoading(false);
    }
  };

  const handleContinueStripeSetup = async () => {
    setStripeConnectLoading(true);
    setError('');
    try {
      const baseUrl = window.location.origin;
      const fn = httpsCallable(functions, 'refreshStripeConnectLink');
      const result = await fn({ returnUrl: baseUrl });
      if (result.data.url) {
        window.location.href = result.data.url;
      }
    } catch (err) {
      console.error('Error refreshing Stripe Connect link:', err);
      setError('Failed to refresh setup link. Please try connecting again.');
    } finally {
      setStripeConnectLoading(false);
    }
  };

  const handleDisconnectStripe = async () => {
    if (!window.confirm('Are you sure you want to disconnect your Stripe account?\n\nPayments will revert to going through the Koda Carte platform account.')) {
      return;
    }
    setStripeConnectLoading(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'disconnectStripeConnect');
      await fn();
      setStripeConnectStatus({ connected: false, status: 'disconnected' });
      setSuccess('Stripe account disconnected. Payments will now go through the platform.');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      console.error('Error disconnecting Stripe:', err);
      setError('Failed to disconnect Stripe account.');
    } finally {
      setStripeConnectLoading(false);
    }
  };

  // ---- Stripe Terminal handlers ----

  const loadTerminalConfig = async () => {
    try {
      setTerminalLoading(true);
      const config = await getTerminalConfig();
      setTerminalConfig(config);
      if (config.configured) {
        const readersResult = await listReaders();
        setTerminalReaders(readersResult.readers || []);
      }
    } catch (err) {
      console.error('Error loading terminal config:', err);
    } finally {
      setTerminalLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeSection === 'terminal' && currentUser?.uid) {
      loadTerminalConfig();
    }
  }, [activeSection, currentUser]);

  const handleCreateTerminalLocation = async (e) => {
    e.preventDefault();
    setError('');
    setTerminalSaving(true);
    try {
      await createTerminalLocation(terminalLocationForm);
      setSuccess('Terminal location created successfully!');
      setShowLocationForm(false);
      await loadTerminalConfig();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to create terminal location: ' + (err.message || err));
    } finally {
      setTerminalSaving(false);
    }
  };

  const handleRegisterReader = async (e) => {
    e.preventDefault();
    setError('');
    setTerminalSaving(true);
    try {
      await registerReader(readerRegistrationCode, readerLabel);
      setSuccess('Reader registered successfully!');
      setShowReaderForm(false);
      setReaderRegistrationCode('');
      setReaderLabel('');
      const readersResult = await listReaders();
      setTerminalReaders(readersResult.readers || []);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to register reader: ' + (err.message || err));
    } finally {
      setTerminalSaving(false);
    }
  };

  const handleDeleteReader = async (readerId, label) => {
    if (!window.confirm(`Remove reader "${label || readerId}"? The reader will need to be re-registered to use again.`)) return;
    setError('');
    try {
      await deleteReader(readerId);
      setTerminalReaders(prev => prev.filter(r => r.id !== readerId));
      setSuccess('Reader removed.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to remove reader: ' + (err.message || err));
    }
  };

  const handleCreateSimulatedReader = async () => {
    setError('');
    setTerminalSaving(true);
    try {
      await createSimulatedReader();
      setSuccess('Simulated reader created! You can now test terminal payments.');
      setShowReaderForm(false);
      setReaderAddMode(null);
      const readersResult = await listReaders();
      setTerminalReaders(readersResult.readers || []);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to create simulated reader: ' + (err.message || err));
    } finally {
      setTerminalSaving(false);
    }
  };

  const handleRefreshReaders = async () => {
    setError('');
    setTerminalSaving(true);
    try {
      const readersResult = await listReaders();
      setTerminalReaders(readersResult.readers || []);
      setSuccess('Reader list refreshed.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError('Failed to refresh readers: ' + (err.message || err));
    } finally {
      setTerminalSaving(false);
    }
  };

  const handleSaveAccountDetails = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const docRef = doc(db, "restaurants", currentUser.uid);
      await updateDoc(docRef, {
        username,
        restaurantName,
        address,
        taxRate: parseFloat(taxRate),
        updatedAt: new Date().toISOString()
      });

      setSuccess('Account details updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to update account details: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveServiceMode = async (mode) => {
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const docRef = doc(db, "restaurants", currentUser.uid);
      await updateDoc(docRef, {
        serviceMode: mode,
        updatedAt: new Date().toISOString()
      });

      setServiceMode(mode);
      setSuccess('Service mode updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to update service mode: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      setSaving(true);

      // Re-authenticate user
      const credential = EmailAuthProvider.credential(
        currentUser.email,
        currentPassword
      );
      await reauthenticateWithCredential(currentUser, credential);

      // Update password
      await updatePassword(currentUser, newPassword);

      setSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      if (error.code === 'auth/wrong-password') {
        setError('Current password is incorrect');
      } else if (error.code === 'auth/weak-password') {
        setError('Password is too weak');
      } else {
        setError('Failed to change password: ' + error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSetReimbursementPin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (reimbursementPin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    if (reimbursementPin.length !== 4 || !/^\d{4}$/.test(reimbursementPin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }

    try {
      setSaving(true);

      // Verify password first
      const credential = EmailAuthProvider.credential(
        currentUser.email,
        pinPassword
      );
      await reauthenticateWithCredential(currentUser, credential);

      // Store PIN in Firestore
      const docRef = doc(db, "restaurants", currentUser.uid);
      await updateDoc(docRef, {
        reimbursementPin: reimbursementPin,
        reimbursementPinUpdatedAt: new Date().toISOString()
      });

      setSuccess('Reimbursement PIN set successfully!');
      setPinPassword('');
      setReimbursementPin('');
      setConfirmPin('');
      setShowPinForm(false);
      setHasPin(true);

      // Log activity
      await activityService.logPinActivity(currentUser.uid, hasPin ? 'updated' : 'created');

      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      if (error.code === 'auth/wrong-password') {
        setError('Password is incorrect');
      } else {
        setError('Failed to set PIN: ' + error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="account-loading">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'account':
        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-person-circle"></i> Account Details</h3>
            </Card.Header>
            <Card.Body>
              <Form onSubmit={handleSaveAccountDetails}>
                <Form.Group className="mb-3">
                  <Form.Label>Username</Form.Label>
                  <Form.Control
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={email}
                    disabled
                    className="disabled-field"
                  />
                  <Form.Text className="text-muted">Email cannot be changed</Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Restaurant Name</Form.Label>
                  <Form.Control
                    type="text"
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Restaurant Address</Form.Label>
                  <AddressAutocomplete
                    value={address}
                    onChange={(value) => setAddress(value)}
                    onSelect={(addressData) => {
                      setAddress(addressData.fullAddress);
                    }}
                    placeholder="Start typing your restaurant address..."
                  />
                  <Form.Text className="text-muted">
                    Start typing to see address suggestions. Select an address from the dropdown.
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Tax Rate (%)</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    required
                  />
                  <Form.Text className="text-muted">
                    This tax rate will be applied to all orders (POS and Website).
                  </Form.Text>
                </Form.Group>

                <Button
                  type="submit"
                  disabled={saving}
                  className="gradient-button"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </Form>

              <hr className="my-4" />

              <div className="logout-section">
                <h5 className="mb-3">Session Management</h5>
                <p className="text-muted mb-3">Sign out of your account to end your current session.</p>
                <Button
                  variant="danger"
                  onClick={async () => {
                    try {
                      await signOut(auth);
                      navigate('/login');
                    } catch (error) {
                      console.error("Error signing out:", error);
                      setError('Failed to sign out. Please try again.');
                    }
                  }}
                  className="logout-account-button"
                >
                  <i className="bi bi-box-arrow-right"></i> Logout
                </Button>
              </div>
            </Card.Body>
          </Card>
        );

      case 'security':
        return (
          <>
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-shield-lock"></i> Security</h3>
            </Card.Header>
            <Card.Body>
              {!showPasswordForm ? (
                <div className="password-section">
                  <p className="text-muted">Change your password to keep your account secure.</p>
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowPasswordForm(true)}
                    className="gradient-outline-button"
                  >
                    Change Password
                  </Button>
                </div>
              ) : (
                <Form onSubmit={handleChangePassword}>
                  <Form.Group className="mb-3">
                    <Form.Label>Current Password</Form.Label>
                    <PasswordInput
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      placeholder="Enter your current password"
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>New Password</Form.Label>
                    <PasswordInput
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      placeholder="Enter new password (min 6 characters)"
                      minLength={6}
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Confirm New Password</Form.Label>
                    <PasswordInput
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Confirm new password"
                      minLength={6}
                    />
                  </Form.Group>

                  <div className="password-actions">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="gradient-button"
                    >
                      {saving ? 'Updating...' : 'Update Password'}
                    </Button>
                    <Button
                      variant="outline-secondary"
                      onClick={() => {
                        setShowPasswordForm(false);
                        setCurrentPassword('');
                        setNewPassword('');
                        setConfirmPassword('');
                        setError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </Form>
              )}
            </Card.Body>
          </Card>

          {/* Two-Factor Authentication Card */}
          <Card className="account-card mt-4">
            <Card.Header className="account-card-header">
              <div className="d-flex justify-content-between align-items-center">
                <h3><i className="bi bi-shield-check"></i> Two-Factor Authentication</h3>
                <Badge bg={twoFactorEnabled ? 'success' : 'secondary'}>
                  {twoFactorEnabled ? 'Active' : 'Not Active'}
                </Badge>
              </div>
            </Card.Header>
            <Card.Body>
              {!twoFactorEnabled ? (
                <div className="password-section">
                  <div className="d-flex gap-3 align-items-start mb-3">
                    <i className="bi bi-lock-fill" style={{ fontSize: '2rem', color: '#667eea' }}></i>
                    <div>
                      <h5 className="mb-1">Add an extra layer of security</h5>
                      <p className="text-muted mb-1">
                        Two-factor authentication protects your account by requiring a code from your phone
                        in addition to your password. Even if someone knows your password, they can't get in
                        without your phone.
                      </p>
                      <p className="text-muted small mb-0">Setup takes about 2 minutes.</p>
                    </div>
                  </div>
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowTfaSetup(true)}
                    className="gradient-outline-button"
                  >
                    <i className="bi bi-shield-plus"></i> Enable Two-Factor Authentication
                  </Button>
                </div>
              ) : (
                <div>
                  <Alert variant="success" className="d-flex align-items-start gap-2 mb-3">
                    <i className="bi bi-check-circle-fill mt-1"></i>
                    <div>
                      <strong>Your account is protected</strong>
                      <br />
                      <small>You'll be asked for a code from your authenticator app each time you sign in.</small>
                    </div>
                  </Alert>

                  {/* Regenerate Backup Codes */}
                  {!showTfaRegen ? (
                    <Button
                      variant="outline-secondary"
                      className="me-2 mb-2"
                      onClick={() => setShowTfaRegen(true)}
                    >
                      <i className="bi bi-key"></i> Generate New Backup Codes
                    </Button>
                  ) : tfaRegenCodes.length > 0 ? (
                    <div className="border rounded p-3 mb-3">
                      <h6>Your New Backup Codes</h6>
                      <p className="text-muted small mb-2">Save these somewhere safe. Your old codes no longer work.</p>
                      <div className="row g-2 mb-3">
                        {tfaRegenCodes.map((code, i) => (
                          <div key={i} className="col-6">
                            <code className="d-block bg-dark text-light p-2 rounded text-center">{i + 1}. {code}</code>
                          </div>
                        ))}
                      </div>
                      <div className="d-flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline-secondary" onClick={() => {
                          navigator.clipboard.writeText(tfaRegenCodes.join('\n'));
                          setSuccess('Backup codes copied!');
                          setTimeout(() => setSuccess(''), 3000);
                        }}>Copy</Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => {
                          setShowTfaRegen(false);
                          setTfaRegenCodes([]);
                          setTfaRegenCode('');
                        }}>Done</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="border rounded p-3 mb-3">
                      <p className="mb-2">Enter your authenticator code to generate new backup codes:</p>
                      <div className="d-flex gap-2 align-items-center flex-wrap">
                        <Form.Control
                          type="text"
                          value={tfaRegenCode}
                          onChange={(e) => setTfaRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="6-digit code"
                          maxLength={6}
                          style={{ maxWidth: '140px', fontFamily: 'monospace', textAlign: 'center', letterSpacing: '2px' }}
                        />
                        <Button
                          variant="primary"
                          disabled={tfaRegenLoading || tfaRegenCode.length !== 6}
                          onClick={async () => {
                            setTfaRegenLoading(true);
                            try {
                              const regenFn = httpsCallable(functions, 'regenerateRestaurantBackupCodes');
                              const result = await regenFn({ code: tfaRegenCode });
                              setTfaRegenCodes(result.data.backupCodes);
                              setSuccess('New backup codes generated!');
                              setTimeout(() => setSuccess(''), 3000);
                            } catch (err) {
                              setError(err.message?.includes('Incorrect') ? 'Incorrect code. Please try again.' : 'Failed to regenerate codes.');
                            } finally {
                              setTfaRegenLoading(false);
                            }
                          }}
                          className="gradient-button"
                        >
                          {tfaRegenLoading ? 'Generating...' : 'Generate'}
                        </Button>
                        <Button variant="outline-secondary" onClick={() => { setShowTfaRegen(false); setTfaRegenCode(''); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Disable 2FA */}
                  {!showTfaDisable ? (
                    <Button
                      variant="outline-danger"
                      className="mb-2"
                      onClick={() => setShowTfaDisable(true)}
                    >
                      <i className="bi bi-shield-x"></i> Disable Two-Factor Authentication
                    </Button>
                  ) : (
                    <div className="border border-danger rounded p-3 mb-3">
                      <p className="mb-2"><strong>Are you sure?</strong> Disabling 2FA will make your account less secure. Enter your authenticator code to confirm:</p>
                      <div className="d-flex gap-2 align-items-center flex-wrap">
                        <Form.Control
                          type="text"
                          value={tfaDisableCode}
                          onChange={(e) => setTfaDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="6-digit code"
                          maxLength={6}
                          style={{ maxWidth: '140px', fontFamily: 'monospace', textAlign: 'center', letterSpacing: '2px' }}
                        />
                        <Button
                          variant="danger"
                          disabled={tfaDisableLoading || tfaDisableCode.length !== 6}
                          onClick={async () => {
                            setTfaDisableLoading(true);
                            try {
                              const disableFn = httpsCallable(functions, 'disableRestaurant2FA');
                              await disableFn({ code: tfaDisableCode });
                              setTwoFactorEnabled(false);
                              setShowTfaDisable(false);
                              setTfaDisableCode('');
                              setSuccess('Two-factor authentication has been disabled.');
                              setTimeout(() => setSuccess(''), 3000);
                            } catch (err) {
                              setError(err.message?.includes('Incorrect') ? 'Incorrect code. Please try again.' : 'Failed to disable 2FA.');
                            } finally {
                              setTfaDisableLoading(false);
                            }
                          }}
                        >
                          {tfaDisableLoading ? 'Disabling...' : 'Confirm Disable'}
                        </Button>
                        <Button variant="outline-secondary" onClick={() => { setShowTfaDisable(false); setTfaDisableCode(''); }}>
                          Keep Enabled
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card.Body>
          </Card>

          {/* 2FA Setup Wizard Modal */}
          {showTfaSetup && (
            <TwoFactorSetup
              onComplete={() => {
                setShowTfaSetup(false);
                setTwoFactorEnabled(true);
                setSuccess('Two-factor authentication enabled successfully!');
                setTimeout(() => setSuccess(''), 3000);
              }}
              onCancel={() => setShowTfaSetup(false)}
              showToast={(msg, type) => {
                if (type === 'error') setError(msg);
                else { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); }
              }}
              setupFnName="setupRestaurant2FA"
              verifyFnName="verifyAndEnableRestaurant2FA"
            />
          )}
          </>
        );

      case 'pin':
        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-key"></i> Reimbursement PIN</h3>
            </Card.Header>
            <Card.Body>
              {!showPinForm ? (
                <div className="password-section">
                  <p className="text-muted">
                    {hasPin
                      ? 'Set a 4-digit PIN required for processing reimbursements. Update your PIN to change it.'
                      : 'Set a 4-digit PIN required for processing reimbursements.'}
                  </p>
                  <Button
                    variant="outline-warning"
                    onClick={() => {
                      setShowPinForm(true);
                      setPinPassword('');
                      setReimbursementPin('');
                      setConfirmPin('');
                      setError('');
                    }}
                    className="gradient-outline-button"
                  >
                    {hasPin ? 'Update PIN' : 'Set PIN'}
                  </Button>
                </div>
              ) : (
                <Form onSubmit={handleSetReimbursementPin}>
                  <Form.Group className="mb-3">
                    <Form.Label>Current Password</Form.Label>
                    <PasswordInput
                      value={pinPassword}
                      onChange={(e) => setPinPassword(e.target.value)}
                      required
                      placeholder="Enter your password to verify"
                    />
                    <Form.Text className="text-muted">
                      Password required to set or update reimbursement PIN
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Reimbursement PIN (4 digits)</Form.Label>
                    <Form.Control
                      type="text"
                      value={reimbursementPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setReimbursementPin(value);
                      }}
                      required
                      placeholder="Enter 4-digit PIN"
                      maxLength={4}
                      pattern="\d{4}"
                    />
                    <Form.Text className="text-muted">
                      Enter a 4-digit PIN (numbers only)
                    </Form.Text>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Confirm PIN</Form.Label>
                    <Form.Control
                      type="text"
                      value={confirmPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setConfirmPin(value);
                      }}
                      required
                      placeholder="Confirm 4-digit PIN"
                      maxLength={4}
                      pattern="\d{4}"
                    />
                  </Form.Group>

                  <div className="password-actions">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="gradient-button"
                    >
                      {saving ? 'Saving...' : (hasPin ? 'Update PIN' : 'Set PIN')}
                    </Button>
                    <Button
                      variant="outline-secondary"
                      onClick={() => {
                        setShowPinForm(false);
                        setPinPassword('');
                        setReimbursementPin('');
                        setConfirmPin('');
                        setError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </Form>
              )}
            </Card.Body>
          </Card>
        );

      case 'locations':
        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-geo-alt"></i> Locations</h3>
            </Card.Header>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <p className="mb-0">Manage your restaurant locations</p>
                <Button variant="primary" onClick={() => {
                  setEditingLocation(null);
                  setLocationForm({ name: '', address: '' });
                  setShowLocationModal(true);
                }}>
                  <i className="bi bi-plus-circle"></i> Add Location
                </Button>
              </div>

              {locationList.length > 0 ? (
                <Table responsive>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Address</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locationList.map(location => (
                      <tr key={location.id}>
                        <td>{location.name}</td>
                        <td>{location.address || 'No address'}</td>
                        <td>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            className="me-2"
                            onClick={() => {
                              setEditingLocation(location);
                              setLocationForm({ name: location.name, address: location.address || '' });
                              setShowLocationModal(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={async () => {
                              if (window.confirm(`Are you sure you want to delete ${location.name}?`)) {
                                try {
                                  await deleteDoc(doc(db, `restaurants/${currentUser.uid}/locations/${location.id}`));
                                  setLocationList(locationList.filter(l => l.id !== location.id));
                                  loadRestaurantData();
                                  setSuccess('Location deleted successfully');
                                } catch (error) {
                                  setError('Failed to delete location: ' + error.message);
                                }
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-muted text-center py-3">No locations added yet. Click "Add Location" to get started.</p>
              )}
            </Card.Body>
          </Card>
        );

      case 'service_mode':
        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-shop"></i> Service Mode</h3>
            </Card.Header>
            <Card.Body>
              <Alert variant="info" className="mb-4">
                <i className="bi bi-info-circle me-2"></i>
                Service mode determines how your POS, Kitchen, Server, and Payments pages behave. Choose the workflow that matches your restaurant type.
              </Alert>

              <div className="service-mode-options">
                <div
                  className={`service-mode-card ${serviceMode === 'full_service' ? 'active' : ''}`}
                  onClick={() => !saving && handleSaveServiceMode('full_service')}
                >
                  <div className="service-mode-icon">
                    <i className="bi bi-cup-hot"></i>
                  </div>
                  <div className="service-mode-info">
                    <h5>Full Service</h5>
                    <p>Traditional dine-in restaurant. Tables required, servers deliver food, payment collected after service.</p>
                    <div className="service-mode-features">
                      <Badge bg="secondary" className="me-1">Tables</Badge>
                      <Badge bg="secondary" className="me-1">Server</Badge>
                      <Badge bg="secondary" className="me-1">Pay After</Badge>
                    </div>
                  </div>
                  {serviceMode === 'full_service' && (
                    <div className="service-mode-check">
                      <i className="bi bi-check-circle-fill"></i>
                    </div>
                  )}
                </div>

                <div
                  className={`service-mode-card ${serviceMode === 'counter_service' ? 'active' : ''}`}
                  onClick={() => !saving && handleSaveServiceMode('counter_service')}
                >
                  <div className="service-mode-icon">
                    <i className="bi bi-shop"></i>
                  </div>
                  <div className="service-mode-info">
                    <h5>Counter Service</h5>
                    <p>Pay-first at counter. Order number called when ready. Tables optional, no server needed.</p>
                    <div className="service-mode-features">
                      <Badge bg="secondary" className="me-1">Pay First</Badge>
                      <Badge bg="secondary" className="me-1">Counter Pickup</Badge>
                      <Badge bg="secondary" className="me-1">Optional Tables</Badge>
                    </div>
                  </div>
                  {serviceMode === 'counter_service' && (
                    <div className="service-mode-check">
                      <i className="bi bi-check-circle-fill"></i>
                    </div>
                  )}
                </div>

                <div
                  className={`service-mode-card ${serviceMode === 'food_truck' ? 'active' : ''}`}
                  onClick={() => !saving && handleSaveServiceMode('food_truck')}
                >
                  <div className="service-mode-icon">
                    <i className="bi bi-truck"></i>
                  </div>
                  <div className="service-mode-info">
                    <h5>Food Truck</h5>
                    <p>Pay-first at window. Simplest workflow — no tables, no servers. Customer picks up when ready.</p>
                    <div className="service-mode-features">
                      <Badge bg="secondary" className="me-1">Pay First</Badge>
                      <Badge bg="secondary" className="me-1">Window Pickup</Badge>
                      <Badge bg="secondary" className="me-1">No Tables</Badge>
                    </div>
                  </div>
                  {serviceMode === 'food_truck' && (
                    <div className="service-mode-check">
                      <i className="bi bi-check-circle-fill"></i>
                    </div>
                  )}
                </div>
              </div>

              {saving && (
                <div className="text-center mt-3">
                  <Spinner animation="border" size="sm" /> Saving...
                </div>
              )}
            </Card.Body>
          </Card>
        );

      case 'subscription':
        const currentTier = getCurrentTier();
        const tierInfo = TIER_FEATURES[currentTier];
        const billingCycle = subscription?.billingCycle || 'annual';
        const currentPrice = calculatePrice(currentTier, billingCycle);
        const locationCount = subscription?.locationCount || 1;

        // All tier keys in order (including scout free tier)
        const allTiers = ['scout', 'ally', 'guide', 'chief', 'elder'];
        const billingOptions = [
          { value: 'annual', label: 'Annual', discount: 'Best value - No markup', savings: 0 },
          { value: 'quarterly', label: 'Quarterly', discount: '+10% markup', savings: 10 },
          { value: 'monthly', label: 'Monthly', discount: '+20% markup', savings: 20 }
        ];

        const handleChangeBillingCycle = (newCycle) => {
          if (newCycle === billingCycle) return;

          const newPrice = calculatePrice(currentTier, newCycle);
          const newCycleLabel = billingOptions.find(b => b.value === newCycle)?.label || newCycle;

          setPendingPlanChange({
            type: 'billing',
            newTier: currentTier,
            newCycle: newCycle,
            cycleLabel: newCycleLabel,
            newPrice: newPrice,
            isUpgrade: false,
            action: 'change billing cycle'
          });
          setShowPlanModal(true);
        };

        const handleChangePlan = (newTier, selectedBillingCycle = billingCycle) => {
          if (newTier === currentTier && selectedBillingCycle === billingCycle) return;

          const isUpgrade = TIER_FEATURES[newTier].level > TIER_FEATURES[currentTier].level;
          const action = newTier === currentTier ? 'update billing for' : (isUpgrade ? 'upgrade' : 'downgrade');
          const newPrice = calculatePrice(newTier, selectedBillingCycle);
          const cycleLabel = billingOptions.find(b => b.value === selectedBillingCycle)?.label || selectedBillingCycle;

          setPendingPlanChange({
            type: 'plan',
            newTier: newTier,
            newCycle: selectedBillingCycle,
            cycleLabel: cycleLabel,
            newPrice: newPrice,
            isUpgrade: isUpgrade,
            action: action
          });
          setShowPlanModal(true);
        };


        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-credit-card-2-front"></i> Subscription</h3>
            </Card.Header>
            <Card.Body>
              {/* Current Plan Header */}
              <div style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderRadius: '16px',
                padding: '24px',
                color: 'white',
                marginBottom: '24px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <p style={{ opacity: 0.8, margin: 0, fontSize: '0.9rem' }}>Current Plan</p>
                    <h2 style={{ margin: '8px 0', fontSize: '2rem', fontWeight: 800 }}>
                      {tierInfo?.icon} {tierInfo?.name || 'Ally'}
                    </h2>
                    <Badge bg={subscription?.status === 'active' ? 'success' : 'warning'}>
                      {subscription?.status === 'active' ? 'Active' : (subscription?.status || 'Active')}
                    </Badge>
                    {locationCount > 1 && (
                      <Badge bg="info" className="ms-2">
                        {locationCount} Locations
                      </Badge>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ opacity: 0.8, margin: 0, fontSize: '0.9rem' }}>Monthly Cost</p>
                    <h2 style={{ margin: '8px 0', fontSize: '2rem', fontWeight: 800 }}>
                      {currentTier === 'scout' ? 'Free' : `$${(parseFloat(currentPrice) * locationCount).toFixed(2)}`}
                    </h2>
                    <p style={{ opacity: 0.8, margin: 0, fontSize: '0.85rem', textTransform: 'capitalize' }}>
                      {currentTier === 'scout' ? 'Forever free' : `Billed ${billingCycle}`}
                    </p>
                  </div>
                </div>
              </div>

              {/* All Plans Comparison */}
              <div style={{ marginBottom: '24px' }}>
                <h5 style={{ marginBottom: '16px' }}>Change Your Plan</h5>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '16px'
                }}>
                  {allTiers.map((tierKey) => {
                    const tier = TIER_FEATURES[tierKey];
                    const price = calculatePrice(tierKey, billingCycle);
                    const isCurrent = tierKey === currentTier;
                    const isHigher = tier.level > TIER_FEATURES[currentTier].level;
                    const isLower = tier.level < TIER_FEATURES[currentTier].level;

                    return (
                      <div
                        key={tierKey}
                        style={{
                          border: isCurrent ? '2px solid #667eea' : '1px solid #e5e7eb',
                          borderRadius: '12px',
                          padding: '20px',
                          background: isCurrent ? 'rgba(102, 126, 234, 0.05)' : 'white',
                          position: 'relative'
                        }}
                      >
                        {isCurrent && (
                          <Badge
                            bg="primary"
                            style={{
                              position: 'absolute',
                              top: '-10px',
                              right: '12px',
                              fontSize: '0.7rem'
                            }}
                          >
                            Current
                          </Badge>
                        )}
                        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                          <span style={{ fontSize: '2rem' }}>{tier.icon}</span>
                          <h5 style={{ margin: '8px 0 4px', fontWeight: 700 }}>{tier.name}</h5>
                          <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>
                            ${price}
                            <span style={{ fontSize: '0.85rem', fontWeight: 400, color: '#666' }}>/mo</span>
                          </div>
                          {locationCount > 1 && (
                            <div style={{ fontSize: '0.8rem', color: '#666' }}>
                              ${(parseFloat(price) * locationCount).toFixed(2)}/mo total
                            </div>
                          )}
                        </div>

                        {/* Feature highlights */}
                        <ul style={{
                          listStyle: 'none',
                          padding: 0,
                          margin: '0 0 16px',
                          fontSize: '0.85rem'
                        }}>
                          {tier.features.slice(0, 5).map((feature, idx) => (
                            <li key={idx} style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              marginBottom: '4px',
                              color: '#555'
                            }}>
                              <i className="bi bi-check" style={{ color: '#22c55e' }}></i>
                              <span style={{ textTransform: 'capitalize' }}>
                                {feature.replace(/-/g, ' ')}
                              </span>
                            </li>
                          ))}
                          {tier.features.length > 5 && (
                            <li style={{ color: '#888', fontSize: '0.8rem', marginTop: '4px' }}>
                              +{tier.features.length - 5} more features
                            </li>
                          )}
                        </ul>

                        {!isCurrent ? (
                          <Button
                            variant={isHigher ? 'primary' : 'outline-secondary'}
                            size="sm"
                            className="w-100"
                            onClick={() => handleChangePlan(tierKey)}
                            disabled={saving}
                            style={isHigher ? {
                              background: 'linear-gradient(135deg, #b87333 0%, #40e0d0 100%)',
                              border: 'none'
                            } : undefined}
                          >
                            {saving ? 'Processing...' : (isHigher ? 'Upgrade' : 'Downgrade')}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="w-100"
                            disabled
                          >
                            Current Plan
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Features You Have Access To */}
              <div style={{ marginBottom: '24px' }}>
                <h5 style={{ marginBottom: '16px' }}>Your Plan Features</h5>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                  {tierInfo?.features?.map((feature, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      background: '#f8f9fa',
                      borderRadius: '8px'
                    }}>
                      <i className="bi bi-check-circle-fill" style={{ color: '#22c55e' }}></i>
                      <span style={{ textTransform: 'capitalize' }}>{feature.replace(/-/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Features Not In Your Plan */}
              {currentTier !== 'elder' && (
                <div style={{ marginBottom: '24px' }}>
                  <h5 style={{ marginBottom: '16px', color: '#666' }}>
                    <i className="bi bi-lock"></i> Features Available with Higher Plans
                  </h5>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    {TIER_FEATURES.elder.features
                      .filter(f => !tierInfo?.features?.includes(f))
                      .map((feature, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 12px',
                          background: '#f1f1f1',
                          borderRadius: '8px',
                          opacity: 0.7
                        }}>
                          <i className="bi bi-lock-fill" style={{ color: '#f59e0b' }}></i>
                          <span style={{ textTransform: 'capitalize' }}>{feature.replace(/-/g, ' ')}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Billing Cycle Selector */}
              <div style={{
                marginTop: '24px',
                paddingTop: '24px',
                borderTop: '1px solid #e5e7eb'
              }}>
                <h5 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className="bi bi-calendar3" style={{ color: '#667eea' }}></i>
                  Billing Cycle
                </h5>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  marginBottom: '20px'
                }}>
                  {billingOptions.map((option) => {
                    const isSelected = billingCycle === option.value;
                    const optionPrice = calculatePrice(currentTier, option.value);
                    return (
                      <div
                        key={option.value}
                        onClick={() => !isSelected && !saving && handleChangeBillingCycle(option.value)}
                        style={{
                          position: 'relative',
                          padding: '16px',
                          borderRadius: '12px',
                          border: isSelected ? '2px solid #667eea' : '1px solid #e5e7eb',
                          background: isSelected ? 'linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)' : 'white',
                          cursor: isSelected ? 'default' : 'pointer',
                          transition: 'all 0.2s ease',
                          textAlign: 'center'
                        }}
                      >
                        {option.value === 'annual' && (
                          <div style={{
                            position: 'absolute',
                            top: '-10px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                            color: 'white',
                            padding: '2px 10px',
                            borderRadius: '10px',
                            fontSize: '10px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                          }}>
                            Best Value
                          </div>
                        )}
                        <div style={{
                          fontWeight: 700,
                          fontSize: '1rem',
                          color: isSelected ? '#667eea' : '#1f2937',
                          marginBottom: '4px'
                        }}>
                          {option.label}
                        </div>
                        <div style={{
                          fontSize: '1.25rem',
                          fontWeight: 800,
                          color: isSelected ? '#667eea' : '#374151'
                        }}>
                          ${optionPrice}
                          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#666' }}>/mo</span>
                        </div>
                        <div style={{
                          fontSize: '0.75rem',
                          color: option.value === 'annual' ? '#22c55e' : '#f59e0b',
                          fontWeight: 500,
                          marginTop: '4px'
                        }}>
                          {option.discount}
                        </div>
                        {isSelected && (
                          <div style={{
                            marginTop: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            color: '#667eea',
                            fontSize: '0.8rem',
                            fontWeight: 600
                          }}>
                            <i className="bi bi-check-circle-fill"></i>
                            Current
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Billing Info */}
              <div style={{
                marginTop: '16px',
                padding: '20px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e5e7eb'
              }}>
                <h5 style={{ marginBottom: '16px', fontSize: '0.95rem', color: '#374151' }}>
                  <i className="bi bi-receipt" style={{ marginRight: '8px', color: '#667eea' }}></i>
                  Billing Summary
                </h5>
                <Table size="sm" borderless style={{ marginBottom: 0 }}>
                  <tbody>
                    <tr>
                      <td style={{ color: '#666', padding: '8px 0' }}>Current Plan</td>
                      <td style={{ fontWeight: 600, textAlign: 'right', padding: '8px 0' }}>
                        {tierInfo?.icon} {tierInfo?.name}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', padding: '8px 0' }}>Billing Cycle</td>
                      <td style={{ fontWeight: 600, textTransform: 'capitalize', textAlign: 'right', padding: '8px 0' }}>{billingCycle}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', padding: '8px 0' }}>Locations</td>
                      <td style={{ fontWeight: 600, textAlign: 'right', padding: '8px 0' }}>{locationCount}</td>
                    </tr>
                    <tr>
                      <td style={{ color: '#666', padding: '8px 0' }}>Price per Location</td>
                      <td style={{ fontWeight: 600, textAlign: 'right', padding: '8px 0' }}>${currentPrice}/month</td>
                    </tr>
                    {billingCycle !== 'annual' && (
                      <tr>
                        <td style={{ color: '#666', padding: '8px 0' }}>Billing Adjustment</td>
                        <td style={{ fontWeight: 600, color: '#f59e0b', textAlign: 'right', padding: '8px 0' }}>
                          +{((BILLING_MULTIPLIERS[billingCycle] - 1) * 100).toFixed(0)}%
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ color: '#374151', fontWeight: 600, padding: '12px 0 8px' }}>Total Monthly</td>
                      <td style={{ fontWeight: 800, fontSize: '1.2rem', color: '#667eea', textAlign: 'right', padding: '12px 0 8px' }}>
                        ${(parseFloat(currentPrice) * locationCount).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </Table>
                <div style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  background: 'rgba(102, 126, 234, 0.08)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}>
                  <i className="bi bi-info-circle" style={{ color: '#667eea', marginTop: '2px' }}></i>
                  <p style={{ fontSize: '0.8rem', color: '#555', margin: 0, lineHeight: 1.5 }}>
                    Plan changes take effect immediately. Upgrades are prorated, downgrades and billing cycle changes apply at next billing period.
                  </p>
                </div>
              </div>
            </Card.Body>
          </Card>
        );

      case 'usage':
        const tier = getCurrentTier();
        const tierLimits = ORDER_LIMITS[tier] || ORDER_LIMITS.ally;
        const tierName = TIER_FEATURES[tier]?.name || 'Ally';
        const resetDate = usageStats?.periodEnd ? new Date(usageStats.periodEnd).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }) : 'N/A';
        const progressColor = usageStats?.percentUsed >= 100 ? 'danger' :
          usageStats?.percentUsed >= 80 ? 'warning' : 'success';

        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-graph-up"></i> Order Usage</h3>
            </Card.Header>
            <Card.Body>
              {usageLoading ? (
                <div className="text-center py-5">
                  <Spinner animation="border" variant="primary" />
                  <p className="mt-3 text-muted">Loading usage data...</p>
                </div>
              ) : usageStats ? (
                <>
                  {/* Plan Overview */}
                  <div style={{
                    padding: '20px',
                    background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
                    borderRadius: '12px',
                    marginBottom: '24px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div>
                        <h5 style={{ margin: 0, fontWeight: 700 }}>
                          {TIER_FEATURES[tier]?.icon} {tierName} Plan
                        </h5>
                        <p style={{ margin: '4px 0 0', color: '#666', fontSize: '0.9rem' }}>
                          {usageStats.isUnlimited ? 'Unlimited orders' : `${tierLimits.limit.toLocaleString()} orders per billing cycle`}
                        </p>
                      </div>
                      <Badge bg="info" style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
                        Resets: {resetDate}
                      </Badge>
                    </div>
                    {usageStats.daysRemaining > 0 && (
                      <p style={{ margin: 0, color: '#667eea', fontSize: '0.85rem', fontWeight: 500 }}>
                        <i className="bi bi-calendar3"></i> {usageStats.daysRemaining} days remaining in billing cycle
                      </p>
                    )}
                  </div>

                  {/* Order Usage Progress */}
                  {!usageStats.isUnlimited && (
                    <div style={{ marginBottom: '24px' }}>
                      <h5 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="bi bi-bag-check" style={{ color: '#667eea' }}></i>
                        Orders This Period
                      </h5>
                      <div style={{
                        padding: '20px',
                        background: '#f8fafc',
                        borderRadius: '12px',
                        border: '1px solid #e5e7eb'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <span style={{ fontSize: '2rem', fontWeight: 800, color: progressColor === 'danger' ? '#dc3545' : progressColor === 'warning' ? '#f59e0b' : '#22c55e' }}>
                            {usageStats.currentCount.toLocaleString()}
                          </span>
                          <span style={{ fontSize: '1.5rem', fontWeight: 600, color: '#666' }}>
                            / {tierLimits.limit.toLocaleString()}
                          </span>
                        </div>
                        <ProgressBar
                          now={Math.min(usageStats.percentUsed, 100)}
                          variant={progressColor}
                          style={{ height: '12px', borderRadius: '6px' }}
                        />
                        <p style={{ marginTop: '12px', marginBottom: 0, color: '#666', fontSize: '0.85rem' }}>
                          {usageStats.percentUsed.toFixed(1)}% of your monthly limit used
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Menu Views Progress - Only for Scout tier */}
                  {usageStats.hasMenuViewLimit && (
                    <div style={{ marginBottom: '24px' }}>
                      <h5 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="bi bi-eye" style={{ color: '#8b5cf6' }}></i>
                        Menu Views This Period
                      </h5>
                      <div style={{
                        padding: '20px',
                        background: '#f8fafc',
                        borderRadius: '12px',
                        border: '1px solid #e5e7eb'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <span style={{
                            fontSize: '2rem',
                            fontWeight: 800,
                            color: usageStats.menuViewPercentUsed >= 100 ? '#dc3545' :
                              usageStats.menuViewPercentUsed >= 80 ? '#f59e0b' : '#8b5cf6'
                          }}>
                            {usageStats.menuViewCount.toLocaleString()}
                          </span>
                          <span style={{ fontSize: '1.5rem', fontWeight: 600, color: '#666' }}>
                            / {usageStats.menuViewLimit.toLocaleString()}
                          </span>
                        </div>
                        <ProgressBar
                          now={Math.min(usageStats.menuViewPercentUsed, 100)}
                          variant={usageStats.menuViewPercentUsed >= 100 ? 'danger' :
                            usageStats.menuViewPercentUsed >= 80 ? 'warning' : 'info'}
                          style={{ height: '12px', borderRadius: '6px' }}
                        />
                        <p style={{ marginTop: '12px', marginBottom: 0, color: '#666', fontSize: '0.85rem' }}>
                          {usageStats.menuViewPercentUsed.toFixed(1)}% of your monthly menu view limit used
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Elder - Unlimited Notice */}
                  {usageStats.isUnlimited && (
                    <div style={{
                      padding: '24px',
                      background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                      borderRadius: '12px',
                      color: 'white',
                      textAlign: 'center',
                      marginBottom: '24px'
                    }}>
                      <i className="bi bi-infinity" style={{ fontSize: '3rem', marginBottom: '12px', display: 'block' }}></i>
                      <h4 style={{ margin: '0 0 8px' }}>Unlimited Orders</h4>
                      <p style={{ margin: 0, opacity: 0.9 }}>
                        Your Elder plan includes unlimited orders with no overage charges.
                      </p>
                    </div>
                  )}

                  {/* Hard Cap Notice for Scout - No overage, must upgrade */}
                  {usageStats.isHardCapped && (
                    <div style={{
                      padding: '24px',
                      background: usageStats.isOverLimit
                        ? 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)'
                        : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                      borderRadius: '12px',
                      color: 'white',
                      textAlign: 'center',
                      marginBottom: '24px'
                    }}>
                      <i className="bi bi-exclamation-triangle" style={{ fontSize: '2.5rem', marginBottom: '12px', display: 'block' }}></i>
                      {usageStats.isOverLimit ? (
                        <>
                          <h4 style={{ margin: '0 0 8px' }}>Order Limit Reached</h4>
                          <p style={{ margin: '0 0 16px', opacity: 0.9 }}>
                            You've reached the {tierLimits.limit} order limit on your Scout plan.
                            Upgrade now to continue taking orders.
                          </p>
                          <Button
                            variant="light"
                            onClick={() => document.querySelector('[data-section="subscription"]')?.click()}
                            style={{ fontWeight: 600 }}
                          >
                            <i className="bi bi-arrow-up-circle me-1"></i> Upgrade Now
                          </Button>
                        </>
                      ) : (
                        <>
                          <h4 style={{ margin: '0 0 8px' }}>Hard Order Cap</h4>
                          <p style={{ margin: 0, opacity: 0.9 }}>
                            Your Scout plan includes {tierLimits.limit} orders per month.
                            Orders will be blocked after reaching this limit.
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Overage Section - Only show for non-hard-capped tiers */}
                  {!usageStats.isUnlimited && !usageStats.isHardCapped && (
                    <div style={{ marginBottom: '24px' }}>
                      <h5 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="bi bi-exclamation-triangle" style={{ color: usageStats.isOverLimit ? '#dc3545' : '#f59e0b' }}></i>
                        Overage Charges
                      </h5>
                      <div style={{
                        padding: '20px',
                        background: usageStats.isOverLimit ? 'rgba(220, 53, 69, 0.05)' : '#f8fafc',
                        borderRadius: '12px',
                        border: `1px solid ${usageStats.isOverLimit ? 'rgba(220, 53, 69, 0.3)' : '#e5e7eb'}`
                      }}>
                        {usageStats.isOverLimit ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                              <div>
                                <span style={{ fontSize: '0.9rem', color: '#666' }}>Overage Orders</span>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc3545' }}>
                                  {usageStats.overageOrders.toLocaleString()}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '0.9rem', color: '#666' }}>Overage Rate</span>
                                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#666' }}>
                                  {(tierLimits.overageRate * 100).toFixed(1)}% per order
                                </div>
                              </div>
                            </div>
                            <div style={{
                              padding: '16px',
                              background: 'white',
                              borderRadius: '8px',
                              border: '1px solid rgba(220, 53, 69, 0.2)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <span style={{ fontWeight: 600, color: '#374151' }}>Total Overage Charges</span>
                              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#dc3545' }}>
                                ${usageStats.overageCharges.toFixed(2)}
                              </span>
                            </div>
                            <p style={{ marginTop: '12px', marginBottom: 0, fontSize: '0.85rem', color: '#666' }}>
                              <i className="bi bi-info-circle"></i> Overage charges will be billed at the end of your billing cycle.
                            </p>
                          </>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '12px' }}>
                            <i className="bi bi-check-circle-fill" style={{ fontSize: '2rem', color: '#22c55e', marginBottom: '12px', display: 'block' }}></i>
                            <p style={{ margin: 0, color: '#22c55e', fontWeight: 600 }}>No overage charges</p>
                            <p style={{ margin: '8px 0 0', color: '#666', fontSize: '0.85rem' }}>
                              You're within your {tierLimits.limit.toLocaleString()} order limit.
                              {usageStats.percentUsed >= 80 && (
                                <span style={{ color: '#f59e0b', display: 'block', marginTop: '8px' }}>
                                  <i className="bi bi-exclamation-triangle"></i> Approaching limit - consider upgrading!
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Upgrade CTA for non-Elder users */}
                  {tier !== 'elder' && (
                    <div style={{
                      padding: '20px',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      borderRadius: '12px',
                      color: 'white',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '16px'
                    }}>
                      <div>
                        <h5 style={{ margin: '0 0 4px', fontWeight: 700 }}>Need more orders?</h5>
                        <p style={{ margin: 0, opacity: 0.9, fontSize: '0.9rem' }}>
                          Upgrade your plan to increase your order limit and reduce overage rates.
                        </p>
                      </div>
                      <Button
                        variant="light"
                        onClick={() => setActiveSection('subscription')}
                        style={{ fontWeight: 600, whiteSpace: 'nowrap' }}
                      >
                        View Plans <i className="bi bi-arrow-right"></i>
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <i className="bi bi-graph-up" style={{ fontSize: '3rem', color: '#ccc', marginBottom: '16px', display: 'block' }}></i>
                  <p style={{ color: '#666' }}>No usage data available yet. Start processing orders to see your usage stats.</p>
                </div>
              )}
            </Card.Body>
          </Card>
        );

      case 'relay':
        const relayConfig = lanSyncService.getConfig();
        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-broadcast"></i> LAN Relay Settings</h3>
            </Card.Header>
            <Card.Body>
              <div style={{
                padding: '20px',
                background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)',
                borderRadius: '12px',
                marginBottom: '24px'
              }}>
                <h5 style={{ margin: '0 0 8px', fontWeight: 700 }}>Offline Order Sync</h5>
                <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>
                  When internet goes down, orders can still flow between POS, Kitchen, and Server devices
                  via your local network (WiFi). One device runs the relay server.
                </p>
              </div>

              <Form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const ip = formData.get('relayIp').trim();
                const port = parseInt(formData.get('relayPort')) || 8765;
                if (!ip) {
                  setError('Please enter the relay server IP address');
                  return;
                }
                lanSyncService.saveConfig(ip, port, true);
                setSuccess('LAN Relay configured and connecting...');
              }}>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontWeight: 600 }}>Relay Server IP Address</Form.Label>
                  <Form.Control
                    type="text"
                    name="relayIp"
                    defaultValue={relayConfig.relayIp || ''}
                    placeholder="e.g., 192.168.1.100"
                    style={{ fontSize: '1rem' }}
                  />
                  <Form.Text className="text-muted">
                    The IP address of the device running <code>node scripts/lan-relay.js</code>
                  </Form.Text>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label style={{ fontWeight: 600 }}>Port</Form.Label>
                  <Form.Control
                    type="number"
                    name="relayPort"
                    defaultValue={relayConfig.port || 8765}
                    style={{ fontSize: '1rem', maxWidth: '150px' }}
                  />
                </Form.Group>

                <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                  <Button type="submit" variant="primary" style={{ fontWeight: 600 }}>
                    <i className="bi bi-broadcast me-1"></i>
                    {lanSyncService.isConnected() ? 'Reconnect' : 'Connect'}
                  </Button>
                  {lanSyncService.isEnabled() && (
                    <Button
                      variant="outline-danger"
                      onClick={() => {
                        lanSyncService.disconnect();
                        setSuccess('LAN Relay disconnected');
                      }}
                      style={{ fontWeight: 600 }}
                    >
                      <i className="bi bi-x-circle me-1"></i>
                      Disconnect
                    </Button>
                  )}
                </div>
              </Form>

              <div style={{
                marginTop: '24px',
                padding: '16px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e5e7eb'
              }}>
                <h6 style={{ fontWeight: 700, marginBottom: '12px' }}>Connection Status</h6>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: lanSyncService.isConnected() ? '#22c55e' : '#dc3545',
                    display: 'inline-block',
                    boxShadow: lanSyncService.isConnected() ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none'
                  }}></span>
                  <span style={{ fontWeight: 600 }}>
                    {lanSyncService.isConnected() ? 'Connected to relay' : 'Not connected'}
                  </span>
                </div>
                {relayConfig.relayUrl && (
                  <p style={{ margin: '8px 0 0', color: '#666', fontSize: '0.85rem' }}>
                    URL: {relayConfig.relayUrl}
                  </p>
                )}
              </div>

              <div style={{
                marginTop: '24px',
                padding: '16px',
                background: 'rgba(245, 158, 11, 0.08)',
                borderRadius: '12px',
                border: '1px solid rgba(245, 158, 11, 0.2)'
              }}>
                <h6 style={{ fontWeight: 700, marginBottom: '8px' }}>
                  <i className="bi bi-terminal me-1"></i> How to start the relay server
                </h6>
                <p style={{ margin: '0 0 8px', color: '#555', fontSize: '0.85rem' }}>
                  On the POS computer (or a dedicated device), open a terminal and run:
                </p>
                <code style={{
                  display: 'block',
                  padding: '10px 14px',
                  background: '#1a1a2e',
                  color: '#a5b4fc',
                  borderRadius: '8px',
                  fontSize: '0.9rem'
                }}>
                  node scripts/lan-relay.js
                </code>
                <p style={{ margin: '12px 0 0', color: '#555', fontSize: '0.85rem' }}>
                  The relay will display its LAN IP address. Enter that IP above on all devices.
                </p>
              </div>
            </Card.Body>
          </Card>
        );

      case 'payment_account':
        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-stripe"></i> Payment Account</h3>
            </Card.Header>
            <Card.Body>
              <div style={{ maxWidth: '700px' }}>
                <p style={{ color: '#666', marginBottom: '24px', fontSize: '0.95rem' }}>
                  Connect your own Stripe account to receive payments directly from your customers.
                  If not connected, payments go through the Koda Carte platform.
                </p>

                {stripeConnectLoading && (
                  <div className="text-center py-4">
                    <Spinner animation="border" variant="primary" />
                    <p className="mt-2 text-muted">Checking Stripe connection...</p>
                  </div>
                )}

                {!stripeConnectLoading && stripeConnectStatus?.connected && (
                  <div>
                    <Alert variant="success" style={{ borderRadius: '12px' }}>
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-check-circle-fill" style={{ fontSize: '1.3rem' }}></i>
                        <div>
                          <strong>Stripe Account Connected</strong>
                          <br />
                          <span style={{ fontSize: '0.9rem' }}>
                            Payments from POS and online orders go directly to your Stripe account.
                          </span>
                        </div>
                      </div>
                    </Alert>

                    <div style={{
                      background: '#f8f9fa',
                      borderRadius: '12px',
                      padding: '20px',
                      marginTop: '16px'
                    }}>
                      <h6 style={{ fontWeight: 600, marginBottom: '12px' }}>Account Details</h6>
                      <Table borderless size="sm" style={{ marginBottom: 0 }}>
                        <tbody>
                          {stripeConnectStatus.businessName && (
                            <tr>
                              <td style={{ color: '#666', width: '160px' }}>Business Name</td>
                              <td style={{ fontWeight: 500 }}>{stripeConnectStatus.businessName}</td>
                            </tr>
                          )}
                          <tr>
                            <td style={{ color: '#666' }}>Status</td>
                            <td>
                              <Badge bg="success">Active</Badge>
                            </td>
                          </tr>
                          <tr>
                            <td style={{ color: '#666' }}>Charges</td>
                            <td>
                              {stripeConnectStatus.chargesEnabled
                                ? <Badge bg="success">Enabled</Badge>
                                : <Badge bg="warning">Pending</Badge>}
                            </td>
                          </tr>
                          <tr>
                            <td style={{ color: '#666' }}>Payouts</td>
                            <td>
                              {stripeConnectStatus.payoutsEnabled
                                ? <Badge bg="success">Enabled</Badge>
                                : <Badge bg="warning">Pending</Badge>}
                            </td>
                          </tr>
                        </tbody>
                      </Table>
                    </div>

                    <div className="mt-4">
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={handleDisconnectStripe}
                        disabled={stripeConnectLoading}
                      >
                        <i className="bi bi-x-circle me-1"></i>
                        Disconnect Stripe Account
                      </Button>
                    </div>
                  </div>
                )}

                {!stripeConnectLoading && stripeConnectStatus?.status === 'pending' && (
                  <div>
                    <Alert variant="warning" style={{ borderRadius: '12px' }}>
                      <div className="d-flex align-items-center gap-2">
                        <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '1.3rem' }}></i>
                        <div>
                          <strong>Setup Incomplete</strong>
                          <br />
                          <span style={{ fontSize: '0.9rem' }}>
                            Your Stripe account setup was started but not completed. Please finish the setup to start receiving payments.
                          </span>
                        </div>
                      </div>
                    </Alert>
                    <Button
                      variant="primary"
                      onClick={handleContinueStripeSetup}
                      disabled={stripeConnectLoading}
                      style={{
                        background: 'linear-gradient(135deg, #635BFF, #7B73FF)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '12px 24px',
                        fontWeight: 600
                      }}
                    >
                      {stripeConnectLoading ? (
                        <Spinner animation="border" size="sm" className="me-2" />
                      ) : (
                        <i className="bi bi-arrow-right-circle me-2"></i>
                      )}
                      Continue Stripe Setup
                    </Button>
                  </div>
                )}

                {!stripeConnectLoading && (!stripeConnectStatus || stripeConnectStatus.status === 'not_connected' || stripeConnectStatus.status === 'disconnected') && (
                  <div>
                    <div style={{
                      background: 'linear-gradient(135deg, #f0f0ff, #e8e5ff)',
                      borderRadius: '16px',
                      padding: '32px',
                      textAlign: 'center',
                      border: '1px solid #d4d0ff'
                    }}>
                      <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #635BFF, #7B73FF)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 16px'
                      }}>
                        <i className="bi bi-stripe" style={{ color: 'white', fontSize: '1.8rem' }}></i>
                      </div>
                      <h5 style={{ fontWeight: 700, marginBottom: '8px' }}>
                        Receive Payments Directly
                      </h5>
                      <p style={{ color: '#666', marginBottom: '24px', maxWidth: '400px', margin: '0 auto 24px' }}>
                        Connect your Stripe account to receive customer payments directly.
                        It only takes a few minutes to set up.
                      </p>
                      <Button
                        size="lg"
                        onClick={handleConnectStripe}
                        disabled={stripeConnectLoading}
                        style={{
                          background: 'linear-gradient(135deg, #635BFF, #7B73FF)',
                          border: 'none',
                          borderRadius: '10px',
                          padding: '14px 32px',
                          fontWeight: 600,
                          fontSize: '1rem',
                          boxShadow: '0 4px 14px rgba(99, 91, 255, 0.3)'
                        }}
                      >
                        {stripeConnectLoading ? (
                          <Spinner animation="border" size="sm" className="me-2" />
                        ) : (
                          <i className="bi bi-link-45deg me-2"></i>
                        )}
                        Connect Stripe Account
                      </Button>
                    </div>

                    {stripeConnectStatus?.status === 'disconnected' && (
                      <Alert variant="info" className="mt-3" style={{ borderRadius: '12px' }}>
                        <i className="bi bi-info-circle me-1"></i>
                        Your previous Stripe account was disconnected. You can connect a new one at any time.
                      </Alert>
                    )}

                    <div style={{
                      marginTop: '24px',
                      padding: '16px 20px',
                      background: '#f8f9fa',
                      borderRadius: '12px',
                      border: '1px solid #e9ecef'
                    }}>
                      <h6 style={{ fontWeight: 600, marginBottom: '12px' }}>
                        <i className="bi bi-question-circle me-1"></i> How it works
                      </h6>
                      <ul style={{ paddingLeft: '20px', marginBottom: 0, color: '#555', fontSize: '0.9rem' }}>
                        <li style={{ marginBottom: '8px' }}>
                          Click "Connect Stripe Account" to securely set up your Stripe account
                        </li>
                        <li style={{ marginBottom: '8px' }}>
                          You'll be redirected to Stripe to complete a quick verification
                        </li>
                        <li style={{ marginBottom: '8px' }}>
                          Once connected, all POS and online order payments go directly to your account
                        </li>
                        <li>
                          You can disconnect at any time — payments will revert to the Koda Carte platform
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </Card.Body>
          </Card>
        );

      case 'terminal': {
        const locationDone = terminalConfig?.configured;
        const readerDone = terminalReaders.length > 0;
        const currentStep = !locationDone ? 1 : !readerDone ? 2 : 3;

        const stepStyle = (num, done) => ({
          width: '36px', height: '36px', borderRadius: '50%', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem',
          flexShrink: 0,
          background: done ? '#28a745' : num === currentStep ? '#635BFF' : '#dee2e6',
          color: done || num === currentStep ? '#fff' : '#666',
          transition: 'all 0.3s'
        });

        const stepLine = (done) => ({
          width: '2px', height: '24px', margin: '4px auto',
          background: done ? '#28a745' : '#dee2e6', transition: 'all 0.3s'
        });

        return (
          <Card className="account-card">
            <Card.Header className="account-card-header">
              <h3><i className="bi bi-phone"></i> Stripe Terminal Setup</h3>
            </Card.Header>
            <Card.Body>
              <div style={{ maxWidth: '740px' }}>

                {terminalLoading && (
                  <div className="text-center py-4">
                    <Spinner animation="border" variant="primary" />
                    <p className="mt-2 text-muted">Loading terminal configuration...</p>
                  </div>
                )}

                {!terminalLoading && (
                  <div>
                    {/* ── Progress indicator ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px', padding: '16px 20px', background: '#f8f9fa', borderRadius: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={stepStyle(1, locationDone)}>
                          {locationDone ? <i className="bi bi-check-lg"></i> : '1'}
                        </div>
                        <div style={stepLine(locationDone)}></div>
                      </div>
                      <div style={{ flex: 1, marginBottom: '20px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Create Location</div>
                        <small style={{ color: '#888' }}>Restaurant address for Stripe</small>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={stepStyle(2, readerDone)}>
                          {readerDone ? <i className="bi bi-check-lg"></i> : '2'}
                        </div>
                        <div style={stepLine(readerDone)}></div>
                      </div>
                      <div style={{ flex: 1, marginBottom: '20px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Add Reader</div>
                        <small style={{ color: '#888' }}>Register your card reader</small>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={stepStyle(3, readerDone)}>
                          {readerDone ? <i className="bi bi-check-lg"></i> : '3'}
                        </div>
                        <div style={stepLine(readerDone)}></div>
                      </div>
                      <div style={{ flex: 1, marginBottom: '20px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Accept Payments</div>
                        <small style={{ color: '#888' }}>Use Terminal in POS</small>
                      </div>
                    </div>

                    {/* ══════════════════════════════════════ */}
                    {/* STEP 1 — Create Terminal Location     */}
                    {/* ══════════════════════════════════════ */}
                    <div style={{
                      border: currentStep === 1 ? '2px solid #635BFF' : '1px solid #e9ecef',
                      borderRadius: '14px', padding: '24px', marginBottom: '20px',
                      background: currentStep === 1 ? '#fafaff' : '#fff',
                      opacity: locationDone && currentStep !== 1 ? 0.85 : 1,
                      transition: 'all 0.3s'
                    }}>
                      <div className="d-flex align-items-start gap-3 mb-3">
                        <div style={stepStyle(1, locationDone)}>
                          {locationDone ? <i className="bi bi-check-lg"></i> : '1'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <h5 style={{ fontWeight: 700, marginBottom: '4px' }}>Create Your Terminal Location</h5>
                          <p style={{ color: '#666', marginBottom: 0, fontSize: '0.9rem' }}>
                            Enter your restaurant's physical address. Stripe needs this to associate your card readers with a location.
                          </p>
                        </div>
                      </div>

                      {locationDone && (
                        <Alert variant="success" className="mb-0" style={{ borderRadius: '10px' }}>
                          <i className="bi bi-check-circle-fill me-2"></i>
                          <strong>{terminalConfig.locationDisplayName}</strong>
                          {terminalConfig.address && (
                            <span style={{ color: '#555' }}>
                              {' '}&mdash; {terminalConfig.address.line1}, {terminalConfig.address.city}, {terminalConfig.address.state} {terminalConfig.address.postalCode}
                            </span>
                          )}
                        </Alert>
                      )}

                      {!locationDone && !showLocationForm && (
                        <Button
                          onClick={() => {
                            setShowLocationForm(true);
                            if (restaurantData) {
                              setTerminalLocationForm(prev => ({ ...prev, displayName: restaurantData.restaurantName || '' }));
                            }
                          }}
                          style={{ background: 'linear-gradient(135deg, #635BFF, #7B73FF)', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: 600 }}
                        >
                          <i className="bi bi-geo-alt me-2"></i> Enter Restaurant Address
                        </Button>
                      )}

                      {!locationDone && showLocationForm && (
                        <Form onSubmit={handleCreateTerminalLocation} className="mt-2">
                          <Form.Group className="mb-3">
                            <Form.Label>Location Name</Form.Label>
                            <Form.Control type="text" placeholder="e.g., Main Street Location" value={terminalLocationForm.displayName}
                              onChange={e => setTerminalLocationForm(prev => ({ ...prev, displayName: e.target.value }))} required />
                          </Form.Group>
                          <Form.Group className="mb-3">
                            <Form.Label>Street Address</Form.Label>
                            <Form.Control type="text" placeholder="123 Main St" value={terminalLocationForm.addressLine1}
                              onChange={e => setTerminalLocationForm(prev => ({ ...prev, addressLine1: e.target.value }))} required />
                          </Form.Group>
                          <div className="d-flex gap-3">
                            <Form.Group className="mb-3 flex-fill">
                              <Form.Label>City</Form.Label>
                              <Form.Control type="text" value={terminalLocationForm.city}
                                onChange={e => setTerminalLocationForm(prev => ({ ...prev, city: e.target.value }))} required />
                            </Form.Group>
                            <Form.Group className="mb-3" style={{ width: '100px' }}>
                              <Form.Label>State</Form.Label>
                              <Form.Control type="text" placeholder="CA" maxLength={2} value={terminalLocationForm.state}
                                onChange={e => setTerminalLocationForm(prev => ({ ...prev, state: e.target.value.toUpperCase() }))} required />
                            </Form.Group>
                            <Form.Group className="mb-3" style={{ width: '130px' }}>
                              <Form.Label>ZIP Code</Form.Label>
                              <Form.Control type="text" value={terminalLocationForm.postalCode}
                                onChange={e => setTerminalLocationForm(prev => ({ ...prev, postalCode: e.target.value }))} required />
                            </Form.Group>
                          </div>
                          <div className="d-flex gap-2">
                            <Button type="submit" disabled={terminalSaving}
                              style={{ background: 'linear-gradient(135deg, #635BFF, #7B73FF)', border: 'none', borderRadius: '8px', fontWeight: 600 }}>
                              {terminalSaving ? <><Spinner animation="border" size="sm" className="me-2" />Creating...</> : 'Create Location'}
                            </Button>
                            <Button variant="outline-secondary" onClick={() => setShowLocationForm(false)}>Cancel</Button>
                          </div>
                        </Form>
                      )}
                    </div>

                    {/* ══════════════════════════════════════ */}
                    {/* STEP 2 — Add a Card Reader             */}
                    {/* ══════════════════════════════════════ */}
                    <div style={{
                      border: currentStep === 2 ? '2px solid #635BFF' : '1px solid #e9ecef',
                      borderRadius: '14px', padding: '24px', marginBottom: '20px',
                      background: currentStep === 2 ? '#fafaff' : '#fff',
                      opacity: !locationDone ? 0.5 : 1,
                      pointerEvents: !locationDone ? 'none' : 'auto',
                      transition: 'all 0.3s'
                    }}>
                      <div className="d-flex align-items-start gap-3 mb-3">
                        <div style={stepStyle(2, readerDone)}>
                          {readerDone ? <i className="bi bi-check-lg"></i> : '2'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <h5 style={{ fontWeight: 700, marginBottom: '4px' }}>Add Your Card Reader</h5>
                          <p style={{ color: '#666', marginBottom: 0, fontSize: '0.9rem' }}>
                            Choose the option that matches your reader type. Don't have hardware yet? Use the simulated reader to test.
                          </p>
                        </div>
                        {readerDone && (
                          <Button variant="outline-primary" size="sm" onClick={() => { setShowReaderForm(true); setReaderAddMode(null); }}
                            style={{ borderRadius: '8px', flexShrink: 0 }}>
                            <i className="bi bi-plus me-1"></i> Add Another
                          </Button>
                        )}
                      </div>

                      {/* Registered readers table */}
                      {readerDone && (
                        <div className="mb-3">
                          <Table responsive hover size="sm" className="mb-2" style={{ borderRadius: '8px', overflow: 'hidden' }}>
                            <thead>
                              <tr style={{ background: '#f0f0f0' }}>
                                <th>Label</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {terminalReaders.map(reader => (
                                <tr key={reader.id}>
                                  <td style={{ fontWeight: 500 }}>{reader.label || '—'}</td>
                                  <td>
                                    <Badge bg="light" text="dark" style={{ fontSize: '0.75rem' }}>
                                      <i className={`bi ${(reader.connectionType || getReaderConnectionType(reader.deviceType)) === 'bluetooth' ? 'bi-bluetooth' : 'bi-wifi'} me-1`}></i>
                                      {reader.deviceType || 'unknown'}
                                    </Badge>
                                  </td>
                                  <td>
                                    <Badge bg={reader.status === 'online' ? 'success' : 'secondary'}>
                                      {reader.status || 'offline'}
                                    </Badge>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <Button variant="outline-danger" size="sm" onClick={() => handleDeleteReader(reader.id, reader.label)}>
                                      <i className="bi bi-trash"></i>
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                          <Button variant="link" size="sm" className="p-0 text-muted" onClick={handleRefreshReaders} disabled={terminalSaving}>
                            <i className="bi bi-arrow-clockwise me-1"></i> Refresh reader status
                          </Button>
                        </div>
                      )}

                      {/* Add reader panel */}
                      {!readerDone && !showReaderForm && (
                        <Button onClick={() => { setShowReaderForm(true); setReaderAddMode(null); }}
                          style={{ background: 'linear-gradient(135deg, #635BFF, #7B73FF)', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: 600 }}>
                          <i className="bi bi-plus-circle me-2"></i> Add Reader
                        </Button>
                      )}

                      {showReaderForm && (
                        <Card style={{ borderRadius: '12px', border: '1px solid #e0e0ff', background: '#fafaff' }} className="mt-2">
                          <Card.Body>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                              <h6 style={{ fontWeight: 600, marginBottom: 0 }}>Choose Your Reader Type</h6>
                              <Button variant="link" size="sm" className="text-muted p-0"
                                onClick={() => { setShowReaderForm(false); setReaderAddMode(null); setReaderRegistrationCode(''); setReaderLabel(''); }}>
                                <i className="bi bi-x-lg"></i>
                              </Button>
                            </div>

                            {/* ── Option picker ── */}
                            {!readerAddMode && (
                              <div>
                                {/* Smart reader (has screen) */}
                                <div onClick={() => setReaderAddMode('code')} style={{
                                  padding: '16px 20px', borderRadius: '10px', border: '1px solid #dee2e6',
                                  cursor: 'pointer', marginBottom: '10px', transition: 'all 0.2s', background: '#fff'
                                }} onMouseOver={e => { e.currentTarget.style.borderColor = '#635BFF'; e.currentTarget.style.background = '#f8f8ff'; }}
                                   onMouseOut={e => { e.currentTarget.style.borderColor = '#dee2e6'; e.currentTarget.style.background = '#fff'; }}>
                                  <div className="d-flex align-items-center gap-3">
                                    <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#f0f0ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <i className="bi bi-display" style={{ fontSize: '1.3rem', color: '#635BFF' }}></i>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <strong>My reader has a screen</strong>
                                      <br />
                                      <small style={{ color: '#888' }}>WisePOS E, Stripe Reader S700, Verifone P400 &mdash; shows a 3-word code on screen</small>
                                    </div>
                                    <i className="bi bi-chevron-right" style={{ color: '#aaa' }}></i>
                                  </div>
                                </div>

                                {/* Screenless reader */}
                                <div onClick={() => setReaderAddMode('screenless')} style={{
                                  padding: '16px 20px', borderRadius: '10px', border: '1px solid #dee2e6',
                                  cursor: 'pointer', marginBottom: '10px', transition: 'all 0.2s', background: '#fff'
                                }} onMouseOver={e => { e.currentTarget.style.borderColor = '#635BFF'; e.currentTarget.style.background = '#f8f8ff'; }}
                                   onMouseOut={e => { e.currentTarget.style.borderColor = '#dee2e6'; e.currentTarget.style.background = '#fff'; }}>
                                  <div className="d-flex align-items-center gap-3">
                                    <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#f0fff4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <i className="bi bi-bluetooth" style={{ fontSize: '1.3rem', color: '#28a745' }}></i>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <strong>Bluetooth reader (no screen)</strong>
                                      <br />
                                      <small style={{ color: '#888' }}>Stripe Reader M2, BBPOS Chipper, BBPOS WisePad &mdash; connects via Bluetooth, uses pairing code</small>
                                    </div>
                                    <i className="bi bi-chevron-right" style={{ color: '#aaa' }}></i>
                                  </div>
                                </div>

                                {/* Simulated / test */}
                                <div onClick={() => setReaderAddMode('simulated')} style={{
                                  padding: '16px 20px', borderRadius: '10px', border: '1px solid #dee2e6',
                                  cursor: 'pointer', transition: 'all 0.2s', background: '#fff'
                                }} onMouseOver={e => { e.currentTarget.style.borderColor = '#fd7e14'; e.currentTarget.style.background = '#fffaf5'; }}
                                   onMouseOut={e => { e.currentTarget.style.borderColor = '#dee2e6'; e.currentTarget.style.background = '#fff'; }}>
                                  <div className="d-flex align-items-center gap-3">
                                    <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#fff8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <i className="bi bi-bug" style={{ fontSize: '1.3rem', color: '#fd7e14' }}></i>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <strong>I don't have hardware yet</strong> <Badge bg="warning" text="dark" style={{ fontSize: '0.6rem', verticalAlign: 'middle' }}>TEST</Badge>
                                      <br />
                                      <small style={{ color: '#888' }}>Create a virtual simulated reader to test the full payment flow</small>
                                    </div>
                                    <i className="bi bi-chevron-right" style={{ color: '#aaa' }}></i>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* ── Smart reader: registration code ── */}
                            {readerAddMode === 'code' && (
                              <div>
                                <Alert variant="light" style={{ borderRadius: '10px', border: '1px solid #e0e0ff', background: '#f8f8ff' }}>
                                  <strong>Follow these steps on your reader:</strong>
                                  <ol style={{ marginBottom: 0, marginTop: '8px', paddingLeft: '18px', fontSize: '0.9rem' }}>
                                    <li>Plug in and power on your reader</li>
                                    <li>Connect it to your Wi-Fi network (the reader screen will guide you)</li>
                                    <li>Once connected, the reader displays a <strong>3-word code</strong> like <code style={{ background: '#e8e5ff', padding: '2px 6px', borderRadius: '4px' }}>sepia-cerulean-deacon</code></li>
                                    <li>Type that code below and click Register</li>
                                  </ol>
                                </Alert>
                                <Form onSubmit={handleRegisterReader}>
                                  <Form.Group className="mb-3">
                                    <Form.Label><strong>Registration Code</strong></Form.Label>
                                    <Form.Control type="text" placeholder="word-word-word" value={readerRegistrationCode}
                                      onChange={e => setReaderRegistrationCode(e.target.value)} required
                                      style={{ fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '0.5px', padding: '12px' }} />
                                  </Form.Group>
                                  <Form.Group className="mb-3">
                                    <Form.Label>Reader Label <span className="text-muted">(optional &mdash; helps identify it later)</span></Form.Label>
                                    <Form.Control type="text" placeholder="e.g., Front Counter, Bar, Patio" value={readerLabel}
                                      onChange={e => setReaderLabel(e.target.value)} />
                                  </Form.Group>
                                  <div className="d-flex gap-2">
                                    <Button type="submit" disabled={terminalSaving}
                                      style={{ background: 'linear-gradient(135deg, #635BFF, #7B73FF)', border: 'none', borderRadius: '8px', fontWeight: 600, padding: '10px 24px' }}>
                                      {terminalSaving ? <><Spinner animation="border" size="sm" className="me-2" />Registering...</> : <><i className="bi bi-check-circle me-1"></i> Register Reader</>}
                                    </Button>
                                    <Button variant="outline-secondary" onClick={() => { setReaderAddMode(null); setReaderRegistrationCode(''); setReaderLabel(''); }}>Back</Button>
                                  </div>
                                </Form>
                              </div>
                            )}

                            {/* ── Screenless reader: step-by-step guide ── */}
                            {readerAddMode === 'screenless' && (
                              <div>
                                <Alert variant="light" style={{ borderRadius: '10px', border: '1px solid #d4edda', background: '#f0fff4' }}>
                                  <strong><i className="bi bi-bluetooth me-1"></i>Bluetooth readers are registered using the serial number on the device.</strong>
                                  <p style={{ marginTop: '8px', marginBottom: '8px', fontSize: '0.9rem', color: '#555' }}>
                                    Follow these steps &mdash; it only takes a couple of minutes:
                                  </p>
                                  <ol style={{ marginBottom: 0, paddingLeft: '18px', fontSize: '0.9rem' }}>
                                    <li style={{ marginBottom: '10px' }}>
                                      <strong>Find the serial number</strong> &mdash; printed on a label on the back of your reader (e.g., <code style={{ background: '#e8f5e9', padding: '2px 6px', borderRadius: '4px' }}>STRM2DXXXXXXX</code>).
                                    </li>
                                    <li style={{ marginBottom: '10px' }}>
                                      <strong>Make sure your Stripe account is in Live mode</strong> &mdash; physical readers cannot be registered in test mode.
                                      <br />
                                      <small style={{ color: '#dc3545' }}>
                                        <i className="bi bi-exclamation-triangle me-1"></i>
                                        If you see "No registerable readers" when entering the serial number, you are still in test mode. Toggle to <strong>Live mode</strong> in the Stripe Dashboard.
                                      </small>
                                    </li>
                                    <li style={{ marginBottom: '10px' }}>
                                      <strong>Open the Stripe Dashboard:</strong>
                                      <br />
                                      <a href="https://dashboard.stripe.com/terminal/readers" target="_blank" rel="noopener noreferrer"
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '6px', padding: '8px 16px',
                                          background: '#635BFF', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem' }}>
                                        <i className="bi bi-box-arrow-up-right"></i> Open Stripe Terminal Readers
                                      </a>
                                    </li>
                                    <li style={{ marginBottom: '10px' }}>
                                      In the Stripe Dashboard, click <strong>"+ Register reader"</strong>
                                      <ul style={{ marginTop: '4px', paddingLeft: '18px', color: '#666' }}>
                                        <li>Choose the location you created in Step 1</li>
                                        <li>Select <strong>"Serial number"</strong> as the registration method</li>
                                        <li>Enter the serial number from the back of the reader and submit</li>
                                      </ul>
                                    </li>
                                    <li style={{ marginBottom: '10px' }}>
                                      <strong>Power on your reader</strong> and install the <strong>Stripe Terminal</strong> app on your phone/tablet. Pair the reader to your phone via Bluetooth in the app.
                                    </li>
                                    <li style={{ marginBottom: '4px' }}>
                                      <strong>Come back here</strong> and click the button below to sync:
                                    </li>
                                  </ol>
                                </Alert>
                                <Alert variant="warning" style={{ borderRadius: '10px', fontSize: '0.85rem' }}>
                                  <i className="bi bi-info-circle me-1"></i>
                                  <strong>Important:</strong> During payment processing, the Stripe Terminal mobile app must be running on your phone and paired with the reader via Bluetooth. The app bridges the reader's Bluetooth connection to the internet.
                                </Alert>
                                <div className="d-flex gap-2">
                                  <Button variant="success" onClick={async () => { await handleRefreshReaders(); setShowReaderForm(false); setReaderAddMode(null); }}
                                    disabled={terminalSaving}
                                    style={{ borderRadius: '8px', fontWeight: 600, padding: '10px 24px' }}>
                                    {terminalSaving ? <><Spinner animation="border" size="sm" className="me-2" />Syncing...</> : <><i className="bi bi-arrow-repeat me-1"></i> Sync Readers from Stripe</>}
                                  </Button>
                                  <Button variant="outline-secondary" onClick={() => setReaderAddMode(null)}>Back</Button>
                                </div>
                              </div>
                            )}

                            {/* ── Simulated reader ── */}
                            {readerAddMode === 'simulated' && (
                              <div>
                                <Alert variant="light" style={{ borderRadius: '10px', border: '1px solid #ffecd2', background: '#fffaf5' }}>
                                  <strong>This is for testing only.</strong>
                                  <p style={{ marginTop: '8px', marginBottom: 0, fontSize: '0.9rem', color: '#555' }}>
                                    A simulated reader behaves exactly like a real one &mdash; it appears in POS and Payments, and accepts test card payments.
                                    No physical hardware needed. The simulated reader auto-accepts a test card when you process a payment.
                                  </p>
                                </Alert>
                                <div className="d-flex gap-2">
                                  <Button variant="warning" onClick={handleCreateSimulatedReader} disabled={terminalSaving}
                                    style={{ borderRadius: '8px', fontWeight: 600, padding: '10px 24px' }}>
                                    {terminalSaving ? <><Spinner animation="border" size="sm" className="me-2" />Creating...</> : <><i className="bi bi-bug me-1"></i> Create Simulated Reader</>}
                                  </Button>
                                  <Button variant="outline-secondary" onClick={() => setReaderAddMode(null)}>Back</Button>
                                </div>
                              </div>
                            )}
                          </Card.Body>
                        </Card>
                      )}
                    </div>

                    {/* ══════════════════════════════════════ */}
                    {/* STEP 3 — Ready to accept payments     */}
                    {/* ══════════════════════════════════════ */}
                    <div style={{
                      border: readerDone ? '2px solid #28a745' : '1px solid #e9ecef',
                      borderRadius: '14px', padding: '24px',
                      background: readerDone ? '#f0fff4' : '#fff',
                      opacity: !readerDone ? 0.5 : 1,
                      transition: 'all 0.3s'
                    }}>
                      <div className="d-flex align-items-start gap-3">
                        <div style={stepStyle(3, readerDone)}>
                          {readerDone ? <i className="bi bi-check-lg"></i> : '3'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <h5 style={{ fontWeight: 700, marginBottom: '4px' }}>Accept Payments</h5>
                          {readerDone ? (
                            <div>
                              <p style={{ color: '#28a745', fontWeight: 600, marginBottom: '12px', fontSize: '0.95rem' }}>
                                You're all set! Terminal payments are now available.
                              </p>
                              <div style={{ background: '#fff', border: '1px solid #d4edda', borderRadius: '10px', padding: '16px' }}>
                                <p style={{ fontWeight: 600, marginBottom: '8px', fontSize: '0.9rem' }}>How to use it:</p>
                                <ol style={{ paddingLeft: '18px', marginBottom: 0, color: '#555', fontSize: '0.9rem' }}>
                                  <li style={{ marginBottom: '6px' }}>
                                    Go to <strong>POS</strong> (for counter/food truck) or <strong>Payments</strong> (for table service)
                                  </li>
                                  <li style={{ marginBottom: '6px' }}>
                                    Add items and proceed to payment &mdash; you'll see a <strong style={{ color: '#635BFF' }}>Terminal</strong> button alongside Cash and Card
                                  </li>
                                  <li style={{ marginBottom: '6px' }}>
                                    Tap <strong style={{ color: '#635BFF' }}>Terminal</strong>, then <strong>Charge Terminal</strong>
                                  </li>
                                  <li>
                                    The reader will light up &mdash; ask the customer to tap, insert, or swipe their card. Done!
                                  </li>
                                </ol>
                                {terminalReaders.some(r => (r.connectionType || getReaderConnectionType(r.deviceType)) === 'bluetooth') && (
                                  <Alert variant="info" className="mt-3 mb-0" style={{ borderRadius: '8px', fontSize: '0.85rem' }}>
                                    <i className="bi bi-bluetooth me-1"></i>
                                    <strong>Bluetooth reader tip:</strong> Make sure your reader is powered on and the Stripe Terminal mobile app is running on your phone before processing payments.
                                  </Alert>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p style={{ color: '#999', marginBottom: 0, fontSize: '0.9rem' }}>
                              Complete steps 1 and 2 above to start accepting terminal payments.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card.Body>
          </Card>
        );
      }

      case 'access_control':
        return <AccessControl />;

      default:
        return null;
    }
  };

  return (
    <Container fluid className="account-container">
      {/* Hero Header */}
      <div className="account-hero">
        <div className="hero-content">
          <h1>Account Management</h1>
          <p>Manage your account details and preferences</p>
        </div>
      </div>

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

      <div className="account-layout">
        {/* Sidebar Navigation */}
        <div className="account-sidebar">
          <nav className="account-nav">
            <button
              className={`account-nav-item ${activeSection === 'account' ? 'active' : ''}`}
              onClick={() => setActiveSection('account')}
            >
              <i className="bi bi-person-circle"></i>
              <span>Account Details</span>
            </button>
            <button
              className={`account-nav-item ${activeSection === 'service_mode' ? 'active' : ''}`}
              onClick={() => setActiveSection('service_mode')}
            >
              <i className="bi bi-shop"></i>
              <span>Service Mode</span>
            </button>
            <button
              className={`account-nav-item ${activeSection === 'subscription' ? 'active' : ''}`}
              onClick={() => setActiveSection('subscription')}
            >
              <i className="bi bi-credit-card-2-front"></i>
              <span>Subscription</span>
            </button>
            <button
              className={`account-nav-item ${activeSection === 'security' ? 'active' : ''}`}
              onClick={() => setActiveSection('security')}
            >
              <i className="bi bi-shield-lock"></i>
              <span>Security</span>
            </button>
            <button
              className={`account-nav-item ${activeSection === 'pin' ? 'active' : ''}`}
              onClick={() => setActiveSection('pin')}
            >
              <i className="bi bi-key"></i>
              <span>Reimbursement PIN</span>
            </button>
            <button
              className={`account-nav-item ${activeSection === 'payment_account' ? 'active' : ''}`}
              onClick={() => setActiveSection('payment_account')}
              data-section="payment_account"
            >
              <i className="bi bi-stripe"></i>
              <span>Payment Account</span>
              {stripeConnectStatus?.connected && (
                <Badge bg="success" style={{ marginLeft: '8px', fontSize: '0.65rem' }}>Connected</Badge>
              )}
            </button>
            <button
              className={`account-nav-item ${activeSection === 'terminal' ? 'active' : ''}`}
              onClick={() => setActiveSection('terminal')}
            >
              <i className="bi bi-phone"></i>
              <span>Stripe Terminal</span>
              {terminalConfig?.configured && (
                <Badge bg="success" style={{ marginLeft: '8px', fontSize: '0.65rem' }}>Active</Badge>
              )}
            </button>
            <button
              className={`account-nav-item ${activeSection === 'access_control' ? 'active' : ''}`}
              onClick={() => setActiveSection('access_control')}
            >
              <i className="bi bi-shield-check"></i>
              <span>Staff Access Control</span>
            </button>
            {isMultiLocation && (
              <button
                className={`account-nav-item ${activeSection === 'locations' ? 'active' : ''}`}
                onClick={() => setActiveSection('locations')}
              >
                <i className="bi bi-geo-alt"></i>
                <span>Locations</span>
              </button>
            )}
            <button
              className={`account-nav-item ${activeSection === 'usage' ? 'active' : ''}`}
              onClick={() => setActiveSection('usage')}
            >
              <i className="bi bi-graph-up"></i>
              <span>Usage</span>
              {usageStats?.isOverLimit && (
                <Badge bg="danger" style={{ marginLeft: '8px', fontSize: '0.7rem' }}>!</Badge>
              )}
            </button>
            <button
              className={`account-nav-item ${activeSection === 'relay' ? 'active' : ''}`}
              onClick={() => setActiveSection('relay')}
            >
              <i className="bi bi-broadcast"></i>
              <span>LAN Relay</span>
            </button>
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="account-main-content">
          {renderSectionContent()}
        </div>
      </div>

      {/* Location Modal */}
      <Modal show={showLocationModal} onHide={() => setShowLocationModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>{editingLocation ? 'Edit Location' : 'Add New Location'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Location Name</Form.Label>
              <Form.Control
                type="text"
                value={locationForm.name}
                onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                placeholder="e.g., Downtown Location, Airport Branch"
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Address</Form.Label>
              <AddressAutocomplete
                value={locationForm.address}
                onChange={(value) => setLocationForm({ ...locationForm, address: value })}
                onSelect={(addressData) => {
                  setLocationForm({ ...locationForm, address: addressData.fullAddress });
                }}
                placeholder="Enter location address"
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowLocationModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (!locationForm.name.trim()) {
                setError('Location name is required');
                return;
              }
              try {
                setSaving(true);
                if (editingLocation) {
                  await updateDoc(doc(db, `restaurants/${currentUser.uid}/locations/${editingLocation.id}`), {
                    name: locationForm.name,
                    address: locationForm.address,
                    updatedAt: new Date().toISOString()
                  });
                  setSuccess('Location updated successfully');
                } else {
                  await addDoc(collection(db, `restaurants/${currentUser.uid}/locations`), {
                    name: locationForm.name,
                    address: locationForm.address,
                    createdAt: new Date().toISOString()
                  });
                  setSuccess('Location added successfully');
                }
                setShowLocationModal(false);
                loadRestaurantData();
                // Reload locations
                const locationsRef = collection(db, `restaurants/${currentUser.uid}/locations`);
                const locationsSnap = await getDocs(locationsRef);
                const locationsData = locationsSnap.docs.map(doc => ({
                  id: doc.id,
                  ...doc.data()
                }));
                setLocationList(locationsData);
              } catch (error) {
                setError('Failed to save location: ' + error.message);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
          >
            {saving ? 'Saving...' : (editingLocation ? 'Update' : 'Add')} Location
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Plan Change Modal */}
      <Modal
        show={showPlanModal}
        onHide={() => {
          setShowPlanModal(false);
          setPendingPlanChange(null);
        }}
        centered
        className="plan-change-modal"
      >
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          borderRadius: '16px',
          overflow: 'hidden',
          border: 'none'
        }}>
          {/* Modal Header with Glow Effect */}
          <div style={{
            position: 'relative',
            padding: '32px 32px 24px',
            textAlign: 'center',
            overflow: 'hidden'
          }}>
            {/* Background Glow */}
            <div style={{
              position: 'absolute',
              top: '-50%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '300px',
              height: '300px',
              background: pendingPlanChange?.isUpgrade
                ? 'radial-gradient(circle, rgba(34, 197, 94, 0.3) 0%, transparent 70%)'
                : 'radial-gradient(circle, rgba(102, 126, 234, 0.3) 0%, transparent 70%)',
              pointerEvents: 'none'
            }} />

            {/* Icon */}
            <div style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 20px',
              background: pendingPlanChange?.isUpgrade
                ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: pendingPlanChange?.isUpgrade
                ? '0 8px 32px rgba(34, 197, 94, 0.4)'
                : '0 8px 32px rgba(102, 126, 234, 0.4)',
              position: 'relative',
              zIndex: 1
            }}>
              <i
                className={`bi ${pendingPlanChange?.isUpgrade ? 'bi-rocket-takeoff-fill' : pendingPlanChange?.type === 'billing' ? 'bi-calendar-check-fill' : 'bi-arrow-down-circle-fill'}`}
                style={{ fontSize: '36px', color: 'white' }}
              />
            </div>

            {/* Title */}
            <h3 style={{
              color: 'white',
              fontSize: '1.5rem',
              fontWeight: 800,
              margin: '0 0 8px',
              position: 'relative',
              zIndex: 1
            }}>
              {pendingPlanChange?.type === 'billing'
                ? 'Change Billing Cycle'
                : pendingPlanChange?.isUpgrade
                  ? 'Upgrade Your Plan'
                  : 'Downgrade Plan'}
            </h3>
            <p style={{
              color: 'rgba(255, 255, 255, 0.7)',
              margin: 0,
              fontSize: '0.95rem',
              position: 'relative',
              zIndex: 1
            }}>
              {pendingPlanChange?.type === 'billing'
                ? 'Review your new billing cycle'
                : `You're about to ${pendingPlanChange?.action} to ${TIER_FEATURES[pendingPlanChange?.newTier]?.name}`}
            </p>
          </div>

          {/* Plan Details Card */}
          <div style={{ padding: '0 32px 24px' }}>
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '16px',
              padding: '24px',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              {/* New Plan Info */}
              {pendingPlanChange?.type === 'plan' && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  marginBottom: '20px',
                  paddingBottom: '20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                  <div style={{
                    width: '56px',
                    height: '56px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '28px'
                  }}>
                    {TIER_FEATURES[pendingPlanChange?.newTier]?.icon}
                  </div>
                  <div>
                    <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.8rem', marginBottom: '2px' }}>
                      New Plan
                    </div>
                    <div style={{ color: 'white', fontSize: '1.25rem', fontWeight: 700 }}>
                      {TIER_FEATURES[pendingPlanChange?.newTier]?.name}
                    </div>
                  </div>
                </div>
              )}

              {/* Pricing Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.9rem' }}>Billing Cycle</span>
                  <span style={{
                    color: 'white',
                    fontWeight: 600,
                    background: 'rgba(102, 126, 234, 0.2)',
                    padding: '4px 12px',
                    borderRadius: '8px',
                    fontSize: '0.85rem'
                  }}>
                    {pendingPlanChange?.cycleLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.9rem' }}>Price per Location</span>
                  <span style={{ color: 'white', fontWeight: 600 }}>${pendingPlanChange?.newPrice}/mo</span>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  marginTop: '4px'
                }}>
                  <span style={{ color: 'white', fontSize: '1rem', fontWeight: 600 }}>Total Monthly</span>
                  <span style={{
                    color: pendingPlanChange?.isUpgrade ? '#22c55e' : '#a5b4fc',
                    fontWeight: 800,
                    fontSize: '1.5rem'
                  }}>
                    ${(parseFloat(pendingPlanChange?.newPrice || 0) * (subscription?.locationCount || 1)).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Info Note */}
            <div style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: 'rgba(245, 158, 11, 0.1)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              border: '1px solid rgba(245, 158, 11, 0.2)'
            }}>
              <i className="bi bi-info-circle-fill" style={{ color: '#f59e0b', marginTop: '2px' }} />
              <p style={{
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '0.8rem',
                margin: 0,
                lineHeight: 1.5
              }}>
                {pendingPlanChange?.isUpgrade
                  ? 'You will be charged the prorated difference for the remainder of your current billing period.'
                  : 'Your new rate will apply at the start of your next billing period.'}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{
            padding: '20px 32px 32px',
            display: 'flex',
            gap: '12px'
          }}>
            <Button
              variant="outline-light"
              onClick={() => {
                setShowPlanModal(false);
                setPendingPlanChange(null);
              }}
              style={{
                flex: 1,
                padding: '14px',
                borderRadius: '12px',
                fontWeight: 600,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.8)'
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // Call the confirm function from subscription section
                const confirmBtn = document.getElementById('confirm-plan-change-btn');
                if (confirmBtn) confirmBtn.click();
              }}
              disabled={saving}
              style={{
                flex: 2,
                padding: '14px',
                borderRadius: '12px',
                fontWeight: 700,
                border: 'none',
                background: pendingPlanChange?.isUpgrade
                  ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                  : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                boxShadow: pendingPlanChange?.isUpgrade
                  ? '0 4px 20px rgba(34, 197, 94, 0.4)'
                  : '0 4px 20px rgba(102, 126, 234, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" />
                  Processing...
                </>
              ) : (
                <>
                  <i className={`bi ${pendingPlanChange?.isUpgrade ? 'bi-rocket-takeoff' : 'bi-check-lg'}`} />
                  {pendingPlanChange?.type === 'billing'
                    ? 'Confirm Change'
                    : pendingPlanChange?.isUpgrade
                      ? 'Upgrade Now'
                      : 'Confirm Downgrade'}
                </>
              )}
            </Button>
          </div>
        </div>
        {/* Hidden button to trigger confirm from inside the subscription section */}
        <button
          id="confirm-plan-change-btn"
          style={{ display: 'none' }}
          onClick={async () => {
            if (!pendingPlanChange) return;
            try {
              setSaving(true);
              setShowPlanModal(false);
              if (pendingPlanChange.type === 'billing') {
                await updateDoc(doc(db, 'restaurants', currentUser.uid), {
                  'subscription.billingCycle': pendingPlanChange.newCycle,
                  'subscription.updatedAt': new Date().toISOString()
                });
                setSuccess(`Billing cycle changed to ${pendingPlanChange.cycleLabel}!`);
              } else {
                await updateDoc(doc(db, 'restaurants', currentUser.uid), {
                  'subscription.tier': pendingPlanChange.newTier,
                  'subscription.billingCycle': pendingPlanChange.newCycle,
                  'subscription.updatedAt': new Date().toISOString()
                });
                const actionText = pendingPlanChange.action === 'update billing for' ? 'updated' : pendingPlanChange.action + 'd';
                setSuccess(`Successfully ${actionText} to ${TIER_FEATURES[pendingPlanChange.newTier].name} plan!`);
              }
            } catch (error) {
              setError(`Failed to ${pendingPlanChange.action}: ${error.message}`);
            } finally {
              setSaving(false);
              setPendingPlanChange(null);
            }
          }}
        />
      </Modal>
    </Container>
  );
};

export default Account;
