import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { getSession } from "./auth";
import { sbFetch } from "./colectasShared";
import {
  leerEtiqueta, envioCoincide, filtroEnvios, datosDeEnvio, fechaCorta, horaCorta,
  desdeRango, hastaRango, estadoFila, textoParaExcel, resumen,
} from "./dobleBultoShared";

// Doble bulto — paquetes de más de un bulto que se le cobran al cliente (pedido de Alejo 08/11/2026).
// Reemplaza "foto → grupo de Facebook → foto por foto → Excel": al ingresar la mercadería se escanea
// el QR, se confirma la cantidad de bultos y listo. La dirección y la zona NO están en el QR de ML:
// se completan solas cuando el envío aparece en envios_busqueda (sync de LightData). La tabla de
// abajo se copia y se pega en el Excel con las mismas columnas de siempre.
// Datos: doble_bultos + ml_vendedores (migración 20261108200000_doble_bultos.sql).

const COLS_ENVIO = "id_interno,tracking,id_venta_ml,razon_social,direccion,localidad,cp";
const REFRESH_MS = 3 * 60 * 1000;
const yo = () => { const s = getSession(); return (s && (s.nombre || s.email)) || "equipo"; };
const sinTabla = (e) => /doble_bultos|ml_vendedores|relation|schema cache|PGRST205|42P01/i.test(String(e && e.message));
const RANGOS = [["hoy", "Hoy"], ["semana", "Esta semana"], ["pasada", "Semana pasada"], ["30", "30 días"]];

// ---------- datos ----------
async function buscarEnvio(codigo) {
  const f = filtroEnvios([codigo]);
  if (!f) return null;
  const rows = await sbFetch(`envios_busqueda?${f}&select=${COLS_ENVIO}&limit=5`);
  return (rows || []).find((e) => envioCoincide(e, codigo)) || null;
}
async function buscarExistente(codigo) {
  const rows = await sbFetch(`doble_bultos?codigo=eq.${encodeURIComponent(codigo)}&select=*&limit=1`);
  return (rows && rows[0]) || null;
}
async function clienteDeVendedor(senderId) {
  const rows = await sbFetch(`ml_vendedores?sender_id=eq.${encodeURIComponent(senderId)}&select=cliente&limit=1`);
  return (rows && rows[0] && rows[0].cliente) || null;
}
const aprenderVendedor = (senderId, cliente) => (senderId && cliente
  ? sbFetch("ml_vendedores?on_conflict=sender_id", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ sender_id: senderId, cliente, actualizado_at: new Date().toISOString() }]),
    }).catch(() => {})
  : Promise.resolve());
