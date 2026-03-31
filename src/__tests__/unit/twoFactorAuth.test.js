/**
 * Unit Tests — Two-Factor Authentication (TOTP)
 * Tests backup code generation, TOTP code validation logic,
 * setup flow state transitions, and edge cases.
 */

describe('Two-Factor Authentication — Unit Tests', () => {

  // ==========================================
  // Backup Code Generation
  // ==========================================

  describe('Backup Code Generation', () => {
    // Replicate the logic from functions/index.js generateBackupCodes()
    const generateBackupCodes = () => {
      const codes = [];
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
      for (let i = 0; i < 8; i++) {
        let code = '';
        for (let j = 0; j < 8; j++) {
          if (j === 4) code += '-';
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        codes.push(code);
      }
      return codes;
    };

    it('should generate exactly 8 backup codes', () => {
      const codes = generateBackupCodes();
      expect(codes).toHaveLength(8);
    });

    it('should generate codes in XXXX-XXXX format', () => {
      const codes = generateBackupCodes();
      const format = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
      codes.forEach(code => {
        expect(code).toMatch(format);
      });
    });

    it('should not include confusing characters (I, O, 0, 1)', () => {
      const codes = generateBackupCodes();
      codes.forEach(code => {
        expect(code).not.toMatch(/[IO01]/);
      });
    });

    it('should generate unique codes in a set', () => {
      const codes = generateBackupCodes();
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(8);
    });

    it('should generate different codes each time', () => {
      const set1 = generateBackupCodes();
      const set2 = generateBackupCodes();
      // Extremely unlikely that all 8 match
      expect(set1).not.toEqual(set2);
    });
  });

  // ==========================================
  // TOTP Code Validation (Input Sanitization)
  // ==========================================

  describe('TOTP Code Input Validation', () => {
    const isValidTotpCode = (code) => {
      if (!code) return false;
      const trimmed = code.trim();
      return trimmed.length === 6 && /^\d{6}$/.test(trimmed);
    };

    it('should accept a valid 6-digit numeric code', () => {
      expect(isValidTotpCode('123456')).toBe(true);
    });

    it('should accept a code with leading zeros', () => {
      expect(isValidTotpCode('012345')).toBe(true);
    });

    it('should accept a code with whitespace trimmed', () => {
      expect(isValidTotpCode(' 123456 ')).toBe(true);
    });

    it('should reject empty input', () => {
      expect(isValidTotpCode('')).toBe(false);
      expect(isValidTotpCode(null)).toBe(false);
      expect(isValidTotpCode(undefined)).toBe(false);
    });

    it('should reject codes with letters', () => {
      expect(isValidTotpCode('12345a')).toBe(false);
      expect(isValidTotpCode('abcdef')).toBe(false);
    });

    it('should reject codes shorter than 6 digits', () => {
      expect(isValidTotpCode('12345')).toBe(false);
      expect(isValidTotpCode('1')).toBe(false);
    });

    it('should reject codes longer than 6 digits', () => {
      expect(isValidTotpCode('1234567')).toBe(false);
    });

    it('should reject codes with special characters', () => {
      expect(isValidTotpCode('12-456')).toBe(false);
      expect(isValidTotpCode('123.56')).toBe(false);
    });
  });

  // ==========================================
  // Backup Code Validation
  // ==========================================

  describe('Backup Code Validation', () => {
    const isBackupCodeFormat = (code) => {
      if (!code) return false;
      const trimmed = code.trim();
      return trimmed.includes('-') && trimmed.length === 9;
    };

    const validateBackupCode = (code, storedCodes) => {
      if (!isBackupCodeFormat(code)) return { valid: false, reason: 'invalid_format' };
      const upperCode = code.trim().toUpperCase();
      const index = storedCodes.findIndex(bc => bc.code === upperCode && !bc.used);
      if (index === -1) return { valid: false, reason: 'not_found_or_used' };
      return { valid: true, index };
    };

    const storedCodes = [
      { code: 'ABCD-EF23', used: false },
      { code: 'GHKL-MN45', used: false },
      { code: 'PQRS-TV67', used: true },
      { code: 'WXYZ-2345', used: false },
    ];

    it('should validate a correct unused backup code', () => {
      const result = validateBackupCode('ABCD-EF23', storedCodes);
      expect(result.valid).toBe(true);
      expect(result.index).toBe(0);
    });

    it('should reject an already used backup code', () => {
      const result = validateBackupCode('PQRS-TV67', storedCodes);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found_or_used');
    });

    it('should reject a code not in the stored list', () => {
      const result = validateBackupCode('ZZZZ-ZZZZ', storedCodes);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found_or_used');
    });

    it('should be case-insensitive', () => {
      const result = validateBackupCode('abcd-ef23', storedCodes);
      expect(result.valid).toBe(true);
    });

    it('should reject codes in wrong format', () => {
      expect(validateBackupCode('123456', storedCodes).valid).toBe(false);
      expect(validateBackupCode('ABCDEFGH', storedCodes).valid).toBe(false);
      expect(validateBackupCode('', storedCodes).valid).toBe(false);
    });
  });

  // ==========================================
  // Backup Code Consumption Tracking
  // ==========================================

  describe('Backup Code Consumption', () => {
    it('should mark a used code and track remaining count', () => {
      const codes = [
        { code: 'AAAA-BBBB', used: false },
        { code: 'CCCC-DDDD', used: false },
        { code: 'EEEE-FFFF', used: false },
      ];

      // Simulate using the first code
      const useIndex = 0;
      const updated = [...codes];
      updated[useIndex] = { ...updated[useIndex], used: true, usedAt: new Date().toISOString() };

      expect(updated[useIndex].used).toBe(true);
      expect(updated[useIndex].usedAt).toBeDefined();

      const remaining = updated.filter(bc => !bc.used).length;
      expect(remaining).toBe(2);
    });

    it('should correctly count when all codes are used', () => {
      const codes = [
        { code: 'AAAA-BBBB', used: true },
        { code: 'CCCC-DDDD', used: true },
        { code: 'EEEE-FFFF', used: true },
      ];

      const remaining = codes.filter(bc => !bc.used).length;
      expect(remaining).toBe(0);
    });

    it('should warn when remaining codes are low (2 or fewer)', () => {
      const codesWithMostUsed = [
        { code: 'AAAA-BBBB', used: true },
        { code: 'CCCC-DDDD', used: true },
        { code: 'EEEE-FFFF', used: true },
        { code: 'GGHH-JJKK', used: true },
        { code: 'LLMM-NNPP', used: true },
        { code: 'QQRR-SSTT', used: true },
        { code: 'UUVV-WWXX', used: false },
        { code: 'YYZZ-2345', used: false },
      ];

      const remaining = codesWithMostUsed.filter(bc => !bc.used).length;
      expect(remaining).toBe(2);
      expect(remaining <= 2).toBe(true); // Should trigger low-codes warning
    });
  });

  // ==========================================
  // Setup Flow State Transitions
  // ==========================================

  describe('Setup Flow State Transitions', () => {
    const STEPS = { WHY: 1, DOWNLOAD_APP: 2, SCAN_QR: 3, VERIFY: 4, BACKUP: 5 };

    it('should follow the correct step order', () => {
      const stepOrder = [STEPS.WHY, STEPS.DOWNLOAD_APP, STEPS.SCAN_QR, STEPS.VERIFY, STEPS.BACKUP];
      expect(stepOrder).toEqual([1, 2, 3, 4, 5]);
    });

    it('should not allow skipping from step 1 to step 4', () => {
      // Step 3 (QR generation) must happen before step 4 (verify)
      // because the QR code triggers the Cloud Function that generates the secret
      let currentStep = 1;
      const goToStep = (target) => {
        // Can only advance one step at a time (except 2→3 which triggers API)
        if (target === currentStep + 1 || (currentStep === 2 && target === 3)) {
          currentStep = target;
          return true;
        }
        return false;
      };

      expect(goToStep(2)).toBe(true);
      expect(goToStep(4)).toBe(false); // Can't skip step 3
      expect(currentStep).toBe(2);
    });

    it('should allow going back to previous steps', () => {
      let currentStep = 4;
      const goBack = () => {
        if (currentStep > 1) {
          currentStep -= 1;
          return true;
        }
        return false;
      };

      expect(goBack()).toBe(true);
      expect(currentStep).toBe(3);
      expect(goBack()).toBe(true);
      expect(currentStep).toBe(2);
    });
  });

  // ==========================================
  // Pending Secret Expiry Check
  // ==========================================

  describe('Pending Secret Expiry', () => {
    const isExpired = (createdAt, windowMinutes = 10) => {
      const threshold = new Date(Date.now() - windowMinutes * 60 * 1000);
      return createdAt < threshold;
    };

    it('should not be expired if created just now', () => {
      expect(isExpired(new Date())).toBe(false);
    });

    it('should not be expired if created 5 minutes ago', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(isExpired(fiveMinutesAgo)).toBe(false);
    });

    it('should be expired if created 11 minutes ago', () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
      expect(isExpired(elevenMinutesAgo)).toBe(true);
    });

    it('should be expired if created exactly 10 minutes ago', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000 - 1);
      expect(isExpired(tenMinutesAgo)).toBe(true);
    });
  });

  // ==========================================
  // Manual Entry Key Formatting
  // ==========================================

  describe('Manual Entry Key Formatting', () => {
    const formatKey = (secret) => {
      return secret.match(/.{1,4}/g).join(' ');
    };

    it('should format a 16-char secret into groups of 4', () => {
      expect(formatKey('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP');
    });

    it('should format a 32-char secret into groups of 4', () => {
      const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      expect(formatKey(secret)).toBe('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
    });

    it('should handle an odd-length secret', () => {
      expect(formatKey('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
    });
  });

  // ==========================================
  // Code Type Detection (TOTP vs Backup)
  // ==========================================

  describe('Code Type Detection', () => {
    const detectCodeType = (code) => {
      if (!code) return 'invalid';
      const trimmed = code.trim();
      if (trimmed.includes('-') && trimmed.length === 9) return 'backup';
      if (trimmed.length === 6 && /^\d{6}$/.test(trimmed)) return 'totp';
      return 'invalid';
    };

    it('should detect a TOTP code', () => {
      expect(detectCodeType('123456')).toBe('totp');
      expect(detectCodeType('000000')).toBe('totp');
    });

    it('should detect a backup code', () => {
      expect(detectCodeType('ABCD-EF23')).toBe('backup');
      expect(detectCodeType('abcd-ef23')).toBe('backup');
    });

    it('should detect invalid input', () => {
      expect(detectCodeType('')).toBe('invalid');
      expect(detectCodeType('abc')).toBe('invalid');
      expect(detectCodeType('1234567890')).toBe('invalid');
      expect(detectCodeType(null)).toBe('invalid');
    });
  });
});
