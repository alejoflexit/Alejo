import React from "react";
import "./HistorialLoader.css";

// Carga inicial de la app: camioncito neón miniatura que deja una estela de partículas.
// (El FlexitLoader grande con la ciudad queda solo para Pendientes históricos.)
function Rueda({ cx }) {
  return (
    <g className="hl-wh">
      <circle cx={cx} cy="48" r="8" fill="#061225" stroke="#02C4B8" strokeWidth="2.4" />
      <path d={`M${cx} 43.5V52.5M${cx - 4.5} 48H${cx + 4.5}`} stroke="#97E4C7" strokeWidth="1.8" />
    </g>
  );
}

export default function HistorialLoader({ label = "Cargando historial" }) {
  return (
    <div className="hl-wrap" role="status" aria-live="polite">
      <svg className="hl-van" viewBox="-76 -30 260 92" fill="none" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <circle key={i} className={`hl-pt hl-p${i}`} cx="4" cy={20 + (i % 3) * 9} r={i % 2 ? 1.8 : 2.6} fill="#97E4C7" />
        ))}
        <g className="hl-body">
          <path d="M8 14Q8 8 14 8H72Q79 8 84 13L97 26Q105 28 107 34V43Q107 48 102 48H8Z" fill="rgba(2,196,184,.08)" stroke="#02C4B8" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M77 14H81Q83.5 14 86 17L94 26H77Z" fill="rgba(151,228,199,.15)" stroke="#02C4B8" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M70 12V45" stroke="#02C4B8" strokeWidth="1.4" opacity=".45" />
          <Rueda cx={29} />
          <Rueda cx={86} />
        </g>
      </svg>
      <div className="hl-lbl">{label}<span className="hl-dots" /></div>
    </div>
  );
}
