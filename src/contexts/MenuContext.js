import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
    collection,
    query,
    orderBy,
    onSnapshot,
    getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { useLocation } from './LocationContext';
import { preloadImages, extractImageUrls } from '../services/imageService';

const MenuContext = createContext();

export function useMenu() {
    return useContext(MenuContext);
}

// Cache key for localStorage
const MENU_CACHE_KEY = 'restaurant_menu_cache';
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function MenuProvider({ children }) {
    const [allCategories, setAllCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);
    const { currentUser, restaurantUid } = useAuth();
    const { isMultiLocation, selectedLocation } = useLocation();

    // Try to load from cache on initial mount
    useEffect(() => {
        if (!currentUser) return;

        try {
            const cacheKey = selectedLocation
                ? `${MENU_CACHE_KEY}_${restaurantUid}_${selectedLocation}`
                : `${MENU_CACHE_KEY}_${restaurantUid}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;

                // Use cache if less than 5 minutes old
                if (age < CACHE_EXPIRY_MS && data && data.length > 0) {
                    console.log('MenuContext: Using cached menu data');
                    setAllCategories(data);
                    setLoading(false);
                    // Preload images into browser cache immediately
                    preloadImages(extractImageUrls(data));
                }
            }
        } catch (err) {
            console.warn('MenuContext: Failed to load cache', err);
        }
    }, [currentUser, selectedLocation]);

    // Save to cache whenever data changes
    const saveToCache = useCallback((data) => {
        if (!currentUser || !data || data.length === 0) return;

        try {
            const cacheKey = selectedLocation
                ? `${MENU_CACHE_KEY}_${restaurantUid}_${selectedLocation}`
                : `${MENU_CACHE_KEY}_${restaurantUid}`;
            localStorage.setItem(cacheKey, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (err) {
            console.warn('MenuContext: Failed to save cache', err);
        }
    }, [currentUser, restaurantUid, selectedLocation]);

    // Load menu data with parallel queries
    const loadMenuData = useCallback(async () => {
        if (!currentUser) return;

        try {
            const categoriesRef = collection(db, `restaurants/${restaurantUid}/menuCategories`);
            const q = query(categoriesRef, orderBy('name'));
            const categoriesSnapshot = await getDocs(q);

            // Use Promise.all to fetch all items in parallel
            const categoriesWithItems = await Promise.all(
                categoriesSnapshot.docs.map(async (categoryDoc) => {
                    const category = { id: categoryDoc.id, ...categoryDoc.data() };

                    // Fetch items for this category
                    const itemsRef = collection(db, `restaurants/${restaurantUid}/menuCategories/${category.id}/items`);
                    const itemsQuery = query(itemsRef, orderBy('name'));
                    const itemsSnapshot = await getDocs(itemsQuery);

                    category.items = itemsSnapshot.docs.map(itemDoc => ({
                        id: itemDoc.id,
                        categoryId: category.id,
                        categoryName: category.name,
                        ...itemDoc.data()
                    }));

                    return category;
                })
            );

            setAllCategories(categoriesWithItems);
            setLastUpdated(Date.now());
            saveToCache(categoriesWithItems);
            setLoading(false);
            // Preload images into browser cache
            preloadImages(extractImageUrls(categoriesWithItems));

        } catch (error) {
            console.error('MenuContext: Error loading menu data', error);
            setLoading(false);
        }
    }, [currentUser, saveToCache]);

    // Set up real-time listener for menu changes
    useEffect(() => {
        if (!currentUser) {
            setLoading(false);
            return;
        }

        // Initial load
        loadMenuData();

        // Listen for category changes to trigger refresh
        const categoriesRef = collection(db, `restaurants/${restaurantUid}/menuCategories`);
        const q = query(categoriesRef, orderBy('name'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            // Only reload if there are actual changes (not initial load)
            if (!snapshot.metadata.hasPendingWrites && lastUpdated) {
                console.log('MenuContext: Menu changed, reloading...');
                loadMenuData();
            }
        });

        return () => unsubscribe();
    }, [currentUser, loadMenuData, lastUpdated]);

    // Filter categories by location (memoized for performance)
    const categories = useMemo(() => {
        if (!isMultiLocation || !selectedLocation) {
            return allCategories;
        }

        // Filter items by selected location
        return allCategories.map(category => ({
            ...category,
            items: (category.items || []).filter(item => {
                // If item has no locations array or empty array, it applies to all locations
                if (!item.locations || item.locations.length === 0) {
                    return true;
                }
                // Otherwise, check if selected location is in the item's locations
                return item.locations.includes(selectedLocation);
            })
        }));
    }, [allCategories, isMultiLocation, selectedLocation]);

    // Force refresh function
    const refreshMenu = useCallback(() => {
        console.log('MenuContext: Force refresh triggered');
        setLoading(true);
        loadMenuData();
    }, [loadMenuData]);

    // Clear cache (useful when user logs out)
    const clearCache = useCallback(() => {
        if (currentUser) {
            localStorage.removeItem(`${MENU_CACHE_KEY}_${restaurantUid}`);
        }
    }, [currentUser]);

    const value = {
        categories,           // Filtered by location
        allCategories,        // Unfiltered (all locations)
        loading,
        refreshMenu,
        clearCache,
        lastUpdated
    };

    return (
        <MenuContext.Provider value={value}>
            {children}
        </MenuContext.Provider>
    );
}
