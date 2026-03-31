/**
 * Koda Carte — Embeddable Restaurant Widget
 *
 * Provides menu browsing, online ordering, and customer account management
 * directly within a restaurant's existing website via an iframe-based widget.
 *
 * Usage:
 *   <script src="https://restaurant-portal-6b147.web.app/widget.js"></script>
 *   <script>
 *     KodaCarte.init({
 *       restaurantId: 'your-restaurant-slug',
 *       mode: 'inline',        // 'inline' | 'float' | 'page'
 *       target: '#koda-menu',  // CSS selector (required for 'inline' mode)
 *       theme: 'auto'          // 'auto' | 'light' | 'dark'
 *     });
 *   </script>
 */
(function() {
  'use strict';

  var BASE_URL = 'https://us-central1-restaurant-portal-6b147.cloudfunctions.net/serveWebsite';

  // Auto-detect base URL for local development
  if (typeof window !== 'undefined') {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) {
        var src = scripts[i].src;
        // If loaded from localhost emulator, use emulator URL
        if (src.indexOf('localhost') !== -1) {
          BASE_URL = 'http://localhost:5001/restaurant-portal-6b147/us-central1/serveWebsite';
        }
        break;
      }
    }
  }

  // =========================================================
  // KodaCarte global object
  // =========================================================
  window.KodaCarte = {
    _instance: null,
    _config: null,

    /**
     * Initialize the widget
     * @param {Object} config
     * @param {string} config.restaurantId - Restaurant slug or ID (required)
     * @param {string} [config.mode='inline'] - Display mode: 'inline', 'float', or 'page'
     * @param {string} [config.target] - CSS selector for inline mount (required for inline mode)
     * @param {string} [config.theme='auto'] - Theme: 'auto', 'light', 'dark'
     * @param {string} [config.primaryColor] - Override primary color
     * @param {string} [config.buttonText='Order Online'] - Text for float button
     * @param {string} [config.buttonPosition='bottom-right'] - Float button position
     * @param {Function} [config.onOrderPlaced] - Callback when order is placed
     * @param {Function} [config.onCartUpdate] - Callback when cart updates
     * @param {Function} [config.onAuthChange] - Callback when auth state changes
     * @param {Function} [config.onReady] - Callback when widget is ready
     */
    init: function(config) {
      if (!config || !config.restaurantId) {
        console.error('[KodaCarte] restaurantId is required');
        return;
      }

      // Check host page URL for promo deep-link param
      var urlParams = new URLSearchParams(window.location.search);
      var promoFromUrl = urlParams.get('koda_promo') || '';

      this._config = {
        restaurantId: config.restaurantId,
        mode: config.mode || 'inline',
        target: config.target || null,
        theme: config.theme || 'auto',
        primaryColor: config.primaryColor || null,
        buttonText: config.buttonText || 'Order Online',
        buttonPosition: config.buttonPosition || 'bottom-right',
        defaultTab: config.defaultTab || 'menu',
        promo: promoFromUrl,
        onOrderPlaced: config.onOrderPlaced || null,
        onCartUpdate: config.onCartUpdate || null,
        onAuthChange: config.onAuthChange || null,
        onReady: config.onReady || null
      };

      // Inject base styles
      this._injectStyles();

      // Build based on mode
      switch (this._config.mode) {
        case 'float':
          this._createFloatWidget();
          break;
        case 'page':
          this._createPageWidget();
          break;
        case 'inline':
        default:
          this._createInlineWidget();
          break;
      }

      // Listen for messages from iframe
      window.addEventListener('message', this._handleMessage.bind(this));
    },

    // =========================================================
    // Inline mode — renders inside a target div
    // =========================================================
    _createInlineWidget: function() {
      var target = this._config.target
        ? document.querySelector(this._config.target)
        : null;

      if (!target) {
        console.error('[KodaCarte] Target element not found:', this._config.target);
        return;
      }

      // Create widget container
      var container = document.createElement('div');
      container.className = 'kc-widget kc-widget-inline';
      container.innerHTML = this._buildWidgetShell('inline');
      target.appendChild(container);

      this._instance = container;
      this._setupTabs(container);
      this._loadIframe(container.querySelector('.kc-iframe'));
    },

    // =========================================================
    // Float mode — floating button that opens a drawer/modal
    // =========================================================
    _createFloatWidget: function() {
      var cfg = this._config;

      // Create floating button
      var btn = document.createElement('button');
      btn.className = 'kc-float-btn';
      btn.setAttribute('aria-label', cfg.buttonText);
      btn.innerHTML = '<span class="kc-float-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v13H7l-4 4V3z"/></svg></span>' +
        '<span class="kc-float-text">' + cfg.buttonText + '</span>';

      if (cfg.primaryColor) {
        btn.style.background = cfg.primaryColor;
      }

      // Position
      var pos = cfg.buttonPosition;
      if (pos.indexOf('left') !== -1) {
        btn.style.left = '20px';
        btn.style.right = 'auto';
      }
      if (pos.indexOf('top') !== -1) {
        btn.style.top = '20px';
        btn.style.bottom = 'auto';
      }

      document.body.appendChild(btn);

      // Create drawer overlay
      var drawerOverlay = document.createElement('div');
      drawerOverlay.className = 'kc-drawer-overlay';
      drawerOverlay.style.display = 'none';
      document.body.appendChild(drawerOverlay);

      // Create drawer
      var drawer = document.createElement('div');
      drawer.className = 'kc-drawer';
      drawer.innerHTML = this._buildWidgetShell('float');
      drawer.style.display = 'none';
      document.body.appendChild(drawer);

      this._instance = drawer;
      this._setupTabs(drawer);

      var iframe = drawer.querySelector('.kc-iframe');
      var iframeLoaded = false;

      var self = this;

      function openDrawer() {
        drawer.style.display = 'flex';
        drawerOverlay.style.display = 'block';
        btn.classList.add('kc-float-btn-active');
        if (!iframeLoaded) {
          self._loadIframe(iframe);
          iframeLoaded = true;
        }
      }

      function closeDrawer() {
        drawer.style.display = 'none';
        drawerOverlay.style.display = 'none';
        btn.classList.remove('kc-float-btn-active');
      }

      btn.addEventListener('click', function() {
        if (drawer.style.display !== 'none') {
          closeDrawer();
        } else {
          openDrawer();
        }
      });

      // Auto-open drawer if promo deep-link detected
      if (this._config.promo) {
        openDrawer();
      }

      drawerOverlay.addEventListener('click', closeDrawer);

      var closeBtn = drawer.querySelector('.kc-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', closeDrawer);
      }

      // Resize handle (desktop/tablet only)
      var resizeHandle = document.createElement('div');
      resizeHandle.className = 'kc-resize-handle';
      drawer.appendChild(resizeHandle);

      if (window.matchMedia('(min-width: 481px)').matches) {
        var isResizing = false;
        var resizeStartX, resizeStartY, resizeStartWidth, resizeStartTop;

        function startResize(clientX, clientY) {
          isResizing = true;
          resizeStartX = clientX;
          resizeStartY = clientY;
          var rect = drawer.getBoundingClientRect();
          resizeStartWidth = rect.width;
          resizeStartTop = rect.top;
          drawer.style.transition = 'none';
        }

        function doResize(clientX, clientY) {
          if (!isResizing) return;
          var newWidth = Math.max(320, Math.min(resizeStartWidth + (resizeStartX - clientX), window.innerWidth - 20));
          var newTop = Math.max(10, Math.min(resizeStartTop + (clientY - resizeStartY), window.innerHeight - 300));
          drawer.style.width = newWidth + 'px';
          drawer.style.top = newTop + 'px';
        }

        function stopResize() {
          if (isResizing) {
            isResizing = false;
            drawer.style.transition = '';
          }
        }

        resizeHandle.addEventListener('mousedown', function(e) {
          startResize(e.clientX, e.clientY);
          e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
          if (isResizing) { doResize(e.clientX, e.clientY); e.preventDefault(); }
        });
        document.addEventListener('mouseup', stopResize);

        resizeHandle.addEventListener('touchstart', function(e) {
          startResize(e.touches[0].clientX, e.touches[0].clientY);
          e.preventDefault();
        }, { passive: false });
        document.addEventListener('touchmove', function(e) {
          if (isResizing) { doResize(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
        }, { passive: false });
        document.addEventListener('touchend', stopResize);
      }
    },

    // =========================================================
    // Page mode — full-width section
    // =========================================================
    _createPageWidget: function() {
      var target = this._config.target
        ? document.querySelector(this._config.target)
        : document.body;

      var container = document.createElement('div');
      container.className = 'kc-widget kc-widget-page';
      container.innerHTML = this._buildWidgetShell('page');
      target.appendChild(container);

      this._instance = container;
      this._setupTabs(container);
      this._loadIframe(container.querySelector('.kc-iframe'));
    },

    // =========================================================
    // Shared: build widget shell HTML
    // =========================================================
    _buildWidgetShell: function(mode) {
      var showClose = mode === 'float';
      var headerClass = mode === 'page' ? 'kc-header kc-header-page' : 'kc-header';

      return '' +
        '<div class="' + headerClass + '">' +
          '<nav class="kc-tabs">' +
            '<button class="kc-tab active" data-tab="menu">Menu</button>' +
            '<button class="kc-tab" data-tab="account">My Account</button>' +
            '<button class="kc-tab" data-tab="orders">Orders</button>' +
            '<button class="kc-tab" data-tab="promotions">Promos</button>' +
            '<button class="kc-tab" data-tab="rewards">Rewards</button>' +
            '<button class="kc-tab" data-tab="reviews">Reviews</button>' +
          '</nav>' +
          '<div class="kc-header-right">' +
            '<span class="kc-cart-badge" style="display:none;">0</span>' +
            (showClose ? '<button class="kc-close-btn" aria-label="Close">&times;</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="kc-body">' +
          '<iframe class="kc-iframe" title="Restaurant ordering" allow="payment" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>' +
        '</div>';
    },

    // =========================================================
    // Tab navigation
    // =========================================================
    _setupTabs: function(container) {
      var tabs = container.querySelectorAll('.kc-tab');
      var self = this;

      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function() {
          // Update active state
          for (var j = 0; j < tabs.length; j++) {
            tabs[j].classList.remove('active');
          }
          this.classList.add('active');

          // Tell iframe to navigate
          var tab = this.getAttribute('data-tab');
          var iframe = container.querySelector('.kc-iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'koda-navigate', tab: tab }, '*');
          }
        });
      }
    },

    // =========================================================
    // Load iframe
    // =========================================================
    _loadIframe: function(iframe) {
      if (!iframe) return;

      var cfg = this._config;
      var url = BASE_URL +
        '?restaurant=' + encodeURIComponent(cfg.restaurantId) +
        '&embed=true' +
        '&tab=' + encodeURIComponent(cfg.defaultTab);

      if (cfg.promo) {
        url += '&promo=' + encodeURIComponent(cfg.promo);
      }

      iframe.src = url;
    },

    // =========================================================
    // Handle postMessage from iframe
    // =========================================================
    _handleMessage: function(event) {
      if (!event.data || typeof event.data.type !== 'string') return;
      if (event.data.type.indexOf('koda-') !== 0) return;

      var data = event.data;
      var cfg = this._config;

      switch (data.type) {
        case 'koda-embed-ready':
          if (cfg.onReady) cfg.onReady();
          break;

        case 'koda-auth-change':
          if (cfg.onAuthChange) cfg.onAuthChange(data);
          // Update account tab label
          if (this._instance) {
            var accountTab = this._instance.querySelector('.kc-tab[data-tab="account"]');
            if (accountTab) {
              accountTab.textContent = data.authenticated ? 'My Account' : 'Sign In';
            }
          }
          break;

        case 'koda-cart-update':
          if (cfg.onCartUpdate) cfg.onCartUpdate(data);
          // Update cart badge
          if (this._instance && data.count !== undefined) {
            var badge = this._instance.querySelector('.kc-cart-badge');
            if (badge) {
              if (data.count > 0) {
                badge.textContent = data.count;
                badge.style.display = 'inline-flex';
              } else {
                badge.style.display = 'none';
              }
            }
          }
          break;

        case 'koda-order-placed':
          if (cfg.onOrderPlaced) cfg.onOrderPlaced(data);
          break;

        case 'koda-tab-change':
          // Sync tab state from iframe navigation
          if (this._instance && data.tab) {
            var allTabs = this._instance.querySelectorAll('.kc-tab');
            for (var i = 0; i < allTabs.length; i++) {
              allTabs[i].classList.toggle('active', allTabs[i].getAttribute('data-tab') === data.tab);
            }
          }
          break;
      }
    },

    // =========================================================
    // Inject styles
    // =========================================================
    _injectStyles: function() {
      if (document.getElementById('kc-widget-styles')) return;

      var primaryColor = this._config.primaryColor || '#2c3e50';

      var css = '' +
        ':root { --kc-primary: ' + primaryColor + '; }' +

        /* Reset within widget */
        '.kc-widget *, .kc-drawer *, .kc-float-btn * { box-sizing: border-box; }' +

        /* ---- INLINE MODE ---- */
        '.kc-widget-inline {' +
          'border: 1px solid #e0e0e0;' +
          'border-radius: 12px;' +
          'overflow: hidden;' +
          'background: #fff;' +
          'box-shadow: 0 2px 20px rgba(0,0,0,0.08);' +
        '}' +
        '.kc-widget-inline .kc-body { height: 600px; }' +

        /* ---- PAGE MODE ---- */
        '.kc-widget-page {' +
          'width: 100%;' +
          'background: #fff;' +
        '}' +
        '.kc-widget-page .kc-body { height: 700px; }' +

        /* ---- HEADER ---- */
        '.kc-header {' +
          'display: flex;' +
          'align-items: center;' +
          'justify-content: space-between;' +
          'padding: 8px 12px;' +
          'background: var(--kc-primary);' +
          'color: #fff;' +
          'min-height: 44px;' +
          'gap: 8px;' +
          'flex-shrink: 0;' +
        '}' +
        '.kc-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }' +

        /* ---- TABS ---- */
        '.kc-tabs { display: flex; gap: 2px; flex: 1; flex-wrap: wrap; }' +
        '.kc-tab {' +
          'padding: 8px 16px;' +
          'background: transparent;' +
          'border: none;' +
          'color: rgba(255,255,255,0.7);' +
          'cursor: pointer;' +
          'font-size: 0.88rem;' +
          'font-weight: 500;' +
          'border-radius: 6px;' +
          'transition: all 0.2s;' +
          'white-space: nowrap;' +
        '}' +
        '.kc-tab:hover { color: #fff; background: rgba(255,255,255,0.12); }' +
        '.kc-tab.active { color: #fff; background: rgba(255,255,255,0.2); font-weight: 600; }' +

        /* ---- CART BADGE ---- */
        '.kc-cart-badge {' +
          'display: inline-flex;' +
          'align-items: center;' +
          'justify-content: center;' +
          'min-width: 22px;' +
          'height: 22px;' +
          'padding: 0 6px;' +
          'border-radius: 11px;' +
          'background: #e74c3c;' +
          'color: #fff;' +
          'font-size: 0.75rem;' +
          'font-weight: 700;' +
        '}' +

        /* ---- BODY (iframe container) ---- */
        '.kc-body {' +
          'width: 100%;' +
          'position: relative;' +
        '}' +
        '.kc-iframe {' +
          'width: 100%;' +
          'height: 100%;' +
          'border: none;' +
          'display: block;' +
        '}' +

        /* ---- CLOSE BUTTON ---- */
        '.kc-close-btn {' +
          'background: none;' +
          'border: none;' +
          'color: #fff;' +
          'font-size: 1.5rem;' +
          'cursor: pointer;' +
          'padding: 0 4px;' +
          'line-height: 1;' +
          'opacity: 0.8;' +
        '}' +
        '.kc-close-btn:hover { opacity: 1; }' +

        /* ---- FLOAT BUTTON ---- */
        '.kc-float-btn {' +
          'position: fixed;' +
          'bottom: 20px;' +
          'right: 20px;' +
          'padding: 14px 24px;' +
          'background: var(--kc-primary);' +
          'color: #fff;' +
          'border: none;' +
          'border-radius: 50px;' +
          'cursor: pointer;' +
          'font-size: 1rem;' +
          'font-weight: 600;' +
          'display: flex;' +
          'align-items: center;' +
          'gap: 8px;' +
          'box-shadow: 0 4px 24px rgba(0,0,0,0.25);' +
          'z-index: 99998;' +
          'transition: all 0.3s;' +
        '}' +
        '.kc-float-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(0,0,0,0.3); }' +
        '.kc-float-btn-active { opacity: 0.5; }' +
        '.kc-float-icon { display: flex; align-items: center; }' +

        /* ---- DRAWER OVERLAY ---- */
        '.kc-drawer-overlay {' +
          'position: fixed;' +
          'top: 0; left: 0; right: 0; bottom: 0;' +
          'background: rgba(0,0,0,0.4);' +
          'z-index: 99999;' +
        '}' +

        /* ---- DRAWER ---- */
        '.kc-drawer {' +
          'position: fixed;' +
          'top: 80px; right: 10px; bottom: 10px;' +
          'width: 420px;' +
          'max-width: calc(100vw - 20px);' +
          'background: #fff;' +
          'border-radius: 16px;' +
          'box-shadow: 0 8px 40px rgba(0,0,0,0.2);' +
          'z-index: 100000;' +
          'display: flex;' +
          'flex-direction: column;' +
          'overflow: hidden;' +
          'animation: kc-slide-in 0.3s ease;' +
        '}' +
        '.kc-drawer .kc-body { flex: 1; min-height: 0; }' +
        '.kc-drawer .kc-tabs { justify-content: center; }' +

        '.kc-resize-handle {' +
          'position: absolute;' +
          'top: 0;' +
          'left: 0;' +
          'width: 24px;' +
          'height: 24px;' +
          'cursor: nw-resize;' +
          'z-index: 10;' +
          'border-radius: 16px 0 0 0;' +
        '}' +
        '.kc-resize-handle::after {' +
          'content: "";' +
          'position: absolute;' +
          'top: 6px;' +
          'left: 6px;' +
          'width: 8px;' +
          'height: 8px;' +
          'border-top: 2px solid rgba(255,255,255,0.5);' +
          'border-left: 2px solid rgba(255,255,255,0.5);' +
        '}' +
        '.kc-resize-handle:hover::after {' +
          'border-color: rgba(255,255,255,0.9);' +
        '}' +

        '@keyframes kc-slide-in {' +
          'from { transform: translateX(100%); opacity: 0; }' +
          'to { transform: translateX(0); opacity: 1; }' +
        '}' +

        /* ---- RESPONSIVE ---- */
        '@media (max-width: 480px) {' +
          '.kc-drawer { top: 12px; right: 6px; bottom: 6px; left: 6px; width: auto; max-width: 100%; border-radius: 12px; }' +
          '.kc-tab { padding: 7px 12px; font-size: 0.8rem; }' +
          '.kc-tabs { justify-content: center; }' +
          '.kc-float-btn { bottom: 14px; right: 14px; padding: 12px 20px; font-size: 0.9rem; }' +
          '.kc-resize-handle { display: none !important; }' +
        '}' +
        '';

      var style = document.createElement('style');
      style.id = 'kc-widget-styles';
      style.textContent = css;
      document.head.appendChild(style);
    }
  };
})();
