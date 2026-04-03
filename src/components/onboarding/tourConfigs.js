// Tour step configurations for each onboarding feature
// Each key matches a step ID from ONBOARDING_STEPS
// Selectors use actual CSS class names from each component

const tourConfigs = {
  restaurant_profile: [
    {
      target: 'body',
      content: 'Welcome to your Account Settings! This is where you set up your restaurant profile, manage subscriptions, configure security, and handle staff access.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.account-main-content .account-card',
      content: 'Start by filling in your restaurant name, address, phone number, and business hours. This information appears on your website and receipts.',
      placement: 'bottom',
    },
  ],

  menu_setup: [
    {
      target: 'body',
      content: 'Welcome to Menu Management! Here you create categories (like Appetizers, Entrees, Drinks) and add items with photos, prices, and descriptions.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.menu-add-category-btn',
      content: 'Start by creating your first category. Click here to add categories like "Appetizers", "Main Course", "Beverages", etc.',
      placement: 'bottom',
    },
    {
      target: '.menu-categories',
      content: 'Once you have categories, click on one to add menu items. Each item can have a photo, description, price, and optional discount.',
      placement: 'right',
    },
    {
      target: '.menu-items-grid',
      content: 'Your menu items appear here. Click "Add Item" to create new items with images, descriptions, and pricing.',
      placement: 'left',
    },
  ],

  table_layout: [
    {
      target: 'body',
      content: 'Welcome to the Table Layout Designer! Design your restaurant floor plan by adding tables, booths, and bar seating.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.table-layout-toolbar',
      content: 'Click "Add Table" here to add new tables. You can set each table\'s number, capacity, shape (round, square, rectangle), and section.',
      placement: 'bottom',
    },
    {
      target: '.table-floor-plan',
      content: 'Drag tables around to match your actual floor layout. This helps servers and the POS system track which tables are in use.',
      placement: 'top',
    },
  ],

  staff_access: [
    {
      target: 'body',
      content: 'Staff Access lets you create accounts for your team. Each staff member gets a role-based login with limited permissions.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.account-main-content .account-card',
      content: 'Create staff accounts with specific roles: Kitchen (sees kitchen display only), Server (sees server view), or POS Operator (takes orders). Staff log in with their own credentials.',
      placement: 'bottom',
    },
  ],

  reimbursement_pin: [
    {
      target: 'body',
      content: 'The Reimbursement PIN is a security feature that protects against unauthorized refunds. Only managers with this PIN can approve refunds and reimbursements.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.account-main-content .account-card',
      content: 'Set a 4-6 digit PIN that managers will enter when processing refunds. This prevents staff from issuing unauthorized refunds. You can change it anytime from Account Settings.',
      placement: 'bottom',
    },
  ],

  stripe_setup: [
    {
      target: 'body',
      content: 'Payment Setup lets you connect your Stripe account to accept card payments. Stripe handles all the payment processing securely.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.account-main-content .account-card',
      content: 'Click "Connect with Stripe" to link your Stripe account. If you don\'t have one, Stripe will guide you through creating one. Once connected, you can accept card payments through POS, website, and widget orders.',
      placement: 'bottom',
    },
  ],

  stripe_terminal: [
    {
      target: 'body',
      content: 'Stripe Terminal lets you accept in-person card payments using a physical card reader connected to your POS. Customers can tap, swipe, or insert their card.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.account-main-content .account-card',
      content: 'First, register your card reader here. Enter the reader\'s registration code (found on the device or its packaging). The reader will connect via internet.',
      placement: 'bottom',
    },
  ],

  pos_basics: [
    {
      target: 'body',
      content: 'Welcome to the POS (Point of Sale)! This is your order-taking station. The layout is optimized for tablets and touchscreens.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.pos-categories',
      content: 'Step 1: Select a menu category to see its items. Categories are displayed as easy-to-tap buttons.',
      placement: 'right',
    },
    {
      target: '.pos-items-grid',
      content: 'Step 2: Tap on items to add them to the current order. You can adjust quantities and add special notes.',
      placement: 'left',
    },
    {
      target: '.pos-order-panel',
      content: 'Step 3: Review the current order, assign a table, and click "Send to Kitchen" when ready. The order will appear on the Kitchen Display immediately.',
      placement: 'left',
    },
    {
      target: '.pos-table-selection',
      content: 'Assign a table number to each order so servers know where to deliver. You can also use it for counter/takeout orders.',
      placement: 'top',
    },
  ],

  kitchen_display: [
    {
      target: 'body',
      content: 'The Kitchen Display shows all active orders in real-time. Kitchen staff use this to see what needs to be prepared and in what order.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.kitchen-orders-grid',
      content: 'Each card shows an order with its items, table number, and how long ago it was placed. Orders are color-coded by status.',
      placement: 'bottom',
    },
    {
      target: '.kitchen-action-button',
      content: 'Update order status as you work: "Start Preparing" when you begin, then "Mark Ready" when the food is done. This notifies the servers automatically.',
      placement: 'top',
    },
  ],

  server_view: [
    {
      target: 'body',
      content: 'The Server View helps front-of-house staff manage their tables and track order progress. Servers can see which orders are ready to be served.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.server-orders-grid',
      content: 'See all orders at a glance — color-coded by status (available, occupied, food ready). Click an order to see its details.',
      placement: 'bottom',
    },
    {
      target: '.server-action-button',
      content: 'When an order is marked "Ready" by the kitchen, it appears here. Click "Mark Served" after delivering the food to complete the service cycle.',
      placement: 'top',
    },
  ],

  payment_processing: [
    {
      target: 'body',
      content: 'The Payments page lets you process payments for completed orders. You can accept cards, cash, or split bills between multiple payment methods.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.payments-tables-grid',
      content: 'Served orders appear here ready for payment. Select an order to process its payment.',
      placement: 'bottom',
    },
    {
      target: '.payment-method-buttons',
      content: 'Choose a payment method: Card (via Stripe Terminal or manual entry), Cash, or Split Bill. For card payments, the customer taps/swipes on your terminal.',
      placement: 'bottom',
    },
  ],

  order_management: [
    {
      target: 'body',
      content: 'The Orders page gives you a complete view of all orders — past and present. Filter, search, and track orders through their entire lifecycle.',
      placement: 'center',
      disableBeacon: true,
    },
  ],

  website_builder: [
    {
      target: 'body',
      content: 'The Website Builder creates a professional restaurant website with online ordering built in. Choose a template and customize it to match your brand.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.template-grid',
      content: 'Pick from 3 beautiful templates: Modern Bistro (dark, sleek), Italian Trattoria (classic, gold accents), or Fresh Cafe (green, natural). Each is fully responsive.',
      placement: 'bottom',
    },
    {
      target: '.builder-tabs',
      content: 'Customize your site — update the hero image, about text, accent colors, business hours, and social media links using these tabs.',
      placement: 'bottom',
    },
    {
      target: '.preview-panel',
      content: 'Preview your site here before going live, then click Publish. Your restaurant gets a unique URL where customers can view your menu and place orders online.',
      placement: 'left',
    },
  ],

  online_ordering: [
    {
      target: 'body',
      content: 'Website Integration gives you an embeddable ordering widget that you can add to any existing website. Customers can browse your menu and order without leaving your site.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.code-box',
      content: 'Copy this embed code and paste it into your website\'s HTML. The widget loads your live menu, handles cart, checkout, and payments — all branded to your restaurant.',
      placement: 'bottom',
    },
    {
      target: '.url-card',
      content: 'Your published restaurant website URL is shown here. Share it with customers or link to it from your social media.',
      placement: 'bottom',
    },
  ],

  promotions_rewards: [
    {
      target: 'body',
      content: 'Promotions & Rewards helps you drive repeat customers. Create discount codes, loyalty rewards, and an interactive spin-to-win wheel.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.page-header',
      content: 'Create promotions with discount codes (% off or $ off). Set start/end dates, usage limits, and minimum order amounts.',
      placement: 'bottom',
    },
    {
      target: '.promotions-list, .rewards-config',
      content: 'Set up the loyalty rewards system — customers earn points with each order and can redeem them for rewards. The spin wheel adds a fun gamification element!',
      placement: 'bottom',
    },
  ],

  analytics_dashboard: [
    {
      target: 'body',
      content: 'Your Analytics Dashboard shows key business metrics at a glance — revenue trends, order volume, popular items, peak hours, and more.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.ca-kpi-grid',
      content: 'Key metrics are displayed here — total revenue, order count, average ticket size, and growth percentages. Use these to make data-driven decisions.',
      placement: 'bottom',
    },
    {
      target: '.ca-chart-panel',
      content: 'Charts show trends over time. Track daily/weekly/monthly revenue, order counts, average order values, and compare across time periods.',
      placement: 'bottom',
    },
  ],

  seo_social: [
    {
      target: 'body',
      content: 'SEO & Social Media lets you connect your social accounts and post content directly from Koda Carte. Manage your Facebook, Instagram, and business listings from one place.',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.main-nav-pills',
      content: 'Navigate between tabs: Create posts, get AI content ideas, analyze SEO, manage reviews, and track your online visibility.',
      placement: 'bottom',
    },
    {
      target: '.platform-buttons',
      content: 'Select which platforms to post to — Facebook, Instagram, or both. Connect your accounts first under the Visibility tab.',
      placement: 'bottom',
    },
    {
      target: '.business-connections-card',
      content: 'Connect your Yelp, Google Business, and Apple Maps listings to monitor reviews and manage your online presence from one dashboard.',
      placement: 'bottom',
    },
  ],
};

export default tourConfigs;
