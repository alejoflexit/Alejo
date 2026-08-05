import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { authedFetch } from "./auth";
import { slaMeli } from "./slaShared";

// Pestaña "Análisis" — port del prototipo prototipos/panel-analisis.html a React.
// Datos: `semanas` (por cadete×día, prop desde App) + semanas_zonas y cadete_topes de Supabase.
// Regla de oro: una sola fórmula de SLA (slaMeli) usada en toda la pestaña.

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

// Umbrales calibrables (mismos valores que el prototipo aprobado 2026-07-23).
const CFG = {
  slaCritico: 95, slaOk: 98,
  minML: 30,            // mínimo de envíos ML para opinar sobre SLA
  minEntregados: 50,    // mínimo para opinar sobre post-21
  tarde_post21: 0.12,   // ≥12% de entregas post 21hs
  tarde_fin: 21 * 60 + 10, // fin de ruta promedio 21:10 o más tarde
  repro21_min: 3,       // al menos 3 repro-21 en el período
  repro21_frec: 0.30,   // ...en ≥30% de los días trabajados
  tope: 50,             // tope diario default
  sobrecarga: 45,       // promedio diario ≥45 (90% del tope)
  deltaSla: 1.5,        // pp para "en caída" / "mejorando"
  zonaMin: 50,          // envíos mínimos para opinar de una zona (anti-ruido)
  // --- Decisiones de la semana (v2) ---
  alertasMax: 5,        // máximo de alertas en "Atención prioritaria"
  regionFlecha: 0.5,    // pp de Δ vs período anterior para flecha ↑/↓ en las tarjetas de región
  regionFlecha2: 2,     // pp de caída para ↓↓ (región hundiéndose)
  // Severidad por tipo de señal (spec: crítico 3 / caída 2 / al límite–tarde–repro21 1).
  sev: { critico: 3, caida: 2, limite: 1, tarde: 1, repro: 1, locCritico: 2, locCaida: 1 },
  // Diccionario de acciones. `hoy` se usa en la semana en curso; `otro` en "Últimas 4"/"Todo".
  acciones: {
    critico: { hoy: "hablar hoy", otro: "revisar" },
    caida: { hoy: "hablar hoy", otro: "revisar" },
    repro: { hoy: "hablar hoy", otro: "revisar" },
    tarde: { hoy: "revisar ruta y hora de salida", otro: "revisar ruta y hora de salida" },
    limite: { hoy: "descargar carga", otro: "descargar carga" },
    zona: { hoy: "revisar zona", otro: "revisar zona" },
  },
};

const C = {
  bg: "#0D0D2B", card: "#1A1A4A", cardAlt: "#12123A", teal: "#2ECFAA", blue: "#3A8FD4",
  ink: "#FFFFFF", muted: "rgba(255,255,255,0.62)", faint: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.1)", good: "#2ECFAA", warn: "#E8B84B", crit: "#E5604D",
  dim: "rgba(255,255,255,0.16)", goodText: "#7FE3C9", critText: "#F2937F",
};

// ---- helpers ----
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
// Entradas que NO son cadetes reales (van a "Alertas operativas / calidad de datos", nunca al ranking).
const esBasura = (n) => /repro ?gramar/i.test(n) || /devuelto dep[oó]sito/i.test(n) || /qued[oó] en dep[oó]sito/i.test(n);
const claseOper = (n) => esSin(n) ? "sinAsignar" : /devuelto dep[oó]sito/i.test(n) ? "devuelto" : /qued[oó] en dep[oó]sito/i.test(n) ? "quedo" : /repro ?gramar/i.test(n) ? "repro" : "otros";
const esSin = (n) => n.startsWith("⚠️");
const fmtInt = (n) => (n == null ? "—" : Number(n).toLocaleString("es-AR"));
const fmt1 = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const fmtHora = (m) => (m == null ? "—" : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0"));
const hhmmToMin = (s) => { if (!s) return null; const p = String(s).split(":"); if (p.length < 2) return null; const h = +p[0], mi = +p[1]; return (isNaN(h) || isNaN(mi)) ? null : h * 60 + mi; };
const fmtSemLabel = (label) => (label ? String(label).split("-")[0] : "");
const mediana = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Mismo criterio de match localidad↔zona que src/Zonas.js (tolerante, contra los nombres de zonas_cp).
const normZ = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const matchZona = (nl, nz) => { if (!nl || nl.length < 4) return false; return nz === nl || nz.includes(nl) || nl.includes(nz); };
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS_SEM = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MES_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Rango compacto de un set de fechas ISO: "20–24 jul" (mismo mes) o "23 jun–19 jul".
function rangoFechas(fechas) {
  if (!fechas || !fechas.length) return "";
  const s = fechas.slice().sort();
  const [, am, ad] = s[0].split("-"); const [, bm, bd] = s[s.length - 1].split("-");
  return am === bm ? `${+ad}–${+bd} ${MES[+am - 1]}` : `${+ad} ${MES[+am - 1]}–${+bd} ${MES[+bm - 1]}`;
}

// La fórmula de SLA Meli ahora vive en slaShared.js (una sola definición para toda la app).
// --- histograma de entregas por hora (columna `horas`: {"18":12,"19":30,...}) ---
// Es lo que hace movible el corte del titular: no hay que reprocesar el Excel, se suma distinto.
function sumaHoras(dst, src) { if (!src) return dst; for (const k of Object.keys(src)) dst[k] = (dst[k] || 0) + (src[k] || 0); return dst; }
function totalHoras(h) { let t = 0; if (h) for (const k of Object.keys(h)) t += h[k] || 0; return t; }
// Entregas a partir del corte (>= corte) = "fuera de horario".
function fueraDeCorte(h, corte) { let t = 0; if (h) for (const k of Object.keys(h)) { if (+k >= corte) t += h[k] || 0; } return t; }
// % entregado ANTES del corte. null si esa fila/período todavía no tiene histograma cargado.
function antesDeCorte(h, corte) { const t = totalHoras(h); return t > 0 ? (t - fueraDeCorte(h, corte)) / t * 100 : null; }

function slaColor(s) { return s == null ? C.muted : s < CFG.slaCritico ? C.crit : s < CFG.slaOk ? C.warn : C.good; }
// Color de la lente "Horario": % de entregas antes de las 21. Mismo criterio que el semáforo de
// la tile Post-21 (CFG.tarde_post21 = 12% tarde / la mitad = en riesgo), dado vuelta.
function horColor(v) { return v == null ? C.muted : v <= 100 - CFG.tarde_post21 * 100 ? C.crit : v <= 100 - CFG.tarde_post21 * 50 ? C.warn : C.good; }

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
// Escrituras (seguimiento de decisiones). POST devuelve la fila creada; DELETE devuelve null.
// Escribe con la SESIÓN del usuario, no con la clave anónima: decisiones_seguimiento dejó de
// aceptar escritura anónima (auditoría 02/08 — cualquiera con la clave del bundle podía
// insertar y borrar filas). authedFetch ya refresca el token si venció.
async function sbWrite(path, method, body) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
// Fecha de HOY en Argentina (ISO YYYY-MM-DD) — no usar toISOString (es UTC y de noche salta de día).
const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

// Agrega `semanas` (por cadete×día) para un conjunto de labels de semana.
function aggWeeks(semanas, labelSet, topeMap) {
  const porCad = {};
  const g = { cant: 0, pend: 0, dem: 0, d21: 0, p21: 0, ml: 0, sin: 0, basura: 0, horas: {}, oper: { sinAsignar: 0, devuelto: 0, quedo: 0, repro: 0, otros: 0 } };
  for (const s of semanas) {
    if (!labelSet.has(s.label)) continue;
    for (const dia of s.dias) {
      for (const m of dia.datos) {
        const name = norm(m.cadete);
        g.cant += m.cantidad; g.pend += m.pendientes; g.dem += m.demorados;
        g.d21 += (m.dem21 || 0); g.p21 += (m.post21 || 0); g.ml += m.envios_ml; sumaHoras(g.horas, m.horas);
        if (esSin(name)) { g.sin += m.cantidad; g.oper.sinAsignar += m.cantidad; continue; }
        if (esBasura(name)) { g.basura += m.cantidad; g.oper[claseOper(name)] += m.cantidad; continue; }
        const c = porCad[name] || (porCad[name] = { name, cant: 0, pend: 0, dem: 0, d21: 0, p21: 0, ml: 0, dias: 0, dd21: 0, finSum: 0, finDias: 0, diasSobreTope: 0, diasDem: 0, diasP21: 0, diasCargaAlta: 0, ultInc: "", tope: topeMap[name] || CFG.tope });
        c.cant += m.cantidad; c.pend += m.pendientes; c.dem += m.demorados;
        c.d21 += (m.dem21 || 0); c.p21 += (m.post21 || 0); c.ml += m.envios_ml;
        c.dias += 1;
        if ((m.dem21 || 0) > 0) c.dd21 += 1;
        if ((m.demorados || 0) > 0 || (m.dem21 || 0) > 0) { c.diasDem += 1; if (dia.fecha > c.ultInc) c.ultInc = dia.fecha; }
        if ((m.post21 || 0) > 0) c.diasP21 += 1;
        const tope = topeMap[name] || CFG.tope;
        if (m.cantidad >= CFG.sobrecarga) c.diasCargaAlta += 1;
        if (m.cantidad > tope) c.diasSobreTope += 1;
        const fm = hhmmToMin(m.fin_ruta);
        if (fm != null) { c.finSum += fm; c.finDias += 1; }
      }
    }
  }
  const cads = Object.values(porCad).map((c) => {
    c.entregados = c.cant - c.pend; c.sla = slaMeli(c.ml, c.dem, c.d21);
    c.prom = c.dias > 0 ? c.cant / c.dias : 0;
    c.fin = c.finDias > 0 ? c.finSum / c.finDias : null;
    c.p21rate = c.entregados > 0 ? c.p21 / c.entregados : 0;
    c.pctSobreTope = c.dias > 0 ? c.diasSobreTope / c.dias : 0;
    return c;
  });
  g.entregados = g.cant - g.pend; g.sla = slaMeli(g.ml, g.dem, g.d21);
  g.p21rate = g.entregados > 0 ? g.p21 / g.entregados : 0;
  g.pendRate = g.cant > 0 ? g.pend / g.cant : 0;
  g.cadetes = cads.filter((c) => c.cant >= 10).length;
  return { g, cads };
}

// Agrega solo los primeros `nDays` días de una semana (para comparar "mismos días" contra la semana en curso).
function aggWeekFirstDays(semanas, label, nDays, topeMap) {
  const s = semanas.find((x) => x.label === label);
  if (!s) return null;
  return aggWeeks([{ ...s, dias: s.dias.slice(0, nDays) }], new Set([label]), topeMap);
}

// ---- subcomponentes chicos ----
// Sparkline de la tile: la forma del período adentro del número. El promedio tapa el pico
// (ej: post-21 al 11% el lunes y 4% el resto da 5,9% y parece una semana pareja).
// Sin ejes ni tooltip a propósito — es contexto, no un gráfico; el gráfico está en Tendencia.
function Spark({ vals, color, w = 62, h = 24 }) {
  const v = (vals || []).filter((x) => x != null && !isNaN(x));
  if (v.length < 3) return null;
  const mn = Math.min(...v), mx = Math.max(...v), r = (mx - mn) || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * (w - 2) + 1, h - 2 - ((x - mn) / r) * (h - 5)]);
  const d = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} style={{ flex: "0 0 auto", overflow: "visible" }} aria-hidden="true">
      <polygon points={`1,${h} ${d} ${w - 1},${h}`} fill={color} opacity="0.10" />
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.1" fill={color} />
    </svg>
  );
}

function Tile({ label, value, delta, dot, sub, onClick, open, spark }) {
  return (
    <div onClick={onClick} style={{ background: C.cardAlt, border: `1px solid ${onClick && open ? C.teal : C.border}`, borderRadius: 12, padding: "14px 16px", minWidth: 120, flex: "1 1 130px", cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block" }} />}
        {label}
        {onClick && <span style={{ marginLeft: "auto", color: C.teal, fontSize: 12 }}>{open ? "▾" : "▸"}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginTop: 4 }}>{value}</div>
          {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{sub}</div>}
          {delta}
        </div>
        {spark}
      </div>
    </div>
  );
}
function DeltaSpan({ delta, unidad, bueno, prevLbl }) {
  if (delta == null) return null;
  const up = delta >= 0;
  const good = up === (bueno === "up");
  return (
    <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
      <span style={{ color: good ? C.goodText : C.critText, fontWeight: 600 }}>
        {(up ? "+" : "−") + fmt1(Math.abs(delta)) + (unidad === "pp" ? " pp" : "")}
      </span>{" vs " + prevLbl}
    </div>
  );
}
// Fila de alerta del bloque "Atención prioritaria". Clickeable → abre el drill-down (Tarea 2).
function AlertRow({ a, onClick, abierto, seg }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 6px", borderTop: `1px solid ${C.faint}`, cursor: onClick ? "pointer" : "default", background: abierto ? "rgba(255,255,255,0.03)" : "transparent" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#F2953F", marginTop: 5, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
          {a.kind === "localidad" ? "📍 " : ""}{a.name} <span style={{ color: C.teal, fontWeight: 600 }}>· {a.accion}</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{a.motivo}</div>
        {seg}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", marginLeft: 8 }}>{a.dato}</div>
      {onClick && <span style={{ color: C.teal, fontSize: 12, marginLeft: 4, flex: "0 0 auto" }}>{abierto ? "▾" : "▸"}</span>}
    </div>
  );
}

// ---- Drill-down (Tarea 2) ----
// Acción fuerte (el "siguiente paso") por tipo de señal, para destacarla en el detalle del cadete.
const ACC_FUERTE = { critico: "🗣️ Hablar con cadete", caida: "🗣️ Hablar con cadete", repro: "🗣️ Revisar reprogramaciones", tarde: "🧭 Revisar ruta", limite: "📦 Redistribuir carga" };
const panelStyle = { background: C.cardAlt, border: `1px solid ${C.teal}`, borderRadius: 12, padding: "12px 14px", marginTop: 8 };
const fmtDDMM = (iso) => { const p = String(iso || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : iso; };
function Kv({ k, v, color }) {
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ fontSize: 10.5, color: C.muted }}>{k}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || C.ink, marginTop: 2 }}>{v}</div>
    </div>
  );
}
function DrillHead({ title, onClose }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, flex: 1 }}>{title}</div>
      <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12, padding: "3px 9px", cursor: "pointer" }}>Cerrar ✕</button>
    </div>
  );
}

// ---- Markdown mínimo (sin librerías): ##/# títulos, - listas, **negrita**, _itálica_ ----
function mdInline(text) {
  const out = []; let key = 0, last = 0, m;
  const re = /\*\*(.+?)\*\*|_(.+?)_/g;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<b key={key++}>{m[1]}</b>);
    else out.push(<i key={key++}>{m[2]}</i>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function Markdown({ md }) {
  const lines = String(md || "").split("\n");
  const blocks = []; let list = null;
  const flush = () => { if (list) { blocks.push(<ul key={"u" + blocks.length} style={{ margin: "4px 0 8px", paddingLeft: 18 }}>{list}</ul>); list = null; } };
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) { flush(); return; }
    if (t.startsWith("## ")) { flush(); blocks.push(<div key={i} style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 4px", color: C.ink }}>{mdInline(t.slice(3))}</div>); return; }
    if (t.startsWith("# ")) { flush(); blocks.push(<div key={i} style={{ fontSize: 15, fontWeight: 700, margin: "10px 0 6px", color: C.ink }}>{mdInline(t.slice(2))}</div>); return; }
    if (t.startsWith("- ") || t.startsWith("* ")) { if (!list) list = []; list.push(<li key={i} style={{ marginBottom: 3 }}>{mdInline(t.slice(2))}</li>); return; }
    flush(); blocks.push(<div key={i} style={{ margin: "3px 0", lineHeight: 1.55 }}>{mdInline(t)}</div>);
  });
  flush();
  return <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>{blocks}</div>;
}

