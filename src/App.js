import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LocationProvider } from './contexts/LocationContext';
import { MenuProvider } from './contexts/MenuContext';
import { SubscriptionProvider } from './contexts/SubscriptionContext';
import { AdminProvider } from './contexts/AdminContext';
import { OnboardingProvider } from './contexts/OnboardingContext';
import Login from './components/Login';
import Signup from './components/Signup';
import Home from './components/Home';
import Dashboard from './components/Dashboard';
import Account from './components/Account';
import MenuManagement from './components/MenuManagement';
import CategoryItems from './components/CategoryItems';
import Orders from './components/Orders';
import PromotionsRewards from './components/PromotionsRewards';
import POS from './components/POS';
import Kitchen from './components/Kitchen';
import Server from './components/Server';
import TableLayout from './components/TableLayout';
import Payments from './components/Payments';
import SeoSocialPosts from './components/SeoSocialPosts';
import WebsiteIntegration from './components/WebsiteIntegration';
import WebsiteBuilder from './components/WebsiteBuilder';
import ReviewManagement from './components/ReviewManagement';
import MobileApp from './components/MobileApp';
import CustomerDisplay from './components/CustomerDisplay';
import PrivacyPolicy from './components/PrivacyPolicy';
import SmsTerms from './components/SmsTerms';
import LandingPage from './components/landing/LandingPage';
import NotFound from './components/NotFound';
import ErrorBoundary from './components/ErrorBoundary';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminLogin from './components/admin/AdminLogin';
import Layout from './components/Layout';
import PrivateRoute from './components/PrivateRoute';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <SubscriptionProvider>
        <LocationProvider>
          <MenuProvider>
            <OnboardingProvider>
            <Router>
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/sms-terms" element={<SmsTerms />} />

                {/* Admin Routes */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/*" element={
                  <AdminProvider>
                    <AdminDashboard />
                  </AdminProvider>
                } />

                {/* Protected App Routes */}
                <Route path="/home" element={
                  <PrivateRoute>
                    <Layout><Home /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/analytics" element={
                  <PrivateRoute>
                    <Layout><Dashboard /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/menu-management" element={
                  <PrivateRoute>
                    <Layout><MenuManagement /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/menu-management/category/:categoryId" element={
                  <PrivateRoute>
                    <Layout><CategoryItems /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/orders" element={
                  <PrivateRoute>
                    <Layout><Orders /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/promotions" element={
                  <PrivateRoute>
                    <Layout><PromotionsRewards /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/pos" element={
                  <PrivateRoute>
                    <Layout><POS /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/kitchen" element={
                  <PrivateRoute>
                    <Layout><Kitchen /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/server" element={
                  <PrivateRoute>
                    <Layout><Server /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/table-layout" element={
                  <PrivateRoute>
                    <Layout><TableLayout /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/payments" element={
                  <PrivateRoute>
                    <Layout><Payments /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/customer-display" element={
                  <PrivateRoute>
                    <Layout><CustomerDisplay /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/seo-social" element={
                  <PrivateRoute>
                    <Layout><SeoSocialPosts /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/website-integration" element={
                  <PrivateRoute>
                    <Layout><WebsiteIntegration /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/website-builder" element={
                  <PrivateRoute>
                    <Layout><WebsiteBuilder /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/reviews" element={
                  <PrivateRoute>
                    <Layout><ReviewManagement /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/mobile-app" element={
                  <PrivateRoute>
                    <Layout><MobileApp /></Layout>
                  </PrivateRoute>
                } />
                <Route path="/account" element={
                  <PrivateRoute>
                    <Layout><Account /></Layout>
                  </PrivateRoute>
                } />

                {/* 404 Catch-All */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Router>
            </OnboardingProvider>
          </MenuProvider>
        </LocationProvider>
      </SubscriptionProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;