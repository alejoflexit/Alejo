import React from "react";
import "./HistorialLoader.css";

// Carga inicial de la app: camioncito neón miniatura + paquetitos que se le van saliendo.
// (El FlexitLoader grande con la ciudad queda solo para Pendientes históricos.)
function Rueda({ cx }) {
  return (
    <g className="hl-wh">
      <circle cx={cx} cy="48" r="8" fill="#061225" stroke="#02C4B8" strokeWidth="2.4" />
      <path d={`M${cx} 43.5V52.5M${cx - 4.5} 48H${cx + 4.5}`} stroke="#97E4C7" strokeWidth="1.8" />
    </g>
  );
}

function Paquete({ n }) {
  return (
    <g className={`hl-box hl-b${n}`}>
      <rect x="0" y="22" width="15" height="15" rx="2" fill="rgba(151,228,199,.12)" stroke="#97E4C7" strokeWidth="1.8" />
      <path d="M7.5 22V37" stroke="#97E4C7" strokeWidth="1.3" opacity=".7" />
    </g>
  );
}

export default function HistorialLoader({ label = "Cargando historial" }) {
  return (
    <div className="hl-wrap" role="status" aria-live="polite">
      <svg className="hl-van" viewBox="-76 0 260 62" fill="none" aria-hidden="true">
        <path className="hl-sl" d="M-6 18H-30" stroke="#97E4C7" strokeWidth="2" strokeLinecap="round" />
        <path className="hl-sl hl-s2" d="M-4 40H-38" stroke="#97E4C7" strokeWidth="2" strokeLinecap="round" />
        {[0, 1, 2, 3].map(n => <Paquete key={n} n={n} />)}
        <g className="hl-body">
          <path d="M8 14Q8 8 14 8H72Q79 8 84 13L97 26Q105 28 107 34V43Q107 48 102 48H8Z" fill="rgba(2,196,184,.08)" stroke="#02C4B8" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M77 14H81Q83.5 14 86 17L94 26H77Z" fill="rgba(151,228,199,.15)" stroke="#02C4B8" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M20 19l8 9-8 9M32 19l8 9-8 9" stroke="#97E4C7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <Rueda cx={29} />
          <Rueda cx={86} />
        </g>
      </svg>
      <div className="hl-lbl">{label}<span className="hl-dots" /></div>
    </div>
  );
}
