import { createSignal } from 'ranuts/utils';

export interface User {
  id: string;
  username: string;
}

export interface AuthState {
  loggedIn: boolean;
  user: User | null;
  loading: boolean;
  error: string | null;
}

export const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';

// Helper to get headers with authorization token
export const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('weread_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

// Custom API Fetch helper
export const apiFetch = async <T = any>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null }> => {
  try {
    const url = `${API_BASE}${path}`;
    const headers = {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    };
    
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    const data = await response.json().catch(() => null);
    
    if (!response.ok) {
      const errorMsg = data?.error || `Request failed with status ${response.status}`;
      // Auto logout on token expiration
      if (response.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/register') {
        logout();
      }
      return { data: null, error: errorMsg };
    }
    
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || '网络连接失败' };
  }
};

const initialToken = localStorage.getItem('weread_token');
const initialUserStr = localStorage.getItem('weread_user');
const initialUser = initialUserStr ? JSON.parse(initialUserStr) : null;

export const [getAuthState, setAuthState] = createSignal<AuthState>(
  {
    loggedIn: !!initialToken,
    user: initialUser,
    loading: false,
    error: null,
  },
  { subscriber: 'auth-state-change' }
);

export const register = async (username: string, password: string): Promise<boolean> => {
  setAuthState({ ...getAuthState(), loading: true, error: null });
  const { error } = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  
  if (error) {
    setAuthState({ ...getAuthState(), loading: false, error });
    return false;
  }
  
  setAuthState({ ...getAuthState(), loading: false, error: null });
  return true;
};

export const login = async (username: string, password: string): Promise<boolean> => {
  setAuthState({ ...getAuthState(), loading: true, error: null });
  const { data, error } = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  
  if (error || !data) {
    setAuthState({ ...getAuthState(), loading: false, error: error || '登录失败' });
    return false;
  }
  
  localStorage.setItem('weread_token', data.token);
  localStorage.setItem('weread_user', JSON.stringify(data.user));
  
  setAuthState({
    loggedIn: true,
    user: data.user,
    loading: false,
    error: null,
  });
  return true;
};

export const logout = async (): Promise<void> => {
  // Try sending logout request (best effort)
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  
  localStorage.removeItem('weread_token');
  localStorage.removeItem('weread_user');
  
  setAuthState({
    loggedIn: false,
    user: null,
    loading: false,
    error: null,
  });
  
  // Refresh page or trigger app-wide db refresh to clear state
  window.location.reload();
};

export const checkMe = async (): Promise<void> => {
  const token = localStorage.getItem('weread_token');
  if (!token) return;
  
  const { data, error } = await apiFetch<{ user: User }>('/api/auth/me');
  if (error || !data) {
    logout();
  } else {
    localStorage.setItem('weread_user', JSON.stringify(data.user));
    setAuthState({
      loggedIn: true,
      user: data.user,
      loading: false,
      error: null,
    });
  }
};
