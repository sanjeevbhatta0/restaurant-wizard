import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, collection, addDoc, deleteDoc, getDocs, setDoc } from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Container, Card, Form, Button, Alert, Spinner, Modal, Table, Badge } from 'react-bootstrap';
import AddressAutocomplete from './AddressAutocomplete';
import './Account.css';

const Account = () => {
  const { currentUser } = useAuth();
  const { isMultiLocation, locations, loadRestaurantData } = useLocation();
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

  // Location management
  const [locationList, setLocationList] = useState([]);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [locationForm, setLocationForm] = useState({ name: '', address: '' });

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

        {/* Location Management Card - Only for Multi-Location */}
        {isMultiLocation && (
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
        )}

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
      </div>
    </Container>
  );
};

export default Account;
