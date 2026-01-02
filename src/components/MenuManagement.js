import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
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
import { useLocation } from '../contexts/LocationContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useMenu } from '../contexts/MenuContext';
import { Button, Form, Alert, Spinner, Modal, Badge, ProgressBar } from 'react-bootstrap';
import menuParserService from '../services/menuParserService';
import './PageHeader.css';
import './MenuManagement.css';

const MenuManagement = () => {
  // Use shared menu data from context
  const { categories, loading: menuLoading, refreshMenu } = useMenu();
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const { currentUser } = useAuth();
  const { isMultiLocation, locations, selectedLocation } = useLocation();
  const { getCurrentTier, getMenuLimit } = useSubscription();

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
    imageUrl: '',
    locations: [] // Empty array = all locations, otherwise specific location IDs
  });
  const [categoryForm, setCategoryForm] = useState({ name: '' });
  const [imagePreview, setImagePreview] = useState(null);

  // Menu upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);

  // Menu limit modal for scout tier
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Calculate total menu items across all categories
  const totalMenuItems = categories.reduce((sum, cat) => sum + (cat.items?.length || 0), 0);
  const menuLimit = getMenuLimit();
  const isAtMenuLimit = getCurrentTier() === 'scout' && totalMenuItems >= menuLimit.items;

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
      refreshMenu(); // Refresh cached menu data
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

      refreshMenu(); // Refresh cached menu data
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to delete category: ' + error.message);
    }
  };

  const handleAddItem = (category) => {
    // Check menu item limit for scout tier
    if (isAtMenuLimit) {
      setShowUpgradeModal(true);
      return;
    }

    setCurrentCategory(category);
    setItemForm({
      name: '',
      description: '',
      price: '',
      discount: '',
      discountType: 'amount',
      image: null,
      imageUrl: '',
      locations: [] // Default: all locations
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
      imageUrl: item.imageUrl || '',
      locations: item.locations || [] // Preserve location assignments
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
      setSaving(true);
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
        locations: itemForm.locations || [], // Empty array = all locations
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
        imageUrl: '',
        locations: []
      });
      setImagePreview(null);
      refreshMenu(); // Refresh cached menu data
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to save item: ' + error.message);
    } finally {
      setSaving(false);
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
      refreshMenu(); // Refresh cached menu data
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to delete item: ' + error.message);
    }
  };

  // Handle menu upload with AI parsing
  const handleMenuUpload = async () => {
    if (!uploadedFile) {
      setError('Please select a file to upload');
      return;
    }

    setIsUploading(true);
    setUploadProgress(1);
    setUploadStatus('Preparing your menu for AI processing...');
    setUploadComplete(false);

    try {
      // Read file as base64
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const base64Data = e.target.result;
          // Extract base64 data without the data URL prefix
          const base64Content = base64Data.split(',')[1];
          const mimeType = uploadedFile.type;

          setUploadProgress(15);
          setUploadStatus('Uploading to AI service...');

          // Simulate progress while waiting for AI
          const progressInterval = setInterval(() => {
            setUploadProgress(prev => {
              if (prev < 85) {
                return prev + Math.random() * 5;
              }
              return prev;
            });
          }, 500);

          setUploadStatus('AI is analyzing your menu...');

          // Call the AI parsing service
          const result = await menuParserService.parseMenuImage(base64Content, mimeType);

          clearInterval(progressInterval);
          setUploadProgress(90);
          setUploadStatus('Creating menu items...');

          if (result.success && result.data?.categories) {
            // Create categories and items in Firestore
            let totalItemsCreated = 0;

            for (const category of result.data.categories) {
              // Check if category already exists
              let categoryId;
              const existingCategory = categories.find(
                c => c.name.toLowerCase() === category.name.toLowerCase()
              );

              if (existingCategory) {
                categoryId = existingCategory.id;
              } else {
                // Create new category
                const categoryRef = doc(collection(db, `restaurants/${currentUser.uid}/menuCategories`));
                await setDoc(categoryRef, {
                  name: category.name,
                  createdAt: new Date()
                });
                categoryId = categoryRef.id;
              }

              // Create items in the category
              for (const item of category.items) {
                await addDoc(
                  collection(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items`),
                  {
                    name: item.name,
                    description: item.description || '',
                    price: item.price || 0,
                    discount: item.discount || 0,
                    discountType: 'amount',
                    imageUrl: '',
                    imageStoragePath: '',
                    locations: [],
                    createdAt: new Date(),
                    updatedAt: new Date()
                  }
                );
                totalItemsCreated++;
              }
            }

            setUploadProgress(100);
            setUploadStatus(`✅ Successfully imported ${totalItemsCreated} items!`);
            setUploadComplete(true);
            setSuccess(`Menu imported! Created ${totalItemsCreated} items across ${result.data.categories.length} categories.`);
          } else {
            throw new Error('Failed to parse menu data');
          }
        } catch (err) {
          console.error('Error processing menu:', err);
          setUploadStatus(`❌ Error: ${err.message}`);
          setUploadProgress(0);
          setError('Failed to process menu: ' + err.message);
        } finally {
          setIsUploading(false);
        }
      };

      reader.onerror = () => {
        setError('Failed to read the file');
        setIsUploading(false);
      };

      reader.readAsDataURL(uploadedFile);
    } catch (err) {
      console.error('Error uploading menu:', err);
      setError('Failed to upload menu: ' + err.message);
      setIsUploading(false);
    }
  };

  const resetUploadModal = () => {
    setShowUploadModal(false);
    setUploadProgress(0);
    setUploadStatus('');
    setIsUploading(false);
    setUploadComplete(false);
    setUploadedFile(null);
  };

  // Get current category's items
  const currentCategoryData = categories.find(c => c.id === selectedCategory);
  const currentCategoryItems = currentCategoryData?.items || [];

  if (menuLoading && categories.length === 0) {
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
            <p>Create and organize your restaurant menu{getCurrentTier() === 'scout' && <span className="text-warning ms-2">({totalMenuItems}/{menuLimit.items} items)</span>}</p>
          </div>
        </div>
        {/* Only show AI upload for non-scout tiers */}
        {getCurrentTier() !== 'scout' && (
          <Button
            variant="light"
            className="ms-auto"
            onClick={() => setShowUploadModal(true)}
            style={{
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <i className="bi bi-cloud-upload"></i>
            Upload Menu
            <Badge bg="warning" text="dark" style={{ fontSize: '0.7em' }}>AI</Badge>
          </Button>
        )}
      </div>

      {/* Premium Feature Promo Banner for Ally Tier ONLY (not scout) */}
      {getCurrentTier() === 'ally' && (
        <div className="premium-promo-banner">
          <div className="promo-glow"></div>
          <div className="promo-content">
            <div className="promo-icon-container">
              <div className="promo-icon-bg">
                <i className="bi bi-stars"></i>
              </div>
              <div className="promo-sparkle promo-sparkle-1">✦</div>
              <div className="promo-sparkle promo-sparkle-2">✧</div>
              <div className="promo-sparkle promo-sparkle-3">✦</div>
            </div>
            <div className="promo-text-content">
              <div className="promo-badge">
                <span className="promo-badge-icon">🎁</span>
                <span>Limited Time Bonus</span>
              </div>
              <h3 className="promo-title">AI Menu Upload Included!</h3>
              <p className="promo-description">
                You're enjoying AI-powered menu uploads as a special bonus.
                <strong> Upgrade to Guide</strong> to unlock unlimited uploads and keep this premium feature forever.
              </p>
            </div>
            <Link to="/account" className="promo-cta-button">
              <span>View Plans</span>
              <i className="bi bi-arrow-right-circle-fill"></i>
            </Link>
          </div>
        </div>
      )}

      {/* Scout tier limit warning */}
      {getCurrentTier() === 'scout' && totalMenuItems >= menuLimit.items * 0.8 && (
        <Alert variant={totalMenuItems >= menuLimit.items ? 'danger' : 'warning'} className="menu-alert">
          <i className="bi bi-exclamation-triangle"></i>
          {totalMenuItems >= menuLimit.items ? (
            <>You've reached the {menuLimit.items} item limit on the free Scout plan. <Link to="/account">Upgrade now</Link> to add unlimited items.</>
          ) : (
            <>You're using {totalMenuItems} of {menuLimit.items} menu items on the free Scout plan. <Link to="/account">Upgrade</Link> for unlimited items.</>
          )}
        </Alert>
      )}

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible className="menu-alert">{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible className="menu-alert">{success}</Alert>}

      {isMultiLocation && selectedLocation && (
        <Alert variant="info" className="menu-alert">
          <i className="bi bi-info-circle"></i> Showing menu items for: <strong>{locations.find(l => l.id === selectedLocation)?.name || 'Selected Location'}</strong>.
          Items available at all locations are also shown. Use location assignment when adding/editing items to limit to specific locations.
        </Alert>
      )}

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
                {isMultiLocation && item.locations && item.locations.length > 0 && (
                  <div className="menu-item-locations">
                    <Badge bg="secondary" className="me-1">
                      <i className="bi bi-geo-alt"></i> {item.locations.length} location{item.locations.length > 1 ? 's' : ''}
                    </Badge>
                  </div>
                )}
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
            imageUrl: '',
            locations: []
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
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
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
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Price</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={itemForm.price}
                onChange={(e) => {
                  const value = e.target.value;
                  setItemForm({ ...itemForm, price: value === '' ? '' : value });
                }}
                onBlur={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setItemForm({ ...itemForm, price: '' });
                  }
                }}
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
                    onChange={(e) => {
                      const value = e.target.value;
                      setItemForm({ ...itemForm, discount: value === '' ? '' : value });
                    }}
                    onBlur={(e) => {
                      const value = e.target.value;
                      if (value === '') {
                        setItemForm({ ...itemForm, discount: '' });
                      }
                    }}
                    placeholder="Enter discount"
                  />
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group>
                  <Form.Label>Discount Type</Form.Label>
                  <Form.Select
                    value={itemForm.discountType}
                    onChange={(e) => setItemForm({ ...itemForm, discountType: e.target.value })}
                  >
                    <option value="amount">Amount ($)</option>
                    <option value="percentage">Percentage (%)</option>
                  </Form.Select>
                </Form.Group>
              </div>
            </div>

            {/* Location Assignment - Only for Multi-Location */}
            {isMultiLocation && locations.length > 0 && (
              <Form.Group className="mb-3">
                <Form.Label>Available at Locations</Form.Label>
                <Form.Text className="d-block mb-2 text-muted">
                  Leave unchecked to make this item available at all locations. Select specific locations to limit availability.
                </Form.Text>
                <div className="location-checkboxes">
                  {locations.map(location => {
                    const currentLocations = itemForm.locations || [];
                    const isChecked = currentLocations.includes(location.id);
                    return (
                      <Form.Check
                        key={location.id}
                        type="checkbox"
                        id={`location-${location.id}`}
                        label={location.name}
                        checked={isChecked}
                        onChange={(e) => {
                          const locations = itemForm.locations || [];
                          if (e.target.checked) {
                            setItemForm({
                              ...itemForm,
                              locations: [...locations, location.id]
                            });
                          } else {
                            setItemForm({
                              ...itemForm,
                              locations: locations.filter(id => id !== location.id)
                            });
                          }
                        }}
                        className="mb-2"
                      />
                    );
                  })}
                </div>
                {itemForm.locations.length === 0 && (
                  <Badge bg="info" className="mt-2">Available at all locations</Badge>
                )}
                {itemForm.locations.length > 0 && (
                  <Badge bg="primary" className="mt-2">
                    Available at {itemForm.locations.length} location{itemForm.locations.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </Form.Group>
            )}

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
                    imageUrl: '',
                    locations: []
                  });
                  setImagePreview(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : (editingItem ? 'Update Item' : 'Add Item')}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Menu Upload Modal */}
      <Modal
        show={showUploadModal}
        onHide={!isUploading ? resetUploadModal : undefined}
        centered
        backdrop={isUploading ? 'static' : true}
      >
        <Modal.Header closeButton={!isUploading}>
          <Modal.Title>
            <i className="bi bi-magic me-2"></i>
            AI Menu Upload
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!isUploading && !uploadComplete ? (
            <>
              <p className="text-muted mb-3">
                Upload a photo or PDF of your menu and our AI will automatically extract
                all categories and items for you.
              </p>
              <Form.Group className="mb-3">
                <Form.Label>Select Menu File</Form.Label>
                <Form.Control
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setUploadedFile(e.target.files[0])}
                />
                <Form.Text className="text-muted">
                  Supported formats: JPG, PNG, PDF
                </Form.Text>
              </Form.Group>
              {uploadedFile && (
                <Alert variant="info" className="d-flex align-items-center">
                  <i className="bi bi-file-earmark me-2"></i>
                  <span>{uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)</span>
                </Alert>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              <div className="mb-3">
                {uploadComplete ? (
                  <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '3rem' }}></i>
                ) : (
                  <Spinner animation="border" variant="primary" style={{ width: '3rem', height: '3rem' }} />
                )}
              </div>
              <h5 className="mb-3">{uploadStatus}</h5>
              <ProgressBar
                now={uploadProgress}
                label={`${Math.round(uploadProgress)}%`}
                animated={!uploadComplete}
                variant={uploadComplete ? 'success' : 'primary'}
                className="mb-3"
                style={{ height: '25px' }}
              />
              {uploadComplete && (
                <p className="text-success mb-0">
                  <i className="bi bi-info-circle me-1"></i>
                  Your menu items have been imported successfully!
                </p>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          {!isUploading && !uploadComplete && (
            <>
              <Button variant="secondary" onClick={resetUploadModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleMenuUpload}
                disabled={!uploadedFile}
              >
                <i className="bi bi-magic me-1"></i>
                Start AI Processing
              </Button>
            </>
          )}
          {uploadComplete && (
            <Button variant="success" onClick={resetUploadModal}>
              <i className="bi bi-check-lg me-1"></i>
              Close
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* Upgrade Modal for Scout Tier Menu Limit */}
      <Modal show={showUpgradeModal} onHide={() => setShowUpgradeModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-arrow-up-circle text-primary me-2"></i>
            Menu Item Limit Reached
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="text-center mb-4">
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              fontSize: '2.5rem'
            }}>
              🔍
            </div>
            <h4>You've reached {menuLimit.items} items!</h4>
            <p className="text-muted">
              The free Scout plan includes up to {menuLimit.items} menu items.
              Upgrade to Ally or higher to add unlimited menu items and unlock AI-powered menu uploads.
            </p>
          </div>
          <div style={{
            background: '#f8f9fa',
            borderRadius: '12px',
            padding: '16px'
          }}>
            <h6><i className="bi bi-star-fill text-warning me-2"></i>Ally Plan Benefits:</h6>
            <ul style={{ marginBottom: 0 }}>
              <li>Unlimited menu items</li>
              <li>AI-powered menu uploads</li>
              <li>500 orders per month</li>
              <li>All POS features</li>
            </ul>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowUpgradeModal(false)}>
            Maybe Later
          </Button>
          <Link to="/account" className="btn" style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            fontWeight: 600
          }}>
            <i className="bi bi-arrow-up-circle me-1"></i>
            Upgrade Now
          </Link>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default MenuManagement;
