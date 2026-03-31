import React, { useState, useEffect, useCallback } from 'react';
import { Card, Form, Button, Alert, Spinner, Table, Badge, Modal } from 'react-bootstrap';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import PasswordInput from './PasswordInput';

const PERMISSION_OPTIONS = [
  { key: 'home', label: 'Home', icon: 'bi-house' },
  { key: 'analytics', label: 'Analytics', icon: 'bi-bar-chart' },
  { key: 'menu-management', label: 'Menu Management', icon: 'bi-menu-button-wide' },
  { key: 'pos', label: 'POS', icon: 'bi-cash-coin' },
  { key: 'kitchen', label: 'Kitchen', icon: 'bi-egg-fried' },
  { key: 'server', label: 'Server', icon: 'bi-person-badge' },
  { key: 'table-layout', label: 'Table Layout', icon: 'bi-grid-3x3-gap' },
  { key: 'payments', label: 'Payments', icon: 'bi-credit-card' },
  { key: 'orders', label: 'Orders', icon: 'bi-cart' },
  { key: 'promotions', label: 'Promotions', icon: 'bi-gift' },
  { key: 'seo-social', label: 'SEO & Social', icon: 'bi-share' },
  { key: 'website-integration', label: 'Website Integration', icon: 'bi-code-slash' },
  { key: 'website-builder', label: 'Website Builder', icon: 'bi-brush' }
];

