import React, { useState } from "react";

// Pantalla de inicio de la app Flexit.
// Landing de marca con accesos a las 4 secciones. Reusa el mecanismo de
// secciones de App.js: cada tarjeta llama onNav(seccion) -> setSeccion(...).

// Íconos de línea (paths de Lucide, MIT) — reemplazan a los emojis para un
// look consistente entre dispositivos.
const ICONS = {
  metricas: (
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  colectas: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  arribos: (
    <>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
  tiquetera: (
    <>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </>
  ),
  pagos: (
    <>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
};

// Widget de login arriba a la derecha del home (acceso directo a Liquidaciones)
function LoginWidget({ session, onLogin, onLogout, isMobile }) {
  const [open, setOpen] = useState(false);
  const [em, setEm] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); if (busy) return; setBusy(true); setErr("");
    try { await onLogin(em, pw); setOpen(false); setEm(""); setPw(""); }
    catch (er) { setErr(er.message || "No se pudo iniciar sesión"); }
    finally { setBusy(false); }
  };
  const inp = { width: "100%", padding: "9px 11px", borderRadius: 9, border: `1px solid ${err ? "#FF5C5C" : "rgba(255,255,255,0.18)"}`, background: "rgba(0,0,0,0.3)", color: "#fff", fontSize: 13, boxSizing: "border-box", outline: "none" };
  if (session) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
        <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: "50%", background: "#2ECFAA" }} />
        {!isMobile && <span>{session.email}</span>}
        <button onClick={onLogout} style={{ padding: "5px 11px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", fontSize: 12, cursor: "pointer" }}>Salir</button>
      </div>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ padding: "7px 14px", borderRadius: 9, border: "1px solid rgba(46,207,170,0.35)", background: "rgba(46,207,170,0.12)", color: "#2ECFAA", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Ingresar</button>
      {open && (
        <form onSubmit={submit} style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 250, padding: 14, borderRadius: 14, border: "1px solid rgba(46,207,170,0.25)", background: "#12123a", boxShadow: "0 14px 40px rgba(0,0,0,0.5)", zIndex: 50, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", marginBottom: 2 }}>Ingresar a Liquidaciones</div>
          <input type="email" autoFocus autoComplete="username" placeholder="Email" value={em} onChange={(e) => { setEm(e.target.value); setErr(""); }} style={inp} />
          <input type="password" autoComplete="current-password" placeholder="Contraseña" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} style={inp} />
          {err && <div style={{ color: "#FF5C5C", fontSize: 11.5 }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ padding: "9px", borderRadius: 9, border: "1px solid rgba(46,207,170,0.35)", background: "rgba(46,207,170,0.14)", color: "#2ECFAA", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      )}
    </div>
  );
}

export default function Home({ onNav, onMenu, isMobile, logo, session, onLogin, onLogout }) {
  const cards = [
    { id: "metricas",  title: "Métricas",  desc: "SLA, demorados, pendientes y performance por cadete.", accent: "#22D3EE", grad: "linear-gradient(135deg, #22D3EE, #0891B2)" },
    { id: "colectas",  title: "Colectas",  desc: "Retiros del día por cliente, horarios y choferes.",     accent: "#A78BFA", grad: "linear-gradient(135deg, #A78BFA, #7C3AED)" },
    { id: "arribos",   title: "Arribos",   desc: "Quién va llegando al depósito, ETA y avance en vivo.",   accent: "#34D399", grad: "linear-gradient(135deg, #34D399, #059669)" },
    { id: "tiquetera", title: "Tiquetera", desc: "Casos de clientes, respuestas del agente y aprobación.", accent: "#FBBF24", grad: "linear-gradient(135deg, #FBBF24, #D97706)" },
    { id: "zonas",     title: "Zonas",     desc: "Saturación por zona en vivo: carga del día contra capacidad.", accent: "#F87171", grad: "linear-gradient(135deg, #F87171, #DC2626)" },
    { id: "pagos",     title: "Liquidaciones", desc: "Pagos semanales de cadetes: cálculo, tarifas y cierre.", accent: "#2ECFAA", grad: "linear-gradient(135deg, #2ECFAA, #059669)" },
  ];

  return (
    <div style={{ minHeight: "72vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", paddingTop: isMobile ? 8 : 24 }}>
      {/* Login directo arriba a la derecha (acceso a Liquidaciones sin pasar por el menú) */}
      {onLogin && (
        <div style={{ position: "absolute", top: isMobile ? 6 : 14, right: isMobile ? 8 : 16, zIndex: 20 }}>
          <LoginWidget session={session} onLogin={onLogin} onLogout={onLogout} isMobile={isMobile} />
        </div>
      )}

      {/* Marca */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: isMobile ? 26 : 38 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: isMobile ? 52 : 62, height: isMobile ? 52 : 62, borderRadius: 15, overflow: "hidden", boxShadow: "0 8px 30px rgba(58,143,212,0.35), inset 0 0 0 1px rgba(46,207,170,0.22)" }}>
            <img src={logo} alt="Flexit" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <span style={{ fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: isMobile ? 38 : 48, fontWeight: 700, letterSpacing: "-1px", color: "#fff" }}>Flexit</span>
        </div>
        <p style={{ marginTop: 12, color: "rgba(255,255,255,0.5)", fontSize: isMobile ? 13 : 15, letterSpacing: "0.3px" }}>
          Última milla<span style={{ color: "#2ECFAA", margin: "0 8px" }}>•</span>Panel de operaciones
        </p>
      </div>

      {/* Accesos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 11 : 16, width: "100%", maxWidth: 760 }}>
        {cards.map((c) => (
          <button key={c.id} onClick={() => onNav(c.id)}
            style={{
              position: "relative", textAlign: "left", cursor: "pointer",
              gridColumn: c.full ? "1 / -1" : "auto",
              background: "linear-gradient(180deg, #1A1A4A, #101030)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18,
              padding: isMobile ? "15px 13px" : "22px 20px 20px",
              minHeight: c.full ? (isMobile ? 92 : 104) : (isMobile ? 120 : 150),
              display: "flex", flexDirection: "column", color: "#fff",
              transition: "transform .18s ease, border-color .18s ease, box-shadow .18s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.borderColor = c.accent + "70"; e.currentTarget.style.boxShadow = "0 16px 34px rgba(0,0,0,0.4)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ width: isMobile ? 38 : 46, height: isMobile ? 38 : 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: c.grad, boxShadow: "0 6px 18px " + c.accent + "40", marginBottom: "auto" }}>
              <svg width={isMobile ? 20 : 24} height={isMobile ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICONS[c.id]}
              </svg>
            </div>
            <span style={{ position: "absolute", top: isMobile ? 14 : 22, right: isMobile ? 13 : 20, color: "rgba(255,255,255,0.5)", fontSize: 18 }}>↗</span>
            <h2 style={{ fontSize: isMobile ? 15 : 19, fontWeight: 700, margin: 0, marginTop: isMobile ? 11 : 16 }}>{c.title}</h2>
            {!isMobile && <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 4, marginBottom: 0, lineHeight: 1.35 }}>{c.desc}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
