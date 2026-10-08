// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
// 設定缺漏（例如沒有帶到 VITE_FIREBASE_* 環境變數）時，getAuth 會在模組載入的當下直接丟出例外，
// 發生在 React 掛載之前，整頁只會是白屏。這裡接住並記下原因，main.jsx 看到 firebaseInitError
// 就改顯示靜態的啟動失敗畫面（不顯示設定內容）。
let auth;
let db;
let storage;
let firebaseInitError = null;
try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
} catch (error) {
    firebaseInitError = error;
    console.error("Firebase 初始化失敗：", error?.code || error?.message);
}

export { auth, db, storage, firebaseInitError };