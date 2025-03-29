import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs, 
  query, 
  where, 
  orderBy 
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { db, storage } from '../firebase';
import { 
  Container, 
  Card, 
  Button, 
  Row, 
  Col, 
  Modal, 
  Form, 
  Badge, 
  Spinner, 
  Alert, 
  FormControl,
  InputGroup
} from 'react-bootstrap';

const MenuManagement = ({ user }) => {
  // State for categories and items
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // State for modals
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // State for current selections
  const [currentCategory, setCurrentCategory] = useState(null);
  const [currentItem, setCurrentItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  // Form state
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    discountType: 'none',
    discountValue: '',
    available: true,
    image: null,
    imageUrl: ''
  });

  // Image preview
  const [imagePreview, setImagePreview] = useState(null);
  
  const history = useHistory();

  // Fetch categories and items on load
  useEffect(() => {
    fetchCategories();
  }, [user]);

  const fetchCategories = async () => {
    setLoading(true);
    setError('');
    try {
      const categoriesRef = collection(db, `restaurants/${user.uid}/menuCategories`);
      const q = query(categoriesRef, orderBy('name'));
      const querySnapshot = await getDocs(q);
      
      let categoriesData = [];
      
      for (const categoryDoc of querySnapshot.docs) {
        const categoryData = {
          id: categoryDoc.id,
          ...categoryDoc.data(),
          items: []
        };
        
        // Fetch items for this category
        const itemsRef = collection(db, `restaurants/${user.uid}/menuCategories/${categoryDoc.id}/items`);
        const itemsQuery = query(itemsRef, orderBy('name'));
        const itemsSnapshot = await getDocs(itemsQuery);
        
        itemsSnapshot.forEach(itemDoc => {
          categoryData.items.push({
            id: itemDoc.id,
            ...itemDoc.data()
          });
        });
        
        categoriesData.push(categoryData);
      }
      
      setCategories(categoriesData);
    } catch (err) {
      console.error("Error fetching menu data:", err);
      setError('Failed to load menu data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Category Modal Handlers
  const openCategoryModal = (category = null) => {
    if (category) {
      setCurrentCategory(category);
      setCategoryForm({
        name: category.name,
        description: category.description || ''
      });
    } else {
      setCurrentCategory(null);
      setCategoryForm({ name: '', description: '' });
    }
    setShowCategoryModal(true);
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      if (currentCategory) {
        // Update existing category
        const categoryRef = doc(db, `restaurants/${user.uid}/menuCategories`, currentCategory.id);
        await updateDoc(categoryRef, categoryForm);
      } else {
        // Create new category
        await addDoc(collection(db, `restaurants/${user.uid}/menuCategories`), {
          ...categoryForm,
          createdAt: new Date().toISOString()
        });
      }
      
      await fetchCategories();
      setShowCategoryModal(false);
    } catch (err) {
      console.error("Error saving category:", err);
      setError('Failed to save category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const openDeleteCategoryModal = (category) => {
    setCategoryToDelete(category);
    setShowDeleteModal(true);
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;
    
    setLoading(true);
    try {
      // Delete all items in the category first
      for (const item of categoryToDelete.items) {
        // Delete item image if it exists
        if (item.imageUrl) {
          const imageRef = ref(storage, item.imageStoragePath);
          await deleteObject(imageRef);
        }
        
        // Delete the item
        await deleteDoc(doc(db, `restaurants/${user.uid}/menuCategories/${categoryToDelete.id}/items`, item.id));
      }
      
      // Delete the category
      await deleteDoc(doc(db, `restaurants/${user.uid}/menuCategories`, categoryToDelete.id));
      
      await fetchCategories();
      setShowDeleteModal(false);
      setCategoryToDelete(null);
    } catch (err) {
      console.error("Error deleting category:", err);
      setError('Failed to delete category. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Item Modal Handlers
  const openItemModal = (category, item = null) => {
    setCurrentCategory(category);
    
    if (item) {
      setCurrentItem(item);
      setItemForm({
        name: item.name,
        description: item.description || '',
        price: item.price,
        discountType: item.discountType || 'none',
        discountValue: item.discountValue || '',
        available: item.available !== false, // Default to true if not set
        image: null,
        imageUrl: item.imageUrl || ''
      });
      setImagePreview(item.imageUrl || null);
    } else {
      setCurrentItem(null);
      setItemForm({
        name: '',
        description: '',
        price: '',
        discountType: 'none',
        discountValue: '',
        available: true,
        image: null,
        imageUrl: ''
      });
      setImagePreview(null);
    }
    
    setShowItemModal(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setItemForm({
        ...itemForm,
        image: file
      });
      
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleItemSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      let imageUrl = itemForm.imageUrl;
      let imageStoragePath = currentItem?.imageStoragePath || null;
      
      // Handle image upload if there's a new image
      if (itemForm.image) {
        try {
          console.log('Starting image upload...');
          const fileName = `${Date.now()}-${itemForm.image.name}`;
          imageStoragePath = `restaurants/${user.uid}/menuItems/${currentCategory.id}/${fileName}`;
          const storageRef = ref(storage, imageStoragePath);
          
          // Upload the image
          console.log('Uploading image to storage...');
          const uploadResult = await uploadBytes(storageRef, itemForm.image);
          console.log('Image uploaded successfully:', uploadResult);
          
          // Get the download URL
          console.log('Getting download URL...');
          imageUrl = await getDownloadURL(storageRef);
          console.log('Got download URL:', imageUrl);
          
          // If updating an item and the old image is being replaced, delete old image
          if (currentItem?.imageStoragePath && currentItem.imageStoragePath !== imageStoragePath) {
            try {
              console.log('Deleting old image...');
              const oldImageRef = ref(storage, currentItem.imageStoragePath);
              await deleteObject(oldImageRef);
              console.log('Old image deleted successfully');
            } catch (imgErr) {
              console.warn("Could not delete old image:", imgErr);
            }
          }
        } catch (uploadError) {
          console.error('Error during image upload:', uploadError);
          throw new Error(`Failed to upload image: ${uploadError.message}`);
        }
      }
      
      // Prepare item data
      const itemData = {
        name: itemForm.name,
        description: itemForm.description,
        price: parseFloat(itemForm.price),
        discountType: itemForm.discountType,
        discountValue: itemForm.discountType !== 'none' ? parseFloat(itemForm.discountValue) : null,
        available: itemForm.available,
        updatedAt: new Date().toISOString()
      };
      
      // Add image info if available
      if (imageUrl) {
        itemData.imageUrl = imageUrl;
        itemData.imageStoragePath = imageStoragePath;
      }
      
      // Calculate final price
      if (itemForm.discountType === 'percentage' && itemForm.discountValue) {
        const discount = parseFloat(itemForm.price) * (parseFloat(itemForm.discountValue) / 100);
        itemData.finalPrice = parseFloat((parseFloat(itemForm.price) - discount).toFixed(2));
      } else if (itemForm.discountType === 'amount' && itemForm.discountValue) {
        itemData.finalPrice = parseFloat((parseFloat(itemForm.price) - parseFloat(itemForm.discountValue)).toFixed(2));
      } else {
        itemData.finalPrice = parseFloat(itemForm.price);
      }
      
      console.log('Saving item data to Firestore:', itemData);
      
      if (currentItem) {
        // Update existing item
        const itemRef = doc(db, `restaurants/${user.uid}/menuCategories/${currentCategory.id}/items`, currentItem.id);
        await updateDoc(itemRef, itemData);
        console.log('Item updated successfully');
      } else {
        // Create new item
        itemData.createdAt = new Date().toISOString();
        const docRef = await addDoc(collection(db, `restaurants/${user.uid}/menuCategories/${currentCategory.id}/items`), itemData);
        console.log('New item created successfully with ID:', docRef.id);
      }
      
      await fetchCategories();
      setShowItemModal(false);
    } catch (err) {
      console.error("Error saving menu item:", err);
      setError(`Failed to save menu item: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const openDeleteItemModal = (category, item) => {
    setCurrentCategory(category);
    setItemToDelete(item);
    setShowDeleteModal(true);
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete || !currentCategory) return;
    
    setLoading(true);
    try {
      // Delete image if it exists
      if (itemToDelete.imageStoragePath) {
        const imageRef = ref(storage, itemToDelete.imageStoragePath);
        await deleteObject(imageRef);
      }
      
      // Delete the item
      await deleteDoc(doc(db, `restaurants/${user.uid}/menuCategories/${currentCategory.id}/items`, itemToDelete.id));
      
      await fetchCategories();
      setShowDeleteModal(false);
      setItemToDelete(null);
      setCurrentCategory(null);
    } catch (err) {
      console.error("Error deleting item:", err);
      setError('Failed to delete item. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Utility function to format prices
  const formatPrice = (price) => {
    return `$${parseFloat(price).toFixed(2)}`;
  };
  
  // Calculate final price based on discount
  const calculateFinalPrice = () => {
    if (!itemForm.price) return '';
    
    const basePrice = parseFloat(itemForm.price);
    if (itemForm.discountType === 'none' || !itemForm.discountValue) {
      return formatPrice(basePrice);
    }
    
    if (itemForm.discountType === 'percentage') {
      const discount = basePrice * (parseFloat(itemForm.discountValue) / 100);
      return formatPrice(basePrice - discount);
    } else if (itemForm.discountType === 'amount') {
      return formatPrice(basePrice - parseFloat(itemForm.discountValue));
    }
    
    return formatPrice(basePrice);
  };

  if (loading && categories.length === 0) {
    return (
      <Container className="mt-4">
        <div className="text-center my-5">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading...</span>
          </Spinner>
          <p className="mt-2">Loading menu data...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid className="mt-4">
      <h2 className="mb-4">Menu Management</h2>
      
      {error && <Alert variant="danger">{error}</Alert>}
      
      <div className="d-flex justify-content-between mb-4">
        <Button 
          variant="primary" 
          onClick={() => openCategoryModal()}
        >
          Add New Category
        </Button>
        <Button 
          variant="outline-secondary" 
          onClick={() => history.push('/home')}
        >
          Back to Dashboard
        </Button>
      </div>
      
      {categories.length === 0 && !loading ? (
        <Card className="text-center p-5">
          <Card.Body>
            <h4>No Menu Categories Yet</h4>
            <p>Start by adding your first menu category like "Appetizers" or "Main Course".</p>
            <Button 
              variant="primary" 
              onClick={() => openCategoryModal()}
            >
              Add First Category
            </Button>
          </Card.Body>
        </Card>
      ) : (
        <Row>
          {categories.map(category => (
            <Col key={category.id} lg={6} className="mb-4">
              <Card>
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">{category.name}</h5>
                  <div>
                    <Button 
                      variant="outline-primary" 
                      size="sm" 
                      className="me-2" 
                      onClick={() => openCategoryModal(category)}
                    >
                      Edit
                    </Button>
                    <Button 
                      variant="outline-danger" 
                      size="sm" 
                      onClick={() => openDeleteCategoryModal(category)}
                    >
                      Delete
                    </Button>
                  </div>
                </Card.Header>
                <Card.Body>
                  {category.description && (
                    <Card.Text className="mb-3">{category.description}</Card.Text>
                  )}
                  
                  <div className="d-flex justify-content-between mb-3">
                    <h6>Menu Items ({category.items.length})</h6>
                    <Button 
                      variant="success" 
                      size="sm" 
                      onClick={() => openItemModal(category)}
                    >
                      Add Item
                    </Button>
                  </div>
                  
                  {category.items.length === 0 ? (
                    <p className="text-muted">No items in this category.</p>
                  ) : (
                    <div className="menu-items-container">
                      {category.items.map(item => (
                        <Card key={item.id} className="mb-2 menu-item">
                          <Card.Body className="p-3">
                            <Row>
                              {item.imageUrl && (
                                <Col xs={3} md={2}>
                                  <img 
                                    src={item.imageUrl} 
                                    alt={item.name} 
                                    className="img-fluid rounded"
                                    style={{ maxHeight: '60px', objectFit: 'cover' }}
                                  />
                                </Col>
                              )}
                              <Col xs={item.imageUrl ? 9 : 12} md={item.imageUrl ? 10 : 12}>
                                <div className="d-flex justify-content-between">
                                  <h6 className="mb-1">
                                    {item.name}
                                    {!item.available && (
                                      <Badge bg="secondary" className="ms-2">Unavailable</Badge>
                                    )}
                                  </h6>
                                  <div>
                                    {item.discountType !== 'none' && (
                                      <span className="text-decoration-line-through me-2 text-muted small">
                                        {formatPrice(item.price)}
                                      </span>
                                    )}
                                    <span className="fw-bold">
                                      {formatPrice(item.finalPrice)}
                                    </span>
                                  </div>
                                </div>
                                {item.description && (
                                  <p className="text-muted small mb-1">{item.description}</p>
                                )}
                                <div className="d-flex mt-2">
                                  <Button 
                                    variant="outline-primary" 
                                    size="sm" 
                                    className="me-2 py-0"
                                    onClick={() => openItemModal(category, item)}
                                  >
                                    Edit
                                  </Button>
                                  <Button 
                                    variant="outline-danger" 
                                    size="sm"
                                    className="py-0"
                                    onClick={() => openDeleteItemModal(category, item)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </Col>
                            </Row>
                          </Card.Body>
                        </Card>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      
      {/* Category Modal */}
      <Modal show={showCategoryModal} onHide={() => setShowCategoryModal(false)}>
        <Form onSubmit={handleCategorySubmit}>
          <Modal.Header closeButton>
            <Modal.Title>
              {currentCategory ? 'Edit Category' : 'Add New Category'}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Category Name</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="e.g., Appetizers"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({...categoryForm, name: e.target.value})}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description (optional)</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={3}
                placeholder="e.g., Start your meal with these delicious options"
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({...categoryForm, description: e.target.value})}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowCategoryModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              type="submit"
              disabled={loading || !categoryForm.name.trim()}
            >
              {loading ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Saving...
                </>
              ) : 'Save Category'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
      
      {/* Item Modal */}
      <Modal show={showItemModal} onHide={() => setShowItemModal(false)}>
        <Form onSubmit={handleItemSubmit}>
          <Modal.Header closeButton>
            <Modal.Title>
              {currentItem ? 'Edit Menu Item' : 'Add New Menu Item'}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Item Name</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="e.g., Caesar Salad"
                value={itemForm.name}
                onChange={(e) => setItemForm({...itemForm, name: e.target.value})}
                required
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description (optional)</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={2}
                placeholder="e.g., Fresh romaine lettuce with our house-made dressing"
                value={itemForm.description}
                onChange={(e) => setItemForm({...itemForm, description: e.target.value})}
              />
            </Form.Group>
            
            <Row>
              <Col xs={12} md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Price</Form.Label>
                  <InputGroup>
                    <InputGroup.Text>$</InputGroup.Text>
                    <Form.Control 
                      type="number" 
                      step="0.01" 
                      min="0"
                      placeholder="0.00"
                      value={itemForm.price}
                      onChange={(e) => setItemForm({...itemForm, price: e.target.value})}
                      required
                    />
                  </InputGroup>
                </Form.Group>
              </Col>
              
              <Col xs={12} md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Discount Type</Form.Label>
                  <Form.Select
                    value={itemForm.discountType}
                    onChange={(e) => setItemForm({...itemForm, discountType: e.target.value})}
                  >
                    <option value="none">No Discount</option>
                    <option value="percentage">Percentage Off</option>
                    <option value="amount">Amount Off</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            
            {itemForm.discountType !== 'none' && (
              <Row>
                <Col xs={12} md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>
                      {itemForm.discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
                    </Form.Label>
                    <InputGroup>
                      <Form.Control 
                        type="number" 
                        step={itemForm.discountType === 'percentage' ? "1" : "0.01"}
                        min="0"
                        max={itemForm.discountType === 'percentage' ? "100" : itemForm.price}
                        placeholder={itemForm.discountType === 'percentage' ? "10" : "5.00"}
                        value={itemForm.discountValue}
                        onChange={(e) => setItemForm({...itemForm, discountValue: e.target.value})}
                        required={itemForm.discountType !== 'none'}
                      />
                      <InputGroup.Text>
                        {itemForm.discountType === 'percentage' ? '%' : '$'}
                      </InputGroup.Text>
                    </InputGroup>
                  </Form.Group>
                </Col>
                
                <Col xs={12} md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Final Price</Form.Label>
                    <Form.Control 
                      type="text" 
                      value={calculateFinalPrice()}
                      disabled
                      className="bg-light"
                    />
                  </Form.Group>
                </Col>
              </Row>
            )}
            
            <Form.Group className="mb-3">
              <Form.Label>Item Image (optional)</Form.Label>
              <Form.Control 
                type="file" 
                accept="image/*"
                onChange={handleImageChange}
              />
              <Form.Text className="text-muted">
                Recommended size: 500x300px. Max size: 2MB.
              </Form.Text>
            </Form.Group>
            
            {imagePreview && (
              <div className="text-center mb-3">
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  className="img-thumbnail" 
                  style={{ maxHeight: '150px' }}
                />
              </div>
            )}
            
            <Form.Group className="mb-3">
              <Form.Check 
                type="checkbox"
                id="item-available"
                label="Item is available for ordering"
                checked={itemForm.available}
                onChange={(e) => setItemForm({...itemForm, available: e.target.checked})}
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowItemModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              type="submit"
              disabled={loading || !itemForm.name.trim() || !itemForm.price}
            >
              {loading ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Saving...
                </>
              ) : 'Save Item'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
      
      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>
            {categoryToDelete ? 'Delete Category' : 'Delete Menu Item'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {categoryToDelete ? (
            <>
              <p>Are you sure you want to delete the category <strong>{categoryToDelete.name}</strong>?</p>
              <Alert variant="warning">
                <strong>Warning:</strong> This will also delete all {categoryToDelete.items.length} items in this category! This action cannot be undone.
              </Alert>
            </>
          ) : (
            <>
              <p>Are you sure you want to delete the menu item <strong>{itemToDelete?.name}</strong>?</p>
              <Alert variant="warning">
                <strong>Warning:</strong> This action cannot be undone.
              </Alert>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button 
            variant="danger" 
            onClick={categoryToDelete ? handleDeleteCategory : handleDeleteItem}
            disabled={loading}
          >
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Deleting...
              </>
            ) : 'Delete'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default MenuManagement;