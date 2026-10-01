import React from "react";
import "./FlexitLoader.css";

// Animación de carga "Recorrido": la camioneta Flexit turquesa cruza la ciudad de noche y
// entrega en una casa, un edificio y un local (opción P + cielo de la O, 30/09).
// Elegida por Alejo el 29/09 (opción E con camioneta J) a partir de la referencia
// work/propuestas/flexit-loader/flexit-en-camino.html, con los colores de flexit.ar.
// Arriba va el logo oficial de Flexit (letras en blanco por el fondo oscuro); es decorativo
// y no reemplaza los logos de la app.
//
// Accesibilidad: un solo role="status" con texto fijo, así el lector de pantalla lo
// anuncia una vez al aparecer y no en cada ciclo. La escena es CSS puro y está oculta
// con aria-hidden. Con prefers-reduced-motion queda quieta.
const VAN = { body: "#02C4B8", shade: "#019A91", stripe: "#97E4C7", ink: "#0F0241" };

// Logo oficial de Flexit (el mismo SVG de flexit.ar, copia en src/assets/flexit-logo.svg).
// "word": letras (#0F0241 en el original); el resto son las flechas en degradé.
const LOGO_PATHS = [
  { word: true, fill: "#0F0241", d: "M234.446 34.42c16.655-.737 29.075 4.518 36.717 19.99 2.888 5.848 4.935 18.996 2.754 25.076-10.862.686-22.81-.272-33.791.096-6.01.2-12.867.105-18.85-.164 4.19 12.894 19.216 15.822 30.614 9.578 1.262-.692 3.067-2.711 4.373-3.746 2.329.525 4.71 2.223 6.881 3.427 1.575 1.051 6.442 3.915 8.021 4.688-.819 2.05-1.873 3.31-3.285 4.968-11.122 13.058-38.972 13.94-51.944 3.377-25.258-20.565-16.172-62.852 18.51-67.29m-13.681 30.555h18.218c2.366.008 16.02.336 16.991-.442 0-1.192-1.054-3.334-1.588-4.429-2.83-5.791-9.269-8.972-15.556-8.938q-.28 0-.561.028c-9.503.493-14.654 4.832-17.504 13.781" },
  { word: true, fill: "#0F0241", d: "M307.535 55.652a519 519 0 0 1 13.408-18.514c.778-1.029 7.077-.729 8.686-.725l12.776.045c-.172.494-.464 1.28-.758 1.707-6.622 9.602-13.778 18.826-20.321 28.483-1.037 1.530-1.720 2.586-3.066 3.855 1.139 2.079 24.136 34.862 25.445 35.779.08.057.097.221.124.318-.559.253-1.942.283-2.619.328-6.069.012-12.438.113-18.483-.032-2.960-2.493-9.106-12.486-11.907-15.980-1.148-1.436-2.061-3.210-3.568-4.560a472 472 0 0 0-8.982 12.524c-1.656 2.341-3.329 5.016-5.314 7.072-1.200 1.215-3.664 1.030-5.291 1.010-5.676-.069-11.513.118-17.172-.137 1.745-1.861 7.675-10.372 9.395-12.840 5.347-7.664 11.389-15.522 16.604-23.215-1-1.112-2.631-3.503-3.550-4.770l-7.856-11.044-7.421-10.223c-1.643-2.250-4.378-5.876-5.591-8.321 6.191.404 15.782-.510 21.565.168l8.711 12.170c1.252 1.756 3.759 5.429 5.185 6.902M164.95 6.296l4.863-.046c-.310 4.630-.059 12.460-.044 17.313l-.161-.004c-8.819-.142-14.543 3.520-14.622 12.853l11.656.050c-.280 2.956-.289 14.744.043 17.452-2.732-.190-8.636.032-11.675.040l.018 52.994c-3.772-.060-7.688-.009-11.472-.013l-7.213.017c.138-3.745.011-8.357.009-12.167L136.344 69c-.001-4.880-.100-10.171.066-15.023a363 363 0 0 0-9.952-.012q-.105-8.761.002-17.522l9.975-.031c-.760-18.574 10.283-29.216 28.515-30.116m237.238 10.513.356.176c-.236 5.350-.126 14.055.029 19.395 5.239.130 10.797.061 16.059.072-.163 2.630-.248 15.200.137 17.457-5.099-.136-11.143.036-16.289.079.157 1.812.039 5.485.035 7.425l-.019 14.440c-.004 15.166 1.427 14.537 16.122 14.312-.323 4.349-.073 12.086-.029 16.642-4.656 1.135-8.692.803-13.462.761-21.762-1.860-21.089-15.450-21.091-33.223l.004-20.402-12.004.019-.002-17.494c3.968-.082 8.121-.035 12.106-.050-.083-4.633-.247-9.654.095-14.265a9 9 0 0 1 1.749-.661c5.396-1.447 10.727-3.585 16.204-4.683M175.157 6.256h18.763c-.361 2.834-.115 10.940-.110 14.280l-.001 28.951.006 37.422c-.006 5.400-.321 15.140.152 20.082-1.457-.173-4.914-.075-6.487-.073l-12.328.050z" },
  { word: false, fill: "#60C9C6", d: "M49.498 37.584c1.636 1.727 12.73 17.842 13.24 19.681-.082.671-.728 1.819-1.118 2.397-2.778 4.125-5.655 8.252-8.518 12.32-.625.888-2.733 4.164-3.261 4.66-2.643 2.683-13.48 20.021-15.44 20.562-1.384.383-24.757.307-25.435-.098-.219-.13-.427-.543-.481-.783-.172-.764.142-1.907.505-2.588 1.476-2.774 4.67-6.77 6.617-9.458L27.08 68.369c2.38-3.267 6.034-8.053 8.02-11.375l.207-.005c4.88-6.141 9.451-13.053 14.19-19.405Z" },
  { word: false, fill: "#02C4B8", d: "M49.497 37.584c1.636 1.727 12.73 17.842 13.241 19.681-.082.671-.729 1.819-1.118 2.397-2.779 4.125-5.655 8.252-8.518 12.32-.626.888-2.734 4.164-3.262 4.66-3.542-3.069-7.557-9.953-10.427-13.848-1.273-1.727-3.29-3.982-4.106-5.805 4.879-6.141 9.45-13.053 14.19-19.405" },
  { word: false, fill: "#60C9C6", d: "M46.681 17.155c4.385-.28 9.753-.07 14.234-.134 2.568-.036 8.233-.137 10.526.189 2.125 2.454 5.74 7.848 7.744 10.71 2.392 3.417 5.266 6.966 7.533 10.25 1.122 1.167 2.506 3.415 3.462 4.82l4.529 6.535c1.466 2.137 4.528 5.727 5.222 8.02C98.47 59.64 87.1 76.378 86.356 76.83c-5.189-6.032-9.337-13.197-14.32-19.397l-.295.067c-.714-1.442-1.604-2.764-2.584-4.039-5.633-7.392-10.837-15.125-16.198-22.716-2.24-3.173-6.995-8.765-7.913-12.361.38-.34 1.192-.904 1.635-1.229" },
  { word: false, fill: "#02C4B8", d: "M86.718 38.17c1.122 1.167 2.506 3.415 3.462 4.82l4.529 6.535c1.466 2.137 4.528 5.727 5.222 8.02C98.47 59.64 87.1 76.378 86.356 76.83c-5.189-6.032-9.337-13.197-14.32-19.397.15-1.07 4.07-5.874 4.865-6.86 2.075-2.569 7.03-11.199 9.817-12.403" },
  { word: true, fill: "#0F0241", d: "m347.989 36.46 18.392-.02c.269 6.284-.031 14.904-.031 21.397l.051 49.078-18.421.041z" },
  { word: false, fill: "#97E4C7", d: "M72.036 57.433c4.983 6.2 9.131 13.365 14.32 19.397-.935.93-3.124 4.307-4.035 5.61-2.98 4.262-5.931 8.604-9.03 12.782-.815.914-1.383 2.072-2.727 2.112-7.608.231-15.258-.089-22.869.133-.876.121-2.823-.907-2.533-1.91.418-1.441 1.817-3.655 2.679-4.847a2440 2440 0 0 0 18.953-26.59c1.436-2.042 3.284-4.777 4.947-6.618zM35.1 56.995c-6.09-8.049-11.677-16.14-17.543-24.344l-5.79-8.039c-.93-1.266-2.01-2.497-2.841-3.826-.314-.502-.56-1.048-.562-1.65-.003-.538.3-1.054.676-1.422 1.13-1.108 22.242-.668 25.404-.675 1.65 1.515 6.062 8.043 7.684 10.394 2.338 3.39 5.033 6.84 7.37 10.151-4.74 6.353-9.311 13.264-14.19 19.405z" },
  { word: true, fill: "#0F0241", d: "M354.79 5.727a11.46 11.46 0 0 1 10.948 3.784 11.45 11.45 0 0 1 2.054 11.395 11.46 11.46 0 0 1-8.941 7.362c-6.166.99-11.989-3.137-13.095-9.28-1.107-6.142 2.911-12.039 9.034-13.26Z" },
];

