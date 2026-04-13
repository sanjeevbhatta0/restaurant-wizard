import React, { useRef, useState } from 'react';
import { Modal, Button, Form, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import './ReceiptModal.css';

const ReceiptModal = ({ show, onHide, receiptData }) => {
  const receiptRef = useRef(null);
  const [deliveryMethod, setDeliveryMethod] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState('');
  const [sendError, setSendError] = useState('');

  if (!receiptData) return null;

  const {
    restaurantName,
    restaurantAddress,
    restaurantPhone,
    orderNumbers,
    items,
    subtotal,
    taxRate,
    taxAmount,
    discountAmount,
    discountType,
    promoCode,
    tipAmount,
    total,
    paymentMethod,
    tableNumbers,
    paidAt
  } = receiptData;

  const formatDate = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getPaymentMethodLabel = (method) => {
    switch (method) {
      case 'cash': return 'Cash';
      case 'card': return 'Credit/Debit Card';
      case 'terminal': return 'Card Terminal';
      default: return method || 'N/A';
    }
  };

  const handlePrint = () => {
    const printContent = receiptRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt - ${orderNumbers?.join(', ') || 'Order'}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Courier New', monospace; width: 80mm; padding: 8mm; font-size: 12px; color: #000; }
            .receipt-header { text-align: center; margin-bottom: 12px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
            .receipt-header h2 { font-size: 18px; margin-bottom: 4px; }
            .receipt-header p { font-size: 11px; line-height: 1.4; }
            .receipt-meta { margin-bottom: 10px; font-size: 11px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
            .receipt-meta div { margin-bottom: 2px; }
            .receipt-items { width: 100%; margin-bottom: 10px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
            .receipt-items table { width: 100%; border-collapse: collapse; }
            .receipt-items th { text-align: left; font-size: 11px; border-bottom: 1px solid #000; padding: 2px 0; }
            .receipt-items th:last-child { text-align: right; }
            .receipt-items td { font-size: 11px; padding: 3px 0; vertical-align: top; }
            .receipt-items td:last-child { text-align: right; white-space: nowrap; }
            .receipt-totals { margin-bottom: 10px; font-size: 11px; }
            .receipt-totals .total-row { display: flex; justify-content: space-between; margin-bottom: 2px; }
            .receipt-totals .total-row.grand-total { font-size: 16px; font-weight: bold; border-top: 2px solid #000; padding-top: 6px; margin-top: 6px; }
            .receipt-totals .total-row.discount { color: #333; }
            .receipt-payment { text-align: center; margin: 10px 0; font-size: 11px; border-bottom: 1px dashed #000; padding-bottom: 8px; }
            .receipt-footer { text-align: center; margin-top: 12px; font-size: 10px; }
            .receipt-footer .thank-you { font-size: 13px; font-weight: bold; margin-bottom: 8px; }
            .receipt-branding { text-align: center; margin-top: 14px; padding-top: 8px; border-top: 1px dashed #000; }
            .receipt-branding img { height: 20px; margin-top: 2px; }
            .receipt-branding p { font-size: 9px; color: #666; }
            @media print { body { width: 80mm; } }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
          <script>window.onload = function() { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSend = async () => {
    if (deliveryMethod === 'email' && !customerEmail.trim()) {
      setSendError('Please enter an email address.');
      return;
    }
    if (deliveryMethod === 'sms' && !customerPhone.trim()) {
      setSendError('Please enter a phone number.');
      return;
    }

    setSending(true);
    setSendError('');
    setSendSuccess('');

    try {
      const sendReceipt = httpsCallable(functions, 'sendReceiptOnDemand');
      const result = await sendReceipt({
        receiptData,
        deliveryMethod,
        customerEmail: deliveryMethod === 'email' ? customerEmail.trim() : null,
        customerPhone: deliveryMethod === 'sms' ? customerPhone.trim() : null
      });

      if (result.data?.success) {
        if (deliveryMethod === 'email') {
          setSendSuccess(`Receipt sent to ${customerEmail}`);
        } else {
          setSendSuccess(`Receipt sent to ${customerPhone}`);
        }
        setDeliveryMethod('');
      } else {
        setSendError(result.data?.error || 'Failed to send receipt.');
      }
    } catch (err) {
      const message = err.message || 'Failed to send receipt. Please try again.';
      setSendError(message);
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setDeliveryMethod('');
    setCustomerEmail('');
    setCustomerPhone('');
    setSendSuccess('');
    setSendError('');
    onHide();
  };

  // Gather all items across selected orders
  const allItems = items || [];

  return (
    <Modal show={show} onHide={handleClose} size="md" centered className="receipt-modal">
      <Modal.Header closeButton>
        <Modal.Title><i className="bi bi-receipt me-2"></i>Payment Receipt</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Printable receipt content */}
        <div className="receipt-paper" ref={receiptRef}>
          {/* Restaurant Header */}
          <div className="receipt-header">
            <h2>{restaurantName || 'Restaurant'}</h2>
            {restaurantAddress && <p>{restaurantAddress}</p>}
            {restaurantPhone && <p>Tel: {restaurantPhone}</p>}
          </div>

          {/* Order Meta */}
          <div className="receipt-meta">
            <div><strong>Order:</strong> {orderNumbers?.join(', ') || 'N/A'}</div>
            <div><strong>Date:</strong> {formatDate(paidAt)}</div>
            {tableNumbers && tableNumbers.length > 0 && (
              <div><strong>Table:</strong> {tableNumbers.join(', ')}</div>
            )}
          </div>

          {/* Items */}
          <div className="receipt-items">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: 'center', width: '40px' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item, idx) => (
                  <tr key={idx}>
                    <td>{item.name}</td>
                    <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                    <td style={{ textAlign: 'right' }}>${(item.price * item.quantity).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="receipt-totals">
            <div className="total-row">
              <span>Subtotal</span>
              <span>${subtotal?.toFixed(2) || '0.00'}</span>
            </div>
            {discountAmount > 0 && (
              <div className="total-row discount">
                <span>Discount {promoCode ? `(${promoCode})` : ''} {discountType === 'percentage' ? `${discountAmount}%` : ''}</span>
                <span>-${discountType === 'percentage' ? ((subtotal * discountAmount / 100).toFixed(2)) : discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="total-row">
              <span>Tax ({taxRate}%)</span>
              <span>${taxAmount?.toFixed(2) || '0.00'}</span>
            </div>
            {tipAmount > 0 && (
              <div className="total-row">
                <span>Tip</span>
                <span>${tipAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="total-row grand-total">
              <span>Total</span>
              <span>${total?.toFixed(2) || '0.00'}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="receipt-payment">
            Paid via <strong>{getPaymentMethodLabel(paymentMethod)}</strong>
          </div>

          {/* Thank You */}
          <div className="receipt-footer">
            <div className="thank-you">Thank you for dining with us!</div>
          </div>

          {/* Powered by KodaCarte */}
          <div className="receipt-branding">
            <p>Powered by</p>
            <img src="/koda-carte-logo.png" alt="KodaCarte" />
          </div>
        </div>

        {/* Delivery Options */}
        <div className="receipt-delivery-options mt-3">
          <h6 className="mb-2"><i className="bi bi-send me-1"></i> Send Receipt</h6>
          <Row className="g-2 mb-2">
            <Col>
              <Button
                variant={deliveryMethod === 'email' ? 'primary' : 'outline-primary'}
                size="sm"
                className="w-100"
                onClick={() => { setDeliveryMethod('email'); setSendSuccess(''); setSendError(''); }}
              >
                <i className="bi bi-envelope me-1"></i> Email
              </Button>
            </Col>
            <Col>
              <Button
                variant={deliveryMethod === 'sms' ? 'success' : 'outline-success'}
                size="sm"
                className="w-100"
                onClick={() => { setDeliveryMethod('sms'); setSendSuccess(''); setSendError(''); }}
              >
                <i className="bi bi-phone me-1"></i> SMS
              </Button>
            </Col>
            <Col>
              <Button
                variant="outline-secondary"
                size="sm"
                className="w-100"
                onClick={handlePrint}
              >
                <i className="bi bi-printer me-1"></i> Print
              </Button>
            </Col>
          </Row>

          {deliveryMethod === 'email' && (
            <Form.Group className="mb-2">
              <Form.Control
                type="email"
                placeholder="Customer email address"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                size="sm"
              />
            </Form.Group>
          )}
          {deliveryMethod === 'sms' && (
            <Form.Group className="mb-2">
              <Form.Control
                type="tel"
                placeholder="Customer phone number"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                size="sm"
              />
            </Form.Group>
          )}

          {(deliveryMethod === 'email' || deliveryMethod === 'sms') && (
            <Button
              variant="dark"
              size="sm"
              onClick={handleSend}
              disabled={sending}
              className="w-100"
            >
              {sending ? <><Spinner size="sm" className="me-1" /> Sending...</> : `Send via ${deliveryMethod === 'email' ? 'Email' : 'SMS'}`}
            </Button>
          )}

          {sendSuccess && <Alert variant="success" className="mt-2 mb-0 py-1 px-2 small">{sendSuccess}</Alert>}
          {sendError && <Alert variant="danger" className="mt-2 mb-0 py-1 px-2 small">{sendError}</Alert>}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ReceiptModal;
