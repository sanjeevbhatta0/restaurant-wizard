import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner, Badge, ProgressBar } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, storage, functions } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { compressImage } from '../services/imageService';
import { useNavigate } from 'react-router-dom';
import './MobileApp.css';
import './PageHeader.css';

// Ordered pipeline stages for progress tracking
const PIPELINE_STAGES = [
  { key: 'queued', label: 'Queued', icon: 'clock' },
  { key: 'generating_assets', label: 'Generating Assets', icon: 'image' },
  { key: 'building_ios', label: 'Building iOS', icon: 'apple' },
  { key: 'building_android', label: 'Building Android', icon: 'android2' },
  { key: 'submitting_ios', label: 'Submitting iOS', icon: 'cloud-upload' },
  { key: 'submitting_android', label: 'Submitting Android', icon: 'google-play' },
  { key: 'submitted', label: 'Submitted', icon: 'check-circle' }
];

const STATUS_CONFIG = {
  draft: { label: 'Draft', bg: 'secondary', icon: 'pencil' },
  queued: { label: 'Queued', bg: 'info', icon: 'clock' },
  generating_assets: { label: 'Generating Assets', bg: 'info', icon: 'image' },
  building_ios: { label: 'Building iOS', bg: 'primary', icon: 'apple' },
  building_android: { label: 'Building Android', bg: 'primary', icon: 'android2' },
  submitting_ios: { label: 'Submitting to App Store', bg: 'primary', icon: 'cloud-upload' },
  submitting_android: { label: 'Submitting to Google Play', bg: 'primary', icon: 'google-play' },
  submitted: { label: 'Submitted for Review', bg: 'success', icon: 'check-circle' },
  live: { label: 'Live', bg: 'success', icon: 'broadcast' },
  failed: { label: 'Failed', bg: 'danger', icon: 'exclamation-triangle' },
  update_pending: { label: 'Update Building', bg: 'info', icon: 'arrow-repeat' }
};

const CATEGORIES = [
  { value: 'food-drink', label: 'Food & Drink' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'lifestyle', label: 'Lifestyle' }
];

function generateBundleSuffix(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
}

