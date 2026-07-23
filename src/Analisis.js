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
        const c = porCad[name] || (porCad[name] = { name, cant: 0, pend: 0, dem: 0, d21: 0, p21: 0, ml: 0, dias: 0, dd21: 0, finSum: 0, finDias: 0, diasSobreTope: 0 });
        c.cant += m.cantidad; c.pend += m.pendientes; c.dem += m.demorados;
        c.d21 += (m.dem21 || 0); c.p21 += (m.post21 || 0); c.ml += m.envios_ml;
        c.dias += 1;
        if ((m.dem21 || 0) > 0) c.dd21 += 1;
        const tope = topeMap[name] || CFG.tope;
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

// =================================================================
export default function Analisis({ semanas }) {
  const [zonasRaw, setZonasRaw] = useState(null); // null=cargando, []=vacío
  const [topeMap, setTopeMap] = useState({});
  const [zonasErr, setZonasErr] = useState("");

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

      {/* 4. Sugerencias (mejores / críticos / reincidentes) */}
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Sugerencias <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>· {periodDesc.toLowerCase()}</span></h3>
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
