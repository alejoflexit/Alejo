import React, { useEffect, useMemo, useState, useRef } from "react";
import PendingFilters from "./PendingFilters";
import { pendingPriority, OPEN_STATES, isOpenShipment, matchesSelection } from "./pendingPriority";
import { getSession, authedFetch } from "./auth";

const URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";
// Cancelado y Rechazado por el comprador NO son entregas abiertas: se gestionan como devolución a depósito (RETURN_STATES en pendingPriority.js). El grupo identifica casos a gestionar; no prueba que el paquete haya vuelto.
const resolved = /^entregado/i;
const dateOnly = value => String(value || "").split(/[ T]/)[0];
const isoDate = value => {
  const s = dateOnly(value); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const parseDate = value => {
  const s = dateOnly(value); if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
  const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? null : d;
};
const labelDate = value => { const d = parseDate(value); return d ? d.toLocaleDateString("es-AR", { day:"numeric", month:"long" }) : "Sin fecha"; };
const argentinaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone:"America/Argentina/Buenos_Aires", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const argentinaYesterday = () => { const d = new Date(`${argentinaToday()}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const serviceOf = row => ["flex", "ml", "mercado libre"].includes(String(row.origen || "").trim().toLowerCase()) ? "Flex" : "Particular";
const dayCard = { width:"100%", minHeight:126, textAlign:"left", display:"flex", flexDirection:"column", gap:4, padding:12, border:"1px solid transparent", background:"rgba(255,255,255,.045)", color:"#fff", borderRadius:9, cursor:"pointer" };
const dayActive = { background:"rgba(46,207,170,.14)", borderColor:"#2ECFAA" };
// Flex en amarillo, elegido por Alejo el 20/09. Ojo: el amarillo tambien marca
// "Atencion +24 h" en el semaforo y el Flex de la tabla sigue en verde agua.
const FLEX_ACCENT = "#f2c94c";
const dayFlexCount = { fontSize:28, lineHeight:1.05, marginTop:8, color:FLEX_ACCENT };
const dayFlexZero = { color:"rgba(255,255,255,.45)" };
const dayPart = { display:"block", marginTop:3, fontSize:11, color:"rgba(255,255,255,.62)" };
const daysGrid = { display:"grid", gridTemplateColumns:"repeat(7,minmax(78px,1fr))", gap:8, width:"100%", overflowX:"auto", paddingBottom:4 };
export default function PendientesHistoricos() {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [day, setDay] = useState(argentinaYesterday);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [courier, setCourier] = useState("");
  const [checkedAt, setCheckedAt] = useState(null);
  const loadingRef = useRef(false);
  const [service, setService] = useState("Todos"), [state, setState] = useState([...OPEN_STATES]), [query, setQuery] = useState(""), [selected, setSelected] = useState(null);
  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true); setError("");
    try {
      if (!getSession()) throw new Error("Iniciá sesión desde Inicio para consultar los pendientes.");
      const data = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await authedFetch(URL + '/rest/v1/envios_busqueda?select=id_interno,id_venta_ml,tracking,estado,fecha_estado,fecha_flexit,cadete,razon_social,direccion,localidad,origen&order=id_interno&limit=1000&offset=' + offset, { headers:{ apikey:KEY } });
        if (!res.ok) throw new Error('No se pudieron cargar los pendientes (' + res.status + ')');
        const page = await res.json(); data.push(...page);
        if (page.length < 1000) break;
      }
      setRows(data.filter(r => !resolved.test(String(r.estado || '').trim())).map(r => ({ ...r, service:serviceOf(r), origin:isoDate(r.fecha_flexit) || isoDate(r.fecha_estado) })));
      setCheckedAt(new Date());
    } catch(e) { setError(e.message); } finally { setLoading(false); loadingRef.current=false; }
  };
  useEffect(() => { load(); const timer=setInterval(() => { if (!document.hidden) load(); },60000); return () => clearInterval(timer); }, []);
  const states = useMemo(() => [...new Set(rows.map(r => String(r.estado || "Sin estado").trim()))].sort(), [rows]);
  const couriers = useMemo(() => [...new Set(rows.map(r => r.cadete || "Sin asignar"))].sort((a,b) => a.localeCompare(b)), [rows]);
  const visible = useMemo(() => rows.filter(r => (!day || r.origin === day) && (!criticalOnly || pendingPriority(r).rank === 3) && (service === "Todos" || r.service === service) && (!courier || (r.cadete || "Sin asignar") === courier) && matchesSelection(r, state) && `${r.id_venta_ml} ${r.tracking} ${r.razon_social} ${r.cadete} ${r.direccion} ${r.localidad}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => pendingPriority(b).rank - pendingPriority(a).rank || String(a.origin).localeCompare(String(b.origin)) || Number(b.service === "Flex") - Number(a.service === "Flex")), [rows,day,service,state,query,criticalOnly,courier]);
  const calendarDays = useMemo(() => {
    // El calendario es histórico: termina en hoy y nunca adelanta fechas futuras.
    const base = parseDate(argentinaToday()) || new Date(); const start = new Date(base); start.setDate(start.getDate() - 6);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const key = d.toISOString().slice(0, 10); const rs = rows.filter(r => r.origin === key && isOpenShipment(r)); const flex = rs.filter(r => r.service === "Flex").length; return { key, d, rs, flex, part: rs.length - flex }; });
  }, [rows]);
  return <div style={{ color:"#fff" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, flexWrap:"wrap", marginBottom:16 }}><div><h2 style={{ margin:0, fontSize:22 }}>Pendientes históricos</h2><div style={{ color:"rgba(255,255,255,.62)", fontSize:12, marginTop:5 }}>Cada envío pendiente, hasta su resolución.</div></div><div style={{ display:"flex", alignItems:"center", gap:12 }}><div style={{ textAlign:"right", color:"rgba(255,255,255,.55)", fontSize:11 }}>Última consulta de la pantalla<br/><b style={{ color:"#fff" }}>{(checkedAt || new Date()).toLocaleString("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</b></div><button onClick={load} disabled={loading} style={button}>{loading ? "Actualizando…" : "↻ Actualizar"}</button></div></div>
    <div style={urgentHero}><div style={{display:"flex",alignItems:"center",gap:18}}><strong style={{ fontSize:34, lineHeight:1 }}>{rows.filter(r => pendingPriority(r).rank === 3).length}</strong><div><b>Flex abiertos con más de 48 horas</b><small style={{display:"block",marginTop:5,color:"#bfc7d8"}}>Estos envíos necesitan seguimiento prioritario.</small></div></div><button onClick={() => { setCriticalOnly(true); setDay(""); setService("Flex"); setState([...OPEN_STATES]); setCourier(""); setQuery(""); }} style={urgentButton}>Revisar urgentes →</button></div>
    {error && <div style={{ ...banner, borderColor:"rgba(226,75,74,.45)", color:"#ffadb4" }}>{error}</div>}
    <div style={banner}>Semáforo desde el ingreso: rojo Flex +48 h · naranja otros +48 h · amarillo +24 h · verde recientes. La hora de consulta no indica cuándo se sincronizó LightData.</div>
    <div style={calendar}><div style={{ width:"100%", display:"flex", flexWrap:"wrap", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:10 }}><div><b style={{ fontSize:15 }}>Flex abiertos por día</b><small style={muted}>Fecha de origen · ingreso A planta</small></div><div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={muted}>Semana seleccionada</span><button style={button}>←</button><button style={button}>Semana actual</button><button style={button}>→</button></div></div><div style={daysGrid}>{calendarDays.map(({key,d,rs,flex,part}) => <div key={key} style={{ position:"relative" }}><button onClick={() => setDay(key)} style={{ ...dayCard, ...(day===key?dayActive:{}) }}><small style={{ textTransform:"capitalize", fontSize:11, lineHeight:1.1 }}>{d.toLocaleDateString("es-AR", { weekday:"long" })}</small><b style={{ fontSize:12, lineHeight:1.1 }}>{d.getDate()}</b><strong style={{ ...dayFlexCount, ...(rs.length && flex ? {} : dayFlexZero) }}>{rs.length ? flex : "—"}</strong><small>{rs.length ? "Flex" : "sin cobertura"}</small>{rs.length > 0 && <small style={dayPart}>+ {part} {part === 1 ? "particular" : "particulares"}</small>}</button></div>)}</div></div>
    <PendingFilters title={day ? 'Pendientes del ' + parseDate(day).toLocaleDateString("es-AR", {weekday:"long",day:"numeric",month:"long"}) : "Pendientes de todo el historial"} count={visible.length} service={service} setService={setService} query={query} setQuery={setQuery} courier={courier} setCourier={setCourier} couriers={couriers} states={states} selectedStates={state} setSelectedStates={value => {setState(value);setCriticalOnly(false);}} showHistory={() => {setDay("");setCriticalOnly(false);}} showYesterday={() => {setDay(argentinaYesterday());setCriticalOnly(false);}} criticalOnly={criticalOnly} clearCritical={() => setCriticalOnly(false)} />
    <div style={{ ...card, borderTop:0, borderRadius:"0 0 10px 10px", overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}><thead><tr>{["Fecha de origen","Servicio / envío","Asignado a","Cliente / dirección","Estado"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{loading && rows.length === 0 ? <tr><td colSpan="5" style={empty}>Cargando pendientes…</td></tr> : rows.length===0 ? <tr><td colSpan="5" style={empty}><b>No hay datos históricos cargados.</b><br/><small>La consulta respondió correctamente, pero la caché de envíos está vacía. Hay que ejecutar la sincronización de LightData.</small></td></tr> : visible.length===0 ? <tr><td colSpan="5" style={empty}>No hay pendientes para estos filtros.</td></tr> : visible.map(r => <tr key={r.id_interno} onClick={()=>setSelected(r)} style={{ borderTop:"1px solid rgba(255,255,255,.08)", cursor:"pointer" }}><td style={td}><b>{labelDate(r.origin)}</b></td><td style={td}><span style={{ ...pill, ...(r.service==="Flex"?flexPill:{}) }}>{r.service}</span><small style={muted}>{r.id_venta_ml || r.tracking || r.id_interno}</small></td><td style={td}><b>{r.cadete || "Sin asignar"}</b><small style={muted}>Último movimiento: {labelDate(r.fecha_estado)}</small></td><td style={td}><b>{r.razon_social || "Cliente sin nombre"}</b><small style={muted}>{[r.direccion,r.localidad].filter(Boolean).join(" · ") || "Dirección no informada"}</small></td><td style={td}>{r.estado || "Sin estado"}<small style={{...muted,color:pendingPriority(r).color,fontWeight:700}}>● {pendingPriority(r).label}</small></td></tr>)}</tbody></table></div>
    {selected && <div role="dialog" onClick={()=>setSelected(null)} style={overlay}><div onClick={e=>e.stopPropagation()} style={drawer}><button onClick={()=>setSelected(null)} style={{ ...button, float:"right" }}>×</button><div style={muted}>DETALLE DEL ENVÍO</div><h2>{selected.id_venta_ml || selected.tracking || selected.id_interno}</h2><p><b>{selected.service}</b> · {selected.estado || "Sin estado"}</p><hr/><p><b>Fecha de origen</b><br/>{labelDate(selected.origin)}</p><p><b>Asignado a</b><br/>{selected.cadete || "Sin asignar"}</p><p><b>Cliente</b><br/>{selected.razon_social || "Sin nombre"}</p><p><b>Dirección</b><br/>{[selected.direccion,selected.localidad].filter(Boolean).join(" · ") || "No informada"}</p></div></div>}
  </div>;
}
const button={border:"1px solid rgba(255,255,255,.16)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:8,padding:"8px 12px",cursor:"pointer"};const banner={padding:"10px 13px",border:"1px solid rgba(239,159,39,.35)",background:"rgba(239,159,39,.08)",borderRadius:8,color:"#f1d39b",fontSize:12,marginBottom:12};const calendar={display:"flex",alignItems:"end",justifyContent:"space-between",gap:12,flexWrap:"wrap",background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const card={background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const th={textAlign:"left",color:"rgba(255,255,255,.55)",fontSize:10,textTransform:"uppercase",padding:"9px 8px"};const td={padding:"12px 8px",verticalAlign:"top"};const muted={display:"block",color:"rgba(255,255,255,.55)",fontSize:11,marginTop:4};const pill={display:"inline-block",padding:"3px 7px",borderRadius:5,background:"rgba(255,255,255,.1)",fontSize:10,marginBottom:4};const flexPill={background:"rgba(46,207,170,.16)",color:"#6de4c3"};const empty={padding:30,textAlign:"center",color:"rgba(255,255,255,.6)"};const overlay={position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:1000,display:"flex",justifyContent:"flex-end"};const drawer={height:"100%",width:"min(430px,100%)",background:"#0d1f37",padding:24,boxSizing:"border-box",overflowY:"auto"};








const urgentHero={display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap",padding:"14px 18px",margin:"0 0 14px",border:"1px solid rgba(255,102,112,.4)",borderLeft:"6px solid #ff6874",borderRadius:9,background:"rgba(90,30,45,.35)"};
const urgentButton={border:0,borderRadius:7,padding:"10px 16px",background:"#ff6874",color:"#1d1420",fontWeight:800,cursor:"pointer"};
