import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Tabs, Tab, Spinner, Badge, Modal } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, functions, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { RESTAURANT_SITE_ID, getApiBaseUrl, getWebsiteUrl, getWebsitePreviewUrl, getAppBaseUrl } from '../config';
import { compressImage } from '../services/imageService';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import './WebsiteBuilder.css';
import './PageHeader.css';

// Template definitions
const TEMPLATES = [
  {
    id: 'modern-bistro',
    name: 'Modern Bistro',
    description: 'Clean, contemporary design with smooth animations. Perfect for modern restaurants and cafes.',
    colors: { primary: '#2c3e50', secondary: '#3498db', accent: '#e74c3c' },
    fonts: ['Poppins', 'Inter', 'Montserrat', 'Open Sans'],
    category: 'Modern'
  },
  {
    id: 'italian-trattoria',
    name: 'Italian Trattoria',
    description: 'Elegant, sophisticated design with serif fonts. Ideal for Italian restaurants and fine dining.',
    colors: { primary: '#1a1a1a', secondary: '#2d2d2d', accent: '#c9a962' },
    fonts: ['Playfair Display', 'Lora', 'Cormorant Garamond', 'Libre Baskerville'],
    category: 'Elegant'
  },
  {
    id: 'fresh-cafe',
    name: 'Fresh Cafe',
    description: 'Bright, cheerful design with playful elements. Great for cafes, bakeries, and juice bars.',
    colors: { primary: '#2d6a4f', secondary: '#40916c', accent: '#ff6b6b' },
    fonts: ['Nunito', 'Quicksand', 'Comfortaa', 'Varela Round'],
    category: 'Casual'
  },
  {
    id: 'warm-spice',
    name: 'Warm Spice',
    description: 'Warm, inviting design with golden amber accents. Perfect for South Asian, Middle Eastern, and ethnic cuisine.',
    colors: { primary: '#3d2b1f', secondary: '#5c4033', accent: '#ce830c' },
    fonts: ['Poppins', 'Geist', 'Inter', 'Nunito'],
    category: 'Warm'
  }
];

