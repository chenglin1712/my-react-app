// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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
let app;
let auth;
let db;
let firebaseInitError = null;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (error) {
    firebaseInitError = error;
    console.error("Firebase 初始化失敗：", error?.code || error?.message);
}

// Storage 只有發音遊戲上傳錄音會用，SDK 改成用到才下載，不放進入口 chunk（審查項 P2-102）
const getStorageInstance = async () => {
    const { getStorage } = await import("firebase/storage");
    return getStorage(app);
};

export { auth, db, getStorageInstance, firebaseInitError };