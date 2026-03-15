export type AuthUser = {
  id: number;
  name: string;
  role: 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN';
  technicianId?: number | null;
};

const ACCESS_TOKEN_KEY = 'accessToken';
const USER_KEY = 'authUser';
export const AUTH_CHANGED_AT_KEY = 'authChangedAt';

const hasWindow = typeof window !== 'undefined';
const storage = hasWindow ? window.localStorage : null;

let accessTokenCache: string | null = storage?.getItem(ACCESS_TOKEN_KEY) ?? null;
let userCache: AuthUser | null = (() => {
  if (!storage) return null;
  const raw = storage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
})();

export function getAccessToken() {
  return accessTokenCache;
}

function emitAuthChanged() {
  if (!hasWindow || !storage) return;
  storage.setItem(AUTH_CHANGED_AT_KEY, String(Date.now()));
  window.dispatchEvent(new Event('auth-changed'));
}

export function setAccessToken(token: string | null) {
  const changed = accessTokenCache !== token;
  accessTokenCache = token;
  if (!storage) return;
  if (token) storage.setItem(ACCESS_TOKEN_KEY, token);
  else storage.removeItem(ACCESS_TOKEN_KEY);
  if (changed) emitAuthChanged();
}

export function getStoredUser() {
  return userCache;
}

export function setStoredUser(user: AuthUser | null) {
  const previousSerialized = userCache ? JSON.stringify(userCache) : null;
  const nextSerialized = user ? JSON.stringify(user) : null;
  const changed = previousSerialized !== nextSerialized;
  userCache = user;
  if (!storage) return;
  if (user) storage.setItem(USER_KEY, JSON.stringify(user));
  else storage.removeItem(USER_KEY);
  if (changed) emitAuthChanged();
}

export function clearAuthStorage() {
  accessTokenCache = null;
  userCache = null;
  if (storage) {
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
  emitAuthChanged();
}
