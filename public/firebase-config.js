// Firebase 설정 (캘린더 프로젝트와 동일한 Firebase 프로젝트 사용)
const firebaseConfig = {
  apiKey: "AIzaSyDI5VxCwhP6RVtFcdvUBJnfpMvRiP7A0us",
  authDomain: "calendar-6df01.firebaseapp.com",
  databaseURL: "https://calendar-6df01-default-rtdb.firebaseio.com",
  projectId: "calendar-6df01",
  storageBucket: "calendar-6df01.firebasestorage.app",
  messagingSenderId: "146027971921",
  appId: "1:146027971921:web:e8cb3eb2ba6e86d83dbf70",
  measurementId: "G-YMTM89ZEHK"
};

// 허용된 이메일 목록 (캘린더와 동일)
const ALLOWED_EMAILS = ['miracle0938@gmail.com', 'miracle38@jiran.com'];

firebase.initializeApp(firebaseConfig);
