import React from 'react';
import { Container } from 'react-bootstrap';

const AppIcon = () => {
  const iconStyle = {
    width: '1024px',
    height: '1024px',
    background: 'linear-gradient(135deg, #4a90e2 0%, #2c3e50 100%)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: '200px',
    position: 'relative',
    overflow: 'hidden'
  };

  const innerCircleStyle = {
    width: '800px',
    height: '800px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '50%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative'
  };

  const textStyle = {
    color: 'white',
    fontSize: '120px',
    fontWeight: 'bold',
    fontFamily: 'Arial, sans-serif',
    textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
  };

  const decorationStyle = {
    position: 'absolute',
    width: '200px',
    height: '200px',
    border: '20px solid rgba(255,255,255,0.2)',
    borderRadius: '50%'
  };

  return (
    <Container className="p-3" style={{ background: '#f8f9fa' }}>
      <div style={iconStyle}>
        <div style={{ ...decorationStyle, top: '100px', left: '100px' }} />
        <div style={{ ...decorationStyle, bottom: '100px', right: '100px' }} />
        <div style={innerCircleStyle}>
          <div style={textStyle}>RW</div>
        </div>
      </div>
      <div className="mt-3">
        <p>This is your 1024x1024 app icon preview. To save it:</p>
        <ol>
          <li>Take a screenshot of this icon (make sure to capture the full square)</li>
          <li>Crop it to exactly 1024x1024 pixels</li>
          <li>Save it as PNG format</li>
        </ol>
      </div>
    </Container>
  );
};

export default AppIcon; 