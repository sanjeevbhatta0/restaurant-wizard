import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Container, Card, Button, Row, Col, Nav } from 'react-bootstrap';
import '../App.css'; // Make sure your CSS file is imported

const Home = ({ user }) => {
  const [restaurantData, setRestaurantData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeComponent, setActiveComponent] = useState('dashboard');
  const history = useHistory();

  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        if (user && user.uid) {
          const docRef = doc(db, "restaurants", user.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            setRestaurantData(docSnap.data());
          } else {
            console.log("No restaurant data found!");
          }
        }
      } catch (error) {
        console.error("Error fetching restaurant data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchRestaurantData();
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      history.push('/login');
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Component content mapping
  const componentContent = {
    dashboard: (
      <Card className="text-center mb-4 bg-light">
        <Card.Body>
          <Card.Title className="display-4">
            Welcome to your restaurant dashboard!
          </Card.Title>
          {restaurantData && (
            <Card.Text className="lead mt-3">
              Managing: {restaurantData.restaurantName}
            </Card.Text>
          )}
          <Card.Text>
            Select a tool from the sidebar to get started!
          </Card.Text>
        </Card.Body>
      </Card>
    ),
    menuManagement: (
      <Card>
        <Card.Body>
          <Card.Title>Menu Management</Card.Title>
          <Card.Text className="mt-4 lead">
            🍔 Oh no! Our chef is still experimenting with the perfect recipe for this feature!
          </Card.Text>
          <Card.Text>
            Legend has it that our developer was last seen muttering "just one more line of code" 
            before disappearing into a cave of energy drinks and keyboard clicks. 
            We've sent a search party with fresh pizza, so this feature should be ready soon!
          </Card.Text>
        </Card.Body>
      </Card>
    ),
    websiteIntegration: (
      <Card>
        <Card.Body>
          <Card.Title>Website Integration</Card.Title>
          <Card.Text className="mt-4 lead">
            🌐 Website Integration is taking a coffee break!
          </Card.Text>
          <Card.Text>
            Our website integration tool is currently attending a digital yoga retreat to improve its flexibility.
            The developer promised it would return more powerful than ever, just as soon as they figure out
            why their code works on their machine but not in production. Classic developer excuse, am I right?
          </Card.Text>
        </Card.Body>
      </Card>
    ),
    seoSocial: (
      <Card>
        <Card.Body>
          <Card.Title>SEO Social Posts</Card.Title>
          <Card.Text className="mt-4 lead">
            📱 Our SEO social posts generator is currently lost in the algorithm!
          </Card.Text>
          <Card.Text>
            It was last seen trying to convince Instagram's algorithm that your restaurant's food 
            is more interesting than cat videos. We're optimistic it will return once our developer 
            stops procrastinating by scrolling through TikTok for "research purposes."
          </Card.Text>
        </Card.Body>
      </Card>
    )
  };

  if (loading) {
    return <div className="text-center mt-5"><h2>Loading...</h2></div>;
  }

  return (
    <Container fluid>
      <Row className="mt-4 mb-4">
        <Col className="d-flex justify-content-between align-items-center">
          <h1>Restaurant Portal</h1>
          <Button variant="outline-danger" onClick={handleLogout}>Logout</Button>
        </Col>
      </Row>

      <Row>
        {/* Sidebar */}
        <Col md={3} lg={2} className="mb-4">
          <Card className="sidebar">
            <Card.Header>Restaurant Tools</Card.Header>
            <Nav className="flex-column" variant="pills">
              <Nav.Item>
                <Nav.Link 
                  className={activeComponent === 'dashboard' ? 'active' : ''} 
                  onClick={() => setActiveComponent('dashboard')}
                >
                  Dashboard
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  className={activeComponent === 'menuManagement' ? 'active' : ''} 
                  onClick={() => setActiveComponent('menuManagement')}
                >
                  Menu Management
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  className={activeComponent === 'websiteIntegration' ? 'active' : ''} 
                  onClick={() => setActiveComponent('websiteIntegration')}
                >
                  Website Integration
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  className={activeComponent === 'seoSocial' ? 'active' : ''} 
                  onClick={() => setActiveComponent('seoSocial')}
                >
                  SEO Social Posts
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </Card>
        </Col>

        {/* Main Content */}
        <Col md={9} lg={10}>
          {componentContent[activeComponent]}
        </Col>
      </Row>
    </Container>
  );
};

export default Home;