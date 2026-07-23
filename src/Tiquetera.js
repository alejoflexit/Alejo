// build: tiquetera 11 — login con Supabase Auth (email+contraseña por persona)
import { useState, useEffect, useCallback, useRef } from "react";
import { login, logout, getSession, authedFetch, getToken } from "./auth";

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
  abierto:            { txt: "● Nuevo",          bg: "rgba(255,92,92,0.15)", color: "#FF5C5C" },
  enviando:           { txt: "📤 Enviando…",     bg: "rgba(74,158,255,0.15)", color: "#4A9EFF" },
  esperando_cadete:   { txt: "⏳ Esp. cadete",   bg: "rgba(255,176,32,0.15)", color: "#FFB020" },
  esperando_deposito: { txt: "📦 Esp. depósito", bg: "rgba(74,158,255,0.15)", color: "#4A9EFF" },
  esperando_cliente:  { txt: "✓ Contestado",  bg: "rgba(46,207,170,0.15)", color: "#2ECFAA" },
  resuelto:           { txt: "✓ Resuelto",       bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.45)" },
};

// Posibles duplicados: mismo envio_id o mismo numero clave (direccion/orden, 3+ digitos) en el mensaje
function numerosClave(c) {
  const nums = new Set();
  if (c.envio_id) nums.add(String(c.envio_id));
  (String(c.mensaje || "").match(/\d{3,12}/g) || []).forEach(n => nums.add(n));
  return nums;
}
function posiblesDuplicados(c, casos) {
  const mios = numerosClave(c);
  const t = c.created_at ? new Date(c.created_at).getTime() : null;
  const VENTANA = 3 * 60 * 1000; // mismo chat en ±3 min = probablemente la misma consulta partida (ej. imagen + texto)
  return casos.filter(o => {
    if (o.id === c.id || o.estado === "resuelto") return false;
    const porNumero = mios.size && [...numerosClave(o)].some(n => mios.has(n));
    const porChat = t && c.chat_id && o.chat_id === c.chat_id && o.created_at && Math.abs(new Date(o.created_at).getTime() - t) <= VENTANA;
    return porNumero || porChat;
  }).slice(0, 3);
}

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
function limpiarNombreEquipo(txt) {
  let t = String(txt || "").trim();
  ["(equipo)", "(principal)"].forEach(s => { const i = t.toLowerCase().indexOf(s); if (i >= 0) t = t.slice(0, i); });
  return t.trim();
}
// Reemplaza las menciones @<número/lid> por el nombre del equipo cuando se conoce (mapa de agente_config).
function resolverMenciones(texto, mapa) {
  if (!texto) return texto;
  return String(texto).replace(/@([0-9]{6,})/g, (m, dig) => (mapa && mapa[dig]) ? "@" + mapa[dig] : m);
}
function nombreCliente(txt) {
  if (!txt) return "";
  let t = String(txt).trim();
  t = t.replace(/^soporte\s+/i, "").replace(/\s*[-–]\s*soporte\s+flexit\s*$/i, "").replace(/\s*[-–]\s*flexit\s*$/i, "");
  return t.trim() || String(txt).trim();
}
function ordenGrupo(c) {
  if (c.fijado && c.estado !== "resuelto") return 0;
  if (desperto(c)) return 1;
  if (c.estado === "abierto" && !dormido(c)) return 1.5; // sin contestar: arriba del resto
  if (c.estado === "resuelto") return 4;
  if (dormido(c)) return 3;
  return 2;
}

