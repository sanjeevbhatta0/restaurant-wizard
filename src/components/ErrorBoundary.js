import React from 'react';
import { Container, Card, Button } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
          <Card className="text-center p-4" style={{ maxWidth: '480px', width: '100%' }}>
            <Card.Body>
              <h1 style={{ fontSize: '3rem', fontWeight: '700', color: '#e74c3c', marginBottom: '8px' }}>
                Oops!
              </h1>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '12px' }}>
                Something went wrong
              </h2>
              <p className="text-muted" style={{ marginBottom: '24px' }}>
                An unexpected error occurred. Your data is safe — please try reloading the page.
              </p>
              <div className="d-flex gap-2 justify-content-center">
                <Button variant="outline-secondary" onClick={this.handleGoHome}>
                  Go Home
                </Button>
                <Button
                  onClick={this.handleReload}
                  style={{ backgroundColor: '#40e0d0', border: 'none', color: '#1a1a2e' }}
                >
                  Reload Page
                </Button>
              </div>
            </Card.Body>
          </Card>
        </Container>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
