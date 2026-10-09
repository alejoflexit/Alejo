// src/Usuarios.js — Centro de control de usuarios (solo admin)
// Matriz usuario × sección para prender/apagar accesos, alta de usuarios, cambio de contraseña
// y desactivar acceso. Todo lo privilegiado pasa por la edge function admin-usuarios.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SECCIONES, adminUsuarios, esAdmin } from "./permisos";
import { sbFetch } from "./colectasShared";
import { QrBot } from "./ColectasBot";

const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glass: "rgba(27,28,46,0.72)", pop: "rgba(20,21,36,0.97)",
  line: "rgba(255,255,255,0.07)", line2: "rgba(255,255,255,0.12)",
  teal: "#2ee6b6", ambar: "#F5C044", rojo: "#E8615F",
  grotesk: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
};
const card = { background: C.glass, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" };
const OPERATIVAS = SECCIONES.filter((s) => !s.soloAdmin).map((s) => s.id);

const inicial = (u) => ((u.nombre || u.email || "?").trim()[0] || "?").toUpperCase();
const nombreDe = (u) => u.nombre || (u.email || "").split("@")[0].replace(/^./, (c) => c.toUpperCase());
function haceCuanto(iso) {
  if (!iso) return "nunca entró";
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 60) return "hace un rato";
  const h = min / 60; if (h < 24) return `hace ${Math.round(h)} h`;
  const d = h / 24; if (d < 2) return "ayer";
  if (d < 30) return `hace ${Math.round(d)} días`;
  return `hace ${Math.round(d / 30)} meses`;
}
function generarPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return Array.from(a, (n) => abc[n % abc.length]).join("");
}
const seccionesDe = (u) => (Array.isArray(u.secciones) ? u.secciones : OPERATIVAS);
const mismo = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function Avatar({ u, size = 34 }) {
  const apagado = u.desactivado;
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2.6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: u.rol === "admin" ? "rgba(46,230,182,0.16)" : "rgba(255,255,255,0.07)", color: apagado ? C.ink3 : u.rol === "admin" ? C.teal : C.ink,
      fontFamily: C.grotesk, fontWeight: 700, fontSize: size * 0.42, boxShadow: `inset 0 0 0 1px ${u.rol === "admin" ? "rgba(46,230,182,0.3)" : C.line2}` }}>
      {inicial(u)}
    </div>
  );
}

function Toggle({ on, locked, onClick, label }) {
  return (
    <button type="button" onClick={locked ? undefined : onClick} aria-pressed={on} aria-label={label} title={label}
      style={{ width: 34, height: 20, borderRadius: 10, border: "none", padding: 0, position: "relative", cursor: locked ? "default" : "pointer",
        background: on ? (locked ? "rgba(46,230,182,0.28)" : C.teal) : "rgba(255,255,255,0.1)", transition: "background .15s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 8, background: on ? "#06221a" : "rgba(255,255,255,0.55)", transition: "left .15s",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        {locked && <i className="ti ti-lock" style={{ fontSize: 10, color: on ? C.teal : "#222" }} />}
      </span>
    </button>
  );
}

const btn = (tipo = "ghost") => ({
  padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
  ...(tipo === "primario" ? { background: C.teal, color: "#04150f", border: "none" }
    : tipo === "ambar" ? { background: "rgba(245,192,68,0.12)", color: C.ambar, border: "1px solid rgba(245,192,68,0.35)" }
    : tipo === "rojo" ? { background: "rgba(232,97,95,0.12)", color: C.rojo, border: "1px solid rgba(232,97,95,0.35)" }
    : { background: "rgba(255,255,255,0.05)", color: C.ink2, border: `1px solid ${C.line2}` }),
});
const input = { width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line2}`, borderRadius: 10, padding: "9px 12px", color: C.ink, fontSize: 14, outline: "none" };
const labelSt = { fontSize: 11, fontWeight: 600, color: C.ink3, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" };

function Copiable({ texto, children }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" style={btn()} onClick={() => { navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1600); }).catch(() => {}); }}>
      <i className={ok ? "ti ti-check" : "ti ti-copy"} /> {ok ? "Copiado" : children}
    </button>
  );
}

function useEscape(fn) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") fn(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [fn]);
}

// Tarjeta de credenciales para pasarle a la persona por WhatsApp
function Credenciales({ email, password, titulo, onCerrar }) {
  const msg = `Tu acceso a la app de Flexit:\nUsuario: ${email}\nContraseña: ${password}\nhttps://flota-logistica-iota.vercel.app`;
  return (
    <div style={{ ...card, background: "rgba(46,230,182,0.07)", border: "1px solid rgba(46,230,182,0.3)", padding: 16, marginTop: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}><i className="ti ti-circle-check" style={{ color: C.teal }} />{titulo}</div>
      <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, color: C.ink2, lineHeight: 1.7 }}>
        {email}<br />{password}
      </div>
      <div style={{ fontSize: 12, color: C.ink3, margin: "8px 0 12px" }}>Esta contraseña no se vuelve a mostrar. Copiala ahora.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Copiable texto={msg}>Copiar mensaje</Copiable>
        {onCerrar && <button type="button" style={btn()} onClick={onCerrar}>Listo</button>}
      </div>
    </div>
  );
}

