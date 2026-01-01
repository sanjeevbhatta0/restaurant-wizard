import React, { useState, useEffect, useCallback } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Tabs, Tab, Spinner, Badge } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import './WebsiteBuilder.css';

// Template definitions
const TEMPLATES = [
  {
    id: 'modern-bistro',
    name: 'Modern Bistro',
    description: 'Clean, contemporary design with smooth animations. Perfect for modern restaurants and cafes.',
    preview: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&h=250&fit=crop',
    colors: { primary: '#2c3e50', secondary: '#3498db', accent: '#e74c3c' },
    fonts: ['Poppins', 'Inter', 'Montserrat', 'Open Sans'],
    category: 'Modern'
  },
  {
    id: 'italian-trattoria',
    name: 'Italian Trattoria',
    description: 'Elegant, sophisticated design with serif fonts. Ideal for Italian restaurants and fine dining.',
    preview: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=250&fit=crop',
    colors: { primary: '#1a1a1a', secondary: '#2d2d2d', accent: '#c9a962' },
    fonts: ['Playfair Display', 'Lora', 'Cormorant Garamond', 'Libre Baskerville'],
    category: 'Elegant'
  },
  {
    id: 'fresh-cafe',
    name: 'Fresh Cafe',
    description: 'Bright, cheerful design with playful elements. Great for cafes, bakeries, and juice bars.',
    preview: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=250&fit=crop',
    colors: { primary: '#2d6a4f', secondary: '#40916c', accent: '#ff6b6b' },
    fonts: ['Nunito', 'Quicksand', 'Comfortaa', 'Varela Round'],
    category: 'Casual'
  }
];

