import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { getSession } from "./auth";
import { FX, FX_FONT, rgba } from "./theme";
import { prepararAudio, beep, camaraViva, obtenerCamara, apagarCamara, soltarCamara } from "./camaraQR";
import * as db from "./contingenciaDB";
import {
  suscribir, sincronizar, programar, arrancarReintentos, contarPendientes,
  cargarRemotos, remotosGuardados, listasGuardadas, actualizarListas,
} from "./contingenciaSync";
import {
  LISTA_MODOS, MODOS, modoPidePersona, leerContingencia, evaluarLectura, nuevoEscaneo, codigosDeTanda,
  mapaVendedores, clienteVisible, marcarBorrado, marcarMostrado, desdeRemoto, fusionar, agruparTandas,
  primerPendiente, matrizQR, OPCIONES_QR, plural, etiquetaDia, horaAR, diaAR, uuid, clasificarError,
} from "./contingenciaShared";

// Modo contingencia — cuando LightData se cae en plena operación (pedido de Alejo, 16/11/2026: se cayó en
// plena colecta con ~4.000 envíos y se perdió la trazabilidad).
//   A. Escanear: colecta (chofer), ingreso a planta, salida (cadete). Todo queda primero en el dispositivo
//      (IndexedDB) y se sube a Supabase en segundo plano, con reintentos. Funciona sin red.
//   B. Pasar a LightData: muestra los QR guardados, uno por vez y en grande, para escanearlos con la app
//      oficial de LightData desde la pantalla. La app NO escribe en LightData.
//      "Mostrado" = se mostró en pantalla. El sistema no sabe si LightData lo registró.
// Datos: contingencia_escaneos (migración 20261116180000_contingencia_escaneos.sql) + ml_vendedores.

const LS_TANDA = "fx_cont_tanda";
const DIAS_PASAR = 7;
const yo = () => { const s = getSession(); return (s && (s.nombre || s.email)) || null; };
const leerTanda = () => { try { return JSON.parse(localStorage.getItem(LS_TANDA)); } catch { return null; } };
const guardarTanda = (t) => { try { localStorage.setItem(LS_TANDA, JSON.stringify(t)); } catch {} };
const hoyAR = () => diaAR(new Date().toISOString());

function useSync() {
  const [s, setS] = useState({ pendientes: 0, subiendo: false, error: null });
  useEffect(() => suscribir(setS), []);
  return s;
}
function useEnLinea() {
  const [on, setOn] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener("online", a); window.addEventListener("offline", b);
    return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); };
  }, []);
  return on;
}

// Indicador de subida: el mismo en la pantalla y en el escáner
function EstadoSubida({ sync, enLinea, oscuro }) {
  const { pendientes, subiendo, error } = sync;
  let txt, tono;
  const n = `${pendientes} sin subir`;
  if (!pendientes) { txt = "Todo subido"; tono = "ok"; }
  else if (error === "tabla") { txt = `${n} · falta la tabla`; tono = "am"; }
  else if (error === "sesion") { txt = `${n} · iniciá sesión`; tono = "am"; }
  else if (!enLinea) { txt = `${n} · sin conexión`; tono = "am"; }
  else if (subiendo) { txt = `Subiendo ${pendientes}…`; tono = "nt"; }
  else { txt = n; tono = "am"; }
  return <span className={`ct-chip ${tono}${oscuro ? " osc" : ""}`}><i />{txt}</span>;
}

