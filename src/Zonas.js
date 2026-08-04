import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getSession, authedFetch } from "./auth";
import { slaMeli } from "./slaShared";

// Zonas — saturación por TERRITORIO y por zona, EN VIVO (spec-zonas-en-vivo).
// Fuente: bridge del VPS GET /zonas (Excel de ENVIOS con Fecha Flexit = hoy, cache 5 min).
// v3 (feedback de Alejo 23/07):
//  - La vista por cadete del Excel NO sirve (las asignaciones rotan si alguien falta).
//    La unidad correcta es el TERRITORIO: el grupo de zonas que se hace junto
//    (ej. Recoleta + Retiro), definido en cadete_topes.zonas — estable aunque cambie quién lo corre.
//  - Atribución fina CP+localidad: 48 de 515 CPs están en varias zonas (CABA se pisa; ej. 1408 =
//    Liniers/Monte Castro/Versalles/Villa Luro/Villa Real). Con el CP solo, una zona chica se
//    llevaba todo el CP (Villa Real "32" cuando tenía 2 reales). Se desambigua con la localidad.

const BRIDGE_ZONAS_URL = "https://srv1801226.hstgr.cloud/bridge/zonas";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // misma key que Arribos (riesgo aceptado, ver spec-lightdata-bridge)
const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

const REFRESH_MS = 5 * 60 * 1000; // igual al cache del bridge
const UMBRAL_LIMITE = 0.85;       // ≥85% del tope = "al límite"

const C = {
  card: "#1A1A4A", cardAlt: "#12123A", border: "rgba(255,255,255,0.08)",
  text: "#fff", muted: "rgba(255,255,255,0.55)", faint: "rgba(255,255,255,0.35)",
  ok: "#2ECFAA", warn: "#EF9F27", crit: "#E24B4A",
};

const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n));
const horaAR = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// Hora AR real (no la del dispositivo): antes de las 14:30 la pantalla va en vivo; desde las 14:30, la foto del corte.
const CORTE_HHMM = 14 * 60 + 30; // 14:30 AR (spec-zonas-foto-1430)
const hoyARISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function minutosAR() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = +(p.find((x) => x.type === "hour").value), m = +(p.find((x) => x.type === "minute").value);
  return (h % 24) * 60 + m;
}
const fechaLargaAR = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(iso + "T12:00:00-03:00"));

