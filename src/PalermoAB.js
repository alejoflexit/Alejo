import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { getSession } from "./auth";
import { sbFetch } from "./colectasShared";
import { bridgeFetch } from "./bridge";
import { prepararAudio, beep, camaraViva, obtenerCamara, apagarCamara, soltarCamara } from "./camaraQR";
import { leerEtiqueta, envioCoincide, filtroEnvios, diaAR } from "./dobleBultoShared";
import { zonaPalermo, CARRITOS, FILTRO_RECUADRO } from "./palermoShared";
import { ESC_CSS, EscArriba, EscPastilla, EscMarco, EscAyuda, EscBarra, EscHoja, EscEtiqueta, EscGrupo, EscFila, IcoAviso, IcoPin, IcoEscanear, IcoLista } from "./escanerUI";

// Palermo A/B — pedido de Alejo (20/11/2026). Se escanea el QR del paquete y la pantalla dice en qué
// carrito va (A o B) según la latitud/longitud del envío en LightData (columna nueva de envios_busqueda,
// migración 20261120220000). El corte vive en palermoShared.js.
// Cada escaneo se guarda en palermo_escaneos (una fila por envío y día, migración 20261120233000):
// el contador es del DÍA y es el mismo en todos los celulares. Si la tabla no existe, cuenta solo en el celu.
//
// Para que sea instantáneo, al abrir se precargan los envíos de la caché que caen en el recuadro de
// Palermo; si un código no está en la precarga, se busca puntual en envios_busqueda.

const COLS = "id_interno,tracking,id_venta_ml,razon_social,direccion,localidad,cp,cadete,latitud,longitud";
const COLS_SIN_COORD = "id_interno,tracking,id_venta_ml,razon_social,direccion,localidad,cp,cadete";
const faltaColumna = (e) => /latitud|longitud|42703|PGRST204/i.test(String(e && e.message));
const AUTO_SIGUE_MS = 1400;
const REFRESCO_MS = 15000; // el contador compartido se actualiza solo cada 15 s
const sinTabla = (e) => /palermo_escaneos|relation|schema cache|PGRST205|42P01/i.test(String(e && e.message));
const hoyAR = () => diaAR(new Date().toISOString()); // A/B: la cámara sigue sola; los avisos esperan un toque

// ---------- datos ----------
const claves = (e) => [e.tracking, e.id_interno, e.id_venta_ml].map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);

async function precargar() {
  const rows = await sbFetch(`envios_busqueda?${FILTRO_RECUADRO}&select=${COLS}&order=actualizado_at.desc&limit=5000`);
  const mapa = new Map();
  for (const e of rows || []) for (const k of claves(e)) if (!mapa.has(k)) mapa.set(k, e);
  return { mapa, n: (rows || []).length };
}

let sinCoordenadas = false; // se prende si Supabase todavía no tiene las columnas
async function buscarEnvio(codigo) {
  const f = filtroEnvios([codigo]);
  if (!f) return null;
  let rows;
  try {
    rows = await sbFetch(`envios_busqueda?${f}&select=${sinCoordenadas ? COLS_SIN_COORD : COLS}&limit=5`);
  } catch (e) {
    if (!faltaColumna(e)) throw e;
    sinCoordenadas = true;
    rows = await sbFetch(`envios_busqueda?${f}&select=${COLS_SIN_COORD}&limit=5`);
  }
  return (rows || []).find((e) => envioCoincide(e, codigo)) || null;
}

