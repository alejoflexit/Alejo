import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { armarCadetes, resumen, enMano, quedaronPlanta, saludDatos, hhmm, hace, INICIO_REPARTO, FIN_REPARTO, BALDE, CORTE_21 } from "./monitoreoShared";

// Monitoreo — progreso del reparto POR CADETE, en vivo, + detector de caída de datos.
// Fuente: bridge del VPS GET /reparto (Excel de ENVIOS con Fecha A planta = hoy, obs=2, cache 3 min).
// "Fecha estado" del Excel = hora del último estado de cada envío: de ahí salen la salida de cada
// cadete, su última entrega, el ritmo y la actividad general cada 15' (si se corta, es una caída).

const BRIDGE_URL = "https://srv1801226.hstgr.cloud/bridge/reparto";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // misma key que Arribos/Zonas (riesgo aceptado, ver spec-lightdata-bridge)
const REFRESH_MS = 3 * 60 * 1000;

const C = {
  card: "#1A1A4A", cardAlt: "#12123A", border: "rgba(255,255,255,0.08)",
  text: "#fff", muted: "rgba(255,255,255,0.55)", faint: "rgba(255,255,255,0.35)",
  ok: "#2ECFAA", warn: "#EF9F27", crit: "#E24B4A", info: "#7FB2FF",
};
const TONO = {
  ok: { c: C.ok, bg: "rgba(46,207,170,0.12)" },
  warn: { c: C.warn, bg: "rgba(239,159,39,0.12)" },
  crit: { c: C.crit, bg: "rgba(226,75,74,0.12)" },
  info: { c: C.info, bg: "rgba(127,178,255,0.12)" },
};
const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n || 0));
function minutosDe(iso) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(iso ? new Date(iso) : new Date());
  return (+p.find((x) => x.type === "hour").value % 24) * 60 + +p.find((x) => x.type === "minute").value;
}

