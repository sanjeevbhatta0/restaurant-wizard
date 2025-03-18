// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
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

export { auth, db, storage };
export default app;