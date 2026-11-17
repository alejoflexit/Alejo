// Modo contingencia — subida a Supabase y listas guardadas en el dispositivo.
// La pantalla nunca espera a esto: los escaneos ya están en IndexedDB (contingenciaDB.js) y acá se suben
// en lotes, con reintentos. La subida es idempotente por el uuid de cada escaneo:
//   alta     → POST … on_conflict=id + resolution=ignore-duplicates (INSERT … ON CONFLICT DO NOTHING)
//   borrado  → PATCH borrado_at donde todavía es null
//   mostrado → PATCH reesc_at/reesc_por donde todavía es null (gana la primera marca)
// Reintentar cualquiera de los tres deja la base igual.

import { getSession, getToken } from "./auth";
import { sbFetch, cargarChoferesFull } from "./colectasShared";
import * as db from "./contingenciaDB";
import { pendientesSync, filaParaSubir, lotes, lotesPor, aplicarSubida, clasificarError, CAMPOS_ALTA } from "./contingenciaShared";

export const TABLA = "contingencia_escaneos";
const LOTE_ALTA = 200;
const LOTE_PATCH = 100; // ids por URL (uuid = 36 caracteres)
const TIEMPO_MS = 25000;

// sbFetch con tiempo máximo: con señal mala un fetch puede quedar colgado minutos
async function sb(path, opts = {}, ms = TIEMPO_MS) {
  const c = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = c ? setTimeout(() => c.abort(), ms) : null;
  try { return await sbFetch(path, c ? { ...opts, signal: c.signal } : opts); }
  finally { if (t) clearTimeout(t); }
}

// ---------- estado observable ----------
let estado = { pendientes: 0, subiendo: false, error: null, ultimoOk: null };
const oyentes = new Set();
function set(p) { estado = { ...estado, ...p }; oyentes.forEach((f) => { try { f(estado); } catch {} }); }
export const estadoSync = () => estado;
export function suscribir(fn) { oyentes.add(fn); fn(estado); return () => oyentes.delete(fn); }

export async function contarPendientes() {
  const n = pendientesSync(await db.todos()).total;
  set({ pendientes: n });
  return n;
}

// ---------- subida ----------
let corriendo = null;
let otraVez = false;

export function sincronizar() {
  if (corriendo) { otraVez = true; return corriendo; }
  corriendo = (async () => {
    try {
      do { otraVez = false; await unaPasada(); } while (otraVez);
    } finally { corriendo = null; }
    return estado;
  })();
  return corriendo;
}

