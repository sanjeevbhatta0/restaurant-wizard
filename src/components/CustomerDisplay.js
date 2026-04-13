import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Button, Spinner, Badge } from 'react-bootstrap';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { initializeWakeLock, cleanupWakeLock, isWakeLockSupported } from '../services/wakeLockService';
import useFullscreen from '../hooks/useFullscreen';
import './CustomerDisplay.css';

const TIP_PRESETS_DEFAULT = [15, 18, 20, 25];

export default function CustomerDisplay() {
  const { currentUser, restaurantUid } = useAuth();
  const { isFullscreen, isFullscreenAvailable, toggleFullscreen } = useFullscreen();
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Restaurant config
  const [restaurantName, setRestaurantName] = useState('');
  const [displayConfig, setDisplayConfig] = useState({
    showTip: true,
    showSignature: true,
    showReceiptOptions: true,
    tipPresets: TIP_PRESETS_DEFAULT
  });

  // Payment session (real-time from Firestore)
  const [session, setSession] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Customer input
  const [selectedTip, setSelectedTip] = useState(null); // percentage or 'custom'
  const [customTipAmount, setCustomTipAmount] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [receiptMethod, setReceiptMethod] = useState('none');
  const [receiptContact, setReceiptContact] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  // Signature canvas
  const canvasRef = useRef(null);
  const drawingRef = useRef({ active: false, lastX: 0, lastY: 0 });

  const uid = restaurantUid || currentUser?.uid;

  // Load restaurant config
  useEffect(() => {
    if (!uid) return;
    const loadConfig = async () => {
      const docSnap = await getDoc(doc(db, 'restaurants', uid));
      if (docSnap.exists()) {
        const data = docSnap.data();
        setRestaurantName(data.restaurantName || 'Restaurant');
        if (data.customerDisplayConfig) {
          setDisplayConfig(prev => ({ ...prev, ...data.customerDisplayConfig }));
        }
      }
    };
    loadConfig();
  }, [uid]);

  // Real-time listener for payment review session
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'restaurants', uid, 'paymentReview', 'current'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.status === 'pending_customer') {
          setSession(data);
          setSessionId(snap.id);
          // Reset customer inputs for new session
          setSelectedTip(null);
          setCustomTipAmount('');
          setSignatureData('');
          setReceiptMethod('none');
          setReceiptContact('');
          setConfirmed(false);
          clearCanvas();
        } else if (data.status === 'confirmed' || data.status === 'completed') {
          setSession(data);
          setConfirmed(true);
        } else if (data.status === 'idle') {
          setSession(null);
          setConfirmed(false);
        }
      } else {
        setSession(null);
        setConfirmed(false);
      }
    });
    return () => unsub();
  }, [uid]);

  // Wake lock
  useEffect(() => {
    if (isWakeLockSupported()) {
      initializeWakeLock(setWakeLockActive);
    }
    return () => cleanupWakeLock();
  }, []);

  // Calculate tip amount
  const tipAmount = useCallback(() => {
    if (!session) return 0;
    if (selectedTip === 'custom') return parseFloat(customTipAmount) || 0;
    if (selectedTip === 'none') return 0;
    if (selectedTip !== null) return (session.subtotal * selectedTip) / 100;
    return 0;
  }, [session, selectedTip, customTipAmount]);

  const totalWithTip = session ? session.total + tipAmount() : 0;

  // Send customer response back to POS
  const handleConfirm = async () => {
    if (!uid || !session) return;
    setConfirmed(true);
    try {
      await updateDoc(doc(db, 'restaurants', uid, 'paymentReview', 'current'), {
        status: 'confirmed',
        customerResponse: {
          tipPercent: selectedTip === 'custom' || selectedTip === 'none' ? null : selectedTip,
          tipAmount: tipAmount(),
          totalWithTip,
          signature: signatureData || null,
          receiptMethod,
          receiptContact: receiptContact || null,
          confirmedAt: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error('Failed to confirm:', err);
      setConfirmed(false);
    }
  };

  // Signature canvas handlers
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData('');
  };

  const startDraw = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    drawingRef.current = { active: true, lastX: x, lastY: y };
  };

  const draw = (e) => {
    if (!drawingRef.current.active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    ctx.beginPath();
    ctx.moveTo(drawingRef.current.lastX, drawingRef.current.lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    drawingRef.current.lastX = x;
    drawingRef.current.lastY = y;
  };

  const endDraw = () => {
    drawingRef.current.active = false;
    const canvas = canvasRef.current;
    if (canvas) setSignatureData(canvas.toDataURL('image/png'));
  };

  // Idle screen — no active payment session
  if (!session || session.status === 'idle') {
    return (
      <div className={`customer-display-idle ${isFullscreen ? 'fullscreen-mode' : ''}`}>
        <div className="cd-toolbar">
          {isFullscreenAvailable && (
            <button className="cd-toolbar-btn" onClick={toggleFullscreen}>
              <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
            </button>
          )}
          {wakeLockActive && <Badge bg="dark" className="cd-badge"><i className="bi bi-lock"></i> Screen On</Badge>}
        </div>
        <div className="cd-idle-content">
          <div className="cd-idle-logo">
            <i className="bi bi-shop" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
          </div>
          <h2 className="cd-idle-name">{restaurantName}</h2>
          <p className="cd-idle-message">Welcome! Your order summary will appear here.</p>
        </div>
      </div>
    );
  }

  // Confirmed — thank you screen
  if (confirmed) {
    return (
      <div className={`customer-display-confirmed ${isFullscreen ? 'fullscreen-mode' : ''}`}>
        <div className="cd-toolbar">
          {isFullscreenAvailable && (
            <button className="cd-toolbar-btn" onClick={toggleFullscreen}>
              <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
            </button>
          )}
        </div>
        <div className="cd-confirmed-content">
          <i className="bi bi-check-circle-fill cd-confirmed-icon"></i>
          <h2>Thank You!</h2>
          <p>Your payment is being processed.</p>
          {tipAmount() > 0 && <p className="cd-confirmed-tip">Tip: ${tipAmount().toFixed(2)}</p>}
        </div>
      </div>
    );
  }

  // Active payment review
  return (
    <div className={`customer-display-active ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div className="cd-toolbar">
        {isFullscreenAvailable && (
          <button className="cd-toolbar-btn" onClick={toggleFullscreen}>
            <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
          </button>
        )}
      </div>

      <div className="cd-content">
        {/* Header */}
        <div className="cd-header">
          <h3>{restaurantName}</h3>
          <div className="cd-order-info">
            {session.orderNumber && <span>Order #{session.orderNumber}</span>}
            {session.tableNumber && <span> &middot; Table {session.tableNumber}</span>}
          </div>
        </div>

        {/* Items */}
        <div className="cd-items-section">
          <h5 className="cd-section-title">Order Summary</h5>
          <div className="cd-items-list">
            {(session.items || []).map((item, i) => (
              <div key={i} className="cd-item">
                <div className="cd-item-info">
                  <span className="cd-item-qty">{item.quantity}x</span>
                  <span className="cd-item-name">{item.name}</span>
                  {item.spiceLevel && <Badge bg="danger" className="ms-1" style={{ fontSize: '0.65rem' }}>{item.spiceLevel}</Badge>}
                  {item.notes && <div className="cd-item-notes">{item.notes}</div>}
                </div>
                <span className="cd-item-price">${(item.price * item.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="cd-totals">
            <div className="cd-total-row"><span>Subtotal</span><span>${(session.subtotal || 0).toFixed(2)}</span></div>
            <div className="cd-total-row"><span>Tax ({session.taxRate || 0}%)</span><span>${(session.taxAmount || 0).toFixed(2)}</span></div>
            {tipAmount() > 0 && (
              <div className="cd-total-row cd-tip-row"><span>Tip</span><span>${tipAmount().toFixed(2)}</span></div>
            )}
            <div className="cd-total-row cd-grand-total">
              <span>Total</span>
              <span>${totalWithTip.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Tip Selection */}
        {displayConfig.showTip && (
          <div className="cd-section">
            <h5 className="cd-section-title">Add a Tip</h5>
            <div className="cd-tip-options">
              {(displayConfig.tipPresets || TIP_PRESETS_DEFAULT).map(pct => (
                <button
                  key={pct}
                  className={`cd-tip-btn ${selectedTip === pct ? 'active' : ''}`}
                  onClick={() => setSelectedTip(pct)}
                >
                  <div className="cd-tip-pct">{pct}%</div>
                  <div className="cd-tip-amt">${((session.subtotal * pct) / 100).toFixed(2)}</div>
                </button>
              ))}
              <button
                className={`cd-tip-btn ${selectedTip === 'custom' ? 'active' : ''}`}
                onClick={() => setSelectedTip('custom')}
              >
                <div className="cd-tip-pct">Custom</div>
                <div className="cd-tip-amt">$</div>
              </button>
              <button
                className={`cd-tip-btn cd-tip-none ${selectedTip === 'none' ? 'active' : ''}`}
                onClick={() => setSelectedTip('none')}
              >
                <div className="cd-tip-pct">No Tip</div>
              </button>
            </div>
            {selectedTip === 'custom' && (
              <div className="cd-custom-tip">
                <span className="cd-custom-tip-symbol">$</span>
                <input
                  type="number"
                  className="cd-custom-tip-input"
                  value={customTipAmount}
                  onChange={(e) => setCustomTipAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  autoFocus
                />
              </div>
            )}
          </div>
        )}

        {/* Signature */}
        {displayConfig.showSignature && (
          <div className="cd-section">
            <div className="d-flex justify-content-between align-items-center">
              <h5 className="cd-section-title mb-0">Signature</h5>
              <button className="cd-clear-btn" onClick={clearCanvas}>Clear</button>
            </div>
            <canvas
              ref={canvasRef}
              width={400}
              height={120}
              className="cd-signature-canvas"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
          </div>
        )}

        {/* Receipt Options */}
        {displayConfig.showReceiptOptions && (
          <div className="cd-section">
            <h5 className="cd-section-title">Receipt</h5>
            <div className="cd-receipt-options">
              <button className={`cd-receipt-btn ${receiptMethod === 'none' ? 'active' : ''}`} onClick={() => setReceiptMethod('none')}>
                <i className="bi bi-x-circle"></i><span>No Receipt</span>
              </button>
              <button className={`cd-receipt-btn ${receiptMethod === 'print' ? 'active' : ''}`} onClick={() => setReceiptMethod('print')}>
                <i className="bi bi-printer"></i><span>Print</span>
              </button>
              <button className={`cd-receipt-btn ${receiptMethod === 'email' ? 'active' : ''}`} onClick={() => setReceiptMethod('email')}>
                <i className="bi bi-envelope"></i><span>Email</span>
              </button>
              <button className={`cd-receipt-btn ${receiptMethod === 'text' ? 'active' : ''}`} onClick={() => setReceiptMethod('text')}>
                <i className="bi bi-chat-dots"></i><span>Text</span>
              </button>
            </div>
            {(receiptMethod === 'email' || receiptMethod === 'text') && (
              <input
                type={receiptMethod === 'email' ? 'email' : 'tel'}
                className="cd-receipt-input"
                value={receiptContact}
                onChange={(e) => setReceiptContact(e.target.value)}
                placeholder={receiptMethod === 'email' ? 'Email address' : 'Phone number'}
                autoFocus
              />
            )}
          </div>
        )}

        {/* Confirm Button */}
        <div className="cd-confirm-section">
          <button className="cd-confirm-btn" onClick={handleConfirm} disabled={confirmed}>
            {confirmed ? 'Processing...' : `Confirm $${totalWithTip.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
