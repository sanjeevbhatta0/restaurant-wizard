import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Container, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import AddressAutocomplete from './AddressAutocomplete';
import './Account.css';

const Account = () => {
  const { currentUser } = useAuth();
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
  
  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);

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

  if (loading) {
    return (
      <div className="account-loading">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

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

      <div className="account-content-grid">
        {/* Account Details Card */}
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
                    // Optionally store structured address data
                    setAddress(addressData.fullAddress);
                  }}
                  placeholder="Start typing your restaurant address..."
                />
                <Form.Text className="text-muted">
                  Start typing to see address suggestions. Select an address from the dropdown.
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
          </Card.Body>
        </Card>

        {/* Password Change Card */}
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
                  <Form.Control
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="Enter your current password"
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>New Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="Enter new password (min 6 characters)"
                    minLength={6}
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Confirm New Password</Form.Label>
                  <Form.Control
                    type="password"
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
      </div>
    </Container>
  );
};

export default Account;