async function supa(pathQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${pathQuery.split("?")[0]} → ${r.status}`);
  return r.json();
}

// Match zona↔localidad tolerante: "Santa Rita" (Excel) debe encontrar "Villa Santa Rita" (zona).
function matchNombre(nl, nz) {
  if (!nl || nl.length < 4) return false;
  return nz === nl || nz.includes(nl) || nl.includes(nz);
}

// Arma la vista "Por zona" desde un mapa zona -> {total, entregados}. (La vista principal ahora es Recorridos.)
// La usan tanto el modo EN VIVO (porZona del bridge) como el modo FOTO (por_zona del corte).
function construirVistas(porZona, mapas) {
  const { topeZona, zonaCadetes } = mapas;
  const conTope = [], sinTopeArr = [];
  for (const [zona, v] of Object.entries(porZona)) {
    const tope = topeZona.get(norm(zona));
    if (tope) {
      const pct = v.total / tope;
      conTope.push({ zona, ...v, tope, pct, estado: pct >= 1 ? "saturada" : pct >= UMBRAL_LIMITE ? "limite" : "ok", cadetes: zonaCadetes.get(norm(zona)) || [] });
    } else {
      sinTopeArr.push({ zona, ...v });
    }
  }
  conTope.sort((a, b) => b.pct - a.pct);
  sinTopeArr.sort((a, b) => b.total - a.total);
  const asignados = Object.values(porZona).reduce((a, v) => a + v.total, 0);
  return { conTope, sinTopeArr, asignados };
}

// ============ Calibrador de topes (spec-calibrador-topes, C1) ============
// La app PROPONE con evidencia; una persona aplica. Nada cambia sin click humano.
const CAL = {
  ventanaDias: 21,        // últimas 3 semanas
  minDiasTrab: 8,         // días trabajados en la ventana para opinar
  minDiasAlta: 4,         // días con carga ≥ tope+buffer y SLA alto para proponer SUBIR
  bufferAlta: 5,          // "carga alta" = carga ≥ tope + 5
  minMlDia: 10,           // un día cuenta solo si tuvo ≥10 envíos ML
  slaAltaMin: 98,         // SLA ≥98 en esos días de carga alta
  margenMediana: 10,      // tope propuesto ≤ mediana + 10 (anti-outlier)
  capSobreT: 15,          // tope propuesto ≤ tope + 15
  lunesPct: 0.70,         // ≥70% de los días de carga alta el mismo día → refuerzo, no suba
  pct90: 0.90,            // REVISAR: días con carga ≥ 90% del tope
  revisarSlaMax: 95,      // ...donde el SLA cayó <95%
  revisarMinDias: 2,      // en ≥2 días
  operativos: [/^repro gramar/i, /^quedo en el/i, /^devuelto deposito/i, /^⚠️/], // usuarios internos, no cadetes
};
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const slaMeliDia = slaMeli; // alias local histórico — la fórmula vive en slaShared.js
const round5 = (x) => Math.round(x / 5) * 5;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const percentil = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
const medianaArr = (arr) => percentil(arr, 0.5);
function confianza(nAlta, med, p90, nTrab) {
  const fa = clamp((nAlta - 4) / (8 - 4), 0, 1);                 // cantidad de días de carga alta
  const fb = med > 0 ? clamp(1 - (p90 - med) / med, 0, 1) : 0;    // estabilidad: p90 cerca de la mediana
  const fc = clamp((nTrab - 8) / (15 - 8), 0, 1);                // días trabajados
  const score = (fa + fb + fc) / 3;
  return { score, label: score >= 0.66 ? "Alta" : score >= 0.33 ? "Media" : "Baja", dots: Math.max(1, Math.round(score * 4)) };
}
// Devuelve {subir:[], lunes:[], revisar:[]} desde semanas (ventana) + topes + fleteros.
function calcularPropuestas(sem, topes, fleteros) {
  const topeMap = new Map();
  for (const t of topes) if (t.tope) topeMap.set(norm(t.cadete), { cadete: t.cadete, tope: t.tope });
  const byCad = new Map();
  for (const r of sem) {
    const nombre = String(r.cadete || "");
    if (CAL.operativos.some((re) => re.test(nombre.trim()))) continue;
    const k = norm(nombre);
    if (!topeMap.has(k) || fleteros.has(k)) continue;
    let c = byCad.get(k);
    if (!c) { const tm = topeMap.get(k); c = { cadete: tm.cadete, tope: tm.tope, dias: [] }; byCad.set(k, c); }
    const ml = r.envios_ml || 0;
    c.dias.push({ carga: r.cantidad || 0, ml, dem: r.demorados || 0, d21: r.dem21 || 0, sla: ml >= CAL.minMlDia ? slaMeliDia(ml, r.demorados || 0, r.dem21 || 0) : null, dow: new Date(r.fecha + "T12:00:00-03:00").getDay(), fecha: r.fecha });
  }
  const subir = [], lunes = [], revisar = [];
  for (const c of byCad.values()) {
    const T = c.tope, dias = c.dias, nTrab = dias.length;
    const cargas = dias.map((d) => d.carga);
    const prom = Math.round(cargas.reduce((a, b) => a + b, 0) / (nTrab || 1));
    const med = Math.round(medianaArr(cargas)), p90 = Math.round(percentil(cargas, 0.9)), maxc = Math.max(0, ...cargas);
    const diasSobre = dias.filter((d) => d.carga > T).length;
    const diasAlta = dias.filter((d) => d.carga >= T + CAL.bufferAlta && d.ml >= CAL.minMlDia && d.sla != null && d.sla >= CAL.slaAltaMin);
    const ev = { ventana_dias: CAL.ventanaDias, dias_trabajados: nTrab, dias_sobre_tope: diasSobre, promedio: prom, mediana: med, p90, maximo: maxc };
    // SUBIR / efecto lunes — elegible por días de carga alta
    if (nTrab >= CAL.minDiasTrab && diasAlta.length >= CAL.minDiasAlta) {
      // Efecto lunes primero: si la carga alta se concentra en un día, es refuerzo semanal, no suba
      // de tope permanente — y esto vale aunque el cap (mediana+10) frenaría la suba igual.
      const dowCount = {}; diasAlta.forEach((d) => { dowCount[d.dow] = (dowCount[d.dow] || 0) + 1; });
      const top = Object.entries(dowCount).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] / diasAlta.length >= CAL.lunesPct) {
        lunes.push({ cadete: c.cadete, T, dia: DOW[+top[0]], nAlta: diasAlta.length, nDia: top[1], ...ev });
      } else {
        const propuesto = round5(Math.min(p90, med + CAL.margenMediana, T + CAL.capSobreT));
        if (propuesto > T) {
          const aMl = diasAlta.reduce((a, d) => a + d.ml, 0), aDem = diasAlta.reduce((a, d) => a + d.dem, 0), aD21 = diasAlta.reduce((a, d) => a + d.d21, 0);
          const slaAlta = slaMeliDia(aMl, aDem, aD21);
          subir.push({ cadete: c.cadete, T, propuesto, slaAlta: slaAlta != null ? Math.round(slaAlta * 10) / 10 : null, diasAlta: diasAlta.length, conf: confianza(diasAlta.length, med, p90, nTrab), ev: { ...ev, dias_alta: diasAlta.length, sla_carga_alta: slaAlta != null ? Math.round(slaAlta * 10) / 10 : null, tope_anterior: T, tope_propuesto: propuesto } });
        }
      }
    }
    // REVISAR (nunca propone número)
    const dias90 = dias.filter((d) => d.carga >= CAL.pct90 * T && d.ml >= CAL.minMlDia && d.sla != null && d.sla < CAL.revisarSlaMax);
    if (dias90.length >= CAL.revisarMinDias) {
      revisar.push({ cadete: c.cadete, T, dias: dias90.sort((a, b) => a.fecha < b.fecha ? -1 : 1).map((d) => ({ fecha: d.fecha, carga: d.carga, sla: Math.round(d.sla * 10) / 10 })) });
    }
  }
  subir.sort((a, b) => b.conf.score - a.conf.score);
  revisar.sort((a, b) => b.dias.length - a.dias.length);
  return { subir, lunes, revisar };
}

// ============ Copiloto de Zonas (spec-zonas-copiloto-fase1 + spec-zonas-fijas) ============
// Determinístico: reglas + umbrales acá, textos por plantilla con números reales. Sin Claude API.
// El riesgo es por RECORRIDO contra su tope propio (el titular ya no existe como concepto).
// Umbrales del banco de pruebas (backtest 31/07, entrenado con mayo-junio y validado contra julio).
// El 100% que se usaba antes estaba en el peor punto de la curva: acertaba 36,7% y avisaba solo el
// 9,1% de los días que terminaron mal. Arriba del 115% la alerta acierta ~70%. Entre 85 y 115 la
// señal es ruido (1 de cada 3), así que deja de ser alarma y pasa a ser información.
const COP = {
  altoUtil: 1.15,          // 🔴 carga ≥ 115% de la capacidad — acierta ~7 de cada 10
  cargadoUtil: 0.85,       // ◍ 85–115%: "va cargado", informativo, SIN color de alarma
  vecinoUtilMax: 0.60,     // vecino "libre" para redistribuir: utilización < 60%
  vecinoMargenMin: 10,     // ...y con al menos 10 de margen (capacidad − carga)
};

// Bandas de riesgo por cadete. El banco mostró que saber QUIÉN sale predice ~3× mejor que cuánto
// lleva: en julio, un cadete de banda alta terminó con SLA<98 el 40% de los días y uno de banda
// baja el 12%. Y 3 de cada 4 días malos pasaron con la carga en niveles normales.
const BANDA = { ventanaDias: 60, minDias: 10, alta: 0.30, media: 0.15, minMl: 10, slaMalo: 98 };

// Los nombres de recorrido/persona son cortos ("Vani", "Gus") y en semanas están completos
// ("Vanina Barracas"). Match exacto y, si no, por contención — pero solo si es inequívoco.
function matchCadete(nombre, mapa) {
  const k = norm(nombre);
  if (!k) return null;
  if (mapa.has(k)) return mapa.get(k);
  const cands = [...mapa.keys()].filter((x) => x.includes(k) || k.includes(x));
  return cands.length === 1 ? mapa.get(cands[0]) : null;   // ambiguo ("Javier") → no se opina
}

// Peor banda entre la gente que corre el recorrido.
function bandaReco(t, bandas) {
  if (!bandas || !bandas.size) return null;
  const nombres = (t.personas && t.personas.length) ? t.personas.map((p) => p.cadete) : (t.chofer_ref ? [t.chofer_ref] : []);
  let peor = null;
  for (const n of nombres) {
    const b = matchCadete(n, bandas);
    if (b && (!peor || b.tasa > peor.tasa)) peor = { ...b, cadete: n };
  }
  return peor;
}
// Riesgo por RECORRIDO (spec-zonas-fijas): solo utilización contra su tope propio. Sin historial de titular.
function riesgoReco(t, banda) {
  const util = t.tope ? t.total / t.tope : null;
  if (!t.tope) return { nivel: "sindatos", util, banda, razones: ["sin capacidad configurada"] };
  const cargaTxt = `${Math.round(t.total)}/${t.tope} envíos (${Math.round(util * 100)}% de la capacidad)`;
  const alta = banda && banda.nivel === "alta";
  const histTxt = banda ? `${banda.cadete} viene con demoras el ${Math.round(banda.tasa * 100)}% de los días` : null;
  // Carga muy por encima: es la única señal de carga que el banco valida.
  if (util >= COP.altoUtil) return { nivel: "alto", util, banda, razones: [cargaTxt, "arriba del 115%: 7 de cada 10 veces termina con demoras"] };
  // Las dos señales débiles juntas sí valen: historial malo + carga por encima de lo normal.
  if (alta && util >= COP.cargadoUtil) return { nivel: "alto", util, banda, razones: [cargaTxt, histTxt] };
  if (alta) return { nivel: "medio", util, banda, razones: [histTxt, cargaTxt] };
  // 85–115% sin historial malo: informativo, NO alarma (acá caía Microcentro).
  if (util >= COP.cargadoUtil) return { nivel: "cargado", util, banda, razones: [cargaTxt] };
  return { nivel: "bajo", util, banda, razones: [] };
}
// Arma las barras por recorrido desde un mapa zona -> {total, entregados}. Zona en N recorridos → reparto en partes iguales.
// Devuelve las barras + las zonas con volumen que no caen en ningún recorrido activo (el agujero a vigilar).
function construirRecorridos(porZona, mapas) {
  const { recos, coberturaReco } = mapas;
  const cubiertas = new Set();
  const barras = recos.map((r) => {
    let total = 0, entregados = 0;
    for (const z of r.zonasList) {
      const k = norm(z); cubiertas.add(k);
      const v = porZona[z] || buscarZona(porZona, k); // porZona viene indexado por nombre exacto de zonas_cp
      if (!v) continue;
      const nCob = coberturaReco.get(k) || 1;      // zona en N recorridos → reparto en partes iguales
      total += v.total / nCob; entregados += (v.entregados || 0) / nCob;
    }
    return { ...r, total, entregados };
  });
  const zonasSinRecorrido = [];
  for (const [zona, v] of Object.entries(porZona)) {
    if ((v.total || 0) <= 0) continue;
    if (!cubiertas.has(norm(zona))) zonasSinRecorrido.push({ zona, total: v.total });
  }
  zonasSinRecorrido.sort((a, b) => b.total - a.total);
  return { barras, zonasSinRecorrido };
}
// porZona está indexado por el nombre exacto de zona (igual que en zonas_cp); resolvemos por norm por las dudas.
function buscarZona(porZona, k) {
  for (const [zona, v] of Object.entries(porZona)) if (norm(zona) === k) return v;
  return null;
}

export default function Zonas() {
  const [vista, setVista] = useState("recorrido"); // "recorrido" (carrito por zona) | "zona"
  const [recos, setRecos] = useState(null);        // barras por recorrido [{...recorrido, total, entregados}]
  const [zonasSinReco, setZonasSinReco] = useState([]); // zonas con volumen sin recorrido activo (el agujero)
  const [zonas, setZonas] = useState(null);       // [{zona, total, entregados, tope, pct, estado, cadetes}]
  const [sinTope, setSinTope] = useState([]);     // zonas con envíos pero sin tope configurado
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [sinEndpoint, setSinEndpoint] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState("");
  // Modo según la hora AR (spec-zonas-foto-1430): "vivo" antes de las 14:30, "foto" del corte desde las 14:30.
  const [modo, setModo] = useState(() => (minutosAR() >= CORTE_HHMM ? "foto" : "vivo"));
  const [escapeVivo, setEscapeVivo] = useState(false); // en modo foto, el usuario pidió ver el vivo igual (una consulta, sin refresco)
  const [fotoVacia, setFotoVacia] = useState(false);   // no hay ningún corte guardado todavía
  // Calibrador de topes (independiente del bridge; usa semanas + cadete_topes)
  const [propuestas, setPropuestas] = useState(null); // null=cargando, {subir,lunes,revisar}
  const [verVerdes, setVerVerdes] = useState(false);  // recorridos 🟢 colapsados por defecto
  const [verProp, setVerProp] = useState(false);      // bloque colapsado por defecto
  const [sesion] = useState(() => getSession());       // hay usuario logueado? (para el botón Aplicar)
  const [aplicando, setAplicando] = useState("");     // cadete que se está aplicando
  const [propErr, setPropErr] = useState("");
  // Editor de "quién corre este recorrido" (define la capacidad real del día)
  const [editReco, setEditReco] = useState(null);    // id del recorrido con el editor abierto
  const [gBusy, setGBusy] = useState(false);
  const [gErr, setGErr] = useState("");
  const [nuevoNom, setNuevoNom] = useState("");
  const [nuevoTope, setNuevoTope] = useState(50);
  const [bandas, setBandas] = useState(new Map()); // norm(cadete) -> {tasa, dias, nivel}
  const refMapas = useRef(null);

  // Mapas (zonas_cp + cadete_topes) — una sola vez por visita, los usan el vivo y la foto.
  const cargarMapas = useCallback(async () => {
    if (refMapas.current) return refMapas.current;
    const [zonasCP, topes, regiones, recorridos, personas] = await Promise.all([
      supa("zonas_cp?select=cp,zona&limit=10000"),
      supa("cadete_topes?select=cadete,tope,zonas&activo=eq.true&limit=1000"),
      supa("zonas_regiones?select=zona,region&limit=1000").catch(() => []),
      supa("recorridos?select=id,nombre,zonas,grupo,region,colecta,tope,chofer_ref&activo=eq.true&order=grupo.asc,nombre.asc&limit=1000").catch(() => []),
      supa("recorrido_personas?select=id,recorrido_id,cadete,tope,rol&activo=eq.true&order=rol.asc,cadete.asc&limit=2000").catch(() => []),
    ]);
    const regionZona = new Map(); // norm(zona) -> región (para la vecindad gruesa del copiloto)
    for (const z of (regiones || [])) regionZona.set(norm(z.zona), z.region);
    // Recorridos (spec-zonas-fijas): la unidad de la pantalla. Zonas parseadas + cobertura (zona en N recorridos → reparto en partes iguales).
    // Quién corre cada recorrido. La CAPACIDAD deja de ser el número escrito a mano en
    // recorridos.tope y pasa a ser la suma de los topes de su gente (titular + motos + refuerzos).
    // Antes, un recorrido con moto medía contra la capacidad de una sola persona y gritaba siempre:
    // Microcentro decía 40 de tope teniendo dos personas de 50 arriba.
    const personasPorReco = new Map();
    for (const pr of (personas || [])) {
      const arr = personasPorReco.get(pr.recorrido_id) || [];
      arr.push(pr); personasPorReco.set(pr.recorrido_id, arr);
    }
    const recos = (recorridos || []).map((r) => {
      const gente = personasPorReco.get(r.id) || [];
      const capacidad = gente.length ? gente.reduce((a, x) => a + (x.tope || 0), 0) : (r.tope || 0);
      return {
        ...r,
        zonasList: String(r.zonas || "").split(/[,/]/).map((z) => z.trim()).filter(Boolean),
        personas: gente,
        topeFijo: r.tope,     // el viejo número a mano, solo de referencia
        tope: capacidad,      // lo que mira todo el resto de la pantalla
      };
    });
    const coberturaReco = new Map(); // norm(zona) -> en cuántos recorridos activos está
    for (const r of recos) for (const z of r.zonasList) { const k = norm(z); coberturaReco.set(k, (coberturaReco.get(k) || 0) + 1); }
    const cpZonas = new Map();      // cp (dígitos) -> [zona, zona…]  (48/515 CPs tienen varias)
    const todasZonas = new Set();
    for (const z of zonasCP) {
      const digitos = String(z.cp).replace(/\D/g, "");
      if (!digitos) continue;
      const arr = cpZonas.get(digitos) || [];
      if (!arr.includes(z.zona)) arr.push(z.zona);
      cpZonas.set(digitos, arr);
      todasZonas.add(z.zona);
    }
    const topeZona = new Map();     // norm(zona) -> tope sumado (para la vista por zona)
    const zonaCadetes = new Map();  // norm(zona) -> cadetes que la hacen
    for (const t of topes) {
      if (!t.zonas) continue;
      for (const z of String(t.zonas).split(/[,/]/)) {
        const k = norm(z);
        if (!k) continue;
        topeZona.set(k, (topeZona.get(k) || 0) + (t.tope || 0));
        zonaCadetes.set(k, [...(zonaCadetes.get(k) || []), t.cadete]);
      }
    }
    // Etiquetas de recorrido que no existen en zonas_cp (lista de calidad de datos a): con el seed actual = ninguna.
    const labelsSinMatch = [...new Set(recos.flatMap((r) => r.zonasList).filter((z) => !todasZonas.has(z)))];
    // Sugerencias de gente para cada recorrido: cadetes cuyas zonas están TODAS dentro del
    // recorrido (regla estricta a propósito — un comodín como "Palermo, Recoleta, Colegiales,
    // Caballito" no se auto-sugiere en ninguno; ese lo suma Alejo a mano si corresponde).
    const sugeridosReco = new Map();
    for (const r of recos) {
      const setReco = new Set(r.zonasList.map(norm));
      if (!setReco.size) continue;
      const yaEstan = new Set((r.personas || []).map((x) => norm(x.cadete)));
      const sug = [];
      for (const t of topes) {
        if (!t.zonas) continue;
        const zc = String(t.zonas).split(/[,/]/).map((z) => norm(z.trim())).filter(Boolean);
        if (!zc.length || !zc.every((z) => setReco.has(z))) continue;
        if (yaEstan.has(norm(t.cadete))) continue;
        sug.push({ cadete: t.cadete, tope: t.tope || 50 });
      }
      if (sug.length) sugeridosReco.set(r.id, sug);
    }
    refMapas.current = { cpZonas, topeZona, zonaCadetes, topes, todasZonas: [...todasZonas], regionZona, recos, coberturaReco, labelsSinMatch, sugeridosReco };
    return refMapas.current;
  }, []);

  // MODO EN VIVO (antes de las 14:30): carga del día desde el bridge, refresco 5 min.
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const mapas = await cargarMapas();
      const r = await fetch(`${BRIDGE_ZONAS_URL}`, { headers: { "x-bridge-key": BRIDGE_KEY } });
      const j = await r.json().catch(() => null);
      if (r.status === 404 || (j && j.error === "ruta desconocida")) { setSinEndpoint(true); setError(null); return; }
      if (!r.ok || !j || (!j.porDet && !j.porCP)) throw new Error((j && j.error) || `bridge → ${r.status}`);
      setSinEndpoint(false);

      const { cpZonas, todasZonas } = mapas;
      const finoDisponible = !!j.porDet; // cp|localidad — necesita el bridge re-deployado

      // atribución envío→zona
      const porZona = {}; // zona -> {total, entregados}
      let sinZona = 0, sinCp = 0, ambiguos = 0;
      const suma = (zona, v) => { const n = porZona[zona] || (porZona[zona] = { total: 0, entregados: 0 }); n.total += v.t; n.entregados += v.e; };
      const entradas = finoDisponible ? Object.entries(j.porDet) : Object.entries(j.porCP);
      for (const [key, v] of entradas) {
        const [cp, loc] = finoDisponible ? key.split("|") : [key, ""];
        if (cp === "(sin cp)") { sinCp += v.t; continue; }
        const cands = cpZonas.get(cp) || [];
        const nl = norm(loc);
        let zona = null;
        if (cands.length === 1) {
          zona = cands[0];
        } else if (cands.length > 1) {
          if (!finoDisponible) {
            // Sin localidad (bridge viejo): repartir el CP compartido en partes iguales entre sus
            // zonas — aproximado pero visible. Jamás descartar (el 30% del volumen vive en estos CPs).
            for (const z of cands) suma(z, { t: v.t / cands.length, e: v.e / cands.length });
            continue;
          }
          const m = cands.filter((z) => matchNombre(nl, norm(z)));
          if (m.length === 1) zona = m[0];
          else if (m.length === 0) {
            // la localidad no matchea las zonas de ese CP: buscar por nombre en todas las zonas
            const g = todasZonas.filter((z) => matchNombre(nl, norm(z)));
            if (g.length === 1) zona = g[0]; else { ambiguos += v.t; continue; }
          } else { ambiguos += v.t; continue; }
        } else {
          // CP sin zona: última chance por nombre de localidad
          const g = finoDisponible ? todasZonas.filter((z) => matchNombre(nl, norm(z))) : [];
          if (g.length === 1) zona = g[0]; else { sinZona += v.t; continue; }
        }
        suma(zona, v);
      }

      const { conTope, sinTopeArr, asignados } = construirVistas(porZona, mapas);
      const { barras, zonasSinRecorrido } = construirRecorridos(porZona, mapas);
      setZonas(conTope);
      setSinTope(sinTopeArr);
      setRecos(barras);
      setZonasSinReco(zonasSinRecorrido);
      const cadetesSinZonas = mapas.topes.filter((t) => !t.zonas || !String(t.zonas).trim()).length;
      setMeta({ modo: "vivo", total: j.total, actualizado: j.actualizado, sinZona, sinCp, ambiguos, asignados, cadetesSinZonas, finoDisponible });
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  }, [cargarMapas]);

  // MODO FOTO (desde las 14:30): lee corte_dia (Supabase), congelado. Sin tocar el bridge.
  const cargarFoto = useCallback(async () => {
    setCargando(true);
    try {
      const mapas = await cargarMapas();
      const hoy = hoyARISO();
      const cols = "fecha,total,por_zona,zonas_alerta,actualizado_at";
      let filas = await supa(`corte_dia?select=${cols}&fecha=eq.${hoy}`);
      const esDeHoy = filas.length > 0;
      if (!esDeHoy) filas = await supa(`corte_dia?select=${cols}&order=fecha.desc&limit=1`);
      if (!filas.length) { setFotoVacia(true); setSinEndpoint(false); setError(null); return; }
      setFotoVacia(false);
      const corte = filas[0];
      // La foto trae por_zona = {zona: envíos} (enteros). No hay entregados ni detalle por CP.
      const porZona = {}; let sinZona = 0;
      for (const [z, n] of Object.entries(corte.por_zona || {})) {
        if (z === "(sin zona)") { sinZona += n; continue; }
        porZona[z] = { total: n, entregados: 0 };
      }
      const { conTope, sinTopeArr, asignados } = construirVistas(porZona, mapas);
      const { barras, zonasSinRecorrido } = construirRecorridos(porZona, mapas);
      setZonas(conTope);
      setSinTope(sinTopeArr);
      setRecos(barras);
      setZonasSinReco(zonasSinRecorrido);
      setMeta({ modo: "foto", total: corte.total, fecha: corte.fecha, actualizado: corte.actualizado_at, esDeHoy, asignados, sinZona, sinCp: 0, ambiguos: 0, cadetesSinZonas: 0, finoDisponible: true });
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  }, [cargarMapas]);

  useEffect(() => {
    if (modo === "vivo") {
      cargar();
      // Si mientras la pantalla está abierta cruza las 14:30, el próximo tick pasa a la foto.
      const t = setInterval(() => { if (minutosAR() >= CORTE_HHMM) setModo("foto"); else cargar(); }, REFRESH_MS);
      return () => clearInterval(t);
    }
    if (escapeVivo) { cargar(); return; } // foto + escape: una sola consulta en vivo, sin refresco
    cargarFoto();                          // foto: congelada, sin refresco
  }, [modo, escapeVivo, cargar, cargarFoto]);

  // Refresco manual (botón ⟳): re-lee lo que corresponde al modo actual, nunca el bridge en modo foto.
  const refrescar = () => ((modo === "vivo" || escapeVivo) ? cargar() : cargarFoto());

  // Calibrador: carga semanas (ventana) + topes + fleteros y calcula las propuestas (1 vez).
  const cargarPropuestas = useCallback(async () => {
    try {
      const cutoff = new Date(Date.now() - CAL.ventanaDias * 86400000).toISOString().slice(0, 10);
      const [sem, topes, tarifas] = await Promise.all([
        supa(`semanas?select=fecha,cadete,cantidad,demorados,dem21,envios_ml&fecha=gte.${cutoff}&limit=100000`),
        supa("cadete_topes?select=cadete,tope,backup&activo=eq.true&limit=1000"),
        supa("cadetes_tarifas?select=nombre,nombre_lightdata,fletero&limit=2000").catch(() => []),
      ]);
      const excluir = new Set(); // fleteros + suplentes (backup): no se les propone tocar el tope personal
      for (const t of (tarifas || [])) if (t.fletero) { if (t.nombre_lightdata) excluir.add(norm(t.nombre_lightdata)); if (t.nombre) excluir.add(norm(t.nombre)); }
      for (const t of (topes || [])) if (t.backup) excluir.add(norm(t.cadete));
      setPropuestas(calcularPropuestas(sem, topes, excluir));
    } catch (e) { setPropErr(String(e.message || e)); setPropuestas({ subir: [], lunes: [], revisar: [] }); }
  }, []);
  useEffect(() => { cargarPropuestas(); }, [cargarPropuestas]);

  // Historial por cadete: qué proporción de sus días terminó con SLA Meli < 98. Es la señal que
  // el banco de pruebas encontró más fuerte (3× la carga), así que entra al riesgo del recorrido.
  const cargarBandas = useCallback(async () => {
    try {
      const desde = new Date(Date.now() - BANDA.ventanaDias * 86400000).toISOString().slice(0, 10);
      const filas = await supa(`semanas?select=cadete,envios_ml,demorados,dem21&fecha=gte.${desde}&limit=100000`);
      const acc = new Map();
      for (const r of (filas || [])) {
        const ml = r.envios_ml || 0;
        if (ml < BANDA.minMl) continue;                       // días muy chicos no opinan
        const sla = slaMeli(ml, r.demorados, r.dem21);
        const k = norm(r.cadete);
        const a = acc.get(k) || { dias: 0, malos: 0 };
        a.dias++; if (sla < BANDA.slaMalo) a.malos++;
        acc.set(k, a);
      }
      const m = new Map();
      for (const [k, a] of acc) {
        if (a.dias < BANDA.minDias) continue;                 // sin recorrido suficiente, no se etiqueta
        const tasa = a.malos / a.dias;
        m.set(k, { tasa, dias: a.dias, nivel: tasa >= BANDA.alta ? "alta" : tasa >= BANDA.media ? "media" : "baja" });
      }
      setBandas(m);
    } catch { /* sin bandas la pantalla sigue funcionando solo con la carga */ }
  }, []);
  useEffect(() => { cargarBandas(); }, [cargarBandas]);

  async function aplicarPropuesta(p) {
    if (!sesion) return;
    setAplicando(p.cadete); setPropErr("");
    try {
      // 1) registrar el cambio (append-only). Si el registro falla, NO se aplica el tope.
      const rLog = await authedFetch(`${SUPABASE_URL}/rest/v1/topes_cambios`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ cadete: p.cadete, tope_anterior: p.T, tope_nuevo: p.propuesto, usuario: sesion.email, origen: "propuesta", evidencia: p.ev }]),
      });
      if (!rLog.ok) throw new Error(`no se pudo registrar el cambio (${rLog.status}) — el tope NO se tocó`);
      // 2) recién ahora actualizar el tope
      const rUp = await authedFetch(`${SUPABASE_URL}/rest/v1/cadete_topes?cadete=eq.${encodeURIComponent(p.cadete)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ tope: p.propuesto }),
      });
      if (!rUp.ok) throw new Error(`se registró el cambio pero no se pudo actualizar el tope (${rUp.status}) — revisar`);
      refMapas.current = null;
      await Promise.all([cargarPropuestas(), cargar()]);
    } catch (e) { setPropErr(String(e.message || e)); }
    finally { setAplicando(""); }
  }

  // ── Gente del recorrido: define la capacidad. Después de cada cambio se tiran los mapas
  //    cacheados y se recarga, para que el semáforo se recalcule con la capacidad nueva.
  const refrescarTrasCambio = useCallback(async () => {
    refMapas.current = null;
    if (modo === "vivo" || escapeVivo) await cargar(); else await cargarFoto();
  }, [modo, escapeVivo, cargar, cargarFoto]);

  const gentePost = useCallback(async (body) => {
    setGBusy(true); setGErr("");
    try {
      const r = await authedFetch(`${SUPABASE_URL}/rest/v1/recorrido_personas`, {
        method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      await refrescarTrasCambio();
    } catch (e) { setGErr("No se pudo guardar: " + String(e.message || e).slice(0, 160)); }
    finally { setGBusy(false); }
  }, [refrescarTrasCambio]);

  const gentePatch = useCallback(async (id, patch) => {
    setGBusy(true); setGErr("");
    try {
      const r = await authedFetch(`${SUPABASE_URL}/rest/v1/recorrido_personas?id=eq.${id}`, {
        method: "PATCH", body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(await r.text());
      await refrescarTrasCambio();
    } catch (e) { setGErr("No se pudo guardar: " + String(e.message || e).slice(0, 160)); }
    finally { setGBusy(false); }
  }, [refrescarTrasCambio]);

  const gentePop = useCallback(async (id) => {
    setGBusy(true); setGErr("");
    try {
      const r = await authedFetch(`${SUPABASE_URL}/rest/v1/recorrido_personas?id=eq.${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      await refrescarTrasCambio();
    } catch (e) { setGErr("No se pudo borrar: " + String(e.message || e).slice(0, 160)); }
    finally { setGBusy(false); }
  }, [refrescarTrasCambio]);

  // Copiloto: enriquece los RECORRIDOS con riesgo (util vs su tope) + recomendación (determinístico).
  const copiloto = useMemo(() => {
    if (!recos) return null;
    const base = recos.map((t) => ({ ...t, riesgo: riesgoReco(t, bandaReco(t, bandas)) }));
    // recomendación: necesita todos los utils/regiones para hallar recorrido vecino libre en la misma región
    const libres = base.filter((x) => x.tope && x.riesgo.util != null && x.riesgo.util < COP.vecinoUtilMax && (x.tope - x.total) >= COP.vecinoMargenMin);
    for (const t of base) {
      if (t.riesgo.nivel === "alto") {
        const cands = libres.filter((x) => x.region && x.region === t.region && x.nombre !== t.nombre)
          .sort((a, b) => (b.tope - b.total) - (a.tope - a.total)).slice(0, 2);
        t.reco = cands.length ? `Redistribuir hacia ${cands.map((c) => c.nombre).join(" o ")}` : "Sin capacidad libre en la región — evaluar refuerzo o segundo recorrido";
      } else if (t.riesgo.nivel === "medio") {
        t.reco = "Vigilar de cerca antes de la salida";
      } else t.reco = null;
    }
    const capList = base.filter((x) => x.tope && x.riesgo.util != null && x.riesgo.util < COP.vecinoUtilMax);
    const capLibre = { envios: Math.round(capList.reduce((a, x) => a + (x.tope - x.total), 0)), n: capList.length };
    const orden = { alto: 0, medio: 1 };
    const decisiones = base.filter((t) => t.riesgo.nivel === "alto" || t.riesgo.nivel === "medio")
      .sort((a, b) => (orden[a.riesgo.nivel] - orden[b.riesgo.nivel]) || ((b.riesgo.util ?? 0) - (a.riesgo.util ?? 0)));
    return { recos: base, decisiones, capLibre };
  }, [recos, bandas]);

  const colorEstado = (e) => (e === "saturada" ? C.crit : e === "limite" ? C.warn : e === "sintope" ? C.faint : C.ok);
  const f = norm(filtro);
  const esReco = vista === "recorrido";
  const zonasConSin = zonas ? [...zonas, ...sinTope.map((z) => ({ ...z, tope: null, pct: null, estado: "sintope", cadetes: [] }))] : [];
  const items = esReco ? [] : zonasConSin.filter((it) => !f || norm(it.zona).includes(f) || it.cadetes.some((c) => norm(c).includes(f)));
  const saturadas = esReco ? (copiloto ? copiloto.decisiones.filter((d) => d.riesgo.nivel === "alto").length : 0) : zonasConSin.filter((x) => x.estado === "saturada").length;
  const alLimite = esReco ? (copiloto ? copiloto.decisiones.filter((d) => d.riesgo.nivel === "medio").length : 0) : zonasConSin.filter((x) => x.estado === "limite").length;

  // Recorridos del copiloto filtrados por el buscador (para el detalle de abajo en la vista Recorridos).
  const recoCop = copiloto ? copiloto.recos.filter((t) => !f || norm(t.nombre).includes(f) || norm(t.chofer_ref || "").includes(f)) : [];
  const recoVerdes = recoCop.filter((t) => t.riesgo.nivel === "bajo" || t.riesgo.nivel === "cargado");
  const recoSinDatos = recoCop.filter((t) => t.riesgo.nivel === "sindatos");
  const labelsSinMatch = (refMapas.current && refMapas.current.labelsSinMatch) || []; // calidad de datos (a)

  const badgeRiesgo = (nivel) => nivel === "alto" ? { t: "🔴 ALTO", c: C.crit } : nivel === "medio" ? { t: "🟡 MEDIO", c: C.warn }
    : nivel === "cargado" ? { t: "◍ va cargado", c: C.muted }   // informativo: no es alerta
    : nivel === "bajo" ? { t: "🟢 OK", c: C.ok } : { t: "⚪ sin capacidad", c: C.faint };
  // Tarjeta de recorrido enriquecida (riesgo por utilización + recomendación). El cadete es circunstancial: solo referencia de planilla.
  const tarjetaReco = (it) => {
    const rz = it.riesgo, badge = badgeRiesgo(rz.nivel), col = badge.c;
    const ancho = Math.min(rz.util ?? 0, 1.2) / 1.2;
    const gente = it.personas || [];
    const abierto = editReco === it.id;
    const sug = (refMapas.current && refMapas.current.sugeridosReco && refMapas.current.sugeridosReco.get(it.id)) || [];
    return (
      <div key={it.nombre} style={{ background: C.card, border: `1px solid ${rz.nivel === "alto" ? "rgba(226,75,74,0.45)" : C.border}`, borderRadius: 12, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{it.nombre}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: col }}>{badge.t}</span>
          {it.colecta === false && <span style={{ fontSize: 10.5, color: C.faint, border: `1px solid ${C.border}`, borderRadius: 999, padding: "1px 7px" }}>sin colecta</span>}
          {/* Historial de quien lo corre: la señal más fuerte según el banco de pruebas. Es contexto,
              no una alarma — por eso va como chip y no cambia el color del recorrido por sí solo. */}
          {rz.banda && (
            <span title={`${rz.banda.cadete}: ${Math.round(rz.banda.tasa * 100)}% de sus últimos ${rz.banda.dias} días terminaron con SLA Meli por debajo de 98`}
              style={{ fontSize: 10.5, borderRadius: 999, padding: "1px 8px", fontWeight: 600,
                border: `1px solid ${rz.banda.nivel === "alta" ? "rgba(226,75,74,0.45)" : rz.banda.nivel === "media" ? "rgba(239,159,39,0.40)" : C.border}`,
                background: rz.banda.nivel === "alta" ? "rgba(226,75,74,0.12)" : rz.banda.nivel === "media" ? "rgba(239,159,39,0.10)" : "transparent",
                color: rz.banda.nivel === "alta" ? C.crit : rz.banda.nivel === "media" ? C.warn : C.faint }}>
              histórico {Math.round(rz.banda.tasa * 100)}%
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
            <b>{num(it.total)}</b>{it.tope ? <span style={{ color: C.muted }}> / {num(it.tope)}</span> : null}
          </span>
        </div>
        {/* Quién lo corre = de dónde sale la capacidad. Es el dato que faltaba: con una moto
            sumada, el mismo volumen deja de ser "alto". */}
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>
            {gente.length
              ? <>Lo corren: {gente.map((g) => `${g.cadete}${g.rol === "moto" ? " 🛵" : g.rol === "refuerzo" ? " (refuerzo)" : ""} ${g.tope}`).join(" · ")}</>
              : <>ref. planilla: {it.chofer_ref || "—"}</>}
          </span>
          {sesion && (
            <button type="button" onClick={() => { setEditReco(abierto ? null : it.id); setGErr(""); setNuevoNom(""); setNuevoTope(50); }}
              style={{ border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)", color: abierto ? C.ok : C.muted, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {abierto ? "listo" : "editar equipo"}
            </button>
          )}
          {sug.length > 0 && !abierto && (
            <span style={{ color: C.warn }}>· {sug.length} sin sumar</span>
          )}
        </div>

        {abierto && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: C.cardAlt }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>
              Quién corre este recorrido — la suma de los topes es la capacidad
            </div>
            {gente.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 130, fontSize: 12.5, fontWeight: 600 }}>{g.cadete}</span>
                {["titular", "refuerzo", "moto"].map((r) => (
                  <button key={r} type="button" disabled={gBusy} onClick={() => gentePatch(g.id, { rol: r })}
                    style={{ border: `1px solid ${g.rol === r ? C.ok : C.border}`, background: g.rol === r ? "rgba(46,207,170,0.14)" : "transparent", color: g.rol === r ? C.ok : C.faint, borderRadius: 999, padding: "2px 9px", fontSize: 10.5, fontWeight: 600, cursor: "pointer" }}>
                    {r === "moto" ? "🛵 moto" : r}
                  </button>
                ))}
                <input type="number" defaultValue={g.tope} min={0} max={300} disabled={gBusy}
                  onBlur={(e) => { const v = Math.max(0, Math.min(300, +e.target.value || 0)); if (v !== g.tope) gentePatch(g.id, { tope: v }); }}
                  style={{ width: 58, padding: "3px 6px", borderRadius: 7, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.25)", color: C.text, fontSize: 12, textAlign: "right" }} />
                <button type="button" disabled={gBusy} onClick={() => gentePop(g.id)} title="Sacar del recorrido"
                  style={{ border: "none", background: "none", color: "rgba(255,255,255,0.28)", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
            ))}

            {sug.length > 0 && (
              <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
                  Ya están cargados en topes con estas zonas y no figuran acá:
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {sug.map((x) => (
                    <button key={x.cadete} type="button" disabled={gBusy}
                      onClick={() => gentePost({ recorrido_id: it.id, cadete: x.cadete, tope: x.tope, rol: "refuerzo" })}
                      style={{ border: `1px solid ${C.warn}55`, background: "rgba(239,159,39,0.10)", color: C.warn, borderRadius: 999, padding: "3px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                      + {x.cadete} · {x.tope}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input value={nuevoNom} onChange={(e) => setNuevoNom(e.target.value)} placeholder="sumar otra persona o moto…"
                style={{ flex: 1, minWidth: 150, padding: "5px 9px", borderRadius: 8, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.25)", color: C.text, fontSize: 12.5 }} />
              <input type="number" value={nuevoTope} min={0} max={300} onChange={(e) => setNuevoTope(+e.target.value || 0)}
                style={{ width: 62, padding: "5px 7px", borderRadius: 8, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.25)", color: C.text, fontSize: 12.5, textAlign: "right" }} />
              <button type="button" disabled={gBusy || !nuevoNom.trim()}
                onClick={() => { gentePost({ recorrido_id: it.id, cadete: nuevoNom.trim(), tope: nuevoTope, rol: "moto" }); setNuevoNom(""); }}
                style={{ border: `1px solid ${C.ok}`, background: "rgba(46,207,170,0.12)", color: C.ok, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: nuevoNom.trim() ? "pointer" : "default" }}>
                🛵 Sumar
              </button>
            </div>
            {gErr && <div style={{ color: C.crit, fontSize: 11.5, marginTop: 7 }}>{gErr}</div>}
            {gente.length === 0 && <div style={{ color: C.warn, fontSize: 11.5, marginTop: 7 }}>Sin gente cargada — se está usando el tope fijo de {num(it.topeFijo || 0)}.</div>}
          </div>
        )}
        {rz.razones.filter(Boolean).length > 0 && <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 4, lineHeight: 1.5 }}>{rz.razones.filter(Boolean).join(" · ")}</div>}
        {it.reco && <div style={{ fontSize: 12, color: rz.nivel === "alto" ? "#f1a2a1" : "#f3c886", marginBottom: 6, fontWeight: 600 }}>→ {it.reco}</div>}
        {it.tope ? (
          <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
            <div style={{ width: `${(ancho * 100).toFixed(1)}%`, height: "100%", borderRadius: 4, background: col === C.faint ? C.muted : col, transition: "width .5s" }} />
            <div style={{ position: "absolute", left: `${((1 / 1.2) * 100).toFixed(1)}%`, top: 0, bottom: 0, width: 2, background: "rgba(255,255,255,0.35)" }} />
          </div>
        ) : null}
      </div>
    );
  };

  if (sinEndpoint) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, maxWidth: 620 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>El bridge todavía no tiene el endpoint de zonas</div>
        <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
          El código ya está en el repo del vault (<code>vps/lightdata-bridge.js</code>) — falta correr el deploy en el VPS.
          Mandale a Hermes el mensaje <b>mensaje-hermes-zonas.md</b> del vault y esta pantalla arranca sola.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {meta && (
          <>
            {meta.modo === "foto" ? (
              <span style={{ fontSize: 13, color: C.muted }}>
                📸 <b style={{ color: C.text }}>Foto del corte {fechaLargaAR(meta.fecha)} 14:30</b> · <b style={{ color: C.text }}>{num(meta.total)}</b> envíos (todos los estados) · <b style={{ color: C.text }}>{num(meta.asignados)}</b> ubicados en zonas · congelado, sin refresco
              </span>
            ) : (
              <span style={{ fontSize: 13, color: C.muted }}>
                <b style={{ color: C.text }}>{num(meta.total)}</b> envíos hoy (todos los estados, Fecha Flexit) · <b style={{ color: C.text }}>{num(meta.asignados)}</b> ubicados en zonas · dato de las <b style={{ color: C.text }}>{horaAR(meta.actualizado)}</b>{escapeVivo ? " · en vivo (una consulta)" : " · refresco 5 min"}
              </span>
            )}
            <span style={{ fontSize: 12.5, padding: "3px 10px", borderRadius: 999, background: "rgba(226,75,74,0.12)", color: C.crit, fontWeight: 700 }}>🔴 {saturadas} saturados</span>
            <span style={{ fontSize: 12.5, padding: "3px 10px", borderRadius: 999, background: "rgba(239,159,39,0.12)", color: C.warn, fontWeight: 700 }}>🟠 {alLimite} al límite</span>
          </>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
            {[["recorrido", "Recorridos"], ["zona", "Por zona"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setVista(k)}
                style={{ background: vista === k ? "rgba(46,207,170,0.15)" : "none", border: "none", color: vista === k ? C.ok : C.muted, padding: "7px 12px", fontSize: 13, fontWeight: vista === k ? 700 : 500, cursor: "pointer" }}>
                {lbl}
              </button>
            ))}
          </div>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar zona o cadete…"
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, padding: "7px 12px", fontSize: 13, width: 160 }} />
          <button onClick={refrescar} disabled={cargando} title={meta && meta.modo === "foto" && !escapeVivo ? "Volver a leer la foto del corte" : "Actualizar ahora"}
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.muted, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>
            {cargando ? "…" : "⟳"}
          </button>
        </div>
      </div>

      {/* Modo foto (spec-zonas-foto-1430): banner explicativo + escape a vivo */}
      {meta && meta.modo === "foto" && (
        <div style={{ background: "rgba(46,207,170,0.10)", border: "1px solid rgba(46,207,170,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#bfeee0", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ lineHeight: 1.5, flex: 1, minWidth: 220 }}>
            {meta.esDeHoy
              ? <>📸 <b>Foto de las 14:30</b> — con esto salieron los cadetes. Los ingresos de la tarde entran como día siguiente, por eso la pantalla queda congelada en el corte.</>
              : <>📸 Todavía no hay corte de hoy. Te muestro la <b>última foto disponible: {fechaLargaAR(meta.fecha)} 14:30</b>. Los ingresos posteriores son de días siguientes.</>}
          </span>
          <button onClick={() => setEscapeVivo(true)} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>ver dato en vivo igual</button>
        </div>
      )}
      {meta && meta.modo === "vivo" && escapeVivo && (
        <div style={{ background: "rgba(239,159,39,0.10)", border: "1px solid rgba(239,159,39,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f3c886", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ lineHeight: 1.5, flex: 1, minWidth: 220 }}>⚠️ <b>Dato en vivo después del corte.</b> Desde las 14:30 LightData suma ingresos de ecommerce que son del día siguiente — este número ya no representa lo que salió a reparto. Una sola consulta, sin refresco.</span>
          <button onClick={() => setEscapeVivo(false)} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>volver a la foto</button>
        </div>
      )}

      {/* === Zonas con volumen sin recorrido (spec-zonas-fijas) — el agujero, siempre visible arriba === */}
      {zonasSinReco.length > 0 && (
        <div style={{ background: "rgba(226,75,74,0.10)", border: "1px solid rgba(226,75,74,0.40)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f1a2a1", marginBottom: 14, lineHeight: 1.5 }}>
          ⚠️ <b>Volumen sin recorrido asignado</b> ({num(zonasSinReco.reduce((a, z) => a + z.total, 0))} envíos en {zonasSinReco.length} {zonasSinReco.length === 1 ? "zona" : "zonas"}): {zonasSinReco.map((z) => `${z.zona} (${num(z.total)})`).join(" · ")}. No le corresponde a ningún carrito — hay que crear el recorrido o sumarla a uno.
        </div>
      )}

      {/* === Centro de decisiones (spec-zonas-copiloto-fase1 / recableado a recorridos) — arriba de todo === */}
      {copiloto && (
        <div style={{ background: C.card, border: `1px solid ${copiloto.decisiones.length ? "rgba(239,159,39,0.35)" : "rgba(46,207,170,0.30)"}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>
              {copiloto.decisiones.length
                ? `${copiloto.decisiones.length} ${copiloto.decisiones.length === 1 ? "decisión" : "decisiones"} hoy: ${copiloto.decisiones.map((d) => `${d.nombre} (${d.riesgo.nivel})`).join(" · ")}`
                : "✅ Sin decisiones pendientes: todos los recorridos en orden"}
            </span>
            {copiloto.capLibre.n > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted, padding: "3px 10px", borderRadius: 999, background: "rgba(46,207,170,0.10)" }}>
                Capacidad libre: ~{num(copiloto.capLibre.envios)} envíos en {copiloto.capLibre.n} recorridos <span style={{ color: C.faint }}>(aprox.)</span>
              </span>
            )}
          </div>
          {copiloto.decisiones.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {copiloto.decisiones.map((it) => tarjetaReco(it))}
            </div>
          )}
        </div>
      )}

      {/* === Calibrador de topes: propuestas con evidencia (spec-calibrador-topes, C1) === */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14 }}>
        <div onClick={() => setVerProp((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", cursor: "pointer" }}>
          <span style={{ color: C.ok, fontSize: 13 }}>{verProp ? "▾" : "▸"}</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🎯 Propuestas de tope</span>
          <span style={{ fontSize: 12, color: C.muted }}>· la app propone con evidencia, vos aplicás</span>
          {propuestas && (() => { const n = propuestas.subir.length + propuestas.lunes.length + propuestas.revisar.length; return <span style={{ marginLeft: "auto", fontSize: 12, color: n ? C.ok : C.muted, fontWeight: 700 }}>{n ? `${n}` : "sin propuestas"}</span>; })()}
        </div>
        {verProp && (
          <div style={{ padding: "0 14px 12px" }}>
            {propuestas == null ? (
              <div style={{ fontSize: 12.5, color: C.muted }}>Calculando…</div>
            ) : (propuestas.subir.length + propuestas.lunes.length + propuestas.revisar.length) === 0 ? (
              <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>Sin propuestas por ahora — los topes están bien calibrados para la carga de las últimas 3 semanas. {propErr ? <span style={{ color: C.crit }}>({propErr})</span> : null}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {!sesion && <div style={{ fontSize: 11.5, color: "#f3c886" }}>Iniciá sesión (Tiquetera/Colectas) para poder aplicar los cambios.</div>}
                {propErr && <div style={{ fontSize: 11.5, color: C.crit }}>{propErr}</div>}
                {propuestas.subir.map((p) => (
                  <div key={"s" + p.cadete} style={{ border: "1px solid rgba(46,207,170,0.35)", background: "rgba(46,207,170,0.06)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>⬆️ {p.cadete} — subir tope {p.T} → {p.propuesto}</span>
                      <span style={{ fontSize: 11.5, color: C.muted }}>· Confianza: {"●".repeat(p.conf.dots)}{"○".repeat(4 - p.conf.dots)} {p.conf.label}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>{p.ev.dias_trabajados} días trabajados · {p.ev.dias_sobre_tope} sobre el tope · promedio {p.ev.promedio} · mediana {p.ev.mediana} · p90 {p.ev.p90} · máximo {p.ev.maximo} · SLA en días de carga alta {p.slaAlta != null ? p.slaAlta + "%" : "—"}</div>
                    {sesion && <button onClick={() => aplicarPropuesta(p)} disabled={aplicando === p.cadete} style={{ marginTop: 8, background: "rgba(46,207,170,0.16)", border: `1px solid ${C.ok}`, borderRadius: 8, color: C.ok, fontSize: 12.5, fontWeight: 700, padding: "5px 14px", cursor: "pointer" }}>{aplicando === p.cadete ? "Aplicando…" : "Aplicar"}</button>}
                  </div>
                ))}
                {propuestas.lunes.map((p) => (
                  <div key={"l" + p.cadete} style={{ border: "1px solid rgba(239,159,39,0.35)", background: "rgba(239,159,39,0.06)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>📅 {p.cadete} — carga alta concentrada los {p.dia}s</div>
                    <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>{p.nDia} de {p.nAlta} días de carga alta fueron {p.dia}s → un tope general no lo arregla; conviene revisar un refuerzo de {p.dia}s. (Tope {p.T} · promedio {p.ev.promedio} · p90 {p.ev.p90})</div>
                  </div>
                ))}
                {propuestas.revisar.map((p) => (
                  <div key={"r" + p.cadete} style={{ border: "1px solid rgba(226,75,74,0.35)", background: "rgba(226,75,74,0.06)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>⚠️ {p.cadete} — revisar: bajar tope o sumar refuerzo</div>
                    <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>En {p.dias.length} días con carga ≥90% del tope ({p.T}) el SLA cayó &lt;95%: {p.dias.map((d) => `${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)} (${d.carga} env, ${d.sla}%)`).join(" · ")}. Bajar el tope es decisión tuya — los datos muestran cuánto llevan, no cuánto aguantan.</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>Ventana: últimas 3 semanas de <code>semanas</code>. SUBIR = días sostenidos por encima del tope con SLA ≥98% (tope propuesto = mín(p90, mediana+10, tope+15)). REVISAR nunca propone número. Fleteros, suplentes (backup) y usuarios internos quedan afuera. Cada cambio aplicado queda registrado en <code>topes_cambios</code>. Ojo: este es el <b>tope personal del cadete</b> (para su rendimiento) — no es el tope del recorrido/carrito, que se ajusta aparte.</div>
          </div>
        )}
      </div>

      {meta && !meta.finoDisponible && (
        <div style={{ background: "rgba(239,159,39,0.10)", border: "1px solid rgba(239,159,39,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f3c886", marginBottom: 14 }}>
          ⚠️ Números aproximados: los CPs que pertenecen a varias zonas (48 de 515, ~30% del volumen) se están repartiendo en partes iguales entre ellas. Con el re-deploy del bridge (mensaje-hermes-zonas.md) la atribución pasa a CP + localidad y queda exacta.
        </div>
      )}

      {error && (
        <div style={{ background: "rgba(226,75,74,0.10)", border: "1px solid rgba(226,75,74,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f1a2a1", marginBottom: 14 }}>
          No pude actualizar recién ({error}). {(recos && recos.length) || zonasConSin.length ? "Muestro el último dato bueno." : "Reintento solo en unos minutos."}
        </div>
      )}

      {fotoVacia && (
        <div style={{ color: C.muted, fontSize: 14, padding: "20px 0", lineHeight: 1.6 }}>
          Todavía no hay ningún corte guardado en la base. La foto de las 14:30 aparece cuando corra el primer corte del día.{" "}
          <button onClick={() => setEscapeVivo(true)} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12.5, padding: "4px 10px", cursor: "pointer" }}>ver dato en vivo</button>
        </div>
      )}

      {!zonas && !fotoVacia && cargando && (
        <div style={{ color: C.muted, fontSize: 14, padding: "30px 0" }}>{modo === "foto" && !escapeVivo ? "Cargando la foto del corte…" : "Cargando el listado del día… la primera vez puede tardar un minuto (baja el Excel completo de LightData)."}</div>
      )}

      {zonas && (
        <>
          {esReco && copiloto ? (
            /* Vista Recorridos: las decisiones (ALTO/MEDIO) ya están arriba; acá el resto. */
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recoSinDatos.map((it) => tarjetaReco(it))}
              {recoVerdes.length > 0 && (
                <details open={verVerdes} onToggle={(e) => setVerVerdes(e.currentTarget.open)}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text, padding: "6px 2px" }}>
                    🟢 {recoVerdes.length} recorridos sin intervención (ver)
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>{recoVerdes.map((it) => tarjetaReco(it))}</div>
                </details>
              )}
              {recoCop.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "16px 4px" }}>Nada coincide con la búsqueda.</div>}
            </div>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it) => {
              const nombre = it.zona;
              const sub = (it.cadetes.length ? "La hacen: " + it.cadetes.join(" · ") : "");
              const col = colorEstado(it.estado);
              const pct = it.pct ?? 0;
              const ancho = Math.min(pct, 1.2) / 1.2;
              return (
                <div key={nombre} style={{ background: C.card, border: `1px solid ${it.estado === "saturada" ? "rgba(226,75,74,0.45)" : C.border}`, borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{nombre}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: col }}>
                      {it.estado === "saturada" ? "🔴 SATURADO" : it.estado === "limite" ? "🟠 AL LÍMITE" : it.estado === "sintope" ? "sin tope" : "🟢 OK"}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                      <b>{num(it.total)}</b>{it.tope ? <span style={{ color: C.muted }}> / {num(it.tope)}</span> : null}
                      {meta && meta.modo !== "foto" && <span style={{ color: C.faint, fontSize: 12.5 }}> · {num(it.entregados)} entregados</span>}
                    </span>
                  </div>
                  {sub && <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>{sub}</div>}
                  {it.tope ? (
                    <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
                      <div style={{ width: `${(ancho * 100).toFixed(1)}%`, height: "100%", borderRadius: 4, background: col === C.faint ? C.muted : col, transition: "width .5s" }} />
                      <div style={{ position: "absolute", left: `${((1 / 1.2) * 100).toFixed(1)}%`, top: 0, bottom: 0, width: 2, background: "rgba(255,255,255,0.35)" }} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {items.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "16px 4px" }}>Nada coincide con la búsqueda.</div>}
          </div>
          )}

          {(sinTope.length > 0 || labelsSinMatch.length > 0 || (meta && (meta.sinZona > 0 || meta.sinCp > 0 || meta.ambiguos > 0))) && (
            <details style={{ marginTop: 18, color: C.muted }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text }}>
                Datos sueltos ({num(sinTope.reduce((s, z) => s + z.total, 0) + (meta ? meta.sinZona + meta.sinCp + meta.ambiguos : 0))} envíos)
              </summary>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 8 }}>
                {labelsSinMatch.length > 0 && <div>⚠️ Etiquetas de recorrido que no existen en <code>zonas_cp</code> (no reciben volumen): {labelsSinMatch.join(", ")}.</div>}
                {sinTope.length > 0 && (
                  <div>Zonas sin tope de cadete (aparecen grises en "Por zona"): {sinTope.length} zonas, {num(sinTope.reduce((s2, z) => s2 + z.total, 0))} envíos.</div>
                )}
                {meta && meta.ambiguos > 0 && <div>Envíos en CPs compartidos cuya localidad no alcanzó para decidir la zona: {num(meta.ambiguos)} (quedan fuera de las barras — mejor faltar que inflar).</div>}
                {meta && meta.sinZona > 0 && <div>CPs que no matchean ninguna zona de <code>zonas_cp</code>: {num(meta.sinZona)} envíos.</div>}
                {meta && meta.sinCp > 0 && <div>Envíos sin CP en LightData: {num(meta.sinCp)}.</div>}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
