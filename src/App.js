import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Login from './components/Login';
import Signup from './components/Signup';
import Home from './components/Home';
import MenuManagement from './components/MenuManagement';
import CategoryItems from './components/CategoryItems';
import Orders from './components/Orders';
import SeoSocialPosts from './components/SeoSocialPosts';
import WebsiteIntegration from './components/WebsiteIntegration';
import PrivacyPolicy from './components/PrivacyPolicy';
import Layout from './components/Layout';
import PrivateRoute from './components/PrivateRoute';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="home" element={
              <PrivateRoute>
                <Home />
              </PrivateRoute>
            } />
            <Route path="menu-management" element={
              <PrivateRoute>
                <MenuManagement />
              </PrivateRoute>
            } />
            <Route path="menu-management/category/:categoryId" element={
              <PrivateRoute>
                <CategoryItems />
              </PrivateRoute>
            } />
            <Route path="orders" element={
              <PrivateRoute>
                <Orders />
              </PrivateRoute>
            } />
            <Route path="seo-social" element={
              <PrivateRoute>
                <SeoSocialPosts />
              </PrivateRoute>
            } />
            <Route path="website-integration" element={
              <PrivateRoute>
                <WebsiteIntegration />
              </PrivateRoute>
            } />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;