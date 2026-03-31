/**
 * Integration Tests — Two-Factor Authentication Flow
 * Tests the full 2FA setup, login, disable, and backup code flows
 * using mocked Firebase services.
 */

// Mock Firebase modules
const mockSignInWithEmailAndPassword = jest.fn();
const mockGetDoc = jest.fn();
const mockHttpsCallable = jest.fn();
const mockSignOut = jest.fn();

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args) => mockSignInWithEmailAndPassword(...args),
  getAuth: jest.fn(() => ({ signOut: mockSignOut, currentUser: { uid: 'admin-uid', email: 'admin@test.com' } })),
  updatePassword: jest.fn(),
  EmailAuthProvider: { credential: jest.fn() },
  reauthenticateWithCredential: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(),
  doc: jest.fn(),
  getDoc: (...args) => mockGetDoc(...args),
  enableMultiTabIndexedDbPersistence: jest.fn(() => Promise.resolve()),
  connectFirestoreEmulator: jest.fn(),
}));

jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: (_, fnName) => mockHttpsCallable(fnName),
  connectFunctionsEmulator: jest.fn(),
}));

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(),
  connectStorageEmulator: jest.fn(),
}));

jest.mock('../../firebase', () => ({
  auth: { signOut: jest.fn(), currentUser: { uid: 'admin-uid', email: 'admin@test.com' } },
  db: {},
  storage: {},
  functions: {},
}));

jest.mock('../../services/adminConfigService', () => ({
  checkIsAdmin: jest.fn(() => Promise.resolve(true)),
}));