// En vivo (21/11): si el envío no está en la caché o no tiene ubicación (p. ej. ingresó a planta hace
// minutos), se le pregunta a LightData por el bridge del VPS (/envio-ubicacion, 1-2 s). Solo códigos numéricos.
async function buscarEnVivo(codigo) {
  if (!/^\d{5,20}$/.test(String(codigo))) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await bridgeFetch("envio-ubicacion", { codigo: String(codigo) }, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.encontrado && j.envio ? j.envio : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
// Sin coordenadas en LightData (21/11, caso Fitz Roy 2469): se ubica la dirección con el geocodificador de la
// Ciudad (USIG). Va por JSONP (script) porque USIG no habilita CORS; solo se acepta un resultado de CABA.
function geocodificarUSIG(direccion) {
  const limpia = String(direccion || "").split(/\s\/\s|Referencia|,|\(/i)[0].replace(/\b(calle|avenida|av\.?)\s+/gi, "").trim();
  if (!limpia || !/\d/.test(limpia)) return Promise.resolve(null);
  return new Promise((ok) => {
    const cb = "__usig" + Date.now() + Math.floor(Math.random() * 1000);
    const sc = document.createElement("script");
    const fin = (v) => { clearTimeout(t); delete window[cb]; sc.remove(); ok(v); };
    const t = setTimeout(() => fin(null), 6000);
    window[cb] = (j) => {
      const d = ((j && j.direccionesNormalizadas) || []).find((x) => x.cod_partido === "caba" && x.coordenadas);
      fin(d ? { latitud: Number(d.coordenadas.y), longitud: Number(d.coordenadas.x), geocodificado: true } : null);
    };
    sc.onerror = () => fin(null);
    sc.src = `https://servicios.usig.buenosaires.gob.ar/normalizar/?direccion=${encodeURIComponent(limpia)}&geocodificar=true&srid=4326&maxOptions=5&callback=${cb}`;
    document.head.appendChild(sc);
  });
}
// Foto del día (21/11): el bridge baja cada 60 s lo movido hoy en LightData y le pasa a la app los del
// recuadro de Palermo. Se suma a la precarga, así un paquete que ingresó hace un rato se clasifica sin red.
async function traerFotoDia() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await bridgeFetch("envios-palermo", null, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j && j.envios) ? j.envios : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function buscarCompleto(codigo, local) {
  if (local && zonaPalermo(local.latitud, local.longitud)) return local;
  // Caché y LightData en paralelo: antes se esperaba una y después la otra.
  const vivoP = buscarEnVivo(codigo);
  // Etiqueta de LightData ya cargada pero sin coordenadas: se ubica la dirección al mismo tiempo.
  const geoP = local && local.direccion ? geocodificarUSIG(local.direccion) : null;
  let env = local || (await buscarEnvio(codigo).catch(() => null));
  if (env && zonaPalermo(env.latitud, env.longitud)) return env;
  if (geoP) { const g = await geoP; if (g && zonaPalermo(g.latitud, g.longitud)) return { ...env, ...g }; }
  const vivo = await vivoP;
  if (vivo) env = { ...(env || {}), ...vivo };
  if (env && !zonaPalermo(env.latitud, env.longitud) && env.direccion) {
    const g = await geocodificarUSIG(env.direccion);
    if (g) env = { ...env, ...g };
  }
  return env;
}

// envío (o null) → { tipo: "A" | "B" | "fuera" | "sinubic" | "noesta", env }
function clasificar(env) {
  if (!env) return { tipo: "noesta", env: null };
  const z = zonaPalermo(env.latitud, env.longitud);
  return { tipo: z || "sinubic", env };
}

const dirDe = (env) => (env ? [env.direccion, env.localidad].filter(Boolean).join(" · ") : "");

// =====================================================================================
export default function PalermoAB() {
  const [escaner, setEscaner] = useState(() => /[?&]escanear=1/.test(window.location.search));
  const [pre, setPre] = useState({ estado: "cargando", n: 0, at: null });
  const mapaRef = useRef(new Map());
  const fotoRef = useRef([]);
  // Escaneos de HOY (servidor + los recién hechos en este celu que todavía no subieron)
  const [hoy, setHoy] = useState({ dia: hoyAR(), filas: [] });
  const [tabla, setTabla] = useState("ok"); // ok | falta | red
  const [pendientes, setPendientes] = useState(0);
  const locales = useRef(new Map()); // codigo → fila local hasta que el servidor la devuelva
  const hoyRef = useRef(hoy); hoyRef.current = hoy;

  const cargar = useCallback(async () => {
    try {
      const { mapa, n } = await precargar();
      for (const e of fotoRef.current) for (const k of claves(e)) mapa.set(k, e); // la foto del bridge manda
      mapaRef.current = mapa;
      setPre({ estado: "ok", n, at: new Date() });
    } catch (e) {
      setPre({ estado: faltaColumna(e) ? "migracion" : getSession() ? "red" : "sesion", n: 0, at: null });
    }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 5 * 60 * 1000); return () => clearInterval(t); }, [cargar]);
  // Lo recién movido en LightData pisa a la caché (trae la ubicación al día). Cada 60 s mientras está abierta.
  useEffect(() => {
    let vivo = true;
    const sumar = async () => {
      const envios = await traerFotoDia();
      if (!vivo || !envios) return;
      fotoRef.current = envios;
      const mapa = new Map(mapaRef.current);
      for (const e of envios) for (const k of claves(e)) mapa.set(k, e);
      mapaRef.current = mapa;
    };
    sumar();
    const t = setInterval(sumar, 60 * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!/[?&]escanear=1/.test(window.location.search)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);

  // Junta lo del servidor con lo local (lo local manda: es lo último que se escaneó en este celu)
  const fusionar = useCallback((dia, delServidor) => {
    const m = new Map((delServidor || []).map((f) => [f.codigo, f]));
    for (const [c, f] of locales.current) { if (f.dia !== dia) locales.current.delete(c); else m.set(c, f); }
    return [...m.values()].sort((a, b) => String(b.escaneado_at).localeCompare(String(a.escaneado_at)));
  }, []);

  const traerHoy = useCallback(async () => {
    const dia = hoyAR();
    try {
      const rows = await sbFetch(`palermo_escaneos?dia=eq.${dia}&select=codigo,carrito,tipo,manual,direccion,escaneado_por,escaneado_at&order=escaneado_at.desc&limit=3000`);
      setTabla("ok");
      setHoy({ dia, filas: fusionar(dia, rows) });
    } catch (e) {
      setTabla(sinTabla(e) ? "falta" : "red");
      setHoy((h) => ({ dia, filas: fusionar(dia, h.dia === dia ? h.filas.filter((f) => !locales.current.has(f.codigo)) : []) }));
    }
  }, [fusionar]);
  useEffect(() => { traerHoy(); const t = setInterval(traerHoy, REFRESCO_MS); return () => clearInterval(t); }, [traerHoy]);

  async function subir(fila, intento = 0) {
    try {
      await sbFetch("palermo_escaneos?on_conflict=dia,codigo", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([fila]),
      });
      locales.current.delete(fila.codigo);
      return true;
    } catch (e) {
      if (sinTabla(e)) { setTabla("falta"); return false; } // queda contado solo en este celu
      if (intento < 3) { await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1))); return subir(fila, intento + 1); }
      setTabla("red");
      return false;
    }
  }

  // Registra el paquete en el carrito (o sin carrito). Devuelve false si ya estaba hoy con el mismo carrito.
  const anotar = useCallback((codigo, tipo, env, manual) => {
    const dia = hoyAR();
    const carrito = tipo === "A" || tipo === "B" ? tipo : null;
    const previo = hoyRef.current.filas.find((f) => f.codigo === codigo);
    if (previo && previo.carrito === carrito && !manual) return false;
    const yo = (() => { const s = getSession(); return (s && (s.nombre || s.email)) || "equipo"; })();
    const fila = { dia, codigo, carrito, tipo, manual: !!manual, direccion: dirDe(env) || null, cliente: (env && env.razon_social) || null, escaneado_por: yo, escaneado_at: new Date().toISOString() };
    locales.current.set(codigo, fila);
    setHoy((h) => ({ dia, filas: fusionar(dia, h.dia === dia ? h.filas : []) }));
    setPendientes((n) => n + 1);
    subir(fila).finally(() => setPendientes((n) => n - 1));
    return !previo;
  }, [fusionar]); // eslint-disable-line react-hooks/exhaustive-deps
  const sesion = {
    A: hoy.filas.filter((f) => f.carrito === "A").length,
    B: hoy.filas.filter((f) => f.carrito === "B").length,
    otros: hoy.filas.filter((f) => !f.carrito).length,
  };

  const total = sesion.A + sesion.B;
  const fecha = new Date().toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return (
    <div className="pab">
      <style>{CSS}</style>
      <div className="pab-cab">
        <div>
          <div className="pab-tit">Palermo A/B</div>
          <div className="pab-sub">{total + sesion.otros} {total + sesion.otros === 1 ? "paquete escaneado" : "paquetes escaneados"} hoy{pendientes > 0 ? " · guardando…" : ""}</div>
        </div>
        <span className="pab-fecha">{fecha}</span>
      </div>

      {pre.estado === "migracion" && <div className="pab-alerta">Falta agregar latitud y longitud a <code>envios_busqueda</code> (migración <code>20261120220000</code>). Hasta entonces la pantalla no puede decir el carrito.</div>}
      {pre.estado === "sesion" && <div className="pab-alerta">Entrá con tu usuario desde Inicio para poder consultar los envíos.</div>}
      {tabla === "falta" && <div className="pab-alerta">Falta crear la tabla <code>palermo_escaneos</code> (migración <code>20261120233000</code>): por ahora el contador es solo de este celular.</div>}
      {tabla === "red" && <div className="pab-alerta">Hay escaneos que no se pudieron guardar (sin señal). Siguen contados en este celular y se reintenta solo.</div>}
      {pre.estado === "red" && <div className="pab-alerta">No se pudieron traer los envíos. Igual podés escanear: cada paquete se busca en el momento. <button className="pab-link" onClick={cargar}>Reintentar</button></div>}

      <div className="pab-carros">
        {["A", "B"].map((z) => (
          <div key={z} className="pab-carro">
            <div className="pab-carro-top"><span className={"pab-letra t-" + z}>{z}</span><span className="pab-pct">{total ? `${Math.round((sesion[z] / total) * 100)}%` : ""}</span></div>
            <div className="pab-n">{sesion[z]}</div>
            <div className="pab-barrios">{CARRITOS[z].barrios}</div>
          </div>
        ))}
      </div>

      <div className="pab-etq"><IcoPin />Dónde está el corte</div>
      <div className="pab-celda pab-regla">Calle <b>Malabia</b>, de Córdoba a Santa Fe: hacia Alto Palermo es <b className="c-A">A</b>, hacia Hollywood es <b className="c-B">B</b>. Del otro lado de Santa Fe el límite es <b>Av. Sarmiento</b>: hacia Palermo Chico es A, hacia Cañitas es B.</div>

      {hoy.filas.length > 0 && <>
        <div className="pab-etq"><IcoLista size={16} />Escaneados hoy{sesion.otros ? <span className="pab-etq-sub">{sesion.otros} sin carrito</span> : null}</div>
        <div className="pab-celda pab-lista">
          {hoy.filas.slice(0, 60).map((x) => (
            <div key={x.codigo} className="pab-fila">
              <span className={"pab-chip t-" + (x.carrito || "x")}>{x.carrito || "–"}</span>
              <span className="pab-fdir">{x.direccion || `Envío ${x.codigo}`}{x.manual ? " · a mano" : ""}</span>
              <span className="pab-quien">{x.escaneado_por || ""}</span>
            </div>
          ))}
        </div>
      </>}

      <div className="pab-meta">
        {pre.estado === "ok" ? `${pre.n} ${pre.n === 1 ? "envío" : "envíos"} de Palermo con ubicación ${pre.n === 1 ? "precargado" : "precargados"} · ${pre.at.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : pre.estado === "cargando" ? "Cargando envíos…" : ""}
      </div>

      <div className="pab-fab"><button className="pab-escanear" onPointerDown={prepararAudio} onClick={() => setEscaner(true)}><IcoEscanear />Escanear paquetes</button></div>

      {escaner && <Escaner mapaRef={mapaRef} anotar={anotar} sesion={sesion} onCerrar={() => setEscaner(false)} />}
    </div>
  );
}

// =====================================================================================
function Escaner({ mapaRef, anotar, sesion, onCerrar }) {
  const video = useRef();
  const pausa = useRef(false);
  const ultimo = useRef({ c: "", at: 0 });
  const [res, setRes] = useState(null); // { codigo, tipo, env, buscando, repetido }
  const [error, setError] = useState(null);
  const [tipear, setTipear] = useState(false);
  const [tipeo, setTipeo] = useState("");
  const auto = useRef(null);

  const seguir = useCallback(() => {
    clearTimeout(auto.current);
    setRes((r) => { if (r) ultimo.current = { c: r.codigo, at: Date.now() }; return null; });
    pausa.current = false;
  }, []);

  const mostrar = useCallback((codigo, env) => {
    const { tipo } = clasificar(env);
    const nuevo = tipo === "A" || tipo === "B" ? anotar(codigo, tipo, env) : true;
    if (tipo === "A") beep(true);
    else if (tipo === "B") { beep(true); setTimeout(() => beep(true), 170); } // B suena doble: se distingue sin mirar
    else beep(false);
    setRes({ codigo, tipo, env, buscando: false, repetido: !nuevo });
    clearTimeout(auto.current);
    if (tipo === "A" || tipo === "B") auto.current = setTimeout(seguir, AUTO_SIGUE_MS);
  }, [anotar, seguir]);

  const procesar = useCallback((texto) => {
    if (pausa.current) return;
    const l = leerEtiqueta(texto);
    const ahora = Date.now();
    if (!l) return;
    if (l.codigo === ultimo.current.c && ahora - ultimo.current.at < 2500) return; // sigue la misma etiqueta en cuadro
    ultimo.current = { c: l.codigo, at: ahora };
    pausa.current = true;
    const local = mapaRef.current.get(String(l.codigo).toLowerCase());
    if (local && zonaPalermo(local.latitud, local.longitud)) { mostrar(l.codigo, local); return; }
    setRes({ codigo: l.codigo, buscando: true });
    buscarCompleto(l.codigo, local)
      .then((env) => mostrar(l.codigo, env || local || null))
      .catch(() => { beep(false); setRes({ codigo: l.codigo, tipo: "error", env: null }); });
  }, [mapaRef, mostrar]);

  function elegir(z) { if (res) anotar(res.codigo, z, res.env, true); seguir(); }
  function ninguno() { if (res) anotar(res.codigo, res.tipo, res.env, false); seguir(); }

  // Cámara + lectura cada ~250 ms (BarcodeDetector si existe; si no, jsQR — iPhone). Igual que Doble bulto.
  useEffect(() => {
    let stream, timer, vivo = true, conectando = false, listo = false;
    const el = video.current;
    const cv = document.createElement("canvas");
    const det = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    const conectar = async (forzar) => {
      if (conectando || !vivo) return;
      conectando = true;
      try {
        if (forzar) apagarCamara();
        stream = await obtenerCamara();
        if (!vivo) return;
        const v = video.current;
        if (v.srcObject !== stream) { v.style.opacity = "0"; v.srcObject = stream; }
        await v.play().catch(() => {});
        setTimeout(() => { if (vivo && v.videoWidth) v.style.opacity = "1"; }, 350);
      } catch { /* reintenta el vigía */ } finally { conectando = false; }
    };
    const alVolver = () => { if (!document.hidden) conectar(!camaraViva()); };
    document.addEventListener("visibilitychange", alVolver);
    const vigia = setInterval(() => { const v = video.current; if (vivo && listo && !document.hidden && v && (!v.videoWidth || !camaraViva())) conectar(true); }, 2500);
    (async () => {
      try {
        stream = await obtenerCamara();
        if (!vivo) { soltarCamara(); return; }
        const v = video.current;
        const remedir = () => { v.style.width = "99.9%"; requestAnimationFrame(() => { v.style.width = "100%"; }); };
        ["loadedmetadata", "playing", "resize"].forEach((ev) => v.addEventListener(ev, remedir));
        v.srcObject = stream; await v.play();
        remedir();
        setTimeout(() => { remedir(); requestAnimationFrame(() => requestAnimationFrame(() => { if (vivo) v.style.opacity = "1"; })); }, 350);
        setTimeout(remedir, 1000);
        listo = true;
      } catch { setError("No se pudo abrir la cámara. Revisá el permiso en Ajustes › Safari › Cámara."); return; }
      let ocupado = false;
      timer = setInterval(async () => {
        const v = video.current;
        if (ocupado || pausa.current || !v || !v.videoWidth) return;
        ocupado = true;
        try {
          let texto = null;
          if (det) { const r = await det.detect(v).catch(() => []); if (r && r[0]) texto = r[0].rawValue; }
          if (!texto) {
            const e = 800 / v.videoWidth; cv.width = 800; cv.height = Math.round(v.videoHeight * e);
            const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(v, 0, 0, cv.width, cv.height);
            const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: "dontInvert" });
            if (r) texto = r.data;
          }
          if (texto) procesar(texto);
        } finally { ocupado = false; }
      }, 250);
    })();
    return () => { vivo = false; clearInterval(timer); clearInterval(vigia); clearTimeout(auto.current); document.removeEventListener("visibilitychange", alVolver); if (el) el.srcObject = null; soltarCamara(); };
  }, [procesar]);

  // Pantalla fija mientras se escanea (sin pellizcar)
  useEffect(() => {
    const no = (e) => e.preventDefault();
    const pinch = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("gesturestart", no); document.addEventListener("gesturechange", no);
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => { document.removeEventListener("gesturestart", no); document.removeEventListener("gesturechange", no); document.removeEventListener("touchmove", pinch); };
  }, []);

  const esCarro = res && (res.tipo === "A" || res.tipo === "B");
  const AVISOS = {
    noesta: ["No está en LightData", "No aparece en los envíos sincronizados. Fijate la dirección en la etiqueta."],
    sinubic: ["Sin ubicación", "LightData no trae coordenadas para este envío."],
    fuera: ["No es de Palermo", "La ubicación cae afuera de Palermo. Apartalo."],
    error: ["Sin conexión", "No se pudo consultar. Probá de nuevo o elegí a mano."],
  };
  function tipeado(e) {
    e.preventDefault();
    const t = tipeo.trim();
    if (!t) return;
    setTipeo(""); setTipear(false);
    ultimo.current = { c: "", at: 0 }; pausa.current = false;
    procesar(t);
  }

  return createPortal(
    <div className="esc" onPointerDown={prepararAudio}>
      <style>{ESC_CSS}{CSS_RES}</style>
      <div className="esc-abriendo">Abriendo cámara…</div>
      <video ref={video} playsInline muted autoPlay disablePictureInPicture className="esc-video" style={{ opacity: 0 }} />
      <div className="esc-vineta" />
      <EscMarco estado={res && !res.buscando && !esCarro ? "aviso" : null} />
      <EscArriba titulo="Palermo A/B" onVolver={onCerrar} derecha={<EscPastilla>{sesion.A + sesion.B} hoy</EscPastilla>} />
      {!res && !tipear && <EscAyuda tono={error ? "aviso" : null}>{error || "Apuntá al QR de la etiqueta"}</EscAyuda>}
      {res && res.buscando && <EscAyuda>Buscando en LightData…</EscAyuda>}

      {esCarro && (
        <button className={"pab-res t-" + res.tipo} onClick={seguir}>
          <span className="pab-res-letra">{res.tipo}</span>
          <span className="pab-res-nom">{CARRITOS[res.tipo].nombre}{res.repetido ? " · ya escaneado" : ""}</span>
          <span className="pab-res-card">
            <span className="esc-fila"><span className="k">{(res.env && res.env.direccion) || `Envío ${res.codigo}`}</span><span className="v">{(res.env && res.env.localidad) || ""}</span></span>
            {res.env && res.env.razon_social ? <span className="esc-fila"><span className="k">{res.env.razon_social}</span><span className="v">{res.codigo}</span></span> : null}
          </span>
          <span className="pab-res-toca">Sigue sola · tocá para seguir ya</span>
        </button>
      )}

      {res && !res.buscando && !esCarro && (
        <EscHoja titulo={AVISOS[res.tipo][0]} onCerrar={ninguno} cerrarLabel="Siguiente">
          <EscEtiqueta icono={<IcoAviso />} tono="aviso">{AVISOS[res.tipo][1]}</EscEtiqueta>
          <EscGrupo>
            {res.env ? <EscFila k={res.env.direccion || "Sin dirección"} v={res.env.cp ? `CP ${res.env.cp}` : res.env.localidad || ""} /> : null}
            <EscFila k={(res.env && res.env.razon_social) || "Envío"} v={res.codigo} />
          </EscGrupo>
          {res.tipo !== "fuera" && <>
            <EscEtiqueta icono={<IcoPin />}>¿En qué carrito lo pusiste?</EscEtiqueta>
            <div className="esc-botones">
              <button className="esc-btn glow-a" onClick={() => elegir("A")}>Carrito A</button>
              <button className="esc-btn glow-b" onClick={() => elegir("B")}>Carrito B</button>
            </div>
          </>}
          <div className="esc-botones"><button className="esc-btn suave" onClick={ninguno}>{res.tipo === "fuera" ? "Siguiente" : "Ninguno · siguiente"}</button></div>
        </EscHoja>
      )}

      {tipear && !res && (
        <EscHoja titulo="Tipear código" onCerrar={() => { setTipear(false); pausa.current = false; }} cerrarLabel="Cancelar">
          <form onSubmit={tipeado} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input className="esc-input" autoFocus inputMode="numeric" placeholder="Número de envío, tracking o venta" value={tipeo} onChange={(e) => setTipeo(e.target.value)} />
            <div className="esc-botones"><button className="esc-btn glow-teal" type="submit" disabled={!tipeo.trim()}>Buscar</button></div>
          </form>
        </EscHoja>
      )}

      <EscBarra
        izq={{ n: sesion.A, label: "Carrito A", punto: CARRITOS.A.color }}
        der={{ n: sesion.B, label: "Carrito B", punto: CARRITOS.B.color }}
        onCentro={() => { if (res) return; pausa.current = true; setTipear(true); }}
      />
    </div>,
    document.body
  );
}

// Pantalla de resultado A/B: el color del carrito a pantalla completa
const CSS_RES = `
.pab-res{position:absolute;inset:0;z-index:3;border:0;padding:0;margin:0;width:100%;color:#fff;font:inherit;cursor:pointer;touch-action:manipulation;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;animation:pab-in .12s ease-out}
.pab-res.t-A{background:radial-gradient(120% 80% at 50% 30%,#2fbf63 0%,#13853f 55%,#0a4d25 100%)}
.pab-res.t-B{background:radial-gradient(120% 80% at 50% 30%,#ffae3d 0%,#d9690a 55%,#7a3504 100%)}
.pab-res-letra{font-size:min(70vw,300px);font-weight:700;line-height:.9;letter-spacing:-.04em}
.pab-res-nom{font-size:22px;font-weight:600;margin-bottom:18px}
.pab-res-card{display:block;width:calc(100% - 32px);max-width:480px;border-radius:24px;background:rgba(0,0,0,.18);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.2);text-align:left}
.pab-res-card .esc-fila .v{color:rgba(255,255,255,.75)}
.pab-res-toca{position:absolute;bottom:calc(env(safe-area-inset-bottom) + 98px);font-size:13px;opacity:.8}
@keyframes pab-in{from{opacity:.4;transform:scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pab-res{animation:none}}
`;

const CSS = `
.pab{display:flex;flex-direction:column;gap:14px;color:#f4f5fa;max-width:760px;font-family:-apple-system,'SF Pro Text',Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding-bottom:8px}
.pab-cab{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:2px 2px 0}
.pab-tit{font-size:30px;font-weight:700;letter-spacing:-.6px;line-height:1.1}
.pab-sub{font-size:15px;color:rgba(255,255,255,.6);margin-top:3px}
.pab-fecha{flex:none;height:32px;padding:0 12px;border-radius:16px;display:inline-flex;align-items:center;font-size:14px;font-weight:600;background:linear-gradient(160deg,rgba(34,30,96,.55),rgba(10,37,52,.55));border:1px solid rgba(160,170,255,.18);text-transform:capitalize}
.pab-alerta{border-radius:18px;padding:12px 14px;font-size:14px;line-height:1.5;background:rgba(255,204,77,.08);border:1px solid rgba(255,204,77,.35)}
.pab-alerta code{font-size:12px;color:#ffcc4d}
.pab-link{background:none;border:0;color:#2EE6B6;font:inherit;font-size:14px;cursor:pointer;padding:4px 6px}
.pab-carros{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pab-carro{border-radius:20px;padding:14px;display:flex;flex-direction:column;gap:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06)}
.pab-carro-top{display:flex;align-items:center;justify-content:space-between}
.pab-letra{width:36px;height:36px;border-radius:12px;color:#fff;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center}
.pab-letra.t-A,.pab-chip.t-A{background:#1fa651}.pab-letra.t-B,.pab-chip.t-B{background:#f08a12}
.pab-pct{font-size:13px;color:rgba(255,255,255,.55);font-weight:500}
.pab-n{font-size:36px;font-weight:700;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.pab-barrios{font-size:12px;line-height:1.35;color:rgba(255,255,255,.6)}
.pab-etq{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:rgba(255,255,255,.85);padding:4px 4px 0}
.pab-etq svg{color:rgba(255,255,255,.55)}
.pab-etq-sub{margin-left:auto;font-size:13px;font-weight:500;color:rgba(255,255,255,.5)}
.pab-celda{border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.05)}
.pab-regla{padding:14px 16px;font-size:14px;line-height:1.55;color:rgba(255,255,255,.78)}
.pab-regla b{color:#fff}.pab-regla .c-A{color:#30d158}.pab-regla .c-B{color:#ff9f0a}
.pab-lista{overflow:hidden}
.pab-fila{display:flex;gap:12px;align-items:center;padding:11px 14px;font-size:15px}
.pab-fila+.pab-fila{border-top:1px solid rgba(255,255,255,.07)}
.pab-chip{width:26px;height:26px;flex:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;background:rgba(255,255,255,.12);color:#fff}
.pab-fdir{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pab-quien{font-size:13px;color:rgba(255,255,255,.5);white-space:nowrap}
.pab-meta{font-size:12px;color:rgba(255,255,255,.4);padding:0 4px}
.pab-fab{position:sticky;bottom:calc(env(safe-area-inset-bottom) + 10px);z-index:20;padding-top:4px}
.pab-escanear{width:100%;height:58px;border-radius:29px;border:0;background:linear-gradient(135deg,#2EE6B6 0%,#27c29e 55%,#6b5cff 150%);color:#04261d;font:inherit;font-size:17px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;touch-action:manipulation;box-shadow:0 12px 34px rgba(46,230,182,.25)}
.pab-escanear:active{transform:scale(.99)}
@media (max-width:600px){.pab-tit{font-size:28px}}
`;
