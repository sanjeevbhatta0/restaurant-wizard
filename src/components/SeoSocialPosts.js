import React, { useState, useEffect, useCallback } from 'react';
import { 
  Container, Button, Form, Row, Col, Alert, Card, Spinner, 
  Tab, Nav, Badge, Modal, OverlayTrigger, Tooltip, Dropdown,
  ProgressBar, ListGroup, Accordion
} from 'react-bootstrap';
import { FaFacebook, FaInstagram, FaTwitter, FaImage, FaMagic, FaRobot, FaLightbulb, 
  FaChartLine, FaCalendarAlt, FaHashtag, FaCopy, FaRedo, FaCheck, FaSearch,
  FaGoogle, FaMapMarkerAlt, FaStar, FaExclamationTriangle } from 'react-icons/fa';
import { storage, db } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, collection, addDoc, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import socialMediaService from '../services/socialMediaService';
import aiContentService from '../services/aiContentService';
import { facebookService } from '../services/facebookService';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import './SeoSocialPosts.css';
import './PageHeader.css';

const SeoSocialPosts = () => {
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation, locations } = useLocation();
  
  // Connection states
  const [connectedAccounts, setConnectedAccounts] = useState({
    facebook: false,
    instagram: false,
    twitter: false
  });
  const [facebookPages, setFacebookPages] = useState([]);
  const [selectedFacebookPage, setSelectedFacebookPage] = useState('');
  const [instagramAccounts, setInstagramAccounts] = useState([]);
  const [selectedInstagramAccount, setSelectedInstagramAccount] = useState('');
  
  // Restaurant data
  const [restaurantData, setRestaurantData] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  
  // Content creation states
  const [postContent, setPostContent] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState({
    facebook: false,
    instagram: false,
    twitter: false
  });
  
  // AI states
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [suggestedHashtags, setSuggestedHashtags] = useState([]);
  const [selectedHashtags, setSelectedHashtags] = useState([]);
  const [contentIdeas, setContentIdeas] = useState([]);
  const [seoData, setSeoData] = useState(null);
  const [isLoadingSeo, setIsLoadingSeo] = useState(false);
  
  // UI states
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('create');
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiContentType, setAiContentType] = useState('general');
  const [aiTone, setAiTone] = useState('friendly');
  const [aiPlatform, setAiPlatform] = useState('instagram');
  const [selectedMenuItem, setSelectedMenuItem] = useState('');
  const [postHistory, setPostHistory] = useState([]);
  const [copied, setCopied] = useState('');

  // Load initial data
  useEffect(() => {
    if (currentUser) {
      loadRestaurantData();
      loadSavedConnections();
      loadMenuItems();
      loadPostHistory();
    }
  }, [currentUser, selectedLocation]);

  const loadRestaurantData = async () => {
    try {
      const restaurantDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}`));
      if (restaurantDoc.exists()) {
        const data = restaurantDoc.data();
        
        // Get location-specific data if multi-location
        if (isMultiLocation && selectedLocation) {
          const locationDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}/locations/${selectedLocation}`));
          if (locationDoc.exists()) {
            const locationData = locationDoc.data();
            setRestaurantData({ ...data, ...locationData, locationName: locationData.name });
          } else {
            setRestaurantData(data);
          }
        } else {
          setRestaurantData(data);
        }
      }
    } catch (error) {
      console.error('Error loading restaurant data:', error);
    }
  };

  const loadMenuItems = async () => {
    try {
      const categoriesSnapshot = await getDocs(
        collection(db, `restaurants/${currentUser.uid}/menuCategories`)
      );
      
      const items = [];
      for (const categoryDoc of categoriesSnapshot.docs) {
        const itemsSnapshot = await getDocs(
          collection(db, `restaurants/${currentUser.uid}/menuCategories/${categoryDoc.id}/items`)
        );
        itemsSnapshot.forEach(itemDoc => {
          const itemData = itemDoc.data();
          // Filter by location if multi-location
          if (!isMultiLocation || !selectedLocation || 
              !itemData.locations || itemData.locations.length === 0 || 
              itemData.locations.includes(selectedLocation)) {
            items.push({ id: itemDoc.id, categoryName: categoryDoc.data().name, ...itemData });
          }
        });
      }
      setMenuItems(items);
    } catch (error) {
      console.error('Error loading menu items:', error);
    }
  };

  const loadPostHistory = async () => {
    try {
      const postsQuery = query(
        collection(db, `restaurants/${currentUser.uid}/socialPosts`),
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      const snapshot = await getDocs(postsQuery);
      const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPostHistory(posts);
    } catch (error) {
      console.error('Error loading post history:', error);
    }
  };

  const loadSavedConnections = async () => {
    try {
      const connections = await socialMediaService.getConnections(currentUser.uid);
      
      if (connections?.facebook?.connected) {
        setConnectedAccounts(prev => ({ ...prev, facebook: true }));
        await checkFacebookLoginStatus();
      }
      
      if (connections?.instagram?.connected) {
        setConnectedAccounts(prev => ({ ...prev, instagram: true }));
      }
    } catch (error) {
      console.error('Error loading saved connections:', error);
    }
  };

  const checkFacebookLoginStatus = useCallback(async () => {
    try {
      await facebookService.initFacebookLogin();
      const pages = await facebookService.getPages();
      setFacebookPages(pages);
      if (pages.length > 0) {
        setSelectedFacebookPage(pages[0].id);
      }
      
      const igAccounts = await facebookService.getInstagramAccounts();
      setInstagramAccounts(igAccounts);
      
      if (pages.length > 0) {
        setConnectedAccounts(prev => ({ ...prev, facebook: true }));
        await socialMediaService.updateConnection(currentUser.uid, 'facebook', {
          connected: true,
          connectedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error checking Facebook login status:', error);
    }
  }, [currentUser]);

  // AI Content Generation
  const handleGenerateContent = async () => {
    setIsGenerating(true);
    setError('');
    
    try {
      const context = {
        restaurantName: restaurantData?.name || restaurantData?.restaurantName,
        cuisineType: restaurantData?.cuisineType || 'Restaurant',
        location: restaurantData?.address || restaurantData?.locationName
      };
      
      // Add menu item context if selected
      if (aiContentType === 'menu_feature' && selectedMenuItem) {
        const menuItem = menuItems.find(item => item.id === selectedMenuItem);
        if (menuItem) {
          context.menuItem = {
            name: menuItem.name,
            description: menuItem.description,
            price: menuItem.price
          };
        }
      }
      
      const result = await aiContentService.generatePost({
        type: aiContentType,
        platform: aiPlatform,
        tone: aiTone,
        context
      });
      
      if (result.success && result.content) {
        setGeneratedContent(result.content);
        setSuggestedHashtags(result.content.hashtags || []);
      }
    } catch (error) {
      console.error('Error generating content:', error);
      setError('Failed to generate content. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUseGeneratedContent = () => {
    if (generatedContent?.caption) {
      // Combine caption with selected hashtags
      let finalContent = generatedContent.caption;
      if (selectedHashtags.length > 0) {
        finalContent += '\n\n' + selectedHashtags.map(h => `#${h}`).join(' ');
      }
      setPostContent(finalContent);
      setShowAIModal(false);
      setSuccess('AI-generated content added! Feel free to edit before posting.');
    }
  };

  const handleImproveContent = async (instruction) => {
    if (!postContent.trim()) {
      setError('Please write some content first');
      return;
    }
    
    setIsGenerating(true);
    setError('');
    
    try {
      const result = await aiContentService.improveContent(postContent, instruction);
      if (result.success && result.improvedContent) {
        setPostContent(result.improvedContent);
        setSuccess('Content improved!');
      }
    } catch (error) {
      console.error('Error improving content:', error);
      setError('Failed to improve content');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateHashtags = async () => {
    if (!postContent.trim()) {
      setError('Please write some content first');
      return;
    }
    
    setIsGenerating(true);
    
    try {
      const platform = Object.keys(selectedPlatforms).find(p => selectedPlatforms[p]) || 'instagram';
      const result = await aiContentService.generateHashtags(postContent, platform);
      if (result.success && result.hashtags) {
        setSuggestedHashtags(result.hashtags);
      }
    } catch (error) {
      console.error('Error generating hashtags:', error);
      setError('Failed to generate hashtags');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLoadSeoData = async () => {
    setIsLoadingSeo(true);
    
    try {
      const result = await aiContentService.getSeoRecommendations({
        name: restaurantData?.name || restaurantData?.restaurantName,
        address: restaurantData?.address,
        cuisineType: restaurantData?.cuisineType,
        websiteUrl: restaurantData?.websiteUrl,
        hasOnlineOrdering: true,
        socialMedia: connectedAccounts.facebook ? 'Facebook connected' : 'Not connected'
      });
      
      if (result.success && result.recommendations) {
        setSeoData(result.recommendations);
      }
    } catch (error) {
      console.error('Error loading SEO data:', error);
      setError('Failed to load SEO analysis. Make sure the AI service is configured.');
    } finally {
      setIsLoadingSeo(false);
    }
  };

  const handleLoadContentIdeas = async () => {
    setIsGenerating(true);
    
    try {
      const result = await aiContentService.getContentIdeas({
        restaurantName: restaurantData?.name || restaurantData?.restaurantName,
        cuisineType: restaurantData?.cuisineType,
        location: restaurantData?.address,
        currentMonth: new Date().toLocaleString('default', { month: 'long' })
      });
      
      if (result.success && result.ideas) {
        setContentIdeas(result.ideas);
      }
    } catch (error) {
      console.error('Error loading content ideas:', error);
      setError('Failed to load content ideas');
    } finally {
      setIsGenerating(false);
    }
  };

  // Social Media Actions
  const handleFacebookLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const response = await facebookService.login();
      await socialMediaService.updateConnection(currentUser.uid, 'facebook', {
        connected: true,
        token: response.authResponse.accessToken,
        userId: response.authResponse.userID,
        connectedAt: new Date().toISOString()
      });
      
      setConnectedAccounts(prev => ({ ...prev, facebook: true }));
      await checkFacebookLoginStatus();
      setSuccess('Successfully connected to Facebook!');
    } catch (err) {
      setError(`Failed to connect to Facebook: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstagramConnect = async () => {
    try {
      setIsLoading(true);
      await facebookService.login();
      await checkFacebookLoginStatus();
      setConnectedAccounts(prev => ({ ...prev, instagram: true }));
    } catch (error) {
      setError('Failed to connect Instagram. Make sure you have an Instagram Business account.');
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

      if (selectedImage) {
        const imageRef = ref(storage, `social-posts/${currentUser.uid}/${Date.now()}-${selectedImage.name}`);
        const uploadResult = await uploadBytes(imageRef, selectedImage);
        imageUrl = await getDownloadURL(uploadResult.ref);
      }

      // Post to selected platforms
      if (selectedPlatforms.facebook && selectedFacebookPage) {
        const page = facebookPages.find(p => p.id === selectedFacebookPage);
        await facebookService.postToPage(selectedFacebookPage, page.access_token, postContent, imageUrl);
      }
      
      if (selectedPlatforms.instagram && selectedInstagramAccount) {
        if (!imageUrl) {
          throw new Error('An image is required for Instagram posts');
        }
        await facebookService.postToInstagram(selectedInstagramAccount, imageUrl, postContent);
      }

      // Save to history
      await addDoc(collection(db, `restaurants/${currentUser.uid}/socialPosts`), {
        content: postContent,
        imageUrl,
        platforms: selectedPlatforms,
        createdAt: Timestamp.now(),
        locationId: selectedLocation || null
      });

      setSuccess('🎉 Post published successfully!');
      setPostContent('');
      setSelectedImage(null);
      setSuggestedHashtags([]);
      setSelectedHashtags([]);
      loadPostHistory();
    } catch (err) {
      setError(`Failed to publish post: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  const toggleHashtag = (hashtag) => {
    setSelectedHashtags(prev => 
      prev.includes(hashtag) 
        ? prev.filter(h => h !== hashtag)
        : [...prev, hashtag]
    );
  };

  const addHashtagsToContent = () => {
    if (selectedHashtags.length > 0) {
      const hashtagString = '\n\n' + selectedHashtags.map(h => `#${h}`).join(' ');
      setPostContent(prev => prev + hashtagString);
      setSelectedHashtags([]);
      setSuggestedHashtags([]);
    }
  };

  const getLocationName = () => {
    if (!isMultiLocation) return '';
    const location = locations?.find(l => l.id === selectedLocation);
    return location?.name || '';
  };

  return (
    <Container className="py-4 seo-social-container">
      {/* Page Header */}
      <div className="page-header-gradient ai-header">
        <div className="header-content">
          <i className="bi bi-stars header-icon"></i>
          <div>
            <h2>SEO & Social Media <Badge bg="warning" text="dark" className="ms-2">AI Powered</Badge></h2>
            <p>Create engaging content, manage social media, and boost your online presence</p>
          </div>
        </div>
      </div>

      {/* Multi-location notice */}
      {isMultiLocation && (
        <Alert variant="info" className="mb-4">
          <i className="bi bi-geo-alt-fill me-2"></i>
          Managing social media for <strong>{getLocationName()}</strong>
        </Alert>
      )}

      {/* Main Tabs */}
      <Tab.Container activeKey={activeTab} onSelect={setActiveTab}>
        <Nav variant="pills" className="mb-4 main-nav-pills">
          <Nav.Item>
            <Nav.Link eventKey="create">
              <FaMagic className="me-2" />Create Post
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="ideas">
              <FaLightbulb className="me-2" />Content Ideas
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="seo">
              <FaSearch className="me-2" />SEO Analysis
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="history">
              <FaCalendarAlt className="me-2" />Post History
            </Nav.Link>
          </Nav.Item>
        </Nav>

        <Tab.Content>
          {/* CREATE POST TAB */}
          <Tab.Pane eventKey="create">
            <Row>
              {/* Main Content Creation */}
              <Col lg={8}>
                <Card className="shadow-sm mb-4">
                  <Card.Header className="bg-white py-3">
                    <div className="d-flex justify-content-between align-items-center">
                      <h5 className="mb-0">Create Your Post</h5>
                      <Button 
                        variant="primary" 
                        onClick={() => setShowAIModal(true)}
                        className="ai-generate-btn"
                      >
                        <FaRobot className="me-2" />Generate with AI
                      </Button>
                    </div>
                  </Card.Header>
                  <Card.Body>
                    {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
                    {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

                    <Form onSubmit={handleSubmit}>
                      {/* Platform Selection */}
                      <div className="mb-4">
                        <Form.Label className="fw-medium">Post to:</Form.Label>
                        <div className="platform-buttons">
                          <Button
                            variant={selectedPlatforms.facebook ? 'primary' : 'outline-secondary'}
                            onClick={() => handlePlatformToggle('facebook')}
                            disabled={!connectedAccounts.facebook}
                            className="platform-btn"
                          >
                            <FaFacebook className="me-2" />Facebook
                            {!connectedAccounts.facebook && <small className="d-block">Not connected</small>}
                          </Button>
                          <Button
                            variant={selectedPlatforms.instagram ? 'danger' : 'outline-secondary'}
                            onClick={() => handlePlatformToggle('instagram')}
                            disabled={!connectedAccounts.instagram || instagramAccounts.length === 0}
                            className="platform-btn"
                          >
                            <FaInstagram className="me-2" />Instagram
                            {!connectedAccounts.instagram && <small className="d-block">Not connected</small>}
                          </Button>
                          <Button
                            variant="outline-secondary"
                            disabled
                            className="platform-btn"
                          >
                            <FaTwitter className="me-2" />Twitter
                            <small className="d-block">Coming Soon</small>
                          </Button>
                        </div>
                      </div>

                      {/* Page/Account Selection */}
                      {selectedPlatforms.facebook && facebookPages.length > 0 && (
                        <Form.Group className="mb-4">
                          <Form.Label>Select Facebook Page</Form.Label>
                          <Form.Select
                            value={selectedFacebookPage}
                            onChange={(e) => setSelectedFacebookPage(e.target.value)}
                          >
                            {facebookPages.map((page) => (
                              <option key={page.id} value={page.id}>{page.name}</option>
                            ))}
                          </Form.Select>
                        </Form.Group>
                      )}

                      {selectedPlatforms.instagram && instagramAccounts.length > 0 && (
                        <Form.Group className="mb-4">
                          <Form.Label>Select Instagram Account</Form.Label>
                          <Form.Select
                            value={selectedInstagramAccount}
                            onChange={(e) => setSelectedInstagramAccount(e.target.value)}
                          >
                            <option value="">Choose an account...</option>
                            {instagramAccounts.map((account) => (
                              <option key={account.instagram_account.id} value={account.instagram_account.id}>
                                {account.name}
                              </option>
                            ))}
                          </Form.Select>
                        </Form.Group>
                      )}

                      {/* Content Input */}
                      <Form.Group className="mb-4">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <Form.Label className="mb-0">Caption</Form.Label>
                          <Dropdown>
                            <Dropdown.Toggle variant="link" size="sm" className="p-0 text-decoration-none">
                              <FaMagic className="me-1" />Improve with AI
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                              <Dropdown.Item onClick={() => handleImproveContent('make_shorter')}>
                                Make Shorter
                              </Dropdown.Item>
                              <Dropdown.Item onClick={() => handleImproveContent('make_longer')}>
                                Make Longer
                              </Dropdown.Item>
                              <Dropdown.Item onClick={() => handleImproveContent('more_engaging')}>
                                More Engaging
                              </Dropdown.Item>
                              <Dropdown.Item onClick={() => handleImproveContent('add_emojis')}>
                                Add Emojis
                              </Dropdown.Item>
                              <Dropdown.Item onClick={() => handleImproveContent('add_urgency')}>
                                Add Urgency
                              </Dropdown.Item>
                              <Dropdown.Item onClick={() => handleImproveContent('add_humor')}>
                                Add Humor
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown>
                        </div>
                        <Form.Control
                          as="textarea"
                          rows={5}
                          value={postContent}
                          onChange={(e) => setPostContent(e.target.value)}
                          placeholder="What would you like to share with your customers?"
                          className="content-textarea"
                        />
                        <div className="d-flex justify-content-between mt-2">
                          <small className="text-muted">{postContent.length} characters</small>
                          <Button 
                            variant="link" 
                            size="sm" 
                            onClick={handleGenerateHashtags}
                            disabled={isGenerating || !postContent.trim()}
                          >
                            <FaHashtag className="me-1" />Generate Hashtags
                          </Button>
                        </div>
                      </Form.Group>

                      {/* Suggested Hashtags */}
                      {suggestedHashtags.length > 0 && (
                        <div className="hashtag-suggestions mb-4">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <Form.Label className="mb-0">Suggested Hashtags</Form.Label>
                            <Button 
                              variant="outline-primary" 
                              size="sm"
                              onClick={addHashtagsToContent}
                              disabled={selectedHashtags.length === 0}
                            >
                              Add Selected to Caption
                            </Button>
                          </div>
                          <div className="hashtag-chips">
                            {suggestedHashtags.map((hashtag, index) => (
                              <Badge
                                key={index}
                                bg={selectedHashtags.includes(hashtag) ? 'primary' : 'light'}
                                text={selectedHashtags.includes(hashtag) ? 'white' : 'dark'}
                                className="hashtag-chip"
                                onClick={() => toggleHashtag(hashtag)}
                              >
                                #{hashtag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Image Upload */}
                      <Form.Group className="mb-4">
                        <Form.Label>Image</Form.Label>
                        <div className="image-upload-container">
                          <Form.Control
                            type="file"
                            onChange={handleImageUpload}
                            accept="image/*"
                            className="d-none"
                            id="image-upload"
                          />
                          <label htmlFor="image-upload" className="image-upload-label">
                            {selectedImage ? (
                              <img src={URL.createObjectURL(selectedImage)} alt="Preview" className="image-preview" />
                            ) : (
                              <>
                                <FaImage size={32} className="mb-2 text-muted" />
                                <span>Click to upload image</span>
                                {selectedPlatforms.instagram && (
                                  <small className="text-warning d-block mt-1">Required for Instagram</small>
                                )}
                              </>
                            )}
                          </label>
                        </div>
                      </Form.Group>

                      {/* Submit Button */}
                      <Button
                        type="submit"
                        variant="success"
                        size="lg"
                        className="w-100 submit-btn"
                        disabled={
                          isLoading ||
                          !postContent.trim() ||
                          (!selectedPlatforms.facebook && !selectedPlatforms.instagram) ||
                          (selectedPlatforms.facebook && !selectedFacebookPage) ||
                          (selectedPlatforms.instagram && !selectedInstagramAccount)
                        }
                      >
                        {isLoading ? (
                          <><Spinner animation="border" size="sm" className="me-2" />Publishing...</>
                        ) : (
                          '🚀 Publish Now'
                        )}
                      </Button>
                    </Form>
                  </Card.Body>
                </Card>
              </Col>

              {/* Sidebar */}
              <Col lg={4}>
                {/* Connect Accounts */}
                <Card className="shadow-sm mb-4">
                  <Card.Header className="bg-white">
                    <h6 className="mb-0">Connected Accounts</h6>
                  </Card.Header>
                  <Card.Body>
                    <div className="d-grid gap-2">
                      <Button
                        onClick={handleFacebookLogin}
                        variant={connectedAccounts.facebook ? 'outline-success' : 'outline-primary'}
                        className="connect-btn"
                        disabled={isLoading}
                      >
                        <FaFacebook className="me-2" />
                        {connectedAccounts.facebook ? '✓ Facebook Connected' : 'Connect Facebook'}
                      </Button>
                      <Button
                        onClick={handleInstagramConnect}
                        variant={connectedAccounts.instagram && instagramAccounts.length > 0 ? 'outline-success' : 'outline-danger'}
                        className="connect-btn"
                        disabled={isLoading}
                      >
                        <FaInstagram className="me-2" />
                        {connectedAccounts.instagram && instagramAccounts.length > 0 ? '✓ Instagram Connected' : 'Connect Instagram'}
                      </Button>
                      <Button variant="outline-secondary" disabled className="connect-btn">
                        <FaTwitter className="me-2" />Twitter Coming Soon
                      </Button>
                    </div>
                    <small className="text-muted d-block mt-2">
                      Connect your accounts to post directly from here
                    </small>
                  </Card.Body>
                </Card>

                {/* Quick Tips */}
                <Card className="shadow-sm tips-card">
                  <Card.Header className="bg-gradient-primary text-white">
                    <h6 className="mb-0"><FaLightbulb className="me-2" />Quick Tips</h6>
                  </Card.Header>
                  <ListGroup variant="flush">
                    <ListGroup.Item className="small">
                      <strong>Best time to post:</strong> 11am-1pm & 7pm-9pm
                    </ListGroup.Item>
                    <ListGroup.Item className="small">
                      <strong>Instagram:</strong> Use 5-10 relevant hashtags
                    </ListGroup.Item>
                    <ListGroup.Item className="small">
                      <strong>Facebook:</strong> Include a call-to-action
                    </ListGroup.Item>
                    <ListGroup.Item className="small">
                      <strong>Engagement:</strong> Ask questions in your posts
                    </ListGroup.Item>
                  </ListGroup>
                </Card>
              </Col>
            </Row>
          </Tab.Pane>

          {/* CONTENT IDEAS TAB */}
          <Tab.Pane eventKey="ideas">
            <Card className="shadow-sm">
              <Card.Header className="bg-white py-3">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h5 className="mb-1">AI Content Ideas</h5>
                    <small className="text-muted">Get personalized content suggestions for your restaurant</small>
                  </div>
                  <Button 
                    variant="primary" 
                    onClick={handleLoadContentIdeas}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <><Spinner animation="border" size="sm" className="me-2" />Generating...</>
                    ) : (
                      <><FaRobot className="me-2" />Generate Ideas</>
                    )}
                  </Button>
                </div>
              </Card.Header>
              <Card.Body>
                {contentIdeas.length === 0 ? (
                  <div className="text-center py-5">
                    <FaLightbulb size={48} className="text-warning mb-3" />
                    <h5>Need Content Inspiration?</h5>
                    <p className="text-muted">
                      Click "Generate Ideas" to get AI-powered content suggestions<br />
                      tailored to your restaurant, cuisine, and the current season.
                    </p>
                  </div>
                ) : (
                  <Row>
                    {contentIdeas.map((idea, index) => (
                      <Col md={6} key={index} className="mb-3">
                        <Card className="h-100 idea-card">
                          <Card.Body>
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <Badge bg={
                                idea.type === 'promotion' ? 'success' :
                                idea.type === 'engagement' ? 'primary' :
                                idea.type === 'seasonal' ? 'warning' :
                                idea.type === 'behind_scenes' ? 'info' : 'secondary'
                              }>
                                {idea.type}
                              </Badge>
                              <Badge bg={
                                idea.estimatedEngagement === 'high' ? 'success' :
                                idea.estimatedEngagement === 'medium' ? 'warning' : 'secondary'
                              }>
                                {idea.estimatedEngagement} engagement
                              </Badge>
                            </div>
                            <h6>{idea.title}</h6>
                            <p className="small text-muted mb-2">{idea.description}</p>
                            <div className="small mb-2">
                              <strong>Best day:</strong> {idea.bestDayToPost}
                            </div>
                            <div className="idea-platforms mb-2">
                              {idea.platforms?.map((platform, i) => (
                                <Badge key={i} bg="light" text="dark" className="me-1">
                                  {platform === 'instagram' && <FaInstagram className="me-1" />}
                                  {platform === 'facebook' && <FaFacebook className="me-1" />}
                                  {platform}
                                </Badge>
                              ))}
                            </div>
                            <Button 
                              variant="outline-primary" 
                              size="sm"
                              onClick={() => {
                                setPostContent(idea.exampleCaption || '');
                                setActiveTab('create');
                              }}
                            >
                              Use This Idea
                            </Button>
                          </Card.Body>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                )}
              </Card.Body>
            </Card>
          </Tab.Pane>

          {/* SEO ANALYSIS TAB */}
          <Tab.Pane eventKey="seo">
            <Card className="shadow-sm">
              <Card.Header className="bg-white py-3">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h5 className="mb-1"><FaSearch className="me-2" />SEO Health Check</h5>
                    <small className="text-muted">AI-powered analysis of your online presence</small>
                  </div>
                  <Button 
                    variant="primary" 
                    onClick={handleLoadSeoData}
                    disabled={isLoadingSeo}
                  >
                    {isLoadingSeo ? (
                      <><Spinner animation="border" size="sm" className="me-2" />Analyzing...</>
                    ) : (
                      <><FaChartLine className="me-2" />{seoData ? 'Refresh Analysis' : 'Run Analysis'}</>
                    )}
                  </Button>
                </div>
              </Card.Header>
              <Card.Body>
                {!seoData ? (
                  <div className="text-center py-5">
                    <FaSearch size={48} className="text-primary mb-3" />
                    <h5>Check Your SEO Health</h5>
                    <p className="text-muted">
                      Get AI-powered recommendations to improve your<br />
                      restaurant's visibility on Google and social media.
                    </p>
                    <Button variant="primary" onClick={handleLoadSeoData} disabled={isLoadingSeo}>
                      Start Analysis
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* SEO Score */}
                    <Row className="mb-4">
                      <Col md={4}>
                        <Card className="text-center h-100 seo-score-card">
                          <Card.Body>
                            <div className={`seo-score seo-grade-${seoData.grade?.toLowerCase()}`}>
                              {seoData.seoScore}
                            </div>
                            <h4 className="mb-2">SEO Score</h4>
                            <Badge bg={
                              seoData.grade === 'A' ? 'success' :
                              seoData.grade === 'B' ? 'primary' :
                              seoData.grade === 'C' ? 'warning' : 'danger'
                            } className="grade-badge">
                              Grade: {seoData.grade}
                            </Badge>
                          </Card.Body>
                        </Card>
                      </Col>
                      <Col md={8}>
                        <Card className="h-100">
                          <Card.Header className="bg-danger text-white">
                            <h6 className="mb-0"><FaExclamationTriangle className="me-2" />Priority Actions</h6>
                          </Card.Header>
                          <ListGroup variant="flush">
                            {seoData.immediateActions?.slice(0, 4).map((action, index) => (
                              <ListGroup.Item key={index} className="d-flex align-items-start">
                                <Badge 
                                  bg={action.priority === 'high' ? 'danger' : action.priority === 'medium' ? 'warning' : 'info'}
                                  className="me-2 mt-1"
                                >
                                  {action.priority}
                                </Badge>
                                <div>
                                  <strong>{action.action}</strong>
                                  {action.impact && <small className="text-muted d-block">{action.impact}</small>}
                                </div>
                              </ListGroup.Item>
                            ))}
                          </ListGroup>
                        </Card>
                      </Col>
                    </Row>

                    {/* Detailed Recommendations */}
                    <Accordion defaultActiveKey="0">
                      <Accordion.Item eventKey="0">
                        <Accordion.Header>
                          <FaGoogle className="me-2 text-primary" />Google Business Profile Tips
                        </Accordion.Header>
                        <Accordion.Body>
                          <ul className="mb-0">
                            {seoData.googleBusinessTips?.map((tip, index) => (
                              <li key={index} className="mb-2">{tip}</li>
                            ))}
                          </ul>
                        </Accordion.Body>
                      </Accordion.Item>
                      <Accordion.Item eventKey="1">
                        <Accordion.Header>
                          <FaHashtag className="me-2 text-info" />Recommended Keywords
                        </Accordion.Header>
                        <Accordion.Body>
                          <div className="d-flex flex-wrap gap-2">
                            {seoData.keywords?.map((keyword, index) => (
                              <Badge key={index} bg="light" text="dark" className="keyword-badge">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        </Accordion.Body>
                      </Accordion.Item>
                      <Accordion.Item eventKey="2">
                        <Accordion.Header>
                          <FaLightbulb className="me-2 text-warning" />Content Ideas for SEO
                        </Accordion.Header>
                        <Accordion.Body>
                          <ul className="mb-0">
                            {seoData.contentIdeas?.map((idea, index) => (
                              <li key={index} className="mb-2">{idea}</li>
                            ))}
                          </ul>
                        </Accordion.Body>
                      </Accordion.Item>
                      <Accordion.Item eventKey="3">
                        <Accordion.Header>
                          <FaExclamationTriangle className="me-2 text-danger" />Common Mistakes to Avoid
                        </Accordion.Header>
                        <Accordion.Body>
                          <ul className="mb-0 text-danger">
                            {seoData.mistakesToAvoid?.map((mistake, index) => (
                              <li key={index} className="mb-2">{mistake}</li>
                            ))}
                          </ul>
                        </Accordion.Body>
                      </Accordion.Item>
                      <Accordion.Item eventKey="4">
                        <Accordion.Header>
                          <FaCalendarAlt className="me-2 text-success" />Monthly Checklist
                        </Accordion.Header>
                        <Accordion.Body>
                          {seoData.monthlyChecklist?.map((task, index) => (
                            <Form.Check 
                              key={index}
                              type="checkbox"
                              label={task}
                              className="mb-2"
                            />
                          ))}
                        </Accordion.Body>
                      </Accordion.Item>
                    </Accordion>
                  </>
                )}
              </Card.Body>
            </Card>
          </Tab.Pane>

          {/* POST HISTORY TAB */}
          <Tab.Pane eventKey="history">
            <Card className="shadow-sm">
              <Card.Header className="bg-white py-3">
                <h5 className="mb-0"><FaCalendarAlt className="me-2" />Recent Posts</h5>
              </Card.Header>
              <Card.Body>
                {postHistory.length === 0 ? (
                  <div className="text-center py-5">
                    <FaCalendarAlt size={48} className="text-muted mb-3" />
                    <h5>No Posts Yet</h5>
                    <p className="text-muted">
                      Posts you publish will appear here.
                    </p>
                    <Button variant="primary" onClick={() => setActiveTab('create')}>
                      Create Your First Post
                    </Button>
                  </div>
                ) : (
                  <Row>
                    {postHistory.map((post, index) => (
                      <Col md={6} key={post.id || index} className="mb-3">
                        <Card className="h-100 history-card">
                          <Card.Body>
                            <div className="d-flex justify-content-between mb-2">
                              <div>
                                {post.platforms?.facebook && <Badge bg="primary" className="me-1"><FaFacebook /></Badge>}
                                {post.platforms?.instagram && <Badge bg="danger" className="me-1"><FaInstagram /></Badge>}
                              </div>
                              <small className="text-muted">
                                {post.createdAt?.toDate?.()?.toLocaleDateString() || 'Unknown date'}
                              </small>
                            </div>
                            <p className="small mb-2" style={{ whiteSpace: 'pre-wrap' }}>
                              {post.content?.substring(0, 200)}
                              {post.content?.length > 200 && '...'}
                            </p>
                            {post.imageUrl && (
                              <img src={post.imageUrl} alt="Post" className="img-fluid rounded" style={{ maxHeight: '100px' }} />
                            )}
                          </Card.Body>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                )}
              </Card.Body>
            </Card>
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>

      {/* AI Generation Modal */}
      <Modal show={showAIModal} onHide={() => setShowAIModal(false)} size="lg" centered>
        <Modal.Header closeButton className="bg-gradient-primary text-white">
          <Modal.Title><FaRobot className="me-2" />AI Content Generator</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row className="mb-4">
            <Col md={4}>
              <Form.Group>
                <Form.Label>Content Type</Form.Label>
                <Form.Select value={aiContentType} onChange={(e) => setAiContentType(e.target.value)}>
                  <option value="general">General Post</option>
                  <option value="menu_feature">Feature Menu Item</option>
                  <option value="promotion">Promotion/Offer</option>
                  <option value="event">Event Announcement</option>
                  <option value="engagement">Engagement Post</option>
                  <option value="behind_scenes">Behind the Scenes</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Tone</Form.Label>
                <Form.Select value={aiTone} onChange={(e) => setAiTone(e.target.value)}>
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="exciting">Exciting</option>
                  <option value="elegant">Elegant</option>
                  <option value="fun">Fun & Playful</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Platform</Form.Label>
                <Form.Select value={aiPlatform} onChange={(e) => setAiPlatform(e.target.value)}>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="twitter">Twitter</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {aiContentType === 'menu_feature' && (
            <Form.Group className="mb-4">
              <Form.Label>Select Menu Item to Feature</Form.Label>
              <Form.Select value={selectedMenuItem} onChange={(e) => setSelectedMenuItem(e.target.value)}>
                <option value="">Choose an item...</option>
                {menuItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.categoryName} - {item.name} (${item.price})
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          <div className="text-center mb-4">
            <Button 
              variant="primary" 
              size="lg"
              onClick={handleGenerateContent}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <><Spinner animation="border" size="sm" className="me-2" />Generating...</>
              ) : (
                <><FaMagic className="me-2" />Generate Content</>
              )}
            </Button>
          </div>

          {generatedContent && (
            <div className="generated-content">
              <Card className="mb-3">
                <Card.Header className="bg-success text-white">
                  <div className="d-flex justify-content-between align-items-center">
                    <span>Generated Caption</span>
                    <Button 
                      variant="light" 
                      size="sm"
                      onClick={() => handleCopy(generatedContent.caption, 'caption')}
                    >
                      {copied === 'caption' ? <FaCheck /> : <FaCopy />}
                    </Button>
                  </div>
                </Card.Header>
                <Card.Body>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{generatedContent.caption}</p>
                </Card.Body>
              </Card>

              {generatedContent.hashtags?.length > 0 && (
                <div className="mb-3">
                  <h6>Suggested Hashtags (click to select):</h6>
                  <div className="hashtag-chips">
                    {generatedContent.hashtags.map((hashtag, index) => (
                      <Badge
                        key={index}
                        bg={selectedHashtags.includes(hashtag) ? 'primary' : 'light'}
                        text={selectedHashtags.includes(hashtag) ? 'white' : 'dark'}
                        className="hashtag-chip"
                        onClick={() => toggleHashtag(hashtag)}
                      >
                        #{hashtag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {generatedContent.bestPostTime && (
                <Alert variant="info" className="small">
                  <strong>Best time to post:</strong> {generatedContent.bestPostTime}
                </Alert>
              )}

              {generatedContent.alternativeVersions?.length > 0 && (
                <Accordion className="mb-3">
                  <Accordion.Item eventKey="0">
                    <Accordion.Header>Alternative Versions</Accordion.Header>
                    <Accordion.Body>
                      {generatedContent.alternativeVersions.map((version, index) => (
                        <div key={index} className="mb-2 p-2 bg-light rounded">
                          <p className="mb-1 small">{version}</p>
                          <Button variant="link" size="sm" className="p-0" onClick={() => {
                            setGeneratedContent({...generatedContent, caption: version});
                          }}>
                            Use this version
                          </Button>
                        </div>
                      ))}
                    </Accordion.Body>
                  </Accordion.Item>
                </Accordion>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAIModal(false)}>
            Cancel
          </Button>
          <Button 
            variant="success" 
            onClick={handleUseGeneratedContent}
            disabled={!generatedContent?.caption}
          >
            <FaCheck className="me-2" />Use This Content
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SeoSocialPosts;
