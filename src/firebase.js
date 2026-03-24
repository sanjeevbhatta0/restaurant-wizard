// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, enableMultiTabIndexedDbPersistence } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyACOWtwR1QMedvnzMxzlh4JZU2buNl-vO0",
  authDomain: "restaurant-portal-6b147.firebaseapp.com",
  projectId: "restaurant-portal-6b147",
  storageBucket: "restaurant-portal-6b147.appspot.com",
  messagingSenderId: "767096499289",
  appId: "1:767096499289:web:00be3ea1e69fe0ea709548",
  measurementId: "G-Y6SJVWSKHM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// Enable offline persistence for Firestore
// Data is cached in IndexedDB and writes are queued when offline
enableMultiTabIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence failed: multiple tabs open with different settings');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence not available in this browser');
  }
});

// Connect to emulators in development
if (process.env.REACT_APP_USE_EMULATOR === 'true') {
  connectAuthEmulator(auth, `http://${process.env.REACT_APP_EMULATOR_HOST}:${process.env.REACT_APP_AUTH_EMULATOR_PORT}`);
  connectFirestoreEmulator(db, process.env.REACT_APP_EMULATOR_HOST, parseInt(process.env.REACT_APP_FIRESTORE_EMULATOR_PORT));
  connectStorageEmulator(storage, process.env.REACT_APP_EMULATOR_HOST, parseInt(process.env.REACT_APP_STORAGE_EMULATOR_PORT));
  connectFunctionsEmulator(functions, process.env.REACT_APP_EMULATOR_HOST, parseInt(process.env.REACT_APP_FUNCTIONS_EMULATOR_PORT));
}

export { auth, db, storage, functions };
export default app;