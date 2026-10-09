import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { armarCadetes, resumen, enMano, quedaronPlanta, saludDatos, hhmm, hace, INICIO_REPARTO, FIN_REPARTO, BALDE } from "./monitoreoShared";
import { slaMeli } from "./slaShared";

// Monitoreo — avance del reparto POR CADETE, en vivo, + detector de caída de datos.
// Fuente: bridge del VPS GET /reparto (Excel A planta = hoy, obs=2, cache 3 min). El bridge clasifica
// cada pendiente con las MISMAS reglas que Métricas (demorados, Repro 21hs, demora Flexit) cruzando el
// historial interno de LightData. Reglas y criterios: wiki analisis/spec-monitoreo-reparto.
// Estética: la del Inicio (vidrio, grises, un solo acento). Color solo en un punto chico de estado.

const BRIDGE_URL = "https://srv1801226.hstgr.cloud/bridge/reparto";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // misma key que Arribos/Zonas (riesgo aceptado, ver spec-lightdata-bridge)
const REFRESH_MS = 3 * 60 * 1000;

const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glass: "rgba(27,28,46,0.72)", line: "rgba(255,255,255,0.06)", soft: "rgba(255,255,255,0.05)",
  teal: "#2ee6b6", ambar: "#F5C044", rojo: "#E8615F",
  grotesk: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
};
const card = { background: C.glass, border: `1px solid ${C.line}`, borderRadius: 16, WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)" };
const PUNTO = { ok: C.teal, atencion: C.ambar, critico: C.rojo, neutro: C.ink3 };
const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n || 0));
function minutosDe(iso) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(iso ? new Date(iso) : new Date());
  return (+p.find((x) => x.type === "hour").value % 24) * 60 + +p.find((x) => x.type === "minute").value;
}
const tonoEstado = (e) => (e.clave === "termino" ? "ok" : e.atencion || e.clave === "no_salio" ? "atencion" : "neutro");

const FILTROS = [["atencion", "Para mirar"], ["en_ruta", "En ruta"], ["termino", "Terminaron"], ["todos", "Todos"]];
const esAtencion = (c) => c.estado.atencion || c.estado.clave === "no_salio";

