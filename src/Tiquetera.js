// build: tiquetera 11 — login con Supabase Auth (email+contraseña por persona)
import { useState, useEffect, useCallback } from "react";
import { login, logout, getSession, authedFetch } from "./auth";

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

async function sb(path, options = {}) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Prefer": "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// LightData API externa (mismo mecanismo que la verificación de demorados en App.js)
const TOKEN_EMPRESA = "ldae_125_6e2c8f1d4a9b3d7c5f0a2e8b1c4d7a96";
const ID_EMPRESA = 125;

function fmtFecha(f) {
  if (!f) return "";
  const d = new Date(f);
  if (isNaN(d.getTime())) return String(f);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Panel "Info del envío": estado actual desde envios_busqueda + historial en vivo desde LightData
function InfoEnvio({ envioId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);

  const consultar = useCallback(async () => {
    setCargando(true);
    const out = { envio: null, historial: null, error: "" };
    try {
      const rows = await sb(`envios_busqueda?id_interno=eq.${encodeURIComponent(envioId)}&limit=1`);
      out.envio = rows && rows[0] ? rows[0] : null;
      if (!out.envio) {
        out.error = "El envío ya no está en la caché de búsqueda (guarda ~6 días).";
      } else {
        const cod = String(out.envio.cod_cliente || "").trim();
        let tok = null;
        if (cod) {
          const variantes = [...new Set([cod, cod.replace(/^0+/, ""), cod.padStart(4, "0")])];
          for (const v of variantes) {
            try {
              const tk = await sb(`clientes_tokens?codigo=eq.${encodeURIComponent(v)}&select=token&limit=1`);
              if (tk && tk[0] && tk[0].token) { tok = tk[0].token; break; }
            } catch (e) { /* variante inválida para el tipo de columna, probar la siguiente */ }
          }
        }
        if (tok) {
          try {
            const res = await fetch("https://apiexterna.lightdata.com.ar/externa/obtener-datos-envio", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TOKEN_EMPRESA}` },
              body: JSON.stringify({ idEmpresa: ID_EMPRESA, idEnvio: String(envioId), token: tok }),
            });
            const j = res.ok ? await res.json() : null;
            out.historial = j && j.success && j.data && j.data.estadosHistorial ? j.data.estadosHistorial : null;
            if (Array.isArray(out.historial)) {
              out.historial = [...out.historial].sort((a, b) => new Date(a.fecha) - new Date(b.fecha)); // cronológico: retirado → … → entregado
            }
            if (!out.historial) out.error = "LightData no devolvió historial para este envío.";
          } catch (e) { out.error = "No se pudo consultar LightData: " + e.message; }
        } else {
          out.error = "Sin token del cliente (código " + (cod || "¿?") + ") — se muestra solo el estado de la caché.";
        }
      }
    } catch (e) { out.error = "Error consultando el envío: " + e.message; }
    setData(out);
    setCargando(false);
  }, [envioId]);

  useEffect(() => { if (open && !data && !cargando) consultar(); }, [open, data, cargando, consultar]);

  const e = data && data.envio;
  return (
    <div style={{ maxWidth: 640, marginBottom: 10 }}>
      <button onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(74,158,255,0.35)", background: "rgba(74,158,255,0.08)", color: "#4A9EFF" }}>
        📦 Info del envío
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s", fontSize: 10 }}>▶</span>
      </button>
      {open && (
        <div style={{ border: "1px solid rgba(74,158,255,0.25)", borderRadius: "0 10px 10px 10px", background: "rgba(74,158,255,0.05)", padding: "12px 14px", fontSize: 13 }}>
          {cargando && <div style={{ color: "rgba(255,255,255,0.5)" }}>Consultando LightData…</div>}
          {!cargando && data && (<>
            {e && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ padding: "3px 10px", borderRadius: 6, fontWeight: 700, background: /entregado/i.test(e.estado) ? "rgba(46,207,170,0.15)" : "rgba(255,176,32,0.15)", color: /entregado/i.test(e.estado) ? "#2ECFAA" : "#FFB020" }}>
                    {e.estado || "¿?"}{e.fecha_estado ? ` · ${e.fecha_estado}` : ""}
                  </span>
                  {e.cadete && <span style={{ color: "rgba(255,255,255,0.75)" }}>🛵 <b>{e.cadete}</b></span>}
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                  <b style={{ color: "#fff" }}>{e.nombre || "—"}</b> · {e.direccion || "—"}{e.localidad ? `, ${e.localidad}` : ""}{e.cp ? ` (CP ${e.cp})` : ""}<br />
                  Cliente: {e.razon_social || e.cod_cliente || "—"}
                  {e.id_venta_ml ? <> · Venta ML: {e.id_venta_ml}</> : null}
                  {e.url_tracking ? <> · <a href={e.url_tracking} target="_blank" rel="noreferrer" style={{ color: "#4A9EFF" }}>Ver tracking</a></> : null}
                </div>
              </div>
            )}
            {Array.isArray(data.historial) && data.historial.length > 0 && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#4A9EFF", fontWeight: 700, marginBottom: 6 }}>Historial</div>
                {data.historial.map((h, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "4px 0", borderBottom: i < data.historial.length - 1 ? "1px dashed rgba(255,255,255,0.06)" : "none" }}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", flex: "0 0 auto", background: i === data.historial.length - 1 ? "#2ECFAA" : "rgba(255,255,255,0.25)" }} />
                    <span style={{ flex: "1 1 auto", color: "#fff", fontWeight: i === data.historial.length - 1 ? 700 : 400 }}>{h.estado}</span>
                    <span style={{ color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>{fmtFecha(h.fecha)}</span>
                    {h.quien && <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.quien}</span>}
                  </div>
                ))}
              </div>
            )}
            {data.error && <div style={{ color: "#FFB020", fontSize: 12.5, marginTop: 6 }}>⚠ {data.error}</div>}
            <button onClick={() => { setData(null); consultar(); }}
              style={{ marginTop: 8, padding: "5px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)" }}>
              ↻ Actualizar
            </button>
          </>)}
        </div>
      )}
    </div>
  );
}

// Config del equipo (PIN, operadores, duplas): vive en la tabla tiquetera_config y se edita desde el panel ⚙️ (solo Alejo)
const CONFIG_DEFAULT = { pin: "2121", operadores: ["Santi", "Paco", "Tiago", "Emanuel", "Admin"], duplas: ["Paco/Tiago", "Santi/Emanuel"] };

const TIPO_COLORES = {
  "estado de envío": { bg: "rgba(74,158,255,0.15)", color: "#4A9EFF" },
  "demorado":        { bg: "rgba(255,176,32,0.15)", color: "#FFB020" },
  "devolución":      { bg: "rgba(167,139,250,0.15)", color: "#A78BFA" },
  "reclamo":         { bg: "rgba(255,92,92,0.15)", color: "#FF9D9D" },
  "colecta":         { bg: "rgba(46,207,170,0.15)", color: "#2ECFAA" },
  "otro":            { bg: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" },
};

const ESTADO_BADGES = {
  abierto:            { txt: "● Nuevo",          bg: "rgba(46,207,170,0.15)", color: "#2ECFAA" },
  enviando:           { txt: "📤 Enviando…",     bg: "rgba(74,158,255,0.15)", color: "#4A9EFF" },
  esperando_cadete:   { txt: "⏳ Esp. cadete",   bg: "rgba(255,176,32,0.15)", color: "#FFB020" },
  esperando_deposito: { txt: "📦 Esp. depósito", bg: "rgba(74,158,255,0.15)", color: "#4A9EFF" },
  esperando_cliente:  { txt: "✓ Contestado",  bg: "rgba(46,207,170,0.15)", color: "#2ECFAA" },
  resuelto:           { txt: "✓ Resuelto",       bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)" },
};

function edadMin(caso) { return (Date.now() - new Date(caso.created_at).getTime()) / 60000; }
function edadTxt(caso) {
  const m = Math.floor(edadMin(caso));
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}
function edadColor(caso) {
  if (caso.estado === "resuelto") return "rgba(255,255,255,0.25)";
  if (caso.estado === "esperando_cliente") return "#2ECFAA"; // contestado: la presión bajó
  const m = edadMin(caso);
  if (m < 30) return "#4A9EFF";   // nuevo (azul — verde confunde con "resuelto")
  if (m < 120) return "#FFB020";  // esperando hace 30min-2hs
  return "#FF5C5C";               // +2hs sin resolver
}
function dormido(c)   { return c.snooze_hasta && new Date(c.snooze_hasta) > new Date(); }
function desperto(c)  { return c.snooze_hasta && new Date(c.snooze_hasta) <= new Date() && c.estado !== "resuelto"; }
// "Soporte Lemirk - Flexit" → "Lemirk" · "Tiziano Vila - Soporte Flexit" → "Tiziano Vila" · "Alejo - Flexit" → "Alejo"
function nombreCliente(txt) {
  if (!txt) return "";
  let t = String(txt).trim();
  t = t.replace(/^soporte\s+/i, "").replace(/\s*[-–]\s*soporte\s+flexit\s*$/i, "").replace(/\s*[-–]\s*flexit\s*$/i, "");
  return t.trim() || String(txt).trim();
}
function ordenGrupo(c) {
  if (c.fijado && c.estado !== "resuelto") return 0;
  if (desperto(c)) return 1;
  if (c.estado === "resuelto") return 4;
  if (dormido(c)) return 3;
  return 2;
}

export default function Tiquetera() {
  const [casos, setCasos] = useState([]);
  const [error, setError] = useState("");
  const [busca, setBusca] = useState("");
  const [chip, setChip] = useState("abiertos");
  const [orden, setOrden] = useState("antiguos");
  const [abierto, setAbierto] = useState(null);
  const [textos, setTextos] = useState({});
  const [notaTxt, setNotaTxt] = useState("");
  const [operador, setOperador] = useState(() => (getSession() || {}).nombre || "");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [admPin, setAdmPin] = useState("");
  const [admOps, setAdmOps] = useState("");
  const [admDuplas, setAdmDuplas] = useState("");

  const cargar = useCallback(async () => {
    try {
      const desde = new Date(Date.now() - 7 * 86400000).toISOString();
      const rows = await sb(`casos?select=*&created_at=gte.${desde}&order=created_at.desc&limit=500`);
      setCasos(rows || []);
      setError("");
    } catch (e) { setError("No se pudo cargar la tiquetera: " + e.message); }
  }, []);

  useEffect(() => { cargar(); const t = setInterval(cargar, 30000); return () => clearInterval(t); }, [cargar]);

  useEffect(() => { (async () => { try { const r = await sb("tiquetera_config?id=eq.1"); setCfg(r && r[0] ? r[0] : CONFIG_DEFAULT); } catch (e) { setCfg(CONFIG_DEFAULT); } })(); }, []);

  async function guardarAdmin() {
    const nuevo = {
      pin: admPin.trim() || "2121",
      operadores: admOps.split(",").map(s => s.trim()).filter(Boolean),
      duplas: admDuplas.split(",").map(s => s.trim()).filter(Boolean),
    };
    try {
      await sb("tiquetera_config?id=eq.1", { method: "PATCH", body: JSON.stringify(nuevo) });
      setCfg({ ...cfg, ...nuevo });
      setAdminOpen(false);
    } catch (e) { setError("No se pudo guardar la configuración: " + e.message); }
  }

  async function patch(id, cambios) {
    try {
      await sb(`casos?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
      await cargar();
    } catch (e) { setError("Error al actualizar: " + e.message); }
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const counts = {
    abiertos: casos.filter(c => ["abierto", "enviando"].includes(c.estado) && !dormido(c)).length,
    sinContestar: casos.filter(c => c.estado === "abierto" && !dormido(c)).length,
    cadete: casos.filter(c => c.estado === "esperando_cadete").length,
    deposito: casos.filter(c => c.estado === "esperando_deposito").length,
    resueltos: casos.filter(c => c.estado === "resuelto" && c.resuelto_at && new Date(c.resuelto_at) >= hoy).length,
  };
  const abiertosViejos = casos.filter(c => c.estado !== "resuelto" && edadMin(c) > 480).length;

  const visibles = casos
    .filter(c => {
      if (busca) {
        const q = busca.toLowerCase();
        const blob = `#${c.id} ${c.id} ${c.grupo || ""} ${c.chat_id || ""} ${c.autor || ""} ${c.mensaje || ""} ${c.envio_id || ""} ${c.cadete || ""} ${c.tipo || ""} ${c.asignado || ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (chip === "abiertos") return c.estado !== "resuelto";
      if (chip === "sin_contestar") return c.estado === "abierto";
      if (chip === "cadete") return c.estado === "esperando_cadete";
      if (chip === "deposito") return c.estado === "esperando_deposito";
      if (chip === "resueltos") return c.estado === "resuelto";
      return true;
    })
    .sort((a, b) => ordenGrupo(a) - ordenGrupo(b) || (orden === "antiguos" ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.created_at) - new Date(a.created_at)));

  const chipStyle = (activo) => ({
    padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer", border: "1px solid",
    borderColor: activo ? "#2ECFAA" : "rgba(255,255,255,0.12)",
    background: activo ? "rgba(46,207,170,0.15)" : "rgba(255,255,255,0.04)",
    color: activo ? "#2ECFAA" : "rgba(255,255,255,0.6)", fontWeight: activo ? 700 : 500,
  });
  const btn = (primario) => ({
    flex: primario ? 1 : "0 0 auto", padding: "9px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
    border: primario ? "none" : "1px solid rgba(255,255,255,0.15)",
    background: primario ? "#1A9E7C" : "rgba(255,255,255,0.05)",
    color: primario ? "#fff" : "rgba(255,255,255,0.7)",
  });

  if (!cfg) return <div style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>Cargando…</div>;

  if (!operador) return (
    <div style={{ minHeight: "62vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 430, maxWidth: "94vw", padding: "38px 34px", borderRadius: 22, border: "1px solid rgba(46,207,170,0.22)", background: "linear-gradient(165deg, rgba(46,207,170,0.09), rgba(58,143,212,0.06) 55%, rgba(255,255,255,0.02))", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", textAlign: "center" }}>
        <div style={{ width: 66, height: 66, margin: "0 auto 16px", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, background: "rgba(46,207,170,0.12)", border: "1px solid rgba(46,207,170,0.35)", boxShadow: "0 6px 20px rgba(46,207,170,0.15)" }}>🎟️</div>
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em" }}>Tiquetera Flexit</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 4, marginBottom: 24 }}>Consultas de WhatsApp · Agente</div>
        <form onSubmit={async e => {
          e.preventDefault();
          if (loginBusy) return;
          setLoginBusy(true); setLoginErr("");
          try { const ses = await login(loginEmail, loginPass); setOperador(ses.nombre); }
          catch (err) { setLoginErr(err.message || "No se pudo iniciar sesión"); }
          finally { setLoginBusy(false); }
        }}>
          <input type="email" autoFocus autoComplete="username" value={loginEmail} onChange={e => { setLoginEmail(e.target.value); setLoginErr(""); }} placeholder="Email"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${loginErr ? "#FF5C5C" : "rgba(255,255,255,0.18)"}`, background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 15, boxSizing: "border-box", outline: "none", marginBottom: 10 }} />
          <input type="password" autoComplete="current-password" value={loginPass} onChange={e => { setLoginPass(e.target.value); setLoginErr(""); }} placeholder="Contraseña"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${loginErr ? "#FF5C5C" : "rgba(255,255,255,0.18)"}`, background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 15, boxSizing: "border-box", outline: "none" }} />
          {loginErr && <div style={{ color: "#FF5C5C", fontSize: 12.5, marginTop: 8 }}>{loginErr}</div>}
          <button type="submit" disabled={loginBusy}
            style={{ width: "100%", marginTop: 16, padding: "13px 10px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(46,207,170,0.35)", background: loginBusy ? "rgba(46,207,170,0.04)" : "rgba(46,207,170,0.12)", color: "#2ECFAA" }}>
            {loginBusy ? "Entrando…" : "Entrar"}</button>
        </form>
      </div>
    </div>
  );

  return (
    <div>
      <style>{`@keyframes temblarTk{0%,100%{transform:translateX(0)}10%{transform:translateX(-3px)}20%{transform:translateX(3px)}30%{transform:translateX(-2px)}40%{transform:translateX(2px)}50%{transform:translateX(0)}}`}</style>

      {error && <div style={{ background: "rgba(226,75,74,0.15)", color: "#E24B4A", border: "1px solid rgba(226,75,74,0.3)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: "1rem" }}>{error}</div>}

      {abiertosViejos > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 10, border: "1px solid rgba(74,158,255,0.4)", background: "rgba(74,158,255,0.08)", fontSize: 14, marginBottom: "1rem" }}>
          <span>🌙</span>
          <div><b style={{ color: "#4A9EFF" }}>Traspaso de turno:</b> hay <b>{abiertosViejos} caso{abiertosViejos > 1 ? "s" : ""}</b> con más de 8 horas sin resolver.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 420 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente, grupo, envío, dirección…"
            style={{ width: "100%", padding: "9px 12px 9px 34px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
        </div>
        <div onClick={() => setChip("abiertos")} style={chipStyle(chip === "abiertos")}>Abiertos <b>{counts.abiertos}</b></div>
        <div onClick={() => setChip("sin_contestar")} style={{ ...chipStyle(chip === "sin_contestar"), borderColor: chip === "sin_contestar" ? "#FF5C5C" : "rgba(255,92,92,0.35)", color: chip === "sin_contestar" ? "#FF5C5C" : "rgba(255,140,140,0.8)", background: chip === "sin_contestar" ? "rgba(255,92,92,0.12)" : "rgba(255,92,92,0.04)" }}>Sin contestar <b>{counts.sinContestar}</b></div>
        <div onClick={() => setChip("cadete")} style={chipStyle(chip === "cadete")}>Esp. cadete <b>{counts.cadete}</b></div>
        <div onClick={() => setChip("deposito")} style={chipStyle(chip === "deposito")}>Esp. depósito <b>{counts.deposito}</b></div>
        <div onClick={() => setChip("resueltos")} style={chipStyle(chip === "resueltos")}>Resueltos hoy <b>{counts.resueltos}</b></div>
        <select value={orden} onChange={e => setOrden(e.target.value)} title="Orden de la lista"
          style={{ padding: "6px 10px", borderRadius: 20, fontSize: 12.5, cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)", background: "#12123A", color: "rgba(255,255,255,0.6)" }}>
          <option value="antiguos">⇅ Antiguos primero</option>
          <option value="nuevos">⇅ Nuevos primero</option>
        </select>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>
          👤 <b style={{ color: "#fff" }}>{operador}</b>
          <span onClick={() => { logout(); setOperador(""); }} style={{ cursor: "pointer", textDecoration: "underline" }}>salir</span>
          {operador === "Admin" && <span title="Configuración de la tiquetera (pide PIN de admin)" onClick={() => {
            if (adminOpen) { setAdminOpen(false); return; }
            const ok = sessionStorage.getItem("tk_admin_ok") === "1" || window.prompt("PIN de administrador:") === (cfg.pin_admin || "4747");
            if (!ok) { setError("PIN de administrador incorrecto."); return; }
            sessionStorage.setItem("tk_admin_ok", "1");
            setAdmPin(cfg.pin); setAdmOps((cfg.operadores || []).join(", ")); setAdmDuplas((cfg.duplas || []).join(", ")); setAdminOpen(true);
          }} style={{ cursor: "pointer", fontSize: 15 }}>⚙️</span>}
        </div>
      </div>

      {adminOpen && (
        <div style={{ border: "1px solid rgba(74,158,255,0.35)", borderRadius: 12, padding: "14px 16px", marginBottom: "1rem", background: "rgba(74,158,255,0.06)", maxWidth: 680 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>⚙️ Configuración de la tiquetera</div>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>PIN del equipo
              <input value={admPin} onChange={e => setAdmPin(e.target.value)} style={{ width: "100%", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 13, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>Operadores (separados por coma)
              <input value={admOps} onChange={e => setAdmOps(e.target.value)} style={{ width: "100%", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 13, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>Duplas para el reparto automático (separadas por coma)
              <input value={admDuplas} onChange={e => setAdmDuplas(e.target.value)} style={{ width: "100%", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 13, boxSizing: "border-box" }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={btn(true)} onClick={guardarAdmin}>Guardar</button>
            <button style={btn(false)} onClick={() => setAdminOpen(false)}>Cancelar</button>
          </div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>Los cambios aplican para los casos e ingresos nuevos; los casos ya asignados no se tocan.</div>
        </div>
      )}

      {visibles.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>
          Sin casos {chip === "resueltos" ? "resueltos" : "pendientes"}. Cuando entre un mensaje a un grupo conectado, aparece acá solo.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visibles.map(c => {
          const tc = TIPO_COLORES[c.tipo] || TIPO_COLORES.otro;
          const eb = ESTADO_BADGES[c.estado] || ESTADO_BADGES.abierto;
          const exp = abierto === c.id;
          const desp = desperto(c);
          const dorm = dormido(c);
          return (
            <div key={c.id} style={{
              borderRadius: 10, overflow: "hidden", opacity: dorm || c.estado === "resuelto" ? 0.55 : 1,
              border: `1px solid ${desp ? "#FFB020" : c.fijado ? "#2ECFAA" : "rgba(255,255,255,0.1)"}`,
              borderLeft: `4px solid ${edadColor(c)}`,
              background: "rgba(255,255,255,0.03)",
              boxShadow: desp ? "0 0 12px rgba(255,176,32,0.35)" : "none",
              animation: desp ? "temblarTk 1.6s ease-in-out infinite" : "none",
            }}>
              <div onClick={() => setAbierto(exp ? null : c.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12.5, fontWeight: 700, color: "#4A9EFF", background: "rgba(74,158,255,0.1)", padding: "2px 8px", borderRadius: 6 }}>#{c.id}</span>
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 120 }}>{nombreCliente(c.grupo || c.autor) || c.chat_id || "—"}</span>
                <span style={{ padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", background: tc.bg, color: tc.color }}>{c.tipo || "otro"}</span>
                {c.asignado && <span style={{ fontSize: 11, color: "#4A9EFF", background: "rgba(74,158,255,0.1)", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>👥 {c.asignado}</span>}
                <span style={{ flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 120 }}>{c.mensaje}</span>
                {c.fijado && c.estado !== "resuelto" && <span style={{ fontSize: 11.5, color: "#2ECFAA", background: "rgba(46,207,170,0.12)", border: "1px solid rgba(46,207,170,0.35)", padding: "2px 8px", borderRadius: 6 }}>📌 Fijado</span>}
                {dorm && <span style={{ fontSize: 11.5, color: "#FFB020", background: "rgba(255,176,32,0.12)", padding: "2px 8px", borderRadius: 6 }}>⏰ hasta {new Date(c.snooze_hasta).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
                {desp && <span style={{ fontSize: 11.5, color: "#FFB020", background: "rgba(255,176,32,0.2)", fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>⏰ ¡Despertó!</span>}
                <span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, background: eb.bg, color: eb.color, whiteSpace: "nowrap" }}>{eb.txt}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: edadColor(c), marginRight: 5, boxShadow: edadMin(c) > 120 && c.estado !== "resuelto" ? `0 0 6px ${edadColor(c)}` : "none" }} />
                  {edadTxt(c)}
                </span>
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, transform: exp ? "rotate(90deg)" : "none", transition: "transform .2s" }}>▶</span>
              </div>

              {exp && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "14px 16px" }}>
                  <div style={{ background: "rgba(74,158,255,0.08)", borderRadius: "0 10px 10px 10px", padding: "10px 12px", maxWidth: 640, fontSize: 14, lineHeight: 1.45, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: "#2ECFAA", fontWeight: 600, marginBottom: 3 }}>{nombreCliente(c.autor) || "Cliente"}</div>
                    {c.mensaje}
                  </div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                    {c.envio_id && <span>Envío <b style={{ color: "#fff" }}>#{c.envio_id}</b></span>}
                    {c.cadete && <span>Cadete: <b style={{ color: "#fff" }}>{c.cadete}</b></span>}
                    <span>Chat: {c.chat_id}</span>
                    {c.turno && <span>Turno: {c.turno}</span>}
                    {c.resuelto_por && <span style={{ color: "#2ECFAA" }}>✓ Resuelto por {c.resuelto_por}</span>}
                  </div>

                  {c.envio_id && <InfoEnvio envioId={c.envio_id} />}

                  {Array.isArray(c.notas) && c.notas.length > 0 && c.notas.map((n, i) => (
                    <div key={i} style={{ background: "rgba(255,176,32,0.08)", border: "1px solid rgba(255,176,32,0.3)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#E8D9A8", maxWidth: 640, marginBottom: 8 }}>
                      <b style={{ color: "#FFB020" }}>{n.quien || "Nota"}:</b> {n.texto}
                    </div>
                  ))}

                  {c.respuesta_enviada && (
                    <div style={{ background: "rgba(46,207,170,0.07)", border: "1px solid rgba(46,207,170,0.35)", borderRadius: 10, padding: "10px 12px", maxWidth: 640, marginBottom: 10 }}>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#2ECFAA", fontWeight: 700, marginBottom: 4 }}>
                        {c.estado === "enviando" ? "📤 En cola — sale en menos de 1 minuto" : ("✓✓ Enviado al cliente" + (c.enviado_at ? " · " + new Date(c.enviado_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""))}
                      </div>
                      <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.45 }}>{c.respuesta_enviada}</div>
                    </div>
                  )}

                  {c.estado !== "resuelto" && (<>
                    <div style={{ border: "1px dashed rgba(46,207,170,0.5)", borderRadius: 10, padding: "10px 12px", background: "rgba(46,207,170,0.04)", maxWidth: 640, marginBottom: 10 }}>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#2ECFAA", fontWeight: 700, marginBottom: 5 }}>{c.respuesta_enviada ? "✦ Enviar otro mensaje (opcional)" : "✦ Respuesta — editá antes de enviar"}</div>
                      <textarea value={textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_enviada ? "" : (c.respuesta_sugerida || ""))}
                        onChange={e => setTextos({ ...textos, [c.id]: e.target.value })}
                        rows={2}
                        style={{ width: "100%", background: "transparent", border: "none", color: "#fff", fontSize: 13.5, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ display: "flex", gap: 8, maxWidth: 640, marginBottom: 10 }}>
                      <input value={notaTxt} onChange={e => setNotaTxt(e.target.value)} placeholder="Nota interna para el equipo (no la ve el cliente)…"
                        style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#fff", fontSize: 13 }} />
                      <button style={btn(false)} onClick={() => { if (!notaTxt.trim()) return; patch(c.id, { notas: [...(c.notas || []), { quien: operador, texto: notaTxt.trim(), at: new Date().toISOString() }] }); setNotaTxt(""); }}>+ Nota</button>
                    </div>
                    <div style={{ display: "flex", gap: 8, maxWidth: 640, flexWrap: "wrap" }}>
                      <button style={btn(true)} title="Copiar la respuesta al portapapeles" onClick={(e) => {
                        const txt = (textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_sugerida || "")).trim();
                        if (!txt) { setError("No hay respuesta para copiar."); return; }
                        navigator.clipboard.writeText(txt);
                        const b = e.currentTarget; const o = b.textContent; b.textContent = "✓ Copiado"; setTimeout(() => { b.textContent = o; }, 1500);
                      }}>📋 Copiar</button>
                      <button style={btn(false)} onClick={() => {
                        const txt = (textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_sugerida || "")).trim();
                        if (!txt) { setError("Escribí la respuesta antes de enviar."); return; }
                        patch(c.id, { respuesta_enviada: txt, estado: "enviando", enviado_por: operador });
                      }}>✓ Aprobar y enviar</button>
                      <button style={btn(false)} title="Si copiaste el mensaje y lo pegaste vos en WhatsApp, marcá el caso como respondido con esto" onClick={() => {
                        const txt = (textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_sugerida || "")).trim();
                        patch(c.id, { respuesta_enviada: txt || c.respuesta_sugerida || "(respondido por fuera de la tiquetera)", estado: "esperando_cliente", enviado_at: new Date().toISOString(), enviado_via: "manual", enviado_por: operador });
                      }}>✓✓ Enviado</button>
                      <button style={btn(false)} onClick={() => patch(c.id, { estado: c.estado === "esperando_cadete" ? "abierto" : "esperando_cadete" })}>
                        {c.estado === "esperando_cadete" ? "Volver a abierto" : "Esperando cadete"}
                      </button>
                      <button style={btn(false)} title="Fijar arriba" onClick={() => patch(c.id, { fijado: !c.fijado })}>📌</button>
                      <select defaultValue="" title="Posponer este caso (la alarma lo despierta)"
                        onChange={e => { const v = e.target.value; if (!v) return; let d; if (v === "manana") { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); } else { d = new Date(Date.now() + Number(v) * 3600000); } patch(c.id, { snooze_hasta: d.toISOString() }); e.target.value = ""; }}
                        style={{ ...btn(false), background: "#12123A", color: "rgba(255,255,255,0.7)" }}>
                        <option value="" disabled>⏰ Posponer…</option>
                        <option value="0.5">30 min</option>
                        <option value="1">1 hora</option>
                        <option value="2">2 horas</option>
                        <option value="4">4 horas</option>
                        <option value="8">8 horas</option>
                        <option value="manana">Mañana 9hs</option>
                      </select>
                      {c.snooze_hasta && <button style={{ ...btn(false), borderColor: "rgba(255,176,32,0.5)", color: "#FFB020" }} title="Cancela la alarma: deja de sonar/temblar y el caso vuelve a la lista normal" onClick={() => patch(c.id, { snooze_hasta: null })}>🔕 Apagar alarma</button>}
                      <button style={{ ...btn(false), borderColor: "rgba(46,207,170,0.4)", color: "#2ECFAA" }}
                        onClick={() => patch(c.id, { estado: "resuelto", resuelto_por: operador, resuelto_at: new Date().toISOString(), snooze_hasta: null, fijado: false })}>
                        Resolver
                      </button>
                    </div>
                  </>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
