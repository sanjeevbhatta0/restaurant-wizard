import React, { useState, useEffect } from 'react';
import { Card, Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { FaFacebook, FaInstagram, FaTwitter } from 'react-icons/fa';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import socialMediaService from '../services/socialMediaService';
import FacebookLogin from 'react-facebook-login';

const SeoSocialPosts = ({ user }) => {
  const [connectedAccounts, setConnectedAccounts] = useState({
    facebook: false,
    instagram: false,
    twitter: false
  });
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

  // Load user's social media connections on component mount
  useEffect(() => {
    const loadConnections = async () => {
      try {
        const connections = await socialMediaService.getUserConnections(user.uid);
        setConnectedAccounts({
          facebook: connections.facebook.connected,
          instagram: connections.instagram.connected,
          twitter: connections.twitter.connected
        });
      } catch (err) {
        setError('Failed to load social media connections');
        console.error(err);
      }
    };

    if (user?.uid) {
      loadConnections();
    }
  }, [user]);

  const handleFacebookResponse = async (response) => {
    if (response.accessToken) {
      try {
        setIsLoading(true);
        setError('');
        
        // Store the Facebook access token
        const connectionData = {
          connected: true,
          token: response.accessToken,
          userId: response.userID,
          connectedAt: new Date().toISOString()
        };

        await socialMediaService.updateConnection(user.uid, 'facebook', connectionData);
        
        setConnectedAccounts(prev => ({
          ...prev,
          facebook: true
        }));

        setSuccess('Successfully connected to Facebook');
      } catch (err) {
        setError(`Failed to connect to Facebook: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSocialConnect = async (platform) => {
    try {
      setIsLoading(true);
      setError('');
      
      // Here we'll implement the OAuth flow for each platform
      // For now, we'll simulate a successful connection
      const connectionData = {
        connected: true,
        token: 'dummy-token',
        connectedAt: new Date().toISOString()
      };

      await socialMediaService.updateConnection(user.uid, platform, connectionData);
      
      setConnectedAccounts(prev => ({
        ...prev,
        [platform]: true
      }));

      setSuccess(`Successfully connected to ${platform}`);
    } catch (err) {
      setError(`Failed to connect to ${platform}: ${err.message}`);
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

      // Create post in Firebase
      const postId = await socialMediaService.createPost(user.uid, {
        content: postContent,
        imageUrl,
        platforms: selectedPlatforms
      });

      setSuccess('Post created successfully! It will be published to selected platforms shortly.');
      setPostContent('');
      setSelectedImage(null);
      setSelectedPlatforms({
        facebook: false,
        instagram: false,
        twitter: false
      });
    } catch (err) {
      setError(`Failed to create post: ${err.message}`);
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
              {!connectedAccounts.facebook ? (
                <FacebookLogin
                  appId={process.env.REACT_APP_FACEBOOK_APP_ID}
                  autoLoad={false}
                  fields="name,email,picture"
                  scope="pages_manage_posts,pages_read_engagement"
                  callback={handleFacebookResponse}
                  cssClass="btn btn-primary w-100 mb-3"
                  icon={<FaFacebook className="me-2" />}
                  textButton="Connect Facebook"
                />
              ) : (
                <Button 
                  variant="success"
                  className="w-100 mb-3"
                  disabled
                >
                  <FaFacebook className="me-2" />
                  Connected to Facebook
                </Button>
              )}
            </Col>
            <Col md={4}>
              <Button 
                variant={connectedAccounts.instagram ? "success" : "primary"}
                className="w-100 mb-3"
                onClick={() => handleSocialConnect('instagram')}
                disabled={isLoading}
              >
                <FaInstagram className="me-2" />
                {connectedAccounts.instagram ? 'Connected' : 'Connect Instagram'}
              </Button>
            </Col>
            <Col md={4}>
              <Button 
                variant={connectedAccounts.twitter ? "success" : "primary"}
                className="w-100 mb-3"
                onClick={() => handleSocialConnect('twitter')}
                disabled={isLoading}
              >
                <FaTwitter className="me-2" />
                {connectedAccounts.twitter ? 'Connected' : 'Connect X (Twitter)'}
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
                (!selectedPlatforms.facebook && !selectedPlatforms.instagram && !selectedPlatforms.twitter)
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