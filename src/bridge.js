// src/bridge.js — acceso al bridge de LightData del VPS (seguridad, 13/11/2026).
//
// La app ya NO le pega directo al VPS: pasa por la función de Supabase `bridge`, que exige un
// usuario logueado y agrega la clave del lado del servidor (la clave no puede vivir en el
// frontend: el repo es público y el bundle se descarga).
//
// TRANSICIÓN: mientras la función no esté desplegada (404 de Supabase), se usa el camino viejo
// con la clave. Cuando se rote la clave del VPS ese camino deja de andar solo; después hay que
// borrar LEGACY_KEY y el bloque de respaldo. Ver ESTADO-SEGURIDAD.md.
import { authedFetch, getSession } from './auth';

const FUNCION = 'https://svlagoosmxxcsbevkrhy.supabase.co/functions/v1/bridge';
const VPS = 'https://srv1801226.hstgr.cloud/bridge';
const LEGACY_KEY = 'db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b'; // BORRAR al rotar la clave del VPS

let funcionDisponible = true; // se apaga si Supabase responde que la función no existe

// Devuelve el Response (igual que fetch). `ruta`: reparto | colecta | colecta-detalle | zonas | geo | envio-qr
export async function bridgeFetch(ruta, params = null, opciones = {}) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  const { signal, cache } = opciones;
  if (funcionDisponible) {
    let r = null;
    try {
      r = await authedFetch(`${FUNCION}/${ruta}${qs}`, { method: 'GET', signal, cache: cache || 'no-store' });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      // Error de red/CORS: si la función no existe, Supabase responde sin CORS y el navegador lo
      // muestra como error de red. Durante la transición se cae al camino viejo.
      funcionDisponible = false;
    }
    if (r) {
      if (r.status !== 404) return r;
      const cuerpo = await r.clone().json().catch(() => ({}));
      if (cuerpo && cuerpo.motivo) return r; // 404 de la función (ruta no permitida): es real
      funcionDisponible = false; // 404 de Supabase: la función todavía no está desplegada
    }
  }
  return fetch(`${VPS}/${ruta}${qs}`, { headers: { 'x-bridge-key': LEGACY_KEY }, signal, cache: cache || 'no-store' });
}

// Mensaje para mostrar cuando el bridge responde 401 (sin sesión)
export const sinSesionBridge = (r) => r && r.status === 401 && !getSession();
