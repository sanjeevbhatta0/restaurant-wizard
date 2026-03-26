import React, { useState, useEffect } from 'react';
import { Container, Card, Alert, Button, Row, Col, Nav, Tab, Badge, Accordion } from 'react-bootstrap';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import './PageHeader.css';
import './WebsiteIntegration.css';

const WebsiteIntegration = () => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [copied, setCopied] = useState('');
  const [loading, setLoading] = useState(true);
  const [websitePublished, setWebsitePublished] = useState(false);
  const [restaurantSlug, setRestaurantSlug] = useState('');
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation, locations } = useLocation();

  useEffect(() => {
    const loadWebsiteConfig = async () => {
      if (!currentUser) return;
      
      setLoading(true);
      try {
        // Determine config path based on multi-location
        const configPath = isMultiLocation && selectedLocation
          ? `restaurants/${currentUser.uid}/locations/${selectedLocation}/website/config`
          : `restaurants/${currentUser.uid}/website/config`;
        
        const configDoc = await getDoc(doc(db, configPath));
        
        if (configDoc.exists()) {
          const data = configDoc.data();
          setWebsitePublished(data.isPublished || false);
          
          // Get restaurant/location data for slug
          const restaurantDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}`));
          const restaurantData = restaurantDoc.data() || {};
          
          let slug = restaurantData.slug || currentUser.uid;
          
          if (isMultiLocation && selectedLocation) {
            const locationDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}/locations/${selectedLocation}`));
            const locationData = locationDoc.data() || {};
            const locationSlug = locationData.slug || selectedLocation;
            slug = `${slug}-${locationSlug}`;
          }
          
          setRestaurantSlug(slug);
          setWebsiteUrl(`https://us-central1-restaurant-portal-6b147.cloudfunctions.net/serveWebsite?restaurant=${slug}`);
        } else {
          setWebsitePublished(false);
          setWebsiteUrl('');
        }
      } catch (error) {
        console.error('Error loading website config:', error);
      } finally {
        setLoading(false);
      }
    };

    loadWebsiteConfig();
  }, [currentUser, selectedLocation, isMultiLocation]);

  const handleCopy = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  const getLocationName = () => {
    if (!isMultiLocation) return '';
    const location = locations?.find(l => l.id === selectedLocation);
    return location?.name || '';
  };

  // Widget embed base URL
  const widgetScriptUrl = 'https://restaurant-portal-6b147.web.app/widget.js';

  // Widget embed snippets
  const getWidgetInlineCode = () => `<!-- Step 1: Add this where you want the menu/ordering to appear -->
<div id="koda-menu"></div>

<!-- Step 2: Add this before the closing </body> tag -->
<script src="${widgetScriptUrl}"></script>
<script>
  KodaCarte.init({
    restaurantId: '${restaurantSlug}',
    mode: 'inline',
    target: '#koda-menu'
  });
</script>`;

  const getWidgetFloatCode = () => `<!-- Add this before the closing </body> tag -->
<script src="${widgetScriptUrl}"></script>
<script>
  KodaCarte.init({
    restaurantId: '${restaurantSlug}',
    mode: 'float',
    buttonText: 'Order Online'
  });
</script>`;

  const getWidgetPageCode = () => `<!-- Step 1: Add this where you want the full ordering section -->
<div id="koda-ordering"></div>

<!-- Step 2: Add this before the closing </body> tag -->
<script src="${widgetScriptUrl}"></script>
<script>
  KodaCarte.init({
    restaurantId: '${restaurantSlug}',
    mode: 'page',
    target: '#koda-ordering'
  });
</script>`;

  const getWidgetWordPressCode = () => `<!-- Add to your WordPress page using a "Custom HTML" block -->
<div id="koda-menu"></div>
<script src="${widgetScriptUrl}"></script>
<script>
  KodaCarte.init({
    restaurantId: '${restaurantSlug}',
    mode: 'inline',
    target: '#koda-menu'
  });
</script>`;

  const getWidgetWixCode = () => `<!-- In Wix: Add → Embed → Custom Element → HTML iframe
     Paste this code in the "Enter Code" field: -->
<div id="koda-menu" style="width:100%;"></div>
<script src="${widgetScriptUrl}"></script>
<script>
  KodaCarte.init({
    restaurantId: '${restaurantSlug}',
    mode: 'inline',
    target: '#koda-menu'
  });
</script>`;

  const getWidgetSquarespaceCode = () => `<!-- In Squarespace: Add a "Code Block" and paste this: -->
<div id="koda-menu"></div>
<script src="${widgetScriptUrl}"></script>
<script>
  KodaCarte.init({
    restaurantId: '${restaurantSlug}',
    mode: 'inline',
    target: '#koda-menu'
  });
</script>`;

  // Code snippets for different platforms
  const getSimpleLinkHtml = () => `<a href="${websiteUrl}" target="_blank" rel="noopener noreferrer">
  Order Online
</a>`;

  const getButtonHtml = () => `<a href="${websiteUrl}" 
   target="_blank" 
   rel="noopener noreferrer"
   style="display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
  🍽️ Order Online Now
</a>`;

  const getFancyButtonHtml = () => `<style>
  .order-online-btn {
    display: inline-block;
    padding: 16px 32px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    text-decoration: none;
    border-radius: 50px;
    font-weight: bold;
    font-size: 18px;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    transition: all 0.3s ease;
  }
  .order-online-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
    color: white;
  }
</style>
<a href="${websiteUrl}" target="_blank" rel="noopener noreferrer" class="order-online-btn">
  🍽️ Order Online
</a>`;

  const getFloatingButtonHtml = () => `<style>
  .floating-order-btn {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 16px 24px;
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
    color: white;
    text-decoration: none;
    border-radius: 50px;
    font-weight: bold;
    font-size: 16px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 9999;
    animation: pulse 2s infinite;
  }
  .floating-order-btn:hover {
    transform: scale(1.05);
    color: white;
  }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 4px 20px rgba(238, 90, 36, 0.4); }
    50% { box-shadow: 0 4px 30px rgba(238, 90, 36, 0.8); }
  }
</style>
<a href="${websiteUrl}" target="_blank" rel="noopener noreferrer" class="floating-order-btn">
  🛒 Order Now
</a>`;

  const getWordPressShortcode = () => `<!-- Add this to your WordPress page/post using the "Custom HTML" block -->
<div style="text-align: center; margin: 20px 0;">
  <a href="${websiteUrl}" 
     target="_blank" 
     rel="noopener noreferrer"
     style="display: inline-block; padding: 15px 30px; background-color: #28a745; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
    Order Online
  </a>
</div>`;

  const getSquarespaceCode = () => `<!-- Add this using a "Code Block" in Squarespace -->
<div style="text-align: center; padding: 30px 0;">
  <a href="${websiteUrl}" 
     target="_blank"
     style="display: inline-block; padding: 18px 36px; background: #000; color: #fff; text-decoration: none; font-family: inherit; font-size: 14px; letter-spacing: 2px; text-transform: uppercase;">
    Order Online →
  </a>
</div>`;

  const getWixCode = () => `<!-- In Wix, you can:
1. Add a Button element
2. Set the link to: ${websiteUrl}
3. Enable "Open in new tab"

Or use the HTML embed widget with this code: -->
<a href="${websiteUrl}" 
   target="_blank"
   style="display: inline-block; padding: 15px 30px; background: #3899ec; color: white; text-decoration: none; border-radius: 25px; font-weight: bold;">
  Order Online
</a>`;

  if (loading) {
    return (
      <Container className="py-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-4 website-integration-container">
      {/* Page Header */}
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-link-45deg header-icon"></i>
          <div>
            <h2>Website Integration</h2>
            <p>Add online ordering to your existing website</p>
          </div>
        </div>
      </div>

      {/* Multi-location notice */}
      {isMultiLocation && (
        <Alert variant="info" className="mb-4">
          <i className="bi bi-geo-alt-fill me-2"></i>
          <strong>Multi-Location:</strong> You're viewing integration options for <strong>{getLocationName()}</strong>. 
          Use the location dropdown in the header to switch locations.
        </Alert>
      )}

      {/* Website Status */}
      {!websitePublished ? (
        <Alert variant="warning" className="mb-4">
          <Alert.Heading>
            <i className="bi bi-exclamation-triangle me-2"></i>
            Website Not Published Yet
          </Alert.Heading>
          <p className="mb-0">
            You need to create and publish your website first before you can integrate it with your existing site.
          </p>
          <hr />
          <Button variant="warning" href="/website-builder">
            <i className="bi bi-tools me-2"></i>
            Go to Website Builder
          </Button>
        </Alert>
      ) : (
        <>
          {/* Your Website URL */}
          <Card className="mb-4 url-card">
            <Card.Header className="bg-success text-white">
              <h5 className="mb-0">
                <i className="bi bi-check-circle-fill me-2"></i>
                Your Online Ordering Website
              </h5>
            </Card.Header>
            <Card.Body>
              <p className="text-muted mb-3">
                This is your unique online ordering website URL. Share it with customers or integrate it into your existing website.
              </p>
              <div className="url-box d-flex align-items-center">
                <code className="flex-grow-1 p-3 bg-light rounded-start">{websiteUrl}</code>
                <Button 
                  variant={copied === 'url' ? 'success' : 'primary'}
                  className="rounded-end rounded-start-0"
                  onClick={() => handleCopy(websiteUrl, 'url')}
                >
                  {copied === 'url' ? <><i className="bi bi-check"></i> Copied!</> : <><i className="bi bi-clipboard"></i> Copy</>}
                </Button>
              </div>
              <div className="mt-3">
                <Button variant="outline-primary" href={websiteUrl} target="_blank" rel="noopener noreferrer">
                  <i className="bi bi-box-arrow-up-right me-2"></i>
                  Open Website
                </Button>
              </div>
            </Card.Body>
          </Card>

          {/* ============================================ */}
          {/* WIDGET INTEGRATION — Full Embed (No Redirect) */}
          {/* ============================================ */}
          <Card className="mb-4 border-primary">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">
                <i className="bi bi-window-stack me-2"></i>
                Widget Integration — Embed Directly In Your Website
                <Badge bg="warning" text="dark" className="ms-2">Recommended</Badge>
              </h5>
            </Card.Header>
            <Card.Body>
              <Alert variant="info" className="mb-4">
                <Alert.Heading style={{fontSize: '1rem'}}>
                  <i className="bi bi-stars me-2"></i>
                  What does this do?
                </Alert.Heading>
                <p className="mb-0">
                  This embeds your <strong>full menu, online ordering, customer accounts, promotions, and rewards</strong> directly
                  inside your existing website. Your customers <strong>never leave your website</strong> — everything happens right there.
                  No pop-ups to a different URL, no redirects. It looks and feels like part of your own site.
                </p>
              </Alert>

              <Tab.Container defaultActiveKey="widget-inline">
                <Row>
                  <Col md={3}>
                    <Nav variant="pills" className="flex-column integration-nav">
                      <Nav.Item>
                        <Nav.Link eventKey="widget-inline">
                          <i className="bi bi-layout-text-window me-2"></i>Inline Embed
                          <small className="d-block text-muted mt-1" style={{fontSize: '0.7rem'}}>Best for most websites</small>
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="widget-float">
                          <i className="bi bi-chat-square-dots me-2"></i>Floating Button
                          <small className="d-block text-muted mt-1" style={{fontSize: '0.7rem'}}>Always-visible button</small>
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="widget-page">
                          <i className="bi bi-fullscreen me-2"></i>Full Page Section
                          <small className="d-block text-muted mt-1" style={{fontSize: '0.7rem'}}>Dedicated ordering page</small>
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="widget-platforms">
                          <i className="bi bi-laptop me-2"></i>Platform Guides
                          <small className="d-block text-muted mt-1" style={{fontSize: '0.7rem'}}>WordPress, Wix, etc.</small>
                        </Nav.Link>
                      </Nav.Item>
                    </Nav>
                  </Col>
                  <Col md={9}>
                    <Tab.Content>
                      {/* ---- INLINE EMBED ---- */}
                      <Tab.Pane eventKey="widget-inline">
                        <h5><i className="bi bi-layout-text-window me-2"></i>Inline Embed</h5>
                        <p className="text-muted">
                          Embeds the full ordering experience directly into a section of your page.
                          Great for adding a "Menu" or "Order Online" section to your existing website.
                        </p>
                        <Alert variant="success" className="mb-3">
                          <strong>How it works:</strong> You place a small container (<code>&lt;div&gt;</code>) anywhere on your page,
                          and the widget fills it with your menu, cart, checkout, and customer account features.
                        </Alert>

                        <h6 className="mt-4 mb-3">Step-by-step instructions:</h6>
                        <ol className="instruction-list">
                          <li>
                            <strong>Open your website's HTML file</strong>
                            <p className="text-muted">This is the page where you want the menu and ordering to appear (e.g., your "Menu" page or "Order Online" page).</p>
                          </li>
                          <li>
                            <strong>Find the spot where you want the menu to show up</strong>
                            <p className="text-muted">Look for the section in your HTML where you'd like the ordering widget to appear. This could be below your header, in a main content area, etc.</p>
                          </li>
                          <li>
                            <strong>Copy and paste this code:</strong>
                            <div className="code-box mt-2">
                              <div className="d-flex justify-content-end mb-2">
                                <Button size="sm" variant={copied === 'widget-inline' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWidgetInlineCode(), 'widget-inline')}>
                                  {copied === 'widget-inline' ? 'Copied!' : 'Copy Code'}
                                </Button>
                              </div>
                              <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '12px', maxHeight: '250px', overflow: 'auto'}}><code>{getWidgetInlineCode()}</code></pre>
                            </div>
                          </li>
                          <li>
                            <strong>Save and publish your page</strong>
                            <p className="text-muted">That's it! Your customers can now browse your menu, add items to cart, create accounts, and place orders — all without leaving your website.</p>
                          </li>
                        </ol>
                      </Tab.Pane>

                      {/* ---- FLOATING BUTTON ---- */}
                      <Tab.Pane eventKey="widget-float">
                        <h5><i className="bi bi-chat-square-dots me-2"></i>Floating Button</h5>
                        <p className="text-muted">
                          Adds a floating "Order Online" button in the corner of your website that stays visible as visitors scroll.
                          When clicked, it opens a side panel with the full ordering experience.
                        </p>
                        <Alert variant="info" className="mb-3">
                          <strong>Best for:</strong> Websites where you want ordering available on <em>every</em> page
                          without changing your page layout. The button floats in the bottom-right corner.
                        </Alert>

                        <h6 className="mt-4 mb-3">Step-by-step instructions:</h6>
                        <ol className="instruction-list">
                          <li>
                            <strong>Open your website's HTML file</strong>
                            <p className="text-muted">You only need to add this once — it will appear on the page where you add it.</p>
                          </li>
                          <li>
                            <strong>Paste this code just before the closing <code>&lt;/body&gt;</code> tag:</strong>
                            <div className="code-box mt-2">
                              <div className="d-flex justify-content-end mb-2">
                                <Button size="sm" variant={copied === 'widget-float' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWidgetFloatCode(), 'widget-float')}>
                                  {copied === 'widget-float' ? 'Copied!' : 'Copy Code'}
                                </Button>
                              </div>
                              <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '12px'}}><code>{getWidgetFloatCode()}</code></pre>
                            </div>
                          </li>
                          <li>
                            <strong>Save and publish</strong>
                            <p className="text-muted">A floating button will appear on your page. Customers click it to browse your menu and order.</p>
                          </li>
                        </ol>

                        <Alert variant="secondary" className="mt-3">
                          <strong>Tip:</strong> You can customize the button text by changing <code>buttonText: 'Order Online'</code> to whatever you'd like —
                          for example, <code>'View Menu'</code> or <code>'Order Now'</code>.
                        </Alert>
                      </Tab.Pane>

                      {/* ---- FULL PAGE SECTION ---- */}
                      <Tab.Pane eventKey="widget-page">
                        <h5><i className="bi bi-fullscreen me-2"></i>Full Page Section</h5>
                        <p className="text-muted">
                          Creates a full-width ordering section that spans your entire page.
                          Ideal for a dedicated "Order Online" page on your website.
                        </p>

                        <h6 className="mt-4 mb-3">Step-by-step instructions:</h6>
                        <ol className="instruction-list">
                          <li>
                            <strong>Create a new page on your website</strong> (or use an existing one)
                            <p className="text-muted">Name it "Order Online", "Menu", or whatever fits your site.</p>
                          </li>
                          <li>
                            <strong>Paste this code into the page:</strong>
                            <div className="code-box mt-2">
                              <div className="d-flex justify-content-end mb-2">
                                <Button size="sm" variant={copied === 'widget-page' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWidgetPageCode(), 'widget-page')}>
                                  {copied === 'widget-page' ? 'Copied!' : 'Copy Code'}
                                </Button>
                              </div>
                              <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '12px', maxHeight: '250px', overflow: 'auto'}}><code>{getWidgetPageCode()}</code></pre>
                            </div>
                          </li>
                          <li>
                            <strong>Save and publish</strong>
                            <p className="text-muted">The widget will fill the entire width of that section with your menu and ordering system.</p>
                          </li>
                        </ol>
                      </Tab.Pane>

                      {/* ---- PLATFORM GUIDES ---- */}
                      <Tab.Pane eventKey="widget-platforms">
                        <h5><i className="bi bi-laptop me-2"></i>Platform-Specific Guides</h5>
                        <p className="text-muted mb-4">
                          Select your website platform for step-by-step instructions on embedding the widget.
                        </p>

                        <Accordion>
                          {/* WordPress */}
                          <Accordion.Item eventKey="wp">
                            <Accordion.Header>
                              <img src="https://s.w.org/style/images/about/WordPress-logotype-wmark.png" alt="WordPress" style={{height: '24px', marginRight: '10px'}} />
                              WordPress
                            </Accordion.Header>
                            <Accordion.Body>
                              <ol className="instruction-list">
                                <li><strong>Log in to your WordPress admin panel</strong> (yourdomain.com/wp-admin)</li>
                                <li><strong>Go to</strong> Pages &rarr; Add New (or edit an existing page like "Menu" or "Order Online")</li>
                                <li><strong>Click the + button</strong> and search for <strong>"Custom HTML"</strong> block</li>
                                <li>
                                  <strong>Paste this code into the HTML block:</strong>
                                  <div className="code-box mt-2">
                                    <div className="d-flex justify-content-end mb-2">
                                      <Button size="sm" variant={copied === 'widget-wp' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWidgetWordPressCode(), 'widget-wp')}>
                                        {copied === 'widget-wp' ? 'Copied!' : 'Copy'}
                                      </Button>
                                    </div>
                                    <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px'}}><code>{getWidgetWordPressCode()}</code></pre>
                                  </div>
                                </li>
                                <li><strong>Click "Publish"</strong> or "Update" to save your page</li>
                                <li><strong>Visit the page</strong> — you should see your full menu and ordering system embedded right there!</li>
                              </ol>
                              <Alert variant="info" className="mt-3">
                                <strong>Note:</strong> Some WordPress themes may block external scripts. If the widget doesn't load,
                                try adding the code through your theme's footer (Appearance &rarr; Theme File Editor &rarr; footer.php) or use a
                                plugin like "Insert Headers and Footers" to add the script tag.
                              </Alert>
                            </Accordion.Body>
                          </Accordion.Item>

                          {/* Squarespace */}
                          <Accordion.Item eventKey="ss">
                            <Accordion.Header>
                              <i className="bi bi-square-fill me-2"></i>
                              Squarespace
                            </Accordion.Header>
                            <Accordion.Body>
                              <ol className="instruction-list">
                                <li><strong>Log in to Squarespace</strong> and edit your site</li>
                                <li><strong>Go to the page</strong> where you want the ordering widget (or create a new page)</li>
                                <li><strong>Click the + button</strong> to add a block, then select <strong>"Code"</strong> (under "More")</li>
                                <li>
                                  <strong>Paste this code:</strong>
                                  <div className="code-box mt-2">
                                    <div className="d-flex justify-content-end mb-2">
                                      <Button size="sm" variant={copied === 'widget-ss' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWidgetSquarespaceCode(), 'widget-ss')}>
                                        {copied === 'widget-ss' ? 'Copied!' : 'Copy'}
                                      </Button>
                                    </div>
                                    <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px'}}><code>{getWidgetSquarespaceCode()}</code></pre>
                                  </div>
                                </li>
                                <li><strong>Make sure</strong> the "Display Source" toggle is <strong>OFF</strong></li>
                                <li><strong>Click "Apply"</strong> and save your page</li>
                              </ol>
                              <Alert variant="warning" className="mt-3">
                                <strong>Important:</strong> Squarespace's free plan may not support code injection.
                                You need a Business plan or higher to use custom code blocks.
                              </Alert>
                            </Accordion.Body>
                          </Accordion.Item>

                          {/* Wix */}
                          <Accordion.Item eventKey="wix">
                            <Accordion.Header>
                              <i className="bi bi-box me-2"></i>
                              Wix
                            </Accordion.Header>
                            <Accordion.Body>
                              <ol className="instruction-list">
                                <li><strong>Open the Wix Editor</strong> for your site</li>
                                <li><strong>Navigate</strong> to the page where you want the ordering widget</li>
                                <li><strong>Click Add (+)</strong> &rarr; <strong>Embed Code</strong> &rarr; <strong>Embed HTML</strong></li>
                                <li>
                                  <strong>Click "Enter Code"</strong> and paste this:
                                  <div className="code-box mt-2">
                                    <div className="d-flex justify-content-end mb-2">
                                      <Button size="sm" variant={copied === 'widget-wix' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWidgetWixCode(), 'widget-wix')}>
                                        {copied === 'widget-wix' ? 'Copied!' : 'Copy'}
                                      </Button>
                                    </div>
                                    <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px'}}><code>{getWidgetWixCode()}</code></pre>
                                  </div>
                                </li>
                                <li><strong>Resize the HTML element</strong> to fill the width of your page and set a good height (we recommend at least 600px)</li>
                                <li><strong>Publish</strong> your site</li>
                              </ol>
                            </Accordion.Body>
                          </Accordion.Item>

                          {/* GoDaddy */}
                          <Accordion.Item eventKey="gd">
                            <Accordion.Header>
                              <i className="bi bi-globe me-2"></i>
                              GoDaddy Website Builder
                            </Accordion.Header>
                            <Accordion.Body>
                              <ol className="instruction-list">
                                <li><strong>Log in to GoDaddy</strong> and open your website builder</li>
                                <li><strong>Edit the page</strong> where you want the widget</li>
                                <li><strong>Add a section</strong> &rarr; choose <strong>"HTML"</strong> or <strong>"Embed"</strong></li>
                                <li><strong>Paste the Inline Embed code</strong> from the "Inline Embed" tab above</li>
                                <li><strong>Publish</strong> your changes</li>
                              </ol>
                            </Accordion.Body>
                          </Accordion.Item>

                          {/* Custom HTML */}
                          <Accordion.Item eventKey="html">
                            <Accordion.Header>
                              <i className="bi bi-code-slash me-2"></i>
                              Custom HTML Website
                            </Accordion.Header>
                            <Accordion.Body>
                              <ol className="instruction-list">
                                <li><strong>Open your HTML file</strong> in your code editor (VS Code, Sublime, etc.)</li>
                                <li><strong>Pick a mode</strong> from the tabs above (Inline, Floating Button, or Full Page)</li>
                                <li><strong>Copy the code snippet</strong> and paste it into your HTML file</li>
                                <li><strong>Upload your updated file</strong> to your hosting provider (via FTP, cPanel, Netlify, Vercel, etc.)</li>
                              </ol>
                              <Alert variant="success" className="mt-3">
                                <strong>Developer tip:</strong> You can listen for events from the widget by passing callback functions:
                                <pre className="bg-dark text-light p-2 rounded mt-2" style={{fontSize: '11px'}}><code>{`KodaCarte.init({
  restaurantId: '${restaurantSlug}',
  mode: 'inline',
  target: '#koda-menu',
  onOrderPlaced: function(data) {
    console.log('Order placed!', data);
  },
  onCartUpdate: function(data) {
    console.log('Cart updated:', data);
  },
  onReady: function() {
    console.log('Widget loaded!');
  }
});`}</code></pre>
                              </Alert>
                            </Accordion.Body>
                          </Accordion.Item>
                        </Accordion>
                      </Tab.Pane>
                    </Tab.Content>
                  </Col>
                </Row>
              </Tab.Container>

              {/* What's Included */}
              <div className="mt-4 p-3 bg-light rounded">
                <h6 className="mb-3"><i className="bi bi-check2-all me-2 text-success"></i>Everything included in the widget:</h6>
                <Row>
                  <Col md={4}>
                    <ul className="list-unstyled mb-0">
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Full menu browsing</li>
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Add to cart &amp; checkout</li>
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Online ordering</li>
                    </ul>
                  </Col>
                  <Col md={4}>
                    <ul className="list-unstyled mb-0">
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Customer sign up / sign in</li>
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Order history &amp; tracking</li>
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Promotions &amp; promo codes</li>
                    </ul>
                  </Col>
                  <Col md={4}>
                    <ul className="list-unstyled mb-0">
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Loyalty rewards &amp; points</li>
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Spin wheel prizes</li>
                      <li className="mb-2"><i className="bi bi-check-circle text-success me-2"></i>Mobile responsive</li>
                    </ul>
                  </Col>
                </Row>
              </div>
            </Card.Body>
          </Card>

          {/* Integration Options (existing link/button options) */}
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">
                <i className="bi bi-code-slash me-2"></i>
                Simple Link &amp; Button Options
                <small className="text-muted ms-2" style={{fontSize: '0.75rem'}}>(redirects to your Koda Carte website)</small>
              </h5>
            </Card.Header>
            <Card.Body>
              <p className="text-muted mb-4">
                These options add a simple link or button that opens your Koda Carte website in a new tab. Use these if you just want a quick "Order Online" button.
              </p>

              <Tab.Container defaultActiveKey="simple-link">
                <Row>
                  <Col md={3}>
                    <Nav variant="pills" className="flex-column integration-nav">
                      <Nav.Item>
                        <Nav.Link eventKey="simple-link">
                          <i className="bi bi-link me-2"></i>Simple Link
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="button">
                          <i className="bi bi-square me-2"></i>Button
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="fancy-button">
                          <i className="bi bi-stars me-2"></i>Fancy Button
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="floating">
                          <i className="bi bi-pin-angle me-2"></i>Floating Button
                        </Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="qr-code">
                          <i className="bi bi-qr-code me-2"></i>QR Code
                        </Nav.Link>
                      </Nav.Item>
                    </Nav>
                  </Col>
                  <Col md={9}>
                    <Tab.Content>
                      {/* Simple Link */}
                      <Tab.Pane eventKey="simple-link">
                        <h5>Simple Link</h5>
                        <p className="text-muted">A basic text link that blends with your website content.</p>
                        <div className="preview-box mb-3">
                          <small className="text-muted">Preview:</small>
                          <div className="p-3 bg-white border rounded mt-1">
                            <a href={websiteUrl} target="_blank" rel="noopener noreferrer">Order Online</a>
                          </div>
                        </div>
                        <div className="code-box">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <small className="text-muted">HTML Code:</small>
                            <Button size="sm" variant={copied === 'simple' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getSimpleLinkHtml(), 'simple')}>
                              {copied === 'simple' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded"><code>{getSimpleLinkHtml()}</code></pre>
                        </div>
                      </Tab.Pane>

                      {/* Button */}
                      <Tab.Pane eventKey="button">
                        <h5>Simple Button</h5>
                        <p className="text-muted">A clean, visible button for your menu or navigation.</p>
                        <div className="preview-box mb-3">
                          <small className="text-muted">Preview:</small>
                          <div className="p-3 bg-white border rounded mt-1">
                            <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
                               style={{display: 'inline-block', padding: '12px 24px', backgroundColor: '#28a745', color: 'white', textDecoration: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px'}}>
                              🍽️ Order Online Now
                            </a>
                          </div>
                        </div>
                        <div className="code-box">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <small className="text-muted">HTML Code:</small>
                            <Button size="sm" variant={copied === 'button' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getButtonHtml(), 'button')}>
                              {copied === 'button' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '12px'}}><code>{getButtonHtml()}</code></pre>
                        </div>
                      </Tab.Pane>

                      {/* Fancy Button */}
                      <Tab.Pane eventKey="fancy-button">
                        <h5>Fancy Gradient Button</h5>
                        <p className="text-muted">An eye-catching button with gradient and hover effects.</p>
                        <div className="preview-box mb-3">
                          <small className="text-muted">Preview:</small>
                          <div className="p-3 bg-white border rounded mt-1">
                            <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
                               style={{display: 'inline-block', padding: '16px 32px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', textDecoration: 'none', borderRadius: '50px', fontWeight: 'bold', fontSize: '18px', boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)'}}>
                              🍽️ Order Online
                            </a>
                          </div>
                        </div>
                        <div className="code-box">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <small className="text-muted">HTML + CSS Code:</small>
                            <Button size="sm" variant={copied === 'fancy' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getFancyButtonHtml(), 'fancy')}>
                              {copied === 'fancy' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px', maxHeight: '200px', overflow: 'auto'}}><code>{getFancyButtonHtml()}</code></pre>
                        </div>
                      </Tab.Pane>

                      {/* Floating Button */}
                      <Tab.Pane eventKey="floating">
                        <h5>Floating Order Button</h5>
                        <p className="text-muted">A fixed button that stays visible as visitors scroll your page.</p>
                        <Alert variant="info" className="mb-3">
                          <i className="bi bi-info-circle me-2"></i>
                          This button will appear in the bottom-right corner of your website, always visible to visitors.
                        </Alert>
                        <div className="preview-box mb-3">
                          <small className="text-muted">Preview (simulated position):</small>
                          <div className="p-3 bg-light border rounded mt-1 position-relative" style={{height: '120px'}}>
                            <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
                               style={{position: 'absolute', bottom: '15px', right: '15px', padding: '16px 24px', background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%)', color: 'white', textDecoration: 'none', borderRadius: '50px', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)'}}>
                              🛒 Order Now
                            </a>
                          </div>
                        </div>
                        <div className="code-box">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <small className="text-muted">HTML + CSS Code:</small>
                            <Button size="sm" variant={copied === 'floating' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getFloatingButtonHtml(), 'floating')}>
                              {copied === 'floating' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px', maxHeight: '200px', overflow: 'auto'}}><code>{getFloatingButtonHtml()}</code></pre>
                        </div>
                      </Tab.Pane>

                      {/* QR Code */}
                      <Tab.Pane eventKey="qr-code">
                        <h5>QR Code</h5>
                        <p className="text-muted">Generate a QR code for table tents, flyers, or business cards.</p>
                        <div className="text-center p-4 bg-white border rounded mb-3">
                          <img 
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(websiteUrl)}`}
                            alt="QR Code for online ordering"
                            className="mb-3"
                          />
                          <div>
                            <Button 
                              variant="outline-primary" 
                              href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(websiteUrl)}&format=png`}
                              download="online-ordering-qr.png"
                              target="_blank"
                            >
                              <i className="bi bi-download me-2"></i>
                              Download QR Code
                            </Button>
                          </div>
                        </div>
                        <Alert variant="success">
                          <strong>💡 Pro Tip:</strong> Print this QR code on table tents, receipts, or takeout bags so customers can easily reorder!
                        </Alert>
                      </Tab.Pane>
                    </Tab.Content>
                  </Col>
                </Row>
              </Tab.Container>
            </Card.Body>
          </Card>

          {/* Platform-Specific Instructions */}
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">
                <i className="bi bi-laptop me-2"></i>
                Platform-Specific Instructions
              </h5>
            </Card.Header>
            <Card.Body>
              <p className="text-muted mb-4">
                Select your website platform for step-by-step instructions:
              </p>

              <Accordion defaultActiveKey="0">
                {/* WordPress */}
                <Accordion.Item eventKey="0">
                  <Accordion.Header>
                    <img src="https://s.w.org/style/images/about/WordPress-logotype-wmark.png" alt="WordPress" style={{height: '24px', marginRight: '10px'}} />
                    WordPress
                  </Accordion.Header>
                  <Accordion.Body>
                    <ol className="instruction-list">
                      <li>
                        <strong>Log in to your WordPress admin panel</strong>
                        <p className="text-muted">Go to yourdomain.com/wp-admin and sign in</p>
                      </li>
                      <li>
                        <strong>Navigate to the page where you want to add the button</strong>
                        <p className="text-muted">Pages → All Pages → Edit your page</p>
                      </li>
                      <li>
                        <strong>Add a Custom HTML block</strong>
                        <p className="text-muted">Click the + button and search for "Custom HTML"</p>
                      </li>
                      <li>
                        <strong>Paste the code below:</strong>
                        <div className="code-box mt-2">
                          <div className="d-flex justify-content-end mb-2">
                            <Button size="sm" variant={copied === 'wordpress' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWordPressShortcode(), 'wordpress')}>
                              {copied === 'wordpress' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px'}}><code>{getWordPressShortcode()}</code></pre>
                        </div>
                      </li>
                      <li>
                        <strong>Click "Update" or "Publish"</strong>
                        <p className="text-muted">Your online ordering button is now live!</p>
                      </li>
                    </ol>
                    <Alert variant="info" className="mt-3">
                      <strong>Alternative:</strong> You can also add this as a menu item. Go to Appearance → Menus, add a Custom Link with your URL, and save.
                    </Alert>
                  </Accordion.Body>
                </Accordion.Item>

                {/* Squarespace */}
                <Accordion.Item eventKey="1">
                  <Accordion.Header>
                    <i className="bi bi-square-fill me-2"></i>
                    Squarespace
                  </Accordion.Header>
                  <Accordion.Body>
                    <ol className="instruction-list">
                      <li>
                        <strong>Log in to your Squarespace account</strong>
                        <p className="text-muted">Go to squarespace.com and sign in</p>
                      </li>
                      <li>
                        <strong>Edit the page where you want the button</strong>
                        <p className="text-muted">Click "Edit" on the page</p>
                      </li>
                      <li>
                        <strong>Add a Code Block</strong>
                        <p className="text-muted">Click + → Code (under "More")</p>
                      </li>
                      <li>
                        <strong>Paste the code below:</strong>
                        <div className="code-box mt-2">
                          <div className="d-flex justify-content-end mb-2">
                            <Button size="sm" variant={copied === 'squarespace' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getSquarespaceCode(), 'squarespace')}>
                              {copied === 'squarespace' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px'}}><code>{getSquarespaceCode()}</code></pre>
                        </div>
                      </li>
                      <li>
                        <strong>Click "Apply" and save your page</strong>
                      </li>
                    </ol>
                  </Accordion.Body>
                </Accordion.Item>

                {/* Wix */}
                <Accordion.Item eventKey="2">
                  <Accordion.Header>
                    <i className="bi bi-box me-2"></i>
                    Wix
                  </Accordion.Header>
                  <Accordion.Body>
                    <ol className="instruction-list">
                      <li>
                        <strong>Open your Wix Editor</strong>
                        <p className="text-muted">Go to wix.com and edit your site</p>
                      </li>
                      <li>
                        <strong>Option A: Add a Button</strong>
                        <p className="text-muted">Add → Button → Choose a style</p>
                        <ul>
                          <li>Click on the button to edit</li>
                          <li>Click "Link" icon</li>
                          <li>Select "Web Address"</li>
                          <li>Paste: <code>{websiteUrl}</code></li>
                          <li>Check "Open in a new tab"</li>
                        </ul>
                      </li>
                      <li>
                        <strong>Option B: Use HTML Embed</strong>
                        <p className="text-muted">Add → Embed → HTML iframe → "Enter Code"</p>
                        <div className="code-box mt-2">
                          <div className="d-flex justify-content-end mb-2">
                            <Button size="sm" variant={copied === 'wix' ? 'success' : 'outline-secondary'} onClick={() => handleCopy(getWixCode(), 'wix')}>
                              {copied === 'wix' ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                          <pre className="bg-dark text-light p-3 rounded" style={{fontSize: '11px'}}><code>{getWixCode()}</code></pre>
                        </div>
                      </li>
                      <li>
                        <strong>Publish your site</strong>
                      </li>
                    </ol>
                  </Accordion.Body>
                </Accordion.Item>

                {/* GoDaddy */}
                <Accordion.Item eventKey="3">
                  <Accordion.Header>
                    <i className="bi bi-globe me-2"></i>
                    GoDaddy Website Builder
                  </Accordion.Header>
                  <Accordion.Body>
                    <ol className="instruction-list">
                      <li>
                        <strong>Log in to GoDaddy</strong>
                        <p className="text-muted">Go to godaddy.com and access your website builder</p>
                      </li>
                      <li>
                        <strong>Edit your page</strong>
                        <p className="text-muted">Navigate to the page where you want the button</p>
                      </li>
                      <li>
                        <strong>Add a Button section</strong>
                        <p className="text-muted">Click + to add a section, choose "Button"</p>
                      </li>
                      <li>
                        <strong>Configure the button</strong>
                        <ul>
                          <li>Text: "Order Online"</li>
                          <li>Link: <code>{websiteUrl}</code></li>
                          <li>Enable "Open in new window"</li>
                        </ul>
                      </li>
                      <li>
                        <strong>Publish your changes</strong>
                      </li>
                    </ol>
                  </Accordion.Body>
                </Accordion.Item>

                {/* Custom HTML Website */}
                <Accordion.Item eventKey="4">
                  <Accordion.Header>
                    <i className="bi bi-code-slash me-2"></i>
                    Custom HTML Website
                  </Accordion.Header>
                  <Accordion.Body>
                    <p>If you have a custom-built website, you can add any of the code snippets from the "Integration Options" section above directly into your HTML.</p>
                    <ol className="instruction-list">
                      <li>
                        <strong>Open your HTML file</strong>
                        <p className="text-muted">Use your code editor (VS Code, Sublime, etc.)</p>
                      </li>
                      <li>
                        <strong>Find where you want the button</strong>
                        <p className="text-muted">Usually in the header, navigation, or a prominent section</p>
                      </li>
                      <li>
                        <strong>Paste the code</strong>
                        <p className="text-muted">Choose from Simple Link, Button, or Floating Button above</p>
                      </li>
                      <li>
                        <strong>Upload your updated file</strong>
                        <p className="text-muted">Via FTP, cPanel, or your hosting control panel</p>
                      </li>
                    </ol>
                  </Accordion.Body>
                </Accordion.Item>

                {/* Google Business */}
                <Accordion.Item eventKey="5">
                  <Accordion.Header>
                    <i className="bi bi-google me-2"></i>
                    Google Business Profile
                  </Accordion.Header>
                  <Accordion.Body>
                    <ol className="instruction-list">
                      <li>
                        <strong>Go to Google Business Profile</strong>
                        <p className="text-muted">Visit business.google.com and sign in</p>
                      </li>
                      <li>
                        <strong>Select your restaurant</strong>
                      </li>
                      <li>
                        <strong>Click "Edit profile" → "Website"</strong>
                        <p className="text-muted">Or look for "Add website" button</p>
                      </li>
                      <li>
                        <strong>Add your ordering link</strong>
                        <p className="text-muted">Paste: <code>{websiteUrl}</code></p>
                      </li>
                      <li>
                        <strong>Add Order Online link (if available)</strong>
                        <p className="text-muted">Some business profiles have a dedicated "Order food" link option</p>
                      </li>
                    </ol>
                    <Alert variant="success">
                      <strong>🎯 Important:</strong> Adding your ordering link to Google Business helps customers find you when they search!
                    </Alert>
                  </Accordion.Body>
                </Accordion.Item>
              </Accordion>
            </Card.Body>
          </Card>

          {/* Best Practices */}
          <Card className="mb-4">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">
                <i className="bi bi-lightbulb me-2"></i>
                Best Practices & Tips
              </h5>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={6}>
                  <div className="tip-card mb-3">
                    <h6><i className="bi bi-geo-alt text-primary me-2"></i>Prominent Placement</h6>
                    <p className="text-muted small mb-0">
                      Place your "Order Online" button in your header, navigation menu, or as a floating button for maximum visibility.
                    </p>
                  </div>
                  <div className="tip-card mb-3">
                    <h6><i className="bi bi-phone text-primary me-2"></i>Mobile-Friendly</h6>
                    <p className="text-muted small mb-0">
                      All our buttons are mobile-responsive. Test on your phone to ensure customers have a smooth experience.
                    </p>
                  </div>
                  <div className="tip-card mb-3">
                    <h6><i className="bi bi-share text-primary me-2"></i>Share on Social Media</h6>
                    <p className="text-muted small mb-0">
                      Add your ordering link to your Instagram bio, Facebook page, and all social profiles.
                    </p>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="tip-card mb-3">
                    <h6><i className="bi bi-card-image text-primary me-2"></i>Use QR Codes</h6>
                    <p className="text-muted small mb-0">
                      Print QR codes on table tents, receipts, takeout bags, and business cards for easy mobile access.
                    </p>
                  </div>
                  <div className="tip-card mb-3">
                    <h6><i className="bi bi-graph-up text-primary me-2"></i>Track Performance</h6>
                    <p className="text-muted small mb-0">
                      Monitor your orders in the Dashboard to see how online ordering is growing.
                    </p>
                  </div>
                  <div className="tip-card mb-3">
                    <h6><i className="bi bi-arrow-repeat text-primary me-2"></i>Keep Menu Updated</h6>
                    <p className="text-muted small mb-0">
                      Your online menu syncs automatically with Menu Management. Keep it current with prices and availability.
                    </p>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          {/* Need Help */}
          <Card className="border-primary">
            <Card.Body className="text-center py-4">
              <i className="bi bi-headset display-4 text-primary mb-3"></i>
              <h5>Need Help?</h5>
              <p className="text-muted">
                If you need assistance integrating online ordering into your website, our support team is here to help.
              </p>
              <Button variant="primary" href="mailto:support@restaurantwizard.com">
                <i className="bi bi-envelope me-2"></i>
                Contact Support
              </Button>
            </Card.Body>
          </Card>
        </>
      )}
    </Container>
  );
};

export default WebsiteIntegration;
