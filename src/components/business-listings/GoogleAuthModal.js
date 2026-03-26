import React, { useState } from 'react';
import { Modal, Button, Alert, Spinner, ListGroup } from 'react-bootstrap';
import { FaGoogle, FaExternalLinkAlt, FaCheckCircle } from 'react-icons/fa';

const GoogleAuthModal = ({ show, onHide, onInitiateAuth, isLoading }) => {
  const [authUrl, setAuthUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await onInitiateAuth();
      if (result.success && result.authUrl) {
        setAuthUrl(result.authUrl);
        // Open OAuth flow in new window
        window.open(result.authUrl, '_blank', 'width=600,height=700');
      } else if (result.error === 'not_configured') {
        setError(result.message);
      } else {
        setError('Failed to initiate Google authorization.');
      }
    } catch (err) {
      setError('Failed to connect to Google Business. Please try again.');
      console.error('Google auth error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton style={{ background: 'linear-gradient(135deg, #4285F4, #34A853)', color: 'white' }}>
        <Modal.Title>
          <FaGoogle className="me-2" />Connect Google Business Profile
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}

        {!authUrl ? (
          <>
            <p className="mb-3">
              Connect your Google Business Profile to manage reviews, respond to customers, and improve your visibility on Google Search and Maps.
            </p>

            <h6 className="mb-2">What you'll be able to do:</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="px-0 border-0">
                <FaCheckCircle className="text-success me-2" />View and respond to Google reviews
              </ListGroup.Item>
              <ListGroup.Item className="px-0 border-0">
                <FaCheckCircle className="text-success me-2" />Get AI-powered review response suggestions
              </ListGroup.Item>
              <ListGroup.Item className="px-0 border-0">
                <FaCheckCircle className="text-success me-2" />Track your Google rating and review trends
              </ListGroup.Item>
              <ListGroup.Item className="px-0 border-0">
                <FaCheckCircle className="text-success me-2" />Get visibility improvement recommendations
              </ListGroup.Item>
            </ListGroup>

            <Alert variant="info" className="small">
              <strong>Note:</strong> You'll be redirected to Google to authorize access. Make sure you sign in with the Google account that manages your business profile.
            </Alert>

            <div className="text-center">
              <Button
                variant="primary"
                size="lg"
                onClick={handleConnect}
                disabled={loading}
                style={{ background: '#4285F4', border: 'none' }}
              >
                {loading ? (
                  <><Spinner size="sm" className="me-2" />Connecting...</>
                ) : (
                  <><FaGoogle className="me-2" />Sign in with Google</>
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center py-3">
            <FaGoogle size={48} className="text-primary mb-3" />
            <h5>Authorization in Progress</h5>
            <p className="text-muted">
              A new window has opened for Google authorization.<br />
              Complete the sign-in process there, then return here.
            </p>
            <Button variant="outline-primary" onClick={() => window.open(authUrl, '_blank', 'width=600,height=700')}>
              <FaExternalLinkAlt className="me-2" />Reopen Authorization Window
            </Button>
            <div className="mt-3">
              <Button variant="link" size="sm" onClick={onHide}>
                I've completed authorization
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default GoogleAuthModal;
