import React from 'react';
import { Link } from 'react-router-dom';
import './Login.css';

const SmsTerms = () => {
  return (
    <div className="auth-page" style={{ minHeight: '100vh' }}>
      <div className="auth-background"></div>
      <div style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: '800px',
        margin: '0 auto',
        padding: '60px 20px'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
            <img
              src="/koda-carte-logo.png"
              alt="Koda Carte"
              style={{ height: '60px', marginBottom: '16px' }}
            />
            <div style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #b87333 0%, #40e0d0 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Koda Carte
            </div>
          </Link>
        </div>

        {/* Content Card */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: '24px',
          padding: '40px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)'
        }}>
          <h1 style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            color: '#1a1a2e',
            marginBottom: '8px'
          }}>
            SMS Terms & Conditions
          </h1>
          <p style={{ color: '#666', marginBottom: '32px' }}>
            Last updated: April 9, 2026
          </p>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              1. SMS Messaging Service
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              Koda Carte provides SMS messaging services to restaurant customers on behalf of
              restaurants using our platform. These messages include delivery notifications, order
              confirmations, and order receipt messages related to orders placed through
              restaurant websites, ordering widgets, and mobile apps powered by Koda Carte.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              2. Consent & Opt-In
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7, marginBottom: '12px' }}>
              By providing your phone number during the online ordering checkout process,
              you expressly consent to receive transactional SMS messages from Koda Carte
              on behalf of the restaurant. Consent is collected in the following ways:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li><strong>Online Ordering Checkout:</strong> When placing an order through a
                restaurant's website or ordering widget, customers enter their phone number
                and agree to receive order-related text messages before completing their order.</li>
              <li><strong>Delivery Orders:</strong> When placing a delivery order, customers provide
                their phone number for delivery status updates including driver assignment,
                pickup, and dropoff notifications.</li>
              <li><strong>Receipt Requests:</strong> When a customer requests an order receipt to be
                sent via SMS at the point of sale or through the online ordering system.</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              3. Types of Messages
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7, marginBottom: '12px' }}>
              You may receive the following types of SMS messages:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li><strong>Order Confirmations:</strong> Confirmation that your order has been received</li>
              <li><strong>Delivery Notifications:</strong> Updates on your delivery status (driver assigned,
                en route, arriving, delivered)</li>
              <li><strong>Order Receipts:</strong> Digital receipts for completed orders</li>
              <li><strong>Order Status Updates:</strong> Notifications when your order is being prepared or is ready for pickup</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              4. Message Frequency
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              Message frequency varies based on your ordering activity. You will typically receive
              1-5 messages per order placed. Messages are transactional and directly related to
              orders you initiate. No marketing or promotional messages are sent via SMS.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              5. Opt-Out
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              You can opt out of receiving SMS messages at any time by replying <strong>STOP</strong> to
              any message you receive. After opting out, you will receive a confirmation message
              and no further SMS messages will be sent. You may opt back in at any time by
              replying <strong>START</strong> or by providing your phone number during a future order.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              6. Help
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              For help or questions about our SMS messaging, reply <strong>HELP</strong> to any message
              or contact us at <a href="mailto:support@kodacarte.com" style={{ color: '#b87333' }}>support@kodacarte.com</a>.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              7. Rates & Charges
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              Message and data rates may apply. Koda Carte does not charge for SMS messages,
              but your mobile carrier's standard messaging rates may apply. Please contact your
              carrier for details about your messaging plan.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              8. Privacy
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              Your phone number and messaging data are handled in accordance with our{' '}
              <Link to="/privacy-policy" style={{ color: '#b87333' }}>Privacy Policy</Link>.
              We do not sell, share, or distribute your phone number to third parties for
              marketing purposes. Phone numbers are used solely for delivering order-related
              transactional messages.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              9. Supported Carriers
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              SMS messaging is supported on all major U.S. carriers including AT&T, Verizon,
              T-Mobile, Sprint, and others. Carriers are not liable for delayed or undelivered messages.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              10. Contact Us
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              If you have questions about these SMS Terms & Conditions, contact us:
            </p>
            <div style={{
              background: '#f8f9fa',
              borderRadius: '12px',
              padding: '20px',
              marginTop: '16px'
            }}>
              <p style={{ margin: 0, color: '#555' }}>
                <strong>Email:</strong> support@kodacarte.com<br />
                <strong>Address:</strong> Koda Carte, United States
              </p>
            </div>
          </section>

          {/* Footer Links */}
          <div style={{
            borderTop: '1px solid #e5e7eb',
            paddingTop: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <Link to="/" style={{
              color: '#b87333',
              textDecoration: 'none',
              fontWeight: 600
            }}>
              &larr; Back to Home
            </Link>
            <Link to="/privacy-policy" style={{
              color: '#b87333',
              textDecoration: 'none',
              fontWeight: 600
            }}>
              Privacy Policy
            </Link>
            <p style={{ margin: 0, color: '#999', fontSize: '0.9rem' }}>
              &copy; {new Date().getFullYear()} Koda Carte. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SmsTerms;
