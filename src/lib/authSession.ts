export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoredAuthSession {
  token: string;
  user: AuthUser;
}

const STORAGE_KEY = "qw.auth.session";

export function readStoredAuthSession(): StoredAuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredAuthSession;
  } catch {
    return null;
  }
}

export function writeStoredAuthSession(session: StoredAuthSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAccessToken() {
  return readStoredAuthSession()?.token ?? null;
}

export function buildAuthHeaders(extra?: HeadersInit): HeadersInit {
  const token = getAccessToken();
  const selectedWs = typeof window !== "undefined" ? localStorage.getItem("selected_workspace_id") : null;
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(selectedWs ? { "X-Workspace-Id": selectedWs } : {}),
  };
}

