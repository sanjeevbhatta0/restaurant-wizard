import React, { useState, useEffect } from 'react';
import { Container, Card, Alert, Button } from 'react-bootstrap';

const WebsiteIntegration = ({ user }) => {
  const [embedCode, setEmbedCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Generate the embed code using the user's restaurant ID
    const code = `<div id="restaurant-menu-${user.uid}"></div>
<script src="https://restaurant-portal-6b147.web.app/embed.js"></script>
<script>
  RestaurantMenu.init({
    restaurantId: "${user.uid}",
    container: "restaurant-menu-${user.uid}"
  });
</script>`;
    setEmbedCode(code);
  }, [user]);

  const handleCopy = () => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Container className="mt-4">
      <h2 className="mb-4">Website Integration</h2>
      
      <Card className="mb-4">
        <Card.Body>
          <Card.Title>Add Your Menu to Your Website</Card.Title>
          <Card.Text>
            Follow these steps to integrate your menu into your website:
          </Card.Text>
          <ol>
            <li className="mb-2">Copy the code below</li>
            <li className="mb-2">Paste it into your website's HTML where you want the menu to appear</li>
            <li className="mb-2">The menu will automatically sync with any changes you make here</li>
          </ol>
          
          <Alert variant="info">
            Your menu will inherit your website's styles for a seamless look.
          </Alert>

          <div className="bg-light p-3 rounded position-relative">
            <pre className="mb-0">
              <code>{embedCode}</code>
            </pre>
            <Button
              variant="primary"
              className="position-absolute top-0 end-0 m-3"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy Code'}
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Card.Title>Preview</Card.Title>
          <Card.Text>
            This is how your menu will look on your website:
          </Card.Text>
          <div 
            id={`restaurant-menu-${user.uid}`} 
            className="border rounded p-3"
          >
            Loading preview...
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default WebsiteIntegration; 