import React, { useState, useEffect, useRef, useCallback } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Container, Card, Button, Form, Alert, Spinner, Table, Badge, Modal, Row, Col } from 'react-bootstrap';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import activityService from '../services/activityService';
import lanSyncService from '../services/lanSyncService';
import offlineService from '../services/offlineService';
import { getStripe, createPaymentIntent, confirmPayment, processRefund as stripeProcessRefund } from '../services/stripeService';
import { initializeNotifications, notifyPayments, unlockAudio } from '../services/notificationService';
import useFullscreen from '../hooks/useFullscreen';
import './PageHeader.css';
import './Payments.css';

// Stripe Card Element styling
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#32325d',
      fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
      fontSmoothing: 'antialiased',
      fontSize: '16px',
      '::placeholder': {
        color: '#aab7c4'
      }
    },
    invalid: {
      color: '#fa755a',
      iconColor: '#fa755a'
    }
  },
  hidePostalCode: false
};

// Stripe Card Payment Form Component
const CardPaymentForm = ({
  total,
  onPaymentSuccess,
  onPaymentError,
  processing,
  setProcessing,
  orderIds,
  tableNumbers,
  restaurantId,
  paymentDetails
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [cardError, setCardError] = useState(null);
  const [cardComplete, setCardComplete] = useState(false);

  const handleCardChange = (event) => {
    setCardError(event.error ? event.error.message : null);
    setCardComplete(event.complete);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setCardError(null);

    try {
      // 1. Create PaymentIntent on the backend
      const { clientSecret, paymentIntentId } = await createPaymentIntent(
        total,
        orderIds,
        tableNumbers,
        restaurantId
      );

      // 2. Confirm the payment with Stripe
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement),
        }
      });

      if (error) {
        setCardError(error.message);
        onPaymentError(error.message);
      } else if (paymentIntent.status === 'succeeded') {
        // 3. Confirm payment on backend and update orders
        await confirmPayment(paymentIntentId, orderIds, paymentDetails, restaurantId);
        onPaymentSuccess(paymentIntentId);
      } else {
        setCardError('Payment was not completed. Please try again.');
        onPaymentError('Payment was not completed');
      }
    } catch (error) {
      console.error('Payment error:', error);
      setCardError(error.message || 'An error occurred during payment');
      onPaymentError(error.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit}>
      <div className="stripe-card-element">
        <Form.Label><strong>Card Details</strong></Form.Label>
        <div className="card-element-wrapper">
          <CardElement options={CARD_ELEMENT_OPTIONS} onChange={handleCardChange} />
        </div>
        {cardError && (
          <Alert variant="danger" className="mt-2 mb-0">
            <i className="bi bi-exclamation-circle"></i> {cardError}
          </Alert>
        )}
      </div>

      <div className="mt-4 d-flex justify-content-between align-items-center">
        <div className="payment-total-display">
          <span>Total to charge:</span>
          <strong className="text-success fs-4">${total.toFixed(2)}</strong>
        </div>
        <Button
          type="submit"
          variant="success"
          size="lg"
          disabled={!stripe || !cardComplete || processing}
        >
          {processing ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Processing...
            </>
          ) : (
            <>
              <i className="bi bi-credit-card"></i> Pay ${total.toFixed(2)}
            </>
          )}
        </Button>
      </div>
    </Form>
  );
};

