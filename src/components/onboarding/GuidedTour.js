import React, { useCallback } from 'react';
import { Joyride, STATUS } from 'react-joyride';
import { useOnboarding } from '../../contexts/OnboardingContext';
import tourConfigs from './tourConfigs';

const joyrideStyles = {
  options: {
    arrowColor: '#1a1a2e',
    backgroundColor: '#1a1a2e',
    overlayColor: 'rgba(0, 0, 0, 0.6)',
    primaryColor: '#667eea',
    textColor: '#e0e0e0',
    zIndex: 10000,
  },
  tooltip: {
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
  },
  tooltipContainer: {
    textAlign: 'left',
  },
  tooltipTitle: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '8px',
  },
  tooltipContent: {
    fontSize: '14px',
    lineHeight: '1.6',
  },
  buttonNext: {
    backgroundColor: '#667eea',
    borderRadius: '8px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: '500',
  },
  buttonBack: {
    color: '#999',
    fontSize: '14px',
  },
  buttonSkip: {
    color: '#999',
    fontSize: '13px',
  },
  buttonClose: {
    color: '#999',
  },
  spotlight: {
    borderRadius: '8px',
  },
};

const GuidedTour = ({ stepId }) => {
  const { activeTour, endTour } = useOnboarding();

  const steps = tourConfigs[stepId] || [];
  const isActive = activeTour === stepId;

  const handleCallback = useCallback((data) => {
    const { status } = data;
    const finishedStatuses = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      endTour(status === STATUS.FINISHED ? stepId : null);
    }
  }, [endTour, stepId]);

  if (!isActive || steps.length === 0) return null;

  return (
    <Joyride
      steps={steps}
      run={true}
      continuous={true}
      showSkipButton={true}
      showProgress={true}
      callback={handleCallback}
      styles={joyrideStyles}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Got it!',
        next: 'Next',
        skip: 'Skip tour',
      }}
      floaterProps={{
        disableAnimation: false,
      }}
      disableOverlayClose={false}
      disableScrolling={false}
      spotlightClicks={true}
    />
  );
};

export default GuidedTour;
