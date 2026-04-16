import React from 'react';
import { Link } from 'react-router-dom';
import { Container, Card, Button } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

const NotFound = () => {
  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card className="text-center p-4" style={{ maxWidth: '480px', width: '100%' }}>
        <Card.Body>
          <h1 style={{ fontSize: '4rem', fontWeight: '700', color: '#40e0d0', marginBottom: '8px' }}>404</h1>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '12px' }}>Page Not Found</h2>
          <p className="text-muted" style={{ marginBottom: '24px' }}>
            The page you're looking for doesn't exist or has been moved.
          </p>
          <div className="d-flex gap-2 justify-content-center">
            <Link to="/">
              <Button variant="outline-secondary">Go Home</Button>
            </Link>
            <Link to="/login">
              <Button style={{ backgroundColor: '#40e0d0', border: 'none', color: '#1a1a2e' }}>
                Log In
              </Button>
            </Link>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default NotFound;