// =====================================================================================
export default function Contingencia() {
  const [tab, setTab] = useState("escanear");
  const [regs, setRegs] = useState(null);          // registros del dispositivo
  const [vendFilas, setVendFilas] = useState([]);
  const [cadetes, setCadetes] = useState([]);
  const [listasAt, setListasAt] = useState(null);
  const [almacen, setAlmacen] = useState(null);
  const [modo, setModo] = useState(() => (leerTanda() || {}).modo || null);
  const [persona, setPersona] = useState(() => (leerTanda() || {}).persona || "");
  const [tanda, setTanda] = useState(() => leerTanda());
  const [escaner, setEscaner] = useState(false);
  const [aviso, setAviso] = useState(null);
  const sync = useSync();
  const enLinea = useEnLinea();

  const recargar = useCallback(async () => {
    const r = await db.todos().catch(() => []);
    setRegs(r);
    contarPendientes().catch(() => {});
    return r;
  }, []);

  useEffect(() => {
    let vivo = true;
    db.tipoAlmacen().then((t) => vivo && setAlmacen(t));
    db.pedirPersistencia();
    recargar();
    // Primero lo guardado (anda sin red), después lo fresco si se puede bajar
    listasGuardadas().then((l) => {
      if (!vivo) return;
      setVendFilas(l.vendedores); setCadetes(l.cadetes); setListasAt(l.vendAt || l.cadAt || null);
      actualizarListas().then((n) => {
        if (!vivo) return;
        if (n.vendedores) setVendFilas(n.vendedores);
        if (n.cadetes) setCadetes(n.cadetes);
        if (n.vendedores || n.cadetes) setListasAt(Date.now());
      });
    });
    // Los reintentos siguen aunque se salga de la sección (mientras la app esté abierta)
    arrancarReintentos();
    return () => { vivo = false; };
  }, [recargar]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 2800); return () => clearTimeout(t); }, [aviso]);

  const vend = useMemo(() => mapaVendedores(vendFilas), [vendFilas]);
  const pide = modoPidePersona(modo);
  const listo = modo && (!pide || persona.trim());
  const deTanda = useMemo(() => (tanda && regs ? regs.filter((r) => r.tanda === tanda.id && !r.borrado_at).length : 0), [regs, tanda]);
  const sigueTanda = !!(tanda && tanda.modo === modo && (tanda.persona || "") === (pide ? persona.trim() : "") && tanda.dia === hoyAR());

  function empezar(nueva) {
    if (!listo) return;
    prepararAudio();
    let t = tanda;
    if (nueva || !sigueTanda) {
      t = { id: uuid(), modo, persona: pide ? persona.trim() : null, dia: hoyAR(), inicio: new Date().toISOString() };
      setTanda(t); guardarTanda(t);
    }
    setEscaner(true);
  }

  const sinSubir = sync.pendientes;
  return (
    <div className="ct">
      <style>{CSS}</style>

      <div className="ct-card ct-top">
        <div style={{ minWidth: 0 }}>
          <div className="ct-tit">Modo contingencia</div>
          <div className="ct-sub">Para cuando LightData no anda: escaneá igual, queda guardado en el celu y se sube solo. Cuando LightData vuelve, lo pasás re-escaneando los QR desde esta pantalla.</div>
        </div>
        <div className="ct-top-der">
          <EstadoSubida sync={sync} enLinea={enLinea} />
          {sinSubir > 0 && enLinea && <button className="ct-btn" disabled={sync.subiendo} onClick={() => sincronizar().then(recargar)}>Subir ahora</button>}
        </div>
      </div>

      {sync.error === "tabla" && sinSubir > 0 && (
        <div className="ct-card ct-alerta"><b>Falta crear la tabla en Supabase</b> (migración <code>20261116180000_contingencia_escaneos.sql</code>). Los escaneos quedan guardados en este dispositivo y se suben solos cuando esté.</div>
      )}
      {sync.error === "sesion" && sinSubir > 0 && (
        <div className="ct-card ct-alerta">No hay sesión iniciada: los escaneos quedan en este dispositivo. Iniciá sesión desde Inicio para subirlos.</div>
      )}
      {almacen === "ls" && (
        <div className="ct-card ct-alerta">Este navegador no deja usar el almacenamiento completo: se guarda en un espacio más chico. Si podés, usá Safari o Chrome normal (no privado).</div>
      )}

      <div className="ct-seg ct-tabs">
        <button className={tab === "escanear" ? "on" : ""} onClick={() => setTab("escanear")}>Escanear</button>
        <button className={tab === "pasar" ? "on" : ""} onClick={() => setTab("pasar")}>Pasar a LightData</button>
      </div>

      {tab === "escanear" ? (
        <div className="ct-card">
          <div className="ct-paso">1 · ¿Qué estás escaneando?</div>
          <div className="ct-modos">
            {LISTA_MODOS.map((m) => (
              <button key={m.id} className={"ct-modo" + (modo === m.id ? " on" : "")} onClick={() => setModo(m.id)}>
                <b>{m.label}</b>
                <small>{m.id === "colecta" ? "Retiro en el cliente" : m.id === "ingreso" ? "Llega al depósito" : "Sale con el cadete"}</small>
              </button>
            ))}
          </div>

          {pide && (
            <>
              <div className="ct-paso">2 · {MODOS[modo].pide}</div>
              <SelectorPersona lista={cadetes} valor={persona} onElegir={setPersona} sinLista={!cadetes.length} />
            </>
          )}

          {modo && (
            <div className="ct-empezar">
              <button className="ct-btn ct-pri ct-grande" disabled={!listo} onClick={() => empezar(false)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></svg>
                {sigueTanda && deTanda ? `Seguir escaneando · ${deTanda}` : "Escanear"}
              </button>
              {sigueTanda && deTanda > 0 && (
                <button className="ct-link" onClick={() => empezar(true)}>Empezar una tanda nueva</button>
              )}
            </div>
          )}

          <ResumenLocal regs={regs} />
          {listasAt && <div className="ct-nota">Listas de choferes y clientes guardadas en este dispositivo · {etiquetaDia(diaAR(new Date(listasAt).toISOString()))} {horaAR(new Date(listasAt).toISOString())}</div>}
        </div>
      ) : (
        <Pasar regs={regs} vend={vend} recargar={recargar} enLinea={enLinea} />
      )}

      {aviso && <div className="ct-toast">{aviso}</div>}
      {escaner && tanda && (
        <Escaner tanda={tanda} vend={vend} regsIniciales={regs || []} sync={sync} enLinea={enLinea}
          onCerrar={(n) => { setEscaner(false); recargar(); if (n) setAviso(`${plural(n, "escaneo guardado", "escaneos guardados")} en esta tanda`); }} />
      )}
    </div>
  );
}

// Buscador de chofer / cadete con la lista guardada. Si no está, se puede usar el nombre tipeado.
function SelectorPersona({ lista, valor, onElegir, sinLista }) {
  const [q, setQ] = useState("");
  if (valor) {
    return (
      <div className="ct-elegido">
        <b>{valor}</b>
        <button className="ct-btn" onClick={() => { onElegir(""); setQ(""); }}>Cambiar</button>
      </div>
    );
  }
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nq = norm(q.trim());
  const filtrados = nq ? lista.filter((n) => norm(n).includes(nq)) : lista;
  const exacto = lista.some((n) => norm(n) === nq);
  return (
    <div>
      <input className="ct-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscá o escribí el nombre" autoComplete="off" autoCorrect="off" spellCheck={false} />
      {sinLista && <div className="ct-nota">No hay lista guardada todavía (hace falta red una vez). Escribí el nombre.</div>}
      <div className="ct-personas">
        {q.trim() && !exacto && <button className="ct-persona nuevo" onClick={() => onElegir(q.trim())}>Usar “{q.trim()}”</button>}
        {filtrados.slice(0, 40).map((n) => <button key={n} className="ct-persona" onClick={() => onElegir(n)}>{n}</button>)}
      </div>
    </div>
  );
}

