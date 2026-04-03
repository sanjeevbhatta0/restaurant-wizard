import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOnboarding, ONBOARDING_STEPS, CATEGORIES } from '../../contexts/OnboardingContext';
import './OnboardingChecklist.css';

const OnboardingChecklist = () => {
  const {
    completedSteps,
    dismissed,
    progress,
    completedCount,
    totalSteps,
    isComplete,
    completeStep,
    dismissOnboarding,
    startTour,
    loading,
  } = useOnboarding();

  const [expandedCategory, setExpandedCategory] = useState('setup');
  const [showAll, setShowAll] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: null, y: null });
  const [size, setSize] = useState({ width: 420, height: null });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef(null);

  // Set initial position on mount (bottom-right)
  useEffect(() => {
    if (position.x === null) {
      setPosition({
        x: window.innerWidth - 450,
        y: window.innerHeight - 500,
      });
    }
  }, [position.x]);

  // Drag handlers
  const handleMouseDown = useCallback((e) => {
    if (e.target.closest('.category-header, .btn-start-step, .btn-skip-step, .btn-dismiss-small, .btn-show-more, .btn-dismiss, a')) return;
    setIsDragging(true);
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (isDragging) {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y)),
      });
    }
    if (isResizing) {
      const rect = panelRef.current.getBoundingClientRect();
      setSize({
        width: Math.max(320, e.clientX - rect.left),
        height: Math.max(200, e.clientY - rect.top),
      });
    }
  }, [isDragging, isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  if (loading || dismissed) return null;

  // Group steps by category
  const groupedSteps = {};
  ONBOARDING_STEPS.forEach(step => {
    if (!groupedSteps[step.category]) groupedSteps[step.category] = [];
    groupedSteps[step.category].push(step);
  });

  const nextStep = ONBOARDING_STEPS.find(s => !completedSteps[s.id]);
  const categoryOrder = ['setup', 'payments', 'operations', 'growth'];
  const visibleCategories = showAll ? categoryOrder : categoryOrder.slice(0, 2);

  // Celebration
  if (isComplete) {
    return (
      <div
        className="onboarding-floating"
        ref={panelRef}
        style={{ left: position.x, top: position.y, width: size.width }}
      >
        <div className="onboarding-complete-float">
          <div className="complete-icon"><i className="bi bi-trophy-fill"></i></div>
          <h3>You're All Set!</h3>
          <p>Your restaurant is ready to go!</p>
          <button className="btn-dismiss" onClick={dismissOnboarding}>Dismiss</button>
        </div>
      </div>
    );
  }

  // Minimized pill
  if (minimized) {
    return (
      <button
        className="onboarding-pill"
        onClick={() => setMinimized(false)}
        style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}
      >
        <i className="bi bi-rocket-takeoff-fill"></i>
        <span>Setup Guide</span>
        <span className="pill-progress">{completedCount}/{totalSteps}</span>
      </button>
    );
  }

  return (
    <div
      className={`onboarding-floating ${isDragging ? 'dragging' : ''}`}
      ref={panelRef}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        ...(size.height ? { height: size.height } : {}),
      }}
    >
      {/* Draggable Header */}
      <div className="onboarding-drag-header" onMouseDown={handleMouseDown}>
        <div className="drag-handle">
          <i className="bi bi-grip-horizontal"></i>
        </div>
        <div className="header-info">
          <div className="onboarding-icon-sm">
            <i className="bi bi-rocket-takeoff-fill"></i>
          </div>
          <div>
            <h2>Getting Started</h2>
            <p>{completedCount}/{totalSteps} steps done</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-header-action" onClick={() => setMinimized(true)} title="Minimize">
            <i className="bi bi-dash-lg"></i>
          </button>
          <button className="btn-header-action" onClick={dismissOnboarding} title="Dismiss guide">
            <i className="bi bi-x-lg"></i>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="float-progress">
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="progress-text">{progress}%</span>
      </div>

      {/* Scrollable Content */}
      <div className="onboarding-scroll-content">
        <div className="onboarding-categories">
          {visibleCategories.map(catKey => {
            const cat = CATEGORIES[catKey];
            const steps = groupedSteps[catKey] || [];
            const catCompleted = steps.filter(s => completedSteps[s.id]).length;
            const isExpanded = expandedCategory === catKey;

            return (
              <div key={catKey} className={`onboarding-category ${isExpanded ? 'expanded' : ''}`}>
                <button
                  className="category-header"
                  onClick={() => setExpandedCategory(isExpanded ? null : catKey)}
                >
                  <div className="category-info">
                    <div className="category-icon" style={{ color: cat.color }}>
                      <i className={`bi ${cat.icon}`}></i>
                    </div>
                    <div>
                      <h3>{cat.label}</h3>
                      <span className="category-progress">{catCompleted}/{steps.length} complete</span>
                    </div>
                  </div>
                  <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} chevron`}></i>
                </button>

                {isExpanded && (
                  <div className="category-steps">
                    {steps.map(step => {
                      const isDone = !!completedSteps[step.id];
                      const isNext = nextStep?.id === step.id;
                      return (
                        <div key={step.id} className={`step-item ${isDone ? 'completed' : ''} ${isNext ? 'next-step' : ''}`}>
                          <div className="step-check">
                            {isDone ? (
                              <i className="bi bi-check-circle-fill done-icon"></i>
                            ) : (
                              <div className="step-circle" />
                            )}
                          </div>
                          <div className="step-content">
                            <h4>{step.title}</h4>
                            <p>{step.description}</p>
                          </div>
                          <div className="step-actions">
                            {!isDone ? (
                              <Link to={step.link} className="btn-start-step" onClick={() => { completeStep(step.id); startTour(step.id); }}>
                                {isNext ? 'Start' : 'Go'} <i className="bi bi-arrow-right"></i>
                              </Link>
                            ) : (
                              <span className="done-badge">Done</span>
                            )}
                            {!isDone && (
                              <button className="btn-skip-step" onClick={() => completeStep(step.id)} title="Mark as done">
                                Skip
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!showAll ? (
          <button className="btn-show-more" onClick={() => setShowAll(true)}>
            Show all steps <i className="bi bi-chevron-down"></i>
          </button>
        ) : (
          <button className="btn-show-more" onClick={() => setShowAll(false)}>
            Show less <i className="bi bi-chevron-up"></i>
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="resize-handle"
        onMouseDown={(e) => { setIsResizing(true); e.preventDefault(); }}
      />
    </div>
  );
};

export default OnboardingChecklist;