const FILTROS = [
  ["atencion", "Atención"],
  ["en_ruta", "En ruta"],
  ["termino", "Terminaron"],
  ["todos", "Todos"],
];

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
      setError({ msg: String(e.message || e), at: new Date().toISOString() }); // conserva el último dato bueno
    } finally { enCurso.current = false; setCargando(false); }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    const reloj = setInterval(() => setTick((x) => x + 1), 60 * 1000); // "hace X min" avanza solo
    const vis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); clearInterval(reloj); document.removeEventListener("visibilitychange", vis); };
  }, [cargar]);

  const ahoraDato = datos ? minutosDe(datos.actualizado) : null;
  const ahoraReal = minutosDe();
  const cadetes = useMemo(() => (datos ? armarCadetes(datos.porCadete, ahoraDato) : []), [datos, ahoraDato]);
  const res = useMemo(() => resumen(cadetes, datos), [cadetes, datos]);
  // La salud se mide contra la hora REAL: si el bridge dejó de responder, el dato envejece y también alarma.
  const salud = useMemo(() => saludDatos(datos, ahoraReal), [datos, ahoraReal]);

  const cuenta = useMemo(() => ({
    atencion: cadetes.filter((c) => c.estado.atencion || c.estado.clave === "no_salio").length,
    en_ruta: cadetes.filter((c) => !["termino"].includes(c.estado.clave) && !c.estado.atencion && c.estado.clave !== "no_salio").length,
    termino: cadetes.filter((c) => c.estado.clave === "termino").length,
    todos: cadetes.length,
  }), [cadetes]);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return cadetes.filter((c) => {
      if (q) return c.nombre.toLowerCase().includes(q);
      if (filtro === "atencion") return c.estado.atencion || c.estado.clave === "no_salio";
      if (filtro === "en_ruta") return c.estado.clave !== "termino" && !c.estado.atencion && c.estado.clave !== "no_salio";
      if (filtro === "termino") return c.estado.clave === "termino";
      return true;
    });
  }, [cadetes, filtro, busca]);

  if (sinEndpoint) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, maxWidth: 620 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Falta activar el monitoreo en el servidor</div>
        <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
          El código ya está en el repo del vault (<code>vps/lightdata-bridge.js</code>, endpoint <code>/reparto</code>). Falta correr
          <code> bash /root/obsidian-flexit/vps/deploy-bridge.sh</code> en el VPS (se lo podés pedir a Hermes). Después esta pantalla arranca sola.
        </div>
      </div>
    );
  }

  const pct = res.total ? Math.round((res.e / res.total) * 100) : 0;
  const datoViejo = datos && ahoraReal - ahoraDato >= 10;

  return (
    <div>
      {/* ── Salud del dato ── */}
      <SaludBanner salud={salud} error={error} datos={datos} datoViejo={datoViejo} ahoraReal={ahoraReal} ahoraDato={ahoraDato} />

      {!datos && !error && <div style={{ color: C.muted, fontSize: 14, padding: "30px 4px" }}>Bajando el reparto de hoy desde LightData… (tarda hasta un minuto)</div>}

      {datos && (<>
        {/* ── Actividad del día ── */}
        <Actividad datos={datos} huecos={salud.huecos || []} ahora={ahoraReal} />

        {/* ── Números del día ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, margin: "14px 0 18px" }}>
          <Kpi titulo="Entregados" valor={`${num(res.e)} / ${num(res.total)}`} sub={`${pct}% del día`} color={C.ok} barra={pct} />
          <Kpi titulo="Flex sin gestionar" valor={num(res.flexSinGest)} sub={`de ${num(res.flexPend)} Flex pendientes · sin Nadie ni reprogramado`} color={!res.flexSinGest ? C.ok : ahoraDato >= 20 * 60 ? C.crit : C.warn} />
          <Kpi titulo="Ya gestionados" valor={num(res.nadie + res.repro)} sub={`${num(res.nadie)} Nadie · ${num(res.repro)} reprogramados`} />
          <Kpi titulo="En la calle" valor={num(res.camino)} sub={`${res.enRuta} cadetes en ruta`} />
          <Kpi titulo="No salieron" valor={num(res.noSalio)} sub="todo en planta" color={res.noSalio ? C.crit : null} onClick={() => { setFiltro("atencion"); setBusca(""); }} />
          <Kpi titulo="Para mirar" valor={num(res.atencion)} sub="frenados · sin entregas · tarde" color={res.atencion ? C.warn : null} onClick={() => { setFiltro("atencion"); setBusca(""); }} />
          <Kpi titulo="Terminaron" valor={num(res.termino)} sub={`de ${cadetes.length} cadetes`} />
          {(res.sinAsignar > 0 || res.internos > 0) && (
            <Kpi titulo="Sin cadete" valor={num(res.sinAsignar)} sub={`${datos.sinAsignar.planta} en planta${res.internos ? ` · ${res.internos} en usuarios internos` : ""}`} color={datos.sinAsignar.planta ? C.warn : null} />
          )}
        </div>

        {/* ── Filtros ── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden", flexWrap: "wrap" }}>
            {FILTROS.map(([k, lbl]) => (
              <button key={k} onClick={() => { setFiltro(k); setBusca(""); }}
                style={{ background: filtro === k && !busca ? "rgba(46,207,170,0.15)" : "none", border: "none", color: filtro === k && !busca ? C.ok : C.muted, padding: "7px 12px", fontSize: 13, fontWeight: filtro === k ? 700 : 500, cursor: "pointer" }}>
                {lbl} <span style={{ opacity: 0.7 }}>{cuenta[k]}</span>
              </button>
            ))}
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cadete…"
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, padding: "7px 12px", fontSize: 13, width: 170, maxWidth: "50vw" }} />
          <button onClick={cargar} disabled={cargando} title="Actualizar ahora"
            style={{ marginLeft: "auto", background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.muted, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>
            {cargando ? "Actualizando…" : "⟳ Actualizar"}
          </button>
        </div>

        {/* ── Cadetes ── */}
        {visibles.length === 0 ? (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, color: C.muted, fontSize: 14 }}>
            {filtro === "atencion" && !busca ? "✅ Nadie para mirar: todos los cadetes con carga vienen avanzando." : "No hay cadetes para mostrar."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibles.map((c) => (
              <FilaCadete key={c.nombre} c={c} ahora={ahoraDato} abierto={abierto === c.nombre} onToggle={() => setAbierto(abierto === c.nombre ? null : c.nombre)} />
            ))}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 14, lineHeight: 1.6 }}>
          Envíos con Fecha A planta = hoy (todos los orígenes). "Salió" = primer movimiento fuera de planta · "Sin gestionar" = pendiente sin Nadie ni reprogramado hoy (se cruza con el historial de LightData, también los que volvieron a planta) ·
          "Frenado" = le quedan sin gestionar y no entrega hace 60' o más ·
          "Termina tarde" = a su ritmo actual pasaría las 21:00. Se actualiza solo cada 3 minutos.
        </div>
      </>)}
    </div>
  );
}

