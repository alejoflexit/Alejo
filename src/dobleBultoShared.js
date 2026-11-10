// Doble bulto — lógica pura (sin React ni red), testeada en dobleBultoShared.test.js.
//
// El QR de la etiqueta de Mercado Libre es un JSON {"id":"47963506158","sender_id":123,"hash_code":…}:
// trae el número de envío y el vendedor, NO la dirección. LightData usa su propio QR (JSON con "did").
// La dirección / CP / localidad salen de envios_busqueda cuando el envío aparece ahí.

// Texto leído (QR o tipeado) → { codigo, sender_id, tipo, qr } | null
export function leerEtiqueta(texto) {
  const t = String(texto || "").trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    if (j && typeof j === "object") {
      if (j.id != null && String(j.id).trim()) return { codigo: String(j.id).trim(), sender_id: j.sender_id != null ? String(j.sender_id).trim() : null, tipo: "ml", qr: t };
      if (j.did != null && String(j.did).trim()) return { codigo: String(j.did).trim(), sender_id: null, tipo: "ld", qr: t };
      return null;
    }
  } catch { /* no es JSON */ }
  const c = t.replace(/^#/, "").trim();
  if (c.length < 4 || c.length > 80 || /\s/.test(c)) return null;
  return { codigo: c, sender_id: null, tipo: "texto", qr: t };
}

const norm = (v) => String(v == null ? "" : v).trim().replace(/^#/, "").toLowerCase();

// ¿Este envío de envios_busqueda es el del código escaneado?
export function envioCoincide(envio, codigo) {
  const c = norm(codigo);
  if (!c || !envio) return false;
  return [envio.tracking, envio.id_interno, envio.id_venta_ml].some((v) => norm(v) === c);
}

// Códigos que se pueden mandar en un filtro in.(...) de PostgREST sin romper la URL
export const codigoConsultable = (c) => /^[\w-]{4,80}$/.test(String(c || ""));

// Filtro or=(...) de envios_busqueda para una tanda de códigos
export function filtroEnvios(codigos) {
  const lista = [...new Set(codigos.filter(codigoConsultable))].map((c) => `"${c}"`).join(",");
  if (!lista) return null;
  return `or=(tracking.in.(${lista}),id_interno.in.(${lista}),id_venta_ml.in.(${lista}))`;
}

// Datos que se guardan en doble_bultos al cruzar con un envío
export function datosDeEnvio(e) {
  return {
    id_interno: e.id_interno || null,
    cliente: e.razon_social || null,
    direccion: e.direccion || null,
    localidad: e.localidad || null,
    cp: e.cp || null,
  };
}

// Fecha y hora de Argentina (UTC-3, sin horario de verano)
const enAR = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t - 3 * 3600e3) : null; };
export function fechaCorta(iso) {
  const d = enAR(iso);
  return d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "";
}
export function horaCorta(iso) {
  const d = enAR(iso);
  return d ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : "";
}

// Inicio de cada rango (ISO UTC) — "semana" arranca el lunes, como en Liquidaciones
export function desdeRango(rango, ahora = Date.now()) {
  const d = new Date(ahora - 3 * 3600e3); // reloj AR expresado en UTC
  d.setUTCHours(0, 0, 0, 0);
  const lunes = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
  let ini;
  if (rango === "hoy") ini = d;
  else if (rango === "semana") ini = lunes;
  else if (rango === "pasada") ini = new Date(lunes.getTime() - 7 * 864e5);
  else ini = new Date(d.getTime() - 30 * 864e5);
  return new Date(ini.getTime() + 3 * 3600e3).toISOString();
}
// Fin del rango (solo "semana pasada" tiene tope: el lunes de esta semana)
export function hastaRango(rango, ahora = Date.now()) {
  return rango === "pasada" ? desdeRango("semana", ahora) : null;
}

// Una fila sin datos de LightData después de 3 días ya no "va a aparecer sola"
export const DIAS_SIN_DATOS = 3;
export function estadoFila(f, ahora = Date.now()) {
  if (f.cruzado_at || f.direccion) return "ok";
  const dias = (ahora - Date.parse(f.escaneado_at)) / 864e5;
  return dias >= DIAS_SIN_DATOS ? "no_aparece" : "pendiente";
}

// Filas → texto para pegar en el Excel. Mismo orden de columnas que la planilla de siempre:
// FECHA · Cliente · Nro de venta · Dirección · Num bultos · Zona. Sin encabezado (se pega debajo).
const celda = (v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ").trim();
export function textoParaExcel(filas) {
  return filas
    .slice()
    .sort((a, b) => Date.parse(a.escaneado_at) - Date.parse(b.escaneado_at))
    .map((f) => [fechaCorta(f.escaneado_at), f.cliente, f.codigo, f.direccion, f.bultos, f.localidad].map(celda).join("\t"))
    .join("\n");
}

export function resumen(filas, ahora = Date.now()) {
  let bultos = 0, sinDatos = 0;
  for (const f of filas) { bultos += Number(f.bultos) || 0; if (estadoFila(f, ahora) !== "ok") sinDatos++; }
  return { paquetes: filas.length, bultos, sinDatos };
}

// Día (reloj AR) de una fila, como "2026-11-10" — para el filtro por día dentro de la semana
export function diaAR(iso) {
  const d = enAR(iso);
  return d ? d.toISOString().slice(0, 10) : "";
}
const DIAS_SEM = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
// Días del rango semanal para los chips: "semana" = lunes → hoy; "pasada" = lunes → domingo
export function diasDelRango(rango, ahora = Date.now()) {
  if (rango !== "semana" && rango !== "pasada") return [];
  const ini = new Date(new Date(desdeRango(rango, ahora)).getTime() - 3 * 3600e3);
  const hoy = new Date(ahora - 3 * 3600e3); hoy.setUTCHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ini.getTime() + i * 864e5);
    if (d > hoy) break;
    out.push({ dia: d.toISOString().slice(0, 10), label: `${DIAS_SEM[d.getUTCDay()]} ${d.getUTCDate()}` });
  }
  return out;
}

// Encabezado de cada día en la lista del celu: "Hoy · mar 10/11", "Ayer · lun 9/11", "vie 6/11"
export function etiquetaDia(iso, ahora = Date.now()) {
  const d = enAR(iso);
  if (!d) return "";
  const base = `${DIAS_SEM[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  const k = d.toISOString().slice(0, 10);
  const hoy = new Date(ahora - 3 * 3600e3).toISOString().slice(0, 10);
  const ayer = new Date(ahora - 3 * 3600e3 - 864e5).toISOString().slice(0, 10);
  return k === hoy ? `Hoy · ${base}` : k === ayer ? `Ayer · ${base}` : base;
}
