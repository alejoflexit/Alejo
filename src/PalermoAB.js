import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { getSession } from "./auth";
import { sbFetch } from "./colectasShared";
import { prepararAudio, beep, camaraViva, obtenerCamara, apagarCamara, soltarCamara } from "./camaraQR";
import { leerEtiqueta, envioCoincide, filtroEnvios } from "./dobleBultoShared";
import { zonaPalermo, CARRITOS, FILTRO_RECUADRO } from "./palermoShared";

// Palermo A/B — pedido de Alejo (20/11/2026). Se escanea el QR del paquete y la pantalla dice en qué
// carrito va (A o B) según la latitud/longitud del envío en LightData (columna nueva de envios_busqueda,
// migración 20261120220000). El corte vive en palermoShared.js. No escribe nada: solo lee y muestra.
//
// Para que sea instantáneo, al abrir se precargan los envíos de la caché que caen en el recuadro de
// Palermo; si un código no está en la precarga, se busca puntual en envios_busqueda.

const COLS = "id_interno,tracking,id_venta_ml,razon_social,direccion,localidad,cp,cadete,latitud,longitud";
const COLS_SIN_COORD = "id_interno,tracking,id_venta_ml,razon_social,direccion,localidad,cp,cadete";
const faltaColumna = (e) => /latitud|longitud|42703|PGRST204/i.test(String(e && e.message));
const AUTO_SIGUE_MS = 1400; // A/B: la cámara sigue sola; los avisos esperan un toque

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
  const [sesion, setSesion] = useState({ A: 0, B: 0, otros: 0, lista: [] });
  const vistos = useRef(new Set());

  const cargar = useCallback(async () => {
    try {
      const { mapa, n } = await precargar();
      mapaRef.current = mapa;
      setPre({ estado: "ok", n, at: new Date() });
    } catch (e) {
      setPre({ estado: faltaColumna(e) ? "migracion" : getSession() ? "red" : "sesion", n: 0, at: null });
    }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 5 * 60 * 1000); return () => clearInterval(t); }, [cargar]);
  useEffect(() => {
    if (!/[?&]escanear=1/.test(window.location.search)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);

  const anotar = useCallback((codigo, tipo, env, manual) => {
    if (vistos.current.has(codigo)) return false;
    vistos.current.add(codigo);
    setSesion((s) => ({
      A: s.A + (tipo === "A" ? 1 : 0), B: s.B + (tipo === "B" ? 1 : 0), otros: s.otros + (tipo !== "A" && tipo !== "B" ? 1 : 0),
      lista: [{ codigo, tipo, dir: dirDe(env), manual: !!manual }, ...s.lista].slice(0, 200),
    }));
    return true;
  }, []);
  const reiniciar = () => { vistos.current = new Set(); setSesion({ A: 0, B: 0, otros: 0, lista: [] }); };

  const total = sesion.A + sesion.B;
  return (
    <div className="pab">
      <style>{CSS}</style>
      <div className="pab-card pab-top">
        <div>
          <div className="pab-tit">Palermo en dos carritos</div>
          <div className="pab-sub">Escaneá el QR del paquete y la pantalla te dice en qué carrito va, según la ubicación del envío en LightData.</div>
        </div>
      </div>

      {pre.estado === "migracion" && <div className="pab-card pab-alerta">Falta agregar latitud y longitud a <code>envios_busqueda</code> (migración <code>20261120220000</code>). Hasta entonces la pantalla no puede decir el carrito.</div>}
      {pre.estado === "sesion" && <div className="pab-card pab-alerta">Entrá con tu usuario desde Inicio para poder consultar los envíos.</div>}
      {pre.estado === "red" && <div className="pab-card pab-alerta">No se pudieron traer los envíos. Igual podés escanear: cada paquete se busca en el momento. <button className="pab-link" onClick={cargar}>Reintentar</button></div>}

      <div className="pab-carros">
        {["A", "B"].map((z) => (
          <div key={z} className="pab-carro" style={{ "--c": CARRITOS[z].color }}>
            <div className="pab-letra">{z}</div>
            <div style={{ minWidth: 0 }}>
              <div className="pab-n">{sesion[z]}<small>{total ? ` · ${Math.round((sesion[z] / total) * 100)}%` : ""}</small></div>
              <div className="pab-barrios">{CARRITOS[z].barrios}</div>
            </div>
          </div>
        ))}
      </div>

      <button className="pab-escanear" onPointerDown={prepararAudio} onClick={() => setEscaner(true)}>Escanear paquetes</button>

      <div className="pab-card">
        <div className="pab-regla"><b>Dónde está el corte.</b> Calle <b>Malabia</b>, de Córdoba a Santa Fe: hacia Alto Palermo es <b style={{ color: CARRITOS.A.color }}>A</b>, hacia Hollywood es <b style={{ color: CARRITOS.B.color }}>B</b>. Del otro lado de Santa Fe, el límite es <b>Av. Sarmiento</b> (Plaza Italia → río): hacia Palermo Chico es A, hacia Cañitas es B.</div>
        <div className="pab-meta">
          {pre.estado === "ok" ? `${pre.n} ${pre.n === 1 ? "envío" : "envíos"} de Palermo con ubicación ${pre.n === 1 ? "precargado" : "precargados"} · ${pre.at.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : pre.estado === "cargando" ? "Cargando envíos…" : ""}
        </div>
      </div>

      {sesion.lista.length > 0 && (
        <div className="pab-card">
          <div className="pab-lhead"><b>Escaneados ahora</b><span>{sesion.lista.length}{sesion.otros ? ` · ${sesion.otros} sin carrito` : ""}</span><button className="pab-link" onClick={reiniciar}>Empezar de cero</button></div>
          {sesion.lista.slice(0, 40).map((x) => (
            <div key={x.codigo} className="pab-fila">
              <span className={"pab-chip t-" + x.tipo}>{x.tipo === "A" || x.tipo === "B" ? x.tipo : "?"}</span>
              <span className="pab-fdir">{x.dir || `Envío ${x.codigo}`}{x.manual ? " · elegido a mano" : ""}</span>
            </div>
          ))}
        </div>
      )}

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
    if (local) { mostrar(l.codigo, local); return; }
    setRes({ codigo: l.codigo, buscando: true });
    buscarEnvio(l.codigo)
      .then((env) => mostrar(l.codigo, env))
      .catch(() => { beep(false); setRes({ codigo: l.codigo, tipo: "error", env: null }); });
  }, [mapaRef, mostrar]);

  function elegir(z) { if (res) anotar(res.codigo, z, res.env, true); seguir(); }

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
    noesta: ["Todavía no está en LightData", "No aparece en los envíos sincronizados. Fijate la dirección en la etiqueta."],
    sinubic: ["Sin ubicación en LightData", "El envío no trae coordenadas. Mirá la dirección y elegí el carrito."],
    fuera: ["No es de Palermo", "La ubicación cae afuera de Palermo. Apartalo."],
    error: ["Sin conexión", "No se pudo consultar. Probá de nuevo o elegí a mano."],
  };

  return createPortal(
    <div className="pab-esc" onPointerDown={prepararAudio}>
      <style>{CSS}</style>
      <div className="pab-esc-abriendo">Abriendo cámara…</div>
      <video ref={video} playsInline muted autoPlay disablePictureInPicture className="pab-esc-video" style={{ opacity: 0 }} />
      <div className="pab-esc-marco"><i /><i /><i /><i /></div>
      <div className="pab-esc-arriba">
        <div className="pab-esc-cont">
          <span style={{ color: CARRITOS.A.color }}>A <b>{sesion.A}</b></span>
          <span style={{ color: CARRITOS.B.color }}>B <b>{sesion.B}</b></span>
        </div>
        <button className="pab-esc-cerrar" onClick={onCerrar}>Cerrar</button>
      </div>
      {error && !res && <div className="pab-esc-aviso">{error}</div>}

      {res && res.buscando && <div className="pab-esc-aviso">Buscando envío {res.codigo}…</div>}

      {esCarro && (
        <div className="pab-res" style={{ background: CARRITOS[res.tipo].color }} onClick={seguir}>
          <div className="pab-res-letra">{res.tipo}</div>
          <div className="pab-res-nom">{CARRITOS[res.tipo].nombre}{res.repetido ? " · ya escaneado" : ""}</div>
          <div className="pab-res-dir">{dirDe(res.env)}</div>
          {res.env && res.env.razon_social ? <div className="pab-res-cli">{res.env.razon_social}</div> : null}
          <div className="pab-res-toca">Tocá para seguir</div>
        </div>
      )}

      {res && !res.buscando && !esCarro && (
        <div className="pab-hoja">
          <div className="pab-hoja-tit">{AVISOS[res.tipo][0]}</div>
          <div className="pab-hoja-txt">{AVISOS[res.tipo][1]}</div>
          {res.env && <div className="pab-hoja-dir">{dirDe(res.env)}{res.env.cp ? ` · CP ${res.env.cp}` : ""}</div>}
          <div className="pab-hoja-cod">Envío {res.codigo}</div>
          {res.tipo !== "fuera" && (
            <div className="pab-hoja-bot">
              <button style={{ background: CARRITOS.A.color }} onClick={() => elegir("A")}>Lo puse en A</button>
              <button style={{ background: CARRITOS.B.color }} onClick={() => elegir("B")}>Lo puse en B</button>
            </div>
          )}
          <button className="pab-hoja-sig" onClick={seguir}>{res.tipo === "fuera" ? "Siguiente" : "Ninguno · siguiente"}</button>
        </div>
      )}
    </div>,
    document.body
  );
}

const CSS = `
.pab{display:flex;flex-direction:column;gap:14px;color:#f4f5fa;max-width:760px}
.pab-card{background:rgba(27,28,46,.72);border:1px solid rgba(255,255,255,.06);border-radius:14px;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);padding:16px}
.pab-tit{font-family:'Space Grotesk',-apple-system,'Segoe UI',sans-serif;font-size:19px;font-weight:600;letter-spacing:-.3px}
.pab-sub{font-size:13px;color:#a7adc2;margin-top:4px;line-height:1.45}
.pab-alerta{border-color:rgba(245,192,68,.35);font-size:14px;line-height:1.5}
.pab-alerta code{font-size:12px;color:#F5C044}
.pab-link{background:none;border:0;color:#2ee6b6;font:inherit;font-size:13px;cursor:pointer;padding:4px 6px}
.pab-carros{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pab-carro{display:flex;gap:14px;align-items:center;background:rgba(27,28,46,.72);border:1px solid rgba(255,255,255,.06);border-left:4px solid var(--c);border-radius:14px;padding:14px}
.pab-letra{width:56px;height:56px;flex:none;border-radius:14px;background:var(--c);color:#fff;font-family:'Space Grotesk',sans-serif;font-size:34px;font-weight:700;display:flex;align-items:center;justify-content:center}
.pab-n{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;line-height:1}
.pab-n small{font-size:13px;color:#a7adc2;font-weight:500}
.pab-barrios{font-size:12px;color:#a7adc2;margin-top:5px;line-height:1.35}
.pab-escanear{min-height:56px;border-radius:14px;border:0;background:#2ee6b6;color:#062a20;font:inherit;font-size:17px;font-weight:700;cursor:pointer;touch-action:manipulation}
.pab-regla{font-size:14px;line-height:1.55;color:#c9cbe0}
.pab-meta{font-size:12px;color:#71768e;margin-top:10px}
.pab-lhead{display:flex;gap:10px;align-items:baseline;margin-bottom:8px;font-size:14px}
.pab-lhead span{color:#a7adc2;font-size:13px;flex:1}
.pab-fila{display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,.05);font-size:14px}
.pab-chip{width:26px;height:26px;flex:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;background:rgba(255,255,255,.1);color:#f4f5fa}
.pab-chip.t-A{background:#0a9b5b;color:#fff}.pab-chip.t-B{background:#e8650a;color:#fff}
.pab-fdir{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9cbe0}
@media (max-width:600px){.pab-carros{gap:8px}.pab-carro{padding:10px;gap:10px}.pab-letra{width:44px;height:44px;font-size:26px}.pab-n{font-size:24px}}
.pab-esc{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:90;overflow:hidden;background:#000;color:#fff;font-family:-apple-system,'Segoe UI',sans-serif}
.pab-esc-abriendo{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.55);font-size:15px}
.pab-esc-video{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;background:#000;transition:opacity .18s}
.pab-esc-marco{position:absolute;left:50%;top:45%;width:min(70vw,290px);aspect-ratio:1/1;transform:translate(-50%,-50%);pointer-events:none}
.pab-esc-marco i{position:absolute;width:38px;height:38px;border:0 solid rgba(255,255,255,.75)}
.pab-esc-marco i:nth-child(1){left:0;top:0;border-left-width:4px;border-top-width:4px;border-top-left-radius:16px}
.pab-esc-marco i:nth-child(2){right:0;top:0;border-right-width:4px;border-top-width:4px;border-top-right-radius:16px}
.pab-esc-marco i:nth-child(3){left:0;bottom:0;border-left-width:4px;border-bottom-width:4px;border-bottom-left-radius:16px}
.pab-esc-marco i:nth-child(4){right:0;bottom:0;border-right-width:4px;border-bottom-width:4px;border-bottom-right-radius:16px}
.pab-esc-arriba{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top) + 12px) 18px 14px;background:rgba(8,8,15,.72);z-index:2}
.pab-esc-cont{display:flex;gap:18px;font-size:15px;font-weight:600}
.pab-esc-cont b{font-family:'Space Grotesk',sans-serif;font-size:28px;margin-left:4px}
.pab-esc-cerrar{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:14px;font-weight:600;cursor:pointer;touch-action:manipulation}
.pab-esc-aviso{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom) + 28px);transform:translateX(-50%);background:rgba(10,12,24,.92);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 16px;font-size:15px;max-width:calc(100vw - 32px);text-align:center}
.pab-res{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;cursor:pointer;touch-action:manipulation;animation:pab-in .12s ease-out}
.pab-res-letra{font-family:'Space Grotesk',sans-serif;font-size:min(62vw,340px);font-weight:700;line-height:.85;color:#fff}
.pab-res-nom{font-size:22px;font-weight:700}
.pab-res-dir{font-size:19px;font-weight:500;max-width:520px;overflow-wrap:anywhere}
.pab-res-cli{font-size:15px;opacity:.85}
.pab-res-toca{position:absolute;bottom:calc(env(safe-area-inset-bottom) + 22px);font-size:13px;opacity:.75}
@keyframes pab-in{from{opacity:.4;transform:scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pab-res{animation:none}}
.pab-hoja{position:absolute;left:0;right:0;bottom:0;z-index:3;background:#151626;border-top-left-radius:28px;border-top-right-radius:28px;padding:22px 18px calc(env(safe-area-inset-bottom) + 18px);display:flex;flex-direction:column;gap:10px}
.pab-hoja>*{width:100%;max-width:520px;margin:0 auto;box-sizing:border-box}
.pab-hoja-tit{font-family:'Space Grotesk',sans-serif;font-size:21px;font-weight:600;color:#F5C044}
.pab-hoja-txt{font-size:14px;color:#b9bdd0;line-height:1.45}
.pab-hoja-dir{font-size:18px;font-weight:600;overflow-wrap:anywhere}
.pab-hoja-cod{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#8a8ca6}
.pab-hoja-bot{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}
.pab-hoja-bot button{min-height:64px;border:0;border-radius:18px;color:#fff;font:inherit;font-size:17px;font-weight:700;cursor:pointer;touch-action:manipulation}
.pab-hoja-sig{min-height:48px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f5fa;font:inherit;font-size:15px;font-weight:600;cursor:pointer}
`;
