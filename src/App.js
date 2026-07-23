import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react"; // build: 20 nav + lazy
import Home from "./Home";
import { getSession, login, logout } from "./auth";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

// Code splitting: cada vista pesada se baja recién cuando se entra (mejora la carga inicial)
const Colectas = lazy(() => import("./Colectas"));
const Tiquetera = lazy(() => import("./Tiquetera"));
const Pagos = lazy(() => import("./Pagos"));

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

const ML_LOGO = "data:image/webp;base64,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";
const FLEXIT_LOGO = "data:image/jpeg;base64,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";

const TOKEN_EMPRESA = "ldae_125_6e2c8f1d4a9b3d7c5f0a2e8b1c4d7a96";
const ID_EMPRESA = "125";

// Cache de tokens de clientes 
let _clienteTokens = null;

async function getClienteTokens() {
  if (_clienteTokens) return _clienteTokens;
  try {
    const res = await supabaseFetch("clientes_tokens?select=codigo,token&limit=1000");
    _clienteTokens = {};
    if (Array.isArray(res)) {
      res.forEach(r => { 
        _clienteTokens[r.codigo] = r.token;
        _clienteTokens[String(r.codigo).replace(/^0+/, '')] = r.token;
        _clienteTokens[String(r.codigo).padStart(4, '0')] = r.token;
      });
    }
  } catch(e) { _clienteTokens = {}; }
  return _clienteTokens;
}

// Consulta el historial de un envio ML y determina si es demora real
async function esDemorReal(idInterno, codCliente) {
  try {
    const tokens = await getClienteTokens();
    const codStr = String(codCliente).trim();
    const token = tokens[codStr] || tokens[codStr.replace(/^0+/, '')] || tokens[codStr.padStart(4,'0')];
    if (!token) return true;
    
    const res = await fetch("https://apiexterna.lightdata.com.ar/externa/obtener-datos-envio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN_EMPRESA}`
      },
      body: JSON.stringify({ idEmpresa: ID_EMPRESA, idEnvio: String(idInterno), token })
    });
    if (!res.ok) return true;
    const data = await res.json();
    if (!data.success || !data.data?.estadosHistorial) return true;
    const historial = data.data.estadosHistorial;
    const tuvoNadieAntes21 = historial.some(h => {
      const estadoH = String(h.estado).toLowerCase();
      const esNadieORepro = estadoH.includes("nadie") || estadoH.includes("reprogramado");
      if (!esNadieORepro) return false;
      try {
        const hora = new Date(h.fecha).getHours();
        return hora < 21;
      } catch(e) { return true; }
    });
    return !tuvoNadieAntes21;
  } catch(e) {
    return true;
  }
}

const BRAND = {
  navy:    "#0D0D2B",
  navyMid: "#12123A",
  navyCard:"#1A1A4A",
  teal:    "#2ECFAA",
  blue:    "#3A8FD4",
  white:   "#FFFFFF",
  muted:   "rgba(255,255,255,0.62)", // contraste AA sobre navy (antes 0.5)
  faint:   "rgba(255,255,255,0.08)",
  border:  "rgba(255,255,255,0.1)",
};

// Skeleton de carga: feedback inmediato al cambiar de vista (evita la pantalla congelada)
function VistaSkeleton() {
  const bar = (w, h = 16) => ({ width: w, height: h, borderRadius: 8, background: "rgba(255,255,255,0.07)", animation: "flexitPulse 1.2s ease-in-out infinite" });
  return (
    <div aria-label="Cargando..." style={{ padding: "0.5rem 0" }}>
      <style>{`@keyframes flexitPulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
      <div style={{ ...bar(220, 26), marginBottom: 18 }} />
      <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={bar(180, 72)} />)}
      </div>
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} style={{ ...bar("100%", 34), marginBottom: 8 }} />)}
    </div>
  );
}

// Panel de navegación (compartido entre la sidebar fija de desktop y el overlay de mobile)
function NavPanel({ seccion, go, onClose, logo }) {
  const items = [
    { id: "metricas", icon: "ti ti-chart-bar", label: "Métricas" },
    { id: "colectas", icon: "ti ti-package", label: "Colectas" },
    { id: "arribos", icon: "ti ti-truck-delivery", label: "Arribos" },
    { id: "tiquetera", icon: "ti ti-ticket", label: "Tiquetera" },
    ...(getSession()?.email === "admin@flexit.app" ? [{ id: "pagos", icon: "ti ti-cash", label: "Liquidaciones" }] : []),
  ];
  return (
    <>
      <div onClick={() => go("home")} title="Ir al inicio" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "2rem", paddingBottom: "1rem", borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
        <img src={logo} alt="Flexit" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 8 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Flexit</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, paddingLeft: 10 }}>Navegación</div>
        {items.map(it => {
          const active = seccion === it.id;
          return (
            <button key={it.id} onClick={() => go(it.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${active ? "rgba(46,207,170,0.3)" : "rgba(255,255,255,0.08)"}`, background: active ? "rgba(46,207,170,0.1)" : "rgba(255,255,255,0.04)", color: active ? "#2ECFAA" : "rgba(255,255,255,0.75)", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
              <i className={it.icon} style={{ fontSize: 18 }} />
              {it.label}
            </button>
          );
        })}
        <a href="/choferes.html"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.75)", fontSize: 14, fontWeight: 500, cursor: "pointer", textDecoration: "none" }}>
          <i className="ti ti-user-plus" style={{ fontSize: 18 }} />
          Alta de Choferes
        </a>
      </div>
      {onClose && (
        <button onClick={onClose}
          style={{ marginTop: "auto", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "none", color: "rgba(255,255,255,0.45)", fontSize: 13, cursor: "pointer" }}>
          Cerrar ✕
        </button>
      )}
    </>
  );
}

const SLA_VERDE = 98;
const SLA_AMARILLO = 95;

function getSemaforo(sla) {
  if (sla === null) return { color: "#555577", bg: "rgba(85,85,119,0.15)", label: "SIN DATOS", emoji: "⚪" };
  if (sla >= SLA_VERDE)    return { color: "#2ECFAA", bg: "rgba(46,207,170,0.15)", label: "OK",      emoji: "🟢" };
  if (sla >= SLA_AMARILLO) return { color: "#EF9F27", bg: "rgba(239,159,39,0.15)", label: "RIESGO",  emoji: "🟡" };
  return                          { color: "#E24B4A", bg: "rgba(226,75,74,0.15)",  label: "CRÍTICO", emoji: "🔴" };
}

function evaluar(demorados, sla) {
  if (sla === null) return "SIN DATOS";
  if (demorados >= 5 || sla < 90) return "MUY MALO";
  if (demorados >= 3 || sla < 95) return "MALO";
  if (sla < 98) return "MEDIO";
  return "BUENO";
}

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  console.log("Supabase:", options.method || "GET", url.split("/v1/")[1]);
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=representation",
      ...options.headers,
    },
  });
  const text = await res.text();
  console.log("Supabase response:", res.status, text.slice(0,100));
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : [];
}

async function cargarDesdeSupabase() {
  let rows;
  try {
    rows = await supabaseFetch("semanas?select=id,label,fecha,cadete,cantidad,pendientes,demorados,envios_ml,post21,dem21,envios_particular,inicio_ruta,fin_ruta,demorados_detalle,sin_datos_detalle&order=fecha.asc&limit=50000");
  } catch(e) {
    // Columna demorados_detalle no existe aún — usar query sin ella
    rows = await supabaseFetch("semanas?select=id,label,fecha,cadete,cantidad,pendientes,demorados,envios_ml,post21,dem21,envios_particular,inicio_ruta,fin_ruta&order=fecha.asc&limit=50000");
  }
  const map = {};
  for (const r of rows) {
    if (new Date(r.fecha + "T12:00:00").getDay() === 0) continue; // domingos: no se opera, no mostrar
    if (!map[r.label]) map[r.label] = { label: r.label, dias: {} };
    if (!map[r.label].dias[r.fecha]) map[r.label].dias[r.fecha] = [];
    map[r.label].dias[r.fecha].push({
      cadete: r.cadete, cantidad: r.cantidad, pendientes: r.pendientes,
      demorados: r.demorados, envios_ml: r.envios_ml, post21: r.post21||0, dem21: r.dem21||0, envios_particular: r.envios_particular||0, inicio_ruta: r.inicio_ruta||null, fin_ruta: r.fin_ruta||null, fecha: r.fecha,
      demoradosDetalle: r.demorados_detalle || [],
      sinDatosDetalle: r.sin_datos_detalle || [],
    });
  }
  return Object.values(map).map(s => ({
    label: s.label,
    dias: Object.entries(s.dias).map(([fecha, datos]) => {
      const enriched = datos.map(m => {
        const pct = m.cantidad > 0 ? (m.cantidad - m.pendientes) / m.cantidad * 100 : 0;
        const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados - (m.dem21||0)) / m.envios_ml * 100 : null;
        return { ...m, pctEntrega: +pct.toFixed(2), slaMeli: sla !== null ? +sla.toFixed(2) : null, evaluacion: evaluar(m.demorados + (m.dem21||0), sla) };
      });
      return { fecha, datos: enriched };
    }).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  })).sort((a, b) => { const fa = a.dias[0]?.fecha || ''; const fb = b.dias[0]?.fecha || ''; return fa.localeCompare(fb); });
}

async function guardarEnSupabase(datos, fecha, weekLabel) {
  // Guard: nunca borrar el día si no hay datos nuevos que insertar (evita dejar el día en blanco).
  if (!datos || datos.length === 0) {
    throw new Error("No hay datos para guardar: se cancela para no borrar el día ya cargado.");
  }
  // Delete existing rows for this date
  await supabaseFetch(`semanas?fecha=eq.${fecha}&label=eq.${encodeURIComponent(weekLabel)}`, { method: "DELETE" });
  // Insert new rows
  const rows = datos.map(m => ({
    label: weekLabel, fecha, cadete: m.cadete,
    cantidad: m.cantidad, pendientes: m.pendientes,
    demorados: m.demorados, envios_ml: m.envios_ml, post21: m.post21 || 0, dem21: m.dem21 || 0, envios_particular: m.envios_particular || 0, inicio_ruta: m.inicio_ruta || null, fin_ruta: m.fin_ruta || null,
    demorados_detalle: m.demoradosDetalle || [],
    sin_datos_detalle: m.sinDatosDetalle || [],
  }));
  try {
    await supabaseFetch("semanas", { method: "POST", body: JSON.stringify(rows) });
  } catch(e) {
    // Fallback sin columnas nuevas si aún no existen
    const rowsFallback = rows.map(({ demorados_detalle, sin_datos_detalle, ...r }) => r);
    await supabaseFetch("semanas", { method: "POST", body: JSON.stringify(rowsFallback) });
  }
}

