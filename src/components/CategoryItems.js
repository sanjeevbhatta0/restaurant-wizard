import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot,
  doc,
  addDoc,
  deleteDoc,
  getDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Container, Card, Button, Form, Alert, Spinner, Modal } from 'react-bootstrap';

const CategoryItems = () => {
  const { categoryId } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [category, setCategory] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Modal states
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    image: null,
    imageUrl: ''
  });
  const [imagePreview, setImagePreview] = useState(null);

  useEffect(() => {
    if (!currentUser || !categoryId) return;

    // Fetch category details
    const fetchCategory = async () => {
      try {
        const categoryRef = doc(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}`);
        const categorySnap = await getDoc(categoryRef);
        
        if (categorySnap.exists()) {
          setCategory({ id: categorySnap.id, ...categorySnap.data() });
        } else {
          setError('Category not found');
          navigate('/menu-management');
          return;
        }
      } catch (error) {
        console.error('Error fetching category:', error);
        setError('Failed to fetch category details');
      }
    };

    // Fetch items
    const itemsRef = collection(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items`);
    const q = query(itemsRef, orderBy('name'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setItems(itemsData);
      setLoading(false);
    });

    fetchCategory();
    return () => unsubscribe();
  }, [currentUser, categoryId, navigate]);

  const handleAddItem = () => {
    setItemForm({
      name: '',
      description: '',
      price: '',
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

    try {
      setLoading(true);
      let imageUrl = '';
      let imageStoragePath = '';

      if (itemForm.image) {
        const fileName = `${Date.now()}-${itemForm.image.name}`;
        imageStoragePath = `restaurants/${currentUser.uid}/menuItems/${categoryId}/${fileName}`;
        const storageRef = ref(storage, imageStoragePath);
        await uploadBytes(storageRef, itemForm.image);
        imageUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, `restaurants/${currentUser.uid}/menuCategories/${categoryId}/items`), {
        name: itemForm.name,
        description: itemForm.description,
        price: parseFloat(itemForm.price),
        imageUrl,
        imageStoragePath,
        createdAt: new Date()
      });

      setSuccess('Item added successfully');
      setShowItemModal(false);
    } catch (error) {
      setError('Failed to add item: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (itemId, imageStoragePath) => {
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
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>{category?.name} Items</h2>
        <Button variant="secondary" onClick={() => navigate('/menu-management')}>
          Back to Categories
        </Button>
      </div>

      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}

      <Button variant="primary" className="mb-4" onClick={handleAddItem}>
        Add New Item
      </Button>

      {items.map(item => (
        <Card key={item.id} className="mb-3 item-card">
          <Card.Body>
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h5>{item.name}</h5>
                <p className="text-muted mb-1">{item.description}</p>
                <p className="mb-0">${item.price.toFixed(2)}</p>
              </div>
              <div className="d-flex">
                {item.imageUrl && (
                  <img 
                    src={item.imageUrl} 
                    alt={item.name} 
                    style={{ width: '50px', height: '50px', objectFit: 'cover', marginRight: '10px' }}
                  />
                )}
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => handleDeleteItem(item.id, item.imageStoragePath)}
                >
                  Delete
                </Button>
              </div>
            </div>
          </Card.Body>
        </Card>
      ))}

      {items.length === 0 && (
        <Card className="text-center">
          <Card.Body>
            <Card.Text>No items in this category yet. Add your first item!</Card.Text>
          </Card.Body>
        </Card>
      )}

      <Modal show={showItemModal} onHide={() => setShowItemModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Add New Item</Modal.Title>
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

export default CategoryItems; 