// ── Panel lateral de un usuario ──
function Detalle({ u, onCerrar, onCambio }) {
  const [nombre, setNombre] = useState(u.nombre || "");
  const [pw, setPw] = useState("");
  const [pwOk, setPwOk] = useState(null);
  const [armado, setArmado] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { if (!armado) return; const t = setTimeout(() => setArmado(false), 3000); return () => clearTimeout(t); }, [armado]);
  useEscape(onCerrar);

  const correr = async (clave, fn) => {
    setBusy(clave); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };

  const guardarNombre = () => correr("nombre", async () => {
    await adminUsuarios("permisos", { id: u.id, nombre, secciones: seccionesDe(u) });
    onCambio();
  });
  const cambiarPw = () => correr("pw", async () => {
    await adminUsuarios("password", { id: u.id, password: pw });
    setPwOk(pw); setPw("");
  });
  const toggleAcceso = () => {
    if (!u.desactivado && !armado) { setArmado(true); return; }
    setArmado(false);
    correr("acceso", async () => { await adminUsuarios(u.desactivado ? "activar" : "desactivar", { id: u.id }); onCambio(); });
  };

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1500, display: "flex", justifyContent: "flex-end", backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", height: "100%", overflowY: "auto", background: C.pop, borderLeft: `1px solid ${C.line2}`, padding: "22px 20px 40px", boxSizing: "border-box", color: C.ink }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          <Avatar u={u} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: C.grotesk, fontSize: 18, fontWeight: 600 }}>{nombreDe(u)}</div>
            <div style={{ fontSize: 12.5, color: C.ink3, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
          </div>
          <button type="button" onClick={onCerrar} style={btn()}>Cerrar <i className="ti ti-x" /></button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24, fontSize: 12 }}>
          <span style={{ padding: "4px 10px", borderRadius: 20, background: u.desactivado ? "rgba(232,97,95,0.12)" : "rgba(46,230,182,0.1)", color: u.desactivado ? C.rojo : C.teal, fontWeight: 600 }}>
            {u.desactivado ? "Acceso desactivado" : "Activo"}
          </span>
          {u.rol === "admin" && <span style={{ padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: C.ink2, fontWeight: 600 }}>Administrador</span>}
          <span style={{ padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: C.ink2 }}>Último ingreso: {haceCuanto(u.ultimo_ingreso)}</span>
        </div>

        {u.rol !== "admin" && (
          <section style={{ marginBottom: 26 }}>
            <label style={labelSt}>Nombre</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={input} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cómo aparece en la app" />
              <button type="button" style={btn(nombre !== (u.nombre || "") ? "primario" : "ghost")} disabled={busy === "nombre" || nombre === (u.nombre || "")} onClick={guardarNombre}>
                {busy === "nombre" ? "…" : "Guardar"}
              </button>
            </div>
          </section>
        )}

        <section style={{ marginBottom: 26 }}>
          <label style={labelSt}>Contraseña</label>
          <div style={{ fontSize: 12.5, color: C.ink3, lineHeight: 1.5, marginBottom: 10 }}>
            La actual no se puede ver: el sistema la guarda cifrada y ni el admin la conoce. Si la olvidó, poné una nueva (o tocá <b style={{ color: C.ink2 }}>Generar</b>) y pasásela.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...input, fontFamily: "ui-monospace, Menlo, monospace" }} value={pw} onChange={(e) => { setPw(e.target.value); setPwOk(null); }} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            <button type="button" style={btn()} onClick={() => { setPw(generarPassword()); setPwOk(null); }} title="Inventa una contraseña al azar"><i className="ti ti-refresh" /> Generar</button>
          </div>
          <button type="button" style={{ ...btn(pw.length >= 8 ? "primario" : "ghost"), marginTop: 10, opacity: pw.length >= 8 ? 1 : 0.5 }} disabled={pw.length < 8 || busy === "pw"} onClick={cambiarPw}>
            <i className="ti ti-key" /> {busy === "pw" ? "Cambiando…" : "Cambiar contraseña"}
          </button>
          {pwOk && <Credenciales email={u.email} password={pwOk} titulo="Contraseña cambiada" />}
        </section>

        {!u.es_yo && (
          <section>
            <label style={labelSt}>Acceso a la app</label>
            <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.5, marginBottom: 10 }}>
              {u.desactivado
                ? "No puede entrar. Sus notas y registros siguen en la app."
                : "Desactivar le corta el ingreso (en menos de una hora si ya tenía la sesión abierta). No borra nada y se puede revertir."}
            </div>
            <button type="button" style={btn(u.desactivado ? "primario" : armado ? "rojo" : "ambar")} disabled={busy === "acceso"} onClick={toggleAcceso}>
              <i className={u.desactivado ? "ti ti-lock-open" : "ti ti-lock"} />
              {busy === "acceso" ? "…" : u.desactivado ? "Reactivar acceso" : armado ? "¿Seguro? Tocá otra vez" : "Desactivar acceso"}
            </button>
          </section>
        )}

        {err && <div style={{ marginTop: 18, color: C.rojo, fontSize: 13 }}>{err}</div>}
      </div>
    </div>
  );
}

