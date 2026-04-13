import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Container, Card, Button, Badge, Alert, Spinner, Modal, Form, Table } from 'react-bootstrap';
import './PageHeader.css';
import './ReviewManagement.css';

const ReviewManagement = () => {
  const { restaurantUid } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedReview, setSelectedReview] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [reviewStats, setReviewStats] = useState({ total: 0, approved: 0, pending: 0, rejected: 0, avgRating: 0 });

  // Real-time listener for aggregate stats (all reviews)
  useEffect(() => {
    if (!restaurantUid) return;
    const reviewsRef = collection(db, `restaurants/${restaurantUid}/reviews`);
    const allQuery = query(reviewsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(allQuery, (snapshot) => {
      let total = 0, approved = 0, pending = 0, rejected = 0, ratingSum = 0, ratingCount = 0;
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        total++;
        if (data.status === 'approved') { approved++; ratingSum += (data.rating || 0); ratingCount++; }
        else if (data.status === 'pending') pending++;
        else if (data.status === 'rejected') rejected++;
      });
      setReviewStats({
        total,
        approved,
        pending,
        rejected,
        avgRating: ratingCount > 0 ? (ratingSum / ratingCount) : 0
      });
    });
    return () => unsubscribe();
  }, [restaurantUid]);

  // Real-time listener for reviews
  useEffect(() => {
    if (!restaurantUid) return;

    const reviewsRef = collection(db, `restaurants/${restaurantUid}/reviews`);
    let q;
    if (filter === 'all') {
      q = query(reviewsRef, orderBy('createdAt', 'desc'));
    } else {
      q = query(reviewsRef, where('status', '==', filter), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reviewList = [];
      snapshot.forEach(docSnap => {
        reviewList.push({ id: docSnap.id, ...docSnap.data() });
      });
      setReviews(reviewList);
      setLoading(false);
    }, (err) => {
      console.error('Error listening to reviews:', err);
      setError('Failed to load reviews');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [restaurantUid, filter]);

  const handleApprove = async (review) => {
    setProcessing(true);
    setError('');
    try {
      await updateDoc(doc(db, `restaurants/${restaurantUid}/reviews/${review.id}`), {
        status: 'approved',
        approvedAt: new Date(),
        updatedAt: new Date()
      });
      setSuccess(`Review by "${review.customerName}" approved!`);
      setTimeout(() => setSuccess(''), 3000);
      setShowDetailModal(false);
    } catch (err) {
      setError('Failed to approve review: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (review) => {
    setProcessing(true);
    setError('');
    try {
      await updateDoc(doc(db, `restaurants/${restaurantUid}/reviews/${review.id}`), {
        status: 'rejected',
        updatedAt: new Date()
      });
      setSuccess(`Review by "${review.customerName}" rejected.`);
      setTimeout(() => setSuccess(''), 3000);
      setShowDetailModal(false);
    } catch (err) {
      setError('Failed to reject review: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedReview) return;
    setProcessing(true);
    setError('');
    try {
      await deleteDoc(doc(db, `restaurants/${restaurantUid}/reviews/${selectedReview.id}`));
      setSuccess('Review deleted.');
      setTimeout(() => setSuccess(''), 3000);
      setShowDeleteModal(false);
      setShowDetailModal(false);
      setSelectedReview(null);
    } catch (err) {
      setError('Failed to delete review: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const renderStars = (rating) => {
    return Array.from({ length: 5 }, (_, i) => (
      <i
        key={i}
        className={`bi bi-star${i < rating ? '-fill' : ''}`}
        style={{ color: i < rating ? '#f59e0b' : '#d1d5db', fontSize: '1rem' }}
      ></i>
    ));
  };

  const renderHalfStars = (avg, size = '1.2rem') => {
    return Array.from({ length: 5 }, (_, i) => {
      const diff = avg - i;
      let icon = 'bi-star';
      if (diff >= 0.75) icon = 'bi-star-fill';
      else if (diff >= 0.25) icon = 'bi-star-half';
      return (
        <i key={i} className={`bi ${icon}`} style={{ color: diff >= 0.25 ? '#f59e0b' : '#d1d5db', fontSize: size }}></i>
      );
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending': return <Badge bg="warning" text="dark">Pending</Badge>;
      case 'approved': return <Badge bg="success">Approved</Badge>;
      case 'rejected': return <Badge bg="danger">Rejected</Badge>;
      default: return <Badge bg="secondary">{status}</Badge>;
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  };

  const pendingCount = reviews.filter(r => r.status === 'pending').length;

  return (
    <Container fluid className="review-management">
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-chat-quote header-icon"></i>
          <div>
            <h2>Customer Reviews</h2>
            <p>Manage and moderate customer reviews for your restaurant</p>
          </div>
        </div>
      </div>

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

      {/* Filter Tabs */}
      <div className="review-filters">
        <Button
          variant={filter === 'pending' ? 'warning' : 'outline-secondary'}
          size="sm"
          onClick={() => setFilter('pending')}
          className="me-2"
        >
          Pending {filter !== 'pending' && pendingCount > 0 && <Badge bg="danger" className="ms-1">{pendingCount}</Badge>}
        </Button>
        <Button
          variant={filter === 'approved' ? 'success' : 'outline-secondary'}
          size="sm"
          onClick={() => setFilter('approved')}
          className="me-2"
        >
          Approved
        </Button>
        <Button
          variant={filter === 'rejected' ? 'danger' : 'outline-secondary'}
          size="sm"
          onClick={() => setFilter('rejected')}
          className="me-2"
        >
          Rejected
        </Button>
        <Button
          variant={filter === 'all' ? 'primary' : 'outline-secondary'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All
        </Button>
      </div>

      {/* Aggregated Review Summary */}
      {reviewStats.total > 0 && (
        <Card className="review-summary-card" style={{
          borderRadius: '12px',
          marginBottom: '20px',
          border: '1px solid #e5e7eb',
          background: 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(251,191,36,0.04) 100%)'
        }}>
          <Card.Body style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
              {/* Average Rating */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '2.4rem', fontWeight: '700', color: '#f59e0b', lineHeight: 1 }}>
                  {reviewStats.avgRating > 0 ? reviewStats.avgRating.toFixed(1) : '--'}
                </span>
                <div>
                  <div>{renderHalfStars(reviewStats.avgRating, '1.1rem')}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '2px' }}>
                    Based on {reviewStats.approved} approved {reviewStats.approved === 1 ? 'review' : 'reviews'}
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: '1px', height: '48px', background: '#e5e7eb' }}></div>

              {/* Status Breakdown */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: '600', color: '#374151' }}>{reviewStats.total}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: '600', color: '#f59e0b' }}>{reviewStats.pending}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Pending</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: '600', color: '#10b981' }}>{reviewStats.approved}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Approved</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: '600', color: '#ef4444' }}>{reviewStats.rejected}</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Rejected</div>
                </div>
              </div>
            </div>
          </Card.Body>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" variant="primary" />
        </div>
      ) : reviews.length === 0 ? (
        <Card className="text-center py-5" style={{ borderRadius: '12px' }}>
          <Card.Body>
            <i className="bi bi-chat-quote" style={{ fontSize: '3rem', color: '#d1d5db' }}></i>
            <h5 className="mt-3" style={{ color: '#6b7280' }}>
              {filter === 'pending' ? 'No pending reviews' :
               filter === 'approved' ? 'No approved reviews yet' :
               filter === 'rejected' ? 'No rejected reviews' :
               'No reviews yet'}
            </h5>
            <p className="text-muted">
              Customer reviews from your website and widget will appear here.
            </p>
          </Card.Body>
        </Card>
      ) : (
        <div className="review-list">
          {reviews.map(review => (
            <Card
              key={review.id}
              className="review-card"
              onClick={() => { setSelectedReview(review); setShowDetailModal(true); }}
              style={{ cursor: 'pointer' }}
            >
              <Card.Body>
                <div className="review-card-header">
                  <div>
                    <strong>{review.customerName}</strong>
                    <div className="review-stars">{renderStars(review.rating)}</div>
                  </div>
                  <div className="review-card-meta">
                    {getStatusBadge(review.status)}
                    <small className="text-muted ms-2">{formatDate(review.createdAt)}</small>
                  </div>
                </div>
                <p className="review-text">{review.reviewText}</p>
                {review.status === 'pending' && (
                  <div className="review-actions" onClick={e => e.stopPropagation()}>
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleApprove(review)}
                      disabled={processing}
                    >
                      <i className="bi bi-check-lg me-1"></i> Approve
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleReject(review)}
                      disabled={processing}
                      className="ms-2"
                    >
                      <i className="bi bi-x-lg me-1"></i> Reject
                    </Button>
                  </div>
                )}
              </Card.Body>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <Modal show={showDetailModal} onHide={() => setShowDetailModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Review Details</Modal.Title>
        </Modal.Header>
        {selectedReview && (
          <Modal.Body>
            <div className="mb-3">
              <strong style={{ fontSize: '1.1rem' }}>{selectedReview.customerName}</strong>
              {selectedReview.customerEmail && (
                <div className="text-muted" style={{ fontSize: '0.85rem' }}>{selectedReview.customerEmail}</div>
              )}
            </div>
            <div className="mb-3">
              {renderStars(selectedReview.rating)}
              <span className="ms-2 text-muted">({selectedReview.rating}/5)</span>
            </div>
            <div className="mb-3" style={{
              background: '#f9fafb',
              padding: '16px',
              borderRadius: '8px',
              lineHeight: 1.6
            }}>
              "{selectedReview.reviewText}"
            </div>
            <div className="mb-2">
              <small className="text-muted">Status: </small>{getStatusBadge(selectedReview.status)}
            </div>
            <div>
              <small className="text-muted">Submitted: {formatDate(selectedReview.createdAt)}</small>
            </div>
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button
            variant="outline-danger"
            size="sm"
            onClick={() => { setShowDeleteModal(true); }}
          >
            <i className="bi bi-trash me-1"></i> Delete
          </Button>
          {selectedReview?.status === 'pending' && (
            <>
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => handleReject(selectedReview)}
                disabled={processing}
              >
                Reject
              </Button>
              <Button
                variant="success"
                onClick={() => handleApprove(selectedReview)}
                disabled={processing}
              >
                {processing ? <Spinner animation="border" size="sm" /> : 'Approve'}
              </Button>
            </>
          )}
          {selectedReview?.status === 'rejected' && (
            <Button
              variant="success"
              onClick={() => handleApprove(selectedReview)}
              disabled={processing}
            >
              Approve
            </Button>
          )}
          {selectedReview?.status === 'approved' && (
            <Button
              variant="outline-warning"
              onClick={() => handleReject(selectedReview)}
              disabled={processing}
            >
              Revoke Approval
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* Delete Confirmation */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete Review</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to permanently delete this review by <strong>{selectedReview?.customerName}</strong>?
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={processing}>
            {processing ? <Spinner animation="border" size="sm" /> : 'Delete'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default ReviewManagement;
