import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Form, Button, Card, Alert } from 'react-bootstrap';
import './Login.css';

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }
    
    try {
      setError('');
      setLoading(true);
      
      // Create the user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Update the user profile with the username
      await updateProfile(user, {
        displayName: username
      });
      
      // Store additional user data in Firestore
      await setDoc(doc(db, "restaurants", user.uid), {
        restaurantName: restaurantName,
        username: username,
        email: email,
        createdAt: new Date().toISOString()
      });
      
      navigate('/home');
    } catch (err) {
      setError('Failed to create an account: ' + err.message);
      console.error(err);
    }
    
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-background"></div>
      <div className="auth-container" style={{ maxWidth: '500px', padding: '20px' }}>
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
              <h2>Create Account</h2>
              <p>Join Koda Carte today</p>
            </div>
            <Card.Body className="auth-card-body">
              {error && <Alert variant="danger" className="auth-alert">{error}</Alert>}
              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-3">
                  <Form.Label>Username</Form.Label>
                  <Form.Control 
                    type="text" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required 
                    className="auth-input"
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Restaurant Name</Form.Label>
                  <Form.Control 
                    type="text" 
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    required 
                    className="auth-input"
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required 
                    className="auth-input"
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Password</Form.Label>
                  <Form.Control 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required 
                    className="auth-input"
                  />
                </Form.Group>
                <Form.Group className="mb-4">
                  <Form.Label>Confirm Password</Form.Label>
                  <Form.Control 
                    type="password" 
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required 
                    className="auth-input"
                  />
                </Form.Group>
                <Button 
                  disabled={loading} 
                  className="auth-button w-100" 
                  type="submit"
                >
                  {loading ? 'Creating Account...' : 'Sign Up'}
                </Button>
              </Form>
            </Card.Body>
            <Card.Footer className="auth-card-footer">
              <div className="text-center">
                Already have an account? <Link to="/login" className="auth-link">Log In</Link>
              </div>
            </Card.Footer>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Signup;
