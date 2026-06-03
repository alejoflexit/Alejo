import React, { useState, useCallback, useRef, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2bGFnb29zbXh4Y3NiZXZrcmh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTE1ODMsImV4cCI6MjA5NDg4NzU4M30.h0cyc0TI8yEZSny-udR2-5tzihd5jvJRTiFEbkCnVng";

const ML_LOGO = "data:image/webp;base64,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";
const FLEXIT_LOGO = "data:image/jpeg;base64,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zzzzzyrzzzzzzzyn777777774TwyoH333330k7Dzzzzzzybzzzzzzzzyj777777755nxih3333331oPzzzzzzxbzzzzzzzzzzTf77777753CyYvz33333wbHzzzzzxbzzzzzzzzzwlb77777766XiyxHX33330njDzzzzxbzzzzzzzzzzyzL777777C2XwmpX3332way7zzzzxbzzzzzzzzzzzyT/wC+++sYh7x87K1998m/hIY8888C888888888888Mj+++/XBBxLw8EB19p0xB5Kw888W8888888888888tX++O5BBBk58dAQ0FRBBBwEw88X88888888888888Z2gRBBBBBNR8IJERBBBBBoJ88V888888888888888u9BBBBBBxi88O/BBBBBBRX88A88888888888888gCXBBBBBB9B80/ItBBBBB5588A8888888888888w7Ne9JBBB4wM4c++aFBBBNWs88A8888888888884Vtc8T5JBR6t8wf++/8ACQQbbfPPAPPPPPPPPPPPPL41fffETQTLPNRvvvvidQWAfPPPFPPPPPPPPPPPJSBPfffTFPAHOH/vvvvvNvETfPPPFPPPPPPPPPPOJzHffffbGxjfHP8A777777/I3zzzzxTzzzzzzzzzzsH333333zL3zQ77777776qDzzzzzwHzzzzzzzzyQs333333wffzWf7777777uEzzzzzzwjzzzzzzzzC8T333332G63xB777777774zzzzzzzw3zzzzzzzg2Tz333331q3zj77777777+3zzzzzzzz3zzzzzzymrT33333icjzGf7777777JnzzzzzzzzznzzzzzzhETzzzzzySkzwr77777775YzzzzzzzzzynzzzzzzmwHDDDHCAK3zw3LLLLPPPc3zzzzzzzzzz3zzzzzzz0zG0+G8e3zzx00333zz03zzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzjzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzjzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyj/2gAMAwEAAgADAAAAEPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOfPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPE/PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPAvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPB/PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPBfPPPPPOCPPPPPPPPPPONfsMPMMP8PPPPPPPPPPPFPPPPPPLEUoss088bvPPI1WLTDnDEJPPPPPPPPPPAPPPPPPKEQQQQQQQcXfPKvvv/wD/APuNbw888888888B888888osNBBBBBBBXJsCq3//AP8A/wDvl2888888888U8888888YCMBBBBBBwg04AA//AP8A/wD/ADtWfPPPPPPPF/PPPPPPLNfjAQQQQQYqLKBYv/8A/wD/APyqdPPPPPPPCvPPPPPPPLMNgQQQQQQR4LF1n/8A/wD/AP8A8gHzzzzzzirzzzzzzzzygQAEEEEEEF2TwoL7/wD/AP8A/wCQI88888oC888888888slvMBBBBBAwC0IlS3//AP8A/wDLbk8888oW8888888888s56BBBBBBCk+sVsX//AP8A+9nOHzzzyhbzzzzzzzzzzyjgUEEEETR7smzCvf8A/wD5MHmJ/PPKAfPPPPPPPPPPLKIxQQSRvvv6dKAwt/7NzvhndPPKPPPPPPPPPPPPPLMbyCJZ/vvqg7AbEd2H/vvru/PKPfPPPPPPPPPPPPLEeh3/AL777626xcVz777777h/yj/zzzzzzzzzzzzzyhQ/777777+Hyi6/7777764LyirzzzzzzzzzzzzzhOuf777775z3ih6pj77774kvyirzzzzzzzzzzzziww58zb775gbywTDRrr777N3zyj7zzzzzzzzzzzywax77UPb6663gHsEGM3b77ADzyj7zzzzzzzzzzzgjFf8A/wDpu/uWuBN4AQQUAvubvPPKLvPPPPPPPPPOEWxv/wD/APcydCskfwBBBBCdNyN888oX8888888888sztf8A/wD/APudbB4hwBBBBBBh5h8888oX8888888884Go/wD/AP8A/wD/AK7DgAMEEEEEEESXzzzzygDzzzzzzzzhFs//AP8A/wD/AOn04BuhBBBBBANF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";

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
        _clienteTokens[String(r.codigo).replace(/^0+/, '')] = r.token; // sin ceros adelante
        _clienteTokens[String(r.codigo).padStart(4, '0')] = r.token; // con ceros adelante
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
    if (!token) return true; // Sin token, asumimos demora real
    
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
      // Solo cuenta si fue antes de las 21hs
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
  muted:   "rgba(255,255,255,0.5)",
  faint:   "rgba(255,255,255,0.08)",
  border:  "rgba(255,255,255,0.1)",
};

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
  const rows = await supabaseFetch("semanas?select=id,label,fecha,cadete,cantidad,pendientes,demorados,envios_ml,post21,dem21,envios_particular,inicio_ruta,fin_ruta&order=fecha.asc");
  const map = {};
  for (const r of rows) {
    if (!map[r.label]) map[r.label] = { label: r.label, dias: {} };
    if (!map[r.label].dias[r.fecha]) map[r.label].dias[r.fecha] = [];
    map[r.label].dias[r.fecha].push({
      cadete: r.cadete, cantidad: r.cantidad, pendientes: r.pendientes,
      demorados: r.demorados, envios_ml: r.envios_ml, post21: r.post21||0, dem21: r.dem21||0, envios_particular: r.envios_particular||0, inicio_ruta: r.inicio_ruta||null, fin_ruta: r.fin_ruta||null, fecha: r.fecha,
    });
  }
  return Object.values(map).map(s => ({
    label: s.label,
    dias: Object.entries(s.dias).map(([fecha, datos]) => {
      const enriched = datos.map(m => {
        const pct = m.cantidad > 0 ? (m.cantidad - m.pendientes) / m.cantidad * 100 : 0;
        const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados) / m.envios_ml * 100 : null;
        return { ...m, pctEntrega: +pct.toFixed(2), slaMeli: sla !== null ? +sla.toFixed(2) : null, evaluacion: evaluar(m.demorados, sla) };
      });
      return { fecha, datos: enriched };
    }).sort((a, b) => a.fecha.localeCompare(b.fecha)),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

async function guardarEnSupabase(datos, fecha, weekLabel) {
  // Delete existing rows for this date
  await supabaseFetch(`semanas?fecha=eq.${fecha}&label=eq.${encodeURIComponent(weekLabel)}`, { method: "DELETE" });
  // Insert new rows
  const rows = datos.map(m => ({
    label: weekLabel, fecha, cadete: m.cadete,
    cantidad: m.cantidad, pendientes: m.pendientes,
    demorados: m.demorados, envios_ml: m.envios_ml, post21: m.post21 || 0, dem21: m.dem21 || 0, envios_particular: m.envios_particular || 0, inicio_ruta: m.inicio_ruta || null, fin_ruta: m.fin_ruta || null,
  }));
  await supabaseFetch("semanas", { method: "POST", body: JSON.stringify(rows) });
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
    const esDemorado = esML && (esEnPlanta || ((esEnCamino || esReproML) && !noEsDemora.has(idInterno)));
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
    if (!map[cadete]) map[cadete] = { cadete, cantidad: 0, pendientes: 0, demorados: 0, envios_ml: 0, post21: 0, dem21: 0, envios_particular: 0, inicio_ruta: null, fin_ruta: null };
    map[cadete].cantidad++;
    if (esPendiente) map[cadete].pendientes++;
    if (esDemorado)  map[cadete].demorados++;
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
    const esRepro21 = esML && estado === "reprogramado por meli" && fechaEstado.split(" ")[1] && parseInt(fechaEstado.split(" ")[1].split(":")[0]) >= 21;
    if (esRepro21) map[cadete].dem21++;
  }
  return Object.values(map).map(m => {
    const pct = m.cantidad > 0 ? (m.cantidad - m.pendientes) / m.cantidad * 100 : 0;
    const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados) / m.envios_ml * 100 : null;
    const slaReal = m.envios_ml > 0 ? (m.envios_ml - m.demorados - m.dem21) / m.envios_ml * 100 : null;
    return { ...m, pctEntrega: +pct.toFixed(2), slaMeli: slaReal !== null ? +slaReal.toFixed(2) : null, evaluacion: evaluar(m.demorados + m.dem21, slaReal), fecha, post21: m.post21 || 0, dem21: m.dem21 || 0, entregados: m.cantidad - m.pendientes, envios_particular: m.envios_particular || 0, inicio_ruta: m.inicio_ruta || null, fin_ruta: m.fin_ruta || null };
  });
}

