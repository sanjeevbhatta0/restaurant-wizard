import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { Container, Card, Form, Button, Alert } from 'react-bootstrap';
import PasswordInput from './PasswordInput';
import 'bootstrap/dist/css/bootstrap.min.css';
import './Login.css';

const Login = () => {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Helper function to check if input is an email
  const isEmail = (str) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  };

  // Look up email by username using Cloud Function
  const getEmailByUsername = async (username) => {
    try {
      // Determine the correct function URL based on environment
      const isEmulator = process.env.REACT_APP_USE_EMULATOR === 'true';
      const functionUrl = isEmulator 
        ? 'http://localhost:5001/restaurant-portal-6b147/us-central1/lookupEmailByUsername'
        : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net/lookupEmailByUsername';
      
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.email;
      }
      
      return null;
    } catch (error) {
      console.error('Error looking up username:', error);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);
      
      let email = usernameOrEmail;
      
      // If input is not an email, try to look it up as username
      if (!isEmail(usernameOrEmail)) {
        const foundEmail = await getEmailByUsername(usernameOrEmail);
        if (!foundEmail) {
          setError('Username or email not found');
          setLoading(false);
          return;
        }
        email = foundEmail;
      }
      
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/home');
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        setError('Username or email not found');
      } else if (error.code === 'auth/wrong-password') {
        setError('Incorrect password');
      } else if (error.code === 'auth/invalid-email') {
        setError('Invalid email format');
      } else {
        setError('Failed to sign in: ' + error.message);
      }
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-background"></div>
      <Container className="auth-container">
        <div className="auth-card-wrapper">
          <Card className="auth-card">
            <div className="auth-card-header">
              <div className="auth-logo">
                <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 2L4 8V16C4 22.6 9.4 28 16 28C22.6 28 28 22.6 28 16V8L16 2Z" fill="white"/>
                  <path d="M16 6L8 10V16C8 20.4 11.6 24 16 24C20.4 24 24 20.4 24 16V10L16 6Z" fill="rgba(255,255,255,0.8)"/>
                  <circle cx="16" cy="16" r="4" fill="#667eea"/>
                </svg>
              </div>
              <h2>Welcome Back</h2>
              <p>Sign in to Koda Carte</p>
            </div>
            <Card.Body className="auth-card-body">
              {error && <Alert variant="danger" className="auth-alert">{error}</Alert>}
              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Username or Email</Form.Label>
                  <Form.Control 
                    type="text" 
                    value={usernameOrEmail}
                    onChange={(e) => setUsernameOrEmail(e.target.value)}
                    required 
                    className="auth-input"
                    placeholder="Enter your username or email"
                  />
                  <Form.Text className="text-muted">
                    You can login with either your username or email address
                  </Form.Text>
                </Form.Group>
                <Form.Group className="mb-4">
                  <Form.Label>Password</Form.Label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required 
                    className="auth-input"
                  />
                </Form.Group>
                <Button 
                  disabled={loading} 
                  className="auth-button w-100" 
                  type="submit"
                >
                  {loading ? 'Signing in...' : 'Log In'}
                </Button>
              </Form>
            </Card.Body>
            <Card.Footer className="auth-card-footer">
              <div className="text-center">
                Don't have an account? <Link to="/signup" className="auth-link">Sign Up</Link>
              </div>
            </Card.Footer>
          </Card>
        </div>
      </Container>
    </div>
  );
};

export default Login;