// wordInk: color de las letras. iconInk: si se pasa, las flechas van de un solo color
// (sobre la camioneta turquesa el degradé no se distinguiría).
function FlexitLogo({ height, wordInk = "#0F0241", iconInk = null, ...rest }) {
  return (
    <svg height={height} width={(height * 424) / 114} viewBox="0 0 424 114" fill="none" aria-hidden="true" {...rest}>
      {LOGO_PATHS.map((p, i) => <path key={i} d={p.d} fill={p.word ? wordInk : (iconInk || p.fill)} />)}
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

// Camioneta: SVG anidado dentro de la escena (unidades de la escena).
function Van({ x = 0, y = 0, scale = 1 }) {
  return (
    <svg x={x} y={y} width={130 * scale} height={62 * scale} viewBox="0 0 130 62" fill="none" overflow="visible">
      <ellipse cx="64" cy="60" rx="56" ry="2.5" fill="rgba(0,0,0,.45)" />
      <path d="M6 13Q6 6 13 6H86Q93 6 98 11.5L112 27Q119 29.5 121 35V45Q121 50 116 50H10Q6 50 6 46Z" fill={VAN.body} />
      <path d="M6 38H121V45Q121 50 116 50H10Q6 50 6 46Z" fill={VAN.shade} />
      <rect x="6" y="36" width="115" height="3" fill={VAN.stripe} />
      <path d="M13 7.5H86" stroke="rgba(255,255,255,.28)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M88 12H93Q95.5 12 97.5 14.5L108 27.5H88Z" fill="#0F0241" />
      {/* Chofer en la cabina y su brazo, que asoma por la ventanilla para revolear la caja */}
      <circle cx="94.5" cy="21.5" r="3.6" fill="#E8B48A" />
      <path d="M90.6 20.2Q91 16.6 94.6 16.4Q98.2 16.6 98.6 20.2Z" fill="#02C4B8" />
      <rect x="97.6" y="19.2" width="3.4" height="1.2" rx=".6" fill="#02C4B8" />
      <g className="fx-arm">
        <path d="M99 23L114 12" stroke="#0F0241" strokeWidth="4.2" strokeLinecap="round" />
        <path d="M111.6 13.8L113.8 12.2" stroke="#02C4B8" strokeWidth="4.4" strokeLinecap="round" />
        <circle cx="116" cy="10.6" r="2.9" fill="#E8B48A" />
      </g>
      <path d="M90 14.5L94 14.5" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M84 9V47" stroke="rgba(15,2,65,.22)" strokeWidth="1" />
      <rect x="100" y="31" width="5" height="1.6" rx=".8" fill="rgba(15,2,65,.35)" />
      <rect x="115" y="30.5" width="5.5" height="4" rx="1.5" fill="#FFE7A3" />
      <rect x="6" y="28" width="2.5" height="7" rx="1" fill="#FF7A7A" />
      <rect x="114" y="44" width="8" height="5" rx="1.5" fill="#0F0241" />
      <FlexitLogo x="17" y="12" height={18} wordInk={VAN.ink} iconInk={VAN.ink} />
      <circle cx="27" cy="50" r="12" fill="#0D1F37" />
      <circle cx="99" cy="50" r="12" fill="#0D1F37" />
      <Wheel cx={27} />
      <Wheel cx={99} />
    </svg>
  );
}

// ---- Escena a todo el ancho: "Recorrido con 3 entregas" sobre la ciudad de noche ----
// Opción P + cielo de la opción O, elegidas por Alejo el 30/09. Unidades de la escena:
// 1400 × 300, calle en y = 250. El SVG se recorta a los costados en pantallas angostas
// (preserveAspectRatio "slice"), así que en el celular queda centrado en el edificio.
const W = 1400;
const ROAD = 250;
const LIT = "#FFE7A3";
const GLASS = "#0B2340";
const WALL = "#1E3A60";
const WALL2 = "#17304F";

// Generador pseudoaleatorio con semilla fija: la ciudad es siempre la misma.
function seeded(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CITY = (() => {
  const r = seeded(11);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const blocks = [];
  const windows = [];
  for (let x = -20; x < W + 20;) {
    const w = int(46, 96), h = int(50, 150);
    blocks.push({ x, y: ROAD - h, w, h });
    for (let wy = ROAD - h + 12; wy < ROAD - 14; wy += 16) {
      for (let wx = x + 8; wx < x + w - 10; wx += 14) {
        if (r() < 0.18) windows.push({ x: wx, y: wy, twinkle: r() < 0.25, delay: (r() * 6).toFixed(1) });
      }
    }
    x += w + int(4, 18);
  }
  const stars = Array.from({ length: 40 }, () => ({ x: int(0, W), y: int(40, 125) }));
  return { blocks, windows, stars };
})();

function NightCity() {
  return (
    <g>
      {CITY.stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r="1.4" fill="#E4EEEB" opacity=".5" />)}
      <circle cx="1180" cy="78" r="26" fill="#E4EEEB" opacity=".9" />
      <circle cx="1192" cy="70" r="24" fill="#0D1F37" />
      {CITY.blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="#112645" opacity=".75" />)}
      {CITY.windows.map((w, i) => (
        <rect key={i} className={w.twinkle ? "fx-tw" : undefined} style={w.twinkle ? { animationDelay: `-${w.delay}s` } : undefined}
          x={w.x} y={w.y} width="6" height="7" rx="1" fill={LIT} opacity=".7" />
      ))}
      {[90, 320, 550, 780, 1010, 1240].map(lx => (
        <g key={lx}>
          <path d={`M${lx} ${ROAD}V${ROAD - 62}Q${lx} ${ROAD - 70} ${lx + 10} ${ROAD - 70}H${lx + 16}`} stroke="#2C4E78" strokeWidth="3" fill="none" strokeLinecap="round" />
          <ellipse cx={lx + 16} cy={ROAD - 67} rx="6" ry="3" fill={LIT} />
        </g>
      ))}
      <rect x="0" y={ROAD} width={W} height="2" fill="rgba(255,255,255,.16)" />
      <rect x="0" y={ROAD + 2} width={W} height="40" fill="rgba(255,255,255,.025)" />
      <path d={`M0 ${ROAD + 22}H${W}`} stroke="rgba(255,255,255,.12)" strokeWidth="2" strokeDasharray="26 22" />
    </g>
  );
}

// Destinos (escala 1,5). Cada puerta se ilumina cuando le llega su caja.
function House({ x, y, door }) {
  // Casa: techo macizo con alero, frontón relleno (con ventanita redonda) y arbustos apoyados en el piso.
  return (
    <svg x={x} y={y} width={92 * 1.5} height={73 * 1.5} viewBox="0 0 92 73" fill="none">
      <rect x="63" y="9" width="8" height="18" fill="#0F0241" />
      <rect x="61" y="7" width="12" height="3" rx="1" fill="#0F0241" />
      <path d="M10 33L46 11L82 33V73H10Z" fill={WALL} />
      <path d="M54 33H82V73H54Z" fill={WALL2} />
      <path d="M46 11L82 33H54Z" fill={WALL2} opacity=".55" />
      <circle cx="46" cy="25" r="4.2" fill={LIT} opacity=".9" />
      <path d="M41.8 25H50.2M46 20.8V29.2" stroke={WALL} strokeWidth="1.2" />
      <path d="M0 35L46 5L92 35L86 37L46 11.5L6 37Z" fill="#0F0241" />
      <path d="M46 5L92 35" stroke="#02C4B8" strokeWidth="1.2" opacity=".45" />
      <rect x="15" y="42" width="17" height="13" rx="2" fill={LIT} />
      <path d="M23.5 42V55M15 48.5H32" stroke={WALL} strokeWidth="1.6" />
      <rect x="60" y="42" width="16" height="11" rx="2" fill={LIT} opacity=".75" />
      <path d="M68 42V53" stroke={WALL2} strokeWidth="1.6" />
      <rect className={door} x="37" y="48" width="15" height="25" rx="2" fill="#2C4E78" />
      <circle cx="48.5" cy="61" r="1.2" fill={LIT} />
      <rect x="34" y="71" width="21" height="2" rx="1" fill="#2C4E78" />
      <path d="M1 73Q1 64 8 64Q15 64 15 73Z" fill="#019A91" />
      <path d="M5 73Q5 67 11 67Q17 67 17 73Z" fill="#02C4B8" opacity=".8" />
      <path d="M77 73Q77 65 83.5 65Q90 65 90 73Z" fill="#019A91" />
    </svg>
  );
}

const BUILDING_LIT = new Set(["0,0", "1,2", "2,1", "0,3", "2,3", "1,0"]);
function Building({ x, y, door }) {
  const wins = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    wins.push(<rect key={`${r}-${c}`} x={16 + c * 18} y={12 + r * 14} width="11" height="9" rx="1.5" fill={BUILDING_LIT.has(`${r},${c}`) ? LIT : GLASS} />);
  }
  return (
    <svg x={x} y={y} width={84 * 1.5} height={90 * 1.5} viewBox="0 0 84 90" fill="none">
      <rect x="8" y="4" width="68" height="86" fill={WALL} />
      <rect x="56" y="4" width="20" height="86" fill={WALL2} opacity=".6" />
      <rect x="5" y="2" width="74" height="5" rx="1" fill="#0F0241" />
      {wins}
      <rect className={door} x="34" y="70" width="16" height="20" rx="1.5" fill="#2C4E78" />
      <path d="M42 70V90" stroke={WALL} strokeWidth="1.2" />
      <rect x="60" y="72" width="10" height="7" rx="1.5" fill="#0F0241" />
      <rect x="62" y="74" width="6" height="1.5" fill="#02C4B8" />
    </svg>
  );
}

