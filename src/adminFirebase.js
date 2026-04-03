/**
 * Separate Firebase app instance for the Admin Portal.
 *
 * Uses the same Firebase project but maintains an independent auth session,
 * so logging into the admin portal doesn't overwrite the restaurant user's session.
 */
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { connectFunctionsEmulator } from "firebase/functions";

const devConfig = {
  apiKey: "AIzaSyACOWtwR1QMedvnzMxzlh4JZU2buNl-vO0",
  authDomain: "restaurant-portal-6b147.firebaseapp.com",
  projectId: "restaurant-portal-6b147",
  storageBucket: "restaurant-portal-6b147.firebasestorage.app",
  messagingSenderId: "767096499289",
  appId: "1:767096499289:web:00be3ea1e69fe0ea709548",
  measurementId: "G-Y6SJVWSKHM"
};

const prodConfig = {
  apiKey: "AIzaSyCl8JplSR6gFxOYz57skUrWUgNVN-gt3X8",
  authDomain: "kodacarte-861d8.firebaseapp.com",
  projectId: "kodacarte-861d8",
  storageBucket: "kodacarte-861d8.firebasestorage.app",
  messagingSenderId: "81130683572",
  appId: "1:81130683572:web:fd4a8363508377b8586be1",
  measurementId: "G-3V3K9W8XWE"
};

const firebaseConfig = process.env.REACT_APP_FIREBASE_ENV === 'production' ? prodConfig : devConfig;

// Named instance — keeps auth state separate from the main app
const adminApp = initializeApp(firebaseConfig, 'admin');

const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);
const adminFunctions = getFunctions(adminApp);

// Connect to emulators in development
if (process.env.REACT_APP_USE_EMULATOR === 'true') {
  connectAuthEmulator(adminAuth, `http://${process.env.REACT_APP_EMULATOR_HOST}:${process.env.REACT_APP_AUTH_EMULATOR_PORT}`);
  connectFirestoreEmulator(adminDb, process.env.REACT_APP_EMULATOR_HOST, parseInt(process.env.REACT_APP_FIRESTORE_EMULATOR_PORT));
  connectFunctionsEmulator(adminFunctions, process.env.REACT_APP_EMULATOR_HOST, parseInt(process.env.REACT_APP_FUNCTIONS_EMULATOR_PORT));
}

export { adminAuth, adminDb, adminFunctions };
export default adminApp;