export default function WebsiteBuilder() {
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation, locations } = useLocation();
  const [activeTab, setActiveTab] = useState('template');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  
  // Use global selectedLocation from the app's location context (top-right dropdown)
  // No need for separate location state - use the global one
  
  const [config, setConfig] = useState({
    template: 'modern-bistro',
    restaurantName: '',
    tagline: '',
    description: '',
    heroImage: '',
    aboutImage: '',
    aboutContent: '',
    address: '',
      phone: '',
      email: '',
    logo: '',
    primaryColor: '#2c3e50',
    secondaryColor: '#3498db',
    accentColor: '#e74c3c',
    fontFamily: 'Poppins',
    facebook: '',
    instagram: '',
    twitter: '',
      hours: {
        monday: { open: '11:00', close: '22:00' },
        tuesday: { open: '11:00', close: '22:00' },
        wednesday: { open: '11:00', close: '22:00' },
        thursday: { open: '11:00', close: '22:00' },
        friday: { open: '11:00', close: '23:00' },
        saturday: { open: '12:00', close: '23:00' },
        sunday: { open: '12:00', close: '21:00' }
    }
  });

  // Load existing configuration
  useEffect(() => {
    const loadConfig = async () => {
      if (!currentUser) return;
      
      // For multi-location, wait for location selection
      if (isMultiLocation && !selectedLocation) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        
        // For multi-location, use location-specific config path
        const configPath = isMultiLocation 
          ? `restaurants/${currentUser.uid}/locations/${selectedLocation}/website/config`
          : `restaurants/${currentUser.uid}/website/config`;
        
        // Load website config
        const configDoc = await getDoc(doc(db, configPath));
        if (configDoc.exists()) {
          const data = configDoc.data();
          setConfig(prev => ({ ...prev, ...data }));
          setIsPublished(data.isPublished || false);
        } else {
          // Reset config for new location
          setConfig(prev => ({
            ...prev,
            template: 'modern-bistro',
            restaurantName: '',
            tagline: '',
            description: '',
            isPublished: false
          }));
          setIsPublished(false);
        }
        
        // Load restaurant/location data for defaults
        const restaurantDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}`));
        let locationData = null;
        
        if (isMultiLocation && selectedLocation) {
          const locationDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}/locations/${selectedLocation}`));
          if (locationDoc.exists()) {
            locationData = locationDoc.data();
          }
        }
        
        if (restaurantDoc.exists()) {
          const data = restaurantDoc.data();
          // For multi-location, create slug with location identifier
          const locationInfo = locationData || {};
          const locationSlug = locationData?.slug || selectedLocation || '';
          const baseSlug = data.slug || currentUser.uid;
          const slug = isMultiLocation ? `${baseSlug}-${locationSlug}` : baseSlug;
          
          setWebsiteUrl(`https://${slug}.restaurant-portal-6b147.web.app`);
          
          // Use emulator URL when running locally
          const isEmulator = process.env.REACT_APP_USE_EMULATOR === 'true';
          const baseUrl = isEmulator 
            ? 'http://localhost:5001/restaurant-portal-6b147/us-central1/serveWebsite'
            : 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net/serveWebsite';
          
          // Include locationId in preview URL for multi-location
          const locationParam = isMultiLocation ? `&locationId=${selectedLocation}` : '';
          setPreviewUrl(`${baseUrl}?restaurant=${slug}&preview=true${locationParam}`);
          
          // Set defaults from restaurant/location data if not already set
          setConfig(prev => ({
            ...prev,
            restaurantName: prev.restaurantName || locationInfo.name || data.name || '',
            address: prev.address || locationInfo.address || data.address || '',
            phone: prev.phone || locationInfo.phone || data.phone || '',
            email: prev.email || locationInfo.email || data.email || '',
            locationId: isMultiLocation ? selectedLocation : currentUser.uid
          }));
        }
      } catch (err) {
        console.error('Error loading config:', err);
        setError('Failed to load website configuration');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [currentUser, isMultiLocation, selectedLocation]);

  // Update colors when template changes
  const handleTemplateChange = useCallback((templateId) => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setConfig(prev => ({
        ...prev,
        template: templateId,
        primaryColor: template.colors.primary,
        secondaryColor: template.colors.secondary,
        accentColor: template.colors.accent,
        fontFamily: template.fonts[0]
      }));
    }
  }, []);

  // Save configuration
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const saveWebsiteConfig = httpsCallable(functions, 'saveWebsiteConfig');
      // Include locationId for multi-location restaurants
      const configWithLocation = {
        ...config,
        locationId: isMultiLocation ? selectedLocation : currentUser.uid
      };
      const result = await saveWebsiteConfig({ 
        config: configWithLocation,
        locationId: isMultiLocation ? selectedLocation : null
      });
      
      if (result.data.success) {
        setWebsiteUrl(result.data.websiteUrl);
        
        // Use emulator URL when running locally
        const isEmulator = process.env.REACT_APP_USE_EMULATOR === 'true';
        const slug = result.data.slug;
        const locationParam = isMultiLocation ? `&locationId=${selectedLocation}` : '';
        if (isEmulator && slug) {
          setPreviewUrl(`http://localhost:5001/restaurant-portal-6b147/us-central1/serveWebsite?restaurant=${slug}&preview=true${locationParam}`);
        } else {
          setPreviewUrl(result.data.previewUrl);
        }
        setSuccess('Configuration saved successfully!');
      }
    } catch (err) {
      console.error('Error saving config:', err);
      setError('Failed to save configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Publish website
  const handlePublish = async () => {
    setPublishing(true);
    setError('');
    setSuccess('');

    try {
      // First save the config
      await handleSave();
      
      // Then publish
      const publishWebsite = httpsCallable(functions, 'publishWebsite');
      const result = await publishWebsite({});
      
      if (result.data.success) {
        setIsPublished(true);
        setWebsiteUrl(result.data.websiteUrl);
        setSuccess(`🎉 Website published! View it at: ${result.data.websiteUrl}`);
      }
    } catch (err) {
      console.error('Error publishing:', err);
      setError('Failed to publish website: ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleHoursChange = (day, type, value) => {
    setConfig(prev => ({
      ...prev,
      hours: {
        ...prev.hours,
        [day]: { ...prev.hours[day], [type]: value }
      }
    }));
  };

  const selectedTemplate = TEMPLATES.find(t => t.id === config.template) || TEMPLATES[0];

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3">Loading website builder...</p>
      </Container>
    );
  }

  return (
    <Container fluid className="website-builder py-4">
      {/* Header */}
      <div className="builder-header mb-4">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div>
            <h1 className="mb-1">
              <i className="bi bi-globe me-2"></i>
              Website Builder
            </h1>
            <p className="text-muted mb-0">
              Create a beautiful website for your restaurant
              {isPublished && (
                <Badge bg="success" className="ms-2">Published</Badge>
              )}
              {isMultiLocation && selectedLocation && (
                <Badge bg="info" className="ms-2">
                  <i className="bi bi-geo-alt me-1"></i>
                  {locations.find(l => l.id === selectedLocation)?.name || 'Location'}
                </Badge>
              )}
            </p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            {previewUrl && (
              <Button 
                variant="outline-secondary" 
                href={previewUrl}
                target="_blank"
              >
                <i className="bi bi-eye me-1"></i> Preview
              </Button>
            )}
          <Button 
              variant="outline-primary" 
            onClick={handleSave} 
            disabled={saving}
          >
              {saving ? (
                <>
                  <Spinner size="sm" animation="border" className="me-1" />
                  Saving...
                </>
              ) : (
                <>
                  <i className="bi bi-save me-1"></i> Save Draft
                </>
              )}
          </Button>
          <Button 
              variant="primary" 
              onClick={handlePublish} 
              disabled={publishing || saving}
            >
              {publishing ? (
                <>
                  <Spinner size="sm" animation="border" className="me-1" />
                  Publishing...
                </>
              ) : (
                <>
                  <i className="bi bi-rocket-takeoff me-1"></i> Publish
                </>
              )}
          </Button>
          </div>
        </div>
      </div>

      {/* Multi-location info banner */}
      {isMultiLocation && selectedLocation && (
        <Alert variant="info" className="mb-4">
          <i className="bi bi-geo-alt-fill me-2"></i>
          <strong>Building website for:</strong> {locations?.find(l => l.id === selectedLocation)?.name || 'Selected Location'}
          <span className="text-muted ms-2">
            (Use the location dropdown at the top-right to switch locations)
          </span>
        </Alert>
      )}
      
      {isMultiLocation && !selectedLocation && (
        <Alert variant="warning" className="mb-4">
          <i className="bi bi-exclamation-triangle me-2"></i>
          <strong>Please select a location</strong> from the dropdown at the top-right corner to build its website.
        </Alert>
      )}

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

      {websiteUrl && isPublished && (
        <Alert variant="info" className="mb-4">
          <i className="bi bi-link-45deg me-2"></i>
          Your website is live at: <a href={websiteUrl} target="_blank" rel="noopener noreferrer"><strong>{websiteUrl}</strong></a>
        </Alert>
      )}

      <Row>
        {/* Settings Panel */}
        <Col lg={5} xl={4}>
          <Card className="builder-panel">
            <Card.Body className="p-0">
      <Tabs
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k)}
                className="builder-tabs"
              >
                {/* Template Selection */}
                <Tab eventKey="template" title={<><i className="bi bi-palette me-1"></i> Template</>}>
                  <div className="p-3">
                    <h5 className="mb-3">Choose Your Template</h5>
                    <div className="template-grid">
                      {TEMPLATES.map(template => (
                        <div 
                          key={template.id}
                          className={`template-card ${config.template === template.id ? 'selected' : ''}`}
                          onClick={() => handleTemplateChange(template.id)}
                        >
                          <div className="template-preview">
                            <img src={template.preview} alt={template.name} />
                            {config.template === template.id && (
                              <div className="template-selected-badge">
                                <i className="bi bi-check-circle-fill"></i>
                              </div>
                            )}
                          </div>
                          <div className="template-info">
                            <h6>{template.name}</h6>
                            <Badge bg="secondary" size="sm">{template.category}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-muted small mt-3">
                      {selectedTemplate.description}
                    </p>
                  </div>
                </Tab>

                {/* Basic Info */}
                <Tab eventKey="content" title={<><i className="bi bi-pencil me-1"></i> Content</>}>
                  <div className="p-3">
            <Form.Group className="mb-3">
                      <Form.Label>Restaurant Name</Form.Label>
              <Form.Control
                type="text"
                        value={config.restaurantName}
                        onChange={(e) => handleChange('restaurantName', e.target.value)}
                        placeholder="Your Restaurant Name"
              />
            </Form.Group>

            <Form.Group className="mb-3">
                      <Form.Label>Tagline</Form.Label>
              <Form.Control
                type="text"
                        value={config.tagline}
                        onChange={(e) => handleChange('tagline', e.target.value)}
                        placeholder="e.g., Authentic Italian Since 1985"
              />
            </Form.Group>

            <Form.Group className="mb-3">
                      <Form.Label>Description</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={config.description}
                        onChange={(e) => handleChange('description', e.target.value)}
                        placeholder="Brief description for the hero section"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Hero Image URL</Form.Label>
              <Form.Control
                        type="url"
                        value={config.heroImage}
                        onChange={(e) => handleChange('heroImage', e.target.value)}
                        placeholder="https://example.com/hero.jpg"
                      />
                      <Form.Text className="text-muted">
                        Recommended: 1920x1080px or larger
                      </Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>About Section Image URL</Form.Label>
                      <Form.Control
                        type="url"
                        value={config.aboutImage}
                        onChange={(e) => handleChange('aboutImage', e.target.value)}
                        placeholder="https://example.com/about.jpg"
              />
            </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>About Us Content</Form.Label>
                      <ReactQuill
                        value={config.aboutContent}
                        onChange={(content) => handleChange('aboutContent', content)}
                        placeholder="Tell your restaurant's story..."
                        theme="snow"
                      />
                    </Form.Group>
          </div>
        </Tab>

                {/* Contact Info */}
                <Tab eventKey="contact" title={<><i className="bi bi-geo-alt me-1"></i> Contact</>}>
                  <div className="p-3">
            <Form.Group className="mb-3">
              <Form.Label>Phone Number</Form.Label>
              <Form.Control
                type="tel"
                        value={config.phone}
                        onChange={(e) => handleChange('phone', e.target.value)}
                        placeholder="(555) 123-4567"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                        value={config.email}
                        onChange={(e) => handleChange('email', e.target.value)}
                        placeholder="hello@restaurant.com"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Address</Form.Label>
              <Form.Control
                as="textarea"
                        rows={2}
                        value={config.address}
                        onChange={(e) => handleChange('address', e.target.value)}
                        placeholder="123 Main Street, City, State 12345"
              />
            </Form.Group>

                    <h6 className="mt-4 mb-3">Business Hours</h6>
                    {Object.entries(config.hours).map(([day, hours]) => (
                      <div key={day} className="d-flex align-items-center gap-2 mb-2">
                        <span className="hours-day">{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                <Form.Control
                  type="time"
                  value={hours.open}
                          onChange={(e) => handleHoursChange(day, 'open', e.target.value)}
                          size="sm"
                        />
                        <span>to</span>
                <Form.Control
                  type="time"
                  value={hours.close}
                          onChange={(e) => handleHoursChange(day, 'close', e.target.value)}
                          size="sm"
                />
              </div>
            ))}

                    <h6 className="mt-4 mb-3">Social Media</h6>
                    <Form.Group className="mb-2">
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-facebook"></i></span>
              <Form.Control
                type="url"
                          value={config.facebook}
                          onChange={(e) => handleChange('facebook', e.target.value)}
                          placeholder="Facebook URL"
                        />
                      </div>
            </Form.Group>
                    <Form.Group className="mb-2">
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-instagram"></i></span>
              <Form.Control
                type="url"
                          value={config.instagram}
                          onChange={(e) => handleChange('instagram', e.target.value)}
                          placeholder="Instagram URL"
                        />
                      </div>
            </Form.Group>
                    <Form.Group className="mb-2">
                      <div className="input-group">
                        <span className="input-group-text"><i className="bi bi-twitter-x"></i></span>
              <Form.Control
                type="url"
                          value={config.twitter}
                          onChange={(e) => handleChange('twitter', e.target.value)}
                          placeholder="Twitter/X URL"
                        />
                      </div>
            </Form.Group>
          </div>
        </Tab>

                {/* Theme/Style */}
                <Tab eventKey="theme" title={<><i className="bi bi-brush me-1"></i> Theme</>}>
                  <div className="p-3">
            <Form.Group className="mb-3">
                      <Form.Label>Logo URL</Form.Label>
              <Form.Control
                        type="url"
                        value={config.logo}
                        onChange={(e) => handleChange('logo', e.target.value)}
                        placeholder="https://example.com/logo.png"
              />
            </Form.Group>

                    <h6 className="mt-4 mb-3">Colors</h6>
                    <Row className="g-3">
                      <Col xs={4}>
                        <Form.Group>
                          <Form.Label className="small">Primary</Form.Label>
                          <Form.Control
                            type="color"
                            value={config.primaryColor}
                            onChange={(e) => handleChange('primaryColor', e.target.value)}
                            className="color-picker"
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={4}>
                        <Form.Group>
                          <Form.Label className="small">Secondary</Form.Label>
                          <Form.Control
                            type="color"
                            value={config.secondaryColor}
                            onChange={(e) => handleChange('secondaryColor', e.target.value)}
                            className="color-picker"
                          />
                        </Form.Group>
                      </Col>
                      <Col xs={4}>
                        <Form.Group>
                          <Form.Label className="small">Accent</Form.Label>
              <Form.Control
                type="color"
                            value={config.accentColor}
                            onChange={(e) => handleChange('accentColor', e.target.value)}
                            className="color-picker"
              />
            </Form.Group>
                      </Col>
                    </Row>

                    <Form.Group className="mt-4">
              <Form.Label>Font Family</Form.Label>
              <Form.Select
                        value={config.fontFamily}
                        onChange={(e) => handleChange('fontFamily', e.target.value)}
                      >
                        {selectedTemplate.fonts.map(font => (
                          <option key={font} value={font}>{font}</option>
                        ))}
              </Form.Select>
            </Form.Group>

                    <Button 
                      variant="outline-secondary" 
                      size="sm" 
                      className="mt-3"
                      onClick={() => handleTemplateChange(config.template)}
                    >
                      <i className="bi bi-arrow-counterclockwise me-1"></i>
                      Reset to Template Defaults
                    </Button>
                  </div>
                </Tab>

                {/* Menu Tab */}
                <Tab eventKey="menu" title={<><i className="bi bi-list-ul me-1"></i> Menu</>}>
                  <div className="p-3">
                    <div className="text-center py-4">
                      <i className="bi bi-check-circle text-success" style={{ fontSize: '3rem' }}></i>
                      <h5 className="mt-3">Menu Auto-Synced</h5>
                      <p className="text-muted">
                        Your menu is automatically synced from Menu Management. 
                        Any changes you make there will appear on your website in real-time.
                      </p>
                      <Button 
                        variant="outline-primary" 
                        href="/menu-management"
                      >
                        <i className="bi bi-arrow-right me-1"></i>
                        Go to Menu Management
                      </Button>
                    </div>
                  </div>
        </Tab>
      </Tabs>
            </Card.Body>
          </Card>
        </Col>

        {/* Live Preview */}
        <Col lg={7} xl={8}>
          <Card className="preview-panel">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <div>
                <i className="bi bi-display me-2"></i>
                <strong>Live Preview</strong>
              </div>
              <div className="preview-controls">
                <Button variant="outline-secondary" size="sm" className="me-1" title="Desktop">
                  <i className="bi bi-display"></i>
                </Button>
                <Button variant="outline-secondary" size="sm" className="me-1" title="Tablet">
                  <i className="bi bi-tablet"></i>
                </Button>
                <Button variant="outline-secondary" size="sm" title="Mobile">
                  <i className="bi bi-phone"></i>
                </Button>
              </div>
            </Card.Header>
            <Card.Body className="p-0">
              <div className="preview-frame-container">
                {previewUrl ? (
                  <iframe
                    src={previewUrl}
                    className="preview-frame"
                    title="Website Preview"
                  />
                ) : (
                  <div className="preview-placeholder">
                    <i className="bi bi-globe" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
                    <p className="mt-3 text-muted">
                      Save your configuration to see a live preview
                    </p>
                  </div>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
} 
