// Modo contingencia — lógica pura (sin React, sin red, sin IndexedDB), testeada en contingenciaShared.test.js.
//
// Para cuando LightData se cae en plena operación: se escanea igual en la app, todo queda guardado
// (primero en el dispositivo, después en Supabase) y cuando LightData vuelve se "pasa" re-escaneando
// desde la pantalla: la app regenera cada QR a partir del texto CRUDO que se leyó y alguien lo escanea
// con la app oficial de LightData. Por eso el texto crudo se guarda tal cual, sin recortar ni tocar.
//
// La app NO escribe en LightData (regla: LightData solo lectura). "Mostrado" = el QR se mostró en
// pantalla para escanearlo; el sistema no puede saber si LightData lo registró.

import QRCode from "qrcode";
import { leerEtiqueta } from "./dobleBultoShared";

// Herramienta del depósito (Alejo, 16/11): solo ingreso a planta y salida con cadete. La tabla todavía
// acepta 'colecta' (primera versión); si apareciera una fila así, se ignora al agrupar.
export const MODOS = {
  ingreso: { id: "ingreso", label: "Ingreso a planta", persona: null, pide: null },
  salida: { id: "salida", label: "Salida", persona: "cadete", pide: "Elegí el cadete" },
};
export const LISTA_MODOS = [MODOS.ingreso, MODOS.salida];
export const modoValido = (modo) => Object.prototype.hasOwnProperty.call(MODOS, modo);
export const modoPidePersona = (modo) => !!(MODOS[modo] && MODOS[modo].persona);

// ---------- lectura ----------
// Texto leído por la cámara → { codigo, sender_id, tipo, qr } | null.
// Usa el mismo parser que Doble bulto para el código, pero `qr` es el texto EXACTO recibido (sin trim):
// regenerar el QR idéntico es lo que permite el re-escaneo.
export function leerContingencia(texto) {
  if (typeof texto !== "string") return null;
  const l = leerEtiqueta(texto);
  if (!l) return null;
  return { codigo: l.codigo, sender_id: l.sender_id, tipo: l.tipo, qr: texto };
}

// Número de cliente que trae el QR propio de LightData ({"local":1,"did":…,"cliente":…,"empresa":125})
export function clienteLD(qr) {
  try {
    const j = JSON.parse(String(qr || "").trim());
    return j && typeof j === "object" && j.did != null && j.cliente != null && String(j.cliente).trim() ? String(j.cliente).trim() : null;
  } catch { return null; }
}

// Cliente para mostrar (sirve para ubicar un paquete; no define grupos). Si el vendedor de ML no se conoce,
// se muestra su sender_id.
export function clienteVisible(reg, vendedores) {
  if (reg.cliente) return reg.cliente;
  if (reg.sender_id) {
    const c = vendedores && (vendedores instanceof Map ? vendedores.get(String(reg.sender_id)) : vendedores[String(reg.sender_id)]);
    return c || `Sin identificar · vendedor ${reg.sender_id}`;
  }
  const ld = reg.tipo === "ld" ? clienteLD(reg.qr) : null;
  return ld ? `Cliente LightData ${ld}` : "Sin identificar";
}

// Lista de ml_vendedores → Map sender_id → cliente
export function mapaVendedores(filas) {
  const m = new Map();
  for (const f of filas || []) if (f && f.sender_id != null && f.cliente) m.set(String(f.sender_id), f.cliente);
  return m;
}

