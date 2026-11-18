// שכבת תקשורת עם השרת: מוסיפה טוקן התחברות, מפענחת JSON וזורקת שגיאה עם ההודעה מהשרת.

// בפיתוח Vite מעביר את /api לשרת (vite.config.js). אם הלקוח מתארח בדומיין אחר מהשרת
// (למשל Firebase Hosting), מגדירים VITE_API_BASE=https://your-server.example.com
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

const TOKEN_KEY = 'app_token';
const USER_KEY = 'app_user';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function safeStorage(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getToken() {
  return safeStorage(() => localStorage.getItem(TOKEN_KEY));
}

// המשתמש השמור משמש רק להצגה מהירה עד שהשרת מאשר אותו (/api/me).
// שינוי ידני שלו ב-localStorage לא נותן שום הרשאה — השרת בודק כל בקשה.
export function getStoredUser() {
  if (!getToken()) return null;
  return safeStorage(() => JSON.parse(localStorage.getItem(USER_KEY) || 'null'));
}

export function setSession(token, user) {
  safeStorage(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  });
}

export function clearSession() {
  safeStorage(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  });
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') {
      clearSession();
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new ApiError(res.status, data?.error || `שגיאה (${res.status})`);
  }
  return data;
}
