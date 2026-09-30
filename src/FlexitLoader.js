import React from "react";
import "./FlexitLoader.css";

// Animación de carga "La entrega": camioneta Flexit turquesa que deja una caja en una casa.
// Elegida por Alejo el 29/09 (opción E con camioneta J) a partir de la referencia
// work/propuestas/flexit-loader/flexit-en-camino.html, con los colores de flexit.ar.
// La marca de arriba (flechitas + "flexit") es decorativa: no reemplaza los logos de la app.
//
// Accesibilidad: un solo role="status" con texto fijo, así el lector de pantalla lo
// anuncia una vez al aparecer y no en cada ciclo. La escena es CSS puro y está oculta
// con aria-hidden. Con prefers-reduced-motion queda quieta.
const VAN = { body: "#02C4B8", shade: "#019A91", stripe: "#97E4C7", ink: "#0F0241" };

function Chevrons({ width, height, color, strokeWidth = 3.4 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 20" fill="none" aria-hidden="true">
      <path d="M3 3l7 7-7 7M12 3l7 7-7 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Wheel({ cx }) {
  return (
    <g className="fx-wheel">
      <circle cx={cx} cy="50" r="9.5" fill="#141925" />
      <circle cx={cx} cy="50" r="5.8" fill="#C9D3DF" />
      <path d={`M${cx} 45.2V54.8M${cx - 4.2} 47.6L${cx + 4.2} 52.4M${cx - 4.2} 52.4L${cx + 4.2} 47.6`} stroke="#8A97A8" strokeWidth="1.3" />
      <circle cx={cx} cy="50" r="1.8" fill="#5B6676" />
    </g>
  );
}

function Van() {
  return (
    <svg className="fx-van" width="130" height="62" viewBox="0 0 130 62" fill="none">
      <ellipse cx="64" cy="60" rx="56" ry="2.5" fill="rgba(0,0,0,.45)" />
      <path d="M6 13Q6 6 13 6H86Q93 6 98 11.5L112 27Q119 29.5 121 35V45Q121 50 116 50H10Q6 50 6 46Z" fill={VAN.body} />
      <path d="M6 38H121V45Q121 50 116 50H10Q6 50 6 46Z" fill={VAN.shade} />
      <rect x="6" y="36" width="115" height="3" fill={VAN.stripe} />
      <path d="M13 7.5H86" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M88 12H93Q95.5 12 97.5 14.5L108 27.5H88Z" fill="#0F0241" />
      <path d="M90 14.5L94 14.5" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M84 9V47" stroke="rgba(15,2,65,.22)" strokeWidth="1" />
      <rect x="100" y="31" width="5" height="1.6" rx=".8" fill="rgba(15,2,65,.35)" />
      <rect x="115" y="30.5" width="5.5" height="4" rx="1.5" fill="#FFE7A3" />
      <rect x="6" y="28" width="2.5" height="7" rx="1" fill="#FF7A7A" />
      <rect x="114" y="44" width="8" height="5" rx="1.5" fill="#0F0241" />
      <path d="M21 17l5.5 5.5L21 28M29 17l5.5 5.5L29 28" stroke={VAN.ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="38" y="27" fill={VAN.ink} fontFamily="Poppins, system-ui, sans-serif" fontSize="15" fontWeight="700" letterSpacing="-.5">flexit</text>
      <circle cx="27" cy="50" r="12" fill="#0D1F37" />
      <circle cx="99" cy="50" r="12" fill="#0D1F37" />
      <Wheel cx={27} />
      <Wheel cx={99} />
    </svg>
  );
}

export default function FlexitLoader({
  label = "Cargando…",
  sub = "Un momento, estamos consultando los datos.",
  eyebrow = null,
  style,
}) {
  return (
    <div className="fx-loader" role="status" aria-live="polite" style={style}>
      {eyebrow && <span className="fx-eyebrow" aria-hidden="true">{eyebrow}</span>}
      <div className="fx-brand" aria-hidden="true">
        <Chevrons width={30} height={25} color="#02C4B8" />
        <span>flexit</span>
      </div>
      <div className="fx-scene" aria-hidden="true">
        <div className="fx-roof" />
        <div className="fx-house" />
        <div className="fx-door" />
        <div className="fx-road" />
        <div className="fx-box" />
        <Van />
        <div className="fx-ok">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#0F0241" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className="fx-label">{label}</div>
      {sub && <div className="fx-sub">{sub}</div>}
    </div>
  );
}
