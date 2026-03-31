import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Modal, Button, Alert } from 'react-bootstrap';
import './TableSelectionModal.css';

const TableSelectionModal = ({ show, onHide, onSelect, selectedTables = [], allowOccupied = false }) => {
  const { currentUser, restaurantUid } = useAuth();
  const [layout, setLayout] = useState(null);
  const [tables, setTables] = useState([]);
  const [tableStatuses, setTableStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [localSelectedTables, setLocalSelectedTables] = useState(selectedTables);
  const floorPlanRef = useRef(null);
  const { selectedLocation, isMultiLocation } = useLocation();

  useEffect(() => {
    setLocalSelectedTables(selectedTables);
  }, [selectedTables]);

  useEffect(() => {
    if (show && currentUser) {
      if (isMultiLocation && !selectedLocation) {
        setError('Please select a location first');
        setLoading(false);
        setTables([]);
        return;
      }
      loadLayoutAndStatuses();
    }
  }, [show, currentUser, isMultiLocation, selectedLocation]);

  const loadLayoutAndStatuses = async () => {
    try {
      setLoading(true);
      setError('');

      // Load layout - use location-specific path for multi-location
      const layoutPath = isMultiLocation && selectedLocation
        ? `restaurants/${restaurantUid}/locations/${selectedLocation}/layout/floorPlan`
        : `restaurants/${restaurantUid}/layout/floorPlan`;
      
      const layoutRef = doc(db, layoutPath);
      const layoutSnap = await getDoc(layoutRef);

      if (!layoutSnap.exists()) {
        setError('No table layout found. Please create a layout first in Table Layout page.');
        setTables([]);
        setLoading(false);
        return;
      }

      const layoutData = layoutSnap.data();
      setLayout(layoutData);
      setTables(layoutData.tables || []);

      // Load active orders to determine table statuses
      // Tables remain occupied until order is 'completed' (payment received)
      const ordersRef = collection(db, `restaurants/${restaurantUid}/orders`);
      
      // Build query with proper status filtering - include 'served' since payment is still pending!
      let activeOrdersQuery;
      if (isMultiLocation && selectedLocation) {
        // Multi-location: filter by locationId AND status
        activeOrdersQuery = query(
          ordersRef,
          where('locationId', '==', selectedLocation),
          where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready', 'served'])
        );
      } else {
        // Single-location: filter by status only
        activeOrdersQuery = query(
          ordersRef,
          where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready', 'served'])
        );
      }

      const ordersSnapshot = await getDocs(activeOrdersQuery);

      const statuses = {};
      layoutData.tables?.forEach(table => {
        statuses[table.number] = table.status || 'available';
      });

      ordersSnapshot.docs.forEach(doc => {
        const orderData = doc.data();
        if (orderData.tableNumber) {
          const tableNumbers = Array.isArray(orderData.tableNumber)
            ? orderData.tableNumber
            : [orderData.tableNumber];
          
          tableNumbers.forEach(tableNum => {
            if (statuses[tableNum]) {
              statuses[tableNum] = 'occupied';
            }
          });
        }
      });

      setTableStatuses(statuses);
    } catch (error) {
      console.error('Error loading layout:', error);
      if (isMultiLocation && !selectedLocation) {
        setError('Please select a location first');
      } else {
        setError('Failed to load table layout');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleTableSelection = (tableNumber) => {
    setLocalSelectedTables(prev => {
      if (prev.includes(tableNumber)) {
        return prev.filter(t => t !== tableNumber);
      } else {
        return [...prev, tableNumber];
      }
    });
  };

  const handleConfirm = () => {
    if (localSelectedTables.length === 0) {
      setError('Please select at least one table');
      return;
    }
    onSelect(localSelectedTables);
    onHide();
  };

  const getTableStatusColor = (tableNumber) => {
    const status = tableStatuses[tableNumber] || 'available';
    switch (status) {
      case 'available':
        return '#27ae60'; // Green
      case 'occupied':
        return '#e74c3c'; // Red
      case 'reserved':
        return '#f39c12'; // Orange
      default:
        return '#95a5a6'; // Gray
    }
  };

  const isTableSelected = (tableNumber) => {
    return localSelectedTables.includes(tableNumber);
  };

  const isTableOccupied = (tableNumber) => {
    return tableStatuses[tableNumber] === 'occupied';
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" className="table-selection-modal">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-grid-3x3-gap"></i> Select Table(s)
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        
        {loading ? (
          <div className="table-selection-loading">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : tables.length === 0 ? (
          <div className="table-selection-empty">
            <i className="bi bi-grid-3x3-gap"></i>
            <p>No tables found. Please create a layout in Table Layout page.</p>
          </div>
        ) : (
          <>
            <div className="table-selection-info">
              <p className="mb-2">
                <strong>Selected:</strong> {localSelectedTables.length === 0 
                  ? 'None' 
                  : localSelectedTables.sort((a, b) => {
                      // Sort numbers numerically, strings alphabetically
                      const numA = parseInt(a);
                      const numB = parseInt(b);
                      if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                      }
                      return a.localeCompare(b);
                    }).join(', ')}
              </p>
              <div className="table-status-legend">
                <div className="legend-item">
                  <span className="legend-color" style={{ backgroundColor: '#27ae60' }}></span>
                  <span>Available</span>
                </div>
                <div className="legend-item">
                  <span className="legend-color" style={{ backgroundColor: '#e74c3c' }}></span>
                  <span>Occupied</span>
                </div>
                <div className="legend-item">
                  <span className="legend-color" style={{ backgroundColor: '#f39c12' }}></span>
                  <span>Reserved</span>
                </div>
              </div>
            </div>

            <div 
              className="table-selection-floor-plan"
              ref={floorPlanRef}
            >
              {tables.map(table => {
                const isSelected = isTableSelected(table.number);
                const isOccupied = isTableOccupied(table.number);
                const canSelect = allowOccupied || !isOccupied || isSelected; // Can select if allowedOccupied is true, or not occupied, or already selected

                return (
                  <div
                    key={table.id}
                    className={`table-selection-item ${isSelected ? 'selected' : ''} ${isOccupied && !isSelected && !allowOccupied ? 'occupied' : ''}`}
                    style={{
                      left: `${table.x}%`,
                      top: `${table.y}%`,
                      backgroundColor: isSelected ? '#3498db' : getTableStatusColor(table.number),
                      opacity: canSelect ? 1 : 0.6,
                      cursor: canSelect ? 'pointer' : 'not-allowed',
                      transform: 'translate(-50%, -50%)'
                    }}
                    onClick={() => canSelect && toggleTableSelection(table.number)}
                    title={isOccupied && !isSelected && !allowOccupied ? 'This table is currently occupied' : `Table ${table.number} - ${table.capacity || 4} seats`}
                  >
                    <div className="table-selection-number">{table.number}</div>
                    <div className="table-selection-capacity">
                      <i className="bi bi-people"></i> {table.capacity || 4}
                    </div>
                    {isSelected && (
                      <div className="table-selection-check">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button 
          variant="primary" 
          onClick={handleConfirm}
          disabled={localSelectedTables.length === 0}
        >
          Confirm Selection ({localSelectedTables.length})
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default TableSelectionModal;
