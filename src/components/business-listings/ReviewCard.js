import React, { useState } from 'react';
import { Card, Badge, Button, Form, Spinner, Collapse, Alert } from 'react-bootstrap';
import { FaStar, FaRobot, FaCopy, FaCheck, FaReply, FaExternalLinkAlt } from 'react-icons/fa';

const ReviewCard = ({ review, restaurantName, cuisineType, onGenerateResponse, onReplyToGoogle }) => {
  const [showAiResponse, setShowAiResponse] = useState(false);
  const [aiResponse, setAiResponse] = useState(review.aiResponseSuggestion || '');
  const [alternativeResponses, setAlternativeResponses] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replying, setReplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const renderStars = (rating) => {
    return Array.from({ length: 5 }, (_, i) => (
      <FaStar key={i} className={i < rating ? 'text-warning' : 'text-muted'} size={12} />
    ));
  };

  const getSentimentBadge = (rating) => {
    if (rating >= 4) return <Badge bg="success" className="ms-2">Positive</Badge>;
    if (rating === 3) return <Badge bg="warning" text="dark" className="ms-2">Neutral</Badge>;
    return <Badge bg="danger" className="ms-2">Negative</Badge>;
  };

  const getPlatformBadge = (platform) => {
    const styles = {
      yelp: { bg: 'danger', label: 'Yelp' },
      google: { bg: 'primary', label: 'Google' },
      apple: { bg: 'dark', label: 'Apple' }
    };
    const { bg, label } = styles[platform] || { bg: 'secondary', label: platform };
    return <Badge bg={bg} className="me-2">{label}</Badge>;
  };

  const handleGenerateResponse = async () => {
    setGenerating(true);
    setError('');
    try {
      const result = await onGenerateResponse({
        reviewText: review.text,
        rating: review.rating,
        authorName: review.authorName,
        restaurantName,
        cuisineType
      });
      if (result.success) {
        setAiResponse(result.response);
        setAlternativeResponses(result.alternativeResponses || []);
        setReplyText(result.response);
        setShowAiResponse(true);
      }
    } catch (err) {
      setError('Failed to generate response');
    } finally {
      setGenerating(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setReplying(true);
    setError('');
    try {
      await onReplyToGoogle(review.platformUrl || review.externalId, replyText);
      setShowReplyForm(false);
    } catch (err) {
      setError('Failed to post reply');
    } finally {
      setReplying(false);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Card className="review-card mb-3">
      <Card.Body>
        {/* Header */}
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div className="d-flex align-items-center">
            {getPlatformBadge(review.platform)}
            {review.authorImageUrl && (
              <img src={review.authorImageUrl} alt="" className="rounded-circle me-2" style={{ width: 28, height: 28 }} />
            )}
            <div>
              <strong className="small">{review.authorName}</strong>
              <div className="d-flex align-items-center">
                {renderStars(review.rating)}
                {getSentimentBadge(review.rating)}
              </div>
            </div>
          </div>
          <small className="text-muted">{formatDate(review.createdAt)}</small>
        </div>

        {/* Review Text */}
        <p className="mb-2 review-text">{review.text}</p>

        {/* Owner Response (if exists) */}
        {review.ownerResponse && (
          <div className="owner-response mb-2">
            <small className="text-muted fw-bold">Your Response:</small>
            <p className="small mb-0 mt-1">{review.ownerResponse}</p>
          </div>
        )}

        {error && <Alert variant="danger" className="small py-1 px-2 mb-2">{error}</Alert>}

        {/* Actions */}
        <div className="d-flex gap-2 flex-wrap">
          {!review.ownerResponse && (
            <Button
              variant="outline-primary"
              size="sm"
              onClick={handleGenerateResponse}
              disabled={generating}
            >
              {generating ? <Spinner size="sm" className="me-1" /> : <FaRobot className="me-1" />}
              AI Response
            </Button>
          )}

          {review.platform === 'google' && !review.ownerResponse && (
            <Button variant="outline-success" size="sm" onClick={() => setShowReplyForm(!showReplyForm)}>
              <FaReply className="me-1" />Reply on Google
            </Button>
          )}

          {review.platformUrl && (
            <Button
              variant="link"
              size="sm"
              className="text-muted p-0 ms-auto"
              onClick={() => window.open(review.platformUrl, '_blank')}
            >
              <FaExternalLinkAlt size={10} className="me-1" />View
            </Button>
          )}
        </div>

        {/* AI Response Collapse */}
        <Collapse in={showAiResponse}>
          <div className="mt-3 ai-response-section">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <small className="fw-bold text-primary"><FaRobot className="me-1" />AI Suggestion</small>
              <Button variant="link" size="sm" className="p-0" onClick={() => handleCopy(aiResponse)}>
                {copied ? <FaCheck className="text-success" /> : <FaCopy />}
              </Button>
            </div>
            <p className="small mb-2 p-2 bg-light rounded">{aiResponse}</p>
            {alternativeResponses.length > 0 && (
              <div className="small">
                <strong>Alternatives:</strong>
                {alternativeResponses.map((alt, i) => (
                  <p key={i} className="mb-1 p-2 bg-light rounded" style={{ cursor: 'pointer' }} onClick={() => { setAiResponse(alt); setReplyText(alt); }}>
                    {alt}
                  </p>
                ))}
              </div>
            )}
            {review.platform === 'google' && (
              <Button variant="success" size="sm" onClick={() => { setReplyText(aiResponse); setShowReplyForm(true); setShowAiResponse(false); }}>
                Use & Reply on Google
              </Button>
            )}
            {review.platform !== 'google' && (
              <small className="text-muted d-block mt-1">
                Copy this response and paste it on {review.platform === 'yelp' ? 'Yelp' : 'the platform'} directly.
              </small>
            )}
          </div>
        </Collapse>

        {/* Google Reply Form */}
        <Collapse in={showReplyForm}>
          <div className="mt-3">
            <Form.Control
              as="textarea"
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write your reply..."
              className="mb-2"
            />
            <div className="d-flex gap-2">
              <Button variant="success" size="sm" onClick={handleReply} disabled={replying || !replyText.trim()}>
                {replying ? <Spinner size="sm" className="me-1" /> : null}
                Post Reply
              </Button>
              <Button variant="outline-secondary" size="sm" onClick={() => setShowReplyForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Collapse>
      </Card.Body>
    </Card>
  );
};

export default ReviewCard;
