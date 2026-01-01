import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Container, Card, Button, Form, Alert, Spinner, Table, Badge, Modal, Row, Col } from 'react-bootstrap';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import activityService from '../services/activityService';
import { getStripe, createPaymentIntent, confirmPayment, processRefund as stripeProcessRefund } from '../services/stripeService';
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
  const [orders, setOrders] = useState([]);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { selectedLocation, isMultiLocation } = useLocation();
  
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
  
  // Payment method selection
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' or 'card'
  const [stripePromise, setStripePromise] = useState(null);

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

  // Load all served orders grouped by table
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

      // Group orders by table number
      const grouped = {};
      ordersData.forEach(order => {
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

    return () => unsubscribe();
  }, [currentUser, selectedLocation, isMultiLocation, selectedTable]);

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

      // Group orders by table number
      const grouped = {};
      ordersData.forEach(order => {
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
            paidAt: new Date().toISOString()
          },
          updatedAt: new Date()
        });
      });

      await Promise.all(updatePromises);

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

      // Check if order was paid with card (has Stripe payment intent)
      const hasStripePayment = selectedOrder.paymentDetails?.stripePaymentIntentId;

      if (hasStripePayment) {
        // Process refund through Stripe
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
          tableNumber: selectedOrder.tableNumber,
          refundAmount,
          refundType: reimbursementType,
          paymentMethod: 'card',
          locationId: selectedOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
        });

        setSuccess(`Card refund processed successfully. Refund amount: $${refundAmount.toFixed(2)}`);
      } else {
        // Cash refund - just update order status locally
        const orderRef = doc(db, `restaurants/${currentUser.uid}/orders/${reimbursementOrder}`);
        await updateDoc(orderRef, {
          status: 'reimbursed',
          reimbursement: {
            amount: refundAmount,
            type: reimbursementType,
            processedAt: new Date(),
            processedBy: currentUser.uid,
            paymentMethod: 'cash'
          },
          updatedAt: new Date()
        });

        // Create reimbursement record for analytics
        const reimbursementsRef = collection(db, `restaurants/${currentUser.uid}/reimbursements`);
        await setDoc(doc(reimbursementsRef), {
          orderId: reimbursementOrder,
          orderNumber: selectedOrder.orderNumber || reimbursementOrder,
          tableNumber: selectedOrder.tableNumber,
          locationId: selectedLocation || currentUser.uid,
          amount: refundAmount,
          type: reimbursementType,
          originalOrderTotal: selectedOrder.total || 0,
          paymentMethod: 'cash',
          processedAt: new Date(),
          processedBy: currentUser.uid
        });

        // Log reimbursement activity
        await activityService.logReimbursementActivity(currentUser.uid, {
          orderNumber: selectedOrder.orderNumber || reimbursementOrder,
          orderId: reimbursementOrder,
          tableNumber: selectedOrder.tableNumber,
          refundAmount,
          refundType: reimbursementType,
          paymentMethod: 'cash',
          locationId: selectedOrder.locationId || (isMultiLocation && selectedLocation ? selectedLocation : currentUser.uid)
        });

        setSuccess(`Cash refund recorded. Refund amount: $${refundAmount.toFixed(2)}`);
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
    <Container fluid className="payments-container">
      {/* Page Header */}
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-credit-card header-icon"></i>
          <div>
            <h2>Payments</h2>
            <p>Process customer payments and manage transactions</p>
          </div>
        </div>
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

      {/* Reimbursement Modal */}
      <Modal show={showReimbursementModal} onHide={() => !processingReimbursement && setShowReimbursementModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-arrow-counterclockwise"></i> Process Reimbursement</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="warning">
            <i className="bi bi-info-circle"></i> Tips are non-refundable. Refunds will include order amount, taxes, and discounts.
            {reimbursementOrderData?.paymentDetails?.stripePaymentIntentId && (
              <div className="mt-2">
                <Badge bg="primary"><i className="bi bi-credit-card"></i> This order was paid with card - refund will be processed through Stripe</Badge>
              </div>
            )}
          </Alert>
          
          <Form>
            <Form.Group className="mb-3">
              <Form.Label><strong>Select Table</strong></Form.Label>
              <Form.Select
                value={reimbursementTable}
                onChange={(e) => {
                  setReimbursementTable(e.target.value);
                  setReimbursementOrder('');
                }}
                required
              >
                <option value="">Choose a table...</option>
                {Object.keys(completedOrders).map(tableNum => (
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
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
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
                    <Badge bg={reimbursementOrderData.paymentDetails?.paymentMethod === 'card' ? 'primary' : 'secondary'}>
                      {reimbursementOrderData.paymentDetails?.paymentMethod === 'card' ? (
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
                      <span>${(reimbursementOrderData.paymentDetails?.subtotal || reimbursementOrderData.total || 0).toFixed(2)}</span>
                    </div>
                    
                    {/* Tax */}
                    {reimbursementOrderData.paymentDetails?.taxAmount > 0 && (
                      <div className="d-flex justify-content-between mb-2">
                        <span>Tax ({reimbursementOrderData.paymentDetails?.taxRate || 0}%):</span>
                        <span>${(reimbursementOrderData.paymentDetails.taxAmount || 0).toFixed(2)}</span>
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
