import React, { useState, useEffect } from 'react';
import { Container, Table, Badge, Form, Row, Col, Card, Button, Modal, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, setDoc, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import activityService from '../services/activityService';
import './PageHeader.css';

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const { currentUser, restaurantUid } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();

  // Search state
  const [searchMode, setSearchMode] = useState('none'); // 'none', 'orderNumber', 'date'
  const [searchOrderNumber, setSearchOrderNumber] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Reimbursement state
  const [showPinModal, setShowPinModal] = useState(false);
  const [showReimbursementModal, setShowReimbursementModal] = useState(false);
  const [reimbursementPin, setReimbursementPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [selectedOrderForReimbursement, setSelectedOrderForReimbursement] = useState(null);
  const [reimbursementType, setReimbursementType] = useState('full'); // 'full' or 'partial'
  const [partialRefundAmount, setPartialRefundAmount] = useState('');
  const [processingReimbursement, setProcessingReimbursement] = useState(false);
  const [restaurantData, setRestaurantData] = useState(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Load restaurant data for PIN
  useEffect(() => {
    if (!currentUser) return;

    const fetchRestaurantData = async () => {
      try {
        const docRef = doc(db, "restaurants", restaurantUid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setRestaurantData(docSnap.data());
        }
      } catch (error) {
        console.error('Error fetching restaurant data:', error);
      }
    };

    fetchRestaurantData();
  }, [currentUser, restaurantUid]);

  useEffect(() => {
    if (!currentUser || !restaurantUid) return;

    const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);
    const q = query(ordersRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter by location if multi-location
      if (isMultiLocation && selectedLocation) {
        ordersData = ordersData.filter(order => {
          return order.locationId === selectedLocation;
        });
      }

      setOrders(ordersData);
      filterOrders(ordersData, statusFilter);
    });

    return () => unsubscribe();
  }, [currentUser, restaurantUid, isMultiLocation, selectedLocation]);

  const filterOrders = (ordersData, status) => {
    if (status === 'all') {
      setFilteredOrders(ordersData);
    } else {
      setFilteredOrders(ordersData.filter(order => order.status === status));
    }
  };

  const handleFilterChange = (status) => {
    setStatusFilter(status);
    filterOrders(orders, status);
  };

  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case 'new':
        return 'primary';
      case 'sent_to_kitchen':
        return 'info';
      case 'preparing':
        return 'warning';
      case 'ready':
        return 'success';
      case 'served':
        return 'success';
      case 'completed':
        return 'dark';
      case 'cancelled':
        return 'danger';
      case 'reimbursed':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const formatStatus = (status) => {
    switch (status) {
      case 'sent_to_kitchen':
        return 'Sent to Kitchen';
      case 'new':
        return 'New';
      case 'preparing':
        return 'Preparing';
      case 'ready':
        return 'Ready';
      case 'served':
        return 'Served';
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'reimbursed':
        return 'Reimbursed';
      default:
        return status;
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return new Intl.DateTimeFormat('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date);
  };

  const formatPrice = (price) => {
    return typeof price === 'number' ? `$${price.toFixed(2)}` : '$0.00';
  };

  // Check if order is within 7 days (eligible for reimbursement)
  const isWithin7Days = (order) => {
    if (!order.createdAt) return false;
    const orderDate = order.createdAt.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return orderDate >= sevenDaysAgo;
  };

  // Check if order can be reimbursed
  const canReimburse = (order) => {
    return (
      order.status === 'completed' &&
      (order.reimbursement === undefined || order.reimbursement === null) &&
      isWithin7Days(order)
    );
  };

  // Search by order number
  const handleSearchByOrderNumber = async () => {
    if (!searchOrderNumber.trim()) {
      setSearchError('Please enter an order number');
      return;
    }

    setSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);

      // Search through all orders and filter client-side
      const snapshot = await getDocs(ordersRef);
      const results = [];

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const orderNum = data.orderNumber || doc.id.slice(0, 8);
        if (orderNum.toLowerCase().includes(searchOrderNumber.toLowerCase()) ||
          doc.id.toLowerCase().includes(searchOrderNumber.toLowerCase())) {
          results.push({ id: doc.id, ...data });
        }
      });

      // Apply location filter
      let filteredResults = results;
      if (isMultiLocation && selectedLocation) {
        filteredResults = results.filter(order => order.locationId === selectedLocation);
      }

      setSearchResults(filteredResults);
      if (filteredResults.length === 0) {
        setSearchError('No orders found matching that order number');
      }
    } catch (err) {
      console.error('Error searching orders:', err);
      setSearchError('Failed to search orders');
    } finally {
      setSearching(false);
    }
  };

  // Search by date
  const handleSearchByDate = async () => {
    if (!searchDate) {
      setSearchError('Please select a date');
      return;
    }

    setSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);
      const snapshot = await getDocs(ordersRef);

      const selectedDate = new Date(searchDate);
      const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));

      const results = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const orderDate = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        if (orderDate >= startOfDay && orderDate <= endOfDay) {
          results.push({ id: doc.id, ...data });
        }
      });

      // Apply location filter
      let filteredResults = results;
      if (isMultiLocation && selectedLocation) {
        filteredResults = results.filter(order => order.locationId === selectedLocation);
      }

      // Sort by date (newest first)
      filteredResults.sort((a, b) => {
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return dateB - dateA;
      });

      setSearchResults(filteredResults);
      if (filteredResults.length === 0) {
        setSearchError(`No orders found for ${searchDate}`);
      }
    } catch (err) {
      console.error('Error searching orders:', err);
      setSearchError('Failed to search orders');
    } finally {
      setSearching(false);
    }
  };

  // Clear search
  const clearSearch = () => {
    setSearchMode('none');
    setSearchOrderNumber('');
    setSearchDate('');
    setSearchResults([]);
    setSearchError('');
  };

  // Handle reimbursement click
  const handleReimbursementClick = (order) => {
    if (!restaurantData?.reimbursementPin) {
      setError('Reimbursement PIN not set. Please set it in Account settings first.');
      return;
    }

    setSelectedOrderForReimbursement(order);
    setShowPinModal(true);
    setReimbursementPin('');
    setPinError('');
  };

  // Verify PIN
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
    setReimbursementType('full');
    setPartialRefundAmount('');
    setShowReimbursementModal(true);
  };

  // Calculate refundable amount
  const calculateRefundAmount = (order) => {
    if (!order) return 0;
    const paymentDetails = order.paymentDetails || {};

    if (paymentDetails.total) {
      const tipAmount = paymentDetails.tipAmount || 0;
      return Math.max(0, paymentDetails.total - tipAmount);
    }

    return order.total || 0;
  };

  // Process reimbursement
  const handleReimbursement = async () => {
    if (!selectedOrderForReimbursement) {
      setError('No order selected');
      return;
    }

    const order = selectedOrderForReimbursement;

    setProcessingReimbursement(true);
    setError('');

    try {
      const refundAmount = reimbursementType === 'full'
        ? calculateRefundAmount(order)
        : Math.min(parseFloat(partialRefundAmount) || 0, calculateRefundAmount(order));

      if (refundAmount <= 0) {
        setError('Invalid refund amount');
        setProcessingReimbursement(false);
        return;
      }

      // Determine payment method
      const hasStripePayment = order.paymentDetails?.stripePaymentIntentId ||
        order.paymentMethod === 'card' ||
        order.paymentDetails?.paymentMethodId;

      const actualPaymentMethod = hasStripePayment ? 'card' :
        (order.paymentMethod === 'payAtRestaurant' ? 'cash' : (order.paymentMethod || 'cash'));

      const orderTableNumber = order.tableNumber ||
        (order.source === 'website' ? 'Online Order' : null);
      const isOnlineOrder = order.source === 'website';

      // Update order status
      const orderRef = doc(db, `restaurants/${restaurantUid}/orders/${order.id}`);
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

      // Create reimbursement record
      const reimbursementsRef = collection(db, `restaurants/${restaurantUid}/reimbursements`);
      const reimbursementData = {
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        locationId: order.locationId || selectedLocation || restaurantUid,
        amount: refundAmount,
        type: reimbursementType,
        originalOrderTotal: order.total || 0,
        paymentMethod: actualPaymentMethod,
        processedAt: new Date(),
        processedBy: currentUser.uid,
        isOnlineOrder: isOnlineOrder,
        orderType: order.orderType || 'dine_in'
      };

      if (orderTableNumber && orderTableNumber !== 'Online Order') {
        reimbursementData.tableNumber = orderTableNumber;
      }

      await setDoc(doc(reimbursementsRef), reimbursementData);

      // Log activity
      await activityService.logReimbursementActivity(restaurantUid, {
        orderNumber: order.orderNumber || order.id,
        orderId: order.id,
        tableNumber: orderTableNumber || 'Online Order',
        refundAmount,
        refundType: reimbursementType,
        paymentMethod: actualPaymentMethod,
        isOnlineOrder: isOnlineOrder,
        locationId: order.locationId || (isMultiLocation && selectedLocation ? selectedLocation : restaurantUid)
      });

      setSuccess(`Reimbursement processed successfully. Refund amount: $${refundAmount.toFixed(2)}`);
      setShowReimbursementModal(false);
      setSelectedOrderForReimbursement(null);

      // Update search results if applicable
      if (searchResults.length > 0) {
        setSearchResults(prev => prev.map(o =>
          o.id === order.id ? { ...o, status: 'reimbursed', reimbursement: { amount: refundAmount } } : o
        ));
      }
    } catch (err) {
      console.error('Error processing reimbursement:', err);
      setError('Failed to process reimbursement: ' + err.message);
    } finally {
      setProcessingReimbursement(false);
    }
  };

  // Render order table
  const renderOrderTable = (ordersList, showReimbursementButton = false) => (
    <Table responsive hover>
      <thead>
        <tr>
          <th>Order #</th>
          <th>Date</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Total</th>
          <th>Pickup Time</th>
          <th>Status</th>
          {showReimbursementButton && <th>Action</th>}
        </tr>
      </thead>
      <tbody>
        {ordersList.map(order => (
          <tr key={order.id}>
            <td><strong>{order.orderNumber || order.id.slice(0, 8)}</strong></td>
            <td>{formatDate(order.createdAt)}</td>
            <td>
              {order.customerName}<br />
              <small className="text-muted">{order.customerPhone}</small>
            </td>
            <td>
              {order.items?.map((item, index) => (
                <div key={index}>
                  {item.quantity}x {item.name}
                </div>
              ))}
            </td>
            <td>{formatPrice(order.total)}</td>
            <td>{order.pickupTime}</td>
            <td>
              <Badge bg={getStatusBadgeVariant(order.status)}>
                {formatStatus(order.status)}
              </Badge>
              {order.tableNumber && (
                <div><small className="text-muted">Table #{order.tableNumber}</small></div>
              )}
              {order.reimbursement && (
                <div><small className="text-success">Refunded: ${order.reimbursement.amount?.toFixed(2)}</small></div>
              )}
            </td>
            {showReimbursementButton && (
              <td>
                {canReimburse(order) ? (
                  <Button
                    variant="outline-warning"
                    size="sm"
                    onClick={() => handleReimbursementClick(order)}
                  >
                    <i className="bi bi-arrow-counterclockwise me-1"></i>
                    Reimburse
                  </Button>
                ) : order.status === 'reimbursed' ? (
                  <Badge bg="secondary">Reimbursed</Badge>
                ) : order.status === 'completed' && !isWithin7Days(order) ? (
                  <small className="text-muted">Expired (&gt;7 days)</small>
                ) : null}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <Container className="py-4">
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-cart header-icon"></i>
          <div>
            <h2>Orders</h2>
            <p>Manage and track all customer orders</p>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <Alert variant="success" onClose={() => setSuccess('')} dismissible>
          {success}
        </Alert>
      )}
      {error && (
        <Alert variant="danger" onClose={() => setError('')} dismissible>
          {error}
        </Alert>
      )}

      {/* Search Section */}
      <Card className="mb-4">
        <Card.Header className="bg-primary text-white">
          <i className="bi bi-search me-2"></i>
          Order Search & Reimbursement
        </Card.Header>
        <Card.Body>
          <Row className="mb-3">
            <Col xs="auto">
              <Form.Check
                inline
                type="radio"
                id="search-none"
                label="Normal View"
                checked={searchMode === 'none'}
                onChange={() => clearSearch()}
              />
              <Form.Check
                inline
                type="radio"
                id="search-order"
                label="Search by Order #"
                checked={searchMode === 'orderNumber'}
                onChange={() => { setSearchMode('orderNumber'); setSearchResults([]); setSearchError(''); }}
              />
              <Form.Check
                inline
                type="radio"
                id="search-date"
                label="Search by Date"
                checked={searchMode === 'date'}
                onChange={() => { setSearchMode('date'); setSearchResults([]); setSearchError(''); }}
              />
            </Col>
          </Row>

          {searchMode === 'orderNumber' && (
            <Row className="align-items-end">
              <Col md={4}>
                <Form.Group>
                  <Form.Label>Order Number</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="text"
                      placeholder="Enter order number..."
                      value={searchOrderNumber}
                      onChange={(e) => setSearchOrderNumber(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearchByOrderNumber()}
                    />
                    <Button
                      variant="primary"
                      onClick={handleSearchByOrderNumber}
                      disabled={searching}
                    >
                      {searching ? <Spinner size="sm" /> : <i className="bi bi-search"></i>}
                    </Button>
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col xs="auto">
                <Button variant="outline-secondary" onClick={clearSearch}>
                  Clear
                </Button>
              </Col>
            </Row>
          )}

          {searchMode === 'date' && (
            <Row className="align-items-end">
              <Col md={4}>
                <Form.Group>
                  <Form.Label>Select Date</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="date"
                      value={searchDate}
                      onChange={(e) => setSearchDate(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                    />
                    <Button
                      variant="primary"
                      onClick={handleSearchByDate}
                      disabled={searching}
                    >
                      {searching ? <Spinner size="sm" /> : <i className="bi bi-search"></i>}
                    </Button>
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col xs="auto">
                <Button variant="outline-secondary" onClick={clearSearch}>
                  Clear
                </Button>
              </Col>
            </Row>
          )}

          {searchError && (
            <Alert variant="warning" className="mt-3 mb-0">
              {searchError}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {/* Search Results */}
      {searchMode !== 'none' && searchResults.length > 0 && (
        <Card className="mb-4">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <span><i className="bi bi-list-check me-2"></i>Search Results ({searchResults.length} orders)</span>
            <small className="text-muted">Orders within 7 days can be reimbursed</small>
          </Card.Header>
          <Card.Body className="p-0">
            {renderOrderTable(searchResults, true)}
          </Card.Body>
        </Card>
      )}

      {/* Normal Orders View (only show when not searching) */}
      {searchMode === 'none' && (
        <>
          <Row className="mb-4 align-items-center">
            <Col xs="auto">
              <Form.Group>
                <Form.Select
                  value={statusFilter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  style={{ minWidth: '200px' }}
                >
                  <option value="all">All Orders</option>
                  <option value="new">New Orders</option>
                  <option value="sent_to_kitchen">Sent to Kitchen</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready</option>
                  <option value="served">Served</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="reimbursed">Reimbursed</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          {renderOrderTable(filteredOrders, false)}

          {filteredOrders.length === 0 && (
            <div className="text-center py-4">
              <p className="text-muted">
                {statusFilter === 'all'
                  ? 'No orders yet'
                  : `No ${statusFilter} orders`}
              </p>
            </div>
          )}
        </>
      )}

      {/* PIN Verification Modal */}
      <Modal show={showPinModal} onHide={() => setShowPinModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-shield-lock me-2"></i>
            Enter Reimbursement PIN
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">
            Enter your 4-digit PIN to proceed with the reimbursement for order <strong>#{selectedOrderForReimbursement?.orderNumber || selectedOrderForReimbursement?.id?.slice(0, 8)}</strong>
          </p>
          <Form.Group>
            <Form.Control
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="Enter 4-digit PIN"
              value={reimbursementPin}
              onChange={(e) => setReimbursementPin(e.target.value.replace(/\D/g, ''))}
              className="text-center fs-4"
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && handlePinVerification()}
            />
          </Form.Group>
          {pinError && (
            <Alert variant="danger" className="mt-3 mb-0">
              {pinError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPinModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handlePinVerification}>
            Verify PIN
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Reimbursement Modal */}
      <Modal show={showReimbursementModal} onHide={() => setShowReimbursementModal(false)} centered>
        <Modal.Header closeButton className="bg-warning">
          <Modal.Title>
            <i className="bi bi-arrow-counterclockwise me-2"></i>
            Process Reimbursement
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedOrderForReimbursement && (
            <>
              <div className="mb-3 p-3 bg-light rounded">
                <Row>
                  <Col>
                    <small className="text-muted">Order #</small>
                    <p className="mb-0 fw-bold">{selectedOrderForReimbursement.orderNumber || selectedOrderForReimbursement.id?.slice(0, 8)}</p>
                  </Col>
                  <Col>
                    <small className="text-muted">Original Total</small>
                    <p className="mb-0 fw-bold">{formatPrice(selectedOrderForReimbursement.total)}</p>
                  </Col>
                  <Col>
                    <small className="text-muted">Refundable</small>
                    <p className="mb-0 fw-bold text-success">{formatPrice(calculateRefundAmount(selectedOrderForReimbursement))}</p>
                  </Col>
                </Row>
              </div>

              <Form.Group className="mb-3">
                <Form.Label>Reimbursement Type</Form.Label>
                <div>
                  <Form.Check
                    inline
                    type="radio"
                    id="reimburse-full"
                    label={`Full Refund (${formatPrice(calculateRefundAmount(selectedOrderForReimbursement))})`}
                    checked={reimbursementType === 'full'}
                    onChange={() => setReimbursementType('full')}
                  />
                  <Form.Check
                    inline
                    type="radio"
                    id="reimburse-partial"
                    label="Partial Refund"
                    checked={reimbursementType === 'partial'}
                    onChange={() => setReimbursementType('partial')}
                  />
                </div>
              </Form.Group>

              {reimbursementType === 'partial' && (
                <Form.Group className="mb-3">
                  <Form.Label>Refund Amount</Form.Label>
                  <InputGroup>
                    <InputGroup.Text>$</InputGroup.Text>
                    <Form.Control
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={calculateRefundAmount(selectedOrderForReimbursement)}
                      value={partialRefundAmount}
                      onChange={(e) => setPartialRefundAmount(e.target.value)}
                      placeholder="Enter amount"
                    />
                  </InputGroup>
                  <Form.Text className="text-muted">
                    Maximum refundable: {formatPrice(calculateRefundAmount(selectedOrderForReimbursement))}
                  </Form.Text>
                </Form.Group>
              )}

              <Alert variant="info" className="mb-0">
                <i className="bi bi-info-circle me-2"></i>
                This will mark the order as reimbursed and create a record for your analytics.
              </Alert>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowReimbursementModal(false)}>
            Cancel
          </Button>
          <Button
            variant="warning"
            onClick={handleReimbursement}
            disabled={processingReimbursement || (reimbursementType === 'partial' && (!partialRefundAmount || parseFloat(partialRefundAmount) <= 0))}
          >
            {processingReimbursement ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Processing...
              </>
            ) : (
              <>
                <i className="bi bi-check-circle me-2"></i>
                Confirm Reimbursement
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Orders;