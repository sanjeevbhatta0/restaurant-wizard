import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Spinner, Alert, Button, Badge, Modal, Form } from 'react-bootstrap';
import {
  collection,
  addDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Elements } from '@stripe/react-stripe-js';
import lanSyncService from '../services/lanSyncService';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { useMenu } from '../contexts/MenuContext';
import MenuItemImage from './MenuItemImage';
import { useSubscription } from '../contexts/SubscriptionContext';
import TableSelectionModal from './TableSelectionModal';
import ReceiptModal from './ReceiptModal';
import CardPaymentForm from './CardPaymentForm';
import activityService from '../services/activityService';
import { getStripe, getStripeConnectStatus } from '../services/stripeService';
import {
  getTerminalConfig,
  listReaders,
  collectServerDrivenPayment,
  cancelServerDrivenAction,
  simulateCardPresent,
  getReaderConnectionType
} from '../services/terminalService';
import { initializeWakeLock, cleanupWakeLock, isWakeLockSupported } from '../services/wakeLockService';
import { incrementOrderCount } from '../services/orderUsageService';
import useFullscreen from '../hooks/useFullscreen';
import './PageHeader.css';
import './POS.css';

const POS = () => {
  // Use shared menu data from context (already filtered by location)
  const { categories, loading: menuLoading } = useMenu();
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [showTableModal, setShowTableModal] = useState(false);
  const [error, setError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [sendingOrder, setSendingOrder] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [showWakeLockPrompt, setShowWakeLockPrompt] = useState(true);
  const { currentUser, restaurantUid } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const { isPayFirst, requiresTables, getServiceMode, customerDisplayEnabled } = useSubscription();

  // Item options modal state (notes + spice level)
  const [showItemOptions, setShowItemOptions] = useState(false);
  const [itemOptionsTarget, setItemOptionsTarget] = useState(null);
  const [itemNotes, setItemNotes] = useState('');
  const [itemSpiceLevel, setItemSpiceLevel] = useState('');
  const [editingCartIndex, setEditingCartIndex] = useState(null);

  // Pay-first mode state
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [taxRate, setTaxRate] = useState(8);
  const [restaurantData, setRestaurantData] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  // Customer display state
  const [cdPending, setCdPending] = useState(false);
  const [cdResponse, setCdResponse] = useState(null);
  const cdUnsubRef = useRef(null);

  // Resizable panel state
  const [categoryWidth, setCategoryWidth] = useState(() => {
    const saved = localStorage.getItem('pos_category_width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const [orderWidth, setOrderWidth] = useState(() => {
    const saved = localStorage.getItem('pos_order_width');
    return saved ? parseInt(saved, 10) : 320;
  });
  const dragRef = useRef({ active: null, startX: 0, startWidth: 0 });

  const handleDragStart = useCallback((panel, e) => {
    e.preventDefault();
    dragRef.current = {
      active: panel,
      startX: e.clientX || e.touches?.[0]?.clientX || 0,
      startWidth: panel === 'category' ? categoryWidth : orderWidth
    };

    const handleMove = (ev) => {
      const clientX = ev.clientX || ev.touches?.[0]?.clientX || 0;
      const delta = clientX - dragRef.current.startX;
      if (dragRef.current.active === 'category') {
        const newWidth = Math.min(400, Math.max(60, dragRef.current.startWidth + delta));
        setCategoryWidth(newWidth);
      } else {
        // Order panel: dragging left = wider, right = narrower
        const newWidth = Math.min(500, Math.max(200, dragRef.current.startWidth - delta));
        setOrderWidth(newWidth);
      }
    };

    const handleEnd = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist to localStorage
      if (dragRef.current.active === 'category') {
        localStorage.setItem('pos_category_width', String(categoryWidth));
      } else {
        localStorage.setItem('pos_order_width', String(orderWidth));
      }
      dragRef.current.active = null;
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
  }, [categoryWidth, orderWidth]);

  // Save widths when they change (debounced via the drag end handler above)
  useEffect(() => {
    localStorage.setItem('pos_category_width', String(categoryWidth));
  }, [categoryWidth]);
  useEffect(() => {
    localStorage.setItem('pos_order_width', String(orderWidth));
  }, [orderWidth]);

  // Stripe promise — POS always uses platform account (not Stripe Connect)
  // This avoids issues with stale/invalid connected accounts
  const [stripePromise, setStripePromise] = useState(null);

  // Terminal state
  const [terminalAvailable, setTerminalAvailable] = useState(false);
  const [terminalReaderId, setTerminalReaderId] = useState(null);
  const [terminalReaderLabel, setTerminalReaderLabel] = useState('');
  const [terminalReaderType, setTerminalReaderType] = useState(''); // 'bluetooth', 'internet', 'simulated'
  const [terminalStatus, setTerminalStatus] = useState(''); // creating_intent, waiting_for_card, processing, succeeded
  const [activePaymentIntentId, setActivePaymentIntentId] = useState(null);

  // KodaPay (mobile Tap to Pay) state
  const [kodaPayPending, setKodaPayPending] = useState(false);
  const [kodaPayOrderRef, setKodaPayOrderRef] = useState(null);
  const kodaPayUnsubscribeRef = useRef(null);

  // Fullscreen mode
  const { isFullscreen, isFullscreenAvailable, toggleFullscreen } = useFullscreen();
  const posWrapperRef = useRef(null);

  // Enable wake lock to keep POS screen on
  const enableWakeLock = useCallback(async () => {
    if (isWakeLockSupported()) {
      const enabled = await initializeWakeLock(setWakeLockActive);
      setShowWakeLockPrompt(false);
      if (enabled) {
        console.log('POS: Screen will stay on');
      }
    }
  }, []);

  // Initialize Stripe — uses connected account if valid, falls back to platform
  useEffect(() => {
    const initStripe = async () => {
      try {
        const connectStatus = await getStripeConnectStatus();
        const connectedId = connectStatus.connected ? connectStatus.stripeAccountId : null;
        const stripe = await getStripe(connectedId);
        setStripePromise(stripe);
      } catch (error) {
        console.error('Error initializing Stripe, falling back to platform:', error);
        const stripe = await getStripe();
        setStripePromise(stripe);
      }
    };
    initStripe();
  }, []);

  // Cleanup wake lock on unmount
  useEffect(() => {
    return () => {
      cleanupWakeLock();
    };
  }, []);

  // Warn before leaving page with active order items
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (orderItems.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [orderItems]);

  // Load restaurant settings (tax rate, name, address, etc.)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const loadRestaurantData = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'restaurants', restaurantUid));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setRestaurantData(data);
          if (data.taxRate !== undefined) setTaxRate(data.taxRate);
        }
      } catch (err) {
        console.error('Failed to load restaurant data:', err);
      }
    };
    loadRestaurantData();
  }, [currentUser, restaurantUid]);

  // Check if Stripe Terminal is configured and find the reader
  useEffect(() => {
    if (!currentUser?.uid) return;
    const checkTerminal = async () => {
      try {
        const config = await getTerminalConfig();
        if (config.configured) {
          const readersResult = await listReaders();
          const readers = readersResult.readers || [];
          if (readers.length > 0) {
            setTerminalAvailable(true);
            setTerminalReaderId(readers[0].id);
            setTerminalReaderLabel(readers[0].label || readers[0].deviceType || 'Reader');
            setTerminalReaderType(readers[0].connectionType || getReaderConnectionType(readers[0].deviceType));
          }
        }
      } catch (err) {
        console.error('Terminal config check failed:', err);
      }
    };
    checkTerminal();
  }, [currentUser]);

  // Handle terminal card payment (pay-first mode) — server-driven
  const handleTerminalPayment = async () => {
    if (orderItems.length === 0 || !terminalReaderId) return;

    setSendingOrder(true);
    setError('');
    setTerminalStatus('');
    setActivePaymentIntentId(null);

    try {
      const isSimulated = terminalReaderType === 'simulated';

      // Collect payment via server-driven flow
      const paymentPromise = collectServerDrivenPayment(
        terminalReaderId,
        calculateTotalWithTax(),
        [],
        selectedTables,
        restaurantUid,
        (status) => setTerminalStatus(status)
      );

      // For simulated readers, auto-present a card after a short delay
      if (isSimulated) {
        setTimeout(async () => {
          try { await simulateCardPresent(terminalReaderId); } catch (e) { /* ignore */ }
        }, 2000);
      }

      const { paymentIntentId } = await paymentPromise;

      // Create the order after successful payment
      const orderNumber = generateOrderNumber();
      const { orderData, orderLocationId } = buildOrderData(orderNumber, {
        method: 'terminal',
        stripePaymentIntentId: paymentIntentId
      });
      await submitOrder(orderData, orderLocationId, orderNumber);
    } catch (err) {
      if (err.message?.includes('canceled')) {
        setError('Payment was canceled.');
      } else {
        setError('Terminal payment failed: ' + err.message);
      }
    } finally {
      setSendingOrder(false);
      setTerminalStatus('');
      setActivePaymentIntentId(null);
    }
  };

  // Auto-select first category when categories load
  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      setSelectedCategory(categories[0].id);
    }
  }, [categories, selectedCategory]);

  // Calculate item price after discount
  const calculateItemPrice = (item) => {
    let price = item.price;
    if (item.discount > 0) {
      if (item.discountType === 'percentage') {
        price = item.price - (item.price * item.discount / 100);
      } else {
        price = item.price - item.discount;
      }
    }
    return Math.max(0, price);
  };

  // Add item to order — opens options modal if spice levels are configured
  const addToOrder = (item) => {
    if (item.spiceLevelEnabled && item.spiceLevels && item.spiceLevels.length > 0) {
      // Show options modal for spice level selection (required)
      setItemOptionsTarget(item);
      setItemNotes('');
      setItemSpiceLevel('');
      setEditingCartIndex(null);
      setShowItemOptions(true);
      return;
    }
    // No spice levels — add directly (merge by id since no notes/spice differ)
    addItemToCart(item, '', '');
  };

  // Add item to cart with notes and spice level
  const addItemToCart = (item, notes, spiceLevel) => {
    setOrderItems(prevItems => {
      const existingIndex = prevItems.findIndex(i =>
        i.id === item.id &&
        (i.notes || '') === (notes || '') &&
        (i.spiceLevel || '') === (spiceLevel || '')
      );
      if (existingIndex >= 0) {
        const updated = [...prevItems];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1
        };
        return updated;
      }
      return [...prevItems, { ...item, quantity: 1, notes: notes || '', spiceLevel: spiceLevel || '' }];
    });
  };

  // Confirm item options modal
  const confirmItemOptions = () => {
    if (itemOptionsTarget?.spiceLevelEnabled && itemOptionsTarget?.spiceLevels?.length > 0 && !itemSpiceLevel) {
      return; // Spice level is required
    }
    if (editingCartIndex !== null) {
      // Editing existing cart item's notes
      setOrderItems(prevItems => {
        const updated = [...prevItems];
        updated[editingCartIndex] = { ...updated[editingCartIndex], notes: itemNotes || '' };
        return updated;
      });
    } else {
      addItemToCart(itemOptionsTarget, itemNotes, itemSpiceLevel);
    }
    setShowItemOptions(false);
    setItemOptionsTarget(null);
    setItemNotes('');
    setItemSpiceLevel('');
    setEditingCartIndex(null);
  };

  // Edit notes on an existing cart item
  const editCartItemNotes = (index) => {
    const item = orderItems[index];
    setItemOptionsTarget(item);
    setItemNotes(item.notes || '');
    setItemSpiceLevel(item.spiceLevel || '');
    setEditingCartIndex(index);
    setShowItemOptions(true);
  };

  // Update item quantity by cart index
  const updateQuantity = (index, delta) => {
    setOrderItems(prevItems => {
      return prevItems.map((item, i) => {
        if (i === index) {
          const newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return null;
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean);
    });
  };

  // Remove item from order by cart index
  const removeItem = (index) => {
    setOrderItems(prevItems => prevItems.filter((_, i) => i !== index));
  };

  // Clear entire order
  const clearOrder = () => {
    setOrderItems([]);
    setSelectedTables([]);
    setCdPending(false);
    setCdResponse(null);
    if (cdUnsubRef.current) {
      cdUnsubRef.current();
      cdUnsubRef.current = null;
    }
  };

  // Calculate order total
  const calculateTotal = () => {
    return orderItems.reduce((total, item) => {
      return total + (calculateItemPrice(item) * item.quantity);
    }, 0);
  };

  // Generate order number
  const generateOrderNumber = () => {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timePart = now.getTime().toString().slice(-4);
    return `ORD-${datePart}-${timePart}`;
  };

  // Calculate tax and totals for pay-first mode
  const calculateSubtotal = () => calculateTotal();
  const calculateTaxAmount = () => calculateSubtotal() * (taxRate / 100);
  const calculateTotalWithTax = () => calculateSubtotal() + calculateTaxAmount();

  // Build order data (shared between full-service and pay-first flows)
  const buildOrderData = (orderNumber, paymentInfo = null) => {
    const orderLocationId = isMultiLocation && selectedLocation
      ? selectedLocation
      : restaurantUid;

    const tableNumber = selectedTables.length > 0
      ? (selectedTables.length === 1 ? selectedTables[0] : selectedTables)
      : null;

    const orderData = {
      orderNumber,
      locationId: orderLocationId,
      items: orderItems.map(item => ({
        id: item.id,
        name: item.name,
        categoryName: item.categoryName,
        price: calculateItemPrice(item),
        originalPrice: item.price,
        quantity: item.quantity,
        subtotal: calculateItemPrice(item) * item.quantity,
        ...(item.notes && { notes: item.notes }),
        ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
      })),
      status: 'sent_to_kitchen',
      orderType: (getServiceMode() === 'counter_service' || getServiceMode() === 'food_truck') ? 'counter' : 'dine_in',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (tableNumber) {
      orderData.tableNumber = tableNumber;
    }

    // Attach customer display response (tip, signature, receipt) if available
    if (cdResponse) {
      orderData.customerDisplayResponse = {
        tipAmount: cdResponse.tipAmount || 0,
        tipPercent: cdResponse.tipPercent || null,
        signature: cdResponse.signature || null,
        receiptMethod: cdResponse.receiptMethod || 'none',
        receiptContact: cdResponse.receiptContact || null,
        confirmedAt: cdResponse.confirmedAt || null
      };
    }

    if (paymentInfo) {
      orderData.paidAtPOS = true;
      const tipAmt = cdResponse?.tipAmount || 0;
      const totalBeforeTip = calculateTotalWithTax();
      orderData.total = totalBeforeTip + tipAmt;
      orderData.paymentDetails = {
        subtotal: calculateSubtotal(),
        taxRate: taxRate,
        taxAmount: calculateTaxAmount(),
        tipAmount: tipAmt,
        total: totalBeforeTip + tipAmt,
        paymentMethod: paymentInfo.method,
        paidAt: new Date().toISOString(),
        ...(paymentInfo.stripePaymentIntentId && { stripePaymentIntentId: paymentInfo.stripePaymentIntentId })
      };
    } else {
      orderData.total = calculateTotal();
    }

    return { orderData, orderLocationId };
  };

  // Submit order to Firestore
  const submitOrder = async (orderData, orderLocationId, orderNumber) => {
    // Check order limit BEFORE creating the order
    try {
      const usageResult = await incrementOrderCount(restaurantUid, orderData.total);
      if (usageResult.blocked) {
        throw new Error(usageResult.reason || 'Order limit reached. Please upgrade your plan.');
      }
    } catch (usageErr) {
      if (usageErr.message?.includes('limit')) {
        throw usageErr; // Re-throw limit errors to block the order
      }
      console.error('Failed to track order usage:', usageErr);
      // Non-limit errors: allow the order to proceed
    }

    const docRef = await addDoc(
      collection(db, `restaurants/${restaurantUid}/orders`),
      orderData
    );

    lanSyncService.sendOrder({ id: docRef.id, ...orderData });

    const tableDisplay = selectedTables.length > 0
      ? (selectedTables.length === 1
        ? selectedTables[0]
        : selectedTables.sort((a, b) => {
          const numA = parseInt(a);
          const numB = parseInt(b);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.localeCompare(b);
        }).join(' and '))
      : null;

    await activityService.logOrderActivity(restaurantUid, 'received', {
      orderNumber,
      tableNumber: tableDisplay,
      status: 'sent_to_kitchen',
      locationId: orderLocationId,
      ...(orderData.paidAtPOS && { paymentMethod: orderData.paymentDetails.paymentMethod, paidAtPOS: true })
    });

    setOrderSuccess({
      orderNumber,
      tableNumber: tableDisplay,
      paidAtPOS: orderData.paidAtPOS || false,
      total: orderData.total
    });

    // Build receipt data for pay-first orders
    if (orderData.paidAtPOS && orderData.paymentDetails) {
      setReceiptData({
        restaurantName: restaurantData?.restaurantName || '',
        restaurantAddress: restaurantData?.address || '',
        restaurantPhone: restaurantData?.phone || '',
        orderNumbers: [orderNumber],
        items: orderData.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })),
        subtotal: orderData.paymentDetails.subtotal,
        taxRate: orderData.paymentDetails.taxRate,
        taxAmount: orderData.paymentDetails.taxAmount,
        discountAmount: 0,
        discountType: 'amount',
        promoCode: null,
        tipAmount: orderData.paymentDetails.tipAmount || 0,
        total: orderData.paymentDetails.total,
        paymentMethod: orderData.paymentDetails.paymentMethod,
        tableNumbers: tableDisplay ? [tableDisplay] : [],
        paidAt: orderData.paymentDetails.paidAt
      });
    }

    setOrderItems([]);
    setSelectedTables([]);
    setShowPaymentStep(false);
    setPaymentMethod(null);
    setCdResponse(null);
    setCdPending(false);
  };

  // Send order to kitchen (full-service mode — no payment)
  const sendToKitchen = async () => {
    if (orderItems.length === 0) {
      setError('Please add items to the order');
      return;
    }
    if (requiresTables() && selectedTables.length === 0) {
      setError('Please assign at least one table');
      return;
    }

    setSendingOrder(true);
    setError('');

    try {
      const orderNumber = generateOrderNumber();
      const { orderData, orderLocationId } = buildOrderData(orderNumber);
      await submitOrder(orderData, orderLocationId, orderNumber);
    } catch (err) {
      setError('Failed to send order: ' + err.message);
    } finally {
      setSendingOrder(false);
    }
  };

  // Handle pay-first cash payment
  const handleCashPayment = async () => {
    if (orderItems.length === 0) return;

    setSendingOrder(true);
    setError('');

    try {
      const orderNumber = generateOrderNumber();
      const { orderData, orderLocationId } = buildOrderData(orderNumber, { method: 'cash' });
      await submitOrder(orderData, orderLocationId, orderNumber);
    } catch (err) {
      setError('Failed to process order: ' + err.message);
    } finally {
      setSendingOrder(false);
    }
  };

  // Handle pay-first card payment success
  const handleCardPaymentSuccess = async (paymentIntentId) => {
    try {
      const orderNumber = generateOrderNumber();
      const { orderData, orderLocationId } = buildOrderData(orderNumber, {
        method: 'card',
        stripePaymentIntentId: paymentIntentId
      });
      await submitOrder(orderData, orderLocationId, orderNumber);
    } catch (err) {
      setError('Payment succeeded but failed to create order: ' + err.message);
    }
  };

  // Handle pay-first card payment error
  const handleCardPaymentError = (errorMessage) => {
    setError('Card payment failed: ' + errorMessage);
  };

  // Handle KodaPay (mobile Tap to Pay) payment
  const handleKodaPayPayment = async () => {
    if (orderItems.length === 0) return;

    setSendingOrder(true);
    setError('');

    try {
      const orderNumber = generateOrderNumber();
      const orderLocationId = isMultiLocation && selectedLocation
        ? selectedLocation
        : restaurantUid;

      const tableNumber = selectedTables.length > 0
        ? (selectedTables.length === 1 ? selectedTables[0] : selectedTables)
        : null;

      // Create order with pending_payment status — KodaPay will pick it up
      const orderData = {
        orderNumber,
        locationId: orderLocationId,
        items: orderItems.map(item => ({
          id: item.id,
          name: item.name,
          categoryName: item.categoryName,
          price: calculateItemPrice(item),
          originalPrice: item.price,
          quantity: item.quantity,
          subtotal: calculateItemPrice(item) * item.quantity,
          ...(item.notes && { notes: item.notes }),
          ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
        })),
        status: 'pending_payment',
        orderType: (getServiceMode() === 'counter_service' || getServiceMode() === 'food_truck') ? 'counter' : 'dine_in',
        subtotal: calculateSubtotal(),
        total: calculateTotalWithTax(),
        taxRate: taxRate,
        taxAmount: calculateTaxAmount(),
        pendingMobilePayment: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (tableNumber) {
        orderData.tableNumber = tableNumber;
      }

      const docRef = await addDoc(
        collection(db, `restaurants/${restaurantUid}/orders`),
        orderData
      );

      // Show waiting screen
      setKodaPayPending(true);
      setKodaPayOrderRef({ id: docRef.id, orderNumber, tableNumber: tableNumber });
      setShowPaymentStep(false);
      setPaymentMethod(null);
      setSendingOrder(false);

      // Listen for payment completion from KodaPay
      const unsubscribe = onSnapshot(
        doc(db, `restaurants/${restaurantUid}/orders`, docRef.id),
        (docSnap) => {
          if (!docSnap.exists()) return;
          const data = docSnap.data();

          if (data.rejectedByMobile === true || (data.status === 'cancelled' && data.pendingMobilePayment !== true)) {
            // Payment was rejected/cancelled by KodaPay
            unsubscribe();
            kodaPayUnsubscribeRef.current = null;
            setKodaPayPending(false);
            setKodaPayOrderRef(null);
            setShowPaymentStep(true);
            setPaymentMethod(null);

            setError('Payment was cancelled from KodaPay. You can choose another payment method.');
            return;
          }

          if (data.paidAtPOS === true && data.status === 'sent_to_kitchen') {
            // Payment completed by KodaPay!
            unsubscribe();
            kodaPayUnsubscribeRef.current = null;
            setKodaPayPending(false);
            setKodaPayOrderRef(null);

            const tableDisplay = selectedTables.length > 0
              ? (selectedTables.length === 1
                ? selectedTables[0]
                : selectedTables.sort((a, b) => {
                  const numA = parseInt(a);
                  const numB = parseInt(b);
                  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                  return a.localeCompare(b);
                }).join(' and '))
              : null;

            setOrderSuccess({
              orderNumber,
              tableNumber: tableDisplay,
              paidAtPOS: true,
              paidViaKodaPay: true,
              total: data.paymentDetails?.total || data.total
            });

            setOrderItems([]);
            setSelectedTables([]);

            // Log activity
            activityService.logOrderActivity(restaurantUid, 'received', {
              orderNumber,
              tableNumber: tableDisplay,
              status: 'sent_to_kitchen',
              locationId: orderLocationId,
              paymentMethod: 'kodapay',
              paidAtPOS: true
            }).catch(err => console.error('Activity log failed:', err));
          }
        }
      );

      kodaPayUnsubscribeRef.current = unsubscribe;
    } catch (err) {
      setError('Failed to create order for KodaPay: ' + err.message);
      setSendingOrder(false);
    }
  };

  // Cancel KodaPay payment
  const cancelKodaPayPayment = async () => {
    if (kodaPayUnsubscribeRef.current) {
      kodaPayUnsubscribeRef.current();
      kodaPayUnsubscribeRef.current = null;
    }

    // Delete the pending order from Firestore
    if (kodaPayOrderRef?.id) {
      try {
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, `restaurants/${restaurantUid}/orders`, kodaPayOrderRef.id));
      } catch (err) {
        console.error('Failed to delete pending order:', err);
      }
    }

    setKodaPayPending(false);
    setKodaPayOrderRef(null);
    setShowPaymentStep(true);
    setPaymentMethod(null);
  };

  // Cleanup KodaPay listener on unmount
  useEffect(() => {
    return () => {
      if (kodaPayUnsubscribeRef.current) {
        kodaPayUnsubscribeRef.current();
      }
    };
  }, []);

  // Initiate payment step (pay-first modes)
  const initiatePayment = () => {
    if (orderItems.length === 0) {
      setError('Please add items to the order');
      return;
    }
    setError('');
    setShowPaymentStep(true);
  };

  // Customer Display — send payment session and listen for confirmation
  const sendToCustomerDisplay = async () => {
    if (!restaurantUid || orderItems.length === 0) return;

    const subtotal = calculateSubtotal();
    const tax = calculateTaxAmount();
    const total = calculateTotalWithTax();
    const tableNumber = selectedTables.length > 0
      ? (selectedTables.length === 1 ? selectedTables[0] : selectedTables.join(', '))
      : null;

    const sessionData = {
      status: 'pending_customer',
      items: orderItems.map(item => ({
        id: item.id,
        name: item.name,
        price: calculateItemPrice(item),
        quantity: item.quantity,
        ...(item.notes && { notes: item.notes }),
        ...(item.spiceLevel && { spiceLevel: item.spiceLevel })
      })),
      subtotal,
      taxRate,
      taxAmount: tax,
      total,
      orderNumber: null,
      tableNumber,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'restaurants', restaurantUid, 'paymentReview', 'current'), sessionData);
      setCdPending(true);
      setCdResponse(null);

      // Listen for customer confirmation
      if (cdUnsubRef.current) cdUnsubRef.current();
      cdUnsubRef.current = onSnapshot(
        doc(db, 'restaurants', restaurantUid, 'paymentReview', 'current'),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.status === 'confirmed' && data.customerResponse) {
              setCdResponse(data.customerResponse);
              setCdPending(false);
            }
          }
        }
      );
    } catch (err) {
      console.error('Failed to send to customer display:', err);
      setError('Failed to send to customer display: ' + err.message);
    }
  };

  const cancelCustomerDisplay = async () => {
    if (cdUnsubRef.current) {
      cdUnsubRef.current();
      cdUnsubRef.current = null;
    }
    setCdPending(false);
    setCdResponse(null);
    try {
      await setDoc(doc(db, 'restaurants', restaurantUid, 'paymentReview', 'current'), { status: 'idle' });
    } catch (err) {
      console.error('Failed to reset customer display:', err);
    }
  };

  const proceedAfterCustomerDisplay = async () => {
    // Reset the paymentReview doc to idle
    try {
      await setDoc(doc(db, 'restaurants', restaurantUid, 'paymentReview', 'current'), { status: 'idle' });
    } catch (err) {
      console.error('Failed to reset customer display:', err);
    }
    if (cdUnsubRef.current) {
      cdUnsubRef.current();
      cdUnsubRef.current = null;
    }

    if (isPayFirst()) {
      // For pay-first, now show payment method selection
      setShowPaymentStep(true);
    } else {
      // For full-service, send to kitchen
      await sendToKitchen();
    }
    setCdResponse(null);
  };

  // Cleanup customer display listener on unmount
  useEffect(() => {
    return () => {
      if (cdUnsubRef.current) cdUnsubRef.current();
    };
  }, []);

  const handleTableSelect = (tables) => {
    setSelectedTables(tables);
  };

  // Get current category's items
  const currentCategoryItems = categories.find(c => c.id === selectedCategory)?.items || [];

  // Show warning if multi-location but no location selected
  if (isMultiLocation && !selectedLocation && !menuLoading) {
    return (
      <div className="pos-wrapper">
        <div className="page-header-gradient">
          <div className="header-content">
            <i className="bi bi-cash-register header-icon"></i>
            <div>
              <h2>Point of Sale</h2>
              <p>Process orders and manage your restaurant sales</p>
            </div>
          </div>
        </div>
        <div className="pos-container">
          <div className="d-flex align-items-center justify-content-center" style={{ height: '100%', flexDirection: 'column' }}>
            <i className="bi bi-exclamation-triangle" style={{ fontSize: '3rem', color: '#ffc107', marginBottom: '20px' }}></i>
            <h4>Please Select a Location</h4>
            <p className="text-muted">Select a location from the dropdown in the header to use POS</p>
          </div>
        </div>
      </div>
    );
  }

  if (menuLoading) {
    return (
      <div className="pos-loading">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  return (
    <div className={`pos-wrapper ${isFullscreen ? 'fullscreen-mode' : ''}`} ref={posWrapperRef}>
      {/* Page Header */}
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-cash-register header-icon"></i>
          <div>
            <h2>Point of Sale</h2>
            <p>{getServiceMode() === 'food_truck'
              ? `Take orders at the window${isPayFirst() ? ' and collect payment' : ''}`
              : getServiceMode() === 'counter_service'
                ? `Take orders at the counter${isPayFirst() ? ' and collect payment' : ''}`
                : 'Process orders and manage your restaurant sales'}</p>
          </div>
          {(getServiceMode() === 'counter_service' || getServiceMode() === 'food_truck') && (
            <Badge bg="light" text="dark" className="ms-3" style={{ fontSize: '0.8rem' }}>
              <i className={`bi ${isPayFirst() ? 'bi-cash-coin' : 'bi-receipt-cutoff'} me-1`}></i>
              {isPayFirst() ? 'Pre-Pay' : 'Post-Pay'}
            </Badge>
          )}
        </div>
        {/* Wake Lock status */}
        <div className="notification-status d-flex gap-2 align-items-center">
          {wakeLockActive ? (
            <Badge bg="info" className="notification-badge">
              <i className="bi bi-display"></i> Screen On
            </Badge>
          ) : showWakeLockPrompt && isWakeLockSupported() ? (
            <Button
              variant="outline-light"
              size="sm"
              onClick={enableWakeLock}
              className="enable-notifications-btn"
            >
              <i className="bi bi-display"></i> Keep Screen On
            </Button>
          ) : null}
          {/* Fullscreen Toggle */}
          {isFullscreenAvailable && (
            <Button
              variant={isFullscreen ? "light" : "outline-light"}
              size="sm"
              onClick={() => toggleFullscreen(posWrapperRef.current)}
              className="ms-2"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
              {isFullscreen ? ' Exit Fullscreen' : ' Fullscreen'}
            </Button>
          )}
        </div>
      </div>

      <div className="pos-container">
        {/* Left Panel - Category Navigation */}
        <div className="pos-categories" style={{ width: categoryWidth }}>
          <h5>Categories</h5>
          <ul className="category-nav">
            {categories.map(category => (
              <li
                key={category.id}
                className={`category-nav-item ${selectedCategory === category.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category.id)}
              >
                {category.name}
                <span style={{ float: 'right', opacity: 0.7 }}>
                  ({category.items?.length || 0})
                </span>
              </li>
            ))}
          </ul>
          {categories.length === 0 && (
            <div style={{ padding: '15px', color: '#bdc3c7', fontSize: '0.9rem' }}>
              No categories yet. Add categories in Menu Management.
            </div>
          )}
        </div>

        {/* Drag handle - Categories / Main */}
        <div
          className="pos-drag-handle"
          onMouseDown={(e) => handleDragStart('category', e)}
          onTouchStart={(e) => handleDragStart('category', e)}
          title="Drag to resize categories"
        >
          <div className="pos-drag-handle-dots" />
        </div>

        {/* Main Panel - Item Tiles */}
        <div className="pos-main">
          <div className="pos-header">
            <h4>
              {categories.find(c => c.id === selectedCategory)?.name || 'Select a Category'}
            </h4>
            {error && (
              <Alert variant="danger" onClose={() => setError('')} dismissible style={{ margin: 0, padding: '8px 15px' }}>
                {error}
              </Alert>
            )}
          </div>

          <div className="pos-items-grid">
            {currentCategoryItems.map(item => (
              <div
                key={item.id}
                className="pos-item-tile"
                onClick={() => addToOrder(item)}
              >
                <MenuItemImage src={item.imageUrl} alt={item.name} size={70} />
                <div className="pos-item-name">{item.name}</div>
                <div className="pos-item-price">
                  ${calculateItemPrice(item).toFixed(2)}
                  {item.discount > 0 && (
                    <span className="pos-item-discount">${item.price.toFixed(2)}</span>
                  )}
                </div>
              </div>
            ))}
            {currentCategoryItems.length === 0 && selectedCategory && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#7f8c8d', padding: '40px' }}>
                <i className="bi bi-inbox" style={{ fontSize: '3rem', marginBottom: '10px', display: 'block' }}></i>
                No items in this category
              </div>
            )}
          </div>
        </div>

        {/* Drag handle - Main / Order Panel */}
        <div
          className="pos-drag-handle"
          onMouseDown={(e) => handleDragStart('order', e)}
          onTouchStart={(e) => handleDragStart('order', e)}
          title="Drag to resize order panel"
        >
          <div className="pos-drag-handle-dots" />
        </div>

        {/* Right Panel - Current Order */}
        <div className="pos-order-panel" style={{ width: orderWidth }}>
          <div className="pos-order-header">
            <h5>Current Order</h5>
            <span>{orderItems.length} item(s)</span>
          </div>

          <div className="pos-order-items">
            {orderItems.length === 0 ? (
              <div className="pos-order-empty">
                <i className="bi bi-cart3"></i>
                <p>No items in order</p>
                <small>Click items to add them</small>
              </div>
            ) : (
              orderItems.map((item, index) => (
                <div key={`${item.id}_${index}`} className="pos-order-item">
                  <div className="pos-order-item-info">
                    <div className="pos-order-item-name">
                      {item.name}
                      <span
                        className="pos-order-item-edit-notes"
                        onClick={(e) => { e.stopPropagation(); editCartItemNotes(index); }}
                        title={item.notes ? 'Edit note' : 'Add note'}
                      >
                        <i className={`bi bi-pencil${item.notes ? '-fill' : ''}`} style={{ fontSize: '0.7rem', marginLeft: '6px', color: item.notes ? '#e67e22' : '#aaa', cursor: 'pointer' }}></i>
                      </span>
                    </div>
                    {item.spiceLevel && (
                      <Badge bg="danger" style={{ fontSize: '0.65rem', marginBottom: '2px' }}>{item.spiceLevel}</Badge>
                    )}
                    {item.notes && (
                      <div className="pos-order-item-notes">{item.notes}</div>
                    )}
                    <div className="pos-order-item-price">
                      ${calculateItemPrice(item).toFixed(2)} each
                    </div>
                  </div>
                  <div className="pos-order-item-quantity">
                    <button onClick={() => updateQuantity(index, -1)}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQuantity(index, 1)}>+</button>
                  </div>
                  <div className="pos-order-item-total">
                    ${(calculateItemPrice(item) * item.quantity).toFixed(2)}
                  </div>
                  <span
                    className="pos-order-item-remove"
                    onClick={() => removeItem(index)}
                  >
                    <i className="bi bi-x-circle"></i>
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="pos-order-footer">
            {/* Subtotal (always shown) */}
            <div className="pos-order-total">
              <span>{isPayFirst() ? 'Subtotal:' : 'Total:'}</span>
              <span>${calculateTotal().toFixed(2)}</span>
            </div>

            {/* Tax breakdown for pay-first modes */}
            {isPayFirst() && orderItems.length > 0 && (
              <div className="pos-tax-breakdown">
                <div className="pos-tax-line">
                  <span>Tax ({taxRate}%):</span>
                  <span>${calculateTaxAmount().toFixed(2)}</span>
                </div>
                <div className="pos-tax-line pos-grand-total">
                  <span>Total:</span>
                  <span>${calculateTotalWithTax().toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Table selection — hidden for food_truck, optional for counter_service */}
            {getServiceMode() !== 'food_truck' && (
              <div className="pos-table-selection">
                <label>Table(s) {!requiresTables() && <span className="text-muted">(optional)</span>}</label>
                <button
                  className="pos-assign-table-btn"
                  onClick={() => setShowTableModal(true)}
                >
                  <i className="bi bi-grid-3x3-gap"></i>
                  {selectedTables.length === 0
                    ? (requiresTables() ? 'Assign Table' : 'No Table')
                    : selectedTables.length === 1
                      ? `Table ${selectedTables[0]}`
                      : `Tables ${selectedTables.sort((a, b) => {
                        const numA = parseInt(a);
                        const numB = parseInt(b);
                        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                        return a.localeCompare(b);
                      }).join(' and ')}`}
                </button>
              </div>
            )}

            {/* Customer Display: tip/receipt info after confirmation */}
            {cdResponse && (
              <div className="pos-cd-response">
                {cdResponse.tipAmount > 0 && (
                  <div className="pos-cd-response-row">
                    <span><i className="bi bi-heart-fill" style={{ color: '#e74c3c' }}></i> Tip:</span>
                    <span>${cdResponse.tipAmount.toFixed(2)}{cdResponse.tipPercent ? ` (${cdResponse.tipPercent}%)` : ''}</span>
                  </div>
                )}
                {cdResponse.receiptMethod && cdResponse.receiptMethod !== 'none' && (
                  <div className="pos-cd-response-row">
                    <span><i className="bi bi-receipt"></i> Receipt:</span>
                    <span>{cdResponse.receiptMethod}{cdResponse.receiptContact ? ` — ${cdResponse.receiptContact}` : ''}</span>
                  </div>
                )}
                {cdResponse.signature && (
                  <div className="pos-cd-response-row">
                    <span><i className="bi bi-pen"></i> Signed</span>
                  </div>
                )}
              </div>
            )}

            {/* Full-service: Send to Kitchen button (or customer display first) */}
            {!isPayFirst() && !cdPending && !cdResponse && (
              <button
                className="pos-send-button"
                onClick={customerDisplayEnabled ? sendToCustomerDisplay : sendToKitchen}
                disabled={orderItems.length === 0 || (requiresTables() && selectedTables.length === 0) || sendingOrder}
              >
                {sendingOrder ? (
                  <>
                    <Spinner animation="border" size="sm" /> Sending...
                  </>
                ) : customerDisplayEnabled ? (
                  <>
                    <i className="bi bi-display"></i> Send to Customer Display
                  </>
                ) : (
                  <>
                    <i className="bi bi-send"></i> Send to Kitchen
                  </>
                )}
              </button>
            )}

            {/* Full-service: after customer display confirms, proceed to kitchen */}
            {!isPayFirst() && cdResponse && (
              <button
                className="pos-send-button"
                onClick={proceedAfterCustomerDisplay}
                disabled={sendingOrder}
              >
                {sendingOrder ? (
                  <>
                    <Spinner animation="border" size="sm" /> Sending...
                  </>
                ) : (
                  <>
                    <i className="bi bi-send"></i> Send to Kitchen
                  </>
                )}
              </button>
            )}

            {/* Customer Display: waiting for customer */}
            {cdPending && (
              <div className="pos-cd-waiting">
                <Spinner animation="border" size="sm" variant="primary" />
                <span style={{ marginLeft: '8px' }}>Waiting for customer...</span>
                <button className="pos-clear-button" onClick={cancelCustomerDisplay} style={{ marginTop: '8px' }}>
                  Cancel
                </button>
              </div>
            )}

            {/* Pay-first: Payment step (or customer display first) */}
            {isPayFirst() && !showPaymentStep && !cdPending && !cdResponse && (
              <button
                className="pos-send-button pos-pay-button"
                onClick={customerDisplayEnabled ? sendToCustomerDisplay : initiatePayment}
                disabled={orderItems.length === 0}
              >
                {customerDisplayEnabled ? (
                  <><i className="bi bi-display"></i> Send to Customer Display</>
                ) : (
                  <><i className="bi bi-cash-coin"></i> Proceed to Payment</>
                )}
              </button>
            )}

            {/* Pay-first: after customer display confirms, proceed to payment */}
            {isPayFirst() && !showPaymentStep && cdResponse && (
              <button
                className="pos-send-button pos-pay-button"
                onClick={proceedAfterCustomerDisplay}
              >
                <i className="bi bi-cash-coin"></i> Proceed to Payment
              </button>
            )}

            {isPayFirst() && showPaymentStep && (
              <div className="pos-payment-step">
                <div className="pos-payment-header">
                  <strong>Select Payment Method</strong>
                  <button className="pos-payment-back" onClick={() => { setShowPaymentStep(false); setPaymentMethod(null); }}>
                    <i className="bi bi-arrow-left"></i> Back
                  </button>
                </div>

                {!paymentMethod && (
                  <div className="pos-payment-methods">
                    <button
                      className="pos-payment-method-btn pos-cash-btn"
                      onClick={() => setPaymentMethod('cash')}
                    >
                      <i className="bi bi-cash-stack"></i>
                      <span>Cash</span>
                    </button>
                    <button
                      className="pos-payment-method-btn pos-card-btn"
                      onClick={() => setPaymentMethod('card')}
                    >
                      <i className="bi bi-credit-card"></i>
                      <span>Card</span>
                    </button>
                    <button
                      className="pos-payment-method-btn pos-terminal-btn"
                      onClick={() => setPaymentMethod('terminal')}
                      style={{ background: 'linear-gradient(135deg, #635BFF, #7B73FF)', color: 'white' }}
                    >
                      <i className={`bi ${terminalReaderType === 'bluetooth' ? 'bi-bluetooth' : 'bi-phone'}`}></i>
                      <span>Terminal</span>
                    </button>
                    <button
                      className="pos-payment-method-btn pos-kodapay-btn"
                      onClick={() => setPaymentMethod('kodapay')}
                      style={{ background: 'linear-gradient(135deg, #1B5E20, #2E7D32)', color: 'white' }}
                    >
                      <i className="bi bi-phone-vibrate"></i>
                      <span>KodaPay</span>
                    </button>
                  </div>
                )}

                {paymentMethod === 'cash' && (
                  <div className="pos-cash-confirm">
                    <div className="pos-payment-amount">
                      <span>Amount Due:</span>
                      <strong>${calculateTotalWithTax().toFixed(2)}</strong>
                    </div>
                    <button
                      className="pos-send-button pos-confirm-cash-btn"
                      onClick={handleCashPayment}
                      disabled={sendingOrder}
                    >
                      {sendingOrder ? (
                        <><Spinner animation="border" size="sm" /> Processing...</>
                      ) : (
                        <><i className="bi bi-check-circle"></i> Confirm Cash Payment</>
                      )}
                    </button>
                  </div>
                )}

                {paymentMethod === 'card' && stripePromise && (
                  <div className="pos-card-payment">
                    <Elements stripe={stripePromise}>
                      <CardPaymentForm
                        total={calculateTotalWithTax()}
                        onPaymentSuccess={handleCardPaymentSuccess}
                        onPaymentError={handleCardPaymentError}
                        processing={paymentProcessing}
                        setProcessing={setPaymentProcessing}
                        orderIds={[]}
                        tableNumbers={selectedTables}
                        restaurantId={restaurantUid}
                        source="pos"
                        paymentDetails={{
                          subtotal: calculateSubtotal(),
                          taxRate: taxRate,
                          taxAmount: calculateTaxAmount(),
                          total: calculateTotalWithTax()
                        }}
                      />
                    </Elements>
                  </div>
                )}

                {paymentMethod === 'terminal' && (
                  <div className="pos-terminal-payment">
                    {!terminalAvailable ? (
                      <div style={{
                        textAlign: 'center', padding: '24px',
                        background: '#f8f9fa', borderRadius: '12px'
                      }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>
                          <i className="bi bi-phone" style={{ color: '#635BFF' }}></i>
                        </div>
                        <p style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: '8px' }}>
                          Terminal Not Set Up
                        </p>
                        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '16px' }}>
                          Go to <strong>Account → Stripe Terminal Setup</strong> to register a terminal reader before using this payment method.
                        </p>
                        <button
                          className="pos-clear-button"
                          onClick={() => setPaymentMethod(null)}
                          style={{ marginTop: '4px' }}
                        >
                          Back to Payment Methods
                        </button>
                      </div>
                    ) : (
                    <>
                    <div className="pos-payment-amount" style={{ marginBottom: '16px' }}>
                      <span>Amount Due:</span>
                      <strong>${calculateTotalWithTax().toFixed(2)}</strong>
                    </div>

                    {terminalStatus === '' && !sendingOrder && (
                      <button
                        className="pos-send-button"
                        onClick={handleTerminalPayment}
                        disabled={sendingOrder}
                        style={{ background: 'linear-gradient(135deg, #635BFF, #7B73FF)', border: 'none' }}
                      >
                        <i className="bi bi-phone"></i> Charge Terminal
                      </button>
                    )}

                    {(terminalStatus || sendingOrder) && (
                      <div style={{
                        textAlign: 'center', padding: '20px',
                        background: '#f8f9fa', borderRadius: '12px'
                      }}>
                        {(terminalStatus === 'connecting' || terminalStatus === 'creating_intent') && (
                          <>
                            <Spinner animation="border" variant="primary" />
                            <p style={{ marginTop: '12px', fontWeight: 500 }}>Connecting to reader...</p>
                          </>
                        )}
                        {terminalStatus === 'waiting_for_card' && (
                          <>
                            <div style={{ fontSize: '3rem', marginBottom: '8px' }}>
                              <i className="bi bi-credit-card-2-front" style={{ color: '#635BFF' }}></i>
                            </div>
                            <p style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '4px' }}>
                              Waiting for Customer
                            </p>
                            <p style={{ color: '#666' }}>
                              {terminalReaderType === 'bluetooth'
                                ? 'Ask customer to tap, insert, or swipe card on the Bluetooth reader'
                                : 'Ask customer to tap, insert, or swipe card on the reader'}
                            </p>
                            {terminalReaderType === 'bluetooth' && (
                              <p style={{ color: '#999', fontSize: '0.85rem' }}>
                                <i className="bi bi-bluetooth me-1"></i>Ensure reader is powered on and connected via Stripe app
                              </p>
                            )}
                            <button
                              className="pos-clear-button"
                              onClick={async () => {
                                try { await cancelServerDrivenAction(terminalReaderId); } catch (e) { /* ignore */ }
                                setTerminalStatus('');
                                setSendingOrder(false);
                              }}
                              style={{ marginTop: '8px' }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {terminalStatus === 'processing' && (
                          <>
                            <Spinner animation="border" variant="success" />
                            <p style={{ marginTop: '12px', fontWeight: 500 }}>Processing payment...</p>
                          </>
                        )}
                      </div>
                    )}
                    </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* KodaPay payment method */}
            {isPayFirst() && showPaymentStep && paymentMethod === 'kodapay' && (
              <div className="pos-kodapay-payment">
                <div className="pos-payment-amount" style={{ marginBottom: '16px' }}>
                  <span>Amount Due:</span>
                  <strong>${calculateTotalWithTax().toFixed(2)}</strong>
                </div>
                <button
                  className="pos-send-button"
                  onClick={handleKodaPayPayment}
                  disabled={sendingOrder}
                  style={{ background: 'linear-gradient(135deg, #1B5E20, #2E7D32)', border: 'none' }}
                >
                  {sendingOrder ? (
                    <><Spinner animation="border" size="sm" /> Sending to KodaPay...</>
                  ) : (
                    <><i className="bi bi-phone-vibrate"></i> Send to KodaPay</>
                  )}
                </button>
                <p style={{ textAlign: 'center', color: '#666', fontSize: '0.85rem', marginTop: '10px' }}>
                  The order will appear on your KodaPay device for Tap to Pay
                </p>
              </div>
            )}

            {orderItems.length > 0 && !showPaymentStep && !kodaPayPending && (
              <button className="pos-clear-button" onClick={clearOrder}>
                Clear Order
              </button>
            )}
          </div>
        </div>

        {/* KodaPay Waiting Overlay */}
        {kodaPayPending && kodaPayOrderRef && (
          <div className="pos-order-success" style={{ background: 'rgba(27, 94, 32, 0.95)' }}>
            <div className="pos-order-success-content">
              <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>
                <i className="bi bi-phone-vibrate" style={{ color: '#fff' }}></i>
              </div>
              <h3 style={{ color: '#fff' }}>Waiting for KodaPay...</h3>
              <div className="order-number pos-order-number-large" style={{ color: '#A5D6A7' }}>
                {kodaPayOrderRef.orderNumber}
              </div>
              <div style={{ margin: '20px 0' }}>
                <Spinner animation="border" variant="light" />
              </div>
              <p style={{ color: '#C8E6C9', fontSize: '1rem', maxWidth: '300px', margin: '0 auto 20px' }}>
                Open KodaPay on your iPhone and tap the customer's card to complete payment
              </p>
              <button
                onClick={cancelKodaPayPayment}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.95rem'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Order Success Modal */}
        {orderSuccess && (
          <div className="pos-order-success">
            <div className="pos-order-success-content">
              <div className="pos-order-success-icon">
                <i className={`bi ${orderSuccess.paidViaKodaPay ? 'bi-phone-vibrate' : orderSuccess.paidAtPOS ? 'bi-cash-coin' : 'bi-check-lg'}`}></i>
              </div>
              {orderSuccess.paidAtPOS ? (
                <>
                  <h3>{orderSuccess.paidViaKodaPay ? 'KodaPay Payment Received!' : 'Payment Received!'}</h3>
                  <div className="order-number pos-order-number-large">{orderSuccess.orderNumber}</div>
                  <div className="pos-success-detail">
                    Order sent to kitchen — ${orderSuccess.total?.toFixed(2)}
                  </div>
                  {orderSuccess.tableNumber && (
                    <div className="table-number">Table #{orderSuccess.tableNumber}</div>
                  )}
                </>
              ) : (
                <>
                  <h3>Order Sent to Kitchen!</h3>
                  <div className="order-number">{orderSuccess.orderNumber}</div>
                  {orderSuccess.tableNumber && (
                    <div className="table-number">Table #{orderSuccess.tableNumber}</div>
                  )}
                </>
              )}
              <div className="pos-success-actions">
                {orderSuccess.paidAtPOS && receiptData && (
                  <button className="pos-receipt-btn" onClick={() => setShowReceiptModal(true)}>
                    <i className="bi bi-receipt me-1"></i> View Receipt
                  </button>
                )}
                <button onClick={() => { setOrderSuccess(null); setReceiptData(null); }}>
                  New Order
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table Selection Modal */}
        {getServiceMode() !== 'food_truck' && (
          <TableSelectionModal
            show={showTableModal}
            onHide={() => setShowTableModal(false)}
            onSelect={handleTableSelect}
            selectedTables={selectedTables}
          />
        )}

        {/* Receipt Modal */}
        <ReceiptModal
          show={showReceiptModal}
          onHide={() => setShowReceiptModal(false)}
          receiptData={receiptData}
        />

        {/* Item Options Modal (Notes + Spice Level) */}
        <Modal
          show={showItemOptions}
          onHide={() => { setShowItemOptions(false); setItemOptionsTarget(null); setEditingCartIndex(null); }}
          centered
          size="sm"
        >
          <Modal.Header closeButton>
            <Modal.Title style={{ fontSize: '1rem' }}>
              {editingCartIndex !== null ? 'Edit Note' : (itemOptionsTarget?.name || 'Item Options')}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {/* Spice Level (required when available, only for new items) */}
            {editingCartIndex === null && itemOptionsTarget?.spiceLevelEnabled && itemOptionsTarget?.spiceLevels?.length > 0 && (
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold">
                  Spice Level <span className="text-danger">*</span>
                </Form.Label>
                <div className="d-flex flex-wrap gap-2">
                  {itemOptionsTarget.spiceLevels.map((level) => (
                    <Button
                      key={level}
                      variant={itemSpiceLevel === level ? 'danger' : 'outline-danger'}
                      size="sm"
                      onClick={() => setItemSpiceLevel(level)}
                    >
                      {level}
                    </Button>
                  ))}
                </div>
                {!itemSpiceLevel && (
                  <Form.Text className="text-danger">Please select a spice level.</Form.Text>
                )}
              </Form.Group>
            )}

            {/* Notes */}
            <Form.Group>
              <Form.Label>Notes (optional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                maxLength={200}
                placeholder="e.g. extra roasted, no ice, add straw"
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
                autoFocus={editingCartIndex !== null}
              />
              <Form.Text className="text-muted">{itemNotes.length}/200</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => { setShowItemOptions(false); setItemOptionsTarget(null); setEditingCartIndex(null); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={confirmItemOptions}
              disabled={editingCartIndex === null && itemOptionsTarget?.spiceLevelEnabled && itemOptionsTarget?.spiceLevels?.length > 0 && !itemSpiceLevel}
            >
              {editingCartIndex !== null ? 'Update' : 'Add to Order'}
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    </div>
  );
};

export default POS;