function Shop({ x, y, door }) {
  return (
    <svg x={x} y={y} width={92 * 1.5} height={78 * 1.5} viewBox="0 0 92 78" fill="none">
      <rect x="6" y="10" width="80" height="68" fill={WALL} />
      <rect x="4" y="6" width="84" height="7" rx="1.5" fill="#0F0241" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d={`M${6 + i * 10} 18H${16 + i * 10}V26Q${11 + i * 10} 30 ${6 + i * 10} 26Z`} fill={i % 2 === 0 ? "#02C4B8" : "#E4EEEB"} />
      ))}
      <rect x="10" y="36" width="24" height="30" rx="2" fill={GLASS} />
      <rect x="14" y="42" width="6" height="6" rx="1" fill="#C98E4E" />
      <rect x="22" y="44" width="5" height="4" rx="1" fill="#E9C48F" />
      <rect x="36" y="40" width="18" height="38" rx="2" fill="#2C4E78" />
      <rect className={door} x="38" y="43" width="14" height="33" rx="1" fill={GLASS} />
      <rect x="58" y="36" width="24" height="30" rx="2" fill={GLASS} />
      <path d="M61 44Q70 38 79 44" stroke={LIT} strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

function Box({ className }) {
  return (
    <g className={className}>
      <rect width="22" height="22" rx="4" fill="#C98E4E" />
      <rect x="8" width="6" height="22" fill="#E9C48F" />
    </g>
  );
}

