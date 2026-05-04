/* STH Site App — Firebase initialisation
   Shared across all modules. Uses the same Firebase project as the
   existing Cartage PWA, so the `jobs` collection is shared.
   ============================================================
   ⚠️  REPLACE THE CONFIG BELOW with your real Firebase config
   from the existing Cartage PWA (Firebase console → Project
   settings → Your apps → Web app → Config).
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ⚠️ PASTE YOUR EXISTING CARTAGE FIREBASE CONFIG HERE
const firebaseConfig = {
  const firebaseConfig = {
  apiKey: "AIzaSyDmUGL8Tyfy74OMjgaBZlFK-PTFG3AYYK0",
  authDomain: "sth-cartage.firebaseapp.com",
  projectId: "sth-cartage",
  storageBucket: "sth-cartage.firebasestorage.app",
  messagingSenderId: "613314698438",
  appId: "1:613314698438:web:6acb8a91215b5a8efe0bc7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Enable offline persistence — critical for site use in basements
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence: multiple tabs open, persistence only enabled in one');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence: browser does not support offline persistence');
  }
});

export {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
};
