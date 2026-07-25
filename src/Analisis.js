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
const esBasura = (n) => /^repro gramar/i.test(n) || /^devuelto deposito/i.test(n);
const esSin = (n) => n.startsWith("⚠️");
const fmtInt = (n) => (n == null ? "—" : Number(n).toLocaleString("es-AR"));
const fmt1 = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const fmtHora = (m) => (m == null ? "—" : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0"));
const hhmmToMin = (s) => { if (!s) return null; const p = String(s).split(":"); if (p.length < 2) return null; const h = +p[0], mi = +p[1]; return (isNaN(h) || isNaN(mi)) ? null : h * 60 + mi; };
const fmtSemLabel = (label) => (label ? String(label).split("-")[0] : "");
const mediana = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

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
  const g = { cant: 0, pend: 0, dem: 0, d21: 0, p21: 0, ml: 0, sin: 0, basura: 0 };
  for (const s of semanas) {
    if (!labelSet.has(s.label)) continue;
    for (const dia of s.dias) {
      for (const m of dia.datos) {
        const name = norm(m.cadete);
        g.cant += m.cantidad; g.pend += m.pendientes; g.dem += m.demorados;
        g.d21 += (m.dem21 || 0); g.p21 += (m.post21 || 0); g.ml += m.envios_ml;
        if (esSin(name)) { g.sin += m.cantidad; continue; }
        if (esBasura(name)) { g.basura += m.cantidad; continue; }
        const c = porCad[name] || (porCad[name] = { name, cant: 0, pend: 0, dem: 0, d21: 0, p21: 0, ml: 0, dias: 0, dd21: 0, finSum: 0, finDias: 0, diasSobreTope: 0, diasDem: 0, diasP21: 0, diasCargaAlta: 0, tope: topeMap[name] || CFG.tope });
        c.cant += m.cantidad; c.pend += m.pendientes; c.dem += m.demorados;
        c.d21 += (m.dem21 || 0); c.p21 += (m.post21 || 0); c.ml += m.envios_ml;
        c.dias += 1;
        if ((m.dem21 || 0) > 0) c.dd21 += 1;
        if ((m.demorados || 0) > 0 || (m.dem21 || 0) > 0) c.diasDem += 1;
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

// ---- subcomponentes chicos ----
function Tile({ label, value, delta, dot }) {
  return (
    <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", minWidth: 120, flex: "1 1 130px" }}>
      <div style={{ fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "inline-block" }} />}
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.ink, marginTop: 4 }}>{value}</div>
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
function Card({ icon, titulo, items, render, vacio }) {
  const [expanded, setExpanded] = useState(false);
  const list = expanded ? items : items.slice(0, 5);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", opacity: items.length ? 1 : 0.6 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: items.length ? 8 : 0 }}>
        {icon} {titulo} {items.length ? <span style={{ color: C.muted, fontWeight: 400 }}>· {items.length}</span> : null}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted }}>{vacio}</div>
      ) : (
        <>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: C.ink, lineHeight: 1.55 }}>
            {list.map((it, i) => <li key={i}>{render(it)}</li>)}
          </ul>
          {items.length > 5 && !expanded && (
            <div onClick={() => setExpanded(true)} style={{ marginTop: 6, fontSize: 12, color: C.teal, cursor: "pointer" }}>
              +{items.length - 5} más — tocá para ver
            </div>
          )}
        </>
      )}
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

