import React, { useContext, useState, useEffect, createContext } from 'react';
import { auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isStaff, setIsStaff] = useState(false);
  const [staffPermissions, setStaffPermissions] = useState([]);
  const [staffRestaurantId, setStaffRestaurantId] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        // Check for staff custom claims
        try {
          const tokenResult = await user.getIdTokenResult();
          const claims = tokenResult.claims;
          if (claims.isStaff) {
            setIsStaff(true);
            setStaffPermissions(claims.permissions || []);
            setStaffRestaurantId(claims.restaurantId || null);
          } else {
            setIsStaff(false);
            setStaffPermissions([]);
            setStaffRestaurantId(null);
          }
        } catch {
          setIsStaff(false);
          setStaffPermissions([]);
          setStaffRestaurantId(null);
        }
      } else {
        setIsStaff(false);
        setStaffPermissions([]);
        setStaffRestaurantId(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // restaurantUid: the restaurant owner's UID for Firestore paths
  // For staff, this is the owner; for owners, this is themselves
  const restaurantUid = isStaff ? staffRestaurantId : currentUser?.uid;

  const value = {
    currentUser,
    loading,
    isStaff,
    staffPermissions,
    staffRestaurantId,
    restaurantUid
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
