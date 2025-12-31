import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Container, Card, Button, Form, Alert, Spinner, Table, Badge, Modal, Row, Col } from 'react-bootstrap';
import './PageHeader.css';
import './Payments.css';

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

  const confirmPayment = async () => {
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
            total
          },
          updatedAt: new Date()
        });
      });

      await Promise.all(updatePromises);

      // Release tables by updating table status to 'available' in the layout
      if (tableNumbers.size > 0) {
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
      }

      setSuccess(`Payment processed successfully for ${selectedOrders.length} order(s). Total: $${total.toFixed(2)}. Tables released.`);
      setShowPaymentModal(false);
      
      // Reset form
      setSelectedOrders([]);
      setDiscountAmount(0);
      setTipAmount(0);
      setTaxRate(8.5);
      // Don't reset selectedTable - let user see the updated state (orders will be removed from tablesWithOrders automatically)
    } catch (error) {
      console.error('Error processing payment:', error);
      setError('Failed to process payment: ' + error.message);
    } finally {
      setProcessing(false);
    }
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

  const selectedOrdersData = orders.filter(o => selectedOrders.includes(o.id));

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

      {/* Payment Confirmation Modal */}
      <Modal show={showPaymentModal} onHide={() => !processing && setShowPaymentModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Payment</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Alert variant="info">
            <strong>Payment Method:</strong> Dummy Payment (Stripe integration coming soon)
          </Alert>
          <div className="payment-confirmation">
            <h6>Orders to be paid:</h6>
            <ul>
              {selectedOrdersData.map(order => (
                <li key={order.id}>
                  Order {order.orderNumber || order.id.slice(0, 8)} - ${(order.total || 0).toFixed(2)}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <strong>Total Amount: ${total.toFixed(2)}</strong>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPaymentModal(false)} disabled={processing}>
            Cancel
          </Button>
          <Button variant="success" onClick={confirmPayment} disabled={processing}>
            {processing ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Processing...
              </>
            ) : (
              'Confirm Payment'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Payments;
