import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { CardElement, Elements, useStripe, useElements } from '@stripe/react-stripe-js';
import { auth, db } from '../firebase';
import { Form, Button, Card, Alert, Badge, Spinner } from 'react-bootstrap';
import PasswordInput from './PasswordInput';
import { TIER_FEATURES, TRIAL_PERIOD_DAYS } from '../contexts/SubscriptionContext';
import { getStripe, createTierPayment, calculateTierPrice, formatAmount } from '../services/stripeService';
import './Login.css';

// Stripe card element styling
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#1a1a2e',
      fontFamily: '"Poppins", system-ui, sans-serif',
      fontSmoothing: 'antialiased',
      fontSize: '16px',
      '::placeholder': {
        color: '#aab7c4'
      },
      padding: '12px'
    },
    invalid: {
      color: '#ef4444',
      iconColor: '#ef4444'
    }
  }
};

// Main Signup Form Component (wrapped in Stripe Elements)
const SignupForm = () => {
  const [searchParams] = useSearchParams();
  const stripe = useStripe();
  const elements = useElements();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [username, setUsername] = useState('');
  const [locationCount, setLocationCount] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1 = account details, 2 = payment
  const navigate = useNavigate();

  // Get tier and billing cycle from URL params
  const selectedTier = searchParams.get('tier') || 'ally';
  const billingCycle = searchParams.get('cycle') || 'annual';

  // Validate tier
  const validTier = TIER_FEATURES[selectedTier] ? selectedTier : 'ally';
  const tierInfo = TIER_FEATURES[validTier];

  // Calculate pricing based on locations
  const pricing = useMemo(() => {
    return calculateTierPrice(validTier, billingCycle, locationCount);
  }, [validTier, billingCycle, locationCount]);

  const handleAccountSubmit = async (e) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }

    if (password.length < 6) {
      return setError('Password must be at least 6 characters');
    }

    if (!username.trim()) {
      return setError('Username is required');
    }

    if (!restaurantName.trim()) {
      return setError('Restaurant name is required');
    }

    // Move to payment step
    setError('');
    setStep(2);
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return setError('Payment system not loaded. Please refresh the page.');
    }

    try {
      setError('');
      setLoading(true);

      // Create PaymentIntent on backend
      const { clientSecret, paymentIntentId } = await createTierPayment(
        pricing.totalCharge,
        validTier,
        billingCycle,
        locationCount,
        restaurantName,
        email
      );

      // Confirm payment with Stripe
      const cardElement = elements.getElement(CardElement);
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            email: email,
            name: restaurantName
          }
        }
      });

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (paymentIntent.status !== 'succeeded') {
        throw new Error('Payment was not successful. Please try again.');
      }

      // Payment successful - now create the user account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update the user profile with the username
      await updateProfile(user, {
        displayName: username
      });

      // Calculate subscription period end
      const now = new Date();
      const periodMonths = { monthly: 1, quarterly: 3, annual: 12 }[billingCycle];
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

      // Store user data with subscription info
      await setDoc(doc(db, "restaurants", user.uid), {
        restaurantName: restaurantName,
        username: username,
        usernameLower: username.toLowerCase(),
        email: email,
        isMultiLocation: locationCount > 1,
        locationCount: locationCount,
        createdAt: new Date().toISOString(),
        // Subscription data
        subscription: {
          tier: validTier,
          status: 'active',
          billingCycle: billingCycle,
          locationCount: locationCount,
          stripePaymentIntentId: paymentIntentId,
          // TODO: Replace with Stripe subscription IDs when implementing recurring billing
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          amountPaid: pricing.totalCharge,
          createdAt: new Date().toISOString()
        }
      });

      // If multi-location, create default locations
      if (locationCount > 1) {
        for (let i = 1; i <= locationCount; i++) {
          const locationId = i === 1 ? user.uid : `${user.uid}_loc_${i}`;
          await setDoc(doc(db, `restaurants/${user.uid}/locations`, locationId), {
            name: i === 1 ? restaurantName : `${restaurantName} - Location ${i}`,
            address: '',
            isDefault: i === 1,
            createdAt: new Date().toISOString()
          });
        }
      }

      navigate('/home');
    } catch (err) {
      console.error('Signup error:', err);
      setError(err.message || 'Failed to complete signup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-background"></div>
      <div className="auth-container" style={{ maxWidth: '520px', padding: '20px' }}>
        <div className="auth-card-wrapper">
          <Card className="auth-card">
            <div className="auth-card-header">
              <div className="auth-logo">
                <img
                  src="/koda-carte-logo.png"
                  alt="Koda Carte"
                  style={{ height: '48px', width: 'auto' }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
              <h2>{step === 1 ? 'Create Account' : 'Complete Payment'}</h2>
              <p>{step === 1 ? 'Join Koda Carte today' : 'Secure payment powered by Stripe'}</p>

              {/* Step indicator */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '16px'
              }}>
                <div style={{
                  width: '32px',
                  height: '4px',
                  borderRadius: '2px',
                  background: step >= 1 ? '#40e0d0' : 'rgba(255,255,255,0.3)'
                }} />
                <div style={{
                  width: '32px',
                  height: '4px',
                  borderRadius: '2px',
                  background: step >= 2 ? '#40e0d0' : 'rgba(255,255,255,0.3)'
                }} />
              </div>

              {/* Selected Plan Display */}
              <div style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '12px',
                padding: '16px',
                marginTop: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>Selected Plan:</span>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                      {tierInfo?.icon} {tierInfo?.name}
                      <Badge
                        bg="light"
                        text="dark"
                        style={{ marginLeft: '8px', fontSize: '0.75rem' }}
                      >
                        {billingCycle}
                      </Badge>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                      ${pricing.monthlyPerLocation}/mo per location
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>
                      {formatAmount(pricing.totalCharge)}
                      <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>
                        {' '}for {pricing.billingMonths} month{pricing.billingMonths > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Location count adjuster */}
                <div style={{
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '0.9rem' }}>Number of Locations:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={() => setLocationCount(Math.max(1, locationCount - 1))}
                      disabled={locationCount <= 1}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        fontSize: '1.2rem',
                        cursor: locationCount <= 1 ? 'not-allowed' : 'pointer',
                        opacity: locationCount <= 1 ? 0.5 : 1
                      }}
                    >
                      −
                    </button>
                    <span style={{ fontSize: '1.2rem', fontWeight: 700, minWidth: '32px', textAlign: 'center' }}>
                      {locationCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setLocationCount(locationCount + 1)}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        fontSize: '1.2rem',
                        cursor: 'pointer'
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>

                {locationCount > 1 && (
                  <div style={{
                    marginTop: '8px',
                    fontSize: '0.8rem',
                    opacity: 0.7,
                    textAlign: 'center'
                  }}>
                    Total: {locationCount} locations × ${pricing.monthlyPerLocation}/mo × {pricing.billingMonths} months = {formatAmount(pricing.totalCharge)}
                  </div>
                )}
              </div>

              <Link
                to="/#pricing"
                style={{
                  display: 'block',
                  marginTop: '8px',
                  fontSize: '0.85rem',
                  color: 'rgba(255,255,255,0.7)'
                }}
              >
                Change plan →
              </Link>
            </div>

            <Card.Body className="auth-card-body">
              {error && <Alert variant="danger" className="auth-alert">{error}</Alert>}

              {step === 1 ? (
                <Form onSubmit={handleAccountSubmit}>
                  <Form.Group className="mb-3">
                    <Form.Label>Username</Form.Label>
                    <Form.Control
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="auth-input"
                      placeholder="Choose a username"
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
                      placeholder="Your restaurant name"
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
                      placeholder="your@email.com"
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Password</Form.Label>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="auth-input"
                    />
                  </Form.Group>
                  <Form.Group className="mb-4">
                    <Form.Label>Confirm Password</Form.Label>
                    <PasswordInput
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="auth-input"
                    />
                  </Form.Group>
                  <Button
                    className="auth-button w-100"
                    type="submit"
                  >
                    Continue to Payment →
                  </Button>
                </Form>
              ) : (
                <Form onSubmit={handlePaymentSubmit}>
                  {/* Summary */}
                  <div style={{
                    background: '#f8f9fa',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ color: '#666' }}>Restaurant</span>
                      <span style={{ fontWeight: 600 }}>{restaurantName}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ color: '#666' }}>Locations</span>
                      <span style={{ fontWeight: 600 }}>{locationCount}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ color: '#666' }}>Plan</span>
                      <span style={{ fontWeight: 600 }}>{tierInfo?.name} ({billingCycle})</span>
                    </div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingTop: '8px',
                      borderTop: '1px solid #e5e7eb',
                      marginTop: '8px'
                    }}>
                      <span style={{ fontWeight: 700 }}>Total</span>
                      <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatAmount(pricing.totalCharge)}</span>
                    </div>
                  </div>

                  {/* Card Element */}
                  <Form.Group className="mb-4">
                    <Form.Label>Card Details</Form.Label>
                    <div style={{
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '12px'
                    }}>
                      <CardElement options={CARD_ELEMENT_OPTIONS} />
                    </div>
                    <Form.Text className="text-muted" style={{ display: 'block', marginTop: '8px' }}>
                      🔒 Your payment is secured with Stripe
                    </Form.Text>
                  </Form.Group>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Button
                      variant="outline-secondary"
                      onClick={() => setStep(1)}
                      disabled={loading}
                      style={{ flex: 1 }}
                    >
                      ← Back
                    </Button>
                    <Button
                      disabled={loading || !stripe}
                      className="auth-button"
                      type="submit"
                      style={{ flex: 2 }}
                    >
                      {loading ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Processing...
                        </>
                      ) : (
                        `Pay ${formatAmount(pricing.totalCharge)}`
                      )}
                    </Button>
                  </div>

                  <p style={{
                    fontSize: '0.75rem',
                    color: '#666',
                    textAlign: 'center',
                    marginTop: '12px'
                  }}>
                    By signing up, you agree to our Terms of Service and Privacy Policy
                  </p>
                </Form>
              )}
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

// Wrapper component with Stripe Elements provider
const Signup = () => {
  const [stripePromise, setStripePromise] = useState(null);

  useEffect(() => {
    getStripe().then(setStripePromise);
  }, []);

  if (!stripePromise) {
    return (
      <div className="auth-page">
        <div className="auth-background"></div>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          color: 'white'
        }}>
          <Spinner animation="border" className="me-2" />
          Loading payment system...
        </div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <SignupForm />
    </Elements>
  );
};

export default Signup;
