import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
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

  // Listen to orders
  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);
    const q = query(ordersRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (isMultiLocation && selectedLocation) {
        data = data.filter(o => o.locationId === selectedLocation);
      }
      setAllOrders(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, isMultiLocation, selectedLocation]);

  // Listen to reimbursements
  useEffect(() => {
    if (!currentUser) return;

    const reimbRef = collection(db, `restaurants/${restaurantUid}/reimbursements`);
    const q = query(reimbRef, orderBy('processedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (isMultiLocation && selectedLocation) {
        data = data.filter(r => r.locationId === selectedLocation);
      }
      setAllReimbursements(data);
    });

    return () => unsubscribe();
  }, [currentUser, isMultiLocation, selectedLocation]);

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