// ---------- ids ----------
export function uuid(rnd) {
  if (!rnd && typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (rnd) rnd(b);
  else if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- escaneo en ráfaga ----------
// La misma etiqueta queda varios cuadros frente a la cámara: dentro de EN_CUADRO_MS se ignora en silencio.
// Pasado eso, si el código ya está en la tanda, es un duplicado (se avisa, no se guarda).
export const EN_CUADRO_MS = 2500;
// estado = { codigos: Set de códigos de la tanda, ultimo: { c, at } }
export function evaluarLectura(estado, codigo, ahora) {
  const u = estado.ultimo || { c: "", at: 0 };
  if (codigo === u.c && ahora - u.at < EN_CUADRO_MS) return "ignorar";
  return estado.codigos.has(codigo) ? "duplicado" : "nuevo";
}

// Registro completo de un escaneo (lo que se guarda en el dispositivo)
export function nuevoEscaneo({ lectura, modo, persona, cliente, por, tanda, ahora = Date.now(), id }) {
  return {
    id: id || uuid(),
    qr: lectura.qr,
    codigo: lectura.codigo,
    sender_id: lectura.sender_id || null,
    tipo: lectura.tipo,
    modo,
    persona: modoPidePersona(modo) ? persona || null : null,
    cliente: cliente || null,
    escaneado_por: por || null,
    escaneado_at: new Date(ahora).toISOString(),
    tanda,
    // estado local de sincronización (no se sube tal cual)
    s_alta: 0,          // 0 = falta subir el escaneo · 1 = está en Supabase
    borrado_at: null, s_borrado: 1,
    reesc_at: null, reesc_por: null, s_reesc: 1,
  };
}

// Códigos vigentes (no borrados) de una tanda
export function codigosDeTanda(registros, tanda) {
  return new Set((registros || []).filter((r) => r.tanda === tanda && !r.borrado_at).map((r) => r.codigo));
}

// ---------- sincronización ----------
// Solo los campos de alta: la subida es INSERT … ON CONFLICT (id) DO NOTHING, así reintentar no duplica
// ni pisa marcas que haya puesto otro dispositivo.
export const CAMPOS_ALTA = ["id", "qr", "codigo", "sender_id", "tipo", "modo", "persona", "cliente", "escaneado_por", "escaneado_at", "tanda"];
export function filaParaSubir(r) {
  const o = {};
  for (const k of CAMPOS_ALTA) o[k] = r[k] == null ? null : r[k];
  return o;
}

// Qué falta subir. Las marcas (borrado / mostrado) son PATCH y solo se mandan cuando el alta ya está arriba.
export function pendientesSync(registros) {
  const altas = [], borrados = [], reesc = [];
  for (const r of registros || []) {
    if (!r.s_alta) { altas.push(r); continue; }
    if (r.borrado_at && !r.s_borrado) borrados.push(r);
    if (r.reesc_at && !r.s_reesc && !r.borrado_at) reesc.push(r);
  }
  return { altas, borrados, reesc, total: altas.length + borrados.length + reesc.length };
}
export const cuantosSinSubir = (registros) => pendientesSync(registros).total;

export function lotes(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Aplica a un registro el resultado de una subida exitosa (se llama sobre la versión FRESCA del registro,
// para no pisar un borrado o una marca hechos mientras la subida estaba en vuelo)
export function aplicarSubida(r, tipo, snapshot) {
  if (!r) return r;
  if (tipo === "alta") return { ...r, s_alta: 1 };
  if (tipo === "borrado") return r.borrado_at === snapshot.borrado_at ? { ...r, s_borrado: 1 } : r;
  if (tipo === "reesc") return r.reesc_at === snapshot.reesc_at ? { ...r, s_reesc: 1 } : r;
  return r;
}

// Marcas locales que todavía no subieron
export function marcarBorrado(r, ahora = Date.now()) {
  if (r.borrado_at) return r;
  return { ...r, borrado_at: new Date(ahora).toISOString(), s_borrado: 0 };
}
export function marcarMostrado(r, por, ahora = Date.now()) {
  if (r.reesc_at) return r;
  return { ...r, reesc_at: new Date(ahora).toISOString(), reesc_por: por || null, s_reesc: 0 };
}

// Fila que llegó de Supabase → registro local (ya está arriba: s_alta = 1)
export function desdeRemoto(f) {
  return {
    ...filaParaSubir(f),
    s_alta: 1,
    borrado_at: f.borrado_at || null, s_borrado: 1,
    reesc_at: f.reesc_at || null, reesc_por: f.reesc_por || null, s_reesc: 1,
  };
}

// Junta lo de Supabase (todos los dispositivos) con lo del dispositivo. Por id: lo local manda para lo
// que todavía no subió; una marca puesta en cualquier lado no se pierde.
export function fusionar(remotos, locales) {
  const m = new Map();
  for (const f of remotos || []) m.set(f.id, desdeRemoto(f));
  for (const l of locales || []) {
    const r = m.get(l.id);
    if (!r) { m.set(l.id, l); continue; }
    m.set(l.id, {
      ...r,
      ...l,
      s_alta: 1,
      borrado_at: l.borrado_at || r.borrado_at,
      reesc_at: l.reesc_at || r.reesc_at,
      reesc_por: l.reesc_at ? l.reesc_por : r.reesc_por,
    });
  }
  return [...m.values()];
}

// ---------- tandas a pasar ----------
// Día (reloj AR, UTC-3) de un ISO, como "2026-11-16"
export function diaAR(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t - 3 * 3600e3).toISOString().slice(0, 10) : "";
}

// Grupos para el re-escaneo: modo + día, y en salida además el cadete. Filas de modos que ya no existen
// (ej. 'colecta' de la primera versión) se ignoran. Dentro de cada grupo un código aparece una sola vez
// (el escaneo más viejo), ordenados por hora.
export function agruparTandas(registros) {
  const grupos = new Map();
  const orden = (registros || []).filter((r) => !r.borrado_at && modoValido(r.modo)).slice()
    .sort((a, b) => (a.escaneado_at < b.escaneado_at ? -1 : a.escaneado_at > b.escaneado_at ? 1 : a.id < b.id ? -1 : 1));
  for (const r of orden) {
    const dia = diaAR(r.escaneado_at);
    const persona = modoPidePersona(r.modo) ? r.persona || "Sin asignar" : null;
    const key = [r.modo, dia, persona || ""].join("|");
    let g = grupos.get(key);
    if (!g) { g = { key, modo: r.modo, dia, persona, items: [], vistos: new Set() }; grupos.set(key, g); }
    if (g.vistos.has(r.codigo)) {
      // mismo envío escaneado dos veces (otra tanda u otro dispositivo): si alguno ya se mostró, cuenta
      if (r.reesc_at) { const i = g.items.findIndex((x) => x.codigo === r.codigo); if (i >= 0 && !g.items[i].reesc_at) g.items[i] = { ...g.items[i], reesc_at: r.reesc_at }; }
      continue;
    }
    g.vistos.add(r.codigo);
    g.items.push(r);
  }
  const ordenModo = { ingreso: 0, salida: 1 };
  return [...grupos.values()].map(({ vistos, ...g }) => {
    const mostrados = g.items.filter((x) => x.reesc_at).length;
    return { ...g, total: g.items.length, mostrados, completo: mostrados === g.items.length };
  }).sort((a, b) => (a.dia !== b.dia ? (a.dia < b.dia ? 1 : -1)
    : a.modo !== b.modo ? ordenModo[a.modo] - ordenModo[b.modo]
    : (a.persona || "").localeCompare(b.persona || "", "es")));
}

// Índice por el que retomar un grupo: el primero que todavía no se mostró (o 0 si están todos)
export function primerPendiente(items) {
  const i = (items || []).findIndex((x) => !x.reesc_at);
  return i < 0 ? 0 : i;
}

// ---------- QR regenerado ----------
// Fondo blanco, módulos negros, margen de 4 módulos (zona de silencio estándar) y corrección media.
export const OPCIONES_QR = { errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } };

// Matriz del QR (para el test byte a byte y para dibujar). Devuelve { size, data: Uint8Array 0/1 }.
export function matrizQR(texto) {
  const q = QRCode.create(texto, { errorCorrectionLevel: OPCIONES_QR.errorCorrectionLevel });
  return { size: q.modules.size, data: q.modules.data };
}

// Matriz → píxeles RGBA (escala `px` por módulo + margen), el formato que lee jsQR
export function pixelesQR({ size, data }, px = 4, margen = OPCIONES_QR.margin) {
  const lado = (size + margen * 2) * px;
  const out = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!data[y * size + x]) continue;
    for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
      const i = (((y + margen) * px + dy) * lado + (x + margen) * px + dx) * 4;
      out[i] = out[i + 1] = out[i + 2] = 0;
    }
  }
  return { ancho: lado, alto: lado, data: out };
}

