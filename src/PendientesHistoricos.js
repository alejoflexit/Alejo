import React, { useEffect, useMemo, useState } from "react";
import { authedFetch } from "./auth";

const URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";
const resolved = /^(entregado|cancelado)/i;
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
const serviceOf = row => ["flex", "ml", "mercado libre"].includes(String(row.origen || "").trim().toLowerCase()) ? "Flex" : "Particular";

export default function PendientesHistoricos() {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [day, setDay] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); });
  const [service, setService] = useState("Todos"), [state, setState] = useState("Todos"), [query, setQuery] = useState(""), [selected, setSelected] = useState(null);
  const load = async () => { setLoading(true); setError(""); try {
    const res = await authedFetch(`${URL}/rest/v1/envios_busqueda?select=id_interno,id_venta_ml,tracking,estado,fecha_estado,fecha_flexit,cadete,razon_social,direccion,localidad,origen&order=fecha_flexit.asc&limit=50000`, { headers:{ apikey:KEY } });
    if (!res.ok) throw new Error(`No se pudieron cargar los pendientes (${res.status})`);
    const data = await res.json();
    const normalized = data.filter(r => !resolved.test(String(r.estado || ""))).map(r => ({ ...r, service:serviceOf(r), origin:isoDate(r.fecha_flexit) || isoDate(r.fecha_estado) }));
    setRows(normalized);
    const todayKey = new Date().toISOString().slice(0, 10);
    const available = [...new Set(normalized.map(r => r.origin).filter(Boolean))].sort();
    const prior = available.filter(d => d < todayKey);
    if (prior.length) setDay(prior[prior.length - 1]);
  } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const states = useMemo(() => [...new Set(rows.map(r => String(r.estado || "Sin estado").trim()))].sort(), [rows]);
  const visible = useMemo(() => rows.filter(r => (!day || r.origin === day) && (service === "Todos" || r.service === service) && (state === "Todos" || String(r.estado || "Sin estado").trim() === state) && `${r.id_venta_ml} ${r.tracking} ${r.razon_social} ${r.cadete} ${r.direccion} ${r.localidad}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => String(a.origin).localeCompare(String(b.origin)) || Number(b.service === "Flex") - Number(a.service === "Flex")), [rows,day,service,state,query]);
  const count = type => rows.filter(r => (!day || r.origin === day) && (type === "Todos" || r.service === type)).length;
  return <div style={{ color:"#fff" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:16 }}><div><h2 style={{ margin:0 }}>Pendientes históricos</h2><div style={{ color:"rgba(255,255,255,.62)", fontSize:12, marginTop:5 }}>Seguimiento por fecha de origen · actualización manual</div></div><button onClick={load} disabled={loading} style={button}>{loading ? "Actualizando…" : "↻ Actualizar"}</button></div>
    {error && <div style={{ ...banner, borderColor:"rgba(226,75,74,.45)", color:"#ffadb4" }}>{error}</div>}
    <div style={banner}>La sección consulta la caché histórica disponible. Última consulta: {new Date().toLocaleString("es-AR")}. Un error conserva la vista anterior.</div>
    <div style={calendar}><label style={label}>Fecha de origen<div style={{ display:"flex", gap:7, alignItems:"center" }}><input type="date" value={day} onChange={e => setDay(e.target.value)} style={input}/><button onClick={() => setDay("")} style={button}>Todos los días</button></div></label><div style={segmented}>{["Todos","Flex","Particular"].map(s => <button key={s} onClick={() => setService(s)} style={{ ...button, ...(service===s?active:{}) }}>{s} <b>{count(s)}</b></button>)}</div></div>
    <div style={filters}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar envío, cliente, cadete o dirección…" style={{ ...input, flex:1, minWidth:220 }}/><select value={state} onChange={e=>setState(e.target.value)} style={input}><option>Todos</option>{states.map(s=><option key={s}>{s}</option>)}</select></div>
    <div style={{ ...card, overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}><thead><tr>{["Fecha de origen","Servicio / envío","Asignado a","Cliente / dirección","Estado"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan="5" style={empty}>Cargando pendientes…</td></tr> : visible.length===0 ? <tr><td colSpan="5" style={empty}>No hay pendientes para estos filtros.</td></tr> : visible.map(r => <tr key={r.id_interno} onClick={()=>setSelected(r)} style={{ borderTop:"1px solid rgba(255,255,255,.08)", cursor:"pointer" }}><td style={td}><b>{labelDate(r.origin)}</b></td><td style={td}><span style={{ ...pill, ...(r.service==="Flex"?flexPill:{}) }}>{r.service}</span><small style={muted}>{r.id_venta_ml || r.tracking || r.id_interno}</small></td><td style={td}><b>{r.cadete || "Sin asignar"}</b><small style={muted}>Último movimiento: {labelDate(r.fecha_estado)}</small></td><td style={td}><b>{r.razon_social || "Cliente sin nombre"}</b><small style={muted}>{[r.direccion,r.localidad].filter(Boolean).join(" · ") || "Dirección no informada"}</small></td><td style={td}>{r.estado || "Sin estado"}</td></tr>)}</tbody></table></div>
    {selected && <div role="dialog" onClick={()=>setSelected(null)} style={overlay}><div onClick={e=>e.stopPropagation()} style={drawer}><button onClick={()=>setSelected(null)} style={{ ...button, float:"right" }}>×</button><div style={muted}>DETALLE DEL ENVÍO</div><h2>{selected.id_venta_ml || selected.tracking || selected.id_interno}</h2><p><b>{selected.service}</b> · {selected.estado || "Sin estado"}</p><hr/><p><b>Fecha de origen</b><br/>{labelDate(selected.origin)}</p><p><b>Asignado a</b><br/>{selected.cadete || "Sin asignar"}</p><p><b>Cliente</b><br/>{selected.razon_social || "Sin nombre"}</p><p><b>Dirección</b><br/>{[selected.direccion,selected.localidad].filter(Boolean).join(" · ") || "No informada"}</p></div></div>}
  </div>;
}
const button={border:"1px solid rgba(255,255,255,.16)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:8,padding:"8px 12px",cursor:"pointer"};const active={background:"rgba(46,207,170,.18)",borderColor:"#2ECFAA",color:"#2ECFAA"};const input={border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:8,padding:"9px 11px"};const banner={padding:"10px 13px",border:"1px solid rgba(239,159,39,.35)",background:"rgba(239,159,39,.08)",borderRadius:8,color:"#f1d39b",fontSize:12,marginBottom:12};const calendar={display:"flex",alignItems:"end",justifyContent:"space-between",gap:12,flexWrap:"wrap",background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const segmented={display:"flex",gap:6,flexWrap:"wrap"};const label={display:"flex",flexDirection:"column",gap:5,fontSize:11,color:"rgba(255,255,255,.62)"};const filters={display:"flex",gap:10,margin:"12px 0"};const card={background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const th={textAlign:"left",color:"rgba(255,255,255,.55)",fontSize:10,textTransform:"uppercase",padding:"9px 8px"};const td={padding:"12px 8px",verticalAlign:"top"};const muted={display:"block",color:"rgba(255,255,255,.55)",fontSize:11,marginTop:4};const pill={display:"inline-block",padding:"3px 7px",borderRadius:5,background:"rgba(255,255,255,.1)",fontSize:10,marginBottom:4};const flexPill={background:"rgba(46,207,170,.16)",color:"#6de4c3"};const empty={padding:30,textAlign:"center",color:"rgba(255,255,255,.6)"};const overlay={position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:1000,display:"flex",justifyContent:"flex-end"};const drawer={height:"100%",width:"min(430px,100%)",background:"#0d1f37",padding:24,boxSizing:"border-box",overflowY:"auto"};