const Payments = () => {
  const { currentUser } = useAuth();
  const [selectedTable, setSelectedTable] = useState(null);
  const [tablesWithOrders, setTablesWithOrders] = useState({}); // { tableNumber: [orders] }
  const [onlineOrders, setOnlineOrders] = useState([]); // Online orders (pickup/delivery)
  const [orders, setOrders] = useState([]);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { selectedLocation, isMultiLocation } = useLocation();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(true);

  // Track previous order IDs to detect new served orders
  const prevServedOrderIds = useRef(new Set());
  const isInitialServedLoad = useRef(true);

  // Enable notifications handler
  const enableNotifications = useCallback(async () => {
    unlockAudio();
    const enabled = await initializeNotifications();
    setNotificationsEnabled(enabled);
    setShowNotificationPrompt(false);
  }, []);
  const [showOnlineOrders, setShowOnlineOrders] = useState(false); // Toggle for online orders view
  const [showOnlineOrderDetailModal, setShowOnlineOrderDetailModal] = useState(false);
  const [selectedOnlineOrder, setSelectedOnlineOrder] = useState(null);
  const [orderSearchQuery, setOrderSearchQuery] = useState(''); // For reimbursement search
  const [onlineOrderPaymentMethod, setOnlineOrderPaymentMethod] = useState('cash'); // Payment method for pay-at-store orders

  // Fullscreen mode
  const { isFullscreen, isFullscreenAvailable, toggleFullscreen } = useFullscreen();
  const paymentsContainerRef = useRef(null);

  // Payment details
  const [subtotal, setSubtotal] = useState(0);
  const [taxRate, setTaxRate] = useState(8.5); // Default 8.5%
  const [taxAmount, setTaxAmount] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountType, setDiscountType] = useState('amount'); // 'amount' or 'percentage'
  const [tipAmount, setTipAmount] = useState(0);
  const [tipType, setTipType] = useState('amount'); // 'amount' or 'percentage'
  const [total, setTotal] = useState(0);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReimbursementModal, setShowReimbursementModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [reimbursementPin, setReimbursementPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [reimbursementTable, setReimbursementTable] = useState('');
  const [reimbursementOrder, setReimbursementOrder] = useState('');
  const [reimbursementType, setReimbursementType] = useState('full'); // 'full' or 'partial'
  const [partialRefundAmount, setPartialRefundAmount] = useState(0);
  const [processingReimbursement, setProcessingReimbursement] = useState(false);
  const [completedOrders, setCompletedOrders] = useState({}); // { tableNumber: [orders] }
  const [restaurantData, setRestaurantData] = useState(null);

  // Promo code
  const [promoCode, setPromoCode] = useState('');
  const [promoValidation, setPromoValidation] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');

  // Payment method selection
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' or 'card'
  const [stripePromise, setStripePromise] = useState(null);

  // Load restaurant settings (tax rate)
  useEffect(() => {
    const fetchRestaurantData = async () => {
      if (!currentUser) return;
      try {
        const docRef = doc(db, 'restaurants', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRestaurantData(data);
          // Set tax rate from settings, default to 8.5 if not set
          setTaxRate(data.taxRate !== undefined ? data.taxRate : 8.5);
        }
      } catch (error) {
        console.error('Error fetching restaurant settings:', error);
      }
    };
    fetchRestaurantData();
  }, [currentUser]);

  // Initialize Stripe
  useEffect(() => {
    const initStripe = async () => {
      try {
        const stripe = await getStripe();
        setStripePromise(stripe);
      } catch (error) {
        console.error('Error initializing Stripe:', error);
      }
    };
    initStripe();
  }, []);

  // Load all served orders grouped by table (EXCLUDING online orders)
  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);

    let q = query(ordersRef, where('status', '==', 'served'));

    // Add location filter if multi-location
    if (isMultiLocation && selectedLocation) {
      q = query(q, where('locationId', '==', selectedLocation));
    } else if (isMultiLocation && !selectedLocation) {
      setTablesWithOrders({});
      setOrders([]);
      setSelectedOrders([]);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Detect new served orders and trigger notifications
      if (!isInitialServedLoad.current) {
        ordersData.forEach(order => {
          if (!prevServedOrderIds.current.has(order.id) && order.source !== 'website') {
            // New served order detected!
            console.log('New served order detected:', order.orderNumber || order.id);
            notifyPayments.orderServed(
              order.orderNumber || order.id,
              order.tableNumber,
              order.total
            );
          }
        });
        prevServedOrderIds.current = new Set(ordersData.map(o => o.id));
      } else {
        prevServedOrderIds.current = new Set(ordersData.map(o => o.id));
        isInitialServedLoad.current = false;
      }

      // Group orders by table number - EXCLUDE online orders (source='website')
      const grouped = {};
      ordersData.forEach(order => {
        // Skip online orders - they appear in the Online Orders section
        if (order.source === 'website') return;

        const tableNumbers = Array.isArray(order.tableNumber)
          ? order.tableNumber
          : [order.tableNumber];

        tableNumbers.forEach(tableNum => {
          if (!grouped[tableNum]) {
            grouped[tableNum] = [];
          }
          // Only add if not already added (for multi-table orders)
          if (!grouped[tableNum].find(o => o.id === order.id)) {
            grouped[tableNum].push(order);
          }
        });
      });

      setTablesWithOrders(grouped);

      // If a table is selected, update its orders
      if (selectedTable) {
        const tableKey = Array.isArray(selectedTable) ? selectedTable[0] : selectedTable;
        setOrders(grouped[tableKey] || []);
      }
    }, (error) => {
      console.error('Error loading orders:', error);
      setError('Failed to load orders: ' + error.message);
    });

    // LAN Relay listeners — pick up served orders from relay when offline
    const unsubRelayStatus = lanSyncService.onStatusUpdate(({ orderId, updates }) => {
      if (updates.status === 'served') {
        setOrders(prev => {
          const exists = prev.find(o => o.id === orderId);
          if (exists) return prev;
          return [...prev, { id: orderId, ...updates }];
        });
      }
      if (updates.status === 'completed' || updates.status === 'reimbursed') {
        setOrders(prev => prev.filter(o => o.id !== orderId));
        setSelectedOrders(prev => prev.filter(id => id !== orderId));
      }
    });

    const unsubRelayBatch = lanSyncService.onBatchUpdate(({ orderIds, updates }) => {
      if (updates.status === 'completed' || updates.status === 'reimbursed') {
        setOrders(prev => prev.filter(o => !orderIds.includes(o.id)));
        setSelectedOrders(prev => prev.filter(id => !orderIds.includes(id)));
      }
    });

    return () => {
      unsubscribe();
      unsubRelayStatus();
      unsubRelayBatch();
    };
  }, [currentUser, selectedLocation, isMultiLocation, selectedTable]);

  // Load online orders (pickup/delivery from website) that are new or served
  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);

    // Query for website orders - they have source='website' or orderType in ['pickup', 'delivery']
    let q = query(
      ordersRef,
      where('source', '==', 'website'),
      where('status', 'in', ['new', 'served', 'ready'])
    );

    // Add location filter if multi-location
    if (isMultiLocation && selectedLocation) {
      q = query(
        ordersRef,
        where('source', '==', 'website'),
        where('locationId', '==', selectedLocation),
        where('status', 'in', ['new', 'served', 'ready'])
      );
    } else if (isMultiLocation && !selectedLocation) {
      setOnlineOrders([]);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by createdAt (newest first)
      ordersData.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
        const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
        return dateB - dateA;
      });

      setOnlineOrders(ordersData);
    }, (error) => {
      console.error('Error loading online orders:', error);
    });

    return () => unsubscribe();
  }, [currentUser, selectedLocation, isMultiLocation]);

  // Load completed orders for reimbursement
  useEffect(() => {
    if (!currentUser) return;

    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);

    let q = query(ordersRef, where('status', '==', 'completed'));

    // Add location filter if multi-location
    if (isMultiLocation && selectedLocation) {
      q = query(q, where('locationId', '==', selectedLocation));
    } else if (isMultiLocation && !selectedLocation) {
      setCompletedOrders({});
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Group orders by table number OR as online orders
      const grouped = {};
      ordersData.forEach(order => {
        // Check if it's an online order (no table, or has source='website')
        const isOnlineOrder = order.source === 'website' || order.orderType === 'pickup' || order.orderType === 'delivery';

        if (isOnlineOrder && !order.tableNumber) {
          // Group online orders under a special key
          if (!grouped['__online__']) {
            grouped['__online__'] = [];
          }
          grouped['__online__'].push(order);
        } else {
          // Regular table orders
          const tableNumbers = Array.isArray(order.tableNumber)
            ? order.tableNumber
            : [order.tableNumber];

          tableNumbers.forEach(tableNum => {
            if (!grouped[tableNum]) {
              grouped[tableNum] = [];
            }
            if (!grouped[tableNum].find(o => o.id === order.id)) {
              grouped[tableNum].push(order);
            }
          });
        }
      });

      setCompletedOrders(grouped);
    }, (error) => {
      console.error('Error loading completed orders:', error);
    });

    return () => unsubscribe();
  }, [currentUser, selectedLocation, isMultiLocation]);

  useEffect(() => {
    calculateTotals();
  }, [selectedOrders, taxRate, taxAmount, discountAmount, discountType, tipAmount, tipType, subtotal]);

  const loadOrdersForTable = async () => {
    try {
      setLoading(true);
      setError('');

      const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);

      // Get table numbers - handle both single table and array
      const tableNumbers = Array.isArray(selectedTable) ? selectedTable : [selectedTable];

      // Query for orders with "served" status and matching table number
      const ordersData = [];

      for (const tableNum of tableNumbers) {
        let q = query(
          ordersRef,
          where('status', '==', 'served'),
          where('tableNumber', '==', tableNum)
        );

        // Add location filter if multi-location
        if (isMultiLocation && selectedLocation) {
          q = query(q, where('locationId', '==', selectedLocation));
        }

        const snapshot = await getDocs(q);

        snapshot.docs.forEach(doc => {
          ordersData.push({
            id: doc.id,
            ...doc.data()
          });
        });
      }

      // Also check for orders where tableNumber is an array
      let allOrdersQuery = query(ordersRef, where('status', '==', 'served'));

      // Add location filter if multi-location
      if (isMultiLocation && selectedLocation) {
        allOrdersQuery = query(allOrdersQuery, where('locationId', '==', selectedLocation));
      }

      const allOrdersSnapshot = await getDocs(allOrdersQuery);

      allOrdersSnapshot.docs.forEach(doc => {
        const orderData = doc.data();
        if (Array.isArray(orderData.tableNumber)) {
          const hasMatchingTable = orderData.tableNumber.some(t => tableNumbers.includes(t));
          if (hasMatchingTable && !ordersData.find(o => o.id === doc.id)) {
            ordersData.push({
              id: doc.id,
              ...orderData
            });
          }
        }
      });

      setOrders(ordersData);

      if (ordersData.length === 0) {
        setError(`No orders served at ${Array.isArray(selectedTable) ? `Tables ${selectedTable.join(', ')}` : `Table ${selectedTable}`}`);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
      setError('Failed to load orders: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTableSelect = (tableNumber) => {
    if (selectedTable === tableNumber) {
      // Deselect if clicking the same table
      setSelectedTable(null);
      setOrders([]);
      setSelectedOrders([]);
    } else {
      setSelectedTable(tableNumber);
      setOrders(tablesWithOrders[tableNumber] || []);
      setSelectedOrders([]);
    }
  };

  const toggleOrderSelection = (orderId) => {
    setSelectedOrders(prev => {
      if (prev.includes(orderId)) {
        return prev.filter(id => id !== orderId);
      } else {
        return [...prev, orderId];
      }
    });
  };

  const calculateTotals = () => {
    if (selectedOrders.length === 0) {
      setSubtotal(0);
      setTaxAmount(0);
      setTotal(0);
      return;
    }

    // Calculate subtotal from selected orders
    const ordersSubtotal = selectedOrders.reduce((sum, orderId) => {
      const order = orders.find(o => o.id === orderId);
      return sum + (order?.total || 0);
    }, 0);

    setSubtotal(ordersSubtotal);

    // Calculate tax
    let calculatedTax = 0;
    if (taxRate > 0) {
      calculatedTax = ordersSubtotal * (taxRate / 100);
    }
    setTaxAmount(calculatedTax);

    // Calculate discount
    let calculatedDiscount = 0;
    if (discountAmount > 0) {
      if (discountType === 'percentage') {
        calculatedDiscount = ordersSubtotal * (discountAmount / 100);
      } else {
        calculatedDiscount = discountAmount;
      }
    }

    // Calculate tip
    let calculatedTip = 0;
    if (tipAmount > 0) {
      const amountAfterDiscount = ordersSubtotal - calculatedDiscount + calculatedTax;
      if (tipType === 'percentage') {
        calculatedTip = amountAfterDiscount * (tipAmount / 100);
      } else {
        calculatedTip = tipAmount;
      }
    }

    // Calculate total
    const finalTotal = ordersSubtotal + calculatedTax - calculatedDiscount + calculatedTip;
    setTotal(Math.max(0, finalTotal));
  };

  const validateAndApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const { app } = await import('../firebase');
      const functions = getFunctions(app);
      const validatePromoCodeFn = httpsCallable(functions, 'validatePromoCode');
      const result = await validatePromoCodeFn({
        restaurantId: currentUser.uid,
        promoCode: promoCode.trim(),
        subtotal
      });
      if (result.data.valid) {
        setPromoValidation(result.data);
        if (result.data.discountUnit === 'percentage') {
          setDiscountAmount(result.data.discountValue);
          setDiscountType('percentage');
        } else {
          setDiscountAmount(result.data.discountValue);
          setDiscountType('amount');
        }
      } else {
        setPromoError(result.data.reason);
        setPromoValidation(null);
      }
    } catch (err) {
      setPromoError(err.message || 'Failed to validate promo code');
      setPromoValidation(null);
    } finally {
      setPromoLoading(false);
    }
  };

  const clearPromo = () => {
    setPromoCode('');
    setPromoValidation(null);
    setPromoError('');
    setDiscountAmount(0);
    setDiscountType('amount');
  };

  const handleProcessPayment = async () => {
    if (selectedOrders.length === 0) {
      setError('Please select at least one order to pay');
      return;
    }

    setShowPaymentModal(true);
  };

  // Handle cash payment
  const confirmCashPayment = async () => {
    try {
      setProcessing(true);
      setError('');

      // Get table numbers from selected orders
      const tableNumbers = new Set();
      selectedOrders.forEach(orderId => {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          if (Array.isArray(order.tableNumber)) {
            order.tableNumber.forEach(t => tableNumbers.add(String(t)));
          } else if (order.tableNumber) {
            tableNumbers.add(String(order.tableNumber));
          }
        }
      });

      // Update all selected orders to "completed" status
      const updatePromises = selectedOrders.map(orderId => {
        const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${orderId}`);
        return updateDoc(orderRef, {
          status: 'completed',
          paymentDate: new Date(),
          paymentDetails: {
            subtotal,
            taxRate,
            taxAmount,
            discountAmount,
            discountType,
            tipAmount,
            tipType,
            total,
            paymentMethod: 'cash',
            promoCode: promoValidation?.promoCode || null,
            promotionId: promoValidation?.promotionId || null,
            promoDiscount: promoValidation ? (discountType === 'percentage' ? subtotal * (discountAmount / 100) : discountAmount) : 0,
            paidAt: new Date().toISOString()
          },
          updatedAt: new Date()
        });
      });

      await Promise.all(updatePromises);

      // Mark promo claim as used after successful payment
      if (promoValidation?.claimId) {
        try {
          const claimRef = doc(db, `restaurants/${currentUser.uid}/promotionClaims/${promoValidation.claimId}`);
          await updateDoc(claimRef, { used: true, usedAt: new Date(), usedInOrder: selectedOrders[0] });
        } catch (promoErr) {
          console.error('Error marking promo as used:', promoErr);
        }
      }

      // Broadcast batch status update via LAN relay
      lanSyncService.sendBatchUpdate(selectedOrders, { status: 'completed', updatedAt: new Date() });

      // Get order numbers for activity logging
      const orderNumbers = selectedOrders.map(orderId => {
        const order = orders.find(o => o.id === orderId);
        return order?.orderNumber || orderId;
      });

      // Log payment activity
      await activityService.logPaymentActivity(currentUser.uid, {
        orderNumbers,
        tableNumbers: Array.from(tableNumbers),
        total,
        orderCount: selectedOrders.length,
        paymentMethod: 'cash',
        locationId: isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid
      });

      // Release tables
      await releaseTableStatus(tableNumbers);

      setSuccess(`Cash payment processed successfully for ${selectedOrders.length} order(s). Total: $${total.toFixed(2)}. Tables released.`);
      setShowPaymentModal(false);

      // Reset form
      resetPaymentForm();
    } catch (error) {
      console.error('Error processing cash payment:', error);
      setError('Failed to process payment: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  // Handle successful card payment
  const handleCardPaymentSuccess = async (paymentIntentId) => {
    try {
      // Get table numbers from selected orders
      const tableNumbers = new Set();
      selectedOrders.forEach(orderId => {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          if (Array.isArray(order.tableNumber)) {
            order.tableNumber.forEach(t => tableNumbers.add(String(t)));
          } else if (order.tableNumber) {
            tableNumbers.add(String(order.tableNumber));
          }
        }
      });

      // Get order numbers for activity logging
      const orderNumbers = selectedOrders.map(orderId => {
        const order = orders.find(o => o.id === orderId);
        return order?.orderNumber || orderId;
      });

      // Mark promo claim as used after successful card payment
      if (promoValidation?.claimId) {
        try {
          const claimRef = doc(db, `restaurants/${currentUser.uid}/promotionClaims/${promoValidation.claimId}`);
          await updateDoc(claimRef, { used: true, usedAt: new Date(), usedInOrder: selectedOrders[0] });
        } catch (promoErr) {
          console.error('Error marking promo as used:', promoErr);
        }
      }

      // Log payment activity
      await activityService.logPaymentActivity(currentUser.uid, {
        orderNumbers,
        tableNumbers: Array.from(tableNumbers),
        total,
        orderCount: selectedOrders.length,
        paymentMethod: 'card',
        stripePaymentIntentId: paymentIntentId,
        locationId: isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid
      });

      // Release tables
      await releaseTableStatus(tableNumbers);

      setSuccess(`Card payment processed successfully for ${selectedOrders.length} order(s). Total: $${total.toFixed(2)}. Tables released.`);
      setShowPaymentModal(false);

      // Reset form
      resetPaymentForm();
    } catch (error) {
      console.error('Error after card payment:', error);
      // Payment was successful, but there was an error updating local state
      setSuccess(`Payment processed! Total: $${total.toFixed(2)}. Note: ${error.message}`);
      setShowPaymentModal(false);
      resetPaymentForm();
    }
  };

  // Handle card payment error
  const handleCardPaymentError = (errorMessage) => {
    setError('Card payment failed: ' + errorMessage);
  };

  // Release table status
  const releaseTableStatus = async (tableNumbers) => {
    if (tableNumbers.size === 0) return;

    try {
      // For multi-location, use location-specific layout path
      const layoutPath = isMultiLocation && selectedLocation
        ? `restaurants/${currentUser.uid}/locations/${selectedLocation}/layout/floorPlan`
        : `restaurants/${currentUser.uid}/layout/floorPlan`;

      const layoutRef = doc(db, layoutPath);
      const layoutSnap = await getDoc(layoutRef);

      if (layoutSnap.exists()) {
        const layoutData = layoutSnap.data();
        const updatedTables = layoutData.tables.map(table => {
          if (tableNumbers.has(String(table.number))) {
            return { ...table, status: 'available' };
          }
          return table;
        });

        await setDoc(layoutRef, {
          ...layoutData,
          tables: updatedTables,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (layoutError) {
      console.error('Error updating table status:', layoutError);
      // Don't fail payment if table status update fails
    }
  };

  // Reset payment form
  const resetPaymentForm = () => {
    setSelectedOrders([]);
    setDiscountAmount(0);
    setTipAmount(0);
    setTaxRate(8.5);
    setPaymentMethod('cash');
    setPromoCode('');
    setPromoValidation(null);
    setPromoError('');
  };

  // Handle online order selection for viewing details
  const handleOnlineOrderSelect = (order) => {
    setSelectedOnlineOrder(order);
    setOnlineOrderPaymentMethod('cash'); // Reset to cash by default
    setShowOnlineOrderDetailModal(true);
  };

  // Check if online order is pre-paid
  const isOrderPrepaid = (order) => {
    return order.paymentMethod === 'card' && order.paymentDetails?.status === 'pending';
  };

  // Verify and complete pre-paid online order
  const handleVerifyOnlineOrder = async () => {
    if (!selectedOnlineOrder) return;

    setProcessing(true);
    setError('');

    try {
      const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${selectedOnlineOrder.id}`);

      await updateDoc(orderRef, {
        status: 'completed',
        paymentVerified: true,
        paymentVerifiedAt: new Date(),
        paymentVerifiedBy: currentUser.uid,
        paymentDetails: {
          ...selectedOnlineOrder.paymentDetails,
          status: 'verified',
          verifiedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      });

      // Log activity
      await activityService.logPaymentActivity(currentUser.uid, {
        orderNumbers: [selectedOnlineOrder.orderNumber || selectedOnlineOrder.id],
        tableNumbers: ['Online Order'],
        total: selectedOnlineOrder.total,
        orderCount: 1,
        paymentMethod: 'card (online)',
        orderType: selectedOnlineOrder.orderType,
        locationId: selectedOnlineOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
      });

      setSuccess(`Online order #${selectedOnlineOrder.orderNumber || selectedOnlineOrder.id.slice(0, 8)} verified and completed!`);
      setShowOnlineOrderDetailModal(false);
      setSelectedOnlineOrder(null);
    } catch (error) {
      console.error('Error verifying online order:', error);
      setError('Failed to verify order: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  // Handle cash payment for unpaid online orders
  const handleOnlineOrderCashPayment = async () => {
    if (!selectedOnlineOrder) return;

    setProcessing(true);
    setError('');

    try {
      const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${selectedOnlineOrder.id}`);

      await updateDoc(orderRef, {
        status: 'completed',
        paymentDate: new Date(),
        paymentDetails: {
          subtotal: selectedOnlineOrder.subtotal || selectedOnlineOrder.total,
          taxRate: 0,
          taxAmount: selectedOnlineOrder.tax || 0,
          total: selectedOnlineOrder.total,
          paymentMethod: 'cash',
          paidAt: new Date().toISOString()
        },
        updatedAt: new Date()
      });

      // Log activity
      await activityService.logPaymentActivity(currentUser.uid, {
        orderNumbers: [selectedOnlineOrder.orderNumber || selectedOnlineOrder.id],
        tableNumbers: ['Online Order'],
        total: selectedOnlineOrder.total,
        orderCount: 1,
        paymentMethod: 'cash',
        orderType: selectedOnlineOrder.orderType,
        locationId: selectedOnlineOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
      });

      setSuccess(`Cash payment received for online order #${selectedOnlineOrder.orderNumber || selectedOnlineOrder.id.slice(0, 8)}!`);
      setShowOnlineOrderDetailModal(false);
      setSelectedOnlineOrder(null);
      setOnlineOrderPaymentMethod('cash');
    } catch (error) {
      console.error('Error processing cash payment:', error);
      setError('Failed to process payment: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  // Handle card payment success for online orders (pay at store)
  const handleOnlineOrderCardPaymentSuccess = async (paymentIntentId) => {
    if (!selectedOnlineOrder) return;

    try {
      // Log activity
      await activityService.logPaymentActivity(currentUser.uid, {
        orderNumbers: [selectedOnlineOrder.orderNumber || selectedOnlineOrder.id],
        tableNumbers: ['Online Order'],
        total: selectedOnlineOrder.total,
        orderCount: 1,
        paymentMethod: 'card',
        stripePaymentIntentId: paymentIntentId,
        orderType: selectedOnlineOrder.orderType,
        locationId: selectedOnlineOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
      });

      setSuccess(`Card payment processed for online order #${selectedOnlineOrder.orderNumber || selectedOnlineOrder.id.slice(0, 8)}!`);
      setShowOnlineOrderDetailModal(false);
      setSelectedOnlineOrder(null);
      setOnlineOrderPaymentMethod('cash');
    } catch (error) {
      console.error('Error after card payment:', error);
      setSuccess(`Payment processed! Note: ${error.message}`);
      setShowOnlineOrderDetailModal(false);
      setSelectedOnlineOrder(null);
      setOnlineOrderPaymentMethod('cash');
    }
  };

  // Handle card payment error for online orders
  const handleOnlineOrderCardPaymentError = (errorMessage) => {
    setError('Card payment failed: ' + errorMessage);
  };

  // Filter completed orders for reimbursement search
  const getFilteredReimbursementOrders = () => {
    if (!orderSearchQuery.trim()) return null;

    // Search across all completed orders
    const allOrders = [];
    Object.entries(completedOrders).forEach(([key, orders]) => {
      orders.forEach(order => {
        const orderNumber = order.orderNumber || order.id;
        if (orderNumber.toLowerCase().includes(orderSearchQuery.toLowerCase())) {
          allOrders.push({ ...order, tableKey: key });
        }
      });
    });

    return allOrders;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const calculateRefundAmount = (order) => {
    if (!order) return 0;

    // Get payment details if available (for completed orders)
    const paymentDetails = order.paymentDetails || {};

    // If payment was processed, use the final total minus tip
    if (paymentDetails.total) {
      const tipAmount = paymentDetails.tipAmount || 0;
      // Refundable = final paid amount - tip (tips are non-refundable)
      return Math.max(0, paymentDetails.total - tipAmount);
    }

    // For orders without payment details, use original order total
    // (no tip was added yet, so full amount is refundable)
    return order.total || 0;
  };

  const handleReimbursement = async () => {
    if (!reimbursementTable || !reimbursementOrder) {
      setError('Please select a table and order');
      return;
    }

    const selectedOrder = completedOrders[reimbursementTable]?.find(o => o.id === reimbursementOrder);
    if (!selectedOrder) {
      setError('Order not found');
      return;
    }

    setProcessingReimbursement(true);
    setError('');

    try {
      const refundAmount = reimbursementType === 'full'
        ? calculateRefundAmount(selectedOrder)
        : Math.min(parseFloat(partialRefundAmount) || 0, calculateRefundAmount(selectedOrder));

      if (refundAmount <= 0) {
        setError('Invalid refund amount');
        setProcessingReimbursement(false);
        return;
      }

      // Check if order was paid with card
      // For POS orders: check stripePaymentIntentId
      // For website orders: check paymentMethod === 'card' or paymentDetails.paymentMethodId
      const hasStripePayment = selectedOrder.paymentDetails?.stripePaymentIntentId ||
        selectedOrder.paymentMethod === 'card' ||
        selectedOrder.paymentDetails?.paymentMethodId;

      // Determine actual payment method for display
      const actualPaymentMethod = hasStripePayment ? 'card' :
        (selectedOrder.paymentMethod === 'payAtRestaurant' ? 'cash' : (selectedOrder.paymentMethod || 'cash'));

      // Handle tableNumber for online orders (may be undefined)
      const orderTableNumber = selectedOrder.tableNumber ||
        (selectedOrder.source === 'website' ? 'Online Order' : null);
      const isOnlineOrder = selectedOrder.source === 'website' || reimbursementTable === '__online__';

      if (hasStripePayment && selectedOrder.paymentDetails?.stripePaymentIntentId) {
        // Process refund through Stripe (only if we have a payment intent ID)
        await stripeProcessRefund(
          reimbursementOrder,
          currentUser.uid,
          refundAmount,
          reimbursementType
        );

        // Log reimbursement activity
        await activityService.logReimbursementActivity(currentUser.uid, {
          orderNumber: selectedOrder.orderNumber || reimbursementOrder,
          orderId: reimbursementOrder,
          tableNumber: orderTableNumber || 'Online Order',
          refundAmount,
          refundType: reimbursementType,
          paymentMethod: 'card',
          isOnlineOrder: isOnlineOrder,
          locationId: selectedOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
        });

        setSuccess(`Card refund processed successfully. Refund amount: $${refundAmount.toFixed(2)}`);
      } else {
        // Cash refund (or online card payment without Stripe intent) - update order status locally
        const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${reimbursementOrder}`);
        await updateDoc(orderRef, {
          status: 'reimbursed',
          reimbursement: {
            amount: refundAmount,
            type: reimbursementType,
            processedAt: new Date(),
            processedBy: currentUser.uid,
            paymentMethod: actualPaymentMethod
          },
          updatedAt: new Date()
        });

        // Create reimbursement record for analytics
        const reimbursementsRef = collection(db, `restaurants/${currentUser.uid}/reimbursements`);
        const reimbursementData = {
          orderId: reimbursementOrder,
          orderNumber: selectedOrder.orderNumber || reimbursementOrder,
          locationId: selectedOrder.locationId || selectedLocation || currentUser.uid,
          amount: refundAmount,
          type: reimbursementType,
          originalOrderTotal: selectedOrder.total || 0,
          paymentMethod: actualPaymentMethod,
          processedAt: new Date(),
          processedBy: currentUser.uid,
          isOnlineOrder: isOnlineOrder,
          orderType: selectedOrder.orderType || 'dine_in'
        };

        // Only add tableNumber if it exists (not for online orders)
        if (orderTableNumber && orderTableNumber !== 'Online Order') {
          reimbursementData.tableNumber = orderTableNumber;
        }

        await setDoc(doc(reimbursementsRef), reimbursementData);

        // Log reimbursement activity
        await activityService.logReimbursementActivity(currentUser.uid, {
          orderNumber: selectedOrder.orderNumber || reimbursementOrder,
          orderId: reimbursementOrder,
          tableNumber: orderTableNumber || 'Online Order',
          refundAmount,
          refundType: reimbursementType,
          paymentMethod: actualPaymentMethod,
          isOnlineOrder: isOnlineOrder,
          locationId: selectedOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
        });

        setSuccess(`${actualPaymentMethod === 'card' ? 'Card' : 'Cash'} refund recorded. Refund amount: $${refundAmount.toFixed(2)}`);
      }

      setShowReimbursementModal(false);
      setReimbursementTable('');
      setReimbursementOrder('');
      setReimbursementType('full');
      setPartialRefundAmount(0);
    } catch (error) {
      console.error('Error processing reimbursement:', error);
      setError('Failed to process reimbursement: ' + error.message);
    } finally {
      setProcessingReimbursement(false);
    }
  };

  // Load restaurant data to check for PIN
  useEffect(() => {
    if (!currentUser) return;

    const fetchRestaurantData = async () => {
      try {
        const docRef = doc(db, "restaurants", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setRestaurantData(docSnap.data());
        }
      } catch (error) {
        console.error('Error fetching restaurant data:', error);
      }
    };

    fetchRestaurantData();
  }, [currentUser]);

  const handlePinVerification = () => {
    setPinError('');

    if (!reimbursementPin || reimbursementPin.length !== 4) {
      setPinError('Please enter a 4-digit PIN');
      return;
    }

    const storedPin = restaurantData?.reimbursementPin;
    if (!storedPin) {
      setPinError('Reimbursement PIN not set. Please set it in Account settings first.');
      return;
    }

    if (reimbursementPin !== storedPin) {
      setPinError('Incorrect PIN. Please try again.');
      setReimbursementPin('');
      return;
    }

    // PIN is correct, proceed to reimbursement modal
    setShowPinModal(false);
    setReimbursementPin('');
    setShowReimbursementModal(true);
  };

  const handleReimbursementClick = () => {
    // Check if PIN is set
    if (!restaurantData?.reimbursementPin) {
      setError('Reimbursement PIN not set. Please set it in Account settings first.');
      return;
    }

    // Show PIN entry modal first
    setShowPinModal(true);
    setReimbursementPin('');
    setPinError('');
  };

  const selectedOrdersData = orders.filter(o => selectedOrders.includes(o.id));
  const reimbursementOrderData = reimbursementOrder && reimbursementTable
    ? completedOrders[reimbursementTable]?.find(o => o.id === reimbursementOrder)
    : null;
  const maxRefundAmount = reimbursementOrderData ? calculateRefundAmount(reimbursementOrderData) : 0;

  // Get table numbers for card payment
  const getTableNumbersForPayment = () => {
    const tableNumbers = [];
    selectedOrders.forEach(orderId => {
      const order = orders.find(o => o.id === orderId);
      if (order) {
        if (Array.isArray(order.tableNumber)) {
          order.tableNumber.forEach(t => {
            if (!tableNumbers.includes(String(t))) tableNumbers.push(String(t));
          });
        } else if (order.tableNumber && !tableNumbers.includes(String(order.tableNumber))) {
          tableNumbers.push(String(order.tableNumber));
        }
      }
    });
    return tableNumbers;
  };

  return (
    <Container fluid className={`payments-container ${isFullscreen ? 'fullscreen-mode' : ''}`} ref={paymentsContainerRef}>
      {/* Page Header */}
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-credit-card header-icon"></i>
          <div>
            <h2>Payments</h2>
            <p>Process customer payments and manage transactions</p>
          </div>
        </div>
        {/* Notification status indicator */}
        <div className="notification-status">
          {notificationsEnabled ? (
            <Badge bg="success" className="notification-badge">
              <i className="bi bi-bell-fill"></i> Notifications On
            </Badge>
          ) : showNotificationPrompt ? (
            <Button
              variant="warning"
              size="sm"
              onClick={enableNotifications}
              className="enable-notifications-btn"
            >
              <i className="bi bi-bell"></i> Enable Sound Alerts
            </Button>
          ) : (
            <Badge bg="secondary" className="notification-badge">
              <i className="bi bi-bell-slash"></i> Notifications Off
            </Badge>
          )}
        </div>
        {/* Fullscreen Toggle */}
        {isFullscreenAvailable && (
          <Button
            variant={isFullscreen ? "light" : "outline-light"}
            size="sm"
            onClick={() => toggleFullscreen(paymentsContainerRef.current)}
            className="ms-2"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
            {isFullscreen ? ' Exit' : ' Fullscreen'}
          </Button>
        )}
      </div>

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

      {/* Action Buttons */}
      <div className="mb-4 d-flex justify-content-end">
        <Button
          variant="outline-warning"
          onClick={handleReimbursementClick}
          className="me-2"
        >
          <i className="bi bi-arrow-counterclockwise"></i> Reimbursement
        </Button>
      </div>

      {/* Online Orders Section */}
      {onlineOrders.length > 0 && (
        <Card className="mb-4 online-orders-card">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5><i className="bi bi-globe"></i> Online Orders ({onlineOrders.length})</h5>
            <Button
              variant="light"
              size="sm"
              onClick={() => setShowOnlineOrders(!showOnlineOrders)}
              className="online-orders-toggle-btn"
            >
              <i className={`bi ${showOnlineOrders ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`}></i>
              {showOnlineOrders ? 'Hide Orders' : 'View Orders'}
            </Button>
          </Card.Header>
          {showOnlineOrders && (
            <Card.Body>
              <div className="online-orders-grid">
                {onlineOrders.map(order => {
                  const isPrepaid = order.paymentMethod === 'card';
                  const orderTypeLabel = order.orderType === 'delivery' ? 'Delivery' : 'Pickup';
                  return (
                    <Card
                      key={order.id}
                      className="online-order-card"
                      onClick={() => handleOnlineOrderSelect(order)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Card.Body>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <div>
                            <Badge bg={order.orderType === 'pickup' ? 'success' : 'warning'} className="me-2">
                              <i className={`bi ${order.orderType === 'pickup' ? 'bi-bag-check' : 'bi-truck'}`}></i> {orderTypeLabel}
                            </Badge>
                            {isPrepaid && (
                              <Badge bg="info">
                                <i className="bi bi-credit-card-fill"></i> PAID
                              </Badge>
                            )}
                            {!isPrepaid && (
                              <Badge bg="secondary">
                                <i className="bi bi-cash"></i> Pay at Store
                              </Badge>
                            )}
                          </div>
                          <Badge bg="dark">#{order.orderNumber || order.id.slice(0, 8)}</Badge>
                        </div>
                        <div className="order-customer-info">
                          <i className="bi bi-person-circle"></i>
                          <span>{order.customer?.name || 'Customer'}</span>
                          <span className="text-muted ms-2">{order.customer?.phone}</span>
                        </div>
                        <div className="d-flex justify-content-between mt-2">
                          <span className="text-muted">{order.items?.length || 0} items</span>
                          <strong className="text-success">${(order.total || 0).toFixed(2)}</strong>
                        </div>
                        <small className="text-muted">{formatDate(order.createdAt)}</small>
                      </Card.Body>
                    </Card>
                  );
                })}
              </div>
            </Card.Body>
          )}
        </Card>
      )}

      {/* Tables with Served Orders */}
      {Object.keys(tablesWithOrders).length > 0 && (
        <Card className="mb-4">
          <Card.Header>
            <h5><i className="bi bi-table"></i> Tables with Served Orders</h5>
          </Card.Header>
          <Card.Body>
            <div className="payments-tables-grid">
              {Object.entries(tablesWithOrders).map(([tableNumber, tableOrders]) => {
                const isSelected = selectedTable === tableNumber;
                const totalAmount = tableOrders.reduce((sum, order) => sum + (order.total || 0), 0);
                return (
                  <Card
                    key={tableNumber}
                    className={`payments-table-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleTableSelect(tableNumber)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Card.Body>
                      <div className="table-card-header">
                        <h4>
                          <i className="bi bi-table"></i> Table {tableNumber}
                        </h4>
                        <Badge bg={isSelected ? 'primary' : 'secondary'}>
                          {tableOrders.length} {tableOrders.length === 1 ? 'Order' : 'Orders'}
                        </Badge>
                      </div>
                      <div className="table-card-info">
                        <div className="table-card-total">
                          <strong>Total: ${totalAmount.toFixed(2)}</strong>
                        </div>
                        <div className="table-card-orders">
                          {tableOrders.slice(0, 2).map(order => (
                            <div key={order.id} className="table-order-preview">
                              <small>
                                #{order.orderNumber || order.id.slice(0, 8)} - ${(order.total || 0).toFixed(2)}
                              </small>
                            </div>
                          ))}
                          {tableOrders.length > 2 && (
                            <small className="text-muted">+{tableOrders.length - 2} more</small>
                          )}
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                );
              })}
            </div>
          </Card.Body>
        </Card>
      )}

      {isMultiLocation && !selectedLocation && (
        <Alert variant="warning" className="mt-4">
          <i className="bi bi-exclamation-triangle"></i> Please select a location to view payments.
        </Alert>
      )}

      {selectedTable && orders.length > 0 ? (
        <>
          {/* Orders List */}
          <Card className="mb-4">
            <Card.Header>
              <h5>Served Orders for {Array.isArray(selectedTable) ? `Tables ${selectedTable.join(', ')}` : `Table ${selectedTable}`}</h5>
            </Card.Header>
            <Card.Body>
              <Table responsive hover>
                <thead>
                  <tr>
                    <th width="50">
                      <Form.Check
                        type="checkbox"
                        checked={selectedOrders.length === orders.length && orders.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedOrders(orders.map(o => o.id));
                          } else {
                            setSelectedOrders([]);
                          }
                        }}
                      />
                    </th>
                    <th>Order #</th>
                    <th>Items</th>
                    <th>Order Time</th>
                    <th>Subtotal</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => {
                    const isSelected = selectedOrders.includes(order.id);
                    return (
                      <tr
                        key={order.id}
                        className={isSelected ? 'table-selected' : ''}
                        onClick={() => toggleOrderSelection(order.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <Form.Check
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOrderSelection(order.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td>{order.orderNumber || order.id.slice(0, 8)}</td>
                        <td>
                          {order.items?.length || 0} item(s)
                          {order.items && order.items.length > 0 && (
                            <small className="text-muted d-block">
                              {order.items.slice(0, 2).map(item => item.name).join(', ')}
                              {order.items.length > 2 && '...'}
                            </small>
                          )}
                        </td>
                        <td>{formatDate(order.createdAt)}</td>
                        <td>${(order.total || 0).toFixed(2)}</td>
                        <td>
                          <Badge bg="success">{order.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card.Body>
          </Card>

          {/* Payment Details */}
          {selectedOrders.length > 0 && (
            <Card className="mb-4">
              <Card.Header>
                <h5>Payment Details</h5>
              </Card.Header>
              <Card.Body>
                <Row>
                  <Col md={6}>
                    <h6 className="mb-3">Order Summary</h6>
                    <div className="payment-summary">
                      <div className="summary-row">
                        <span>Subtotal ({selectedOrders.length} order{selectedOrders.length > 1 ? 's' : ''}):</span>
                        <span>${subtotal.toFixed(2)}</span>
                      </div>
                    </div>

                    <h6 className="mb-3 mt-4">Tax</h6>
                    <Form.Group className="mb-3">
                      <Row>
                        <Col>
                          <Form.Control
                            type="number"
                            step="0.1"
                            value={taxRate}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTaxRate(value === '' ? '' : parseFloat(value) || 0);
                            }}
                            onBlur={(e) => {
                              const value = e.target.value;
                              if (value === '') {
                                setTaxRate(0);
                              }
                            }}
                            placeholder="Tax Rate %"
                          />
                        </Col>
                        <Col xs="auto">
                          <span className="align-middle">%</span>
                        </Col>
                      </Row>
                      <Form.Text className="text-muted">Tax Amount: ${taxAmount.toFixed(2)}</Form.Text>
                    </Form.Group>

                    <h6 className="mb-3 mt-4">Promo Code</h6>
                    <Form.Group className="mb-3">
                      <Row>
                        <Col>
                          <Form.Control
                            type="text"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                            placeholder="Enter customer promo code"
                            disabled={!!promoValidation}
                          />
                        </Col>
                        <Col xs="auto">
                          {promoValidation ? (
                            <Button variant="outline-danger" onClick={clearPromo}>Remove</Button>
                          ) : (
                            <Button variant="outline-primary" onClick={validateAndApplyPromo} disabled={promoLoading || !promoCode.trim()}>
                              {promoLoading ? 'Checking...' : 'Apply'}
                            </Button>
                          )}
                        </Col>
                      </Row>
                      {promoValidation && (
                        <Form.Text className="text-success d-block mt-1">
                          Applied: {promoValidation.title} ({promoValidation.discountValue}{promoValidation.discountUnit === 'percentage' ? '%' : '$'} off)
                        </Form.Text>
                      )}
                      {promoError && <Form.Text className="text-danger d-block mt-1">{promoError}</Form.Text>}
                    </Form.Group>

                    <h6 className="mb-3 mt-4">Discount</h6>
                    <Form.Group className="mb-3">
                      <Row>
                        <Col>
                          <Form.Control
                            type="number"
                            step="0.01"
                            value={discountAmount}
                            onChange={(e) => {
                              const value = e.target.value;
                              setDiscountAmount(value === '' ? '' : parseFloat(value) || 0);
                            }}
                            onBlur={(e) => {
                              const value = e.target.value;
                              if (value === '') {
                                setDiscountAmount(0);
                              }
                            }}
                            placeholder="Discount amount"
                          />
                        </Col>
                        <Col xs="auto">
                          <Form.Select
                            value={discountType}
                            onChange={(e) => setDiscountType(e.target.value)}
                            style={{ width: '120px' }}
                          >
                            <option value="amount">$</option>
                            <option value="percentage">%</option>
                          </Form.Select>
                        </Col>
                      </Row>
                    </Form.Group>

                    <h6 className="mb-3 mt-4">Tip</h6>
                    <Form.Group className="mb-3">
                      <Row>
                        <Col>
                          <Form.Control
                            type="number"
                            step="0.01"
                            value={tipAmount}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTipAmount(value === '' ? '' : parseFloat(value) || 0);
                            }}
                            onBlur={(e) => {
                              const value = e.target.value;
                              if (value === '') {
                                setTipAmount(0);
                              }
                            }}
                            placeholder="Tip amount"
                          />
                        </Col>
                        <Col xs="auto">
                          <Form.Select
                            value={tipType}
                            onChange={(e) => setTipType(e.target.value)}
                            style={{ width: '120px' }}
                          >
                            <option value="amount">$</option>
                            <option value="percentage">%</option>
                          </Form.Select>
                        </Col>
                      </Row>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <div className="payment-total-card">
                      <h5 className="mb-4">Payment Summary</h5>
                      <div className="payment-breakdown">
                        <div className="breakdown-row">
                          <span>Subtotal:</span>
                          <span>${subtotal.toFixed(2)}</span>
                        </div>
                        <div className="breakdown-row">
                          <span>Tax ({taxRate}%):</span>
                          <span>${taxAmount.toFixed(2)}</span>
                        </div>
                        {discountAmount > 0 && (
                          <div className="breakdown-row text-danger">
                            <span>Discount ({discountType === 'percentage' ? `${discountAmount}%` : `$${discountAmount.toFixed(2)}`}):</span>
                            <span>-${(discountType === 'percentage' ? subtotal * (discountAmount / 100) : discountAmount).toFixed(2)}</span>
                          </div>
                        )}
                        {tipAmount > 0 && (
                          <div className="breakdown-row">
                            <span>Tip ({tipType === 'percentage' ? `${tipAmount}%` : `$${tipAmount.toFixed(2)}`}):</span>
                            <span>${(tipType === 'percentage' ? (subtotal - (discountType === 'percentage' ? subtotal * (discountAmount / 100) : discountAmount) + taxAmount) * (tipAmount / 100) : tipAmount).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="breakdown-row total-row">
                          <span><strong>Total:</strong></span>
                          <span><strong>${total.toFixed(2)}</strong></span>
                        </div>
                      </div>
                      <Button
                        variant="success"
                        size="lg"
                        className="w-100 mt-4"
                        onClick={handleProcessPayment}
                        disabled={processing}
                      >
                        <i className="bi bi-credit-card"></i> Process Payment
                      </Button>
                    </div>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          )}
        </>
      ) : selectedTable && orders.length === 0 ? (
        <Card>
          <Card.Body className="text-center py-5">
            <i className="bi bi-inbox" style={{ fontSize: '3rem', color: '#ccc' }}></i>
            <p className="mt-3 text-muted">No orders served at this table</p>
          </Card.Body>
        </Card>
      ) : !isMultiLocation || selectedLocation ? (
        Object.keys(tablesWithOrders).length === 0 && (
          <Card>
            <Card.Body className="text-center py-5">
              <i className="bi bi-inbox" style={{ fontSize: '3rem', color: '#ccc' }}></i>
              <p className="mt-3 text-muted">No tables with served orders</p>
              <p className="text-muted">Orders will appear here once they are marked as served</p>
            </Card.Body>
          </Card>
        )
      ) : null}

      {/* Payment Modal with Payment Method Selection */}
      <Modal show={showPaymentModal} onHide={() => !processing && setShowPaymentModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-credit-card"></i> Process Payment</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Payment Method Selection */}
          <div className="payment-method-selection mb-4">
            <h6 className="mb-3">Select Payment Method</h6>
            <div className="payment-method-buttons">
              <Button
                variant={paymentMethod === 'cash' ? 'success' : 'outline-secondary'}
                className="payment-method-btn me-3"
                onClick={() => setPaymentMethod('cash')}
                disabled={processing}
              >
                <i className="bi bi-cash-coin"></i>
                <span>Cash</span>
              </Button>
              <Button
                variant={paymentMethod === 'card' ? 'primary' : 'outline-secondary'}
                className="payment-method-btn"
                onClick={() => setPaymentMethod('card')}
                disabled={processing}
              >
                <i className="bi bi-credit-card-2-front"></i>
                <span>Card</span>
              </Button>
            </div>
          </div>

          {/* Order Summary */}
          <div className="payment-confirmation mb-4">
            <h6>Orders to be paid:</h6>
            <ul className="order-list">
              {selectedOrdersData.map(order => (
                <li key={order.id}>
                  <span>Order #{order.orderNumber || order.id.slice(0, 8)}</span>
                  <span>${(order.total || 0).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="payment-summary-total">
              <div className="d-flex justify-content-between">
                <span>Subtotal:</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="d-flex justify-content-between">
                <span>Tax ({taxRate}%):</span>
                <span>${taxAmount.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="d-flex justify-content-between text-success">
                  <span>Discount:</span>
                  <span>-${(discountType === 'percentage' ? subtotal * (discountAmount / 100) : discountAmount).toFixed(2)}</span>
                </div>
              )}
              {tipAmount > 0 && (
                <div className="d-flex justify-content-between">
                  <span>Tip:</span>
                  <span>${(tipType === 'percentage' ? (subtotal - (discountType === 'percentage' ? subtotal * (discountAmount / 100) : discountAmount) + taxAmount) * (tipAmount / 100) : tipAmount).toFixed(2)}</span>
                </div>
              )}
              <hr />
              <div className="d-flex justify-content-between fs-5">
                <strong>Total:</strong>
                <strong className="text-success">${total.toFixed(2)}</strong>
              </div>
            </div>
          </div>

          {/* Payment Form based on method */}
          {paymentMethod === 'cash' ? (
            <div className="cash-payment-section">
              <Alert variant="info">
                <i className="bi bi-cash"></i> Collect <strong>${total.toFixed(2)}</strong> in cash from the customer.
              </Alert>
            </div>
          ) : (
            <div className="card-payment-section">
              {stripePromise ? (
                <Elements stripe={stripePromise}>
                  <CardPaymentForm
                    total={total}
                    onPaymentSuccess={handleCardPaymentSuccess}
                    onPaymentError={handleCardPaymentError}
                    processing={processing}
                    setProcessing={setProcessing}
                    orderIds={selectedOrders}
                    tableNumbers={getTableNumbersForPayment()}
                    restaurantId={currentUser.uid}
                    paymentDetails={{
                      subtotal,
                      taxRate,
                      taxAmount,
                      discountAmount,
                      discountType,
                      tipAmount,
                      tipType,
                      total
                    }}
                  />
                </Elements>
              ) : (
                <div className="text-center py-4">
                  <Spinner animation="border" variant="primary" />
                  <p className="mt-2 text-muted">Loading payment form...</p>
                </div>
              )}
            </div>
          )}
        </Modal.Body>
        {paymentMethod === 'cash' && (
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowPaymentModal(false)} disabled={processing}>
              Cancel
            </Button>
            <Button variant="success" onClick={confirmCashPayment} disabled={processing}>
              {processing ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Processing...
                </>
              ) : (
                <>
                  <i className="bi bi-check-circle"></i> Confirm Cash Payment
                </>
              )}
            </Button>
          </Modal.Footer>
        )}
      </Modal>

      {/* PIN Verification Modal */}
      <Modal show={showPinModal} onHide={() => !processingReimbursement && setShowPinModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-shield-lock"></i> Verify Reimbursement PIN</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning">
            <i className="bi bi-info-circle"></i> Enter your 4-digit reimbursement PIN to proceed with reimbursement.
          </Alert>

          {pinError && <Alert variant="danger">{pinError}</Alert>}

          <Form.Group className="mb-3">
            <Form.Label><strong>Reimbursement PIN</strong></Form.Label>
            <Form.Control
              type="text"
              value={reimbursementPin}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                setReimbursementPin(value);
                setPinError('');
              }}
              placeholder="Enter 4-digit PIN"
              maxLength={4}
              pattern="\d{4}"
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handlePinVerification();
                }
              }}
            />
            <Form.Text className="text-muted">
              Enter the 4-digit PIN set in Account settings
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPinModal(false)} disabled={processingReimbursement}>
            Cancel
          </Button>
          <Button
            variant="warning"
            onClick={handlePinVerification}
            disabled={processingReimbursement || reimbursementPin.length !== 4}
          >
            Verify & Continue
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Online Order Detail Modal */}
      <Modal show={showOnlineOrderDetailModal} onHide={() => !processing && setShowOnlineOrderDetailModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-globe"></i> Online Order Details
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedOnlineOrder && (
            <>
              <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                  <h4>Order #{selectedOnlineOrder.orderNumber || selectedOnlineOrder.id.slice(0, 8)}</h4>
                  <Badge bg={selectedOnlineOrder.orderType === 'pickup' ? 'success' : 'warning'} className="me-2">
                    <i className={`bi ${selectedOnlineOrder.orderType === 'pickup' ? 'bi-bag-check' : 'bi-truck'}`}></i>
                    {selectedOnlineOrder.orderType === 'pickup' ? ' Pickup' : ' Delivery'}
                  </Badge>
                  {selectedOnlineOrder.paymentMethod === 'card' ? (
                    <Badge bg="info"><i className="bi bi-credit-card-fill"></i> PRE-PAID</Badge>
                  ) : (
                    <Badge bg="secondary"><i className="bi bi-cash"></i> Pay at Store</Badge>
                  )}
                </div>
                <div className="text-end">
                  <h3 className="text-success mb-0">${(selectedOnlineOrder.total || 0).toFixed(2)}</h3>
                  <small className="text-muted">{formatDate(selectedOnlineOrder.createdAt)}</small>
                </div>
              </div>

              <Card className="mb-3">
                <Card.Header><strong>Customer Information</strong></Card.Header>
                <Card.Body>
                  <Row>
                    <Col md={4}>
                      <i className="bi bi-person-circle me-2"></i>
                      <strong>{selectedOnlineOrder.customer?.name || 'N/A'}</strong>
                    </Col>
                    <Col md={4}>
                      <i className="bi bi-telephone me-2"></i>
                      {selectedOnlineOrder.customer?.phone || 'N/A'}
                    </Col>
                    <Col md={4}>
                      <i className="bi bi-envelope me-2"></i>
                      {selectedOnlineOrder.customer?.email || 'N/A'}
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              <Card className="mb-3">
                <Card.Header><strong>Order Items</strong></Card.Header>
                <Card.Body>
                  <Table size="sm">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="text-center">Qty</th>
                        <th className="text-end">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOnlineOrder.items?.map((item, index) => (
                        <tr key={index}>
                          <td>{item.name}</td>
                          <td className="text-center">{item.quantity}</td>
                          <td className="text-end">${((item.finalPrice || item.price) * item.quantity).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan="2"><strong>Subtotal</strong></td>
                        <td className="text-end"><strong>${(selectedOnlineOrder.subtotal || 0).toFixed(2)}</strong></td>
                      </tr>
                      <tr>
                        <td colSpan="2">Tax</td>
                        <td className="text-end">${(selectedOnlineOrder.tax || 0).toFixed(2)}</td>
                      </tr>
                      <tr className="table-success">
                        <td colSpan="2"><strong>Total</strong></td>
                        <td className="text-end"><strong>${(selectedOnlineOrder.total || 0).toFixed(2)}</strong></td>
                      </tr>
                    </tfoot>
                  </Table>
                </Card.Body>
              </Card>

              {selectedOnlineOrder.paymentMethod === 'card' && (
                <Card className="mb-3 border-info">
                  <Card.Header className="bg-info text-white">
                    <strong><i className="bi bi-credit-card"></i> Payment Details</strong>
                  </Card.Header>
                  <Card.Body>
                    <Row>
                      <Col md={6}>
                        <p className="mb-1"><strong>Payment Method:</strong> Credit Card</p>
                        <p className="mb-1"><strong>Status:</strong>
                          <Badge bg="success" className="ms-2">Paid Online</Badge>
                        </p>
                      </Col>
                      <Col md={6}>
                        <p className="mb-1"><strong>Amount Charged:</strong> ${(selectedOnlineOrder.total || 0).toFixed(2)}</p>
                        {selectedOnlineOrder.paymentDetails?.paymentMethodId && (
                          <p className="mb-1 text-muted"><small>Payment ID: {selectedOnlineOrder.paymentDetails.paymentMethodId}</small></p>
                        )}
                      </Col>
                    </Row>
                    <Alert variant="info" className="mb-0 mt-3">
                      <i className="bi bi-check-circle"></i> This order has been paid online. Click "Verify & Complete" to mark it as fulfilled.
                    </Alert>
                  </Card.Body>
                </Card>
              )}

              {selectedOnlineOrder.paymentMethod !== 'card' && (
                <Card className="mb-3 border-warning">
                  <Card.Header className="bg-warning">
                    <strong><i className="bi bi-wallet2"></i> Collect Payment</strong>
                  </Card.Header>
                  <Card.Body>
                    <p className="mb-3">This customer chose to pay at the restaurant. Total to collect: <strong className="text-success fs-5">${(selectedOnlineOrder.total || 0).toFixed(2)}</strong></p>

                    {/* Payment Method Selection */}
                    <div className="payment-method-selection mb-3">
                      <Form.Label><strong>Select Payment Method:</strong></Form.Label>
                      <div className="payment-method-buttons d-flex gap-2">
                        <Button
                          variant={onlineOrderPaymentMethod === 'cash' ? 'success' : 'outline-secondary'}
                          className="flex-fill"
                          onClick={() => setOnlineOrderPaymentMethod('cash')}
                          disabled={processing}
                        >
                          <i className="bi bi-cash-coin me-2"></i>
                          Cash
                        </Button>
                        <Button
                          variant={onlineOrderPaymentMethod === 'card' ? 'primary' : 'outline-secondary'}
                          className="flex-fill"
                          onClick={() => setOnlineOrderPaymentMethod('card')}
                          disabled={processing}
                        >
                          <i className="bi bi-credit-card-2-front me-2"></i>
                          Card
                        </Button>
                      </div>
                    </div>

                    {/* Cash Payment Info */}
                    {onlineOrderPaymentMethod === 'cash' && (
                      <Alert variant="info" className="mb-0">
                        <i className="bi bi-cash"></i> Collect <strong>${(selectedOnlineOrder.total || 0).toFixed(2)}</strong> in cash from the customer, then click "Confirm Cash Payment".
                      </Alert>
                    )}

                    {/* Card Payment Form */}
                    {onlineOrderPaymentMethod === 'card' && stripePromise && (
                      <div className="card-payment-section">
                        <Elements stripe={stripePromise}>
                          <CardPaymentForm
                            total={selectedOnlineOrder.total || 0}
                            onPaymentSuccess={handleOnlineOrderCardPaymentSuccess}
                            onPaymentError={handleOnlineOrderCardPaymentError}
                            processing={processing}
                            setProcessing={setProcessing}
                            orderIds={[selectedOnlineOrder.id]}
                            tableNumbers={['Online']}
                            restaurantId={currentUser.uid}
                            paymentDetails={{
                              subtotal: selectedOnlineOrder.subtotal || selectedOnlineOrder.total,
                              taxRate: 0,
                              taxAmount: selectedOnlineOrder.tax || 0,
                              total: selectedOnlineOrder.total,
                              orderType: selectedOnlineOrder.orderType
                            }}
                          />
                        </Elements>
                      </div>
                    )}

                    {onlineOrderPaymentMethod === 'card' && !stripePromise && (
                      <div className="text-center py-3">
                        <Spinner animation="border" variant="primary" size="sm" />
                        <span className="ms-2">Loading payment form...</span>
                      </div>
                    )}
                  </Card.Body>
                </Card>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowOnlineOrderDetailModal(false)} disabled={processing}>
            Close
          </Button>
          {selectedOnlineOrder?.paymentMethod === 'card' ? (
            <Button variant="success" onClick={handleVerifyOnlineOrder} disabled={processing}>
              {processing ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Processing...
                </>
              ) : (
                <>
                  <i className="bi bi-check-circle"></i> Verify & Complete
                </>
              )}
            </Button>
          ) : (
            /* Only show Confirm Cash Payment button when cash is selected */
            onlineOrderPaymentMethod === 'cash' && (
              <Button variant="success" onClick={handleOnlineOrderCashPayment} disabled={processing}>
                {processing ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <i className="bi bi-cash"></i> Confirm Cash Payment
                  </>
                )}
              </Button>
            )
          )}
        </Modal.Footer>
      </Modal>

      {/* Reimbursement Modal */}
      <Modal show={showReimbursementModal} onHide={() => !processingReimbursement && setShowReimbursementModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-arrow-counterclockwise"></i> Process Reimbursement</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning">
            <i className="bi bi-info-circle"></i> Tips are non-refundable. Refunds will include order amount, taxes, and discounts.
            {(reimbursementOrderData?.paymentDetails?.stripePaymentIntentId ||
              reimbursementOrderData?.paymentMethod === 'card' ||
              reimbursementOrderData?.paymentDetails?.paymentMethodId) && (
                <div className="mt-2">
                  <Badge bg="primary">
                    <i className="bi bi-credit-card"></i> This order was paid with card
                    {reimbursementOrderData?.paymentDetails?.stripePaymentIntentId
                      ? ' - refund will be processed through Stripe'
                      : ' (online payment)'}
                  </Badge>
                </div>
              )}
          </Alert>

          {/* Search by Order Number */}
          <Form.Group className="mb-4">
            <Form.Label><strong><i className="bi bi-search"></i> Search by Order Number</strong></Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter order number to search..."
              value={orderSearchQuery}
              onChange={(e) => {
                setOrderSearchQuery(e.target.value);
                // Clear table/order selection when searching
                if (e.target.value.trim()) {
                  setReimbursementTable('');
                  setReimbursementOrder('');
                }
              }}
            />
          </Form.Group>

          {/* Search Results */}
          {orderSearchQuery.trim() && getFilteredReimbursementOrders() && (
            <div className="mb-4">
              <h6>Search Results:</h6>
              {getFilteredReimbursementOrders().length > 0 ? (
                <div className="search-results-list">
                  {getFilteredReimbursementOrders().map(order => (
                    <Card
                      key={order.id}
                      className={`mb-2 cursor-pointer ${reimbursementOrder === order.id ? 'border-primary' : ''}`}
                      onClick={() => {
                        setReimbursementTable(order.tableKey);
                        setReimbursementOrder(order.id);
                        setOrderSearchQuery('');
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Card.Body className="py-2">
                        <div className="d-flex justify-content-between align-items-center">
                          <div>
                            <strong>#{order.orderNumber || order.id.slice(0, 8)}</strong>
                            {order.tableKey === '__online__' ? (
                              <Badge bg="info" className="ms-2">Online Order</Badge>
                            ) : (
                              <span className="ms-2 text-muted">Table {order.tableKey}</span>
                            )}
                          </div>
                          <div>
                            <span className="me-3">${(order.total || 0).toFixed(2)}</span>
                            <Badge bg={order.paymentDetails?.paymentMethod === 'card' ? 'primary' : 'secondary'}>
                              {order.paymentDetails?.paymentMethod === 'card' ? 'Card' : 'Cash'}
                            </Badge>
                          </div>
                        </div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              ) : (
                <Alert variant="info">No orders found matching "{orderSearchQuery}"</Alert>
              )}
            </div>
          )}

          {!orderSearchQuery.trim() && (
            <>
              <hr />
              <h6 className="mb-3">Or select by Table/Order Type:</h6>
            </>
          )}

          <Form>
            {!orderSearchQuery.trim() && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label><strong>Select Source</strong></Form.Label>
                  <Form.Select
                    value={reimbursementTable}
                    onChange={(e) => {
                      setReimbursementTable(e.target.value);
                      setReimbursementOrder('');
                    }}
                    required
                  >
                    <option value="">Choose a table or order type...</option>
                    {/* Online Orders option */}
                    {completedOrders['__online__'] && completedOrders['__online__'].length > 0 && (
                      <option value="__online__">
                        🌐 Online Orders ({completedOrders['__online__'].length} {completedOrders['__online__'].length === 1 ? 'order' : 'orders'})
                      </option>
                    )}
                    {/* Table orders */}
                    {Object.keys(completedOrders)
                      .filter(key => key !== '__online__')
                      .map(tableNum => (
                        <option key={tableNum} value={tableNum}>
                          Table {tableNum} ({completedOrders[tableNum].length} {completedOrders[tableNum].length === 1 ? 'order' : 'orders'})
                        </option>
                      ))}
                  </Form.Select>
                </Form.Group>

                {reimbursementTable && completedOrders[reimbursementTable] && (
                  <Form.Group className="mb-3">
                    <Form.Label><strong>Select Order</strong></Form.Label>
                    <Form.Select
                      value={reimbursementOrder}
                      onChange={(e) => setReimbursementOrder(e.target.value)}
                      required
                    >
                      <option value="">Choose an order...</option>
                      {completedOrders[reimbursementTable].map(order => (
                        <option key={order.id} value={order.id}>
                          Order #{order.orderNumber || order.id.slice(0, 8)} - ${(order.total || 0).toFixed(2)} - {formatDate(order.createdAt)}
                          {order.paymentDetails?.paymentMethod === 'card' ? ' (Card)' : ' (Cash)'}
                          {order.source === 'website' ? ' 🌐' : ''}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                )}
              </>
            )}

            {reimbursementOrderData && (
              <>
                <div className="mb-3 p-3 bg-light rounded">
                  <h6>Order Details:</h6>
                  <div className="d-flex justify-content-between mb-2">
                    <span>Order Total:</span>
                    <strong>${(reimbursementOrderData.total || 0).toFixed(2)}</strong>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span>Payment Method:</span>
                    <Badge bg={
                      (reimbursementOrderData.paymentDetails?.paymentMethod === 'card' ||
                        reimbursementOrderData.paymentMethod === 'card' ||
                        reimbursementOrderData.paymentDetails?.paymentMethodId) ? 'primary' : 'secondary'
                    }>
                      {(reimbursementOrderData.paymentDetails?.paymentMethod === 'card' ||
                        reimbursementOrderData.paymentMethod === 'card' ||
                        reimbursementOrderData.paymentDetails?.paymentMethodId) ? (
                        <><i className="bi bi-credit-card"></i> Card</>
                      ) : (
                        <><i className="bi bi-cash"></i> Cash</>
                      )}
                    </Badge>
                  </div>
                  {reimbursementOrderData.paymentDetails?.tipAmount > 0 && (
                    <div className="d-flex justify-content-between mb-2 text-muted">
                      <span>Tip (Non-refundable):</span>
                      <span>-${(reimbursementOrderData.paymentDetails.tipAmount || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="d-flex justify-content-between mt-2 pt-2 border-top">
                    <span><strong>Maximum Refundable:</strong></span>
                    <strong className="text-success">${maxRefundAmount.toFixed(2)}</strong>
                  </div>
                </div>

                <Form.Group className="mb-3">
                  <Form.Label><strong>Refund Type</strong></Form.Label>
                  <Form.Select
                    value={reimbursementType}
                    onChange={(e) => {
                      setReimbursementType(e.target.value);
                      if (e.target.value === 'full') {
                        setPartialRefundAmount(maxRefundAmount);
                      }
                    }}
                  >
                    <option value="full">Full Refund (${maxRefundAmount.toFixed(2)})</option>
                    <option value="partial">Partial Refund</option>
                  </Form.Select>
                </Form.Group>

                {reimbursementType === 'partial' && (
                  <Form.Group className="mb-3">
                    <Form.Label><strong>Refund Amount</strong></Form.Label>
                    <Form.Control
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxRefundAmount}
                      value={partialRefundAmount}
                      onChange={(e) => {
                        const value = e.target.value;
                        setPartialRefundAmount(value === '' ? '' : Math.min(parseFloat(value) || 0, maxRefundAmount));
                      }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value === '') {
                          setPartialRefundAmount(0);
                        }
                      }}
                      placeholder={`Enter amount (max: $${maxRefundAmount.toFixed(2)})`}
                      required
                    />
                    <Form.Text className="text-muted">
                      Maximum refundable: ${maxRefundAmount.toFixed(2)}
                    </Form.Text>
                  </Form.Group>
                )}

                <div className="alert alert-info">
                  <strong>Refund Summary:</strong>
                  <div className="mt-2">
                    {/* Subtotal */}
                    <div className="d-flex justify-content-between mb-2">
                      <span>Subtotal:</span>
                      <span>${(reimbursementOrderData.paymentDetails?.subtotal || reimbursementOrderData.subtotal || reimbursementOrderData.total || 0).toFixed(2)}</span>
                    </div>

                    {/* Tax - Check both paymentDetails.taxAmount (POS) and order.tax (website) */}
                    {(reimbursementOrderData.paymentDetails?.taxAmount > 0 || reimbursementOrderData.tax > 0) && (
                      <div className="d-flex justify-content-between mb-2">
                        <span>Tax ({reimbursementOrderData.paymentDetails?.taxRate || reimbursementOrderData.taxRate || 0}%):</span>
                        <span>${(reimbursementOrderData.paymentDetails?.taxAmount || reimbursementOrderData.tax || 0).toFixed(2)}</span>
                      </div>
                    )}

                    {/* Discount */}
                    {reimbursementOrderData.paymentDetails?.discountAmount > 0 && (
                      <div className="d-flex justify-content-between mb-2 text-success">
                        <span>Discount ({reimbursementOrderData.paymentDetails?.discountType === 'percentage'
                          ? `${reimbursementOrderData.paymentDetails.discountAmount}%`
                          : `$${reimbursementOrderData.paymentDetails.discountAmount.toFixed(2)}`}):</span>
                        <span>
                          -${(reimbursementOrderData.paymentDetails.discountType === 'percentage'
                            ? (reimbursementOrderData.paymentDetails.subtotal || reimbursementOrderData.total || 0) * (reimbursementOrderData.paymentDetails.discountAmount / 100)
                            : reimbursementOrderData.paymentDetails.discountAmount).toFixed(2)}
                        </span>
                      </div>
                    )}

                    {/* Tip - Not refundable */}
                    {reimbursementOrderData.paymentDetails?.tipAmount > 0 && (
                      <div className="d-flex justify-content-between mb-2 text-muted">
                        <span>
                          Tip ({reimbursementOrderData.paymentDetails?.tipType === 'percentage'
                            ? `${reimbursementOrderData.paymentDetails.tipAmount}%`
                            : `$${reimbursementOrderData.paymentDetails.tipAmount.toFixed(2)}`})
                          <small className="text-danger">(Not refundable)</small>:
                        </span>
                        <span>-${(reimbursementOrderData.paymentDetails.tipAmount || 0).toFixed(2)}</span>
                      </div>
                    )}

                    {/* Divider */}
                    <hr className="my-2" />

                    {/* Total Refund Amount */}
                    <div className="d-flex justify-content-between mt-2">
                      <span><strong>Total Refund Amount:</strong></span>
                      <strong className="text-success">
                        ${(reimbursementType === 'full' ? maxRefundAmount : (parseFloat(partialRefundAmount) || 0)).toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </div>
              </>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowReimbursementModal(false)} disabled={processingReimbursement}>
            Cancel
          </Button>
          <Button
            variant="warning"
            onClick={handleReimbursement}
            disabled={processingReimbursement || !reimbursementTable || !reimbursementOrder || (reimbursementType === 'partial' && (parseFloat(partialRefundAmount) || 0) <= 0)}
          >
            {processingReimbursement ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Processing...
              </>
            ) : (
              <>
                <i className="bi bi-arrow-counterclockwise"></i> Process Reimbursement
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Payments;
