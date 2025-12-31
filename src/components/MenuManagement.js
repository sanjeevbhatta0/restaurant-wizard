import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  addDoc,
  getDocs,
  updateDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Button, Form, Alert, Spinner, Modal } from 'react-bootstrap';
import './PageHeader.css';
import './MenuManagement.css';

const MenuManagement = () => {
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { currentUser } = useAuth();

  // Modal states
  const [showItemModal, setShowItemModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showEditItemModal, setShowEditItemModal] = useState(false);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    discount: '',
    discountType: 'amount',
    image: null,
    imageUrl: ''
  });
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [imagePreview, setImagePreview] = useState(null);

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
        
        category.items = itemsSnapshot.docs.map(itemDoc => ({
          id: itemDoc.id,
          categoryId: category.id,
          ...itemDoc.data()
        }));
        
        categoriesData.push(category);
      }
      
      setCategories(categoriesData);
      if (categoriesData.length > 0 && !selectedCategory) {
        setSelectedCategory(categoriesData[0].id);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, selectedCategory]);

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

  const handleAddCategory = async (e) => {
    e.preventDefault();
    const name = categoryForm.name.trim();
    if (!name) return;

    try {
      setError('');
      const categoryRef = doc(collection(db, `restaurants/${currentUser.uid}/menuCategories`));
      await setDoc(categoryRef, {
        name,
        createdAt: new Date()
      });
      setSuccess('Category added successfully');
      setCategoryForm({ name: '' });
      setShowCategoryModal(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to add category: ' + error.message);
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (!window.confirm('Are you sure you want to delete this category and all its items?')) return;

    try {
      setError('');
      // Delete all items in the category first
      const itemsRef = collection(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items`);
      const itemsSnapshot = await getDocs(itemsRef);
      
      for (const itemDoc of itemsSnapshot.docs) {
        const itemData = itemDoc.data();
        if (itemData.imageStoragePath) {
          const imageRef = ref(storage, itemData.imageStoragePath);
          await deleteObject(imageRef);
        }
        await deleteDoc(doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items/${itemDoc.id}`));
      }
      
      // Then delete the category
      await deleteDoc(doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}`));
      setSuccess('Category and all its items deleted successfully');
      
      // Select first category if available
      const updatedCategories = categories.filter(c => c.id !== categoryId);
      if (updatedCategories.length > 0 && selectedCategory === categoryId) {
        setSelectedCategory(updatedCategories[0].id);
      } else if (updatedCategories.length === 0) {
        setSelectedCategory(null);
      }
      
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to delete category: ' + error.message);
    }
  };

  const handleAddItem = (category) => {
    setCurrentCategory(category);
    setItemForm({
      name: '',
      description: '',
      price: '',
      discount: '',
      discountType: 'amount',
      image: null,
      imageUrl: ''
    });
    setImagePreview(null);
    setShowItemModal(true);
  };

  const handleEditItem = (item, category) => {
    setEditingItem(item);
    setCurrentCategory(category);
    setItemForm({
      name: item.name || '',
      description: item.description || '',
      price: item.price || '',
      discount: item.discount || '',
      discountType: item.discountType || 'amount',
      image: null,
      imageUrl: item.imageUrl || ''
    });
    setImagePreview(item.imageUrl || null);
    setShowEditItemModal(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setItemForm({
        ...itemForm,
        image: file
      });
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmitItem = async (e) => {
    e.preventDefault();
    if (!currentCategory) return;

    try {
      setError('');
      setLoading(true);
      let imageUrl = itemForm.imageUrl;
      let imageStoragePath = editingItem?.imageStoragePath || '';

      if (itemForm.image) {
        // Delete old image if editing
        if (editingItem?.imageStoragePath) {
          try {
            const oldImageRef = ref(storage, editingItem.imageStoragePath);
            await deleteObject(oldImageRef);
          } catch (err) {
            console.error('Error deleting old image:', err);
          }
        }
        
        const fileName = `${Date.now()}-${itemForm.image.name}`;
        imageStoragePath = `restaurants/${currentUser.uid}/menuItems/${currentCategory.id}/${fileName}`;
        const storageRef = ref(storage, imageStoragePath);
        await uploadBytes(storageRef, itemForm.image);
        imageUrl = await getDownloadURL(storageRef);
      }

      const itemData = {
        name: itemForm.name,
        description: itemForm.description,
        price: parseFloat(itemForm.price),
        discount: itemForm.discount ? parseFloat(itemForm.discount) : 0,
        discountType: itemForm.discountType,
        imageUrl,
        imageStoragePath,
        updatedAt: new Date()
      };

      if (editingItem) {
        // Update existing item
        const itemRef = doc(db, `restaurants/${currentUser.uid}/menuCategories/${currentCategory.id}/items/${editingItem.id}`);
        await updateDoc(itemRef, itemData);
        setSuccess('Item updated successfully');
      } else {
        // Add new item
        itemData.createdAt = new Date();
      await addDoc(collection(db, `restaurants/${currentUser.uid}/menuCategories/${currentCategory.id}/items`), itemData);
      setSuccess('Item added successfully');
      }

      setShowItemModal(false);
      setShowEditItemModal(false);
      setEditingItem(null);
      setItemForm({
        name: '',
        description: '',
        price: '',
        discount: '',
        discountType: 'amount',
        image: null,
        imageUrl: ''
      });
      setImagePreview(null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to save item: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (categoryId, itemId, imageStoragePath) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    try {
      setError('');
      if (imageStoragePath) {
        const imageRef = ref(storage, imageStoragePath);
        await deleteObject(imageRef);
      }
      
      await deleteDoc(doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items/${itemId}`));
      setSuccess('Item deleted successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to delete item: ' + error.message);
    }
  };

  // Get current category's items
  const currentCategoryData = categories.find(c => c.id === selectedCategory);
  const currentCategoryItems = currentCategoryData?.items || [];

  if (loading && categories.length === 0) {
    return (
      <div className="menu-loading">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  return (
    <div className="menu-management-container">
      {/* Page Header */}
      <div className="page-header-gradient">
        <div className="header-content">
          <i className="bi bi-menu-button-wide header-icon"></i>
          <div>
            <h2>Menu Management</h2>
            <p>Create and organize your restaurant menu</p>
          </div>
        </div>
      </div>
      
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible className="menu-alert">{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible className="menu-alert">{success}</Alert>}

      <div className="menu-container">
        {/* Left Panel - Category Navigation */}
        <div className="menu-categories">
          <h5>Categories</h5>
          <button 
            className="menu-add-category-btn"
            onClick={() => setShowCategoryModal(true)}
          >
            <i className="bi bi-plus-circle"></i> Add Category
          </button>
          <ul className="category-nav">
            {categories.map(category => (
              <li
                key={category.id}
                className={`category-nav-item ${selectedCategory === category.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(category.id)}
              >
                <span className="category-name">{category.name}</span>
                <span className="category-count">({category.items?.length || 0})</span>
                <button
                  className="category-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCategory(category.id);
                  }}
                  title="Delete category"
                >
                  <i className="bi bi-trash"></i>
                </button>
              </li>
            ))}
          </ul>
          {categories.length === 0 && (
            <div className="menu-empty-categories">
              <i className="bi bi-folder-plus"></i>
              <p>No categories yet</p>
              <small>Click "Add Category" to get started</small>
            </div>
          )}
        </div>

        {/* Main Panel - Item Tiles */}
        <div className="menu-main">
          <div className="menu-header">
            <h4>
              {currentCategoryData?.name || 'Select a Category'}
            </h4>
            {selectedCategory && (
              <Button 
                variant="primary"
                onClick={() => handleAddItem(currentCategoryData)}
                className="menu-add-item-header-btn"
              >
                <i className="bi bi-plus-circle"></i> Add Item
              </Button>
            )}
          </div>
          
          <div className="menu-items-grid">
            {/* Add Item Tile */}
            {selectedCategory && (
              <div
                className="menu-item-tile menu-add-item-tile"
                onClick={() => handleAddItem(currentCategoryData)}
              >
                <div className="menu-add-item-icon">
                  <i className="bi bi-plus-circle"></i>
                </div>
                <div className="menu-add-item-text">Add Item</div>
              </div>
            )}

            {/* Item Tiles */}
            {currentCategoryItems.map(item => (
              <div
                key={item.id}
                className="menu-item-tile"
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="menu-item-image"
                  />
                ) : (
                  <div className="menu-item-placeholder">
                    <i className="bi bi-cup-straw"></i>
                  </div>
                )}
                <div className="menu-item-name">{item.name}</div>
                <div className="menu-item-price">
                  ${calculateItemPrice(item).toFixed(2)}
                  {item.discount > 0 && (
                    <span className="menu-item-discount">${item.price.toFixed(2)}</span>
                  )}
                </div>
                <div className="menu-item-actions">
                  <button
                    className="menu-item-edit-btn"
                    onClick={() => handleEditItem(item, currentCategoryData)}
                    title="Edit item"
                  >
                    <i className="bi bi-pencil"></i>
                  </button>
                  <button
                    className="menu-item-delete-btn"
                    onClick={() => handleDeleteItem(currentCategoryData.id, item.id, item.imageStoragePath)}
                    title="Delete item"
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            ))}

            {currentCategoryItems.length === 0 && selectedCategory && (
              <div className="menu-empty-items">
                <i className="bi bi-inbox"></i>
                <p>No items in this category</p>
                <small>Click "Add Item" to add your first item</small>
              </div>
            )}

            {!selectedCategory && (
              <div className="menu-empty-items">
                <i className="bi bi-folder2-open"></i>
                <p>Select a category to view items</p>
                <small>Or create a new category to get started</small>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Add Category Modal */}
      <Modal show={showCategoryModal} onHide={() => setShowCategoryModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add New Category</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleAddCategory}>
            <Form.Group className="mb-3">
              <Form.Label>Category Name</Form.Label>
              <Form.Control
                type="text"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ name: e.target.value })}
                placeholder="Enter category name"
                required
                autoFocus
              />
            </Form.Group>
            <div className="d-flex justify-content-end">
              <Button variant="secondary" className="me-2" onClick={() => setShowCategoryModal(false)}>
                Cancel
              </Button>
            <Button type="submit">Add Category</Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Add/Edit Item Modal */}
      <Modal 
        show={showItemModal || showEditItemModal} 
        onHide={() => {
          setShowItemModal(false);
          setShowEditItemModal(false);
          setEditingItem(null);
          setItemForm({
            name: '',
            description: '',
            price: '',
            discount: '',
            discountType: 'amount',
            image: null,
            imageUrl: ''
          });
          setImagePreview(null);
        }}
        size="lg"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {editingItem ? 'Edit Item' : `Add New Item to ${currentCategory?.name}`}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmitItem}>
            <Form.Group className="mb-3">
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={itemForm.name}
                onChange={(e) => setItemForm({...itemForm, name: e.target.value})}
                required
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={itemForm.description}
                onChange={(e) => setItemForm({...itemForm, description: e.target.value})}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Price</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={itemForm.price}
                onChange={(e) => setItemForm({...itemForm, price: e.target.value})}
                required
              />
            </Form.Group>

            <div className="row mb-3">
              <div className="col-md-6">
                <Form.Group>
                  <Form.Label>Discount</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={itemForm.discount}
                    onChange={(e) => setItemForm({...itemForm, discount: e.target.value})}
                    placeholder="Enter discount"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group>
                  <Form.Label>Discount Type</Form.Label>
                  <Form.Select
                    value={itemForm.discountType}
                    onChange={(e) => setItemForm({...itemForm, discountType: e.target.value})}
                  >
                    <option value="amount">Amount ($)</option>
                    <option value="percentage">Percentage (%)</option>
                  </Form.Select>
                </Form.Group>
              </div>
            </div>

            <Form.Group className="mb-3">
              <Form.Label>Image</Form.Label>
              <Form.Control
                type="file"
                accept="image/*"
                onChange={handleImageChange}
              />
            </Form.Group>

            {imagePreview && (
              <div className="mb-3">
                <img
                  src={imagePreview}
                  alt="Preview"
                  style={{ maxWidth: '100%', height: 'auto', maxHeight: '200px', borderRadius: '8px' }}
                />
              </div>
            )}

            <div className="d-flex justify-content-end">
              <Button 
                variant="secondary" 
                className="me-2" 
                onClick={() => {
                  setShowItemModal(false);
                  setShowEditItemModal(false);
                  setEditingItem(null);
                  setItemForm({
                    name: '',
                    description: '',
                    price: '',
                    discount: '',
                    discountType: 'amount',
                    image: null,
                    imageUrl: ''
                  });
                  setImagePreview(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : (editingItem ? 'Update Item' : 'Add Item')}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default MenuManagement;
