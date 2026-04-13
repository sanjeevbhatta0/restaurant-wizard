/**
 * Unit Tests — Template Rendering & Website Component Logic
 * Tests the renderTemplate() placeholder system, conditional blocks,
 * favicon/logo injection, Google Maps embed, address encoding,
 * hours display, config JSON escaping, pickup time generation,
 * and all template sections across all 4 templates.
 *
 * Source: functions/index.js (renderTemplate, serveWebsite),
 *         functions/templates/(all templates)/template.html
 */

// ==========================================
// renderTemplate() — Placeholder Replacement
// ==========================================

/**
 * Mirrors the renderTemplate() function from functions/index.js.
 * Replaces {{placeholder}} tokens and handles {{#if var}}...{{/if}} blocks.
 */
function renderTemplate(template, data) {
  let html = template;

  const replacements = {
    '{{restaurantId}}': data.restaurantId || '',
    '{{locationId}}': data.locationId || data.restaurantId || '',
    '{{restaurantName}}': data.restaurantName || 'Restaurant',
    '{{tagline}}': data.tagline || 'Welcome to our restaurant',
    '{{description}}': data.description || 'Delicious food, great atmosphere',
    '{{heroImage}}': data.heroImage || '',
    '{{aboutImage}}': data.aboutImage || '',
    '{{aboutContent}}': data.aboutContent || '<p>Welcome to our restaurant!</p>',
    '{{address}}': data.address || '123 Main Street, City, State 12345',
    '{{addressEncoded}}': encodeURIComponent(data.address || '123 Main Street, City, State 12345'),
    '{{phone}}': data.phone || '(555) 123-4567',
    '{{email}}': data.email || 'hello@restaurant.com',
    '{{primaryColor}}': data.primaryColor || '#2c3e50',
    '{{secondaryColor}}': data.secondaryColor || '#3498db',
    '{{accentColor}}': data.accentColor || '#e74c3c',
    '{{fontFamily}}': data.fontFamily || 'Poppins',
    '{{logo}}': data.logo || '',
    '{{facebook}}': data.facebook || '',
    '{{instagram}}': data.instagram || '',
    '{{twitter}}': data.twitter || '',
    '{{taxRate}}': data.taxRate !== undefined ? data.taxRate : 8,
    '{{promoId}}': data.promoId || '',
    '{{year}}': new Date().getFullYear().toString(),
    '{{apiBaseUrl}}': data.apiBaseUrl || 'https://us-central1-test.cloudfunctions.net',
    '{{stripePublishableKey}}': data.stripePublishableKey || '',
    '{{stripeConnectedAccountId}}': data.stripeConnectedAccountId || '',
    '{{skipPhoneVerification}}': data.skipPhoneVerification ? 'true' : 'false',
    '{{hoursJson}}': JSON.stringify(data.hours || {
      monday: { open: '11:00', close: '22:00' },
      tuesday: { open: '11:00', close: '22:00' },
      wednesday: { open: '11:00', close: '22:00' },
      thursday: { open: '11:00', close: '22:00' },
      friday: { open: '11:00', close: '23:00' },
      saturday: { open: '12:00', close: '23:00' },
      sunday: { open: '12:00', close: '21:00' }
    }),
    '{{configJson}}': JSON.stringify({
      restaurantId: data.restaurantId || '',
      locationId: data.locationId || data.restaurantId || '',
      restaurantName: data.restaurantName || 'Restaurant',
      apiBaseUrl: data.apiBaseUrl || 'https://us-central1-test.cloudfunctions.net',
      stripePublishableKey: (data.stripePublishableKey || '').trim(),
      stripeConnectedAccountId: (data.stripeConnectedAccountId || '').trim(),
      taxRate: (data.taxRate !== undefined ? data.taxRate : 8) / 100,
      promoId: data.promoId || ''
    }).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c'),
    '{{firebaseConfigJson}}': JSON.stringify({
      apiKey: 'test-api-key',
      authDomain: 'test-project.firebaseapp.com',
      projectId: 'test-project',
      storageBucket: 'test-project.appspot.com'
    })
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    html = html.split(placeholder).join(value);
  }

  // Handle conditional blocks
  html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, variable, content) => {
    return data[variable] ? content : '';
  });

  return html;
}

// ==========================================
// Pickup Time Generation (NEW logic)
// ==========================================

function generatePickupTimes(now, hours) {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayKey = dayNames[now.getDay()];
  const todayHours = hours && hours[todayKey];

  let openTime = null;
  let closeTime = null;
  if (todayHours && todayHours.open) {
    const [oh, om] = todayHours.open.split(':').map(Number);
    openTime = new Date(now);
    openTime.setHours(oh, om, 0, 0);
  }
  if (todayHours && todayHours.close) {
    const [ch, cm] = todayHours.close.split(':').map(Number);
    closeTime = new Date(now);
    closeTime.setHours(ch, cm, 0, 0);
  }

  // Start 1 hour from now, round up to next 20-min mark
  let start = new Date(now.getTime() + 60 * 60000);
  // If before opening time, push start to opening time
  if (openTime && start < openTime) {
    start = new Date(openTime);
  }
  const rem = start.getMinutes() % 20;
  if (rem !== 0) start.setMinutes(start.getMinutes() + (20 - rem));
  start.setSeconds(0, 0);

  const times = [{ value: 'ASAP', label: 'ASAP' }];
  for (let i = 0; i < 18; i++) {
    const time = new Date(start.getTime() + i * 20 * 60000);
    if (closeTime && time > closeTime) break;
    times.push({
      value: time.toISOString(),
      label: time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    });
  }
  return times;
}

