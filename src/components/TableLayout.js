import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../contexts/LocationContext';
import { Container, Button, Modal, Form, Alert, Spinner } from 'react-bootstrap';
import './PageHeader.css';
import './TableLayout.css';

const TableLayout = () => {
  const { currentUser } = useAuth();
  const { selectedLocation, isMultiLocation } = useLocation();
  const [layout, setLayout] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAddTableModal, setShowAddTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [draggedTable, setDraggedTable] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const floorPlanRef = useRef(null);
  const [tableForm, setTableForm] = useState({ number: '', capacity: 4 });

  useEffect(() => {
    if (!currentUser) return;
    if (isMultiLocation && !selectedLocation) {
      setLayout(null);
      setTables([]);
      setLoading(false);
      return;
    }
    loadLayout();
  }, [currentUser, isMultiLocation, selectedLocation]);

  useEffect(() => {
    if (!currentUser || tables.length === 0) return;
    
    // Subscribe to orders to update table statuses in real-time
    const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
    const activeOrdersQuery = query(
      ordersRef,
      where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready'])
    );
    
    const unsubscribe = onSnapshot(activeOrdersQuery, () => {
      // Update table statuses based on active orders
      updateTableStatuses();
    });

    return () => unsubscribe();
  }, [currentUser, tables.length, isMultiLocation, selectedLocation]);

  const loadLayout = async () => {
    try {
      setLoading(true);
      // For multi-location, use location-specific layout path
      const layoutPath = isMultiLocation && selectedLocation
        ? `restaurants/${currentUser.uid}/locations/${selectedLocation}/layout/floorPlan`
        : `restaurants/${currentUser.uid}/layout/floorPlan`;
      
      const layoutRef = doc(db, layoutPath);
      const layoutSnap = await getDoc(layoutRef);
      
      if (layoutSnap.exists()) {
        const data = layoutSnap.data();
        setLayout(data);
        const loadedTables = data.tables || [];
        setTables(loadedTables);
        // Update statuses after loading
        await updateTableStatuses(loadedTables);
      } else {
        setLayout(null);
        setTables([]);
      }
    } catch (error) {
      console.error('Error loading layout:', error);
      setError('Failed to load layout');
    } finally {
      setLoading(false);
    }
  };

  const updateTableStatuses = async (tablesToUpdate = null) => {
    try {
      const tablesToCheck = tablesToUpdate || tables;
      if (tablesToCheck.length === 0) return;

      // Get active orders
      const ordersRef = collection(db, `restaurants/${currentUser.uid}/orders`);
      let activeOrdersQuery = query(
        ordersRef,
        where('status', 'in', ['new', 'sent_to_kitchen', 'preparing', 'ready'])
      );

      // Filter by location if multi-location
      if (isMultiLocation && selectedLocation) {
        activeOrdersQuery = query(activeOrdersQuery, where('locationId', '==', selectedLocation));
      }

      const ordersSnapshot = await getDocs(activeOrdersQuery);

      // Create a map of occupied tables
      const occupiedTables = new Set();
      ordersSnapshot.docs.forEach(doc => {
        const orderData = doc.data();
        if (orderData.tableNumber) {
          const tableNumbers = Array.isArray(orderData.tableNumber)
            ? orderData.tableNumber
            : [orderData.tableNumber];
          tableNumbers.forEach(tableNum => occupiedTables.add(String(tableNum)));
        }
      });

      // Update table statuses
      const updatedTables = tablesToCheck.map(table => ({
        ...table,
        status: occupiedTables.has(String(table.number)) ? 'occupied' : (table.status || 'available')
      }));

      setTables(updatedTables);
    } catch (error) {
      console.error('Error updating table statuses:', error);
    }
  };

  const handleAddTable = () => {
    setEditingTable(null);
    setTableForm({ number: '', capacity: 4 });
    setShowAddTableModal(true);
  };

  const handleEditTable = (table) => {
    setEditingTable(table);
    setTableForm({ number: table.number, capacity: table.capacity || 4 });
    setShowAddTableModal(true);
  };

  const handleSaveTable = () => {
    const tableNumber = tableForm.number.trim();
    if (!tableNumber) {
      setError('Table number is required');
      return;
    }

    // Check for duplicate table numbers (excluding the current editing table)
    const existingTable = tables.find(t => 
      t.number === tableNumber && (!editingTable || t.id !== editingTable.id)
    );
    
    if (existingTable) {
      setError(`Table ${tableNumber} already exists. Please use a different number.`);
      return;
    }

    if (editingTable) {
      // Update existing table
      const updatedTables = tables.map(t =>
        t.id === editingTable.id
          ? { ...t, number: tableNumber, capacity: parseInt(tableForm.capacity) || 4 }
          : t
      );
      setTables(updatedTables);
    } else {
      // Add new table - place it in the center initially
      const newTable = {
        id: `table-${Date.now()}`,
        number: tableNumber,
        capacity: parseInt(tableForm.capacity) || 4,
        x: 50, // Percentage from left
        y: 50, // Percentage from top
        status: 'available' // available, occupied, reserved
      };
      setTables([...tables, newTable]);
    }

    setShowAddTableModal(false);
    setEditingTable(null);
    setTableForm({ number: '', capacity: 4 });
    setError('');
  };

  const handleDeleteTable = (tableId) => {
    if (window.confirm('Are you sure you want to delete this table?')) {
      setTables(tables.filter(t => t.id !== tableId));
    }
  };

  const handleMouseDown = (e, table) => {
    e.preventDefault();
    setDraggedTable(table);
    const rect = floorPlanRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setDragOffset({
      x: x - table.x,
      y: y - table.y
    });
  };

  // Touch event handler for mobile devices (iPad/iPhone)
  const handleTouchStart = (e, table) => {
    e.preventDefault();
    const touch = e.touches[0];
    setDraggedTable(table);
    const rect = floorPlanRef.current.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * 100;
    const y = ((touch.clientY - rect.top) / rect.height) * 100;
    setDragOffset({
      x: x - table.x,
      y: y - table.y
    });
  };

  const handleMouseMove = (e) => {
    if (!draggedTable || !floorPlanRef.current) return;

    const rect = floorPlanRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    // Subtract offset to maintain relative position
    x -= dragOffset.x;
    y -= dragOffset.y;

    // Constrain to floor plan bounds
    x = Math.max(5, Math.min(95, x));
    y = Math.max(5, Math.min(95, y));

    setTables(tables.map(t =>
      t.id === draggedTable.id ? { ...t, x, y } : t
    ));
  };

  // Touch move handler for mobile devices
  const handleTouchMove = (e) => {
    if (!draggedTable || !floorPlanRef.current) return;
    e.preventDefault(); // Prevent scrolling while dragging

    const touch = e.touches[0];
    const rect = floorPlanRef.current.getBoundingClientRect();
    let x = ((touch.clientX - rect.left) / rect.width) * 100;
    let y = ((touch.clientY - rect.top) / rect.height) * 100;

    // Subtract offset to maintain relative position
    x -= dragOffset.x;
    y -= dragOffset.y;

    // Constrain to floor plan bounds
    x = Math.max(5, Math.min(95, x));
    y = Math.max(5, Math.min(95, y));

    setTables(tables.map(t =>
      t.id === draggedTable.id ? { ...t, x, y } : t
    ));
  };

  const handleMouseUp = () => {
    setDraggedTable(null);
  };

  // Touch end handler for mobile devices
  const handleTouchEnd = () => {
    setDraggedTable(null);
  };

  useEffect(() => {
    if (draggedTable) {
      // Mouse events for desktop
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Touch events for mobile devices (iPad/iPhone)
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.addEventListener('touchcancel', handleTouchEnd);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
      };
    }
  }, [draggedTable, dragOffset]);

  const handleSaveLayout = async () => {
    if (tables.length === 0) {
      setError('Please add at least one table before saving');
      return;
    }

    try {
      setSaving(true);
      setError('');
      
      const layoutData = {
        tables: tables,
        updatedAt: new Date().toISOString()
      };

      // For multi-location, use location-specific layout path
      const layoutPath = isMultiLocation && selectedLocation
        ? `restaurants/${currentUser.uid}/locations/${selectedLocation}/layout/floorPlan`
        : `restaurants/${currentUser.uid}/layout/floorPlan`;
      
      const layoutRef = doc(db, layoutPath);
      await setDoc(layoutRef, layoutData, { merge: true });

      setLayout(layoutData);
      setSuccess('Layout saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error saving layout:', error);
      setError('Failed to save layout: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const getTableStatusColor = (status) => {
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

  const getTableStatusLabel = (status) => {
    switch (status) {
      case 'available':
        return 'Available';
      case 'occupied':
        return 'Occupied';
      case 'reserved':
        return 'Reserved';
      default:
        return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="table-layout-loading">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  // Show warning if multi-location but no location selected
  if (isMultiLocation && !selectedLocation) {
    return (
      <Container fluid className="table-layout-container">
        <div className="page-header-gradient">
          <div className="header-content">
            <i className="bi bi-grid-3x3-gap header-icon"></i>
            <div>
              <h2>Table Layout</h2>
              <p>Design and manage your restaurant floor plan</p>
            </div>
          </div>
        </div>
        <div className="d-flex align-items-center justify-content-center" style={{ height: '400px', flexDirection: 'column' }}>
          <i className="bi bi-exclamation-triangle" style={{ fontSize: '3rem', color: '#ffc107', marginBottom: '20px' }}></i>
          <h4>Please Select a Location</h4>
          <p className="text-muted">Select a location from the dropdown in the header to manage table layouts</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid className="table-layout-container">
      {/* Page Header */}
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-grid-3x3-gap header-icon"></i>
          <div>
            <h2>Table Layout</h2>
            <p>Design and manage your restaurant floor plan</p>
          </div>
        </div>
      </div>

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

      {!layout && tables.length === 0 ? (
        <div className="table-layout-empty">
          <div className="empty-content">
            <i className="bi bi-grid-3x3-gap"></i>
            <h3>No Layout Created</h3>
            <p>Create your restaurant floor plan by adding tables</p>
            <Button variant="primary" size="lg" onClick={handleAddTable}>
              <i className="bi bi-plus-circle"></i> Create Layout
            </Button>
          </div>
        </div>
      ) : (
        <div className="table-layout-content">
          <div className="table-layout-toolbar">
            <Button variant="primary" onClick={handleAddTable}>
              <i className="bi bi-plus-circle"></i> Add Table
            </Button>
            <Button 
              variant="success" 
              onClick={handleSaveLayout}
              disabled={saving || tables.length === 0}
            >
              {saving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Saving...
                </>
              ) : (
                <>
                  <i className="bi bi-save"></i> Save Layout
                </>
              )}
            </Button>
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
            className="table-floor-plan"
            ref={floorPlanRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {tables.map(table => (
              <div
                key={table.id}
                className="table-element"
                style={{
                  left: `${table.x}%`,
                  top: `${table.y}%`,
                  backgroundColor: getTableStatusColor(table.status),
                  cursor: draggedTable?.id === table.id ? 'grabbing' : 'grab',
                  touchAction: 'none' // Prevents default touch behaviors for better drag experience
                }}
                onMouseDown={(e) => handleMouseDown(e, table)}
                onTouchStart={(e) => handleTouchStart(e, table)}
              >
                <div className="table-number">{table.number}</div>
                <div className="table-capacity">
                  <i className="bi bi-people"></i> {table.capacity}
                </div>
                <div className="table-actions">
                  <button
                    className="table-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditTable(table);
                    }}
                    title="Edit table"
                  >
                    <i className="bi bi-pencil"></i>
                  </button>
                  <button
                    className="table-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTable(table.id);
                    }}
                    title="Delete table"
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
                <div className="table-status-badge">
                  {getTableStatusLabel(table.status)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Table Modal */}
      <Modal show={showAddTableModal} onHide={() => {
        setShowAddTableModal(false);
        setEditingTable(null);
        setTableForm({ number: '', capacity: 4 });
        setError('');
      }}>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingTable ? 'Edit Table' : 'Add New Table'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Table Number</Form.Label>
              <Form.Control
                type="text"
                value={tableForm.number}
                onChange={(e) => setTableForm({ ...tableForm, number: e.target.value })}
                placeholder="e.g., 1, 2, A1, etc."
                required
                autoFocus
              />
              <Form.Text className="text-muted">
                Each table must have a unique number
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Capacity (Number of Seats)</Form.Label>
              <Form.Control
                type="number"
                min="1"
                max="20"
                value={tableForm.capacity}
                onChange={(e) => {
                  const value = e.target.value;
                  setTableForm({ ...tableForm, capacity: value === '' ? '' : parseInt(value) || 4 });
                }}
                onBlur={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setTableForm({ ...tableForm, capacity: 4 });
                  }
                }}
                required
              />
            </Form.Group>
            {error && <Alert variant="danger">{error}</Alert>}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => {
            setShowAddTableModal(false);
            setEditingTable(null);
            setTableForm({ number: '', capacity: 4 });
            setError('');
          }}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveTable}>
            {editingTable ? 'Update' : 'Add'} Table
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default TableLayout;
