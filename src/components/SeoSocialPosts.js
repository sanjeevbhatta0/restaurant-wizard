import React, { useState, useEffect, useCallback } from 'react';
import { Container, Button, Form, Row, Col, Alert, Card, Spinner } from 'react-bootstrap';
import { FaFacebook, FaInstagram, FaTwitter, FaImage } from 'react-icons/fa';
import { storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import socialMediaService from '../services/socialMediaService';
import { facebookService } from '../services/facebookService';
import './SeoSocialPosts.css';

const SeoSocialPosts = ({ user }) => {
  const [connectedAccounts, setConnectedAccounts] = useState({
    facebook: false,
    instagram: false,
    twitter: false
  });
  const [facebookPages, setFacebookPages] = useState([]);
  const [selectedFacebookPage, setSelectedFacebookPage] = useState('');
  const [instagramAccounts, setInstagramAccounts] = useState([]);
  const [selectedInstagramAccount, setSelectedInstagramAccount] = useState('');
  const [isInstagramEnabled, setIsInstagramEnabled] = useState(false);
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
    if (user) {
      loadSavedConnections();
    }
  }, [user]);

  const loadSavedConnections = async () => {
    try {
      console.log('Loading saved connections for user:', user.uid);
      const connections = await socialMediaService.getConnections(user.uid);
      console.log('Loaded connections:', connections);
      
      if (connections?.facebook?.connected) {
        console.log('Found Facebook connection, initializing...');
        setConnectedAccounts(prev => ({
          ...prev,
          facebook: true
        }));
        setSelectedPlatforms(prev => ({
          ...prev,
          facebook: true
        }));
        // Load Facebook pages since we're connected
        await checkFacebookLoginStatus();
      }

      if (connections?.instagram?.connected) {
        console.log('Found Instagram connection');
        setConnectedAccounts(prev => ({
          ...prev,
          instagram: true
        }));
        setSelectedPlatforms(prev => ({
          ...prev,
          instagram: true
        }));
      }
    } catch (error) {
      console.error('Error loading saved connections:', error);
      setError('Failed to load saved connections');
    }
  };

  const checkFacebookLoginStatus = useCallback(async () => {
    try {
      console.log('Checking Facebook login status...');
      await facebookService.initFacebookLogin();
      const pages = await facebookService.getPages();
      console.log('Initial Facebook pages load:', pages);
      setFacebookPages(pages);
      if (pages.length > 0) {
        console.log('Setting first page as selected:', pages[0].id);
        setSelectedFacebookPage(pages[0].id);
      }
      
      // Get Instagram accounts
      const instagramAccounts = await facebookService.getInstagramAccounts();
      setInstagramAccounts(instagramAccounts);
      setIsInstagramEnabled(instagramAccounts.length > 0);

      // If pages exist, set Facebook as connected
      if (pages.length > 0) {
        setConnectedAccounts(prev => ({
          ...prev,
          facebook: true
        }));
        setSelectedPlatforms(prev => ({
          ...prev,
          facebook: true
        }));

        // Store the connection in Firebase
        const connectionData = {
          connected: true,
          connectedAt: new Date().toISOString()
        };
        await socialMediaService.updateConnection(user.uid, 'facebook', connectionData);
      }
    } catch (error) {
      console.error('Error checking Facebook login status:', error);
    }
  }, [user]);

  const handleFacebookLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      console.log('Initiating Facebook login...');
      const response = await facebookService.login();
      console.log('Facebook login response:', response);
      
      // Store the Facebook access token
      const connectionData = {
        connected: true,
        token: response.authResponse.accessToken,
        userId: response.authResponse.userID,
        connectedAt: new Date().toISOString()
      };

      console.log('Storing Facebook connection data...');
      await socialMediaService.updateConnection(user.uid, 'facebook', connectionData);
      
      setConnectedAccounts(prev => ({
        ...prev,
        facebook: true
      }));

      setSelectedPlatforms(prev => ({
        ...prev,
        facebook: true
      }));

      // Load user's Facebook pages
      await loadFacebookPages();

      setSuccess('Successfully connected to Facebook');
    } catch (err) {
      console.error('Facebook login error:', err);
      setError(`Failed to connect to Facebook: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFacebookPages = async () => {
    try {
      console.log('Loading Facebook pages...');
      const pages = await facebookService.getPages();
      console.log('Loaded Facebook pages:', pages);
      setFacebookPages(pages);
      if (pages.length > 0) {
        console.log('Setting first page as selected:', pages[0].id);
        setSelectedFacebookPage(pages[0].id);
      }
    } catch (err) {
      console.error('Error loading Facebook pages:', err);
      setError('Failed to load Facebook pages');
    }
  };

  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedImage(file);
    }
  };

  const handlePlatformToggle = (platform) => {
    console.log('Toggling platform:', platform);
    setSelectedPlatforms(prev => {
      const newState = {
        ...prev,
        [platform]: !prev[platform]
      };
      console.log('New selected platforms state:', newState);
      return newState;
    });

    // Reset selected page/account when unchecking a platform
    if (platform === 'facebook' && selectedPlatforms.facebook) {
      setSelectedFacebookPage('');
    } else if (platform === 'instagram' && selectedPlatforms.instagram) {
      setSelectedInstagramAccount('');
    }
  };

  const handleInstagramConnect = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      // Use the same Facebook login since Instagram accounts are managed through Facebook
      await facebookService.login();
      await checkFacebookLoginStatus(); // This will now fetch both Facebook pages and Instagram accounts
      
      setConnectedAccounts(prev => ({ ...prev, instagram: true }));
      
      // Automatically select Instagram platform when connected
      setSelectedPlatforms(prev => ({
        ...prev,
        instagram: true
      }));
    } catch (error) {
      console.error('Error connecting Instagram:', error);
      setError('Failed to connect Instagram. Make sure you have an Instagram Business account connected to your Facebook Page.');
    } finally {
      setIsLoading(false);
    }
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
      if (selectedPlatforms.facebook && selectedFacebookPage) {
        await facebookService.postToPage(
          selectedFacebookPage,
          postContent,
          imageUrl
        );
      } else if (selectedPlatforms.instagram && selectedInstagramAccount) {
        if (!imageUrl) {
          throw new Error('An image is required for Instagram posts');
        }
        await facebookService.postToInstagram(
          selectedInstagramAccount,
          imageUrl,
          postContent
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
    <Container className="py-5">
      <Card className="shadow-sm border-0 mb-4">
        <Card.Header className="bg-white border-0 pt-4 px-4">
          <h2 className="mb-0">Create Social Media Post</h2>
        </Card.Header>
        <Card.Body className="px-4">
          <Row className="mb-4">
            <Col md={4}>
              <Button
                onClick={handleFacebookLogin}
                variant={connectedAccounts.facebook ? "outline-success" : "outline-primary"}
                className="w-100 mb-3 social-btn"
                disabled={isLoading}
              >
                <FaFacebook className="me-2" />
                {connectedAccounts.facebook ? 'Connected to Facebook' : 'Connect Facebook'}
              </Button>
            </Col>
            <Col md={4}>
              <Button
                onClick={handleInstagramConnect}
                variant={connectedAccounts.instagram ? "outline-success" : "outline-primary"}
                className="w-100 mb-3 social-btn"
                disabled={isLoading}
              >
                <FaInstagram className="me-2" />
                {connectedAccounts.instagram ? 'Connected to Instagram' : 'Connect Instagram'}
              </Button>
            </Col>
            <Col md={4}>
              <Button
                variant="outline-secondary"
                className="w-100 mb-3 social-btn"
                disabled={true}
              >
                <FaTwitter className="me-2" />
                Coming Soon
              </Button>
            </Col>
          </Row>

          {error && (
            <Alert variant="danger" className="mb-4 fade-in">
              {error}
            </Alert>
          )}

          {success && (
            <Alert variant="success" className="mb-4 fade-in">
              {success}
            </Alert>
          )}

          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-4">
              <Form.Label className="fw-medium">Select Platforms</Form.Label>
              <div className="platform-checkboxes">
                <Form.Check
                  type="checkbox"
                  id="facebook-check"
                  label="Facebook"
                  checked={selectedPlatforms.facebook}
                  onChange={() => handlePlatformToggle('facebook')}
                  disabled={!connectedAccounts.facebook || isLoading}
                  className="platform-checkbox"
                />
                <Form.Check
                  type="checkbox"
                  id="instagram-check"
                  label="Instagram"
                  checked={selectedPlatforms.instagram}
                  onChange={() => handlePlatformToggle('instagram')}
                  disabled={!connectedAccounts.instagram || isLoading}
                  className="platform-checkbox"
                />
                <Form.Check
                  type="checkbox"
                  id="twitter-check"
                  label="Twitter"
                  checked={selectedPlatforms.twitter}
                  onChange={() => handlePlatformToggle('twitter')}
                  disabled={true}
                  className="platform-checkbox"
                />
              </div>
            </Form.Group>

            {console.log('Render state:', { selectedPlatforms, facebookPages, selectedFacebookPage })}
            
            {selectedPlatforms.facebook && facebookPages.length > 0 && (
              <Form.Group className="mb-4">
                <Form.Label className="fw-medium">Select Facebook Page</Form.Label>
                <Form.Select
                  value={selectedFacebookPage}
                  onChange={(e) => setSelectedFacebookPage(e.target.value)}
                  required
                  className="form-select-lg"
                >
                  <option value="">Choose a page...</option>
                  {facebookPages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            {selectedPlatforms.instagram && (
              <>
                {isInstagramEnabled ? (
                  <Form.Group className="mb-4">
                    <Form.Label className="fw-medium">Select Instagram Account</Form.Label>
                    <Form.Select
                      value={selectedInstagramAccount}
                      onChange={(e) => setSelectedInstagramAccount(e.target.value)}
                      required
                      className="form-select-lg"
                    >
                      <option value="">Choose an account...</option>
                      {instagramAccounts.map((account) => (
                        <option key={account.instagram_account.id} value={account.instagram_account.id}>
                          {account.name}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                ) : (
                  <Alert variant="warning" className="mb-4 fade-in">
                    Please connect an Instagram Business account to your Facebook Page first.
                  </Alert>
                )}
              </>
            )}
            
            <Form.Group className="mb-4">
              <Form.Label className="fw-medium">Message</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                placeholder="What's on your mind?"
                className="form-control-lg"
              />
            </Form.Group>

            <Form.Group className="mb-4">
              <Form.Label className="fw-medium">Image</Form.Label>
              <div className="image-upload-container">
                <Form.Control
                  type="file"
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="d-none"
                  id="image-upload"
                />
                <label 
                  htmlFor="image-upload" 
                  className="image-upload-label"
                >
                  {selectedImage ? (
                    <img src={URL.createObjectURL(selectedImage)} alt="Preview" className="image-preview" />
                  ) : (
                    <>
                      <FaImage size={24} className="mb-2" />
                      <span>Click to upload image</span>
                    </>
                  )}
                </label>
              </div>
            </Form.Group>

            <div className="d-grid">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="mt-4"
                disabled={
                  isLoading ||
                  !postContent.trim() ||
                  (!selectedPlatforms.facebook && !selectedPlatforms.instagram && !selectedPlatforms.twitter) ||
                  (selectedPlatforms.facebook && !selectedFacebookPage) ||
                  (selectedPlatforms.instagram && !selectedInstagramAccount)
                }
              >
                {isLoading ? (
                  <>
                    <Spinner
                      as="span"
                      animation="border"
                      size="sm"
                      role="status"
                      aria-hidden="true"
                      className="me-2"
                    />
                    Posting...
                  </>
                ) : (
                  'Post Now'
                )}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default SeoSocialPosts; 