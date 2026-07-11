/* ========================================================
   TaskFlow — firebase-sync.js
   Thin wrapper around Firebase (Auth + Firestore) so app.js
   can stay backend-agnostic. Exposes window.TaskFlowCloud.
   Uses the Firebase compat SDK (loaded via <script> tags in
   index.html) so no bundler/module step is required.
   ======================================================== */

(function(){
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyD1r-qzFVe97wkgCRA1ap94cyj1OgWZJj8",
    authDomain: "kevin-task-4405.firebaseapp.com",
    projectId: "kevin-task-4405",
    storageBucket: "kevin-task-4405.firebasestorage.app",
    messagingSenderId: "417140026464",
    appId: "1:417140026464:web:677f350d8c7e59eba12705",
    measurementId: "G-HGW7654EHG"
  };

  let app = null, auth = null, db = null, provider = null;
  let ready = false;
  let unsubscribeSnapshot = null;
  let currentUser = null;

  const authListeners = [];
  const remoteUpdateListeners = [];
  const statusListeners = [];

  function emitStatus(status){
    statusListeners.forEach(fn => { try{ fn(status); }catch(e){ console.error(e); } });
  }
  function emitAuth(user){
    authListeners.forEach(fn => { try{ fn(user); }catch(e){ console.error(e); } });
  }
  function emitRemoteUpdate(data){
    remoteUpdateListeners.forEach(fn => { try{ fn(data); }catch(e){ console.error(e); } });
  }

  function init(){
    if(ready) return true;
    if(typeof firebase === "undefined"){
      console.warn("Firebase SDK not loaded; cloud sync disabled.");
      return false;
    }
    try{
      app = firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      provider = new firebase.auth.GoogleAuthProvider();
      ready = true;

      auth.onAuthStateChanged((user)=>{
        currentUser = user;
        emitAuth(user);
        if(user){
          startListening(user.uid);
        } else {
          stopListening();
        }
      });
      return true;
    }catch(e){
      console.error("Firebase init failed", e);
      return false;
    }
  }

  function docRef(uid){
    return db.collection("users").doc(uid);
  }

  function startListening(uid){
    stopListening();
    emitStatus("syncing");
    unsubscribeSnapshot = docRef(uid).onSnapshot((snap)=>{
      if(snap.exists){
        emitRemoteUpdate(snap.data());
      }
      emitStatus("synced");
    }, (err)=>{
      console.error("Firestore snapshot error", err);
      emitStatus("error");
    });
  }
  function stopListening(){
    if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  }

  async function signIn(){
    if(!init()) throw new Error("Firebase not available");
    return auth.signInWithPopup(provider);
  }
  async function signOut(){
    if(!auth) return;
    stopListening();
    return auth.signOut();
  }

  async function fetchOnce(uid){
    const snap = await docRef(uid).get();
    return snap.exists ? snap.data() : null;
  }

  async function push(state){
    if(!currentUser) return;
    emitStatus("syncing");
    try{
      await docRef(currentUser.uid).set(Object.assign({}, state, {
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }));
      emitStatus("synced");
    }catch(e){
      console.error("Firestore push failed", e);
      emitStatus("error");
    }
  }

  window.TaskFlowCloud = {
    init,
    signIn,
    signOut,
    push,
    fetchOnce,
    isSignedIn: ()=> !!currentUser,
    getUser: ()=> currentUser,
    onAuthChange: (fn)=> authListeners.push(fn),
    onRemoteUpdate: (fn)=> remoteUpdateListeners.push(fn),
    onStatusChange: (fn)=> statusListeners.push(fn)
  };

  // Attempt init immediately (safe no-op if SDK failed to load, e.g. offline).
  init();
})();
