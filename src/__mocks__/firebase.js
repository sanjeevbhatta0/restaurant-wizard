/**
 * Firebase Mock
 * Provides mock implementations for all Firebase services used in the app.
 */

// ==========================================
// Firestore Mock
// ==========================================

const mockFirestoreData = {};

const mockAddDoc = jest.fn().mockResolvedValue({ id: 'mock-doc-id' });
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockSetDoc = jest.fn().mockResolvedValue(undefined);
const mockGetDoc = jest.fn().mockResolvedValue({
  exists: () => true,
  data: () => ({}),
  id: 'mock-doc-id'
});
const mockGetDocs = jest.fn().mockResolvedValue({
  docs: [],
  empty: true,
  size: 0
});
const mockDeleteDoc = jest.fn().mockResolvedValue(undefined);

const mockOnSnapshot = jest.fn((query, callback, errorCallback) => {
  // Default: call callback with empty snapshot
  if (typeof callback === 'function') {
    callback({
      docs: [],
      empty: true,
      size: 0,
      metadata: { hasPendingWrites: false }
    });
  }
  // Return unsubscribe function
  return jest.fn();
});

const mockCollection = jest.fn((db, path) => ({ path, type: 'collection' }));
const mockDoc = jest.fn((db, path) => ({ path, type: 'doc' }));
const mockQuery = jest.fn((...args) => ({ type: 'query', args }));
const mockWhere = jest.fn((field, op, value) => ({ type: 'where', field, op, value }));
const mockOrderBy = jest.fn((field, direction) => ({ type: 'orderBy', field, direction }));
const mockLimit = jest.fn((n) => ({ type: 'limit', n }));
const mockServerTimestamp = jest.fn(() => new Date().toISOString());

const db = { type: 'firestore' };

// ==========================================
// Auth Mock
// ==========================================

const mockSignInWithEmailAndPassword = jest.fn().mockResolvedValue({
  user: { uid: 'test-user-id', email: 'test@test.com' }
});
const mockCreateUserWithEmailAndPassword = jest.fn().mockResolvedValue({
  user: { uid: 'test-user-id', email: 'test@test.com' }
});
const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockOnAuthStateChanged = jest.fn((auth, callback) => {
  callback(null);
  return jest.fn();
});

const auth = { type: 'auth' };

// ==========================================
// Storage Mock
// ==========================================

const storage = { type: 'storage' };

// ==========================================
// Functions Mock
// ==========================================

const functions = { type: 'functions' };
const mockHttpsCallable = jest.fn(() => jest.fn().mockResolvedValue({ data: {} }));

export {
  db,
  auth,
  storage,
  functions,
  mockAddDoc,
  mockUpdateDoc,
  mockSetDoc,
  mockGetDoc,
  mockGetDocs,
  mockDeleteDoc,
  mockOnSnapshot,
  mockCollection,
  mockDoc,
  mockQuery,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockServerTimestamp,
  mockSignInWithEmailAndPassword,
  mockCreateUserWithEmailAndPassword,
  mockSignOut,
  mockOnAuthStateChanged,
  mockHttpsCallable,
  mockFirestoreData
};

export default { type: 'app' };
