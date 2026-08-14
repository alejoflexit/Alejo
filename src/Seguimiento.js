import React, { useEffect, useMemo, useState } from "react";
import { authedFetch } from "./auth";
import { construirSeguimiento, mensajeCadete, SEGUIMIENTO_CFG } from "./seguimientoSla";

const URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";
const C = { card:"#1A1A4A", teal:"#2ECFAA", white:"#fff", muted:"rgba(255,255,255,.62)", border:"rgba(255,255,255,.1)", red:"#E24B4A", amber:"#EF9F27" };
const card = { background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"1.1rem" };
const fmt = n => Number(n).toLocaleString("es-AR", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fechaEnvio = iso => new Date(iso).toLocaleString("es-AR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
const plural = (n, singular, pluralForma=`${singular}s`) => `${n} ${n===1?singular:pluralForma}`;

async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return; } catch {}
  const area=document.createElement("textarea");
  area.value=texto; area.style.position="fixed"; area.style.opacity="0";
  document.body.appendChild(area); area.focus(); area.select();
  const ok=document.execCommand("copy"); area.remove();
  if(!ok) throw new Error("copy failed");
}

async function leerEnviados(label, session) {
  if (!label || !session) return [];
  const r = await authedFetch(`${URL}/rest/v1/seguimiento_sla_mensajes?semana_label=eq.${encodeURIComponent(label)}&select=cadete,enviado_at,sla,envios_ml,demorados,dem21`, { headers:{ apikey:KEY } });
  if (!r.ok) throw new Error("No se pudo cargar el registro de mensajes");
  return r.json();
}
async function marcar(label, f) {
  const r = await authedFetch(`${URL}/rest/v1/seguimiento_sla_mensajes?on_conflict=semana_label,cadete`, { method:"POST", headers:{ apikey:KEY, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=representation" }, body:JSON.stringify({ semana_label:label, cadete:f.cadete, sla:+f.sla.toFixed(2), envios_ml:f.enviosMl, demorados:f.demorados, dem21:f.dem21, enviado_at:new Date().toISOString() }) });
  if (!r.ok) throw new Error("No se pudo marcar el mensaje como enviado");
  return (await r.json())[0];
}
async function desmarcar(label, cadete) {
  const r = await authedFetch(`${URL}/rest/v1/seguimiento_sla_mensajes?semana_label=eq.${encodeURIComponent(label)}&cadete=eq.${encodeURIComponent(cadete)}`, { method:"DELETE", headers:{ apikey:KEY } });
  if (!r.ok) throw new Error("No se pudo desmarcar el mensaje");
}
async function leerInactivos() {
  const r = await authedFetch(`${URL}/rest/v1/seguimiento_sla_cadetes_inactivos?select=cadete,motivo,baja_at,baja_por&order=cadete.asc`, { headers:{ apikey:KEY } });
  if (!r.ok) throw new Error("No se pudo cargar la lista de cadetes dados de baja");
  return r.json();
}
async function darDeBaja(cadete) {
  const r = await authedFetch(`${URL}/rest/v1/seguimiento_sla_cadetes_inactivos`, { method:"POST", headers:{ apikey:KEY, Prefer:"return=representation" }, body:JSON.stringify({ cadete, motivo:"Ya no trabaja en Flexit" }) });
  if (!r.ok) throw new Error("No se pudo dar de baja al cadete");
  return (await r.json())[0];
}
async function reactivar(cadete) {
  const r = await authedFetch(`${URL}/rest/v1/seguimiento_sla_cadetes_inactivos?cadete=eq.${encodeURIComponent(cadete)}`, { method:"DELETE", headers:{ apikey:KEY } });
  if (!r.ok) throw new Error("No se pudo reactivar al cadete");
}

export default function Seguimiento({ semanas, semanaActiva, session }) {
  const esAdmin=session?.email==="admin@flexit.app";
  const reporteBase = useMemo(() => construirSeguimiento(semanas, semanaActiva), [semanas, semanaActiva]);
  const [enviados, setEnviados] = useState([]), [inactivos, setInactivos] = useState([]), [verInactivos, setVerInactivos] = useState(false), [configCadete, setConfigCadete] = useState(null), [abierto, setAbierto] = useState(null), [copiado, setCopiado] = useState(null), [busy, setBusy] = useState(null), [error, setError] = useState("");
  useEffect(() => { let ok=true; setEnviados([]); setError(""); leerEnviados(semanaActiva, session).then(x=>ok&&setEnviados(x)).catch(e=>ok&&setError(e.message)); return()=>{ok=false;}; }, [semanaActiva, session]);
  useEffect(() => { let ok=true; setInactivos([]); if(esAdmin) leerInactivos().then(x=>ok&&setInactivos(x)).catch(e=>ok&&setError(e.message)); return()=>{ok=false;}; }, [esAdmin]);
  const inactivosSet=useMemo(()=>new Set(inactivos.map(x=>x.cadete.toLocaleLowerCase("es"))),[inactivos]);
  const reporte=useMemo(()=>({...reporteBase,filas:reporteBase.filas.filter(f=>!inactivosSet.has(f.cadete.toLocaleLowerCase("es")))}),[reporteBase,inactivosSet]);
  const enviadosMap = useMemo(() => new Map(enviados.map(e=>[e.cadete,e])), [enviados]);
  const copiar = async f => { try { await copiarTexto(mensajeCadete(f)); setCopiado(f.cadete); setTimeout(()=>setCopiado(null),1800); } catch { setError("No se pudo copiar el mensaje."); } };
  const toggle = async f => {
    if (!session) { setError("Iniciá sesión desde el encabezado para registrar mensajes enviados."); return; }
    setBusy(f.cadete); setError("");
    try { const viejo=enviadosMap.get(f.cadete); if(viejo){await desmarcar(semanaActiva,f.cadete);setEnviados(x=>x.filter(e=>e.cadete!==f.cadete));}else{const row=await marcar(semanaActiva,f);setEnviados(x=>[...x.filter(e=>e.cadete!==f.cadete),row]);} } catch(e){setError(e.message);} finally{setBusy(null);}
  };
  const baja = async f => {
    if(!esAdmin) return;
    if(!window.confirm(`¿Ocultar a ${f.cadete} del seguimiento?\n\nDejará de aparecer en esta lista, pero conservaremos sus métricas históricas.`)) return;
    setBusy(`baja:${f.cadete}`); setError("");
    try { const row=await darDeBaja(f.cadete); setInactivos(x=>[...x.filter(i=>i.cadete!==f.cadete),row]); }
    catch(e){setError(e.message);} finally{setBusy(null);}
  };
  const alta = async cadete => {
    setBusy(`alta:${cadete}`); setError("");
    try { await reactivar(cadete); setInactivos(x=>x.filter(i=>i.cadete!==cadete)); }
    catch(e){setError(e.message);} finally{setBusy(null);}
  };
  if (!reporte.actual) return <div style={{...card,textAlign:"center",color:C.muted}}>No hay datos para esta semana.</div>;
  const accionables=reporte.filas.filter(f=>!f.muestraChica).length, criticos=reporte.filas.filter(f=>f.critico&&!f.muestraChica).length, reincidentes=reporte.filas.filter(f=>f.reincidente&&!f.muestraChica).length;
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{padding:"1px 0 3px"}}><div style={{fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",fontSize:18,fontWeight:650,letterSpacing:"-.15px",lineHeight:1.25,color:C.white}}>Seguimiento semanal de cadetes</div><div style={{color:"rgba(255,255,255,.68)",fontSize:12.5,fontWeight:400,lineHeight:1.4,marginTop:5}}>SLA Meli de {semanaActiva}{reporte.anterior?` · comparado con ${reporte.anterior.label}`:" · sin semana anterior"}</div></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10}}>
      {[["Para contactar",accionables,C.red],["Críticos",criticos,C.red],["Reincidentes",reincidentes,C.amber],["Mensajes enviados",enviados.length,C.teal]].map(([l,v,c])=><div key={l} style={card}><div style={{color:C.muted,fontSize:11,textTransform:"uppercase"}}>{l}</div><div style={{color:c,fontSize:24,fontWeight:700,letterSpacing:"-.3px",fontVariantNumeric:"tabular-nums",marginTop:5}}>{v}</div></div>)}
    </div>
    <div style={{...card,padding:"11px 14px",color:C.muted,fontSize:12,lineHeight:1.5}}>Se muestran todos los cadetes debajo de {SEGUIMIENTO_CFG.slaObjetivo}%. Con menos de {SEGUIMIENTO_CFG.minMl} envíos ML se marca <b style={{color:C.amber}}>muestra chica</b>. Las direcciones se ven solo acá; no se copian al mensaje.</div>
    {error&&<div style={{background:"rgba(226,75,74,.1)",border:"1px solid rgba(226,75,74,.3)",borderRadius:10,padding:"10px 14px",color:C.red,fontSize:13}}>{error}</div>}
    {reporte.filas.length===0?<div style={{...card,textAlign:"center",padding:"2.5rem",color:C.teal}}><i className="ti ti-circle-check" style={{fontSize:34,display:"block",marginBottom:8}}/>Todos los cadetes quedaron en 98% o más.</div>:reporte.filas.map(f=>{
      const enviado=enviadosMap.get(f.cadete), color=f.critico?C.red:C.amber, detalles=[...f.demoradosDetalle.map(d=>({...d,tipo:"Demorado"})),...f.dem21Detalle.map(d=>({...d,tipo:"Repro 21"}))];
      const trend=f.delta===null?"Sin comparación":`${f.delta>=.1?"↑":f.delta<=-.1?"↓":"→"} ${f.delta>0?"+":""}${fmt(f.delta)} pp`;
      return <div key={f.cadete} style={{...card,borderColor:enviado?"rgba(46,207,170,.38)":f.critico?"rgba(226,75,74,.34)":C.border}}>
        <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>{esAdmin&&<button aria-label={`Configurar ${f.cadete}`} aria-expanded={configCadete===f.cadete} title="Configurar cadete" onClick={()=>setConfigCadete(configCadete===f.cadete?null:f.cadete)} style={botonIcono(configCadete===f.cadete)}><i className="ti ti-settings"/></button>}<div style={{flex:"1 1 240px"}}>
          <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}><b style={{color:C.white,fontSize:15}}>{f.cadete}</b>{f.critico&&<small style={{color:C.red,fontWeight:800}}>CRÍTICO</small>}{f.reincidente&&<small style={{color:C.amber,fontWeight:800}}>REINCIDENTE</small>}{f.muestraChica&&<small style={{color:C.amber,fontWeight:800}}>MUESTRA CHICA</small>}{enviado&&<small style={{color:C.teal,fontWeight:800}}>✓ ENVIADO {fechaEnvio(enviado.enviado_at)}</small>}</div>
          <div style={{display:"flex",gap:13,flexWrap:"wrap",color:C.muted,fontSize:12,marginTop:6}}><span>{f.enviosMl} ML</span><span>{plural(f.demorados,"demorado")}</span><span>{plural(f.dem21,"repro 21","repro 21")}</span><span style={{color:f.delta!==null&&f.delta>=.1?C.teal:f.delta!==null&&f.delta<=-.1?C.red:C.muted}}>{trend}</span></div>
        </div><div style={{textAlign:"right"}}><div style={{color,fontFamily:'"Space Grotesk",sans-serif',fontSize:22,fontWeight:700,letterSpacing:"-.4px",fontVariantNumeric:"tabular-nums"}}>{fmt(f.sla)}%</div><div style={{color:C.muted,fontSize:10,fontVariantNumeric:"tabular-nums"}}>{f.slaAnterior===null?"sin dato anterior":`antes ${fmt(f.slaAnterior)}%`}</div></div></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}><button onClick={()=>copiar(f)} style={boton(C.teal)}>{copiado===f.cadete?"✓ Copiado":"Copiar mensaje"}</button><button onClick={()=>toggle(f)} disabled={busy===f.cadete} style={boton(enviado?C.teal:C.muted)}>{busy===f.cadete?"Guardando…":enviado?"Desmarcar enviado":"Marcar enviado"}</button><button onClick={()=>setAbierto(abierto===f.cadete?null:f.cadete)} style={boton(C.muted)}>{abierto===f.cadete?"Ocultar detalle":`Ver ${plural(detalles.length,"caso")}`}</button></div>
        {configCadete===f.cadete&&<div style={{marginTop:10,padding:"10px 12px",borderRadius:9,background:"rgba(255,255,255,.035)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,color:C.muted,fontSize:12}}><span>Configuración del cadete</span><button disabled={busy===`baja:${f.cadete}`} onClick={()=>baja(f)} style={boton(C.red)}>{busy===`baja:${f.cadete}`?"Ocultando…":"Ocultar del seguimiento"}</button></div>}
        {abierto===f.cadete&&<div style={{marginTop:12,display:"grid",gap:8}}><div style={{background:"rgba(0,0,0,.2)",borderRadius:9,padding:"12px 14px",whiteSpace:"pre-wrap",color:"rgba(255,255,255,.82)",fontSize:12.5,lineHeight:1.55}}>{mensajeCadete(f)}</div>{detalles.map((d,j)=><div key={`${d.id}-${j}`} style={{padding:"8px 10px",borderRadius:8,background:"rgba(255,255,255,.035)",color:C.muted,fontSize:11.5}}><b style={{color:d.tipo==="Repro 21"?C.amber:C.red,marginRight:9}}>{d.tipo}</b> #{d.id} · <span style={{color:"rgba(255,255,255,.8)"}}>{d.dir||"Sin dirección"}</span></div>)}</div>}
      </div>;
    })}
    {esAdmin&&inactivos.length>0&&<div style={{...card,padding:"10px 14px",marginTop:8}}><button onClick={()=>setVerInactivos(x=>!x)} style={{...boton(C.muted),width:"100%",textAlign:"left"}}>{verInactivos?"Ocultar": "Ver"} cadetes dados de baja ({inactivos.length})</button>{verInactivos&&<div style={{display:"grid",gap:8,marginTop:10}}>{inactivos.map(x=><div key={x.cadete} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,color:C.muted,fontSize:12}}><span><b style={{color:C.white}}>{x.cadete}</b>{x.motivo?` · ${x.motivo}`:""}</span><button disabled={busy===`alta:${x.cadete}`} onClick={()=>alta(x.cadete)} style={boton(C.teal)}>{busy===`alta:${x.cadete}`?"Reactivando…":"Reactivar"}</button></div>)}</div>}</div>}
  </div>;
}

function boton(color){
  const teal=color===C.teal;
  return { border:`1px solid ${teal?"rgba(46,207,170,.42)":"rgba(255,255,255,.18)"}`, background:teal?"rgba(46,207,170,.08)":"rgba(255,255,255,.04)", color, borderRadius:8, padding:"8px 13px", cursor:"pointer", fontWeight:700 };
}
function botonIcono(activo){return{width:32,height:32,borderRadius:8,border:`1px solid ${activo?"rgba(46,207,170,.38)":"rgba(255,255,255,.12)"}`,background:activo?"rgba(46,207,170,.1)":"rgba(255,255,255,.03)",color:activo?C.teal:C.muted,cursor:"pointer",display:"grid",placeItems:"center",fontSize:15,flexShrink:0};}