async function unaPasada() {
  let regs = await db.todos();
  let p = pendientesSync(regs);
  set({ pendientes: p.total });
  if (!p.total) { set({ error: null }); return; }
  // Sin token válido authedFetch cae a la clave anónima: el PATCH "anda" pero no toca filas (RLS) y la
  // marca se daría por subida sin estarlo. Por eso sin token no se sube nada.
  if (!getSession() || !(await getToken().catch(() => null))) {
    set({ error: typeof navigator !== "undefined" && navigator.onLine === false ? "red" : "sesion" });
    return;
  }
  set({ subiendo: true });
  try {
    for (const lote of lotes(p.altas, LOTE_ALTA)) {
      await sb(`${TABLA}?on_conflict=id&columns=${CAMPOS_ALTA.join(",")}`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(lote.map(filaParaSubir)),
      });
      await db.actualizar(lote.map((r) => r.id), (r) => aplicarSubida(r, "alta"));
      set({ pendientes: Math.max(0, estado.pendientes - lote.length) });
    }
    // Las marcas se mandan con la versión fresca (las altas recién subidas ya las habilitan)
    regs = await db.todos();
    p = pendientesSync(regs);
    for (const lote of lotes(p.borrados, LOTE_PATCH)) {
      const ids = lote.map((r) => r.id);
      await sb(`${TABLA}?id=in.(${ids.join(",")})&borrado_at=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ borrado_at: lote[0].borrado_at }),
      });
      const snap = new Map(lote.map((r) => [r.id, r]));
      await db.actualizar(ids, (r) => aplicarSubida(r, "borrado", snap.get(r.id)));
    }
    for (const lote of lotesPor(p.reesc, "reesc_por", LOTE_PATCH)) {
      const ids = lote.map((r) => r.id);
      await sb(`${TABLA}?id=in.(${ids.join(",")})&reesc_at=is.null`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ reesc_at: lote[0].reesc_at, reesc_por: lote[0].reesc_por }),
      });
      const snap = new Map(lote.map((r) => [r.id, r]));
      await db.actualizar(ids, (r) => aplicarSubida(r, "reesc", snap.get(r.id)));
    }
    set({ error: null, ultimoOk: Date.now() });
  } catch (e) {
    set({ error: clasificarError(e) });
  } finally {
    set({ subiendo: false });
    await contarPendientes().catch(() => {});
  }
}

// Subida "pronto": junta varios escaneos seguidos en un solo lote
let timerProg = null;
export function programar(ms = 1500) {
  clearTimeout(timerProg);
  timerProg = setTimeout(() => { sincronizar().catch(() => {}); }, ms);
}

// Reintentos: cada 20 s si queda algo (más espaciado si viene fallando), y al volver la conexión o la app.
// Se arranca una sola vez por carga de la app y sigue aunque se salga de la sección.
let reintentosVivos = false;
export function arrancarReintentos() {
  if (reintentosVivos) return () => {};
  reintentosVivos = true;
  let fallos = 0, vivo = true, t = null;
  const ciclo = async () => {
    if (!vivo) return;
    const n = await contarPendientes().catch(() => 0);
    if (n && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      await sincronizar().catch(() => {});
      fallos = estado.error ? Math.min(fallos + 1, 5) : 0;
    }
    if (vivo) t = setTimeout(ciclo, 20000 * Math.pow(1.6, fallos));
  };
  const ya = () => { fallos = 0; clearTimeout(t); ciclo(); };
  const alVolver = () => { if (!document.hidden) ya(); };
  window.addEventListener("online", ya);
  document.addEventListener("visibilitychange", alVolver);
  ciclo();
  return () => { vivo = false; reintentosVivos = false; clearTimeout(t); window.removeEventListener("online", ya); document.removeEventListener("visibilitychange", alVolver); };
}

// ---------- lectura de Supabase (lo escaneado por todos) ----------
const COLS = [...CAMPOS_ALTA, "borrado_at", "reesc_at", "reesc_por"].join(",");
export async function cargarRemotos(desdeISO) {
  const out = [];
  for (let off = 0; off < 50000; off += 1000) {
    const filas = await sb(`${TABLA}?escaneado_at=gte.${encodeURIComponent(desdeISO)}&select=${COLS}&order=escaneado_at.asc,id.asc&limit=1000&offset=${off}`);
    out.push(...(filas || []));
    if (!filas || filas.length < 1000) break;
  }
  db.escribirCache("remotos", { at: Date.now(), desde: desdeISO, filas: out }).catch(() => {});
  return out;
}
export const remotosGuardados = () => db.leerCache("remotos");

// ---------- listas para trabajar sin red ----------
// Se bajan cuando se puede y quedan en el dispositivo. Si la bajada falla o viene vacía, se usa la guardada.
export async function listasGuardadas() {
  const [v, c] = await Promise.all([db.leerCache("vendedores"), db.leerCache("cadetes")]);
  return { vendedores: (v && v.filas) || [], cadetes: (c && c.lista) || [], vendAt: v && v.at, cadAt: c && c.at };
}

export async function actualizarListas() {
  const res = {};
  try {
    const filas = [];
    for (let off = 0; off < 50000; off += 1000) {
      const f = await sb(`ml_vendedores?select=sender_id,cliente&order=sender_id.asc&limit=1000&offset=${off}`);
      filas.push(...(f || []));
      if (!f || f.length < 1000) break;
    }
    if (filas.length) { res.vendedores = filas; await db.escribirCache("vendedores", { at: Date.now(), filas }); }
  } catch { /* queda la guardada */ }
  try {
    const lista = await cargarChoferesFull(); // semanas + colectas_choferes_manuales (lo mismo que usa Colectas)
    if (lista && lista.length) { res.cadetes = lista; await db.escribirCache("cadetes", { at: Date.now(), lista }); }
  } catch { /* queda la guardada */ }
  return res;
}
