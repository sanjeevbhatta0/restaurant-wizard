/**
 * Unit Tests — AuthContext
 *
 * Covers the central session provider:
 *   - anonymous (signed-out) state
 *   - signed-in owner state (no staff claims)
 *   - signed-in staff state (with custom claims)
 *   - loading gate
 *   - subscription cleanup on unmount
 *   - token claim fetch failure falls back to non-staff
 *   - restaurantUid derivation (owner vs staff)
 */

const React = require('react');
const { render, act } = require('@testing-library/react');

// Capture the callback passed to onAuthStateChanged so tests can drive it.
let capturedAuthCallback = null;
const mockUnsubscribe = jest.fn();
const mockOnAuthStateChanged = jest.fn((_auth, cb) => {
  capturedAuthCallback = cb;
  return mockUnsubscribe;
});

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args) => mockOnAuthStateChanged(...args),
}));

jest.mock('../../firebase', () => ({
  auth: { _marker: 'mock-auth' },
}));

const { AuthProvider, useAuth } = require('../../contexts/AuthContext');

function Consumer({ onRender }) {
  const value = useAuth();
  onRender(value);
  return React.createElement('div', { 'data-testid': 'consumer' }, 'ok');
}

describe('AuthContext', () => {
  let lastValue;
  const capture = (v) => { lastValue = v; };

  beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;
    lastValue = null;
    // Re-install impl — clearAllMocks wipes the one passed to jest.fn(impl).
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      capturedAuthCallback = cb;
      return mockUnsubscribe;
    });
  });

  it('registers an onAuthStateChanged listener on mount', async () => {
    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(typeof capturedAuthCallback).toBe('function');
  });

  it('does not render children while loading (before first auth callback)', async () => {
    let result;
    await act(async () => {
      result = render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    // Loading gate hides children; consumer never called.
    expect(result.queryByTestId('consumer')).toBeNull();
    expect(lastValue).toBeNull();
  });

  it('exposes signed-out defaults when no user is authenticated', async () => {
    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => {
      await capturedAuthCallback(null);
    });

    expect(lastValue).toEqual({
      currentUser: null,
      loading: false,
      isStaff: false,
      staffPermissions: [],
      staffRestaurantId: null,
      restaurantUid: undefined,
    });
  });

  it('derives restaurantUid from currentUser.uid for restaurant owners', async () => {
    const owner = {
      uid: 'owner-123',
      email: 'owner@test.com',
      getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }),
    };

    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => { await capturedAuthCallback(owner); });

    expect(lastValue.currentUser).toBe(owner);
    expect(lastValue.isStaff).toBe(false);
    expect(lastValue.staffPermissions).toEqual([]);
    expect(lastValue.staffRestaurantId).toBe(null);
    expect(lastValue.restaurantUid).toBe('owner-123');
  });

  it('picks up staff custom claims and exposes staff-scoped state', async () => {
    const staff = {
      uid: 'staff-456',
      email: 'cook@test.com',
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: {
          isStaff: true,
          permissions: ['pos', 'kitchen'],
          restaurantId: 'owner-123',
        },
      }),
    };

    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => { await capturedAuthCallback(staff); });

    expect(lastValue.isStaff).toBe(true);
    expect(lastValue.staffPermissions).toEqual(['pos', 'kitchen']);
    expect(lastValue.staffRestaurantId).toBe('owner-123');
    // Staff's restaurantUid points at the owner, NOT the staff uid.
    expect(lastValue.restaurantUid).toBe('owner-123');
  });

  it('defaults permissions to [] when isStaff claim is present without permissions', async () => {
    const staff = {
      uid: 'staff-789',
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: { isStaff: true, restaurantId: 'owner-xyz' },
      }),
    };

    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => { await capturedAuthCallback(staff); });

    expect(lastValue.isStaff).toBe(true);
    expect(lastValue.staffPermissions).toEqual([]);
    expect(lastValue.staffRestaurantId).toBe('owner-xyz');
  });

  it('falls back to non-staff when getIdTokenResult throws', async () => {
    const user = {
      uid: 'user-err',
      getIdTokenResult: jest.fn().mockRejectedValue(new Error('token revoked')),
    };

    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => { await capturedAuthCallback(user); });

    expect(lastValue.currentUser).toBe(user);
    expect(lastValue.isStaff).toBe(false);
    expect(lastValue.staffPermissions).toEqual([]);
    expect(lastValue.staffRestaurantId).toBe(null);
    // With isStaff=false, restaurantUid falls back to currentUser.uid
    expect(lastValue.restaurantUid).toBe('user-err');
  });

  it('clears staff state when a staff user signs out', async () => {
    const staff = {
      uid: 'staff-777',
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: { isStaff: true, permissions: ['pos'], restaurantId: 'owner-A' },
      }),
    };

    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => { await capturedAuthCallback(staff); });
    expect(lastValue.isStaff).toBe(true);

    // Sign out
    await act(async () => { await capturedAuthCallback(null); });
    expect(lastValue.currentUser).toBe(null);
    expect(lastValue.isStaff).toBe(false);
    expect(lastValue.staffPermissions).toEqual([]);
    expect(lastValue.staffRestaurantId).toBe(null);
    expect(lastValue.restaurantUid).toBeUndefined();
  });

  it('transitions staff → owner cleanly on auth state change', async () => {
    const staff = {
      uid: 'staff-1',
      getIdTokenResult: jest.fn().mockResolvedValue({
        claims: { isStaff: true, permissions: ['pos'], restaurantId: 'owner-A' },
      }),
    };
    const owner = {
      uid: 'owner-B',
      getIdTokenResult: jest.fn().mockResolvedValue({ claims: {} }),
    };

    await act(async () => {
      render(React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture })));
    });
    await act(async () => { await capturedAuthCallback(staff); });
    expect(lastValue.restaurantUid).toBe('owner-A');

    await act(async () => { await capturedAuthCallback(owner); });
    expect(lastValue.isStaff).toBe(false);
    expect(lastValue.restaurantUid).toBe('owner-B');
  });

  it('unsubscribes from onAuthStateChanged on unmount', async () => {
    let result;
    await act(async () => {
      result = render(
        React.createElement(AuthProvider, {}, React.createElement(Consumer, { onRender: capture }))
      );
    });
    await act(async () => { await capturedAuthCallback(null); });
    result.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
