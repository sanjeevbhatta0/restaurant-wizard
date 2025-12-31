import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LocationProvider } from './contexts/LocationContext';
import Login from './components/Login';
import Signup from './components/Signup';
import Home from './components/Home';
import Dashboard from './components/Dashboard';
import Account from './components/Account';
import MenuManagement from './components/MenuManagement';
import CategoryItems from './components/CategoryItems';
import Orders from './components/Orders';
import POS from './components/POS';
import Kitchen from './components/Kitchen';
import Server from './components/Server';
import TableLayout from './components/TableLayout';
import Payments from './components/Payments';
import SeoSocialPosts from './components/SeoSocialPosts';
import WebsiteIntegration from './components/WebsiteIntegration';
import WebsiteBuilder from './components/WebsiteBuilder';
import PrivacyPolicy from './components/PrivacyPolicy';
import Layout from './components/Layout';
import PrivateRoute from './components/PrivateRoute';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <LocationProvider>
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
            <Route path="analytics" element={
              <PrivateRoute>
                <Dashboard />
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
            <Route path="pos" element={
              <PrivateRoute>
                <POS />
              </PrivateRoute>
            } />
            <Route path="kitchen" element={
              <PrivateRoute>
                <Kitchen />
              </PrivateRoute>
            } />
            <Route path="server" element={
              <PrivateRoute>
                <Server />
              </PrivateRoute>
            } />
            <Route path="table-layout" element={
              <PrivateRoute>
                <TableLayout />
              </PrivateRoute>
            } />
            <Route path="payments" element={
              <PrivateRoute>
                <Payments />
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
            <Route path="website-builder" element={
              <PrivateRoute>
                <WebsiteBuilder />
              </PrivateRoute>
            } />
            <Route path="account" element={
              <PrivateRoute>
                <Account />
              </PrivateRoute>
            } />
          </Route>
        </Routes>
      </Router>
      </LocationProvider>
    </AuthProvider>
  );
}

export default App;