const actualizarFila = (id, campos) => sbFetch(`doble_bultos?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(campos) });

// Completa dirección/zona de lo escaneado en las últimas 3 semanas que todavía no tiene datos
async function cruzarPendientes() {
  const desde = new Date(Date.now() - 21 * 864e5).toISOString();
  const pend = await sbFetch(`doble_bultos?cruzado_at=is.null&escaneado_at=gte.${desde}&select=id,codigo,sender_id&limit=1000`);
  if (!pend || !pend.length) return 0;
  let n = 0;
  for (let i = 0; i < pend.length; i += 40) {
    const tanda = pend.slice(i, i + 40);
    const f = filtroEnvios(tanda.map((p) => p.codigo));
    if (!f) continue;
    const envios = await sbFetch(`envios_busqueda?${f}&select=${COLS_ENVIO}&limit=500`).catch(() => []);
    const hechos = await Promise.all(tanda.map(async (p) => {
      const e = (envios || []).find((x) => envioCoincide(x, p.codigo));
      if (!e) return false;
      await actualizarFila(p.id, { ...datosDeEnvio(e), cruzado_at: new Date().toISOString() }).catch(() => {});
      await aprenderVendedor(p.sender_id, e.razon_social);
      return true;
    }));
    n += hechos.filter(Boolean).length;
  }
  return n;
}

// ---------- beep (el AudioContext se crea en el toque de "Escanear": iPhone lo exige) ----------
let audio = null;
function prepararAudio() {
  try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch { audio = null; }
}
function beep(ok = true) {
  try { navigator.vibrate && navigator.vibrate(ok ? 50 : [40, 60, 40]); } catch {}
  try {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1250 : 520; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.18));
  } catch {}
}

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch {
    try {
      const ta = document.createElement("textarea"); ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}

// =====================================================================================
export default function DobleBulto() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [rango, setRango] = useState("semana");
  const [cliente, setCliente] = useState("");
  // Desde el ícono del celu (?escanear=1) la cámara se abre en el primer cuadro, sin mostrar antes la tabla
  const [escaner, setEscaner] = useState(() => /[?&]escanear=1/.test(window.location.search));
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [armado, setArmado] = useState(null); // id de la fila con "¿Borrar?" armado

  // Primero muestra la tabla y después, en segundo plano, completa direcciones que falten (09/11: antes
  // esperaba el cruce con LightData antes de mostrar nada).
  const cargar = useCallback(async (cruzar = true) => {
    const traer = async () => {
      const hasta = hastaRango(rango);
      const rows = await sbFetch(`doble_bultos?escaneado_at=gte.${desdeRango(rango)}${hasta ? `&escaneado_at=lt.${hasta}` : ""}&order=escaneado_at.desc&limit=3000`);
      setFilas(rows || []); setError(null);
    };
    try {
      await traer();
      if (cruzar) cruzarPendientes().then((n) => (n ? traer() : null)).catch(() => {});
    } catch (e) {
      setError(sinTabla(e) ? "tabla" : getSession() ? "red" : "sesion");
      setFilas((f) => f || []);
    }
  }, [rango]);

  // Acceso directo del celu (doble-bulto.html / atajo del ícono): llega con ?escanear=1 y abre la cámara directo
  useEffect(() => {
    if (!/[?&]escanear=1/.test(window.location.search)) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);
  useEffect(() => { setFilas(null); cargar(); const t = setInterval(() => cargar(), REFRESH_MS); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 2600); return () => clearTimeout(t); }, [aviso]);
  useEffect(() => { if (armado == null) return; const t = setTimeout(() => setArmado(null), 3000); return () => clearTimeout(t); }, [armado]);

  const clientes = useMemo(() => [...new Set((filas || []).map((f) => f.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [filas]);
  const visibles = useMemo(() => (filas || []).filter((f) => !cliente || (cliente === "__sin" ? !f.cliente : f.cliente === cliente)), [filas, cliente]);
  const res = resumen(visibles);

  async function copiarTabla() {
    if (!visibles.length) return;
    const ok = await copiar(textoParaExcel(visibles));
    if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 2200); } else setAviso("No se pudo copiar. Probá de nuevo.");
  }
  async function cambiarBultos(f, n) {
    setFilas((xs) => xs.map((x) => (x.id === f.id ? { ...x, bultos: n } : x)));
    try { await actualizarFila(f.id, { bultos: n }); } catch { setAviso("No se pudo guardar el cambio"); cargar(false); }
  }
  async function borrar(f) {
    if (armado !== f.id) { setArmado(f.id); return; }
    setArmado(null);
    setFilas((xs) => xs.filter((x) => x.id !== f.id));
    try { await sbFetch(`doble_bultos?id=eq.${f.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); setAviso("Borrado"); }
    catch { setAviso("No se pudo borrar"); cargar(false); }
  }

  return (
    <div className="db">
      <style>{CSS}</style>

      <div className="db-card db-top">
        <div style={{ minWidth: 0 }}>
          <div className="db-tit">Doble bulto</div>
          <div className="db-sub">Escaneá el QR de cada paquete con más de un bulto al ingresar. La dirección y la zona se completan solas cuando el envío entra a LightData.</div>
        </div>
        <button className="db-btn db-pri db-grande" onClick={() => { prepararAudio(); setEscaner(true); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></svg>
          Escanear paquetes
        </button>
      </div>

      {error === "tabla" && <div className="db-card db-alerta"><b>Falta un paso para que funcione:</b> crear las tablas en Supabase (migración <code>20261108200000_doble_bultos.sql</code> en SQL Editor). Hasta entonces no se guarda nada.</div>}
      {error === "sesion" && <div className="db-card db-alerta">Iniciá sesión desde Inicio para ver y cargar los doble bultos.</div>}
      {error === "red" && <div className="db-card db-alerta">No se pudieron traer los datos. Se reintenta solo en unos minutos.</div>}

      <div className="db-card">
        <div className="db-barra">
          <div className="db-seg">
            {RANGOS.map(([k, l]) => <button key={k} className={rango === k ? "on" : ""} onClick={() => { setRango(k); setCliente(""); }}>{l}</button>)}
          </div>
          {clientes.length > 0 && (
            <select className="db-select" value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente">
              <option value="">Todos los clientes</option>
              {clientes.map((c) => <option key={c} value={c}>{c}</option>)}
              {(filas || []).some((f) => !f.cliente) && <option value="__sin">Sin cliente todavía</option>}
            </select>
          )}
          <div className="db-esp" />
          <button className={"db-btn" + (copiado ? " db-ok" : "")} disabled={!visibles.length} onClick={copiarTabla} title="Copia las filas en el orden del Excel: Fecha · Cliente · Nro de venta · Dirección · Bultos · Zona">
            {copiado ? `Copiado ✓ ${visibles.length} fila${visibles.length === 1 ? "" : "s"}` : "Copiar para Excel"}
          </button>
        </div>

        {filas && (
          <div className="db-res">
            <span><b>{res.paquetes}</b> paquete{res.paquetes === 1 ? "" : "s"}</span>
            <span><b>{res.bultos}</b> bultos</span>
            {res.sinDatos > 0 && <span className="db-amb"><b>{res.sinDatos}</b> sin dirección todavía</span>}
          </div>
        )}

        {filas === null ? <div className="db-vacio">Cargando…</div>
          : !visibles.length ? <div className="db-vacio">{error ? "" : "Nada escaneado en este período."}</div>
          : (
            <div className="db-tabla">
              <div className="db-f db-th"><span>Fecha</span><span>Cliente</span><span>Nro de envío</span><span>Dirección</span><span>Bultos</span><span>Zona</span><span /></div>
              {visibles.map((f) => {
                const est = estadoFila(f);
                return (
                  <div key={f.id} className="db-f">
                    <span className="db-fecha">{fechaCorta(f.escaneado_at)}<small>{horaCorta(f.escaneado_at)}</small></span>
                    <span className="db-cli">{f.cliente || <i className="db-gris">Se completa solo</i>}</span>
                    <span className="db-cod">{f.codigo}</span>
                    <span className="db-dir">{f.direccion || <i className={est === "no_aparece" ? "db-amb" : "db-gris"}>{est === "no_aparece" ? "No apareció en LightData" : "Sin datos todavía"}</i>}</span>
                    <span>
                      <select className="db-select db-bul" value={f.bultos} onChange={(e) => cambiarBultos(f, Number(e.target.value))} aria-label="Bultos">
                        {Array.from({ length: 19 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </span>
                    <span className="db-zona">{f.localidad || "—"}</span>
                    <span><button className={"db-x" + (armado === f.id ? " on" : "")} onClick={() => borrar(f)} title="Borrar (tocá dos veces)">{armado === f.id ? "¿Borrar?" : "×"}</button></span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {aviso && <div className="db-toast">{aviso}</div>}
      {escaner && <Escaner onCerrar={(n) => { setEscaner(false); if (n) setAviso(`${n} paquete${n === 1 ? "" : "s"} cargado${n === 1 ? "" : "s"}`); cargar(); }} />}
    </div>
  );
}

// =====================================================================================
// Escáner continuo: lee → muestra cliente y bultos → Confirmar → sigue con el próximo.
function Escaner({ onCerrar }) {
  const video = useRef();
  const pausa = useRef(false);
  const ultimo = useRef({ c: "", at: 0 });
  const [card, setCard] = useState(null);
  const [cargados, setCargados] = useState([]);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const cardRef = useRef(null); cardRef.current = card;

  // 09/11: todo lo lento pasa por detrás. Al escanear, la hoja aparece al instante con los números
  // habilitados; la búsqueda del cliente/dirección y el guardado corren en segundo plano, con reintentos.
  const vendCache = useRef(new Map()); // sender_id → cliente, para mostrarlo al toque en esta tanda
  const pendientes = useRef(new Set());
  const [cerrando, setCerrando] = useState(false);

  const procesar = useCallback((texto) => {
    if (pausa.current) return;
    const l = leerEtiqueta(texto);
    const ahora = Date.now();
    if (!l) return;
    if (l.codigo === ultimo.current.c && ahora - ultimo.current.at < 5000) return; // la misma etiqueta sigue en cuadro
    ultimo.current = { c: l.codigo, at: ahora };
    pausa.current = true;
    beep(true);
    setFlash(null);
    const conocido = l.sender_id ? vendCache.current.get(l.sender_id) : null;
    const info = Promise.all([
      buscarExistente(l.codigo).catch(() => null),
      buscarEnvio(l.codigo).catch(() => null),
      l.sender_id && !conocido ? clienteDeVendedor(l.sender_id).catch(() => null) : conocido,
    ]).then(([ex, env, vend]) => {
      const cliente = (env && env.razon_social) || (ex && ex.cliente) || vend || null;
      if (cliente && l.sender_id) vendCache.current.set(l.sender_id, cliente);
      return { ex, env, vend, cliente };
    });
    setCard({ l, info, buscando: true, cliente: conocido || null });
    info.then((r) => {
      setCard((c) => (c && c.l.codigo === l.codigo ? { ...c, buscando: false, ex: r.ex, env: r.env, cliente: r.cliente || c.cliente } : c));
      setCargados((xs) => xs.map((x) => (x.codigo === l.codigo && !x.cliente && r.cliente ? { ...x, cliente: r.cliente } : x)));
    });
  }, []);

  function soltar() {
    if (cardRef.current) ultimo.current = { c: cardRef.current.l.codigo, at: Date.now() };
    setCard(null);
    pausa.current = false;
  }

  const marcar = (codigo, patch) => setCargados((xs) => xs.map((x) => (x.codigo === codigo ? { ...x, ...patch } : x)));

  // Guarda en segundo plano: upsert por código (re-escanear actualiza los bultos, nunca duplica),
  // y cuando llega la búsqueda completa cliente/dirección. Hasta 3 reintentos; si no, queda ⚠ para tocar.
  function guardarFondo(l, info, n, intento = 0) {
    const p = (async () => {
      marcar(l.codigo, { estado: "guardando" });
      try {
        await sbFetch("doble_bultos?on_conflict=codigo", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([{ codigo: l.codigo, qr: l.qr.slice(0, 500), sender_id: l.sender_id, bultos: n, escaneado_por: yo() }]),
        });
        marcar(l.codigo, { estado: "ok" });
        const r = await info;
        const cod = encodeURIComponent(l.codigo);
        if (r.env) {
          await sbFetch(`doble_bultos?codigo=eq.${cod}`, { method: "PATCH", body: JSON.stringify({ ...datosDeEnvio(r.env), cruzado_at: new Date().toISOString() }) }).catch(() => {});
          aprenderVendedor(l.sender_id, r.env.razon_social);
        } else if (r.cliente) {
          await sbFetch(`doble_bultos?codigo=eq.${cod}&cliente=is.null`, { method: "PATCH", body: JSON.stringify({ cliente: r.cliente }) }).catch(() => {});
        }
      } catch (e) {
        if (sinTabla(e)) { marcar(l.codigo, { estado: "error" }); setError("Falta crear la tabla en Supabase: todavía no se guarda nada."); return; }
        if (intento < 3) { await new Promise((ok) => setTimeout(ok, 1500 * (intento + 1))); return guardarFondo(l, info, n, intento + 1); }
        marcar(l.codigo, { estado: "error" });
      }
    })();
    pendientes.current.add(p);
    p.finally(() => pendientes.current.delete(p));
    return p;
  }

  // Opción C: tocar el número guarda y la cámara sigue con el próximo paquete — sin esperar a la red
  function guardar(n) {
    const c = cardRef.current;
    if (!c) return;
    if (c.ex && c.ex.bultos === n) { soltar(); setFlash({ tipo: "ok", txt: `Sin cambios · ${n} bultos` }); return; }
    setCargados((xs) => [{ codigo: c.l.codigo, l: c.l, info: c.info, cliente: c.cliente, bultos: n, estado: "guardando" }, ...xs.filter((x) => x.codigo !== c.l.codigo)]);
    guardarFondo(c.l, c.info, n);
    setFlash({ tipo: "ok", txt: `✓ ${n} bultos` });
    soltar();
  }

  async function terminar() {
    if (pendientes.current.size) {
      setCerrando(true);
      await Promise.race([Promise.allSettled([...pendientes.current]), new Promise((ok) => setTimeout(ok, 8000))]);
    }
    onCerrar(cargados.length);
  }

  // Cámara + lectura cada ~250 ms (BarcodeDetector si existe; si no, jsQR — iPhone)
  useEffect(() => {
    let stream, timer, vivo = true;
    const cv = document.createElement("canvas");
    const det = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return; }
        // iPhone a veces dibuja el video chico (con bordes negros) hasta que algo lo obliga a re-medirse:
        // cuando llega la imagen o cambia su tamaño, se fuerza un re-dibujo a pantalla completa (09/11)
        const v = video.current;
        const remedir = () => { v.style.width = "99.9%"; requestAnimationFrame(() => { v.style.width = "100%"; }); };
        ["loadedmetadata", "playing", "resize"].forEach((ev) => v.addEventListener(ev, remedir));
        v.srcObject = stream; await v.play();
        setTimeout(remedir, 300); setTimeout(remedir, 1000);
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
    return () => { vivo = false; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [procesar]);

  // Pantalla fija mientras se escanea: sin pellizcar para hacer zoom (iOS ignora user-scalable=no)
  useEffect(() => {
    const no = (e) => e.preventDefault();
    const pinch = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("gesturestart", no);
    document.addEventListener("gesturechange", no);
    document.addEventListener("touchmove", pinch, { passive: false });
    // OJO: no cambiar el <meta viewport> en vivo — en iPhone deja los toques corridos y achica el video (09/11)
    return () => {
      document.removeEventListener("gesturestart", no);
      document.removeEventListener("gesturechange", no);
      document.removeEventListener("touchmove", pinch);
    };
  }, []);

  // Desktop: tocar 2–6 guarda, Escape descarta
  useEffect(() => {
    const k = (e) => {
      if (!cardRef.current || e.target.tagName === "INPUT") return;
      if (/^[2-6]$/.test(e.key) && !cardRef.current.mas) { e.preventDefault(); guardar(Number(e.key)); }
      if (e.key === "Escape") soltar();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 1800); return () => clearTimeout(t); }, [flash]);

  const setMas = (n) => setCard((c) => (c ? { ...c, mas: n ? Math.max(2, Math.min(50, n)) : 0 } : c));
  const totalBultos = cargados.reduce((s, x) => s + x.bultos, 0);
  const bloqueado = !card || cerrando;
  const conError = cargados.filter((x) => x.estado === "error");
  const actual = card && card.ex ? card.ex.bultos : null;

  return createPortal(
    <div className="db-esc" onPointerDown={prepararAudio}>
      <style>{CSS}</style>
      <video ref={video} playsInline muted autoPlay disablePictureInPicture className="db-esc-video"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }} />
      <div className={"db-esc-marco" + (card ? " ok" : "")}><i /><i /><i /><i /></div>
      <div className="db-esc-arriba">
        <div className="db-esc-total">
          {cargados.length
            ? <><b>{totalBultos}</b><span>bultos · {cargados.length} paquete{cargados.length === 1 ? "" : "s"}</span></>
            : <span className="db-esc-tit">Apuntá al QR de la etiqueta</span>}
        </div>
        <button className="db-esc-term" disabled={cerrando} onClick={terminar}>{cerrando ? "Guardando…" : "Terminar"}</button>
      </div>

      {flash && !card && <div className={"db-esc-flash" + (flash.tipo === "ok" ? "" : " aviso")}>{flash.txt}</div>}
      {error && !card && !flash && <div className="db-esc-flash aviso">{error}</div>}

      <div className={"db-esc-abajo" + (card ? " hoja" : "")}>
        {card ? (
          <>
            <div className="db-esc-cab">
              <div style={{ minWidth: 0 }}>
                <div className="db-esc-cli">{card.cliente || (card.buscando ? <span className="db-esc-busc">Buscando cliente…</span> : "Cliente: se completa solo")}</div>
                <div className="db-esc-det">
                  {card.l.codigo}
                  {card.env && card.env.localidad ? ` · ${card.env.localidad}` : !card.buscando && !card.env ? " · todavía no está en LightData" : ""}
                </div>
              </div>
              <button className="db-esc-desc" onClick={soltar}>Descartar</button>
            </div>
            {card.ex && <div className="db-esc-ya">Ya estaba cargado el {fechaCorta(card.ex.escaneado_at)} con {card.ex.bultos} bultos. Tocá otro número para corregirlo; no se duplica.</div>}
            {card.mas ? (
              <>
                <div className="db-esc-bultos">
                  <button className="db-paso" onClick={() => setMas(card.mas - 1)} disabled={card.mas <= 2} aria-label="Menos">−</button>
                  <div className="db-esc-n"><b>{card.mas}</b><small>bultos</small></div>
                  <button className="db-paso" onClick={() => setMas(card.mas + 1)} disabled={card.mas >= 50} aria-label="Más">+</button>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="db-num chico" onClick={() => setMas(0)}>Volver</button>
                  <button className="db-num on" style={{ flex: 1 }} disabled={bloqueado} onClick={() => guardar(card.mas)}>{`Guardar · ${card.mas} bultos`}</button>
                </div>
              </>
            ) : (
              <>
                <div className="db-esc-preg">¿Cuántos bultos? Tocá el número y se guarda.</div>
                <div className="db-nums">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button key={n} className={"db-num" + ((actual ? actual === n : n === 2) ? " on" : "")} disabled={bloqueado} onClick={() => guardar(n)}>{n}</button>
                  ))}
                  <button className="db-num chico" disabled={bloqueado} onClick={() => setMas(Math.max(7, actual || 7))}>Más…</button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* 09/11: sacamos el "tipeá el número" — Alejo prefiere la foto de siempre para etiquetas rotas */}
            {conError.length > 0 && (
              <button className="db-esc-reint" onClick={() => conError.forEach((x) => guardarFondo(x.l, x.info, x.bultos))}>
                ⚠ {conError.length} sin guardar (sin señal). Tocá para reintentar
              </button>
            )}
            {cargados.length > 0 && (
              <div className="db-esc-lista">
                {cargados.slice(0, 5).map((x) => (
                  <div key={x.codigo} className="db-esc-fila">
                    <span className={"db-esc-ico" + (x.estado === "error" ? " err" : x.estado === "guardando" ? " pend" : "")}>{x.estado === "error" ? "!" : "✓"}</span>
                    <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.cliente || `Envío ${x.codigo}`}</span><b>{x.bultos}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>, document.body);
}

const CSS = `
.db{display:flex;flex-direction:column;gap:14px;color:#f4f5fa}
.db-card{background:rgba(27,28,46,.72);border:1px solid rgba(255,255,255,.06);border-radius:16px;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);padding:16px}
.db-top{display:flex;align-items:center;justify-content:space-between;gap:16px}
.db-tit{font-family:'Space Grotesk',-apple-system,'Segoe UI',sans-serif;font-size:19px;font-weight:600;letter-spacing:-.3px}
.db-sub{font-size:13px;color:#a7adc2;margin-top:4px;line-height:1.45;max-width:620px}
.db-alerta{border-color:rgba(245,192,68,.35);color:#f4f5fa;font-size:13.5px;line-height:1.5}
.db-alerta code{font-size:12px;color:#F5C044}
.db-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:13px;padding:8px 13px;border-radius:10px;cursor:pointer;white-space:nowrap}
.db-btn:disabled{opacity:.45;cursor:default}
.db-pri{background:rgba(46,230,182,.12);border-color:rgba(46,230,182,.32);color:#2ee6b6}
.db-ok{border-color:rgba(46,230,182,.4);color:#2ee6b6}
.db-grande{font-size:15px;font-weight:600;padding:12px 18px;min-height:48px}
.db-barra{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.db-esp{flex:1}
.db-seg{display:inline-flex;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:3px}
.db-seg button{background:none;border:0;color:#a7adc2;font:inherit;font-size:13px;padding:7px 12px;border-radius:8px;cursor:pointer}
.db-seg button.on{background:rgba(255,255,255,.08);color:#f4f5fa}
.db-select{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:13px;padding:7px 10px;border-radius:9px;max-width:220px}
.db-select option{background:#1b1c2e}
.db-res{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#a7adc2;margin:14px 0 10px}
.db-res b{font-family:'Space Grotesk',sans-serif;font-size:17px;color:#f4f5fa;margin-right:4px}
.db-amb{color:#F5C044}.db-res .db-amb b{color:#F5C044}
.db-gris{color:#71768e;font-style:normal}
i.db-amb{font-style:normal}
.db-vacio{padding:28px 8px;text-align:center;color:#71768e;font-size:13.5px}
.db-tabla{border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden}
.db-f{display:grid;grid-template-columns:62px minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.6fr) 72px minmax(0,1fr) 72px;gap:10px;padding:9px 12px;align-items:center;font-size:13px;border-top:1px solid rgba(255,255,255,.05)}
.db-f>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.db-th{border-top:0;background:rgba(255,255,255,.03);font-size:11px;color:#8a8ca6;text-transform:uppercase;letter-spacing:.05em}
.db-fecha small{display:block;font-size:11px;color:#71768e}
.db-cod{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;color:#c9cbe0}
.db-bul{padding:5px 8px;width:62px}
.db-x{background:none;border:1px solid transparent;color:#71768e;font:inherit;font-size:15px;padding:4px 8px;border-radius:8px;cursor:pointer}
.db-x.on{border-color:rgba(245,192,68,.4);color:#F5C044;font-size:12px}
.db-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 24px);transform:translateX(-50%);background:rgba(10,12,24,.92);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:12px;padding:11px 16px;font-size:14px;z-index:80}
@media (max-width:700px){
  .db-top{flex-direction:column;align-items:stretch}
  .db-grande{width:100%}
  .db-th{display:none}
  .db-f{grid-template-columns:minmax(0,1fr) 72px;grid-template-areas:"cli bul" "dir dir" "zona zona" "fecha x";gap:4px 10px;padding:12px}
  .db-f>span:nth-child(1){grid-area:fecha}.db-cli{grid-area:cli;font-weight:600;font-size:14px}.db-f>span:nth-child(3){display:none}
  .db-dir{grid-area:dir;color:#a7adc2}.db-f>span:nth-child(5){grid-area:bul;justify-self:end}.db-zona{grid-area:zona;color:#a7adc2;font-size:12.5px}
  .db-f>span:nth-child(7){grid-area:x;justify-self:end}
  .db-fecha small{display:inline;margin-left:6px}
}
.db-esc{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:90;overflow:hidden;background:#000;color:#fff;font-family:-apple-system,'Segoe UI',sans-serif}
.db-esc-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.db-esc-marco{position:absolute;left:50%;top:41%;width:min(70vw,290px);aspect-ratio:1/1;transform:translate(-50%,-50%);pointer-events:none}
.db-esc-marco i{position:absolute;width:38px;height:38px;border:0 solid rgba(255,255,255,.75);transition:border-color .15s}
.db-esc-marco i:nth-child(1){left:0;top:0;border-left-width:4px;border-top-width:4px;border-top-left-radius:16px}
.db-esc-marco i:nth-child(2){right:0;top:0;border-right-width:4px;border-top-width:4px;border-top-right-radius:16px}
.db-esc-marco i:nth-child(3){left:0;bottom:0;border-left-width:4px;border-bottom-width:4px;border-bottom-left-radius:16px}
.db-esc-marco i:nth-child(4){right:0;bottom:0;border-right-width:4px;border-bottom-width:4px;border-bottom-right-radius:16px}
.db-esc-marco.ok i{border-color:#2ee6b6}
.db-esc-arriba{position:absolute;top:0;left:0;right:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 12px) 18px 14px;background:rgba(8,8,15,.72)}
.db-esc-total{display:flex;align-items:baseline;gap:10px;min-width:0}
.db-esc-total b{font-family:'Space Grotesk',sans-serif;font-size:34px;font-weight:700;line-height:1}
.db-esc-total span{font-size:13px;color:#b9bdd0}
.db-esc-total .db-esc-tit{font-size:15px;color:#f4f5fa;font-weight:600}
.db-esc-term{touch-action:manipulation;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.db-esc-flash{position:absolute;left:50%;top:calc(env(safe-area-inset-top) + 84px);transform:translateX(-50%);background:rgba(10,12,24,.92);border:1px solid rgba(46,230,182,.5);color:#fff;border-radius:14px;padding:11px 16px;font-size:15px;font-weight:600;max-width:calc(100vw - 32px);text-align:center}
.db-esc-flash.aviso{border-color:rgba(245,192,68,.6);font-weight:500}
.db-esc-abajo{position:absolute;left:0;right:0;bottom:0;padding:14px 16px calc(env(safe-area-inset-bottom) + 16px);background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.85) 25%);display:flex;flex-direction:column;gap:12px}
.db-esc-abajo.hoja{background:#151626;border-top-left-radius:28px;border-top-right-radius:28px;padding-top:20px;gap:14px}
.db-esc-abajo>*{width:100%;max-width:520px;margin:0 auto;box-sizing:border-box}
.db-esc-cab{display:flex;align-items:center;justify-content:space-between;gap:12px}
.db-esc-cli{font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:600;line-height:1.25}
.db-esc-det{font-size:13px;color:#b9bdd0;margin-top:3px;overflow-wrap:anywhere}
.db-esc-desc{touch-action:manipulation;min-height:44px;padding:0 12px;border:0;border-radius:12px;background:transparent;color:#b9bdd0;font:inherit;font-size:14px;font-weight:500;cursor:pointer;flex-shrink:0}
.db-esc-ya{font-size:12.5px;color:#F5C044;line-height:1.4}
.db-esc-err{font-size:13px;color:#F5C044}
.db-esc-preg{font-size:14px;color:#b9bdd0}
.db-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.db-num{touch-action:manipulation;min-height:72px;border-radius:18px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f5fa;font-family:'Space Grotesk',sans-serif;font-size:30px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent}
.db-num.on{background:#2ee6b6;border-color:#2ee6b6;color:#062a20}
.db-num.chico{font-family:inherit;font-size:17px;font-weight:600;padding:0 18px}
.db-num.on.chico,.db-esc-bultos+div .db-num.on{font-family:inherit;font-size:17px}
.db-num:active:not(:disabled){transform:scale(.96)}
.db-num:disabled{opacity:.45;cursor:default}
.db-esc-bultos{display:flex;align-items:center;justify-content:center;gap:24px}
.db-paso{width:60px;height:60px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-size:28px;line-height:1;cursor:pointer}
.db-paso:disabled{opacity:.3}
.db-esc-n{display:flex;flex-direction:column;align-items:center;min-width:80px}
.db-esc-n b{font-family:'Space Grotesk',sans-serif;font-size:52px;line-height:1}
.db-esc-n small{font-size:13px;color:#b9bdd0}
.db-esc-lista{display:flex;flex-direction:column;gap:6px;max-height:24vh;overflow:auto}
.db-esc-fila{display:flex;gap:10px;align-items:center;font-size:14px}
.db-esc-ico.pend{background:rgba(255,255,255,.1);color:#b9bdd0}
.db-esc-ico.err{background:rgba(245,192,68,.2);color:#F5C044}
.db-esc-busc{color:#b9bdd0;font-weight:500;font-size:17px}
.db-esc-reint{min-height:44px;border-radius:12px;border:1px solid rgba(245,192,68,.5);background:rgba(245,192,68,.12);color:#F5C044;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.db-esc-ico{width:22px;height:22px;border-radius:50%;background:rgba(46,230,182,.18);color:#2ee6b6;display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
`;