// Lo escaneado en este dispositivo, por tanda (para saber qué hay guardado acá)
function ResumenLocal({ regs }) {
  const tandas = useMemo(() => {
    const m = new Map();
    for (const r of regs || []) {
      if (r.borrado_at) continue;
      let t = m.get(r.tanda);
      if (!t) { t = { id: r.tanda, modo: r.modo, persona: r.persona, dia: diaAR(r.escaneado_at), n: 0, sinSubir: 0, ultimo: r.escaneado_at }; m.set(r.tanda, t); }
      t.n++; if (!r.s_alta) t.sinSubir++;
      if (r.escaneado_at > t.ultimo) t.ultimo = r.escaneado_at;
    }
    return [...m.values()].sort((a, b) => (a.ultimo < b.ultimo ? 1 : -1)).slice(0, 8);
  }, [regs]);
  if (!tandas.length) return null;
  return (
    <div className="ct-local">
      <div className="ct-paso">En este dispositivo</div>
      {tandas.map((t) => (
        <div key={t.id} className="ct-fila">
          <span className="ct-badge">{MODOS[t.modo] ? MODOS[t.modo].label : t.modo}</span>
          <span className="ct-fila-txt">{t.persona || "—"}<small>{etiquetaDia(t.dia)} · {horaAR(t.ultimo)}</small></span>
          <b>{t.n}</b>
          {t.sinSubir > 0 ? <span className="ct-am">{t.sinSubir} sin subir</span> : <span className="ct-ok">Subido</span>}
        </div>
      ))}
    </div>
  );
}

