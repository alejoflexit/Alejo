import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { puedeVer, esAdmin } from "./permisos";
import { slaMeli } from "./slaShared";
import { useClima, textoNivel, Lluvia } from "./Clima";
import {
  sbFetch, todayStr, minutosAR,
  NOTA_TIPOS, ordenarNotas, resolverNota, posponerNota, useNotasRealtime, aplicarCambioNota, textoNota,
} from "./colectasShared";

// ── Home = Centro de operaciones (spec-home-centro-operaciones, diseño flexit-design "premium"; rediseño 10/10:
// en escritorio menú lateral + fila de indicadores; en el celular indicadores 2×2 y accesos 3×3 abajo).
// El home responde "¿qué requiere mi atención?" y cambia según la franja horaria del día real de
// Alejo: a la mañana el arranque (quién estuvo mal ayer → grupo), al mediodía colectas, los lunes
// la liquidación. La pizarra (notas del equipo) está siempre, con buzón en el header.

// ── Íconos de línea (Lucide, MIT) ──
const ICONS = {
  metricas: (<><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>),
  colectas: (<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>),
  arribos: (<><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></>),
  tiquetera: (<><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></>),
  pizarra: (<><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z" /><path d="M15 3v6h6" /><path d="M8 13h6" /><path d="M8 17h4" /></>),
  pagos: (<><rect width="20" height="12" x="2" y="6" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></>),
  monitoreo: (<><path d="M3 12h4l3 8 4-16 3 8h4" /></>),
  pendientes: (<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" /><path d="M12 7v5l3 2" /></>),
  bell: (<><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>),
  arrow: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  check: (<><path d="M20 6 9 17l-5-5" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>),
  usuarios: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><circle cx="12" cy="10.5" r="2.2" /><path d="M8.5 16.2a4 4 0 0 1 7 0" /></>),
};
const Icon = ({ id, size = 20, color = "currentColor", w = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[id]}</svg>
);

// ── Paleta premium (recetas del skill flexit-design) ──
const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glass: "rgba(27,28,46,0.72)", glassSoft: "rgba(27,28,46,0.6)", pop: "rgba(24,25,42,0.92)",
  line: "rgba(255,255,255,0.06)",
  teal: "#2ee6b6", ambar: "#F5C044", rojo: "#E8615F", azul: "#5BA8E8", lila: "#bd8ed8",
  shadow: "0 20px 60px rgba(0,0,0,0.28)",
  grotesk: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
};
const cardBase = {
  position: "relative", background: C.glass, border: `1px solid ${C.line}`, borderRadius: 20,
  boxShadow: C.shadow, WebkitBackdropFilter: "blur(18px) saturate(140%)", backdropFilter: "blur(18px) saturate(140%)",
};
// slaMeli viene de slaShared.js — una sola definición de la fórmula para toda la app.
const fmt = (n) => Number(n || 0).toLocaleString("es-AR");
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// ── LoginWidget (acceso rápido en el header) ──
function LoginWidget({ session, onLogin, onLogout }) {
  const [open, setOpen] = useState(false);
  const [em, setEm] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const inp = { padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.line}`, background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 13, outline: "none" };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await onLogin(em, pw); setOpen(false); setEm(""); setPw(""); }
    catch { setErr("Email o contraseña incorrectos"); } finally { setBusy(false); }
  };
  if (session) return (
    <button onClick={onLogout} title={session.email} style={{ padding: "8px 12px", borderRadius: 11, border: `1px solid ${C.line}`, background: C.glassSoft, color: C.ink2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Salir</button>
  );
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ padding: "9px 14px", borderRadius: 11, border: "1px solid rgba(46,230,182,0.3)", background: "rgba(46,230,182,0.12)", color: C.teal, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Ingresar</button>
      {open && (
        <form onSubmit={submit} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 250, padding: 14, borderRadius: 16, border: `1px solid ${C.line}`, background: C.pop, boxShadow: C.shadow, zIndex: 60, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>Ingresar al equipo</div>
          <input type="email" autoFocus autoComplete="username" placeholder="Email" value={em} onChange={(e) => { setEm(e.target.value); setErr(""); }} style={inp} />
          <input type="password" autoComplete="current-password" placeholder="Contraseña" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} style={inp} />
          {err && <div style={{ color: C.rojo, fontSize: 11.5 }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ padding: 9, borderRadius: 9, border: "1px solid rgba(46,230,182,0.35)", background: "rgba(46,230,182,0.14)", color: C.teal, fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      )}
    </div>
  );
}

// ── Buzón del equipo (campana + popover con las notas de la pizarra) ──
function Buzon({ notas, onIr, onResolver }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const pendientes = ordenarNotas(notas.filter((n) => !n.resuelta_at));
  const n = pendientes.length;
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ position: "relative", width: 40, height: 40, borderRadius: 12, background: C.glassSoft, border: `1px solid ${C.line}`, color: C.ink2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon id="bell" size={20} />
        {n > 0 && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 11, background: C.rojo, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #0F0F1B", fontFamily: C.grotesk }}>{n}</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", top: 54, right: 0, width: 340, maxWidth: "calc(100vw - 32px)", background: C.pop, border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: "hidden", zIndex: 60, WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
            <span style={{ fontFamily: C.grotesk, fontWeight: 600, fontSize: 14 }}>Buzón del equipo</span>
            <span onClick={() => { setOpen(false); onIr("pizarra"); }} style={{ fontSize: 11.5, color: C.teal, cursor: "pointer", fontWeight: 600 }}>Abrir pizarra →</span>
          </div>
          {n === 0 && <div style={{ padding: "8px 16px 18px", fontSize: 12.5, color: C.ink3 }}>Sin notas pendientes. Todo tranquilo.</div>}
          {pendientes.slice(0, 6).map((nt) => {
            const t = NOTA_TIPOS[nt.tipo] || {};
            const col = nt.tipo === "ausencia" ? C.rojo : nt.tipo === "colecta" ? C.lila : C.azul;
            return (
              <div key={nt.id} style={{ display: "flex", gap: 11, padding: "11px 16px", borderTop: `1px solid ${C.line}` }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.grotesk, fontWeight: 600, fontSize: 12, color: col, background: col + "26" }}>{(nt.autor || "?")[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{nt.autor || "—"} <span style={{ color: C.ink3, fontWeight: 400 }}>· {t.label}</span></div>
                  <div style={{ fontSize: 12.5, color: C.ink2, lineHeight: 1.4, marginTop: 2 }}>{textoNota(nt)}</div>
                  {nt.tipo === "ausencia" && nt.cubre && <div style={{ fontSize: 11, color: C.teal, marginTop: 2 }}>cubre {nt.cubre}</div>}
                </div>
                <button onClick={() => onResolver(nt)} title="Marcar hecho" style={{ alignSelf: "center", border: "1px solid rgba(46,230,182,0.4)", background: "rgba(46,230,182,0.1)", color: C.teal, borderRadius: 9, padding: "6px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>✓</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


const mini = { border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.05)", color: "#fff", borderRadius: 9, padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 34, whiteSpace: "nowrap" };
const miniOk = { ...mini, border: "1px solid rgba(46,230,182,0.4)", color: "#2ee6b6", background: "rgba(46,230,182,0.1)" };

// ── Easter egg: Paco, la mascota secreta de Flexit ──
// Doble clic en el logo del header del Home abre este modal para llevarse el widget de escritorio
// (hosteado en public/paco/ + public/paco-widget.zip). Paco NO aparece en la interfaz normal —
// es solo la sorpresa. El sprite animado (public/paco-sprites.png, 3 frames de 72x161 @2x) vive acá.
function PacoEgg({ onClose }) {
  const [copiado, setCopiado] = useState(false);
  const cmd = "irm https://flota-logistica-iota.vercel.app/paco/instalar.ps1 | iex";
  const copiar = () => {
    try { navigator.clipboard.writeText(cmd); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { }
  };
  return (
    <>
      <style>{`
        .paco-egg-sprite {
          width: 72px; height: 161px; margin: 0 auto 14px;
          background: url(${process.env.PUBLIC_URL || ""}/paco-sprites.png) 0 0 / 216px 161px no-repeat;
          animation: paco-toma-mate 18s infinite;
          image-rendering: pixelated;
        }
        /* 3 frames: reposo → levanta → toma mate → levanta → reposo (mismo ciclo que el widget) */
        @keyframes paco-toma-mate {
          0%, 77.77%                    { background-position: 0 0; }
          77.78%, 80.55%, 97.23%, 100%  { background-position: -72px 0; }
          80.56%, 97.22%                { background-position: -144px 0; }
        }
        @media (prefers-reduced-motion: reduce) { .paco-egg-sprite { animation: none; } }
      `}</style>
      {(
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(8,8,24,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardBase, background: "rgba(24,25,42,0.97)", maxWidth: 440, width: "100%", padding: "26px 28px", color: C.ink, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
            <div className="paco-egg-sprite" aria-hidden="true" />
            <div style={{ fontSize: 19, fontWeight: 700, fontFamily: C.grotesk, marginBottom: 6, textAlign: "center" }}>🧉 ¡Encontraste a Paco!</div>
            <div style={{ fontSize: 13.5, color: C.ink2, lineHeight: 1.5, marginBottom: 18 }}>
              Llevátelo a tu escritorio: queda flotando en la pantalla, siempre visible, tomando mate.
              Doble clic sobre él te abre Flexit. Solo para Windows.
            </div>
            <a href={`${process.env.PUBLIC_URL || ""}/paco-widget.zip`} download="paco-widget.zip"
              style={{ display: "block", textAlign: "center", background: "rgba(46,230,182,0.12)", border: "1px solid rgba(46,230,182,0.4)", color: C.teal, borderRadius: 12, padding: "12px 16px", fontSize: 14, fontWeight: 700, textDecoration: "none", fontFamily: C.grotesk }}>
              ⬇ Descargar instalador (ZIP)
            </a>
            <div style={{ fontSize: 12, color: C.ink3, margin: "8px 0 16px", textAlign: "center" }}>
              Descomprimilo y hacé doble clic en <b>INSTALAR.bat</b>
            </div>
            <div style={{ fontSize: 12, color: C.ink2, marginBottom: 6 }}>O si preferís, pegá esto en PowerShell:</div>
            <div onClick={copiar} title="Clic para copiar"
              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px", fontSize: 11.5, fontFamily: "Consolas, monospace", color: copiado ? C.teal : C.ink2, cursor: "pointer", wordBreak: "break-all" }}>
              {copiado ? "✓ Copiado — pegalo en PowerShell y Enter" : cmd}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: "transparent", color: C.ink2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Piezas visuales del Home (rediseño 10/10: escritorio con menú lateral + fila de indicadores) ──
const tileSt = { ...cardBase, borderRadius: 16, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 9, textAlign: "left", color: C.ink, font: "inherit", minWidth: 0 };
const tileCap = { fontSize: 12, fontWeight: 600, color: C.ink3, display: "flex", alignItems: "center", gap: 6 };
const tileNum = (mobile) => ({ fontFamily: C.grotesk, fontWeight: 600, fontSize: mobile ? 26 : 32, letterSpacing: "-0.8px", lineHeight: 1, fontVariantNumeric: "tabular-nums" });
const tileSub = { fontSize: 12, color: C.ink3, lineHeight: 1.35 };
const cardTitle = { fontSize: 13, fontWeight: 600, color: C.ink2, margin: 0 };

// Tarjeta-indicador. Si tiene onClick es un botón (acceso a su sección); el hover solo cambia el
// color del borde — nada que altere el alto (ver feedback-hover-sin-reflujo).
function Tile({ cap, onClick, irA, children, style }) {
  const props = onClick ? {
    onClick, type: "button", title: irA ? `Ir a ${irA}` : undefined,
    onMouseEnter: (e) => { e.currentTarget.style.borderColor = "rgba(46,230,182,0.35)"; },
    onMouseLeave: (e) => { e.currentTarget.style.borderColor = C.line; },
  } : {};
  const Tag = onClick ? "button" : "div";
  return (
    <Tag {...props} style={{ ...tileSt, cursor: onClick ? "pointer" : "default", transition: "border-color .18s ease", ...style }}>
      <span style={tileCap}>{cap}{onClick && <span style={{ marginLeft: "auto", fontSize: 13, lineHeight: 1 }}>→</span>}</span>
      {children}
    </Tag>
  );
}

const MiniBarra = ({ pct, color }) => (
  <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
    <div style={{ height: "100%", borderRadius: 2, width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width .4s ease" }} />
  </div>
);

// Línea de tendencia chiquita (SLA de los últimos días). Escala propia por serie.
function Sparkline({ valores, color, w = 84, h = 28 }) {
  const v = (valores || []).filter((x) => x != null);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), rango = max - min || 1;
  const pts = v.map((x, i) => [2 + (i * (w - 4)) / (v.length - 1), h - 3 - ((x - min) / rango) * (h - 6)]);
  const ult = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" role="img" aria-label="Tendencia del SLA de los últimos días">
      <polyline points={pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ult[0]} cy={ult[1]} r="2.5" fill={color} />
    </svg>
  );
}

// Ícono del clima según el nivel (reemplaza los emojis ☀️🌦️🌧️⛈️).
function IconoClima({ nivel, size = 26 }) {
  const lluvia = nivel !== "seco";
  const color = nivel === "fuerte" ? C.rojo : lluvia ? C.azul : C.ambar;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {!lluvia && (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)}
      {lluvia && <path d="M20 15.5A4.5 4.5 0 0 0 17.5 7a6 6 0 0 0-11.4 1.8A4 4 0 0 0 6 16.5h13" />}
      {lluvia && nivel !== "fuerte" && <path d="M8 19v2M12 19v2M16 19v2" />}
      {nivel === "fuerte" && <path d="m13 16-2.5 4h3L11 24" />}
    </svg>
  );
}

const ddmm = (iso) => { const f = new Date(iso + "T12:00:00"); return `${f.getDate()}/${f.getMonth() + 1}`; };

export default function Home({ onNav, isMobile, logo, session, onLogin, onLogout, comBadge = 0 }) {
  const clima = useClima(); // pronóstico de lluvia en horario de reparto (Open-Meteo)
  const [eggPaco, setEggPaco] = useState(false); // easter egg: 5 clics seguidos en el logo del header
  const eggClicks = useRef({ n: 0, t: 0 });
  const clickLogoEgg = () => {
    const ahora = Date.now();
    if (ahora - eggClicks.current.t > 1500) eggClicks.current.n = 0; // se resetea si pasa 1,5s entre clics
    eggClicks.current.t = ahora;
    eggClicks.current.n += 1;
    if (eggClicks.current.n >= 5) { eggClicks.current.n = 0; setEggPaco(true); }
  };
  const hoy = todayStr();
  const ahora = useMemo(() => new Date(Date.now() - 3 * 3600 * 1000), []);
  const diaSemana = new Date(hoy + "T12:00:00").getDay();
  const minsAhora = minutosAR();
  const franja = minsAhora < 690 ? "manana" : "dia";
  const ventanaArribos = minsAhora >= 780 && minsAhora <= 930; // 13:00–15:30: lo que más se usa (llegan los choferes)
  const esLunMar = diaSemana === 1 || diaSemana === 2;
  const isAdmin = !!(session && session.email === "admin@flexit.app");
  const horaTxt = `${String(ahora.getUTCHours()).padStart(2, "0")}:${String(ahora.getUTCMinutes()).padStart(2, "0")}`;
  const usuario = (session || {}).nombre || "";
  const saludo = minsAhora < 720 ? "Buen día" : minsAhora < 1200 ? "Buenas tardes" : "Buenas noches";

  const [ayer, setAyer] = useState(null);
  const [col, setCol] = useState(null);
  const [notas, setNotas] = useState([]);
  const [liq, setLiq] = useState(null);
  const [copiado, setCopiado] = useState(false);

  // Datos de ayer (semanas, lectura pública). Se traen ~2 semanas para la tendencia del SLA.
  useEffect(() => {
    sbFetch("semanas?select=cadete,fecha,cantidad,demorados,dem21,post21,envios_ml&order=fecha.desc&limit=1200")
      .then((rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        const porFecha = {};
        rows.forEach((r) => { (porFecha[r.fecha] = porFecha[r.fecha] || []).push(r); });
        const fechas = Object.keys(porFecha).sort(); // asc
        const slaDe = (f) => {
          let ml = 0, dem = 0, d21 = 0;
          porFecha[f].forEach((r) => { ml += r.envios_ml || 0; dem += r.demorados || 0; d21 += r.dem21 || 0; });
          return slaMeli(ml, dem, d21);
        };
        const maxFecha = fechas[fechas.length - 1];
        // La fecha más vieja puede venir cortada por el limit: se descarta de la serie.
        const serieFechas = fechas.slice(fechas.length > 8 ? -8 : 1).slice(-7);
        const serie = serieFechas.map(slaDe);
        const prevFecha = fechas.length > 1 ? fechas[fechas.length - 2] : null;
        let env = 0; const cad = [];
        porFecha[maxFecha].forEach((r) => {
          env += r.cantidad || 0;
          const s = slaMeli(r.envios_ml, r.demorados, r.dem21);
          if (s != null && (r.envios_ml || 0) >= 10 && s < 98) {
            const mot = [];
            if ((r.dem21 || 0) > 0) mot.push(`${r.dem21} post-21`);
            if ((r.demorados || 0) > 0) mot.push(`${r.demorados} dem.`);
            cad.push({ nombre: r.cadete, sla: s, motivo: mot.join(" · ") || "SLA bajo", nivel: s < 95 ? "rojo" : "ambar" });
          }
        });
        cad.sort((a, b) => a.sla - b.sla);
        const sla = slaDe(maxFecha);
        const slaPrev = prevFecha ? slaDe(prevFecha) : null;
        setAyer({ fecha: maxFecha, envios: env, sla, cadetes: cad, serie, prevFecha, delta: sla != null && slaPrev != null ? sla - slaPrev : null });
      })
      .catch(() => {});
  }, []);

  // Colectas + arribos de hoy (requiere login)
  useEffect(() => {
    if (!session) return;
    let vivo = true;
    Promise.all([
      sbFetch("colectas_clientes?select=id,activo,fija,seccion,opera_sabados&bot_prueba=not.is.true"),
      sbFetch(`colectas_registros?select=cliente_id,estado,choferes,confirmado_por&fecha=eq.${hoy}`),
      sbFetch(`colectas_arribos?select=cadete,llego_at&fecha=eq.${hoy}`),
    ]).then(([clientes, regs, arr]) => {
      if (!vivo) return;
      const regById = {}; (regs || []).forEach((r) => { regById[r.cliente_id] = r; });
      let sinChofer = 0, confirmadas = 0, conColecta = 0;
      // Sábado = solo las colectas que operan sábados; entre semana = sin las fichas de sábado (mismo criterio que Colectas)
      const esSabado = new Date(hoy + "T12:00:00").getDay() === 6;
      const aplica = (c) => esSabado ? (c.seccion === "SABADOS" || c.opera_sabados) : c.seccion !== "SABADOS";
      (clientes || []).filter((c) => c.activo && aplica(c)).forEach((c) => {
        const r = regById[c.id];
        const est = (c.fija && (!r?.estado || r.estado === "blanco")) ? "amarillo" : (r?.estado || "blanco");
        if (est === "rojo") return;
        const chs = r?.choferes?.length ? r.choferes : ["A coordinar"];
        const sinAsig = chs.every((x) => x === "A coordinar");
        if (est === "verde") confirmadas++;
        if (est === "amarillo" || est === "verde") { conColecta++; if (sinAsig) sinChofer++; }
      });
      // Roster de arribos = cadetes con al menos una colecta CONFIRMADA hoy (mismo criterio que la pantalla Arribos),
      // no la cantidad de filas en colectas_arribos (que solo existen para los ya marcados).
      const roster = new Set();
      (regs || []).forEach((r) => {
        if (r.estado === "rojo") return;
        (r.choferes || []).forEach((ch) => {
          if (!ch || ch === "A coordinar") return;
          if (r.estado === "verde" || (r.confirmado_por || []).includes(ch)) roster.add(ch);
        });
      });
      const llegadosSet = new Set((arr || []).filter((a) => a.llego_at).map((a) => a.cadete));
      const faltan = [...roster].filter((ch) => !llegadosSet.has(ch)).sort((a, b) => a.localeCompare(b, "es"));
      setCol({ sinChofer, confirmadas, totalCol: conColecta, llegaron: roster.size - faltan.length, totalArr: roster.size, faltan });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [session, hoy]);

  // Notas del equipo (buzón + feed). Requiere login.
  const recargarNotas = useCallback(() => {
    if (!session) return;
    sbFetch(`notas_operativas?select=*&or=(resuelta_at.is.null,fecha_objetivo.eq.${hoy})&order=created_at.asc`)
      .then((rows) => setNotas(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, [session, hoy]);
  useEffect(() => { recargarNotas(); }, [recargarNotas]);
  useNotasRealtime(useCallback((row, ev) => setNotas((prev) => aplicarCambioNota(prev, row, ev)), []), !!session);

  // Liquidación (solo lun/mar, solo admin).
  // Dos bugs que hacían que esto mostrara siempre "0 cadetes confirmados":
  //   1) buscaba el lunes de HOY. El lunes se liquida la semana que YA TERMINÓ, así que va el
  //      lunes anterior (−7 días). Con el lunes de hoy la semana ni siquiera empezó.
  //   2) armaba el label como "03/08", pero `pagos_cierres.semana_label` es ISO ("2026-07-27").
  //      La query no matcheaba nada y devolvía [], que se leía como "cero confirmados".
  // Además contaba filas: un cierre en borrador NO está confirmado.
  useEffect(() => {
    if (!isAdmin || !esLunMar) return;
    const l = new Date(hoy + "T12:00:00");
    l.setDate(l.getDate() - ((l.getDay() + 6) % 7) - 7); // lunes de la semana que se liquida
    const lunesISO = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`;
    const sab = new Date(l); sab.setDate(sab.getDate() + 5);
    const dm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    sbFetch(`pagos_cierres?select=cadete,pagado,estado&semana_label=eq.${encodeURIComponent(lunesISO)}`)
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        const confirmados = rows.filter((r) => r.estado === "confirmado").length;
        const pagados = rows.filter((r) => r.pagado).length;
        setLiq({ label: `${dm(l)} al ${dm(sab)}`, confirmados, pagados });
      })
      .catch(() => {});
  }, [isAdmin, esLunMar, hoy]);

  const notasHoy = useMemo(() => ordenarNotas(notas.filter((n) => !n.resuelta_at && n.fecha_objetivo === hoy && n.tipo !== "aviso")), [notas, hoy]);
  const pendientesFuturas = useMemo(() => notas.filter((n) => !n.resuelta_at && n.fecha_objetivo > hoy).length, [notas, hoy]);
  const resolverLocal = (n) => { setNotas((prev) => prev.filter((x) => x.id !== n.id)); resolverNota(n.id, usuario).catch(recargarNotas); };
  const moverLocal = (n) => { setNotas((prev) => prev.filter((x) => x.id !== n.id)); posponerNota(n).catch(recargarNotas); };

  const copiarResumen = () => {
    if (!ayer) return;
    const f = new Date(ayer.fecha + "T12:00:00");
    const lineas = ayer.cadetes.map((c) => `• ${c.nombre}: SLA ${c.sla.toFixed(1)}% (${c.motivo})`);
    const txt = `📊 Cierre ${f.getDate()}/${f.getMonth() + 1}\nSLA general: ${ayer.sla != null ? ayer.sla.toFixed(1) + "%" : "—"}\n${fmt(ayer.envios)} envíos\n\nA reforzar:\n${lineas.join("\n") || "Sin cadetes en alerta ✓"}`;
    navigator.clipboard.writeText(txt).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1800); }).catch(() => {});
  };

  // Foco del día (el protagonista)
  const foco = (() => {
    // La liquidación es el foco mientras quede algo por hacer: o no confirmaste ninguno,
    // o hay confirmados sin pagar. (Antes el corte era un 41 hardcodeado.)
    if (isAdmin && esLunMar && liq && (liq.confirmados === 0 || liq.pagados < liq.confirmados)) return "liq";
    if (session && franja === "dia" && col && col.sinChofer > 0) return "colectas";
    // 13:00–15:30 el protagonista es Arribos (llegan los choferes) mientras falte alguno
    if (session && ventanaArribos && col && col.totalArr > 0 && col.llegaron < col.totalArr) return "arribos";
    if (franja === "manana" && ayer && ayer.cadetes.length > 0) return "arranque";
    return "ok";
  })();
  const colCompleto = !!(col && col.totalCol > 0 && col.sinChofer === 0 && col.confirmadas === col.totalCol);

  const modulos = [
    { id: "metricas", label: "Métricas" }, { id: "colectas", label: "Colectas" }, { id: "arribos", label: "Arribos" }, { id: "monitoreo", label: "Monitoreo" },
    { id: "tiquetera", label: "Tiquetera" }, { id: "pizarra", label: "Pizarra" }, { id: "pagos", label: "Pagos" }, { id: "pendientes", label: "Históricos" },
  ].filter((d) => puedeVer(d.id))
    .concat(session && esAdmin() ? [{ id: "usuarios", label: "Usuarios" }] : []); // solo el admin

  // ── Foco de hoy: franja fina si está todo bien; tarjeta protagonista (ámbar) si hay algo que hacer ──
  const focoTitulo = { fontFamily: C.grotesk, fontSize: isMobile ? 20 : 23, fontWeight: 600, letterSpacing: "-0.5px", margin: "6px 0 4px", lineHeight: 1.2 };
  const focoBajada = { fontSize: 13.5, color: C.ink2, lineHeight: 1.5 };
  const ctaAmbar = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.ambar, color: "#1a1406", fontWeight: 700, fontSize: 13.5, border: "none", borderRadius: 12, padding: "0 18px", minHeight: 44, cursor: "pointer", whiteSpace: "nowrap", width: isMobile ? "100%" : "auto" };
  const focoAccion = (() => {
    if (foco === "colectas") return { titulo: `${col.sinChofer} colecta${col.sinChofer === 1 ? "" : "s"} sin chofer`, bajada: <>Asignalas <b style={{ color: C.ambar }}>antes de las 14:00</b> para evitar demoras en el reparto.</>, cta: "Abrir colectas", go: () => onNav("colectas") };
    if (foco === "arribos") return { titulo: `Van llegando: ${col.llegaron} de ${col.totalArr} cadetes`, bajada: <>{col.totalArr - col.llegaron === 1 ? "Falta" : "Faltan"} <b style={{ color: C.ambar }}>{col.totalArr - col.llegaron}</b> por llegar al depósito. Marcá a cada uno cuando entra.</>, cta: "Abrir arribos", go: () => onNav("arribos") };
    if (foco === "arranque") return { titulo: `${ayer.cadetes.length} cadete${ayer.cadetes.length === 1 ? "" : "s"} para revisar de ayer`, bajada: `SLA general ${ayer.sla != null ? ayer.sla.toFixed(1) + "%" : "—"}. Copiá el resumen y mandalo al grupo.`, cta: copiado ? "Copiado" : "Copiar resumen para el grupo", go: copiarResumen, sinFlecha: true };
    if (foco === "liq") return { titulo: `Liquidación ${liq.label}`, bajada: liq.confirmados === 0 ? "Todavía no confirmaste ningún cadete. Ahí arranca." : `${liq.confirmados} confirmados · ${liq.pagados} pagados${liq.confirmados > liq.pagados ? ` · faltan ${liq.confirmados - liq.pagados} por pagar` : ""}.`, cta: "Ir a liquidaciones", go: () => onNav("pagos") };
    return null;
  })();
  const focoEl = focoAccion ? (
    <section aria-label="Foco de hoy" style={{ ...cardBase, borderRadius: 18, padding: isMobile ? "18px" : "20px 24px", borderColor: "rgba(245,192,68,0.35)", background: "linear-gradient(100deg, rgba(245,192,68,0.12), transparent 60%), " + C.glass, display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: isMobile ? 14 : 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0 }}>
        {!isMobile && (
          <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, background: "rgba(245,192,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.ambar} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: C.grotesk, fontSize: 11, fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: C.ambar }}>Foco de hoy</div>
          <div style={focoTitulo}>{focoAccion.titulo}</div>
          <div style={focoBajada}>{focoAccion.bajada}</div>
        </div>
      </div>
      <button type="button" onClick={focoAccion.go} style={ctaAmbar}>{focoAccion.cta}{!focoAccion.sinFlecha && <Icon id="arrow" size={15} color="#1a1406" />}</button>
    </section>
  ) : (
    <section aria-label="Foco de hoy" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderRadius: 14, background: "rgba(46,230,182,0.06)", border: "1px solid rgba(46,230,182,0.18)" }}>
      <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: "50%", background: "rgba(46,230,182,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon id="check" size={14} color={C.teal} w={3} /></span>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 10, rowGap: 2, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Todo bajo control</span>
        <span style={{ color: C.ink3, fontSize: 13 }}>Sin urgencias ahora.{!session ? " Ingresá para ver colectas y notas del equipo." : ""}</span>
      </div>
    </section>
  );

  // ── Aviso de lluvia: solo cuando el pronóstico complica el reparto (hoy o mañana) ──
  const lluviaEl = clima && (() => {
    const hoyMal = clima.hoy.nivel === "fuerte" || clima.hoy.nivel === "lluvia";
    const mananaMal = clima.manana && clima.manana.nivel === "fuerte";
    if (!hoyMal && !mananaMal) return null;
    const r = hoyMal ? clima.hoy : clima.manana;
    const fuerte = r.nivel === "fuerte";
    const color = fuerte ? C.rojo : C.ambar;
    return (
      <div style={{ ...cardBase, borderRadius: 16, padding: isMobile ? "14px 16px" : "14px 20px", borderColor: fuerte ? "rgba(232,97,95,0.45)" : "rgba(245,192,68,0.4)", background: `linear-gradient(135deg, ${fuerte ? "rgba(232,97,95,0.10)" : "rgba(245,192,68,0.08)"}, transparent 70%), ${C.glass}` }}>
        {hoyMal && <Lluvia intensidad={clima.ahora || r.nivel} />}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <IconoClima nivel={r.nivel} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: C.grotesk, fontWeight: 600, fontSize: 15, color }}>{hoyMal ? "Hoy" : "Mañana"}: {textoNivel(r)}</div>
            <div style={{ fontSize: 12, color: C.ink2, marginTop: 3, lineHeight: 1.5 }}>
              {fuerte ? "Va a complicar el reparto: avisá a los cadetes, sacá primero las zonas lejanas y prevé bolsas para los paquetes." : "Puede demorar el reparto: avisá a los cadetes y prevé bolsas para los paquetes."}
              {hoyMal && mananaMal ? " Mañana también llueve fuerte." : ""}
            </div>
          </div>
        </div>
      </div>
    );
  })();

  // ── Indicadores: SLA · Envíos · Colectas · Clima (2×2 en el celular, una fila en escritorio) ──
  const slaColor = (s) => (s >= 98 ? C.teal : s >= 95 ? C.ambar : C.rojo);
  const climaTexto = (r) => !r ? "" : r.nivel === "fuerte" ? "Lluvia fuerte" : r.nivel === "lluvia" ? "Lluvia" : r.nivel === "puede" ? "Puede llover" : "Sin lluvia";
  const climaValor = (r) => !r ? "—" : (r.nivel === "fuerte" || r.nivel === "lluvia") ? `${String(r.mm).replace(".", ",")} mm` : r.nivel === "puede" ? `${r.prob}%` : "Seco";
  const tiles = [];
  if (ayer && ayer.sla != null) tiles.push(
    <Tile key="sla" cap="SLA de ayer" onClick={() => onNav("metricas")} irA="Métricas">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <span style={{ ...tileNum(isMobile), color: slaColor(ayer.sla) }}>{ayer.sla.toFixed(1).replace(".", ",")}%</span>
        {!isMobile && <Sparkline valores={ayer.serie} color={slaColor(ayer.sla)} />}
      </div>
      {ayer.delta != null ? (
        <span style={tileSub}><b style={{ color: ayer.delta >= 0 ? C.teal : C.rojo, fontWeight: 600 }}>{ayer.delta >= 0 ? "▲" : "▼"} {Math.abs(ayer.delta).toFixed(1).replace(".", ",")} pts</b> vs. {ddmm(ayer.prevFecha)}</span>
      ) : <span style={tileSub}>{ddmm(ayer.fecha)}</span>}
    </Tile>
  );
  if (ayer) tiles.push(
    <Tile key="env" cap="Envíos de ayer" onClick={() => onNav("metricas")} irA="Métricas">
      <span style={tileNum(isMobile)}>{fmt(ayer.envios)}</span>
      <span style={tileSub}>{ayer.cadetes.length > 0 ? <b style={{ color: C.ambar, fontWeight: 600 }}>{ayer.cadetes.length} en alerta</b> : "Nadie en alerta"}</span>
    </Tile>
  );
  if (session && col) tiles.push(
    <Tile key="col" cap="Colectas" onClick={() => onNav("colectas")} irA="Colectas">
      <span style={tileNum(isMobile)}>{col.confirmadas}<span style={{ fontSize: isMobile ? 15 : 17, color: C.ink3, fontWeight: 500 }}> / {col.totalCol}</span></span>
      <MiniBarra pct={col.totalCol ? (col.confirmadas / col.totalCol) * 100 : 0} color={colCompleto ? C.teal : col.sinChofer > 0 ? C.ambar : C.lila} />
      <span style={tileSub}>{colCompleto ? "Todas confirmadas" : col.sinChofer > 0 ? <b style={{ color: C.ambar, fontWeight: 600 }}>{col.sinChofer} sin chofer</b> : `${col.totalCol - col.confirmadas} por confirmar`}</span>
    </Tile>
  );
  if (clima) {
    const llueveHoy = clima.ahora || clima.hoy.nivel === "fuerte" || clima.hoy.nivel === "lluvia";
    tiles.push(
      <Tile key="clima" cap={isMobile ? "Clima hoy" : "Clima en reparto"}>
        {llueveHoy && <Lluvia intensidad={clima.ahora || clima.hoy.nivel} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconoClima nivel={clima.hoy.nivel} size={isMobile ? 24 : 28} />
          <span style={{ ...tileNum(isMobile), fontSize: clima.hoy.nivel === "seco" ? (isMobile ? 22 : 26) : tileNum(isMobile).fontSize }}>{climaValor(clima.hoy)}</span>
        </div>
        <span style={tileSub}>{climaTexto(clima.hoy)}{clima.manana ? ` · mañana ${climaTexto(clima.manana).toLowerCase()}` : ""}</span>
      </Tile>
    );
  }

  // ── Arribos: cuántos llegaron y QUIÉN falta ──
  const arribosEl = session && col && col.totalArr > 0 && (
    <article style={{ ...cardBase, borderRadius: 16, padding: isMobile ? 16 : "20px 22px", display: "flex", flexDirection: "column", gap: 12, flex: isMobile ? "none" : "3 1 380px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={cardTitle}>Arribos</h2>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", color: C.teal }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: C.teal }} />EN VIVO</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...tileNum(isMobile), fontSize: isMobile ? 34 : 42 }}>{col.llegaron}</span>
        <span style={{ fontFamily: C.grotesk, fontSize: isMobile ? 16 : 19, color: C.ink3 }}>/ {col.totalArr} llegaron</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 3, width: `${(col.llegaron / col.totalArr) * 100}%`, background: C.teal, transition: "width .4s ease" }} />
      </div>
      {col.faltan.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.ink2 }}><Icon id="check" size={15} color={C.teal} w={2.6} /> Llegaron todos</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, color: C.ink3 }}>{col.faltan.length === 1 ? "Falta 1" : `Faltan ${col.faltan.length}`}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {col.faltan.slice(0, 6).map((n) => (
              <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 6px", borderRadius: 20, background: "rgba(245,192,68,0.08)", border: "1px solid rgba(245,192,68,0.25)", fontSize: 13, fontWeight: 600 }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(245,192,68,0.18)", color: C.ambar, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{(n || "?")[0].toUpperCase()}</span>
                {n}
              </span>
            ))}
            {col.faltan.length > 6 && <span style={{ alignSelf: "center", fontSize: 12, color: C.ink3 }}>y {col.faltan.length - 6} más</span>}
          </div>
        </div>
      )}
      <button type="button" onClick={() => onNav("arribos")} style={{ alignSelf: isMobile ? "stretch" : "flex-start", minHeight: 40, padding: "0 16px", borderRadius: 10, border: `1px solid rgba(255,255,255,0.1)`, background: "transparent", color: C.ink2, fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 2 }}>Abrir arribos</button>
    </article>
  );

  // ── Notas del equipo ──
  const notasEl = session && (
    <article style={{ ...cardBase, borderRadius: 16, padding: isMobile ? "14px 16px" : "20px 22px", display: "flex", flexDirection: "column", gap: 6, flex: isMobile ? "none" : "2 1 300px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={cardTitle}>Notas del equipo</h2>
        <button type="button" onClick={() => onNav("pizarra")} style={{ background: "none", border: "none", color: C.teal, fontWeight: 600, cursor: "pointer", fontSize: 12.5, padding: "6px 0" }}>+ Nueva</button>
      </div>
      {notasHoy.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: "center", justifyContent: "center", gap: 10, padding: isMobile ? "4px 0" : "14px 0", textAlign: isMobile ? "left" : "center", fontSize: 13, color: C.ink2 }}>
          <span style={{ width: isMobile ? 26 : 36, height: isMobile ? 26 : 36, flexShrink: 0, borderRadius: "50%", background: "rgba(46,230,182,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon id="check" size={isMobile ? 13 : 17} color={C.teal} w={2.6} /></span>
          <span>
            Sin notas pendientes para hoy.{pendientesFuturas > 0 ? ` Hay ${pendientesFuturas} para los próximos días.` : ""}{" "}
            <span onClick={() => onNav("pizarra")} style={{ color: C.teal, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{pendientesFuturas > 0 ? "Verlas" : "Abrir la pizarra"} →</span>
          </span>
        </div>
      ) : (
        <div>
          {notasHoy.slice(0, isMobile ? 2 : 4).map((n) => {
            const t = NOTA_TIPOS[n.tipo] || {};
            const col2 = n.tipo === "ausencia" ? C.rojo : C.lila;
            const urg = n.prioridad === "ahora"; const hora = n.prioridad === "hora" && n.hora_limite;
            return (
              <div key={n.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                <div title={t.label} style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.grotesk, fontWeight: 600, fontSize: 12, color: col2, background: col2 + "22" }}>{(n.autor || "?")[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 150, fontSize: 13 }}>
                  {urg && <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: C.rojo, borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>AHORA</span>}
                  {hora && <span style={{ fontSize: 10, fontWeight: 800, color: "#1a1500", background: C.ambar, borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>{n.hora_limite}</span>}
                  {textoNota(n)}
                  {n.tipo === "ausencia" && n.cubre && <span style={{ color: C.teal, fontWeight: 600 }}> · cubre {n.cubre}</span>}
                  <span style={{ display: "block", fontSize: 11, color: C.ink3, marginTop: 1 }}>{n.autor}{t.label ? ` · ${t.label}` : ""}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => resolverLocal(n)} style={miniOk}>✓ Hecho</button>
                  {n.tipo !== "ausencia" && <button onClick={() => moverLocal(n)} style={mini}>→ Mañana</button>}
                </div>
              </div>
            );
          })}
          {notasHoy.length > (isMobile ? 2 : 4) && (
            <div onClick={() => onNav("pizarra")} style={{ textAlign: "center", fontSize: 12, color: C.teal, fontWeight: 600, padding: "11px 0 2px", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>Ver las {notasHoy.length} en la pizarra →</div>
          )}
        </div>
      )}
    </article>
  );

  const sinSesionEl = !session && (
    <div style={{ ...cardBase, borderRadius: 16, padding: "16px 18px", fontSize: 13, color: C.ink2, lineHeight: 1.5 }}>
      Ingresá arriba a la derecha para ver colectas, arribos y las notas del equipo en vivo.
    </div>
  );

  const buscarBtn = session && puedeVer("envio") && (
    <button type="button" onClick={() => onNav("envio")} aria-label="Buscar envío"
      style={{ display: "flex", alignItems: "center", gap: 10, height: isMobile ? 46 : 42, width: isMobile ? "100%" : 280, boxSizing: "border-box", padding: "0 14px", borderRadius: 12, border: `1px solid rgba(255,255,255,0.08)`, background: C.glassSoft, color: C.ink3, cursor: "pointer", fontSize: isMobile ? 15 : 13, textAlign: "left" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(46,230,182,0.35)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      Buscar envío
    </button>
  );

  const metaTxt = `${session ? "En vivo" : "Panel"} · ${isMobile ? `${DIAS[diaSemana].slice(0, 3)} ${ahora.getUTCDate()}/${ahora.getUTCMonth() + 1} · ${horaTxt}` : `${DIAS[diaSemana]} ${ahora.getUTCDate()} de ${MESES[ahora.getUTCMonth()]} · ${horaTxt}`}`;
  const saludoEl = (
    <div style={{ minWidth: 0, flex: 1 }}>
      <h1 style={{ margin: 0, fontFamily: C.grotesk, fontSize: isMobile ? 19 : 25, fontWeight: 600, letterSpacing: "-0.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {saludo}{usuario && !isMobile ? `, ${usuario.split(" ")[0]}` : ""}
      </h1>
      <div style={{ fontSize: isMobile ? 11.5 : 13, color: C.ink3, marginTop: 3, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.teal, boxShadow: "0 0 0 3px rgba(46,230,182,0.16)", flexShrink: 0 }} />
        {metaTxt}
      </div>
    </div>
  );
  const logoEl = (size) => (
    <div onClick={clickLogoEgg} style={{ width: size, height: size, borderRadius: 12, overflow: "hidden", flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(46,230,182,0.25)", userSelect: "none" }}>
      <img src={logo} alt="Flexit" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );

  const fondo = <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(1100px 600px at 12% -4%, rgba(0,255,180,0.05), transparent 60%), radial-gradient(1000px 640px at 92% 106%, rgba(0,180,255,0.04), transparent 60%)" }} />;
  const fuente = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  // ════════════════ CELULAR ════════════════
  if (isMobile) return (
    <div style={{ minHeight: "78vh", padding: "6px 2px 30px" }}>
      {fondo}
      {eggPaco && <PacoEgg onClose={() => setEggPaco(false)} />}
      <div style={{ position: "relative", zIndex: 1, fontFamily: fuente, color: C.ink, display: "flex", flexDirection: "column", gap: 12 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {logoEl(40)}
          {saludoEl}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {session && <Buzon notas={notas} onIr={onNav} onResolver={resolverLocal} />}
            {onLogin && <LoginWidget session={session} onLogin={onLogin} onLogout={onLogout} />}
          </div>
        </header>
        {buscarBtn}
        {focoEl}
        {lluviaEl}
        {tiles.length > 0 && <section aria-label="Indicadores" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>{tiles}</section>}
        {arribosEl}
        {notasEl}
        {sinSesionEl}
        <nav aria-label="Módulos" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 8 }}>
          {modulos.map((d) => (
            <button key={d.id} type="button" onClick={() => onNav(d.id)} style={{ ...cardBase, borderRadius: 14, padding: "14px 6px", minHeight: 78, textAlign: "center", cursor: "pointer", color: C.ink2 }}>
              {d.id === "pizarra" && comBadge > 0 && <span style={{ position: "absolute", top: 8, right: 10, minWidth: 18, height: 18, borderRadius: 9, background: C.rojo, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", fontFamily: C.grotesk }}>{comBadge}</span>}
              <div style={{ color: C.teal, marginBottom: 7, display: "flex", justifyContent: "center" }}><Icon id={d.id} size={22} /></div>
              <div style={{ fontSize: 11.5, fontWeight: 600, fontFamily: C.grotesk }}>{d.label}</div>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );

  // ════════════════ ESCRITORIO ════════════════
  // El menú queda pegado a la izquierda y el contenido se centra en el espacio que sobra
  // (tope 1320 px): en pantallas anchas no queda todo amontonado a la izquierda.
  const navItem = (activo) => ({ position: "relative", display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", background: activo ? "rgba(46,230,182,0.10)" : "transparent", color: activo ? C.ink : C.ink2, fontSize: 13.5, fontWeight: activo ? 600 : 500, cursor: activo ? "default" : "pointer", textAlign: "left", transition: "background .15s ease, color .15s ease" });
  return (
    <div style={{ minHeight: "calc(100vh - 3rem)", display: "flex", alignItems: "flex-start", gap: 28 }}>
      {fondo}
      {eggPaco && <PacoEgg onClose={() => setEggPaco(false)} />}

      {/* Menú lateral — reemplaza la fila de accesos de abajo */}
      <nav aria-label="Módulos" style={{ position: "sticky", top: 24, zIndex: 2, width: 216, flexShrink: 0, height: "calc(100vh - 48px)", boxSizing: "border-box", padding: "18px 12px", borderRadius: 18, background: "rgba(15,15,27,0.55)", border: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 3, fontFamily: fuente }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px 18px" }}>
          {logoEl(36)}
          <span style={{ fontFamily: C.grotesk, fontWeight: 700, fontSize: 17, color: C.ink }}>Flexit</span>
        </div>
        <button type="button" aria-current="page" style={navItem(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></svg>
          Inicio
        </button>
        {modulos.map((d) => (
          <button key={d.id} type="button" onClick={() => onNav(d.id)} style={navItem(false)}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = C.ink; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.ink2; }}>
            <Icon id={d.id} size={18} />
            {d.label}
            {d.id === "pizarra" && comBadge > 0 && <span style={{ marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 9, background: C.rojo, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", fontFamily: C.grotesk }}>{comBadge}</span>}
          </button>
        ))}
        <div style={{ flex: 1, minHeight: 16 }} />
        {session && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 6px 2px", borderTop: `1px solid ${C.line}` }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.grotesk, fontWeight: 600, fontSize: 13, color: C.ink, flexShrink: 0 }}>{(usuario || session.email || "?")[0].toUpperCase()}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{usuario || "Equipo"}</div>
              <div style={{ fontSize: 11.5, color: C.ink3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.email}</div>
            </div>
            {onLogout && <button type="button" onClick={onLogout} style={{ background: "none", border: "none", color: C.ink3, fontSize: 12, cursor: "pointer", padding: 6, flexShrink: 0 }}>Salir</button>}
          </div>
        )}
      </nav>

      {/* Contenido */}
      <main style={{ flex: 1, minWidth: 0, maxWidth: 1320, margin: "0 auto", position: "relative", zIndex: 1, fontFamily: fuente, color: C.ink, display: "flex", flexDirection: "column", gap: 18, paddingTop: 4 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {saludoEl}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {buscarBtn}
            {session && <Buzon notas={notas} onIr={onNav} onResolver={resolverLocal} />}
            {onLogin && !session && <LoginWidget session={session} onLogin={onLogin} onLogout={onLogout} />}
          </div>
        </header>
        {focoEl}
        {lluviaEl}
        {tiles.length > 0 && (<>
          {/* Una sola fila con todos los indicadores; en pantallas angostas pasan a 2×2 (nunca 3 + 1 suelto) */}
          <style>{`@media (max-width: 980px) { .fx-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }`}</style>
          <section aria-label="Indicadores" className="fx-kpis" style={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`, gap: 14 }}>{tiles}</section>
        </>)}
        {(arribosEl || notasEl) && <section style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "stretch" }}>{arribosEl}{notasEl}</section>}
        {sinSesionEl}
      </main>
    </div>
  );
}
