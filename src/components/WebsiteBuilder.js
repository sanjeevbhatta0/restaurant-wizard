import React, { useState, useEffect } from 'react';
import { Container, Tabs, Tab, Form, Button, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { updateWebsiteData } from '../services/websiteService';

export default function WebsiteBuilder() {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [websiteData, setWebsiteData] = useState({
    home: {
      title: '',
      subtitle: '',
      content: '',
      heroImage: ''
    },
    contact: {
      phone: '',
      email: '',
      address: '',
      hours: {
        monday: { open: '11:00', close: '22:00' },
        tuesday: { open: '11:00', close: '22:00' },
        wednesday: { open: '11:00', close: '22:00' },
        thursday: { open: '11:00', close: '22:00' },
        friday: { open: '11:00', close: '23:00' },
        saturday: { open: '12:00', close: '23:00' },
        sunday: { open: '12:00', close: '21:00' }
      },
      socialMedia: {
        facebook: '',
        instagram: '',
        twitter: ''
      }
    },
    theme: {
      primaryColor: '#2c3e50',
      secondaryColor: '#3498db',
      fontFamily: 'Poppins',
      logo: ''
    }
  });

  // Load website data
  useEffect(() => {
    const loadWebsiteData = async () => {
      try {
        const websiteDoc = await getDoc(doc(db, `restaurants/${currentUser.uid}/website/data`));
        if (websiteDoc.exists()) {
          setWebsiteData(prevData => ({
            ...prevData,
            ...websiteDoc.data()
          }));
        }
      } catch (error) {
        console.error('Error loading website data:', error);
        setError('Failed to load website data');
      }
    };

    if (currentUser) {
      loadWebsiteData();
    }
  }, [currentUser]);

  // Save website data
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const websiteUrl = await updateWebsiteData(currentUser.uid, websiteData);
      setSuccess(`Changes saved successfully! View your website at ${websiteUrl}`);
    } catch (error) {
      console.error('Error saving website data:', error);
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Update website data
  const handleChange = (section, field, value) => {
    setWebsiteData(prevData => ({
      ...prevData,
      [section]: {
        ...prevData[section],
        [field]: value
      }
    }));
  };

  return (
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>Website Builder</h1>
        <div>
          <Button 
            variant="primary" 
            onClick={handleSave} 
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button 
            variant="outline-primary" 
            className="ms-2"
            href={`https://${currentUser.uid}.restaurant-portal-6b147.web.app`}
            target="_blank"
          >
            View Website
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

      <Tabs
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k)}
        className="mb-4"
      >
        <Tab eventKey="home" title="Home">
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Page Title</Form.Label>
              <Form.Control
                type="text"
                value={websiteData.home.title}
                onChange={(e) => handleChange('home', 'title', e.target.value)}
                placeholder="Enter your restaurant name"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Subtitle</Form.Label>
              <Form.Control
                type="text"
                value={websiteData.home.subtitle}
                onChange={(e) => handleChange('home', 'subtitle', e.target.value)}
                placeholder="Enter a catchy subtitle"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Content</Form.Label>
              <ReactQuill
                value={websiteData.home.content}
                onChange={(content) => handleChange('home', 'content', content)}
                placeholder="Tell your restaurant's story..."
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Hero Image URL</Form.Label>
              <Form.Control
                type="text"
                value={websiteData.home.heroImage}
                onChange={(e) => handleChange('home', 'heroImage', e.target.value)}
                placeholder="Enter the URL of your hero image"
              />
            </Form.Group>
          </Form>
        </Tab>

        <Tab eventKey="menu" title="Menu">
          <div className="p-4 bg-light rounded">
            <h3>Menu Configuration</h3>
            <p>Your menu is automatically synchronized with your Menu Management section.</p>
            <p>Any changes you make in Menu Management will be reflected on your website immediately.</p>
          </div>
        </Tab>

        <Tab eventKey="contact" title="Contact">
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Phone Number</Form.Label>
              <Form.Control
                type="tel"
                value={websiteData.contact.phone}
                onChange={(e) => handleChange('contact', 'phone', e.target.value)}
                placeholder="Enter your phone number"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control
                type="email"
                value={websiteData.contact.email}
                onChange={(e) => handleChange('contact', 'email', e.target.value)}
                placeholder="Enter your email address"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Address</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={websiteData.contact.address}
                onChange={(e) => handleChange('contact', 'address', e.target.value)}
                placeholder="Enter your restaurant's address"
              />
            </Form.Group>

            <h4 className="mt-4">Business Hours</h4>
            {Object.entries(websiteData.contact.hours).map(([day, hours]) => (
              <div key={day} className="d-flex gap-3 mb-2">
                <div style={{width: '100px'}}>{day.charAt(0).toUpperCase() + day.slice(1)}</div>
                <Form.Control
                  type="time"
                  value={hours.open}
                  onChange={(e) => handleChange('contact', 'hours', {
                    ...websiteData.contact.hours,
                    [day]: { ...hours, open: e.target.value }
                  })}
                />
                <Form.Control
                  type="time"
                  value={hours.close}
                  onChange={(e) => handleChange('contact', 'hours', {
                    ...websiteData.contact.hours,
                    [day]: { ...hours, close: e.target.value }
                  })}
                />
              </div>
            ))}

            <h4 className="mt-4">Social Media</h4>
            <Form.Group className="mb-3">
              <Form.Label>Facebook URL</Form.Label>
              <Form.Control
                type="url"
                value={websiteData.contact.socialMedia.facebook}
                onChange={(e) => handleChange('contact', 'socialMedia', {
                  ...websiteData.contact.socialMedia,
                  facebook: e.target.value
                })}
                placeholder="Enter your Facebook page URL"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Instagram URL</Form.Label>
              <Form.Control
                type="url"
                value={websiteData.contact.socialMedia.instagram}
                onChange={(e) => handleChange('contact', 'socialMedia', {
                  ...websiteData.contact.socialMedia,
                  instagram: e.target.value
                })}
                placeholder="Enter your Instagram profile URL"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Twitter URL</Form.Label>
              <Form.Control
                type="url"
                value={websiteData.contact.socialMedia.twitter}
                onChange={(e) => handleChange('contact', 'socialMedia', {
                  ...websiteData.contact.socialMedia,
                  twitter: e.target.value
                })}
                placeholder="Enter your Twitter profile URL"
              />
            </Form.Group>
          </Form>
        </Tab>

        <Tab eventKey="order" title="Order Online">
          <div className="p-4 bg-light rounded">
            <h3>Online Ordering</h3>
            <p>The online ordering system is automatically integrated with your website.</p>
            <p>Customers will be able to browse your menu, add items to cart, and place orders directly through your website.</p>
          </div>
        </Tab>

        <Tab eventKey="theme" title="Theme">
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Primary Color</Form.Label>
              <Form.Control
                type="color"
                value={websiteData.theme.primaryColor}
                onChange={(e) => handleChange('theme', 'primaryColor', e.target.value)}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Secondary Color</Form.Label>
              <Form.Control
                type="color"
                value={websiteData.theme.secondaryColor}
                onChange={(e) => handleChange('theme', 'secondaryColor', e.target.value)}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Font Family</Form.Label>
              <Form.Select
                value={websiteData.theme.fontFamily}
                onChange={(e) => handleChange('theme', 'fontFamily', e.target.value)}
              >
                <option value="Poppins">Poppins</option>
                <option value="Roboto">Roboto</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Lato">Lato</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Logo URL</Form.Label>
              <Form.Control
                type="text"
                value={websiteData.theme.logo}
                onChange={(e) => handleChange('theme', 'logo', e.target.value)}
                placeholder="Enter the URL of your logo"
              />
            </Form.Group>
          </Form>
        </Tab>
      </Tabs>
    </Container>
  );
} 