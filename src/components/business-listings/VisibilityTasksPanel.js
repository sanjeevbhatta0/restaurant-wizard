import React, { useState } from 'react';
import {
  Card, Row, Col, Badge, Button, Form, Spinner, Alert,
  ProgressBar, Accordion
} from 'react-bootstrap';
import {
  FaRobot, FaCheckCircle, FaLightbulb, FaGoogle, FaApple, FaGlobe
} from 'react-icons/fa';

const VisibilityTasksPanel = ({
  tasks,
  restaurantData,
  connections,
  reviews,
  onGenerateTasks,
  onUpdateTaskStatus,
  isLoading
}) => {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const totalCount = tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      // Build review summary for AI context
      const reviewSummary = reviews?.length > 0
        ? `${reviews.length} reviews, avg rating ${(reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)}/5`
        : 'No reviews collected yet';

      await onGenerateTasks({
        restaurantData: {
          name: restaurantData?.name || restaurantData?.restaurantName,
          cuisineType: restaurantData?.cuisineType,
          address: restaurantData?.address
        },
        connectedPlatforms: {
          yelp: !!connections?.yelp?.connected,
          google: !!connections?.google?.connected,
          apple: !!connections?.apple?.connected
        },
        reviewSummary
      });
    } catch (err) {
      setError('Failed to generate tasks. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleTask = async (taskId, currentStatus) => {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      await onUpdateTaskStatus(taskId, newStatus);
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const getPlatformIcon = (platform) => {
    switch (platform) {
      case 'yelp': return <span style={{ color: '#d32323', fontWeight: 700 }}>Y</span>;
      case 'google': return <FaGoogle style={{ color: '#4285F4' }} />;
      case 'apple': return <FaApple />;
      default: return <FaGlobe className="text-primary" />;
    }
  };

  const getPriorityColor = (priority) => {
    if (priority === 'high') return 'danger';
    if (priority === 'medium') return 'warning';
    return 'info';
  };

  // Group tasks by priority
  const highPriority = tasks.filter(t => t.priority === 'high');
  const mediumPriority = tasks.filter(t => t.priority === 'medium');
  const lowPriority = tasks.filter(t => t.priority === 'low');

  return (
    <>
      {/* Header with Generate Button */}
      <Card className="shadow-sm mb-4">
        <Card.Header className="bg-white py-3">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h5 className="mb-1"><FaLightbulb className="me-2 text-warning" />Visibility Improvement Tasks</h5>
              <small className="text-muted">AI-powered recommendations to boost your online presence</small>
            </div>
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <><Spinner size="sm" className="me-2" />Generating...</>
              ) : (
                <><FaRobot className="me-2" />{tasks.length > 0 ? 'Refresh Tasks' : 'Generate Tasks'}</>
              )}
            </Button>
          </div>
        </Card.Header>
      </Card>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}

      {tasks.length === 0 ? (
        <Card className="shadow-sm">
          <Card.Body className="text-center py-5">
            <FaLightbulb size={48} className="text-warning mb-3" />
            <h5>Get Visibility Recommendations</h5>
            <p className="text-muted">
              Click "Generate Tasks" to get AI-powered recommendations<br />
              for improving your restaurant's visibility across Yelp, Google, and Apple.
            </p>
            <Button variant="primary" onClick={handleGenerate} disabled={generating}>
              {generating ? <><Spinner size="sm" className="me-2" />Generating...</> : <><FaRobot className="me-2" />Generate Tasks</>}
            </Button>
          </Card.Body>
        </Card>
      ) : (
        <>
          {/* Progress Card */}
          <Card className="shadow-sm mb-4">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">Progress</h6>
                <Badge bg={progressPercent === 100 ? 'success' : 'primary'}>
                  {completedCount}/{totalCount} completed
                </Badge>
              </div>
              <ProgressBar
                now={progressPercent}
                variant={progressPercent === 100 ? 'success' : progressPercent >= 50 ? 'primary' : 'warning'}
                label={`${progressPercent}%`}
                style={{ height: '10px' }}
              />
              {progressPercent === 100 && (
                <Alert variant="success" className="mt-3 mb-0">
                  <FaCheckCircle className="me-2" />All tasks completed! Generate new tasks to continue improving.
                </Alert>
              )}
            </Card.Body>
          </Card>

          {/* Task Groups */}
          {[
            { title: 'High Priority', tasks: highPriority, variant: 'danger' },
            { title: 'Medium Priority', tasks: mediumPriority, variant: 'warning' },
            { title: 'Low Priority', tasks: lowPriority, variant: 'info' }
          ].filter(group => group.tasks.length > 0).map((group, groupIdx) => (
            <Card className="shadow-sm mb-3" key={groupIdx}>
              <Card.Header className="bg-white py-2">
                <div className="d-flex align-items-center">
                  <Badge bg={group.variant} className="me-2">{group.title}</Badge>
                  <small className="text-muted">
                    {group.tasks.filter(t => t.status === 'completed').length}/{group.tasks.length} done
                  </small>
                </div>
              </Card.Header>
              <Card.Body className="p-0">
                <Accordion flush>
                  {group.tasks.map((task, taskIdx) => (
                    <Accordion.Item key={task.id || taskIdx} eventKey={`${groupIdx}-${taskIdx}`}>
                      <Accordion.Header>
                        <div className="d-flex align-items-center w-100 pe-3">
                          <Form.Check
                            type="checkbox"
                            checked={task.status === 'completed'}
                            onChange={() => handleToggleTask(task.id, task.status)}
                            onClick={(e) => e.stopPropagation()}
                            className="me-3"
                          />
                          <span className="me-2">{getPlatformIcon(task.platform)}</span>
                          <div className="flex-grow-1">
                            <span className={task.status === 'completed' ? 'text-decoration-line-through text-muted' : ''}>
                              {task.title}
                            </span>
                            {task.description && (
                              <small className="text-muted d-block">{task.description}</small>
                            )}
                          </div>
                          {task.impactScore && (
                            <Badge bg="success" className="ms-2">+{task.impactScore} pts</Badge>
                          )}
                        </div>
                      </Accordion.Header>
                      <Accordion.Body className="bg-light">
                        {task.steps && task.steps.length > 0 ? (
                          <ol className="mb-0 ps-3">
                            {task.steps.map((step, stepIdx) => (
                              <li key={stepIdx} className="mb-2 pb-2 border-bottom">
                                {step.replace(/^Step \d+:\s*/i, '')}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-muted mb-0 small">No detailed steps available for this task.</p>
                        )}
                        {task.category && (
                          <div className="mt-2">
                            <Badge bg="light" text="dark" className="me-1">Category: {task.category}</Badge>
                            <Badge bg="light" text="dark">Platform: {task.platform}</Badge>
                          </div>
                        )}
                      </Accordion.Body>
                    </Accordion.Item>
                  ))}
                </Accordion>
              </Card.Body>
            </Card>
          ))}

          {/* Impact Summary */}
          <Card className="shadow-sm border-primary">
            <Card.Body>
              <Row className="text-center">
                <Col>
                  <strong>Potential Impact</strong>
                  <div className="text-success fs-5">
                    +{tasks.reduce((s, t) => s + (t.impactScore || 5), 0)} visibility points
                  </div>
                </Col>
                <Col>
                  <strong>Platforms Covered</strong>
                  <div>
                    {[...new Set(tasks.map(t => t.platform))].map((p, i) => (
                      <span key={i} className="me-2">{getPlatformIcon(p)}</span>
                    ))}
                  </div>
                </Col>
                <Col>
                  <strong>Categories</strong>
                  <div>
                    {[...new Set(tasks.map(t => t.category).filter(Boolean))].map((c, i) => (
                      <Badge key={i} bg="light" text="dark" className="me-1">{c}</Badge>
                    ))}
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </>
      )}
    </>
  );
};

export default VisibilityTasksPanel;