// Busca el envío mencionado (por número de venta/orden/tracking) en el texto — sirve cuando el número
// está en el mensaje citado y el bot no pudo vincularlo. Solo encuentra envíos recientes (caché ~6 días).
function EnvioPorTexto({ texto }) {
  const [envio, setEnvio] = useState(undefined);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const nums = [...new Set(String(texto || "").replace(/@[0-9]+/g, " ").match(/[0-9]{6,}/g) || [])].slice(0, 6);
      if (!nums.length) { setEnvio(null); return; }
      const list = nums.join(",");
      try {
        const rows = await sb(`envios_busqueda?or=(id_venta_ml.in.(${list}),id_interno.in.(${list}),tracking.in.(${list}))&select=id_interno,cadete,estado,fecha_estado,localidad&limit=1`);
        if (!cancel) setEnvio(rows && rows[0] ? rows[0] : null);
      } catch (e) { if (!cancel) setEnvio(null); }
    })();
    return () => { cancel = true; };
  }, [texto]);
  if (!envio) return null;
  return (
    <div style={{ maxWidth: 640, marginBottom: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(46,207,170,0.35)", background: "rgba(46,207,170,0.06)", fontSize: 13, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <span style={{ color: "#2ECFAA", fontWeight: 700 }}>📦 Lo tiene: {envio.cadete || "sin asignar"}</span>
      <span style={{ color: "rgba(255,255,255,0.6)" }}>· {envio.estado || "?"}{envio.fecha_estado ? " · " + envio.fecha_estado : ""}{envio.localidad ? " · " + envio.localidad : ""}</span>
      <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>(envío #{envio.id_interno})</span>
    </div>
  );
}

export default function Tiquetera() {
  const [casos, setCasos] = useState([]);
  const [error, setError] = useState("");
  const [busca, setBusca] = useState("");
  const [chip, setChip] = useState("abiertos");
  const [orden, setOrden] = useState("antiguos");
  const [abierto, setAbierto] = useState(null);
  const [respAbierta, setRespAbierta] = useState(false);     // respuesta del bot desplegable (colapsada por defecto)
  const [confirmarResolver, setConfirmarResolver] = useState(null); // confirmación inline de "Resolver"
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
  const [gruposOpen, setGruposOpen] = useState(false);
  const [grupos, setGrupos] = useState([]);
  const [mapaGrupos, setMapaGrupos] = useState({});
  const [mapaLids, setMapaLids] = useState({}); // lid (dígitos) -> nombre del equipo, para mostrar las menciones @número con nombre
  const [viendo, setViendo] = useState({}); // casoId -> [operadores que lo estan viendo]
  const [bugPara, setBugPara] = useState(null);
  const [bugTxt, setBugTxt] = useState("");
  const [bugMsg, setBugMsg] = useState(null);
  const [bugsOpen, setBugsOpen] = useState(false);
  const [reportes, setReportes] = useState([]);
  const [copiado, setCopiado] = useState(null);
  const [mediaCaso, setMediaCaso] = useState(null); // imagen adjunta del caso abierto {b64, mime}
  const [hilos, setHilos] = useState({}); // casoId -> historial de conversación abierto/cerrado
  const [lightbox, setLightbox] = useState(null); // imagen abierta en grande (visor dentro de la tiquetera)
  const presCh = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const desde = new Date(Date.now() - 7 * 86400000).toISOString();
      const rows = await sb(`casos?select=id,created_at,grupo,chat_id,autor,mensaje,tipo,estado,envio_id,cadete,respuesta_sugerida,respuesta_enviada,asignado,turno,snooze_hasta,fijado,resuelto_por,resuelto_at,notas,enviado_at,enviado_via,enviado_por,mensaje_id,media_mime,media_expira,cita&created_at=gte.${desde}&order=created_at.desc&limit=500`);
      setCasos((rows || []).filter(c => c.autor !== 'Colectas Flexit')); // ocultar los avisos automáticos de colecta (mensaje del propio bot, no es una consulta)
      setError("");
    } catch (e) { setError("No se pudo cargar la tiquetera: " + e.message); }
  }, []);

  useEffect(() => { cargar(); const t = setInterval(cargar, 30000); return () => clearInterval(t); }, [cargar]);

  // Deteccion de colision: presencia realtime — quien esta mirando que caso
  useEffect(() => {
    if (!window.supabase || !operador) return;
    let client = null, cancelled = false;
    (async () => {
      const token = await getToken().catch(() => null);
      if (cancelled) return;
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      if (token) client.realtime.setAuth(token);
      const ch = client.channel("tiquetera-presencia", { config: { presence: { key: operador } } });
      ch.on("presence", { event: "sync" }, () => {
        const st = ch.presenceState();
        const map = {};
        Object.entries(st).forEach(([quien, metas]) => {
          if (quien === operador) return;
          (metas || []).forEach(m => { if (m.caso) (map[m.caso] = map[m.caso] || []).push(quien); });
        });
        setViendo(map);
      });
      ch.subscribe(st => { if (st === "SUBSCRIBED") { presCh.current = ch; try { ch.track({ caso: null }); } catch {} } });
    })();
    return () => { cancelled = true; presCh.current = null; try { client && client.realtime.disconnect(); } catch {} };
  }, [operador]);

  useEffect(() => { try { presCh.current && presCh.current.track({ caso: abierto }); } catch {} }, [abierto]);

  // Titulo de la pestana: "(N) Tiquetera" cuando hay casos sin contestar
  useEffect(() => {
    const n = casos.filter(c => c.estado === "abierto" && !dormido(c)).length;
    document.title = n > 0 ? `(${n}) Tiquetera Flexit` : "Tiquetera Flexit";
    return () => { document.title = "Métricas Flexit"; };
  }, [casos]);

  useEffect(() => { setNotaTxt(""); setBugPara(null); setBugTxt(""); setRespAbierta(false); setConfirmarResolver(null); }, [abierto]);

  useEffect(() => { (async () => { try { const r = await sb("tiquetera_config?id=eq.1"); setCfg(r && r[0] ? r[0] : CONFIG_DEFAULT); } catch (e) { setCfg(CONFIG_DEFAULT); } })(); }, []);
  useEffect(() => { (async () => { try { const gs = await sb("agente_config?tipo=eq.grupo&select=chat_id,nombre_grupo"); const m = {}; (gs || []).forEach(g => { if (g.chat_id) m[g.chat_id] = g.nombre_grupo; }); setMapaGrupos(m); const eq = await sb("agente_config?tipo=eq.lid_equipo&select=lid,etiqueta,nombre_grupo"); const ml = {}; (eq || []).forEach(e => { const dig = String(e.lid || "").replace(/[^0-9]/g, ""); if (dig) ml[dig] = limpiarNombreEquipo(e.etiqueta || e.nombre_grupo || dig); }); setMapaLids(ml); } catch (e) {} })(); }, []);

  // Traer la imagen adjunta (base64) sólo al abrir un caso — no en la lista, para no cargar de más.
  useEffect(() => {
    setMediaCaso(null);
    if (abierto == null) return;
    const c = casos.find(x => x.id === abierto);
    if (!c || !c.media_mime || !String(c.media_mime).startsWith("image")) return;
    if (c.media_expira && new Date(c.media_expira) < new Date()) return; // ya venció (se borra sola)
    let cancel = false;
    (async () => {
      try { const r = await sb(`casos?id=eq.${abierto}&select=media_b64,media_mime`); const row = r && r[0]; if (!cancel && row && row.media_b64) setMediaCaso({ b64: row.media_b64, mime: row.media_mime }); } catch (e) {}
    })();
    return () => { cancel = true; };
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const cargarGrupos = useCallback(async () => {
    try {
      const rows = await sb("agente_config?tipo=eq.grupo&order=estado.asc,nombre_grupo.asc");
      setGrupos(rows || []);
    } catch (e) { setError("No se pudieron cargar los grupos: " + e.message); }
  }, []);

  async function patchGrupo(id, cambios) {
    try {
      await sb(`agente_config?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
      await cargarGrupos();
    } catch (e) { setError("No se pudo cambiar el grupo (¿entraste como Admin?): " + e.message); }
  }

  async function reportarBug(c) {
    const texto = bugTxt.trim();
    if (!texto) return;
    try {
      await sb("reportes_bug", { method: "POST", body: JSON.stringify({ caso_id: c.id, chat_id: c.chat_id, autor_caso: c.autor, reporta: operador, texto }) });
      setBugTxt(""); setBugPara(null); setError(""); setBugMsg(c.id);
      setTimeout(() => setBugMsg(m => (m === c.id ? null : m)), 3500);
    } catch (e) { setError("No se pudo guardar el reporte: " + e.message); }
  }
  const cargarReportes = useCallback(async () => {
    try {
      const rows = await sb("reportes_bug?order=estado.asc,created_at.desc&limit=200");
      setReportes(rows || []);
    } catch (e) { setError("No se pudieron cargar los reportes: " + e.message); }
  }, []);
  async function marcarRevisado(id) {
    try {
      await sb(`reportes_bug?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ estado: "revisado", revisado_por: operador, revisado_at: new Date().toISOString() }) });
      await cargarReportes();
    } catch (e) { setError("No se pudo marcar revisado: " + e.message); }
  }
  async function patch(id, cambios) {
    try {
      await sb(`casos?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
      await cargar();
    } catch (e) { setError("Error al actualizar: " + e.message); }
  }

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const miDupla = cfg ? (cfg.duplas || []).find(d => d.split("/").map(x => x.trim().toLowerCase()).includes((operador || "").toLowerCase())) : null;
  const counts = {
    abiertos: casos.filter(c => c.estado !== "resuelto").length,
    sinContestar: casos.filter(c => c.estado === "abierto" && !dormido(c)).length,
    cadete: casos.filter(c => c.estado === "esperando_cadete").length,
    deposito: casos.filter(c => c.estado === "esperando_deposito").length,
    resueltos: casos.filter(c => c.estado === "resuelto" && c.resuelto_at && new Date(c.resuelto_at) >= hoy).length,
    mios: casos.filter(c => c.estado !== "resuelto" && miDupla && c.asignado === miDupla).length,
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
      if (chip === "sin_contestar") return c.estado === "abierto" && !dormido(c);
      if (chip === "cadete") return c.estado === "esperando_cadete";
      if (chip === "deposito") return c.estado === "esperando_deposito";
      if (chip === "resueltos") return c.estado === "resuelto";
      if (chip === "mios") return c.estado !== "resuelto" && c.asignado === miDupla;
      return true;
    })
    .sort((a, b) => ordenGrupo(a) - ordenGrupo(b) || (orden === "antiguos" ? new Date(a.created_at) - new Date(b.created_at) : new Date(b.created_at) - new Date(a.created_at)));

  useEffect(() => {
    if (abierto == null) return;
    const onKey = (e) => {
      if (e.key === "Escape") { setError(""); setAbierto(null); return; }
      if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].indexOf(e.key) === -1) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;
      const idx = visibles.findIndex(x => x.id === abierto);
      if (idx === -1) return;
      e.preventDefault();
      const delta = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : -1;
      const nx = visibles[idx + delta];
      if (nx) setAbierto(nx.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, visibles]);

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
          try {
            const ses = await login(loginEmail, loginPass);
            setOperador(ses.nombre);
            cargar();
            try { const r = await sb("tiquetera_config?id=eq.1"); if (r && r[0]) setCfg(r[0]); } catch {}
          }
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
      <style>{`@keyframes pingTk{75%,100%{transform:scale(2.4);opacity:0}}@keyframes temblarTk{0%,100%{transform:translateX(0)}10%{transform:translateX(-3px)}20%{transform:translateX(3px)}30%{transform:translateX(-2px)}40%{transform:translateX(2px)}50%{transform:translateX(0)}}`}</style>

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
        {miDupla && <div onClick={() => setChip("mios")} style={chipStyle(chip === "mios")}>Mis casos <b>{counts.mios}</b></div>}
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
          {operador === "Admin" && <span title="Grupos de WhatsApp del agente" onClick={() => {
            if (gruposOpen) { setGruposOpen(false); return; }
            const ok = sessionStorage.getItem("tk_admin_ok") === "1" || window.prompt("PIN de administrador:") === (cfg.pin_admin || "4747");
            if (!ok) { setError("PIN de administrador incorrecto."); return; }
            sessionStorage.setItem("tk_admin_ok", "1");
            cargarGrupos(); setGruposOpen(true);
          }} style={{ cursor: "pointer", fontSize: 15 }}>📱</span>}
          {operador === "Admin" && <span title="Reportes de bugs del equipo" onClick={() => {
            if (bugsOpen) { setBugsOpen(false); return; }
            const ok = sessionStorage.getItem("tk_admin_ok") === "1" || window.prompt("PIN de administrador:") === (cfg.pin_admin || "4747");
            if (!ok) { setError("PIN de administrador incorrecto."); return; }
            sessionStorage.setItem("tk_admin_ok", "1");
            cargarReportes(); setBugsOpen(true);
          }} style={{ cursor: "pointer", fontSize: 15 }}>🐛</span>}
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

      {gruposOpen && (
        <div style={{ border: "1px solid rgba(74,158,255,0.35)", borderRadius: 12, padding: "14px 16px", marginBottom: "1rem", background: "rgba(74,158,255,0.06)", maxWidth: 720 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>📱 Grupos de WhatsApp del agente</div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginBottom: 12 }}>
            <b>Pendiente</b> = grupo nuevo detectado, el bot está mudo ahí. <b>Activá</b> para que empiece a crear casos (sigue sin enviar hasta que prendas “Envío”). <b>Envío</b> = el bot puede mandar respuestas aprobadas al cliente.
          </div>
          {grupos.length === 0 && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.4)" }}>No hay grupos cargados todavía.</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {grupos.map(g => {
              const col = g.estado === "activo" ? "#39d98a" : g.estado === "pendiente" ? "#f5a623" : "rgba(255,255,255,0.4)";
              return (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.nombre_grupo || g.chat_id}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{g.cliente || "cliente sin identificar"}{g.cod_cliente ? ` · cód ${g.cod_cliente}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: col, textTransform: "uppercase", letterSpacing: 0.4 }}>{g.estado}</span>
                  {g.estado !== "activo"
                    ? <button style={btn(true)} onClick={() => patchGrupo(g.id, { estado: "activo" })}>Activar</button>
                    : <button style={btn(false)} onClick={() => patchGrupo(g.id, { estado: "inactivo", envio_habilitado: false })}>Pausar</button>}
                  {g.estado === "activo" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: g.envio_habilitado ? "#39d98a" : "rgba(255,255,255,0.55)", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!g.envio_habilitado} onChange={e => {
                        if (e.target.checked && !window.confirm(`¿Habilitar ENVÍO para "${g.nombre_grupo || g.chat_id}"?\n\nEl bot va a poder mandar respuestas aprobadas al cliente en este grupo.`)) return;
                        patchGrupo(g.id, { envio_habilitado: e.target.checked });
                      }} />
                      Envío
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={btn(false)} onClick={() => setGruposOpen(false)}>Cerrar</button>
            <button style={btn(false)} onClick={cargarGrupos}>↻ Actualizar</button>
          </div>
        </div>
      )}

      {bugsOpen && (
        <div style={{ border: "1px solid rgba(229,115,115,0.35)", borderRadius: 12, padding: "14px 16px", marginBottom: "1rem", background: "rgba(229,115,115,0.06)", maxWidth: 720 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>🐛 Reportes de bugs del equipo</div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginBottom: 12 }}>Lo que el equipo marcó como raro desde cada caso. Revisalo y marcá cuando lo hayas visto.</div>
          {reportes.length === 0 && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.4)" }}>No hay reportes todavía.</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {reportes.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", padding: "8px 10px", borderRadius: 8, background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.08)", opacity: r.estado === "revisado" ? 0.55 : 1 }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#fff" }}>{r.texto}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{r.caso_id ? `caso #${r.caso_id}` : "general"} · {r.reporta || "\u2014"} · {fmtFecha(r.created_at)}</div>
                </div>
                {r.estado === "revisado"
                  ? <span style={{ fontSize: 11, color: "#39d98a" }}>✓ revisado</span>
                  : <button style={btn(false)} onClick={() => marcarRevisado(r.id)}>✓ Revisado</button>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button style={btn(false)} onClick={() => setBugsOpen(false)}>Cerrar</button>
            <button style={btn(false)} onClick={cargarReportes}>↻ Actualizar</button>
          </div>
        </div>
      )}

      {visibles.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>
          Sin casos {chip === "resueltos" ? "resueltos" : "pendientes"}. Cuando entre un mensaje a un grupo conectado, aparece acá solo.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visibles.map((c, i) => {
          const tc = TIPO_COLORES[c.tipo] || TIPO_COLORES.otro;
          const eb = ESTADO_BADGES[c.estado] || ESTADO_BADGES.abierto;
          const desp = desperto(c);
          const dorm = dormido(c);
          return (
            <div key={c.id} style={{
              borderRadius: 10, overflow: "hidden", opacity: dorm || c.estado === "resuelto" ? 0.55 : 1,
              border: `1px solid ${desp ? "#FFB020" : c.fijado ? "#2ECFAA" : "rgba(255,255,255,0.1)"}`,
              borderLeft: `3px solid ${edadColor(c)}`,
              background: i % 2 ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.02)",
              boxShadow: desp ? "0 0 12px rgba(255,176,32,0.35)" : "none",
              animation: desp ? "temblarTk 1.6s ease-in-out infinite" : "none",
            }}>
              <div onClick={() => setAbierto(c.id)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", cursor: "pointer", flexWrap: "wrap" }}>
                <span title={c.estado === "abierto" && !dorm ? "Caso nuevo, sin contestar" : undefined} style={{ width: 10, height: 10, flexShrink: 0, position: "relative", display: "inline-block" }}>
                  {c.estado === "abierto" && !dorm && (<>
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#FBBF24", animation: "pingTk 1.6s cubic-bezier(0,0,0.2,1) infinite" }} />
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#FBBF24" }} />
                  </>)}
                </span>
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.32)" }}>#{c.id}</span>
                <span style={{ fontWeight: 600, fontSize: 14, minWidth: 120, display: "flex", alignItems: "center" }}>
                  {nombreCliente(mapaGrupos[c.chat_id] || c.grupo) || c.chat_id || "—"}
                </span>
                <span style={{ padding: "2px 8px", borderRadius: 5, fontSize: 10.5, fontWeight: 500, background: tc.bg, color: tc.color }}>{c.tipo || "otro"}</span>
                {c.asignado && <span style={{ fontSize: 11, color: "#4A9EFF", background: "rgba(74,158,255,0.1)", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>👥 {c.asignado}</span>}
                <span style={{ flex: 1, color: "rgba(255,255,255,0.5)", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 120 }}>{resolverMenciones(c.mensaje, mapaLids)}</span>
                {c.fijado && c.estado !== "resuelto" && <span style={{ fontSize: 11.5, color: "#2ECFAA", background: "rgba(46,207,170,0.12)", border: "1px solid rgba(46,207,170,0.35)", padding: "2px 8px", borderRadius: 6 }}>📌 Fijado</span>}
                {dorm && <span style={{ fontSize: 11.5, color: "#FFB020", background: "rgba(255,176,32,0.12)", padding: "2px 8px", borderRadius: 6 }}>⏰ hasta {new Date(c.snooze_hasta).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
                {desp && <span style={{ fontSize: 11.5, color: "#FFB020", background: "rgba(255,176,32,0.2)", fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>⏰ ¡Despertó!</span>}
                {(viendo[c.id] || []).length > 0 && (
                  <span title={"Cuidado: tambien lo esta viendo " + viendo[c.id].join(" y ")} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, background: "rgba(255,176,32,0.15)", color: "#FFB020", whiteSpace: "nowrap" }}>👀 {viendo[c.id].join(", ")}</span>
                )}
                {c.estado !== "abierto" && <span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, background: eb.bg, color: eb.color, whiteSpace: "nowrap" }}>{eb.txt}</span>}
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                  {edadTxt(c)}
                </span>
              </div>


            </div>
          );
        })}
      </div>
      {abierto != null && (() => {
        const c = casos.find(x => x.id === abierto);
        if (!c) return null;
        const tc = TIPO_COLORES[c.tipo] || TIPO_COLORES.otro;
        const eb = ESTADO_BADGES[c.estado] || ESTADO_BADGES.abierto;
        const dorm = dormido(c);
        return (
          <div onClick={() => { setError(""); setAbierto(null); }} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,7,12,0.30)", backdropFilter: "blur(1.5px)", WebkitBackdropFilter: "blur(1.5px)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 720, margin: "auto", background: "#0f1626", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.55)", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)", position: "sticky", top: 0, background: "#0f1626", borderRadius: "14px 14px 0 0" }}>
                {c.estado === "abierto" && !dorm && (
                  <span title="Sin contestar" style={{ width: 10, height: 10, flexShrink: 0, position: "relative", display: "inline-block" }}>
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#FBBF24", animation: "pingTk 1.6s cubic-bezier(0,0,0.2,1) infinite" }} />
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#FBBF24" }} />
                  </span>
                )}
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12.5, fontWeight: 700, color: "#4A9EFF", background: "rgba(74,158,255,0.1)", padding: "2px 8px", borderRadius: 6 }}>#{c.id}</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>{nombreCliente(mapaGrupos[c.chat_id] || c.grupo) || c.chat_id || "\u2014"}</span>
                <span style={{ padding: "2px 8px", borderRadius: 5, fontSize: 10.5, fontWeight: 500, background: tc.bg, color: tc.color }}>{c.tipo || "otro"}</span>
                {c.estado !== "abierto" && <span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 6, background: eb.bg, color: eb.color }}>{eb.txt}</span>}
                <button onClick={() => { setError(""); setAbierto(null); }} title="Cerrar" style={{ marginLeft: "auto", background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: "16px 18px" }}>
                {error && <div style={{ background: "rgba(226,75,74,0.15)", color: "#E24B4A", border: "1px solid rgba(226,75,74,0.3)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div>}
                  {c.cita && (
                    <div style={{ borderLeft: "3px solid rgba(46,207,170,0.55)", background: "rgba(255,255,255,0.04)", borderRadius: "0 8px 8px 0", padding: "6px 10px", marginBottom: 6, maxWidth: 640 }}>
                      <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: 2, textTransform: "uppercase", letterSpacing: ".04em" }}>↩ En respuesta a</div>
                      <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>{resolverMenciones(c.cita, mapaLids)}</div>
                    </div>
                  )}
                  <div style={{ background: "rgba(74,158,255,0.08)", borderRadius: "0 10px 10px 10px", padding: "10px 12px", maxWidth: 640, fontSize: 14, lineHeight: 1.45, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: "#2ECFAA", fontWeight: 600, marginBottom: 3 }}>{nombreCliente(c.autor) || "Cliente"}</div>
                    {resolverMenciones(c.mensaje, mapaLids)}
                  </div>
                  {mediaCaso && (
                    <img onClick={() => setLightbox(`data:${mediaCaso.mime};base64,${mediaCaso.b64}`)} src={`data:${mediaCaso.mime};base64,${mediaCaso.b64}`} alt="Imagen adjunta" title="Tocar para ver en grande" style={{ width: 104, height: 104, objectFit: "cover", borderRadius: 9, border: "1px solid rgba(255,255,255,0.14)", display: "block", cursor: "zoom-in", marginBottom: 10 }} />
                  )}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                    {c.envio_id && <span>Envío <b style={{ color: "#fff" }}>#{c.envio_id}</b></span>}
                    {c.cadete && <span>Cadete: <b style={{ color: "#fff" }}>{c.cadete}</b></span>}
                    {c.turno && <span>Turno: {c.turno}</span>}
                    {c.resuelto_por && <span style={{ color: "#2ECFAA" }}>✓ Resuelto por {c.resuelto_por}</span>}
                  </div>

                  {c.envio_id && <InfoEnvio envioId={c.envio_id} />}
                  {!c.envio_id && (c.cita || c.mensaje) && <EnvioPorTexto texto={[c.cita, c.mensaje].filter(Boolean).join(" ")} />}

                  {Array.isArray(c.notas) && c.notas.length > 0 && (() => {
                    const hilo = [
                      { at: c.created_at, quien: c.autor, texto: c.mensaje, esConsulta: true },
                      ...c.notas.map(n => ({ at: n.at, quien: n.quien, texto: n.texto, esConsulta: false })),
                    ].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
                    const ab = !!hilos[c.id];
                    return (
                      <div style={{ maxWidth: 640, marginBottom: 10 }}>
                        <button onClick={() => setHilos(h => ({ ...h, [c.id]: !h[c.id] }))}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#cfe3ff", borderRadius: 9, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          <span>💬 Conversación ({hilo.length} mensaje{hilo.length > 1 ? "s" : ""})</span>
                          <span style={{ opacity: 0.7 }}>{ab ? "▴" : "▾"}</span>
                        </button>
                        {ab && (
                          <div style={{ maxHeight: 230, overflowY: "auto", marginTop: 8, padding: "4px 2px", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, background: "rgba(0,0,0,0.15)" }}>
                            <div style={{ position: "relative", padding: "8px 10px 8px 26px" }}>
                              <div style={{ position: "absolute", left: 11, top: 12, bottom: 12, width: 2, background: "rgba(255,255,255,0.12)" }} />
                              {hilo.map((it, i) => (
                                <div key={i} style={{ position: "relative", marginBottom: i === hilo.length - 1 ? 2 : 12 }}>
                                  <span style={{ position: "absolute", left: it.esConsulta ? -20 : -19, top: 4, width: it.esConsulta ? 11 : 9, height: it.esConsulta ? 11 : 9, borderRadius: "50%", background: it.esConsulta ? "#4A9EFF" : "rgba(255,255,255,0.35)", border: "2px solid #0f1626", boxShadow: it.esConsulta ? "0 0 0 4px rgba(74,158,255,0.18)" : "none" }} />
                                  <div>
                                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>{it.at ? new Date(it.at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 6 }}>{nombreCliente(it.quien) || ""}</span>
                                    {it.esConsulta && <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, color: "#4A9EFF", background: "rgba(74,158,255,0.15)", borderRadius: 4, padding: "1px 6px", marginLeft: 8 }}>consulta</span>}
                                  </div>
                                  <div style={it.esConsulta
                                    ? { fontSize: 13, lineHeight: 1.38, marginTop: 3, color: "#fff", background: "rgba(74,158,255,0.10)", border: "1px solid rgba(74,158,255,0.4)", borderRadius: 8, padding: "7px 10px" }
                                    : { fontSize: 13, lineHeight: 1.38, marginTop: 2, color: "rgba(255,255,255,0.9)" }}>
                                    {resolverMenciones(it.texto, mapaLids)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {c.respuesta_enviada && (
                    <div style={{ background: "rgba(46,207,170,0.07)", border: "1px solid rgba(46,207,170,0.35)", borderRadius: 10, padding: "10px 12px", maxWidth: 640, marginBottom: 10 }}>
                      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#2ECFAA", fontWeight: 700, marginBottom: 4 }}>
                        {c.estado === "enviando" ? "📤 En cola — sale en menos de 1 minuto" : ("✓✓ Enviado al cliente" + (c.enviado_at ? " · " + new Date(c.enviado_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""))}
                      </div>
                      <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.85)", lineHeight: 1.45 }}>{c.respuesta_enviada}</div>
                    </div>
                  )}

                  {(() => { const dups = posiblesDuplicados(c, casos); return dups.length > 0 && (
                    <div style={{ maxWidth: 640, marginBottom: 10, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,176,32,0.4)", background: "rgba(255,176,32,0.07)", fontSize: 12.5, color: "#FFB020" }}>
                      ⚠ Posible duplicado (mismo envío o número):{dups.map(d => (
                        <span key={d.id} onClick={() => setAbierto(d.id)} title={d.mensaje} style={{ cursor: "pointer", textDecoration: "underline", marginLeft: 6 }}>
                          #{d.id}{d.estado === "resuelto" ? " (resuelto)" : d.respuesta_enviada ? " (contestado)" : ""}
                        </span>
                      ))}
                    </div>
                  ); })()}
                  {c.estado !== "resuelto" && (<>
                    <div style={{ border: "1px dashed rgba(46,207,170,0.5)", borderRadius: 10, padding: "10px 12px", background: "rgba(46,207,170,0.04)", maxWidth: 640, marginBottom: 10 }}>
                      <div onClick={c.respuesta_enviada ? undefined : () => setRespAbierta(v => !v)} title={c.respuesta_enviada ? undefined : (respAbierta ? "Ocultar" : "Mostrar")}
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: c.respuesta_enviada ? "default" : "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#2ECFAA", fontWeight: 700, userSelect: "none" }}>
                        {!c.respuesta_enviada && <span style={{ display: "inline-block", transition: "transform .15s", transform: respAbierta ? "rotate(90deg)" : "none", fontSize: 10 }}>▸</span>}
                        <span>🤖 {c.respuesta_enviada ? "Enviar otro mensaje (opcional)" : "Respuesta del bot — editá antes de enviar"}</span>
                      </div>
                      {(respAbierta || c.respuesta_enviada) && (
                        <textarea value={textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_enviada ? "" : (c.respuesta_sugerida || ""))}
                          onChange={e => setTextos({ ...textos, [c.id]: e.target.value })}
                          ref={el => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                          placeholder="Escribí la respuesta…"
                          style={{ width: "100%", background: "transparent", border: "none", color: "#fff", fontSize: 13.5, fontFamily: "inherit", resize: "none", overflow: "hidden", outline: "none", boxSizing: "border-box", marginTop: 8, minHeight: 40, display: "block" }} />
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, maxWidth: 640, marginBottom: 10 }}>
                      <input value={notaTxt} onChange={e => setNotaTxt(e.target.value)} placeholder="Nota interna para el equipo (no la ve el cliente)…"
                        style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#fff", fontSize: 13 }} />
                      <button style={btn(false)} onClick={() => { if (!notaTxt.trim()) return; patch(c.id, { notas: [...(c.notas || []), { quien: operador, texto: notaTxt.trim(), at: new Date().toISOString() }] }); setNotaTxt(""); }}>+ Nota</button>
                    </div>
                    <div style={{ display: "flex", gap: 8, maxWidth: 640, flexWrap: "wrap" }}>
                      <button style={{ ...btn(false), padding: "8px 11px", fontSize: 15, ...(copiado === c.id ? { background: "#1A9E7C", borderColor: "transparent", color: "#fff" } : {}) }} title="Copiar la respuesta" onClick={() => {
                        const txt = (textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_sugerida || "")).trim();
                        if (!txt) { setError("No hay respuesta para copiar."); return; }
                        navigator.clipboard.writeText(txt); setCopiado(c.id);
                      }}>{copiado === c.id ? "✓" : "📋"}</button>
                      <button style={{ ...btn(false), padding: "8px 12px", fontSize: 17, borderColor: "rgba(46,207,170,0.5)", color: "#2ECFAA" }} title="Enviar mensaje de bot" onClick={() => {
                        const txt = (textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_sugerida || "")).trim();
                        if (!txt) { setError("Escribí la respuesta antes de enviar."); return; }
                        if (!window.confirm("Se va a ENVIAR este mensaje al cliente por WhatsApp:\n\n" + txt + "\n\n¿Confirmás?")) return; patch(c.id, { respuesta_enviada: txt, estado: "enviando", enviado_por: operador });
                      }}>🤖</button>
                      <button style={btn(false)} title="Si copiaste el mensaje y lo pegaste vos en WhatsApp, marcá el caso como respondido con esto" onClick={() => {
                        const txt = (textos[c.id] !== undefined ? textos[c.id] : (c.respuesta_sugerida || "")).trim();
                        patch(c.id, { respuesta_enviada: txt || c.respuesta_sugerida || "(respondido por fuera de la tiquetera)", estado: "esperando_cliente", enviado_at: new Date().toISOString(), enviado_via: "manual", enviado_por: operador });
                      }}>✓✓ Contestado</button>
                      <button style={btn(false)} onClick={() => patch(c.id, { estado: c.estado === "esperando_cadete" ? "abierto" : "esperando_cadete" })}>
                        {c.estado === "esperando_cadete" ? "Volver a abierto" : "Esperando cadete"}
                      </button>
                      <button style={btn(false)} onClick={() => patch(c.id, { estado: c.estado === "esperando_deposito" ? "abierto" : "esperando_deposito" })}>
                        {c.estado === "esperando_deposito" ? "Volver a abierto" : "Esperando depósito"}
                      </button>
                      <button style={btn(false)} title="Fijar arriba" onClick={() => patch(c.id, { fijado: !c.fijado })}>📌</button>
                      <select defaultValue="" title="Posponer este caso (la alarma lo despierta)"
                        onChange={e => { const v = e.target.value; if (!v) return; let d; if (v === "manana") { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); } else { d = new Date(Date.now() + Number(v) * 3600000); } patch(c.id, { snooze_hasta: d.toISOString() }); e.target.value = ""; }}
                        style={{ ...btn(false), padding: "8px 10px", background: "#12123A", color: "rgba(255,255,255,0.7)", appearance: "none", WebkitAppearance: "none", MozAppearance: "none", textAlign: "center" }} title="Posponer (la alarma lo despierta)">
                        <option value="" disabled>⏰</option>
                        <option value="0.5">30 min</option>
                        <option value="1">1 hora</option>
                        <option value="2">2 horas</option>
                        <option value="4">4 horas</option>
                        <option value="8">8 horas</option>
                        <option value="manana">Mañana 9hs</option>
                      </select>
                      {c.snooze_hasta && <button style={{ ...btn(false), borderColor: "rgba(255,176,32,0.5)", color: "#FFB020" }} title="Cancela la alarma: deja de sonar/temblar y el caso vuelve a la lista normal" onClick={() => patch(c.id, { snooze_hasta: null })}>🔕 Apagar alarma</button>}
                      <button style={{ ...btn(false), borderColor: "rgba(46,207,170,0.4)", color: "#2ECFAA" }}
                        onClick={() => setConfirmarResolver(c.id)}>
                        Resolver
                      </button>
                      <button style={{ ...btn(false), padding: "8px 11px", fontSize: 15, borderColor: "rgba(229,115,115,0.45)", color: "#E57373" }} title="Reportar algo raro de este caso"
                        onClick={() => { setBugPara(bugPara === c.id ? null : c.id); setBugTxt(""); }}>🐛</button>
                    </div>
                    {confirmarResolver === c.id && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", maxWidth: 640, marginTop: 10, padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(46,207,170,0.45)", background: "rgba(46,207,170,0.07)" }}>
                        <span style={{ fontSize: 13, color: "#fff" }}>¿Marcar este caso como resuelto?</span>
                        <button style={{ ...btn(true), marginLeft: "auto" }} onClick={async () => {
                          const idx = visibles.findIndex(x => x.id === c.id);
                          let siguiente = null;
                          for (let j = idx + 1; j < visibles.length; j++) { if (visibles[j].id !== c.id && visibles[j].estado !== "resuelto") { siguiente = visibles[j].id; break; } }
                          if (siguiente == null) for (let j = idx - 1; j >= 0; j--) { if (visibles[j].id !== c.id && visibles[j].estado !== "resuelto") { siguiente = visibles[j].id; break; } }
                          setConfirmarResolver(null);
                          await patch(c.id, { estado: "resuelto", resuelto_por: operador, resuelto_at: new Date().toISOString(), snooze_hasta: null, fijado: false });
                          setAbierto(siguiente); // salta directo a la próxima consulta pendiente (o cierra si no hay)
                        }}>Sí, resolver</button>
                        <button style={btn(false)} onClick={() => setConfirmarResolver(null)}>Cancelar</button>
                      </div>
                    )}
                    {bugPara === c.id && (
                      <div style={{ display: "flex", gap: 8, maxWidth: 640, marginTop: 10 }}>
                        <input value={bugTxt} onChange={e => setBugTxt(e.target.value)} autoFocus placeholder="¿Qué viste raro en este caso?"
                          onKeyDown={e => { if (e.key === "Enter") reportarBug(c); }}
                          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(229,115,115,0.45)", background: "rgba(229,115,115,0.06)", color: "#fff", fontSize: 13 }} />
                        <button style={btn(true)} onClick={() => reportarBug(c)}>Guardar reporte</button>
                      </div>
                    )}
                    {bugMsg === c.id && <div style={{ marginTop: 8, fontSize: 12.5, color: "#39d98a" }}>✓ ¡Gracias! Reporte guardado para revisar.</div>}
                  </>)}
              </div>
            </div>
          </div>
        );
      })()}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(4,6,12,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox} alt="Imagen" style={{ maxWidth: "96%", maxHeight: "94%", borderRadius: 8, boxShadow: "0 20px 80px rgba(0,0,0,0.7)" }} />
          <button onClick={() => setLightbox(null)} title="Cerrar" style={{ position: "absolute", top: 16, right: 20, background: "rgba(255,255,255,0.14)", border: "none", color: "#fff", fontSize: 24, lineHeight: 1, borderRadius: 8, width: 40, height: 40, cursor: "pointer" }}>×</button>
        </div>
      )}
    </div>
  );
}