// =====================================================================================
// Escáner en ráfaga: un QR tras otro sin tocar nada. Cada lectura se guarda en el dispositivo y recién
// ahí suena (el ✓ significa "quedó guardado acá"); la subida va por detrás.
function Escaner({ tanda, vend, regsIniciales, sync, enLinea, onCerrar }) {
  const video = useRef();
  const codigos = useRef(codigosDeTanda(regsIniciales, tanda.id));
  const ultimo = useRef({ c: "", at: 0 });
  const vendRef = useRef(vend); vendRef.current = vend;
  const [lista, setLista] = useState(() => regsIniciales.filter((r) => r.tanda === tanda.id && !r.borrado_at)
    .sort((a, b) => (a.escaneado_at < b.escaneado_at ? 1 : -1)));
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);
  const [armado, setArmado] = useState(null);
  const [nuevos, setNuevos] = useState(0);
  const modo = MODOS[tanda.modo];

  const procesar = useCallback((texto) => {
    const l = leerContingencia(texto);
    if (!l) return;
    const ahora = Date.now();
    const ev = evaluarLectura({ codigos: codigos.current, ultimo: ultimo.current }, l.codigo, ahora);
    // Mientras la etiqueta sigue en cuadro se renueva la marca: el aviso de duplicado sale solo si el
    // mismo código vuelve a aparecer después de haber salido del cuadro
    ultimo.current = { c: l.codigo, at: ahora };
    if (ev === "ignorar") return;
    if (ev === "duplicado") { beep(false); setFlash({ tipo: "dup", txt: `Ya estaba en esta tanda · ${l.codigo}`, at: ahora }); return; }
    const cliente = l.sender_id ? vendRef.current.get(String(l.sender_id)) || null : null;
    const r = nuevoEscaneo({ lectura: l, modo: tanda.modo, persona: tanda.persona, cliente, por: yo(), tanda: tanda.id, ahora });
    codigos.current.add(l.codigo);
    db.guardar(r).then(() => {
      beep(true);
      setLista((xs) => [r, ...xs]);
      setNuevos((n) => n + 1);
      setFlash({ tipo: "ok", txt: tanda.modo === "colecta" ? clienteVisible(r, vendRef.current) : `✓ ${l.codigo}`, at: ahora });
      programar();
    }).catch(() => {
      codigos.current.delete(l.codigo);
      ultimo.current = { c: "", at: 0 };
      beep(false);
      setFlash({ tipo: "err", txt: "No se pudo guardar en el dispositivo. Volvé a escanearlo.", at: ahora });
    });
  }, [tanda]);

  async function quitar(r) {
    if (armado !== r.id) { setArmado(r.id); return; }
    setArmado(null);
    try {
      await db.modificar(r.id, (x) => marcarBorrado(x));
      codigos.current.delete(r.codigo);
      if (ultimo.current.c === r.codigo) ultimo.current = { c: "", at: 0 };
      setLista((xs) => xs.filter((x) => x.id !== r.id));
      setFlash({ tipo: "ok", txt: `Quitado · ${r.codigo}`, at: Date.now() });
      programar();
    } catch { setFlash({ tipo: "err", txt: "No se pudo quitar. Probá de nuevo.", at: Date.now() }); }
  }

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), flash.tipo === "ok" ? 1400 : 2600); return () => clearTimeout(t); }, [flash]);
  useEffect(() => { if (armado == null) return; const t = setTimeout(() => setArmado(null), 3000); return () => clearTimeout(t); }, [armado]);

  // Cámara + lectura cada ~200 ms. Misma mecánica que Doble bulto (BarcodeDetector o jsQR, cámara
  // compartida de camaraQR.js, video invisible hasta que el iPhone se acomoda, reconexión al volver).
  useEffect(() => {
    let stream, timer, vivo = true;
    const el = video.current;
    const cv = document.createElement("canvas");
    const det = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    let conectando = false, listo = false;
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
      } catch { /* el intento siguiente lo vuelve a probar */ } finally { conectando = false; }
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
        if (ocupado || !v || !v.videoWidth) return;
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
      }, 200);
    })();
    return () => { vivo = false; clearInterval(timer); clearInterval(vigia); document.removeEventListener("visibilitychange", alVolver); if (el) el.srcObject = null; soltarCamara(); };
  }, [procesar]);

  // Pantalla fija mientras se escanea (sin pellizcar para hacer zoom), igual que Doble bulto
  useEffect(() => {
    const no = (e) => e.preventDefault();
    const pinch = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("gesturestart", no);
    document.addEventListener("gesturechange", no);
    document.addEventListener("touchmove", pinch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", no);
      document.removeEventListener("gesturechange", no);
      document.removeEventListener("touchmove", pinch);
    };
  }, []);

  const titulo = `${modo.label}${tanda.persona ? ` · ${tanda.persona}` : ""}`;
  return createPortal(
    <div className="ct-esc" onPointerDown={prepararAudio}>
      <style>{CSS}</style>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.55)", fontSize: 15 }}>Abriendo cámara…</div>
      <video ref={video} playsInline muted autoPlay disablePictureInPicture
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000", opacity: 0, transition: "opacity .18s" }} />
      <div className={"ct-marco" + (flash ? ` ${flash.tipo}` : "")}><i /><i /><i /><i /></div>

      <div className="ct-esc-arriba">
        <div className="ct-esc-total">
          <b>{lista.length}</b>
          <span className="ct-esc-tit">{titulo}</span>
        </div>
        <button className="ct-esc-cerrar" onClick={() => onCerrar(nuevos)}>Cerrar</button>
      </div>
      <div className="ct-esc-estado"><EstadoSubida sync={sync} enLinea={enLinea} oscuro /></div>

      {flash && <div key={flash.at} className={"ct-esc-flash " + flash.tipo}>{flash.txt}</div>}
      {error && !flash && <div className="ct-esc-flash err">{error}</div>}

      <div className="ct-esc-abajo">
        {lista.length === 0 ? (
          <div className="ct-esc-vacio">Apuntá al QR de la etiqueta. Se guarda solo y sigue con el próximo.</div>
        ) : (
          <div className="ct-esc-lista">
            {lista.slice(0, 6).map((r) => (
              <div key={r.id} className="ct-esc-fila">
                <span className={"ct-esc-ico" + (r.s_alta ? "" : " pend")}>✓</span>
                <span className="ct-esc-fila-txt">
                  <span className="ct-mono">{r.codigo}</span>
                  {tanda.modo === "colecta" && <small>{clienteVisible(r, vend)}</small>}
                </span>
                <button className={"ct-quitar" + (armado === r.id ? " on" : "")} onClick={() => quitar(r)}>{armado === r.id ? "¿Quitar?" : "Quitar"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>, document.body);
}

// =====================================================================================
// B. Pasar a LightData: tandas agrupadas → visor de QR uno por vez.
function Pasar({ regs, vend, recargar, enLinea }) {
  const [remotos, setRemotos] = useState(null);
  const [remAt, setRemAt] = useState(null);
  const [err, setErr] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [completos, setCompletos] = useState(false);
  const [abierto, setAbierto] = useState(null); // key del grupo

  const traer = useCallback(async () => {
    setCargando(true);
    const desde = new Date(Date.now() - DIAS_PASAR * 864e5).toISOString();
    try { const f = await cargarRemotos(desde); setRemotos(f); setRemAt(Date.now()); setErr(null); }
    catch (e) {
      const c = clasificarError(e);
      setErr(c === "tabla" ? "tabla" : c === "sesion" ? "sesion" : "red");
      const g = await remotosGuardados().catch(() => null);
      if (g && g.filas) { setRemotos((r) => r || g.filas); setRemAt((a) => a || g.at); }
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { traer(); }, [traer]);

  const todos = useMemo(() => fusionar(remotos || [], regs || []), [remotos, regs]);
  const grupos = useMemo(() => agruparTandas(todos, vend), [todos, vend]);
  const visibles = completos ? grupos : grupos.filter((g) => !g.completo);
  const grupo = abierto ? grupos.find((g) => g.key === abierto) : null;

  return (
    <div className="ct-card">
      <div className="ct-explica">
        Abrí un grupo y escaneá cada QR de la pantalla con la app de LightData. <b>“Mostrado”</b> quiere decir que el QR se mostró acá: esta app no puede saber si LightData lo registró. Revisalo en LightData al terminar.
      </div>
      <div className="ct-barra">
        <button className={"ct-btn" + (completos ? " on" : "")} onClick={() => setCompletos(!completos)}>{completos ? "Ocultar completos" : "Ver también completos"}</button>
        <div className="ct-esp" />
        <button className="ct-btn" disabled={cargando} onClick={() => { traer(); recargar(); }}>{cargando ? "Actualizando…" : "Actualizar"}</button>
      </div>
      {err === "tabla" && <div className="ct-nota ct-am">Falta la tabla en Supabase: se ve solo lo escaneado en este dispositivo.</div>}
      {err === "sesion" && <div className="ct-nota ct-am">Iniciá sesión desde Inicio para ver lo escaneado en los otros dispositivos. Se ve solo lo de este.</div>}
      {err === "red" && <div className="ct-nota ct-am">{enLinea ? "No se pudo traer lo de los otros dispositivos." : "Sin conexión."} {remAt ? `Se muestra lo bajado a las ${horaAR(new Date(remAt).toISOString())} y lo de este dispositivo.` : "Se ve solo lo de este dispositivo."}</div>}

      {regs === null || (remotos === null && cargando) ? <div className="ct-vacio">Cargando…</div>
        : !visibles.length ? <div className="ct-vacio">{grupos.length ? "Todos los grupos ya se mostraron completos." : `No hay escaneos de contingencia en los últimos ${DIAS_PASAR} días.`}</div>
        : (
          <div className="ct-grupos">
            {visibles.map((g, i) => {
              const nuevoDia = i === 0 || visibles[i - 1].dia !== g.dia;
              const pct = g.total ? Math.round((g.mostrados / g.total) * 100) : 0;
              return (
                <React.Fragment key={g.key}>
                  {nuevoDia && <div className="ct-sep">{etiquetaDia(g.dia)}</div>}
                  <button className={"ct-grupo" + (g.completo ? " ok" : "")} onClick={() => setAbierto(g.key)}>
                    <span className="ct-badge">{MODOS[g.modo] ? MODOS[g.modo].label : g.modo}</span>
                    <span className="ct-grupo-txt">
                      <b>{g.modo === "ingreso" ? "Ingreso a planta" : g.persona}</b>
                      {g.cliente && <small>{g.cliente}</small>}
                    </span>
                    <span className="ct-grupo-num">
                      <b>{g.mostrados}<small>/{g.total}</small></b>
                      <small>mostrados</small>
                    </span>
                    <span className="ct-barrita"><i style={{ width: `${pct}%` }} /></span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}

      {grupo && <Visor grupo={grupo} onCerrar={() => { setAbierto(null); recargar(); }} onMarcado={recargar} />}
    </div>
  );
}

// Dibuja el QR desde el texto crudo, módulo por módulo, sin suavizado (mismo camino que el test)
function QR({ texto, lado }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const m = matrizQR(texto);
    const mods = m.size + OPCIONES_QR.margin * 2;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.max(1, Math.floor((lado * dpr) / mods));
    c.width = c.height = mods * px;
    c.style.width = c.style.height = `${(mods * px) / dpr}px`;
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.fillStyle = OPCIONES_QR.color.light; cx.fillRect(0, 0, c.width, c.height);
    cx.fillStyle = OPCIONES_QR.color.dark;
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
      if (m.data[y * m.size + x]) cx.fillRect((x + OPCIONES_QR.margin) * px, (y + OPCIONES_QR.margin) * px, px, px);
    }
  }, [texto, lado]);
  return <canvas ref={ref} className="ct-qr" aria-label="Código QR" />;
}

const INTERVALOS = [0, 1000, 1500, 2000, 3000];
function Visor({ grupo, onCerrar, onMarcado }) {
  const items = grupo.items;
  const [i, setI] = useState(() => primerPendiente(items));
  const [mostrados, setMostrados] = useState(() => new Set(items.filter((x) => x.reesc_at).map((x) => x.id)));
  const [intervalo, setIntervalo] = useState(() => { const v = Number(localStorage.getItem("fx_cont_intervalo")); return INTERVALOS.includes(v) ? v : 0; });
  const [pausa, setPausa] = useState(true);
  const [fin, setFin] = useState(false);
  const [lado, setLado] = useState(300);

  useEffect(() => {
    const medir = () => setLado(Math.floor(Math.min(window.innerWidth * 0.9, (window.innerHeight - 250) * 0.95, 560)));
    medir(); window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  // Que la pantalla no se apague mientras se pasa (donde el navegador lo permite)
  useEffect(() => {
    let lock = null, vivo = true;
    const pedir = () => { try { navigator.wakeLock && navigator.wakeLock.request("screen").then((l) => { if (vivo) lock = l; else l.release(); }).catch(() => {}); } catch {} };
    pedir();
    const alVolver = () => { if (!document.hidden) pedir(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; document.removeEventListener("visibilitychange", alVolver); try { lock && lock.release(); } catch {} };
  }, []);

  const marcar = useCallback((item) => {
    if (!item || mostrados.has(item.id)) return;
    setMostrados((s) => new Set(s).add(item.id));
    // Sobre la versión guardada en el dispositivo (o, si vino de otro dispositivo, desde la fila de Supabase)
    db.modificar(item.id, (x) => marcarMostrado(x, yo()), desdeRemoto(item))
      .then(() => { programar(2500); onMarcado && onMarcado(); }).catch(() => {});
  }, [mostrados, onMarcado]);

  const siguiente = useCallback(() => {
    marcar(items[i]);
    if (i + 1 >= items.length) { setFin(true); setPausa(true); return; }
    setI(i + 1);
  }, [i, items, marcar]);
  const anterior = () => { setFin(false); setI((x) => Math.max(0, x - 1)); };

  // Avance automático
  useEffect(() => {
    if (!intervalo || pausa || fin) return;
    const t = setTimeout(siguiente, intervalo);
    return () => clearTimeout(t);
  }, [intervalo, pausa, fin, siguiente]);

  // Teclado (monitor): → / espacio = siguiente · ← = anterior · Esc = cerrar
  useEffect(() => {
    const k = (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); if (!fin) siguiente(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); anterior(); }
      else if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const elegirIntervalo = (v) => { setIntervalo(v); try { localStorage.setItem("fx_cont_intervalo", String(v)); } catch {} setPausa(!v); };
  const item = items[i];
  const nMostrados = items.filter((x) => mostrados.has(x.id)).length;
  const titulo = [MODOS[grupo.modo] ? MODOS[grupo.modo].label : grupo.modo, grupo.persona, grupo.cliente].filter(Boolean).join(" · ");

  return createPortal(
    <div className="ct-visor">
      <style>{CSS}</style>
      <div className="ct-visor-arriba">
        <div style={{ minWidth: 0 }}>
          <div className="ct-visor-tit">{titulo}</div>
          <div className="ct-visor-sub">{etiquetaDia(grupo.dia)} · {nMostrados} de {items.length} mostrados</div>
        </div>
        <button className="ct-visor-cerrar" onClick={onCerrar}>Cerrar</button>
      </div>

      {fin ? (
        <div className="ct-visor-fin">
          <b>Se mostraron los {items.length}.</b>
          <span>Revisá en LightData que hayan entrado todos: esta app no lo puede confirmar.</span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="ct-vbtn" onClick={() => { setFin(false); setI(0); }}>Ver de nuevo desde el primero</button>
            <button className="ct-vbtn pri" onClick={onCerrar}>Listo</button>
          </div>
        </div>
      ) : item ? (
        <>
          <button className="ct-visor-qr" onClick={siguiente} aria-label="Siguiente">
            <QR texto={item.qr} lado={lado} />
          </button>
          <div className="ct-visor-cod">
            <span className="ct-mono">{item.codigo}</span>
            <small>{i + 1} / {items.length}{mostrados.has(item.id) ? " · ya mostrado" : ""} · {horaAR(item.escaneado_at)}</small>
          </div>
        </>
      ) : <div className="ct-visor-fin"><b>Este grupo está vacío.</b></div>}

      {!fin && item && (
        <div className="ct-visor-abajo">
          <div className="ct-visor-nav">
            <button className="ct-vbtn" disabled={i === 0} onClick={anterior}>‹ Anterior</button>
            <button className="ct-vbtn pri grande" onClick={siguiente}>{i + 1 >= items.length ? "Terminar" : "Siguiente ›"}</button>
          </div>
          <div className="ct-visor-auto">
            <span>Pasar solo</span>
            <div className="ct-vseg">
              {INTERVALOS.map((v) => <button key={v} className={intervalo === v ? "on" : ""} onClick={() => elegirIntervalo(v)}>{v ? `${String(v / 1000).replace(".", ",")} s` : "No"}</button>)}
            </div>
            {intervalo > 0 && <button className={"ct-vbtn" + (pausa ? " pri" : "")} onClick={() => setPausa(!pausa)}>{pausa ? "Seguir" : "Pausa"}</button>}
          </div>
        </div>
      )}
    </div>, document.body);
}

const C = FX.color;
const CSS = `
.ct{display:flex;flex-direction:column;gap:14px;color:${C.ink}}
.ct-card{background:${C.glass};border:1px solid ${C.line};border-radius:${FX.radius.lg}px;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);padding:16px}
.ct-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ct-top-der{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ct-tit{font-family:${FX_FONT.display};font-size:19px;font-weight:600;letter-spacing:-.3px}
.ct-sub{font-size:${FX.size.md}px;color:${C.ink2};margin-top:4px;line-height:1.45;max-width:640px}
.ct-alerta{border-color:${rgba(C.ambarRgb, 0.35)};font-size:14px;line-height:1.5}
.ct-alerta code{font-size:12px;color:${C.ambar}}
.ct-chip{display:inline-flex;align-items:center;gap:8px;font-size:${FX.size.md}px;font-weight:600;padding:7px 12px;border-radius:${FX.radius.pill}px;border:1px solid ${C.border};background:rgba(255,255,255,.04);white-space:nowrap}
.ct-chip i{width:8px;height:8px;border-radius:50%;background:${C.ink3}}
.ct-chip.ok{color:${C.teal};border-color:${rgba(C.tealRgb, 0.3)}}.ct-chip.ok i{background:${C.teal}}
.ct-chip.am{color:${C.ambar};border-color:${rgba(C.ambarRgb, 0.4)}}.ct-chip.am i{background:${C.ambar}}
.ct-chip.nt{color:${C.ink2}}
.ct-chip.osc{background:rgba(8,8,15,.72)}
.ct-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:${C.ink};font:inherit;font-size:${FX.size.md}px;padding:8px 13px;min-height:40px;border-radius:${FX.radius.md}px;cursor:pointer;white-space:nowrap;touch-action:manipulation}
.ct-btn:disabled{opacity:.45;cursor:default}
.ct-btn.on{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.16)}
.ct-pri{background:${rgba(C.tealRgb, 0.12)};border-color:${rgba(C.tealRgb, 0.32)};color:${C.teal}}
.ct-grande{font-size:16px;font-weight:600;padding:12px 20px;min-height:54px;border-radius:${FX.radius.lg}px}
.ct-link{background:none;border:0;color:${C.ink2};font:inherit;font-size:14px;text-decoration:underline;padding:10px 4px;cursor:pointer;min-height:44px}
.ct-seg{display:grid;grid-template-columns:1fr 1fr;background:rgba(255,255,255,.04);border:1px solid ${C.line};border-radius:${FX.radius.lg}px;padding:4px;gap:4px}
.ct-seg button{background:none;border:0;color:${C.ink2};font:inherit;font-size:15px;font-weight:600;padding:12px 8px;border-radius:${FX.radius.md}px;cursor:pointer;min-height:48px;touch-action:manipulation}
.ct-seg button.on{background:rgba(255,255,255,.09);color:${C.ink}}
.ct-paso{font-size:${FX.size.sm}px;color:${C.ink3};text-transform:uppercase;letter-spacing:.06em;margin:4px 2px 10px;font-weight:600}
.ct-modos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:18px}
.ct-modo{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;min-height:76px;padding:14px;border-radius:${FX.radius.xl}px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:${C.ink};font:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.ct-modo b{font-family:${FX_FONT.display};font-size:17px;font-weight:600}
.ct-modo small{font-size:${FX.size.md}px;color:${C.ink2}}
.ct-modo.on{border-color:${C.teal};background:${rgba(C.tealRgb, 0.1)}}
.ct-modo.on b{color:${C.teal}}
.ct-input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);color:${C.ink};font:inherit;font-size:16px;padding:12px 14px;border-radius:${FX.radius.md}px;outline:none}
.ct-input:focus{border-color:${rgba(C.tealRgb, 0.5)}}
.ct-personas{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 18px;max-height:260px;overflow:auto}
.ct-persona{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);color:${C.ink};font:inherit;font-size:15px;padding:10px 14px;min-height:44px;border-radius:${FX.radius.pill}px;cursor:pointer;touch-action:manipulation}
.ct-persona.nuevo{border-color:${rgba(C.tealRgb, 0.4)};color:${C.teal}}
.ct-elegido{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:${FX.radius.lg}px;border:1px solid ${rgba(C.tealRgb, 0.35)};background:${rgba(C.tealRgb, 0.07)};margin-bottom:18px}
.ct-elegido b{font-family:${FX_FONT.display};font-size:18px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-empezar{display:flex;flex-direction:column;align-items:stretch;gap:2px;margin-bottom:6px}
.ct-empezar .ct-grande{width:100%}
.ct-nota{font-size:${FX.size.sm}px;color:${C.ink3};margin-top:10px;line-height:1.45}
.ct-am{color:${C.ambar}}.ct-ok{color:${C.teal}}
.ct-local{margin-top:20px;border-top:1px solid ${C.line};padding-top:14px}
.ct-fila{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:9px 2px;font-size:14px;border-bottom:1px solid ${C.line}}
.ct-fila b{font-family:${FX_FONT.display};font-size:17px}
.ct-fila>span:last-child{font-size:${FX.size.sm}px;white-space:nowrap}
.ct-fila-txt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-fila-txt small{display:block;font-size:${FX.size.sm}px;color:${C.ink3}}
.ct-badge{font-size:${FX.size.xs}px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:${C.ink2};background:rgba(255,255,255,.06);border:1px solid ${C.line};border-radius:${FX.radius.sm}px;padding:3px 7px;white-space:nowrap}
.ct-mono{font-family:${FX_FONT.mono}}
.ct-explica{font-size:14px;line-height:1.5;color:${C.ink2};padding:12px 14px;border-radius:${FX.radius.lg}px;background:rgba(255,255,255,.03);border:1px solid ${C.line};margin-bottom:12px}
.ct-explica b{color:${C.ink}}
.ct-barra{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ct-esp{flex:1}
.ct-vacio{padding:28px 8px;text-align:center;color:${C.ink3};font-size:14px}
.ct-grupos{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.ct-sep{padding:14px 4px 2px;font-size:${FX.size.sm}px;color:${C.ink3};text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.ct-grupo{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;text-align:left;width:100%;padding:14px 14px 18px;border-radius:${FX.radius.lg}px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:${C.ink};font:inherit;cursor:pointer;touch-action:manipulation;overflow:hidden}
.ct-grupo-txt{min-width:0}
.ct-grupo-txt b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-grupo-txt small{display:block;font-size:${FX.size.md}px;color:${C.ink2};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.ct-grupo-num{display:flex;flex-direction:column;align-items:flex-end}
.ct-grupo-num b{font-family:${FX_FONT.display};font-size:20px;font-weight:700}
.ct-grupo-num b small{font-size:14px;color:${C.ink2};font-weight:500}
.ct-grupo-num>small{font-size:${FX.size.xs}px;color:${C.ink3}}
.ct-barrita{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.05)}
.ct-barrita i{display:block;height:100%;background:${C.ambar}}
.ct-grupo.ok .ct-barrita i{background:${C.teal}}
.ct-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 24px);transform:translateX(-50%);background:rgba(10,12,24,.92);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:${FX.radius.lg}px;padding:11px 16px;font-size:14px;z-index:80}
@media (max-width:700px){
  .ct{gap:10px}
  .ct-top{background:none;border:0;-webkit-backdrop-filter:none;backdrop-filter:none;padding:2px 4px 0}
  .ct-top .ct-tit{font-size:22px}
  .ct-card{padding:12px}
  .ct-modos{grid-template-columns:1fr;gap:8px}
  .ct-modo{min-height:64px;flex-direction:row;align-items:center;justify-content:space-between}
}
/* Escáner */
.ct-esc{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:90;overflow:hidden;background:#000;color:#fff;font-family:${FX_FONT.body}}
.ct-marco{position:absolute;left:50%;top:40%;width:min(70vw,290px);aspect-ratio:1/1;transform:translate(-50%,-50%);pointer-events:none}
.ct-marco i{position:absolute;width:38px;height:38px;border:0 solid rgba(255,255,255,.75);transition:border-color .15s}
.ct-marco i:nth-child(1){left:0;top:0;border-left-width:4px;border-top-width:4px;border-top-left-radius:16px}
.ct-marco i:nth-child(2){right:0;top:0;border-right-width:4px;border-top-width:4px;border-top-right-radius:16px}
.ct-marco i:nth-child(3){left:0;bottom:0;border-left-width:4px;border-bottom-width:4px;border-bottom-left-radius:16px}
.ct-marco i:nth-child(4){right:0;bottom:0;border-right-width:4px;border-bottom-width:4px;border-bottom-right-radius:16px}
.ct-marco.ok i{border-color:${C.teal}}
.ct-marco.dup i,.ct-marco.err i{border-color:${C.ambar}}
.ct-esc-arriba{position:absolute;top:0;left:0;right:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 12px) 18px 12px;background:rgba(8,8,15,.78)}
.ct-esc-total{display:flex;align-items:baseline;gap:12px;min-width:0}
.ct-esc-total b{font-family:${FX_FONT.display};font-size:44px;font-weight:700;line-height:1}
.ct-esc-tit{font-size:15px;font-weight:600;color:${C.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-esc-cerrar{touch-action:manipulation;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:${C.ink};font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.ct-esc-estado{position:absolute;top:calc(env(safe-area-inset-top) + 78px);left:18px}
.ct-esc-flash{position:absolute;left:50%;top:calc(env(safe-area-inset-top) + 124px);transform:translateX(-50%);background:rgba(10,12,24,.92);border:1px solid ${rgba(C.tealRgb, 0.55)};color:#fff;border-radius:${FX.radius.lg}px;padding:12px 18px;font-size:16px;font-weight:600;max-width:calc(100vw - 32px);text-align:center;overflow-wrap:anywhere}
.ct-esc-flash.dup,.ct-esc-flash.err{border-color:${rgba(C.ambarRgb, 0.7)};color:${C.ambar}}
.ct-esc-abajo{position:absolute;left:0;right:0;bottom:0;padding:14px 16px calc(env(safe-area-inset-bottom) + 16px);background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.88) 22%)}
.ct-esc-abajo>*{max-width:520px;margin:0 auto}
.ct-esc-vacio{font-size:15px;color:#d5d8e6;text-align:center;padding:10px 0 6px}
.ct-esc-lista{display:flex;flex-direction:column;gap:4px}
.ct-esc-fila{display:flex;gap:10px;align-items:center;font-size:14px;min-height:44px}
.ct-esc-fila-txt{flex:1;min-width:0;display:flex;flex-direction:column}
.ct-esc-fila-txt .ct-mono{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-esc-fila-txt small{font-size:12px;color:#b9bdd0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-esc-ico{width:22px;height:22px;border-radius:50%;background:${rgba(C.tealRgb, 0.18)};color:${C.teal};display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.ct-esc-ico.pend{background:rgba(255,255,255,.12);color:#d5d8e6}
.ct-quitar{touch-action:manipulation;min-height:40px;min-width:84px;padding:0 12px;border-radius:${FX.radius.md}px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#d5d8e6;font:inherit;font-size:14px;cursor:pointer;flex-shrink:0}
.ct-quitar.on{border-color:${rgba(C.ambarRgb, 0.6)};color:${C.ambar};background:${rgba(C.ambarRgb, 0.12)}}
/* Visor de QR: fondo blanco para el mejor contraste al escanear desde la pantalla */
.ct-visor{position:fixed;inset:0;height:100dvh;z-index:95;background:#fff;color:#111;display:flex;flex-direction:column;align-items:center;font-family:${FX_FONT.body};overflow:hidden}
.ct-visor-arriba{width:100%;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:calc(env(safe-area-inset-top) + 10px) 16px 8px;border-bottom:1px solid #eee}
.ct-visor-tit{font-family:${FX_FONT.display};font-size:17px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ct-visor-sub{font-size:13px;color:#555;margin-top:2px}
.ct-visor-cerrar{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid #ccc;background:#f4f4f4;color:#111;font:inherit;font-size:14px;font-weight:600;cursor:pointer;flex-shrink:0;touch-action:manipulation}
.ct-visor-qr{flex:1;display:flex;align-items:center;justify-content:center;background:#fff;border:0;padding:8px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;min-height:0}
.ct-qr{display:block;image-rendering:pixelated;background:#fff}
.ct-visor-cod{display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 16px 8px}
.ct-visor-cod .ct-mono{font-size:24px;font-weight:600;letter-spacing:.02em;color:#000;overflow-wrap:anywhere;text-align:center}
.ct-visor-cod small{font-size:13px;color:#555}
.ct-visor-abajo{width:100%;max-width:560px;box-sizing:border-box;padding:8px 16px calc(env(safe-area-inset-bottom) + 14px);display:flex;flex-direction:column;gap:10px}
.ct-visor-nav{display:grid;grid-template-columns:1fr 2fr;gap:10px}
.ct-vbtn{min-height:48px;padding:0 16px;border-radius:${FX.radius.lg}px;border:1px solid #ccc;background:#f4f4f4;color:#111;font:inherit;font-size:15px;font-weight:600;cursor:pointer;touch-action:manipulation;white-space:nowrap}
.ct-vbtn:disabled{opacity:.4;cursor:default}
.ct-vbtn.pri{background:#0b0f1a;border-color:#0b0f1a;color:#fff}
.ct-vbtn.grande{min-height:60px;font-size:18px}
.ct-visor-auto{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;font-size:14px;color:#333}
.ct-vseg{display:inline-flex;border:1px solid #ccc;border-radius:${FX.radius.md}px;overflow:hidden}
.ct-vseg button{min-height:44px;min-width:48px;padding:0 10px;border:0;border-left:1px solid #ddd;background:#fff;color:#111;font:inherit;font-size:14px;cursor:pointer;touch-action:manipulation}
.ct-vseg button:first-child{border-left:0}
.ct-vseg button.on{background:#0b0f1a;color:#fff}
.ct-visor-fin{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}
.ct-visor-fin b{font-family:${FX_FONT.display};font-size:24px}
.ct-visor-fin span{font-size:15px;color:#444;max-width:420px;line-height:1.45}
`;
