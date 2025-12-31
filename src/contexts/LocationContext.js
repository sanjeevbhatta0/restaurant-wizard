import React, { createContext, useContext, useState, useEffect } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';

const LocationContext = createContext();

export function useLocation() {
  return useContext(LocationContext);
}

export function LocationProvider({ children }) {
  const { currentUser } = useAuth();
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [isMultiLocation, setIsMultiLocation] = useState(false);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setSelectedLocation(null);
      setIsMultiLocation(false);
      setLocations([]);
      setLoading(false);
      return;
    }

    loadRestaurantData();
  }, [currentUser]);

  const loadRestaurantData = async () => {
    try {
      setLoading(true);
      
      // Load restaurant data
      const restaurantRef = doc(db, `restaurants/${currentUser.uid}`);
      const restaurantSnap = await getDoc(restaurantRef);
      
      if (restaurantSnap.exists()) {
        const data = restaurantSnap.data();
        const multiLocation = data.isMultiLocation || false;
        setIsMultiLocation(multiLocation);

        if (multiLocation) {
          // Load locations
          const locationsRef = collection(db, `restaurants/${currentUser.uid}/locations`);
          const locationsSnap = await getDocs(locationsRef);
          const locationsData = locationsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setLocations(locationsData);
          
          // Set first location as default if none selected
          if (locationsData.length > 0) {
            // Check localStorage for previously selected location
            const savedLocation = localStorage.getItem(`selectedLocation_${currentUser.uid}`);
            if (savedLocation && locationsData.find(l => l.id === savedLocation)) {
              setSelectedLocation(savedLocation);
            } else {
              setSelectedLocation(locationsData[0].id);
              localStorage.setItem(`selectedLocation_${currentUser.uid}`, locationsData[0].id);
            }
          }
        } else {
          // Single location - use restaurant ID as location
          setLocations([]);
          setSelectedLocation(currentUser.uid);
        }
      } else {
        // Default to single location
        setIsMultiLocation(false);
        setSelectedLocation(currentUser?.uid || null);
      }
    } catch (error) {
      console.error('Error loading restaurant data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetSelectedLocation = (locationId) => {
    setSelectedLocation(locationId);
    if (currentUser) {
      localStorage.setItem(`selectedLocation_${currentUser.uid}`, locationId);
    }
  };

  const value = {
    selectedLocation,
    setSelectedLocation: handleSetSelectedLocation,
    isMultiLocation,
    locations,
    loadRestaurantData,
    loading
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}
