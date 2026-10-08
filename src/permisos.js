// src/permisos.js — qué secciones ve cada usuario.
// La fuente es la tabla usuarios_permisos (cada uno lee solo su fila; la edita el admin desde
// Usuarios → edge function admin-usuarios). Se cachea en localStorage para que el menú salga
// al instante y se refresca en segundo plano.
//
// OJO: esto oculta pantallas, no blinda datos. Las tablas siguen con su RLS propia.
import { useEffect, useState } from "react";
import { getSession, authedFetch } from "./auth";

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const LS = "fx_permisos";
export const ADMIN_EMAIL = "admin@flexit.app";

// Catálogo de secciones que se pueden habilitar/quitar (orden = orden en pantalla)
export const SECCIONES = [
  { id: "metricas",   label: "Métricas",    icon: "ti ti-chart-bar" },
  { id: "colectas",   label: "Colectas",    icon: "ti ti-package" },
  { id: "arribos",    label: "Arribos",     icon: "ti ti-truck-delivery" },
  { id: "zonas",      label: "Zonas",       icon: "ti ti-alarm" },
  { id: "pizarra",    label: "Pizarra",     icon: "ti ti-notes" },
  { id: "tiquetera",  label: "Tiquetera",   icon: "ti ti-ticket" },
  { id: "pendientes", label: "Pendientes históricos", icon: "ti ti-history" },
  { id: "choferes",   label: "Alta de choferes", icon: "ti ti-user-plus" },
  { id: "pagos",      label: "Liquidaciones", icon: "ti ti-cash", soloAdmin: true },
];
// Lo que veía todo el mundo antes de que existieran los permisos
const POR_DEFECTO = SECCIONES.filter((s) => !s.soloAdmin).map((s) => s.id);

function leerCache() {
  try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; }
}

// Permisos del usuario logueado. Sin sesión → null (la app se comporta como siempre).
export function permisosActuales() {
  const s = getSession();
  if (!s) return null;
  const c = leerCache();
  if (c && c.email === s.email) return c;
  // Sin datos todavía: lo de siempre (admin ve todo)
  return { email: s.email, rol: s.email === ADMIN_EMAIL ? "admin" : "usuario", secciones: null };
}

export function esAdmin() {
  const p = permisosActuales();
  return !!p && p.rol === "admin";
}

export function puedeVer(id) {
  if (id === "home") return true;
  if (id === "envio") return puedeVer("tiquetera"); // Buscar envío usa los mismos datos que la Tiquetera
  if (id === "usuarios") return esAdmin();
  const p = permisosActuales();
  if (!p) return true; // sin sesión: igual que antes (cada sección pide su propio login; Pagos el del admin)
  if (p.rol === "admin") return true;
  if (id === "pagos") return false;
  const lista = Array.isArray(p.secciones) ? p.secciones : POR_DEFECTO;
  return lista.includes(id);
}

export async function refrescarPermisos() {
  const s = getSession();
  if (!s) { try { localStorage.removeItem(LS); } catch {} return null; }
  const r = await authedFetch(`${SUPABASE_URL}/rest/v1/usuarios_permisos?select=rol,secciones`);
  if (!r.ok) return permisosActuales();
  const filas = await r.json().catch(() => []);
  const f = Array.isArray(filas) && filas[0];
  const p = f
    ? { email: s.email, rol: f.rol, secciones: f.secciones }
    : { email: s.email, rol: s.email === ADMIN_EMAIL ? "admin" : "usuario", secciones: null };
  try { localStorage.setItem(LS, JSON.stringify(p)); } catch {}
  return p;
}

// Hook: devuelve un número que cambia cuando se actualizan los permisos (para re-renderizar)
export function usePermisos(sessionKey) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let vivo = true;
    refrescarPermisos().then(() => { if (vivo) setV((x) => x + 1); }).catch(() => {});
    const onFocus = () => refrescarPermisos().then(() => vivo && setV((x) => x + 1)).catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { vivo = false; window.removeEventListener("focus", onFocus); };
  }, [sessionKey]);
  return v;
}

// ── Llamadas al centro de control (solo admin) ──
export async function adminUsuarios(accion, datos = {}) {
  const r = await authedFetch(`${SUPABASE_URL}/functions/v1/admin-usuarios`, {
    method: "POST",
    body: JSON.stringify({ accion, ...datos }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}
