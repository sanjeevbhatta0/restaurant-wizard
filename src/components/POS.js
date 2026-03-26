import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Spinner, Alert, Button, Badge } from 'react-bootstrap';
import {
  collection,
  addDoc,
  doc,
  getDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Elements } from '@stripe/react-stripe-js';
import lanSyncService from '../services/lanSyncService';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { useMenu } from '../contexts/MenuContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import TableSelectionModal from './TableSelectionModal';
import CardPaymentForm from './CardPaymentForm';
import activityService from '../services/activityService';
import { getStripe } from '../services/stripeService';
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
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const { isPayFirst, requiresTables, getServiceMode } = useSubscription();

  // Pay-first mode state
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [taxRate, setTaxRate] = useState(8);

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

  // Cleanup wake lock on unmount
  useEffect(() => {
    return () => {
      cleanupWakeLock();
    };
  }, []);

  // Load tax rate from restaurant settings
  useEffect(() => {
    if (!currentUser?.uid) return;
    const loadTaxRate = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'restaurants', currentUser.uid));
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.taxRate !== undefined) setTaxRate(data.taxRate);
        }
      } catch (err) {
        console.error('Failed to load tax rate:', err);
      }
    };
    loadTaxRate();
  }, [currentUser]);

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

  // Add item to order
  const addToOrder = (item) => {
    setOrderItems(prevItems => {
      const existingIndex = prevItems.findIndex(i => i.id === item.id);
      if (existingIndex >= 0) {
        const updated = [...prevItems];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1
        };
        return updated;
      }
      return [...prevItems, { ...item, quantity: 1 }];
    });
  };

  // Update item quantity
  const updateQuantity = (itemId, delta) => {
    setOrderItems(prevItems => {
      return prevItems.map(item => {
        if (item.id === itemId) {
          const newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return null;
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean);
    });
  };

  // Remove item from order
  const removeItem = (itemId) => {
    setOrderItems(prevItems => prevItems.filter(item => item.id !== itemId));
  };

  // Clear entire order
  const clearOrder = () => {
    setOrderItems([]);
    setSelectedTables([]);
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
      : currentUser.uid;

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
        subtotal: calculateItemPrice(item) * item.quantity
      })),
      status: 'sent_to_kitchen',
      orderType: isPayFirst() ? 'counter' : 'dine_in',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (tableNumber) {
      orderData.tableNumber = tableNumber;
    }

    if (paymentInfo) {
      orderData.paidAtPOS = true;
      orderData.total = calculateTotalWithTax();
      orderData.paymentDetails = {
        subtotal: calculateSubtotal(),
        taxRate: taxRate,
        taxAmount: calculateTaxAmount(),
        total: calculateTotalWithTax(),
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
    const docRef = await addDoc(
      collection(db, `restaurants/${currentUser.uid}/orders`),
      orderData
    );

    lanSyncService.sendOrder({ id: docRef.id, ...orderData });

    try {
      await incrementOrderCount(currentUser.uid, orderData.total);
    } catch (usageErr) {
      console.error('Failed to track order usage:', usageErr);
    }

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

    await activityService.logOrderActivity(currentUser.uid, 'received', {
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

    setOrderItems([]);
    setSelectedTables([]);
    setShowPaymentStep(false);
    setPaymentMethod(null);
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

  // Initiate payment step (pay-first modes)
  const initiatePayment = () => {
    if (orderItems.length === 0) {
      setError('Please add items to the order');
      return;
    }
    setError('');
    setShowPaymentStep(true);
  };

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
              ? 'Take orders and collect payment at the window'
              : getServiceMode() === 'counter_service'
                ? 'Take orders and collect payment at the counter'
                : 'Process orders and manage your restaurant sales'}</p>
          </div>
          {isPayFirst() && (
            <Badge bg="light" text="dark" className="ms-3" style={{ fontSize: '0.8rem' }}>
              <i className="bi bi-cash-coin me-1"></i> Pay First
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
        <div className="pos-categories">
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
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="pos-item-image"
                  />
                ) : (
                  <div className="pos-item-placeholder">
                    <i className="bi bi-cup-straw"></i>
                  </div>
                )}
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

        {/* Right Panel - Current Order */}
        <div className="pos-order-panel">
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
              orderItems.map(item => (
                <div key={item.id} className="pos-order-item">
                  <div className="pos-order-item-info">
                    <div className="pos-order-item-name">{item.name}</div>
                    <div className="pos-order-item-price">
                      ${calculateItemPrice(item).toFixed(2)} each
                    </div>
                  </div>
                  <div className="pos-order-item-quantity">
                    <button onClick={() => updateQuantity(item.id, -1)}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)}>+</button>
                  </div>
                  <div className="pos-order-item-total">
                    ${(calculateItemPrice(item) * item.quantity).toFixed(2)}
                  </div>
                  <span
                    className="pos-order-item-remove"
                    onClick={() => removeItem(item.id)}
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

            {/* Full-service: Send to Kitchen button */}
            {!isPayFirst() && (
              <button
                className="pos-send-button"
                onClick={sendToKitchen}
                disabled={orderItems.length === 0 || (requiresTables() && selectedTables.length === 0) || sendingOrder}
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

            {/* Pay-first: Payment step */}
            {isPayFirst() && !showPaymentStep && (
              <button
                className="pos-send-button pos-pay-button"
                onClick={initiatePayment}
                disabled={orderItems.length === 0}
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

                {paymentMethod === 'card' && (
                  <div className="pos-card-payment">
                    <Elements stripe={getStripe()}>
                      <CardPaymentForm
                        total={calculateTotalWithTax()}
                        onPaymentSuccess={handleCardPaymentSuccess}
                        onPaymentError={handleCardPaymentError}
                        processing={paymentProcessing}
                        setProcessing={setPaymentProcessing}
                        orderIds={[]}
                        tableNumbers={selectedTables}
                        restaurantId={currentUser.uid}
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
              </div>
            )}

            {orderItems.length > 0 && !showPaymentStep && (
              <button className="pos-clear-button" onClick={clearOrder}>
                Clear Order
              </button>
            )}
          </div>
        </div>

        {/* Order Success Modal */}
        {orderSuccess && (
          <div className="pos-order-success">
            <div className="pos-order-success-content">
              <div className="pos-order-success-icon">
                <i className={`bi ${orderSuccess.paidAtPOS ? 'bi-cash-coin' : 'bi-check-lg'}`}></i>
              </div>
              {orderSuccess.paidAtPOS ? (
                <>
                  <h3>Payment Received!</h3>
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
              <button onClick={() => setOrderSuccess(null)}>
                New Order
              </button>
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
      </div>
    </div>
  );
};

export default POS;
