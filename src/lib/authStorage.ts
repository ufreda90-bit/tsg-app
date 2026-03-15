export type UserRole = 'ADMIN' | 'DISPATCHER' | 'TECHNICIAN';

export type AuthUser = {
  id: number;
  name: string;
  role: UserRole;
  activeRole: UserRole;
  availableRoles: UserRole[];
  technicianId?: number | null;
};

const ACCESS_TOKEN_KEY = 'accessToken';
const USER_KEY = 'authUser';
export const AUTH_CHANGED_AT_KEY = 'authChangedAt';

const hasWindow = typeof window !== 'undefined';
const storage = hasWindow ? window.localStorage : null;
const USER_ROLES: UserRole[] = ['ADMIN', 'DISPATCHER', 'TECHNICIAN'];

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && USER_ROLES.includes(value as UserRole);

const normalizeAuthUser = (value: unknown): AuthUser | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const id = Number(source.id);
  const role = isUserRole(source.role) ? source.role : null;
  if (!Number.isInteger(id) || id <= 0 || !role) return null;

  const activeRole = isUserRole(source.activeRole) ? source.activeRole : role;
  const availableRolesFromPayload = Array.isArray(source.availableRoles)
    ? source.availableRoles.filter(isUserRole)
    : [];
  const availableRoles = [...new Set<UserRole>([role, activeRole, ...availableRolesFromPayload])];

  const technicianIdRaw = source.technicianId;
  const technicianId =
    technicianIdRaw === null || technicianIdRaw === undefined
      ? null
      : Number.isInteger(Number(technicianIdRaw))
        ? Number(technicianIdRaw)
        : null;

  return {
    id,
    name: typeof source.name === 'string' ? source.name : '',
    role,
    activeRole,
    availableRoles,
    technicianId
  };
};

let accessTokenCache: string | null = storage?.getItem(ACCESS_TOKEN_KEY) ?? null;
let userCache: AuthUser | null = (() => {
  if (!storage) return null;
  const raw = storage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return normalizeAuthUser(JSON.parse(raw));
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
  const normalizedUser = user ? normalizeAuthUser(user) : null;
  const previousSerialized = userCache ? JSON.stringify(userCache) : null;
  const nextSerialized = normalizedUser ? JSON.stringify(normalizedUser) : null;
  const changed = previousSerialized !== nextSerialized;
  userCache = normalizedUser;
  if (!storage) return;
  if (normalizedUser) storage.setItem(USER_KEY, JSON.stringify(normalizedUser));
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