export default function WebsiteBuilder() {
  const { currentUser, restaurantUid } = useAuth();
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
  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [customDomain, setCustomDomain] = useState('');
  const [customDomainWww, setCustomDomainWww] = useState('');
  const [customDomainStatus, setCustomDomainStatus] = useState(null); // null | 'pending' | 'partial' | 'active'
  const [domainInput, setDomainInput] = useState('');
  const [domainVerifying, setDomainVerifying] = useState(false);
  const [domainRemoving, setDomainRemoving] = useState(false);
  const [domainMessage, setDomainMessage] = useState({ type: '', text: '' });
  const [domainStep, setDomainStep] = useState(1); // 1: enter domain, 2: DNS instructions, 3: verify, 4: confirm disconnect

  const [dnsRecords, setDnsRecords] = useState({ apex: [], www: [] });
  const [wwwVerified, setWwwVerified] = useState(false);
  const [apexVerified, setApexVerified] = useState(false);

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
          ? `restaurants/${restaurantUid}/locations/${selectedLocation}/website/config`
          : `restaurants/${restaurantUid}/website/config`;
        
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
        const restaurantDoc = await getDoc(doc(db, `restaurants/${restaurantUid}`));
        let locationData = null;
        
        if (isMultiLocation && selectedLocation) {
          const locationDoc = await getDoc(doc(db, `restaurants/${restaurantUid}/locations/${selectedLocation}`));
          if (locationDoc.exists()) {
            locationData = locationDoc.data();
          }
        }
        
        if (restaurantDoc.exists()) {
          const data = restaurantDoc.data();
          // Load custom domain state
          if (data.customDomain) {
            // Normalize: customDomain should always be the bare domain
            const bare = data.customDomain.startsWith('www.') ? data.customDomain.slice(4) : data.customDomain;
            setCustomDomain(bare);
            setCustomDomainWww(data.customDomainWww || `www.${bare}`);
            setCustomDomainStatus(data.customDomainStatus || 'pending');
            setDomainInput(bare);
            if (data.customDomainDnsRecords) setDnsRecords(data.customDomainDnsRecords);
          } else {
            setCustomDomain('');
            setCustomDomainWww('');
            setCustomDomainStatus(null);
            setDomainInput('');
            setDnsRecords({ apex: [], www: [] });
          }
          // For multi-location, create slug with location identifier
          const locationInfo = locationData || {};
          const locationSlug = locationData?.slug || selectedLocation || '';
          const baseSlug = data.slug || restaurantUid;
          const slug = isMultiLocation ? `${baseSlug}-${locationSlug}` : baseSlug;
          
          setWebsiteUrl(getWebsiteUrl(slug));

          // Include locationId in preview URL for multi-location
          const locationParam = isMultiLocation ? `&locationId=${selectedLocation}` : '';
          setPreviewUrl(getWebsitePreviewUrl(slug, restaurantUid, locationParam));

          // Set defaults from restaurant/location data if not already set
          setConfig(prev => ({
            ...prev,
            restaurantName: prev.restaurantName || locationInfo.name || data.name || '',
            address: prev.address || locationInfo.address || data.address || '',
            phone: prev.phone || locationInfo.phone || data.phone || '',
            email: prev.email || locationInfo.email || data.email || '',
            locationId: isMultiLocation ? selectedLocation : restaurantUid
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
        locationId: isMultiLocation ? selectedLocation : restaurantUid
      };
      const result = await saveWebsiteConfig({ 
        config: configWithLocation,
        locationId: isMultiLocation ? selectedLocation : null
      });
      
      if (result.data.success) {
        setWebsiteUrl(result.data.websiteUrl);
        
        // Use emulator URL when running locally
        const slug = result.data.slug;
        const locationParam = isMultiLocation ? `&locationId=${selectedLocation}` : '';
        if (slug) {
          setPreviewUrl(getWebsitePreviewUrl(slug, restaurantUid, locationParam));
        } else {
          setPreviewUrl(result.data.previewUrl);
        }
        setSuccess('Configuration saved successfully!');
        // Auto-reload preview iframe after successful save
        setIframeKey(prev => prev + 1);
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
      
      // Then publish - pass locationId for multi-location support
      const publishWebsite = httpsCallable(functions, 'publishWebsite');
      const result = await publishWebsite({
        locationId: isMultiLocation ? selectedLocation : null
      });
      
      if (result.data.success) {
        setIsPublished(true);
        setWebsiteUrl(result.data.websiteUrl);
        setSuccess('Website published! View it at: ' + result.data.websiteUrl);
        setIframeKey(prev => prev + 1);
      }
    } catch (err) {
      console.error('Error publishing:', err);
      setError('Failed to publish website: ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  // Custom domain handlers
  const handleOpenDomainModal = () => {
    setDomainMessage({ type: '', text: '' });
    if (customDomain) {
      setDomainInput(customDomain);
      setDomainStep(3); // Show status if already configured
    } else {
      setDomainInput('');
      setDomainStep(1);
    }
    setShowDomainModal(true);
  };

  const handleDomainNext = () => {
    const cleaned = domainInput.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!cleaned) {
      setDomainMessage({ type: 'danger', text: 'Please enter a domain name.' });
      return;
    }
    const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
    if (!domainRegex.test(cleaned)) {
      setDomainMessage({ type: 'danger', text: 'Invalid domain format. Enter something like www.yourrestaurant.com' });
      return;
    }
    setDomainInput(cleaned);
    setDomainMessage({ type: '', text: '' });
    setDomainStep(2);
  };

  const handleVerifyDomain = async () => {
    setDomainVerifying(true);
    setDomainMessage({ type: '', text: '' });
    try {
      const verifyCustomDomain = httpsCallable(functions, 'verifyCustomDomain');
      const result = await verifyCustomDomain({ domain: domainInput });
      const data = result.data;
      setCustomDomain(data.domain);
      setCustomDomainWww(data.wwwDomain || `www.${data.domain}`);
      setCustomDomainStatus(data.status);
      if (data.dnsRecords) setDnsRecords(data.dnsRecords);
      if (data.wwwVerified !== undefined) setWwwVerified(data.wwwVerified);
      if (data.apexVerified !== undefined) setApexVerified(data.apexVerified);
      setDomainStep(3);
      if (data.dnsVerified) {
        setDomainMessage({ type: 'success', text: data.message });
      } else if (data.status === 'partial') {
        setDomainMessage({ type: 'warning', text: data.message });
      } else {
        setDomainMessage({ type: 'warning', text: data.message });
      }
    } catch (err) {
      console.error('Domain verification error:', err);
      setDomainMessage({ type: 'danger', text: err.message || 'Failed to verify domain' });
    } finally {
      setDomainVerifying(false);
    }
  };

  const handleRemoveDomain = async () => {
    setDomainRemoving(true);
    setDomainMessage({ type: '', text: '' });
    try {
      const removeCustomDomain = httpsCallable(functions, 'removeCustomDomain');
      await removeCustomDomain();
      setCustomDomain('');
      setCustomDomainWww('');
      setCustomDomainStatus(null);
      setDomainInput('');
      setDomainStep(1);
      setDnsRecords({ apex: [], www: [] });
      setWwwVerified(false);
      setApexVerified(false);
      setDomainMessage({ type: 'success', text: 'Custom domain disconnected.' });
    } catch (err) {
      console.error('Domain removal error:', err);
      setDomainMessage({ type: 'danger', text: err.message || 'Failed to remove domain' });
    } finally {
      setDomainRemoving(false);
    }
  };

  const handleChangeDomain = () => {
    setDomainStep(1);
    setDomainInput('');
    setDomainMessage({ type: '', text: '' });
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

  // Image upload state
  const [uploading, setUploading] = useState({});
  const heroFileRef = useRef(null);
  const aboutFileRef = useRef(null);
  const logoFileRef = useRef(null);

  const handleImageUpload = async (field, file) => {
    if (!file || !restaurantUid) return;

    // Validate file type
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setError('Please select an image or video file.');
      return;
    }

    // 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      setError('File is too large. Maximum size is 10MB.');
      return;
    }

    setUploading(prev => ({ ...prev, [field]: true }));
    setError('');

    try {
      let uploadFile = file;

      // Compress images (not videos)
      if (file.type.startsWith('image/')) {
        const maxSize = field === 'heroImage' ? 1920 : field === 'logo' ? 400 : 800;
        uploadFile = await compressImage(file, { maxWidth: maxSize, maxHeight: maxSize, quality: 0.85 });
      }

      // Delete old file from storage if it exists
      const oldPath = config[`${field}StoragePath`];
      if (oldPath) {
        try {
          await deleteObject(ref(storage, oldPath));
        } catch (err) {
          // Ignore — old file may not exist
        }
      }

      const fileName = `${Date.now()}-${file.name}`;
      const storagePath = `restaurants/${restaurantUid}/website/${field}/${fileName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, uploadFile);
      const downloadUrl = await getDownloadURL(storageRef);

      setConfig(prev => ({
        ...prev,
        [field]: downloadUrl,
        [`${field}StoragePath`]: storagePath
      }));
    } catch (err) {
      console.error(`Error uploading ${field}:`, err);
      setError(`Failed to upload image: ${err.message}`);
    } finally {
      setUploading(prev => ({ ...prev, [field]: false }));
    }
  };

  const handleImageRemove = async (field) => {
    const storagePath = config[`${field}StoragePath`];
    if (storagePath) {
      try {
        await deleteObject(ref(storage, storagePath));
      } catch (err) {
        // Ignore — file may not exist
      }
    }
    setConfig(prev => ({
      ...prev,
      [field]: '',
      [`${field}StoragePath`]: ''
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
      <div className="page-header-gradient" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
        <div className="header-content">
          <i className="bi bi-globe header-icon"></i>
          <div>
            <h2>Website Builder</h2>
            <p style={{ margin: '5px 0 0', opacity: 0.9 }}>
              Create a beautiful website for your restaurant
              {isPublished && (
                <Badge bg="light" text="dark" className="ms-2">Published</Badge>
              )}
              {isMultiLocation && selectedLocation && (
                <Badge bg="light" text="dark" className="ms-2">
                  <i className="bi bi-geo-alt me-1"></i>
                  {locations.find(l => l.id === selectedLocation)?.name || 'Location'}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {previewUrl && (
            <Button
              variant="outline-light"
              onClick={() => { setIframeKey(prev => prev + 1); setShowPreviewModal(true); }}
              size="sm"
            >
              <i className="bi bi-eye me-1"></i> Preview
            </Button>
          )}
          <Button
            variant="outline-light"
            onClick={handleOpenDomainModal}
            size="sm"
          >
            <i className="bi bi-globe2 me-1"></i>
            {customDomain ? 'Custom Domain' : 'Add Domain'}
            {customDomainStatus === 'active' && (
              <Badge bg="success" className="ms-1" style={{ fontSize: '0.65rem' }}>Connected</Badge>
            )}
            {customDomainStatus === 'pending' && (
              <Badge bg="warning" text="dark" className="ms-1" style={{ fontSize: '0.65rem' }}>Pending</Badge>
            )}
          </Button>
          <Button
            variant="outline-light"
            onClick={handleSave}
            disabled={saving}
            size="sm"
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
            variant="light"
            onClick={handlePublish}
            disabled={publishing || saving}
            size="sm"
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
        <Col lg={8} xl={7} className="mx-auto">
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
                          <div className="template-preview" style={{
                            background: `linear-gradient(135deg, ${template.colors.primary} 0%, ${template.colors.secondary} 60%, ${template.colors.accent} 100%)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px'
                          }}>
                            <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.85rem', textShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>{template.name}</span>
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
                      <Form.Label>Hero Image</Form.Label>
                      {config.heroImage ? (
                        <div className="image-upload-preview mb-2">
                          <img src={config.heroImage} alt="Hero preview" style={{ width: '100%', maxHeight: '150px', objectFit: 'cover', borderRadius: '8px' }} />
                          <div className="d-flex gap-2 mt-2">
                            <Button variant="outline-secondary" size="sm" onClick={() => heroFileRef.current?.click()} disabled={uploading.heroImage}>
                              <i className="bi bi-arrow-repeat me-1"></i> Replace
                            </Button>
                            <Button variant="outline-danger" size="sm" onClick={() => handleImageRemove('heroImage')}>
                              <i className="bi bi-trash me-1"></i> Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="image-upload-dropzone"
                          onClick={() => heroFileRef.current?.click()}
                          style={{ border: '2px dashed #dee2e6', borderRadius: '8px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#f8f9fa' }}
                        >
                          {uploading.heroImage ? (
                            <><Spinner size="sm" animation="border" className="me-2" />Uploading...</>
                          ) : (
                            <>
                              <i className="bi bi-cloud-arrow-up" style={{ fontSize: '2rem', color: '#6c757d' }}></i>
                              <p className="mb-0 mt-2 text-muted small">Click to upload hero image</p>
                              <p className="mb-0 text-muted" style={{ fontSize: '0.75rem' }}>Recommended: 1920x1080px or larger</p>
                            </>
                          )}
                        </div>
                      )}
                      <input
                        ref={heroFileRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { if (e.target.files[0]) handleImageUpload('heroImage', e.target.files[0]); e.target.value = ''; }}
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>About Section Image</Form.Label>
                      {config.aboutImage ? (
                        <div className="image-upload-preview mb-2">
                          <img src={config.aboutImage} alt="About preview" style={{ width: '100%', maxHeight: '150px', objectFit: 'cover', borderRadius: '8px' }} />
                          <div className="d-flex gap-2 mt-2">
                            <Button variant="outline-secondary" size="sm" onClick={() => aboutFileRef.current?.click()} disabled={uploading.aboutImage}>
                              <i className="bi bi-arrow-repeat me-1"></i> Replace
                            </Button>
                            <Button variant="outline-danger" size="sm" onClick={() => handleImageRemove('aboutImage')}>
                              <i className="bi bi-trash me-1"></i> Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="image-upload-dropzone"
                          onClick={() => aboutFileRef.current?.click()}
                          style={{ border: '2px dashed #dee2e6', borderRadius: '8px', padding: '24px', textAlign: 'center', cursor: 'pointer', background: '#f8f9fa' }}
                        >
                          {uploading.aboutImage ? (
                            <><Spinner size="sm" animation="border" className="me-2" />Uploading...</>
                          ) : (
                            <>
                              <i className="bi bi-cloud-arrow-up" style={{ fontSize: '2rem', color: '#6c757d' }}></i>
                              <p className="mb-0 mt-2 text-muted small">Click to upload about image</p>
                              <p className="mb-0 text-muted" style={{ fontSize: '0.75rem' }}>Recommended: 800x600px</p>
                            </>
                          )}
                        </div>
                      )}
                      <input
                        ref={aboutFileRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { if (e.target.files[0]) handleImageUpload('aboutImage', e.target.files[0]); e.target.value = ''; }}
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
                      <Form.Label>Logo</Form.Label>
                      {config.logo ? (
                        <div className="image-upload-preview mb-2">
                          <img src={config.logo} alt="Logo preview" style={{ maxHeight: '80px', objectFit: 'contain', borderRadius: '8px', background: '#f8f9fa', padding: '8px' }} />
                          <div className="d-flex gap-2 mt-2">
                            <Button variant="outline-secondary" size="sm" onClick={() => logoFileRef.current?.click()} disabled={uploading.logo}>
                              <i className="bi bi-arrow-repeat me-1"></i> Replace
                            </Button>
                            <Button variant="outline-danger" size="sm" onClick={() => handleImageRemove('logo')}>
                              <i className="bi bi-trash me-1"></i> Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="image-upload-dropzone"
                          onClick={() => logoFileRef.current?.click()}
                          style={{ border: '2px dashed #dee2e6', borderRadius: '8px', padding: '16px', textAlign: 'center', cursor: 'pointer', background: '#f8f9fa' }}
                        >
                          {uploading.logo ? (
                            <><Spinner size="sm" animation="border" className="me-2" />Uploading...</>
                          ) : (
                            <>
                              <i className="bi bi-image" style={{ fontSize: '1.5rem', color: '#6c757d' }}></i>
                              <p className="mb-0 mt-1 text-muted small">Click to upload logo</p>
                            </>
                          )}
                        </div>
                      )}
                      <input
                        ref={logoFileRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { if (e.target.files[0]) handleImageUpload('logo', e.target.files[0]); e.target.value = ''; }}
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
      </Row>

      {/* Custom Domain Modal */}
      <Modal
        show={showDomainModal}
        onHide={() => setShowDomainModal(false)}
        size="lg"
        centered
      >
        <Modal.Header closeButton style={{ background: '#f8f9fa', borderBottom: '1px solid #e9ecef' }}>
          <Modal.Title>
            <i className="bi bi-globe2 me-2"></i>
            Custom Domain
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ padding: '1.5rem' }}>
          {domainMessage.text && (
            <Alert variant={domainMessage.type} dismissible onClose={() => setDomainMessage({ type: '', text: '' })}>
              {domainMessage.type === 'success' && <i className="bi bi-check-circle-fill me-2"></i>}
              {domainMessage.type === 'warning' && <i className="bi bi-exclamation-triangle-fill me-2"></i>}
              {domainMessage.type === 'danger' && <i className="bi bi-x-circle-fill me-2"></i>}
              {domainMessage.text}
            </Alert>
          )}

          {/* Step 1: Enter Domain */}
          {domainStep === 1 && (
            <div>
              <h5 className="mb-3">Connect Your Own Domain</h5>
              <p className="text-muted mb-4">
                Use your restaurant's own domain name (like <strong>www.yourrestaurant.com</strong>) so customers can visit your website directly. No technical expertise required — we'll walk you through it step by step.
              </p>

              <Form.Group className="mb-4">
                <Form.Label className="fw-bold">Enter your domain name</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="e.g., www.yourrestaurant.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDomainNext()}
                  size="lg"
                />
                <Form.Text className="text-muted">
                  We recommend using <strong>www.yourrestaurant.com</strong> rather than the bare domain (yourrestaurant.com). The "www" version is easier to set up and works with all domain providers.
                </Form.Text>
              </Form.Group>

              <div className="d-flex gap-2">
                <Button variant="primary" onClick={handleDomainNext} size="lg">
                  Continue <i className="bi bi-arrow-right ms-1"></i>
                </Button>
              </div>

              <hr className="my-4" />
              <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                <p className="mb-1"><strong>Don't have a domain yet?</strong></p>
                <p className="mb-0">
                  You can purchase one from providers like <a href="https://domains.google.com" target="_blank" rel="noopener noreferrer">Google Domains</a>, <a href="https://www.namecheap.com" target="_blank" rel="noopener noreferrer">Namecheap</a>, <a href="https://www.godaddy.com" target="_blank" rel="noopener noreferrer">GoDaddy</a>, or <a href="https://www.cloudflare.com/products/registrar/" target="_blank" rel="noopener noreferrer">Cloudflare</a>. A domain typically costs $10-15/year.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: DNS Instructions */}
          {domainStep === 2 && (() => {
            const cleaned = domainInput.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
            const isWww = cleaned.startsWith('www.');
            const bareDomain = isWww ? cleaned.slice(4) : cleaned;
            const wwwDomain = isWww ? cleaned : `www.${cleaned}`;
            return (
            <div>
              <h5 className="mb-3">Set Up Your DNS Records</h5>
              <p className="text-muted mb-3">
                Add these two DNS records at your domain registrar (where you bought your domain). This connects both <strong>{bareDomain}</strong> and <strong>{wwwDomain}</strong> to your restaurant website.
              </p>

              {/* Record 1: CNAME for www */}
              <Card className="mb-3" style={{ background: '#f0f7ff', border: '1px solid #b3d7ff' }}>
                <Card.Body>
                  <h6 className="mb-3"><i className="bi bi-1-circle-fill me-2 text-primary"></i>WWW Domain ({wwwDomain})</h6>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '0.75rem 1rem', fontSize: '0.95rem' }}>
                    <div><strong>Type:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>CNAME</code>
                    </div>
                    <div><strong>Name:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>www</code>
                      <span className="text-muted ms-2" style={{ fontSize: '0.8rem' }}>(sometimes called "Host" or "Alias")</span>
                    </div>
                    <div><strong>Value:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>
                        {RESTAURANT_SITE_ID}.web.app
                      </code>
                      <Button
                        variant="link"
                        size="sm"
                        className="ms-1 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText(`${RESTAURANT_SITE_ID}.web.app`);
                          setDomainMessage({ type: 'success', text: 'Copied to clipboard!' });
                          setTimeout(() => setDomainMessage({ type: '', text: '' }), 2000);
                        }}
                        title="Copy to clipboard"
                      >
                        <i className="bi bi-clipboard"></i>
                      </Button>
                    </div>
                    <div><strong>TTL:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>Auto</code>
                      <span className="text-muted ms-2" style={{ fontSize: '0.8rem' }}>(or 3600)</span>
                    </div>
                  </div>
                </Card.Body>
              </Card>

              {/* Record 2: A record for apex */}
              <Card className="mb-4" style={{ background: '#f0fff4', border: '1px solid #b3e6c5' }}>
                <Card.Body>
                  <h6 className="mb-3"><i className="bi bi-2-circle-fill me-2 text-success"></i>Root Domain ({bareDomain})</h6>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '0.75rem 1rem', fontSize: '0.95rem' }}>
                    <div><strong>Type:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>A</code>
                    </div>
                    <div><strong>Name:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>@</code>
                      <span className="text-muted ms-2" style={{ fontSize: '0.8rem' }}>(@ means the root domain itself)</span>
                    </div>
                    <div><strong>Value:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>
                        199.36.158.100
                      </code>
                      <Button
                        variant="link"
                        size="sm"
                        className="ms-1 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText('199.36.158.100');
                          setDomainMessage({ type: 'success', text: 'Copied to clipboard!' });
                          setTimeout(() => setDomainMessage({ type: '', text: '' }), 2000);
                        }}
                        title="Copy to clipboard"
                      >
                        <i className="bi bi-clipboard"></i>
                      </Button>
                    </div>
                    <div><strong>TTL:</strong></div>
                    <div>
                      <code style={{ background: '#fff', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>Auto</code>
                      <span className="text-muted ms-2" style={{ fontSize: '0.8rem' }}>(or 3600)</span>
                    </div>
                  </div>
                  <div className="mt-2 text-muted" style={{ fontSize: '0.8rem' }}>
                    <i className="bi bi-info-circle me-1"></i>
                    If your registrar uses URL forwarding for the root domain, you must <strong>remove</strong> it first and replace with this A record.
                  </div>
                </Card.Body>
              </Card>

              <Card className="mb-4" style={{ background: '#fff9e6', border: '1px solid #ffe0a3' }}>
                <Card.Body>
                  <h6 className="mb-2"><i className="bi bi-lightbulb me-2"></i>Step-by-step for popular providers:</h6>
                  <div className="accordion" id="dnsProviderHelp">
                    {[
                      { name: 'GoDaddy', steps: ['Log in to GoDaddy.com and go to "My Products"', 'Click "DNS" next to your domain', 'Remove any existing URL forwarding for the root domain', `Add Record: Type = CNAME, Host = www, Points to = ${RESTAURANT_SITE_ID}.web.app`, `Add Record: Type = A, Host = @, Points to = 199.36.158.100`, 'TTL: leave as default, click "Save"'] },
                      { name: 'Namecheap', steps: ['Log in to Namecheap.com', 'Go to Domain List > click "Manage"', 'Click "Advanced DNS" tab', 'Remove any URL Redirect Records for @', `Add: Type = CNAME Record, Host = www, Value = ${RESTAURANT_SITE_ID}.web.app`, `Add: Type = A Record, Host = @, Value = 199.36.158.100`, 'TTL: Automatic, click the green checkmark'] },
                      { name: 'Cloudflare', steps: ['Log in to Cloudflare dashboard', 'Select your domain', 'Go to DNS > Records', `Add: Type = CNAME, Name = www, Target = ${RESTAURANT_SITE_ID}.web.app, Proxy = DNS only`, `Add: Type = A, Name = @, IPv4 = 199.36.158.100, Proxy = DNS only`, 'Click "Save" for each'] },
                      { name: 'Google Domains / Squarespace', steps: ['Log in to domains.google.com (now Squarespace Domains)', 'Select your domain', 'Go to DNS in the sidebar', 'Remove any forwarding rules', `Add custom record: Host = www, Type = CNAME, Data = ${RESTAURANT_SITE_ID}.web.app`, `Add custom record: Host = (blank/@), Type = A, Data = 199.36.158.100`, 'Click "Save"'] },
                    ].map((provider, idx) => (
                      <div key={idx} className="mb-2">
                        <button
                          className="btn btn-link text-decoration-none p-0 fw-bold"
                          style={{ fontSize: '0.9rem', color: '#333' }}
                          type="button"
                          data-bs-toggle="collapse"
                          data-bs-target={`#provider-${idx}`}
                        >
                          <i className="bi bi-chevron-right me-1"></i> {provider.name}
                        </button>
                        <div className="collapse" id={`provider-${idx}`}>
                          <ol className="mt-1 mb-0" style={{ fontSize: '0.85rem', paddingLeft: '1.5rem' }}>
                            {provider.steps.map((step, i) => (
                              <li key={i} className="mb-1">{step}</li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card.Body>
              </Card>

              <Alert variant="info" className="mb-4">
                <i className="bi bi-clock-history me-2"></i>
                <strong>DNS changes can take 1-30 minutes to propagate.</strong> If verification fails the first time, wait a few minutes and try again. In rare cases, it can take up to 48 hours.
              </Alert>

              <div className="d-flex gap-2">
                <Button variant="outline-secondary" onClick={() => setDomainStep(1)}>
                  <i className="bi bi-arrow-left me-1"></i> Back
                </Button>
                <Button variant="primary" onClick={handleVerifyDomain} disabled={domainVerifying}>
                  {domainVerifying ? (
                    <>
                      <Spinner size="sm" animation="border" className="me-1" />
                      Verifying DNS...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check2-circle me-1"></i> Verify & Connect
                    </>
                  )}
                </Button>
              </div>
            </div>
            );
          })()}

          {/* Step 3: Status / Connected */}
          {domainStep === 3 && (
            <div>
              <div className="text-center mb-4">
                {customDomainStatus === 'active' ? (
                  <>
                    <div style={{ fontSize: '3rem', color: '#198754' }}>
                      <i className="bi bi-check-circle-fill"></i>
                    </div>
                    <h5 className="mt-2 mb-1">Both Domains Connected</h5>
                    <p className="text-muted">Your custom domains are live and serving your website with SSL.</p>
                  </>
                ) : customDomainStatus === 'partial' ? (
                  <>
                    <div style={{ fontSize: '3rem', color: '#ffc107' }}>
                      <i className="bi bi-exclamation-circle-fill"></i>
                    </div>
                    <h5 className="mt-2 mb-1">Partially Connected</h5>
                    <p className="text-muted">One domain is verified but the other still needs DNS setup.</p>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '3rem', color: '#ffc107' }}>
                      <i className="bi bi-exclamation-circle-fill"></i>
                    </div>
                    <h5 className="mt-2 mb-1">DNS Verification Pending</h5>
                    <p className="text-muted">Your domains are saved but DNS hasn't been verified yet.</p>
                  </>
                )}
              </div>

              <Card className="mb-4">
                <Card.Body>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.75rem 1rem' }}>
                    <div className="text-muted"><strong>Root Domain:</strong></div>
                    <div className="d-flex align-items-center gap-2">
                      <a href={`https://${customDomain}`} target="_blank" rel="noopener noreferrer" className="fw-bold">
                        {customDomain} <i className="bi bi-box-arrow-up-right" style={{ fontSize: '0.75rem' }}></i>
                      </a>
                      {apexVerified || customDomainStatus === 'active' ? (
                        <Badge bg="success" style={{ fontSize: '0.7rem' }}>Verified</Badge>
                      ) : (
                        <Badge bg="warning" text="dark" style={{ fontSize: '0.7rem' }}>Pending</Badge>
                      )}
                    </div>
                    <div className="text-muted"><strong>WWW Domain:</strong></div>
                    <div className="d-flex align-items-center gap-2">
                      <a href={`https://${customDomainWww}`} target="_blank" rel="noopener noreferrer" className="fw-bold">
                        {customDomainWww} <i className="bi bi-box-arrow-up-right" style={{ fontSize: '0.75rem' }}></i>
                      </a>
                      {wwwVerified || customDomainStatus === 'active' ? (
                        <Badge bg="success" style={{ fontSize: '0.7rem' }}>Verified</Badge>
                      ) : (
                        <Badge bg="warning" text="dark" style={{ fontSize: '0.7rem' }}>Pending</Badge>
                      )}
                    </div>
                    <div className="text-muted"><strong>Overall Status:</strong></div>
                    <div>
                      {customDomainStatus === 'active' ? (
                        <Badge bg="success"><i className="bi bi-check-circle me-1"></i>Active</Badge>
                      ) : customDomainStatus === 'partial' ? (
                        <Badge bg="warning" text="dark"><i className="bi bi-exclamation-circle me-1"></i>Partial</Badge>
                      ) : (
                        <Badge bg="warning" text="dark"><i className="bi bi-clock me-1"></i>Pending</Badge>
                      )}
                    </div>
                    <div className="text-muted"><strong>DNS Records:</strong></div>
                    <div style={{ fontSize: '0.85rem' }}>
                      <div>CNAME: <code>www</code> &rarr; <code>{RESTAURANT_SITE_ID}.web.app</code></div>
                      <div>A: <code>@</code> &rarr; <code>199.36.158.100</code></div>
                    </div>
                  </div>
                </Card.Body>
              </Card>

              {(customDomainStatus === 'pending' || customDomainStatus === 'partial') && (
                <Alert variant="info" className="mb-3">
                  <i className="bi bi-info-circle me-2"></i>
                  Make sure you've added both DNS records (CNAME for www + A record for root) at your domain registrar, then click "Re-verify". DNS changes can take a few minutes to propagate. SSL certificates are provisioned automatically once DNS is verified.
                </Alert>
              )}

              <div className="d-flex gap-2 flex-wrap">
                {customDomainStatus === 'pending' && (
                  <Button variant="primary" onClick={handleVerifyDomain} disabled={domainVerifying}>
                    {domainVerifying ? (
                      <><Spinner size="sm" animation="border" className="me-1" /> Verifying...</>
                    ) : (
                      <><i className="bi bi-arrow-repeat me-1"></i> Re-verify DNS</>
                    )}
                  </Button>
                )}
                <Button variant="outline-primary" onClick={handleChangeDomain}>
                  <i className="bi bi-pencil me-1"></i> Change Domain
                </Button>
                <Button variant="outline-danger" onClick={() => { setDomainMessage({ type: '', text: '' }); setDomainStep(4); }}>
                  <i className="bi bi-x-circle me-1"></i> Disconnect Domain
                </Button>
              </div>

              {customDomainStatus === 'active' && (
                <>
                  <hr className="my-4" />
                  <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                    <p className="mb-1"><strong>How it works:</strong></p>
                    <p className="mb-0">
                      When customers visit <strong>{customDomain}</strong> or <strong>{customDomainWww}</strong>, they'll see your restaurant website with full menu, online ordering, and customer portal — exactly like the preview you see here. Your Koda Carte URL will continue to work as well. SSL certificates are automatically provisioned and renewed.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Confirm Disconnect */}
          {domainStep === 4 && (
            <div>
              <div className="text-center mb-4">
                <div style={{ fontSize: '3rem', color: '#dc3545' }}>
                  <i className="bi bi-exclamation-triangle-fill"></i>
                </div>
                <h5 className="mt-2 mb-1">Disconnect Custom Domain?</h5>
                <p className="text-muted">
                  This will remove <strong>{customDomain}</strong> and <strong>{customDomainWww}</strong> from your restaurant website. Visitors to these domains will no longer see your site.
                </p>
              </div>

              <Alert variant="warning" className="mb-4">
                <i className="bi bi-info-circle me-2"></i>
                You can reconnect your domain at any time. Your DNS records at your domain registrar won't be affected — only the connection on our side is removed.
              </Alert>

              <div className="d-flex gap-2 justify-content-center">
                <Button variant="outline-secondary" onClick={() => setDomainStep(3)}>
                  <i className="bi bi-arrow-left me-1"></i> Go Back
                </Button>
                <Button variant="danger" onClick={handleRemoveDomain} disabled={domainRemoving}>
                  {domainRemoving ? (
                    <><Spinner size="sm" animation="border" className="me-1" /> Disconnecting...</>
                  ) : (
                    <><i className="bi bi-x-circle me-1"></i> Yes, Disconnect</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>

      {/* Preview Modal */}
      <Modal
        show={showPreviewModal}
        onHide={() => setShowPreviewModal(false)}
        fullscreen
        className="preview-modal"
      >
        <Modal.Header style={{ background: '#1a1a2e', borderBottom: '1px solid #333', padding: '0.6rem 1rem' }}>
          <div className="d-flex align-items-center gap-2">
            <i className="bi bi-display" style={{ color: '#fff' }}></i>
            <strong style={{ color: '#fff' }}>Preview</strong>
            <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>(updates after save)</span>
          </div>
          <div className="d-flex align-items-center gap-1 ms-auto me-3">
            <Button
              variant={previewDevice === 'desktop' ? 'primary' : 'outline-light'}
              size="sm"
              onClick={() => setPreviewDevice('desktop')}
              title="Desktop"
            >
              <i className="bi bi-display"></i>
            </Button>
            <Button
              variant={previewDevice === 'tablet' ? 'primary' : 'outline-light'}
              size="sm"
              onClick={() => setPreviewDevice('tablet')}
              title="Tablet"
            >
              <i className="bi bi-tablet"></i>
            </Button>
            <Button
              variant={previewDevice === 'mobile' ? 'primary' : 'outline-light'}
              size="sm"
              onClick={() => setPreviewDevice('mobile')}
              title="Mobile"
            >
              <i className="bi bi-phone"></i>
            </Button>
            <Button
              variant="outline-light"
              size="sm"
              onClick={() => setIframeKey(prev => prev + 1)}
              title="Reload"
              className="ms-2"
            >
              <i className="bi bi-arrow-clockwise"></i>
            </Button>
            {previewUrl && (
              <Button
                variant="outline-light"
                size="sm"
                href={previewUrl}
                target="_blank"
                title="Open in new tab"
                className="ms-1"
              >
                <i className="bi bi-box-arrow-up-right"></i>
              </Button>
            )}
          </div>
          <Button variant="outline-light" size="sm" onClick={() => setShowPreviewModal(false)}>
            <i className="bi bi-x-lg"></i>
          </Button>
        </Modal.Header>
        <Modal.Body style={{ background: '#1a1a2e', padding: 0, display: 'flex', justifyContent: 'center' }}>
          {previewUrl ? (
            <iframe
              key={iframeKey}
              src={previewUrl}
              title="Website Preview"
              style={{
                width: previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%',
                height: '100%',
                border: 'none',
                background: '#fff',
                transition: 'width 0.3s ease',
                boxShadow: previewDevice !== 'desktop' ? '0 0 40px rgba(0,0,0,0.5)' : 'none',
                borderRadius: previewDevice !== 'desktop' ? '8px' : '0',
                margin: previewDevice !== 'desktop' ? '10px 0' : '0',
                maxHeight: previewDevice !== 'desktop' ? 'calc(100% - 20px)' : '100%'
              }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>
              <i className="bi bi-globe" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
              <p className="mt-3">Save your configuration to see a preview</p>
            </div>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
} 
