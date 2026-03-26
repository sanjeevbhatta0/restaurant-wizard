import React, { useState } from 'react';
import { Modal, Form, Button, Card, Badge, Spinner, Alert, Row, Col } from 'react-bootstrap';
import { FaSearch, FaStar, FaMapMarkerAlt, FaPhone } from 'react-icons/fa';

const YelpSearchModal = ({ show, onHide, onConnect, isLoading }) => {
  const [searchName, setSearchName] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchName.trim() || !searchLocation.trim()) return;

    setSearching(true);
    setError('');
    setResults([]);

    try {
      const businessListingsService = (await import('../../services/businessListingsService')).default;
      const result = await businessListingsService.searchYelpBusiness(searchName, searchLocation);
      if (result.success) {
        setResults(result.businesses || []);
        if (result.businesses?.length === 0) {
          setError('No businesses found. Try adjusting your search terms.');
        }
      } else if (result.error === 'not_configured') {
        setError(result.message);
      }
    } catch (err) {
      setError('Failed to search Yelp. Please try again.');
      console.error('Yelp search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (business) => {
    setConnecting(business.id);
    try {
      await onConnect(business.id);
      onHide();
    } catch (err) {
      setError('Failed to connect. Please try again.');
    } finally {
      setConnecting(null);
    }
  };

  const renderStars = (rating) => {
    return Array.from({ length: 5 }, (_, i) => (
      <FaStar key={i} className={i < Math.round(rating) ? 'text-warning' : 'text-muted'} size={12} />
    ));
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton className="bg-danger text-white">
        <Modal.Title>
          <img src="https://s3-media0.fl.yelpcdn.com/assets/srv0/yelp_styleguide/514f6997a318/assets/img/logos/yelp_burst/default/32.png" alt="Yelp" className="me-2" style={{ height: 24 }} />
          Find Your Business on Yelp
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleSearch} className="mb-4">
          <Row>
            <Col md={5}>
              <Form.Group>
                <Form.Label>Business Name</Form.Label>
                <Form.Control
                  type="text"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value)}
                  placeholder="e.g., The Gurkha Kitchen"
                />
              </Form.Group>
            </Col>
            <Col md={5}>
              <Form.Group>
                <Form.Label>City or Address</Form.Label>
                <Form.Control
                  type="text"
                  value={searchLocation}
                  onChange={(e) => setSearchLocation(e.target.value)}
                  placeholder="e.g., San Francisco, CA"
                />
              </Form.Group>
            </Col>
            <Col md={2} className="d-flex align-items-end">
              <Button type="submit" variant="danger" className="w-100" disabled={searching || !searchName.trim() || !searchLocation.trim()}>
                {searching ? <Spinner size="sm" /> : <FaSearch />}
              </Button>
            </Col>
          </Row>
        </Form>

        {error && <Alert variant="warning" className="mb-3">{error}</Alert>}

        {results.length > 0 && (
          <div className="yelp-results">
            <h6 className="mb-3">Select your business:</h6>
            {results.map((biz) => (
              <Card key={biz.id} className="mb-2 yelp-result-card" onClick={() => !connecting && handleSelect(biz)} style={{ cursor: 'pointer' }}>
                <Card.Body className="d-flex align-items-center py-2">
                  {biz.imageUrl && (
                    <img src={biz.imageUrl} alt={biz.name} className="rounded me-3" style={{ width: 60, height: 60, objectFit: 'cover' }} />
                  )}
                  <div className="flex-grow-1">
                    <h6 className="mb-1">{biz.name}</h6>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span className="d-flex">{renderStars(biz.rating)}</span>
                      <small className="text-muted">{biz.rating} ({biz.reviewCount} reviews)</small>
                    </div>
                    <small className="text-muted">
                      <FaMapMarkerAlt className="me-1" />{biz.address}
                      {biz.phone && <span className="ms-2"><FaPhone className="me-1" />{biz.phone}</span>}
                    </small>
                    {biz.categories?.length > 0 && (
                      <div className="mt-1">
                        {biz.categories.map((cat, i) => (
                          <Badge key={i} bg="light" text="dark" className="me-1" style={{ fontSize: '10px' }}>{cat}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {connecting === biz.id ? (
                    <Spinner size="sm" variant="danger" />
                  ) : (
                    <Badge bg="danger" className="ms-2">Select</Badge>
                  )}
                </Card.Body>
              </Card>
            ))}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>Cancel</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default YelpSearchModal;
