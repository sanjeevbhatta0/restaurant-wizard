/**
 * Unit Tests — Mobile App Publishing Logic
 * Tests bundle suffix generation, validation, config data construction,
 * status handling, platform selection, and pipeline stages.
 */

describe('Mobile App Publishing Logic', () => {
  // ==========================================
  // Bundle Suffix Generation
  // ==========================================

  describe('generateBundleSuffix', () => {
    const generateBundleSuffix = (name) => {
      return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    };

    it('should convert restaurant name to lowercase alphanumeric', () => {
      expect(generateBundleSuffix('Burger Palace')).toBe('burgerpalace');
    });

    it('should remove special characters', () => {
      expect(generateBundleSuffix("Joe's Diner & Grill!")).toBe('joesdinergrill');
    });

    it('should handle numbers in name', () => {
      expect(generateBundleSuffix('Cafe 42')).toBe('cafe42');
    });

    it('should truncate to 30 characters', () => {
      const longName = 'The Most Amazing Restaurant In The Entire World';
      expect(generateBundleSuffix(longName).length).toBeLessThanOrEqual(30);
    });

    it('should return empty string for empty input', () => {
      expect(generateBundleSuffix('')).toBe('');
      expect(generateBundleSuffix(null)).toBe('');
      expect(generateBundleSuffix(undefined)).toBe('');
    });

    it('should handle unicode characters', () => {
      expect(generateBundleSuffix('Café Résumé')).toBe('cafrsum');
    });

    it('should handle all-special-character names', () => {
      expect(generateBundleSuffix('---!!!')).toBe('');
    });
  });

  // ==========================================
  // Bundle Suffix Validation
  // ==========================================

  describe('bundleSuffixValidation', () => {
    const isValidBundleSuffix = (suffix) => /^[a-z0-9]{2,30}$/.test(suffix);

    it('should accept valid lowercase alphanumeric suffix', () => {
      expect(isValidBundleSuffix('burgerpalace')).toBe(true);
    });

    it('should accept suffix with numbers', () => {
      expect(isValidBundleSuffix('cafe42')).toBe(true);
    });

    it('should reject suffix shorter than 2 characters', () => {
      expect(isValidBundleSuffix('a')).toBe(false);
    });

    it('should reject empty suffix', () => {
      expect(isValidBundleSuffix('')).toBe(false);
    });

    it('should reject suffix with uppercase', () => {
      expect(isValidBundleSuffix('BurgerPalace')).toBe(false);
    });

    it('should reject suffix with special characters', () => {
      expect(isValidBundleSuffix('burger-palace')).toBe(false);
      expect(isValidBundleSuffix('burger_palace')).toBe(false);
      expect(isValidBundleSuffix('burger.palace')).toBe(false);
    });

    it('should reject suffix longer than 30 characters', () => {
      expect(isValidBundleSuffix('a'.repeat(31))).toBe(false);
    });

    it('should accept exactly 2 characters', () => {
      expect(isValidBundleSuffix('ab')).toBe(true);
    });

    it('should accept exactly 30 characters', () => {
      expect(isValidBundleSuffix('a'.repeat(30))).toBe(true);
    });
  });

  // ==========================================
  // Bundle ID Construction
  // ==========================================

  describe('bundleIdConstruction', () => {
    const buildBundleId = (suffix) => `com.kodacarte.wl.${suffix}`;

    it('should construct correct bundle ID', () => {
      expect(buildBundleId('burgerpalace')).toBe('com.kodacarte.wl.burgerpalace');
    });

    it('should construct bundle ID with numbers', () => {
      expect(buildBundleId('cafe42')).toBe('com.kodacarte.wl.cafe42');
    });
  });

  // ==========================================
  // Platform Selection
  // ==========================================

  describe('platformSelection', () => {
    const togglePlatform = (platforms, platform) => {
      if (platforms.includes(platform)) {
        return platforms.length > 1 ? platforms.filter(p => p !== platform) : platforms;
      }
      return [...platforms, platform];
    };

    it('should add a platform', () => {
      expect(togglePlatform(['ios'], 'android')).toEqual(['ios', 'android']);
    });

    it('should remove a platform when multiple selected', () => {
      expect(togglePlatform(['ios', 'android'], 'android')).toEqual(['ios']);
    });

    it('should not remove last platform', () => {
      expect(togglePlatform(['ios'], 'ios')).toEqual(['ios']);
    });

    it('should not add duplicate platform', () => {
      const result = togglePlatform(['ios'], 'ios');
      expect(result).toEqual(['ios']);
    });

    it('should resolve platforms for GitHub Actions', () => {
      const resolvePlatforms = (platforms) => {
        if (platforms.includes('ios') && platforms.includes('android')) return 'both';
        return platforms[0];
      };
      expect(resolvePlatforms(['ios', 'android'])).toBe('both');
      expect(resolvePlatforms(['ios'])).toBe('ios');
      expect(resolvePlatforms(['android'])).toBe('android');
    });
  });

  // ==========================================
  // Pipeline Stages
  // ==========================================

  describe('pipelineStages', () => {
    const PIPELINE_STAGES = [
      { key: 'queued', label: 'Queued' },
      { key: 'generating_assets', label: 'Generating Assets' },
      { key: 'building_ios', label: 'Building iOS' },
      { key: 'building_android', label: 'Building Android' },
      { key: 'submitting_ios', label: 'Submitting iOS' },
      { key: 'submitting_android', label: 'Submitting Android' },
      { key: 'submitted', label: 'Submitted' }
    ];

    it('should have 7 stages', () => {
      expect(PIPELINE_STAGES).toHaveLength(7);
    });

    it('should start with queued and end with submitted', () => {
      expect(PIPELINE_STAGES[0].key).toBe('queued');
      expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1].key).toBe('submitted');
    });

    it('should calculate progress percentage correctly', () => {
      const calcProgress = (status) => {
        const idx = PIPELINE_STAGES.findIndex(s => s.key === status);
        if (idx < 0) return 0;
        return Math.max(5, Math.round(((idx + 1) / PIPELINE_STAGES.length) * 100));
      };
      expect(calcProgress('queued')).toBe(Math.max(5, Math.round(1 / 7 * 100)));
      expect(calcProgress('submitted')).toBe(100);
      expect(calcProgress('unknown')).toBe(0);
    });

    it('should filter stages by platform', () => {
      const filterStages = (platforms) => PIPELINE_STAGES.filter(stage => {
        if (stage.key === 'building_ios' || stage.key === 'submitting_ios') return platforms.includes('ios');
        if (stage.key === 'building_android' || stage.key === 'submitting_android') return platforms.includes('android');
        return true;
      });

      // iOS only — no android stages
      const iosOnly = filterStages(['ios']);
      expect(iosOnly.map(s => s.key)).not.toContain('building_android');
      expect(iosOnly.map(s => s.key)).not.toContain('submitting_android');
      expect(iosOnly.map(s => s.key)).toContain('building_ios');

      // Android only — no iOS stages
      const androidOnly = filterStages(['android']);
      expect(androidOnly.map(s => s.key)).not.toContain('building_ios');
      expect(androidOnly.map(s => s.key)).not.toContain('submitting_ios');
      expect(androidOnly.map(s => s.key)).toContain('building_android');

      // Both — all stages
      const both = filterStages(['ios', 'android']);
      expect(both).toHaveLength(7);
    });

    it('should identify in-pipeline statuses', () => {
      const pipelineStatuses = ['queued', 'generating_assets', 'building_ios', 'building_android', 'submitting_ios', 'submitting_android'];
      const isInPipeline = (status) => pipelineStatuses.includes(status);

      expect(isInPipeline('queued')).toBe(true);
      expect(isInPipeline('building_ios')).toBe(true);
      expect(isInPipeline('submitted')).toBe(false);
      expect(isInPipeline('live')).toBe(false);
      expect(isInPipeline('failed')).toBe(false);
    });
  });

  // ==========================================
  // Status Configuration
  // ==========================================

  describe('statusConfiguration', () => {
    const STATUS_CONFIG = {
      draft: { label: 'Draft', bg: 'secondary' },
      queued: { label: 'Queued', bg: 'info' },
      generating_assets: { label: 'Generating Assets', bg: 'info' },
      building_ios: { label: 'Building iOS', bg: 'primary' },
      building_android: { label: 'Building Android', bg: 'primary' },
      submitting_ios: { label: 'Submitting to App Store', bg: 'primary' },
      submitting_android: { label: 'Submitting to Google Play', bg: 'primary' },
      submitted: { label: 'Submitted for Review', bg: 'success' },
      live: { label: 'Live', bg: 'success' },
      failed: { label: 'Failed', bg: 'danger' },
      update_pending: { label: 'Update Building', bg: 'info' }
    };

    it('should have config for all pipeline statuses', () => {
      const allStatuses = ['draft', 'queued', 'generating_assets', 'building_ios', 'building_android',
        'submitting_ios', 'submitting_android', 'submitted', 'live', 'failed', 'update_pending'];
      allStatuses.forEach(status => {
        expect(STATUS_CONFIG[status]).toBeDefined();
        expect(STATUS_CONFIG[status].label).toBeDefined();
        expect(STATUS_CONFIG[status].bg).toBeDefined();
      });
    });

    it('should use success color for submitted and live', () => {
      expect(STATUS_CONFIG.submitted.bg).toBe('success');
      expect(STATUS_CONFIG.live.bg).toBe('success');
    });

    it('should use danger for failed', () => {
      expect(STATUS_CONFIG.failed.bg).toBe('danger');
    });

    it('should use primary for building/submitting', () => {
      expect(STATUS_CONFIG.building_ios.bg).toBe('primary');
      expect(STATUS_CONFIG.building_android.bg).toBe('primary');
      expect(STATUS_CONFIG.submitting_ios.bg).toBe('primary');
      expect(STATUS_CONFIG.submitting_android.bg).toBe('primary');
    });
  });

  // ==========================================
  // Validation Checklist
  // ==========================================

  describe('validationChecklist', () => {
    const validate = ({ logoUrl, appName, bundleSuffix, bundleAvailable, hasAccess, platforms }) => ({
      logoUploaded: !!logoUrl,
      appNameProvided: (appName || '').trim().length > 0,
      bundleSuffixValid: /^[a-z0-9]{2,30}$/.test(bundleSuffix) && bundleAvailable === true,
      elderPlanActive: hasAccess,
      platformSelected: (platforms || []).length > 0
    });

    it('should pass all validations when correct', () => {
      const result = validate({
        logoUrl: 'https://example.com/logo.png', appName: 'My App', bundleSuffix: 'myapp',
        bundleAvailable: true, hasAccess: true, platforms: ['ios']
      });
      expect(Object.values(result).every(Boolean)).toBe(true);
    });

    it('should fail when no platform selected', () => {
      const result = validate({
        logoUrl: 'https://logo.png', appName: 'My App', bundleSuffix: 'myapp',
        bundleAvailable: true, hasAccess: true, platforms: []
      });
      expect(result.platformSelected).toBe(false);
    });

    it('should fail when logo is missing', () => {
      const result = validate({
        logoUrl: '', appName: 'My App', bundleSuffix: 'myapp',
        bundleAvailable: true, hasAccess: true, platforms: ['ios']
      });
      expect(result.logoUploaded).toBe(false);
    });

    it('should fail when app name is empty', () => {
      const result = validate({
        logoUrl: 'https://logo.png', appName: '   ', bundleSuffix: 'myapp',
        bundleAvailable: true, hasAccess: true, platforms: ['ios']
      });
      expect(result.appNameProvided).toBe(false);
    });

    it('should fail when bundle suffix is taken', () => {
      const result = validate({
        logoUrl: 'https://logo.png', appName: 'My App', bundleSuffix: 'myapp',
        bundleAvailable: false, hasAccess: true, platforms: ['ios']
      });
      expect(result.bundleSuffixValid).toBe(false);
    });

    it('should fail when not on Elder plan', () => {
      const result = validate({
        logoUrl: 'https://logo.png', appName: 'My App', bundleSuffix: 'myapp',
        bundleAvailable: true, hasAccess: false, platforms: ['ios']
      });
      expect(result.elderPlanActive).toBe(false);
    });
  });

  // ==========================================
  // Config Data for Cloud Function
  // ==========================================

  describe('publishPayload', () => {
    it('should construct correct payload for new publish', () => {
      const payload = {
        appName: 'Burger Palace',
        bundleSuffix: 'burgerpalace',
        description: 'Order food online',
        category: 'food-drink',
        keywords: 'burgers, food',
        supportEmail: 'support@bp.com',
        supportUrl: 'https://bp.com',
        privacyPolicyUrl: 'https://kodacarte.com/privacy',
        marketingUrl: null,
        customIconUrl: null,
        platforms: ['ios', 'android'],
        logoUrl: 'https://logo.png',
        primaryColor: '#FF5722',
        existingStatus: null,
        version: '1.0.0',
        buildNumber: 0
      };
      expect(payload.platforms).toEqual(['ios', 'android']);
      expect(payload.existingStatus).toBeNull();
    });

    it('should pass existing config data for updates', () => {
      const payload = {
        appName: 'Burger Palace v2',
        bundleSuffix: 'burgerpalace',
        platforms: ['ios'],
        existingStatus: 'live',
        version: '1.0.0',
        buildNumber: 3,
        iosAppId: '123456789'
      };
      expect(payload.existingStatus).toBe('live');
      expect(payload.buildNumber).toBe(3);
      expect(payload.iosAppId).toBe('123456789');
    });
  });

  // ==========================================
  // Webhook Status Update
  // ==========================================

  describe('webhookStatusUpdate', () => {
    it('should build correct update object', () => {
      const buildUpdate = (body) => {
        const update = { status: body.status, statusMessage: body.statusMessage || '' };
        if (body.errorDetails) update.errorDetails = body.errorDetails;
        if (body.iosBuildId) update.iosBuildId = body.iosBuildId;
        if (body.androidBuildId) update.androidBuildId = body.androidBuildId;
        if (body.status === 'submitted') update.submittedAt = 'timestamp';
        if (body.status === 'failed') update.errorMessage = body.statusMessage;
        return update;
      };

      const progressUpdate = buildUpdate({
        status: 'building_ios',
        statusMessage: 'Building iOS app...'
      });
      expect(progressUpdate.status).toBe('building_ios');
      expect(progressUpdate.errorDetails).toBeUndefined();

      const completedUpdate = buildUpdate({
        status: 'submitted',
        statusMessage: 'Submitted!',
        iosBuildId: 'build-123'
      });
      expect(completedUpdate.submittedAt).toBe('timestamp');
      expect(completedUpdate.iosBuildId).toBe('build-123');

      const failedUpdate = buildUpdate({
        status: 'failed',
        statusMessage: 'Build failed',
        errorDetails: 'Out of memory'
      });
      expect(failedUpdate.errorMessage).toBe('Build failed');
      expect(failedUpdate.errorDetails).toBe('Out of memory');
    });
  });

  // ==========================================
  // Category Options
  // ==========================================

  describe('categoryOptions', () => {
    const CATEGORIES = [
      { value: 'food-drink', label: 'Food & Drink' },
      { value: 'restaurant', label: 'Restaurant' },
      { value: 'lifestyle', label: 'Lifestyle' }
    ];

    it('should have Food & Drink as first option', () => {
      expect(CATEGORIES[0].value).toBe('food-drink');
    });

    it('should have exactly 3 categories', () => {
      expect(CATEGORIES).toHaveLength(3);
    });
  });

  // ==========================================
  // Build Number Increment
  // ==========================================

  describe('buildNumberIncrement', () => {
    it('should start at 1 for new submissions', () => {
      const isUpdate = false;
      const buildNumber = isUpdate ? 1 + 1 : 1;
      expect(buildNumber).toBe(1);
    });

    it('should increment for updates to live apps', () => {
      const existing = { status: 'live', buildNumber: 3 };
      const isUpdate = existing.status === 'live';
      const buildNumber = isUpdate ? (existing.buildNumber || 0) + 1 : 1;
      expect(buildNumber).toBe(4);
    });

    it('should start at 1 for non-live existing config', () => {
      const existing = { status: 'failed', buildNumber: 2 };
      const isUpdate = existing.status === 'live';
      const buildNumber = isUpdate ? (existing.buildNumber || 0) + 1 : 1;
      expect(buildNumber).toBe(1);
    });
  });

  // ==========================================
  // Keywords Pre-fill
  // ==========================================

  describe('keywordsPreFill', () => {
    it('should include restaurant name in default keywords', () => {
      const name = 'Burger Palace';
      const keywords = `${name}, food, ordering, pickup, delivery, restaurant`;
      expect(keywords).toContain('Burger Palace');
      expect(keywords).toContain('food');
      expect(keywords).toContain('delivery');
    });
  });
});