function useXLSX() {
  const [ready, setReady] = useState(typeof window !== "undefined" && !!window.XLSX);
  useEffect(() => {
    if (window.XLSX) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);
  return ready;
}

function parsearExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
        let headerRow = -1;
        for (let i = 0; i < Math.min(10, raw.length); i++) {
          if (raw[i] && raw[i].some(c => String(c || "").includes("Cadete"))) { headerRow = i; break; }
        }
        if (headerRow === -1) { reject(new Error("No se encontró la columna 'Cadete'")); return; }
        const headers = raw[headerRow].map(h => String(h || "").trim());
        const rows = raw.slice(headerRow + 1)
          .filter(r => r && r.some(c => c !== null && c !== undefined && c !== ""))
          .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? ""; }); return o; });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function calcularDia(rows, fecha, noEsDemora = new Set()) {
  const map = {};
  for (const row of rows) {
    const cadete = String(row["Cadete"] || "").trim() || "⚠️ Sin asignar";
    const estado = String(row["Estado"] || "").trim().replace(/^nan$/i, "");
    const origen = String(row["Origen"] || "").trim();
    const esML = origen === "ML";
    const RESUELTOS = ["Entregado","Entregado 2DA visita","Cancelado"];
    const esPendiente = !RESUELTOS.includes(estado);
    const idInterno = String(row["ID (Interno)"] || "").trim();
    const esEnCamino = estado === "En camino al destinatario";
    const esEnPlanta = estado === "En planta de procesamiento";
    const esReproML = estado === "reprogramado por meli";
    const dirBase = String(row["Domicilio"] || row["Dirección"] || row["Domicilio destino"] || row["Dom. Destino"] || row["Destino"] || "").trim();
    const loc = String(row["Localidad"] || "").trim();
    const tieneDatos = !!(dirBase || loc);
    const seriaDemorado = esML && (esEnPlanta || ((esEnCamino || esReproML) && !noEsDemora.has(idInterno)));
    const esDemorado = seriaDemorado && tieneDatos;
    const esSinDatos = seriaDemorado && !tieneDatos; // cliente desvinculado de LightData: sin datos de destino, no se cuenta como demora
    const fechaEstado = String(row["Fecha estado"] || "").trim();
    const esEntregado = ["Entregado","Entregado 2DA visita"].includes(estado);
    let esPost21 = false;
    if (esEntregado && fechaEstado) {
      const hora = fechaEstado.split(" ")[1];
      if (hora) {
        const h = parseInt(hora.split(":")[0]);
        if (h >= 21) esPost21 = true;
      }
    }
    if (!map[cadete]) map[cadete] = { cadete, cantidad: 0, pendientes: 0, demorados: 0, envios_ml: 0, post21: 0, dem21: 0, envios_particular: 0, inicio_ruta: null, fin_ruta: null, demoradosDetalle: [], sinDatosDetalle: [] };
    map[cadete].cantidad++;
    if (esPendiente) map[cadete].pendientes++;
    if (esDemorado) {
      map[cadete].demorados++;
      const dir = [dirBase, loc].filter(Boolean).join(", ");
      map[cadete].demoradosDetalle.push({ id: idInterno, dir, estado });
    }
    if (esSinDatos) {
      const cliente = String(row["Razon Social"] || row["Nombre Fantasia"] || "").trim() || ("Cod. " + String(row["Cod.Cliente"] || "").trim());
      map[cadete].sinDatosDetalle.push({ id: idInterno, cliente, estado });
    }
    if (esML)        map[cadete].envios_ml++;
    if (!esML)       map[cadete].envios_particular++;
    if (esPost21)    map[cadete].post21++;
    // Track inicio and fin de ruta from entregados
    if (esEntregado && fechaEstado) {
      const hora = fechaEstado.split(" ")[1];
      if (hora) {
        if (!map[cadete].inicio_ruta || hora < map[cadete].inicio_ruta) map[cadete].inicio_ruta = hora;
        if (!map[cadete].fin_ruta || hora > map[cadete].fin_ruta) map[cadete].fin_ruta = hora;
      }
    }
    // Repro 21hs: reprogramado por meli + ML + hora >= 21
    const esRepro21 = esML && (estado === "reprogramado por meli" || estado === "Nadie" || estado === "Nadie 2DA visita") && fechaEstado.split(" ")[1] && parseInt(fechaEstado.split(" ")[1].split(":")[0]) >= 21;
    if (esRepro21) map[cadete].dem21++;
  }
  return Object.values(map).map(m => {
    const pct = m.cantidad > 0 ? (m.cantidad - m.pendientes) / m.cantidad * 100 : 0;
    const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados) / m.envios_ml * 100 : null;
    const slaReal = m.envios_ml > 0 ? (m.envios_ml - m.demorados - m.dem21) / m.envios_ml * 100 : null;
    return { ...m, pctEntrega: +pct.toFixed(2), slaMeli: slaReal !== null ? +slaReal.toFixed(2) : null, evaluacion: evaluar(m.demorados + m.dem21, slaReal), fecha, post21: m.post21 || 0, dem21: m.dem21 || 0, entregados: m.cantidad - m.pendientes, envios_particular: m.envios_particular || 0, inicio_ruta: m.inicio_ruta || null, fin_ruta: m.fin_ruta || null, demoradosDetalle: m.demoradosDetalle || [], sinDatosDetalle: m.sinDatosDetalle || [] };
  });
}

function acumularSemana(dias) {
  const map = {};
  for (const dia of dias) {
    for (const m of dia.datos) {
      if (!map[m.cadete]) map[m.cadete] = { cadete: m.cadete, cantidad: 0, pendientes: 0, demorados: 0, envios_ml: 0, post21: 0, dem21: 0, envios_particular: 0, inicio_ruta: null, fin_ruta: null, demoradosDetalle: [], sinDatosDetalle: [] };
      map[m.cadete].cantidad  += m.cantidad;
      map[m.cadete].pendientes+= m.pendientes;
      map[m.cadete].demorados += m.demorados;
      map[m.cadete].demoradosDetalle = (map[m.cadete].demoradosDetalle || []).concat(m.demoradosDetalle || []);
      map[m.cadete].sinDatosDetalle = (map[m.cadete].sinDatosDetalle || []).concat(m.sinDatosDetalle || []);
      map[m.cadete].envios_ml += m.envios_ml;
      map[m.cadete].post21    += (m.post21 || 0);
      map[m.cadete].dem21     += (m.dem21 || 0);
      map[m.cadete].envios_particular += (m.envios_particular || 0);
      if (m.inicio_ruta) {
        if (!map[m.cadete].inicio_ruta || m.inicio_ruta < map[m.cadete].inicio_ruta) map[m.cadete].inicio_ruta = m.inicio_ruta;
      }
      if (m.fin_ruta) {
        if (!map[m.cadete].fin_ruta || m.fin_ruta > map[m.cadete].fin_ruta) map[m.cadete].fin_ruta = m.fin_ruta;
      }
    }
  }
  return Object.values(map).map(m => {
    const pct = m.cantidad > 0 ? (m.cantidad - m.pendientes) / m.cantidad * 100 : 0;
    const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados) / m.envios_ml * 100 : null;
    const slaRealAcum = m.envios_ml > 0 ? (m.envios_ml - m.demorados - m.dem21) / m.envios_ml * 100 : null;
    return { ...m, pctEntrega: +pct.toFixed(2), slaMeli: slaRealAcum !== null ? +slaRealAcum.toFixed(2) : null, evaluacion: evaluar(m.demorados + m.dem21, slaRealAcum), post21: m.post21 || 0, dem21: m.dem21 || 0, entregados: m.cantidad - m.pendientes, inicio_ruta: m.inicio_ruta || null, fin_ruta: m.fin_ruta || null, demoradosDetalle: m.demoradosDetalle || [], sinDatosDetalle: m.sinDatosDetalle || [] };
  }).sort((a, b) => (a.slaMeli ?? 101) - (b.slaMeli ?? 101));
}

