import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  sbFetch, todayStr, minutosAR,
  NOTA_TIPOS, ordenarNotas, resolverNota, posponerNota, useNotasRealtime, aplicarCambioNota, textoNota,
} from "./colectasShared";

// ── Home = Centro de operaciones (spec-home-centro-operaciones, diseño flexit-design "premium").
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
  bell: (<><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>),
  arrow: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  check: (<><path d="M20 6 9 17l-5-5" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>),
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
const slaMeli = (ml, dem, d21) => (ml > 0 ? (ml - dem - (d21 || 0)) / ml * 100 : null);
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
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{nt.autor || "—"} <span style={{ color: C.ink3, fontWeight: 400 }}>· {t.emoji} {t.label}</span></div>
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

// ── Stat card glass ──
// Una tarjeta con `onClick` es un acceso a su sección: se marca con un chevron tenue a la
// derecha del encabezado y el borde se enciende al pasar el mouse. Solo cambia color —
// nada que altere el alto, para no empujar las tarjetas de abajo.
function Stat({ cap, capId, live, children, span2, onClick, orden, irA }) {
  return (
    <div onClick={onClick}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.borderColor = "rgba(46,230,182,0.35)"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.borderColor = C.line; } : undefined}
      title={onClick && irA ? `Ir a ${irA}` : undefined}
      style={{ ...cardBase, padding: "18px 18px", gridColumn: span2 ? "span 2" : "auto", order: orden || 0, cursor: onClick ? "pointer" : "default", transition: "border-color .18s ease" }}>
      <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.10),transparent)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: C.ink2 }}>
        {capId && <Icon id={capId} size={15} color={C.ink3} />} {cap}
        {live && <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.teal, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: C.teal, boxShadow: `0 0 7px ${C.teal}` }} />EN VIVO</span>}
        {onClick && <span style={{ marginLeft: live ? 8 : "auto", color: C.ink3, fontSize: 13, lineHeight: 1 }}>→</span>}
      </div>
      {children}
    </div>
  );
}
const Barra = ({ pct, color }) => (
  <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", marginTop: 12, overflow: "hidden" }}>
    <div style={{ height: "100%", borderRadius: 4, width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width .4s ease" }} />
  </div>
);
const bigNum = (mobile) => ({ fontFamily: C.grotesk, fontWeight: 600, letterSpacing: "-1px", fontSize: mobile ? 24 : 28, marginTop: 10 });
const ctaSt = { display: "inline-flex", alignItems: "center", gap: 8, marginTop: 16, background: "linear-gradient(135deg,#2ee6b6,#22c39a)", color: "#04150f", fontWeight: 700, fontSize: 13.5, border: "none", borderRadius: 13, padding: "12px 18px", cursor: "pointer", boxShadow: "0 8px 22px rgba(46,230,182,0.25)" };
const mini = { border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.05)", color: "#fff", borderRadius: 9, padding: "7px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 34, whiteSpace: "nowrap" };
const miniOk = { ...mini, border: "1px solid rgba(46,230,182,0.4)", color: "#2ee6b6", background: "rgba(46,230,182,0.1)" };
const secSt = { fontSize: 12, fontWeight: 600, color: C.ink3, margin: "22px 6px 12px" };

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

export default function Home({ onNav, isMobile, logo, session, onLogin, onLogout, comBadge = 0 }) {
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
  const franja = minutosAR() < 690 ? "manana" : "dia";
  const minsAhora = minutosAR();
  const ventanaArribos = minsAhora >= 780 && minsAhora <= 930; // 13:00–15:30: lo que más se usa (llegan los choferes)
  const esLunMar = diaSemana === 1 || diaSemana === 2;
  const isAdmin = !!(session && session.email === "admin@flexit.app");
  const horaTxt = `${String(ahora.getUTCHours()).padStart(2, "0")}:${String(ahora.getUTCMinutes()).padStart(2, "0")}`;
  const usuario = (session || {}).nombre || "";

  const [ayer, setAyer] = useState(null);
  const [col, setCol] = useState(null);
  const [notas, setNotas] = useState([]);
  const [liq, setLiq] = useState(null);
  const [copiado, setCopiado] = useState(false);

  // Datos de ayer (semanas, lectura pública)
  useEffect(() => {
    sbFetch("semanas?select=cadete,fecha,cantidad,demorados,dem21,post21,envios_ml&order=fecha.desc&limit=300")
      .then((rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        const maxFecha = rows.reduce((m, r) => (r.fecha > m ? r.fecha : m), rows[0].fecha);
        const dia = rows.filter((r) => r.fecha === maxFecha);
        let ml = 0, dem = 0, d21 = 0, env = 0; const cad = [];
        dia.forEach((r) => {
          ml += r.envios_ml || 0; dem += r.demorados || 0; d21 += r.dem21 || 0; env += r.cantidad || 0;
          const s = slaMeli(r.envios_ml, r.demorados, r.dem21);
          if (s != null && (r.envios_ml || 0) >= 10 && s < 98) {
            const mot = [];
            if ((r.dem21 || 0) > 0) mot.push(`${r.dem21} post-21`);
            if ((r.demorados || 0) > 0) mot.push(`${r.demorados} dem.`);
            cad.push({ nombre: r.cadete, sla: s, motivo: mot.join(" · ") || "SLA bajo", nivel: s < 95 ? "rojo" : "ambar" });
          }
        });
        cad.sort((a, b) => a.sla - b.sla);
        setAyer({ fecha: maxFecha, envios: env, sla: slaMeli(ml, dem, d21), cadetes: cad });
      })
      .catch(() => {});
  }, []);

  // Colectas + arribos de hoy (requiere login)
  useEffect(() => {
    if (!session) return;
    let vivo = true;
    Promise.all([
      sbFetch("colectas_clientes?select=id,activo,fija"),
      sbFetch(`colectas_registros?select=cliente_id,estado,choferes,confirmado_por&fecha=eq.${hoy}`),
      sbFetch(`colectas_arribos?select=cadete,llego_at&fecha=eq.${hoy}`),
    ]).then(([clientes, regs, arr]) => {
      if (!vivo) return;
      const regById = {}; (regs || []).forEach((r) => { regById[r.cliente_id] = r; });
      let sinChofer = 0, confirmadas = 0, conColecta = 0;
      (clientes || []).filter((c) => c.activo).forEach((c) => {
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
      const llegaron = [...roster].filter((ch) => llegadosSet.has(ch)).length;
      setCol({ sinChofer, confirmadas, totalCol: conColecta, llegaron, totalArr: roster.size });
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

  const dock = [
    { id: "metricas", label: "Métricas" }, { id: "colectas", label: "Colectas" }, { id: "arribos", label: "Arribos" },
    { id: "tiquetera", label: "Tiquetera" }, { id: "pizarra", label: "Pizarra" }, { id: "pagos", label: "Pagos" },
  ];

  const bg = {
    minHeight: "78vh", padding: isMobile ? "6px 2px 30px" : "8px 4px 40px",
  };
  const focoTitulo = { fontFamily: C.grotesk, fontSize: isMobile ? 20 : 26, fontWeight: 600, letterSpacing: "-0.6px", margin: "11px 0 6px", lineHeight: 1.15 };
  const focoBajada = { fontSize: isMobile ? 13 : 14, color: C.ink2, lineHeight: 1.5 };

  return (
    <div style={bg}>
      {/* Profundidad: los degradés van en una capa FIJA de pantalla completa (position:fixed) —
          así no dibujan un rectángulo tintado dentro del padding de la app (eso se veía como un
          "borde" alrededor del header). El contenido va por encima. */}
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(1100px 600px at 12% -4%, rgba(0,255,180,0.05), transparent 60%), radial-gradient(1000px 640px at 92% 106%, rgba(0,180,255,0.04), transparent 60%)" }} />
      {eggPaco && <PacoEgg onClose={() => setEggPaco(false)} />}
      <div style={{ maxWidth: 820, margin: "0 auto", position: "relative", zIndex: 1, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: C.ink }}>

        {/* Header — logo + saludo a la izquierda, acciones a la derecha. Sin wrap: el saludo se
            trunca antes de chocar con los botones, y la meta es corta en mobile. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div onClick={clickLogoEgg} style={{ width: isMobile ? 40 : 44, height: isMobile ? 40 : 44, borderRadius: 13, overflow: "hidden", flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(46,230,182,0.25)", userSelect: "none" }}>
            <img src={logo} alt="Flexit" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: C.grotesk, fontSize: isMobile ? 17 : 21, fontWeight: 600, letterSpacing: "-0.4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {franja === "manana" ? "Buen día" : "Hola"}{usuario ? `, ${usuario.split(" ")[0]}` : ""}
            </div>
            <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 1, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.teal, boxShadow: `0 0 6px ${C.teal}`, flexShrink: 0 }} />
              {session ? "En vivo" : "Panel"} · {isMobile ? `${horaTxt}` : `${DIAS[diaSemana]} ${ahora.getUTCDate()} de ${MESES[ahora.getUTCMonth()]} · ${horaTxt}`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {session && <Buzon notas={notas} onIr={onNav} onResolver={resolverLocal} />}
            {onLogin && <LoginWidget session={session} onLogin={onLogin} onLogout={onLogout} />}
          </div>
        </div>

        {/* PROTAGONISTA — Foco de hoy */}
        <div style={{ ...cardBase, padding: isMobile ? "18px 18px" : "22px 24px", marginBottom: 14, borderColor: "rgba(46,230,182,0.3)", boxShadow: `0 0 35px rgba(0,255,180,0.12), ${C.shadow}`, background: "radial-gradient(120% 130% at 100% 0%, rgba(0,255,180,0.10), transparent 55%), " + C.glass }}>
          <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)" }} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: C.grotesk, fontSize: 11, fontWeight: 600, letterSpacing: "1.3px", textTransform: "uppercase", color: C.teal }}>🎯 Foco de hoy</div>
          {foco === "colectas" && (<>
            <div style={focoTitulo}>{col.sinChofer} colecta{col.sinChofer === 1 ? "" : "s"} sin chofer</div>
            <div style={focoBajada}>Asignalas <b style={{ color: C.ambar }}>antes de las 14:00</b> para evitar demoras en el reparto.</div>
            <button onClick={() => onNav("colectas")} style={ctaSt}>Abrir colectas <Icon id="arrow" size={15} color="#04150f" /></button>
          </>)}
          {foco === "arribos" && (<>
            <div style={focoTitulo}>Van llegando: {col.llegaron} de {col.totalArr} cadetes</div>
            <div style={focoBajada}>Faltan <b style={{ color: C.ambar }}>{col.totalArr - col.llegaron}</b> por llegar al depósito. Marcá a cada uno cuando entra.</div>
            <button onClick={() => onNav("arribos")} style={ctaSt}>Abrir arribos <Icon id="arrow" size={15} color="#04150f" /></button>
          </>)}
          {foco === "arranque" && (<>
            <div style={focoTitulo}>{ayer.cadetes.length} cadete{ayer.cadetes.length === 1 ? "" : "s"} para revisar de ayer</div>
            <div style={focoBajada}>SLA general {ayer.sla != null ? ayer.sla.toFixed(1) + "%" : "—"}. Copiá el resumen y mandalo al grupo.</div>
            <button onClick={copiarResumen} style={ctaSt}>{copiado ? "✓ Copiado" : "📋 Copiar resumen para el grupo"}</button>
          </>)}
          {foco === "liq" && (<>
            <div style={focoTitulo}>Liquidación {liq.label}</div>
            <div style={focoBajada}>
              {liq.confirmados === 0
                ? "Todavía no confirmaste ningún cadete. Ahí arranca."
                : `${liq.confirmados} confirmados · ${liq.pagados} pagados${liq.confirmados > liq.pagados ? ` · faltan ${liq.confirmados - liq.pagados} por pagar` : ""}.`}
            </div>
            <button onClick={() => onNav("pagos")} style={ctaSt}>Ir a liquidaciones <Icon id="arrow" size={15} color="#04150f" /></button>
          </>)}
          {foco === "ok" && (<>
            <div style={focoTitulo}>✅ Todo bajo control</div>
            <div style={focoBajada}>Sin urgencias ahora.{ayer && ayer.sla != null ? ` SLA de ayer: ${ayer.sla.toFixed(1)}%.` : ""}{!session ? " Ingresá para ver colectas y notas del equipo." : ""}</div>
          </>)}
        </div>

        {/* AHORA — widgets. En la ventana de arribos (13–15:30) Arribos va primero. */}
        <div style={secSt}>Ahora</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: isMobile ? 11 : 14 }}>
          {/* Colectas: cuando está completo se muestra como "listo" (no una barra llena a medias) */}
          {session && col && (colCompleto ? (
            <Stat cap="Colectas" capId="check" span2={!isMobile} orden={ventanaArribos ? 2 : 1} onClick={() => onNav("colectas")} irA="Colectas">
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 10 }}>
                <span style={{ fontSize: 26 }}>✅</span>
                <div>
                  <div style={{ fontFamily: C.grotesk, fontWeight: 600, fontSize: isMobile ? 18 : 20, color: C.teal, letterSpacing: "-0.5px" }}>Todas confirmadas</div>
                  <div style={{ fontSize: 11, color: C.ink3, marginTop: 2 }}>{col.totalCol} colectas · sin pendientes</div>
                </div>
              </div>
            </Stat>
          ) : (
            <Stat cap="Colectas confirmadas" capId="check" span2={!isMobile} orden={ventanaArribos ? 2 : 1} onClick={() => onNav("colectas")} irA="Colectas">
              <div style={bigNum(isMobile)}>{col.confirmadas} <small style={{ fontSize: 14, color: C.ink3, fontWeight: 500 }}>/ {col.totalCol}</small></div>
              <Barra pct={col.totalCol ? col.confirmadas / col.totalCol * 100 : 0} color={C.lila} />
              <div style={{ fontSize: 11, color: C.ink3, marginTop: 7 }}>{col.sinChofer} sin chofer</div>
            </Stat>
          ))}
          {session && col && col.totalArr > 0 && (
            <Stat cap="Arribos" capId="arribos" live span2={!isMobile} orden={ventanaArribos ? 1 : 2} onClick={() => onNav("arribos")} irA="Arribos">
              <div style={bigNum(isMobile)}>{col.llegaron} <small style={{ fontSize: 14, color: C.ink3, fontWeight: 500 }}>/ {col.totalArr}</small></div>
              <Barra pct={col.totalArr ? col.llegaron / col.totalArr * 100 : 0} color={C.teal} />
              <div style={{ fontSize: 11, color: C.ink3, marginTop: 7 }}>{col.llegaron === col.totalArr ? "llegaron todos ✓" : `faltan ${col.totalArr - col.llegaron}`}</div>
            </Stat>
          )}
          {ayer && ayer.sla != null && (
            <Stat cap="SLA de ayer" capId="chart" span2={!isMobile} orden={3} onClick={() => onNav("metricas")} irA="Métricas">
              <div style={{ ...bigNum(isMobile), color: ayer.sla >= 98 ? C.teal : ayer.sla >= 95 ? C.ambar : C.rojo }}>{ayer.sla.toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: C.ink3, marginTop: 10 }}>{fmt(ayer.envios)} envíos · {ayer.cadetes.length} en alerta</div>
            </Stat>
          )}
          {!session && (
            <Stat cap="Equipo" span2>
              <div style={{ fontSize: 13, color: C.ink2, marginTop: 8, lineHeight: 1.5 }}>Ingresá arriba a la derecha para ver colectas, arribos y las notas del equipo en vivo.</div>
            </Stat>
          )}
        </div>

        {/* NOTAS DEL EQUIPO — siempre visible con sesión; estado vacío si no hay pendientes de hoy */}
        {session && (<>
          <div style={{ ...secSt, display: "flex", alignItems: "center" }}>
            Notas del equipo
            <span onClick={() => onNav("pizarra")} style={{ marginLeft: "auto", color: C.teal, fontWeight: 600, cursor: "pointer", fontSize: 11.5 }}>+ Nueva</span>
          </div>
          {notasHoy.length === 0 ? (
            <div style={{ ...cardBase, padding: "18px", fontSize: 13, color: C.ink2, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <span>Sin notas pendientes para hoy.{pendientesFuturas > 0 ? ` Hay ${pendientesFuturas} para los próximos días — ` : " "}</span>
              <span onClick={() => onNav("pizarra")} style={{ color: C.teal, fontWeight: 600, cursor: "pointer" }}>{pendientesFuturas > 0 ? "verlas" : "abrir la pizarra"} →</span>
            </div>
          ) : (
          <div style={{ ...cardBase, padding: "6px 18px" }}>
            {notasHoy.slice(0, isMobile ? 2 : 4).map((n) => {
              const t = NOTA_TIPOS[n.tipo] || {};
              const col2 = n.tipo === "ausencia" ? C.rojo : C.lila;
              const urg = n.prioridad === "ahora"; const hora = n.prioridad === "hora" && n.hora_limite;
              return (
                <div key={n.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px 0", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, background: col2 + "22" }}>{t.emoji}</div>
                  <div style={{ flex: 1, minWidth: 150, fontSize: 13 }}>
                    {urg && <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: C.rojo, borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>⚡ AHORA</span>}
                    {hora && <span style={{ fontSize: 10, fontWeight: 800, color: "#1a1500", background: C.ambar, borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>⏰ {n.hora_limite}</span>}
                    {textoNota(n)}
                    {n.tipo === "ausencia" && n.cubre && <span style={{ color: C.teal, fontWeight: 600 }}> · cubre {n.cubre}</span>}
                    <span style={{ display: "block", fontSize: 11, color: C.ink3, marginTop: 1 }}>{n.autor}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => resolverLocal(n)} style={miniOk}>✓ Hecho</button>
                    {n.tipo !== "ausencia" && <button onClick={() => moverLocal(n)} style={mini}>→ Mañana</button>}
                  </div>
                </div>
              );
            })}
            {notasHoy.length > (isMobile ? 2 : 4) && (
              <div onClick={() => onNav("pizarra")} style={{ textAlign: "center", fontSize: 12, color: C.teal, fontWeight: 600, padding: "11px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>Ver las {notasHoy.length} en la pizarra →</div>
            )}
          </div>
          )}
        </>)}

        {/* DOCK */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3,1fr)" : "repeat(6,1fr)", gap: isMobile ? 10 : 12, marginTop: 24 }}>
          {dock.map((d) => (
            <button key={d.id} onClick={() => onNav(d.id)} style={{ ...cardBase, padding: "14px 6px", textAlign: "center", cursor: "pointer", color: C.ink2, transition: "transform .18s ease, border-color .18s ease" }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = "rgba(46,230,182,0.35)"; e.currentTarget.style.color = C.ink; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = C.line; e.currentTarget.style.color = C.ink2; }}>
              {d.id === "pizarra" && comBadge > 0 && <span style={{ position: "absolute", top: 8, right: 10, minWidth: 18, height: 18, borderRadius: 9, background: C.rojo, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", fontFamily: C.grotesk }}>{comBadge}</span>}
              <div style={{ color: C.teal, marginBottom: 7, display: "flex", justifyContent: "center" }}><Icon id={d.id} size={24} /></div>
              <div style={{ fontSize: 11, fontWeight: 600, fontFamily: C.grotesk }}>{d.label}</div>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}
