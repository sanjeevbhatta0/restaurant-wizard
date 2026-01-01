import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, collection, addDoc, deleteDoc, getDocs, setDoc } from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider, signOut } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { useNavigate } from 'react-router-dom';
import { Container, Card, Form, Button, Alert, Spinner, Modal, Table, Badge } from 'react-bootstrap';
import AddressAutocomplete from './AddressAutocomplete';
import PasswordInput from './PasswordInput';
import activityService from '../services/activityService';
import './Account.css';

const Account = () => {
  const { currentUser } = useAuth();
  const { isMultiLocation, locations, loadRestaurantData } = useLocation();
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

  // Sidebar navigation
  const [activeSection, setActiveSection] = useState('account');

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
          setHasPin(!!data.reimbursementPin);
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
            {isMultiLocation && (
              <button
                className={`account-nav-item ${activeSection === 'locations' ? 'active' : ''}`}
                onClick={() => setActiveSection('locations')}
              >
                <i className="bi bi-geo-alt"></i>
                <span>Locations</span>
              </button>
            )}
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
    </Container>
  );
};

export default Account;
