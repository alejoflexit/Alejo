// src/auth.js — sesión compartida de Supabase Auth (tiquetera + colectas)
// Sin supabase-js: fetch directo a /auth/v1 (mismo patrón que el resto de la app).
const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

const LS_KEY = "fx_session";

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export function getSession() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}

function saveSession(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

export function logout() { localStorage.removeItem(LS_KEY); }

function pack(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    email: d.user?.email || "",
    nombre: d.user?.user_metadata?.nombre || cap((d.user?.email || "").split("@")[0]),
    exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 120) * 1000,
  };
}

export async function login(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error_description || d.msg || "Email o contraseña incorrectos");
  const s = pack(d);
  saveSession(s);
  return s;
}

async function refreshSession() {
  const s = getSession();
  if (!s || !s.refresh_token) throw new Error("sin sesión");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { logout(); throw new Error("sesión vencida"); }
  const n = pack(d);
  saveSession(n);
  return n;
}

export async function getToken() {
  const s = getSession();
  if (!s) return null;
  if (Date.now() < s.exp) return s.access_token;
  const n = await refreshSession().catch(() => null);
  return n ? n.access_token : null;
}

// fetch a PostgREST con el JWT del usuario (o anon si no hay sesión). Reintenta 1 vez ante 401.
export async function authedFetch(url, options = {}) {
  const doFetch = (t) => fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${t || SUPABASE_KEY}`,
      ...(options.headers || {}),
    },
  });
  let res = await doFetch(await getToken());
  if (res.status === 401 && getSession()) {
    const n = await refreshSession().catch(() => null);
    if (n) res = await doFetch(n.access_token);
    else { logout(); }
  }
  return res;
}
