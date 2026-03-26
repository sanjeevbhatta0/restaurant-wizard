import React, { useState } from 'react';
import { Modal, Form, Button, Alert, ListGroup } from 'react-bootstrap';
import { FaApple, FaExternalLinkAlt, FaCheckCircle } from 'react-icons/fa';

const AppleBusinessModal = ({ show, onHide, onSave, existingData }) => {
  const [businessName, setBusinessName] = useState(existingData?.businessName || '');
  const [appleConnectUrl, setAppleConnectUrl] = useState(existingData?.appleConnectUrl || '');
  const [notes, setNotes] = useState(existingData?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!businessName.trim()) {
      setError('Business name is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await onSave({ businessName, appleConnectUrl, notes });
      onHide();
    } catch (err) {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton style={{ background: '#000', color: 'white' }}>
        <Modal.Title>
          <FaApple className="me-2" />Apple Business Connect
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}

        <Alert variant="info" className="mb-3">
          Apple Business Connect lets you manage how your business appears across Apple apps including Maps, Siri, and Wallet.
        </Alert>

        <h6 className="mb-2">To get started:</h6>
        <ListGroup variant="flush" className="mb-3">
          <ListGroup.Item className="px-0 border-0 small">
            <FaCheckCircle className="text-success me-2" />Visit <strong>businessconnect.apple.com</strong> and sign in
          </ListGroup.Item>
          <ListGroup.Item className="px-0 border-0 small">
            <FaCheckCircle className="text-success me-2" />Search for and claim your business listing
          </ListGroup.Item>
          <ListGroup.Item className="px-0 border-0 small">
            <FaCheckCircle className="text-success me-2" />Update your business info, photos, and hours
          </ListGroup.Item>
          <ListGroup.Item className="px-0 border-0 small">
            <FaCheckCircle className="text-success me-2" />Come back here and enter your details below
          </ListGroup.Item>
        </ListGroup>

        <Button
          variant="dark"
          className="w-100 mb-4"
          onClick={() => window.open('https://businessconnect.apple.com', '_blank')}
        >
          <FaExternalLinkAlt className="me-2" />Open Apple Business Connect
        </Button>

        <hr />

        <h6 className="mb-3">Your Apple Business Details</h6>

        <Form.Group className="mb-3">
          <Form.Label>Business Name (as it appears on Apple Maps)</Form.Label>
          <Form.Control
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g., The Gurkha Kitchen"
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Apple Business Connect URL <small className="text-muted">(optional)</small></Form.Label>
          <Form.Control
            type="url"
            value={appleConnectUrl}
            onChange={(e) => setAppleConnectUrl(e.target.value)}
            placeholder="https://businessconnect.apple.com/..."
          />
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Notes <small className="text-muted">(optional)</small></Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about your Apple Business profile..."
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Cancel</Button>
        <Button variant="dark" onClick={handleSave} disabled={saving || !businessName.trim()}>
          {saving ? 'Saving...' : 'Save Connection'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AppleBusinessModal;