const AccessControl = () => {
  const { currentUser } = useAuth();
  const functions = getFunctions();

  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);

  // Form state
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formPermissions, setFormPermissions] = useState([]);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Load staff accounts
  useEffect(() => {
    if (!currentUser) return;

    const staffRef = collection(db, `restaurants/${currentUser.uid}/staffAccounts`);
    const q = query(staffRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaffList(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const resetForm = useCallback(() => {
    setFormUsername('');
    setFormPassword('');
    setFormDisplayName('');
    setFormPermissions([]);
    setEditingStaff(null);
  }, []);

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (staff) => {
    setEditingStaff(staff);
    setFormUsername(staff.username);
    setFormPassword('');
    setFormDisplayName(staff.displayName);
    setFormPermissions(staff.permissions || []);
    setShowModal(true);
  };

  const togglePermission = (key) => {
    setFormPermissions(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  };

  const selectAllPermissions = () => {
    setFormPermissions(PERMISSION_OPTIONS.map(p => p.key));
  };

  const clearAllPermissions = () => {
    setFormPermissions([]);
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (!formDisplayName.trim()) {
      setError('Display name is required');
      return;
    }
    if (formPermissions.length === 0) {
      setError('Select at least one permission');
      return;
    }

    setSaving(true);
    try {
      if (editingStaff) {
        // Update existing
        const updateFn = httpsCallable(functions, 'updateStaffAccount');
        const payload = {
          staffId: editingStaff.id,
          displayName: formDisplayName.trim(),
          permissions: formPermissions
        };
        if (formPassword) {
          payload.newPassword = formPassword;
        }
        await updateFn(payload);
        setSuccess(`Staff account "${editingStaff.username}" updated`);
      } else {
        // Create new
        if (!formUsername.trim()) {
          setError('Username is required');
          setSaving(false);
          return;
        }
        if (!formPassword || formPassword.length < 6) {
          setError('Password must be at least 6 characters');
          setSaving(false);
          return;
        }
        const createFn = httpsCallable(functions, 'createStaffAccount');
        await createFn({
          username: formUsername.trim(),
          password: formPassword,
          displayName: formDisplayName.trim(),
          permissions: formPermissions
        });
        setSuccess(`Staff account "${formUsername.trim()}" created`);
      }
      setShowModal(false);
      resetForm();
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    setSaving(true);
    try {
      const deleteFn = httpsCallable(functions, 'deleteStaffAccount');
      await deleteFn({ staffId: deleteTarget.id });
      setSuccess(`Staff account "${deleteTarget.username}" deleted`);
      setDeleteTarget(null);
    } catch (err) {
      setError(err.message || 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (staff) => {
    setError('');
    try {
      const updateFn = httpsCallable(functions, 'updateStaffAccount');
      await updateFn({ staffId: staff.id, active: !staff.active });
    } catch (err) {
      setError(err.message || 'Failed to toggle status');
    }
  };

  if (loading) {
    return (
      <Card className="account-card">
        <Card.Header className="account-card-header">
          <h3><i className="bi bi-shield-check"></i> Staff Access Control</h3>
        </Card.Header>
        <Card.Body className="text-center py-5">
          <Spinner animation="border" variant="primary" />
        </Card.Body>
      </Card>
    );
  }

  return (
    <>
      <Card className="account-card">
        <Card.Header className="account-card-header">
          <h3><i className="bi bi-shield-check"></i> Staff Access Control</h3>
        </Card.Header>
        <Card.Body>
          {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
          {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

          <div className="d-flex justify-content-between align-items-center mb-3">
            <p className="text-muted mb-0" style={{ fontSize: '0.9rem' }}>
              Create accounts for your staff with limited access to specific features.
            </p>
            <Button variant="primary" size="sm" onClick={openCreateModal}>
              <i className="bi bi-plus-lg me-1"></i>Add Staff
            </Button>
          </div>

          {staffList.length === 0 ? (
            <div className="text-center py-4 text-muted">
              <i className="bi bi-people" style={{ fontSize: '2.5rem', opacity: 0.4 }}></i>
              <p className="mt-2 mb-0">No staff accounts yet. Click "Add Staff" to create one.</p>
            </div>
          ) : (
            <Table responsive hover className="mb-0">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Display Name</th>
                  <th>Permissions</th>
                  <th>Status</th>
                  <th style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map(staff => (
                  <tr key={staff.id}>
                    <td><strong>{staff.username}</strong></td>
                    <td>{staff.displayName}</td>
                    <td>
                      {(staff.permissions || []).slice(0, 3).map(p => (
                        <Badge key={p} bg="light" text="dark" className="me-1" style={{ fontSize: '0.7rem' }}>
                          {PERMISSION_OPTIONS.find(o => o.key === p)?.label || p}
                        </Badge>
                      ))}
                      {(staff.permissions || []).length > 3 && (
                        <Badge bg="secondary" style={{ fontSize: '0.7rem' }}>
                          +{staff.permissions.length - 3} more
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Form.Check
                        type="switch"
                        checked={staff.active !== false}
                        onChange={() => handleToggleActive(staff)}
                        label={staff.active !== false ? 'Active' : 'Disabled'}
                        style={{ fontSize: '0.85rem' }}
                      />
                    </td>
                    <td>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        className="me-1"
                        onClick={() => openEditModal(staff)}
                      >
                        <i className="bi bi-pencil"></i>
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => setDeleteTarget(staff)}
                      >
                        <i className="bi bi-trash"></i>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Create/Edit Modal */}
      <Modal show={showModal} onHide={() => { setShowModal(false); resetForm(); }} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {editingStaff ? `Edit Staff: ${editingStaff.username}` : 'Create Staff Account'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!editingStaff && (
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value.replace(/\s/g, ''))}
                placeholder="e.g., john_server"
                minLength={3}
              />
              <Form.Text className="text-muted">
                Staff will use this username to log in. No spaces allowed.
              </Form.Text>
            </Form.Group>
          )}

          <Form.Group className="mb-3">
            <Form.Label>Display Name</Form.Label>
            <Form.Control
              type="text"
              value={formDisplayName}
              onChange={(e) => setFormDisplayName(e.target.value)}
              placeholder="e.g., John Smith"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>{editingStaff ? 'New Password (leave blank to keep current)' : 'Password'}</Form.Label>
            <PasswordInput
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              placeholder={editingStaff ? 'Leave blank to keep current' : 'Min 6 characters'}
            />
          </Form.Group>

          <Form.Group className="mb-2">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <Form.Label className="mb-0">Permissions</Form.Label>
              <div>
                <Button variant="link" size="sm" onClick={selectAllPermissions} style={{ fontSize: '0.8rem' }}>
                  Select All
                </Button>
                <Button variant="link" size="sm" onClick={clearAllPermissions} style={{ fontSize: '0.8rem' }}>
                  Clear All
                </Button>
              </div>
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.5rem', background: '#f8f9fa', borderRadius: 8, padding: '0.75rem'
            }}>
              {PERMISSION_OPTIONS.map(perm => (
                <Form.Check
                  key={perm.key}
                  type="checkbox"
                  id={`perm-${perm.key}`}
                  label={
                    <span style={{ fontSize: '0.85rem' }}>
                      <i className={`bi ${perm.icon} me-1`} style={{ opacity: 0.6 }}></i>
                      {perm.label}
                    </span>
                  }
                  checked={formPermissions.includes(perm.key)}
                  onChange={() => togglePermission(perm.key)}
                />
              ))}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => { setShowModal(false); resetForm(); }}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Spinner size="sm" className="me-1" />{editingStaff ? 'Updating...' : 'Creating...'}</> :
              editingStaff ? 'Update Staff' : 'Create Staff'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete Confirmation */}
      <Modal show={!!deleteTarget} onHide={() => setDeleteTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete Staff Account</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to permanently delete the staff account <strong>"{deleteTarget?.username}"</strong>?
          This cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={saving}>
            {saving ? 'Deleting...' : 'Delete'}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AccessControl;
