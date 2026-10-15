// Firebase の設定。手順書(README.md)の「4. 設定をコピーする」で表示される
// firebaseConfig の中身を、下の {} の中にそのまま貼り付けてください。
// この値は公開しても問題ありません(データは firestore.rules で守ります)。
window.FIREBASE_CONFIG = {
        apiKey: "AIzaSyACHSOBRzrTLz2jNdgps7SnOlotzPouo6o",
    authDomain: "playground-d8897.firebaseapp.com",
    projectId: "playground-d8897",
    storageBucket: "playground-d8897.firebasestorage.app",
    messagingSenderId: "314986303136",
    appId: "1:314986303136:web:b9080ef780c03fed23c3c5"
};

// App Check(本物のアプリ以外からのアクセスを防ぐ)の reCAPTCHA Enterprise のキー(サイトキー)。
// 空のままなら App Check は使いません。
window.APPCHECK_SITE_KEY = "";
