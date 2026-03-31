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

const firebaseConfig = {
  apiKey: "AIzaSyACOWtwR1QMedvnzMxzlh4JZU2buNl-vO0",
  authDomain: "restaurant-portal-6b147.firebaseapp.com",
  projectId: "restaurant-portal-6b147",
  storageBucket: "restaurant-portal-6b147.firebasestorage.app",
  messagingSenderId: "767096499289",
  appId: "1:767096499289:web:00be3ea1e69fe0ea709548",
  measurementId: "G-Y6SJVWSKHM"
};

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
