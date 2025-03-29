import React from 'react';
import { Container, Card, ListGroup, Alert } from 'react-bootstrap';

const DataDeletion = () => {
  return (
    <Container className="py-5">
      <h1>Data Deletion Instructions</h1>
      <p className="text-muted">Last updated: {new Date().toLocaleDateString()}</p>

      <Card className="mb-4">
        <Card.Header>
          <h2 className="h4 mb-0">How to Delete Your Data</h2>
        </Card.Header>
        <Card.Body>
          <p>
            Restaurant Wizard values your privacy and makes it easy to delete your personal data
            from our systems. You have multiple options to request data deletion:
          </p>

          <h3 className="h5 mt-4">Option 1: Through Your Account</h3>
          <ListGroup className="mb-4">
            <ListGroup.Item>
              1. Log in to your Restaurant Wizard account
            </ListGroup.Item>
            <ListGroup.Item>
              2. Go to Profile Settings
            </ListGroup.Item>
            <ListGroup.Item>
              3. Click on "Delete Account & Data"
            </ListGroup.Item>
            <ListGroup.Item>
              4. Confirm your decision
            </ListGroup.Item>
          </ListGroup>

          <h3 className="h5">Option 2: Email Request</h3>
          <ListGroup className="mb-4">
            <ListGroup.Item>
              1. Send an email to <a href="mailto:sanjeevbhatta0@gmail.com">sanjeevbhatta0@gmail.com</a>
            </ListGroup.Item>
            <ListGroup.Item>
              2. Subject line: "Data Deletion Request"
            </ListGroup.Item>
            <ListGroup.Item>
              3. Include your account email address
            </ListGroup.Item>
            <ListGroup.Item>
              4. We'll process your request within 30 days
            </ListGroup.Item>
          </ListGroup>

          <Alert variant="info">
            <h4 className="h5">What data will be deleted?</h4>
            <ul className="mb-0">
              <li>Account information</li>
              <li>Restaurant management data</li>
              <li>Social media integration settings</li>
              <li>Post history and analytics</li>
              <li>User preferences and settings</li>
            </ul>
          </Alert>

          <Alert variant="warning">
            <h4 className="h5">Important Notes:</h4>
            <ul className="mb-0">
              <li>Data deletion is permanent and cannot be undone</li>
              <li>Social media posts made through our platform will remain on your social media accounts</li>
              <li>We'll send a confirmation email once deletion is complete</li>
              <li>Backup data may take up to 90 days to be completely removed from our systems</li>
            </ul>
          </Alert>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <h2 className="h4 mb-0">Contact Information</h2>
        </Card.Header>
        <Card.Body>
          <p>If you have any questions about data deletion, please contact us:</p>
          <ul className="mb-0">
            <li>Email: <a href="mailto:sanjeevbhatta0@gmail.com">sanjeevbhatta0@gmail.com</a></li>
            <li>Response Time: Within 2 business days</li>
          </ul>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default DataDeletion; 