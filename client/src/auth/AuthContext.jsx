import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);

async function authRequest(path, options = {}) {
  const response = await fetch(`/api/auth${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;

  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error?.message || 'The request could not be completed.');
    error.code = result.error?.code;
    error.status = response.status;
    throw error;
  }

  return result;
}

function AuthProvider({ children }) {
  const [status, setStatus] = useState('checking');
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);

  const refresh = useCallback(async () => {
    setStatus('checking');
    setAuthError(null);
    try {
      const result = await authRequest('/me');
      setUser(result.user);
      setStatus('authenticated');
      return result.user;
    } catch (error) {
      setUser(null);
      if (error.status === 401 || error.status === 403) {
        setStatus('anonymous');
        setAuthError(error.status === 403 ? error.message : null);
      } else {
        setStatus('error');
        setAuthError(error.message);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const result = await authRequest('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(result.user);
    setStatus('authenticated');
    setAuthError(null);
    return result.user;
  }, []);

  const register = useCallback(async (details) => (
    authRequest('/register', {
      method: 'POST',
      body: JSON.stringify(details),
    })
  ), []);

  const logout = useCallback(async () => {
    await authRequest('/logout', { method: 'POST' });
    setUser(null);
    setStatus('anonymous');
    setAuthError(null);
  }, []);

  const value = useMemo(() => ({
    status,
    user,
    authError,
    login,
    register,
    logout,
    refresh,
  }), [status, user, authError, login, register, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

export { AuthProvider, useAuth };
