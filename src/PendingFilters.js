import React, { useEffect, useRef, useState } from "react";
import "./PendingFilters.css";

const quick = ["En camino al destinatario", "En planta de procesamiento", "No entregado", "Nadie", "Nadie 2DA visita"];
const shortLabel = value => ({ "En camino al destinatario": "En camino", "En planta de procesamiento": "En planta", "Nadie 2DA visita": "Nadie · 2ª visita" }[value] || value);

export default function PendingFilters({ title, count, service, setService, query, setQuery, courier, setCourier, couriers, states, selectedStates, setSelectedStates, showHistory, showYesterday, criticalOnly, clearCritical }) {
  const [menu, setMenu] = useState(null);
  const root = useRef(null);
  useEffect(() => {
    const close = e => { if (!root.current?.contains(e.target)) setMenu(null); };
    const escape = e => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);
  const toggle = value => setSelectedStates(prev => prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]);
  const extras = states.filter(s => !quick.includes(s));
  const extraCount = selectedStates.filter(s => !quick.includes(s)).length;
  const options = values => <div className="ph-state-menu" role="group" aria-label="Seleccionar estados">
    <button className="ph-clear" onClick={() => setSelectedStates([])}>Todos los estados / limpiar</button>
    {values.map(value => <label key={value}><input type="checkbox" checked={selectedStates.includes(value)} onChange={() => toggle(value)} />{shortLabel(value)}</label>)}
    {!values.length && <span>No hay otros estados disponibles</span>}
  </div>;
  return <div className="ph-filters" ref={root}>
    <div className="ph-heading"><div><h3>{title}</h3><span>{count} envíos</span></div><button className="ph-link" onClick={showHistory}>Ver todo el historial →</button></div>
    <div className="ph-service-row"><div className="ph-service" role="group" aria-label="Tipo de servicio">{["Todos", "Flex", "Particular"].map(value => <button key={value} aria-pressed={service === value} onClick={() => setService(value)}>{value === "Particular" ? "Particulares" : value}</button>)}</div><button className="ph-link" onClick={showYesterday}>Pendientes de ayer</button></div>
    <div className="ph-controls">
      <label className="ph-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar envíos" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar envío, cliente o dirección…" /></label>
      <select aria-label="Cadete asignado" value={courier} onChange={e => setCourier(e.target.value)}><option value="">Todos los cadetes</option>{couriers.map(value => <option key={value} value={value}>{value}</option>)}</select>
      <div className="ph-menu-anchor"><button className="ph-state-trigger" aria-expanded={menu === "all"} onClick={() => setMenu(menu === "all" ? null : "all")}><span>Estados · {selectedStates.length ? `${selectedStates.length} seleccionados` : "Todos"}</span><span aria-hidden="true">⌄</span></button>{menu === "all" && options(states)}</div>
    </div>
    <div className="ph-quick" role="group" aria-label="Filtros rápidos de estado">{quick.map(value => <button key={value} className="ph-state-pill" aria-pressed={selectedStates.includes(value)} onClick={() => toggle(value)}><span className="ph-dot" />{shortLabel(value)}</button>)}<div className="ph-menu-anchor"><button className="ph-state-pill" aria-expanded={menu === "more"} aria-pressed={extraCount > 0} onClick={() => setMenu(menu === "more" ? null : "more")}>＋ Más estados{extraCount ? ` · ${extraCount}` : ""}</button>{menu === "more" && options(extras)}</div></div>
    {criticalOnly && <button className="ph-urgent-filter" onClick={clearCritical}>Flex +48 h · quitar filtro ×</button>}
  </div>;
}
