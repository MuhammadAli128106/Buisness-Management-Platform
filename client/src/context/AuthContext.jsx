// AuthContext — owner: Musa. Session lives in httpOnly cookies; refreshing the page keeps you logged in (F1.1).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../utils/api';
import { setUnauthorizedHandler } from '../utils/authSession';
import { refreshSession } from '../utils/tokenRefresh';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { data } = await apiGet('/auth/me');
      setUser(data);
      return data;
    } catch {
      if (await refreshSession()) {
        try { const { data } = await apiGet('/auth/me'); setUser(data); return data; } catch { /* fall through */ }
      }
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      if (!['/login', '/signup'].includes(window.location.pathname)) window.location.assign('/login');
    });
    reload().finally(() => setLoading(false));
  }, [reload]);

  const login = async (email, password) => { const { data } = await apiPost('/auth/login', { email, password }); setUser(data); return data; };
  const signup = async (body) => { const { data } = await apiPost('/auth/signup', body); setUser(data); return data; };
  const logout = async () => { try { await apiPost('/auth/logout'); } catch { /* ignore */ } setUser(null); window.location.assign('/login'); };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, reload, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