// ── Alta de usuario ──
function NuevoUsuario({ onCerrar, onCreado }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState(() => generarPassword());
  const [secs, setSecs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [listo, setListo] = useState(null);
  useEscape(onCerrar);

  const emailFinal = email.includes("@") ? email.trim().toLowerCase() : email.trim() ? `${email.trim().toLowerCase()}@flexit.app` : "";
  const toggle = (id) => setSecs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const crear = async () => {
    setBusy(true); setErr("");
    try {
      await adminUsuarios("crear", { email: emailFinal, password: pw, nombre, secciones: secs });
      setListo({ email: emailFinal, password: pw });
      onCreado();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px, 100%)", maxHeight: "92vh", overflowY: "auto", background: C.pop, border: `1px solid ${C.line2}`, borderRadius: 18, padding: 22, boxSizing: "border-box", color: C.ink }}>
        <div style={{ fontFamily: C.grotesk, fontSize: 19, fontWeight: 600, marginBottom: 18 }}>Nuevo usuario</div>

        {listo ? (
          <Credenciales email={listo.email} password={listo.password} titulo={`${nombre || listo.email} ya puede entrar`} onCerrar={onCerrar} />
        ) : (<>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={labelSt}>Nombre</label>
              <input style={input} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Santi" autoFocus />
            </div>
            <div>
              <label style={labelSt}>Usuario (email)</label>
              <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="santi  →  santi@flexit.app" autoCapitalize="none" />
              {emailFinal && !email.includes("@") && <div style={{ fontSize: 12, color: C.ink3, marginTop: 5 }}>Va a entrar como <b style={{ color: C.ink2 }}>{emailFinal}</b></div>}
            </div>
            <div>
              <label style={labelSt}>Contraseña</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...input, fontFamily: "ui-monospace, Menlo, monospace" }} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                <button type="button" style={btn()} onClick={() => setPw(generarPassword())} title="Inventa otra contraseña al azar"><i className="ti ti-refresh" /> Otra</button>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <label style={{ ...labelSt, marginBottom: 0 }}>Qué puede ver</label>
                <span style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 12 }}>
                  <span style={{ color: C.teal, cursor: "pointer", fontWeight: 600 }} onClick={() => setSecs(OPERATIVAS)}>Todo</span>
                  <span style={{ color: C.ink3, cursor: "pointer" }} onClick={() => setSecs([])}>Nada</span>
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {SECCIONES.filter((s) => !s.soloAdmin).map((s) => {
                  const on = secs.includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggle(s.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, cursor: "pointer", textAlign: "left", fontSize: 13, fontWeight: 600,
                        background: on ? "rgba(46,230,182,0.1)" : "rgba(255,255,255,0.03)", color: on ? C.teal : C.ink3, border: `1px solid ${on ? "rgba(46,230,182,0.35)" : C.line}` }}>
                      <i className={s.icon} style={{ fontSize: 16 }} />{s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {err && <div style={{ marginTop: 14, color: C.rojo, fontSize: 13 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button type="button" style={btn()} onClick={onCerrar}>Cancelar</button>
            <button type="button" style={{ ...btn("primario"), opacity: emailFinal && pw.length >= 8 ? 1 : 0.5 }} disabled={busy || !emailFinal || pw.length < 8} onClick={crear}>
              {busy ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}


// Estado del bot de WhatsApp (colecta_bot_estado). Señales:
//  - ultimo_sync: el sync de grupos de n8n escribe cada pocos minutos → si pasa de 40 min, el bot no anda
//  - wa_estado: lo reporta el guardián del VPS cada 10 min (ready / qr / colgado / …)
//  - ultimo_envio: último link de colectas mandado
const ESTADOS_WA = { ready: "Conectado", qr: "Pide escanear el QR", colgado: "Colgado (el guardián lo reinicia)", connecting: "Conectando…", disconnected: "Desconectado" };
function horaAR(iso) {
  if (!iso) return "—";
  const tz = { timeZone: "America/Argentina/Buenos_Aires" };
  const d = new Date(iso);
  const hora = d.toLocaleTimeString("es-AR", { ...tz, hour: "2-digit", minute: "2-digit" });
  const dia = d.toLocaleDateString("es-AR", { ...tz, day: "2-digit", month: "2-digit" });
  return dia === new Date().toLocaleDateString("es-AR", { ...tz, day: "2-digit", month: "2-digit" }) ? `hoy ${hora}` : `${dia} ${hora}`;
}
function EstadoBot() {
  const [e, setE] = useState(undefined); // undefined = cargando, null = error
  useEffect(() => {
    let vivo = true;
    const cargar = () => sbFetch("rpc/colecta_bot_estado", { method: "POST", body: "{}" })
      .then((r) => { if (vivo) setE(r || null); }).catch(() => { if (vivo) setE(null); });
    cargar();
    const t = setInterval(cargar, 60 * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  if (e === undefined) return null;
  const minGuardian = e && e.wa_estado_at ? (Date.now() - Date.parse(e.wa_estado_at)) / 60000 : Infinity;
  const nivel = !e ? "rojo" : e.pide_qr || e.ok === false ? "rojo" : (e.wa_estado && e.wa_estado !== "ready") || minGuardian > 30 ? "ambar" : "ok";
  const color = nivel === "ok" ? C.teal : nivel === "ambar" ? C.ambar : C.rojo;
  const titulo = !e ? "No pude leer el estado del bot"
    : e.pide_qr ? "Bot desconectado: pide escanear el QR"
    : e.ok === false ? `Bot sin señal${e.ultimo_sync ? " desde " + horaAR(e.ultimo_sync) : ""}`
    : nivel === "ambar" ? "Bot funcionando, con algo para mirar" : "Bot de WhatsApp activo";
  const fila = (k, v, alerta) => (
    <div style={{ display: "flex", gap: 10, fontSize: 13, padding: "3px 0" }}>
      <span style={{ width: 150, flexShrink: 0, color: C.ink3 }}>{k}</span>
      <span style={{ color: alerta ? C.ambar : C.ink2 }}>{v}</span>
    </div>
  );
  return (
    <div style={{ ...card, padding: 16, marginBottom: 16, borderColor: nivel === "ok" ? C.line : color }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: e ? 8 : 0 }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: color, boxShadow: `0 0 10px ${color}` }} />
        <i className="ti ti-brand-whatsapp" style={{ fontSize: 18, color: C.ink2 }} />
        <span style={{ fontFamily: C.grotesk, fontWeight: 700, fontSize: 15, color: nivel === "ok" ? C.ink : color }}>{titulo}</span>
      </div>
      {e && (<>
        {fila("WhatsApp", `${ESTADOS_WA[e.wa_estado] || e.wa_estado || "sin dato"}${e.wa_estado_at ? " · revisado " + horaAR(e.wa_estado_at) : ""}`, e.wa_estado && e.wa_estado !== "ready")}
        {minGuardian > 30 && minGuardian !== Infinity && fila("Guardián del VPS", `no reporta hace ${Math.round(minGuardian)} min (corre cada 10)`, true)}
        {fila("Última señal", horaAR(e.ultimo_sync), e.ok === false)}
        {fila("Último link de colectas", horaAR(e.ultimo_envio))}
        {e.feriado && fila("Hoy", `feriado (${e.feriado}): no salen links`)}
        {e.aviso && fila("Aviso", e.aviso, true)}
      </>)}
      {e && (e.pide_qr || e.ok === false) && <div style={{ marginTop: 10 }}><QrBot /></div>}
    </div>
  );
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState(null);
  const [err, setErr] = useState("");
  const [cambios, setCambios] = useState({}); // id → secciones editadas sin guardar
  const [guardando, setGuardando] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => { const h = () => setIsMobile(window.innerWidth < 760); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);

  const cargar = useCallback(() => {
    adminUsuarios("listar").then((d) => { setUsuarios(d.usuarios); setErr(""); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const secsVista = (u) => cambios[u.id] || seccionesDe(u);
  const toggle = (u, id) => {
    const actual = secsVista(u);
    const nueva = actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id];
    setCambios((c) => {
      const n = { ...c };
      if (mismo(nueva, seccionesDe(u))) delete n[u.id]; else n[u.id] = nueva;
      return n;
    });
  };
  const pendientes = Object.keys(cambios).length;

  const guardar = async () => {
    setGuardando(true); setErr("");
    try {
      for (const [id, secciones] of Object.entries(cambios)) await adminUsuarios("permisos", { id, secciones });
      setCambios({});
      cargar();
    } catch (e) { setErr(e.message); } finally { setGuardando(false); }
  };

  const resumen = useMemo(() => {
    if (!usuarios) return "";
    const off = usuarios.filter((u) => u.desactivado).length;
    return `${usuarios.length} usuarios${off ? ` · ${off} desactivado${off > 1 ? "s" : ""}` : ""}`;
  }, [usuarios]);

  if (!esAdmin()) return <div style={{ ...card, padding: 24, color: C.ink2 }}>Esta sección es solo para el administrador.</div>;

  const abiertoU = abierto && usuarios ? usuarios.find((u) => u.id === abierto) : null;

  return (
    <div style={{ color: C.ink, paddingBottom: pendientes ? 90 : 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: C.ink3 }}>{resumen}</div>
        <button type="button" style={{ ...btn("primario"), marginLeft: "auto" }} onClick={() => setNuevo(true)}><i className="ti ti-user-plus" /> Nuevo usuario</button>
      </div>

      <EstadoBot />

      {err && <div style={{ ...card, padding: 14, color: C.rojo, fontSize: 13, marginBottom: 14 }}>{err}</div>}
      {!usuarios && !err && <div style={{ ...card, padding: 24, color: C.ink3 }}>Cargando usuarios…</div>}

      {usuarios && !isMobile && (
        <div style={{ ...card, overflow: "auto", maxHeight: "70vh", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", top: 0, zIndex: 2, background: "#181a2c", boxShadow: `0 1px 0 ${C.line2}`, textAlign: "left", padding: "12px 16px", color: C.ink3, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Usuario</th>
                {SECCIONES.map((s) => (
                  <th key={s.id} style={{ position: "sticky", top: 0, zIndex: 2, background: "#181a2c", boxShadow: `0 1px 0 ${C.line2}`, padding: "10px 6px", color: C.ink3, fontWeight: 600, fontSize: 11, minWidth: 64 }}>
                    <i className={s.icon} style={{ fontSize: 17, display: "block", marginBottom: 4, color: C.ink2 }} />
                    {s.id === "pendientes" ? "Históricos" : s.id === "choferes" ? "Alta chof." : s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const admin = u.rol === "admin";
                const secs = secsVista(u);
                const sucio = !!cambios[u.id];
                return (
                  <tr key={u.id} style={{ background: sucio ? "rgba(245,192,68,0.05)" : "transparent", opacity: u.desactivado ? 0.5 : 1 }}>
                    <td style={{ padding: "10px 16px", borderBottom: `1px solid ${C.line}` }}>
                      <button type="button" onClick={() => setAbierto(u.id)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.ink, textAlign: "left" }}>
                        <Avatar u={u} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                            {nombreDe(u)}
                            {admin && <span style={{ fontSize: 10, color: C.teal, fontWeight: 700, letterSpacing: "0.05em" }}>ADMIN</span>}
                            {u.desactivado && <span style={{ fontSize: 10, color: C.rojo, fontWeight: 700, letterSpacing: "0.05em" }}>DESACTIVADO</span>}
                          </span>
                          <span style={{ display: "block", fontSize: 11.5, color: C.ink3 }}>{u.email} · {haceCuanto(u.ultimo_ingreso)}</span>
                        </span>
                      </button>
                    </td>
                    {SECCIONES.map((s) => {
                      const locked = admin || s.soloAdmin;
                      const on = admin || (!s.soloAdmin && secs.includes(s.id));
                      return (
                        <td key={s.id} style={{ textAlign: "center", padding: "10px 6px", borderBottom: `1px solid ${C.line}` }}>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <Toggle on={on} locked={locked} onClick={() => toggle(u, s.id)} label={`${s.label} — ${nombreDe(u)}`} />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {usuarios && isMobile && (
        <div style={{ display: "grid", gap: 12 }}>
          {usuarios.map((u) => {
            const admin = u.rol === "admin";
            const secs = secsVista(u);
            return (
              <div key={u.id} style={{ ...card, padding: 14, opacity: u.desactivado ? 0.55 : 1, border: `1px solid ${cambios[u.id] ? "rgba(245,192,68,0.35)" : C.line}` }}>
                <button type="button" onClick={() => setAbierto(u.id)} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.ink, width: "100%", textAlign: "left", marginBottom: 12 }}>
                  <Avatar u={u} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontWeight: 600 }}>{nombreDe(u)} {admin && <span style={{ fontSize: 10, color: C.teal }}>ADMIN</span>} {u.desactivado && <span style={{ fontSize: 10, color: C.rojo }}>DESACTIVADO</span>}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: C.ink3, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                  </span>
                  <i className="ti ti-chevron-right" style={{ color: C.ink3 }} />
                </button>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SECCIONES.map((s) => {
                    const locked = admin || s.soloAdmin;
                    const on = admin || (!s.soloAdmin && secs.includes(s.id));
                    return (
                      <button key={s.id} type="button" onClick={locked ? undefined : () => toggle(u, s.id)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: locked ? "default" : "pointer",
                          background: on ? "rgba(46,230,182,0.1)" : "rgba(255,255,255,0.03)", color: on ? C.teal : C.ink3, border: `1px solid ${on ? "rgba(46,230,182,0.3)" : C.line}`, opacity: locked && !admin ? 0.5 : 1 }}>
                        <i className={locked && !admin ? "ti ti-lock" : s.icon} style={{ fontSize: 13 }} />{s.id === "pendientes" ? "Históricos" : s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {usuarios && (
        <div style={{ fontSize: 12, color: C.ink3, marginTop: 14, lineHeight: 1.6, display: "flex", gap: 8 }}>
          <i className="ti ti-lock" style={{ marginTop: 3 }} />
          <span>Liquidaciones queda solo para el admin: los datos de pagos están cerrados a esa cuenta en la base, así que habilitarla a otro le mostraría una pantalla vacía. Tocá un usuario para cambiarle la contraseña o desactivarlo.</span>
        </div>
      )}

      {pendientes > 0 && (
        <div style={{ position: "fixed", left: "50%", bottom: isMobile ? 18 : 26, transform: "translateX(-50%)", zIndex: 1200, display: "flex", alignItems: "center", gap: 12,
          background: C.pop, border: "1px solid rgba(245,192,68,0.35)", borderRadius: 14, padding: "10px 12px 10px 16px", boxShadow: "0 20px 50px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 13, color: C.ambar, fontWeight: 600 }}>{pendientes} usuario{pendientes > 1 ? "s" : ""} con cambios</span>
          <button type="button" style={btn()} onClick={() => setCambios({})} disabled={guardando}>Descartar</button>
          <button type="button" style={btn("primario")} onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      )}

      {abiertoU && <Detalle u={abiertoU} onCerrar={() => setAbierto(null)} onCambio={cargar} />}
      {nuevo && <NuevoUsuario onCerrar={() => setNuevo(false)} onCreado={cargar} />}
    </div>
  );
}