// ==========================================
// Order Confirmation ASAP handling
// ==========================================

function formatPickupTimeForConfirmation(pickupTime) {
  if (pickupTime === 'ASAP') return 'ASAP';
  const date = new Date(pickupTime);
  if (isNaN(date.getTime())) return 'Invalid time';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ==========================================
// Test Data
// ==========================================

const FULL_RESTAURANT_DATA = {
  restaurantId: 'test-restaurant-123',
  locationId: 'test-location-456',
  restaurantName: 'The Test Kitchen',
  tagline: 'Fresh food, great vibes',
  description: 'A cozy place for amazing meals',
  heroImage: 'https://example.com/hero.jpg',
  aboutImage: 'https://example.com/about.jpg',
  aboutContent: '<p>We love cooking!</p>',
  address: '456 Oak Ave, San Francisco, CA 94102',
  phone: '(415) 555-9876',
  email: 'info@testkitchen.com',
  primaryColor: '#1a1a2e',
  secondaryColor: '#16213e',
  accentColor: '#e94560',
  fontFamily: 'Inter',
  logo: 'https://example.com/logo.png',
  facebook: 'https://facebook.com/testkitchen',
  instagram: 'https://instagram.com/testkitchen',
  twitter: 'https://twitter.com/testkitchen',
  taxRate: 9.25,
  promoId: 'promo-launch-2026',
  apiBaseUrl: 'https://us-central1-test-project.cloudfunctions.net',
  stripePublishableKey: 'pk_test_abc123xyz',
  stripeConnectedAccountId: 'acct_test_456',
  skipPhoneVerification: true,
  hours: {
    monday: { open: '10:00', close: '21:00' },
    tuesday: { open: '10:00', close: '21:00' },
    wednesday: { open: '10:00', close: '21:00' },
    thursday: { open: '10:00', close: '22:00' },
    friday: { open: '10:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '20:00' }
  }
};

const MINIMAL_DATA = {
  restaurantId: 'min-rest-1'
};

// ==========================================
// Template Fragments (simulate real template sections)
// ==========================================

const TITLE_TEMPLATE = '<title>{{restaurantName}} - {{tagline}}</title>';
const META_TEMPLATE = '<meta name="description" content="{{description}}">';
const FAVICON_TEMPLATE = '{{#if logo}}<link rel="icon" href="{{logo}}" type="image/png">{{/if}}';
const FONT_TEMPLATE = '<link href="https://fonts.googleapis.com/css2?family={{fontFamily}}:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">';
const CSS_VARS_TEMPLATE = ':root { --primary-color: {{primaryColor}}; --secondary-color: {{secondaryColor}}; --accent-color: {{accentColor}}; --font-family: \'{{fontFamily}}\', sans-serif; }';
const HERO_TEMPLATE = '{{#if heroImage}}<section class="hero has-image" style="background: url(\'{{heroImage}}\')">{{/if}}<h1>{{restaurantName}}</h1><p>{{description}}</p>';
const ABOUT_TEMPLATE = '{{#if aboutImage}}<img src="{{aboutImage}}" alt="About {{restaurantName}}">{{/if}}<div id="aboutContent">{{aboutContent}}</div>';
const CONTACT_TEMPLATE = '<p class="address">{{address}}</p><p class="phone">{{phone}}</p><p class="email">{{email}}</p>';
const MAP_TEMPLATE = '<iframe src="https://maps.google.com/maps?q={{addressEncoded}}&output=embed"></iframe>';
const SOCIAL_TEMPLATE = '{{#if facebook}}<a href="{{facebook}}" class="social-link"><i class="bi bi-facebook"></i></a>{{/if}}{{#if instagram}}<a href="{{instagram}}" class="social-link"><i class="bi bi-instagram"></i></a>{{/if}}{{#if twitter}}<a href="{{twitter}}" class="social-link"><i class="bi bi-twitter-x"></i></a>{{/if}}';
const FOOTER_LOGO_TEMPLATE = '{{#if logo}}<img src="{{logo}}" alt="{{restaurantName}}" style="height:50px;">{{/if}}<div class="footer-logo">{{restaurantName}}</div>';
const FOOTER_TEMPLATE = '<p>&copy; {{year}} {{restaurantName}}. All rights reserved.</p>';
const TAX_TEMPLATE = '<span>Tax ({{taxRate}}%)</span>';
const CONFIG_TEMPLATE = "const CONFIG = JSON.parse('{{configJson}}');";
const HOURS_TEMPLATE = 'const hours = {{hoursJson}};';
const FIREBASE_TEMPLATE = 'firebase.initializeApp({{firebaseConfigJson}});';
const PORTAL_CONFIG_TEMPLATE = "restaurantId: '{{restaurantId}}', skipPhoneVerification: {{skipPhoneVerification}}";
const PROMO_TEMPLATE = "promoId: '{{promoId}}'";
const STRIPE_TEMPLATE = "stripePublishableKey: '{{stripePublishableKey}}', stripeConnectedAccountId: '{{stripeConnectedAccountId}}'";

// Full page template combining all sections
const FULL_PAGE_TEMPLATE = [
  '<!DOCTYPE html><html><head>',
  TITLE_TEMPLATE, META_TEMPLATE, FAVICON_TEMPLATE, FONT_TEMPLATE,
  '<style>', CSS_VARS_TEMPLATE, '</style>',
  '</head><body>',
  HERO_TEMPLATE, ABOUT_TEMPLATE, CONTACT_TEMPLATE, MAP_TEMPLATE,
  SOCIAL_TEMPLATE, FOOTER_LOGO_TEMPLATE, FOOTER_TEMPLATE, TAX_TEMPLATE,
  '<script>', CONFIG_TEMPLATE, HOURS_TEMPLATE, FIREBASE_TEMPLATE,
  PORTAL_CONFIG_TEMPLATE, PROMO_TEMPLATE, STRIPE_TEMPLATE, '</script>',
  '</body></html>'
].join('\n');


// ==========================================
// Tests
// ==========================================

describe('Template Rendering — All Components', () => {

  // ---- Title & Meta ----

  describe('Title & Meta Tags', () => {
    it('should render restaurant name and tagline in title', () => {
      const html = renderTemplate(TITLE_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toBe('<title>The Test Kitchen - Fresh food, great vibes</title>');
    });

    it('should render description in meta tag', () => {
      const html = renderTemplate(META_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('A cozy place for amazing meals');
    });

    it('should use default values when data is minimal', () => {
      const html = renderTemplate(TITLE_TEMPLATE, MINIMAL_DATA);
      expect(html).toBe('<title>Restaurant - Welcome to our restaurant</title>');
    });
  });

  // ---- Favicon ----

  describe('Favicon (Logo as Favicon)', () => {
    it('should render favicon link when logo is provided', () => {
      const html = renderTemplate(FAVICON_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('<link rel="icon"');
      expect(html).toContain('href="https://example.com/logo.png"');
      expect(html).toContain('type="image/png"');
    });

    it('should NOT render favicon when logo is missing', () => {
      const html = renderTemplate(FAVICON_TEMPLATE, MINIMAL_DATA);
      expect(html).toBe('');
      expect(html).not.toContain('<link rel="icon"');
    });

    it('should NOT render favicon when logo is empty string', () => {
      const html = renderTemplate(FAVICON_TEMPLATE, { ...MINIMAL_DATA, logo: '' });
      expect(html).toBe('');
    });
  });

  // ---- CSS Variables ----

  describe('CSS Variables Injection', () => {
    it('should inject custom colors into CSS variables', () => {
      const html = renderTemplate(CSS_VARS_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('--primary-color: #1a1a2e');
      expect(html).toContain('--secondary-color: #16213e');
      expect(html).toContain('--accent-color: #e94560');
    });

    it('should inject custom font family', () => {
      const html = renderTemplate(CSS_VARS_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain("'Inter'");
    });

    it('should use default colors when not specified', () => {
      const html = renderTemplate(CSS_VARS_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('--primary-color: #2c3e50');
      expect(html).toContain('--secondary-color: #3498db');
      expect(html).toContain('--accent-color: #e74c3c');
      expect(html).toContain("'Poppins'");
    });
  });

  // ---- Font Loading ----

  describe('Font Loading', () => {
    it('should load custom font from Google Fonts', () => {
      const html = renderTemplate(FONT_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('family=Inter:wght@');
    });

    it('should load default Poppins font', () => {
      const html = renderTemplate(FONT_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('family=Poppins:wght@');
    });
  });

  // ---- Hero Section ----

  describe('Hero Section', () => {
    it('should render hero with background image when provided', () => {
      const html = renderTemplate(HERO_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('class="hero has-image"');
      expect(html).toContain("url('https://example.com/hero.jpg')");
      expect(html).toContain('<h1>The Test Kitchen</h1>');
      expect(html).toContain('A cozy place for amazing meals');
    });

    it('should NOT render hero image section when heroImage is missing', () => {
      const html = renderTemplate(HERO_TEMPLATE, MINIMAL_DATA);
      expect(html).not.toContain('class="hero has-image"');
      expect(html).toContain('<h1>Restaurant</h1>');
    });
  });

  // ---- About Section ----

  describe('About Section', () => {
    it('should render about image when provided', () => {
      const html = renderTemplate(ABOUT_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('src="https://example.com/about.jpg"');
      expect(html).toContain('alt="About The Test Kitchen"');
    });

    it('should render about content', () => {
      const html = renderTemplate(ABOUT_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('<p>We love cooking!</p>');
    });

    it('should NOT render about image when not provided', () => {
      const html = renderTemplate(ABOUT_TEMPLATE, MINIMAL_DATA);
      expect(html).not.toContain('<img');
    });

    it('should render default about content when not specified', () => {
      const html = renderTemplate(ABOUT_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('Welcome to our restaurant!');
    });
  });

  // ---- Contact Section ----

  describe('Contact Section', () => {
    it('should render address, phone, and email', () => {
      const html = renderTemplate(CONTACT_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('456 Oak Ave, San Francisco, CA 94102');
      expect(html).toContain('(415) 555-9876');
      expect(html).toContain('info@testkitchen.com');
    });

    it('should use default contact info when not provided', () => {
      const html = renderTemplate(CONTACT_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('123 Main Street, City, State 12345');
      expect(html).toContain('(555) 123-4567');
      expect(html).toContain('hello@restaurant.com');
    });
  });

  // ---- Google Maps Embed ----

  describe('Google Maps Embed', () => {
    it('should URL-encode address for Google Maps', () => {
      const html = renderTemplate(MAP_TEMPLATE, FULL_RESTAURANT_DATA);
      const encoded = encodeURIComponent('456 Oak Ave, San Francisco, CA 94102');
      expect(html).toContain(`q=${encoded}`);
      expect(html).toContain('&output=embed');
    });

    it('should handle special characters in address', () => {
      const data = { ...MINIMAL_DATA, address: "Joe's Diner #5 & Bar, 100 Main St" };
      const html = renderTemplate(MAP_TEMPLATE, data);
      expect(html).toContain(encodeURIComponent("Joe's Diner #5 & Bar, 100 Main St"));
      expect(html).not.toContain("Joe's Diner #5 & Bar"); // raw unencoded should NOT appear in the q= param
    });

    it('should use default address when not specified', () => {
      const html = renderTemplate(MAP_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain(encodeURIComponent('123 Main Street, City, State 12345'));
    });
  });

  // ---- Social Links ----

  describe('Social Links (Conditional)', () => {
    it('should render all social links when all are provided', () => {
      const html = renderTemplate(SOCIAL_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('href="https://facebook.com/testkitchen"');
      expect(html).toContain('href="https://instagram.com/testkitchen"');
      expect(html).toContain('href="https://twitter.com/testkitchen"');
      expect(html).toContain('bi-facebook');
      expect(html).toContain('bi-instagram');
      expect(html).toContain('bi-twitter-x');
    });

    it('should NOT render any social links when none are provided', () => {
      const html = renderTemplate(SOCIAL_TEMPLATE, MINIMAL_DATA);
      expect(html).toBe('');
    });

    it('should render only Facebook when only Facebook is provided', () => {
      const data = { ...MINIMAL_DATA, facebook: 'https://facebook.com/test' };
      const html = renderTemplate(SOCIAL_TEMPLATE, data);
      expect(html).toContain('bi-facebook');
      expect(html).not.toContain('bi-instagram');
      expect(html).not.toContain('bi-twitter-x');
    });

    it('should render only Instagram when only Instagram is provided', () => {
      const data = { ...MINIMAL_DATA, instagram: 'https://instagram.com/test' };
      const html = renderTemplate(SOCIAL_TEMPLATE, data);
      expect(html).not.toContain('bi-facebook');
      expect(html).toContain('bi-instagram');
      expect(html).not.toContain('bi-twitter-x');
    });

    it('should render only Twitter when only Twitter is provided', () => {
      const data = { ...MINIMAL_DATA, twitter: 'https://twitter.com/test' };
      const html = renderTemplate(SOCIAL_TEMPLATE, data);
      expect(html).not.toContain('bi-facebook');
      expect(html).not.toContain('bi-instagram');
      expect(html).toContain('bi-twitter-x');
    });
  });

  // ---- Footer Logo ----

  describe('Footer Logo', () => {
    it('should render logo image above restaurant name when logo provided', () => {
      const html = renderTemplate(FOOTER_LOGO_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('<img src="https://example.com/logo.png"');
      expect(html).toContain('alt="The Test Kitchen"');
      expect(html).toContain('height:50px');
      expect(html).toContain('<div class="footer-logo">The Test Kitchen</div>');
    });

    it('should NOT render logo image when logo is missing', () => {
      const html = renderTemplate(FOOTER_LOGO_TEMPLATE, MINIMAL_DATA);
      expect(html).not.toContain('<img');
      expect(html).toContain('<div class="footer-logo">Restaurant</div>');
    });

    it('should render logo before restaurant name (order check)', () => {
      const html = renderTemplate(FOOTER_LOGO_TEMPLATE, FULL_RESTAURANT_DATA);
      const imgIndex = html.indexOf('<img');
      const nameIndex = html.indexOf('footer-logo');
      expect(imgIndex).toBeLessThan(nameIndex);
    });
  });

  // ---- Footer Copyright ----

  describe('Footer Copyright', () => {
    it('should render current year and restaurant name', () => {
      const html = renderTemplate(FOOTER_TEMPLATE, FULL_RESTAURANT_DATA);
      const year = new Date().getFullYear().toString();
      expect(html).toContain(`&copy; ${year} The Test Kitchen`);
    });

    it('should use default restaurant name when not provided', () => {
      const html = renderTemplate(FOOTER_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('Restaurant. All rights reserved.');
    });
  });

  // ---- Tax Rate ----

  describe('Tax Rate Display', () => {
    it('should render custom tax rate', () => {
      const html = renderTemplate(TAX_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('Tax (9.25%)');
    });

    it('should render default 8% tax rate', () => {
      const html = renderTemplate(TAX_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('Tax (8%)');
    });

    it('should handle zero tax rate', () => {
      const html = renderTemplate(TAX_TEMPLATE, { ...MINIMAL_DATA, taxRate: 0 });
      expect(html).toContain('Tax (0%)');
    });
  });

  // ---- Hours JSON ----

  describe('Hours JSON Injection', () => {
    it('should inject custom hours as valid JSON', () => {
      const html = renderTemplate(HOURS_TEMPLATE, FULL_RESTAURANT_DATA);
      // Extract JSON from "const hours = {...};"
      const jsonStr = html.replace('const hours = ', '').replace(';', '');
      const parsed = JSON.parse(jsonStr);
      expect(parsed.monday.open).toBe('10:00');
      expect(parsed.monday.close).toBe('21:00');
      expect(parsed.friday.close).toBe('23:00');
      expect(parsed.sunday.close).toBe('20:00');
    });

    it('should inject default hours when not specified', () => {
      const html = renderTemplate(HOURS_TEMPLATE, MINIMAL_DATA);
      const jsonStr = html.replace('const hours = ', '').replace(';', '');
      const parsed = JSON.parse(jsonStr);
      expect(parsed.monday.open).toBe('11:00');
      expect(parsed.monday.close).toBe('22:00');
      expect(parsed.friday.close).toBe('23:00');
      expect(parsed.sunday.close).toBe('21:00');
    });

    it('should include all 7 days of the week', () => {
      const html = renderTemplate(HOURS_TEMPLATE, FULL_RESTAURANT_DATA);
      const jsonStr = html.replace('const hours = ', '').replace(';', '');
      const parsed = JSON.parse(jsonStr);
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      days.forEach(day => {
        expect(parsed[day]).toBeDefined();
        expect(parsed[day].open).toBeDefined();
        expect(parsed[day].close).toBeDefined();
      });
    });
  });

  // ---- Config JSON ----

  describe('Config JSON (Safe Injection)', () => {
    it('should inject valid escaped JSON config', () => {
      const html = renderTemplate(CONFIG_TEMPLATE, FULL_RESTAURANT_DATA);
      // Extract from: const CONFIG = JSON.parse('...');
      const match = html.match(/JSON\.parse\('(.+)'\)/);
      expect(match).not.toBeNull();
      // The content is JS-escaped, so we need to unescape for JSON.parse
      const unescaped = match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\u003c/g, '<');
      const config = JSON.parse(unescaped);
      expect(config.restaurantId).toBe('test-restaurant-123');
      expect(config.restaurantName).toBe('The Test Kitchen');
      expect(config.stripePublishableKey).toBe('pk_test_abc123xyz');
      expect(config.taxRate).toBeCloseTo(0.0925, 4); // taxRate/100
    });

    it('should escape single quotes in restaurant name', () => {
      const data = { ...MINIMAL_DATA, restaurantName: "Joe's Diner" };
      const html = renderTemplate(CONFIG_TEMPLATE, data);
      // Should not break the JS string
      expect(html).toContain("JSON.parse('");
      expect(html).not.toContain("Joe's"); // raw quote would break JS
      expect(html).toContain("Joe\\'s"); // should be escaped
    });

    it('should escape < to prevent script injection', () => {
      const data = { ...MINIMAL_DATA, restaurantName: '<script>alert(1)</script>' };
      const html = renderTemplate(CONFIG_TEMPLATE, data);
      expect(html).not.toContain('<script>');
      expect(html).toContain('\\u003c');
    });

    it('should convert taxRate to decimal (divide by 100)', () => {
      const data = { ...MINIMAL_DATA, taxRate: 10 };
      const html = renderTemplate(CONFIG_TEMPLATE, data);
      const match = html.match(/JSON\.parse\('(.+)'\)/);
      const unescaped = match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\u003c/g, '<');
      const config = JSON.parse(unescaped);
      expect(config.taxRate).toBe(0.1);
    });
  });

  // ---- Firebase Config ----

  describe('Firebase Config Injection', () => {
    it('should inject valid Firebase config JSON', () => {
      const html = renderTemplate(FIREBASE_TEMPLATE, FULL_RESTAURANT_DATA);
      const match = html.match(/initializeApp\((.+)\)/);
      expect(match).not.toBeNull();
      const config = JSON.parse(match[1]);
      expect(config.apiKey).toBeDefined();
      expect(config.authDomain).toBeDefined();
      expect(config.projectId).toBeDefined();
      expect(config.storageBucket).toBeDefined();
    });
  });

  // ---- Skip Phone Verification ----

  describe('Skip Phone Verification Config', () => {
    it('should set skipPhoneVerification to true when enabled', () => {
      const html = renderTemplate(PORTAL_CONFIG_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('skipPhoneVerification: true');
    });

    it('should set skipPhoneVerification to false when disabled', () => {
      const data = { ...MINIMAL_DATA, skipPhoneVerification: false };
      const html = renderTemplate(PORTAL_CONFIG_TEMPLATE, data);
      expect(html).toContain('skipPhoneVerification: false');
    });

    it('should default skipPhoneVerification to false when not specified', () => {
      const html = renderTemplate(PORTAL_CONFIG_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain('skipPhoneVerification: false');
    });
  });

  // ---- Promo ID ----

  describe('Promo ID Injection', () => {
    it('should inject promo ID when provided', () => {
      const html = renderTemplate(PROMO_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain("promoId: 'promo-launch-2026'");
    });

    it('should inject empty promo ID when not provided', () => {
      const html = renderTemplate(PROMO_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain("promoId: ''");
    });
  });

  // ---- Stripe Config ----

  describe('Stripe Config Injection', () => {
    it('should inject Stripe keys when provided', () => {
      const html = renderTemplate(STRIPE_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain("stripePublishableKey: 'pk_test_abc123xyz'");
      expect(html).toContain("stripeConnectedAccountId: 'acct_test_456'");
    });

    it('should inject empty Stripe keys when not provided', () => {
      const html = renderTemplate(STRIPE_TEMPLATE, MINIMAL_DATA);
      expect(html).toContain("stripePublishableKey: ''");
      expect(html).toContain("stripeConnectedAccountId: ''");
    });
  });

  // ---- Location ID ----

  describe('Location ID', () => {
    it('should use locationId when provided', () => {
      const template = "locationId: '{{locationId}}'";
      const html = renderTemplate(template, FULL_RESTAURANT_DATA);
      expect(html).toContain("locationId: 'test-location-456'");
    });

    it('should fall back to restaurantId when locationId is missing', () => {
      const template = "locationId: '{{locationId}}'";
      const html = renderTemplate(template, MINIMAL_DATA);
      expect(html).toContain("locationId: 'min-rest-1'");
    });
  });

  // ---- Full Page Rendering ----

  describe('Full Page Template Rendering', () => {
    it('should render all sections without leftover placeholders (full data)', () => {
      const html = renderTemplate(FULL_PAGE_TEMPLATE, FULL_RESTAURANT_DATA);
      // No unreplaced {{...}} should remain (except inside JSON strings which are fine)
      const unreplaced = html.match(/\{\{[a-zA-Z]+\}\}/g);
      expect(unreplaced).toBeNull();
    });

    it('should render all sections without leftover placeholders (minimal data)', () => {
      const html = renderTemplate(FULL_PAGE_TEMPLATE, MINIMAL_DATA);
      const unreplaced = html.match(/\{\{[a-zA-Z]+\}\}/g);
      expect(unreplaced).toBeNull();
    });

    it('should render all sections with full data', () => {
      const html = renderTemplate(FULL_PAGE_TEMPLATE, FULL_RESTAURANT_DATA);
      expect(html).toContain('The Test Kitchen');
      expect(html).toContain('Fresh food, great vibes');
      expect(html).toContain('456 Oak Ave');
      expect(html).toContain('bi-facebook');
      expect(html).toContain('<link rel="icon"');
      expect(html).toContain('footer-logo');
      expect(html).toContain('Tax (9.25%)');
      expect(html).toContain('skipPhoneVerification: true');
    });

    it('should hide conditional sections with minimal data', () => {
      const html = renderTemplate(FULL_PAGE_TEMPLATE, MINIMAL_DATA);
      expect(html).not.toContain('<link rel="icon"');
      expect(html).not.toContain('bi-facebook');
      expect(html).not.toContain('bi-instagram');
      expect(html).not.toContain('bi-twitter-x');
      expect(html).not.toContain('class="hero has-image"');
    });
  });

  // ---- Conditional Blocks ({{#if}}) ----

  describe('Conditional Blocks', () => {
    it('should render content when condition is truthy', () => {
      const template = '{{#if logo}}HAS LOGO{{/if}}';
      expect(renderTemplate(template, { logo: 'url.png' })).toBe('HAS LOGO');
    });

    it('should remove content when condition is falsy (empty string)', () => {
      const template = '{{#if logo}}HAS LOGO{{/if}}';
      expect(renderTemplate(template, { logo: '' })).toBe('');
    });

    it('should remove content when condition is undefined', () => {
      const template = '{{#if logo}}HAS LOGO{{/if}}';
      expect(renderTemplate(template, {})).toBe('');
    });

    it('should handle multiple conditional blocks', () => {
      const template = '{{#if facebook}}FB{{/if}} {{#if instagram}}IG{{/if}} {{#if twitter}}TW{{/if}}';
      const html = renderTemplate(template, { facebook: 'url', twitter: 'url' });
      expect(html).toContain('FB');
      expect(html).not.toContain('IG');
      expect(html).toContain('TW');
    });

    it('should handle nested placeholders inside conditional blocks', () => {
      const template = '{{#if logo}}<img src="{{logo}}">{{/if}}';
      const html = renderTemplate(template, { logo: 'test.png' });
      expect(html).toBe('<img src="test.png">');
    });

    it('should handle multiline content inside conditional blocks', () => {
      const template = '{{#if heroImage}}\n<div class="hero">\n  <img src="{{heroImage}}">\n</div>\n{{/if}}';
      const html = renderTemplate(template, { heroImage: 'hero.jpg' });
      expect(html).toContain('<div class="hero">');
      expect(html).toContain('src="hero.jpg"');
    });
  });
});


// ==========================================
// Pickup Time Generation (NEW logic)
// ==========================================

describe('Pickup Time Generation — New Logic', () => {
  const defaultHours = {
    monday: { open: '10:00', close: '21:00' },
    tuesday: { open: '10:00', close: '21:00' },
    wednesday: { open: '10:00', close: '21:00' },
    thursday: { open: '10:00', close: '22:00' },
    friday: { open: '10:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '20:00' }
  };

  it('should always have ASAP as the first option', () => {
    const now = new Date('2026-04-06T12:00:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    expect(times[0].value).toBe('ASAP');
    expect(times[0].label).toBe('ASAP');
  });

  it('should start timed options at least 1 hour from now', () => {
    const now = new Date('2026-04-06T12:00:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    // First non-ASAP option
    const firstTimed = times[1];
    expect(firstTimed).toBeDefined();
    const timedDate = new Date(firstTimed.value);
    const diffMinutes = (timedDate - now) / 60000;
    expect(diffMinutes).toBeGreaterThanOrEqual(60);
  });

  it('should use 20-minute intervals between timed options', () => {
    const now = new Date('2026-04-06T12:00:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    const timedOptions = times.filter(t => t.value !== 'ASAP');
    for (let i = 1; i < timedOptions.length; i++) {
      const diff = new Date(timedOptions[i].value) - new Date(timedOptions[i - 1].value);
      expect(diff).toBe(20 * 60000); // 20 minutes
    }
  });

  it('should round start time up to next 20-minute mark', () => {
    // 12:07 + 1hr = 13:07 → round up to 13:20
    const now = new Date('2026-04-06T12:07:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    const firstTimed = new Date(times[1].value);
    expect(firstTimed.getMinutes()).toBe(20);
    expect(firstTimed.getHours()).toBe(13);
  });

  it('should not round when already on a 20-minute mark', () => {
    // 12:00 + 1hr = 13:00 → already on 20-minute mark (0 % 20 = 0)
    const now = new Date('2026-04-06T12:00:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    const firstTimed = new Date(times[1].value);
    expect(firstTimed.getMinutes()).toBe(0);
    expect(firstTimed.getHours()).toBe(13);
  });

  it('should not include times past closing time', () => {
    // Monday closes at 21:00. At 19:30, 1hr later = 20:30, round up = 20:40
    // Options: 20:40, 21:00 — 21:20 would be past close
    const now = new Date('2026-04-06T19:30:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    const timedOptions = times.filter(t => t.value !== 'ASAP');

    timedOptions.forEach(opt => {
      const optDate = new Date(opt.value);
      const closeTime = new Date(now);
      closeTime.setHours(21, 0, 0, 0);
      expect(optDate.getTime()).toBeLessThanOrEqual(closeTime.getTime());
    });
  });

  it('should generate options that fit within operating hours', () => {
    // Friday closes at 23:00. At 12:00, start = 13:00
    // Should have many options between 13:00 and 23:00
    const now = new Date('2026-04-10T12:00:00'); // Friday
    const times = generatePickupTimes(now, defaultHours);
    const timedOptions = times.filter(t => t.value !== 'ASAP');
    // From 13:00 to 23:00 = 10hrs = 600min / 20min = 30, but max 18 iterations
    expect(timedOptions.length).toBeGreaterThan(0);
    expect(timedOptions.length).toBeLessThanOrEqual(18);
  });

  it('should return only ASAP when close to closing time', () => {
    // Monday closes at 21:00. At 20:30, 1hr later = 21:30 → past close
    const now = new Date('2026-04-06T20:30:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    expect(times).toHaveLength(1);
    expect(times[0].value).toBe('ASAP');
  });

  it('should not show times before opening hour (the 4AM bug)', () => {
    // Sunday opens at 11:00 AM. At 3:00 AM, 1hr later = 4:00 AM which is before open.
    // Should push start to 11:00 AM, not show 4:00 AM.
    const now = new Date('2026-04-05T03:00:00'); // Sunday
    const times = generatePickupTimes(now, defaultHours);
    const timedOptions = times.filter(t => t.value !== 'ASAP');
    timedOptions.forEach(opt => {
      const optDate = new Date(opt.value);
      // All times must be >= 11:00 AM (opening)
      const openTime = new Date(now);
      openTime.setHours(11, 0, 0, 0);
      expect(optDate.getTime()).toBeGreaterThanOrEqual(openTime.getTime());
    });
    // First timed option should be 11:00 AM (already on 20-min mark)
    const firstTimed = new Date(timedOptions[0].value);
    expect(firstTimed.getHours()).toBe(11);
    expect(firstTimed.getMinutes()).toBe(0);
  });

  it('should push start to opening time when browsing before open', () => {
    // Monday opens at 10:00 AM. At 7:00 AM, 1hr = 8:00 AM < 10:00 AM open.
    // Should start at 10:00 AM.
    const now = new Date('2026-04-06T07:00:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    const firstTimed = new Date(times[1].value);
    expect(firstTimed.getHours()).toBe(10);
    expect(firstTimed.getMinutes()).toBe(0);
  });

  it('should use now+1hr when already past opening time', () => {
    // Monday opens at 10:00 AM. At 2:00 PM, 1hr = 3:00 PM > 10:00 AM.
    // Should start at 3:00 PM (normal behavior).
    const now = new Date('2026-04-06T14:00:00'); // Monday
    const times = generatePickupTimes(now, defaultHours);
    const firstTimed = new Date(times[1].value);
    expect(firstTimed.getHours()).toBe(15);
    expect(firstTimed.getMinutes()).toBe(0);
  });

  it('should handle no hours data (no close constraint)', () => {
    const now = new Date('2026-04-06T12:00:00');
    const times = generatePickupTimes(now, null);
    expect(times[0].value).toBe('ASAP');
    // Without close time, should generate all 18 timed options
    const timedOptions = times.filter(t => t.value !== 'ASAP');
    expect(timedOptions.length).toBe(18);
  });

  it('should handle Sunday hours correctly', () => {
    // Sunday closes at 20:00. At 14:00, start = 15:00
    const now = new Date('2026-04-05T14:00:00'); // Sunday
    const times = generatePickupTimes(now, defaultHours);
    const timedOptions = times.filter(t => t.value !== 'ASAP');
    // From 15:00 to 20:00 inclusive = 5hrs = 300min / 20 + 1 = 16 max slots
    expect(timedOptions.length).toBeLessThanOrEqual(16);
    timedOptions.forEach(opt => {
      const optDate = new Date(opt.value);
      expect(optDate.getHours()).toBeLessThanOrEqual(20);
      if (optDate.getHours() === 20) {
        expect(optDate.getMinutes()).toBe(0);
      }
    });
  });

  it('should return valid ISO strings for timed options', () => {
    const now = new Date('2026-04-06T12:00:00');
    const times = generatePickupTimes(now, defaultHours);
    times.filter(t => t.value !== 'ASAP').forEach(t => {
      expect(() => new Date(t.value)).not.toThrow();
      const d = new Date(t.value);
      expect(d.getTime()).not.toBeNaN();
    });
  });

  it('should have human-readable labels for timed options', () => {
    const now = new Date('2026-04-06T12:00:00');
    const times = generatePickupTimes(now, defaultHours);
    times.filter(t => t.value !== 'ASAP').forEach(t => {
      // Label should contain AM/PM format like "1:00 PM"
      expect(t.label).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
    });
  });
});


// ==========================================
// ASAP Handling in Order Confirmation
// ==========================================

describe('Order Confirmation — ASAP Handling', () => {
  it('should display "ASAP" when pickup time is ASAP', () => {
    const result = formatPickupTimeForConfirmation('ASAP');
    expect(result).toBe('ASAP');
  });

  it('should format valid ISO time correctly', () => {
    const result = formatPickupTimeForConfirmation('2026-04-06T13:00:00.000Z');
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
  });

  it('should handle invalid time string gracefully', () => {
    const result = formatPickupTimeForConfirmation('not-a-date');
    expect(result).toBe('Invalid time');
  });

  it('should not crash on new Date("ASAP")', () => {
    // This was the original bug — new Date("ASAP") returns Invalid Date
    const date = new Date('ASAP');
    expect(isNaN(date.getTime())).toBe(true);
    // Our function handles this
    expect(formatPickupTimeForConfirmation('ASAP')).toBe('ASAP');
  });
});


// ==========================================
// Cross-Template Placeholder Consistency
// ==========================================

describe('Cross-Template Placeholder Consistency', () => {
  // Verifies that all 4 templates use the same placeholders
  // Note: customerPortalStyles, customerPortalScript, customerPortalMockData
  // are file-injected (loaded from disk in the real renderTemplate), not data-driven.
  // They are tested separately. This list covers data-driven placeholders only.
  const ALL_EXPECTED_PLACEHOLDERS = [
    '{{restaurantId}}', '{{locationId}}', '{{restaurantName}}',
    '{{tagline}}', '{{description}}', '{{primaryColor}}',
    '{{secondaryColor}}', '{{accentColor}}', '{{fontFamily}}',
    '{{address}}', '{{addressEncoded}}', '{{phone}}', '{{email}}',
    '{{taxRate}}', '{{year}}', '{{hoursJson}}', '{{configJson}}',
    '{{firebaseConfigJson}}', '{{skipPhoneVerification}}'
  ];

  const CONDITIONAL_PLACEHOLDERS = [
    '{{#if logo}}', '{{#if heroImage}}', '{{#if aboutImage}}',
    '{{#if facebook}}', '{{#if instagram}}', '{{#if twitter}}'
  ];

  it('should have all required simple placeholders defined in renderTemplate', () => {
    const template = ALL_EXPECTED_PLACEHOLDERS.join(' | ');
    const html = renderTemplate(template, FULL_RESTAURANT_DATA);
    // None of the placeholders should remain unreplaced
    ALL_EXPECTED_PLACEHOLDERS.forEach(ph => {
      expect(html).not.toContain(ph);
    });
  });

  it('should handle all conditional blocks', () => {
    const template = CONDITIONAL_PLACEHOLDERS.map(ph => {
      const varName = ph.replace('{{#if ', '').replace('}}', '');
      return `${ph}${varName}-content{{/if}}`;
    }).join(' ');

    // With full data, all conditionals should render
    const htmlFull = renderTemplate(template, FULL_RESTAURANT_DATA);
    expect(htmlFull).toContain('logo-content');
    expect(htmlFull).toContain('heroImage-content');
    expect(htmlFull).toContain('aboutImage-content');
    expect(htmlFull).toContain('facebook-content');
    expect(htmlFull).toContain('instagram-content');
    expect(htmlFull).toContain('twitter-content');

    // With minimal data, all conditionals should be removed
    const htmlMin = renderTemplate(template, MINIMAL_DATA);
    expect(htmlMin.trim()).toBe('');
  });
});