function acumularSemana(dias) {
  const map = {};
  for (const dia of dias) {
    for (const m of dia.datos) {
      if (!map[m.cadete]) map[m.cadete] = { cadete: m.cadete, cantidad: 0, pendientes: 0, demorados: 0, envios_ml: 0, post21: 0, dem21: 0, envios_particular: 0, inicio_ruta: null, fin_ruta: null };
      map[m.cadete].cantidad  += m.cantidad;
      map[m.cadete].pendientes+= m.pendientes;
      map[m.cadete].demorados += m.demorados;
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
    return { ...m, pctEntrega: +pct.toFixed(2), slaMeli: slaRealAcum !== null ? +slaRealAcum.toFixed(2) : null, evaluacion: evaluar(m.demorados + m.dem21, slaRealAcum), post21: m.post21 || 0, dem21: m.dem21 || 0, entregados: m.cantidad - m.pendientes, inicio_ruta: m.inicio_ruta || null, fin_ruta: m.fin_ruta || null };
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
  const viernes = new Date(lunes); viernes.setDate(lunes.getDate() + 4);
  const fmt = (x) => `${x.getDate().toString().padStart(2,"0")}/${(x.getMonth()+1).toString().padStart(2,"0")}`;
  return `${fmt(lunes)}-${fmt(viernes)}`;
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

function TooltipKpi({ label, val, color, icon, tooltip }) {
  const [show, setShow] = React.useState(false);
  return (
    <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:10, padding:"1rem", position:"relative" }}
      onMouseEnter={()=>tooltip&&setShow(true)}
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
    </div>
  );
}

export default function App() {
  const xlsxReady = useXLSX();
  const [semanas, setSemanas]     = useState([]);
  const [semanaActiva, setSemanaActiva] = useState(null);
  const [fecha, setFecha]         = useState(() => new Date().toISOString().slice(0,10));
  const [loading, setLoading]     = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadingDB, setLoadingDB] = useState(true);
  const [error, setError]         = useState("");
  const [tab, setTab]             = useState("tabla");
  const [cadeteSeleccionado, setCadeteSeleccionado] = useState(null);
  const [filtro, setFiltro]       = useState("todos");
  const [sortCol, setSortCol]     = useState("slaMeli");
  const [showRuteo, setShowRuteo] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [sortDir, setSortDir]     = useState("asc");
  const [diaActivo, setDiaActivo] = useState(null); // null = semana completa
  const fileRef = useRef();

  // Cargar desde Supabase al inicio
  useEffect(() => {
    cargarDesdeSupabase()
      .then(data => {
        setSemanas(data);
        if (data.length > 0) setSemanaActiva(data[data.length-1].label);
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
        const estado = String(r["Estado"]||"").trim().replace(/^nan$/i, "");
        const idInterno = r["ID (Interno)"];
        const fechaH = String(r["Fecha estado"]||"").trim();
        const horaH = fechaH.split(" ")[1] ? parseInt(fechaH.split(" ")[1].split(":")[0]) : 0;
        const esEnCaminoML = origen === "ML" && estado === "En camino al destinatario";
        const esReproAntes21 = origen === "ML" && estado === "reprogramado por meli" && horaH < 21;
        return (esEnCaminoML || esReproAntes21) && idInterno;
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

  const semana    = semanas.find(s => s.label === semanaActiva);
  const diasDisponibles = semana?.dias || [];
  const acumulado = semana ? (diaActivo ? acumularSemana(semana.dias.filter(d => d.fecha === diaActivo)) : acumularSemana(semana.dias)) : [];
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
  const totalEnvios    = acumulado.reduce((s,m) => s+m.cantidad, 0);
  const totalML        = acumulado.reduce((s,m) => s+m.envios_ml, 0);
  const totalParticular= acumulado.reduce((s,m) => s+(m.envios_particular||0), 0);
  const totalEntregados= acumulado.reduce((s,m) => s+(m.cantidad-m.pendientes), 0);
  const totalPendientes = acumulado.reduce((s,m) => s+m.pendientes, 0);
  const totalDemorados  = acumulado.reduce((s,m) => s+m.demorados+(m.dem21||0), 0);
  const slaFlexit       = totalEnvios > 0 ? +((totalEnvios - totalPendientes) / totalEnvios * 100).toFixed(1) : null;
  const totalMLDia     = acumulado.reduce((s,m) => s+m.envios_ml, 0);
  const totalDemDia    = acumulado.reduce((s,m) => s+m.demorados, 0);
  const slaPromedio    = totalMLDia > 0 ? +((totalMLDia - totalDemDia) / totalMLDia * 100).toFixed(2) : null;

  const tendencia   = cadeteSeleccionado ? tendenciaCadete(cadeteSeleccionado, semanas) : [];

  // Deep Dive mensual - acumula TODOS los datos de todas las semanas del mes activo
  const getMesActivo = () => {
    if (semanas.length === 0) return null;
    const ultima = semanas[semanas.length - 1];
    const partes = ultima.label.split("-")[0].split("/");
    return partes[1]; // mes en formato MM
  };

  const diasDelMes = semanas.flatMap(s => s.dias).sort((a,b) => a.fecha.localeCompare(b.fecha));

  const acumMes = () => {
    const map = {};
    for (const dia of diasDelMes) {
      for (const m of dia.datos) {
        if (!map[m.cadete]) map[m.cadete] = { cadete: m.cadete, cantidad:0, pendientes:0, demorados:0, envios_ml:0, dias_con_demora:0 };
        map[m.cadete].cantidad += m.cantidad;
        map[m.cadete].pendientes += m.pendientes;
        map[m.cadete].demorados += m.demorados;
        map[m.cadete].envios_ml += m.envios_ml;
        if (m.demorados > 0) map[m.cadete].dias_con_demora++;
      }
    }
    return Object.values(map).map(m => {
      const sla = m.envios_ml > 0 ? (m.envios_ml - m.demorados) / m.envios_ml * 100 : null;
      return { ...m, slaMeli: sla !== null ? +sla.toFixed(2) : null };
    }).sort((a,b) => (a.slaMeli ?? 101) - (b.slaMeli ?? 101));
  };

  const mesData = acumMes();
  const totalEnviosMes = mesData.reduce((s,m) => s+m.cantidad, 0);
  const totalDemoradosMes = mesData.reduce((s,m) => s+m.demorados, 0);
  const totalPendientesMes = mesData.reduce((s,m) => s+m.pendientes, 0);
  const slaArrMes = mesData.filter(m => m.slaMeli !== null);
  const totalMLMes = mesData.reduce((s,m) => s+m.envios_ml, 0);
  const totalDemMes = mesData.reduce((s,m) => s+m.demorados, 0);
  const slaPromedioMes = totalMLMes > 0 ? +((totalMLMes - totalDemMes) / totalMLMes * 100).toFixed(2) : null;
  const criticosMes = mesData.filter(m => m.slaMeli !== null && m.slaMeli < 95);
  const okMes = mesData.filter(m => m.slaMeli !== null && m.slaMeli >= 98);
  const reincidentes = mesData.filter(m => m.dias_con_demora >= 3).sort((a,b) => b.dias_con_demora - a.dias_con_demora);

  // SLA por dia para grafico
  const slaPorDia = diasDelMes.map(dia => {
    const totalML = dia.datos.reduce((s,m) => s+m.envios_ml, 0);
    const demML = dia.datos.reduce((s,m) => s+m.demorados, 0);
    const sla = totalML > 0 ? +((totalML-demML)/totalML*100).toFixed(1) : null;
    const p = dia.fecha.split("-");
    return { fecha: `${p[2]}/${p[1]}`, sla };
  });
  const comparativa = acumulado.slice(0,20).map(m => ({ name:m.cadete.split(" ")[0], sla:m.slaMeli??0, color:getSemaforo(m.slaMeli).color }));

  const inp  = { padding:"7px 12px", fontSize:13, border:`1px solid ${BRAND.border}`, borderRadius:8, background:BRAND.faint, color:BRAND.white, outline:"none" };
  const card = { background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:"1.25rem" };
  const btn  = (active) => ({ padding:"5px 14px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${active?"#2ECFAA":BRAND.border}`, background:active?"rgba(46,207,170,0.15)":BRAND.faint, color:active?"#2ECFAA":BRAND.muted });

  if (loadingDB) return (
    <div style={{ background:BRAND.navy, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:BRAND.teal, fontSize:16, fontFamily:"sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🚚</div>
        Cargando historial...
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background:BRAND.navy, minHeight:"100vh", padding:"1.5rem", color:BRAND.white }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"1.5rem", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:44, height:44, borderRadius:12, overflow:"hidden", flexShrink:0, background:"white", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <img src="data:image/jpeg;base64,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zzzzzyrzzzzzzzyn777777774TwyoH333330k7Dzzzzzzybzzzzzzzzyj777777755nxih3333331oPzzzzzzxbzzzzzzzzzzTf77777753CyYvz33333wbHzzzzzxbzzzzzzzzzwlb77777766XiyxHX33330njDzzzzxbzzzzzzzzzzyzL777777C2XwmpX3332way7zzzzxbzzzzzzzzzzzyT/wC+++sYh7x87K1998m/hIY8888C888888888888Mj+++/XBBxLw8EB19p0xB5Kw888W8888888888888tX++O5BBBk58dAQ0FRBBBwEw88X88888888888888Z2gRBBBBBNR8IJERBBBBBoJ88V888888888888888u9BBBBBBxi88O/BBBBBBRX88A88888888888888gCXBBBBBB9B80/ItBBBBB5588A8888888888888w7Ne9JBBB4wM4c++aFBBBNWs88A8888888888884Vtc8T5JBR6t8wf++/8ACQQbbfPPAPPPPPPPPPPPPL41fffETQTLPNRvvvvidQWAfPPPFPPPPPPPPPPPJSBPfffTFPAHOH/vvvvvNvETfPPPFPPPPPPPPPPOJzHffffbGxjfHP8A777777/I3zzzzxTzzzzzzzzzzsH333333zL3zQ77777776qDzzzzzwHzzzzzzzzyQs333333wffzWf7777777uEzzzzzzwjzzzzzzzzC8T333332G63xB777777774zzzzzzzw3zzzzzzzg2Tz333331q3zj77777777+3zzzzzzzz3zzzzzzymrT33333icjzGf7777777JnzzzzzzzzznzzzzzzhETzzzzzySkzwr77777775YzzzzzzzzzynzzzzzzmwHDDDHCAK3zw3LLLLPPPc3zzzzzzzzzz3zzzzzzz0zG0+G8e3zzx00333zz03zzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz3zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzjzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzjzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyj/2gAMAwEAAgADAAAAEPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOfPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPE/PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPAvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPB/PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPBfPPPPPOCPPPPPPPPPPONfsMPMMP8PPPPPPPPPPPFPPPPPPLEUoss088bvPPI1WLTDnDEJPPPPPPPPPPAPPPPPPKEQQQQQQQcXfPKvvv/wD/APuNbw888888888B888888osNBBBBBBBXJsCq3//AP8A/wDvl2888888888U8888888YCMBBBBBBwg04AA//AP8A/wD/ADtWfPPPPPPPF/PPPPPPLNfjAQQQQQYqLKBYv/8A/wD/APyqdPPPPPPPCvPPPPPPPLMNgQQQQQQR4LF1n/8A/wD/AP8A8gHzzzzzzirzzzzzzzzygQAEEEEEEF2TwoL7/wD/AP8A/wCQI88888oC888888888slvMBBBBBAwC0IlS3//AP8A/wDLbk8888oW8888888888s56BBBBBBCk+sVsX//AP8A+9nOHzzzyhbzzzzzzzzzzyjgUEEEETR7smzCvf8A/wD5MHmJ/PPKAfPPPPPPPPPPLKIxQQSRvvv6dKAwt/7NzvhndPPKPPPPPPPPPPPPPLMbyCJZ/vvqg7AbEd2H/vvru/PKPfPPPPPPPPPPPPLEeh3/AL777626xcVz777777h/yj/zzzzzzzzzzzzzyhQ/777777+Hyi6/7777764LyirzzzzzzzzzzzzzhOuf777775z3ih6pj77774kvyirzzzzzzzzzzzziww58zb775gbywTDRrr777N3zyj7zzzzzzzzzzzywax77UPb6663gHsEGM3b77ADzyj7zzzzzzzzzzzgjFf8A/wDpu/uWuBN4AQQUAvubvPPKLvPPPPPPPPPOEWxv/wD/APcydCskfwBBBBCdNyN888oX8888888888sztf8A/wD/APudbB4hwBBBBBBh5h8888oX8888888884Go/wD/AP8A/wD/AK7DgAMEEEEEEESXzzzzygDzzzzzzzzhFs//AP8A/wD/AOn04BuhBBBBBANF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" alt="Flexit logo" style={{ width:38, height:38, objectFit:"contain" }} />
        </div>
        <div>
          <div style={{ fontSize:22, fontWeight:700, letterSpacing:"-0.02em" }}>Métricas Flexit</div>
          <div style={{ fontSize:13, color:BRAND.muted }}>Control de SLA · Mercado Libre</div>
        </div>
        </div>
        {/* Upload compacto */}
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <div style={{ fontSize:12, color:BRAND.muted }}>
            {semanas.length > 0 && (
              <span>Última carga: <strong style={{color:BRAND.white}}>
                {(() => { 
                  const dias = semanas.flatMap(s=>s.dias); 
                  if(!dias.length) return "—"; 
                  const ultimo = dias.sort((a,b)=>b.fecha.localeCompare(a.fecha))[0]; 
                  const p=ultimo.fecha.split("-"); 
                  const fecha=`${p[2]}/${p[1]}/${p[0]}`;
                  const nombres=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
                  const dia=nombres[new Date(ultimo.fecha+"T12:00:00").getDay()];
                  const color=dia==="Lun"?"#EF9F27":"#2ECFAA";
                  return <span><span style={{color, marginRight:4}}>{dia}</span>{fecha}</span>;
                })()}
              </strong></span>
            )}
          </div>
          <div style={{fontSize:11, color:BRAND.muted, marginBottom:3}}>Fecha del archivo</div><input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} style={{...inp, fontSize:12, padding:"5px 10px"}} />
          <div onDrop={onDrop} onDragOver={e=>e.preventDefault()} onClick={()=>xlsxReady&&fileRef.current.click()}
            style={{ border:"1px solid #2ECFAA", borderRadius:8, padding:"6px 16px", cursor:xlsxReady?"pointer":"wait", fontSize:12, color:"#2ECFAA", background:"rgba(46,207,170,0.08)", whiteSpace:"nowrap" }}>
            <i className="ti ti-upload" style={{ fontSize:14, marginRight:6 }} />
            {!xlsxReady?"Cargando...":loading?(loadingMsg||"Procesando..."):"Subir Excel"}
            <input ref={fileRef} type="file" accept=".xls,.xlsx" style={{ display:"none" }} onChange={e=>onFile(e.target.files[0])} />
          </div>
        </div>
      </div>



      {error && <div style={{ background:"rgba(226,75,74,0.15)", color:"#E24B4A", border:"1px solid rgba(226,75,74,0.3)", padding:"10px 14px", borderRadius:8, fontSize:13, marginBottom:"1rem" }}>{error}</div>}



      {/* Filtros semana y dia */}
      {semanas.length > 0 && (
        <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:10, padding:"10px 16px", marginBottom:"1rem" }}>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"center" }}>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Semana:</span>
              {semanas.map(s => (
                <button key={s.label} onClick={()=>{ setSemanaActiva(s.label); setCadeteSeleccionado(null); setDiaActivo(null); }} style={{ padding:"3px 12px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${semanaActiva===s.label?"#2ECFAA":BRAND.border}`, background:semanaActiva===s.label?"rgba(46,207,170,0.15)":BRAND.faint, color:semanaActiva===s.label?"#2ECFAA":BRAND.muted }}>
                  {s.label}
                </button>
              ))}
            </div>
            {semana && semana.dias.length > 0 && (
              <div style={{ display:"flex", gap:6, alignItems:"center", borderLeft:`1px solid ${BRAND.border}`, paddingLeft:16 }}>
                <span style={{ fontSize:11, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Día:</span>
                <button onClick={()=>setDiaActivo(null)} style={{ padding:"3px 12px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${diaActivo===null?"#2ECFAA":BRAND.border}`, background:diaActivo===null?"rgba(46,207,170,0.15)":BRAND.faint, color:diaActivo===null?"#2ECFAA":BRAND.muted }}>
                  Todos
                </button>
                {semana.dias.map(d => {
                  const p = d.fecha.split("-");
                  const nombres=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
                  const dia=nombres[new Date(d.fecha+"T12:00:00").getDay()];
                  const esLunes = dia === "Lun";
                  return (
                    <button key={d.fecha} onClick={()=>setDiaActivo(d.fecha)} style={{ padding:"3px 12px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${diaActivo===d.fecha?"#2ECFAA":BRAND.border}`, background:diaActivo===d.fecha?"rgba(46,207,170,0.15)":BRAND.faint, color:diaActivo===d.fecha?"#2ECFAA":BRAND.muted }}>
                      <span style={{color: diaActivo===d.fecha?"#2ECFAA": esLunes?"#EF9F27":"inherit", marginRight:3}}>{dia}</span>{`${p[2]}/${p[1]}`}
                    </button>
                  );
                })}
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
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:"1.5rem" }}>
            {[
              ["Total envíos",  totalEnvios,    BRAND.white,  "ti-package"],
              ["Entregados",    totalEntregados,"#2ECFAA",    "ti-circle-check"],
              ["Pendientes",    totalPendientes,"#3A8FD4",    "ti-clock"],
              ["Demorados", totalDemorados, "#E24B4A", "ti-alert-circle"],
              ["SLA Meli",  slaPromedio !== null ? slaPromedio.toFixed(1)+"%" : "—", slaPromedio !== null && slaPromedio >= 98 ? "#2ECFAA" : slaPromedio !== null && slaPromedio >= 95 ? "#EF9F27" : "#E24B4A", "ti-chart-bar"],
              ["SLA Flexit", slaFlexit !== null ? slaFlexit+"%" : "—", slaFlexit !== null && slaFlexit >= 95 ? "#2ECFAA" : slaFlexit !== null && slaFlexit >= 90 ? "#EF9F27" : "#E24B4A", "ti-chart-dots"],
              ["Cadetes",       acumulado.length, BRAND.muted,"ti-users"],
            ].map(([label,val,color,icon]) => {
              const isTotal = label === "Total envíos";
              return (
                <TooltipKpi key={label} label={label} val={val} color={color} icon={icon}
                  tooltip={isTotal ? {ml:totalML, particular:totalParticular, totalEnvios} : null} />
              );
            })}
          </div>

          {criticos > 0 && (
            <div style={{ background:"rgba(226,75,74,0.1)", border:"1px solid rgba(226,75,74,0.3)", borderRadius:10, padding:"10px 16px", marginBottom:"1rem", fontSize:13, color:"#E24B4A" }}>
              <i className="ti ti-alert-circle" style={{ marginRight:8 }} />
              <strong>{criticos} cadete{criticos>1?"s":""} con SLA crítico</strong> — por debajo del 95%. Requieren atención inmediata.
            </div>
          )}

          {/* Tabs + exportar */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${BRAND.border}`, marginBottom:"1.5rem" }}>
            <div style={{ display:"flex", gap:4 }}>
              {[["tabla","ti-table","Tabla"],["tendencia","ti-chart-line","Tendencia"],["deepdive","ti-calendar-stats","Deep Dive"]].map(([key,icon,label]) => (
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

          {/* SEMÁFORO */}
          {tab==="tendencia" && (
            <div style={{ display:"flex", flexDirection:"column", gap:"1.5rem" }}>
              {cadeteSeleccionado && tendencia.length > 0 ? (
                <div style={card}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Evolución SLA Meli</div>
                      <div style={{ fontSize:16, fontWeight:700, color:BRAND.white, marginTop:2 }}>{cadeteSeleccionado}</div>
                    </div>
                    <button onClick={()=>setCadeteSeleccionado(null)} style={{ background:BRAND.faint, border:`1px solid ${BRAND.border}`, borderRadius:8, padding:"4px 12px", fontSize:12, color:BRAND.muted, cursor:"pointer" }}>
                      Ver todos
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
              ) : (
                <div style={{ ...card, textAlign:"center", padding:"2rem", color:BRAND.muted }}>
                  <i className="ti ti-hand-click" style={{ fontSize:32, display:"block", marginBottom:8 }} />
                  Hacé clic en un cadete del semáforo para ver su evolución diaria
                </div>
              )}
              <div style={card}>
                <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, marginBottom:"1rem", textTransform:"uppercase", letterSpacing:"0.06em" }}>Ranking semanal — peores primero</div>
                <div style={{ height:Math.max(260, comparativa.length*32) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparativa} layout="vertical" margin={{ left:10, right:60 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={BRAND.border} />
                      <XAxis type="number" domain={[0,100]} tickFormatter={v=>v+"%"} tick={{ fontSize:11, fill:BRAND.muted }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize:11, fill:BRAND.muted }} width={80} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={ttStyle} formatter={v=>[v.toFixed(1)+"%","SLA Meli"]} />
                      <Bar dataKey="sla" radius={[0,4,4,0]} label={{ position:"right", formatter:v=>v.toFixed(0)+"%", fontSize:11, fill:BRAND.muted }}>
                        {comparativa.map((e,i)=><Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display:"flex", gap:16, flexWrap:"wrap", marginTop:12 }}>
                  {[["#E24B4A","Crítico (<95%)"],["#EF9F27","En riesgo (95–98%)"],["#2ECFAA","OK (≥98%)"]].map(([c,l])=>(
                    <span key={l} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:BRAND.muted }}>
                      <span style={{ width:10, height:10, borderRadius:2, background:c, display:"inline-block" }} />{l}
                    </span>
                  ))}
                </div>
              </div>
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
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div>
                      <div style={{ fontSize:16, fontWeight:500, color:BRAND.white }}>Reporte mensual acumulado</div>
                      <div style={{ fontSize:12, color:BRAND.muted, marginTop:2 }}>{diasDelMes.length} días cargados · {diasDelMes[0]?.fecha.split("-").reverse().join("/")} al {diasDelMes[diasDelMes.length-1]?.fecha.split("-").reverse().join("/")}</div>
                    </div>
                  </div>

                  {/* KPIs mes */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
                    {[
                      ["Envíos ML", totalEnviosMes, BRAND.white, "ti-package"],
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

                  {/* Peores y mejores */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div style={card}>
                      <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, marginBottom:"1rem", textTransform:"uppercase", letterSpacing:"0.06em" }}>Críticos del mes <i className="ti ti-alert-triangle" style={{ fontSize:13, color:"#E24B4A" }} /></div>
                      {criticosMes.slice(0,5).map(m => (
                        <div key={m.cadete} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ flex:1, fontSize:13, fontWeight:500, color:BRAND.white }}>{m.cadete}</div>
                          <div style={{ fontSize:13, fontWeight:600, color: m.slaMeli < 95 ? "#E24B4A" : "#EF9F27" }}>{m.slaMeli?.toFixed(1)}%</div>
                        </div>
                      ))}
                      {criticosMes.length === 0 && <div style={{ fontSize:13, color:BRAND.muted }}>Ningún cadete crítico</div>}
                    </div>
                    <div style={card}>
                      <div style={{ fontSize:11, fontWeight:600, color:BRAND.muted, marginBottom:"1rem", textTransform:"uppercase", letterSpacing:"0.06em" }}>Mejores del mes <i className="ti ti-star" style={{ fontSize:13, color:"#2ECFAA" }} /></div>
                      {[...mesData].reverse().slice(0,5).map(m => (
                        <div key={m.cadete} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                          <div style={{ flex:1, fontSize:13, fontWeight:500, color:BRAND.white }}>{m.cadete}</div>
                          <div style={{ fontSize:13, fontWeight:600, color:"#2ECFAA" }}>{m.slaMeli?.toFixed(1) ?? "—"}%</div>
                        </div>
                      ))}
                    </div>
                  </div>

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
              <div style={{ marginBottom:"1rem", fontSize:13, color:BRAND.muted }}>
                Días cargados: {diasLabels.join(" · ")}
              </div>

              <div style={{ display:"flex", gap:8, marginBottom:"1rem", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[["todos","Todos"],["critico","🔴 Críticos <95%"],["riesgo","🟡 En riesgo 95-98%"],["ok","🟢 OK ≥98%"]].map(([key,label]) => (
                    <button key={key} onClick={()=>setFiltro(key)} style={{ padding:"5px 14px", fontSize:12, fontWeight:600, borderRadius:20, cursor:"pointer", border:`1px solid ${filtro===key?"#2ECFAA":BRAND.border}`, background:filtro===key?"rgba(46,207,170,0.15)":BRAND.faint, color:filtro===key?"#2ECFAA":BRAND.muted }}>
                      {label}
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
                          <td style={{ padding:"10px 14px", fontSize:13, color:m.demorados>0?"#E24B4A":BRAND.muted, fontWeight:m.demorados>0?700:400, borderBottom:`1px solid ${BRAND.border}`, textAlign:"right" }}>{m.demorados}</td>
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
    </div>
  );
}