export default function Monitoreo() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [sinEndpoint, setSinEndpoint] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState("atencion");
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [, setTick] = useState(0);
  const enCurso = useRef(false);

  const cargar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true; setCargando(true);
    try {
      const r = await fetch(BRIDGE_URL, { headers: { "x-bridge-key": BRIDGE_KEY }, cache: "no-store" });
      if (r.status === 404) { setSinEndpoint(true); return; }
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.porCadete) throw new Error((j && j.error) || `bridge → ${r.status}`);
      setSinEndpoint(false); setDatos(j); setError(null);
    } catch (e) {
      setError({ msg: String(e.message || e) }); // conserva el último dato bueno
    } finally { enCurso.current = false; setCargando(false); }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    const reloj = setInterval(() => setTick((x) => x + 1), 60 * 1000);
    const vis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); clearInterval(reloj); document.removeEventListener("visibilitychange", vis); };
  }, [cargar]);

  const ahoraDato = datos ? minutosDe(datos.actualizado) : null;
  const ahoraReal = minutosDe();
  const cadetes = useMemo(() => (datos ? armarCadetes(datos.porCadete, ahoraDato) : []), [datos, ahoraDato]);
  const res = useMemo(() => resumen(cadetes, datos), [cadetes, datos]);
  const salud = useMemo(() => saludDatos(datos, ahoraReal), [datos, ahoraReal]);
  const conReglas = cadetes.some((c) => c.flexRiesgo !== undefined);

  const cuenta = useMemo(() => ({
    atencion: cadetes.filter(esAtencion).length,
    en_ruta: cadetes.filter((c) => c.estado.clave !== "termino" && !esAtencion(c)).length,
    termino: cadetes.filter((c) => c.estado.clave === "termino").length,
    todos: cadetes.length,
  }), [cadetes]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return cadetes.filter((c) => {
      if (q) return c.nombre.toLowerCase().includes(q);
      if (filtro === "atencion") return esAtencion(c);
      if (filtro === "en_ruta") return c.estado.clave !== "termino" && !esAtencion(c);
      if (filtro === "termino") return c.estado.clave === "termino";
      return true;
    });
  }, [cadetes, filtro, busca]);

  if (sinEndpoint) {
    return (
      <div style={{ ...card, padding: 28, maxWidth: 620 }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, color: C.ink }}>Falta activar el monitoreo en el servidor</div>
        <div style={{ fontSize: 13.5, color: C.ink2, lineHeight: 1.6 }}>
          Falta correr <code>deploy-bridge.sh</code> en el VPS (endpoint <code>/reparto</code>). Después esta pantalla arranca sola.
        </div>
      </div>
    );
  }

  const pct = res.total ? Math.round((res.e / res.total) * 100) : 0;
  // SLA Meli si el día cerrara ahora: misma fórmula que Métricas (slaShared). Tiene sentido de noche.
  const slaProy = conReglas && ahoraDato >= 20 * 60 ? slaMeli(res.ml, res.flexRiesgo, res.repro21) : null;

  return (
    <div style={{ color: C.ink }}>
      <SaludBanner salud={salud} error={error} datos={datos} ahoraReal={ahoraReal} ahoraDato={ahoraDato} />

      {!datos && !error && <div style={{ color: C.ink2, fontSize: 14, padding: "30px 4px" }}>Bajando el reparto de hoy desde LightData… (puede tardar un minuto)</div>}

      {datos && (<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "12px 0" }}>
          <Kpi titulo="Entregados" valor={`${num(res.e)}`} extra={`/ ${num(res.total)}`} sub={`${pct}% del día`} barra={pct} />
          {conReglas ? (<>
            <Kpi titulo="Flex en riesgo de demora" valor={num(res.flexRiesgo)} punto={res.flexRiesgo ? "atencion" : "ok"}
              sub={slaProy !== null ? `si cerrara ahora: SLA Meli ${slaProy.toFixed(1).replace(".", ",")}%` : `de ${num(res.flexPend)} Flex pendientes`} />
            <Kpi titulo="Repro 21hs" valor={num(res.repro21)} punto={res.repro21 ? "atencion" : null} sub="Flex con intento después de las 21" />
            <Kpi titulo="Con intento" valor={num(res.nadie + res.repro + res.otros)} sub={`${num(res.nadie)} Nadie · ${num(res.repro)} reprog.${res.otros ? ` · ${num(res.otros)} otros` : ""}`} />
          </>) : <Kpi titulo="En la calle" valor={num(res.camino)} sub={`${res.enRuta} cadetes en ruta`} />}
          <Kpi titulo="Cadetes" valor={num(res.termino)} extra={`/ ${num(cadetes.length)}`} sub={`terminaron · ${res.noSalio} sin salir`} />
        </div>

        <Actividad datos={datos} huecos={salud.huecos || []} ahora={ahoraReal} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "16px 0 10px" }}>
          <div style={{ display: "flex", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
            {FILTROS.map(([k, lbl]) => {
              const on = filtro === k && !busca;
              return (
                <button key={k} onClick={() => { setFiltro(k); setBusca(""); }}
                  style={{ background: on ? "rgba(255,255,255,0.09)" : "none", border: "none", borderRadius: 8, color: on ? C.ink : C.ink2, padding: "6px 12px", fontSize: 13, fontWeight: on ? 600 : 500, cursor: "pointer" }}>
                  {lbl} <span style={{ color: C.ink3 }}>{cuenta[k]}</span>
                </button>
              );
            })}
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cadete…"
            style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, padding: "8px 12px", fontSize: 13, width: 170, maxWidth: "50vw" }} />
          <button onClick={cargar} disabled={cargando}
            style={{ marginLeft: "auto", background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink2, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {visibles.length === 0 ? (
          <div style={{ ...card, padding: 22, color: C.ink2, fontSize: 14 }}>
            {filtro === "atencion" && !busca ? "Nadie para mirar: todos los cadetes con carga vienen avanzando." : "No hay cadetes para mostrar."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibles.map((c) => (
              <FilaCadete key={c.nombre} c={c} ahora={ahoraDato} abierto={abierto === c.nombre} onToggle={() => setAbierto(abierto === c.nombre ? null : c.nombre)} />
            ))}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 14, lineHeight: 1.6 }}>
          Mismas reglas que Métricas. Flex en riesgo = en camino, en planta o sin estado sin un Nadie/reprogramado antes de las 21 (historial de hoy o ayer): sería demorado si el día cerrara ahora.
          Repro 21hs = Nadie o reprogramado a las 21:00 o después sin intento previo. Particulares sin visita = en camino, en planta o sin estado.
          Frenado = lleva envíos sin intento y no entrega hace 60' o más. Se actualiza cada 3 minutos.
        </div>
      </>)}
    </div>
  );
}

