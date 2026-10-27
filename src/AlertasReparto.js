import React, { useEffect, useRef, useState, useCallback } from "react";
import { armarCadetes, enAlerta, saludDatos, minSinEntregar, hace, hhmm } from "./monitoreoShared";

// Alertas del reparto en TODA la app (pedido 26/10): cuando un cadete queda frenado con Flex en
// riesgo, salta un pop-up esté donde esté el usuario dentro de la app, y si la pestaña no está a la
// vista, una notificación del sistema (Windows / Mac / celular) — con permiso del navegador.
// Misma regla que la banda de Monitoreo y el vigía de Telegram (enAlerta). Una vez por cadete por día
// y por navegador. Con la data caída no alerta por cadete (todos parecen frenados).

const BRIDGE_URL = "https://srv1801226.hstgr.cloud/bridge/reparto";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // misma key que Monitoreo (riesgo aceptado)
const CADA_MS = 3 * 60 * 1000;
const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e", rojo: "#E8615F", teal: "#2ee6b6",
  pop: "rgba(24,25,42,0.96)", line: "rgba(255,255,255,0.08)", soft: "rgba(255,255,255,0.06)",
};
const TZ = "America/Argentina/Buenos_Aires";
function ahoraAR(iso) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(iso ? new Date(iso) : new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { dia: `${g("year")}-${g("month")}-${g("day")}`, min: (+g("hour") % 24) * 60 + +g("minute"), dow: g("weekday") };
}
const claveDia = (dia) => `fx_alertas_reparto_${dia}`;
function leerVistos(dia) { try { return new Set(JSON.parse(localStorage.getItem(claveDia(dia)) || "[]")); } catch (e) { return new Set(); } }
function guardarVistos(dia, set) { try { localStorage.setItem(claveDia(dia), JSON.stringify([...set])); } catch (e) {} }

// Monitoreo lee esto al abrir para ir directo al cadete del aviso
export const ABRIR_CADETE_KEY = "fx_monitoreo_abrir";

export default function AlertasReparto({ onIrMonitoreo }) {
  const [cola, setCola] = useState([]); // [{ nombre, flex, texto }]
  const tituloOrig = useRef(null);

  const revisar = useCallback(async () => {
    const a = ahoraAR();
    if (a.dow === "Sun" || a.min < 10 * 60 || a.min > 23 * 60) return;
    let d;
    try {
      const r = await fetch(BRIDGE_URL, { headers: { "x-bridge-key": BRIDGE_KEY }, cache: "no-store" });
      if (!r.ok) return;
      d = await r.json();
    } catch (e) { return; }
    if (!d || !d.porCadete) return;
    if (saludDatos(d, a.min).nivel === "crit") return; // data caída: no alarmar por cadete
    const ahoraDato = ahoraAR(d.actualizado).min;
    const al = armarCadetes(d.porCadete, ahoraDato).filter(enAlerta);
    const vistos = leerVistos(a.dia);
    const nuevos = al.filter((c) => !vistos.has(c.nombre));
    if (!nuevos.length) return;
    nuevos.forEach((c) => vistos.add(c.nombre));
    guardarVistos(a.dia, vistos);
    const items = nuevos.map((c) => {
      const m = minSinEntregar(c, ahoraDato);
      const texto = c.e ? `${c.flexRiesgo} Flex en riesgo · no entrega desde las ${hhmm(c.ultimaEnt ?? c.salida)} (${hace(m)})` : `${c.flexRiesgo} Flex en riesgo · ninguna entrega desde que salió (${hhmm(c.salida)})`;
      return { nombre: c.nombre, flex: c.flexRiesgo, texto };
    });
    setCola((prev) => [...prev, ...items]);
    // Fuera de la pestaña: notificación del sistema (si el usuario la habilitó)
    if (document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      items.forEach((it) => {
        try {
          const n = new Notification(`Ojo, cadete frenado: ${it.nombre}`, { body: it.texto, tag: `fx-frenado-${it.nombre}`, requireInteraction: true });
          n.onclick = () => { window.focus(); try { sessionStorage.setItem(ABRIR_CADETE_KEY, it.nombre); } catch (e) {} onIrMonitoreo && onIrMonitoreo(); window.dispatchEvent(new Event("fx-abrir-cadete")); n.close(); };
        } catch (e) {}
      });
    }
  }, [onIrMonitoreo]);

  useEffect(() => {
    revisar();
    const t = setInterval(revisar, CADA_MS);
    return () => clearInterval(t);
  }, [revisar]);

  // Con alertas sin ver y la pestaña de fondo, el título titila para que se note en la barra
  useEffect(() => {
    if (!cola.length) return;
    if (tituloOrig.current === null) tituloOrig.current = document.title;
    let on = false;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") { document.title = tituloOrig.current; return; }
      on = !on; document.title = on ? `⚠ Cadete frenado (${cola.length})` : tituloOrig.current;
    }, 1200);
    return () => { clearInterval(t); if (tituloOrig.current !== null) document.title = tituloOrig.current; tituloOrig.current = null; };
  }, [cola.length]);

  if (!cola.length) return null;
  const ver = (nombre) => {
    try { sessionStorage.setItem(ABRIR_CADETE_KEY, nombre); } catch (e) {}
    setCola([]);
    onIrMonitoreo && onIrMonitoreo();
    window.dispatchEvent(new Event("fx-abrir-cadete")); // por si Monitoreo ya está abierto
  };
  return (
    <div role="alertdialog" aria-label="Cadete frenado"
      style={{ position: "fixed", right: 16, bottom: 16, width: 360, maxWidth: "calc(100vw - 32px)", zIndex: 3000, background: C.pop, border: `1px solid rgba(232,97,95,0.5)`, borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", padding: "14px 16px", color: C.ink, WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: C.rojo }} />
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>Ojo, {cola.length === 1 ? "cadete frenado" : `${cola.length} cadetes frenados`}</span>
        <button onClick={() => setCola([])} aria-label="Cerrar" style={{ marginLeft: "auto", background: "none", border: "none", color: C.ink3, fontSize: 16, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
        {cola.map((it) => (
          <button key={it.nombre} onClick={() => ver(it.nombre)}
            style={{ textAlign: "left", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", color: C.ink }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.nombre}</div>
            <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 2 }}>{it.texto}</div>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={() => ver(cola[0].nombre)} style={{ flex: 1, background: "rgba(46,230,182,0.12)", border: "1px solid rgba(46,230,182,0.35)", color: C.teal, borderRadius: 10, padding: "8px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Ver en Monitoreo</button>
        <button onClick={() => setCola([])} style={{ background: C.soft, border: `1px solid ${C.line}`, color: C.ink2, borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>Entendido</button>
      </div>
    </div>
  );
}

// Botón para habilitar las notificaciones del sistema (el navegador exige que lo pida un toque).
export function ActivarAvisos() {
  const [perm, setPerm] = useState(() => (typeof Notification === "undefined" ? "no" : Notification.permission));
  if (perm !== "default") return null;
  return (
    <button onClick={() => Notification.requestPermission().then(setPerm).catch(() => {})}
      style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink2, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
      Activar avisos en la compu
    </button>
  );
}
