import React, { useState } from 'react';
import { Card, Button, Badge, Spinner, Alert, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FaStar, FaSync, FaUnlink, FaExternalLinkAlt } from 'react-icons/fa';
import YelpSearchModal from './YelpSearchModal';
import GoogleAuthModal from './GoogleAuthModal';
import AppleBusinessModal from './AppleBusinessModal';

const BusinessConnectionsCard = ({
  connections,
  onYelpConnect,
  onGoogleAuth,
  onAppleSave,
  onDisconnect,
  onSync,
  isLoading
}) => {
  const [showYelpModal, setShowYelpModal] = useState(false);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [showAppleModal, setShowAppleModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const yelpData = connections?.yelp || {};
  const googleData = connections?.google || {};
  const appleData = connections?.apple || {};

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } catch (err) {
      setError('Failed to sync. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const renderStars = (rating) => {
    if (!rating) return null;
    return (
      <span className="d-inline-flex align-items-center ms-1">
        <FaStar className="text-warning" size={10} />
        <small className="ms-1">{rating}</small>
      </span>
    );
  };

  const connectedCount = [yelpData.connected, googleData.connected, appleData.connected].filter(Boolean).length;

  return (
    <>
      <Card className="shadow-sm mb-4 business-connections-card">
        <Card.Header className="bg-white d-flex justify-content-between align-items-center">
          <div>
            <h6 className="mb-0">Business Listings</h6>
            <small className="text-muted">{connectedCount}/3 connected</small>
          </div>
          {connectedCount > 0 && (
            <OverlayTrigger overlay={<Tooltip>Sync all platforms</Tooltip>}>
              <Button variant="outline-secondary" size="sm" onClick={handleSync} disabled={syncing}>
                {syncing ? <Spinner size="sm" /> : <FaSync />}
              </Button>
            </OverlayTrigger>
          )}
        </Card.Header>
        <Card.Body className="p-2">
          {error && <Alert variant="danger" className="small mb-2 mx-1" dismissible onClose={() => setError('')}>{error}</Alert>}

          {/* Yelp */}
          <div className={`listing-item ${yelpData.connected ? 'connected' : ''}`}>
            <div className="listing-icon yelp-icon">
              <span style={{ fontWeight: 700, color: '#d32323', fontSize: '14px' }}>Y</span>
            </div>
            <div className="listing-info">
              <div className="listing-name">
                Yelp
                {yelpData.connected && renderStars(yelpData.rating)}
              </div>
              {yelpData.connected ? (
                <small className="text-success">{yelpData.businessName}</small>
              ) : (
                <small className="text-muted">Not connected</small>
              )}
            </div>
            <div className="listing-actions">
              {yelpData.connected ? (
                <>
                  {yelpData.businessUrl && (
                    <OverlayTrigger overlay={<Tooltip>View on Yelp</Tooltip>}>
                      <Button variant="link" size="sm" className="p-0 me-2" onClick={() => window.open(yelpData.businessUrl, '_blank')}>
                        <FaExternalLinkAlt size={12} />
                      </Button>
                    </OverlayTrigger>
                  )}
                  <OverlayTrigger overlay={<Tooltip>Disconnect</Tooltip>}>
                    <Button variant="link" size="sm" className="p-0 text-danger" onClick={() => onDisconnect('yelp')}>
                      <FaUnlink size={12} />
                    </Button>
                  </OverlayTrigger>
                </>
              ) : (
                <Button variant="outline-danger" size="sm" onClick={() => setShowYelpModal(true)} disabled={isLoading}>
                  Connect
                </Button>
              )}
            </div>
          </div>

          {/* Google */}
          <div className={`listing-item ${googleData.connected ? 'connected' : ''}`}>
            <div className="listing-icon google-icon">
              <span style={{ fontWeight: 700, color: '#4285F4', fontSize: '14px' }}>G</span>
            </div>
            <div className="listing-info">
              <div className="listing-name">
                Google Business
                {googleData.connected && renderStars(googleData.rating)}
              </div>
              {googleData.connected ? (
                <small className="text-success">{googleData.accountName || 'Connected'}</small>
              ) : (
                <small className="text-muted">Not connected</small>
              )}
            </div>
            <div className="listing-actions">
              {googleData.connected ? (
                <OverlayTrigger overlay={<Tooltip>Disconnect</Tooltip>}>
                  <Button variant="link" size="sm" className="p-0 text-danger" onClick={() => onDisconnect('google')}>
                    <FaUnlink size={12} />
                  </Button>
                </OverlayTrigger>
              ) : (
                <Button variant="outline-primary" size="sm" onClick={() => setShowGoogleModal(true)} disabled={isLoading}>
                  Connect
                </Button>
              )}
            </div>
          </div>

          {/* Apple */}
          <div className={`listing-item ${appleData.connected ? 'connected' : ''}`}>
            <div className="listing-icon apple-icon">
              <span style={{ fontWeight: 700, color: '#000', fontSize: '14px' }}></span>
            </div>
            <div className="listing-info">
              <div className="listing-name">Apple Business</div>
              {appleData.connected ? (
                <small className="text-success">{appleData.businessName || 'Connected'}</small>
              ) : (
                <small className="text-muted">Not connected</small>
              )}
            </div>
            <div className="listing-actions">
              {appleData.connected ? (
                <>
                  <OverlayTrigger overlay={<Tooltip>Edit</Tooltip>}>
                    <Button variant="link" size="sm" className="p-0 me-2" onClick={() => setShowAppleModal(true)}>
                      <i className="bi bi-pencil" style={{ fontSize: '12px' }}></i>
                    </Button>
                  </OverlayTrigger>
                  <OverlayTrigger overlay={<Tooltip>Disconnect</Tooltip>}>
                    <Button variant="link" size="sm" className="p-0 text-danger" onClick={() => onDisconnect('apple')}>
                      <FaUnlink size={12} />
                    </Button>
                  </OverlayTrigger>
                </>
              ) : (
                <Button variant="outline-dark" size="sm" onClick={() => setShowAppleModal(true)} disabled={isLoading}>
                  Connect
                </Button>
              )}
            </div>
          </div>

          {connectedCount > 0 && (
            <div className="text-center mt-2">
              <Badge bg="light" text="dark" className="small">
                {yelpData.connected && `Yelp: ${yelpData.reviewCount || 0} reviews`}
                {yelpData.connected && googleData.connected && ' | '}
                {googleData.connected && `Google: ${googleData.reviewCount || 0} reviews`}
              </Badge>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Modals */}
      <YelpSearchModal
        show={showYelpModal}
        onHide={() => setShowYelpModal(false)}
        onConnect={onYelpConnect}
        isLoading={isLoading}
      />
      <GoogleAuthModal
        show={showGoogleModal}
        onHide={() => setShowGoogleModal(false)}
        onInitiateAuth={onGoogleAuth}
        isLoading={isLoading}
      />
      <AppleBusinessModal
        show={showAppleModal}
        onHide={() => setShowAppleModal(false)}
        onSave={onAppleSave}
        existingData={appleData}
      />
    </>
  );
};

export default BusinessConnectionsCard;