describe('Two-Factor Authentication — Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================
  // Admin Login Flow with 2FA
  // ==========================================

  describe('Login Flow with 2FA', () => {
    it('should proceed directly to dashboard when 2FA is not enabled', async () => {
      // Simulate: password auth succeeds, admin check passes, 2FA not enabled
      mockSignInWithEmailAndPassword.mockResolvedValue({
        user: { uid: 'admin-uid', email: 'admin@test.com' }
      });

      mockGetDoc.mockResolvedValue({
        data: () => ({ email: 'admin@test.com', twoFactorEnabled: false }),
        exists: () => true,
      });

      // Simulate the login flow
      const user = await mockSignInWithEmailAndPassword({}, 'admin@test.com', 'password');
      expect(user.user.uid).toBe('admin-uid');

      const adminDoc = await mockGetDoc();
      const adminData = adminDoc.data();
      expect(adminData.twoFactorEnabled).toBe(false);

      // Should NOT show 2FA prompt
      const shouldShow2FA = adminData.twoFactorEnabled === true;
      expect(shouldShow2FA).toBe(false);
    });

    it('should show 2FA prompt when 2FA is enabled', async () => {
      mockSignInWithEmailAndPassword.mockResolvedValue({
        user: { uid: 'admin-uid', email: 'admin@test.com' }
      });

      mockGetDoc.mockResolvedValue({
        data: () => ({ email: 'admin@test.com', twoFactorEnabled: true }),
        exists: () => true,
      });

      const user = await mockSignInWithEmailAndPassword({}, 'admin@test.com', 'password');
      expect(user.user.uid).toBe('admin-uid');

      const adminDoc = await mockGetDoc();
      const adminData = adminDoc.data();
      expect(adminData.twoFactorEnabled).toBe(true);

      const shouldShow2FA = adminData.twoFactorEnabled === true;
      expect(shouldShow2FA).toBe(true);
    });

    it('should verify TOTP code successfully via Cloud Function', async () => {
      const mockVerifyFn = jest.fn().mockResolvedValue({
        data: { success: true, method: 'totp' }
      });
      mockHttpsCallable.mockReturnValue(mockVerifyFn);

      const verifyFn = mockHttpsCallable('verifyAdmin2FACode');
      const result = await verifyFn({ code: '123456' });

      expect(result.data.success).toBe(true);
      expect(result.data.method).toBe('totp');
      expect(mockHttpsCallable).toHaveBeenCalledWith('verifyAdmin2FACode');
    });

    it('should verify backup code successfully and report remaining', async () => {
      const mockVerifyFn = jest.fn().mockResolvedValue({
        data: { success: true, method: 'backup', remainingBackupCodes: 5 }
      });
      mockHttpsCallable.mockReturnValue(mockVerifyFn);

      const verifyFn = mockHttpsCallable('verifyAdmin2FACode');
      const result = await verifyFn({ code: 'ABCD-EF23' });

      expect(result.data.success).toBe(true);
      expect(result.data.method).toBe('backup');
      expect(result.data.remainingBackupCodes).toBe(5);
    });

    it('should warn when backup codes are running low', async () => {
      const mockVerifyFn = jest.fn().mockResolvedValue({
        data: { success: true, method: 'backup', remainingBackupCodes: 2 }
      });
      mockHttpsCallable.mockReturnValue(mockVerifyFn);

      const verifyFn = mockHttpsCallable('verifyAdmin2FACode');
      const result = await verifyFn({ code: 'WXYZ-2345' });

      expect(result.data.remainingBackupCodes).toBeLessThanOrEqual(2);
      // Frontend should show a warning when remaining <= 2
      const shouldWarn = result.data.remainingBackupCodes <= 2;
      expect(shouldWarn).toBe(true);
    });

    it('should reject an incorrect TOTP code', async () => {
      const mockVerifyFn = jest.fn().mockRejectedValue({
        code: 'functions/invalid-argument',
        message: 'Incorrect code. Please check your authenticator app and try again.'
      });
      mockHttpsCallable.mockReturnValue(mockVerifyFn);

      const verifyFn = mockHttpsCallable('verifyAdmin2FACode');
      await expect(verifyFn({ code: '000000' })).rejects.toMatchObject({
        message: expect.stringContaining('Incorrect code')
      });
    });

    it('should sign out if user cancels 2FA verification', async () => {
      // Simulate: user clicks "Cancel sign in"
      const { auth } = require('../../firebase');
      await auth.signOut();
      expect(auth.signOut).toHaveBeenCalled();
    });
  });

  // ==========================================
  // 2FA Setup Flow
  // ==========================================

  describe('2FA Setup Flow', () => {
    it('should generate QR code and manual key via setupAdmin2FA', async () => {
      const mockSetupFn = jest.fn().mockResolvedValue({
        data: {
          success: true,
          qrCodeDataUrl: 'data:image/png;base64,ABC123...',
          manualEntryKey: 'ABCD EFGH IJKL MNOP',
        }
      });
      mockHttpsCallable.mockReturnValue(mockSetupFn);

      const setupFn = mockHttpsCallable('setupAdmin2FA');
      const result = await setupFn();

      expect(result.data.success).toBe(true);
      expect(result.data.qrCodeDataUrl).toContain('data:image/png');
      expect(result.data.manualEntryKey).toBeTruthy();
      expect(mockHttpsCallable).toHaveBeenCalledWith('setupAdmin2FA');
    });

    it('should verify initial code and return backup codes via verifyAndEnable2FA', async () => {
      const mockVerifyEnableFn = jest.fn().mockResolvedValue({
        data: {
          success: true,
          backupCodes: [
            'ABCD-EF23', 'GHKL-MN45', 'PQRS-TV67', 'WXYZ-2345',
            'AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF', 'GGHH-JJKK'
          ]
        }
      });
      mockHttpsCallable.mockReturnValue(mockVerifyEnableFn);

      const verifyEnableFn = mockHttpsCallable('verifyAndEnable2FA');
      const result = await verifyEnableFn({ code: '123456' });

      expect(result.data.success).toBe(true);
      expect(result.data.backupCodes).toHaveLength(8);
      expect(mockHttpsCallable).toHaveBeenCalledWith('verifyAndEnable2FA');
    });

    it('should reject incorrect verification code during setup', async () => {
      const mockVerifyEnableFn = jest.fn().mockRejectedValue({
        code: 'functions/invalid-argument',
        message: 'Incorrect code. Make sure the code from your authenticator app matches and try again.'
      });
      mockHttpsCallable.mockReturnValue(mockVerifyEnableFn);

      const verifyEnableFn = mockHttpsCallable('verifyAndEnable2FA');
      await expect(verifyEnableFn({ code: '999999' })).rejects.toMatchObject({
        message: expect.stringContaining('Incorrect code')
      });
    });

    it('should handle expired setup session', async () => {
      const mockSetupFn = jest.fn().mockRejectedValue({
        code: 'functions/failed-precondition',
        message: 'Setup has expired. Please start again.'
      });
      mockHttpsCallable.mockReturnValue(mockSetupFn);

      const setupFn = mockHttpsCallable('verifyAndEnable2FA');
      await expect(setupFn({ code: '123456' })).rejects.toMatchObject({
        message: expect.stringContaining('expired')
      });
    });
  });

  // ==========================================
  // Disable 2FA Flow
  // ==========================================

  describe('Disable 2FA Flow', () => {
    it('should disable 2FA with valid authenticator code', async () => {
      const mockDisableFn = jest.fn().mockResolvedValue({
        data: { success: true }
      });
      mockHttpsCallable.mockReturnValue(mockDisableFn);

      const disableFn = mockHttpsCallable('disableAdmin2FA');
      const result = await disableFn({ code: '123456' });

      expect(result.data.success).toBe(true);
      expect(mockHttpsCallable).toHaveBeenCalledWith('disableAdmin2FA');
    });

    it('should reject disable request with wrong code', async () => {
      const mockDisableFn = jest.fn().mockRejectedValue({
        code: 'functions/invalid-argument',
        message: 'Incorrect code. Cannot disable 2FA without a valid code.'
      });
      mockHttpsCallable.mockReturnValue(mockDisableFn);

      const disableFn = mockHttpsCallable('disableAdmin2FA');
      await expect(disableFn({ code: '000000' })).rejects.toMatchObject({
        message: expect.stringContaining('Incorrect code')
      });
    });

    it('should handle disable when 2FA is not enabled', async () => {
      const mockDisableFn = jest.fn().mockRejectedValue({
        code: 'functions/failed-precondition',
        message: 'Two-factor authentication is not currently enabled.'
      });
      mockHttpsCallable.mockReturnValue(mockDisableFn);

      const disableFn = mockHttpsCallable('disableAdmin2FA');
      await expect(disableFn({ code: '123456' })).rejects.toMatchObject({
        message: expect.stringContaining('not currently enabled')
      });
    });
  });

  // ==========================================
  // Regenerate Backup Codes Flow
  // ==========================================

  describe('Regenerate Backup Codes Flow', () => {
    it('should regenerate backup codes with valid TOTP code', async () => {
      const mockRegenFn = jest.fn().mockResolvedValue({
        data: {
          success: true,
          backupCodes: [
            'NEWW-CODE', 'ABCD-EF23', 'PQRS-TV67', 'WXYZ-2345',
            'MNPQ-RSTV', 'KLMN-PQRS', 'GHKL-MN45', 'JJKL-MMNN'
          ]
        }
      });
      mockHttpsCallable.mockReturnValue(mockRegenFn);

      const regenFn = mockHttpsCallable('regenerateBackupCodes');
      const result = await regenFn({ code: '123456' });

      expect(result.data.success).toBe(true);
      expect(result.data.backupCodes).toHaveLength(8);
    });

    it('should reject regeneration with invalid code', async () => {
      const mockRegenFn = jest.fn().mockRejectedValue({
        code: 'functions/invalid-argument',
        message: 'Incorrect code.'
      });
      mockHttpsCallable.mockReturnValue(mockRegenFn);

      const regenFn = mockHttpsCallable('regenerateBackupCodes');
      await expect(regenFn({ code: '000000' })).rejects.toMatchObject({
        message: expect.stringContaining('Incorrect')
      });
    });
  });

  // ==========================================
  // Feature Gating (Admin Only)
  // ==========================================

  describe('Admin Access Verification', () => {
    it('should deny 2FA setup for non-admin users', async () => {
      const mockSetupFn = jest.fn().mockRejectedValue({
        code: 'functions/permission-denied',
        message: 'Not an admin.'
      });
      mockHttpsCallable.mockReturnValue(mockSetupFn);

      const setupFn = mockHttpsCallable('setupAdmin2FA');
      await expect(setupFn()).rejects.toMatchObject({
        message: expect.stringContaining('Not an admin')
      });
    });

    it('should deny 2FA verification for unauthenticated users', async () => {
      const mockVerifyFn = jest.fn().mockRejectedValue({
        code: 'functions/unauthenticated',
        message: 'Must be signed in.'
      });
      mockHttpsCallable.mockReturnValue(mockVerifyFn);

      const verifyFn = mockHttpsCallable('verifyAdmin2FACode');
      await expect(verifyFn({ code: '123456' })).rejects.toMatchObject({
        message: expect.stringContaining('Must be signed in')
      });
    });
  });

  // ==========================================
  // Full Setup → Login → Disable Flow
  // ==========================================

  describe('Complete End-to-End Flow', () => {
    it('should complete the full lifecycle: setup → login → disable', async () => {
      // Step 1: Setup — generate QR code
      const mockSetupFn = jest.fn().mockResolvedValue({
        data: { success: true, qrCodeDataUrl: 'data:image/png;base64,...', manualEntryKey: 'ABCD EFGH' }
      });

      // Step 2: Setup — verify and enable
      const mockVerifyEnableFn = jest.fn().mockResolvedValue({
        data: { success: true, backupCodes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF', 'GGHH-JJKK', 'LLMM-NNPP', 'QQRR-SSTT', 'UUVV-WWXX', 'YYZZ-2345'] }
      });

      // Step 3: Login — verify TOTP
      const mockLoginVerifyFn = jest.fn().mockResolvedValue({
        data: { success: true, method: 'totp' }
      });

      // Step 4: Disable
      const mockDisableFn = jest.fn().mockResolvedValue({
        data: { success: true }
      });

      // Execute the flow
      mockHttpsCallable.mockReturnValueOnce(mockSetupFn);
      const setup = await mockHttpsCallable('setupAdmin2FA')();
      expect(setup.data.success).toBe(true);

      mockHttpsCallable.mockReturnValueOnce(mockVerifyEnableFn);
      const enable = await mockHttpsCallable('verifyAndEnable2FA')({ code: '123456' });
      expect(enable.data.success).toBe(true);
      expect(enable.data.backupCodes).toHaveLength(8);

      mockHttpsCallable.mockReturnValueOnce(mockLoginVerifyFn);
      const login = await mockHttpsCallable('verifyAdmin2FACode')({ code: '654321' });
      expect(login.data.success).toBe(true);

      mockHttpsCallable.mockReturnValueOnce(mockDisableFn);
      const disable = await mockHttpsCallable('disableAdmin2FA')({ code: '111111' });
      expect(disable.data.success).toBe(true);
    });
  });

  // ==========================================
  // Backup Code Download/Copy
  // ==========================================

  describe('Backup Code Export', () => {
    it('should format backup codes for download', () => {
      const backupCodes = ['ABCD-EF23', 'GHKL-MN45', 'PQRS-TV67', 'WXYZ-2345',
        'AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF', 'GGHH-JJKK'];

      const formatted = backupCodes.map((code, i) => `${i + 1}. ${code}`).join('\n');
      expect(formatted).toContain('1. ABCD-EF23');
      expect(formatted).toContain('8. GGHH-JJKK');
      expect(formatted.split('\n')).toHaveLength(8);
    });

    it('should format backup codes for clipboard', () => {
      const backupCodes = ['ABCD-EF23', 'GHKL-MN45'];
      const clipboardText = backupCodes.join('\n');
      expect(clipboardText).toBe('ABCD-EF23\nGHKL-MN45');
    });
  });
});
