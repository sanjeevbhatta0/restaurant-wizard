import React, { useState, useEffect } from 'react';
import { Card, Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { FaFacebook, FaInstagram, FaTwitter } from 'react-icons/fa';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import socialMediaService from '../services/socialMediaService';
import { facebookService } from '../services/facebookService';

const SeoSocialPosts = ({ user }) => {
  const [connectedAccounts, setConnectedAccounts] = useState({
    facebook: false,
    instagram: false,
    twitter: false
  });
  const [facebookPages, setFacebookPages] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [postContent, setPostContent] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState({
    facebook: false,
    instagram: false,
    twitter: false
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkFacebookLoginStatus();
  }, []);

  const checkFacebookLoginStatus = async () => {
    try {
      const response = await facebookService.initFacebookLogin();
      if (response.status === 'connected') {
        setConnectedAccounts(prev => ({ ...prev, facebook: true }));
        loadFacebookPages();
      }
    } catch (err) {
      console.error('Error checking Facebook login status:', err);
    }
  };

  const loadFacebookPages = async () => {
    try {
      const pages = await facebookService.getPages();
      setFacebookPages(pages);
      if (pages.length > 0) {
        setSelectedPage(pages[0]);
      }
    } catch (err) {
      console.error('Error loading Facebook pages:', err);
      setError('Failed to load Facebook pages');
    }
  };

  const handleFacebookLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const response = await facebookService.login();
      
      // Store the Facebook access token
      const connectionData = {
        connected: true,
        token: response.authResponse.accessToken,
        userId: response.authResponse.userID,
        connectedAt: new Date().toISOString()
      };

      await socialMediaService.updateConnection(user.uid, 'facebook', connectionData);
      
      setConnectedAccounts(prev => ({
        ...prev,
        facebook: true
      }));

      // Load user's Facebook pages
      await loadFacebookPages();

      setSuccess('Successfully connected to Facebook');
    } catch (err) {
      setError(`Failed to connect to Facebook: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedImage(file);
    }
  };

  const handlePlatformToggle = (platform) => {
    setSelectedPlatforms(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      let imageUrl = null;

      // Upload image if selected
      if (selectedImage) {
        const imageRef = ref(storage, `social-posts/${user.uid}/${Date.now()}-${selectedImage.name}`);
        const uploadResult = await uploadBytes(imageRef, selectedImage);
        imageUrl = await getDownloadURL(uploadResult.ref);
      }

      // Post to Facebook if selected
      if (selectedPlatforms.facebook && selectedPage) {
        await facebookService.postToPage(
          selectedPage.id,
          selectedPage.access_token,
          postContent,
          imageUrl
        );
      }

      setSuccess('Post published successfully!');
      setPostContent('');
      setSelectedImage(null);
      setSelectedPlatforms({
        facebook: false,
        instagram: false,
        twitter: false
      });
    } catch (err) {
      setError(`Failed to publish post: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mt-4">
      <h2>SEO Social Posts</h2>
      
      {/* Social Media Connection Section */}
      <Card className="mb-4">
        <Card.Header>
          <h4>Connect Your Social Media Accounts</h4>
        </Card.Header>
        <Card.Body>
          <Row>
            <Col md={4}>
              <Button 
                variant={connectedAccounts.facebook ? "success" : "primary"}
                className="w-100 mb-3"
                onClick={handleFacebookLogin}
                disabled={isLoading}
              >
                <FaFacebook className="me-2" />
                {connectedAccounts.facebook ? 'Connected to Facebook' : 'Connect Facebook'}
              </Button>
            </Col>
            <Col md={4}>
              <Button 
                variant={connectedAccounts.instagram ? "success" : "primary"}
                className="w-100 mb-3"
                disabled={true}
              >
                <FaInstagram className="me-2" />
                Coming Soon
              </Button>
            </Col>
            <Col md={4}>
              <Button 
                variant={connectedAccounts.twitter ? "success" : "primary"}
                className="w-100 mb-3"
                disabled={true}
              >
                <FaTwitter className="me-2" />
                Coming Soon
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Post Creation Section */}
      <Card>
        <Card.Header>
          <h4>Create New Post</h4>
        </Card.Header>
        <Card.Body>
          <Form onSubmit={handleSubmit}>
            {connectedAccounts.facebook && (
              <Form.Group className="mb-3">
                <Form.Label>Select Facebook Page</Form.Label>
                <Form.Select
                  value={selectedPage?.id || ''}
                  onChange={(e) => setSelectedPage(facebookPages.find(p => p.id === e.target.value))}
                  disabled={isLoading}
                >
                  {facebookPages.map(page => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            <Form.Group className="mb-3">
              <Form.Label>Post Content</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                placeholder="What's on your mind?"
                disabled={isLoading}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Upload Image</Form.Label>
              <Form.Control
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={isLoading}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Select Platforms</Form.Label>
              <div>
                <Form.Check
                  type="checkbox"
                  label="Facebook"
                  checked={selectedPlatforms.facebook}
                  onChange={() => handlePlatformToggle('facebook')}
                  disabled={!connectedAccounts.facebook || isLoading}
                />
                <Form.Check
                  type="checkbox"
                  label="Instagram"
                  checked={selectedPlatforms.instagram}
                  onChange={() => handlePlatformToggle('instagram')}
                  disabled={!connectedAccounts.instagram || isLoading}
                />
                <Form.Check
                  type="checkbox"
                  label="X (Twitter)"
                  checked={selectedPlatforms.twitter}
                  onChange={() => handlePlatformToggle('twitter')}
                  disabled={!connectedAccounts.twitter || isLoading}
                />
              </div>
            </Form.Group>

            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Button 
              variant="primary" 
              type="submit"
              disabled={
                isLoading || 
                !postContent.trim() || 
                (!selectedPlatforms.facebook && !selectedPlatforms.instagram && !selectedPlatforms.twitter) ||
                (selectedPlatforms.facebook && !selectedPage)
              }
            >
              {isLoading ? 'Publishing...' : 'Post to Selected Platforms'}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </div>
  );
};

export default SeoSocialPosts; 