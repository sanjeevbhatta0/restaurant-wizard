import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { CardElement, Elements, useStripe, useElements } from '@stripe/react-stripe-js';
import { auth, db } from '../firebase';
import { Form, Button, Card, Alert, Badge, Spinner } from 'react-bootstrap';
import PasswordInput from './PasswordInput';
import { TIER_FEATURES } from '../contexts/SubscriptionContext';
import { getStripe, createStripeSubscription, activateTrialSubscription, calculateTierPrice, formatAmount } from '../services/stripeService';
import { getPublishedConfig } from '../services/adminConfigService';
import { trackPageView, trackSignup } from '../services/platformAnalyticsService';
import { SMS_ENABLED } from '../config/features';
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
  const [phone, setPhone] = useState('');
  const [locationCount, setLocationCount] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1 = account details, 2 = payment
  const [adminConfig, setAdminConfig] = useState(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState('');
  const navigate = useNavigate();

  // Get tier and billing cycle from URL params
  const selectedTier = searchParams.get('tier') || 'ally';
  const billingCycle = searchParams.get('cycle') || 'annual';

  // Validate tier
  const validTier = TIER_FEATURES[selectedTier] ? selectedTier : 'ally';
  const tierInfo = TIER_FEATURES[validTier];

  // Scout tier is free and single-location only
  const isFreeTier = validTier === 'scout';

  // Check if this tier has a free trial enabled via admin config
  const trialConfig = adminConfig?.freeTrials?.[validTier];
  const hasFreeTrial = !isFreeTier && trialConfig?.enabled && trialConfig?.days > 0;

  // Track signup page view on mount and fetch admin config
  useEffect(() => {
    trackPageView('signup');
    getPublishedConfig().then(setAdminConfig);
  }, []);

  // For scout tier, force single location
  const effectiveLocationCount = isFreeTier ? 1 : locationCount;

  // Calculate pricing from live admin config (falls back to defaults while loading)
  const pricing = useMemo(() => {
    if (isFreeTier) {
      return { totalCharge: 0, monthlyPerLocation: 0, billingMonths: 0 };
    }
    return calculateTierPrice(validTier, billingCycle, effectiveLocationCount, adminConfig);
  }, [validTier, billingCycle, effectiveLocationCount, isFreeTier, adminConfig]);

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

    // For free tier, skip payment and create account directly
    if (isFreeTier) {
      await handleFreeSignup();
      return;
    }

    // For tiers with an active free trial, go to payment step to collect card
    // (card is required but won't be charged until trial ends)
    // For paid tiers, go to payment step to charge immediately

    // Move to payment step
    setError('');
    setStep(2);
  };

  // Handle free tier signup (no payment required)
  const handleFreeSignup = async () => {
    try {
      setError('');
      setLoading(true);

      // Create the user account (no payment)
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Update the user profile with the username
      await updateProfile(user, {
        displayName: username
      });

      // Calculate subscription period (monthly for free tier)
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1); // Monthly cycle for free tier

      // Store user data with free tier subscription info
      await setDoc(doc(db, "restaurants", user.uid), {
        restaurantName: restaurantName,
        username: username,
        usernameLower: username.toLowerCase(),
        email: email,
        phone: phone || null,
        isMultiLocation: false, // Scout tier is single location only
        locationCount: 1,
        createdAt: new Date().toISOString(),
        // Free tier subscription data
        subscription: {
          tier: 'scout',
          status: 'active',
          billingCycle: 'monthly', // Free tier uses monthly billing cycle for usage tracking
          locationCount: 1,
          stripePaymentIntentId: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          amountPaid: 0,
          createdAt: new Date().toISOString()
        }
      });

      // Track the signup
      await trackSignup('scout');

      navigate('/home');
    } catch (err) {
      console.error('Signup error:', err);
      const friendlySignupErrors = {
        'auth/email-already-in-use': 'An account with this email already exists. Please log in or use a different email.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
        'auth/operation-not-allowed': 'Account creation is temporarily unavailable. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection and try again.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
      };
      setError(friendlySignupErrors[err.code] || 'Failed to complete signup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return setError('Payment system not loaded. Please refresh the page.');
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      return setError('Card input not ready. Please refresh the page.');
    }
    if (!cardComplete) {
      return setError(cardError || 'Please enter your card details (number, expiration, and CVC) to complete signup.');
    }

    try {
      setError('');
      setLoading(true);

      // Create Stripe Subscription (or trial SetupIntent) on backend
      const subscriptionResult = await createStripeSubscription(
        validTier,
        billingCycle,
        effectiveLocationCount,
        restaurantName,
        email
      );

      let subscriptionId;
      let stripeCustomerId = subscriptionResult.customerId;
      let subscriptionStatus;
      let trialEnd = null;

      if (subscriptionResult.type === 'trial') {
        // TRIAL FLOW: Confirm SetupIntent (saves card, no charge)
        const { error: setupError, setupIntent } = await stripe.confirmCardSetup(
          subscriptionResult.setupIntentClientSecret,
          {
            payment_method: {
              card: cardElement,
              billing_details: { email, name: restaurantName },
            },
          }
        );

        if (setupError) {
          const e = new Error(setupError.message);
          e.type = setupError.type;
          e.code = setupError.code;
          throw e;
        }

        if (setupIntent.status !== 'succeeded') {
          throw new Error('Card setup was not successful. Please try again.');
        }

        // Card saved — now activate the trial subscription on the server
        const trialResult = await activateTrialSubscription({
          customerId: stripeCustomerId,
          priceId: subscriptionResult.priceId,
          locationCount: effectiveLocationCount,
          trialDays: subscriptionResult.trialDays,
          couponId: subscriptionResult.couponId || null,
          tier: validTier,
          billingCycle,
          restaurantName,
        });

        subscriptionId = trialResult.subscriptionId;
        subscriptionStatus = 'trialing';
        trialEnd = trialResult.trialEnd;
      } else {
        // PAID FLOW: Confirm PaymentIntent (charges immediately)
        const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
          subscriptionResult.clientSecret,
          {
            payment_method: {
              card: cardElement,
              billing_details: { email, name: restaurantName },
            },
          }
        );

        if (stripeError) {
          const e = new Error(stripeError.message);
          e.type = stripeError.type;
          e.code = stripeError.code;
          throw e;
        }

        if (paymentIntent.status !== 'succeeded') {
          throw new Error('Payment was not successful. Please try again.');
        }

        subscriptionId = subscriptionResult.subscriptionId;
        subscriptionStatus = 'active';
      }

      // Payment/setup successful — create the user account
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: username });

      const now = new Date();
      const periodMonths = { monthly: 1, quarterly: 3, annual: 12 }[billingCycle];
      const periodEnd = trialEnd ? new Date(trialEnd) : new Date(now);
      if (!trialEnd) {
        periodEnd.setMonth(periodEnd.getMonth() + periodMonths);
      }

      // Store user data with subscription info
      await setDoc(doc(db, "restaurants", user.uid), {
        restaurantName,
        username,
        usernameLower: username.toLowerCase(),
        email,
        phone: phone || null,
        isMultiLocation: effectiveLocationCount > 1,
        locationCount: effectiveLocationCount,
        createdAt: now.toISOString(),
        subscription: {
          tier: validTier,
          status: subscriptionStatus,
          billingCycle,
          locationCount: effectiveLocationCount,
          stripeCustomerId,
          stripeSubscriptionId: subscriptionId,
          stripePaymentIntentId: null,
          ...(trialEnd ? {
            trialStart: now.toISOString(),
            trialEnd,
          } : {}),
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          amountPaid: subscriptionStatus === 'trialing' ? 0 : pricing.totalCharge,
          createdAt: now.toISOString(),
        },
      });

      // If multi-location, create default locations
      if (effectiveLocationCount > 1) {
        for (let i = 1; i <= effectiveLocationCount; i++) {
          const locationId = i === 1 ? user.uid : `${user.uid}_loc_${i}`;
          await setDoc(doc(db, `restaurants/${user.uid}/locations`, locationId), {
            name: i === 1 ? restaurantName : `${restaurantName} - Location ${i}`,
            address: '',
            isDefault: i === 1,
            createdAt: now.toISOString(),
          });
        }
      }

      await trackSignup(validTier);
      navigate('/home');
    } catch (err) {
      console.error('Signup error:', err);
      const friendlySignupErrors = {
        'auth/email-already-in-use': 'An account with this email already exists. Please log in or use a different email.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
        'auth/operation-not-allowed': 'Account creation is temporarily unavailable. Please try again later.',
        'auth/network-request-failed': 'Network error. Please check your connection and try again.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
      };
      // Stripe errors already have user-friendly messages, Firebase auth errors need mapping
      const errorMessage = friendlySignupErrors[err.code] ||
        (err.type === 'card_error' || err.type === 'validation_error' ? err.message : 'Failed to complete signup. Please try again.');
      setError(errorMessage);
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
                <span className="auth-brand-name">Koda Carte</span>
              </div>
              <h2>{step === 1 ? 'Create Account' : 'Complete Payment'}</h2>
              <p>{step === 1 ? (hasFreeTrial ? `Start your ${trialConfig.days}-day free trial` : 'Join Koda Carte today') : 'Secure payment powered by Stripe'}</p>

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
                      {isFreeTier ? (
                        <Badge
                          bg="success"
                          style={{ marginLeft: '8px', fontSize: '0.75rem' }}
                        >
                          FREE
                        </Badge>
                      ) : (
                        <Badge
                          bg="light"
                          text="dark"
                          style={{ marginLeft: '8px', fontSize: '0.75rem' }}
                        >
                          {billingCycle}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {isFreeTier ? (
                      <>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#4ade80' }}>
                          Free
                        </div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                          No credit card required
                        </div>
                      </>
                    ) : hasFreeTrial ? (
                      <>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#4ade80' }}>
                          {trialConfig.days}-day free trial
                        </div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                          {pricing.discount ? (
                            <>
                              Then{' '}
                              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                                {formatAmount(pricing.originalMonthlyPerLocation)}
                              </span>{' '}
                              {formatAmount(pricing.monthlyPerLocation)}/mo per location
                            </>
                          ) : (
                            <>Then {formatAmount(pricing.monthlyPerLocation)}/mo per location</>
                          )}
                        </div>
                        {pricing.discount && (
                          <Badge bg="success" style={{ fontSize: '0.7rem', marginTop: '4px' }}>
                            {pricing.discount.isPercentage ? `${pricing.discount.amount}% off` : `$${pricing.discount.amount} off`} — {pricing.discount.name}
                          </Badge>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                          {pricing.discount ? (
                            <>
                              <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                                ${pricing.originalMonthlyPerLocation}
                              </span>{' '}
                              ${pricing.monthlyPerLocation}/mo per location
                            </>
                          ) : (
                            <>${pricing.monthlyPerLocation}/mo per location</>
                          )}
                        </div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>
                          {formatAmount(pricing.totalCharge)}
                          <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>
                            {' '}for {pricing.billingMonths} month{pricing.billingMonths > 1 ? 's' : ''}
                          </span>
                        </div>
                        {pricing.discount && (
                          <Badge bg="success" style={{ fontSize: '0.7rem', marginTop: '4px' }}>
                            {pricing.discount.isPercentage ? `${pricing.discount.amount}% off` : `$${pricing.discount.amount} off`} — {pricing.discount.name}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Location count adjuster - disabled for scout tier */}
                {isFreeTier ? (
                  <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ fontSize: '0.9rem' }}>Number of Locations:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>1</span>
                      <Badge bg="secondary" style={{ fontSize: '0.7rem' }}>Single location only</Badge>
                    </div>
                  </div>
                ) : (
                  <>
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
                        Total: {effectiveLocationCount} locations × ${pricing.monthlyPerLocation}/mo × {pricing.billingMonths} months = {formatAmount(pricing.totalCharge)}
                      </div>
                    )}
                  </>
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
                    <Form.Label>Phone Number <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>(optional)</span></Form.Label>
                    <Form.Control
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="auth-input"
                      placeholder="(937) 361-9400"
                    />
                    <Form.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
                      {SMS_ENABLED
                        ? "We'll send you a welcome SMS with setup instructions"
                        : "For account recovery and support contact"}
                    </Form.Text>
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
                    disabled={loading}
                    onClick={(e) => {
                      // Explicit click handler as fallback for environments where
                      // type="submit" click doesn't trigger form onSubmit
                      const form = e.target.closest('form');
                      if (form && !form.checkValidity()) {
                        form.reportValidity();
                        return;
                      }
                      if (form) {
                        e.preventDefault();
                        handleAccountSubmit(e);
                      }
                    }}
                  >
                    {loading ? 'Creating Account...' : (isFreeTier ? 'Create Free Account →' : hasFreeTrial ? `Continue — Add Card for Trial →` : 'Continue to Payment →')}
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
                      <span style={{ fontWeight: 600 }}>{effectiveLocationCount}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ color: '#666' }}>Plan</span>
                      <span style={{ fontWeight: 600 }}>{tierInfo?.name} ({billingCycle})</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ color: '#666' }}>Billing</span>
                      <span style={{ fontWeight: 600 }}>
                        Recurring {billingCycle === 'annual' ? 'yearly' : billingCycle}
                      </span>
                    </div>
                    {pricing.discount && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#666' }}>Discount</span>
                        <span style={{ fontWeight: 600, color: '#16a34a' }}>
                          {pricing.discount.isPercentage ? `${pricing.discount.amount}%` : formatAmount(pricing.discount.amount)} off — {pricing.discount.name}
                        </span>
                      </div>
                    )}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingTop: '8px',
                      borderTop: '1px solid #e5e7eb',
                      marginTop: '8px'
                    }}>
                      <span style={{ fontWeight: 700 }}>
                        {hasFreeTrial ? 'After trial' : 'Total'}
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        {pricing.originalMonthlyPerLocation && (
                          <div style={{ fontSize: '0.8rem', textDecoration: 'line-through', color: '#999' }}>
                            {formatAmount(pricing.originalMonthlyPerLocation * effectiveLocationCount * pricing.billingMonths)}
                          </div>
                        )}
                        <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                          {formatAmount(pricing.totalCharge)}
                          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#666' }}>
                            /{billingCycle === 'annual' ? 'yr' : billingCycle === 'quarterly' ? 'qtr' : 'mo'}
                          </span>
                        </span>
                      </div>
                    </div>
                    {hasFreeTrial && (
                      <div style={{
                        marginTop: '8px',
                        padding: '8px 12px',
                        background: '#f0fdf4',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        color: '#16a34a',
                        textAlign: 'center'
                      }}>
                        {trialConfig.days}-day free trial — you won't be charged today
                      </div>
                    )}
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
                      <CardElement
                        options={CARD_ELEMENT_OPTIONS}
                        onChange={(event) => {
                          setCardComplete(event.complete);
                          setCardError(event.error ? event.error.message : '');
                        }}
                      />
                    </div>
                    {cardError && (
                      <Form.Text style={{ display: 'block', marginTop: '8px', color: '#dc2626' }}>
                        {cardError}
                      </Form.Text>
                    )}
                    <Form.Text className="text-muted" style={{ display: 'block', marginTop: '8px' }}>
                      {hasFreeTrial
                        ? 'Your card will be saved and charged after the trial ends'
                        : 'Your payment is secured with Stripe'}
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
                          {hasFreeTrial ? 'Setting up trial...' : 'Processing...'}
                        </>
                      ) : hasFreeTrial ? (
                        `Start ${trialConfig.days}-Day Free Trial`
                      ) : (
                        `Subscribe — ${formatAmount(pricing.totalCharge)}`
                      )}
                    </Button>
                  </div>

                  <p style={{
                    fontSize: '0.75rem',
                    color: '#666',
                    textAlign: 'center',
                    marginTop: '12px'
                  }}>
                    {hasFreeTrial
                      ? `Your free trial starts today. You'll be charged ${formatAmount(pricing.totalCharge)} after ${trialConfig.days} days unless you cancel.`
                      : `You'll be billed ${formatAmount(pricing.totalCharge)} ${billingCycle === 'annual' ? 'annually' : billingCycle}. Cancel anytime.`}
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
