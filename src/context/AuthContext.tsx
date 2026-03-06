import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { AUTH_CHANGED_AT_KEY, AuthUser, clearAuthStorage, getAccessToken, getRefreshToken, getStoredUser, setAccessToken, setRefreshToken, setStoredUser } from '../lib/authStorage';

export type UserRole = 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN' | null;

interface AuthContextType {
  user: AuthUser | null;
  role: UserRole;
  technicianId: number | null;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const readSessionUser = () => {
    const token = getAccessToken();
    return token ? getStoredUser() : null;
  };
  const [user, setUser] = useState<AuthUser | null>(() => readSessionUser());

  useEffect(() => {
    const syncFromStorage = () => {
      const token = getAccessToken();
      const storedUser = token ? getStoredUser() : null;
      if (token && !storedUser) {
        clearAuthStorage();
      }
      setUser(storedUser ?? null);
    };

    syncFromStorage();

    const handleAuthChanged = () => {
      syncFromStorage();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_CHANGED_AT_KEY) return;
      syncFromStorage();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('auth-changed', handleAuthChanged);
      window.addEventListener('storage', handleStorage);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('auth-changed', handleAuthChanged);
        window.removeEventListener('storage', handleStorage);
      }
    };
  }, []);

  const setSession = (nextUser: AuthUser, accessToken: string, refreshToken: string) => {
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    setStoredUser(nextUser);
    setUser(nextUser);
  };

  const logout = async () => {
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
      }
    } catch (e) {
      // ignore logout errors
    } finally {
      clearAuthStorage();
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('adminProfile');
      }
      setUser(null);
    }
  };

  const role = user?.role ?? null;
  const technicianId = user?.technicianId ?? null;

  return (
    <AuthContext.Provider value={{ user, role, technicianId, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
