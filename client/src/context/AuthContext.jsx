import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../services/firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { clinic } from '../utils/clinicApi';

const AuthContext = createContext();

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  // the portal role from the SERVER (Stage 4B): { role: 'trainee'|'clinician', isAdmin, clinicianStatus, myClinician }
  // or { unavailable: true } — the screens follow it; the server still checks every request
  const [portal, setPortal] = useState(null);

  async function refreshPortal({ forceToken = false } = {}) {
    try {
      if (forceToken && auth.currentUser) await auth.currentUser.getIdToken(true);   // a new role claim is read
    } catch { /* offline */ }
    const r = await clinic('GET', '/me');
    const p = r.ok ? r.data : { unavailable: true, error: r.error };
    setPortal(p);
    return p;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (profileDoc.exists()) {
            setUserProfile(profileDoc.data());
          }
          setAuthError(null);
        } catch (err) {
          console.error('Failed to load profile:', err.message);
          setAuthError(err.message);
        }
        refreshPortal();
      } else {
        setUserProfile(null);
        setPortal(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function register(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    setUserProfile(null);
    return signOut(auth);
  }

  async function resetPassword(email) {
    return sendPasswordResetEmail(auth, email);
  }

  async function refreshProfile() {
    if (user) {
      try {
        const profileDoc = await getDoc(doc(db, 'users', user.uid));
        if (profileDoc.exists()) {
          setUserProfile(profileDoc.data());
        }
        setAuthError(null);
      } catch (err) {
        console.error('Failed to refresh profile:', err.message);
        setAuthError(err.message);
      }
    }
  }

  const value = {
    user,
    userProfile,
    loading,
    authError,
    login,
    register,
    logout,
    resetPassword,
    refreshProfile,
    portal,
    refreshPortal,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
