import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Container, Row, Col, Card, Button, Form, Alert, Spinner, Modal } from 'react-bootstrap';

const MenuManagement = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Modal states
  const [showItemModal, setShowItemModal] = useState(false);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    discount: '',
    discountType: 'amount', // 'amount' or 'percentage'
    image: null,
    imageUrl: ''
  });
  const [editMode, setEditMode] = useState({
    type: null, // 'category' or 'item'
    id: null
  });
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
          ...itemDoc.data()
        }));
        
        categoriesData.push(category);
      }
      
      setCategories(categoriesData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleAddCategory = async (e) => {
    e.preventDefault();
    const name = e.target.categoryName.value;
    if (!name.trim()) return;

    try {
      const categoryRef = doc(collection(db, `restaurants/${currentUser.uid}/menuCategories`));
      await setDoc(categoryRef, {
        name,
        createdAt: new Date()
      });
      setSuccess('Category added successfully');
      e.target.reset();
    } catch (error) {
      setError('Failed to add category: ' + error.message);
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (!window.confirm('Are you sure you want to delete this category and all its items?')) return;

    try {
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
      setLoading(true);
      let imageUrl = '';
      let imageStoragePath = '';

      if (itemForm.image) {
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
        createdAt: new Date()
      };

      await addDoc(collection(db, `restaurants/${currentUser.uid}/menuCategories/${currentCategory.id}/items`), itemData);

      setSuccess('Item added successfully');
      setShowItemModal(false);
      
      // Refresh the items for this category
      const itemsRef = collection(db, `restaurants/${currentUser.uid}/menuCategories/${currentCategory.id}/items`);
      const itemsQuery = query(itemsRef, orderBy('name'));
      const itemsSnapshot = await getDocs(itemsQuery);
      
      const updatedCategories = categories.map(cat => {
        if (cat.id === currentCategory.id) {
          return {
            ...cat,
            items: itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          };
        }
        return cat;
      });
      
      setCategories(updatedCategories);
    } catch (error) {
      setError('Failed to add item: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (categoryId, itemId, imageStoragePath) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    try {
      if (imageStoragePath) {
        const imageRef = ref(storage, imageStoragePath);
        await deleteObject(imageRef);
      }
      
      await deleteDoc(doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items/${itemId}`));
      setSuccess('Item deleted successfully');
    } catch (error) {
      setError('Failed to delete item: ' + error.message);
    }
  };

  const handleEditCategory = async (categoryId, newName) => {
    try {
      const categoryRef = doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}`);
      await updateDoc(categoryRef, {
        name: newName,
        updatedAt: new Date()
      });
      setSuccess('Category updated successfully');
    } catch (error) {
      setError('Failed to update category: ' + error.message);
    }
  };

  const handleEditItem = async (categoryId, itemId, formData) => {
    try {
      const itemRef = doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items/${itemId}`);
      
      // Get the current item data first
      const itemsRef = collection(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items`);
      const itemsQuery = query(itemsRef);
      const itemsSnapshot = await getDocs(itemsQuery);
      const currentItem = itemsSnapshot.docs.find(doc => doc.id === itemId)?.data() || {};

      // Prepare update data, preserving existing fields
      const updateData = {
        name: formData.name,
        description: formData.description || '',
        price: parseFloat(formData.price) || 0,
        discount: parseFloat(formData.discount) || 0,
        discountType: formData.discountType || 'amount',
        imageUrl: currentItem.imageUrl || '',
        imageStoragePath: currentItem.imageStoragePath || '',
        updatedAt: new Date()
      };

      await updateDoc(itemRef, updateData);

      // Update the local state to reflect changes immediately
      setCategories(prevCategories => 
        prevCategories.map(category => {
          if (category.id === categoryId) {
            return {
              ...category,
              items: category.items.map(item => 
                item.id === itemId 
                  ? { ...item, ...updateData }
                  : item
              )
            };
          }
          return category;
        })
      );

      setSuccess('Item updated successfully');
    } catch (error) {
      setError('Failed to update item: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  return (
    <Container className="menu-container">
      <h2 className="mb-4">Menu Management</h2>
      
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>Add New Category</Card.Title>
          <Form onSubmit={handleAddCategory}>
            <Form.Group className="mb-3">
              <Form.Control
                type="text"
                name="categoryName"
                placeholder="Enter category name"
                required
              />
            </Form.Group>
            <Button type="submit">Add Category</Button>
          </Form>
        </Card.Body>
      </Card>

      <Row>
        {categories.map(category => (
          <Col key={category.id} xs={12} className="mb-4">
            <Card className="category-card">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  {editMode.type === 'category' && editMode.id === category.id ? (
                    <Form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleEditCategory(category.id, e.target.categoryName.value);
                        setEditMode({ type: null, id: null });
                      }}
                      className="d-flex gap-2 align-items-center"
                    >
                      <Form.Control
                        type="text"
                        name="categoryName"
                        defaultValue={category.name}
                        required
                      />
                      <Button type="submit" size="sm">Save</Button>
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => setEditMode({ type: null, id: null })}
                      >
                        Cancel
                      </Button>
                    </Form>
                  ) : (
                    <>
                      <Card.Title>{category.name}</Card.Title>
                      <div>
                        <Button 
                          variant="outline-primary"
                          size="sm"
                          className="me-2"
                          onClick={() => setEditMode({ type: 'category', id: category.id })}
                        >
                          Edit
                        </Button>
                        <Button 
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteCategory(category.id)}
                        >
                          Delete Category
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                
                <Button 
                  variant="primary" 
                  className="mb-3"
                  onClick={() => handleAddItem(category)}
                >
                  Add Item
                </Button>

                {category.items && category.items.map(item => (
                  <Card key={item.id} className="mb-2 item-card">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start">
                        {editMode.type === 'item' && editMode.id === item.id ? (
                          <Form 
                            className="w-100"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const formData = {
                                name: e.target.itemName.value,
                                description: e.target.itemDescription.value,
                                price: parseFloat(e.target.itemPrice.value),
                                discount: parseFloat(e.target.itemDiscount.value) || 0,
                                discountType: e.target.discountType.value,
                                imageUrl: item.imageUrl,
                                imageStoragePath: item.imageStoragePath
                              };
                              handleEditItem(category.id, item.id, formData);
                              setEditMode({ type: null, id: null });
                            }}
                          >
                            <div className="mb-2">
                              <Form.Control
                                type="text"
                                name="itemName"
                                defaultValue={item.name}
                                placeholder="Item name"
                                required
                              />
                            </div>
                            <div className="mb-2">
                              <Form.Control
                                as="textarea"
                                name="itemDescription"
                                defaultValue={item.description}
                                placeholder="Description"
                                rows={2}
                              />
                            </div>
                            <div className="mb-2">
                              <Form.Control
                                type="number"
                                name="itemPrice"
                                defaultValue={item.price}
                                placeholder="Price"
                                step="0.01"
                                required
                              />
                            </div>
                            <div className="mb-2 d-flex gap-2">
                              <Form.Control
                                type="number"
                                name="itemDiscount"
                                defaultValue={item.discount}
                                placeholder="Discount"
                                step="0.01"
                              />
                              <Form.Select 
                                name="discountType"
                                defaultValue={item.discountType || 'amount'}
                                style={{ width: '150px' }}
                              >
                                <option value="amount">Amount ($)</option>
                                <option value="percentage">Percentage (%)</option>
                              </Form.Select>
                            </div>
                            <div className="d-flex gap-2 justify-content-end">
                              <Button type="submit" size="sm">Save</Button>
                              <Button 
                                variant="secondary" 
                                size="sm"
                                onClick={() => setEditMode({ type: null, id: null })}
                              >
                                Cancel
                              </Button>
                            </div>
                          </Form>
                        ) : (
                          <>
                            <div>
                              <h5>{item.name}</h5>
                              <p className="text-muted mb-1">{item.description}</p>
                              <p className="mb-0">
                                ${item.price.toFixed(2)}
                                {item.discount > 0 && (
                                  <span className="text-danger ms-2">
                                    {item.discountType === 'percentage' 
                                      ? `${item.discount}% off`
                                      : `$${item.discount.toFixed(2)} off`
                                    }
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="d-flex">
                              {item.imageUrl && (
                                <img 
                                  src={item.imageUrl} 
                                  alt={item.name} 
                                  style={{ width: '50px', height: '50px', objectFit: 'cover', marginRight: '10px' }}
                                />
                              )}
                              <div className="d-flex flex-column gap-2">
                                <Button
                                  variant="outline-primary"
                                  size="sm"
                                  onClick={() => setEditMode({ type: 'item', id: item.id })}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={() => handleDeleteItem(category.id, item.id, item.imageStoragePath)}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </Card.Body>
                  </Card>
                ))}

                {(!category.items || category.items.length === 0) && (
                  <Card.Text className="text-muted">No items in this category</Card.Text>
                )}
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      {categories.length === 0 && (
        <Card className="text-center">
          <Card.Body>
            <Card.Text>No categories yet. Add your first category above!</Card.Text>
          </Card.Body>
        </Card>
      )}

      <Modal show={showItemModal} onHide={() => setShowItemModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add New Item to {currentCategory?.name}</Modal.Title>
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

            <Row className="mb-3">
              <Col>
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
              </Col>
              <Col>
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
              </Col>
            </Row>

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
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              </div>
            )}

            <div className="d-flex justify-content-end">
              <Button variant="secondary" className="me-2" onClick={() => setShowItemModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Adding...' : 'Add Item'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default MenuManagement;