// Bloque "🧠 Informes" — arriba de la pestaña. Lee analista_informes (lo escribe el agente del VPS).
function Informes({ informes }) {
  const [openKey, setOpenKey] = useState(null);
  if (informes == null) return null;                         // cargando: no reservar espacio
  const con = informes.filter((r) => r.informe_md);          // solo los que tienen informe (novedad)
  if (!con.length) return null;                              // sin informes todavía: no mostrar nada
  const ultimo = con[0], resto = con.slice(1);
  const kOf = (r) => r.id || r.fecha + r.tipo;
  const fFecha = (f) => { const p = String(f).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : f; };
  const chip = (t) => (
    <span style={{ background: "rgba(46,207,170,0.14)", color: C.teal, borderRadius: 6, padding: "2px 8px", fontWeight: 600, fontSize: 11 }}>
      {t === "semanal" ? "Semanal" : "Diario"}
    </span>
  );
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>🧠 Informes del analista <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(qué haría, con los números que lo respaldan)</span></h3>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          {chip(ultimo.tipo)}<span style={{ fontSize: 11.5, color: C.muted }}>{fFecha(ultimo.fecha)} · último</span>
        </div>
        <Markdown md={ultimo.informe_md} />
      </div>
      {resto.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {resto.map((r) => {
            const abierto = openKey === kOf(r);
            return (
              <div key={kOf(r)} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 6 }}>
                <div onClick={() => setOpenKey(abierto ? null : kOf(r))} style={{ cursor: "pointer", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <span style={{ color: C.teal }}>{abierto ? "▾" : "▸"}</span>
                  <span style={{ color: C.muted, whiteSpace: "nowrap" }}>{r.tipo === "semanal" ? "Semanal" : "Diario"} · {fFecha(r.fecha)}</span>
                  <span style={{ color: C.ink, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.resumen_tg || "").split("\n")[0]}</span>
                </div>
                {abierto && <div style={{ padding: "0 12px 12px" }}><Markdown md={r.informe_md} /></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =================================================================
export default function Analisis({ semanas }) {
  const [zonasRaw, setZonasRaw] = useState(null); // null=cargando, []=vacío
  const [topeMap, setTopeMap] = useState({});
  const [zonasErr, setZonasErr] = useState("");
  const [informes, setInformes] = useState(null); // null=cargando, []=sin informes

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const z = await sbGet("semanas_zonas?select=fecha,label,localidad,localidad_norm,cantidad,entregados,pendientes,demorados,dem21,post21,envios_ml,nadie,sameday&order=fecha.asc&limit=100000");
        if (alive) setZonasRaw(Array.isArray(z) ? z : []);
      } catch (e) { if (alive) { setZonasRaw([]); setZonasErr(String(e.message || e)); } }
      try {
        const t = await sbGet("cadete_topes?select=cadete,tope&limit=1000");
        if (alive && Array.isArray(t)) { const m = {}; t.forEach((r) => { m[norm(r.cadete)] = r.tope; }); setTopeMap(m); }
      } catch (e) { /* topes best-effort */ }
      try {
        const inf = await sbGet("analista_informes?select=id,fecha,tipo,resumen_tg,informe_md,hay_novedad,created_at&order=created_at.desc&limit=30");
        if (alive) setInformes(Array.isArray(inf) ? inf : []);
      } catch (e) { if (alive) setInformes([]); }
    })();
    return () => { alive = false; };
  }, []);

  // Semanas ordenadas por fecha real (el array `semanas` ya viene ordenado asc desde App).
  const weeks = useMemo(() => semanas.map((s) => ({
    label: s.label,
    fechas: s.dias.map((d) => d.fecha),
    parcial: s.dias.length < 5,
  })), [semanas]);
  const labels = weeks.map((w) => w.label);
  const completas = weeks.filter((w) => !w.parcial).map((w) => w.label);

  const [periodo, setPeriodo] = useState({ t: "sem", w: null });
  const [verCompleto, setVerCompleto] = useState(false); // 7 tarjetas de Sugerencias colapsadas
  // default: última semana completa (o la última que haya)
  const periodW = periodo.w || completas[completas.length - 1] || labels[labels.length - 1] || null;

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

  const parcialActual = periodo.t === "sem" && weeks.find((w) => w.label === periodW)?.parcial;
  const prevLbl = periodo.t === "sem" ? (prevLabels ? "sem. " + fmtSemLabel(prevLabels[0]) : "") : "4 sem. anteriores";

  const cur = useMemo(() => aggWeeks(semanas, new Set(periodLabels), topeMap), [semanas, periodLabels, topeMap]);
  const prev = useMemo(() => (prevLabels ? aggWeeks(semanas, new Set(prevLabels), topeMap) : null), [semanas, prevLabels, topeMap]);

  // Agregado semanal para los gráficos (todas las semanas).
  const weekAgg = useMemo(() => weeks.map((w) => {
    const a = aggWeeks(semanas, new Set([w.label]), topeMap);
    return { label: w.label, name: fmtSemLabel(w.label) + (w.parcial ? "*" : ""), cant: a.g.cant, ml: a.g.ml, sla: a.g.sla, dem: a.g.dem, d21: a.g.d21, sel: periodLabels.includes(w.label) };
  }), [weeks, semanas, topeMap, periodLabels]);

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
        localidad: label, cantidad: z.cantidad, envios_ml: z.envios_ml, sla,
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

    const todos = [...Object.values(porCad), ...locs].sort((a, b) => b.score - a.score);
    const top = todos.slice(0, CFG.alertasMax);
    return { top, nCad: top.filter((a) => a.kind === "cadete").length, nLoc: top.filter((a) => a.kind === "localidad").length, total: todos.length };
  }, [cur, sug, zonaData, periodo.t, parcialActual, prevLbl, diasPeriodo]);

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

  if (!semanas || semanas.length === 0) {
    return <div style={{ padding: 24, color: C.muted }}>No hay datos cargados todavía.</div>;
  }

  // KPIs deltas
  const dVol = (prev && !parcialActual) ? cur.g.cant - prev.g.cant : null;
  const dSla = (prev && cur.g.sla != null && prev.g.sla != null) ? cur.g.sla - prev.g.sla : null;
  const dP21 = prev ? (cur.g.p21rate - prev.g.p21rate) * 100 : null;
  const dPend = prev ? (cur.g.pendRate - prev.g.pendRate) * 100 : null;

  const periodDesc = periodo.t === "sem" ? "Semana del " + fmtSemLabel(periodW) + (parcialActual ? " (parcial)" : "")
    : periodo.t === "ult4" ? "Últimas 4 semanas completas"
      : "Todo el histórico";

  const segBtn = (t, txt) => (
    <button onClick={() => setPeriodo((p) => ({ t, w: t === "sem" ? (p.w || periodW) : p.w }))}
      style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 8, border: `1px solid ${periodo.t === t ? C.teal : C.border}`, background: periodo.t === t ? "rgba(46,207,170,0.14)" : "transparent", color: periodo.t === t ? C.teal : C.muted }}>
      {txt}
    </button>
  );
  const th = (key, label, right) => (
    <th onClick={() => doSort(key)} style={{ padding: "7px 8px", textAlign: right ? "right" : "left", cursor: "pointer", color: sortCol === key ? C.teal : C.muted, fontWeight: 600, fontSize: 11.5, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.cardAlt }}>
      {label}{sortCol === key ? (sortDir < 0 ? " ▼" : " ▲") : ""}
    </th>
  );

  return (
    <div style={{ color: C.ink }}>
      {/* Informes del analista (agente del VPS) — arriba de todo */}
      <Informes informes={informes} />

      {/* Selector de período */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
        {segBtn("sem", "Semana")}{segBtn("ult4", "Últimas 4")}{segBtn("todo", "Todo")}
        {periodo.t === "sem" && (
          <select value={periodW || ""} onChange={(e) => setPeriodo({ t: "sem", w: e.target.value })}
            style={{ padding: "6px 10px", borderRadius: 8, background: C.cardAlt, color: C.ink, border: `1px solid ${C.border}`, fontSize: 12 }}>
            {labels.slice().reverse().map((l) => {
              const w = weeks.find((x) => x.label === l);
              return <option key={l} value={l}>{"Semana del " + fmtSemLabel(l) + (w?.parcial ? " (parcial)" : "")}</option>;
            })}
          </select>
        )}
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {periodDesc} · {prevLabels ? "comparado contra " + (periodo.t === "sem" ? "la semana del " + fmtSemLabel(prevLabels[0]) : "las 4 semanas anteriores") : "sin período de comparación"}
      </div>

      {/* === Decisiones de la semana (v2) === */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>Decisiones de la semana <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· {periodDesc.toLowerCase()}</span></h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <Tile label="SLA Meli (solo ML)" value={cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"} dot={slaColor(cur.g.sla)} delta={dSla != null ? <DeltaSpan delta={dSla} unidad="pp" bueno="up" prevLbl={prevLbl} /> : null} />
          <Tile label="Envíos (ML + particulares)" value={fmtInt(cur.g.cant)} delta={dVol != null ? <DeltaSpan delta={dVol} unidad="" bueno="up" prevLbl={prevLbl} /> : (parcialActual ? <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>semana en curso</div> : null)} />
          <Tile label="Requieren atención" value={fmtInt(alertas.top.length)} delta={<div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{alertas.nCad} cadete{alertas.nCad === 1 ? "" : "s"} · {alertas.nLoc} localidad{alertas.nLoc === 1 ? "" : "es"}</div>} />
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 2 }}>🟠 Atención prioritaria <span style={{ color: C.muted, fontWeight: 400, fontSize: 11.5 }}>· lo más importante primero</span></div>
          {alertas.top.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.muted, padding: "8px 6px" }}>Nada urgente en este período. 👏 Mirá "Ver análisis completo" para el detalle.</div>
          ) : (
            alertas.top.map((a) => <AlertRow key={a.key} a={a} />)
          )}
        </div>
      </div>

      {/* 1. Resumen ejecutivo */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
        <Tile label="Total envíos" value={fmtInt(cur.g.cant)} delta={dVol != null ? <DeltaSpan delta={dVol} unidad="" bueno="up" prevLbl={prevLbl} /> : (parcialActual ? <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>semana en curso</div> : null)} />
        <Tile label="SLA Meli" value={cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"} dot={slaColor(cur.g.sla)} delta={dSla != null ? <DeltaSpan delta={dSla} unidad="pp" bueno="up" prevLbl={prevLbl} /> : null} />
        <Tile label="Demorados + Repro 21" value={fmtInt(cur.g.dem + cur.g.d21)} />
        <Tile label="Entregas post 21" value={fmt1(cur.g.p21rate * 100) + "%"} delta={dP21 != null ? <DeltaSpan delta={dP21} unidad="pp" bueno="down" prevLbl={prevLbl} /> : null} />
        <Tile label="% Pendientes" value={fmt1(cur.g.pendRate * 100) + "%"} delta={dPend != null ? <DeltaSpan delta={dPend} unidad="pp" bueno="down" prevLbl={prevLbl} /> : null} />
        <Tile label="Cadetes activos" value={fmtInt(cur.g.cadetes)} />
      </div>

      {/* Evolución semanal */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Evolución semanal</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 22 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Envíos por semana</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>El período elegido en verde; el resto es contexto. * = semana parcial.</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={weekAgg} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.faint} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v >= 1000 ? (v / 1000) + "k" : v} />
              <Tooltip contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmtInt(v), "Envíos"]} labelStyle={{ color: C.muted }} />
              <Bar dataKey="cant" radius={[3, 3, 0, 0]}>
                {weekAgg.map((d, i) => <Cell key={i} fill={d.sel ? C.teal : C.dim} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>SLA Meli por semana</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>Líneas de referencia en 95 y 98.</div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={weekAgg.filter((d) => d.sla != null)} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.faint} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
              <YAxis domain={["dataMin - 1", 100]} tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v + "%"} />
              <Tooltip contentStyle={{ background: "#0B0B24", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt1(v) + "%", "SLA"]} labelStyle={{ color: C.muted }} />
              <ReferenceLine y={98} stroke={C.good} strokeDasharray="3 3" />
              <ReferenceLine y={95} stroke={C.warn} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="sla" stroke={C.teal} strokeWidth={2} dot={{ r: 3, fill: C.teal }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. SLA por zona */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>SLA por zona <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(oportunidades geográficas)</span></h3>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 22 }}>
        {zonaData == null ? (
          <div style={{ color: C.muted, fontSize: 12 }}>Cargando zonas…</div>
        ) : zonaData.vacio ? (
          <div style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6 }}>
            {zonaData.desde
              ? `Todavía no hay datos por zona para este período. La captura arrancó el ${fmtDMY(zonaData.desde)} — elegí un período desde esa fecha.`
              : "Los datos por zona se empiezan a capturar desde hoy (la Action nocturna guarda la primera foto esta noche). No hay histórico hacia atrás."}
            {zonasErr ? <div style={{ marginTop: 6, color: C.critText, fontSize: 11 }}>({zonasErr})</div> : null}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>
              SLA por localidad con la misma fórmula que la tabla por cadete. Δ = puntos vs el SLA global del período ({cur.g.sla != null ? fmt1(cur.g.sla) + "%" : "—"}). Zonas con &lt;{CFG.zonaMin} envíos van agrupadas abajo (muestra chica).
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["Localidad", "Envíos", "SLA", "Δ vs global", "% post 21", "% Nadie"].map((h, i) => (
                      <th key={i} style={{ padding: "6px 8px", textAlign: i === 0 ? "left" : "right", color: C.muted, fontWeight: 600, fontSize: 11.5, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zonaData.grandes.map((z, i) => {
                    const rojo = z.cantidad >= CFG.zonaMin && z.delta != null && z.delta <= -1;
                    return (
                      <tr key={i} style={{ background: rojo ? "rgba(229,96,77,0.09)" : "transparent" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 600 }}>{slaIcon(z.sla)} {z.localidad}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(z.cantidad)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: slaColor(z.sla), fontWeight: 600 }}>{z.sla != null ? fmt1(z.sla) + "%" : "—"}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: z.delta == null ? C.muted : z.delta >= 0 ? C.goodText : C.critText }}>{z.delta == null ? "—" : (z.delta >= 0 ? "+" : "−") + fmt1(Math.abs(z.delta))}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: z.post21Rate >= 15 ? C.critText : C.ink }}>{(z.post21Rate >= 15 ? "🌙 " : "") + fmt0(z.post21Rate) + "%"}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmt0(z.nadieRate)}%</td>
                      </tr>
                    );
                  })}
                  {zonaData.otras && (
                    <tr style={{ color: C.muted }}>
                      <td style={{ padding: "6px 8px", fontStyle: "italic" }}>{zonaData.otras.localidad} · {zonaData.otras.nZonas} localidades</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtInt(zonaData.otras.cantidad)}</td>
                      <td colSpan={4}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* 3. Carga por cadete — scatter */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Carga vs. SLA <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(cada punto es un cadete)</span></h3>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8 }}>Derecha = muchos paquetes por día. Abajo = SLA flojo. Abajo-derecha necesita que le saques carga; arriba-derecha es tu caballito de batalla. Línea vertical = tope ({CFG.tope}/día).</div>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 16, left: -6, bottom: 16 }}>
            <CartesianGrid stroke={C.faint} />
            <XAxis type="number" dataKey="prom" name="Envíos/día" tick={{ fontSize: 9, fill: C.muted }} label={{ value: "envíos por día trabajado", position: "insideBottom", offset: -8, fontSize: 10, fill: C.muted }} />
            <YAxis type="number" dataKey="sla" name="SLA" domain={["dataMin - 1", 100]} tick={{ fontSize: 9, fill: C.muted }} tickFormatter={(v) => v + "%"} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: C.border }} content={<CadTip />} />
            <ReferenceLine y={98} stroke={C.good} strokeDasharray="3 3" />
            <ReferenceLine y={95} stroke={C.warn} strokeDasharray="3 3" />
            <ReferenceLine x={CFG.tope} stroke={C.muted} strokeDasharray="4 4" label={{ value: "tope", position: "top", fontSize: 9, fill: C.muted }} />
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

      {/* 4. Sugerencias (mejores / críticos / reincidentes) — colapsadas detrás de "Ver análisis completo" */}
      <div onClick={() => setVerCompleto((v) => !v)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
        <span style={{ color: C.teal, fontSize: 14 }}>{verCompleto ? "▾" : "▸"}</span>
        <h3 style={{ fontSize: 14, margin: 0 }}>Ver análisis completo <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· 7 tarjetas de sugerencias · {periodDesc.toLowerCase()}</span></h3>
      </div>
      {verCompleto && (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginBottom: 22 }}>
        <Card icon="🔴" titulo="SLA crítico — hablar hoy" items={sug.criticos} vacio={`Nadie abajo de ${CFG.slaCritico}%. 👏`}
          render={(c) => <><b>{c.name}</b> — SLA {fmt1(c.sla)}% ({fmtInt(c.dem)} dem. + {fmtInt(c.d21)} repro 21 sobre {fmtInt(c.ml)} ML)</>} />
        <Card icon="🌙" titulo="Terminan tarde" items={sug.tarde} vacio="Nadie con post-21 alto ni fin de ruta tarde."
          render={(c) => <><b>{c.name}</b> — {fmt0(c.p21rate * 100)}% post 21{c.fin != null ? " · fin prom. " + fmtHora(c.fin) : ""}</>} />
        <Card icon="🔁" titulo="Repro 21 recurrente" items={sug.repro} vacio="Sin reincidentes de repro 21 en el período."
          render={(c) => <><b>{c.name}</b> — repro 21 en {c.dd21} de {c.dias} días ({fmtInt(c.d21)} envíos)</>} />
        <Card icon="📦" titulo={`Cerca o arriba del tope (${CFG.tope}/día)`} items={sug.sobre} vacio="Nadie pegado al tope."
          render={(c) => <><b>{c.name}</b> — {fmt1(c.prom)} env/día en {c.dias} días{c.sla != null && c.sla < CFG.slaOk ? " · SLA " + fmt1(c.sla) + "% ⚠️" : ""}</>} />
        <Card icon="💪" titulo="Caballitos de batalla" items={sug.caballos} vacio={`Ningún alto-volumen con SLA ≥ ${CFG.slaOk}% en el período.`}
          render={(c) => <><b>{c.name}</b> — {fmtInt(c.cant)} envíos ({fmt1(cur.g.cant > 0 ? c.cant / cur.g.cant * 100 : 0)}% del total) con SLA {fmt1(c.sla)}%</>} />
        <Card icon="📉" titulo={"En caída vs " + prevLbl} items={sug.caida} vacio={prev ? `Nadie empeoró más de ${CFG.deltaSla} pp.` : "Sin período de comparación."}
          render={(c) => <><b>{c.name}</b> — SLA {fmt1(c.sla)}% ({fmt1(c.delta)} pp)</>} />
        <Card icon="📈" titulo="Mejorando" items={sug.mejora} vacio={prev ? "Sin mejoras grandes esta vez." : "Sin período de comparación."}
          render={(c) => <><b>{c.name}</b> — SLA {fmt1(c.sla)}% (+{fmt1(c.delta)} pp)</>} />
      </div>
      )}

      {/* Ranking completo */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Ranking completo <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>(clic en una columna para ordenar)</span></h3>
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
            {ranking.map((c, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.faint}` }}>
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

      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
        Calidad de datos del período: {fmtInt(cur.g.sin)} envíos sin cadete asignado{cur.g.basura > 0 ? ` · ${fmtInt(cur.g.basura)} bajo nombres basura ("Repro gramar", "devuelto depósito") que conviene limpiar en LightData` : ""}. Los sin-asignar y basura cuentan en los KPIs pero quedan fuera del ranking y sugerencias.
      </div>
      <details style={{ fontSize: 11.5, color: C.muted }}>
        <summary style={{ cursor: "pointer", color: C.teal }}>Metodología y umbrales</summary>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          <p>SLA Meli = (envíos ML − demorados − repro 21) / envíos ML — misma fórmula que la tabla por cadete. Umbrales: ✅ ≥98% · ⚠️ 95–98% · 🔴 &lt;95%.</p>
          <p>Sugerencias (umbrales calibrables): SLA crítico &lt;{CFG.slaCritico}% con ≥{CFG.minML} ML · "termina tarde" = ≥{CFG.tarde_post21 * 100}% post 21 o fin ≥ {fmtHora(CFG.tarde_fin)} (con ≥{CFG.minEntregados} entregas) · "repro 21 recurrente" = ≥{CFG.repro21_min} en ≥{CFG.repro21_frec * 100}% de los días · "cerca del tope" = ≥{CFG.sobrecarga} env/día (tope {CFG.tope}) · caída/mejora = ±{CFG.deltaSla} pp.</p>
          <p>Semanas con * son parciales (&lt;5 días); en parciales no se compara volumen, solo tasas.</p>
          <p>SLA por zona: tabla semanas_zonas (se captura desde el deploy de hoy, sin histórico hacia atrás). Zonas con &lt;{CFG.zonaMin} envíos van agrupadas como "muestra chica" y no se marcan críticas. Rojo = ≥{CFG.zonaMin} envíos y Δ ≤ −1 pp.</p>
        </div>
      </details>
    </div>
  );
}

function fmtDMY(iso) {
  if (!iso) return "";
  const p = String(iso).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
