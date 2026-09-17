import React, { useEffect, useMemo, useState } from "react";
import { authedFetch } from "./auth";

const URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";
// En esta bandeja, Cancelado sigue abierto hasta confirmar la devolución física.
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
const linkButton = { border:0, background:"transparent", color:"#2ECFAA", padding:"6px 0", cursor:"pointer" };
const dayCard = { width:"100%", minHeight:112, textAlign:"left", display:"flex", flexDirection:"column", gap:4, padding:12, border:"1px solid transparent", background:"rgba(255,255,255,.045)", color:"#fff", borderRadius:9, cursor:"pointer" };
const dayActive = { background:"rgba(46,207,170,.14)", borderColor:"#2ECFAA" };
const tooltip = { position:"absolute", top:"calc(100% + 7px)", left:0, zIndex:20, minWidth:150, padding:10, borderRadius:8, background:"#10223d", border:"1px solid rgba(255,255,255,.2)", boxShadow:"0 8px 24px #0008", fontSize:12, lineHeight:1.7 };
const daysGrid = { display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:8, width:"100%" };
const serviceBar = { display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", margin:"12px 0" };

export default function PendientesHistoricos() {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [day, setDay] = useState(argentinaYesterday);
  const [service, setService] = useState("Todos"), [state, setState] = useState([]), [query, setQuery] = useState(""), [selected, setSelected] = useState(null), [tipDay, setTipDay] = useState(null);
  const load = async () => { setLoading(true); setError(""); try {
    const res = await authedFetch(`${URL}/rest/v1/envios_busqueda?select=id_interno,id_venta_ml,tracking,estado,fecha_estado,fecha_flexit,cadete,razon_social,direccion,localidad,origen&order=fecha_flexit.asc&limit=50000`, { headers:{ apikey:KEY } });
    if (!res.ok) throw new Error(`No se pudieron cargar los pendientes (${res.status})`);
    const data = await res.json();
    const normalized = data.filter(r => !resolved.test(String(r.estado || ""))).map(r => ({ ...r, service:serviceOf(r), origin:isoDate(r.fecha_flexit) || isoDate(r.fecha_estado) }));
    setRows(normalized);
    const todayKey = argentinaToday();
    const available = [...new Set(normalized.map(r => r.origin).filter(Boolean))].sort();
    const prior = available.filter(d => d < todayKey);
    if (prior.length) setDay(prior[prior.length - 1]);
  } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const states = useMemo(() => [...new Set(rows.map(r => String(r.estado || "Sin estado").trim()))].sort(), [rows]);
  const visible = useMemo(() => rows.filter(r => (!day || r.origin === day) && (service === "Todos" || r.service === service) && (state.length === 0 || state.includes(String(r.estado || "Sin estado").trim())) && `${r.id_venta_ml} ${r.tracking} ${r.razon_social} ${r.cadete} ${r.direccion} ${r.localidad}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => String(a.origin).localeCompare(String(b.origin)) || Number(b.service === "Flex") - Number(a.service === "Flex")), [rows,day,service,state,query]);
  const count = type => rows.filter(r => (!day || r.origin === day) && (type === "Todos" || r.service === type)).length;
  const calendarDays = useMemo(() => {
    // El calendario es histórico: termina en hoy y nunca adelanta fechas futuras.
    const base = parseDate(argentinaToday()) || new Date(); const start = new Date(base); start.setDate(start.getDate() - 6);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const key = d.toISOString().slice(0, 10); const rs = rows.filter(r => r.origin === key); return { key, d, rs }; });
  }, [rows, day]);
  return <div style={{ color:"#fff" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, flexWrap:"wrap", marginBottom:16 }}><div><h2 style={{ margin:0, fontSize:22 }}>Pendientes históricos</h2><div style={{ color:"rgba(255,255,255,.62)", fontSize:12, marginTop:5 }}>Cada envío pendiente, hasta su resolución.</div></div><div style={{ display:"flex", alignItems:"center", gap:12 }}><div style={{ textAlign:"right", color:"rgba(255,255,255,.55)", fontSize:11 }}>Última actualización<br/><b style={{ color:"#fff" }}>{new Date().toLocaleString("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</b></div><button onClick={load} disabled={loading} style={button}>{loading ? "Actualizando…" : "↻ Actualizar"}</button></div></div>
    {error && <div style={{ ...banner, borderColor:"rgba(226,75,74,.45)", color:"#ffadb4" }}>{error}</div>}
    <div style={banner}>La sección consulta la caché histórica disponible. Última consulta: {new Date().toLocaleString("es-AR")}. Un error conserva la vista anterior.</div>
    <div style={calendar}><div style={{ width:"100%", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:10 }}><div><b style={{ fontSize:15 }}>Pendientes por día</b><small style={muted}>Fecha de origen · ingreso A planta</small></div><div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={muted}>Semana seleccionada</span><button style={button}>←</button><button style={button}>Semana actual</button><button style={button}>→</button></div></div><div style={daysGrid}>{calendarDays.map(({key,d,rs}) => <div key={key} style={{ position:"relative" }}><button onClick={() => { setDay(key); setTipDay(null); }} onMouseEnter={() => setTipDay(key)} onMouseLeave={() => setTipDay(null)} style={{ ...dayCard, ...(day===key?dayActive:{}) }}><small style={{ textTransform:"capitalize", fontSize:11, lineHeight:1.1 }}>{d.toLocaleDateString("es-AR", { weekday:"long" })}</small><b style={{ fontSize:12, lineHeight:1.1 }}>{d.getDate()}</b><strong style={{ fontSize:28, lineHeight:1.05, marginTop:8 }}>{rs.length || "—"}</strong><small>{rs.length ? "pendientes" : "sin cobertura"}</small></button>{tipDay===key && <div style={tooltip}><b>{labelDate(key)}</b><div>Flex: {rs.filter(r=>r.service==="Flex").length}</div><div>Particulares: {rs.filter(r=>r.service==="Particular").length}</div></div>}</div>)}</div></div>
    <div style={kpiGrid}><div style={kpi}>Flex pendientes <b>{count("Flex")}</b></div><div style={kpi}>Particulares <b>{count("Particular")}</b></div><div style={kpi}>Sin clasificar <b>0</b></div><div style={{ ...kpi, color:"#ff8f9a" }}>Prioridad crítica <b>{rows.filter(r=>/nadie|no entregado/i.test(r.estado||"")).length}</b></div></div>
    <div style={serviceBar}><div style={segmented}>{["Todos","Flex","Particular"].map(s => <button key={s} onClick={() => setService(s)} style={{ ...button, ...(service===s?active:{}) }}>{s} <b>{count(s)}</b></button>)}</div><div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}><span style={{ ...muted, marginTop:0 }}>Estado</span><button onClick={() => setState([])} style={{ ...button, ...(state.length===0?active:{}) }}>Todos</button>{states.map(s=><button key={s} onClick={() => setState(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev,s])} style={{ ...button, ...(state.includes(s)?active:{}) }}>{s}</button>)}</div></div>
    <div style={filters}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar envío, cliente, cadete o dirección…" style={{ ...input, flex:1, minWidth:220 }}/></div>
    <div style={{ ...card, overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}><thead><tr>{["Fecha de origen","Servicio / envío","Asignado a","Cliente / dirección","Estado"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan="5" style={empty}>Cargando pendientes…</td></tr> : rows.length===0 ? <tr><td colSpan="5" style={empty}><b>No hay datos históricos cargados.</b><br/><small>La consulta respondió correctamente, pero la caché de envíos está vacía. Hay que ejecutar la sincronización de LightData.</small></td></tr> : visible.length===0 ? <tr><td colSpan="5" style={empty}>No hay pendientes para estos filtros.</td></tr> : visible.map(r => <tr key={r.id_interno} onClick={()=>setSelected(r)} style={{ borderTop:"1px solid rgba(255,255,255,.08)", cursor:"pointer" }}><td style={td}><b>{labelDate(r.origin)}</b></td><td style={td}><span style={{ ...pill, ...(r.service==="Flex"?flexPill:{}) }}>{r.service}</span><small style={muted}>{r.id_venta_ml || r.tracking || r.id_interno}</small></td><td style={td}><b>{r.cadete || "Sin asignar"}</b><small style={muted}>Último movimiento: {labelDate(r.fecha_estado)}</small></td><td style={td}><b>{r.razon_social || "Cliente sin nombre"}</b><small style={muted}>{[r.direccion,r.localidad].filter(Boolean).join(" · ") || "Dirección no informada"}</small></td><td style={td}>{r.estado || "Sin estado"}</td></tr>)}</tbody></table></div>
    {selected && <div role="dialog" onClick={()=>setSelected(null)} style={overlay}><div onClick={e=>e.stopPropagation()} style={drawer}><button onClick={()=>setSelected(null)} style={{ ...button, float:"right" }}>×</button><div style={muted}>DETALLE DEL ENVÍO</div><h2>{selected.id_venta_ml || selected.tracking || selected.id_interno}</h2><p><b>{selected.service}</b> · {selected.estado || "Sin estado"}</p><hr/><p><b>Fecha de origen</b><br/>{labelDate(selected.origin)}</p><p><b>Asignado a</b><br/>{selected.cadete || "Sin asignar"}</p><p><b>Cliente</b><br/>{selected.razon_social || "Sin nombre"}</p><p><b>Dirección</b><br/>{[selected.direccion,selected.localidad].filter(Boolean).join(" · ") || "No informada"}</p></div></div>}
  </div>;
}
const kpiGrid={display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:8,margin:"12px 0"};const kpi={display:"flex",justifyContent:"space-between",alignItems:"center",border:"1px solid rgba(255,255,255,.14)",background:"rgba(13,31,55,.86)",borderRadius:8,padding:"11px 13px",fontSize:12,color:"rgba(255,255,255,.75)"};const button={border:"1px solid rgba(255,255,255,.16)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:8,padding:"8px 12px",cursor:"pointer"};const active={background:"rgba(46,207,170,.18)",borderColor:"#2ECFAA",color:"#2ECFAA"};const input={border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:8,padding:"9px 11px"};const banner={padding:"10px 13px",border:"1px solid rgba(239,159,39,.35)",background:"rgba(239,159,39,.08)",borderRadius:8,color:"#f1d39b",fontSize:12,marginBottom:12};const calendar={display:"flex",alignItems:"end",justifyContent:"space-between",gap:12,flexWrap:"wrap",background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const segmented={display:"flex",gap:6,flexWrap:"wrap"};const label={display:"flex",flexDirection:"column",gap:5,fontSize:11,color:"rgba(255,255,255,.62)"};const filters={display:"flex",gap:10,margin:"12px 0"};const card={background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const th={textAlign:"left",color:"rgba(255,255,255,.55)",fontSize:10,textTransform:"uppercase",padding:"9px 8px"};const td={padding:"12px 8px",verticalAlign:"top"};const muted={display:"block",color:"rgba(255,255,255,.55)",fontSize:11,marginTop:4};const pill={display:"inline-block",padding:"3px 7px",borderRadius:5,background:"rgba(255,255,255,.1)",fontSize:10,marginBottom:4};const flexPill={background:"rgba(46,207,170,.16)",color:"#6de4c3"};const empty={padding:30,textAlign:"center",color:"rgba(255,255,255,.6)"};const overlay={position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:1000,display:"flex",justifyContent:"flex-end"};const drawer={height:"100%",width:"min(430px,100%)",background:"#0d1f37",padding:24,boxSizing:"border-box",overflowY:"auto"};



