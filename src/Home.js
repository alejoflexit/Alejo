import React from "react";

// Pantalla de inicio de la app Flexit.
// Landing de marca con accesos a las 4 secciones. Reusa el mecanismo de
// secciones de App.js: cada tarjeta llama onNav(seccion) -> setSeccion(...).
export default function Home({ onNav, onMenu, isMobile, logo }) {
  const cards = [
    { id: "metricas",  icon: "ti-chart-bar",       title: "Métricas",  desc: "SLA, demorados, pendientes y performance por cadete.", accent: "#2ECFAA" },
    { id: "colectas",  icon: "ti-package",         title: "Colectas",  desc: "Retiros del día por cliente, horarios y choferes.",     accent: "#4ADE80" },
    { id: "arribos",   icon: "ti-truck-delivery",  title: "Arribos",   desc: "Quién va llegando al depósito, ETA y avance en vivo.",   accent: "#3A8FD4" },
    { id: "tiquetera", icon: "ti-ticket",          title: "Tiquetera", desc: "Casos de clientes, respuestas del agente y aprobación.", accent: "#A986FF" },
  ];

  return (
    <div style={{ minHeight: "72vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", paddingTop: isMobile ? 8 : 24 }}>
      {/* Menú (abre el sidebar) */}
      <button onClick={onMenu} aria-label="Menú"
        style={{ position: "absolute", top: 0, left: 0, width: 38, height: 38, borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        ☰
      </button>

      {/* Marca */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: isMobile ? 26 : 38 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: isMobile ? 52 : 62, height: isMobile ? 52 : 62, borderRadius: 15, overflow: "hidden", boxShadow: "0 8px 30px rgba(58,143,212,0.35), inset 0 0 0 1px rgba(46,207,170,0.22)" }}>
            <img src={logo} alt="Flexit" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <span style={{ fontSize: isMobile ? 38 : 48, fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>Flexit</span>
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
              background: "linear-gradient(180deg, #1A1A4A, #101030)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18,
              padding: isMobile ? "15px 13px" : "22px 20px 20px",
              minHeight: isMobile ? 120 : 150,
              display: "flex", flexDirection: "column", color: "#fff",
              transition: "transform .18s ease, border-color .18s ease, box-shadow .18s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.borderColor = c.accent + "70"; e.currentTarget.style.boxShadow = "0 16px 34px rgba(0,0,0,0.4)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ width: isMobile ? 38 : 46, height: isMobile ? 38 : 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: c.accent + "1f", border: "1px solid rgba(255,255,255,0.08)", marginBottom: "auto" }}>
              <i className={"ti " + c.icon} style={{ fontSize: isMobile ? 20 : 24, color: c.accent }} />
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
