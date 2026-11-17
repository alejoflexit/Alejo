// Modo contingencia — almacenamiento en el dispositivo (IndexedDB, sin librerías).
// Cada escaneo se escribe acá ANTES de intentar subirlo: si se corta la red o se cierra la app, no se pierde.
// Si el navegador no deja usar IndexedDB (modo privado viejo, etc.) cae a localStorage con la misma interfaz.
//
// Stores:
//   escaneos  — un registro por escaneo (keyPath id), con el estado de subida (s_alta, s_borrado, s_reesc)
//   cache     — clave → valor: vendedores (ml_vendedores), cadetes, tanda actual, última foto de Supabase

const NOMBRE = "flexit-contingencia";
const VERSION = 1;
const LS_ESC = "fx_cont_escaneos";
const LS_KV = "fx_cont_cache";

let dbPromesa = null;
let modo = null; // "idb" | "ls"

function abrir() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise((ok, mal) => {
    try {
      if (typeof indexedDB === "undefined") throw new Error("sin indexedDB");
      const req = indexedDB.open(NOMBRE, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("escaneos")) {
          const s = db.createObjectStore("escaneos", { keyPath: "id" });
          s.createIndex("tanda", "tanda");
        }
        if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      };
      req.onsuccess = () => { modo = "idb"; ok(req.result); };
      req.onerror = () => mal(req.error);
      req.onblocked = () => mal(new Error("bloqueado"));
    } catch (e) { mal(e); }
  }).catch(() => { modo = "ls"; return null; });
  return dbPromesa;
}

// Pide al navegador que no borre estos datos para liberar espacio (Safari/Chrome lo pueden negar)
export async function pedirPersistencia() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}

export async function tipoAlmacen() { await abrir(); return modo; }

const lsLeer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; } };
const lsEscribir = (k, v) => { localStorage.setItem(k, JSON.stringify(v)); };

function tx(db, store, rw, fn) {
  return new Promise((ok, mal) => {
    const t = db.transaction(store, rw ? "readwrite" : "readonly");
    const s = t.objectStore(store);
    try { fn(s); } catch (e) { mal(e); return; }
    t.oncomplete = () => ok();
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error || new Error("abortado"));
  });
}

export async function todos() {
  const db = await abrir();
  if (!db) return Object.values(lsLeer(LS_ESC, {}));
  return new Promise((ok, mal) => {
    const r = db.transaction("escaneos").objectStore("escaneos").getAll();
    r.onsuccess = () => ok(r.result || []);
    r.onerror = () => mal(r.error);
  });
}

// Guarda (inserta o reemplaza) uno o varios registros. Resuelve recién cuando quedó escrito.
export async function guardar(regs) {
  const lista = Array.isArray(regs) ? regs : [regs];
  if (!lista.length) return;
  const db = await abrir();
  if (!db) {
    const m = lsLeer(LS_ESC, {});
    for (const r of lista) m[r.id] = r;
    lsEscribir(LS_ESC, m);
    return;
  }
  await tx(db, "escaneos", true, (s) => { for (const r of lista) s.put(r); });
}

// Lee cada registro y lo reemplaza por fn(registro) en UNA transacción (no pisa cambios hechos
// mientras una subida estaba en vuelo). fn devuelve el registro nuevo, o undefined para no tocarlo.
export async function actualizar(ids, fn) {
  if (!ids.length) return;
  const db = await abrir();
  if (!db) {
    const m = lsLeer(LS_ESC, {});
    for (const id of ids) if (m[id]) { const n = fn(m[id]); if (n) m[id] = n; }
    lsEscribir(LS_ESC, m);
    return;
  }
  await tx(db, "escaneos", true, (s) => {
    for (const id of ids) {
      const g = s.get(id);
      g.onsuccess = () => { if (g.result) { const n = fn(g.result); if (n) s.put(n); } };
    }
  });
}

export async function leerCache(clave) {
  const db = await abrir();
  if (!db) return lsLeer(LS_KV, {})[clave] ?? null;
  return new Promise((ok) => {
    try {
      const r = db.transaction("cache").objectStore("cache").get(clave);
      r.onsuccess = () => ok(r.result ?? null);
      r.onerror = () => ok(null);
    } catch { ok(null); }
  });
}

export async function escribirCache(clave, valor) {
  const db = await abrir();
  if (!db) {
    try { const m = lsLeer(LS_KV, {}); m[clave] = valor; lsEscribir(LS_KV, m); } catch { /* lleno: es solo caché */ }
    return;
  }
  await tx(db, "cache", true, (s) => { s.put(valor, clave); }).catch(() => {});
}

// Cambia UN registro leyendo la versión guardada (no una copia vieja de la pantalla). Si no está en el
// dispositivo (vino de otro, vía Supabase) se crea a partir de `siNoEsta`. Devuelve el registro final.
export async function modificar(id, fn, siNoEsta) {
  const db = await abrir();
  if (!db) {
    const m = lsLeer(LS_ESC, {});
    const base = m[id] || siNoEsta;
    if (!base) return null;
    m[id] = fn(base);
    lsEscribir(LS_ESC, m);
    return m[id];
  }
  let final = null;
  await tx(db, "escaneos", true, (s) => {
    const g = s.get(id);
    g.onsuccess = () => {
      const base = g.result || siNoEsta;
      if (!base) return;
      final = fn(base);
      s.put(final);
    };
  });
  return final;
}
