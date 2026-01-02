import React from 'react';
import { Link } from 'react-router-dom';
import './Login.css';

const PrivacyPolicy = () => {
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
            Privacy Policy
          </h1>
          <p style={{ color: '#666', marginBottom: '32px' }}>
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              1. Introduction
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              Welcome to Koda Carte ("we," "our," or "us"). We respect your privacy and are committed
              to protecting your personal data. This privacy policy explains how we collect, use, and
              safeguard your information when you use our restaurant management platform.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              2. Information We Collect
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7, marginBottom: '12px' }}>
              We collect information that you provide directly to us:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li><strong>Account Information:</strong> Name, email address, username, and password</li>
              <li><strong>Business Information:</strong> Restaurant name, address, and contact details</li>
              <li><strong>Payment Information:</strong> Billing details processed securely through Stripe</li>
              <li><strong>Menu Data:</strong> Menu items, categories, prices, and images you upload</li>
              <li><strong>Order Data:</strong> Customer orders and transaction history</li>
              <li><strong>Social Media Data:</strong> Connected account information when you link social profiles</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              3. How We Use Your Information
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7, marginBottom: '12px' }}>
              We use the information we collect to:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li>Provide, maintain, and improve our services</li>
              <li>Process transactions and manage your subscription</li>
              <li>Send you technical notices, updates, and support messages</li>
              <li>Generate analytics and insights for your restaurant</li>
              <li>Post content to your connected social media accounts (with your explicit permission)</li>
              <li>Respond to your comments, questions, and customer service requests</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              4. Social Media Integration
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              When you connect your social media accounts (Facebook, Instagram), we:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li>Store authentication tokens securely using industry-standard encryption</li>
              <li>Only post content when you explicitly initiate or schedule a post</li>
              <li>Never share your social media credentials with third parties</li>
              <li>Allow you to disconnect and revoke access at any time</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              5. Data Security
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              We implement appropriate security measures to protect your personal information, including:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li>Encryption of data in transit and at rest</li>
              <li>Secure cloud infrastructure powered by Google Firebase</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Access controls and authentication requirements</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              6. Your Rights
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7, marginBottom: '12px' }}>
              You have the following rights regarding your personal data:
            </p>
            <ul style={{ color: '#555', lineHeight: 1.9, paddingLeft: '20px' }}>
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your account and data</li>
              <li><strong>Portability:</strong> Request export of your data in a machine-readable format</li>
              <li><strong>Withdraw Consent:</strong> Revoke permissions for social media integration</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              7. Data Retention
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              We retain your personal data for as long as your account is active or as needed to provide
              you services. You can request deletion at any time, and we will delete your data within
              30 days, except where we are required to retain it for legal purposes.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '12px' }}>
              8. Contact Us
            </h2>
            <p style={{ color: '#555', lineHeight: 1.7 }}>
              If you have questions about this Privacy Policy or wish to exercise your rights, contact us:
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
              ← Back to Home
            </Link>
            <p style={{ margin: 0, color: '#999', fontSize: '0.9rem' }}>
              © {new Date().getFullYear()} Koda Carte. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;