// Parseo del informe del analista (markdown con secciones ## Titular / ## Que mirar / ## Zonas / ## A vigilar).
// Devuelve el titular, los ítems de "Que mirar" (nombre/señal/detalle/acción) y los textos de Zonas y A vigilar.
function parseInforme(md) {
  if (!md) return null;
  const secs = {}; let curSec = null;
  String(md).split("\n").forEach((line) => {
    const h = line.match(/^#{1,3}\s+(.+)/);
    if (h) { curSec = normZ(h[1]); secs[curSec] = []; return; }
    if (curSec) secs[curSec].push(line);
  });
  const get = (k) => (secs[k] || []).join("\n").trim();
  const qmRaw = get("que mirar") || get("qué mirar");
  const items = [];
  qmRaw.split(/\n(?=\d+\.\s)/).forEach((blk) => {
    const b = blk.trim(); if (!b || !/^\d+\./.test(b)) return;
    const bold = (b.match(/\*\*(.+?)\*\*/) || [])[1] || "";
    const partes = bold.split(/\s+[—-]\s+/);
    const accM = b.match(/Acci[oó]n:\s*([\s\S]+)$/i);
    const accion = accM ? accM[1].trim().replace(/\s+/g, " ") : "";
    let detalle = b.replace(/^\d+\.\s*/, "").replace(/\*\*(.+?)\*\*:?/, "").trim();
    const posAcc = detalle.search(/Acci[oó]n:/i);
    if (posAcc >= 0) detalle = detalle.slice(0, posAcc).trim();
    detalle = detalle.replace(/^[:\-\s]+/, "").replace(/\s+/g, " ");
    items.push({ bold, nombre: (partes[0] || bold).trim(), senal: (partes[1] || "").trim(), accion, detalle });
  });
  return { titular: get("titular"), items, zonas: get("zonas"), vigilar: get("a vigilar") };
}

// =================================================================
export default function Analisis({ semanas }) {
  const [zonasRaw, setZonasRaw] = useState(null); // null=cargando, []=vacío
  const [topeMap, setTopeMap] = useState({});
  const [zonaNames, setZonaNames] = useState([]); // nombres de zonas operativas (zonas_cp) para derivar "Zona op."
  const [regionMap, setRegionMap] = useState({}); // zona -> región (zonas_regiones), cargado 1 vez
  const [aliasMap, setAliasMap] = useState({}); // localidad_norm -> zona (localidad_zona_alias), overrides manuales
  const [zonasErr, setZonasErr] = useState("");
  const [informes, setInformes] = useState(null); // null=cargando, []=sin informes
  const [seguim, setSeguim] = useState(null); // seguimiento de decisiones (marcas "hecho"); null=cargando

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const z = await sbGet("semanas_zonas?select=fecha,label,localidad,localidad_norm,cantidad,entregados,pendientes,demorados,dem21,post21,envios_ml,nadie,sameday,zona_cp&order=fecha.asc&limit=100000");
        if (alive) setZonasRaw(Array.isArray(z) ? z : []);
      } catch (e) { if (alive) { setZonasRaw([]); setZonasErr(String(e.message || e)); } }
      try {
        const t = await sbGet("cadete_topes?select=cadete,tope&limit=1000");
        if (alive && Array.isArray(t)) { const m = {}; t.forEach((r) => { m[norm(r.cadete)] = r.tope; }); setTopeMap(m); }
      } catch (e) { /* topes best-effort */ }
      try {
        const zc = await sbGet("zonas_cp?select=zona&limit=10000");
        if (alive && Array.isArray(zc)) setZonaNames([...new Set(zc.map((r) => r.zona).filter(Boolean))]);
      } catch (e) { /* zona op. best-effort */ }
      try {
        const rr = await sbGet("zonas_regiones?select=zona,region&limit=10000");
        if (alive && Array.isArray(rr)) { const m = {}; rr.forEach((r) => { m[r.zona] = r.region; }); setRegionMap(m); }
      } catch (e) { /* regiones best-effort → todo cae en "Sin clasificar" */ }
      try {
        const al = await sbGet("localidad_zona_alias?select=localidad_norm,zona&limit=10000");
        if (alive && Array.isArray(al)) { const m = {}; al.forEach((r) => { m[r.localidad_norm] = r.zona; }); setAliasMap(m); }
      } catch (e) { /* alias best-effort */ }
      try {
        const inf = await sbGet("analista_informes?select=id,fecha,tipo,resumen_tg,informe_md,hay_novedad,created_at&order=created_at.desc&limit=30");
        if (alive) setInformes(Array.isArray(inf) ? inf : []);
      } catch (e) { if (alive) setInformes([]); }
      try {
        const sg = await sbGet("decisiones_seguimiento?select=id,fecha,nombre,kind,tipo,sla_al_marcar&order=created_at.desc&limit=500");
        if (alive) setSeguim(Array.isArray(sg) ? sg : []);
      } catch (e) { if (alive) setSeguim([]); }
    })();
    return () => { alive = false; };
  }, []);

  // Semanas ordenadas por fecha real (el array `semanas` ya viene ordenado asc desde App).
  const weeks = useMemo(() => {
    const arr = semanas.map((s) => ({
      label: s.label,
      fechas: s.dias.map((d) => d.fecha),
      nDias: s.dias.length,
      parcial: s.dias.length < 5,
    }));
    // "en curso" = la última semana tiene menos días cargados que la anterior (todavía se está llenando).
    const n = arr.length;
    if (n >= 2 && arr[n - 1].nDias < arr[n - 2].nDias) arr[n - 1].enCurso = true;
    return arr;
  }, [semanas]);
  const labels = weeks.map((w) => w.label);
  const completas = weeks.filter((w) => !w.parcial).map((w) => w.label);

  const [periodo, setPeriodo] = useState({ t: "sem", w: null });
  const [drill, setDrill] = useState(null); // {kind, name, src} — panel de detalle al tocar una alerta o fila
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 640);
  const [chip, setChip] = useState(null); // filtro rápido del ranking: null | criticos | sobre | tarde | caida
  const [copiado, setCopiado] = useState(false);
  const [verAvanzadas, setVerAvanzadas] = useState(false); // ranking: columnas avanzadas ocultas por defecto
  const [verInforme, setVerInforme] = useState(false); // informe completo del analista colapsado
  const [verIncompletos, setVerIncompletos] = useState(false); // bloque "Datos aún incompletos" colapsado
  const [lenteReg, setLenteReg] = useState("sla"); // tarjetas de Regiones: lente SLA u Horario
  const [verLocs, setVerLocs] = useState(false); // "Localidades a vigilar" plegado por defecto
  const [regionAbierta, setRegionAbierta] = useState(null); // detalle de región, inline debajo de las tarjetas
  const [zonaAbierta, setZonaAbierta] = useState(null);     // dentro de ese detalle, qué zona muestra localidades
  // Tabla de localidades del final: buscador, filtro por región, orden y "ver todas" (muestra chica).
  const [locBusca, setLocBusca] = useState("");
  const [locRegion, setLocRegion] = useState("Todas");
  const [locTodas, setLocTodas] = useState(false);
  const [locSort, setLocSort] = useState({ col: "hor", dir: "asc" }); // peor horario primero
  // Corte horario del titular (idea del "Horario de corte" del ML21). 21 = el que mide Meli.
  // Se recuerda entre sesiones, pero el default siempre es 21 en una máquina nueva.
  const [corte, setCorte] = useState(() => {
    const v = parseInt(localStorage.getItem("fx_corte_horario"), 10);
    return v >= 12 && v <= 23 ? v : 21;
  });
  useEffect(() => { localStorage.setItem("fx_corte_horario", String(corte)); }, [corte]);
  const [verCapacidad, setVerCapacidad] = useState(false); // "Capacidad para redistribuir" colapsado por defecto
  const [verAlertasOp, setVerAlertasOp] = useState(false); // "Alertas operativas / calidad de datos" colapsado por defecto
  const [verAtender, setVerAtender] = useState(true); // "A atender" colapsable (abierto por defecto, es lo principal)
  const [verHist, setVerHist] = useState(false); // "ver historial completo" en el drill (modo Historial)
  const [verTodosPat, setVerTodosPat] = useState(false); // Patrones: ver todos
  const [patSort, setPatSort] = useState("diasDem"); // Patrones: columna de orden

  useEffect(() => {
    const onR = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  // default: la semana más reciente (la "en curso"); el manejo de parcial ya está resuelto.
  const periodW = periodo.w || labels[labels.length - 1] || null;

  const periodLabels = useMemo(() => {
    if (periodo.t === "sem") return periodW ? [periodW] : [];
    if (periodo.t === "ult4") return completas.slice(-4);
    return labels.slice();
  }, [periodo.t, periodW, completas, labels]);

  const prevLabels = useMemo(() => {
    if (periodo.t === "sem") { const i = labels.indexOf(periodW); return i > 0 ? [labels[i - 1]] : null; }
    if (periodo.t === "ult4") { const p = completas.slice(-8, -4); return p.length === 4 ? p : null; }
    return null;
  }, [periodo.t, periodW, labels, completas]);

  const curWeek = weeks.find((w) => w.label === periodW);
  const parcialActual = periodo.t === "sem" && !!curWeek?.parcial;
  const enCursoActual = periodo.t === "sem" && !!curWeek?.enCurso;
  const nCurDias = curWeek ? curWeek.fechas.length : 0;
  const prevLbl = periodo.t === "sem"
    ? (prevLabels ? (enCursoActual ? `mismos ${nCurDias} días de sem. ${fmtSemLabel(prevLabels[0])}` : "sem. " + fmtSemLabel(prevLabels[0])) : "")
    : "4 sem. anteriores";

  const cur = useMemo(() => aggWeeks(semanas, new Set(periodLabels), topeMap), [semanas, periodLabels, topeMap]);
  // Cuando la semana está en curso, la comparación es contra los MISMOS días de la semana anterior (no contra la semana completa).
  const prev = useMemo(() => {
    if (!prevLabels) return null;
    if (enCursoActual && prevLabels.length === 1) {
      const p = aggWeekFirstDays(semanas, prevLabels[0], nCurDias, topeMap);
      if (p) return p;
    }
    return aggWeeks(semanas, new Set(prevLabels), topeMap);
  }, [semanas, prevLabels, topeMap, enCursoActual, nCurDias]);

  // Agregado semanal para los gráficos (todas las semanas).

  // ---- Zonas del período (semanas_zonas) ----
  const zonaData = useMemo(() => {
    if (!zonasRaw) return null;
    const fechasPeriodo = new Set(weeks.filter((w) => periodLabels.includes(w.label)).flatMap((w) => w.fechas));
    const filas = zonasRaw.filter((r) => fechasPeriodo.has(r.fecha));
    if (filas.length === 0) return { vacio: true, desde: zonasRaw.length ? zonasRaw[0].fecha : null };
    const map = {};
    for (const r of filas) {
      const k = r.localidad_norm || "";
      const gz = map[k] || (map[k] = { localidad_norm: k, labels: {}, cantidad: 0, entregados: 0, demorados: 0, dem21: 0, post21: 0, envios_ml: 0, nadie: 0 });
      if (r.localidad) gz.labels[r.localidad] = (gz.labels[r.localidad] || 0) + r.cantidad;
      gz.cantidad += r.cantidad; gz.entregados += r.entregados; gz.demorados += r.demorados;
      gz.dem21 += r.dem21; gz.post21 += r.post21; gz.envios_ml += r.envios_ml; gz.nadie += r.nadie;
    }
    const slaGlobal = cur.g.sla;
    const zonas = Object.values(map).map((z) => {
      const label = Object.keys(z.labels).sort((a, b) => z.labels[b] - z.labels[a])[0] || "(sin localidad)";
      const sla = slaMeli(z.envios_ml, z.demorados, z.dem21);
      const baseEnt = z.entregados || z.cantidad;
      return {
        localidad: label, localidad_norm: z.localidad_norm, cantidad: z.cantidad, envios_ml: z.envios_ml, sla,
        delta: sla != null && slaGlobal != null ? sla - slaGlobal : null,
        post21Rate: baseEnt > 0 ? z.post21 / baseEnt * 100 : 0,
        nadieRate: z.cantidad > 0 ? z.nadie / z.cantidad * 100 : 0,
      };
    });
    const grandes = zonas.filter((z) => z.cantidad >= CFG.zonaMin).sort((a, b) => b.cantidad - a.cantidad);
    const chicas = zonas.filter((z) => z.cantidad < CFG.zonaMin);
    const otras = chicas.length ? {
      localidad: `Otras (muestra chica, <${CFG.zonaMin} envíos)`, esOtras: true,
      cantidad: chicas.reduce((a, z) => a + z.cantidad, 0),
      nZonas: chicas.length,
      chicas: chicas.slice().sort((a, b) => b.cantidad - a.cantidad),
    } : null;
    return { vacio: false, slaGlobal, grandes, otras };
  }, [zonasRaw, weeks, periodLabels, cur]);

  // ---- Sugerencias ----
  const sug = useMemo(() => {
    const cs = cur.cads;
    const conML = cs.filter((c) => c.ml >= CFG.minML);
    const criticos = conML.filter((c) => c.sla != null && c.sla < CFG.slaCritico).sort((a, b) => a.sla - b.sla);
    const tarde = cs.filter((c) => c.entregados >= CFG.minEntregados && (c.p21rate >= CFG.tarde_post21 || (c.fin != null && c.fin >= CFG.tarde_fin))).sort((a, b) => b.p21rate - a.p21rate);
    const repro = cs.filter((c) => c.d21 >= CFG.repro21_min && c.dias > 0 && c.dd21 / c.dias >= CFG.repro21_frec).sort((a, b) => b.d21 - a.d21);
    const sobre = cs.filter((c) => c.dias >= 2 && c.prom >= CFG.sobrecarga).sort((a, b) => b.prom - a.prom);
    const caballos = cs.slice().sort((a, b) => b.cant - a.cant).slice(0, 10).filter((c) => c.sla != null && c.sla >= CFG.slaOk).slice(0, 8);
    let caida = [], mejora = [];
    if (prev) {
      const pm = {}; prev.cads.forEach((c) => { pm[c.name] = c; });
      conML.forEach((c) => {
        const p = pm[c.name];
        if (p && p.ml >= CFG.minML && c.sla != null && p.sla != null) {
          const d = c.sla - p.sla;
          if (d <= -CFG.deltaSla) caida.push({ ...c, delta: d });
          else if (d >= CFG.deltaSla && c.sla >= CFG.slaCritico) mejora.push({ ...c, delta: d });
        }
      });
      caida.sort((a, b) => a.delta - b.delta); mejora.sort((a, b) => b.delta - a.delta);
    }
    return { criticos, tarde, repro, sobre, caballos, caida, mejora };
  }, [cur, prev]);

  // Días distintos del período (para la recurrencia del score).
  const diasPeriodo = useMemo(() => {
    const set = new Set();
    weeks.forEach((w) => { if (periodLabels.includes(w.label)) w.fechas.forEach((f) => set.add(f)); });
    return set.size || 1;
  }, [weeks, periodLabels]);

  // ---- Decisiones de la semana: alertas priorizadas por score ----
  // score = severidad (por tipo) × peso por volumen (ML / mediana ML) × recurrencia (días afectados / días del período).
  const alertas = useMemo(() => {
    const enCurso = periodo.t === "sem" && !!parcialActual;
    const acc = (tipo) => CFG.acciones[tipo][enCurso ? "hoy" : "otro"];
    const mlList = cur.cads.filter((c) => c.ml >= CFG.minML).map((c) => c.ml);
    const medML = mediana(mlList) || 1;
    const rec = (diasAfect) => Math.min(1, (diasAfect || 0) / diasPeriodo);
    const volW = (ml) => (ml || 0) / medML;

    // Un candidato por cadete: el de mayor score entre sus señales.
    const porCad = {};
    const push = (c, tipo, motivo, dato, recur) => {
      const sev = CFG.sev[tipo];
      const score = sev * volW(c.ml) * rec(recur);
      if (!(score > 0)) return;
      const prevC = porCad[c.name];
      if (!prevC || score > prevC.score) {
        porCad[c.name] = { kind: "cadete", key: "c:" + c.name, name: c.name, tipo, sev, score, motivo, dato, accion: acc(tipo), c };
      }
    };
    sug.criticos.forEach((c) => push(c, "critico",
      `SLA ${fmt1(c.sla)}% · ${fmtInt(c.dem)} dem + ${fmtInt(c.d21)} repro 21 sobre ${fmtInt(c.ml)} ML`, fmt1(c.sla) + "%", c.diasDem));
    sug.caida.forEach((c) => push(c, "caida",
      `SLA ${fmt1(c.sla)}% · bajó ${fmt1(Math.abs(c.delta))} pp vs ${prevLbl}`, fmt1(c.sla) + "%", c.diasDem));
    sug.tarde.forEach((c) => push(c, "tarde",
      `${fmt0(c.p21rate * 100)}% post 21${c.fin != null ? " · fin prom. " + fmtHora(c.fin) : ""}`, fmt0(c.p21rate * 100) + "% post 21", c.diasP21));
    sug.repro.forEach((c) => push(c, "repro",
      `repro 21 en ${c.dd21} de ${c.dias} días (${fmtInt(c.d21)} envíos)`, fmtInt(c.d21) + " repro 21", c.dd21));
    sug.sobre.forEach((c) => push(c, "limite",
      `${fmt1(c.prom)} env/día en ${c.dias} días (tope ${c.tope || CFG.tope})`, fmt1(c.prom) + " /día", Math.max(c.diasSobreTope, c.diasCargaAlta)));

    // Candidatos por localidad (semanas_zonas). Recurrencia = 1 (sin conteo diario fiable — supuesto marcado).
    const locs = [];
    if (zonaData && !zonaData.vacio && zonaData.grandes) {
      zonaData.grandes.forEach((z) => {
        if (z.sla == null) return;
        let tipo = null;
        if (z.sla < CFG.slaCritico) tipo = "locCritico";
        else if (z.delta != null && z.delta <= -1) tipo = "locCaida";
        if (!tipo) return;
        const score = CFG.sev[tipo] * volW(z.envios_ml) * 1;
        if (!(score > 0)) return;
        locs.push({
          kind: "localidad", key: "l:" + z.localidad, name: z.localidad, tipo: "zona", sev: CFG.sev[tipo], score,
          motivo: `SLA ${fmt1(z.sla)}%${z.delta != null ? " · " + (z.delta >= 0 ? "+" : "−") + fmt1(Math.abs(z.delta)) + " pp vs global" : ""} · ${fmtInt(z.cantidad)} envíos`,
          dato: fmt1(z.sla) + "%", accion: acc("zona"), z,
        });
      });
    }

    const cadetes = Object.values(porCad).sort((a, b) => b.score - a.score).slice(0, CFG.alertasMax);
    const locsTop = locs.sort((a, b) => b.score - a.score);
    const todos = [...Object.values(porCad), ...locs].sort((a, b) => b.score - a.score);
    return { top: todos.slice(0, CFG.alertasMax), cadetes, locs: locsTop, byCad: porCad, nCad: cadetes.length, nLoc: locsTop.length, total: todos.length };
  }, [cur, sug, zonaData, periodo.t, parcialActual, prevLbl, diasPeriodo]);

  // SLA por localidad del período anterior (para el Δ vs período anterior del drill-down).
  const prevZonaMap = useMemo(() => {
    if (!zonasRaw || !prevLabels) return {};
    const fechasPrev = new Set(weeks.filter((w) => prevLabels.includes(w.label)).flatMap((w) => w.fechas));
    const map = {};
    for (const r of zonasRaw) {
      if (!fechasPrev.has(r.fecha)) continue;
      const k = r.localidad_norm || "";
      const g = map[k] || (map[k] = { demorados: 0, dem21: 0, envios_ml: 0 });
      g.demorados += r.demorados; g.dem21 += r.dem21; g.envios_ml += r.envios_ml;
    }
    const out = {};
    for (const [k, g] of Object.entries(map)) out[k] = slaMeli(g.envios_ml, g.demorados, g.dem21);
    return out;
  }, [zonasRaw, prevLabels, weeks]);

  // Frescura: última fecha con datos + cuánto histórico tienen las localidades.
  const maxFecha = useMemo(() => { let mx = ""; semanas.forEach((s) => s.dias.forEach((d) => { if (d.fecha > mx) mx = d.fecha; })); return mx; }, [semanas]);
  const zonasInfo = useMemo(() => {
    if (!zonasRaw || !zonasRaw.length) return { weeks: 0, desde: null };
    const labs = new Set(); let desde = zonasRaw[0].fecha;
    zonasRaw.forEach((r) => { labs.add(r.label); if (r.fecha < desde) desde = r.fecha; });
    return { weeks: labs.size, desde };
  }, [zonasRaw]);
  // Zona operativa derivada de la localidad (match tolerante contra zonas_cp; sin match único → null).
  const zonaDe = (loc) => { if (!zonaNames.length) return null; const nl = normZ(loc); if (aliasMap[nl]) return aliasMap[nl]; const ex = zonaNames.find((z) => normZ(z) === nl); if (ex) return ex; const ms = zonaNames.filter((z) => matchZona(nl, normZ(z))); return ms.length === 1 ? ms[0] : null; };

  // Jerarquía Región → Zona → Localidad. Suma envios_ml/demorados/dem21 y recalcula SLA en cada nivel
  // (nunca promediar %). Localidad sin match de zona → "Sin zona asignada"; zona sin región → "Sin clasificar".
  // Se calcula 1 vez por período desde zonasRaw (que ya está en memoria) — abrir/cerrar no pega a Supabase.
  const REG_ORDEN = ["CABA", "Norte", "Oeste", "Sur", "Sin clasificar", "Sin zona asignada"];
  const jerarquia = useMemo(() => {
    if (!zonasRaw) return null;
    const fechasPeriodo = new Set(weeks.filter((w) => periodLabels.includes(w.label)).flatMap((w) => w.fechas));
    const filas = zonasRaw.filter((r) => fechasPeriodo.has(r.fecha));
    if (filas.length === 0) return { vacio: true, desde: zonasRaw.length ? zonasRaw[0].fecha : null };
    // 1) localidad (mismo agregado que zonaData, pero conservando demorados/dem21)
    const locMap = {};
    for (const r of filas) {
      const k = r.localidad_norm || "";
      const g = locMap[k] || (locMap[k] = { localidad_norm: k, labels: {}, zonaCp: {}, cantidad: 0, entregados: 0, demorados: 0, dem21: 0, post21: 0, envios_ml: 0, nadie: 0, horas: {} });
      if (r.localidad) g.labels[r.localidad] = (g.labels[r.localidad] || 0) + r.cantidad;
      if (r.zona_cp) g.zonaCp[r.zona_cp] = (g.zonaCp[r.zona_cp] || 0) + r.cantidad;
      g.cantidad += r.cantidad; g.entregados += r.entregados; g.demorados += r.demorados; g.dem21 += r.dem21; g.post21 += r.post21; g.envios_ml += r.envios_ml; g.nadie += r.nadie; sumaHoras(g.horas, r.horas);
    }
    const slaG = cur.g.sla;
    const acc = (o, z) => { o.cantidad += z.cantidad; o.entregados += z.entregados; o.demorados += z.demorados; o.dem21 += z.dem21; o.post21 += z.post21; o.envios_ml += z.envios_ml; o.nadie += z.nadie; sumaHoras(o.horas, z.horas); };
    const nuevo = (nombre, extra) => ({ nombre, cantidad: 0, entregados: 0, demorados: 0, dem21: 0, post21: 0, envios_ml: 0, nadie: 0, horas: {}, ...extra });
    const fin = (o) => { o.sla = slaMeli(o.envios_ml, o.demorados, o.dem21); o.delta = (o.sla != null && slaG != null) ? o.sla - slaG : null; o.post21Rate = (o.entregados || o.cantidad) > 0 ? o.post21 / (o.entregados || o.cantidad) * 100 : 0; o.nadieRate = o.cantidad > 0 ? o.nadie / o.cantidad * 100 : 0; return o; };

    const regiones = {}; let totalML = 0, totalCant = 0, locsSinZona = 0, mlSinZona = 0, nLoc = 0;
    for (const k of Object.keys(locMap)) {
      const loc = locMap[k];
      loc.localidad = Object.keys(loc.labels).sort((a, b) => loc.labels[b] - loc.labels[a])[0] || "(sin localidad)";
      totalML += loc.envios_ml; totalCant += loc.cantidad; nLoc++;
      // zona autoritativa por CP (zona_cp de la carga); fallback al match por nombre para filas viejas sin CP
      const zonaCpTop = Object.keys(loc.zonaCp).sort((a, b) => loc.zonaCp[b] - loc.zonaCp[a])[0];
      const zona = zonaCpTop || zonaDe(loc.localidad); // nombre de zona op. o null
      const regionName = !zona ? "Sin zona asignada" : (regionMap[zona] || "Sin clasificar");
      if (!zona) { locsSinZona++; mlSinZona += loc.envios_ml; }
      const reg = regiones[regionName] || (regiones[regionName] = nuevo(regionName, { zonas: {} }));
      acc(reg, loc);
      const zk = zona || "(sin zona)";
      const zn = reg.zonas[zk] || (reg.zonas[zk] = nuevo(zona || "Sin zona operativa", { localidades: [] }));
      acc(zn, loc); zn.localidades.push(loc);
    }
    const peorPrimero = (a, b) => { if (a.sla == null && b.sla == null) return b.envios_ml - a.envios_ml; if (a.sla == null) return 1; if (b.sla == null) return -1; return a.sla - b.sla; };
    const regionesArr = Object.values(regiones).map((reg) => {
      fin(reg);
      reg.zonasArr = Object.values(reg.zonas).map((zn) => { fin(zn); zn.localidades.forEach(fin); zn.localidades.sort(peorPrimero); return zn; }).sort(peorPrimero);
      return reg;
    }).sort((a, b) => REG_ORDEN.indexOf(a.nombre) - REG_ORDEN.indexOf(b.nombre));
    // aviso de cobertura: si el período elegido arranca antes de que exista dato por zona
    const capturaDesde = zonasRaw.length ? zonasRaw[0].fecha : null;
    const periodoMin = [...fechasPeriodo].sort()[0] || null;
    const avisoDesde = (periodoMin && capturaDesde && periodoMin < capturaDesde) ? capturaDesde : null;
    return { vacio: false, regiones: regionesArr, totalML, totalCant, locsSinZona, mlSinZona, nLoc, pctSinZona: totalML > 0 ? mlSinZona / totalML * 100 : 0, avisoDesde };
  }, [zonasRaw, weeks, periodLabels, regionMap, aliasMap, zonaNames, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // SLA por región del período ANTERIOR (para la flecha de las tarjetas de región).
  // Misma comparación que los KPIs: si la semana está en curso, contra los mismos N días de la semana anterior.
  const prevRegiones = useMemo(() => {
    if (!zonasRaw || !zonasRaw.length || !prevLabels) return null;
    // OJO — `semanas_zonas` NO tiene todos los días (la captura arrancó el 23/07 y no hubo backfill).
    // Comparar la semana completa contra 3 días de la anterior daba flechas falsas: el lunes es el
    // peor día y si falta de un lado, el otro lado "empeora" solo. Por eso la flecha compara
    // únicamente las posiciones de la semana (lun, mar, …) que tienen dato de zona en AMBOS lados.
    const conDato = new Set(zonasRaw.map((r) => r.fecha));
    const wPrev = weeks.filter((w) => prevLabels.includes(w.label));
    const wCur = weeks.filter((w) => periodLabels.includes(w.label));
    const posDe = (ws) => { const s = new Set(); ws.forEach((w) => w.fechas.forEach((f, i) => { if (conDato.has(f)) s.add(i); })); return s; };
    let posPrev = posDe(wPrev);
    if (enCursoActual && prevLabels.length === 1) posPrev = new Set([...posPrev].filter((i) => i < nCurDias));
    const posCur = posDe(wCur);
    const posOk = new Set([...posPrev].filter((i) => posCur.has(i)));
    if (!posOk.size) return null;
    const fechasDe = (ws) => new Set(ws.flatMap((w) => w.fechas.filter((f, i) => posOk.has(i))));
    const agg = (fechas) => {
      const map = {};
      for (const r of zonasRaw) {
        if (!fechas.has(r.fecha)) continue;
        const zona = r.zona_cp || zonaDe(r.localidad);
        const region = !zona ? "Sin zona asignada" : (regionMap[zona] || "Sin clasificar");
        const g = map[region] || (map[region] = { ml: 0, dm: 0, d2: 0, ent: 0, p21: 0, horas: {} });
        g.ml += r.envios_ml; g.dm += r.demorados; g.d2 += r.dem21;
        g.ent += (r.entregados || 0); g.p21 += (r.post21 || 0); sumaHoras(g.horas, r.horas);
      }
      // Las DOS lentes: sla (solo ML) y hor (% entregado antes de las 21, sobre entregados).
      const out = {};
      for (const [k, g] of Object.entries(map)) out[k] = {
        sla: g.ml >= CFG.zonaMin ? slaMeli(g.ml, g.dm, g.d2) : null,
        horas: g.horas,
        hor: g.ent > 0 ? (g.ent - g.p21) / g.ent * 100 : null, // fallback 21hs si no hay histograma
      };
      return out;
    };
    return { prev: agg(fechasDe(wPrev)), cmp: agg(fechasDe(wCur)), dias: posOk.size, parcial: posOk.size < posCur.size };
  }, [zonasRaw, prevLabels, periodLabels, weeks, regionMap, enCursoActual, nCurDias]); // eslint-disable-line react-hooks/exhaustive-deps

  // Informe del analista parseado (para el Titular + enriquecer las tarjetas con su acción en prosa).
  const informeStd = useMemo(() => {
    if (!informes || !informes.length) return null;
    // BUG que tapaba el bloque entero: se agarraba el informe MÁS NUEVO, que casi siempre es un
    // diario ("Parque Chacabuco saturada", 3 líneas sin encabezados markdown). parseInforme no
    // encontraba "## Titular", devolvía titular vacío y el render — condicionado a titular — no
    // mostraba nada. El semanal, que es el que trae el análisis de verdad, quedaba invisible.
    // Ahora: primero el semanal; el diario solo si no hay ninguno.
    const row = informes.find((x) => x.informe_md && x.tipo === "semanal") || informes.find((x) => x.informe_md);
    if (!row) return null;
    const p = parseInforme(row.informe_md) || { items: [] };
    // Los diarios no tienen encabezados: el titular sale del resumen de Telegram o de la 1ª línea.
    if (!p.titular) {
      p.titular = (row.resumen_tg || "").trim()
        || String(row.informe_md).split("\n").map((l) => l.replace(/^[-*\s]+/, "").trim()).find(Boolean)
        || "";
    }
    if (!p.items) p.items = [];
    const porCadete = {}; let capacidad = null;
    p.items.forEach((it) => {
      const nm = norm(it.nombre);
      if (cur.cads.some((c) => c.name === nm)) porCadete[nm] = it;
      else if (/caball|capacidad|aprovech|redistrib/i.test(it.bold + " " + it.senal)) capacidad = it;
    });
    return { row, ...p, porCadete, capacidad };
  }, [informes, cur]);

  // ---- Ranking table ----
  const [sortCol, setSortCol] = useState("cant");
  const [sortDir, setSortDir] = useState(-1);
  const ranking = useMemo(() => {
    const pm = {}; if (prev) prev.cads.forEach((c) => { pm[c.name] = c; });
    const rows = cur.cads.filter((c) => c.cant >= 10).map((c) => {
      const p = pm[c.name];
      return { ...c, pctVol: cur.g.cant > 0 ? c.cant / cur.g.cant * 100 : 0, delta: (p && p.sla != null && c.sla != null && p.ml >= CFG.minML && c.ml >= CFG.minML) ? c.sla - p.sla : null };
    });
    rows.sort((a, b) => { const va = a[sortCol], vb = b[sortCol]; if (va == null) return 1; if (vb == null) return -1; return (typeof va === "string") ? sortDir * va.localeCompare(vb) : sortDir * (va - vb); });
    return rows;
  }, [cur, prev, sortCol, sortDir]);
  const doSort = (key) => { if (sortCol === key) setSortDir((d) => -d); else { setSortCol(key); setSortDir(key === "name" ? 1 : -1); } };

  // Filtros rápidos (chips) sobre el ranking.
  const chipPred = {
    criticos: (c) => c.sla != null && c.sla < CFG.slaCritico && c.ml >= CFG.minML,
    riesgo: (c) => c.sla != null && c.sla >= CFG.slaCritico && c.sla < CFG.slaOk,
    ok: (c) => c.sla != null && c.sla >= CFG.slaOk,
    sobre: (c) => c.prom >= CFG.sobrecarga,
    tarde: (c) => c.entregados >= CFG.minEntregados && (c.p21rate >= CFG.tarde_post21 || (c.fin != null && c.fin >= CFG.tarde_fin)),
    caida: (c) => c.delta != null && c.delta <= -CFG.deltaSla,
  };
  const rankingF = chip ? ranking.filter(chipPred[chip]) : ranking;

  // SLA por cadete en las últimas 4 semanas (columna "Últimas 4 semanas" de Patrones).
  const hist4 = useMemo(() => {
    const last4 = labels.slice(-4);
    const map = {};
    for (const s of semanas) {
      if (!last4.includes(s.label)) continue;
      for (const dia of s.dias) for (const m of dia.datos) {
        const nm = norm(m.cadete);
        if (esSin(nm) || esBasura(nm)) continue;
        const g = map[nm] || (map[nm] = { ml: 0, dm: 0, d2: 0 });
        g.ml += m.envios_ml; g.dm += m.demorados; g.d2 += (m.dem21 || 0);
      }
    }
    const out = {};
    for (const [k, g] of Object.entries(map)) out[k] = slaMeli(g.ml, g.dm, g.d2);
    return out;
  }, [semanas, labels]);

  // Tendencia adaptativa: diaria (semana) / semanal (últimas 4) / mensual (historial).
  const tendData = useMemo(() => {
    if (periodo.t === "sem") {
      const s = semanas.find((x) => x.label === periodW);
      if (!s) return { modo: "día", datos: [] };
      return { modo: "día", datos: s.dias.map((dia) => {
        let cant = 0, ml = 0, dm = 0, d2 = 0, p21 = 0, pend = 0; const horas = {};
        for (const m of dia.datos) { cant += m.cantidad; ml += m.envios_ml; dm += m.demorados; d2 += (m.dem21 || 0); p21 += (m.post21 || 0); pend += m.pendientes; sumaHoras(horas, m.horas); }
        const ent = cant - pend;
        return { name: fmtDDMM(dia.fecha), fecha: dia.fecha, cant, pend, horas, sla: slaMeli(ml, dm, d2), p21r: ent > 0 ? p21 / ent * 100 : null };
      }) };
    }
    if (periodo.t === "ult4") {
      return { modo: "semana", datos: completas.slice(-4).map((l) => { const a = aggWeeks(semanas, new Set([l]), topeMap); return { name: fmtSemLabel(l), cant: a.g.cant, pend: a.g.pend, horas: a.g.horas, sla: a.g.sla, p21r: a.g.entregados > 0 ? a.g.p21rate * 100 : null }; }) };
    }
    const byMonth = {};
    semanas.forEach((s) => s.dias.forEach((dia) => {
      const mk = dia.fecha.slice(0, 7);
      const g = byMonth[mk] || (byMonth[mk] = { cant: 0, ml: 0, dm: 0, d2: 0, p21: 0, pend: 0 });
      for (const m of dia.datos) { g.cant += m.cantidad; g.ml += m.envios_ml; g.dm += m.demorados; g.d2 += (m.dem21 || 0); g.p21 += (m.post21 || 0); g.pend += m.pendientes; }
    }));
    return { modo: "mes", datos: Object.keys(byMonth).sort().map((mk) => { const g = byMonth[mk]; const [y, mo] = mk.split("-"); const ent = g.cant - g.pend; return { name: `${MES[+mo - 1]} ${y.slice(2)}`, cant: g.cant, pend: g.pend, sla: slaMeli(g.ml, g.dm, g.d2), p21r: ent > 0 ? g.p21 / ent * 100 : null }; }) };
  }, [periodo.t, periodW, completas, semanas, topeMap]);

  // Calendario del histórico: stats por fecha (todas las semanas cargadas) para la vista mensual.
  const calStats = useMemo(() => {
    const map = {}; let max = 0;
    semanas.forEach((sw) => sw.dias.forEach((dia) => {
      let cant = 0, ml = 0, dm = 0, d2 = 0, p21 = 0, pend = 0;
      for (const m of dia.datos) { cant += m.cantidad; ml += m.envios_ml; dm += m.demorados; d2 += (m.dem21 || 0); p21 += (m.post21 || 0); pend += m.pendientes; }
      const ent = cant - pend;
      // Se guardan los crudos (ml/dm/d2/ent/p21) además del SLA del día: el SLA del mes NO es
      // el promedio de los SLA diarios — hay que sumar envíos y demoras y recién ahí dividir,
      // si no un domingo de 30 envíos pesa lo mismo que un lunes de 900.
      map[dia.fecha] = { cant, ml, dm, d2, ent, p21, dem: dm + d2, sla: slaMeli(ml, dm, d2), p21r: ent > 0 ? p21 / ent * 100 : null, pend };
      if (cant > max) max = cant;
    }));
    const meses = [...new Set(Object.keys(map).map((f) => f.slice(0, 7)))].sort();
    return { map, max, meses };
  }, [semanas]);
  const [calSel, setCalSel] = useState(null); // día seleccionado del calendario: {fecha, s}
  const [calMes, setCalMes] = useState(null); // mes visible del calendario (default: el último con datos)

  // Patrones: reincidentes de demora (nunca "Sin asignar" ni basura — esos van a alertas operativas).
  const patrones = useMemo(() => {
    const rows = cur.cads.filter((c) => (c.dem + c.d21) > 0).map((c) => {
      const p = prev && prev.cads.find((x) => x.name === c.name);
      const delta = (p && p.sla != null && c.sla != null && p.ml >= CFG.minML && c.ml >= CFG.minML) ? c.sla - p.sla : null;
      return { name: c.name, diasDem: c.diasDem, demoras: c.dem + c.d21, ultInc: c.ultInc, sla4: hist4[c.name] != null ? hist4[c.name] : null, delta, tend: delta == null ? 0 : delta >= CFG.deltaSla ? 1 : delta <= -CFG.deltaSla ? -1 : 0 };
    });
    const key = patSort;
    rows.sort((a, b) => { const va = a[key], vb = b[key]; if (va == null) return 1; if (vb == null) return -1; return typeof va === "string" ? vb.localeCompare(va) : vb - va; });
    return rows;
  }, [cur, prev, hist4, patSort]);

  // Mejoras sostenidas (contrapeso en Historial): SLA subió ≥deltaSla y quedó ≥ crítico.
  const mejorasSost = useMemo(() => {
    if (!prev) return [];
    const pm = {}; prev.cads.forEach((c) => { pm[c.name] = c; });
    return cur.cads.map((c) => { const p = pm[c.name]; const d = (p && p.sla != null && c.sla != null && p.ml >= CFG.minML && c.ml >= CFG.minML) ? c.sla - p.sla : null; return d != null ? { name: c.name, sla: c.sla, delta: d } : null; })
      .filter((x) => x && x.delta >= CFG.deltaSla && x.sla >= CFG.slaCritico).sort((a, b) => b.delta - a.delta).slice(0, 8);
  }, [cur, prev]);

  if (!semanas || semanas.length === 0) {
    return <div style={{ padding: 24, color: C.muted }}>No hay datos cargados todavía.</div>;
  }

  // KPIs deltas
  const dVol = (prev && (!parcialActual || enCursoActual)) ? cur.g.cant - prev.g.cant : null;
  const dSla = (prev && cur.g.sla != null && prev.g.sla != null) ? cur.g.sla - prev.g.sla : null;
  const dPend = (prev && (!parcialActual || enCursoActual)) ? cur.g.pend - prev.g.pend : null;
  const dP21 = (prev && cur.g.entregados > 0 && prev.g.entregados > 0) ? (cur.g.p21rate - prev.g.p21rate) * 100 : null;

  // Series del período para el sparkline de cada tile — mismos datos que el gráfico de Tendencia,
  // así no hay dos verdades. Con menos de 3 puntos el Spark no dibuja nada.
  const serieDe = (k) => (tendData && tendData.datos.length >= 3 ? tendData.datos.map((d) => d[k]) : null);
  const sEnv = serieDe("cant"), sSla = serieDe("sla"), sPend = serieDe("pend");

  // Titular de horario — idea tomada del informe ML21 de LightData: el mismo dato que "Post-21"
  // pero en positivo y con la proporción a la vista. OJO: es NUESTRA definición (post21 sobre
  // entregados); el ML21 de LightData da un número más bajo y todavía no está reconciliado.
  // Con histograma (`horas`) el corte es movible; sin histograma se cae al 21:00 fijo de `post21`.
  const hayHoras = totalHoras(cur.g.horas) > 0;
  const antes21 = hayHoras ? antesDeCorte(cur.g.horas, corte)
    : (cur.g.entregados > 0 ? (1 - cur.g.p21rate) * 100 : null);
  const antes21Prev = (prev && hayHoras && totalHoras(prev.g.horas) > 0) ? antesDeCorte(prev.g.horas, corte)
    : (prev && prev.g.entregados > 0 ? (1 - prev.g.p21rate) * 100 : null);
  const dAntes21 = (antes21 != null && antes21Prev != null) ? antes21 - antes21Prev : (dP21 != null ? -dP21 : null);
  const entregasConHora = hayHoras ? totalHoras(cur.g.horas) : cur.g.entregados;
  const fueraCorte = hayHoras ? fueraDeCorte(cur.g.horas, corte) : cur.g.p21;
  // El semáforo se calibra siempre contra el umbral de CFG, valga el corte que valga.
  const tasaFuera = entregasConHora > 0 ? fueraCorte / entregasConHora : 0;
  const colorAntes21 = tasaFuera >= CFG.tarde_post21 ? C.crit : tasaFuera >= CFG.tarde_post21 / 2 ? C.warn : C.good;
  const puntosCorte = (tendData.datos || []).map((d) => {
    const a = totalHoras(d.horas) > 0 ? antesDeCorte(d.horas, corte) : (d.p21r != null ? 100 - d.p21r : null);
    return a != null ? { name: d.name, antes: a } : null;
  }).filter(Boolean);
  const peorPunto = puntosCorte.length ? puntosCorte.slice().sort((a, b) => a.antes - b.antes)[0] : null;

  const periodDesc = periodo.t === "sem" ? "Semana del " + fmtSemLabel(periodW) + (enCursoActual ? " (en curso)" : parcialActual ? " (parcial)" : "")
    : periodo.t === "ult4" ? "Últimas 4 semanas completas"
      : "Historial completo";

  // Rangos de fecha para cada botón del selector + títulos dinámicos por período.
  const weekByLabel = (l) => weeks.find((w) => w.label === l);
  const minFecha = (() => { let mn = ""; weeks.forEach((w) => w.fechas.forEach((f) => { if (!mn || f < mn) mn = f; })); return mn; })();
  const subPeriodo = {
    sem: weekByLabel(periodW) ? rangoFechas(weekByLabel(periodW).fechas) : "",
    ult4: rangoFechas(completas.slice(-4).flatMap((l) => weekByLabel(l)?.fechas || [])),
    todo: minFecha ? `desde ${MES_FULL[+minFecha.split("-")[1] - 1]}` : "todo el histórico",
  };
  const tituloBloque = periodo.t === "sem" ? "Datos de la semana" : periodo.t === "ult4" ? "Datos de las últimas 4 semanas" : "Datos históricos";
  const tituloAtender = periodo.t === "todo" ? "Casos históricos a revisar" : (enCursoActual ? "Atención inmediata" : "A atender");

  const th = (key, label, right) => (
    // Encabezado fijo de la tabla de cadetes. El z-index y la sombra son necesarios: sin ellos el
    // header se leía como una fila más incrustada entre dos. Ojo con el contenedor — si vuelve a
    // tener padding ARRIBA, por ahí se cuela la fila que está pasando por debajo.
    <th onClick={() => doSort(key)} style={{ padding: "10px 10px", textAlign: right ? "right" : "left", cursor: "pointer", color: sortCol === key ? C.teal : C.muted, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap", borderBottom: `1px solid rgba(255,255,255,0.16)`, position: "sticky", top: 0, zIndex: 3, background: C.cardAlt, boxShadow: "0 6px 14px rgba(0,0,0,0.45)" }}>
      {label}{sortCol === key ? (sortDir < 0 ? " ▼" : " ▲") : ""}
    </th>
  );

  // Panel de detalle (drill-down) para un cadete o una localidad.
  const renderDrill = (d) => {
    if (!d) return null;
    if (d.kind === "localidad") {
      const pool = [...((zonaData && zonaData.grandes) || []), ...((zonaData && zonaData.otras && zonaData.otras.chicas) || [])];
      const z = pool.find((x) => x.localidad === d.name);
      if (!z) return null;
      const pv = prevZonaMap[z.localidad_norm];
      const dAnt = (pv != null && z.sla != null) ? z.sla - pv : null;
      return (
        <div style={panelStyle}>
          <DrillHead title={"📍 " + z.localidad} onClose={() => setDrill(null)} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <Kv k="Envíos (total)" v={fmtInt(z.cantidad)} />
            <Kv k="Envíos ML" v={fmtInt(z.envios_ml)} />
            <Kv k="SLA Meli" v={z.sla != null ? fmt1(z.sla) + "%" : "—"} color={slaColor(z.sla)} />
            <Kv k="Δ vs global" v={z.delta == null ? "—" : (z.delta >= 0 ? "+" : "−") + fmt1(Math.abs(z.delta)) + " pp"} />
            <Kv k="Δ vs período ant." v={dAnt == null ? "—" : (dAnt >= 0 ? "+" : "−") + fmt1(Math.abs(dAnt)) + " pp"} />
            <Kv k="% post 21" v={fmt0(z.post21Rate) + "%"} />
            <Kv k="% Nadie" v={fmt0(z.nadieRate) + "%"} />
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>Los cadetes que cubren cada localidad se ven en la pestaña <b>Zonas</b> (asignación por territorio, en vivo).</div>
        </div>
      );
    }
    // cadete
    const name = d.name;
    const c = cur.cads.find((x) => x.name === name);
    const dias = [];
    const pset = new Set(periodLabels);
    for (const s of semanas) {
      if (!pset.has(s.label)) continue;
      for (const dia of s.dias) for (const m of dia.datos) {
        if (norm(m.cadete) !== name) continue;
        dias.push({ fecha: dia.fecha, cant: m.cantidad, dem: m.demorados, d21: m.dem21 || 0, p21: m.post21 || 0 });
      }
    }
    dias.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const tope = (c && c.tope) || topeMap[name] || CFG.tope;
    // Serie por semana del cadete (para modos Últimas 4 / Historial).
    const serie = weeks.map((w) => {
      const ss = semanas.find((x) => x.label === w.label);
      let cant = 0, ml = 0, dm = 0, d2 = 0, p21 = 0, ent = 0, nd = 0;
      if (ss) for (const dia of ss.dias) for (const m of dia.datos) if (norm(m.cadete) === name) {
        cant += m.cantidad; ml += m.envios_ml; dm += m.demorados; d2 += (m.dem21 || 0); p21 += (m.post21 || 0); ent += (m.cantidad - m.pendientes); nd++;
      }
      return { label: w.label, name: fmtSemLabel(w.label), cant, ml, dm, d2, sla: slaMeli(ml, dm, d2), prom: nd ? cant / nd : 0, post21: ent > 0 ? p21 / ent * 100 : 0, activa: cant > 0 };
    }).filter((x) => x.activa);
    const spark = serie.slice(-4).map((w) => ({ name: w.name, sla: w.sla })).filter((x) => x.sla != null);
    const s4 = serie.slice(-4);
    const t4 = s4.reduce((a, w) => ({ ml: a.ml + w.ml, dm: a.dm + w.dm, d2: a.d2 + w.d2 }), { ml: 0, dm: 0, d2: 0 });
    const sla4 = slaMeli(t4.ml, t4.dm, t4.d2);
    const ultSem = s4.length ? s4[s4.length - 1] : null;
    const nPost = s4.filter((w) => w.post21 >= CFG.tarde_post21 * 100).length;
    const nBajo = s4.filter((w) => w.sla != null && w.sla < CFG.slaCritico).length;
    const patron = nPost >= 2 ? `post-21 alto (≥${CFG.tarde_post21 * 100}%) en ${nPost} de las últimas ${s4.length} semanas`
      : nBajo >= 2 ? `SLA <${CFG.slaCritico}% en ${nBajo} de las últimas ${s4.length} semanas`
        : "sin patrón repetido en las últimas semanas";
    const peores = serie.filter((w) => w.ml >= 30 && w.sla != null).sort((a, b) => a.sla - b.sla).slice(0, 3);
    const sig = alertas.byCad[name];
    const tdR = { padding: "5px 8px", textAlign: "right" };
    const thW = (arr) => <thead><tr>{arr.map((h, i) => <th key={i} style={{ padding: "5px 8px", textAlign: i === 0 ? "left" : "right", color: C.muted, fontWeight: 600, fontSize: 11, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr></thead>;
    const filaSem = (w, i) => (
      <tr key={i} style={{ borderBottom: `1px solid ${C.faint}` }}>
        <td style={{ padding: "5px 8px", fontWeight: 600 }}>{w.name}</td>
        <td style={tdR}>{fmtInt(w.cant)}</td>
        <td style={{ ...tdR, color: slaColor(w.sla) }}>{w.sla != null ? fmt1(w.sla) + "%" : "—"}</td>
        <td style={tdR}>{fmt0(w.post21)}%</td>
      </tr>
    );
    return (
      <div style={panelStyle}>
        <DrillHead title={name} onClose={() => setDrill(null)} />
        {sig ? (
          <div style={{ background: "rgba(242,149,63,0.10)", border: "1px solid rgba(242,149,63,0.30)", borderRadius: 8, padding: "9px 11px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.bg, background: C.teal, borderRadius: 8, padding: "5px 12px", whiteSpace: "nowrap" }}>{ACC_FUERTE[sig.tipo] || "Seguir de cerca"}</span>
              <span style={{ fontSize: 11, color: C.muted }}>siguiente paso</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.ink }}>{sig.motivo}</div>
            {informeStd && informeStd.porCadete[name] && informeStd.porCadete[name].accion && (
              <div style={{ fontSize: 12, color: C.goodText, marginTop: 5, lineHeight: 1.45 }}>💡 Analista: {informeStd.porCadete[name].accion}</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Sin alerta activa: está dentro de los umbrales del período.</div>
        )}
        {periodo.t === "todo" ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 8 }}>
              <Kv k="SLA histórico" v={c && c.sla != null ? fmt1(c.sla) + "%" : "—"} color={slaColor(c ? c.sla : null)} />
              <Kv k="Últimas 4 sem." v={sla4 != null ? fmt1(sla4) + "%" : "—"} color={slaColor(sla4)} />
              <Kv k="Prom/día hist." v={c ? fmt1(c.prom) : "—"} />
              <Kv k="Última semana" v={ultSem ? fmt1(ultSem.prom) + "/día" : "—"} />
              <Kv k="Tope real" v={fmtInt(tope)} />
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}><b style={{ color: C.ink }}>Patrón:</b> {patron}</div>
          </>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
            <Kv k="Envíos" v={fmtInt(c ? c.cant : 0)} />
            <Kv k="Envíos/día" v={c ? fmt1(c.prom) : "—"} />
            <Kv k="Tope real" v={fmtInt(tope)} />
            <Kv k="SLA Meli" v={c && c.sla != null ? fmt1(c.sla) + "%" : "—"} color={slaColor(c ? c.sla : null)} />
            <Kv k="Fin de ruta prom." v={c ? fmtHora(c.fin) : "—"} />
          </div>
        )}
        {periodo.t !== "todo" && c && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>Carga: {fmt1(c.prom)} env/día vs tope {tope}</div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{ width: Math.min(100, c.prom / tope * 100).toFixed(1) + "%", height: "100%", borderRadius: 4, background: c.prom >= tope ? C.crit : c.prom >= CFG.sobrecarga ? C.warn : C.good }} />
            </div>
          </div>
        )}
        {spark.length >= 2 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>SLA últimas {spark.length} semanas</div>
            <ResponsiveContainer width="100%" height={56}>
              <LineChart data={spark} margin={{ top: 4, right: 8, left: -34, bottom: 0 }}>
                <YAxis domain={[80, 100]} hide />
                <Tooltip contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }} formatter={(v) => [fmt1(v) + "%", "SLA"]} labelStyle={{ color: C.muted }} />
                <Line type="monotone" dataKey="sla" stroke={C.teal} strokeWidth={2} dot={{ r: 2, fill: C.teal }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {periodo.t === "sem" ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              {thW(["Día", "Envíos", "Dem.", "Repro21", "Post21"])}
              <tbody>
                {dias.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.faint}` }}>
                    <td style={{ padding: "5px 8px", fontWeight: 600 }}>{fmtDDMM(r.fecha)}</td>
                    <td style={{ ...tdR, color: r.cant > tope ? C.critText : C.ink }}>{fmtInt(r.cant)}</td>
                    <td style={tdR}>{fmtInt(r.dem)}</td>
                    <td style={tdR}>{fmtInt(r.d21)}</td>
                    <td style={tdR}>{fmtInt(r.p21)}</td>
                  </tr>
                ))}
                {dias.length === 0 && <tr><td colSpan={5} style={{ padding: 8, color: C.muted }}>Sin días registrados en el período.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : periodo.t === "ult4" ? (
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Una fila por semana (últimas 4)</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              {thW(["Semana", "Envíos", "SLA", "Post21"])}
              <tbody>
                {s4.map(filaSem)}
                {s4.length === 0 && <tr><td colSpan={4} style={{ padding: 8, color: C.muted }}>Sin semanas registradas.</td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 5 }}>Peores semanas</div>
            {peores.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>Sin semanas con muestra suficiente.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {peores.map((w, i) => (
                  <div key={i} style={{ fontSize: 12.5 }}><span style={{ color: C.muted }}>•</span> <b>{w.name}</b> · <span style={{ color: slaColor(w.sla) }}>SLA {fmt1(w.sla)}%</span> · {fmt0(w.post21)}% post-21</div>
                ))}
              </div>
            )}
            {serie.length > 3 && (
              <div onClick={() => setVerHist((v) => !v)} style={{ marginTop: 8, fontSize: 12, color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                {verHist ? "▾ ocultar historial completo" : `▸ ver historial completo (${serie.length} semanas)`}
              </div>
            )}
            {verHist && (
              <div className="flexit-scroll" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", border: `1px solid ${C.faint}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  {thW(["Semana", "Envíos", "SLA", "Post21"])}
                  <tbody>{serie.slice().reverse().map(filaSem)}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
  // ---- Seguimiento de decisiones: marcar "hecho" cierra el loop decidir → actuar → ¿mejoró? ----
  const marcar = async (a) => {
    try {
      const rows = await sbWrite("decisiones_seguimiento", "POST", { nombre: a.name, kind: a.kind, tipo: a.tipo, dato: a.dato, sla_al_marcar: a.c ? a.c.sla : (a.z ? a.z.sla : null) });
      if (rows && rows.length) setSeguim((s) => [...rows, ...(s || [])]);
    } catch (e) { /* best effort: sin conexión no rompe la pantalla */ }
  };
  const desmarcar = async (id) => {
    try { await sbWrite(`decisiones_seguimiento?id=eq.${id}`, "DELETE"); setSeguim((s) => (s || []).filter((r) => r.id !== id)); } catch (e) { }
  };
  // Línea de seguimiento para una alerta: botón "✔ Hecho" / badge de hoy (con deshacer) / "hecho el DD/MM" + ¿mejoró?
  const segNode = (a) => {
    if (!seguim) return null;
    const marks = seguim.filter((r) => r.nombre === a.name);
    const last = marks[0];
    const esHoy = last && last.fecha === hoyAR();
    const slaNow = a.c ? a.c.sla : (a.z ? a.z.sla : null);
    return (
      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
        {esHoy ? (
          <span onClick={() => desmarcar(last.id)} title="Tocá para deshacer" style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: "rgba(46,207,170,0.12)", border: "1px solid rgba(46,207,170,0.35)", borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>✔ marcado hoy</span>
        ) : (
          <button onClick={() => marcar(a)} title="Marcar que ya lo hiciste (hablaste / redistribuiste / revisaste)" style={{ fontSize: 11, fontWeight: 700, color: C.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>✔ Hecho</button>
        )}
        {last && !esHoy && (
          <span style={{ fontSize: 11, color: C.muted }}>
            ✔ hecho el {fmtDDMM(last.fecha)}
            {last.sla_al_marcar != null && slaNow != null ? <> · SLA {fmt1(last.sla_al_marcar)} → <b style={{ color: slaNow >= last.sla_al_marcar ? C.goodText : C.critText }}>{fmt1(slaNow)}% {slaNow >= last.sla_al_marcar ? "↑" : "↓"}</b></> : null}
          </span>
        )}
      </div>
    );
  };

  const toggleDrill = (kind, name, src) => setDrill((d) => (d && d.src === src && d.name === name && d.kind === kind) ? null : { kind, name, src });
  const isOpen = (kind, name, src) => !!drill && drill.src === src && drill.name === name && drill.kind === kind;
  const navDrill = (dir) => {
    if (!drill || drill.kind !== "cadete") return;
    const list = rankingF.map((c) => c.name);
    const i = list.indexOf(drill.name);
    if (i < 0) return;
    setDrill({ ...drill, name: list[(i + dir + list.length) % list.length] });
  };

  // Texto plano para WhatsApp con las alertas + lo positivo + el resumen (mismos números que la pantalla).
  const resumenTexto = () => {
    const L = [`📊 Flexit · ${periodDesc}`];
    if (maxFecha) L.push(`Datos hasta ${fmtDMY(maxFecha)}`);
    L.push("", `🟠 ${tituloAtender}:`);
    if (alertas.cadetes.length === 0) L.push("• Nadie en rojo 👏");
    else alertas.cadetes.slice(0, 3).forEach((a) => L.push(`• ${a.name} · ${a.accion} — ${a.motivo}`));
    const pos = [];
    sug.caballos.slice(0, 3).forEach((c) => pos.push(`${c.name} — ${fmtInt(c.cant)} envíos, SLA ${fmt1(c.sla)}%`));
    sug.mejora.slice(0, 3).forEach((c) => pos.push(`${c.name} — SLA ${fmt1(c.sla)}% (+${fmt1(c.delta)} pp)`));
    if (pos.length) { L.push("", "💪 Lo positivo:"); pos.slice(0, 3).forEach((p) => L.push(`• ${p}`)); }
    L.push("", `SLA Meli ${cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"} · ${fmtInt(cur.g.cant)} envíos`);
    return L.join("\n");
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(resumenTexto()); setCopiado(true); setTimeout(() => setCopiado(false), 1800); }
    catch (e) { setCopiado(false); }
  };

  const periodoParcial = periodLabels.some((l) => weeks.find((w) => w.label === l)?.parcial);
  const pocasZonas = zonasInfo.weeks > 0 && zonasInfo.weeks < 2;
  const badge = (txt) => <span key={txt} style={{ fontSize: 10.5, fontWeight: 600, color: "#f3c886", background: "rgba(239,159,39,0.12)", border: "1px solid rgba(239,159,39,0.30)", borderRadius: 999, padding: "2px 9px" }}>{txt}</span>;

  return (
    <div style={{ color: C.ink }}>
      {/* Selector de período — control segmentado prominente y fijo arriba */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: C.bg, paddingTop: 8, paddingBottom: 10, marginBottom: 12, borderBottom: `1px solid ${C.faint}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 7 }}>¿Qué querés revisar?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[["sem", "Esta semana"], ["ult4", "Últimas 4 semanas"], ["todo", "Historial"]].map(([t, txt]) => {
            const on = periodo.t === t;
            return (
              <button key={t} onClick={() => setPeriodo((p) => ({ t, w: t === "sem" ? (p.w || periodW) : p.w }))}
                style={{ flex: "1 1 150px", minWidth: 130, padding: "7px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left", border: `1px solid ${on ? C.teal : C.border}`, background: on ? "rgba(46,207,170,0.12)" : C.cardAlt, color: on ? "#A5F0DD" : C.ink, boxShadow: on ? `inset 0 3px 0 ${C.teal}` : "none" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{txt}</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: on ? "rgba(165,240,221,0.7)" : C.muted, marginTop: 1 }}>{subPeriodo[t] || "—"}</div>
              </button>
            );
          })}
        </div>
        {periodo.t === "sem" && (
          <select value={periodW || ""} onChange={(e) => setPeriodo({ t: "sem", w: e.target.value })}
            style={{ marginTop: 8, padding: "8px 12px", borderRadius: 9, background: C.cardAlt, color: C.ink, border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600, width: "100%", maxWidth: 300 }}>
            {labels.slice().reverse().map((l) => {
              const w = weekByLabel(l);
              return <option key={l} value={l}>{"Semana del " + fmtSemLabel(l) + (w?.enCurso ? " (en curso)" : w?.parcial ? " (parcial)" : "")}</option>;
            })}
          </select>
        )}
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
          {periodDesc}{prevLabels ? " · comparado contra " + (periodo.t === "sem" ? (enCursoActual ? `los mismos ${nCurDias} días de la sem. del ` : "la semana del ") + fmtSemLabel(prevLabels[0]) : "las 4 semanas anteriores") : ""}
        </div>
      </div>

      {/* Frescura de datos — arriba de todo */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
        <span>📅 Datos hasta <b style={{ color: C.ink }}>{maxFecha ? fmtDMY(maxFecha) : "—"}</b></span>
        {periodoParcial && !enCursoActual && badge("semana en curso · parcial")}
        {pocasZonas && badge(`localidades: histórico corto${zonasInfo.desde ? " (desde " + fmtDDMM(zonasInfo.desde) + ")" : ""}`)}
      </div>

      {/* Banner fuerte cuando la semana elegida está en curso (todavía se está llenando) */}
      {enCursoActual && (
        <div style={{ background: "rgba(239,159,39,0.12)", border: "1px solid rgba(239,159,39,0.40)", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#f3c886" }}>⏳ Semana en curso · datos hasta {maxFecha ? fmtDMY(maxFecha) : "—"}</span>
          <span style={{ fontSize: 12, color: C.muted }}>La comparación es contra los <b style={{ color: C.ink }}>mismos {nCurDias} día{nCurDias === 1 ? "" : "s"}</b> de la semana anterior, no contra la semana completa.</span>
        </div>
      )}

      {/* Titular del analista (agente del VPS) — arriba de todo, con el informe completo colapsable */}
      {informeStd && informeStd.titular && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>🧠 Análisis del {informeStd.row.tipo === "semanal" ? "semanal" : "día"} · {fmtDDMM(informeStd.row.fecha)}</div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, color: C.ink }}>{informeStd.titular}</div>
            <div onClick={() => setVerInforme((v) => !v)} style={{ marginTop: 9, fontSize: 12, color: C.teal, cursor: "pointer", fontWeight: 600 }}>
              {verInforme ? "▾ ocultar informe completo" : "▸ ver informe completo del analista"}
            </div>
            {verInforme && <div style={{ marginTop: 8, borderTop: `1px solid ${C.faint}`, paddingTop: 8 }}><Markdown md={informeStd.row.informe_md} /></div>}
          </div>
        </div>
      )}


      {/* === Decisiones de la semana (v2) === */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>{tituloBloque}</h3>
        {/* Titular de horario (idea del ML21): reemplaza a la tile "Post-21 (flota)" — es el mismo
            dato en positivo, con la proporción visible. NO se suma a las tiles: las tiles bajaron
            de 4 a 3. Menos piezas, no más. */}
        {antes21 != null && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.80)", fontWeight: 600 }}>
                El <b style={{ fontSize: 22, fontWeight: 800, color: colorAntes21 }}>{fmt1(antes21)}%</b> de las entregas fue antes de las {String(corte).padStart(2, "0")}:00
              </div>
              {dAntes21 != null && (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: dAntes21 >= 0 ? C.goodText : C.critText }}>
                  {(dAntes21 >= 0 ? "+" : "−") + fmt1(Math.abs(dAntes21))} pp <span style={{ color: C.muted, fontWeight: 400 }}>vs {prevLbl}</span>
                </span>
              )}
              {/* Horario de corte (como el del ML21). Solo se puede mover si el período tiene
                  histograma por hora; en semanas viejas sin backfill queda el 21:00 de siempre. */}
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 11, color: C.muted }}>corte</span>
                {hayHoras ? (
                  <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                    <select value={corte} onChange={(e) => setCorte(+e.target.value)}
                      style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", padding: "3px 22px 3px 10px", fontSize: 11.5, fontWeight: 700, borderRadius: 20, cursor: "pointer", border: `1px solid ${corte === 21 ? C.border : C.teal}`, background: corte === 21 ? "rgba(255,255,255,0.04)" : "rgba(46,207,170,0.16)", color: corte === 21 ? C.muted : C.teal, outline: "none" }}>
                      {[18, 19, 20, 21, 22, 23].map((h) => <option key={h} value={h} style={{ background: "#141a2e", color: "#fff" }}>{String(h).padStart(2, "0")}:00</option>)}
                    </select>
                    <span style={{ position: "absolute", right: 9, pointerEvents: "none", fontSize: 8, color: corte === 21 ? C.muted : C.teal }}>▼</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }} title="Este período se cargó antes de que se guardara la hora de cada entrega">21:00 fijo</span>
                )}
              </span>
            </div>
            <div style={{ display: "flex", height: 11, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.06)", marginTop: 11 }}>
              <div style={{ width: `${antes21}%`, background: colorAntes21, transition: "width .5s ease" }} />
              <div style={{ width: `${100 - antes21}%`, background: C.crit, opacity: 0.85 }} />
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: C.muted, marginTop: 8 }}>
              <span><span style={{ width: 8, height: 8, borderRadius: 3, background: colorAntes21, display: "inline-block", marginRight: 6 }} />{fmtInt(entregasConHora - fueraCorte)} en horario</span>
              <span><span style={{ width: 8, height: 8, borderRadius: 3, background: C.crit, display: "inline-block", marginRight: 6 }} />{fmtInt(fueraCorte)} fuera de horario</span>
              {corte !== 21 && <span style={{ color: C.teal }}>· a las 21:00 era {fmt1(antesDeCorte(cur.g.horas, 21))}%</span>}
              {peorPunto && <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.42)" }}>peor {tendData.modo}: {peorPunto.name} · {fmt1(peorPunto.antes)}%</span>}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <Tile label="SLA Meli (solo ML)" value={cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"} dot={slaColor(cur.g.sla)} delta={dSla != null ? <DeltaSpan delta={dSla} unidad="pp" bueno="up" prevLbl={prevLbl} /> : null}
            spark={<Spark vals={sSla} color={C.good} />}
            open={lenteReg === "sla" && !!regionAbierta}
            // Antes esto también te tiraba al árbol del fondo de la página. Ahora baja apenas hasta
            // las tarjetas de Regiones, que están acá nomás, con la lente SLA puesta.
            onClick={() => { setLenteReg("sla"); setTimeout(() => { const el = document.getElementById("regiones-bloque"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); }} />
          <Tile label="Envíos (ML + particulares)" value={fmtInt(cur.g.cant)} spark={<Spark vals={sEnv} color={C.good} />} delta={dVol != null ? <DeltaSpan delta={dVol} unidad="" bueno="up" prevLbl={prevLbl} /> : (parcialActual ? <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>semana en curso</div> : null)} />
          <Tile label="Pendientes" value={fmtInt(cur.g.pend)} dot={cur.g.pendRate >= 0.05 ? C.warn : null} sub={`${fmt1(cur.g.pendRate * 100)}% del total`} spark={<Spark vals={sPend} color={C.good} />} delta={dPend != null ? <DeltaSpan delta={dPend} unidad="" bueno="down" prevLbl={prevLbl} /> : null} />
        </div>

        {/* Regiones — la geografía primero: el problema suele empezar en una zona, no en una persona */}
        {jerarquia && !jerarquia.vacio && (() => {
          const regs = jerarquia.regiones.filter((r) => !r.nombre.startsWith("Sin") && r.envios_ml > 0);
          if (!regs.length) return null;
          const sinML = jerarquia.regiones.filter((r) => r.nombre.startsWith("Sin")).reduce((a, r) => a + r.envios_ml, 0);
          const flecha = (d) => d == null ? null
            : d <= -CFG.regionFlecha2 ? { t: "↓↓", c: C.crit }
              : d <= -CFG.regionFlecha ? { t: "↓", c: C.critText }
                : d >= CFG.regionFlecha ? { t: "↑", c: C.goodText }
                  : { t: "→", c: C.muted };
          // Tocar una región abre el detalle ACÁ MISMO, debajo de las tarjetas. Antes te mandaba
          // con scroll al árbol del final de la página: perdías el contexto y aterrizabas en una
          // sección que no era la que estabas mirando.
          const abrirRegion = (nombre) => {
            setRegionAbierta((r) => (r === nombre ? null : nombre));
            setZonaAbierta(null);
          };
          const hor = lenteReg === "hor"; // lente: SLA (solo ML) o Horario (% entregado antes de las 21)
          return (
            <div id="regiones-bloque" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>🗺️ Regiones</span>
                <span style={{ fontSize: 11, color: C.muted }}>¿qué zona se está rompiendo? · tocá una región para el detalle</span>
                {/* Dos lentes sobre las MISMAS tarjetas — no son tarjetas nuevas. El SLA casi no se
                    mueve (todo verde, cero señal); el horario sí discrimina. */}
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, padding: 3, borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${C.border}` }}>
                  {[["sla", "SLA"], ["hor", "Horario"]].map(([k, lb]) => {
                    const on = lenteReg === k;
                    return (
                      <button key={k} onClick={() => setLenteReg(k)}
                        style={{ height: 26, padding: "0 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                          border: `1px solid ${on ? "rgba(46,207,170,0.45)" : "transparent"}`, background: on ? "rgba(46,207,170,0.16)" : "transparent", color: on ? C.teal : C.muted }}>{lb}</button>
                    );
                  })}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {regs.map((r) => {
                  // La flecha compara el MISMO subconjunto de días de las dos semanas (ver prevRegiones),
                  // no el valor grande de la tarjeta contra un período incompleto.
                  const pvo = prevRegiones ? prevRegiones.prev[r.nombre] : null;
                  const cvo = prevRegiones ? prevRegiones.cmp[r.nombre] : null;
                  // Con histograma la lente Horario respeta el corte elegido; sin él, 21:00 fijo.
                  const horDe = (o) => o ? (totalHoras(o.horas) > 0 ? antesDeCorte(o.horas, corte) : o.hor) : null;
                  const pv = pvo ? (hor ? horDe(pvo) : pvo.sla) : null;
                  const cv = cvo ? (hor ? horDe(cvo) : cvo.sla) : null;
                  const val = hor
                    ? (totalHoras(r.horas) > 0 ? antesDeCorte(r.horas, corte) : (r.entregados > 0 ? 100 - r.post21Rate : null))
                    : r.sla;
                  const col = hor ? horColor(val) : slaColor(r.sla);
                  const d = (pv != null && cv != null) ? cv - pv : null;
                  const f = flecha(d);
                  const pie = hor ? `${fmtInt(r.entregados)} entregas` : `${fmtInt(r.envios_ml)} ML`;
                  const abierta = regionAbierta === r.nombre;
                  return (
                    <div key={r.nombre} onClick={() => abrirRegion(r.nombre)}
                      style={{ flex: "1 1 125px", minWidth: 115, background: abierta ? "rgba(46,207,170,0.07)" : C.cardAlt, border: `1px solid ${abierta ? "rgba(46,207,170,0.45)" : C.border}`, borderLeft: `3px solid ${col}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer" }}>
                      <div style={{ fontSize: 11.5, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, display: "inline-block", flex: "0 0 auto" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</span>
                        <span style={{ marginLeft: "auto", color: C.teal, fontSize: 11 }}>{abierta ? "▾" : "▸"}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
                        <span style={{ fontSize: 19, fontWeight: 700, color: col }}>{val != null ? fmt1(val) + "%" : "—"}</span>
                        {f && <span style={{ fontSize: 14, fontWeight: 700, color: f.c }}>{f.t}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{pie}{d != null ? " · " + (d >= 0 ? "+" : "−") + fmt1(Math.abs(d)) + " pp" : ""}</div>
                    </div>
                  );
                })}
              </div>
              {/* Detalle de la región, acá abajo. Misma lente que las tarjetas: si estás mirando
                  Horario, las zonas también se ordenan y se leen por horario. */}
              {(() => {
                const reg = regionAbierta ? regs.find((x) => x.nombre === regionAbierta) : null;
                if (!reg) return null;
                const valDe = (o) => hor
                  ? (totalHoras(o.horas) > 0 ? antesDeCorte(o.horas, corte) : (o.entregados > 0 ? 100 - o.post21Rate : null))
                  : o.sla;
                const colDe = (v) => hor ? horColor(v) : slaColor(v);
                const zonas = (reg.zonasArr || []).slice().sort((a, b) => {
                  const va = valDe(a), vb = valDe(b);
                  if (va == null && vb == null) return b.envios_ml - a.envios_ml;
                  if (va == null) return 1; if (vb == null) return -1;
                  return va - vb; // peor primero
                });
                const regVal = valDe(reg);
                return (
                  <div style={{ marginTop: 10, background: C.card, border: "1px solid rgba(46,207,170,0.28)", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{reg.nombre}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: colDe(regVal) }}>{regVal != null ? fmt1(regVal) + "%" : "—"}</span>
                      <span style={{ fontSize: 11, color: C.muted }}>
                        {hor ? `${fmtInt(reg.entregados)} entregas · antes de las ${String(corte).padStart(2, "0")}:00` : `${fmtInt(reg.envios_ml)} ML · SLA Meli`}
                        {` · ${zonas.length} ${zonas.length === 1 ? "zona" : "zonas"}, peor primero`}
                      </span>
                      <span onClick={() => { setRegionAbierta(null); setZonaAbierta(null); }} style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted, cursor: "pointer" }}>cerrar ✕</span>
                    </div>
                    <div className="flexit-scroll" style={{ maxHeight: 300, overflowY: "auto" }}>
                      {zonas.map((z) => {
                        const v = valDe(z), abierta = zonaAbierta === z.nombre;
                        const locs = (z.localidades || []).slice().sort((a, b) => {
                          const va = valDe(a), vb = valDe(b);
                          if (va == null && vb == null) return b.envios_ml - a.envios_ml;
                          if (va == null) return 1; if (vb == null) return -1;
                          return va - vb;
                        });
                        return (
                          <div key={z.nombre}>
                            <div onClick={() => setZonaAbierta(abierta ? null : z.nombre)}
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 4px", borderTop: `1px solid ${C.faint}`, cursor: locs.length ? "pointer" : "default" }}>
                              <span style={{ width: 11, color: C.teal, fontSize: 11, flex: "0 0 auto" }}>{locs.length ? (abierta ? "▾" : "▸") : ""}</span>
                              <span style={{ flex: "1 1 auto", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.nombre}</span>
                              <span style={{ flex: "0 0 auto", fontSize: 11, color: C.muted, minWidth: 54, textAlign: "right" }}>{hor ? fmtInt(z.entregados) : fmtInt(z.envios_ml)}</span>
                              <span style={{ flex: "0 0 auto", fontSize: 12.5, fontWeight: 700, color: colDe(v), minWidth: 52, textAlign: "right" }}>{v != null ? fmt1(v) + "%" : "—"}</span>
                            </div>
                            {abierta && locs.map((l) => {
                              const lv = valDe(l);
                              return (
                                <div key={l.nombre || l.localidad} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px 5px 23px", borderTop: `1px solid ${C.faint}`, background: "rgba(255,255,255,0.02)" }}>
                                  <span style={{ flex: "1 1 auto", fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.nombre || l.localidad}</span>
                                  <span style={{ flex: "0 0 auto", fontSize: 11, color: C.muted, minWidth: 54, textAlign: "right" }}>{hor ? fmtInt(l.entregados) : fmtInt(l.envios_ml)}</span>
                                  <span style={{ flex: "0 0 auto", fontSize: 12, fontWeight: 600, color: colDe(lv), minWidth: 52, textAlign: "right" }}>{lv != null ? fmt1(lv) + "%" : "—"}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {hor && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5 }}>% de entregas antes de las {String(corte).padStart(2, "0")}:00 — el SLA puede estar intacto y la región estar entregando cada vez más tarde.</div>}
              {prevRegiones && prevRegiones.parcial && (
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
                  ⚠️ La flecha compara solo {prevRegiones.dias} {prevRegiones.dias === 1 ? "día" : "días"} — son los únicos con dato por zona en las dos semanas. El % grande sí es de todo el período.
                </div>
              )}
              {sinML > 0 && jerarquia.pctSinZona >= 5 && (
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5 }}>+ {fmtInt(sinML)} envíos ML sin zona asignada — no entran en las tarjetas de región</div>
              )}
            </div>
          );
        })()}

        {/* Atender hoy — tarjetas por cadete, la más urgente resaltada */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: verAtender ? 8 : 0 }}>
            <div onClick={() => setVerAtender((v) => !v)} style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.teal, fontSize: 12 }}>{verAtender ? "▾" : "▸"}</span>
              <span>{enCursoActual ? "🔥" : "🟠"} {tituloAtender} <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· {alertas.nCad} {alertas.nCad === 1 ? "cadete" : "cadetes"}{alertas.nLoc ? ` · ${alertas.nLoc} localidad${alertas.nLoc === 1 ? "" : "es"} a vigilar` : ""}</span></span>
            </div>
            {verAtender && <button onClick={(e) => { e.stopPropagation(); copiar(); }} title="Copiar resumen para WhatsApp" style={{ background: copiado ? "rgba(46,207,170,0.16)" : C.cardAlt, border: `1px solid ${copiado ? C.teal : C.border}`, borderRadius: 8, color: copiado ? C.teal : C.muted, fontSize: 12, fontWeight: 600, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
              {copiado ? "✓ Copiado" : "💬 Copiar resumen"}
            </button>}
          </div>
          {verAtender && (alertas.cadetes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.muted, padding: "6px" }}>Nadie en rojo este período. 👏</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {alertas.cadetes.map((a, i) => {
                const enr = informeStd && informeStd.porCadete[a.name];
                const abierto = isOpen("cadete", a.name, "alert");
                const urgente = i === 0;
                return (
                  <div key={a.key} style={{ border: `1px solid ${urgente ? "rgba(229,96,77,0.55)" : C.border}`, background: urgente ? "rgba(229,96,77,0.07)" : C.cardAlt, borderRadius: 10, overflow: "hidden" }}>
                    <div onClick={() => toggleDrill("cadete", a.name, "alert")} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", cursor: "pointer" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: urgente ? C.crit : "#F2953F", marginTop: 5, flex: "0 0 auto" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{a.name} <span style={{ color: C.teal, fontWeight: 600 }}>· {a.accion}</span>{urgente && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: C.critText, background: "rgba(229,96,77,0.16)", borderRadius: 5, padding: "1px 6px" }}>MÁS URGENTE</span>}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{a.motivo}</div>
                        {enr && enr.accion && <div style={{ fontSize: 12, color: C.goodText, marginTop: 4, lineHeight: 1.45 }}>💡 Analista: {enr.accion}</div>}
                        {segNode(a)}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", marginLeft: 8 }}>{a.dato}</div>
                      <span style={{ color: C.teal, fontSize: 12, marginLeft: 4, flex: "0 0 auto" }}>{abierto ? "▾" : "▸"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Localidades a vigilar — parte de las acciones, no del detalle. Plegado por defecto:
            son muchas filas y tapaban lo que sigue; el contador en el encabezado alcanza para
            saber si vale la pena abrirlo. */}
        {alertas.locs.length > 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
            <div onClick={() => setVerLocs((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, marginBottom: verLocs ? 4 : 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.teal, fontSize: 12 }}>{verLocs ? "▾" : "▸"}</span>
              <span>📍 Localidades a vigilar <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· {alertas.locs.length}</span></span>
            </div>
            {verLocs && alertas.locs.map((a) => <AlertRow key={a.key} a={a} seg={segNode(a)} onClick={() => toggleDrill(a.kind, a.name, "locv")} abierto={isOpen(a.kind, a.name, "locv")} />)}
          </div>
        )}

        {/* Capacidad para redistribuir — cadetes confiables con lugar */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
          <div onClick={() => setVerCapacidad((v) => !v)} style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: verCapacidad ? 4 : 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.teal, fontSize: 12 }}>{verCapacidad ? "▾" : "▸"}</span>
            <span>🔄 Capacidad para redistribuir <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· alto volumen y buen SLA, adónde pasar carga{!verCapacidad && sug.caballos.length ? ` · ${sug.caballos.length}` : ""}</span></span>
          </div>
          {verCapacidad && <>
          {informeStd && informeStd.capacidad && informeStd.capacidad.accion && <div style={{ fontSize: 12, color: C.goodText, marginBottom: 8, lineHeight: 1.45 }}>💡 Analista: {informeStd.capacidad.accion}</div>}
          {sug.caballos.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.muted, padding: "6px" }}>Sin caballitos de alto volumen y buen SLA en el período.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {sug.caballos.slice(0, 6).map((c) => {
                const tope = c.tope || CFG.tope; const margen = Math.round(tope - c.prom);
                return (
                  <div key={c.name} style={{ flex: "1 1 190px", minWidth: 0, border: `1px solid ${C.border}`, background: C.cardAlt, borderRadius: 10, padding: "9px 11px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💪 {c.name}</div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>SLA {fmt1(c.sla)}% · {fmtInt(c.cant)} envíos · {fmt1(c.prom)}/día{margen > 3 ? <span style={{ color: C.goodText }}> · margen ~{margen}/día</span> : ""}</div>
                  </div>
                );
              })}
            </div>
          )}
          </>}
        </div>
        {/* Alertas operativas / calidad de datos — separadas de los cadetes */}
        {(() => {
          const op = cur.g.oper;
          const items = [
            ["Sin asignar", op.sinAsignar, "envíos sin cadete"],
            ["Quedó en depósito", op.quedo, "no salió a reparto"],
            ["Devuelto a depósito", op.devuelto, "volvió al depósito"],
            ["Repro gramar", op.repro, "nombre basura en LightData"],
            ["Otros anómalos", op.otros, "nombres a limpiar"],
          ].filter(([, n]) => n > 0);
          if (!items.length) return null;
          return (
            <div style={{ marginTop: 12, background: "rgba(226,75,74,0.06)", border: "1px solid rgba(226,75,74,0.22)", borderRadius: 12, padding: "14px 16px" }}>
              <div onClick={() => setVerAlertasOp((v) => !v)} style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: verAlertasOp ? 6 : 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#F2937F", fontSize: 12 }}>{verAlertasOp ? "▾" : "▸"}</span>
                <span>🧹 Alertas operativas / calidad de datos <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· no son cadetes, revisar carga en LightData{!verAlertasOp ? ` · ${items.length}` : ""}</span></span>
              </div>
              {verAlertasOp && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {items.map(([lbl, n, sub]) => (
                  <div key={lbl} style={{ flex: "1 1 150px", minWidth: 0, background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#F2937F" }}>{lbl}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{fmtInt(n)} envíos · {sub}</div>
                  </div>
                ))}
              </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* === 2 · Cadetes (Semáforo migrado) === */}
      <h2 style={{ fontSize: 16, margin: "28px 0 14px", borderTop: `1px solid ${C.faint}`, paddingTop: 18 }}>Cadetes <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· ranking, semáforo y filtros</span></h2>

      {/* Ranking completo */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Ranking completo <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>{isMobile ? "(tocá una tarjeta para el detalle)" : "(clic en una columna para ordenar · clic en una fila para el detalle)"}</span></h3>
      {/* chips de filtro rápido */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {[["criticos", "🔴 Solo críticos"], ["riesgo", "🟡 En riesgo"], ["ok", "🟢 OK"], ["sobre", "📦 Sobre tope"], ["tarde", "🌙 Terminan tarde"], ["caida", "📉 En caída"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setChip((x) => (x === k ? null : k))}
            style={{ padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", borderRadius: 999, border: `1px solid ${chip === k ? C.teal : C.border}`, background: chip === k ? "rgba(46,207,170,0.14)" : "transparent", color: chip === k ? C.teal : C.muted }}>
            {lbl}
          </button>
        ))}
        {chip && <span style={{ fontSize: 11.5, color: C.muted, alignSelf: "center" }}>{rankingF.length} de {ranking.length}</span>}
        {!isMobile && (
          <button onClick={() => setVerAvanzadas((v) => !v)}
            style={{ marginLeft: "auto", padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", borderRadius: 999, border: `1px solid ${verAvanzadas ? C.teal : C.border}`, background: verAvanzadas ? "rgba(46,207,170,0.14)" : "transparent", color: verAvanzadas ? C.teal : C.muted }}>
            {verAvanzadas ? "− Ocultar métricas avanzadas" : "⚙️ Métricas avanzadas"}
          </button>
        )}
      </div>
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {rankingF.map((c, i) => (
            <div key={i} onClick={() => toggleDrill("cadete", c.name, "rank")} style={{ background: C.cardAlt, border: `1px solid ${isOpen("cadete", c.name, "rank") ? C.teal : C.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ color: slaColor(c.sla), fontWeight: 700, whiteSpace: "nowrap" }}>{c.sla != null ? fmt1(c.sla) + "%" : "—"}</span>
                <span style={{ color: C.teal, flex: "0 0 auto" }}>{isOpen("cadete", c.name, "rank") ? "▾" : "▸"}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{fmtInt(c.cant)} envíos · {fmt1(c.prom)}/día vs tope {c.tope || CFG.tope} · {fmt0(c.p21rate * 100)}% post 21</div>
            </div>
          ))}
          {rankingF.length === 0 && <div style={{ color: C.muted, fontSize: 12.5, padding: "12px 4px" }}>Nadie cumple ese filtro. 👏</div>}
        </div>
      ) : (
      <div className="flexit-scroll" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, /* padding SOLO a los costados y abajo: con padding arriba quedaban 4px sin cubrir por donde asomaba la fila que pasa por detrás del encabezado fijo */ padding: "0 4px 4px", marginBottom: 16, overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {th("name", "Cadete")}{th("cant", "Envíos", 1)}
              {verAvanzadas && th("pctVol", "% vol.", 1)}{verAvanzadas && th("prom", "Prom/día", 1)}
              {th("sla", "SLA", 1)}
              {verAvanzadas && th("delta", "Δ SLA", 1)}{verAvanzadas && th("dem", "Dem.", 1)}{verAvanzadas && th("d21", "Repro21", 1)}
              {th("p21rate", "Post21", 1)}
              {verAvanzadas && th("pctSobreTope", "% >tope", 1)}
              {th("fin", "Fin prom.", 1)}
            </tr>
          </thead>
          <tbody>
            {rankingF.map((c, i) => (
              <tr key={i} onClick={() => toggleDrill("cadete", c.name, "rank")} style={{ borderBottom: `1px solid ${C.faint}`, cursor: "pointer", background: isOpen("cadete", c.name, "rank") ? "rgba(46,207,170,0.08)" : "transparent" }}>
                <td style={{ padding: "9px 10px", fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: "9px 10px", textAlign: "right" }}>{fmtInt(c.cant)}</td>
                {verAvanzadas && <td style={{ padding: "9px 10px", textAlign: "right", color: C.muted }}>{fmt1(c.pctVol)}%</td>}
                {verAvanzadas && <td style={{ padding: "9px 10px", textAlign: "right" }}>{fmt1(c.prom)}</td>}
                <td style={{ padding: "9px 10px", textAlign: "right", color: slaColor(c.sla), fontWeight: 600 }}>{c.sla != null ? fmt1(c.sla) + "%" : "—"}</td>
                {verAvanzadas && <td style={{ padding: "9px 10px", textAlign: "right", color: c.delta == null ? C.muted : c.delta >= 0 ? C.goodText : C.critText }}>{c.delta == null ? "—" : (c.delta >= 0 ? "+" : "−") + fmt1(Math.abs(c.delta))}</td>}
                {verAvanzadas && <td style={{ padding: "9px 10px", textAlign: "right" }}>{fmtInt(c.dem)}</td>}
                {verAvanzadas && <td style={{ padding: "9px 10px", textAlign: "right" }}>{fmtInt(c.d21)}</td>}
                <td style={{ padding: "9px 10px", textAlign: "right" }}>{fmt0(c.p21rate * 100)}%</td>
                {verAvanzadas && <td style={{ padding: "9px 10px", textAlign: "right", color: c.pctSobreTope >= 0.3 ? C.critText : C.muted }}>{fmt0(c.pctSobreTope * 100)}%</td>}
                <td style={{ padding: "9px 10px", textAlign: "right", color: c.fin != null && c.fin >= CFG.tarde_fin ? C.critText : C.ink }}>{fmtHora(c.fin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
        Calidad de datos del período: {fmtInt(cur.g.sin)} envíos sin cadete asignado{cur.g.basura > 0 ? ` · ${fmtInt(cur.g.basura)} bajo nombres basura ("Repro gramar", "devuelto depósito") que conviene limpiar en LightData` : ""}. Los sin-asignar y basura cuentan en los KPIs pero quedan fuera del ranking de cadetes (ver "Alertas operativas" arriba).
      </div>

      {/* === 3 · Tendencia (Mensual migrado) — evolución adaptativa por período === */}
      <h2 style={{ fontSize: 16, margin: "28px 0 14px", borderTop: `1px solid ${C.faint}`, paddingTop: 18 }}>Tendencia <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· evolución {tendData.modo === "día" ? "diaria" : tendData.modo === "semana" ? "semanal" : "mensual"} de SLA y volumen</span></h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginBottom: 22 }}>
        {/* Calendario de volumen — mismo dato que las barras, con más contexto; un mes por vez con flechas */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
          {(() => {
            const meses = calStats.meses;
            if (!meses.length) return <div style={{ color: C.muted, fontSize: 12 }}>Sin datos todavía.</div>;
            const mk = calMes && meses.includes(calMes) ? calMes : meses[meses.length - 1];
            const idx = meses.indexOf(mk);
            const [y, mo] = mk.split("-").map(Number);
            const off = (new Date(y, mo - 1, 1).getDay() + 6) % 7; // lunes = 0
            const nd = new Date(y, mo, 0).getDate();
            const cells = Array.from({ length: off }, () => null).concat(Array.from({ length: nd }, (_, i) => i + 1));
            let pico = null;
            Object.entries(calStats.map).forEach(([f, s]) => { if (f.slice(0, 7) === mk && (!pico || s.cant > pico.s.cant)) pico = { f, s }; });
            // Totales del mes: se suman los envíos de ML y las demoras de todos los días y el SLA
            // se calcula sobre eso — el mismo criterio que el SLA de un día, pero del mes entero.
            const T = { dias: 0, cant: 0, ml: 0, dm: 0, d2: 0, ent: 0, p21: 0 };
            Object.entries(calStats.map).forEach(([f, s]) => {
              if (f.slice(0, 7) !== mk) return;
              T.dias++; T.cant += s.cant; T.ml += s.ml || 0; T.dm += s.dm || 0; T.d2 += s.d2 || 0; T.ent += s.ent || 0; T.p21 += s.p21 || 0;
            });
            const slaMes = slaMeli(T.ml, T.dm, T.d2);
            const p21Mes = T.ent > 0 ? T.p21 / T.ent * 100 : null;
            const navBtn = (dir, dis) => (
              <button disabled={dis} onClick={() => setCalMes(meses[idx + dir])} style={{ width: 26, height: 26, borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: dis ? C.dim : C.teal, cursor: dis ? "default" : "pointer", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{dir < 0 ? "‹" : "›"}</button>
            );
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Volumen del mes</div>
                  {navBtn(-1, idx === 0)}
                  <span style={{ fontSize: 12, fontWeight: 700, minWidth: 92, textAlign: "center", textTransform: "capitalize" }}>{MES_FULL[mo - 1]} {y}</span>
                  {navBtn(1, idx === meses.length - 1)}
                </div>
                {/* El SLA del mes entero, arriba de todo: el calendario muestra el día a día, pero
                    la pregunta que se hace primero es cómo viene el mes. */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", background: C.faint, border: `1px solid ${C.border}`, borderRadius: 9, padding: "8px 11px", margin: "8px 0" }}>
                  <span style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>SLA del mes</span>
                  <b style={{ fontSize: 21, color: slaColor(slaMes), lineHeight: 1 }}>{slaMes != null ? fmt1(slaMes) + "%" : "—"}</b>
                  <span style={{ fontSize: 11.5, color: C.muted }}>
                    {fmtInt(T.ml)} envíos ML · {fmtInt(T.dm + T.d2)} demoras
                    {T.d2 > 0 ? <span style={{ color: C.dim }}> ({fmtInt(T.dm)} demorados + {fmtInt(T.d2)} repro 21hs)</span> : null}
                    {p21Mes != null ? <> · {fmt1(p21Mes)}% post-21</> : null}
                    {" · "}{T.dias} {T.dias === 1 ? "día" : "días"} con datos
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Más verde = más envíos · puntito = SLA flojo ese día (🟡 &lt;{CFG.slaOk}% · 🔴 &lt;{CFG.slaCritico}%). Tocá un día para el detalle.</div>
                {pico && <div style={{ fontSize: 12, color: C.ink, marginBottom: 8 }}><span style={{ color: C.blue, fontWeight: 700 }}>⬆ pico:</span> <b style={{ textTransform: "capitalize" }}>{DIAS_SEM[new Date(pico.f + "T12:00:00").getDay()]} {fmtDDMM(pico.f)}</b> · {fmtInt(pico.s.cant)} envíos</div>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(26px, 1fr))", gap: 3 }}>
                  {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => <div key={d + i} style={{ fontSize: 9, color: C.muted, textAlign: "center" }}>{d}</div>)}
                  {cells.map((d, i) => {
                    if (d == null) return <div key={"e" + i} />;
                    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const s = calStats.map[iso];
                    const alpha = s && calStats.max ? 0.12 + 0.5 * (s.cant / calStats.max) : 0;
                    const sel = calSel && calSel.fecha === iso;
                    return (
                      <div key={iso} onMouseEnter={s ? () => setCalSel({ fecha: iso, s }) : undefined} onClick={s ? () => setCalSel({ fecha: iso, s }) : undefined}
                        style={{ height: 32, borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: s ? "pointer" : "default", background: s ? `rgba(46,207,170,${alpha.toFixed(2)})` : "transparent", border: `1px solid ${sel ? C.teal : "transparent"}` }}>
                        <span style={{ fontSize: 10.5, fontWeight: s ? 700 : 400, color: s ? C.ink : C.dim, lineHeight: 1 }}>{d}</span>
                        {s && s.sla != null && s.sla < CFG.slaOk && <span style={{ width: 5, height: 5, borderRadius: "50%", background: slaColor(s.sla), marginTop: 2 }} />}
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 10, borderTop: `1px solid ${C.faint}`, paddingTop: 8, fontSize: 12, minHeight: 22 }}>
                  {calSel ? (() => {
                    const s = calSel.s;
                    const dw = DIAS_SEM[new Date(calSel.fecha + "T12:00:00").getDay()];
                    return (
                      <span>
                        <b style={{ textTransform: "capitalize" }}>{dw} {fmtDMY(calSel.fecha)}</b> · {fmtInt(s.cant)} envíos · SLA <b style={{ color: slaColor(s.sla) }}>{s.sla != null ? fmt1(s.sla) + "%" : "—"}</b> · {fmtInt(s.dem)} demoras{s.p21r != null ? <> · {fmt1(s.p21r)}% post-21</> : null}{s.pend > 0 ? <> · {fmtInt(s.pend)} pendientes</> : null}
                      </span>
                    );
                  })() : <span style={{ color: C.muted, fontSize: 11.5 }}>Elegí un día para ver su detalle acá.</span>}
                </div>
              </>
            );
          })()}
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>SLA Meli por {tendData.modo}</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Una línea. La punteada es el objetivo (98%).</div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={tendData.datos.filter((d) => d.sla != null)} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" axisLine={{ stroke: C.faint }} tickLine={false} />
              <YAxis domain={[90, 100]} ticks={[90, 95, 100]} allowDataOverflow tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v + "%"} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ stroke: C.border }} contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt1(v) + "%", "SLA"]} labelStyle={{ color: C.muted }} />
              <ReferenceLine y={98} stroke={C.good} strokeOpacity={0.45} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="sla" stroke={C.teal} strokeWidth={2.5} dot={{ r: 2.5, fill: C.teal }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Post-21 por {tendData.modo}</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>% de entregas después de las 21 — ¿la operación se está corriendo a la noche? La punteada es el umbral de "tarde" ({CFG.tarde_post21 * 100}%).</div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={tendData.datos.filter((d) => d.p21r != null)} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" axisLine={{ stroke: C.faint }} tickLine={false} />
              <YAxis domain={[0, "auto"]} tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v + "%"} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ stroke: C.border }} contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt1(v) + "%", "Post-21"]} labelStyle={{ color: C.muted }} />
              <ReferenceLine y={CFG.tarde_post21 * 100} stroke={C.warn} strokeOpacity={0.5} strokeDasharray="4 4" />
              <Line type="monotone" dataKey="p21r" stroke={C.warn} strokeWidth={2.5} dot={{ r: 2.5, fill: C.warn }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* === 4 · Patrones (reincidentes — reemplaza las tarjetas masivas de Mensual) === */}
      <h2 style={{ fontSize: 16, margin: "28px 0 14px", borderTop: `1px solid ${C.faint}`, paddingTop: 18 }}>Patrones <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· reincidentes de demora en {periodDesc.toLowerCase()}</span></h2>
      {patrones.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, color: C.muted, fontSize: 12.5, marginBottom: 22 }}>Sin cadetes con demoras en el período. 👏</div>
      ) : (
        <>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, marginBottom: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>
                {[["name", "Cadete", 0], ["diasDem", "Días con demora", 1], ["demoras", "Demoras", 1], ["ultInc", "Última incidencia", 1], ["sla4", "Últimas 4 sem.", 1], ["tend", "Tendencia", 1]].map(([k, l, r]) => (
                  <th key={k} onClick={() => setPatSort(k)} style={{ padding: "9px 10px", textAlign: r ? "right" : "left", cursor: "pointer", color: patSort === k ? C.teal : C.muted, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{l}{patSort === k ? " \u25BC" : ""}</th>
                ))}
              </tr></thead>
              <tbody>
                {(verTodosPat ? patrones : patrones.slice(0, 10)).map((r, i) => (
                  <tr key={i} onClick={() => toggleDrill("cadete", r.name, "rank")} style={{ borderBottom: `1px solid ${C.faint}`, cursor: "pointer" }}>
                    <td style={{ padding: "9px 10px", fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: r.diasDem >= 3 ? C.critText : C.ink }}>{r.diasDem}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>{fmtInt(r.demoras)}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: C.muted }}>{r.ultInc ? fmtDDMM(r.ultInc) : "\u2014"}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: slaColor(r.sla4), fontWeight: 600 }}>{r.sla4 != null ? fmt1(r.sla4) + "%" : "\u2014"}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: r.tend > 0 ? C.goodText : r.tend < 0 ? C.critText : C.muted }}>{r.tend > 0 ? "\u2191 mejora" : r.tend < 0 ? "\u2193 empeora" : "\u2192"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {patrones.length > 10 && (
            <div onClick={() => setVerTodosPat((v) => !v)} style={{ fontSize: 12, color: C.teal, cursor: "pointer", fontWeight: 600, marginBottom: 12 }}>{verTodosPat ? "ver menos" : `ver todos (${patrones.length})`}</div>
          )}
          {periodo.t === "todo" && mejorasSost.length > 0 && (
            <div style={{ background: "rgba(46,207,170,0.07)", border: "1px solid rgba(46,207,170,0.25)", borderRadius: 12, padding: "9px 12px", marginBottom: 12, fontSize: 12, lineHeight: 1.7 }}>
              <b style={{ color: C.goodText }}>📈 Mejoras sostenidas</b> ·{" "}
              {mejorasSost.map((c, i) => <span key={c.name} onClick={() => toggleDrill("cadete", c.name, "rank")} style={{ cursor: "pointer" }}>{i > 0 ? " · " : ""}{c.name} <span style={{ color: C.muted }}>(+{fmt1(c.delta)}pp)</span></span>)}
            </div>
          )}
        </>
      )}

      {/* === 5 · Localidades (SLA por localidad + zona operativa) === */}
      <h2 style={{ fontSize: 16, margin: "28px 0 10px", borderTop: `1px solid ${C.faint}`, paddingTop: 18 }}>Localidades <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· SLA por localidad y zona operativa</span></h2>
      <div onClick={() => setVerIncompletos((v) => !v)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
        <span style={{ color: C.teal, fontSize: 14 }}>{verIncompletos ? "▾" : "▸"}</span>
        <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600, color: C.muted }}>{verIncompletos ? "Ocultar" : "Ver"} detalle de localidades <span style={{ fontWeight: 400, fontSize: 12 }}>· histórico corto (desde 24/07){alertas.nLoc ? ` · ${alertas.nLoc} a vigilar` : ""}</span></h3>
      </div>
      {verIncompletos && (
      <>
      {informeStd && (informeStd.zonas || informeStd.vigilar) && (
        <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
          {informeStd.zonas && <div style={{ marginBottom: informeStd.vigilar ? 8 : 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>🗺️ Zonas (analista)</div><div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}><Markdown md={informeStd.zonas} /></div></div>}
          {informeStd.vigilar && <div><div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>👁️ A vigilar (analista)</div><div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}><Markdown md={informeStd.vigilar} /></div></div>}
        </div>
      )}
      {/* Tabla plana de localidades (opción A, elegida por Alejo el 03/08). Reemplaza al árbol
          región → zona → localidad, que hacía lo mismo que el detalle inline de las tarjetas de
          Regiones y encima obligaba a abrir tres ramas para llegar a una localidad.
          Acá el trabajo es otro: ENCONTRAR una localidad puntual y ver todas ordenadas — por eso
          buscador, filtro por región y columnas ordenables. Y las dos lentes conviven como
          columnas (SLA y "antes del corte"), porque el SLA casi no discrimina: José C. Paz tiene
          SLA 95,95% y entrega el 72,5% antes de las 21. */}
      {jerarquia == null ? (
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 22 }}>Cargando localidades…</div>
      ) : jerarquia.vacio ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 22, color: C.muted, fontSize: 12.5, lineHeight: 1.6 }}>
          {jerarquia.desde
            ? `Todavía no hay datos por localidad para este período. La captura arrancó el ${fmtDMY(jerarquia.desde)} — elegí un período desde esa fecha.`
            : "Los datos por localidad se empiezan a capturar desde hoy (la Action nocturna guarda la primera foto esta noche). No hay histórico hacia atrás."}
          {zonasErr ? <div style={{ marginTop: 6, color: C.critText, fontSize: 11 }}>({zonasErr})</div> : null}
        </div>
      ) : (
      <>
      <div id="jer-sla" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 10px" }}>
        <input value={locBusca} onChange={(e) => setLocBusca(e.target.value)} placeholder="🔎 buscar localidad…"
          style={{ height: 30, padding: "0 12px", borderRadius: 20, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.25)", color: C.ink, fontSize: 12, outline: "none", fontFamily: "inherit", minWidth: 190 }} />
        <span style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${C.border}` }}>
          {["Todas", ...REG_ORDEN.filter((r) => !r.startsWith("Sin"))].map((r) => {
            const on = locRegion === r;
            return (
              <button key={r} onClick={() => setLocRegion(r)}
                style={{ height: 24, padding: "0 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${on ? "rgba(46,207,170,0.45)" : "transparent"}`, background: on ? "rgba(46,207,170,0.16)" : "transparent", color: on ? C.teal : C.muted }}>{r}</button>
            );
          })}
        </span>
        <span onClick={() => setLocTodas((v) => !v)} style={{ marginLeft: "auto", fontSize: 11, color: C.muted, cursor: "pointer", whiteSpace: "nowrap" }}>
          {locTodas ? "mostrando todas · " : `mínimo ${CFG.zonaMin} envíos ML · `}<span style={{ color: C.teal, fontWeight: 600 }}>{locTodas ? "ocultar muestra chica" : "ver todas"}</span>
        </span>
      </div>
      {jerarquia.avisoDesde && (
        <div style={{ fontSize: 11.5, color: C.warn, background: "rgba(232,184,75,0.10)", border: "1px solid rgba(232,184,75,0.28)", borderRadius: 8, padding: "7px 10px", marginBottom: 10, lineHeight: 1.45 }}>
          ⚠️ Los datos por zona se capturan desde el <b>{fmtDMY(jerarquia.avisoDesde)}</b>. El período elegido es más largo, así que esta tabla solo refleja <b>desde esa fecha</b> — no todo el período.
        </div>
      )}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 22 }}>
        {(() => {
          // Aplanar la jerarquía: una fila por localidad, con su zona operativa y su región.
          const filas = [];
          for (const reg of jerarquia.regiones) {
            for (const zn of reg.zonasArr) {
              for (const l of zn.localidades) {
                filas.push({
                  localidad: l.localidad, norm: l.localidad_norm, zona: zn.nombre, region: reg.nombre,
                  ml: l.envios_ml, ent: l.entregados, sla: l.sla, delta: l.delta,
                  hor: totalHoras(l.horas) > 0 ? antesDeCorte(l.horas, corte) : (l.entregados > 0 ? 100 - l.post21Rate : null),
                });
              }
            }
          }
          const q = norm(locBusca).toLowerCase();
          const vis = filas.filter((f) => (locTodas || f.ml >= CFG.zonaMin)
            && (locRegion === "Todas" || f.region === locRegion)
            && (!q || String(f.localidad).toLowerCase().includes(q) || String(f.zona).toLowerCase().includes(q)));
          const num = (v) => (v == null ? (locSort.dir === "asc" ? Infinity : -Infinity) : v);
          vis.sort((a, b) => {
            const va = num(a[locSort.col]), vb = num(b[locSort.col]);
            if (typeof a[locSort.col] === "string") {
              return locSort.dir === "asc" ? String(a[locSort.col]).localeCompare(String(b[locSort.col])) : String(b[locSort.col]).localeCompare(String(a[locSort.col]));
            }
            return locSort.dir === "asc" ? va - vb : vb - va;
          });
          const orden = (col) => setLocSort((s) => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "localidad" || col === "zona" || col === "region" ? "asc" : "asc" });
          const th2 = (col, label, right) => (
            <th onClick={() => orden(col)} style={{ padding: "0 9px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer", textAlign: right ? "right" : "left", color: locSort.col === col ? C.teal : "rgba(255,255,255,0.45)" }}>
              {label}{locSort.col === col ? (locSort.dir === "asc" ? " ↑" : " ↓") : ""}
            </th>
          );
          const td = { padding: "7px 9px", borderTop: `1px solid ${C.faint}`, fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", color: "rgba(255,255,255,0.86)" };
          const tdL = { ...td, textAlign: "left" };
          return (
            <>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span>{vis.length} localidad{vis.length === 1 ? "" : "es"} · tocá una columna para ordenar · Δ es contra el SLA global ({cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"})</span>
                <span style={{ color: jerarquia.pctSinZona >= 10 ? C.critText : C.muted, fontWeight: 600, whiteSpace: "nowrap" }}>Localidades sin zona op.: {fmtInt(jerarquia.locsSinZona)} · {fmt1(jerarquia.pctSinZona)}% del volumen</span>
              </div>
              <div className="flexit-scroll" style={{ maxHeight: 460, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    {th2("localidad", "Localidad")}{th2("zona", "Zona op.")}{th2("region", "Región")}
                    {th2("ml", "Envíos ML", true)}{th2("sla", "SLA Meli", true)}{th2("hor", `Antes de las ${String(corte).padStart(2, "0")}:00`, true)}{th2("delta", "Δ vs global", true)}
                  </tr></thead>
                  <tbody>
                    {vis.map((f) => (
                      <tr key={f.region + "|" + f.zona + "|" + f.norm} onClick={() => toggleDrill("localidad", f.localidad, "loc")} style={{ cursor: "pointer" }}>
                        <td style={{ ...tdL, fontWeight: 600 }}>{f.localidad}</td>
                        <td style={{ ...tdL, fontSize: 11.5, color: C.muted }}>{f.zona}</td>
                        <td style={{ ...tdL, fontSize: 11.5, color: C.muted }}>{f.region}</td>
                        <td style={td}>{fmtInt(f.ml)}</td>
                        <td style={{ ...td, color: slaColor(f.sla), fontWeight: 700 }}>{f.sla != null ? fmt1(f.sla) + "%" : "—"}</td>
                        <td style={{ ...td, color: horColor(f.hor), fontWeight: 700 }}>
                          {f.hor != null ? fmt1(f.hor) + "%" : "—"}
                          {f.hor != null && (
                            <span style={{ display: "inline-block", width: 74, height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden", verticalAlign: "middle", marginLeft: 8 }}>
                              <span style={{ display: "block", height: "100%", width: `${f.hor}%`, background: horColor(f.hor) }} />
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: f.delta == null ? C.muted : f.delta >= 0 ? C.goodText : C.critText }}>{f.delta == null ? "" : (f.delta >= 0 ? "+" : "−") + fmt1(Math.abs(f.delta)) + " pp"}</td>
                      </tr>
                    ))}
                    {!vis.length && <tr><td colSpan={7} style={{ ...tdL, color: C.muted, fontSize: 12 }}>Ninguna localidad con ese filtro.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </div>
      </>
      )}
      </>
      )}

      <details style={{ fontSize: 11.5, color: C.muted }}>
        <summary style={{ cursor: "pointer", color: C.teal }}>Metodología y umbrales</summary>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          <p>SLA Meli = (envíos ML − demorados − repro 21) / envíos ML — misma fórmula que la tabla por cadete. Umbrales: ✅ ≥98% · ⚠️ 95–98% · 🔴 &lt;95%.</p>
          <p>Sugerencias (umbrales calibrables): SLA crítico &lt;{CFG.slaCritico}% con ≥{CFG.minML} ML · "termina tarde" = ≥{CFG.tarde_post21 * 100}% post 21 o fin ≥ {fmtHora(CFG.tarde_fin)} (con ≥{CFG.minEntregados} entregas) · "repro 21 recurrente" = ≥{CFG.repro21_min} en ≥{CFG.repro21_frec * 100}% de los días · "cerca del tope" = ≥{CFG.sobrecarga} env/día (tope {CFG.tope}) · caída/mejora = ±{CFG.deltaSla} pp.</p>
          <p>Semanas con * son parciales (&lt;5 días); en parciales no se compara volumen, solo tasas.</p>
          <p>SLA por localidad: tabla semanas_zonas (localidad del Excel de LightData, se captura desde el 24/07 sin histórico hacia atrás). "Zona op." = zona operativa derivada con el mapeo tolerante de la pestaña Zonas (contra zonas_cp); sin cruce único queda "—". Localidades con &lt;{CFG.zonaMin} envíos van agrupadas como "muestra chica" (desplegable) y no se marcan críticas. Rojo = ≥{CFG.zonaMin} envíos y Δ ≤ −1 pp.</p>
          <p>Regiones (tarjetas del resumen): mismas sumas que la jerarquía Región → Zona → Localidad de abajo; la flecha compara contra el período anterior (↑/↓ = ±{CFG.regionFlecha} pp · ↓↓ = caída ≥{CFG.regionFlecha2} pp; sin flecha = sin datos comparables). La carga vs tope real de cada cadete se ve en su drill-down y en el chip "sobre tope" del ranking.</p>
          <p>KPIs: "Pendientes" = sin entregar del período (% sobre el total); "Post-21 (flota)" = entregas después de las 21 sobre entregados (puntito rojo si ≥{CFG.tarde_post21 * 100}%). Seguimiento: el botón "✔ Hecho" de una alerta guarda la fecha y el SLA del momento en <code>decisiones_seguimiento</code>; cuando la alerta reaparece, muestra "hecho el DD/MM · SLA antes → ahora" para ver si la acción funcionó.</p>
          <p>Decisiones de la semana: score = severidad (crítico 3 · caída 2 · al límite/tarde/repro21 1) × peso por volumen (ML del cadete/localidad ÷ mediana de ML) × recurrencia (días afectados ÷ días del período). "Requieren atención: N" = alertas mostradas (máx {CFG.alertasMax}). Los verbos ("hablar hoy" vs "revisar") dependen de si el período es la semana en curso.</p>
        </div>
      </details>

      {/* Detalle del cadete/localidad — panel lateral (desktop) / pantalla completa (mobile) */}
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: isMobile ? "center" : "flex-end" }}>
          <div className="flexit-scroll" onClick={(e) => e.stopPropagation()} style={{ background: C.bg, width: isMobile ? "100%" : 470, maxWidth: "100%", height: "100%", overflowY: "auto", padding: 14, boxShadow: "-8px 0 24px rgba(0,0,0,0.35)" }}>
            {drill.kind === "cadete" && rankingF.some((c) => c.name === drill.name) && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={() => navDrill(-1)} style={{ flex: 1, padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardAlt, color: C.muted, cursor: "pointer" }}>‹ anterior</button>
                <button onClick={() => navDrill(1)} style={{ flex: 1, padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardAlt, color: C.muted, cursor: "pointer" }}>siguiente ›</button>
              </div>
            )}
            {renderDrill(drill)}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDMY(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
