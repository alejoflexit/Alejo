import React, { useState } from "react";
import { createPortal } from "react-dom";
import { demoraTotal } from "./demoraTotalShared";

export default function DemoraTotalCell({ metricas }) {
  const [pos, setPos] = useState(null);
  const dato = demoraTotal(metricas);
  const abrir = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(rect.right - 300, window.innerWidth - 308)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 260)) });
  };
  return <>
    <button type="button" aria-label={`Demora total de ${metricas.cadete}`} aria-expanded={!!pos}
      onMouseEnter={abrir} onMouseLeave={() => setPos(null)} onFocus={abrir} onBlur={() => setPos(null)}
      onClick={abrir} onKeyDown={e => { if (e.key === "Escape") setPos(null); }}
      style={{ background:"none", border:0, color:"inherit", font:"inherit", cursor:"pointer", padding:"4px 0", whiteSpace:"nowrap" }}>
      {dato ? `${dato.porcentaje.toLocaleString("es-AR", { minimumFractionDigits:1, maximumFractionDigits:1 })}%` : "—"} ⓘ
    </button>
    {pos && createPortal(<div role="tooltip" style={{ position:"fixed", ...pos, width:300, boxSizing:"border-box", zIndex:10000, padding:14, borderRadius:10, background:"#172b45", color:"#fff", border:"1px solid #536278", boxShadow:"0 8px 24px #0006", fontSize:13, lineHeight:1.5, pointerEvents:"none" }}>
      <strong>{dato ? `${dato.afectados} de ${dato.total} paquetes` : "Demora total no disponible"}</strong>
      {dato ? <><div>Mercado Libre: <b>{dato.meli}</b> (demorados + Repro 21hs)</div><div>Particulares Flexit: <b>{dato.flexit}</b></div></> : <div>{metricas.cantidad > 0 ? "Faltan datos de particulares en uno o más días del período. No equivale a cero demoras." : "No hay paquetes en este período."}</div>}
      <div style={{ marginTop:8, opacity:0.8 }}>Flexit: estado vacío, En camino o En planta.</div>
      <div style={{ marginTop:8 }}>Menor porcentaje = mejor resultado.</div>
    </div>, document.body)}
  </>;
}