function SaludBanner({ salud, error, datos, datoViejo, ahoraReal, ahoraDato }) {
  let nivel = salud.nivel, titulo = salud.titulo, detalle = salud.detalle;
  if (error) {
    nivel = "crit";
    titulo = "No se pudo bajar el dato de LightData";
    detalle = datos ? `Mostrando lo último que llegó (${hhmm(ahoraDato)}, ${hace(ahoraReal - ahoraDato)}). Error: ${error.msg}` : `Error: ${error.msg}`;
  } else if (datoViejo && nivel === "ok") {
    nivel = "warn"; titulo = "El dato no se está actualizando"; detalle = `Último dato bajado a las ${hhmm(ahoraDato)} (${hace(ahoraReal - ahoraDato)}).`;
  }
  if (!datos && !error) return null;
  const t = TONO[nivel] || TONO.info;
  const icono = nivel === "ok" ? "●" : nivel === "warn" ? "▲" : "■";
  return (
    <div role="status" style={{ background: t.bg, border: `1px solid ${t.c}55`, borderRadius: 12, padding: "11px 14px", marginBottom: 12, display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span style={{ color: t.c, fontSize: 14, lineHeight: "20px" }} aria-hidden="true">{icono}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: nivel === "ok" ? C.text : t.c, fontSize: 14 }}>{titulo}</div>
        {detalle && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{detalle}</div>}
        {salud.huecos && salud.huecos.length > 0 && (
          <div style={{ fontSize: 12.5, color: C.warn, marginTop: 4 }}>
            Hoy hubo {salud.huecos.length === 1 ? "un tramo" : `${salud.huecos.length} tramos`} sin datos: {salud.huecos.map((h) => `${hhmm(h.desde)}–${hhmm(h.hasta)}`).join(" · ")}
          </div>
        )}
      </div>
      {datos && <span style={{ fontSize: 11.5, color: C.faint, whiteSpace: "nowrap" }}>dato {hhmm(ahoraDato)}</span>}
    </div>
  );
}

