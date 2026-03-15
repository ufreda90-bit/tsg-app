import { clearAuthStorage, getAccessToken, setAccessToken } from './authStorage';
import { toast } from '../components/Toast';

let warnedMissingToken = false;
let refreshPromise: Promise<string | null> | null = null;
let sessionExpiredToastAt = 0;
const SESSION_EXPIRED_TOAST_TTL_MS = 10_000;

function getPathname(input: RequestInfo | URL) {
  if (typeof input === 'string') return new URL(input, window.location.origin).pathname;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url, window.location.origin).pathname;
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (!data?.accessToken) return null;
        setAccessToken(data.accessToken);
        return data.accessToken as string;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function notifySessionExpired() {
  const now = Date.now();
  if (now - sessionExpiredToastAt < SESSION_EXPIRED_TOAST_TTL_MS) {
    return;
  }
  sessionExpiredToastAt = now;
  toast.error('Session expired. Please log in again.');
}

export function extractErrorMessage(data: any): string {
  if (data && typeof data === 'object' && typeof data.error === 'string') {
    const msg = data.error.trim();
    if (msg) return msg;
  }
  return 'Unexpected server error';
}

async function getErrorMessageFromResponse(response: Response): Promise<string> {
  try {
    const data = await response.clone().json();
    return extractErrorMessage(data);
  } catch {
    return 'Unexpected server error';
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const pathname = getPathname(input);
  const isApi = pathname.startsWith('/api/');
  const isAuthRoute = pathname.startsWith('/api/auth/');
  const isPublicRoute = pathname.startsWith('/api/public/') || pathname === '/api/health';

  let nextInit = init;
  if (isApi && !isAuthRoute) {
    const token = getAccessToken();
    if (token) {
      const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      const headers = new Headers(baseHeaders);
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      nextInit = { ...init, headers };
    } else if (!isPublicRoute) {
      if (import.meta.env.DEV && !warnedMissingToken) {
        console.error('[apiFetch] Nessun access token disponibile. Effettua il login.');
        warnedMissingToken = true;
      }
    }
  }

  let res = await fetch(input, nextInit);

  if (res.status === 403 && isApi && !isAuthRoute && !isPublicRoute) {
    if (import.meta.env.DEV) {
      console.warn('[apiFetch] 403 Forbidden');
    }
    return res;
  }

  if (res.status === 401 && isApi && !isAuthRoute && !isPublicRoute) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      const headers = new Headers(baseHeaders);
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(input, { ...init, headers });
      if (res.status !== 401) {
        return res;
      }
    }

    clearAuthStorage();
    notifySessionExpired();
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }

  if (!res.ok) {
    const message = await getErrorMessageFromResponse(res);
    try {
      (res as Response & { apiErrorMessage?: string }).apiErrorMessage = message;
    } catch {
      // ignore if response object is not extensible
    }
  }

  return res;
}
