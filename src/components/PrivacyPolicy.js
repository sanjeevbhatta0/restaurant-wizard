import React from 'react';
import { Container } from 'react-bootstrap';

const PrivacyPolicy = () => {
  return (
    <Container className="py-5">
      <h1>Privacy Policy</h1>
      <p>Last updated: {new Date().toLocaleDateString()}</p>

      <section className="mb-4">
        <h2>1. Introduction</h2>
        <p>
          Welcome to Restaurant Wizard. We respect your privacy and are committed to protecting your personal data.
          This privacy policy will inform you about how we handle your personal data when you use our service and
          tell you about your privacy rights.
        </p>
      </section>

      <section className="mb-4">
        <h2>2. Data We Collect</h2>
        <p>We collect and process the following data:</p>
        <ul>
          <li>Account information (email, name, business details)</li>
          <li>Restaurant management data</li>
          <li>Social media integration data</li>
          <li>Usage data and analytics</li>
        </ul>
      </section>

      <section className="mb-4">
        <h2>3. How We Use Your Data</h2>
        <p>We use your data to:</p>
        <ul>
          <li>Provide and maintain our service</li>
          <li>Manage your restaurant operations</li>
          <li>Post content to your social media accounts (with your permission)</li>
          <li>Improve our services</li>
          <li>Communicate with you about our services</li>
        </ul>
      </section>

      <section className="mb-4">
        <h2>4. Social Media Integration</h2>
        <p>
          When you connect your social media accounts, we:
        </p>
        <ul>
          <li>Store authentication tokens securely</li>
          <li>Post content only with your explicit permission</li>
          <li>Never share your social media credentials</li>
          <li>Allow you to revoke access at any time</li>
        </ul>
      </section>

      <section className="mb-4">
        <h2>5. Data Storage and Security</h2>
        <p>
          We use industry-standard security measures to protect your data. Your data is stored securely
          using Firebase, and we regularly review our security practices.
        </p>
      </section>

      <section className="mb-4">
        <h2>6. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access your personal data</li>
          <li>Correct inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Withdraw consent for social media integration</li>
          <li>Export your data</li>
        </ul>
      </section>

      <section className="mb-4">
        <h2>7. Data Deletion</h2>
        <p>
          You can request deletion of your data by:
        </p>
        <ul>
          <li>Using the account deletion option in your profile settings</li>
          <li>Emailing our support team at sanjeevbhatta0@gmail.com</li>
          <li>Submitting a deletion request through our contact form</li>
        </ul>
      </section>

      <section className="mb-4">
        <h2>8. Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy, you can contact us:
        </p>
        <ul>
          <li>By email: sanjeevbhatta0@gmail.com</li>
          <li>Through our website contact form</li>
        </ul>
      </section>
    </Container>
  );
};

export default PrivacyPolicy; 