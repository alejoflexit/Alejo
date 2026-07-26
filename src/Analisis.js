import React, { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ReferenceLine, Cell,
} from "recharts";

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
const MES_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Rango compacto de un set de fechas ISO: "20–24 jul" (mismo mes) o "23 jun–19 jul".
function rangoFechas(fechas) {
  if (!fechas || !fechas.length) return "";
  const s = fechas.slice().sort();
  const [, am, ad] = s[0].split("-"); const [, bm, bd] = s[s.length - 1].split("-");
  return am === bm ? `${+ad}–${+bd} ${MES[+am - 1]}` : `${+ad} ${MES[+am - 1]}–${+bd} ${MES[+bm - 1]}`;
}

// Una única fórmula de SLA Meli para toda la pestaña: (ML − demorados − repro 21) / ML.
function slaMeli(ml, dem, dem21) {
  return ml > 0 ? (ml - dem - (dem21 || 0)) / ml * 100 : null;
}
function slaColor(s) { return s == null ? C.muted : s < CFG.slaCritico ? C.crit : s < CFG.slaOk ? C.warn : C.good; }
function slaIcon(s) { return s == null ? "—" : s < CFG.slaCritico ? "🔴" : s < CFG.slaOk ? "⚠️" : "✅"; }

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Agrega `semanas` (por cadete×día) para un conjunto de labels de semana.
function aggWeeks(semanas, labelSet, topeMap) {
  const porCad = {};
  const g = { cant: 0, pend: 0, dem: 0, d21: 0, p21: 0, ml: 0, sin: 0, basura: 0, oper: { sinAsignar: 0, devuelto: 0, quedo: 0, repro: 0, otros: 0 } };
  for (const s of semanas) {
    if (!labelSet.has(s.label)) continue;
    for (const dia of s.dias) {
      for (const m of dia.datos) {
        const name = norm(m.cadete);
        g.cant += m.cantidad; g.pend += m.pendientes; g.dem += m.demorados;
        g.d21 += (m.dem21 || 0); g.p21 += (m.post21 || 0); g.ml += m.envios_ml;
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
function Tile({ label, value, delta, dot, sub, onClick, open }) {
  return (
    <div onClick={onClick} style={{ background: C.cardAlt, border: `1px solid ${onClick && open ? C.teal : C.border}`, borderRadius: 12, padding: "12px 14px", minWidth: 120, flex: "1 1 130px", cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block" }} />}
        {label}
        {onClick && <span style={{ marginLeft: "auto", color: C.teal, fontSize: 12 }}>{open ? "▾" : "▸"}</span>}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{sub}</div>}
      {delta}
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
function CadTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, color: C.ink }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.name}</div>
      <div style={{ color: C.muted }}>SLA <b style={{ color: C.ink }}>{p.sla != null ? fmt1(p.sla) + "%" : "—"}</b></div>
      <div style={{ color: C.muted }}>Envíos/día <b style={{ color: C.ink }}>{fmt1(p.prom)}</b> · {fmtInt(p.cant)} en {p.dias} días</div>
    </div>
  );
}

// Fila de alerta del bloque "Atención prioritaria". Clickeable → abre el drill-down (Tarea 2).
function AlertRow({ a, onClick, abierto }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 6px", borderTop: `1px solid ${C.faint}`, cursor: onClick ? "pointer" : "default", background: abierto ? "rgba(255,255,255,0.03)" : "transparent" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#F2953F", marginTop: 5, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
          {a.kind === "localidad" ? "📍 " : ""}{a.name} <span style={{ color: C.teal, fontWeight: 600 }}>· {a.accion}</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{a.motivo}</div>
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
  const [jerNodos, setJerNodos] = useState(() => new Set()); // acordeón: qué regiones/zonas están abiertas
  const [zonasErr, setZonasErr] = useState("");
  const [informes, setInformes] = useState(null); // null=cargando, []=sin informes

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
  const [verInforme, setVerInforme] = useState(false); // informe completo del analista colapsado
  const [verIncompletos, setVerIncompletos] = useState(false); // bloque "Datos aún incompletos" colapsado
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
  const jerToggle = (k) => setJerNodos((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
      const g = locMap[k] || (locMap[k] = { localidad_norm: k, labels: {}, zonaCp: {}, cantidad: 0, entregados: 0, demorados: 0, dem21: 0, post21: 0, envios_ml: 0, nadie: 0 });
      if (r.localidad) g.labels[r.localidad] = (g.labels[r.localidad] || 0) + r.cantidad;
      if (r.zona_cp) g.zonaCp[r.zona_cp] = (g.zonaCp[r.zona_cp] || 0) + r.cantidad;
      g.cantidad += r.cantidad; g.entregados += r.entregados; g.demorados += r.demorados; g.dem21 += r.dem21; g.post21 += r.post21; g.envios_ml += r.envios_ml; g.nadie += r.nadie;
    }
    const slaG = cur.g.sla;
    const acc = (o, z) => { o.cantidad += z.cantidad; o.entregados += z.entregados; o.demorados += z.demorados; o.dem21 += z.dem21; o.post21 += z.post21; o.envios_ml += z.envios_ml; o.nadie += z.nadie; };
    const nuevo = (nombre, extra) => ({ nombre, cantidad: 0, entregados: 0, demorados: 0, dem21: 0, post21: 0, envios_ml: 0, nadie: 0, ...extra });
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
    return { vacio: false, regiones: regionesArr, totalML, totalCant, locsSinZona, mlSinZona, nLoc, pctSinZona: totalML > 0 ? mlSinZona / totalML * 100 : 0 };
  }, [zonasRaw, weeks, periodLabels, regionMap, aliasMap, zonaNames, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // Informe del analista parseado (para el Titular + enriquecer las tarjetas con su acción en prosa).
  const informeStd = useMemo(() => {
    if (!informes || !informes.length) return null;
    const row = informes.find((x) => x.informe_md);
    const p = row ? parseInforme(row.informe_md) : null;
    if (!p) return null;
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
        let cant = 0, ml = 0, dm = 0, d2 = 0;
        for (const m of dia.datos) { cant += m.cantidad; ml += m.envios_ml; dm += m.demorados; d2 += (m.dem21 || 0); }
        return { name: fmtDDMM(dia.fecha), cant, sla: slaMeli(ml, dm, d2) };
      }) };
    }
    if (periodo.t === "ult4") {
      return { modo: "semana", datos: completas.slice(-4).map((l) => { const a = aggWeeks(semanas, new Set([l]), topeMap); return { name: fmtSemLabel(l), cant: a.g.cant, sla: a.g.sla }; }) };
    }
    const byMonth = {};
    semanas.forEach((s) => s.dias.forEach((dia) => {
      const mk = dia.fecha.slice(0, 7);
      const g = byMonth[mk] || (byMonth[mk] = { cant: 0, ml: 0, dm: 0, d2: 0 });
      for (const m of dia.datos) { g.cant += m.cantidad; g.ml += m.envios_ml; g.dm += m.demorados; g.d2 += (m.dem21 || 0); }
    }));
    return { modo: "mes", datos: Object.keys(byMonth).sort().map((mk) => { const g = byMonth[mk]; const [y, mo] = mk.split("-"); return { name: `${MES[+mo - 1]} ${y.slice(2)}`, cant: g.cant, sla: slaMeli(g.ml, g.dm, g.d2) }; }) };
  }, [periodo.t, periodW, completas, semanas, topeMap]);

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
  const tituloBloque = periodo.t === "sem" ? "Decisiones de esta semana" : periodo.t === "ult4" ? "Decisiones de las últimas 4 semanas" : "Patrones históricos";
  const tituloAtender = periodo.t === "todo" ? "Casos históricos a revisar" : (enCursoActual ? "Atender hoy" : "A atender");

  const th = (key, label, right) => (
    <th onClick={() => doSort(key)} style={{ padding: "7px 8px", textAlign: right ? "right" : "left", cursor: "pointer", color: sortCol === key ? C.teal : C.muted, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.cardAlt }}>
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
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", border: `1px solid ${C.faint}`, borderRadius: 8 }}>
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
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 15px" }}>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <Tile label="SLA Meli (solo ML)" value={cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"} dot={slaColor(cur.g.sla)} delta={dSla != null ? <DeltaSpan delta={dSla} unidad="pp" bueno="up" prevLbl={prevLbl} /> : null}
            open={verIncompletos}
            onClick={() => { setVerIncompletos(true); setJerNodos(new Set(["CABA", "Norte", "Oeste", "Sur"])); setTimeout(() => { const el = document.getElementById("jer-sla"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); }} />
          <Tile label="Envíos (ML + particulares)" value={fmtInt(cur.g.cant)} delta={dVol != null ? <DeltaSpan delta={dVol} unidad="" bueno="up" prevLbl={prevLbl} /> : (parcialActual ? <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>semana en curso</div> : null)} />
          <Tile label="Requieren atención" value={fmtInt(alertas.nCad)} delta={<div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>cadetes a atender{alertas.nLoc ? ` · ${alertas.nLoc} localidad${alertas.nLoc === 1 ? "" : "es"} a vigilar` : ""}</div>} />
        </div>

        {/* Atender hoy — tarjetas por cadete, la más urgente resaltada */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1 }}>🟠 {tituloAtender} <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· lo más urgente primero</span></div>
            <button onClick={copiar} title="Copiar resumen para WhatsApp" style={{ background: copiado ? "rgba(46,207,170,0.16)" : C.cardAlt, border: `1px solid ${copiado ? C.teal : C.border}`, borderRadius: 8, color: copiado ? C.teal : C.muted, fontSize: 12, fontWeight: 600, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
              {copiado ? "✓ Copiado" : "💬 Copiar resumen"}
            </button>
          </div>
          {alertas.cadetes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.muted, padding: "6px" }}>Nadie en rojo este período. 👏</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {alertas.cadetes.map((a, i) => {
                const enr = informeStd && informeStd.porCadete[a.name];
                const abierto = isOpen("cadete", a.name, "alert");
                const urgente = i === 0;
                return (
                  <div key={a.key} style={{ border: `1px solid ${urgente ? "rgba(229,96,77,0.55)" : C.border}`, background: urgente ? "rgba(229,96,77,0.07)" : C.cardAlt, borderRadius: 10, overflow: "hidden" }}>
                    <div onClick={() => toggleDrill("cadete", a.name, "alert")} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 11px", cursor: "pointer" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: urgente ? C.crit : "#F2953F", marginTop: 5, flex: "0 0 auto" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{a.name} <span style={{ color: C.teal, fontWeight: 600 }}>· {a.accion}</span>{urgente && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: C.critText, background: "rgba(229,96,77,0.16)", borderRadius: 5, padding: "1px 6px" }}>MÁS URGENTE</span>}</div>
                        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{a.motivo}</div>
                        {enr && enr.accion && <div style={{ fontSize: 12, color: C.goodText, marginTop: 4, lineHeight: 1.45 }}>💡 Analista: {enr.accion}</div>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", marginLeft: 8 }}>{a.dato}</div>
                      <span style={{ color: C.teal, fontSize: 12, marginLeft: 4, flex: "0 0 auto" }}>{abierto ? "▾" : "▸"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Capacidad para redistribuir — cadetes confiables con lugar */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4 }}>💪 Capacidad para redistribuir <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· alto volumen y buen SLA, adónde pasar carga</span></div>
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
            <div style={{ marginTop: 12, background: "rgba(226,75,74,0.06)", border: "1px solid rgba(226,75,74,0.22)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 6 }}>🧹 Alertas operativas / calidad de datos <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· no son cadetes, revisar carga en LightData</span></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {items.map(([lbl, n, sub]) => (
                  <div key={lbl} style={{ flex: "1 1 150px", minWidth: 0, background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#F2937F" }}>{lbl}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{fmtInt(n)} envíos · {sub}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* === 2 · Cadetes (Semáforo migrado) === */}
      <h2 style={{ fontSize: 16, margin: "6px 0 10px", borderTop: `1px solid ${C.faint}`, paddingTop: 16 }}>Cadetes <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· ranking, semáforo y filtros</span></h2>

      {/* Ranking completo */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Ranking completo <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>{isMobile ? "(tocá una tarjeta para el detalle)" : "(clic en una columna para ordenar · clic en una fila para el detalle)"}</span></h3>
      {/* chips de filtro rápido */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {[["criticos", "🔴 solo críticos"], ["riesgo", "🟡 en riesgo"], ["ok", "🟢 OK"], ["sobre", "📦 sobre tope"], ["tarde", "🌙 terminan tarde"], ["caida", "📉 en caída"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setChip((x) => (x === k ? null : k))}
            style={{ padding: "4px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", borderRadius: 999, border: `1px solid ${chip === k ? C.teal : C.border}`, background: chip === k ? "rgba(46,207,170,0.14)" : "transparent", color: chip === k ? C.teal : C.muted }}>
            {lbl}
          </button>
        ))}
        {chip && <span style={{ fontSize: 11.5, color: C.muted, alignSelf: "center" }}>{rankingF.length} de {ranking.length}</span>}
      </div>
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {rankingF.map((c, i) => (
            <div key={i} onClick={() => toggleDrill("cadete", c.name, "rank")} style={{ background: C.cardAlt, border: `1px solid ${isOpen("cadete", c.name, "rank") ? C.teal : C.border}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ color: slaColor(c.sla), fontWeight: 700, whiteSpace: "nowrap" }}>{c.sla != null ? slaIcon(c.sla) + " " + fmt1(c.sla) + "%" : "—"}</span>
                <span style={{ color: C.teal, flex: "0 0 auto" }}>{isOpen("cadete", c.name, "rank") ? "▾" : "▸"}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{fmtInt(c.cant)} envíos · {fmt1(c.prom)}/día vs tope {c.tope || CFG.tope} · {fmt0(c.p21rate * 100)}% post 21</div>
            </div>
          ))}
          {rankingF.length === 0 && <div style={{ color: C.muted, fontSize: 12.5, padding: "12px 4px" }}>Nadie cumple ese filtro. 👏</div>}
        </div>
      ) : (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, marginBottom: 14, overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {th("name", "Cadete")}{th("cant", "Envíos", 1)}{th("pctVol", "% vol.", 1)}{th("prom", "Prom/día", 1)}
              {th("sla", "SLA", 1)}{th("delta", "Δ SLA", 1)}{th("dem", "Dem.", 1)}{th("d21", "Repro21", 1)}
              {th("p21rate", "Post21", 1)}{th("pctSobreTope", "% >tope", 1)}{th("fin", "Fin prom.", 1)}
            </tr>
          </thead>
          <tbody>
            {rankingF.map((c, i) => (
              <tr key={i} onClick={() => toggleDrill("cadete", c.name, "rank")} style={{ borderBottom: `1px solid ${C.faint}`, cursor: "pointer", background: isOpen("cadete", c.name, "rank") ? "rgba(46,207,170,0.08)" : "transparent" }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(c.cant)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: C.muted }}>{fmt1(c.pctVol)}%</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt1(c.prom)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: slaColor(c.sla), fontWeight: 600 }}>{c.sla != null ? slaIcon(c.sla) + " " + fmt1(c.sla) + "%" : "—"}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: c.delta == null ? C.muted : c.delta >= 0 ? C.goodText : C.critText }}>{c.delta == null ? "—" : (c.delta >= 0 ? "+" : "−") + fmt1(Math.abs(c.delta))}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(c.dem)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(c.d21)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt0(c.p21rate * 100)}%</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: c.pctSobreTope >= 0.3 ? C.critText : C.muted }}>{fmt0(c.pctSobreTope * 100)}%</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: c.fin != null && c.fin >= CFG.tarde_fin ? C.critText : C.ink }}>{fmtHora(c.fin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* 3. Carga por cadete — scatter */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Carga vs. SLA <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(cada punto es un cadete)</span></h3>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>Derecha = muchos paquetes por día. Abajo = SLA flojo. Abajo-derecha necesita que le saques carga; arriba-derecha es tu caballito de batalla. La línea vertical es un tope de referencia ({CFG.tope}/día); el tope real de cada cadete (de <code>cadete_topes</code>) se ve al tocarlo en el ranking.</div>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 16, left: -6, bottom: 16 }}>
            <CartesianGrid stroke={C.faint} />
            <XAxis type="number" dataKey="prom" name="Envíos/día" tick={{ fontSize: 9, fill: C.muted }} label={{ value: "envíos por día trabajado", position: "insideBottom", offset: -8, fontSize: 10, fill: C.muted }} />
            <YAxis type="number" dataKey="sla" name="SLA" domain={[80, 100]} ticks={[80, 85, 90, 95, 100]} allowDataOverflow tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v + "%"} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: C.border }} content={<CadTip />} />
            <ReferenceLine y={98} stroke={C.good} strokeDasharray="3 3" />
            <ReferenceLine y={95} stroke={C.warn} strokeDasharray="3 3" />
            <ReferenceLine x={CFG.tope} stroke={C.muted} strokeDasharray="4 4" label={{ value: "tope ref.", position: "top", fontSize: 9, fill: C.muted }} />
            <Scatter data={cur.cads.filter((c) => c.cant >= 20 && c.sla != null && c.dias > 0)}>
              {cur.cads.filter((c) => c.cant >= 20 && c.sla != null && c.dias > 0).map((p, i) => (
                <Cell key={i} fill={p.sla < CFG.slaCritico ? C.crit : p.sla < CFG.slaOk ? C.warn : C.good} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: C.muted, marginTop: 4 }}>
          <span>✅ OK (≥98%)</span><span>⚠️ En riesgo (95–98%)</span><span>🔴 Crítico (&lt;95%)</span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
        Calidad de datos del período: {fmtInt(cur.g.sin)} envíos sin cadete asignado{cur.g.basura > 0 ? ` · ${fmtInt(cur.g.basura)} bajo nombres basura ("Repro gramar", "devuelto depósito") que conviene limpiar en LightData` : ""}. Los sin-asignar y basura cuentan en los KPIs pero quedan fuera del ranking de cadetes (ver "Alertas operativas" arriba).
      </div>

      {/* === 3 · Tendencia (Mensual migrado) — evolución adaptativa por período === */}
      <h2 style={{ fontSize: 16, margin: "6px 0 10px", borderTop: `1px solid ${C.faint}`, paddingTop: 16 }}>Tendencia <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· evolución {tendData.modo === "día" ? "diaria" : tendData.modo === "semana" ? "semanal" : "mensual"} de SLA y volumen</span></h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 22 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Volumen por {tendData.modo}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>Envíos totales (ML + particulares).</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={tendData.datos} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.faint} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v >= 1000 ? (v / 1000) + "k" : v} />
              <Tooltip contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmtInt(v), "Envíos"]} labelStyle={{ color: C.muted }} />
              <Bar dataKey="cant" radius={[3, 3, 0, 0]} fill={C.teal} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>SLA Meli por {tendData.modo}</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>Escala fija 90–100; líneas de referencia en 95 y 98.</div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={tendData.datos.filter((d) => d.sla != null)} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.faint} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
              <YAxis domain={[90, 100]} ticks={[90, 95, 98, 100]} allowDataOverflow tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v + "%"} />
              <Tooltip contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt1(v) + "%", "SLA"]} labelStyle={{ color: C.muted }} />
              <ReferenceLine y={98} stroke={C.good} strokeDasharray="3 3" />
              <ReferenceLine y={95} stroke={C.warn} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="sla" stroke={C.teal} strokeWidth={2} dot={{ r: 3, fill: C.teal }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* === 4 · Patrones (reincidentes — reemplaza las tarjetas masivas de Mensual) === */}
      <h2 style={{ fontSize: 16, margin: "6px 0 10px", borderTop: `1px solid ${C.faint}`, paddingTop: 16 }}>Patrones <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· reincidentes de demora en {periodDesc.toLowerCase()}</span></h2>
      {patrones.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, color: C.muted, fontSize: 12.5, marginBottom: 22 }}>Sin cadetes con demoras en el período. 👏</div>
      ) : (
        <>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, marginBottom: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>
                {[["name", "Cadete", 0], ["diasDem", "Días con demora", 1], ["demoras", "Demoras", 1], ["ultInc", "Última incidencia", 1], ["sla4", "Últimas 4 sem.", 1], ["tend", "Tendencia", 1]].map(([k, l, r]) => (
                  <th key={k} onClick={() => setPatSort(k)} style={{ padding: "7px 8px", textAlign: r ? "right" : "left", cursor: "pointer", color: patSort === k ? C.teal : C.muted, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{l}{patSort === k ? " \u25BC" : ""}</th>
                ))}
              </tr></thead>
              <tbody>
                {(verTodosPat ? patrones : patrones.slice(0, 10)).map((r, i) => (
                  <tr key={i} onClick={() => toggleDrill("cadete", r.name, "rank")} style={{ borderBottom: `1px solid ${C.faint}`, cursor: "pointer" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: r.diasDem >= 3 ? C.critText : C.ink }}>{r.diasDem}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(r.demoras)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: C.muted }}>{r.ultInc ? fmtDDMM(r.ultInc) : "\u2014"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: slaColor(r.sla4), fontWeight: 600 }}>{r.sla4 != null ? fmt1(r.sla4) + "%" : "\u2014"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: r.tend > 0 ? C.goodText : r.tend < 0 ? C.critText : C.muted }}>{r.tend > 0 ? "\u2191 mejora" : r.tend < 0 ? "\u2193 empeora" : "\u2192"}</td>
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
      <h2 style={{ fontSize: 16, margin: "6px 0 6px", borderTop: `1px solid ${C.faint}`, paddingTop: 16 }}>Localidades <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· SLA por localidad y zona operativa</span></h2>
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
      {alertas.locs.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>📍 Localidades a vigilar</div>
          {alertas.locs.map((a) => <AlertRow key={a.key} a={a} onClick={() => toggleDrill(a.kind, a.name, "locv")} abierto={isOpen(a.kind, a.name, "locv")} />)}
        </div>
      )}
      <h3 id="jer-sla" style={{ fontSize: 14, margin: "0 0 8px" }}>SLA por región → zona → localidad <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(oportunidades geográficas)</span></h3>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 22 }}>
        {jerarquia == null ? (
          <div style={{ color: C.muted, fontSize: 12 }}>Cargando…</div>
        ) : jerarquia.vacio ? (
          <div style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6 }}>
            {jerarquia.desde
              ? `Todavía no hay datos por localidad para este período. La captura arrancó el ${fmtDMY(jerarquia.desde)} — elegí un período desde esa fecha.`
              : "Los datos por localidad se empiezan a capturar desde hoy (la Action nocturna guarda la primera foto esta noche). No hay histórico hacia atrás."}
            {zonasErr ? <div style={{ marginTop: 6, color: C.critText, fontSize: 11 }}>({zonasErr})</div> : null}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span>Tocá una región para ver sus zonas, y una zona para sus localidades. Suma de envíos ML; el SLA se recalcula sobre las sumas (misma fórmula, nunca promedia %). Δ vs SLA global ({cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"}). Peor primero; muestra chica (&lt;{CFG.zonaMin}) agrupada.</span>
              <span style={{ color: jerarquia.pctSinZona >= 10 ? C.critText : C.muted, fontWeight: 600, whiteSpace: "nowrap" }}>Localidades sin zona op.: {fmtInt(jerarquia.locsSinZona)} · {fmt1(jerarquia.pctSinZona)}% del volumen</span>
            </div>
            {(() => {
              const rows = [];
              const cel = (o, nivel, muted) => (
                <>
                  <span style={{ flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: nivel === 0 ? 700 : nivel === 1 ? 600 : 400, fontSize: nivel === 0 ? 13 : 12.5, color: muted ? C.muted : C.ink }}>
                    {nivel === 2 ? slaIcon(o.sla) + " " : ""}{o.nombre || o.localidad}
                  </span>
                  <span style={{ flex: "0 0 auto", fontSize: 11, color: C.muted, minWidth: 46, textAlign: "right" }}>{fmtInt(o.envios_ml)}</span>
                  <span style={{ flex: "0 0 auto", fontSize: 12.5, fontWeight: 600, color: slaColor(o.sla), minWidth: 50, textAlign: "right" }}>{o.sla != null ? fmt1(o.sla) + "%" : "—"}</span>
                  <span style={{ flex: "0 0 auto", fontSize: 11, minWidth: 42, textAlign: "right", color: o.delta == null ? C.muted : o.delta >= 0 ? C.goodText : C.critText }}>{o.delta == null ? "" : (o.delta >= 0 ? "+" : "−") + fmt1(Math.abs(o.delta))}</span>
                </>
              );
              const fila = (key, nivel, contenido, opts = {}) => rows.push(
                <div key={key} onClick={opts.onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 6px", paddingLeft: 6 + nivel * 16, borderBottom: `1px solid ${C.faint}`, cursor: opts.onClick ? "pointer" : "default", background: opts.hi ? "rgba(46,207,170,0.07)" : "transparent" }}>
                  <span style={{ width: 12, flex: "0 0 auto", color: C.teal, fontSize: 12 }}>{opts.chev === undefined ? "" : opts.chev ? "▾" : "▸"}</span>
                  {contenido}
                </div>
              );
              const resumen = (key, nivel, texto) => rows.push(
                <div key={key} style={{ padding: "6px 6px", paddingLeft: 6 + nivel * 16 + 20, fontSize: 11.5, fontStyle: "italic", color: C.muted, borderBottom: `1px solid ${C.faint}` }}>{texto}</div>
              );
              for (const reg of jerarquia.regiones) {
                const rAbierto = jerNodos.has(reg.nombre);
                fila(reg.nombre, 0, cel(reg, 0, false), { chev: rAbierto, hi: rAbierto, onClick: () => jerToggle(reg.nombre) });
                if (!rAbierto) continue;
                const zBig = reg.zonasArr.filter((z) => z.envios_ml >= CFG.zonaMin);
                const zChicas = reg.zonasArr.filter((z) => z.envios_ml < CFG.zonaMin);
                if (!reg.zonasArr.length) resumen(reg.nombre + "-vacio", 1, "sin localidades en el período");
                for (const zn of zBig) {
                  const zKey = reg.nombre + "||" + zn.nombre;
                  const zAbierto = jerNodos.has(zKey);
                  fila(zKey, 1, cel(zn, 1, false), { chev: zAbierto, hi: zAbierto, onClick: () => jerToggle(zKey) });
                  if (!zAbierto) continue;
                  const lBig = zn.localidades.filter((l) => l.cantidad >= CFG.zonaMin);
                  const lChicas = zn.localidades.filter((l) => l.cantidad < CFG.zonaMin);
                  for (const l of lBig) fila(zKey + "||" + l.localidad_norm, 2, cel(l, 2, false), { onClick: () => toggleDrill("localidad", l.localidad, "loc") });
                  if (lChicas.length) resumen(zKey + "-chicas", 2, `+ ${lChicas.length} localidad${lChicas.length === 1 ? "" : "es"} muestra chica · ${fmtInt(lChicas.reduce((a, l) => a + l.envios_ml, 0))} ML`);
                }
                if (zChicas.length) resumen(reg.nombre + "-zchicas", 1, `+ ${zChicas.length} zona${zChicas.length === 1 ? "" : "s"} muestra chica · ${fmtInt(zChicas.reduce((a, z) => a + z.envios_ml, 0))} ML`);
              }
              return <div>{rows}</div>;
            })()}
          </>
        )}
      </div>
      </>
      )}

      <details style={{ fontSize: 11.5, color: C.muted }}>
        <summary style={{ cursor: "pointer", color: C.teal }}>Metodología y umbrales</summary>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          <p>SLA Meli = (envíos ML − demorados − repro 21) / envíos ML — misma fórmula que la tabla por cadete. Umbrales: ✅ ≥98% · ⚠️ 95–98% · 🔴 &lt;95%.</p>
          <p>Sugerencias (umbrales calibrables): SLA crítico &lt;{CFG.slaCritico}% con ≥{CFG.minML} ML · "termina tarde" = ≥{CFG.tarde_post21 * 100}% post 21 o fin ≥ {fmtHora(CFG.tarde_fin)} (con ≥{CFG.minEntregados} entregas) · "repro 21 recurrente" = ≥{CFG.repro21_min} en ≥{CFG.repro21_frec * 100}% de los días · "cerca del tope" = ≥{CFG.sobrecarga} env/día (tope {CFG.tope}) · caída/mejora = ±{CFG.deltaSla} pp.</p>
          <p>Semanas con * son parciales (&lt;5 días); en parciales no se compara volumen, solo tasas.</p>
          <p>SLA por localidad: tabla semanas_zonas (localidad del Excel de LightData, se captura desde el 24/07 sin histórico hacia atrás). "Zona op." = zona operativa derivada con el mapeo tolerante de la pestaña Zonas (contra zonas_cp); sin cruce único queda "—". Localidades con &lt;{CFG.zonaMin} envíos van agrupadas como "muestra chica" (desplegable) y no se marcan críticas. Rojo = ≥{CFG.zonaMin} envíos y Δ ≤ −1 pp.</p>
          <p>Decisiones de la semana: score = severidad (crítico 3 · caída 2 · al límite/tarde/repro21 1) × peso por volumen (ML del cadete/localidad ÷ mediana de ML) × recurrencia (días afectados ÷ días del período). "Requieren atención: N" = alertas mostradas (máx {CFG.alertasMax}). Los verbos ("hablar hoy" vs "revisar") dependen de si el período es la semana en curso.</p>
        </div>
      </details>

      {/* Detalle del cadete/localidad — panel lateral (desktop) / pantalla completa (mobile) */}
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: isMobile ? "center" : "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg, width: isMobile ? "100%" : 470, maxWidth: "100%", height: "100%", overflowY: "auto", padding: 14, boxShadow: "-8px 0 24px rgba(0,0,0,0.35)" }}>
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
