import React, { useState, useEffect } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  addDoc,
  getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import TableSelectionModal from './TableSelectionModal';
import './PageHeader.css';
import './POS.css';

const POS = () => {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [showTableModal, setShowTableModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [sendingOrder, setSendingOrder] = useState(false);
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();

  // Fetch categories and items
  useEffect(() => {
    if (!currentUser) return;

    const categoriesRef = collection(db, `restaurants/${currentUser.uid}/menuCategories`);
    const q = query(categoriesRef, orderBy('name'));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const categoriesData = [];
      
      for (const categoryDoc of snapshot.docs) {
        const category = { id: categoryDoc.id, ...categoryDoc.data() };
        
        // Fetch items for this category
        const itemsRef = collection(db, `restaurants/${currentUser.uid}/menuCategories/${category.id}/items`);
        const itemsQuery = query(itemsRef, orderBy('name'));
        const itemsSnapshot = await getDocs(itemsQuery);
        
        const allItems = itemsSnapshot.docs.map(itemDoc => ({
          id: itemDoc.id,
          categoryId: category.id,
          categoryName: category.name,
          ...itemDoc.data()
        }));

        // Filter items by selected location if multi-location
        if (isMultiLocation && selectedLocation) {
          category.items = allItems.filter(item => {
            // If item has no locations array or empty array, it applies to all locations
            if (!item.locations || item.locations.length === 0) {
              return true;
            }
            // Otherwise, check if selected location is in the item's locations
            return item.locations.includes(selectedLocation);
          });
        } else {
          category.items = allItems;
        }
        
        categoriesData.push(category);
      }
      
      setCategories(categoriesData);
      if (categoriesData.length > 0 && !selectedCategory) {
        setSelectedCategory(categoriesData[0].id);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, selectedCategory, isMultiLocation, selectedLocation]);

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

  // Send order to kitchen
  const sendToKitchen = async () => {
    if (orderItems.length === 0) {
      setError('Please add items to the order');
      return;
    }
    if (selectedTables.length === 0) {
      setError('Please assign at least one table');
      return;
    }

    setSendingOrder(true);
    setError('');

    try {
      const orderNumber = generateOrderNumber();
      
      const orderData = {
        orderNumber,
        tableNumber: selectedTables.length === 1 ? selectedTables[0] : selectedTables,
        locationId: selectedLocation || currentUser.uid, // Store location ID for filtering
        items: orderItems.map(item => ({
          id: item.id,
          name: item.name,
          categoryName: item.categoryName,
          price: calculateItemPrice(item),
          originalPrice: item.price,
          quantity: item.quantity,
          subtotal: calculateItemPrice(item) * item.quantity
        })),
        total: calculateTotal(),
        status: 'sent_to_kitchen',
        orderType: 'dine_in',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await addDoc(
        collection(db, `restaurants/${currentUser.uid}/orders`),
        orderData
      );

      const tableDisplay = selectedTables.length === 1 
        ? selectedTables[0] 
        : selectedTables.sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) {
              return numA - numB;
            }
            return a.localeCompare(b);
          }).join(' and ');

      setOrderSuccess({
        orderNumber,
        tableNumber: tableDisplay
      });

      // Clear the order after successful submission
      setOrderItems([]);
      setSelectedTables([]);
    } catch (err) {
      setError('Failed to send order: ' + err.message);
    } finally {
      setSendingOrder(false);
    }
  };

  const handleTableSelect = (tables) => {
    setSelectedTables(tables);
  };

  // Get current category's items
  const currentCategoryItems = categories.find(c => c.id === selectedCategory)?.items || [];

  // Show warning if multi-location but no location selected
  if (isMultiLocation && !selectedLocation && !loading) {
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

  if (loading) {
    return (
      <div className="pos-loading">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  return (
    <div className="pos-wrapper">
      {/* Page Header */}
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
          <div className="pos-order-total">
            <span>Total:</span>
            <span>${calculateTotal().toFixed(2)}</span>
          </div>

          <div className="pos-table-selection">
            <label>Table(s)</label>
            <button
              className="pos-assign-table-btn"
              onClick={() => setShowTableModal(true)}
            >
              <i className="bi bi-grid-3x3-gap"></i>
              {selectedTables.length === 0 
                ? 'Assign Table' 
                : selectedTables.length === 1
                  ? `Table ${selectedTables[0]}`
                  : `Tables ${selectedTables.sort((a, b) => {
                      const numA = parseInt(a);
                      const numB = parseInt(b);
                      if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                      }
                      return a.localeCompare(b);
                    }).join(' and ')}`}
            </button>
          </div>

          <button
            className="pos-send-button"
            onClick={sendToKitchen}
            disabled={orderItems.length === 0 || selectedTables.length === 0 || sendingOrder}
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

          {orderItems.length > 0 && (
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
              <i className="bi bi-check-lg"></i>
            </div>
            <h3>Order Sent to Kitchen!</h3>
            <div className="order-number">{orderSuccess.orderNumber}</div>
            <div className="table-number">Table #{orderSuccess.tableNumber}</div>
            <button onClick={() => setOrderSuccess(null)}>
              New Order
            </button>
          </div>
        </div>
      )}

      {/* Table Selection Modal */}
      <TableSelectionModal
        show={showTableModal}
        onHide={() => setShowTableModal(false)}
        onSelect={handleTableSelect}
        selectedTables={selectedTables}
      />
      </div>
    </div>
  );
};

export default POS;