// Barras de entregas cada 15' de 10 a 23 hs; los tramos sin ningún movimiento quedan marcados en rojo.
function Actividad({ datos, huecos, ahora }) {
  const baldes = [];
  for (let b = INICIO_REPARTO; b < FIN_REPARTO; b += BALDE) baldes.push(b);
  const max = Math.max(1, ...baldes.map((b) => datos.entregas[String(b)] || 0));
  const enHueco = (b) => huecos.some((h) => b >= h.desde && b < h.hasta);
  const ultimo = datos.ultimoEvento;
  const silencioActual = (b) => ultimo !== null && b > ultimo && b + BALDE <= ahora && ahora - ultimo >= 45;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 8 }}>
        <span>Entregas cada 15 minutos</span>
        <span>{datos.ultimaEntrega !== null ? `última entrega ${hhmm(datos.ultimaEntrega)}` : "sin entregas todavía"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 54 }} aria-label="Entregas cada 15 minutos">
        {baldes.map((b) => {
          const n = datos.entregas[String(b)] || 0;
          const rojo = enHueco(b) || silencioActual(b);
          const futuro = b > ahora;
          return (
            <div key={b} title={`${hhmm(b)}–${hhmm(b + BALDE)}: ${n} entregas`}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", background: rojo ? "rgba(226,75,74,0.22)" : "transparent", borderRadius: 2 }}>
              <div style={{ width: "100%", height: `${Math.max(n ? 6 : 0, (n / max) * 100)}%`, background: futuro ? "rgba(255,255,255,0.1)" : b >= CORTE_21 ? C.warn : C.ok, borderRadius: 2, opacity: futuro ? 0.5 : 0.9 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.faint, marginTop: 4 }}>
        {[10, 13, 16, 19, 21, 23].map((h) => <span key={h}>{h}h</span>)}
      </div>
    </div>
  );
}

function Chip({ tono, children }) {
  const t = TONO[tono] || TONO.info;
  return <span style={{ fontSize: 12, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.c, fontWeight: 600 }}>{children}</span>;
}

function Kpi({ titulo, valor, sub, color, barra, onClick }) {
  return (
    <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "11px 13px", cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: color || C.text, letterSpacing: "-0.02em" }}>{valor}</div>
      {barra !== undefined && (
        <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", margin: "6px 0 2px", overflow: "hidden" }}>
          <div style={{ width: `${barra}%`, height: "100%", background: C.ok }} />
        </div>
      )}
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function FilaCadete({ c, ahora, abierto, onToggle }) {
  const t = TONO[c.estado.tono] || TONO.info;
  const pct = c.t ? (c.e / c.t) * 100 : 0;
  const pr = c.estado.pr;
  const ref = c.ultimaEnt ?? null;
  const dato = (lbl, val, color) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: C.faint }}>{lbl}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color || C.text }}>{val}</div>
    </div>
  );
  const horas = Object.keys(c.entH || {}).map(Number);
  const hMin = horas.length ? Math.min(...horas) : null, hMax = horas.length ? Math.max(...horas) : null;
  return (
    <div style={{ background: C.card, border: `1px solid ${c.estado.atencion || c.estado.clave === "no_salio" ? t.c + "44" : C.border}`, borderRadius: 12, padding: "11px 14px" }}>
      <button onClick={onToggle} aria-expanded={abierto}
        style={{ all: "unset", display: "block", width: "100%", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
          <span style={{ fontWeight: 700, fontSize: 14.5 }}>{c.nombre}</span>
          <span style={{ fontSize: 11.5, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.c, fontWeight: 700 }}>{c.estado.label}</span>
          <span style={{ marginLeft: "auto", fontSize: 13, color: C.muted }}>
            <b style={{ color: C.text }}>{c.e}</b>/{c.t} · <b style={{ color: c.pend ? C.text : C.ok }}>{c.pend}</b> pend.
            {c.mlPend !== undefined && c.mlPend > 0 && <> · <b style={{ color: c.flexSinGest ? C.crit : C.text }}>{c.mlPend}</b> Flex</>}
          </span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden", marginBottom: 9 }}>
          <div style={{ width: `${pct.toFixed(1)}%`, height: "100%", background: c.estado.clave === "termino" ? C.ok : t.c, transition: "width .5s" }} />
        </div>
        {c.pend > 0 && c.sinGest !== undefined && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
            {c.flexSinGest > 0 && <Chip tono={ahora >= 20 * 60 ? "crit" : "warn"}>{c.flexSinGest} Flex sin gestionar</Chip>}
             {enMano(c) > 0 && <Chip tono="info">{enMano(c)} en la calle sin intento</Chip>}
            {quedaronPlanta(c) > 0 && <Chip tono="warn">{quedaronPlanta(c)} quedaron en planta</Chip>}
            {c.nadie > 0 && <Chip tono="info">{c.nadie} Nadie</Chip>}
            {c.reproC > 0 && <Chip tono="info">{c.reproC} Repro. comprador</Chip>}
            {c.reproM > 0 && <Chip tono="info">{c.reproM} Repro. Meli</Chip>}
            {c.tarde > 0 && <Chip tono="warn">{c.tarde} marcados después de las 21</Chip>}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          {dato("Salió", c.salida !== null ? hhmm(c.salida) : "—", c.salida === null && c.pend ? C.crit : null)}
          {dato("Última entrega", ref !== null ? `${hhmm(ref)} · ${hace(Math.max(0, ahora - ref))}` : "—", c.estado.clave === "frenado" ? C.warn : null)}
          {dato("Ritmo", pr ? `${String(pr.ritmo).replace(".", ",")} /h` : "—")}
          {dato("Fin estimado", pr && pr.fin !== null ? (pr.fin >= 23 * 60 ? "después de las 23" : hhmm(pr.fin)) : enMano(c) === 0 ? "listo" : "—", pr && pr.fin > CORTE_21 ? C.warn : null)}
        </div>
      </button>
      {abierto && (
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10, fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
          <div>
            En la calle <b style={{ color: C.text }}>{c.camino}</b> · en planta <b style={{ color: c.planta ? C.warn : C.text }}>{c.planta}</b>
            {c.otros ? <> · otros estados (nadie, reprogramado…) <b style={{ color: C.text }}>{c.otros}</b></> : null}
            {c.cancel ? <> · cancelados <b style={{ color: C.text }}>{c.cancel}</b></> : null}
            {c.ml ? <> · Flex <b style={{ color: C.text }}>{c.mlE}/{c.ml}</b></> : null}
          </div>
          {hMin !== null && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {Array.from({ length: hMax - hMin + 1 }, (_, i) => hMin + i).map((h) => (
                <span key={h} style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "2px 8px", fontSize: 12 }}>
                  {h}h: <b style={{ color: (c.entH[h] || 0) ? C.text : C.crit }}>{c.entH[h] || 0}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
