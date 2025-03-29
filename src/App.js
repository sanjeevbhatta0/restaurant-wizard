import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Switch, Route, Redirect } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

// Import components
import Login from './components/Login';
import Signup from './components/Signup';
import Home from './components/Home';
import MenuManagement from './components/MenuManagement';
import SeoSocialPosts from './components/SeoSocialPosts';
import Navigation from './components/Navigation';
import PrivacyPolicy from './components/PrivacyPolicy';
import AppIcon from './components/AppIcon';
import DataDeletion from './components/DataDeletion';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Protected route component
  const PrivateRoute = ({ component: Component, ...rest }) => (
    <Route
      {...rest}
      render={(props) => 
        loading ? (
          <div className="text-center mt-5"><h2>Loading...</h2></div>
        ) : currentUser ? (
          <Component {...props} user={currentUser} />
        ) : (
          <Redirect to="/login" />
        )
      }
    />
  );

  return (
    <Router>
      <div className="container mt-3">
        {currentUser && <Navigation />}
        <Switch>
          <Route 
            exact path="/login" 
            render={(props) => 
              currentUser ? <Redirect to="/home" /> : <Login {...props} />
            } 
          />
          <Route 
            exact path="/signup" 
            render={(props) => 
              currentUser ? <Redirect to="/home" /> : <Signup {...props} />
            } 
          />
          <Route exact path="/privacy-policy" component={PrivacyPolicy} />
          <Route exact path="/app-icon" component={AppIcon} />
          <Route exact path="/data-deletion" component={DataDeletion} />
          <PrivateRoute exact path="/home" component={Home} />
          <PrivateRoute exact path="/menu-management" component={MenuManagement} />
          <PrivateRoute exact path="/seo-social-posts" component={SeoSocialPosts} />
          <Route exact path="/">
            <Redirect to="/login" />
          </Route>
        </Switch>
      </div>
    </Router>
  );
}

export default App;