export default function MobileApp() {
  const { currentUser, restaurantUid } = useAuth();
  const { hasFeatureAccess, getMinimumTierForFeature } = useSubscription();
  const navigate = useNavigate();

  // Wizard state
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Existing config (null = first time)
  const [existingConfig, setExistingConfig] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // Restaurant data
  const [restaurantData, setRestaurantData] = useState(null);
  const [websiteConfig, setWebsiteConfig] = useState(null);

  // Form fields
  const [appName, setAppName] = useState('');
  const [bundleSuffix, setBundleSuffix] = useState('');
  const [bundleSuffixManual, setBundleSuffixManual] = useState(false);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('food-drink');
  const [keywords, setKeywords] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [supportUrl, setSupportUrl] = useState('');
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState('https://www.kodacarte.com/privacy');
  const [marketingUrl, setMarketingUrl] = useState('');
  const [platforms, setPlatforms] = useState(['ios', 'android']);

  // Custom icon
  const [customIconUrl, setCustomIconUrl] = useState('');
  const [customIconPath, setCustomIconPath] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconFileRef = useRef(null);

  // Bundle uniqueness
  const [bundleChecking, setBundleChecking] = useState(false);
  const [bundleAvailable, setBundleAvailable] = useState(null);

  const uid = restaurantUid || currentUser?.uid;
  const hasAccess = hasFeatureAccess('mobile-app');

  // Load restaurant data + website config (one-time)
  useEffect(() => {
    if (!uid) return;
    const loadData = async () => {
      try {
        const restDoc = await getDoc(doc(db, 'restaurants', uid));
        const restData = restDoc.exists() ? restDoc.data() : {};
        setRestaurantData(restData);

        const webDoc = await getDoc(doc(db, 'restaurants', uid, 'website', 'config'));
        const webData = webDoc.exists() ? webDoc.data() : {};
        setWebsiteConfig(webData);

        // Pre-fill form from restaurant data
        const name = restData.restaurantName || '';
        setAppName(name);
        setBundleSuffix(generateBundleSuffix(name));
        setDescription(restData.description || '');
        setKeywords(`${name}, food, ordering, pickup, delivery, restaurant`);
        setSupportEmail(currentUser?.email || restData.email || '');
        if (restData.slug) {
          setSupportUrl(`https://kodacarte-861d8.web.app/?restaurant=${restData.slug}`);
        }
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load restaurant data');
      }
    };
    loadData();
  }, [uid, currentUser]);

  // Real-time listener for mobile app config
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'restaurants', uid, 'mobileApp', 'config'), (snap) => {
      if (snap.exists()) {
        const config = snap.data();
        setExistingConfig(config);

        // If this is initial load, populate form from existing config
        if (loading) {
          setAppName(config.appName || '');
          setBundleSuffix(config.bundleSuffix || '');
          setBundleSuffixManual(true);
          setDescription(config.description || '');
          setCategory(config.category || 'food-drink');
          setKeywords(config.keywords || '');
          setSupportEmail(config.supportEmail || '');
          setSupportUrl(config.supportUrl || '');
          setPrivacyPolicyUrl(config.privacyPolicyUrl || 'https://www.kodacarte.com/privacy');
          setMarketingUrl(config.marketingUrl || '');
          setCustomIconUrl(config.customIconUrl || '');
          setCustomIconPath(config.customIconStoragePath || '');
          setPlatforms(config.platforms || ['ios', 'android']);
        }
      }
      setLoading(false);
    }, (err) => {
      console.error('Config listener error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [uid]);

  // Auto-generate bundle suffix from app name
  useEffect(() => {
    if (!bundleSuffixManual && appName) {
      setBundleSuffix(generateBundleSuffix(appName));
    }
  }, [appName, bundleSuffixManual]);

  // Debounced bundle uniqueness check
  const checkBundleUniqueness = useCallback(async (suffix) => {
    if (!suffix || suffix.length < 2) { setBundleAvailable(null); return; }
    setBundleChecking(true);
    try {
      const bundleDoc = await getDoc(doc(db, 'mobileAppBundles', suffix));
      if (bundleDoc.exists()) {
        setBundleAvailable(bundleDoc.data().restaurantId === uid);
      } else {
        setBundleAvailable(true);
      }
    } catch (err) {
      setBundleAvailable(null);
    } finally {
      setBundleChecking(false);
    }
  }, [uid]);

  useEffect(() => {
    const timer = setTimeout(() => { if (bundleSuffix) checkBundleUniqueness(bundleSuffix); }, 500);
    return () => clearTimeout(timer);
  }, [bundleSuffix, checkBundleUniqueness]);

  // Custom icon upload
  const handleIconUpload = async (file) => {
    if (!file || !file.type.startsWith('image/')) { setError('Please upload an image file'); return; }
    setUploadingIcon(true);
    setError('');
    try {
      const compressed = await compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.9 });
      if (customIconPath) { try { await deleteObject(ref(storage, customIconPath)); } catch (e) { /* ignore */ } }
      const fileName = `${Date.now()}-app-icon.${file.name.split('.').pop()}`;
      const storagePath = `restaurants/${uid}/mobile-app/icons/${fileName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressed);
      const downloadUrl = await getDownloadURL(storageRef);
      setCustomIconUrl(downloadUrl);
      setCustomIconPath(storagePath);
    } catch (err) {
      setError('Failed to upload icon: ' + err.message);
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleIconRemove = async () => {
    if (customIconPath) { try { await deleteObject(ref(storage, customIconPath)); } catch (e) { /* ignore */ } }
    setCustomIconUrl('');
    setCustomIconPath('');
  };

  const togglePlatform = (platform) => {
    setPlatforms(prev => {
      if (prev.includes(platform)) {
        return prev.length > 1 ? prev.filter(p => p !== platform) : prev; // Must have at least one
      }
      return [...prev, platform];
    });
  };

  // Validation
  const logoUrl = customIconUrl || websiteConfig?.logo || '';
  const primaryColor = websiteConfig?.primaryColor || '#2c3e50';

  const validations = {
    logoUploaded: !!logoUrl,
    appNameProvided: appName.trim().length > 0,
    bundleSuffixValid: /^[a-z0-9]{2,30}$/.test(bundleSuffix) && bundleAvailable === true,
    elderPlanActive: hasAccess,
    platformSelected: platforms.length > 0
  };
  const allValid = Object.values(validations).every(Boolean);

  // Publish — triggers the automated build pipeline
  const handlePublish = async () => {
    if (!allValid) return;
    setPublishing(true);
    setError('');
    try {
      const publishMobileApp = httpsCallable(functions, 'publishMobileApp');
      await publishMobileApp({
        appName: appName.trim(),
        bundleSuffix,
        description: description.trim(),
        category,
        keywords: keywords.trim(),
        supportEmail: supportEmail.trim(),
        supportUrl: supportUrl.trim(),
        privacyPolicyUrl: privacyPolicyUrl.trim(),
        marketingUrl: marketingUrl.trim() || null,
        customIconUrl: customIconUrl || null,
        customIconStoragePath: customIconPath || null,
        platforms,
        logoUrl,
        primaryColor,
        restaurantName: restaurantData?.restaurantName || appName,
        // Pass existing data for updates
        existingStatus: existingConfig?.status || null,
        version: existingConfig?.version || '1.0.0',
        buildNumber: existingConfig?.buildNumber || 0,
        publishedAt: existingConfig?.publishedAt || null,
        iosAppId: existingConfig?.iosAppId || null,
        androidPackage: existingConfig?.androidPackage || null
      });

      setIsEditing(false);
      setSuccess('Build pipeline started! You can track progress below.');
    } catch (err) {
      console.error('Publish error:', err);
      setError('Failed to start build: ' + (err.message || 'Unknown error'));
    } finally {
      setPublishing(false);
    }
  };

  // ── Elder plan gate ──
  if (!hasAccess) {
    return (
      <Container fluid className="py-4">
        <div className="page-header-gradient">
          <div className="header-content">
            <i className="bi bi-phone header-icon"></i>
            <div>
              <h2>Mobile App</h2>
              <p style={{ margin: '5px 0 0', opacity: 0.9 }}>Publish your own branded mobile app</p>
            </div>
          </div>
        </div>
        <Card className="mt-4 text-center p-5">
          <Card.Body>
            <i className="bi bi-lock-fill" style={{ fontSize: '3rem', color: '#f59e0b' }}></i>
            <h3 className="mt-3">Elder Plan Required</h3>
            <p className="text-muted mb-4">
              Publishing a branded mobile app is an exclusive feature of the <strong>Elder Plan</strong>.
              Upgrade to get your restaurant's own app on the App Store and Google Play.
            </p>
            <Button variant="warning" onClick={() => navigate('/account')}>
              <i className="bi bi-arrow-up-circle me-2"></i>View Upgrade Options
            </Button>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container fluid className="py-4 text-center">
        <Spinner animation="border" />
        <p className="mt-2 text-muted">Loading mobile app settings...</p>
      </Container>
    );
  }

  // ── Active Build / Status Dashboard ──
  const isInPipeline = existingConfig && ['queued', 'generating_assets', 'building_ios', 'building_android', 'submitting_ios', 'submitting_android'].includes(existingConfig.status);
  const showDashboard = existingConfig && !isEditing && existingConfig.status !== 'draft';

  if (showDashboard) {
    const status = STATUS_CONFIG[existingConfig.status] || STATUS_CONFIG.draft;
    const currentStageIndex = PIPELINE_STAGES.findIndex(s => s.key === existingConfig.status);
    const progressPercent = isInPipeline
      ? Math.max(5, Math.round(((currentStageIndex + 1) / PIPELINE_STAGES.length) * 100))
      : existingConfig.status === 'submitted' || existingConfig.status === 'live' ? 100 : 0;

    return (
      <Container fluid className="mobile-app-page py-4">
        <div className="page-header-gradient" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
          <div className="header-content">
            <i className="bi bi-phone header-icon"></i>
            <div>
              <h2>Mobile App</h2>
              <p style={{ margin: '5px 0 0', opacity: 0.9 }}>
                {existingConfig.appName}
                <Badge bg={status.bg} className="ms-2">
                  <i className={`bi bi-${status.icon} me-1`}></i>{status.label}
                </Badge>
              </p>
            </div>
          </div>
          {(existingConfig.status === 'live' || existingConfig.status === 'submitted' || existingConfig.status === 'failed') && (
            <Button variant="light" onClick={() => { setIsEditing(true); setStep(1); }}>
              <i className="bi bi-pencil me-1"></i>{existingConfig.status === 'failed' ? 'Retry' : 'Edit & Update'}
            </Button>
          )}
        </div>

        {success && <Alert variant="success" dismissible onClose={() => setSuccess('')} className="mt-3">{success}</Alert>}
        {error && <Alert variant="danger" dismissible onClose={() => setError('')} className="mt-3">{error}</Alert>}

        {/* Pipeline Progress */}
        {isInPipeline && (
          <Card className="mt-4 border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex align-items-center mb-3">
                <Spinner animation="border" size="sm" className="me-2 text-primary" />
                <strong>{existingConfig.statusMessage || 'Building...'}</strong>
              </div>
              <ProgressBar now={progressPercent} animated striped variant="primary" className="mb-3" style={{ height: '8px' }} />
              <div className="pipeline-stages">
                {PIPELINE_STAGES.filter(stage => {
                  // Only show relevant platform stages
                  if (stage.key === 'building_ios' || stage.key === 'submitting_ios') return platforms.includes('ios');
                  if (stage.key === 'building_android' || stage.key === 'submitting_android') return platforms.includes('android');
                  return true;
                }).map((stage, i) => {
                  const stageIdx = PIPELINE_STAGES.findIndex(s => s.key === stage.key);
                  const isComplete = currentStageIndex > stageIdx;
                  const isCurrent = existingConfig.status === stage.key;
                  return (
                    <div key={stage.key} className={`pipeline-stage ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''}`}>
                      <i className={`bi bi-${isComplete ? 'check-circle-fill' : stage.icon}`}></i>
                      <span>{stage.label}</span>
                    </div>
                  );
                })}
              </div>
            </Card.Body>
          </Card>
        )}

        {/* Status Card — non-pipeline states */}
        {!isInPipeline && (
          <Card className="mt-4 mobile-app-status-card border-0 shadow-sm">
            <Card.Body className="text-center py-4">
              <i className={`bi bi-${status.icon}`} style={{ fontSize: '2.5rem', color: `var(--bs-${status.bg})` }}></i>
              <h4 className="mt-2">{existingConfig.statusMessage || status.label}</h4>

              {existingConfig.status === 'submitted' && (
                <p className="text-muted mt-2">App Store review typically takes 1-3 business days. Google Play is usually faster.</p>
              )}

              {existingConfig.status === 'live' && (
                <div className="mt-3 d-flex gap-2 justify-content-center flex-wrap">
                  {existingConfig.iosAppId && (
                    <a href={`https://apps.apple.com/app/id${existingConfig.iosAppId}`} target="_blank" rel="noopener noreferrer" className="btn btn-outline-dark">
                      <i className="bi bi-apple me-1"></i>App Store
                    </a>
                  )}
                  {existingConfig.androidPackage && (
                    <a href={`https://play.google.com/store/apps/details?id=${existingConfig.androidPackage}`} target="_blank" rel="noopener noreferrer" className="btn btn-outline-success">
                      <i className="bi bi-google-play me-1"></i>Google Play
                    </a>
                  )}
                </div>
              )}

              {existingConfig.status === 'failed' && existingConfig.errorDetails && (
                <Alert variant="danger" className="mt-3 text-start mx-auto" style={{ maxWidth: '600px' }}>
                  <strong>Error:</strong> {existingConfig.errorDetails}
                </Alert>
              )}
            </Card.Body>
          </Card>
        )}

        {/* Config Summary */}
        <Row className="mt-4 g-3">
          <Col md={6}>
            <Card className="h-100">
              <Card.Header><i className="bi bi-info-circle me-2"></i>App Information</Card.Header>
              <Card.Body>
                <div className="config-field"><strong>App Name:</strong> {existingConfig.appName}</div>
                <div className="config-field"><strong>Bundle ID:</strong> <code>{existingConfig.bundleId}</code></div>
                <div className="config-field"><strong>Platforms:</strong> {(existingConfig.platforms || []).map(p => p === 'ios' ? 'iOS' : 'Android').join(', ')}</div>
                <div className="config-field"><strong>Category:</strong> {CATEGORIES.find(c => c.value === existingConfig.category)?.label || existingConfig.category}</div>
                <div className="config-field"><strong>Version:</strong> {existingConfig.version} (Build {existingConfig.buildNumber})</div>
              </Card.Body>
            </Card>
          </Col>
          <Col md={6}>
            <Card className="h-100">
              <Card.Header><i className="bi bi-envelope me-2"></i>App Store Info</Card.Header>
              <Card.Body>
                <div className="config-field"><strong>Support Email:</strong> {existingConfig.supportEmail}</div>
                <div className="config-field"><strong>Privacy Policy:</strong> <a href={existingConfig.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">{existingConfig.privacyPolicyUrl}</a></div>
                <div className="config-field"><strong>Keywords:</strong> {existingConfig.keywords}</div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Branding + Timeline */}
        <Row className="mt-3 g-3">
          <Col md={6}>
            <Card className="h-100">
              <Card.Header><i className="bi bi-palette me-2"></i>Branding</Card.Header>
              <Card.Body>
                <div className="d-flex align-items-center gap-3">
                  <div className="app-icon-preview-small" style={{ backgroundColor: primaryColor }}>
                    {(existingConfig.customIconUrl || websiteConfig?.logo) ? (
                      <img src={existingConfig.customIconUrl || websiteConfig?.logo} alt="App Icon" />
                    ) : (
                      <i className="bi bi-shop" style={{ fontSize: '1.5rem', color: '#fff' }}></i>
                    )}
                  </div>
                  <div>
                    <strong>{existingConfig.appName}</strong>
                    <div className="text-muted small">{existingConfig.customIconUrl ? 'Custom icon' : 'Auto-generated from logo'}</div>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col md={6}>
            <Card className="h-100">
              <Card.Header><i className="bi bi-clock-history me-2"></i>Timeline</Card.Header>
              <Card.Body>
                <div className="config-field"><strong>Requested:</strong> {existingConfig.requestedAt?.toDate ? existingConfig.requestedAt.toDate().toLocaleString() : 'N/A'}</div>
                {existingConfig.buildStartedAt && <div className="config-field"><strong>Build Started:</strong> {existingConfig.buildStartedAt.toDate?.().toLocaleString()}</div>}
                {existingConfig.buildCompletedAt && <div className="config-field"><strong>Build Completed:</strong> {existingConfig.buildCompletedAt.toDate?.().toLocaleString()}</div>}
                {existingConfig.submittedAt && <div className="config-field"><strong>Submitted:</strong> {existingConfig.submittedAt.toDate?.().toLocaleString()}</div>}
                {existingConfig.publishedAt && <div className="config-field"><strong>Published:</strong> {existingConfig.publishedAt.toDate?.().toLocaleString()}</div>}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  // ── Wizard ──
  const renderStepIndicator = () => (
    <div className="wizard-steps mb-4">
      {[
        { num: 1, label: 'App Info' },
        { num: 2, label: 'Branding' },
        { num: 3, label: 'Review' }
      ].map(({ num, label }) => (
        <div
          key={num}
          className={`wizard-step ${step === num ? 'active' : ''} ${step > num ? 'completed' : ''}`}
          onClick={() => { if (step > num) setStep(num); }}
        >
          <div className="wizard-step-circle">
            {step > num ? <i className="bi bi-check-lg"></i> : num}
          </div>
          <span className="wizard-step-label">{label}</span>
        </div>
      ))}
    </div>
  );

  // ── Step 1: App Information ──
  const renderStep1 = () => (
    <Card>
      <Card.Header><i className="bi bi-info-circle me-2"></i>App Information</Card.Header>
      <Card.Body>
        <Form.Group className="mb-3">
          <Form.Label>App Name <span className="text-danger">*</span></Form.Label>
          <Form.Control type="text" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="Your Restaurant Name" maxLength={50} />
          <Form.Text className="text-muted">Display name on the App Store and Google Play.</Form.Text>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>Bundle Suffix <span className="text-danger">*</span></Form.Label>
          <div className="d-flex align-items-center gap-2">
            <Form.Control
              type="text" value={bundleSuffix}
              onChange={(e) => { setBundleSuffix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)); setBundleSuffixManual(true); }}
              placeholder="burgerpalace" maxLength={30}
              isValid={bundleAvailable === true} isInvalid={bundleAvailable === false}
            />
            {bundleChecking && <Spinner animation="border" size="sm" />}
          </div>
          <Form.Text className={bundleAvailable === false ? 'text-danger' : 'text-muted'}>
            {bundleAvailable === false ? 'This suffix is already taken.' : <>Bundle ID: <code>com.kodacarte.wl.{bundleSuffix || '...'}</code></>}
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label>App Description</Form.Label>
          <Form.Control as="textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your restaurant app..." maxLength={4000} />
          <Form.Text className="text-muted">{description.length}/4000</Form.Text>
        </Form.Group>

        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>Category</Form.Label>
              <Form.Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>Platforms <span className="text-danger">*</span></Form.Label>
              <div className="d-flex gap-2">
                <Button variant={platforms.includes('ios') ? 'primary' : 'outline-secondary'} onClick={() => togglePlatform('ios')} className="flex-fill">
                  <i className="bi bi-apple me-1"></i>iOS
                </Button>
                <Button variant={platforms.includes('android') ? 'success' : 'outline-secondary'} onClick={() => togglePlatform('android')} className="flex-fill">
                  <i className="bi bi-android2 me-1"></i>Android
                </Button>
              </div>
            </Form.Group>
          </Col>
        </Row>

        <Form.Group className="mb-3">
          <Form.Label>Keywords</Form.Label>
          <Form.Control type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="food, ordering, pickup, delivery, restaurant" />
          <Form.Text className="text-muted">Comma-separated, for App Store SEO.</Form.Text>
        </Form.Group>

        <div className="d-flex justify-content-end">
          <Button variant="primary" onClick={() => setStep(2)} disabled={!appName.trim() || !bundleSuffix || bundleAvailable === false || platforms.length === 0}>
            Next: Branding <i className="bi bi-arrow-right ms-1"></i>
          </Button>
        </div>
      </Card.Body>
    </Card>
  );

  // ── Step 2: Branding ──
  const renderStep2 = () => (
    <Card>
      <Card.Header><i className="bi bi-palette me-2"></i>Branding Preview</Card.Header>
      <Card.Body>
        {!websiteConfig?.logo && !customIconUrl && (
          <Alert variant="warning">
            <i className="bi bi-exclamation-triangle me-2"></i>
            Upload your restaurant logo in <strong>Website Builder</strong> or upload a custom app icon below.
          </Alert>
        )}

        <Row className="g-4">
          <Col md={6}>
            <h5 className="mb-3">App Icon</h5>
            <div className="app-icon-preview-container">
              <div className="app-icon-preview" style={{ backgroundColor: primaryColor }}>
                {logoUrl ? <img src={logoUrl} alt="App Icon" /> : <i className="bi bi-shop" style={{ fontSize: '3rem', color: '#fff' }}></i>}
              </div>
              <div className="app-icon-label">{appName || 'App Name'}</div>
            </div>
            <div className="mt-3">
              <Form.Label className="small text-muted">Custom App Icon (optional, 1024x1024)</Form.Label>
              <div className="d-flex gap-2">
                <Button variant="outline-secondary" size="sm" onClick={() => iconFileRef.current?.click()} disabled={uploadingIcon}>
                  {uploadingIcon ? <Spinner animation="border" size="sm" /> : <i className="bi bi-upload me-1"></i>}Upload
                </Button>
                {customIconUrl && <Button variant="outline-danger" size="sm" onClick={handleIconRemove}><i className="bi bi-trash me-1"></i>Remove</Button>}
              </div>
              <input type="file" ref={iconFileRef} className="d-none" accept="image/*" onChange={(e) => { if (e.target.files[0]) handleIconUpload(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </Col>
          <Col md={6}>
            <h5 className="mb-3">Splash Screen</h5>
            <div className="phone-mockup">
              <div className="phone-frame">
                <div className="phone-notch"></div>
                <div className="phone-screen" style={{ backgroundColor: primaryColor }}>
                  <div className="splash-content">
                    {logoUrl ? <img src={logoUrl} alt="Splash" className="splash-logo" /> : <i className="bi bi-shop" style={{ fontSize: '4rem', color: '#fff' }}></i>}
                    <div className="splash-name" style={{ color: '#fff' }}>{appName || 'Your Restaurant'}</div>
                  </div>
                </div>
                <div className="phone-home-indicator"></div>
              </div>
            </div>
          </Col>
        </Row>

        <div className="d-flex justify-content-between mt-4">
          <Button variant="outline-secondary" onClick={() => setStep(1)}><i className="bi bi-arrow-left me-1"></i>Back</Button>
          <Button variant="primary" onClick={() => setStep(3)} disabled={!logoUrl}>Next: Review <i className="bi bi-arrow-right ms-1"></i></Button>
        </div>
      </Card.Body>
    </Card>
  );

  // ── Step 3: Review & Publish ──
  const renderStep3 = () => (
    <Card>
      <Card.Header><i className="bi bi-rocket-takeoff me-2"></i>Review & Publish</Card.Header>
      <Card.Body>
        <Card bg="light" className="mb-4">
          <Card.Body>
            <h6><i className="bi bi-info-circle me-1"></i>App Info</h6>
            <div className="small"><strong>Name:</strong> {appName}</div>
            <div className="small"><strong>Bundle ID:</strong> <code>com.kodacarte.wl.{bundleSuffix}</code></div>
            <div className="small"><strong>Platforms:</strong> {platforms.map(p => p === 'ios' ? 'iOS' : 'Android').join(', ')}</div>
            <div className="small"><strong>Category:</strong> {CATEGORIES.find(c => c.value === category)?.label}</div>
            {keywords && <div className="small"><strong>Keywords:</strong> {keywords}</div>}
          </Card.Body>
        </Card>

        <div className="d-flex align-items-center gap-3 mb-4 p-3 bg-light rounded">
          <div className="app-icon-preview-small" style={{ backgroundColor: primaryColor }}>
            {logoUrl ? <img src={logoUrl} alt="Icon" /> : <i className="bi bi-shop" style={{ fontSize: '1.5rem', color: '#fff' }}></i>}
          </div>
          <div>
            <strong>{appName}</strong>
            <div className="small text-muted">{customIconUrl ? 'Custom icon' : 'Auto-generated from logo'}</div>
          </div>
        </div>

        <h6 className="mb-3">Requirements Checklist</h6>
        <div className="requirements-checklist mb-4">
          <ChecklistItem ok={validations.logoUploaded} label="Restaurant logo or custom icon uploaded" />
          <ChecklistItem ok={validations.appNameProvided} label="App name provided" />
          <ChecklistItem ok={validations.bundleSuffixValid} label="Bundle suffix valid and unique" />
          <ChecklistItem ok={validations.platformSelected} label="At least one platform selected" />
          <ChecklistItem ok={validations.elderPlanActive} label="Elder Plan active" />
        </div>

        {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}

        <Alert variant="info" className="small">
          <i className="bi bi-info-circle me-2"></i>
          Once you click Publish, our automated pipeline will build your app and submit it to the selected app stores.
          {platforms.includes('ios') && ' iOS App Store review typically takes 1-3 business days.'}
          {platforms.includes('android') && ' Google Play review is usually faster.'}
          {' '}You can track progress in real-time on this page.
        </Alert>

        <div className="d-flex justify-content-between">
          <Button variant="outline-secondary" onClick={() => setStep(2)}><i className="bi bi-arrow-left me-1"></i>Back</Button>
          <Button variant="success" size="lg" onClick={handlePublish} disabled={!allValid || publishing}>
            {publishing ? <><Spinner animation="border" size="sm" className="me-2" />Starting Build...</> :
              <><i className="bi bi-rocket-takeoff me-2"></i>{existingConfig?.status === 'live' ? 'Publish Update' : 'Publish App'}</>}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );

  return (
    <Container fluid className="mobile-app-page py-4">
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-phone header-icon"></i>
          <div>
            <h2>Mobile App</h2>
            <p style={{ margin: '5px 0 0', opacity: 0.9 }}>Publish your own branded mobile app</p>
          </div>
        </div>
      </div>
      <div className="mt-4">
        {renderStepIndicator()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </Container>
  );
}

function ChecklistItem({ ok, label }) {
  return (
    <div className={`checklist-item ${ok ? 'valid' : 'invalid'}`}>
      <i className={`bi bi-${ok ? 'check-circle-fill' : 'x-circle'}`}></i>
      <span>{label}</span>
    </div>
  );
}