function tendenciaCadete(cadete, semanas) {
  const puntos = [];
  for (const sem of semanas) {
    for (const dia of sem.dias) {
      const m = dia.datos.find(d => d.cadete === cadete);
      if (m) puntos.push({ fecha: dia.fecha, sla: m.slaMeli, demorados: m.demorados });
    }
  }
  return puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function getWeekLabel(fecha) {
  const d = new Date(fecha + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const lunes = new Date(d); lunes.setDate(diff);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const fmt = (x) => `${x.getDate().toString().padStart(2,"0")}/${(x.getMonth()+1).toString().padStart(2,"0")}`;
  return `${fmt(lunes)}-${fmt(domingo)}`;
}

function exportarExcel(acumulado, semanaLabel, diasLabels) {
  const resumenData = [
    ["Control de Flota — Semana " + semanaLabel],
    [],
    ["Cadete","Total envíos","Pendientes","Demorados ML","Envíos ML","% Entrega","SLA Meli","Estado"],
    ...acumulado.map(m => [m.cadete, m.cantidad, m.pendientes, m.demorados, m.envios_ml,
      m.pctEntrega.toFixed(1)+"%", m.slaMeli !== null ? m.slaMeli.toFixed(1)+"%" : "—", getSemaforo(m.slaMeli).label])
  ];
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(resumenData);
  ws["!cols"] = [{ wch:25},{wch:14},{wch:12},{wch:14},{wch:12},{wch:12},{wch:12},{wch:12}];
  window.XLSX.utils.book_append_sheet(wb, ws, "Resumen semana");
  window.XLSX.writeFile(wb, `metricas_semana_${semanaLabel.replace(/\//g,"-")}.xlsx`);
}

function SemaforoCard({ m, onClick, selected }) {
  const sem = getSemaforo(m.slaMeli);
  return (
    <div onClick={() => onClick(m.cadete)} style={{
      background: selected ? sem.bg : BRAND.navyCard,
      border: `1px solid ${selected ? sem.color : BRAND.border}`,
      borderLeft: `3px solid ${sem.color}`,
      borderRadius: 12, padding: "1rem", cursor: "pointer", transition: "all 0.15s",
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
        <div style={{ fontSize:13, fontWeight:600, color:BRAND.white, lineHeight:1.3, flex:1, marginRight:8 }}>{m.cadete}</div>
        <div style={{ fontSize:18 }}>{sem.emoji}</div>
      </div>
      <div style={{ fontSize:26, fontWeight:700, color:sem.color, marginBottom:6 }}>
        {m.slaMeli !== null ? m.slaMeli.toFixed(1)+"%" : "—"}
      </div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
        <span style={{ fontSize:11, color:BRAND.muted }}>{m.cantidad} envíos</span>
        {m.demorados > 0 && <span style={{ fontSize:11, color:"#E24B4A", fontWeight:600 }}>{m.demorados} dem.</span>}
        {m.pendientes > 0 && <span style={{ fontSize:11, color:"#3A8FD4" }}>{m.pendientes} pend.</span>}
      </div>
      <div style={{ height:4, background:BRAND.faint, borderRadius:2, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.min(m.slaMeli??0,100)}%`, background:sem.color, borderRadius:2 }} />
      </div>
    </div>
  );
}

const ttStyle = { background:"#1A1A4A", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, fontSize:12, color:"#fff" };

function DemoradosPopover({ detalle, count, cadete }) {
  const [show, setShow] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!show) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setShow(false); setCopied(false); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [show]);
  if (!count) return <span style={{ color:"rgba(255,255,255,0.3)" }}>0</span>;
  const hasDetalle = detalle && detalle.length > 0;
  const copyAll = (e) => {
    e.stopPropagation();
    const text = detalle.map(d => d.dir || d.id).filter(Boolean).join("\n");
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <span
        onClick={(e) => { e.stopPropagation(); if (hasDetalle) { setShow(s => !s); setCopied(false); } }}
        style={{ color:"#E24B4A", fontWeight:700, cursor: hasDetalle ? "pointer" : "default", borderBottom: hasDetalle ? "1px dashed rgba(226,75,74,0.5)" : "none" }}>
        {count}
      </span>
      {show && hasDetalle && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"#0D0D2B", border:"1px solid rgba(226,75,74,0.4)", borderRadius:10, padding:"10px", zIndex:999, minWidth:240, maxWidth:320, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", fontSize:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, paddingBottom:6, borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
            <div>
              <span style={{ color:"#E24B4A", fontWeight:700, fontSize:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>🔴 {count} demorado{count>1?"s":""}</span>
              {cadete && <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginTop:4 }}>{cadete}</div>}
            </div>
            <button onClick={copyAll} title="Copiar todas las direcciones" style={{ background:"none", border:"none", cursor:"pointer", color: copied ? "#2ECFAA" : "rgba(255,255,255,0.4)", fontSize:16, padding:"2px 4px", display:"flex", alignItems:"center" }}>
              {copied ? "✓" : "⎘"}
            </button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:200, overflowY:"auto" }}>
            {detalle.map((d, i) => (
              <div key={i} style={{ padding:"5px 6px", borderRadius:6, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ color:"rgba(255,255,255,0.85)", fontSize:11, lineHeight:"1.3", wordBreak:"break-word" }}>
                  {d.dir || <span style={{ color:"rgba(255,255,255,0.35)", fontStyle:"italic" }}>Sin dirección</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SinDatosBadge({ items }) {
  const [show, setShow] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!items || items.length === 0) return null;
  const porCliente = {};
  for (const it of items) { const c = (it.cliente || "").trim() || "Cliente sin identificar"; porCliente[c] = (porCliente[c] || 0) + 1; }
  const filas = Object.entries(porCliente).sort((a, b) => b[1] - a[1]);
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block", marginBottom:"1rem" }}>
      <button onClick={() => setShow(s => !s)} title="Envíos sin dirección (cliente desvinculado) — tocar para ver detalle"
        style={{ position:"relative", display:"inline-flex", alignItems:"center", justifyContent:"center", background: show ? "rgba(239,159,39,0.22)" : "rgba(239,159,39,0.12)", border:"1px solid rgba(239,159,39,0.5)", borderRadius:9, padding:8, color:"#EF9F27", cursor:"pointer", lineHeight:1 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display:"block" }}>
          <path d="M12 9v4" />
          <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
          <path d="M12 16h.01" />
        </svg>
        <span style={{ position:"absolute", top:-7, right:-7, background:"#E24B4A", color:"#fff", fontSize:11, fontWeight:700, minWidth:18, height:18, borderRadius:9, display:"inline-flex", alignItems:"center", justifyContent:"center", padding:"0 4px", border:"2px solid #0D0D2B" }}>{items.length}</span>
      </button>
      {show && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, background:"#0D0D2B", border:"1px solid rgba(239,159,39,0.4)", borderRadius:10, padding:"12px", zIndex:999, minWidth:270, maxWidth:360, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", fontSize:12 }}>
          <div style={{ color:"rgba(255,255,255,0.85)", fontSize:12, lineHeight:"1.45", marginBottom:10 }}>
            <strong style={{ color:"#EF9F27" }}>{items.length} envío{items.length > 1 ? "s" : ""} sin dirección</strong> — cliente desvinculado de LightData. No cuentan como demora.
          </div>
          <div style={{ color:"#EF9F27", fontWeight:700, fontSize:10, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>Por cliente</div>
          <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:240, overflowY:"auto" }}>
            {filas.map(([cliente, n]) => (
              <div key={cliente} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:"6px 8px", borderRadius:6, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ color:"rgba(255,255,255,0.85)", wordBreak:"break-word" }}>{cliente}</span>
                <span style={{ color:"#EF9F27", fontWeight:700 }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ThHeader({ label, col, tip, sortCol, sortDir, toggleSort }) {
  const [show, setShow] = React.useState(false);
  return (
    <th onClick={()=>col!=="cadete"&&toggleSort(col)}
      onMouseEnter={()=>tip&&setShow(true)}
      onMouseLeave={()=>setShow(false)}
      style={{ padding:"10px 14px", fontSize:11, fontWeight:600, color:sortCol===col?"#fff":"rgba(255,255,255,0.5)", textAlign:col==="cadete"?"left":"right", borderBottom:"1px solid rgba(255,255,255,0.1)", whiteSpace:"nowrap", textTransform:"uppercase", letterSpacing:"0.05em", cursor:col!=="cadete"?"pointer":"default", userSelect:"none", background:sortCol===col?"rgba(255,255,255,0.08)":"transparent", position:"relative" }}>
      {label}{col!=="cadete" && <span style={{marginLeft:4, opacity:0.6}}>{sortCol===col?(sortDir==="asc"?"↑":"↓"):"↕"}</span>}
      {show && tip && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:"50%", transform:"translateX(-50%)", background:"#0D0D2B", border:"1px solid rgba(46,207,170,0.4)", borderRadius:8, padding:"6px 10px", zIndex:200, minWidth:180, fontSize:11, color:"rgba(255,255,255,0.8)", fontWeight:400, textTransform:"none", letterSpacing:"normal", whiteSpace:"normal", pointerEvents:"none" }}>
          {tip}
        </div>
      )}
    </th>
  );
}

function TooltipKpi({ label, val, color, icon, tooltip, tooltipDem }) {
  const [show, setShow] = React.useState(false);
  const hasTooltip = !!(tooltip || tooltipDem);
  return (
    <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:10, padding:"1rem", position:"relative" }}
      onMouseEnter={()=>hasTooltip&&setShow(true)}
      onMouseLeave={()=>setShow(false)}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.04em" }}>{label}</div>
        <i className={`ti ${icon}`} style={{ fontSize:16, color, opacity:0.7 }} />
      </div>
      <div style={{ fontSize:26, fontWeight:700, color }}>{val}</div>
      {show && tooltip && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)", background:BRAND.navy, border:`1px solid rgba(46,207,170,0.4)`, borderRadius:10, padding:"12px", zIndex:100, minWidth:220, boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8, padding:"8px 10px", background:"rgba(255,230,0,0.08)", border:"1px solid rgba(255,230,0,0.2)", borderRadius:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <img src={ML_LOGO} alt="ML" style={{ width:22, height:22, objectFit:"contain", background:"#FFE600", borderRadius:4, padding:1 }} />
              <span style={{ fontSize:13, fontWeight:500 }}>Mercado Libre</span>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:18, fontWeight:600, color:BRAND.white }}>{tooltip.ml.toLocaleString("es-AR")}</div>
              <div style={{ fontSize:10, color:BRAND.muted }}>{tooltip.totalEnvios>0?(tooltip.ml/tooltip.totalEnvios*100).toFixed(1):0}%</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", background:BRAND.faint, border:`1px solid ${BRAND.border}`, borderRadius:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <img src={FLEXIT_LOGO} alt="Flexit" style={{ width:22, height:22, objectFit:"contain", background:"white", borderRadius:4, padding:1 }} />
              <span style={{ fontSize:13, fontWeight:500 }}>Particulares</span>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:18, fontWeight:600, color:BRAND.white }}>{tooltip.particular.toLocaleString("es-AR")}</div>
              <div style={{ fontSize:10, color:BRAND.muted }}>{tooltip.totalEnvios>0?(tooltip.particular/tooltip.totalEnvios*100).toFixed(1):0}%</div>
            </div>
          </div>
        </div>
      )}
      {show && tooltipDem && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)", background:BRAND.navy, border:`1px solid rgba(226,75,74,0.4)`, borderRadius:10, padding:"12px", zIndex:100, minWidth:200, boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, padding:"8px 10px", background:"rgba(226,75,74,0.08)", border:"1px solid rgba(226,75,74,0.2)", borderRadius:8 }}>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.7)" }}>Demorados ML</span>
            <span style={{ fontSize:18, fontWeight:700, color:"#E24B4A" }}>{tooltipDem.demML}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:"rgba(226,75,74,0.05)", border:`1px solid rgba(226,75,74,0.15)`, borderRadius:8 }}>
            <span style={{ fontSize:12, color:"rgba(255,255,255,0.7)" }}>Repro post 21hs</span>
            <span style={{ fontSize:18, fontWeight:700, color:"#E24B4A" }}>{tooltipDem.dem21}</span>
          </div>
        </div>
      )}
    </div>
  );
}


export default function App() {
  const xlsxReady = useXLSX();
  const [semanas, setSemanas]     = useState([]);
  const [semanaActiva, setSemanaActiva] = useState(null);
  const [fecha, setFecha]         = useState(() => new Date(Date.now() - 3*3600*1000).toISOString().slice(0,10));
  const [pendingFile, setPendingFile] = useState(null);
  const [showDateModal, setShowDateModal] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadingDB, setLoadingDB] = useState(true);
  const [error, setError]         = useState("");
  const [tab, setTab]             = useState("tabla");
  const [cadeteSeleccionado, setCadeteSeleccionado] = useState(null);
  const [filtro, setFiltro]       = useState("todos");
  const [sortCol, setSortCol]     = useState("slaMeli");
  const [showRuteo, setShowRuteo] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const historialRef = useRef();
  useEffect(() => {
    function handleClickOutside(e) {
      if (historialRef.current && !historialRef.current.contains(e.target)) {
        setShowHistorial(false);
        setMesActivo(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [mesActivo, setMesActivo] = useState(null);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [sortDir, setSortDir]     = useState("asc");
  const [diaActivo, setDiaActivo] = useState(null); // null = semana completa
  const [rankingVista, setRankingVista] = useState("semana");
  const [mesFiltro, setMesFiltro] = useState(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 700);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 700);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [seccion, setSeccion] = useState("home");
  const [session, setSession] = useState(() => getSession());
  const fileRef = useRef();

  // Título de la pestaña del navegador acorde a la sección activa
  useEffect(() => {
    const titulos = { metricas: "Métricas", colectas: "Colectas", arribos: "Arribos", tiquetera: "Tiquetera", pagos: "Liquidaciones" };
    document.title = titulos[seccion] ? `${titulos[seccion]} · Flexit` : "Flexit — Panel de operaciones";
    // al volver al home, re-sincronizar la sesión (por si se cerró dentro de Pagos)
    if (seccion === "home") setSession(getSession());
  }, [seccion]);

  // Cargar desde Supabase al inicio
  useEffect(() => {
    cargarDesdeSupabase()
      .then(data => {
        setSemanas(data);
        if (data.length > 0) {
          setSemanaActiva(data[data.length-1].label);
          const lastS = data[data.length-1];
          if (lastS.dias && lastS.dias.length > 0) {
            const sorted = [...lastS.dias].sort((a,b) => a.fecha.localeCompare(b.fecha));
            setDiaActivo(sorted[sorted.length-1].fecha);
          }
        }
      })
      .catch(e => setError("Error cargando datos: " + e.message))
      .finally(() => setLoadingDB(false));
  }, []);

  const onFile = useCallback(async (file) => {
    if (!file || !xlsxReady) return;
    setLoading(true); setError(""); setLoadingMsg("Procesando Excel...");
    try {
      const rows = await parsearExcel(file);

      // Debug logs
      console.log("Total rows:", rows.length);
      console.log("Todas las keys:", Object.keys(rows[0] || {}));
      console.log("Fecha estado sample:", rows.slice(0,3).map(r => r["Fecha estado"]));
      const entregados = rows.filter(r => ["Entregado","Entregado 2DA visita"].includes(String(r["Estado"]||"").trim()));
      console.log("Total entregados:", entregados.length);
      console.log("Post21 count:", entregados.filter(r => {
        const fs = String(r["Fecha estado"]||"").trim();
        if (!fs) return false;
        const hora = fs.split(" ")[1];
        if (!hora) return false;
        return parseInt(hora.split(":")[0]) >= 21;
      }).length);

      // Identify ML en camino shipments to verify via API
      const enCaminoML = rows.filter(r => {
        const origen = String(r["Origen"]||"").trim();
        const estado = String(r["Estado"]||"").trim();
        const idInterno = r["ID (Interno)"];
        // Solo verificar historial para "En camino" — En planta siempre es demora
        return origen === "ML" && estado === "En camino al destinatario" && idInterno;
      });
      console.log("En camino ML encontrados:", enCaminoML.length);

      setLoadingMsg(`Verificando ${enCaminoML.length} envíos ML en camino via API...`);

      // Check each en camino ML via API
      const noEsDemora = new Set();
      let checked = 0;
      for (const row of enCaminoML) {
        const idInterno = String(row["ID (Interno)"]).trim();
        const codCliente = row["Cod.Cliente"];
        const esReal = await esDemorReal(idInterno, codCliente);
        if (!esReal) noEsDemora.add(idInterno);
        checked++;
        if (checked % 5 === 0) setLoadingMsg(`Verificando API: ${checked}/${enCaminoML.length}...`);
      }
      console.log("No son demora real:", noEsDemora.size);

      setLoadingMsg("Calculando métricas...");
      const datos = calcularDia(rows, fecha, noEsDemora);
      const weekLabel = getWeekLabel(fecha);
      // Check if day already exists
      const diaExiste = semanas.some(s => s.dias.some(d => d.fecha === fecha));
      if (diaExiste) {
        const p = fecha.split("-");
        const confirmar = window.confirm(`¿Reemplazar los datos del ${p[2]}/${p[1]}/${p[0]}? Los datos actuales se perderán.`);
        if (!confirmar) { setLoading(false); setLoadingMsg(""); return; }
      }
      setLoadingMsg("Guardando en la nube...");
      await guardarEnSupabase(datos, fecha, weekLabel);
      const data = await cargarDesdeSupabase();
      setSemanas(data);
      setSemanaActiva(weekLabel);
      setTab("tabla");
      setLoadingMsg("");
    } catch(e) { setError("Error: " + e.message); setLoadingMsg(""); }
    finally { setLoading(false); }
  }, [fecha, xlsxReady]);

  const onDrop = useCallback((e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }, [onFile]);

  // Auto-select last week on load
  const ultimaSemana = semanas.length > 0 ? semanas[semanas.length-1].label : null;
  const semana    = semanas.find(s => s.label === semanaActiva);
  const diasDisponibles = semana?.dias || [];
  const acumulado = semana ? (diaActivo ? acumularSemana(semana.dias.filter(d => d.fecha === diaActivo)) : acumularSemana(semana.dias)) : [];
  const acumuladoSemanaCompleta = semana ? acumularSemana(semana.dias) : [];
  const diasLabels = semana?.dias.map(d => { const p=d.fecha.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; }) || [];

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const filtrados = acumulado.filter(m => {
    if (filtro==="critico") return m.slaMeli !== null && m.slaMeli < SLA_AMARILLO;
    if (filtro==="riesgo")  return m.slaMeli !== null && m.slaMeli >= SLA_AMARILLO && m.slaMeli < SLA_VERDE;
    if (filtro==="ok")      return m.slaMeli !== null && m.slaMeli >= SLA_VERDE;
    return true;
  }).sort((a, b) => {
    const va = a[sortCol] ?? (sortDir === "asc" ? 999 : -1);
    const vb = b[sortCol] ?? (sortDir === "asc" ? 999 : -1);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const criticos       = acumulado.filter(m => m.slaMeli !== null && m.slaMeli < SLA_AMARILLO).length;
  const enRiesgo       = acumulado.filter(m => m.slaMeli !== null && m.slaMeli >= SLA_AMARILLO && m.slaMeli < SLA_VERDE).length;
  const sinDatosItems  = acumulado.flatMap(m => m.sinDatosDetalle || []); // envíos ML sin datos de destino (cliente desvinculado)
  const totalEnvios    = acumulado.reduce((s,m) => s+m.cantidad, 0);
  const totalML        = acumulado.reduce((s,m) => s+m.envios_ml, 0);
  const totalParticular= acumulado.reduce((s,m) => s+(m.envios_particular||0), 0);
  const totalEntregados= acumulado.reduce((s,m) => s+(m.cantidad-m.pendientes), 0);
  const totalPendientes = acumulado.reduce((s,m) => s+m.pendientes, 0);
  const totalDemorados  = acumulado.reduce((s,m) => s+m.demorados+(m.dem21||0), 0);
  const totalDem21      = acumulado.reduce((s,m) => s+(m.dem21||0), 0);
  const slaFlexit       = totalEnvios > 0 ? +((totalEnvios - totalPendientes) / totalEnvios * 100).toFixed(1) : null;
  const totalMLDia     = acumulado.reduce((s,m) => s+m.envios_ml, 0);
  const totalDemDia    = acumulado.reduce((s,m) => s+m.demorados, 0);
  // SLA Meli headline: descuenta demorados Y dem21 (reprogramados 21hs), igual que la tabla por cadete.
  const slaPromedio    = totalMLDia > 0 ? +((totalMLDia - totalDemDia - totalDem21) / totalMLDia * 100).toFixed(2) : null;

  const tendencia   = cadeteSeleccionado ? tendenciaCadete(cadeteSeleccionado, semanas) : [];

  // Mensual — acumula días con filtro de mes
  const acumDias = (dias) => {
    const map = {};
    for (const dia of dias) {
      for (const m of dia.datos) {
        if (!map[m.cadete]) map[m.cadete] = { cadete: m.cadete, cantidad:0, pendientes:0, demorados:0, dem21:0, envios_ml:0, dias_con_demora:0 };
        map[m.cadete].cantidad += m.cantidad;
        map[m.cadete].pendientes += m.pendientes;
        map[m.cadete].demorados += m.demorados;
        map[m.cadete].dem21 += (m.dem21||0);
        map[m.cadete].envios_ml += m.envios_ml;
        if ((m.demorados + (m.dem21||0)) > 0) map[m.cadete].dias_con_demora++;
      }
    }
    return Object.values(map).map(m => {
      const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados - (m.dem21||0)) / m.envios_ml * 100 : null;
      return { ...m, slaMeli: sla !== null ? +sla.toFixed(2) : null };
    }).sort((a,b) => (a.slaMeli ?? 101) - (b.slaMeli ?? 101));
  };

  const todosLosDias = semanas.flatMap(s => s.dias).sort((a,b) => a.fecha.localeCompare(b.fecha));
  const mesesDisponibles = [...new Set(todosLosDias.map(d => d.fecha.slice(0,7)))].sort();
  const mesMasReciente = mesesDisponibles[mesesDisponibles.length - 1] ?? "";
  const mesFiltroActivo = mesFiltro ?? mesMasReciente;
  const diasDelMes = mesFiltroActivo ? todosLosDias.filter(d => d.fecha.startsWith(mesFiltroActivo)) : todosLosDias;
  const diasMesActual = todosLosDias.filter(d => d.fecha.startsWith(mesMasReciente));

  const mesData = acumDias(diasDelMes);
  const mesDataActual = acumDias(diasMesActual);
  const totalDemoradosMes = mesData.reduce((s,m) => s+m.demorados+(m.dem21||0), 0);
  const totalPendientesMes = mesData.reduce((s,m) => s+m.pendientes, 0);
  const slaArrMes = mesData.filter(m => m.slaMeli !== null);
  const totalMLMes = mesData.reduce((s,m) => s+m.envios_ml, 0);
  const totalEnviosMes = mesData.reduce((s,m) => s+m.cantidad, 0);
  const totalParticularMes = totalEnviosMes - totalMLMes;
  const totalDemMes = mesData.reduce((s,m) => s+m.demorados+(m.dem21||0), 0);
  const slaPromedioMes = totalMLMes > 0 ? +((totalMLMes - totalDemMes) / totalMLMes * 100).toFixed(2) : null;
  const criticosMes = mesData.filter(m => m.slaMeli !== null && m.slaMeli < 95);
  const okMes = mesData.filter(m => m.slaMeli !== null && m.slaMeli >= 98);
  const reincidentes = mesData.filter(m => m.dias_con_demora >= 3).sort((a,b) => b.dias_con_demora - a.dias_con_demora);

  // SLA por dia para grafico
  const slaPorDia = diasDelMes.map(dia => {
    const totalML = dia.datos.reduce((s,m) => s+m.envios_ml, 0);
    const demML = dia.datos.reduce((s,m) => s+m.demorados+(m.dem21||0), 0);
    const sla = totalML > 0 ? +((totalML-demML)/totalML*100).toFixed(1) : null;
    const p = dia.fecha.split("-");
    return { fecha: `${p[2]}/${p[1]}`, sla };
  });
  const rankingData = (rankingVista === "semana" ? acumuladoSemanaCompleta : mesData)
    .filter(m => m.slaMeli !== null)
    .sort((a,b) => (a.slaMeli ?? 200) - (b.slaMeli ?? 200));
  const comparativa = rankingData.slice(0,25).map(m => ({ name:m.cadete, sla:m.slaMeli??0, color:getSemaforo(m.slaMeli).color }));
  const mesSlaMap = Object.fromEntries(mesDataActual.filter(m => m.slaMeli !== null).map(m => [m.cadete, m.slaMeli]));

  const inp  = { padding:"7px 12px", fontSize:13, border:`1px solid ${BRAND.border}`, borderRadius:8, background:BRAND.faint, color:BRAND.white, outline:"none" };
  const card = { background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:"1.25rem" };
  const btn  = (active) => ({ padding:"5px 14px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${active?"#2ECFAA":BRAND.border}`, background:active?"rgba(46,207,170,0.15)":BRAND.faint, color:active?"#2ECFAA":BRAND.muted });

  if (loadingDB && seccion !== "home") return (
    <div style={{ background:BRAND.navy, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:BRAND.teal, fontSize:16, fontFamily:"sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🚚</div>
        Cargando historial...
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background:BRAND.navy, minHeight:"100vh", padding:"1.5rem", paddingBottom: isMobile ? "5rem" : "1.5rem", color:BRAND.white }}>

      {/* Modal: elegir fecha antes de procesar Excel */}
      {showDateModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setShowDateModal(false)}>
          <div style={{ background:"#0D0D2B", border:"1px solid rgba(46,207,170,0.4)", borderRadius:14, padding:"1.5rem", minWidth:280, boxShadow:"0 12px 40px rgba(0,0,0,0.7)" }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:16 }}>¿De qué fecha es el archivo?</div>
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
              style={{ width:"100%", background:"#1A1A4A", border:"1px solid rgba(255,255,255,0.15)", borderRadius:8, padding:"8px 12px", color:BRAND.white, fontSize:14, marginBottom:16, boxSizing:"border-box" }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setShowDateModal(false)}
                style={{ padding:"7px 16px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"none", color:BRAND.muted, cursor:"pointer", fontSize:13 }}>
                Cancelar
              </button>
              <button onClick={()=>{setShowDateModal(false);fileRef.current.click();}}
                style={{ padding:"7px 16px", borderRadius:8, border:"none", background:"#2ECFAA", color:"#0D0D2B", cursor:"pointer", fontSize:13, fontWeight:700 }}>
                Elegir archivo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar overlay (se abre con ☰) */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000, backdropFilter:"blur(2px)" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ position:"absolute", top:0, left:0, bottom:0, width:240, background:"#0D0D2B", borderRight:"1px solid rgba(255,255,255,0.1)", display:"flex", flexDirection:"column", padding:"1.5rem 1rem" }}>
            <NavPanel seccion={seccion} go={(s) => { setSeccion(s); setSidebarOpen(false); }} onClose={() => setSidebarOpen(false)} logo={FLEXIT_LOGO} />
          </div>
        </div>
      )}

      {/* Header */}
      {seccion !== "home" && (<div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"1.5rem", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"
          style={{ width:40, height:40, borderRadius:9, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.06)", color:"#fff", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          ☰
        </button>
        <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, overflow:"hidden" }}>
          <img src={FLEXIT_LOGO} alt="Flexit" style={{ width:44, height:44, objectFit:"cover" }} />
        </div>
        <div>
          <div style={{ fontSize:22, fontWeight:700, letterSpacing:"-0.02em" }}>{seccion === "colectas" ? "Colectas Flexit" : seccion === "arribos" ? "Arribos" : seccion === "tiquetera" ? "Tiquetera Flexit" : seccion === "pagos" ? "Liquidaciones" : "Métricas Flexit"}</div>
          <div style={{ fontSize:13, color:BRAND.muted }}>{seccion === "colectas" ? "Gestión de colectas" : seccion === "arribos" ? "Cadetes que llegan al depósito" : seccion === "tiquetera" ? "Consultas de WhatsApp · Agente" : seccion === "pagos" ? "Liquidación semanal de cadetes" : "Control de SLA · Mercado Libre"}</div>
        </div>
        </div>
        {/* Upload compacto - solo en métricas */}
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {!isMobile && seccion === "metricas" && (<>
          <div onDrop={(e)=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f){setPendingFile(f);setShowDateModal(true);}}} onDragOver={e=>e.preventDefault()} onClick={()=>xlsxReady&&!loading&&setShowDateModal(true)}
            style={{ border:"1px solid #2ECFAA", borderRadius:8, padding:"6px 16px", cursor:xlsxReady&&!loading?"pointer":"wait", fontSize:12, color:"#2ECFAA", background:"rgba(46,207,170,0.08)", whiteSpace:"nowrap" }}>
            <i className="ti ti-upload" style={{ fontSize:14, marginRight:6 }} />
            {!xlsxReady?"Cargando...":loading?(loadingMsg||"Procesando..."):"Subir Excel"}
            <input ref={fileRef} type="file" accept=".xls,.xlsx" style={{ display:"none" }} onChange={e=>{const f=e.target.files[0];if(f)onFile(f);e.target.value="";}} />
          </div>
          </>)}
        </div>
      </div>



      )}

      {seccion === "home" && <Home onNav={setSeccion} onMenu={() => setSidebarOpen(true)} isMobile={isMobile} logo={FLEXIT_LOGO}
        session={session}
        onLogin={async (em, pw) => { const s = await login(em, pw); setSession(s); return s; }}
        onLogout={() => { logout(); setSession(null); }} />}

      {seccion === "colectas" && <Suspense fallback={<VistaSkeleton />}><Colectas /></Suspense>}

      {seccion === "arribos" && <Suspense fallback={<VistaSkeleton />}><Colectas soloArribos /></Suspense>}

      {seccion === "tiquetera" && <Suspense fallback={<VistaSkeleton />}><Tiquetera /></Suspense>}

      {seccion === "pagos" && <Suspense fallback={<VistaSkeleton />}><Pagos /></Suspense>}

      {seccion === "metricas" && (<>
      {error && <div style={{ background:"rgba(226,75,74,0.15)", color:"#E24B4A", border:"1px solid rgba(226,75,74,0.3)", padding:"10px 14px", borderRadius:8, fontSize:13, marginBottom:"1rem" }}>{error}</div>}



      {/* Filtros semana y dia */}
      {semanas.length > 0 && (
        <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:10, padding:"10px 16px", marginBottom:"1rem" }}>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ position:"relative" }} ref={historialRef}>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <span style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Semana:</span>
                <button onClick={()=>setShowHistorial(h=>!h)} style={{ padding:"3px 14px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${showHistorial?"rgba(46,207,170,0.8)":"#2ECFAA"}`, background:"rgba(46,207,170,0.15)", color:"#2ECFAA", display:"flex", alignItems:"center", gap:6 }}>
                  {semanaActiva || "—"}
                  <span style={{ fontSize:10, opacity:0.7 }}>{showHistorial ? "▲" : "▼"}</span>
                </button>
              </div>
              {showHistorial && (() => {
                const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                const mesesConDatos = {};
                semanas.forEach(s => {
                  const f = s.dias[0]?.fecha || "";
                  if (f) { const k = f.slice(0,7); if (!mesesConDatos[k]) mesesConDatos[k] = []; mesesConDatos[k].push(s); }
                });
                const anios = [...new Set(Object.keys(mesesConDatos).map(k=>k.slice(0,4)))].sort();
                return (
                  <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,background:"#1A1A4A",border:"1px solid rgba(255,255,255,0.15)",borderRadius:12,zIndex:300,padding:12,boxShadow:"0 8px 32px rgba(0,0,0,0.6)",minWidth:240}}>
                    {anios.map(anio=>(
                      <div key={anio}>
                        <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.08em"}}>{anio}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
                          {MESES.map((m,i)=>{
                            const k=`${anio}-${String(i+1).padStart(2,"0")}`;
                            const tiene=!!mesesConDatos[k];
                            const activo=mesActivo===k;
                            return <button key={k} onClick={()=>tiene&&setMesActivo(activo?null:k)} style={{padding:"7px 2px",fontSize:12,fontWeight:600,borderRadius:8,cursor:tiene?"pointer":"default",border:`1px solid ${activo?"#2ECFAA":tiene?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.04)"}`,background:activo?"rgba(46,207,170,0.18)":"transparent",color:activo?"#2ECFAA":tiene?"#fff":"rgba(255,255,255,0.18)"}}>{m.toLowerCase()}.</button>;
                          })}
                        </div>
                        {mesActivo&&mesActivo.startsWith(anio)&&mesesConDatos[mesActivo]&&(
                          <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:8,marginBottom:4}}>
                            {mesesConDatos[mesActivo].map(s=>(
                              <div key={s.label} onClick={()=>{setSemanaActiva(s.label);setCadeteSeleccionado(null);setDiaActivo(null);setShowHistorial(false);setMesActivo(null);}}
                                style={{padding:"7px 10px",fontSize:13,cursor:"pointer",borderRadius:8,color:semanaActiva===s.label?"#2ECFAA":"#fff",background:semanaActiva===s.label?"rgba(46,207,170,0.1)":"transparent",fontWeight:semanaActiva===s.label?600:400}}>
                                {s.label}{semanaActiva===s.label&&" ✓"}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {semana && semana.dias.length > 0 && (
              <div style={{ display:"flex", gap:6, alignItems:"center", borderLeft:`1px solid ${BRAND.border}`, paddingLeft:16, overflowX:"auto", flexShrink:1, minWidth:0, scrollbarWidth:"none" }}>
                <span style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Día:</span>
                <span style={{ position:"relative", display:"inline-flex", alignItems:"center", flexShrink:0 }}>
                <select value={diaActivo || ""} onChange={e=>setDiaActivo(e.target.value || null)}
                  style={{ appearance:"none", WebkitAppearance:"none", MozAppearance:"none", padding:"4px 24px 4px 10px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:"1px solid #2ECFAA", background:"rgba(46,207,170,0.15)", color:"#2ECFAA", outline:"none" }}>
                  <option value="" style={{background:"#141a2e",color:"#fff"}}>Todos los días</option>
                  {semana.dias.map(d => {
                    const p = d.fecha.split("-");
                    const nombres=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
                    const dia=nombres[new Date(d.fecha+"T12:00:00").getDay()];
                    return <option key={d.fecha} value={d.fecha} style={{background:"#141a2e",color:"#fff"}}>{dia} {p[2]}/{p[1]}</option>;
                  })}
                </select>
                <span style={{ position:"absolute", right:11, pointerEvents:"none", color:"#2ECFAA", fontSize:9 }}>▼</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {acumulado.length === 0 ? (
        <div style={{ textAlign:"center", padding:"5rem 2rem", color:BRAND.muted }}>
          <i className="ti ti-truck-delivery" style={{ fontSize:56, display:"block", marginBottom:16, color:"#2ECFAA", opacity:0.3 }} />
          <div style={{ fontSize:18, fontWeight:600, color:BRAND.white, marginBottom:8 }}>Sin datos todavía</div>
          <div style={{ fontSize:14 }}>Subí el Excel de LightData para comenzar</div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          {isMobile ? (
            <>
              {/* SLA Meli — card grande featured en mobile */}
              {(() => {
                const slaColor = slaPromedio !== null && slaPromedio >= 98 ? "#2ECFAA" : slaPromedio !== null && slaPromedio >= 95 ? "#EF9F27" : "#E24B4A";
                const circ = 2 * Math.PI * 30;
                const offset = slaPromedio !== null ? circ - (slaPromedio / 100) * circ : circ;
                const sem = getSemaforo(slaPromedio);
                const okLabel = sem.label === "OK" ? "Objetivo cumplido ✓" : sem.label === "RIESGO" ? "En riesgo ⚠️" : sem.label === "CRÍTICO" ? "Crítico 🔴" : "Sin datos";
                return (
                  <div style={{ ...card, display:"flex", alignItems:"center", gap:16, marginBottom:8, background:sem.bg, border:`1px solid ${slaColor}44` }}>
                    <div style={{ position:"relative", width:74, height:74, flexShrink:0 }}>
                      <svg width="74" height="74" style={{ transform:"rotate(-90deg)" }}>
                        <circle cx="37" cy="37" r="30" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7"/>
                        <circle cx="37" cy="37" r="30" fill="none" stroke={slaColor} strokeWidth="7"
                          strokeDasharray={circ} strokeDashoffset={offset}
                          strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.6s ease" }}/>
                      </svg>
                      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ fontSize:17, fontWeight:800, color:slaColor }}>{slaPromedio !== null ? slaPromedio.toFixed(1)+"%" : "—"}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>SLA Meli</div>
                      <div style={{ fontSize:12, color:BRAND.muted, marginBottom:6 }}>Métrica principal · Mercado Libre</div>
                      <div style={{ fontSize:12, fontWeight:600, color:slaColor }}>{okLabel}</div>
                    </div>
                  </div>
                );
              })()}
              {/* Resto KPIs en 2 columnas */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:"1.5rem" }}>
                <TooltipKpi label="Total envíos" val={totalEnvios} color={BRAND.white} icon="ti-package"
                  tooltip={{ml:totalML, particular:totalParticular, totalEnvios}} />
                <TooltipKpi label="Entregados" val={totalEntregados} color="#2ECFAA" icon="ti-circle-check" />
                <TooltipKpi label="Pendientes" val={totalPendientes} color="#3A8FD4" icon="ti-clock" />
                <TooltipKpi label="Demorados" val={totalDemorados} color="#E24B4A" icon="ti-alert-circle" tooltipDem={{demML: totalDemDia, dem21: totalDem21}} />
                <TooltipKpi label="SLA Flexit" val={slaFlexit !== null ? slaFlexit+"%" : "—"} color={slaFlexit !== null && slaFlexit >= 95 ? "#2ECFAA" : slaFlexit !== null && slaFlexit >= 90 ? "#EF9F27" : "#E24B4A"} icon="ti-chart-dots" />
                <TooltipKpi label="Cadetes" val={acumulado.length} color={BRAND.muted} icon="ti-users" />
              </div>
            </>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:"1.5rem" }}>
              <TooltipKpi label="Total envíos" val={totalEnvios} color={BRAND.white} icon="ti-package"
                tooltip={{ml:totalML, particular:totalParticular, totalEnvios}} />
              <TooltipKpi label="Entregados" val={totalEntregados} color="#2ECFAA" icon="ti-circle-check" />
              {(() => {
                const slaColor = slaPromedio !== null && slaPromedio >= 98 ? "#2ECFAA" : slaPromedio !== null && slaPromedio >= 95 ? "#EF9F27" : "#E24B4A";
                const circ = 2 * Math.PI * 28;
                const offset = slaPromedio !== null ? circ - (slaPromedio / 100) * circ : circ;
                return (
                  <div style={{ ...card, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:"0.9rem 0.5rem" }}>
                    <div style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>SLA Meli</div>
                    <div style={{ position:"relative", width:62, height:62 }}>
                      <svg width="62" height="62" style={{ transform:"rotate(-90deg)" }}>
                        <circle cx="31" cy="31" r="28" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7"/>
                        <circle cx="31" cy="31" r="28" fill="none" stroke={slaColor} strokeWidth="7"
                          strokeDasharray={circ} strokeDashoffset={offset}
                          strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.6s ease" }}/>
                      </svg>
                      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ fontSize:13, fontWeight:800, color:slaColor }}>{slaPromedio !== null ? slaPromedio.toFixed(1)+"%" : "—"}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <TooltipKpi label="Pendientes" val={totalPendientes} color="#3A8FD4" icon="ti-clock" />
              <TooltipKpi label="Demorados" val={totalDemorados} color="#E24B4A" icon="ti-alert-circle" tooltipDem={{demML: totalDemDia, dem21: totalDem21}} />
              <TooltipKpi label="SLA Flexit" val={slaFlexit !== null ? slaFlexit+"%" : "—"} color={slaFlexit !== null && slaFlexit >= 95 ? "#2ECFAA" : slaFlexit !== null && slaFlexit >= 90 ? "#EF9F27" : "#E24B4A"} icon="ti-chart-dots" />
              <TooltipKpi label="Cadetes" val={acumulado.length} color={BRAND.muted} icon="ti-users" />
            </div>
          )}

          {criticos > 0 && (
            <div style={{ background:"rgba(226,75,74,0.1)", border:"1px solid rgba(226,75,74,0.3)", borderRadius:10, padding:"10px 16px", marginBottom:"1rem", fontSize:13, color:"#E24B4A" }}>
              <i className="ti ti-alert-circle" style={{ marginRight:8 }} />
              <strong>{criticos} cadete{criticos>1?"s":""} con SLA crítico</strong> — por debajo del 95%. Requieren atención inmediata.
            </div>
          )}

          <SinDatosBadge items={sinDatosItems} />


          {/* Tabs + exportar — solo desktop */}
          {!isMobile && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${BRAND.border}`, marginBottom:"1.5rem" }}>
            <div style={{ display:"flex", gap:4 }}>
              {[["tabla","ti-table","Tabla"],["ranking","ti-gauge","Semáforo"],["deepdive","ti-calendar-stats","Mensual"]].map(([key,icon,label]) => (
                <button key={key} onClick={()=>setTab(key)} style={{ padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer", border:"none", background:"none", marginBottom:-1, color:tab===key?"#2ECFAA":BRAND.muted, borderBottom:`2px solid ${tab===key?"#2ECFAA":"transparent"}` }}>
                  <i className={`ti ${icon}`} style={{ marginRight:6, fontSize:14 }} />{label}
                </button>
              ))}
            </div>
            {xlsxReady && (
              <button onClick={()=>exportarExcel(acumulado,semanaActiva,diasLabels)}
                style={{ padding:"6px 14px", fontSize:12, fontWeight:600, border:"1px solid #2ECFAA", borderRadius:8, cursor:"pointer", background:"rgba(46,207,170,0.1)", color:"#2ECFAA", display:"flex", alignItems:"center", gap:6 }}>
                <i className="ti ti-file-spreadsheet" style={{ fontSize:15 }} /> Exportar Excel
              </button>
            )}
          </div>
          )}
          {/* Bottom nav — solo mobile */}
          {isMobile && (
            <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#0D0D2B", borderTop:`1px solid ${BRAND.border}`, display:"flex", alignItems:"stretch", zIndex:100, paddingBottom:"env(safe-area-inset-bottom)" }}>
              {[["tabla","ti-table","Tabla"],["ranking","ti-gauge","Semáforo"],["deepdive","ti-calendar-stats","Mensual"]].map(([key,icon,label]) => (
                <button key={key} onClick={()=>setTab(key)} style={{ flex:1, padding:"10px 4px 8px", fontSize:10, fontWeight:600, cursor:"pointer", border:"none", background:"none", color:tab===key?"#2ECFAA":BRAND.muted, display:"flex", flexDirection:"column", alignItems:"center", gap:3, borderTop:`2px solid ${tab===key?"#2ECFAA":"transparent"}` }}>
                  <i className={`ti ${icon}`} style={{ fontSize:20 }} />
                  {label}
                </button>
              ))}
              {xlsxReady && (
                <button onClick={()=>exportarExcel(acumulado,semanaActiva,diasLabels)} style={{ flex:1, padding:"10px 4px 8px", fontSize:10, fontWeight:600, cursor:"pointer", border:"none", background:"none", color:BRAND.muted, display:"flex", flexDirection:"column", alignItems:"center", gap:3, borderTop:"2px solid transparent" }}>
                  <i className="ti ti-file-spreadsheet" style={{ fontSize:20 }} />
                  Excel
                </button>
              )}
            </div>
          )}

          {/* RANKING */}
          {tab==="ranking" && (
            <div style={{ display:"flex", flexDirection:"column", gap:"1.5rem" }}>
              <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                <div style={{ fontSize:18, fontWeight:700, color:BRAND.white }}>⚠️ Semáforo de Cadetes</div>
                <div style={{ display:"flex", gap:6 }}>
                  {[["semana","Esta semana"],["mes","Mes completo"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setRankingVista(v)} style={btn(rankingVista===v)}>{l}</button>
                  ))}
                </div>
              </div>
              {rankingData.length === 0 ? (
                <div style={{ ...card, textAlign:"center", padding:"2.5rem", color:BRAND.muted }}>
                  <i className="ti ti-gauge" style={{ fontSize:36, display:"block", marginBottom:10, opacity:0.3 }} />
                  Sin datos suficientes para el semáforo
                </div>
              ) : (
                <>
                  <div style={card}>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      {rankingData.map((m, i) => {
                        const sem = getSemaforo(m.slaMeli);
                        const medal = `${i+1}`;
                        const isSelected = cadeteSeleccionado === m.cadete;
                        const mesSla = mesSlaMap[m.cadete];
                        const delta = (rankingVista === "semana" && mesSla !== undefined && m.slaMeli !== null) ? +(m.slaMeli - mesSla).toFixed(1) : null;
                        const trend = delta === null ? null : delta > 1 ? "↑" : delta < -1 ? "↓" : "→";
                        const trendColor = trend === "↑" ? "#2ECFAA" : trend === "↓" ? "#E24B4A" : BRAND.muted;
                        return (
                          <div key={m.cadete} onClick={()=>setCadeteSeleccionado(isSelected?null:m.cadete)}
                            style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:10, cursor:"pointer",
                              background:isSelected?"rgba(46,207,170,0.1)":i%2===0?"rgba(255,255,255,0.02)":"transparent",
                              border:`1px solid ${isSelected?BRAND.teal:"transparent"}`,
                            }}
                          >
                            <div style={{ width:30, textAlign:"center", fontSize:i<3?18:13, fontWeight:600, color:BRAND.muted, flexShrink:0 }}>{medal}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:14, fontWeight:600, color:BRAND.white }}>{m.cadete}</div>
                              <div style={{ fontSize:11, color:BRAND.muted, marginTop:3, display:"flex", gap:10, flexWrap:"wrap" }}>
                                <span>📦 {m.cantidad} envíos</span>
                                <span>✅ {m.cantidad - m.pendientes} entregados</span>
                                <span style={{ color: m.demorados + (m.dem21||0) > 0 ? "#E24B4A" : BRAND.muted }}>🔴 {m.demorados + (m.dem21||0)} dem.</span>
                                {(m.post21||0) > 0 && <span>🌙 {m.post21} post-21hs</span>}
                                <span>🚚 {m.envios_ml} ML</span>
                              </div>
                            </div>
                            {trend && (
                              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0, width:48, marginRight:4 }}>
                                <div style={{ fontSize:20, color:trendColor, fontWeight:700, lineHeight:1 }}>{trend}</div>
                                <div style={{ fontSize:10, color:trendColor, fontWeight:600 }}>{delta > 0 ? "+" : ""}{delta}%</div>
                                <div style={{ fontSize:9, color:BRAND.muted, opacity:0.7 }}>vs mes</div>
                              </div>
                            )}
                            <div style={{ background:sem.bg, color:sem.color, borderRadius:8, padding:"5px 14px", fontSize:14, fontWeight:700, flexShrink:0, textAlign:"center", minWidth:72 }}>
                              {m.slaMeli !== null ? m.slaMeli.toFixed(1)+"%" : "—"}
                              <div style={{ fontSize:9, fontWeight:500, marginTop:1, opacity:0.8 }}>{sem.label}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {cadeteSeleccionado && tendencia.length > 0 && (
                    <div style={card}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Evolución SLA Meli</div>
                          <div style={{ fontSize:16, fontWeight:700, color:BRAND.white, marginTop:2 }}>{cadeteSeleccionado}</div>
                        </div>
                        <button onClick={()=>setCadeteSeleccionado(null)} style={{ background:BRAND.faint, border:`1px solid ${BRAND.border}`, borderRadius:8, padding:"4px 12px", fontSize:12, color:BRAND.muted, cursor:"pointer" }}>
                          Cerrar
                        </button>
                      </div>
                      <div style={{ height:220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={tendencia} margin={{ left:0, right:20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
                            <XAxis dataKey="fecha" tick={{ fontSize:11, fill:BRAND.muted }} tickFormatter={v=>{ const p=v.split("-"); return `${p[2]}/${p[1]}`; }} />
                            <YAxis domain={[0,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} />
                            <Tooltip contentStyle={ttStyle} formatter={v=>[v!==null?v.toFixed(1)+"%":"—","SLA Meli"]} labelFormatter={v=>{ const p=v.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; }} />
                            <Line type="monotone" dataKey="sla" stroke="#2ECFAA" strokeWidth={2.5} dot={{ fill:"#2ECFAA", r:5 }} activeDot={{ r:7 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                  <div style={card}>
                    <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, marginBottom:"1rem", textTransform:"uppercase", letterSpacing:"0.06em" }}>Peores cadetes — SLA Meli</div>
                    <div style={{ height:Math.max(260, comparativa.length*30) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparativa} layout="vertical" margin={{ left:10, right:60 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={BRAND.border} />
                          <XAxis type="number" domain={[0,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize:10, fill:BRAND.muted }} width={120} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={ttStyle} formatter={v=>[v.toFixed(1)+"%","SLA Meli"]} />
                          <Bar dataKey="sla" radius={[0,4,4,0]} label={{ position:"right", formatter:v=>v.toFixed(0)+"%", fontSize:11, fill:BRAND.muted }}>
                            {comparativa.map((e,i)=><Cell key={i} fill={e.color} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginTop:12 }}>
                      {[["#2ECFAA","OK (≥98%)"],["#EF9F27","En riesgo (95–98%)"],["#E24B4A","Crítico (<95%)"]].map(([c,l])=>(
                        <span key={l} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:BRAND.muted }}>
                          <span style={{ width:10, height:10, borderRadius:2, background:c, display:"inline-block" }} />{l}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TABLA */}
          {tab==="deepdive" && (
            <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
              {diasDelMes.length === 0 ? (
                <div style={{ textAlign:"center", padding:"3rem", color:BRAND.muted }}>
                  <i className="ti ti-calendar-stats" style={{ fontSize:40, display:"block", marginBottom:12, opacity:0.3 }} />
                  <div style={{ fontSize:16, fontWeight:500, color:BRAND.white, marginBottom:8 }}>Sin datos del mes todavía</div>
                  <div style={{ fontSize:13 }}>Subí los Excel del mes para ver el reporte acumulado</div>
                </div>
              ) : (
                <>
                  {/* Header mes */}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                    <div>
                      <div style={{ fontSize:16, fontWeight:500, color:BRAND.white }}>Reporte mensual acumulado</div>
                      <div style={{ fontSize:12, color:BRAND.muted, marginTop:2 }}>{diasDelMes.length} días cargados · {diasDelMes[0]?.fecha.split("-").reverse().join("/")} al {diasDelMes[diasDelMes.length-1]?.fecha.split("-").reverse().join("/")}</div>
                    </div>
                    {mesesDisponibles.length > 0 && (
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {mesesDisponibles.map(m => {
                          const [yr, mo] = m.split("-");
                          const nombres = ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
                          const label = nombres[parseInt(mo)] + " " + yr.slice(2);
                          return (
                            <button key={m} onClick={()=>setMesFiltro(m)} style={btn(m === mesFiltroActivo)}>{label}</button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* KPIs mes */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
                    <TooltipKpi label="Total envíos" val={totalEnviosMes.toLocaleString("es-AR")} color={BRAND.white} icon="ti-package"
                      tooltip={{ ml: totalMLMes, particular: totalParticularMes, totalEnvios: totalEnviosMes }} />
                    {[
                      ["Demorados", totalDemoradosMes, "#E24B4A", "ti-alert-circle"],
                      ["SLA Meli", slaPromedioMes !== null ? slaPromedioMes.toFixed(1)+"%" : "—", slaPromedioMes !== null && slaPromedioMes >= 98 ? "#2ECFAA" : slaPromedioMes !== null && slaPromedioMes >= 95 ? "#EF9F27" : "#E24B4A", "ti-chart-bar"],
                      ["Críticos", criticosMes.length, "#E24B4A", "ti-users"],
                      ["OK ≥98%", okMes.length, "#2ECFAA", "ti-circle-check"],
                      ["Reincidentes", reincidentes.length, "#EF9F27", "ti-repeat"],
                    ].map(([label,val,color,icon]) => (
                      <div key={label} style={{ ...card, padding:"1rem" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                          <div style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.04em" }}>{label}</div>
                          <i className={`ti ${icon}`} style={{ fontSize:16, color, opacity:0.7 }} />
                        </div>
                        <div style={{ fontSize:26, fontWeight:500, color }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Gráfico SLA diario */}
                  {slaPorDia.length > 1 && (
                    <div style={card}>
                      <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, marginBottom:"1rem", textTransform:"uppercase", letterSpacing:"0.06em" }}>Evolución SLA diario del mes</div>
                      <div style={{ height:180 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={slaPorDia} margin={{ left:0, right:20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
                            <XAxis dataKey="fecha" tick={{ fontSize:11, fill:BRAND.muted }} />
                            <YAxis domain={[85,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} />
                            <Tooltip contentStyle={{ background:"#1A1A4A", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, fontSize:12, color:"#fff" }} formatter={v=>[v+"%","SLA"]} />
                            <Line type="monotone" dataKey="sla" stroke="#2ECFAA" strokeWidth={2.5} dot={{ fill:"#2ECFAA", r:4 }} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}


                  {/* Reincidentes */}
                  {reincidentes.length > 0 && (
                    <div style={card}>
                      <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, marginBottom:"1rem", textTransform:"uppercase", letterSpacing:"0.06em" }}>Reincidentes — demoras 3+ días <i className="ti ti-repeat" style={{ fontSize:13, color:"#EF9F27" }} /></div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 }}>
                        {reincidentes.map(m => (
                          <div key={m.cadete} style={{ background:"rgba(226,75,74,0.08)", border:"1px solid rgba(226,75,74,0.2)", borderRadius:8, padding:"10px 14px" }}>
                            <div style={{ fontSize:13, fontWeight:500, color:BRAND.white }}>{m.cadete}</div>
                            <div style={{ fontSize:11, color:BRAND.muted, marginTop:2 }}>{m.dias_con_demora} días con demoras</div>
                            <div style={{ fontSize:20, fontWeight:500, color:"#E24B4A", marginTop:4 }}>{m.demorados} dem.</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sin asignar del mes */}
                  {mesData.find(m => m.cadete.includes("Sin asignar")) && (
                    <div style={{ background:"rgba(226,75,74,0.1)", border:"1px solid rgba(226,75,74,0.3)", borderRadius:10, padding:"10px 16px", fontSize:13, color:"#E24B4A" }}>
                      <i className="ti ti-alert-circle" style={{ marginRight:8 }} />
                      <strong>{mesData.find(m=>m.cadete.includes("Sin asignar"))?.cantidad} envíos sin cadete asignado</strong> en el mes — revisar asignación
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab==="tabla" && (
            <>

              <div style={{ display:"flex", gap:8, marginBottom:"1rem", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[["todos","Todos",null],["critico","Críticos <95%","#E24B4A"],["riesgo","En riesgo 95-98%","#EF9F27"],["ok","OK ≥98%","#2ECFAA"]].map(([key,label,color]) => (
                    <button key={key} onClick={()=>setFiltro(key)} title={label}
                      style={{ display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:600, cursor:"pointer", border:`1px solid ${filtro===key?"#2ECFAA":BRAND.border}`, background:filtro===key?"rgba(46,207,170,0.15)":BRAND.faint, color:filtro===key?"#2ECFAA":BRAND.muted, ...(color ? { width:32, height:32, borderRadius:"50%", padding:0 } : { padding:"5px 14px", borderRadius:20 }) }}>
                      {color ? <span style={{ width:13, height:13, borderRadius:"50%", background:color, display:"block" }} /> : label}
                    </button>
                  ))}
                </div>
                {diaActivo && (
                  <button onClick={()=>setShowRuteo(r=>!r)} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 20px", fontSize:14, fontWeight:600, borderRadius:20, cursor:"pointer", border:`2px solid ${showRuteo?"#2ECFAA":BRAND.border}`, background:showRuteo?"rgba(46,207,170,0.15)":BRAND.faint, color:showRuteo?"#2ECFAA":BRAND.muted, flexShrink:0 }}>
                    🗺️ {showRuteo ? "Ocultar ruteo" : "Ver ruteo"}
                  </button>
                )}
              </div>

              <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                <div style={{ flex:1, overflowX:"auto", borderRadius:12, border:`1px solid ${BRAND.border}` }}>
                <table style={{ width:"100%", borderCollapse:"collapse", minWidth:620 }}>
                  <thead>
                    <tr style={{ background:BRAND.navyMid }}>
                      <th style={{ padding:"10px 14px", width:30, borderBottom:`1px solid ${BRAND.border}` }}></th>
                      {[["Cadete","cadete",null],["Total","cantidad",null],["Entregados","entregados",null],["Pendientes","pendientes",null],["Demorados ML","demorados","Envío sin visitar al final del día"],["Repro 21hs","dem21","Visita post 21hs, reprogramado por ML"],["Post 21hs","post21","Entregado después de las 21hs"],["% Entrega","pctEntrega",null],["SLA Meli","slaMeli",null]].map(([label,col,tip])=>(
                        <ThHeader key={col} label={label} col={col} tip={tip} sortCol={sortCol} sortDir={sortDir} toggleSort={toggleSort} />
                      ))}

                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((m,i)=>{
                      const sem = getSemaforo(m.slaMeli);
                      return (
                        <tr key={m.cadete} onMouseEnter={()=>setHoveredRow(i)} onMouseLeave={()=>setHoveredRow(null)} style={{ background:hoveredRow===i?"rgba(46,207,170,0.12)":i%2===0?BRAND.navyCard:BRAND.navy, borderLeft:`3px solid ${sem.color}`, height:44, transition:"background 0.1s" }}>
                          <td style={{ padding:"10px 14px", width:30, borderBottom:`1px solid ${BRAND.border}` }}>
                            <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:sem.color }} />
                          </td>
                          <td style={{ padding:"10px 14px", fontSize:13, fontWeight:500, color:BRAND.white, borderBottom:`1px solid ${BRAND.border}` }}>{m.cadete}</td>
                          <td style={{ padding:"10px 14px", fontSize:13, color:BRAND.white, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.cantidad}</td>
                          <td style={{ padding:"10px 14px", fontSize:13, color:"#2ECFAA", borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.cantidad-m.pendientes}</td>
                          <td style={{ padding:"10px 14px", fontSize:13, color:m.pendientes>0?"#3A8FD4":BRAND.muted, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.pendientes}</td>
                          <td style={{ padding:"10px 14px", fontSize:13, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}><DemoradosPopover count={m.demorados} detalle={m.demoradosDetalle} cadete={m.cadete} /></td>
                          <td style={{ padding:"10px 14px", fontSize:13, color:(m.dem21||0)>0?"#E24B4A":BRAND.muted, fontWeight:(m.dem21||0)>0?700:400, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.dem21||0}</td>
                          <td style={{ padding:"10px 14px", fontSize:13, color:(m.post21||0)>0?"#EF9F27":BRAND.muted, fontWeight:(m.post21||0)>0?600:400, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.post21||0}</td>

                          <td style={{ padding:"10px 14px", fontSize:13, color:BRAND.muted, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.pctEntrega.toFixed(1)}%</td>
                          <td style={{ padding:"10px 14px", fontSize:13, fontWeight:700, color:sem.color, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.slaMeli!==null?m.slaMeli.toFixed(1)+"%":"—"}</td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Tabla Ruteo al lado */}
              {showRuteo && diaActivo && (
                <div style={{ borderRadius:12, border:`1px solid rgba(46,207,170,0.3)`, background:"rgba(46,207,170,0.03)", flexShrink:0 }}>
                  <table style={{ borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"rgba(46,207,170,0.08)" }}>
                        {["Inicio","Fin","Dur."].map(h=>(
                          <th key={h} style={{ padding:"10px 12px", fontSize:11, fontWeight:600, color:"#2ECFAA", textAlign:"right", borderBottom:`1px solid rgba(46,207,170,0.2)`, textTransform:"uppercase", letterSpacing:"0.05em", whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtrados.map((m,i)=>{
                        const toMin = t => { const [h,min] = t.split(':').map(Number); return h*60+min; };
                        const diff = m.inicio_ruta && m.fin_ruta ? toMin(m.fin_ruta) - toMin(m.inicio_ruta) : 0;
                        const durColor = m.fin_ruta>="21:00"?"#E24B4A":m.fin_ruta>="20:00"?"#EF9F27":"#2ECFAA";
                        const durBg = m.fin_ruta>="21:00"?"rgba(226,75,74,0.15)":m.fin_ruta>="20:00"?"rgba(239,159,39,0.15)":"rgba(46,207,170,0.15)";
                        return (
                          <tr key={m.cadete} onMouseEnter={()=>setHoveredRow(i)} onMouseLeave={()=>setHoveredRow(null)} style={{ borderBottom:`1px solid rgba(46,207,170,0.1)`, height:44, background:hoveredRow===i?"rgba(46,207,170,0.15)":"transparent", transition:"background 0.1s" }}>
                            <td style={{ padding:"10px 12px", fontSize:13, color:BRAND.muted, textAlign:"right" }}>{m.inicio_ruta?m.inicio_ruta.slice(0,5):"—"}</td>
                            <td style={{ padding:"10px 12px", fontSize:13, color:m.fin_ruta&&m.fin_ruta>="21:00"?"#E24B4A":BRAND.muted, fontWeight:m.fin_ruta&&m.fin_ruta>="21:00"?600:400, textAlign:"right" }}>{m.fin_ruta?m.fin_ruta.slice(0,5):"—"}</td>
                            <td style={{ padding:"10px 12px", textAlign:"right" }}>
                              {diff>0?<span style={{ display:"inline-block", padding:"2px 8px", borderRadius:12, fontSize:12, fontWeight:600, color:durColor, background:durBg }}>{Math.floor(diff/60)}h {diff%60}m</span>:<span style={{color:BRAND.muted}}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </>
          )}
        </>
      )}
      </>)}
    </div>
  );
}