// ---------- textos ----------
export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const DIAS_SEM = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export function etiquetaDia(dia, ahora = Date.now()) {
  if (!dia) return "";
  const d = new Date(`${dia}T12:00:00Z`);
  const hoy = diaAR(new Date(ahora).toISOString());
  const ayer = diaAR(new Date(ahora - 864e5).toISOString());
  const base = `${DIAS_SEM[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  return dia === hoy ? `Hoy · ${base}` : dia === ayer ? `Ayer · ${base}` : base;
}
export function horaAR(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t - 3 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ---------- errores de Supabase ----------
// "sesion": RLS rechazó (sin login o token vencido) · "tabla": falta la migración · "red": todo lo demás
export function clasificarError(e) {
  const m = String((e && (e.message || e)) || "");
  if (/row-level security|42501|JWT|not authorized|permission denied/i.test(m)) return "sesion";
  if (/PGRST205|42P01|schema cache|does not exist/i.test(m) && /contingencia_escaneos/i.test(m)) return "tabla";
  return "red";
}

// Agrupa por un campo antes de partir en lotes (un PATCH lleva un solo valor para todo el lote)
export function lotesPor(arr, campo, n) {
  const m = new Map();
  for (const x of arr) { const k = x[campo] == null ? "" : String(x[campo]); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m.values()].flatMap((g) => lotes(g, n));
}
