import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../config/firebase.js';
import { fetchUserProfile, loginUser, registerUser } from '../services/authService.js';
import { AuthContext } from './auth-context.js';

const getCachedUser = () => {
  try {
    const raw = localStorage.getItem('scUser');
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Failed to parse cached user', error);
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getCachedUser);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // While registering, Auth reports the new account before its profile is
  // written. The listener must not read (or sign out) that half-made account.
  const registeringRef = useRef(false);
  // Profile reads can finish out of order; only the latest auth event counts.
  const authEventRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const event = ++authEventRef.current;
      if (registeringRef.current) return;

      if (!firebaseUser) {
        setUser(null);
        setError(null);
        setLoading(false);
        return;
      }

      try {
        const profile = await fetchUserProfile(firebaseUser.uid);
        if (event !== authEventRef.current) return;
        setUser(profile);
      } catch (err) {
        if (event !== authEventRef.current) return;
        console.error('Failed to load profile', err);
        setError(err.message);
        setUser(null);
        await signOut(auth).catch(() => {});
      } finally {
        if (event === authEventRef.current) setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('scUser', JSON.stringify(user));
    } else {
      localStorage.removeItem('scUser');
    }
  }, [user]);

  const handleLogin = useCallback(async (credentials) => {
    setError(null);
    setLoading(true);
    try {
      const profile = await loginUser(credentials);
      setUser(profile);
      return profile;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRegister = useCallback(async (payload) => {
    setError(null);
    setLoading(true);
    registeringRef.current = true;
    try {
      const profile = await registerUser(payload);
      setUser(profile);
      return profile;
    } catch (err) {
      setError(err.message);
      setUser(null);
      throw err;
    } finally {
      registeringRef.current = false;
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await signOut(auth);
    setError(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      login: handleLogin,
      register: handleRegister,
      logout: handleLogout,
      setUser,
    }),
    [user, loading, error, handleLogin, handleRegister, handleLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
