import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Container, Table, Badge, Form, Row, Col, Card, Button, Modal, Alert, Spinner, InputGroup, Pagination, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, setDoc, where, getDocs, limit, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import activityService from '../services/activityService';
import './PageHeader.css';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50];

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const { currentUser, restaurantUid } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Sorting state
  const [sortField, setSortField] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');

  // Inline filter state
  const [orderNumberFilter, setOrderNumberFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');

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
    // Only load last 30 days of orders to control Firestore read costs.
    // Older orders are accessible via the date search feature.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const constraints = [
      where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)),
      orderBy('createdAt', 'desc'),
      limit(500)
    ];
    if (isMultiLocation && selectedLocation) {
      constraints.push(where('locationId', '==', selectedLocation));
    }
    const q = query(ordersRef, ...constraints);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setOrders(ordersData);
      filterOrders(ordersData, statusFilter);
    });

    return () => unsubscribe();
  }, [currentUser, restaurantUid, isMultiLocation, selectedLocation]);

  const filterOrders = useCallback((ordersData, status) => {
    if (status === 'all') {
      setFilteredOrders(ordersData);
    } else {
      setFilteredOrders(ordersData.filter(order => order.status === status));
    }
    setCurrentPage(1); // Reset to first page on filter change
  }, []);

  const handleFilterChange = (status) => {
    setStatusFilter(status);
    filterOrders(orders, status);
  };

  // Sort + inline filter logic applied to filteredOrders
  const processedOrders = useMemo(() => {
    let result = [...filteredOrders];

    // Inline text filters
    if (orderNumberFilter) {
      const q = orderNumberFilter.toLowerCase();
      result = result.filter(o =>
        (o.orderNumber || o.id || '').toLowerCase().includes(q)
      );
    }
    if (customerFilter) {
      const q = customerFilter.toLowerCase();
      result = result.filter(o => {
        const name = (o.customer?.name || o.customerName || '').toLowerCase();
        const phone = (o.customer?.phone || o.customerPhone || '').toLowerCase();
        const email = (o.customer?.email || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || email.includes(q);
      });
    }
    if (sourceFilter !== 'all') {
      result = result.filter(o => (o.source || 'pos') === sourceFilter);
    }

    // Sort
    result.sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'orderNumber':
          valA = (a.orderNumber || a.id || '').toLowerCase();
          valB = (b.orderNumber || b.id || '').toLowerCase();
          break;
        case 'customer':
          valA = (a.customer?.name || a.customerName || '').toLowerCase();
          valB = (b.customer?.name || b.customerName || '').toLowerCase();
          break;
        case 'total':
          valA = a.total || 0;
          valB = b.total || 0;
          break;
        case 'status':
          valA = a.status || '';
          valB = b.status || '';
          break;
        case 'source':
          valA = a.source || 'pos';
          valB = b.source || 'pos';
          break;
        case 'createdAt':
        default:
          valA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
          valB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
          break;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [filteredOrders, orderNumberFilter, customerFilter, sourceFilter, sortField, sortDirection]);

  // Pagination derived values
  const totalPages = Math.max(1, Math.ceil(processedOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedOrders.slice(start, start + pageSize);
  }, [processedOrders, currentPage, pageSize]);

  // Reset page when inline filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [orderNumberFilter, customerFilter, sourceFilter]);

  // Toggle sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <i className="bi bi-chevron-expand text-muted ms-1" style={{ fontSize: '0.7rem' }}></i>;
    return sortDirection === 'asc'
      ? <i className="bi bi-caret-up-fill ms-1" style={{ fontSize: '0.7rem' }}></i>
      : <i className="bi bi-caret-down-fill ms-1" style={{ fontSize: '0.7rem' }}></i>;
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(Number(newSize));
    setCurrentPage(1);
  };

  const formatSource = (source) => {
    switch (source) {
      case 'website': return 'Website';
      case 'widget': return 'Widget';
      case 'pos': return 'POS';
      default: return 'POS';
    }
  };

  const getSourceBadgeVariant = (source) => {
    switch (source) {
      case 'website': return 'info';
      case 'widget': return 'purple';
      default: return 'secondary';
    }
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
      case 'out_for_delivery':
        return 'info';
      case 'delivery_failed':
        return 'danger';
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
      case 'out_for_delivery':
        return 'Out for Delivery';
      case 'delivery_failed':
        return 'Delivery Failed';
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
      const searchTerm = searchOrderNumber.trim();

      // First try exact doc ID lookup (cheapest — 1 read)
      const directDoc = await getDoc(doc(db, `restaurants/${restaurantUid}/orders`, searchTerm));
      if (directDoc.exists()) {
        const data = { id: directDoc.id, ...directDoc.data() };
        if (!isMultiLocation || !selectedLocation || data.locationId === selectedLocation) {
          setSearchResults([data]);
          setSearching(false);
          return;
        }
      }

      // Then search within loaded orders (already in memory — 0 reads)
      const memoryResults = orders.filter(order => {
        const orderNum = order.orderNumber || order.id.slice(0, 8);
        return orderNum.toLowerCase().includes(searchTerm.toLowerCase()) ||
          order.id.toLowerCase().includes(searchTerm.toLowerCase());
      });

      if (memoryResults.length > 0) {
        setSearchResults(memoryResults);
      } else {
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

      const selectedDate = new Date(searchDate);
      const startOfDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0);
      const endOfDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59, 999);

      // Server-side date filtering — only reads orders for the selected day
      const constraints = [
        where('createdAt', '>=', Timestamp.fromDate(startOfDay)),
        where('createdAt', '<=', Timestamp.fromDate(endOfDay)),
        orderBy('createdAt', 'desc')
      ];
      if (isMultiLocation && selectedLocation) {
        constraints.push(where('locationId', '==', selectedLocation));
      }
      const q = query(ordersRef, ...constraints);
      const snapshot = await getDocs(q);

      let filteredResults = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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

  // Render order row (shared between search results and paginated table)
  const renderOrderRow = (order, showReimbursementButton = false) => (
    <tr key={order.id}>
      <td className="fw-semibold text-nowrap" style={{ fontSize: '0.9rem' }}>
        {order.orderNumber || order.id.slice(0, 8)}
      </td>
      <td className="text-nowrap" style={{ fontSize: '0.85rem' }}>
        {formatDate(order.createdAt)}
      </td>
      <td style={{ fontSize: '0.9rem' }}>
        <div className="fw-medium">{order.customer?.name || order.customerName || '-'}</div>
        {(order.customer?.phone || order.customerPhone) && (
          <small className="text-muted">{order.customer?.phone || order.customerPhone}</small>
        )}
      </td>
      <td style={{ fontSize: '0.85rem', maxWidth: '220px' }}>
        {order.items?.slice(0, 3).map((item, index) => (
          <div key={index} className="text-truncate">
            <span className="text-muted">{item.quantity}x</span> {item.name}
          </div>
        ))}
        {order.items?.length > 3 && (
          <small className="text-muted">+{order.items.length - 3} more</small>
        )}
      </td>
      <td className="fw-semibold text-nowrap">{formatPrice(order.total)}</td>
      <td>
        <Badge
          bg={getSourceBadgeVariant(order.source)}
          style={order.source === 'widget' ? { backgroundColor: '#7c3aed', color: '#fff' } : {}}
          className="me-1"
        >
          {formatSource(order.source)}
        </Badge>
        {order.orderType && order.orderType !== 'dine_in' && (
          <Badge bg="outline-secondary" className="border text-muted" style={{ fontSize: '0.7rem' }}>
            {order.orderType === 'pickup' ? 'Pickup' : order.orderType === 'delivery' ? 'Delivery' : ''}
          </Badge>
        )}
      </td>
      <td>
        <Badge bg={getStatusBadgeVariant(order.status)}>
          {formatStatus(order.status)}
        </Badge>
        {order.orderType === 'delivery' && order.doordash && (
          <div><small className="text-info">
            <i className="bi bi-truck"></i> {order.doordash.deliveryStatus?.replace(/_/g, ' ') || 'dispatched'}
            {order.doordash.dasherName && ` (${order.doordash.dasherName})`}
          </small></div>
        )}
        {order.orderType === 'delivery' && order.deliveryAddress && (
          <div><small className="text-muted" title={order.deliveryAddress.fullAddress}>
            <i className="bi bi-geo-alt"></i> {(order.deliveryAddress.fullAddress || '').substring(0, 25)}...
          </small></div>
        )}
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
  );

  // Simple table for search results (no pagination needed)
  const renderSearchTable = (ordersList) => (
    <Table responsive hover size="sm" className="mb-0 align-middle">
      <thead className="table-light">
        <tr>
          <th>Order #</th>
          <th>Date</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Total</th>
          <th>Source</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {ordersList.map(order => renderOrderRow(order, true))}
      </tbody>
    </Table>
  );

  // Pagination controls
  const renderPagination = () => {
    if (processedOrders.length === 0) return null;

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, processedOrders.length);

    // Build page number items — show max 7 pages around current
    const pageItems = [];
    let startPage = Math.max(1, currentPage - 3);
    let endPage = Math.min(totalPages, currentPage + 3);
    if (endPage - startPage < 6) {
      if (startPage === 1) endPage = Math.min(totalPages, 7);
      else startPage = Math.max(1, endPage - 6);
    }

    return (
      <div className="d-flex flex-wrap justify-content-between align-items-center mt-3 gap-2">
        {/* Left: showing X of Y */}
        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
          Showing <strong>{startItem}–{endItem}</strong> of <strong>{processedOrders.length}</strong> orders
        </div>

        {/* Center: page controls */}
        <Pagination className="mb-0" size="sm">
          <Pagination.First onClick={() => setCurrentPage(1)} disabled={currentPage === 1} />
          <Pagination.Prev onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} />
          {startPage > 1 && <Pagination.Ellipsis disabled />}
          {Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i).map(page => (
            <Pagination.Item
              key={page}
              active={page === currentPage}
              onClick={() => setCurrentPage(page)}
            >
              {page}
            </Pagination.Item>
          ))}
          {endPage < totalPages && <Pagination.Ellipsis disabled />}
          <Pagination.Next onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} />
          <Pagination.Last onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} />
        </Pagination>

        {/* Right: page size */}
        <div className="d-flex align-items-center gap-2">
          <small className="text-muted text-nowrap">Per page:</small>
          <Form.Select
            size="sm"
            value={pageSize}
            onChange={(e) => handlePageSizeChange(e.target.value)}
            style={{ width: '70px' }}
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </Form.Select>
        </div>
      </div>
    );
  };

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
            {renderSearchTable(searchResults)}
          </Card.Body>
        </Card>
      )}

      {/* Normal Orders View (only show when not searching) */}
      {searchMode === 'none' && (
        <Card>
          {/* Toolbar: status filter + summary */}
          <Card.Header className="bg-white py-3">
            <Row className="align-items-center g-2">
              <Col xs="auto">
                <Form.Select
                  value={statusFilter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  style={{ minWidth: '180px' }}
                  size="sm"
                >
                  <option value="all">All Statuses</option>
                  <option value="new">New</option>
                  <option value="sent_to_kitchen">Sent to Kitchen</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready</option>
                  <option value="served">Served</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="reimbursed">Reimbursed</option>
                </Form.Select>
              </Col>
              <Col xs="auto">
                <Form.Select
                  value={sourceFilter}
                  onChange={(e) => { setSourceFilter(e.target.value); setCurrentPage(1); }}
                  style={{ minWidth: '140px' }}
                  size="sm"
                >
                  <option value="all">All Sources</option>
                  <option value="pos">POS</option>
                  <option value="website">Website</option>
                  <option value="widget">Widget</option>
                </Form.Select>
              </Col>
              <Col>
                {(orderNumberFilter || customerFilter || sourceFilter !== 'all') && (
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted p-0"
                    onClick={() => { setOrderNumberFilter(''); setCustomerFilter(''); setSourceFilter('all'); }}
                  >
                    <i className="bi bi-x-circle me-1"></i>Clear filters
                  </Button>
                )}
              </Col>
              <Col xs="auto" className="text-muted" style={{ fontSize: '0.85rem' }}>
                <strong>{processedOrders.length}</strong> order{processedOrders.length !== 1 ? 's' : ''}
              </Col>
            </Row>
          </Card.Header>

          {/* Table */}
          <Card.Body className="p-0">
            <Table responsive hover size="sm" className="mb-0 align-middle" style={{ fontSize: '0.9rem' }}>
              <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th style={{ cursor: 'pointer', userSelect: 'none', minWidth: '120px' }} onClick={() => handleSort('orderNumber')}>
                    Order # <SortIcon field="orderNumber" />
                  </th>
                  <th style={{ cursor: 'pointer', userSelect: 'none', minWidth: '140px' }} onClick={() => handleSort('createdAt')}>
                    Date <SortIcon field="createdAt" />
                  </th>
                  <th style={{ cursor: 'pointer', userSelect: 'none', minWidth: '140px' }} onClick={() => handleSort('customer')}>
                    Customer <SortIcon field="customer" />
                  </th>
                  <th style={{ minWidth: '180px' }}>Items</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none', minWidth: '80px' }} onClick={() => handleSort('total')}>
                    Total <SortIcon field="total" />
                  </th>
                  <th style={{ cursor: 'pointer', userSelect: 'none', minWidth: '90px' }} onClick={() => handleSort('source')}>
                    Source <SortIcon field="source" />
                  </th>
                  <th style={{ cursor: 'pointer', userSelect: 'none', minWidth: '100px' }} onClick={() => handleSort('status')}>
                    Status <SortIcon field="status" />
                  </th>
                </tr>
                {/* Inline filter row */}
                <tr>
                  <th className="pb-2 pt-0">
                    <Form.Control
                      size="sm"
                      type="text"
                      placeholder="Filter..."
                      value={orderNumberFilter}
                      onChange={(e) => setOrderNumberFilter(e.target.value)}
                      style={{ fontSize: '0.8rem' }}
                    />
                  </th>
                  <th className="pb-2 pt-0"></th>
                  <th className="pb-2 pt-0">
                    <Form.Control
                      size="sm"
                      type="text"
                      placeholder="Name / phone..."
                      value={customerFilter}
                      onChange={(e) => setCustomerFilter(e.target.value)}
                      style={{ fontSize: '0.8rem' }}
                    />
                  </th>
                  <th className="pb-2 pt-0"></th>
                  <th className="pb-2 pt-0"></th>
                  <th className="pb-2 pt-0"></th>
                  <th className="pb-2 pt-0"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.map(order => renderOrderRow(order, false))}
                {paginatedOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-5">
                      <i className="bi bi-inbox text-muted" style={{ fontSize: '2rem' }}></i>
                      <p className="text-muted mt-2 mb-0">
                        {processedOrders.length === 0 && filteredOrders.length > 0
                          ? 'No orders match your filters'
                          : statusFilter === 'all'
                            ? 'No orders yet'
                            : `No ${formatStatus(statusFilter).toLowerCase()} orders`}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card.Body>

          {/* Pagination footer */}
          {processedOrders.length > 0 && (
            <Card.Footer className="bg-white">
              {renderPagination()}
            </Card.Footer>
          )}
        </Card>
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