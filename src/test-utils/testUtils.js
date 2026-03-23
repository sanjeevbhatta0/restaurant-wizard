/**
 * Test Utilities and Helpers
 * Provides common test wrappers, mock data factories, and render helpers.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ==========================================
// Mock Context Providers
// ==========================================

const defaultAuthValue = {
  currentUser: { uid: 'test-user-id', email: 'test@test.com' },
  loading: false
};

const defaultLocationValue = {
  selectedLocation: 'test-user-id',
  setSelectedLocation: jest.fn(),
  isMultiLocation: false,
  locations: [],
  loadRestaurantData: jest.fn(),
  loading: false
};

const defaultMenuValue = {
  categories: [],
  allCategories: [],
  loading: false,
  refreshMenu: jest.fn(),
  clearCache: jest.fn(),
  lastUpdated: Date.now()
};

const defaultSubscriptionValue = {
  subscription: { tier: 'ally', status: 'active' },
  loading: false,
  getCurrentTier: () => 'ally',
  hasFeatureAccess: () => true,
  isFeaturePreview: () => false,
  getMinimumTierForFeature: () => 'ally',
  canUpgrade: () => true,
  getNextTier: () => 'guide',
  calculatePrice: () => '29.00',
  isSubscriptionActive: () => true,
  getTrialDaysRemaining: () => 0,
  getOrderLimit: () => ({ limit: 500, overageRate: 0.02 }),
  getMenuLimit: () => ({ items: Infinity, reads: Infinity }),
  calculateOverageCharge: () => 0,
  isOverOrderLimit: () => false,
  isOrderHardCapped: () => false,
  TIER_FEATURES: {},
  PRICING: {},
  TRIAL_PERIOD_DAYS: 0,
  ORDER_LIMITS: {},
  MENU_LIMITS: {}
};

// Create mock context modules
const MockAuthContext = React.createContext(defaultAuthValue);
const MockLocationContext = React.createContext(defaultLocationValue);
const MockMenuContext = React.createContext(defaultMenuValue);
const MockSubscriptionContext = React.createContext(defaultSubscriptionValue);

// Provider wrapper for tests
export const createTestWrapper = (overrides = {}) => {
  const authValue = { ...defaultAuthValue, ...overrides.auth };
  const locationValue = { ...defaultLocationValue, ...overrides.location };
  const menuValue = { ...defaultMenuValue, ...overrides.menu };
  const subscriptionValue = { ...defaultSubscriptionValue, ...overrides.subscription };

  return ({ children }) => (
    <MemoryRouter initialEntries={overrides.initialEntries || ['/']}>
      <MockAuthContext.Provider value={authValue}>
        <MockLocationContext.Provider value={locationValue}>
          <MockMenuContext.Provider value={menuValue}>
            <MockSubscriptionContext.Provider value={subscriptionValue}>
              {children}
            </MockSubscriptionContext.Provider>
          </MockMenuContext.Provider>
        </MockLocationContext.Provider>
      </MockAuthContext.Provider>
    </MemoryRouter>
  );
};

// Custom render with providers
export const renderWithProviders = (ui, options = {}) => {
  const Wrapper = createTestWrapper(options);
  return {
    ...render(ui, { wrapper: Wrapper, ...options.renderOptions }),
    // Re-export the override values for assertions
    mockAuth: { ...defaultAuthValue, ...options.auth },
    mockLocation: { ...defaultLocationValue, ...options.location },
    mockMenu: { ...defaultMenuValue, ...options.menu },
    mockSubscription: { ...defaultSubscriptionValue, ...options.subscription }
  };
};

// ==========================================
// Mock Data Factories
// ==========================================

let orderCounter = 0;
let itemCounter = 0;
let categoryCounter = 0;

export const resetCounters = () => {
  orderCounter = 0;
  itemCounter = 0;
  categoryCounter = 0;
};

export const createMockMenuItem = (overrides = {}) => {
  itemCounter++;
  return {
    id: `item-${itemCounter}`,
    name: `Test Item ${itemCounter}`,
    price: 9.99 + itemCounter,
    description: `Description for item ${itemCounter}`,
    categoryId: 'cat-1',
    categoryName: 'Main Course',
    imageUrl: '',
    discount: 0,
    discountType: 'percentage',
    locations: [],
    ...overrides
  };
};

export const createMockCategory = (overrides = {}) => {
  categoryCounter++;
  const items = overrides.items || [
    createMockMenuItem({ categoryId: `cat-${categoryCounter}`, categoryName: `Category ${categoryCounter}` }),
    createMockMenuItem({ categoryId: `cat-${categoryCounter}`, categoryName: `Category ${categoryCounter}` })
  ];

  return {
    id: `cat-${categoryCounter}`,
    name: `Category ${categoryCounter}`,
    items,
    ...overrides
  };
};

export const createMockOrder = (overrides = {}) => {
  orderCounter++;
  const now = new Date();
  return {
    id: `order-${orderCounter}`,
    orderNumber: `ORD-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(orderCounter).padStart(4, '0')}`,
    tableNumber: String(overrides.tableNumber || orderCounter),
    locationId: 'test-user-id',
    items: overrides.items || [
      {
        id: 'item-1',
        name: 'Burger',
        categoryName: 'Main Course',
        price: 12.99,
        originalPrice: 12.99,
        quantity: 1,
        subtotal: 12.99
      },
      {
        id: 'item-2',
        name: 'Fries',
        categoryName: 'Sides',
        price: 4.99,
        originalPrice: 4.99,
        quantity: 2,
        subtotal: 9.98
      }
    ],
    total: overrides.total || 22.97,
    status: overrides.status || 'sent_to_kitchen',
    orderType: overrides.orderType || 'dine_in',
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    ...overrides
  };
};

export const createMockOrderWithStatus = (status, overrides = {}) => {
  return createMockOrder({ status, ...overrides });
};

// ==========================================
// Assertion Helpers
// ==========================================

export const expectOrderStatus = (order, expectedStatus) => {
  expect(order.status).toBe(expectedStatus);
};

export const expectFirestoreUpdate = (mockFn, expectedData) => {
  expect(mockFn).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining(expectedData)
  );
};

// ==========================================
// Timing Helpers
// ==========================================

export const waitForAsync = () => new Promise(resolve => setTimeout(resolve, 0));

export const flushPromises = () => new Promise(resolve => setImmediate(resolve));

// ==========================================
// Exports for context mocking
// ==========================================

export {
  defaultAuthValue,
  defaultLocationValue,
  defaultMenuValue,
  defaultSubscriptionValue,
  MockAuthContext,
  MockLocationContext,
  MockMenuContext,
  MockSubscriptionContext
};