function Check({ cx, cy, className }) {
  return (
    <g className={className}>
      <circle cx={cx} cy={cy} r="21" fill="#02C4B8" opacity=".18" />
      <circle cx={cx} cy={cy} r="16" fill="#02C4B8" />
      <path d={`M${cx - 7} ${cy + 1}l5 5l10-11`} stroke="#0F0241" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function DeliveryRoute() {
  return (
    <svg className="fx-route" viewBox={`0 0 ${W} 300`} preserveAspectRatio="xMidYMax slice" fill="none" aria-hidden="true">
      <NightCity />
      <House x={390} y={ROAD - 73 * 1.5} door="fx-door0" />
      <Building x={780} y={ROAD - 90 * 1.5} door="fx-door1" />
      <Shop x={1150} y={ROAD - 78 * 1.5} door="fx-door2" />
      <g className="fx-van"><Van y={ROAD - 95} scale={1.6} /></g>
      <Box className="fx-box0" />
      <Box className="fx-box1" />
      <Box className="fx-box2" />
      <Check className="fx-ok0" cx={507} cy={145} />
      <Check className="fx-ok1" cx={900} cy={119} />
      <Check className="fx-ok2" cx={1270} cy={137} />
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
        <FlexitLogo height={44} wordInk="#FFFFFF" />
      </div>
      <DeliveryRoute />
      <div className="fx-label">{label}</div>
      {sub && <div className="fx-sub">{sub}</div>}
    </div>
  );
}