function Punto({ tono }) {
  if (!tono) return null;
  return <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: PUNTO[tono] || PUNTO.neutro, flexShrink: 0 }} />;
}

function SaludBanner({ salud, error, datos, ahoraReal, ahoraDato }) {
  if (!datos && !error) return null;
  let tono = salud.nivel === "crit" ? "critico" : salud.nivel === "warn" ? "atencion" : "ok";
  let titulo = salud.titulo, detalle = salud.detalle;
  if (error) {
    tono = "critico"; titulo = "No se pudo bajar el dato de LightData";
    detalle = datos ? `Mostrando lo último que llegó (${hhmm(ahoraDato)}, ${hace(ahoraReal - ahoraDato)}). ${error.msg}` : error.msg;
  } else if (datos && ahoraReal - ahoraDato >= 10 && tono === "ok") {
    tono = "atencion"; titulo = "El dato no se está actualizando"; detalle = `Último dato bajado a las ${hhmm(ahoraDato)} (${hace(ahoraReal - ahoraDato)}).`;
  }
  return (
    <div role="status" style={{ ...card, padding: "11px 14px", display: "flex", gap: 10, alignItems: "baseline" }}>
      <Punto tono={tono} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{titulo}</span>
        {detalle && <span style={{ fontSize: 13, color: C.ink2 }}> · {detalle}</span>}
        {salud.huecos && salud.huecos.length > 0 && (
          <div style={{ fontSize: 12.5, color: C.ink2, marginTop: 3 }}>
            Hoy hubo {salud.huecos.length === 1 ? "un tramo" : `${salud.huecos.length} tramos`} sin datos: {salud.huecos.map((h) => `${hhmm(h.desde)}–${hhmm(h.hasta)}`).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

// Entregas cada 15' de 10 a 23 hs. Un tramo sin ningún movimiento queda como hueco gris rayado.
function Actividad({ datos, huecos, ahora }) {
  const baldes = [];
  for (let b = INICIO_REPARTO; b < FIN_REPARTO; b += BALDE) baldes.push(b);
  const max = Math.max(1, ...baldes.map((b) => datos.entregas[String(b)] || 0));
  const ultimo = datos.ultimoEvento;
  const hueco = (b) => huecos.some((h) => b >= h.desde && b < h.hasta) || (ultimo !== null && b > ultimo && b + BALDE <= ahora && ahora - ultimo >= 45);
  return (
    <div style={{ ...card, padding: "12px 14px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.ink3, marginBottom: 8 }}>
        <span>Entregas cada 15 minutos</span>
        <span>{datos.ultimaEntrega !== null ? `última ${hhmm(datos.ultimaEntrega)}` : "sin entregas todavía"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48 }}>
        {baldes.map((b) => {
          const n = datos.entregas[String(b)] || 0;
          return (
            <div key={b} title={`${hhmm(b)}–${hhmm(b + BALDE)}: ${n} entregas`}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", borderRadius: 2,
                background: hueco(b) ? "repeating-linear-gradient(135deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 5px)" : "transparent" }}>
              <div style={{ width: "100%", height: `${Math.max(n ? 5 : 0, (n / max) * 100)}%`, background: b > ahora ? C.soft : "rgba(46,230,182,0.55)", borderRadius: 2 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.ink3, marginTop: 4 }}>
        {[10, 13, 16, 19, 21, 23].map((h) => <span key={h}>{h}h</span>)}
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, extra, sub, barra, punto }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={{ fontSize: 12, color: C.ink3, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Punto tono={punto} />{titulo}</div>
      <div style={{ fontFamily: C.grotesk, fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px" }}>
        {valor}{extra && <span style={{ fontSize: 15, color: C.ink3, fontWeight: 500 }}> {extra}</span>}
      </div>
      {barra !== undefined && (
        <div style={{ height: 3, borderRadius: 2, background: C.soft, margin: "7px 0 2px", overflow: "hidden" }}>
          <div style={{ width: `${barra}%`, height: "100%", background: C.teal, opacity: 0.8 }} />
        </div>
      )}
      <div style={{ fontSize: 12, color: C.ink2, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

function FilaCadete({ c, ahora, abierto, onToggle }) {
  const pct = c.t ? (c.e / c.t) * 100 : 0;
  const pr = c.estado.pr;
  const ref = c.ultimaEnt ?? null;
  const conReglas = c.flexRiesgo !== undefined;
  const dato = (lbl, val) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.ink3 }}>{lbl}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: C.ink }}>{val}</div>
    </div>
  );
  // Qué le queda: una línea en texto plano, lo importante primero
  const queda = [];
  if (conReglas) {
    if (c.flexRiesgo) queda.push(`${c.flexRiesgo} Flex en riesgo`);
    if (c.repro21) queda.push(`${c.repro21} Repro 21hs`);
    if (c.partSinVisita) queda.push(`${c.partSinVisita} particular${c.partSinVisita > 1 ? "es" : ""} sin visita`);
    if (quedaronPlanta(c)) queda.push(`${quedaronPlanta(c)} en planta`);
    if (c.nadie) queda.push(`${c.nadie} Nadie`);
    if (c.repro) queda.push(`${c.repro} reprogramado${c.repro > 1 ? "s" : ""}`);
    for (const [nom, n] of Object.entries(c.otroRes || {})) queda.push(`${n} ${nom}`);
  }
  const horas = Object.keys(c.entH || {}).map(Number);
  const hMin = horas.length ? Math.min(...horas) : null, hMax = horas.length ? Math.max(...horas) : null;
  const finTxt = pr && pr.fin !== null ? (pr.fin >= 23 * 60 ? "después de las 23" : hhmm(pr.fin)) : enMano(c) === 0 ? "listo" : "—";
  return (
    <div style={{ ...card, borderRadius: 14, padding: "12px 14px" }}>
      <button onClick={onToggle} aria-expanded={abierto} style={{ all: "unset", display: "block", width: "100%", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14.5 }}>{c.nombre}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.ink2 }}>
            <Punto tono={tonoEstado(c.estado)} />{c.estado.label}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: C.ink2, fontFamily: C.grotesk }}>
            <span style={{ color: C.ink }}>{c.e}</span>/{c.t}
            {c.mlPend !== undefined && <> · <span style={{ color: C.ink }}>{c.mlPend}</span> Flex pend.</>}
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: C.soft, overflow: "hidden", marginBottom: 9 }}>
          <div style={{ width: `${pct.toFixed(1)}%`, height: "100%", background: C.teal, opacity: 0.75, transition: "width .5s" }} />
        </div>
        {queda.length > 0 && <div style={{ fontSize: 12.5, color: C.ink2, marginBottom: 9 }}>{queda.join(" · ")}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          {dato("Salió", c.salida !== null ? hhmm(c.salida) : "—")}
          {dato("Última entrega", ref !== null ? `${hhmm(ref)} · ${hace(Math.max(0, ahora - ref))}` : "—")}
          {dato("Ritmo", pr ? `${String(pr.ritmo).replace(".", ",")} por hora` : "—")}
          {dato("Fin estimado", finTxt)}
        </div>
      </button>
      {abierto && hMin !== null && (
        <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 10, paddingTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: hMax - hMin + 1 }, (_, i) => hMin + i).map((h) => (
            <span key={h} style={{ background: C.soft, borderRadius: 7, padding: "3px 9px", fontSize: 12, color: C.ink2 }}>
              {h}h <span style={{ color: C.ink, fontWeight: 600 }}>{c.entH[h] || 0}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
