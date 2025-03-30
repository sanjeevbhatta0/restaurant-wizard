import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Container, Card, Row, Col } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';

const Home = () => {
  const [restaurantData, setRestaurantData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        if (currentUser?.uid) {
          const docRef = doc(db, "restaurants", currentUser.uid);
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
  }, [currentUser]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Container>
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

      <Row className="mt-4">
        <Col md={4} className="mb-3">
          <Card className="h-100">
            <Card.Body className="d-flex flex-column">
              <Card.Title>Menu Management</Card.Title>
              <Card.Text>
                Create and organize your restaurant menu with categories, items, and pricing.
              </Card.Text>
              <Link to="/menu-management" className="btn btn-primary mt-auto">
                Manage Menu
              </Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} className="mb-3">
          <Card className="h-100">
            <Card.Body className="d-flex flex-column">
              <Card.Title>Orders</Card.Title>
              <Card.Text>
                View and manage customer orders for your restaurant.
              </Card.Text>
              <Link to="/orders" className="btn btn-primary mt-auto">
                View Orders
              </Link>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} className="mb-3">
          <Card className="h-100">
            <Card.Body className="d-flex flex-column">
              <Card.Title>Website Integration</Card.Title>
              <Card.Text>
                Get the code to add your menu to your website.
              </Card.Text>
              <Link to="/website-integration" className="btn btn-primary mt-auto">
                Get Code
              </Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default Home;