import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, where, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useLocation } from '../../../contexts/LocationContext';
import { toDate } from '../utils/analyticsCalculations';

const useAnalyticsData = (startDate, endDate, prevStartDate, prevEndDate) => {
  const [allOrders, setAllOrders] = useState([]);
  const [allReimbursements, setAllReimbursements] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currentUser, restaurantUid } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();

  // Listen to orders — server-side date + location filter
  // Use prevStartDate as lower bound to include both current and comparison periods
  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);
    const constraints = [orderBy('createdAt', 'desc')];
    // Server-side date filter: only fetch orders from the comparison start date onward
    if (prevStartDate) {
      constraints.push(where('createdAt', '>=', Timestamp.fromDate(prevStartDate)));
    }
    if (isMultiLocation && selectedLocation) {
      constraints.push(where('locationId', '==', selectedLocation));
    }
    const q = query(ordersRef, ...constraints);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllOrders(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, restaurantUid, isMultiLocation, selectedLocation, prevStartDate]);

  // Listen to reimbursements — server-side date + location filter
  useEffect(() => {
    if (!currentUser) return;

    const reimbRef = collection(db, `restaurants/${restaurantUid}/reimbursements`);
    const constraints = [orderBy('processedAt', 'desc')];
    if (prevStartDate) {
      constraints.push(where('processedAt', '>=', Timestamp.fromDate(prevStartDate)));
    }
    if (isMultiLocation && selectedLocation) {
      constraints.push(where('locationId', '==', selectedLocation));
    }
    const q = query(reimbRef, ...constraints);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAllReimbursements(data);
    });

    return () => unsubscribe();
  }, [currentUser, restaurantUid, isMultiLocation, selectedLocation, prevStartDate]);

  // Filter by date range
  const filterByRange = (items, start, end, dateField = 'createdAt') => {
    return items.filter(item => {
      const d = toDate(item[dateField]);
      if (!d) return false;
      return d >= start && d <= end;
    });
  };

  const filteredOrders = filterByRange(allOrders, startDate, endDate);
  const filteredReimbursements = filterByRange(allReimbursements, startDate, endDate, 'processedAt');
  const prevOrders = filterByRange(allOrders, prevStartDate, prevEndDate);
  const prevReimbursements = filterByRange(allReimbursements, prevStartDate, prevEndDate, 'processedAt');

  return {
    orders: filteredOrders,
    reimbursements: filteredReimbursements,
    prevOrders,
    prevReimbursements,
    allOrders,
    loading
  };
};

export default useAnalyticsData;
