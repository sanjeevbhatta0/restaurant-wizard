import React, { useState, useMemo } from 'react';
import { Card, Row, Col, Badge, Button, Form, Alert, Spinner, ProgressBar } from 'react-bootstrap';
import { FaStar, FaSync, FaFilter, FaChartBar } from 'react-icons/fa';
import ReviewCard from './ReviewCard';

const ReviewsDashboard = ({
  reviews,
  connections,
  restaurantData,
  onGenerateResponse,
  onReplyToGoogle,
  onSyncReviews,
  isLoading
}) => {
  const [platformFilter, setPlatformFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [syncing, setSyncing] = useState(false);

  // Filter and sort reviews
  const filteredReviews = useMemo(() => {
    let result = [...(reviews || [])];

    // Platform filter
    if (platformFilter !== 'all') {
      result = result.filter(r => r.platform === platformFilter);
    }

    // Rating filter
    if (ratingFilter !== 'all') {
      const rating = parseInt(ratingFilter);
      result = result.filter(r => r.rating === rating);
    }

    // Sentiment filter
    if (sentimentFilter !== 'all') {
      if (sentimentFilter === 'positive') result = result.filter(r => r.rating >= 4);
      else if (sentimentFilter === 'neutral') result = result.filter(r => r.rating === 3);
      else if (sentimentFilter === 'negative') result = result.filter(r => r.rating <= 2);
    }

    // Sort
    result.sort((a, b) => {
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      if (sortBy === 'newest') return dateB - dateA;
      if (sortBy === 'oldest') return dateA - dateB;
      if (sortBy === 'highest') return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'lowest') return (a.rating || 0) - (b.rating || 0);
      return 0;
    });

    return result;
  }, [reviews, platformFilter, ratingFilter, sentimentFilter, sortBy]);

  // Calculate stats
  const stats = useMemo(() => {
    const all = reviews || [];
    const total = all.length;
    const avgRating = total > 0 ? all.reduce((s, r) => s + (r.rating || 0), 0) / total : 0;
    const positive = all.filter(r => r.rating >= 4).length;
    const neutral = all.filter(r => r.rating === 3).length;
    const negative = all.filter(r => r.rating <= 2).length;
    const responded = all.filter(r => r.ownerResponse).length;

    return {
      total,
      avgRating: Math.round(avgRating * 10) / 10,
      positive,
      neutral,
      negative,
      responded,
      responseRate: total > 0 ? Math.round((responded / total) * 100) : 0
    };
  }, [reviews]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSyncReviews();
    } finally {
      setSyncing(false);
    }
  };

  const connectedPlatforms = [];
  if (connections?.yelp?.connected) connectedPlatforms.push('yelp');
  if (connections?.google?.connected) connectedPlatforms.push('google');

  if (connectedPlatforms.length === 0) {
    return (
      <Card className="shadow-sm">
        <Card.Body className="text-center py-5">
          <FaStar size={48} className="text-warning mb-3" />
          <h5>Connect Your Business Listings</h5>
          <p className="text-muted">
            Connect your Yelp or Google Business Profile to see reviews here.<br />
            Use the "Business Listings" card on the Create Post tab to get started.
          </p>
        </Card.Body>
      </Card>
    );
  }

  return (
    <>
      {/* Summary Cards */}
      <Row className="mb-4">
        <Col md={3}>
          <Card className="text-center h-100 summary-card">
            <Card.Body>
              <div className="summary-value">{stats.avgRating}</div>
              <div className="d-flex justify-content-center mb-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <FaStar key={i} className={i < Math.round(stats.avgRating) ? 'text-warning' : 'text-muted'} />
                ))}
              </div>
              <small className="text-muted">Average Rating</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100 summary-card">
            <Card.Body>
              <div className="summary-value">{stats.total}</div>
              <small className="text-muted">Total Reviews</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100 summary-card">
            <Card.Body>
              <div className="summary-value">{stats.responseRate}%</div>
              <small className="text-muted">Response Rate</small>
              <ProgressBar
                now={stats.responseRate}
                variant={stats.responseRate >= 80 ? 'success' : stats.responseRate >= 50 ? 'warning' : 'danger'}
                className="mt-2"
                style={{ height: '4px' }}
              />
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="text-center h-100 summary-card">
            <Card.Body>
              <div className="d-flex justify-content-center gap-3 mb-1">
                <div>
                  <Badge bg="success">{stats.positive}</Badge>
                  <small className="d-block text-muted mt-1">Positive</small>
                </div>
                <div>
                  <Badge bg="warning" text="dark">{stats.neutral}</Badge>
                  <small className="d-block text-muted mt-1">Neutral</small>
                </div>
                <div>
                  <Badge bg="danger">{stats.negative}</Badge>
                  <small className="d-block text-muted mt-1">Negative</small>
                </div>
              </div>
              <small className="text-muted">Sentiment</small>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Yelp limitation notice */}
      {connections?.yelp?.connected && (
        <Alert variant="info" className="small py-2">
          <strong>Note:</strong> Yelp's API provides up to 3 most recent reviews.
          <a href={connections.yelp.businessUrl} target="_blank" rel="noopener noreferrer" className="ms-1">
            View all reviews on Yelp <FaChartBar className="ms-1" />
          </a>
        </Alert>
      )}

      {/* Filter Bar */}
      <Card className="shadow-sm mb-4">
        <Card.Body className="py-2">
          <div className="d-flex gap-3 align-items-center flex-wrap">
            <FaFilter className="text-muted" />
            <Form.Select size="sm" style={{ width: 'auto' }} value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="all">All Platforms</option>
              {connections?.yelp?.connected && <option value="yelp">Yelp</option>}
              {connections?.google?.connected && <option value="google">Google</option>}
            </Form.Select>
            <Form.Select size="sm" style={{ width: 'auto' }} value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
              <option value="all">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4 Stars</option>
              <option value="3">3 Stars</option>
              <option value="2">2 Stars</option>
              <option value="1">1 Star</option>
            </Form.Select>
            <Form.Select size="sm" style={{ width: 'auto' }} value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)}>
              <option value="all">All Sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </Form.Select>
            <Form.Select size="sm" style={{ width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest">Highest Rated</option>
              <option value="lowest">Lowest Rated</option>
            </Form.Select>
            <div className="ms-auto">
              <Button variant="outline-primary" size="sm" onClick={handleSync} disabled={syncing}>
                {syncing ? <Spinner size="sm" className="me-1" /> : <FaSync className="me-1" />}
                Sync Reviews
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      {/* Review List */}
      {isLoading ? (
        <div className="text-center py-5">
          <Spinner animation="border" variant="primary" />
          <p className="text-muted mt-2">Loading reviews...</p>
        </div>
      ) : filteredReviews.length === 0 ? (
        <Card className="shadow-sm">
          <Card.Body className="text-center py-4">
            <p className="text-muted mb-0">No reviews match your filters.</p>
          </Card.Body>
        </Card>
      ) : (
        <div className="reviews-list">
          <div className="d-flex justify-content-between mb-2">
            <small className="text-muted">{filteredReviews.length} review{filteredReviews.length !== 1 ? 's' : ''}</small>
          </div>
          {filteredReviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              restaurantName={restaurantData?.name || restaurantData?.restaurantName}
              cuisineType={restaurantData?.cuisineType}
              onGenerateResponse={onGenerateResponse}
              onReplyToGoogle={onReplyToGoogle}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default ReviewsDashboard;
